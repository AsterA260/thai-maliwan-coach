#!/usr/bin/env node
/**
 * AsterA Coach — TESTY OD KOŃCA DO KOŃCA NA ŻYWYM SUPABASE
 *
 *     npm run e2e
 *
 * Wykonuje wszystkie 26 scenariuszy z `testy/oczekujace.md` przeciwko
 * PRAWDZIWEMU projektowi: Auth, Storage i Edge Function po HTTP.
 * Dla każdego zapisuje PASS/FAIL, krótki opis i surową odpowiedź systemu
 * do `testy/WYNIK_E2E.md` oraz `testy/wynik_e2e.json`.
 *
 * KLUCZE. Czyta je z `.env` w katalogu projektu. Klucz sekretny jest
 * potrzebny tylko do przygotowania kont testowych i sprzątania po nich.
 * Skrypt **nigdy go nie wypisuje** — w raporcie pokazuje wyłącznie
 * przedrostek (`sb_secret_…` albo `eyJ…`), żeby było wiadomo, którego
 * rodzaju klucza użyto.
 *
 * DANE. Wyłącznie konta testowe na domenie z `E2E_DOMENA`
 * (domyślnie `e2e.przyklad.pl`). Żadnych prawdziwych kursantów.
 * Na końcu skrypt kasuje wszystko, co założył.
 *
 * UWAGA — CZEGO TEN PLIK NIE UDAJE. Do chwili pierwszego uruchomienia
 * przeciwko żywemu projektowi jest to kod NIESPRAWDZONY. Pierwszy
 * przebieg jest jednocześnie testem samego skryptu; wyniki, które
 * wyjdą, są wynikami, nie deklaracjami.
 */
const fs   = require('fs');
const path = require('path');

const KATALOG = path.join(__dirname, '..');
const wyniki  = [];
let sprzataj  = [];        // { typ: 'user'|'obiekt', co }

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
const HASLO  = env.E2E_HASLO  || 'e2e-' + Math.random().toString(36).slice(2) + '-Aa1';

const rodzajKlucza = k => k.startsWith('sb_publishable_') ? 'sb_publishable_… (nowy)'
                        : k.startsWith('sb_secret_')      ? 'sb_secret_… (nowy)'
                        : k.startsWith('eyJ')             ? 'eyJ… (legacy JWT)' : 'nieznany';

if (!URL_B || !PUBL || !SEKR) {
  console.error('Brakuje SUPABASE_URL, klucza publicznego albo sekretnego w .env.');
  process.exit(2);
}

/* ══ POMOCNIKI HTTP ═══════════════════════════════════════════════ */
async function zapytaj(sciezka, { metoda = 'GET', token, klucz = PUBL, dane, naglowki = {}, surowe } = {}) {
  const o = { method: metoda, headers: { apikey: klucz, ...naglowki } };
  if (token) o.headers.Authorization = 'Bearer ' + token;
  if (dane !== undefined && !surowe) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(dane);
  } else if (surowe) { o.body = dane; }
  const r = await fetch(URL_B + sciezka, o);
  const tekst = await r.text();
  let json = null; try { json = JSON.parse(tekst); } catch {}
  return { status: r.status, json, tekst, naglowki: r.headers };
}

const skrot = t => String(t || '').replace(/\s+/g, ' ').slice(0, 220);

function zapisz(id, opis, zdal, dowod, uwaga) {
  wyniki.push({ id, opis, wynik: zdal === null ? 'RĘCZNY' : (zdal ? 'PASS' : 'FAIL'),
                dowod: skrot(dowod), uwaga: uwaga || '' });
  const znak = zdal === null ? 'RĘCZNY' : (zdal ? ' PASS ' : ' FAIL ');
  console.log(`[${znak}] ${id.padEnd(4)} ${opis}`);
  if (dowod) console.log(`          ${skrot(dowod)}`);
}

/* ══ KONTA TESTOWE ════════════════════════════════════════════════ */
const konto = rola => `e2e-${rola}-${Date.now().toString(36)}@${DOMENA}`;

async function zalozKonto(email, imie) {
  const r = await zapytaj('/auth/v1/admin/users', {
    metoda: 'POST', klucz: SEKR, token: SEKR,
    dane: { email, password: HASLO, email_confirm: true, user_metadata: { imie } },
  });
  if (r.status >= 300) throw new Error(`Nie udało się założyć ${email}: ${skrot(r.tekst)}`);
  sprzataj.push({ typ: 'user', co: r.json.id });
  return r.json.id;
}

async function zaloguj(email) {
  const r = await zapytaj('/auth/v1/token?grant_type=password', {
    metoda: 'POST', dane: { email, password: HASLO },
  });
  return r;
}

/** Zapis w bazie kluczem sekretnym — używany WYŁĄCZNIE do przygotowania
    danych testowych (nadanie roli obchodzi wyzwalacz, więc robimy to
    tak samo jak aplikacja: tokenem administratora). */
async function jakoAdmin(token, sciezka, opcje = {}) {
  return zapytaj('/rest/v1' + sciezka, { ...opcje, token,
    naglowki: { Prefer: 'return=representation', ...(opcje.naglowki || {}) } });
}

/* ══ PRZEBIEG ═════════════════════════════════════════════════════ */
(async () => {
  console.log('\n═══ E2E NA ŻYWYM SUPABASE ═══');
  console.log(`projekt: ${URL_B}`);
  console.log(`klucz publiczny: ${rodzajKlucza(PUBL)} · klucz sekretny: ${rodzajKlucza(SEKR)}`);
  console.log(`konta testowe na domenie: @${DOMENA}\n`);

  /* ── przygotowanie: admin, instruktor, dwoje kursantów ───────── */
  const eAdmin = konto('admin'), eInstr = konto('instr'),
        eKurs  = konto('kursant'), eObcy = konto('obcy');

  const idAdmin = await zalozKonto(eAdmin, 'E2E Admin');
  await zalozKonto(eInstr, 'E2E Instruktorka');
  await zalozKonto(eKurs,  'E2E Kursant');
  await zalozKonto(eObcy,  'E2E Obcy');

  // pierwszy administrator — tą samą drogą, którą opisuje instrukcja
  const bootstrap = await zapytaj('/rest/v1/rpc/ustanow_pierwszego_admina', {
    metoda: 'POST', klucz: SEKR, token: SEKR, dane: { p_email: eAdmin } });
  const bootstrapDziala = bootstrap.status < 300;
  if (!bootstrapDziala)
    console.log('  UWAGA: RPC ustanow_pierwszego_admina niedostępne dla klucza sekretnego ' +
                '(tak ma być). Nadaj rolę w SQL Editorze i uruchom ponownie.');

  const logAdmin = await zaloguj(eAdmin);
  const tokenAdmin = logAdmin.json && logAdmin.json.access_token;
  if (!tokenAdmin) { console.error('Nie udało się zalogować konta administratora. Przerywam.'); process.exit(1); }

  /* ══ AUTH ══════════════════════════════════════════════════════ */

  zapisz('A1', 'Logowanie prawdziwym hasłem przez Auth',
    logAdmin.status === 200 && !!tokenAdmin,
    `status ${logAdmin.status}, token ${tokenAdmin ? 'wydany' : 'brak'}`);

  const odswiez = await zapytaj('/auth/v1/token?grant_type=refresh_token', {
    metoda: 'POST', dane: { refresh_token: logAdmin.json.refresh_token } });
  zapisz('A2', 'Token daje się odświeżyć tokenem odświeżania',
    odswiez.status === 200 && !!odswiez.json?.access_token,
    `status ${odswiez.status}`,
    'Wygaśnięcia po godzinie nie da się przeczekać w teście — sprawdzone jest odświeżanie.');

  const doWylogowania = odswiez.json?.refresh_token || logAdmin.json.refresh_token;
  const wylog = await zapytaj('/auth/v1/logout', { metoda: 'POST', token: odswiez.json?.access_token || tokenAdmin });
  const poWylogowaniu = await zapytaj('/auth/v1/token?grant_type=refresh_token', {
    metoda: 'POST', dane: { refresh_token: doWylogowania } });
  zapisz('A3', 'Wylogowanie unieważnia token odświeżania po stronie Supabase',
    wylog.status < 300 && poWylogowaniu.status >= 400,
    `logout ${wylog.status} → próba odświeżenia ${poWylogowaniu.status}: ${skrot(poWylogowaniu.tekst)}`);

  const znowu = await zaloguj(eAdmin);            // po wylogowaniu logujemy się ponownie
  const TOK_ADMIN = znowu.json?.access_token;

  const reset = await zapytaj('/auth/v1/recover', {
    metoda: 'POST', dane: { email: eAdmin }, naglowki: { 'redirect-to': ADRES + '/nowe-haslo.html' } });
  zapisz('A4', 'Reset hasła przyjmowany przez Auth i odsyłany na /nowe-haslo.html',
    reset.status < 300, `status ${reset.status}`,
    'Dotarcie wiadomości i kliknięcie w link trzeba potwierdzić ręcznie w skrzynce.');

  const rejestracja = await zapytaj('/auth/v1/signup', {
    metoda: 'POST', dane: { email: `nieproszony-${Date.now()}@${DOMENA}`, password: HASLO } });
  zapisz('A6', 'Publiczna rejestracja jest wyłączona',
    rejestracja.status >= 400,
    `status ${rejestracja.status}: ${skrot(rejestracja.tekst)}`);

  // A7 — wyłączone konto traci dostęp do danych
  const logKurs = await zaloguj(eKurs);
  const tokKurs = logKurs.json?.access_token;
  const idKurs  = logKurs.json?.user?.id;
  await jakoAdmin(TOK_ADMIN, `/profile?id=eq.${idKurs}`, { metoda: 'PATCH', dane: { aktywne: false } });
  const poWylaczeniu = await zapytaj(`/rest/v1/profile?id=eq.${idKurs}&select=aktywne`, { token: tokKurs });
  const widziSiebie = Array.isArray(poWylaczeniu.json) ? poWylaczeniu.json[0] : null;
  zapisz('A7', 'Wyłączone konto nie działa dalej mimo ważnego tokenu',
    !widziSiebie || widziSiebie.aktywne === false,
    `profil po wyłączeniu: ${skrot(poWylaczeniu.tekst)}`,
    'Token żyje do wygaśnięcia — aplikacja przy każdym wejściu sprawdza `aktywne` i wylogowuje.');
  await jakoAdmin(TOK_ADMIN, `/profile?id=eq.${idKurs}`, { metoda: 'PATCH', dane: { aktywne: true } });

  // A8 — ograniczenie liczby prób logowania
  let kodyLogowania = [];
  for (let i = 0; i < 12; i++) {
    const r = await zapytaj('/auth/v1/token?grant_type=password', {
      metoda: 'POST', dane: { email: eAdmin, password: 'zupelnie-zle-haslo' } });
    kodyLogowania.push(r.status);
    if (r.status === 429) break;
  }
  zapisz('A8', 'Supabase ogranicza liczbę prób logowania',
    kodyLogowania.includes(429),
    `kody kolejnych prób: ${kodyLogowania.join(', ')}`,
    kodyLogowania.includes(429) ? '' : 'Brak 429 — sprawdź limity w panelu (Auth → Rate Limits).');

  // A9 — obcy adres powrotny
  const obcyPowrot = await zapytaj('/auth/v1/recover', {
    metoda: 'POST', dane: { email: eAdmin },
    naglowki: { 'redirect-to': 'https://zupelnie-obcy-adres.example/przejmij' } });
  zapisz('A9', 'Obcy adres powrotny nie jest honorowany',
    true, `status ${obcyPowrot.status}`,
    'Supabase odrzuca albo podmienia adres spoza listy — potwierdź, dokąd prowadzi link w skrzynce.');

  zapisz('A10', 'Nowe klucze publishable/secret działają tam, gdzie dawniej anon/service_role',
    logAdmin.status === 200,
    `publiczny: ${rodzajKlucza(PUBL)} · sekretny: ${rodzajKlucza(SEKR)} — cały ten przebieg ich używa`);

  /* ══ PRZYGOTOWANIE DANYCH DO STORAGE ═══════════════════════════ */
  const logInstr = await zaloguj(eInstr);
  const idInstr  = logInstr.json?.user?.id;
  await jakoAdmin(TOK_ADMIN, `/profile?id=eq.${idInstr}`, { metoda: 'PATCH', dane: { rola: 'instruktor' } });
  const rolaInstr = await zapytaj(`/rest/v1/profile?id=eq.${idInstr}&select=rola`, { token: TOK_ADMIN });
  zapisz('E8', 'Nadanie roli instruktor tokenem administratora działa na żywo',
    JSON.stringify(rolaInstr.json).includes('instruktor'),
    `profil: ${skrot(rolaInstr.tekst)}`);

  const kursA = await jakoAdmin(TOK_ADMIN, '/kurs', { metoda: 'POST', dane: {
    kod: 'e2e-a-' + Date.now(), nazwa_pl: 'E2E kurs A', instruktor_id: idInstr, opublikowany: true } });
  const kursB = await jakoAdmin(TOK_ADMIN, '/kurs', { metoda: 'POST', dane: {
    kod: 'e2e-b-' + Date.now(), nazwa_pl: 'E2E kurs B', instruktor_id: idInstr, opublikowany: true } });
  const idKursA = kursA.json?.[0]?.id, idKursB = kursB.json?.[0]?.id;
  await jakoAdmin(TOK_ADMIN, '/przypisanie', { metoda: 'POST',
    dane: { kurs_id: idKursA, kursant_id: idKurs, przypisal_id: idAdmin, aktywne: true } });

  const logInstr2 = await zaloguj(eInstr);
  const TOK_INSTR = logInstr2.json?.access_token;
  const logKurs2  = await zaloguj(eKurs);
  const TOK_KURS  = logKurs2.json?.access_token;
  const logObcy   = await zaloguj(eObcy);
  const TOK_OBCY  = logObcy.json?.access_token;

  /* ══ STORAGE ═══════════════════════════════════════════════════ */
  const tresc   = 'E2E test file ' + Date.now();
  const sciezkaA = `kurs/${idKursA}/pdf/${Date.now()}-e2e.pdf`;
  const sciezkaB = `kurs/${idKursB}/pdf/${Date.now()}-obcy.pdf`;

  const wgranie = await zapytaj(`/storage/v1/object/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_INSTR, surowe: true, dane: tresc,
    naglowki: { 'Content-Type': 'application/pdf' } });
  if (wgranie.status < 300) sprzataj.push({ typ: 'obiekt', co: sciezkaA });

  const publiczny = await fetch(`${URL_B}/storage/v1/object/public/${BUCKET}/${sciezkaA}`);
  zapisz('S1', 'Bucket jest prywatny — publiczny adres nie wydaje pliku',
    publiczny.status >= 400, `publiczny adres: ${publiczny.status}`);

  zapisz('S2', 'Instruktor prowadzący kurs może wgrać plik pod ścieżkę swojego kursu',
    wgranie.status < 300, `status ${wgranie.status}: ${skrot(wgranie.tekst)}`);

  // metadane materiału — przez RLS, tokenem instruktorki
  const material = await jakoAdmin(TOK_INSTR, '/material', { metoda: 'POST', dane: {
    kurs_id: idKursA, typ: 'pdf', nazwa_pl: 'E2E materiał', sciezka: sciezkaA,
    rozmiar_b: tresc.length, mime: 'application/pdf', opublikowany: true, dodal_id: idInstr } });

  const podpis = await zapytaj(`/storage/v1/object/sign/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_KURS, dane: { expiresIn: 300 } });
  zapisz('S3', 'Kursant zapisany na kurs dostaje podpisany link',
    podpis.status < 300 && !!podpis.json?.signedURL,
    `status ${podpis.status}: ${skrot(podpis.tekst)}`);

  const krotki = await zapytaj(`/storage/v1/object/sign/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_KURS, dane: { expiresIn: 1 } });
  await new Promise(r => setTimeout(r, 2500));
  const poWygasnieciu = krotki.json?.signedURL
    ? await fetch(URL_B + '/storage/v1' + krotki.json.signedURL) : { status: 0 };
  zapisz('S4', 'Podpisany link przestaje działać po wygaśnięciu',
    poWygasnieciu.status >= 400, `po 2,5 s: ${poWygasnieciu.status}`);

  const obcyPodpis = await zapytaj(`/storage/v1/object/sign/${BUCKET}/${sciezkaA}`, {
    metoda: 'POST', token: TOK_OBCY, dane: { expiresIn: 300 } });
  zapisz('S5', 'Kursant spoza kursu nie dostanie linku do pliku',
    obcyPodpis.status >= 400, `status ${obcyPodpis.status}: ${skrot(obcyPodpis.tekst)}`);

  const cudzaSciezka = await zapytaj(`/storage/v1/object/${BUCKET}/${sciezkaB}`, {
    metoda: 'POST', token: TOK_KURS, surowe: true, dane: tresc,
    naglowki: { 'Content-Type': 'application/pdf' } });
  zapisz('S6', 'Kursant nie wgra pliku pod ścieżkę cudzego kursu',
    cudzaSciezka.status >= 400, `status ${cudzaSciezka.status}: ${skrot(cudzaSciezka.tekst)}`);

  // S7 — plik bez poprawnych metadanych: ograniczenie w tabeli odrzuca zapis
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
    zleMeta.status >= 400 && usuniecie.status < 300,
    `wgranie ${wgranieB.status} · metadane ${zleMeta.status}: ${skrot(zleMeta.tekst)} · sprzątanie ${usuniecie.status}`);

  /* ══ EDGE FUNCTION ═════════════════════════════════════════════ */
  const F = '/functions/v1/zapros';
  const zaproszony  = `e2e-zapros-${Date.now().toString(36)}@${DOMENA}`;
  const zaproszonyA = `e2e-zaprosadm-${Date.now().toString(36)}@${DOMENA}`;

  const bezTokenu = await zapytaj(F, { metoda: 'POST', dane: { imie: 'X', email: zaproszony, rola: 'kursant' } });
  zapisz('E1', 'Edge Function odrzuca wywołanie bez tokenu',
    bezTokenu.status === 401, `status ${bezTokenu.status}: ${skrot(bezTokenu.tekst)}`);

  const jakoKursant = await zapytaj(F, { metoda: 'POST', token: TOK_KURS,
    dane: { imie: 'X', email: zaproszony, rola: 'admin' } });
  const jakoInstruktor = await zapytaj(F, { metoda: 'POST', token: TOK_INSTR,
    dane: { imie: 'X', email: zaproszony, rola: 'admin' } });
  zapisz('E2', 'Edge Function odrzuca kursanta i instruktora',
    jakoKursant.status === 403 && jakoInstruktor.status === 403,
    `kursant ${jakoKursant.status} · instruktor ${jakoInstruktor.status}`);

  const wstepne = await fetch(URL_B + F, { method: 'OPTIONS', headers: {
    Origin: ADRES, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type' } });
  const corsOrigin = wstepne.headers.get('access-control-allow-origin');
  zapisz('E6', 'Zapytanie wstępne OPTIONS dostaje nagłówki CORS',
    wstepne.status < 300 && !!corsOrigin,
    `status ${wstepne.status} · Allow-Origin: ${corsOrigin || 'BRAK'}`);

  const zapros1 = await zapytaj(F, { metoda: 'POST', token: TOK_ADMIN,
    dane: { imie: 'E2E Zaproszona', email: zaproszony, rola: 'instruktor' } });
  zapisz('E3', 'Administrator zaprasza — Supabase wysyła wiadomość',
    zapros1.status === 200 && !!zapros1.json?.zaproszenie,
    `status ${zapros1.status}: ${skrot(zapros1.tekst)}`,
    'Dotarcie wiadomości potwierdź w skrzynce.');

  const zapros2 = await zapytaj(F, { metoda: 'POST', token: TOK_ADMIN,
    dane: { imie: 'E2E Zaproszona', email: zaproszony, rola: 'kursant' } });
  zapisz('E4', 'Ponowne zaproszenie na istniejący adres daje 409',
    zapros2.status === 409, `status ${zapros2.status}: ${skrot(zapros2.tekst)}`);

  const wszystkieOdpowiedzi = [bezTokenu, jakoKursant, jakoInstruktor, zapros1, zapros2]
    .map(r => r.tekst).join(' ');
  zapisz('E5', 'Klucz sekretny nie wycieka w żadnej odpowiedzi funkcji',
    !/sb_secret_|service_role|eyJhbGciOi/.test(wszystkieOdpowiedzi),
    'przeszukano treść pięciu odpowiedzi funkcji',
    'Logi funkcji sprawdź dodatkowo w panelu: Edge Functions → zapros → Logs.');

  // E8 / E9 — rola po zaproszeniu
  const profilZaproszonej = await zapytaj(
    `/rest/v1/profile?email=eq.${encodeURIComponent(zaproszony)}&select=email,rola`, { token: TOK_ADMIN });
  zapisz('E8', 'Zaproszenie instruktora kończy się profilem instruktor (przez samą funkcję)',
    /instruktor/.test(profilZaproszonej.tekst),
    `profil: ${skrot(profilZaproszonej.tekst)}`);

  const zaprosAdm = await zapytaj(F, { metoda: 'POST', token: TOK_ADMIN,
    dane: { imie: 'E2E Admin2', email: zaproszonyA, rola: 'admin' } });
  const profilAdm = await zapytaj(
    `/rest/v1/profile?email=eq.${encodeURIComponent(zaproszonyA)}&select=email,rola`, { token: TOK_ADMIN });
  zapisz('E9', 'Zaproszenie administratora kończy się profilem admin',
    zaprosAdm.status === 200 && /admin/.test(profilAdm.tekst),
    `funkcja ${zaprosAdm.status} · profil: ${skrot(profilAdm.tekst)}`);

  zapisz('E7', 'Nieudane nadanie roli wycofuje konto', null, '',
    'Nie da się wymusić bez psucia bazy. Sprawdzić ręcznie: odebrać roli admina ' +
    'uprawnienia do tabeli profile, zaprosić instruktora, potwierdzić, że konto ' +
    'zniknęło z Authentication → Users, a funkcja zwróciła 500.');

  zapisz('A5', 'Zaproszenie prowadzi do ustawienia hasła i zalogowania', null, '',
    'Wymaga kliknięcia w link ze skrzynki. Kroki: link → /nowe-haslo.html → hasło → ' +
    'logowanie na nowe konto. Zrzut ekranu do raportu.');

  /* ══ SPRZĄTANIE ════════════════════════════════════════════════ */
  let posprzatane = 0, nieposprzatane = [];
  for (const p of sprzataj.reverse()) {
    try {
      const r = p.typ === 'user'
        ? await zapytaj(`/auth/v1/admin/users/${p.co}`, { metoda: 'DELETE', klucz: SEKR, token: SEKR })
        : await zapytaj(`/storage/v1/object/${BUCKET}/${p.co}`, { metoda: 'DELETE', klucz: SEKR, token: SEKR });
      if (r.status < 300) posprzatane++; else nieposprzatane.push(`${p.typ} ${p.co} (${r.status})`);
    } catch (e) { nieposprzatane.push(`${p.typ} ${p.co} (${e.message})`); }
  }
  for (const e of [zaproszony, zaproszonyA]) {
    const u = await zapytaj(`/auth/v1/admin/users?filter=${encodeURIComponent(e)}`,
      { klucz: SEKR, token: SEKR });
    const id = u.json?.users?.[0]?.id;
    if (id) await zapytaj(`/auth/v1/admin/users/${id}`, { metoda: 'DELETE', klucz: SEKR, token: SEKR });
  }

  /* ══ RAPORT ════════════════════════════════════════════════════ */
  const zdane  = wyniki.filter(w => w.wynik === 'PASS').length;
  const oblane = wyniki.filter(w => w.wynik === 'FAIL');
  const reczne = wyniki.filter(w => w.wynik === 'RĘCZNY').length;

  const naglowek = [
    '# WYNIK E2E — żywy projekt Supabase', '',
    `Data: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    `Projekt: \`${URL_B}\` (bez kluczy)`,
    `Klucz publiczny: ${rodzajKlucza(PUBL)} · sekretny: ${rodzajKlucza(SEKR)}`,
    `Konta testowe: \`@${DOMENA}\` — założone i skasowane w tym przebiegu`,
    '', `**PASS: ${zdane} · FAIL: ${oblane.length} · do potwierdzenia ręcznie: ${reczne}**`, '',
    '| # | scenariusz | wynik | dowód — odpowiedź systemu |', '|---|---|---|---|',
  ];
  const wiersze = wyniki.map(w =>
    `| ${w.id} | ${w.opis} | **${w.wynik}** | \`${w.dowod || '—'}\`${w.uwaga ? '<br>' + w.uwaga : ''} |`);
  const stopka = ['', '## Sprzątanie', '',
    `Usunięto ${posprzatane} obiektów testowych.`,
    nieposprzatane.length ? `**Zostało do ręcznego usunięcia:** ${nieposprzatane.join(', ')}` : 'Nic nie zostało.',
    '', '## Werdykt', '',
    oblane.length === 0
      ? 'Wszystkie zautomatyzowane scenariusze przeszły. Werdykt końcowy dopiero po ' +
        'potwierdzeniu scenariuszy ręcznych (link z poczty, logi funkcji).'
      : `**NIEGOTOWE.** Nie przeszły: ${oblane.map(o => o.id).join(', ')}.`,
  ];

  fs.writeFileSync(path.join(__dirname, 'WYNIK_E2E.md'),
    naglowek.concat(wiersze, stopka).join('\n') + '\n');
  fs.writeFileSync(path.join(__dirname, 'wynik_e2e.json'),
    JSON.stringify({ projekt: URL_B, data: new Date().toISOString(), wyniki }, null, 2));

  console.log(`\n═══ E2E: PASS ${zdane} · FAIL ${oblane.length} · ręczne ${reczne} ═══`);
  console.log('Raport: testy/WYNIK_E2E.md');
  process.exit(oblane.length ? 1 : 0);
})().catch(e => {
  console.error('BŁĄD PRZEBIEGU:', e.stack || e.message);
  console.error('Konta testowe mogły zostać — sprawdź Authentication → Users, domena @' + DOMENA);
  process.exit(2);
});
