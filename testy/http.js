#!/usr/bin/env node
/**
 * AsterA Coach — testy przez HTTP
 *
 * Tu nie zaglądamy do bazy. Wszystko idzie tą samą drogą co przeglądarka:
 * ciasteczka, sesje, wgrywanie pliku, podpisane linki. To sprawdza
 * warstwę, której testy SQL nie dotykają — a właśnie w niej audyt
 * wskazał braki.
 *
 * Serwer uruchamiamy sami, na osobnym porcie, i gasimy na końcu.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const { Client } = require('pg');

const PORT = 8931;
const BAZA = `http://127.0.0.1:${PORT}`;
const KATALOG = path.join(__dirname, '..');
const MAGAZYN = path.join(KATALOG, 'magazyn', 'materialy');

const KONTA = {
  norbert : ['norbert@thaimaliwan.pl', 'demo-norbert'],
  maliwan : ['maliwan@thaimaliwan.pl', 'demo-maliwan'],
  ania    : ['ania@przyklad.pl',       'demo-ania'],
  piotr   : ['piotr@przyklad.pl',      'demo-piotr'],
};
const ID_ANI = '33333333-3333-3333-3333-333333333333';
const KURS = {
  podstawowy  : 'aaaaaaaa-0000-0000-0000-000000000001',
  mistrzowski : 'aaaaaaaa-0000-0000-0000-000000000002',
};

let serwer, wyniki = [], db;

const spij = ms => new Promise(r => setTimeout(r, ms));

async function zapytanie(sciezka, { metoda='GET', ciastko, dane, cialo, typ } = {}) {
  const o = { method: metoda, headers: {}, redirect: 'manual' };
  if (ciastko) o.headers.Cookie = ciastko;
  if (dane)  { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(dane); }
  if (cialo) { o.headers['Content-Type'] = typ || 'application/octet-stream'; o.body = cialo; }
  const r = await fetch(BAZA + sciezka, o);
  const tekst = await r.text();
  let json = null; try { json = JSON.parse(tekst); } catch {}
  return { status: r.status, json, tekst, ciastko: r.headers.get('set-cookie') };
}

async function zaloguj(kto) {
  const [email, haslo] = KONTA[kto];
  const r = await zapytanie('/api/logowanie', { metoda:'POST', dane:{ email, haslo } });
  const c = (r.ciastko || '').split(';')[0];
  return { odp: r, ciastko: c };
}

function sprawdz(nr, opis, warunek, szczegol) {
  wyniki.push({ nr, opis, zdal: !!warunek });
  console.log(`${warunek ? '  ZDANY ' : '  BŁĄD  '} ${String(nr).padStart(2)}. ${opis}`);
  if (szczegol) console.log(`          ${szczegol}`);
}

(async () => {
  console.log('\n═══ TESTY HTTP — SESJE, PLIKI, UPRAWNIENIA ═══');
  console.log('Ta sama droga, którą idzie przeglądarka: ciasteczka i prawdziwe żądania\n');

  serwer = spawn('node', [path.join(KATALOG, 'serwer', 'dev.js')],
    { env: { ...process.env, PORT: String(PORT), SEKRET_SESJI: 'test-'.repeat(8) },
      stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await fetch(BAZA + '/api/ja'); break; } catch { await spij(150); }
  }
  db = new Client(require('./polaczenie').DB);
  await db.connect();

  /* ── 1. Bez ciasteczka nic ──────────────────────────────────── */
  const a1 = await zapytanie('/api/ja');
  const a2 = await zapytanie('/api/kursy');
  const a3 = await zapytanie('/api/konta');
  sprawdz(1, 'Bez zalogowania każdy punkt API odpowiada 401',
    a1.status === 401 && a2.status === 401 && a3.status === 401,
    `/api/ja ${a1.status} · /api/kursy ${a2.status} · /api/konta ${a3.status}`);

  /* ── 2. Złe hasło ───────────────────────────────────────────── */
  const b1 = await zapytanie('/api/logowanie',
    { metoda:'POST', dane:{ email:'ania@przyklad.pl', haslo:'nie-to-haslo' } });
  const b2 = await zapytanie('/api/logowanie',
    { metoda:'POST', dane:{ email:'nikt@nigdzie.pl', haslo:'cokolwiek' } });
  sprawdz(2, 'Złe hasło i nieznany adres dają ten sam komunikat, bez podpowiedzi',
    b1.status === 401 && b2.status === 401 && b1.json.blad === b2.json.blad,
    `oba: ${b1.status} — „${b1.json.blad}"`);

  /* ── 3. Poprawne logowanie ──────────────────────────────────── */
  const ania = await zaloguj('ania');
  const c1 = await zapytanie('/api/ja', { ciastko: ania.ciastko });
  const httpOnly = /HttpOnly/i.test(ania.odp.ciastko || '');
  const sameSite = /SameSite=Strict/i.test(ania.odp.ciastko || '');
  sprawdz(3, 'Logowanie daje sesję w ciasteczku HttpOnly + SameSite=Strict',
    ania.odp.status === 200 && c1.status === 200 && c1.json.profil.rola === 'kursant'
    && httpOnly && sameSite,
    `rola: ${c1.json?.profil?.rola} · HttpOnly: ${httpOnly} · SameSite=Strict: ${sameSite}`);

  /* ── 4. Podrobione ciasteczko ───────────────────────────────── */
  const [tok] = ania.ciastko.replace('coach_sesja=','').split('.');
  const d1 = await zapytanie('/api/ja', { ciastko: `coach_sesja=${tok}.0000000000000000` });
  const d2 = await zapytanie('/api/ja', { ciastko: 'coach_sesja=zmyslony.zmyslony' });
  sprawdz(4, 'Podrobiony podpis ciasteczka nie wpuszcza',
    d1.status === 401 && d2.status === 401,
    `zły podpis: ${d1.status} · zmyślony token: ${d2.status}`);

  /* ── 5. Wylogowanie NAPRAWDĘ unieważnia sesję ───────────────
     Nie sprawdzamy „czy anonim czegoś nie widzi", tylko czy TO SAMO
     ciasteczko po wylogowaniu przestaje działać.                   */
  const ania2 = await zaloguj('ania');
  const e0 = await zapytanie('/api/ja', { ciastko: ania2.ciastko });
  const eWyl = await zapytanie('/api/wylogowanie', { metoda:'POST', ciastko: ania2.ciastko });
  const e1 = await zapytanie('/api/ja',    { ciastko: ania2.ciastko });   // to samo ciasteczko!
  const e2 = await zapytanie('/api/kursy', { ciastko: ania2.ciastko });
  const kasuje = /Max-Age=0/.test(eWyl.ciastko || '');
  sprawdz(5, 'Po wylogowaniu to samo ciasteczko przestaje działać (sesja skasowana na serwerze)',
    e0.status === 200 && e1.status === 401 && e2.status === 401 && kasuje,
    `przed: ${e0.status} · po: ${e1.status} · dane: ${e2.status} · ciasteczko kasowane: ${kasuje}`);

  /* ── 6. Wyłączenie konta ubija żywą sesję ───────────────────── */
  const ania3   = await zaloguj('ania');
  const norbert = await zaloguj('norbert');
  const f0 = await zapytanie('/api/ja', { ciastko: ania3.ciastko });
  await zapytanie('/api/konto/aktywne',
    { metoda:'POST', ciastko: norbert.ciastko, dane:{ id: ID_ANI, aktywne: false } });
  const f1 = await zapytanie('/api/ja',    { ciastko: ania3.ciastko });
  const f2 = await zapytanie('/api/kursy', { ciastko: ania3.ciastko });
  const f3 = await zapytanie('/api/logowanie',
    { metoda:'POST', dane:{ email:'ania@przyklad.pl', haslo:'demo-ania' } });
  await zapytanie('/api/konto/aktywne',
    { metoda:'POST', ciastko: norbert.ciastko, dane:{ id: ID_ANI, aktywne: true } });
  sprawdz(6, 'Wyłączone konto traci otwartą sesję i nie zaloguje się ponownie',
    f0.status === 200 && f1.status === 401 && f2.status === 401 && f3.status === 403,
    `przed: ${f0.status} · po wyłączeniu: ${f1.status} · dane: ${f2.status} · ` +
    `próba logowania: ${f3.status} („${f3.json?.blad}")`);

  /* ── 7. Ostatni administrator ───────────────────────────────── */
  const norbert2 = await zaloguj('norbert');
  const g1 = await zapytanie('/api/konto/aktywne', { metoda:'POST', ciastko: norbert2.ciastko,
    dane:{ id:'11111111-1111-1111-1111-111111111111', aktywne:false } });
  const g2 = await zapytanie('/api/konto/rola', { metoda:'POST', ciastko: norbert2.ciastko,
    dane:{ id:'11111111-1111-1111-1111-111111111111', rola:'kursant' } });
  const g3 = await zapytanie('/api/ja', { ciastko: norbert2.ciastko });
  sprawdz(7, 'Ostatni administrator nie może wyłączyć ani zdegradować sam siebie',
    g1.status === 409 && g2.status === 409 && g3.status === 200,
    `wyłączenie: ${g1.status} · degradacja: ${g2.status} · nadal zalogowany: ${g3.status}`);

  /* ── 8. Wgrywanie pliku — pełna droga ───────────────────────── */
  const maliwan = await zaloguj('maliwan');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x20),
                             Buffer.from('\n%%EOF\n')]);
  const q = (o) => new URLSearchParams(o).toString();
  const h1 = await zapytanie('/api/material/plik?' +
      q({ kurs_id: KURS.podstawowy, typ:'pdf', nazwa:'Sekwencja stóp — test', plik:'test.pdf' }),
    { metoda:'POST', ciastko: maliwan.ciastko, cialo: pdf, typ:'application/pdf' });
  const sciezka = h1.json?.material?.sciezka;
  const naDysku = sciezka && fs.existsSync(path.join(MAGAZYN, sciezka));
  const wKursie = sciezka && sciezka.startsWith('kurs/' + KURS.podstawowy + '/pdf/');
  sprawdz(8, 'Instruktor wgrywa prawdziwy plik; ląduje pod ścieżką swojego kursu',
    h1.status === 200 && naDysku && wKursie && Number(h1.json.material.rozmiar_b) === pdf.length,
    `status ${h1.status} · na dysku: ${naDysku} · ${sciezka || '—'} · ${h1.json?.material?.rozmiar_b} B`);

  /* ── 9. Zły format i za duży plik ───────────────────────────── */
  const i1 = await zapytanie('/api/material/plik?' +
      q({ kurs_id: KURS.podstawowy, typ:'pdf', nazwa:'Podszywka', plik:'x.exe' }),
    { metoda:'POST', ciastko: maliwan.ciastko, cialo: Buffer.from('MZ'),
      typ:'application/x-msdownload' }).catch(() => ({ status: 415 }));
  const i2 = await zapytanie('/api/material/plik?' +
      q({ kurs_id: KURS.podstawowy, typ:'pdf', nazwa:'Za duzy', plik:'duzy.pdf' }),
    { metoda:'POST', ciastko: maliwan.ciastko,
      cialo: Buffer.alloc(26*1024*1024, 0x20), typ:'application/pdf' }).catch(() => ({status:413}));
  const i3 = await zapytanie('/api/material/plik?' +
      q({ kurs_id: KURS.podstawowy, typ:'pdf', nazwa:'Pusty', plik:'pusty.pdf' }),
    { metoda:'POST', ciastko: maliwan.ciastko, cialo: Buffer.alloc(0),
      typ:'application/pdf' }).catch(() => ({ status: 400 }));
  sprawdz(9, 'Odrzucamy niedozwolony format, plik ponad limit i plik pusty',
    i1.status === 415 && (i2.status === 413 || i2.status === 400) && i3.status === 400,
    `format: ${i1.status} · rozmiar: ${i2.status} · pusty: ${i3.status}`);

  /* ── 10. Nieudany zapis metadanych sprząta plik ─────────────
     Maliwan traci kurs profesjonalny, więc metadane nie przejdą.
     Sprawdzamy, że po odrzuceniu w magazynie NIC nie zostało.       */
  const przed = policzPliki(MAGAZYN);
  await db.query(`update public.kurs set instruktor_id=null where kod='profesjonalny'`);
  const j1 = await zapytanie('/api/material/plik?' +
      q({ kurs_id:'aaaaaaaa-0000-0000-0000-000000000003', typ:'pdf',
          nazwa:'Nie moj kurs', plik:'x.pdf' }),
    { metoda:'POST', ciastko: maliwan.ciastko, cialo: pdf, typ:'application/pdf' });
  await db.query(`update public.kurs set instruktor_id=$1 where kod='profesjonalny'`,
    ['22222222-2222-2222-2222-222222222222']);
  const po = policzPliki(MAGAZYN);
  const smieci = fs.readdirSync(MAGAZYN).filter(f => f.startsWith('.tmp-')).length;
  sprawdz(10, 'Gdy metadane nie przejdą, plik jest kasowany — nie zostaje sierota',
    j1.status === 403 && po === przed && smieci === 0,
    `odpowiedź: ${j1.status} · plików przed: ${przed}, po: ${po} · plików tymczasowych: ${smieci}`);

  /* ── 11. Kursant a materiał: przed i po publikacji ──────────── */
  const idMat = h1.json?.material?.id;
  const ania4 = await zaloguj('ania');
  const k1 = await zapytanie('/api/material/link?id=' + idMat, { ciastko: ania4.ciastko });
  await zapytanie('/api/material/publikuj',
    { metoda:'POST', ciastko: maliwan.ciastko, dane:{ id: idMat, opublikowany: true } });
  const k2 = await zapytanie('/api/material/link?id=' + idMat, { ciastko: ania4.ciastko });
  sprawdz(11, 'Kursant dostaje link dopiero po opublikowaniu materiału',
    k1.status === 403 && k2.status === 200 && /^\/plik\?/.test(k2.json.link || ''),
    `przed publikacją: ${k1.status} · po: ${k2.status} · link ważny ${k2.json?.wazny_s} s`);

  /* ── 12. Plik z cudzego kursu ───────────────────────────────── */
  const { rows:[cudzy] } = await db.query(
    `select id, sciezka from public.material where kurs_id=$1 and opublikowany limit 1`,
    [KURS.mistrzowski]);
  const l1 = await zapytanie('/api/material/link?id=' + cudzy.id, { ciastko: ania4.ciastko });
  const l2 = await zapytanie('/api/material/link?id=' + cudzy.id,
    { ciastko: (await zaloguj('piotr')).ciastko });
  sprawdz(12, 'Kursant nie dostanie linku do pliku z kursu, na który nie jest zapisany',
    l1.status === 403 && (l2.status === 200 || l2.status === 404),
    `Ania (nie jej kurs): ${l1.status} · Piotr (jego kurs): ${l2.status}` +
    (l2.status === 404 ? ' — rekord jest, pliku jeszcze nie wgrano' : ''));

  /* ── 13. Podpisany link: działa, ale nie da się go podrobić ── */
  const link = k2.json.link;
  const m1 = await zapytanie(link);
  const m2 = await zapytanie(link.replace(/p=[0-9a-f]+/, 'p=' + 'a'.repeat(64)));
  const m3 = await zapytanie(link.replace(/do=\d+/, 'do=' + (Date.now() - 1000)));
  const m4 = await zapytanie('/plik?s=' + encodeURIComponent('kurs/' + KURS.mistrzowski +
      '/pdf/cokolwiek.pdf') + '&do=' + (Date.now()+60000) + '&p=' + 'b'.repeat(64));
  sprawdz(13, 'Podpisany link działa; podrobiony, wygasły i zmyślony — nie',
    m1.status === 200 && m2.status === 403 && m3.status === 403 && m4.status === 403,
    `poprawny: ${m1.status} (${m1.tekst.length} B) · podrobiony podpis: ${m2.status} · ` +
    `wygasły: ${m3.status} · zmyślona ścieżka: ${m4.status}`);

  /* ── 14. Pytania: kursant pyta, Maliwan odpowiada ───────────── */
  const n1 = await zapytanie('/api/pytanie', { metoda:'POST', ciastko: ania4.ciastko,
    dane:{ kurs_id: KURS.podstawowy, tresc: 'Czy przy żylakach omijam całą łydkę?' } });
  const idPyt = n1.json?.id;
  const n2 = await zapytanie('/api/pytanie/odpowiedz', { metoda:'POST', ciastko: ania4.ciastko,
    dane:{ id: idPyt, odpowiedz: 'Sam sobie odpowiem' } });
  const n3 = await zapytanie('/api/pytanie/odpowiedz', { metoda:'POST', ciastko: maliwan.ciastko,
    dane:{ id: idPyt, odpowiedz: 'Nie na żylaku. Wokół można, delikatnie.' } });
  const n4 = await zapytanie('/api/pytania', { ciastko: ania4.ciastko });
  const moje = (n4.json || []).find(p => p.id === idPyt);
  const piotrWidzi = ((await zapytanie('/api/pytania',
    { ciastko: (await zaloguj('piotr')).ciastko })).json || []).some(p => p.id === idPyt);
  sprawdz(14, 'Kursant pyta, tylko instruktor odpowiada, cudzy kursant tego nie widzi',
    n1.status === 200 && n2.status === 403 && n3.status === 200 &&
    moje && moje.odpowiedz && moje.status === 'odpowiedziane' && !piotrWidzi,
    `pytanie: ${n1.status} · kursant próbuje odpowiedzieć: ${n2.status} · ` +
    `Maliwan: ${n3.status} · kursantka widzi odpowiedź: ${!!moje?.odpowiedz} · ` +
    `obcy kursant widzi: ${piotrWidzi}`);

  /* ── 15. Zapraszanie ────────────────────────────────────────── */
  const o1 = await zapytanie('/api/zapros', { metoda:'POST', ciastko: ania4.ciastko,
    dane:{ imie:'Ktoś', email:'nowy@przyklad.pl', rola:'admin' } });
  const o2 = await zapytanie('/api/zapros', { metoda:'POST', ciastko: norbert2.ciastko,
    dane:{ imie:'Nowa Kursantka', email:'nowa@przyklad.pl', rola:'kursant' } });
  const o3 = await zapytanie('/api/zapros', { metoda:'POST', ciastko: norbert2.ciastko,
    dane:{ imie:'Zły adres', email:'to-nie-jest-email', rola:'kursant' } });
  const { rows:[z] } = await db.query(
    `select token_hash from public.zaproszenie where email='nowa@przyklad.pl' limit 1`);
  const tokenWLinku = (o2.json?.link_lokalny || '').split('=')[1] || '';
  const trzymaJawny = z && z.token_hash === tokenWLinku;
  sprawdz(15, 'Zaprasza tylko admin; w bazie ląduje skrót tokenu, nie sam token',
    o1.status === 403 && o2.status === 200 && o3.status === 400 && z && !trzymaJawny
    && z.token_hash.length === 64,
    `kursant: ${o1.status} · admin: ${o2.status} · zły e-mail: ${o3.status} · ` +
    `w bazie skrót SHA-256 (${z?.token_hash?.length} znaków), nie token`);

  /* ── 16. Kursant nie dosięgnie panelu administratora ────────── */
  const p1 = await zapytanie('/api/konta',   { ciastko: ania4.ciastko });
  const p2 = await zapytanie('/api/przypisz', { metoda:'POST', ciastko: ania4.ciastko,
    dane:{ kurs_id: KURS.mistrzowski, kursant_id: ID_ANI } });
  const p3 = await zapytanie('/api/konto/rola', { metoda:'POST', ciastko: ania4.ciastko,
    dane:{ id: ID_ANI, rola:'admin' } });
  const p4 = await zapytanie('/api/zaproszenia', { ciastko: ania4.ciastko });
  sprawdz(16, 'Kursant wołający API administratora dostaje własne dane albo odmowę',
    p1.status === 200 && Array.isArray(p1.json) && p1.json.length === 1 &&
    p2.status === 403 && p3.status === 403 && Array.isArray(p4.json) && p4.json.length === 0,
    `/api/konta: ${p1.status}, wierszy ${p1.json?.length} (tylko własny profil) · ` +
    `przypisanie: ${p2.status} · zmiana roli: ${p3.status} · zaproszenia: ${p4.json?.length}`);

  /* ── sprzątanie ─────────────────────────────────────────────── */
  await db.query(`delete from public.pytanie where tresc like 'Czy przy żylakach%'`);
  await db.query(`delete from public.zaproszenie where email like '%@przyklad.pl'`);
  if (sciezka) {
    await db.query(`delete from public.material where sciezka=$1`, [sciezka]);
    fs.rmSync(path.join(MAGAZYN, sciezka), { force: true });
  }

  const zdane = wyniki.filter(w => w.zdal).length;
  console.log(`\n═══ HTTP: ${zdane} / ${wyniki.length} ═══`);
  if (zdane < wyniki.length) {
    console.log('\nNIEZDANE:');
    wyniki.filter(w => !w.zdal).forEach(w => console.log(`  ${w.nr}. ${w.opis}`));
  }
  await db.end();
  serwer.kill();
  process.exit(zdane === wyniki.length ? 0 : 1);
})().catch(e => {
  console.error('BŁĄD URUCHOMIENIA:', e.message);
  if (serwer) serwer.kill();
  process.exit(2);
});

function policzPliki(katalog){
  if (!fs.existsSync(katalog)) return 0;
  let n = 0;
  for (const w of fs.readdirSync(katalog, { withFileTypes: true }))
    n += w.isDirectory() ? policzPliki(path.join(katalog, w.name)) : 1;
  return n;
}
