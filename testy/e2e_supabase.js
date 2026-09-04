#!/usr/bin/env node
/**
 * AsterA Coach — TESTY OD KOŃCA DO KOŃCA NA ŻYWYM SUPABASE
 *
 *     npm run e2e
 *
 * Wykonuje 26 scenariuszy z `testy/oczekujace.md` przeciwko PRAWDZIWEMU
 * projektowi: Auth, Storage i Edge Function po HTTP. Dla każdego zapisuje
 * wynik, krótki opis i surową odpowiedź systemu do `testy/WYNIK_E2E.md`
 * oraz `testy/wynik_e2e.json`.
 *
 * WYNIKI mają cztery stany i żaden z nich nie jest wpisywany na sztywno:
 *   PASS       — sprawdzone maszynowo i przeszło
 *   FAIL       — sprawdzone maszynowo i nie przeszło
 *   CZĘŚCIOWY  — część sprawdzona maszynowo, reszta wymaga człowieka
 *   RĘCZNY     — maszynowo nie da się, trzeba wykonać samemu
 *
 * KLUCZE. Czyta je z `.env`. Klucz sekretny służy tylko do zakładania
 * i kasowania kont testowych. Skrypt **nigdy go nie wypisuje** — w raporcie
 * widać wyłącznie rodzaj klucza (`sb_secret_…` albo `eyJ…`).
 *
 * DANE. Wyłącznie konta na domenie `E2E_DOMENA` (domyślnie
 * `e2e.przyklad.pl`). Żadnych prawdziwych kursantów. Sprzątanie wykonuje
 * się także po błędzie i po przerwaniu skryptu (Ctrl+C).
 *
 * KONTO ADMINISTRATORA JEST TRWAŁE. Powstaje raz, pod stałym adresem,
 * i NIE jest kasowane — bo rolę `admin` nadaje mu człowiek w SQL Editorze
 * (patrz sekcja „PIERWSZY ADMINISTRATOR" niżej). Kasowanie go po każdym
 * przebiegu oznaczałoby ręczny krok przed każdym uruchomieniem.
 *
 * UWAGA. Do pierwszego uruchomienia przeciwko żywemu projektowi jest to
 * kod NIESPRAWDZONY. Pierwszy przebieg jest jednocześnie testem samego
 * skryptu; wyniki, które wyjdą, są wynikami, nie deklaracjami.
 */
const fs   = require('fs');
const path = require('path');

const KATALOG = path.join(__dirname, '..');

/* Dokładnie te scenariusze mają się pojawić w raporcie — ani jeden mniej,
   ani jeden dwa razy. Sprawdzane na końcu przebiegu. */
const OCZEKIWANE = [
  'A1','A2','A3','A4','A5','A6','A7','A8','A9','A10',
  'S1','S2','S3','S4','S5','S6','S7',
  'E1','E2','E3','E4','E5','E6','E7','E8','E9',
];

const wyniki = [];
let sprzataj = [];         // { typ: 'user'|'obiekt', co }
let posprzatane = 0, nieposprzatane = [];
let sprzatanieZrobione = false;

/* ══ KONFIGURACJA ═════════════════════════════════════════════════ */
function wczytajEnv() {
  const plik = path.join(KATALOG, '.env');
  if (!fs.existsSync(plik)) {
    console.error('Nie ma pliku .env. Skopiuj .env.example i uzupełnij dane projektu testowego.');
    process.exit(2);
  }
  const w = {};
  for (const l of fs.readFileSync(plik, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m) w[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return w;
}

const env    = wczytajEnv();
const URL_B  = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const PUBL   = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
const SEKR   = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADRES  = (env.ADRES_APLIKACJI || 'http://127.0.0.1:8910').replace(/\/+$/, '');
const BUCKET = env.SUPABASE_BUCKET || 'materialy';
const DOMENA = env.E2E_DOMENA || 'e2e.przyklad.pl';
const HASLO  = env.E2E_HASLO  || 'e2e-Trwale-Haslo-Testowe-9';
const E_ADMIN = env.E2E_ADMIN || `e2e-admin@${DOMENA}`;    // stały adres, nie kasowany
const OBCY_ADRES = 'https://zupelnie-obcy-adres.example/przejmij';

const rodzajKlucza = k => k.startsWith('sb_publishable_') ? 'sb_publishable_… (nowy)'
                        : k.startsWith('sb_secret_')      ? 'sb_secret_… (nowy)'
                        : k.startsWith('eyJ')             ? 'eyJ… (legacy JWT)' : 'nieznany';

if (!URL_B || !PUBL || !SEKR) {
  console.error('Brakuje SUPABASE_URL, klucza publicznego albo sekretnego w .env.');
  process.exit(2);
}

/* ══ POMOCNIKI HTTP ═══════════════════════════════════════════════ */
async function zapytaj(sciezka, { metoda = 'GET', token, klucz = PUBL, dane,
                                  naglowki = {}, surowe, przekierowania = 'follow' } = {}) {
  const o = { method: metoda, headers: { apikey: klucz, ...naglowki }, redirect: przekierowania };
  if (token) o.headers.Authorization = 'Bearer ' + token;
  if (dane !== undefined && !surowe) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(dane);
  } else if (surowe) { o.body = dane; }
  const r = await fetch(URL_B + sciezka, o);
  const tekst = await r.text();
  let json = null; try { json = JSON.parse(tekst); } catch {}
  return { status: r.status, json, tekst, naglowki: r.headers,
           lokalizacja: r.headers.get('location') };
}

const skrot = t => String(t || '').replace(/\s+/g, ' ').slice(0, 240);

/** Jedyna droga do wpisania wyniku. `stan` to PASS/FAIL/CZĘŚCIOWY/RĘCZNY —
    wyliczony z odpowiedzi systemu, nigdy wpisany z góry. */
function zapisz(id, opis, stan, dowod, uwaga) {
  if (wyniki.some(w => w.id === id)) {
    console.error(`BŁĄD SKRYPTU: scenariusz ${id} zapisany dwa razy.`);
    process.exitCode = 2;
    return;
  }
  wyniki.push({ id, opis, wynik: stan, dowod: skrot(dowod), uwaga: uwaga || '' });
  console.log(`[${stan.padEnd(9)}] ${id.padEnd(4)} ${opis}`);
  if (dowod) console.log(`             ${skrot(dowod)}`);
}
const ocena = w => (w ? 'PASS' : 'FAIL');

/* ══ SPRZĄTANIE — także po błędzie i po Ctrl+C ════════════════════ */
async function posprzataj() {
  if (sprzatanieZrobione) return;
  sprzatanieZrobione = true;
  if (!sprzataj.length) return;
  console.log(`\nSprzątam ${sprzataj.length} obiektów testowych…`);
  for (const p of sprzataj.slice().reverse()) {
    try {
      const r = p.typ === 'user'
        ? await zapytaj(`/auth/v1/admin/users/${p.co}`, { metoda: 'DELETE', klucz: SEKR, token: SEKR })
        : await zapytaj(`/storage/v1/object/${BUCKET}/${p.co}`, { metoda: 'DELETE', klucz: SEKR, token: SEKR });
      if (r.status < 300) posprzatane++; else nieposprzatane.push(`${p.typ} ${p.co} (${r.status})`);
    } catch (e) { nieposprzatane.push(`${p.typ} ${p.co} (${e.message})`); }
  }
  console.log(`posprzątane: ${posprzatane}` +
    (nieposprzatane.length ? ` · ZOSTAŁO: ${nieposprzatane.join(', ')}` : ''));
}

async function przerwij(sygnal) {
  console.log(`\nPrzerwane (${sygnal}). Nie zostawiam śmieci.`);
  await posprzataj();
  zapiszRaport('PRZERWANY');
  process.exit(130);
}
process.on('SIGINT',  () => { przerwij('SIGINT'); });
process.on('SIGTERM', () => { przerwij('SIGTERM'); });

/* ══ KONTA TESTOWE ════════════════════════════════════════════════ */
const konto = rola => `e2e-${rola}-${Date.now().toString(36)}@${DOMENA}`;

async function znajdzKonto(email) {
  const r = await zapytaj(`/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { klucz: SEKR, token: SEKR });
  return (r.json?.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function zalozKonto(email, imie, { trwale = false } = {}) {
  const istnieje = await znajdzKonto(email);
  if (istnieje) {
    if (!trwale) sprzataj.push({ typ: 'user', co: istnieje.id });
    return istnieje.id;
  }
  const r = await zapytaj('/auth/v1/admin/users', {
    metoda: 'POST', klucz: SEKR, token: SEKR,
    dane: { email, password: HASLO, email_confirm: true, user_metadata: { imie } },
  });
  if (r.status >= 300) throw new Error(`Nie udało się założyć ${email}: ${skrot(r.tekst)}`);
  if (!trwale) sprzataj.push({ typ: 'user', co: r.json.id });
  return r.json.id;
}

const zaloguj = email => zapytaj('/auth/v1/token?grant_type=password',
  { metoda: 'POST', dane: { email, password: HASLO } });

const odswiez = refresh => zapytaj('/auth/v1/token?grant_type=refresh_token',
  { metoda: 'POST', dane: { refresh_token: refresh } });

const jakoAdmin = (token, sciezka, opcje = {}) =>
  zapytaj('/rest/v1' + sciezka, { ...opcje, token,
    naglowki: { Prefer: 'return=representation', ...(opcje.naglowki || {}) } });

/* ══ RAPORT ═══════════════════════════════════════════════════════ */
function zapiszRaport(status = 'ZAKOŃCZONY') {
  const licz = s => wyniki.filter(w => w.wynik === s).length;
  const oblane = wyniki.filter(w => w.wynik === 'FAIL');

  const brakujace = OCZEKIWANE.filter(id => !wyniki.some(w => w.id === id));
  const nadmiarowe = wyniki.map(w => w.id).filter(id => !OCZEKIWANE.includes(id));
  const unikalne = new Set(wyniki.map(w => w.id)).size;
  const kompletne = unikalne === OCZEKIWANE.length && !brakujace.length && !nadmiarowe.length;

  const naglowek = [
    '# WYNIK E2E — żywy projekt Supabase', '',
    `Przebieg: **${status}** · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    `Projekt: \`${URL_B}\` (bez kluczy)`,
    `Klucz publiczny: ${rodzajKlucza(PUBL)} · sekretny: ${rodzajKlucza(SEKR)}`,
    `Konta testowe: \`@${DOMENA}\``,
    '',
    `**PASS: ${licz('PASS')} · FAIL: ${licz('FAIL')} · CZĘŚCIOWY: ${licz('CZĘŚCIOWY')} · ` +
    `RĘCZNY: ${licz('RĘCZNY')} · razem: ${wyniki.length} / ${OCZEKIWANE.length}**`,
    '',
    kompletne
      ? '_Komplet: 26 unikalnych scenariuszy, każdy raz._'
      : `**NIEKOMPLETNY RAPORT** — unikalnych: ${unikalne}` +
        (brakujace.length ? ` · brakuje: ${brakujace.join(', ')}` : '') +
        (nadmiarowe.length ? ` · nadmiarowe: ${nadmiarowe.join(', ')}` : ''),
    '',
    '| # | scenariusz | wynik | dowód — odpowiedź systemu |', '|---|---|---|---|',
  ];
  const kolejnosc = id => { const i = OCZEKIWANE.indexOf(id); return i < 0 ? 999 : i; };
  const wiersze = wyniki.slice().sort((a, b) => kolejnosc(a.id) - kolejnosc(b.id)).map(w =>
    `| ${w.id} | ${w.opis} | **${w.wynik}** | \`${w.dowod || '—'}\`${w.uwaga ? '<br>' + w.uwaga : ''} |`);

  const stopka = ['', '## Sprzątanie', '',
    `Usunięto ${posprzatane} obiektów testowych.`,
    nieposprzatane.length
      ? `**Zostało do ręcznego usunięcia:** ${nieposprzatane.join(', ')}`
      : 'Nic nie zostało.',
    `Konto \`${E_ADMIN}\` jest **trwałe** i celowo nie jest kasowane — ma nadaną rolę admin.`,
    '', '## Werdykt', '',
    status !== 'ZAKOŃCZONY'
      ? `**NIEGOTOWE.** Przebieg zakończył się jako ${status}.`
      : (!kompletne
        ? '**NIEGOTOWE.** Raport nie obejmuje wszystkich 26 scenariuszy.'
        : (oblane.length
          ? `**NIEGOTOWE.** Nie przeszły: ${oblane.map(o => o.id).join(', ')}.`
          : (licz('RĘCZNY') + licz('CZĘŚCIOWY')
            ? 'Wszystkie scenariusze maszynowe przeszły. Werdykt końcowy dopiero po ' +
              `potwierdzeniu ${licz('RĘCZNY') + licz('CZĘŚCIOWY')} punktów oznaczonych ` +
              'jako RĘCZNY i CZĘŚCIOWY.'
            : '**Wszystkie 26 scenariuszy przeszło maszynowo.**'))),
  ];

  fs.writeFileSync(path.join(__dirname, 'WYNIK_E2E.md'),
    naglowek.concat(wiersze, stopka).join('\n') + '\n');
  fs.writeFileSync(path.join(__dirname, 'wynik_e2e.json'),
    JSON.stringify({ projekt: URL_B, status, data: new Date().toISOString(),
                     kompletne, brakujace, nadmiarowe, wyniki }, null, 2));

  console.log(`\n═══ E2E: PASS ${licz('PASS')} · FAIL ${licz('FAIL')} · ` +
              `CZĘŚCIOWY ${licz('CZĘŚCIOWY')} · RĘCZNY ${licz('RĘCZNY')} ═══`);
  if (!kompletne) console.log(`UWAGA: raport niekompletny (${unikalne}/${OCZEKIWANE.length}).`);
  console.log('Raport: testy/WYNIK_E2E.md');
  return { kompletne, oblane };
}

/* ══ PRZEBIEG ═════════════════════════════════════════════════════ */
async function przebieg() {
  console.log('\n═══ E2E NA ŻYWYM SUPABASE ═══');
  console.log(`projekt: ${URL_B}`);
  console.log(`klucz publiczny: ${rodzajKlucza(PUBL)} · sekretny: ${rodzajKlucza(SEKR)}`);
  console.log(`konta testowe na domenie: @${DOMENA}\n`);

  /* ── konta ──────────────────────────────────────────────────── */
  const eInstr = konto('instr'), eKurs = konto('kursant'), eObcy = konto('obcy');
  const idAdmin = await zalozKonto(E_ADMIN, 'E2E Admin', { trwale: true });
  await zalozKonto(eInstr, 'E2E Instruktorka');
  await zalozKonto(eKurs,  'E2E Kursant');
  await zalozKonto(eObcy,  'E2E Obcy');

  /* ── PIERWSZY ADMINISTRATOR — krok człowieka, nie automatu ────
     Rola `admin` NIE jest nadawana kluczem sekretnym. Ten klucz omija
     RLS, ale nie ma tożsamości (`auth.uid()` puste), więc wyzwalacz
     `chron_profil` i tak cofnąłby zmianę — a próba obejścia tego byłaby
     obchodzeniem własnego zabezpieczenia. Automat zatrzymuje się
     i podaje jedną komendę do SQL Editora.                          */
  const profilAdmina = await zapytaj(
    `/rest/v1/profile?id=eq.${idAdmin}&select=email,rola,aktywne`, { klucz: SEKR, token: SEKR });
  const jestAdminem = /"rola":"admin"/.test(profilAdmina.tekst);

  if (!jestAdminem) {
    console.log('\n─────────────────────────────────────────────────────────');
    console.log('ZATRZYMANIE: konto administratora nie ma jeszcze roli admin.');
    console.log('Wykonaj w SQL Editorze projektu DOKŁADNIE tę jedną komendę:\n');
    console.log(`    select public.ustanow_pierwszego_admina('${E_ADMIN}');\n`);
    console.log('Potem uruchom ponownie: npm run e2e');
    console.log('(konto już istnieje i nie zostanie skasowane)');
    console.log('─────────────────────────────────────────────────────────');
    throw Object.assign(new Error('Brak pierwszego administratora'), { zatrzymanie: true });
  }
  console.log(`konto administratora ma rolę admin — potwierdzone w bazie: ${skrot(profilAdmina.tekst)}\n`);

  /* ══ AUTH ══════════════════════════════════════════════════════ */
  const logAdmin = await zaloguj(E_ADMIN);
  const tokenAdmin = logAdmin.json?.access_token;
  zapisz('A1', 'Logowanie prawdziwym hasłem przez Auth',
    ocena(logAdmin.status === 200 && !!tokenAdmin),
    `status ${logAdmin.status}, token ${tokenAdmin ? 'wydany' : 'brak'}`);
  if (!tokenAdmin) throw new Error('Nie udało się zalogować konta administratora.');

  const odswiezenie = await odswiez(logAdmin.json.refresh_token);
  zapisz('A2', 'Token daje się odświeżyć tokenem odświeżania',
    ocena(odswiezenie.status === 200 && !!odswiezenie.json?.access_token),
    `status ${odswiezenie.status}`,
    'Wygaśnięcia po godzinie nie da się przeczekać w teście — sprawdzone jest odświeżanie.');

  const doWylogowania = odswiezenie.json?.refresh_token || logAdmin.json.refresh_token;
  const wylog = await zapytaj('/auth/v1/logout',
    { metoda: 'POST', token: odswiezenie.json?.access_token || tokenAdmin });
  const poWylogowaniu = await odswiez(doWylogowania);
  zapisz('A3', 'Wylogowanie unieważnia token odświeżania po stronie Supabase',
    ocena(wylog.status < 300 && poWylogowaniu.status >= 400),
    `logout ${wylog.status} → próba odświeżenia ${poWylogowaniu.status}: ${skrot(poWylogowaniu.tekst)}`);

  const znowu = await zaloguj(E_ADMIN);
  const TOK_ADMIN = znowu.json?.access_token;

  /* A4 — reset hasła. Maszynowo widzimy tylko, że Auth przyjął żądanie
     i że adres powrotny jest dozwolony. Czy wiadomość doszła i czy link
     działa — tego bez skrzynki nie sprawdzimy. Stąd CZĘŚCIOWY.       */
  const reset = await zapytaj('/auth/v1/recover', {
    metoda: 'POST', dane: { email: E_ADMIN, redirect_to: ADRES + '/nowe-haslo.html' } });
  zapisz('A4', 'Reset hasła przyjęty przez Auth (bez potwierdzenia doręczenia)',
    reset.status < 300 ? 'CZĘŚCIOWY' : 'FAIL',
    `POST /auth/v1/recover → ${reset.status}: ${skrot(reset.tekst)}`,
    'SPRAWDZONE MASZYNOWO: żądanie przyjęte. NIESPRAWDZONE: czy wiadomość dotarła, ' +
    'czy link prowadzi na /nowe-haslo.html i czy po nim da się ustawić hasło. ' +
    'Do zamknięcia trzeba otworzyć skrzynkę — patrz też A5.');

  const rejestracja = await zapytaj('/auth/v1/signup', {
    metoda: 'POST', dane: { email: `nieproszony-${Date.now()}@${DOMENA}`, password: HASLO } });
  zapisz('A6', 'Publiczna rejestracja jest wyłączona',
    ocena(rejestracja.status >= 400),
    `status ${rejestracja.status}: ${skrot(rejestracja.tekst)}`);

  /* A7 — wyłączone konto. Sprawdzamy DWIE rzeczy naprawdę:
       1. czy po wyłączeniu w aplikacji (`aktywne=false`) token nadal
          odświeża się w Auth — bo to jest prawda o tym mechanizmie;
       2. czy blokada na poziomie Auth (ban) faktycznie ucina odświeżanie.
     Dodatkowo: czy wyłączone konto widzi jeszcze dane.               */
  const logKurs = await zaloguj(eKurs);
  const tokKurs = logKurs.json?.access_token;
  const refKurs = logKurs.json?.refresh_token;
  const idKurs  = logKurs.json?.user?.id;

  await jakoAdmin(TOK_ADMIN, `/profile?id=eq.${idKurs}`, { metoda: 'PATCH', dane: { aktywne: false } });
  const daneWylaczonego = await zapytaj(`/rest/v1/profile?id=eq.${idKurs}&select=aktywne`, { token: tokKurs });
  const odswiezPoWylaczeniu = await odswiez(refKurs);

  const ban = await zapytaj(`/auth/v1/admin/users/${idKurs}`, {
    metoda: 'PUT', klucz: SEKR, token: SEKR, dane: { ban_duration: '24h' } });
  const odswiezPoBanie = await odswiez(odswiezPoWylaczeniu.json?.refresh_token || refKurs);
  const logowaniePoBanie = await zaloguj(eKurs);

  const wierszProfilu = Array.isArray(daneWylaczonego.json) ? daneWylaczonego.json[0] : null;
  const danePrzyciete = !wierszProfilu || wierszProfilu.aktywne === false;
  const banUcina = ban.status < 300 && (odswiezPoBanie.status >= 400 || logowaniePoBanie.status >= 400);

  zapisz('A7', 'Wyłączone konto: co naprawdę robi flaga w aplikacji, a co blokada w Auth',
    ocena(danePrzyciete && banUcina),
    `profil po wyłączeniu: ${skrot(daneWylaczonego.tekst)} · odświeżenie po `
    + `aktywne=false: ${odswiezPoWylaczeniu.status} · po banie w Auth: ${odswiezPoBanie.status} · `
    + `logowanie po banie: ${logowaniePoBanie.status}`,
    odswiezPoWylaczeniu.status === 200
      ? 'POTWIERDZONE: sama flaga `aktywne=false` NIE unieważnia tokenu — Auth odświeża go dalej. '
        + 'Dostęp do danych ucina RLS, a aplikacja wylogowuje przy sprawdzeniu `ja()`. '
        + 'Twarde odcięcie sesji daje dopiero blokada konta w Auth.'
      : 'Odświeżenie po samym `aktywne=false` też zostało odrzucone.');

  await zapytaj(`/auth/v1/admin/users/${idKurs}`, {
    metoda: 'PUT', klucz: SEKR, token: SEKR, dane: { ban_duration: 'none' } });
  await jakoAdmin(TOK_ADMIN, `/profile?id=eq.${idKurs}`, { metoda: 'PATCH', dane: { aktywne: true } });

  /* A8 — ograniczenie prób logowania */
  const kodyLogowania = [];
  for (let i = 0; i < 12; i++) {
    const r = await zapytaj('/auth/v1/token?grant_type=password', {
      metoda: 'POST', dane: { email: E_ADMIN, password: 'zupelnie-zle-haslo' } });
    kodyLogowania.push(r.status);
    if (r.status === 429) break;
  }
  zapisz('A8', 'Supabase ogranicza liczbę prób logowania',
    ocena(kodyLogowania.includes(429)),
    `kody kolejnych prób: ${kodyLogowania.join(', ')}`,
    kodyLogowania.includes(429) ? '' : 'Brak 429 — sprawdź Auth → Rate Limits w panelu.');

  /* A9 — adresy powrotne. Sprawdzamy PRZEKIEROWANIE, dwustronnie:
     dozwolony adres ma być użyty, obcy ma zostać odrzucony. Patrzymy
     na nagłówek Location, nie na sam kod odpowiedzi.                */
  const przekierowanieDozwolone = await zapytaj(
    `/auth/v1/verify?token=token-ktory-nie-istnieje&type=recovery` +
    `&redirect_to=${encodeURIComponent(ADRES + '/nowe-haslo.html')}`,
    { przekierowania: 'manual' });
  const przekierowanieObce = await zapytaj(
    `/auth/v1/verify?token=token-ktory-nie-istnieje&type=recovery` +
    `&redirect_to=${encodeURIComponent(OBCY_ADRES)}`,
    { przekierowania: 'manual' });

  const lokDozwolona = przekierowanieDozwolone.lokalizacja || '';
  const lokObca      = przekierowanieObce.lokalizacja || '';
  const obcyOdrzucony = !lokObca.startsWith('https://zupelnie-obcy-adres.example');
  const wlasnyPrzyjety = lokDozwolona.startsWith(ADRES);

  zapisz('A9', 'Adresy powrotne: własny jest honorowany, obcy odrzucany',
    ocena(obcyOdrzucony && wlasnyPrzyjety),
    `dozwolony → Location: ${skrot(lokDozwolona) || 'brak'} · ` +
    `obcy → Location: ${skrot(lokObca) || 'brak'}`,
    obcyOdrzucony
      ? 'Obcy adres nie pojawił się w przekierowaniu — Supabase użył adresu z listy.'
      : 'UWAGA: przekierowanie prowadzi pod obcy adres. Uzupełnij Redirect URLs w panelu.');

  zapisz('A10', 'Nowe klucze publishable/secret działają tam, gdzie dawniej anon/service_role',
    ocena(logAdmin.status === 200 && profilAdmina.status < 300),
    `publiczny: ${rodzajKlucza(PUBL)} · sekretny: ${rodzajKlucza(SEKR)} — cały przebieg ich używa`);

  /* ══ DANE DO STORAGE ═══════════════════════════════════════════ */
  const logInstr0 = await zaloguj(eInstr);
  const idInstr   = logInstr0.json?.user?.id;
  const nadanieRoli = await jakoAdmin(TOK_ADMIN, `/profile?id=eq.${idInstr}`,
    { metoda: 'PATCH', dane: { rola: 'instruktor' } });
  if (!/instruktor/.test(nadanieRoli.tekst))
    throw new Error('Nie udało się nadać roli instruktora tokenem administratora: ' + skrot(nadanieRoli.tekst));

  const kursA = await jakoAdmin(TOK_ADMIN, '/kurs', { metoda: 'POST', dane: {
    kod: 'e2e-a-' + Date.now(), nazwa_pl: 'E2E kurs A', instruktor_id: idInstr, opublikowany: true } });
  const kursB = await jakoAdmin(TOK_ADMIN, '/kurs', { metoda: 'POST', dane: {
    kod: 'e2e-b-' + Date.now(), nazwa_pl: 'E2E kurs B', instruktor_id: idInstr, opublikowany: true } });
  const idKursA = kursA.json?.[0]?.id, idKursB = kursB.json?.[0]?.id;
  await jakoAdmin(TOK_ADMIN, '/przypisanie', { metoda: 'POST',
    dane: { kurs_id: idKursA, kursant_id: idKurs, przypisal_id: idAdmin, aktywne: true } });

  const TOK_INSTR = (await zaloguj(eInstr)).json?.access_token;
  const TOK_KURS  = (await zaloguj(eKurs)).json?.access_token;
  const TOK_OBCY  = (await zaloguj(eObcy)).json?.access_token;

  /* ══ STORAGE ═══════════════════════════════════════════════════ */
  const tresc    = 'E2E test file ' + Date.now();
  const sciezkaA = `kurs/${idKursA}/pdf/${Date.now()}-e2e.pdf`;
  const sciezkaB = `kurs/${idKursB}/pdf/${Date.now()}-obcy.pdf`;

  const wgranie = await zapytaj(`/storage/v1/object/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_INSTR, surowe: true, dane: tresc,
    naglowki: { 'Content-Type': 'application/pdf' } });
  if (wgranie.status < 300) sprzataj.push({ typ: 'obiekt', co: sciezkaA });

  const publiczny = await fetch(`${URL_B}/storage/v1/object/public/${BUCKET}/${sciezkaA}`);
  zapisz('S1', 'Bucket jest prywatny — publiczny adres nie wydaje pliku',
    ocena(publiczny.status >= 400), `publiczny adres: ${publiczny.status}`);

  zapisz('S2', 'Instruktor prowadzący kurs wgrywa plik pod ścieżkę swojego kursu',
    ocena(wgranie.status < 300), `status ${wgranie.status}: ${skrot(wgranie.tekst)}`);

  await jakoAdmin(TOK_INSTR, '/material', { metoda: 'POST', dane: {
    kurs_id: idKursA, typ: 'pdf', nazwa_pl: 'E2E materiał', sciezka: sciezkaA,
    rozmiar_b: tresc.length, mime: 'application/pdf', opublikowany: true, dodal_id: idInstr } });

  const podpis = await zapytaj(`/storage/v1/object/sign/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_KURS, dane: { expiresIn: 300 } });
  zapisz('S3', 'Kursant zapisany na kurs dostaje podpisany link',
    ocena(podpis.status < 300 && !!podpis.json?.signedURL),
    `status ${podpis.status}: ${skrot(podpis.tekst)}`);

  const krotki = await zapytaj(`/storage/v1/object/sign/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_KURS, dane: { expiresIn: 1 } });
  await new Promise(r => setTimeout(r, 2500));
  const poWygasnieciu = krotki.json?.signedURL
    ? await fetch(URL_B + '/storage/v1' + krotki.json.signedURL) : { status: 0 };
  zapisz('S4', 'Podpisany link przestaje działać po wygaśnięciu',
    ocena(poWygasnieciu.status >= 400), `po 2,5 s: ${poWygasnieciu.status}`);

  const obcyPodpis = await zapytaj(`/storage/v1/object/sign/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_OBCY, dane: { expiresIn: 300 } });
  zapisz('S5', 'Kursant spoza kursu nie dostanie linku do pliku',
    ocena(obcyPodpis.status >= 400), `status ${obcyPodpis.status}: ${skrot(obcyPodpis.tekst)}`);

  const cudzaSciezka = await zapytaj(`/storage/v1/object/${BUCKET}/${sciezkaB}`, {
    metoda: 'POST', token: TOK_KURS, surowe: true, dane: tresc,
    naglowki: { 'Content-Type': 'application/pdf' } });
  if (cudzaSciezka.status < 300) sprzataj.push({ typ: 'obiekt', co: sciezkaB });
  zapisz('S6', 'Kursant nie wgra pliku pod ścieżkę cudzego kursu',
    ocena(cudzaSciezka.status >= 400), `status ${cudzaSciezka.status}: ${skrot(cudzaSciezka.tekst)}`);

  const zlaSciezka = `kurs/${idKursB}/pdf/${Date.now()}-niezgodny.pdf`;
  const wgranieB = await zapytaj(`/storage/v1/object/${BUCKET}/${zlaSciezka}`, {
    metoda: 'POST', token: TOK_INSTR, surowe: true, dane: tresc,
    naglowki: { 'Content-Type': 'application/pdf' } });
  const zleMeta = await jakoAdmin(TOK_INSTR, '/material', { metoda: 'POST', dane: {
    kurs_id: idKursA, typ: 'pdf', nazwa_pl: 'E2E niezgodny', sciezka: zlaSciezka,
    opublikowany: false, dodal_id: idInstr } });
  const usuniecie = await zapytaj(`/storage/v1/object/${BUCKET}/${zlaSciezka}`, {
    metoda: 'DELETE', token: TOK_INSTR });
  zapisz('S7', 'Metadane niezgodne ze ścieżką są odrzucane, a plik daje się posprzątać',
    ocena(zleMeta.status >= 400 && usuniecie.status < 300),
    `wgranie ${wgranieB.status} · metadane ${zleMeta.status}: ${skrot(zleMeta.tekst)} · ` +
    `sprzątanie ${usuniecie.status}`);

  /* ══ EDGE FUNCTION ═════════════════════════════════════════════ */
  const F = '/functions/v1/zapros';
  const zaproszony  = `e2e-zapros-${Date.now().toString(36)}@${DOMENA}`;
  const zaproszonyA = `e2e-zaprosadm-${Date.now().toString(36)}@${DOMENA}`;

  const bezTokenu = await zapytaj(F, { metoda: 'POST',
    dane: { imie: 'X', email: zaproszony, rola: 'kursant' } });
  zapisz('E1', 'Edge Function odrzuca wywołanie bez tokenu',
    ocena(bezTokenu.status === 401), `status ${bezTokenu.status}: ${skrot(bezTokenu.tekst)}`);

  const jakoKursant = await zapytaj(F, { metoda: 'POST', token: TOK_KURS,
    dane: { imie: 'X', email: zaproszony, rola: 'admin' } });
  const jakoInstruktor = await zapytaj(F, { metoda: 'POST', token: TOK_INSTR,
    dane: { imie: 'X', email: zaproszony, rola: 'admin' } });
  zapisz('E2', 'Edge Function odrzuca kursanta i instruktora',
    ocena(jakoKursant.status === 403 && jakoInstruktor.status === 403),
    `kursant ${jakoKursant.status} · instruktor ${jakoInstruktor.status}`);

  const wstepne = await fetch(URL_B + F, { method: 'OPTIONS', headers: {
    Origin: ADRES, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type' } });
  const corsOrigin = wstepne.headers.get('access-control-allow-origin');
  zapisz('E6', 'Zapytanie wstępne OPTIONS dostaje nagłówki CORS',
    ocena(wstepne.status < 300 && !!corsOrigin),
    `status ${wstepne.status} · Allow-Origin: ${corsOrigin || 'BRAK'}`);

  const zapros1 = await zapytaj(F, { metoda: 'POST', token: TOK_ADMIN,
    dane: { imie: 'E2E Zaproszona', email: zaproszony, rola: 'instruktor' } });
  const kontoZaproszonej = await znajdzKonto(zaproszony);
  if (kontoZaproszonej) sprzataj.push({ typ: 'user', co: kontoZaproszonej.id });
  zapisz('E3', 'Administrator zaprasza — Supabase przyjmuje i zakłada konto',
    zapros1.status === 200 && !!kontoZaproszonej ? 'CZĘŚCIOWY' : 'FAIL',
    `status ${zapros1.status} · konto w Auth: ${kontoZaproszonej ? 'istnieje' : 'brak'}`,
    'NIESPRAWDZONE MASZYNOWO: czy wiadomość z zaproszeniem dotarła do skrzynki.');

  const zapros2 = await zapytaj(F, { metoda: 'POST', token: TOK_ADMIN,
    dane: { imie: 'E2E Zaproszona', email: zaproszony, rola: 'kursant' } });
  zapisz('E4', 'Ponowne zaproszenie na istniejący adres daje 409',
    ocena(zapros2.status === 409), `status ${zapros2.status}: ${skrot(zapros2.tekst)}`);

  const wszystkieOdpowiedzi = [bezTokenu, jakoKursant, jakoInstruktor, zapros1, zapros2]
    .map(r => r.tekst).join(' ');
  zapisz('E5', 'Klucz sekretny nie wycieka w żadnej odpowiedzi funkcji',
    ocena(!/sb_secret_|service_role|eyJhbGciOi/.test(wszystkieOdpowiedzi)),
    'przeszukano treść pięciu odpowiedzi funkcji',
    'Logi funkcji sprawdź dodatkowo w panelu: Edge Functions → zapros → Logs.');

  const profilZaproszonej = await zapytaj(
    `/rest/v1/profile?email=eq.${encodeURIComponent(zaproszony)}&select=email,rola`,
    { token: TOK_ADMIN });
  zapisz('E8', 'Zaproszenie instruktora kończy się profilem instruktor',
    ocena(/instruktor/.test(profilZaproszonej.tekst)),
    `profil po zaproszeniu: ${skrot(profilZaproszonej.tekst)}`);

  const zaprosAdm = await zapytaj(F, { metoda: 'POST', token: TOK_ADMIN,
    dane: { imie: 'E2E Admin2', email: zaproszonyA, rola: 'admin' } });
  const kontoAdm2 = await znajdzKonto(zaproszonyA);
  if (kontoAdm2) sprzataj.push({ typ: 'user', co: kontoAdm2.id });
  const profilAdm = await zapytaj(
    `/rest/v1/profile?email=eq.${encodeURIComponent(zaproszonyA)}&select=email,rola`,
    { token: TOK_ADMIN });
  zapisz('E9', 'Zaproszenie administratora kończy się profilem admin',
    ocena(zaprosAdm.status === 200 && /"rola":"admin"/.test(profilAdm.tekst)),
    `funkcja ${zaprosAdm.status} · profil: ${skrot(profilAdm.tekst)}`);

  zapisz('E7', 'Nieudane nadanie roli wycofuje konto', 'RĘCZNY', '',
    'Nie da się wymusić bez psucia bazy. Ręcznie: odebrać roli `authenticated` prawo '
    + 'UPDATE na public.profile, zaprosić instruktora, sprawdzić, że funkcja zwróciła 500, '
    + 'a konto zniknęło z Authentication → Users. Potem przywrócić uprawnienie.');

  zapisz('A5', 'Zaproszenie prowadzi do ustawienia hasła i zalogowania', 'RĘCZNY', '',
    `Otworzyć skrzynkę adresu zaproszonego w tym przebiegu, kliknąć link, ustawić hasło `
    + 'na /nowe-haslo.html, zalogować się. Zrzut ekranu do raportu.');
}

/* ══ START ════════════════════════════════════════════════════════ */
(async () => {
  let status = 'ZAKOŃCZONY', blad = null;
  try {
    await przebieg();
  } catch (e) {
    blad = e;
    status = e.zatrzymanie ? 'ZATRZYMANY — KROK RĘCZNY' : 'PRZERWANY BŁĘDEM';
  } finally {
    await posprzataj();                        // także po błędzie
  }
  const { kompletne, oblane } = zapiszRaport(status);

  if (blad) {
    if (!blad.zatrzymanie) console.error('\nBŁĄD PRZEBIEGU:', blad.stack || blad.message);
    process.exit(blad.zatrzymanie ? 3 : 2);
  }
  process.exit(oblane.length || !kompletne ? 1 : 0);
})();
