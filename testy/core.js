#!/usr/bin/env node
/**
 * AsterA Coach — testy AsterA Core (skorupa Cognito)                [Etap 2]
 *
 * Core biegnie W TYM procesie, na lokalnej bazie, z atrapą Cognito
 * (testy/cognito_atrapa.js) i atrapą dostawcy tożsamości. Ścieżka
 * weryfikacji tokenu jest dokładnie produkcyjna — różni się wyłącznie
 * kluczem prywatnym po stronie wystawcy.
 *
 * Czego ten plik NIE sprawdza (bo lokalnie nie da się tego udowodnić):
 * SRP, haseł, blokady po błędnych próbach (A8). To biegnie przeciw
 * prawdziwej puli w Etapie 2 na AWS.
 */
const { Client } = require('pg');
const { AtrapaCognito } = require('./cognito_atrapa');
const { TozsamoscAtrapa } = require('../serwer/tozsamosc');
const { uruchomCore } = require('../serwer/core');

const KTO = {
  norbert: '11111111-1111-1111-1111-111111111111',
  maliwan: '22222222-2222-2222-2222-222222222222',
  ania:    '33333333-3333-3333-3333-333333333333',
};
const KURS_MISTRZ = 'aaaaaaaa-0000-0000-0000-000000000002';

let wyniki = [];
function sprawdz(nr, opis, ok, szczegol) {
  wyniki.push(!!ok);
  console.log(`${ok ? '  ZDANY ' : '  BŁĄD  '} ${String(nr).padStart(2)}. ${opis}`);
  if (szczegol) console.log(`          ${szczegol}`);
}

(async () => {
  console.log('\n═══ TESTY ASTERA CORE — TOKEN COGNITO, KONTA, RLS PRZEZ CORE ═══');
  const db = new Client(require('./polaczenie').DB); await db.connect();

  const cognito = new AtrapaCognito();
  await cognito.uruchom();
  const tozsamosc = new TozsamoscAtrapa();
  const core = uruchomCore({
    tozsamosc,
    env: { ...cognito.srodowisko(), PORT: '0', CORE_ORIGIN: 'https://coach.thaimaliwan.pl', CORE_TOZSAMOSC: 'atrapa' },
  });
  const port = await core.start();
  const BAZA = `http://127.0.0.1:${port}`;

  async function zadanie(sciezka, { token, metoda = 'GET', dane, naglowki = {} } = {}) {
    const r = await fetch(BAZA + sciezka, {
      method: metoda,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
                 ...(dane ? { 'Content-Type': 'application/json' } : {}), ...naglowki },
      body: dane ? JSON.stringify(dane) : undefined,
    });
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json, naglowki: r.headers };
  }
  const tok = (sub, o) => cognito.token(sub, { uzycie: 'access', ...o });

  /* ── 1. Bez tokenu i ze śmieciem: 401, nigdy 500 ───────────── */
  const a1 = await zadanie('/api/ja');
  const a2 = await zadanie('/api/ja', { token: 'to.nie.jest.token' });
  const a3 = await zadanie('/api/ja', { naglowki: { Authorization: 'Basic abc' } });
  sprawdz(1, 'Bez tokenu, ze śmieciem, z innym schematem — zawsze 401',
    a1.status === 401 && a2.status === 401 && a3.status === 401,
    `brak: ${a1.status} · śmieć: ${a2.status} · Basic: ${a3.status}`);

  /* ── 2. Poprawny token → profil i dane przez RLS ────────────── */
  const b1 = await zadanie('/api/ja',    { token: tok(KTO.ania) });
  const b2 = await zadanie('/api/kursy', { token: tok(KTO.ania) });
  const b3 = await zadanie('/api/konta', { token: tok(KTO.ania) });
  sprawdz(2, 'Poprawny token dostępu: profil z `sub`, dane przycięte przez RLS',
    b1.status === 200 && b1.json?.profil?.id === KTO.ania && b1.json.profil.rola === 'kursant'
    && b2.status === 200 && b2.json.length === 1 && b3.status === 200 && b3.json.length === 1,
    `ja: ${b1.json?.profil?.imie} (${b1.json?.profil?.rola}) · kursów: ${b2.json?.length} · kont widzi: ${b3.json?.length}`);

  /* ── 3. Każda wada tokenu osobno — i każda kończy się 401 ──── */
  const wady = {
    'wygasły':          tok(KTO.ania, { zmiany: { exp: Math.floor(Date.now()/1000) - 120 } }),
    'zły odbiorca':     tok(KTO.ania, { zmiany: { client_id: 'cudza-aplikacja' } }),
    'zły wystawca':     tok(KTO.ania, { zmiany: { iss: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_INNA' } }),
    'obcy klucz':       tok(KTO.ania, { klucz: 'obcy' }),
    'token ID zamiast dostępu': cognito.token(KTO.ania, { uzycie: 'id' }),
    'nieznany kid':     tok(KTO.ania, { kid: 'nie-ma-takiego' }),
    'sub nie-UUID':     tok('norbert', {}),
    'alg none':         (() => { const [h,p,s] = tok(KTO.ania).split('.');
                          const nh = Buffer.from(JSON.stringify({ alg: 'none', kid: cognito.kid })).toString('base64url');
                          return `${nh}.${p}.`; })(),
  };
  const odp = {};
  for (const [nazwa, t] of Object.entries(wady)) odp[nazwa] = (await zadanie('/api/ja', { token: t })).status;
  sprawdz(3, 'Wygasły, zły aud, zły iss, obcy klucz, złe token_use, nieznany kid, zły sub, alg=none → 401',
    Object.values(odp).every(s => s === 401),
    Object.entries(odp).map(([k, v]) => `${k}: ${v}`).join(' · '));

  /* ── 4. Rotacja kluczy: nieznany kid odświeża JWKS raz, nie w kółko ── */
  const przed = cognito.pobran;
  for (let i = 0; i < 5; i++) await zadanie('/api/ja', { token: tok(KTO.ania, { kid: 'obcy-kid-' + i }) });
  const po = cognito.pobran;
  sprawdz(4, 'Nieznany `kid` nie zamienia Core w maszynkę do odpytywania JWKS',
    po - przed <= 1, `5 tokenów z obcym kid → pobrań JWKS: ${po - przed} (limit: 1 na 60 s)`);

  /* ── 5. Logowania hasłem w Core nie ma — to granica wariantu A ── */
  const c1 = await zadanie('/api/logowanie', { metoda: 'POST', dane: { email: 'ania@przyklad.pl', haslo: 'demo-ania' } });
  const c2 = await zadanie('/api/wylogowanie', { metoda: 'POST', token: tok(KTO.ania) });
  sprawdz(5, 'Core nie ma logowania ani wylogowania — hasło nigdy tu nie trafia',
    c1.status === 404 && c2.status === 404, `logowanie: ${c1.status} · wylogowanie: ${c2.status}`);

  /* ── 6. CORS: jeden origin, preflight bez tokenu ────────────── */
  const d1 = await zadanie('/api/ja', { metoda: 'OPTIONS' });
  const d2 = await zadanie('/api/ja', { token: tok(KTO.ania) });
  sprawdz(6, 'CORS: preflight 204, dozwolony dokładnie jeden origin frontu',
    d1.status === 204 && d2.naglowki.get('access-control-allow-origin') === 'https://coach.thaimaliwan.pl',
    `OPTIONS: ${d1.status} · Allow-Origin: ${d2.naglowki.get('access-control-allow-origin')}`);

  /* ── 7. Zaproszenie = konto u dostawcy + profil, w jednej operacji ── */
  await db.query(`delete from public.profile where email='nowa.core@przyklad.pl'`);
  await db.query(`delete from public.zaproszenie where email='nowa.core@przyklad.pl'`);
  const e1 = await zadanie('/api/zapros', { metoda: 'POST', token: tok(KTO.norbert),
    dane: { email: 'nowa.core@przyklad.pl', imie: 'Nowa Core', rola: 'instruktor' } });
  const nowaId = e1.json?.konto?.id;
  const nowaJa = nowaId ? await zadanie('/api/ja', { token: tok(nowaId) }) : { status: 0 };
  const e2 = await zadanie('/api/zapros', { metoda: 'POST', token: tok(KTO.ania),
    dane: { email: 'x@przyklad.pl', imie: 'Ktoś', rola: 'admin' } });
  sprawdz(7, 'Admin zaprasza: powstaje konto u dostawcy i profil z rolą; nowa osoba od razu ma dostęp; kursant nie zaprosi',
    e1.status === 200 && nowaId && tozsamosc.konta.has(nowaId)
    && nowaJa.status === 200 && nowaJa.json.profil.rola === 'instruktor' && nowaJa.json.profil.email === 'nowa.core@przyklad.pl'
    && e2.status === 403 && !tozsamosc.dziennik.some(([op, id]) => op === 'utworz' && tozsamosc.konta.get(id)?.email === 'x@przyklad.pl'),
    `zapros: ${e1.status} · konto u dostawcy: ${tozsamosc.konta.has(nowaId)} · /api/ja nowej: ${nowaJa.status} (${nowaJa.json?.profil?.rola}) · kursant: ${e2.status}`);

  /* ── 8. Wycofanie: profil się nie zapisał → konto znika ──────── */
  //  Ten sam e-mail drugi raz: konto u dostawcy powstaje (inny sub),
  //  profil odpada na UNIQUE(email) → Core musi usunąć konto.
  const kontPrzed = tozsamosc.konta.size;
  tozsamosc.konta.forEach(k => { if (k.email === 'nowa.core@przyklad.pl') k.email = 'zwolniony@przyklad.pl'; }); // zwolnij e-mail u dostawcy
  const f1 = await zadanie('/api/zapros', { metoda: 'POST', token: tok(KTO.norbert),
    dane: { email: 'nowa.core@przyklad.pl', imie: 'Duplikat', rola: 'kursant' } });
  const kontPo = tozsamosc.konta.size;
  const usunieto = tozsamosc.dziennik.slice(-2).some(([op]) => op === 'usun');
  sprawdz(8, 'Gdy profil się nie zapisze, konto u dostawcy jest wycofywane — nie zostaje sierota',
    f1.status >= 400 && kontPo === kontPrzed && usunieto,
    `odpowiedź: ${f1.status} · kont przed/po: ${kontPrzed}/${kontPo} · wycofanie w dzienniku: ${usunieto}`);

  /* ── 9. Wyłączenie konta: ważny token przestaje działać, dostawca powiadomiony ── */
  const g1 = await zadanie('/api/konto/aktywne', { metoda: 'POST', token: tok(KTO.norbert),
    dane: { id: nowaId, aktywne: false } });
  const tokenNowej = tok(nowaId);                      // podpis dalej poprawny, exp dalej w przyszłości
  const g2 = await zadanie('/api/ja', { token: tokenNowej });
  const wylaczonaUDostawcy = tozsamosc.konta.get(nowaId)?.aktywne === false;
  const g3 = await zadanie('/api/konto/aktywne', { metoda: 'POST', token: tok(KTO.norbert),
    dane: { id: nowaId, aktywne: true } });
  const g4 = await zadanie('/api/ja', { token: tokenNowej });
  sprawdz(9, 'Konto wyłączone przez admina: ważny token dostaje 401, dostawca blokuje; włączone — wraca',
    g1.status === 200 && g2.status === 401 && wylaczonaUDostawcy && g3.status === 200 && g4.status === 200
    && tozsamosc.konta.get(nowaId)?.aktywne === true,
    `wyłącz: ${g1.status} · ważny token po wyłączeniu: ${g2.status} · u dostawcy: wyłączone=${wylaczonaUDostawcy} · włącz: ${g3.status} · po: ${g4.status}`);

  /* ── 10. Tożsamość z tokenu, nie z ciała żądania ────────────── */
  const h1 = await zadanie('/api/postep', { metoda: 'POST', token: tok(KTO.ania),
    dane: { etap_id: (await db.query(`select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
                                       where l.kurs_id=$1 limit 1`, [KURS_MISTRZ])).rows[0].id,
            status: 'zrobione', kursant_id: KTO.norbert, uid: KTO.norbert } });
  sprawdz(10, 'Podanie cudzego identyfikatora w ciele żądania nic nie daje — tożsamość idzie z tokenu',
    h1.status === 403 || (h1.status === 200 && h1.json === null),
    `postęp na cudzym kursie z podrobionym kursant_id: ${h1.status}`);

  /* sprzątanie */
  await db.query(`delete from public.profile where email in ('nowa.core@przyklad.pl')`);
  await db.query(`delete from public.zaproszenie where email in ('nowa.core@przyklad.pl','x@przyklad.pl')`);
  await core.stop(); cognito.zatrzymaj(); await db.end();

  const zd = wyniki.filter(Boolean).length;
  console.log(`\n═══ CORE: ${zd} / ${wyniki.length} ═══`);
  process.exit(zd === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.stack || e.message); process.exit(2); });
