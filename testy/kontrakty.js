#!/usr/bin/env node
/**
 * AsterA Coach — TESTY KONTRAKTÓW: front ↔ warstwy danych
 *
 * PO CO ISTNIEJE
 * Audyt wykazał dokładnie tę klasę błędu: ekrany wołały `/api/*`,
 * a obok leżała nieużywana warstwa Supabase o innym kształcie danych
 * (`ja()` zwracało co innego, `kursanci()` nie miało `zrobione`).
 * Nikt tego nie wychwycił, bo nic tego nie sprawdzało.
 *
 * Ten test sprawdza trzy rzeczy naraz:
 *   1. że ekrany NIE wołają `/api/*` na własną rękę — mają jedną
 *      warstwę danych i tylko ona wie, gdzie są dane;
 *   2. że obie warstwy mają WSZYSTKIE funkcje kontraktu;
 *   3. że obie zwracają TE SAME POLA — porównujemy kształty odpowiedzi.
 *
 * CZEGO TEN TEST NIE ROBI — i tak jest napisane, bez udawania:
 * warstwa Supabase jest tu odpytywana przez atrapę klienta, która
 * odpowiada PRAWDZIWYMI wierszami z lokalnej bazy (te same tabele,
 * ten sam widok), ale nie chodzi po sieci do Supabase. Ruch po HTTP
 * do Supabase Auth, Storage i Edge Function pozostaje OCZEKUJĄCY —
 * patrz testy/oczekujace.md.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const { Client } = require('pg');

const PORT    = 8933;
const BAZA    = `http://127.0.0.1:${PORT}`;
const KATALOG = path.join(__dirname, '..');
const WEB     = path.join(KATALOG, 'web');

let serwer, db, wyniki = [];
const spij = ms => new Promise(r => setTimeout(r, ms));

function sprawdz(nr, opis, warunek, szczegol) {
  wyniki.push({ nr, opis, zdal: !!warunek });
  console.log(`${warunek ? '  ZDANY ' : '  BŁĄD  '} ${String(nr).padStart(2)}. ${opis}`);
  if (szczegol) console.log(`          ${szczegol}`);
}

const klucze = o => Object.keys(o || {}).sort().join(',');
const maPola = (o, pola) => pola.every(p => o && Object.prototype.hasOwnProperty.call(o, p));

/* ── uruchomienie pliku warstwy w atrapie przeglądarki ─────────── */
function uruchom(plik, srodowisko) {
  const kod = fs.readFileSync(path.join(WEB, plik), 'utf8');
  const f = new Function('window', 'document', 'location', 'fetch',
                         'setTimeout', 'URLSearchParams', 'module', kod);
  f(srodowisko.window, srodowisko.document, srodowisko.location, srodowisko.fetch,
    setTimeout, URLSearchParams, { exports: {} });
}

function atrapaDokumentu() {
  return { createElement: () => ({}), head: { appendChild() {} } };
}

/* ══ ATRAPA KLIENTA SUPABASE ═══════════════════════════════════════
   Odpowiada prawdziwymi wierszami z lokalnej bazy — sprawdzamy
   kształt danych, który adapter z nich buduje.                    */
/** Z listy kolumn PostgREST („id, imie, kurs:kurs_id (nazwa)")
    zostawiamy tylko zwykłe nazwy — atrapa ma zwracać dokładnie te
    kolumny, o które prosi adapter, a nie cały wiersz. Inaczej test
    porównywałby kształty, których produkcja nigdy nie zobaczy. */
function wybraneKolumny(lista) {
  if (!lista || lista === '*' || lista.includes('*')) return null;
  const proste = lista.replace(/\([^)]*\)/g, '')          // usuwamy zagnieżdżenia
    .split(',').map(s => s.trim()).filter(s => s && !s.includes(':'));
  return proste.length ? proste : null;
}

function atrapaSupabase(tabele, kontekst) {
  const budowniczy = (nazwa) => {
    let wiersze = (tabele[nazwa] || []).map(r => ({ ...r }));
    let zapis = null, kolumny = null;
    const przytnij = w => {
      if (!kolumny) return w;
      const o = {};
      for (const k of kolumny) o[k] = w[k];
      return o;
    };
    const b = {
      select(lista) { kolumny = wybraneKolumny(lista); return b; },
      eq(k, v) {
        if (!k.includes('.')) wiersze = wiersze.filter(r => String(r[k]) === String(v));
        return b;
      },
      order() { return b; },
      limit() { return b; },
      insert(x) { zapis = x; wiersze = [{ ...(tabele[nazwa] || [])[0], ...x }]; return b; },
      upsert(x) { zapis = x; wiersze = [{ ...(tabele[nazwa] || [])[0], ...x }]; return b; },
      update(x) { zapis = x; wiersze = wiersze.map(r => ({ ...r, ...x })); return b; },
      delete() { return b; },
      maybeSingle() { return Promise.resolve({ data: wiersze[0] ? przytnij(wiersze[0]) : null, error: null }); },
      single()      { return Promise.resolve({ data: wiersze[0] ? przytnij(wiersze[0]) : null, error: null }); },
      then(ok, zle) {
        kontekst.zapisy.push({ tabela: nazwa, dane: zapis });
        return Promise.resolve({ data: wiersze.map(przytnij), error: null }).then(ok, zle);
      },
    };
    return b;
  };

  return {
    from: budowniczy,
    auth: {
      getUser:  async () => ({ data: { user: { id: kontekst.uid } } }),
      getSession: async () => ({ data: { session: kontekst.sesja ? { user: { id: kontekst.uid } } : null } }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => { kontekst.wylogowany = true; return { error: null }; },
      resetPasswordForEmail: async (_a, o) => { kontekst.reset = o; return { error: null }; },
      updateUser: async (x) => { kontekst.haslo = x.password; return { error: null }; },
      onAuthStateChange() { return { data: null }; },
    },
    storage: {
      from: () => ({
        createSignedUrl: async (s) => ({ data: { signedUrl: 'https://przyklad/' + s }, error: null }),
        upload: async () => ({ error: null }),
        remove: async (s) => { kontekst.skasowane = s; return { error: null }; },
      }),
    },
    functions: {
      invoke: async (_n, { body }) => ({
        data: { zaproszenie: { id: kontekst.uid, email: body.email, imie: body.imie, rola: body.rola,
                               kurs_id: body.kurs_id || null },
                uwaga: 'Supabase wysłał wiadomość z linkiem do ustawienia hasła.' },
        error: null }),
    },
  };
}

(async () => {
  console.log('\n═══ TESTY KONTRAKTÓW — FRONT ↔ WARSTWY DANYCH ═══');
  console.log('Czy ekrany mają jedno źródło danych i czy obie warstwy mówią tym samym językiem\n');

  /* ══ 1–2. STATYCZNIE: co jest w plikach ekranów ═══════════════ */
  const EKRANY = ['index.html', 'app.html', 'nowe-haslo.html'];
  const tresci = Object.fromEntries(
    EKRANY.map(e => [e, fs.readFileSync(path.join(WEB, e), 'utf8')]));

  // Komentarze nie są kodem — wycinamy je, żeby test mierzył
  // wywołania, a nie opisy.
  const bezKomentarzy = t => t
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const winne = EKRANY.filter(e => /['"`]\/api\//.test(bezKomentarzy(tresci[e])));
  sprawdz(1, 'Żaden ekran nie woła /api/* bezpośrednio — dane idą przez jedną warstwę',
    winne.length === 0,
    winne.length ? `zostawione wywołania w: ${winne.join(', ')}` : 'index.html, app.html, nowe-haslo.html — czysto');

  const brakSkryptow = EKRANY.filter(e =>
    !/src="konfig\.js"/.test(tresci[e]) || !/src="warstwa-danych\.js"/.test(tresci[e]));
  sprawdz(2, 'Każdy ekran dołącza konfig.js i warstwa-danych.js',
    brakSkryptow.length === 0,
    brakSkryptow.length ? `brakuje w: ${brakSkryptow.join(', ')}` : 'wszystkie trzy ekrany');

  /* ══ serwer deweloperski + baza ═══════════════════════════════ */
  serwer = spawn('node', [path.join(KATALOG, 'serwer', 'dev.js')],
    { env: { ...process.env, PORT: String(PORT), SEKRET_SESJI: 'kontrakty-'.repeat(4) },
      stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await fetch(BAZA + '/api/ja'); break; } catch { await spij(150); }
  }
  db = new Client({ host: '/tmp', port: 5433, user: 'postgres', database: 'coach' });
  await db.connect();

  /* ══ WARSTWA LOKALNA — prawdziwy serwer, prawdziwe ciasteczko ══ */
  let ciastko = '';
  const fetchLokalny = async (sciezka, opcje = {}) => {
    const o = { ...opcje, headers: { ...(opcje.headers || {}) } };
    if (ciastko) o.headers.Cookie = ciastko;
    const r = await fetch(BAZA + sciezka, o);
    const ustaw = r.headers.get('set-cookie');
    if (ustaw) ciastko = ustaw.split(';')[0];
    return r;
  };

  const oknoL = {};
  uruchom('warstwa-danych.js', {
    window: oknoL, document: atrapaDokumentu(),
    location: { pathname: '/app.html', href: '' }, fetch: fetchLokalny,
  });
  await oknoL.GOTOWE;
  const L = oknoL.DANE;
  const KONTRAKT = oknoL.KONTRAKT_DANYCH;

  /* ══ WARSTWA SUPABASE — atrapa klienta na prawdziwych wierszach ══ */
  // Przygotowanie danych dla testu 9: dane startowe nie zawierają
  // ani jednego pytania, a atrapa Supabase działa na migawce tabel
  // pobranej niżej — bez tego wiersza obie warstwy zwracają pustą
  // listę i test nie ma czego porównać.
  await db.query(`delete from public.pytanie where tresc = 'Pytanie kontrolne do kontraktow'`);
  await db.query(
    `insert into public.pytanie (kursant_id, kurs_id, tresc)
     values ('33333333-3333-3333-3333-333333333333',
             'aaaaaaaa-0000-0000-0000-000000000001',
             'Pytanie kontrolne do kontraktow')`);

  const TABELE = {};
  // Atrapa Supabase czyta te same tabele i widoki, z których korzysta
  // warstwa produkcyjna. Po przejściu na tłumaczenia tabelaryczne
  // doszły widoki odczytowe — bez nich atrapa nie miałaby czego oddać.
  for (const t of ['profile', 'kurs', 'lekcja', 'etap', 'material', 'postep',
                   'przypisanie', 'pytanie', 'widok_kursanci',
                   'widok_kurs', 'widok_lekcja', 'widok_etap', 'widok_material',
                   'kurs_tekst', 'lekcja_tekst', 'material_tekst',
                   'etap_wersja', 'etap_tekst', 'jezyk'])
    TABELE[t] = (await db.query(`select * from public.${t}`)).rows;

  const maliwan = TABELE.profile.find(p => p.email === 'maliwan@thaimaliwan.pl');
  const kontekst = { uid: maliwan.id, sesja: true, zapisy: [] };

  const oknoS = {
    KONFIG: { SUPABASE_URL: 'https://przyklad.supabase.co', SUPABASE_ANON_KEY: 'anon-testowy',
              SUPABASE_BUCKET: 'materialy', ADRES_APLIKACJI: 'https://coach.thaimaliwan.pl' },
    supabase: { createClient: () => atrapaSupabase(TABELE, kontekst) },
  };
  const lokalizacja = { pathname: '/app.html', href: '', origin: 'https://coach.thaimaliwan.pl', hash: '' };
  uruchom('dane-supabase.js', {
    window: oknoS, document: atrapaDokumentu(), location: lokalizacja, fetch: async () => {},
  });
  uruchom('warstwa-danych.js', {
    window: oknoS, document: atrapaDokumentu(), location: lokalizacja, fetch: async () => {},
  });
  await oknoS.GOTOWE;
  const S = oknoS.DANE;

  /* ══ 3–4. Komplet funkcji ════════════════════════════════════ */
  const brakL = KONTRAKT.filter(f => typeof L[f] !== 'function');
  const brakS = KONTRAKT.filter(f => typeof S[f] !== 'function');
  sprawdz(3, `Warstwa lokalna ma wszystkie ${KONTRAKT.length} funkcji kontraktu`,
    brakL.length === 0, brakL.length ? `brakuje: ${brakL.join(', ')}` : KONTRAKT.join(', '));
  sprawdz(4, `Warstwa Supabase ma wszystkie ${KONTRAKT.length} funkcji kontraktu`,
    brakS.length === 0, brakS.length ? `brakuje: ${brakS.join(', ')}` : 'komplet');

  /* ══ 5. Wybór warstwy bez podmieniania kodu ═══════════════════ */
  sprawdz(5, 'Warstwę wybiera sam konfig.js: bez URL-a → lokalna, z URL-em → Supabase',
    oknoL.TRYB === 'lokalny' && oknoS.TRYB === 'supabase' && oknoS.DANE === oknoS.DANE_SUPABASE,
    `bez konfiguracji: ${oknoL.TRYB} · z konfiguracją: ${oknoS.TRYB}`);

  /* ══ logowanie w warstwie lokalnej ════════════════════════════ */
  const jaL = await L.zaloguj('maliwan@thaimaliwan.pl', 'demo-maliwan');
  const jaS = await S.ja();

  /* ══ 6. ja() ══════════════════════════════════════════════════ */
  sprawdz(6, 'ja() zwraca sam profil (nie kopertę) i te same pola w obu warstwach',
    klucze(jaL) === klucze(jaS) && maPola(jaL, ['id', 'imie', 'rola', 'aktywne']),
    `lokalnie: ${klucze(jaL)}\n          Supabase: ${klucze(jaS)}`);

  /* ══ 7. kursanci() ════════════════════════════════════════════ */
  const kursanciL = await L.kursanci();
  const kursanciS = await S.kursanci();
  const wymaganeK = ['id', 'imie', 'email', 'kurs', 'kurs_id', 'zrobione', 'etapow'];
  sprawdz(7, 'kursanci() ma w obu warstwach zrobione i etapow — pasek postępu ma z czego liczyć',
    kursanciL.length > 0 && kursanciS.length > 0 &&
    maPola(kursanciL[0], wymaganeK) && maPola(kursanciS[0], wymaganeK) &&
    Number.isFinite(Number(kursanciL[0].zrobione)) && Number.isFinite(Number(kursanciS[0].zrobione)),
    `lokalnie: ${klucze(kursanciL[0])}\n          Supabase: ${klucze(kursanciS[0])}`);

  /* ══ 8. kurs() ════════════════════════════════════════════════ */
  const kursy = await L.kursy();
  const kursMaliwan = kursy[0];
  const kursL = await L.kurs(kursMaliwan.id);
  const kursS = await S.kurs(kursMaliwan.id);
  sprawdz(8, 'kurs() zwraca w obu warstwach cztery te same listy',
    klucze(kursL) === 'etapy,lekcje,materialy,postepy' && klucze(kursS) === klucze(kursL),
    `lokalnie: ${klucze(kursL)} · Supabase: ${klucze(kursS)}`);

  /* ══ 9. konta() i pytania() ═══════════════════════════════════ */
  const kontaS = await S.konta();
  const pytaniaL = await L.pytania();
  const pytaniaS = await S.pytania();
  const wymaganeP = ['id', 'tresc', 'status', 'kursant', 'kurs', 'odpowiedz', 'odpowiedzial'];
  sprawdz(9, 'pytania() mają w obu warstwach imię kursanta, nazwę kursu i autora odpowiedzi',
    pytaniaL.length > 0 && pytaniaS.length > 0 &&
    maPola(pytaniaL[0], wymaganeP) && maPola(pytaniaS[0], wymaganeP),
    `lokalnie: ${klucze(pytaniaL[0])}\n          Supabase: ${klucze(pytaniaS[0])}`);
  sprawdz(10, 'konta() zwraca listę profili z rolą i stanem konta',
    Array.isArray(kontaS) && kontaS.length > 0 && maPola(kontaS[0], ['id','imie','email','rola','aktywne']),
    `Supabase: ${klucze(kontaS[0])}`);

  /* ══ 11. wgrajMaterial() — prawdziwy plik w obu warstwach ═════ */
  const bajty = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const plik = new File([bajty], 'kontrakt-testowy.pdf', { type: 'application/pdf' });
  let materialL = null, bladWgrywania = null;
  try {
    materialL = await L.wgrajMaterial({ kurs_id: kursMaliwan.id, typ: 'pdf',
                                        nazwa: 'Kontrakt testowy', plik });
  } catch (e) { bladWgrywania = e.message; }
  const materialS = await S.wgrajMaterial({ kurs_id: kursMaliwan.id, typ: 'pdf',
                                            nazwa: 'Kontrakt testowy', plik });
  sprawdz(11, 'wgrajMaterial() przyjmuje w obu warstwach prawdziwy plik i zwraca rekord materiału',
    materialL && materialS && maPola(materialL, ['id','nazwa','sciezka','rozmiar_b']) &&
    maPola(materialS, ['nazwa','sciezka','rozmiar_b']),
    bladWgrywania ? `lokalnie: ${bladWgrywania}` :
      `lokalnie: ${materialL.sciezka}\n          Supabase (atrapa): ${materialS.sciezka}`);

  /* ══ 12. linkDoMaterialu() ════════════════════════════════════ */
  let linkL = null, linkS = null;
  if (materialL) {
    await L.publikujMaterial(materialL.id, true);
    linkL = await L.linkDoMaterialu(materialL.id);
    linkS = await S.linkDoMaterialu(TABELE.material[0] ? TABELE.material[0].id : materialL.id);
  }
  sprawdz(12, 'linkDoMaterialu() zwraca w obu warstwach link, nazwę i czas ważności',
    linkL && linkS && klucze(linkL) === klucze(linkS) && klucze(linkL) === 'link,nazwa,wazny_s',
    linkL ? `lokalnie: ${klucze(linkL)} · Supabase: ${klucze(linkS)}` : 'brak materiału do sprawdzenia');

  if (materialL) await L.usunMaterial(materialL.id);        // sprzątamy po sobie

  /* ══ 13. zapros() — zaprasza wyłącznie administrator ══════════ */
  await L.zaloguj('norbert@thaimaliwan.pl', 'demo-norbert');
  const zapL = await L.zapros({ imie: 'Kontrakt', email: 'kontrakt@przyklad.pl', rola: 'kursant' });
  const zapS = await S.zapros({ imie: 'Kontrakt', email: 'kontrakt@przyklad.pl', rola: 'kursant' });
  sprawdz(13, 'zapros() zwraca zaproszenie w obu warstwach; link na ekranie tylko lokalnie',
    zapL && zapL.zaproszenie && zapS && zapS.zaproszenie &&
    typeof zapL.link_lokalny === 'string' && zapS.link_lokalny === undefined,
    `lokalnie: ${klucze(zapL)} · Supabase: ${klucze(zapS)}`);

  /* ══ 14. reset hasła prowadzi pod jeden adres ═════════════════ */
  await S.wyslijLinkResetu('kontrakt@przyklad.pl');
  const adresPowrotu = (kontekst.reset || {}).redirectTo || '';
  sprawdz(14, 'Reset hasła odsyła pod ten sam adres co zaproszenie: /nowe-haslo.html',
    adresPowrotu === 'https://coach.thaimaliwan.pl/nowe-haslo.html',
    `redirectTo: ${adresPowrotu || 'brak'}`);

  /* ══ 15. wylogowanie idzie przez Supabase, nie przez /api ════ */
  kontekst.wylogowany = false;
  await S.wyloguj();
  sprawdz(15, 'Wylogowanie na produkcji unieważnia sesję w Supabase Auth',
    kontekst.wylogowany === true,
    'signOut() wywołany');

  /* ══ podsumowanie ════════════════════════════════════════════ */
  await db.query(`delete from public.zaproszenie where email = 'kontrakt@przyklad.pl'`);
  await db.query(`delete from public.pytanie where tresc = 'Pytanie kontrolne do kontraktow'`);
  const zdane = wyniki.filter(w => w.zdal).length;
  console.log(`\n═══ KONTRAKTY: ${zdane} / ${wyniki.length} ═══`);
  if (zdane < wyniki.length) {
    console.log('\nNIEZDANE:');
    wyniki.filter(w => !w.zdal).forEach(w => console.log(`  ${w.nr}. ${w.opis}`));
  }
  await db.end();
  serwer.kill();
  process.exit(zdane === wyniki.length ? 0 : 1);
})().catch(e => {
  console.error('BŁĄD URUCHOMIENIA:', e.stack || e.message);
  if (serwer) serwer.kill();
  process.exit(2);
});
