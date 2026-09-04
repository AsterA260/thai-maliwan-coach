#!/usr/bin/env node
/**
 * AsterA Coach — testy bezpieczeństwa
 *
 * Każdy test wykonuje się na PRAWDZIWEJ bazie z włączonym RLS,
 * w roli `authenticated` i z ustawionym request.jwt.claims — dokładnie
 * tak, jak Supabase ustawia kontekst dla zalogowanego użytkownika.
 * Niezalogowany = rola `anon` bez żadnych claimów.
 */
const { Client } = require('pg');

const DB = { host: '/tmp', port: 5433, user: 'postgres', database: 'coach' };

const KTO = {
  norbert : '11111111-1111-1111-1111-111111111111', // admin
  maliwan : '22222222-2222-2222-2222-222222222222', // instruktor
  ania    : '33333333-3333-3333-3333-333333333333', // kursant, kurs podstawowy
  piotr   : '44444444-4444-4444-4444-444444444444', // kursant, kurs mistrzowski
  obcy    : '55555555-5555-5555-5555-555555555555', // kursant bez kursu
};
const KURS = {
  podstawowy   : 'aaaaaaaa-0000-0000-0000-000000000001',
  mistrzowski  : 'aaaaaaaa-0000-0000-0000-000000000002',
  profesjonalny: 'aaaaaaaa-0000-0000-0000-000000000003',
};

let db, wyniki = [];

/** Wykonuje zapytanie w kontekście danego użytkownika (albo bez logowania). */
async function jako(uid, sql, params = []) {
  await db.query('begin');
  try {
    if (uid) {
      await db.query('set local role authenticated');
      await db.query(
        `select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]
      );
    } else {
      await db.query('set local role anon');
      await db.query(`select set_config('request.jwt.claims', '', true)`);
    }
    const r = await db.query(sql, params);
    await db.query('rollback');
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback');
    return { ok: false, blad: e.message.split('\n')[0] };
  }
}

/** Liczba z zapytania; odmowa dostępu liczy się jako 0 widocznych wierszy. */
function n(r){ return r.ok ? (r.rows[0] ? Number(r.rows[0].n) : 0) : 0; }

function sprawdz(nr, opis, warunek, szczegol) {
  wyniki.push({ nr, opis, zdal: !!warunek, szczegol });
  const znak = warunek ? '  ZDANY ' : '  BŁĄD  ';
  console.log(`${znak} ${String(nr).padStart(2)}. ${opis}`);
  if (szczegol) console.log(`          ${szczegol}`);
}

(async () => {
  db = new Client(DB);
  await db.connect();

  console.log('\n═══ TESTY BEZPIECZEŃSTWA — AsterA Coach ═══');
  console.log('Baza: PostgreSQL 16, RLS włączony i wymuszony (FORCE) na wszystkich tabelach\n');

  // ── 1. Niezalogowany nie otworzy Coacha ani materiałów ──────────
  const a1 = await jako(null, 'select count(*)::int n from public.kurs');
  const a2 = await jako(null, 'select count(*)::int n from public.etap');
  const a3 = await jako(null, 'select count(*)::int n from public.material');
  const a4 = await jako(null, 'select count(*)::int n from public.profile');
  const bezLogowania = [a1, a2, a3, a4]
    .map(r => (r.ok ? r.rows[0].n : 'odmowa'));
  sprawdz(1, 'Niezalogowany nie widzi kursów, etapów, materiałów ani kont',
    bezLogowania.every(v => v === 0 || v === 'odmowa'),
    `kursy=${bezLogowania[0]} etapy=${bezLogowania[1]} materiały=${bezLogowania[2]} konta=${bezLogowania[3]}`);

  // ── 2. Kursant nie wejdzie do panelu Maliwan ani Norberta ───────
  const b1 = await jako(KTO.ania, `select public.jestem_adminem() a, public.jestem_instruktorem() i`);
  const b2 = await jako(KTO.ania, `select count(*)::int n from public.profile`);
  const b3 = await jako(KTO.ania,
    `update public.profile set rola = 'admin' where id = $1 returning id`, [KTO.ania]);
  const b4 = await jako(KTO.ania, `select count(*)::int n from public.przypisanie`);
  sprawdz(2, 'Kursant nie ma uprawnień admina/instruktora i nie podniesie sobie roli',
    b1.rows[0].a === false && b1.rows[0].i === false &&
    b2.rows[0].n === 1 && (b3.ok === false || b3.n === 0) && b4.rows[0].n === 1,
    `widzi kont: ${b2.rows[0].n} (tylko swoje) · przypisań: ${b4.rows[0].n} (tylko swoje) · ` +
    `próba zmiany roli: ${b3.ok === false ? 'odrzucona' : b3.n + ' wierszy'}`);

  // ── 3. Kursant nie pobierze materiału z nieprzypisanego kursu ───
  const c1 = await jako(KTO.ania,
    `select count(*)::int n from public.material where kurs_id = $1`, [KURS.mistrzowski]);
  const c2 = await jako(KTO.piotr,
    `select count(*)::int n from public.material where kurs_id = $1`, [KURS.mistrzowski]);
  const c3 = await jako(KTO.ania, `select sciezka from public.material where id = $1`,
    ['cccccccc-0000-0000-0000-000000000001']);
  sprawdz(3, 'Kursant nie widzi materiału z kursu, na który nie jest zapisany',
    c1.rows[0].n === 0 && c2.rows[0].n === 1 && c3.n === 0,
    `Ania (kurs podstawowy) widzi materiałów mistrzowskiego: ${c1.rows[0].n} · ` +
    `Piotr (zapisany): ${c2.rows[0].n} · ścieżka pliku dla Ani: ${c3.n === 0 ? 'niedostępna' : 'WYCIEK'}`);

  // ── 4. Zmiana adresu nie omija uprawnień ───────────────────────
  // Symulacja: kursant zna ID cudzego kursu i pyta o niego wprost.
  const d1 = await jako(KTO.ania, `select count(*)::int n from public.kurs where id = $1`, [KURS.mistrzowski]);
  const d2 = await jako(KTO.ania, `select count(*)::int n from public.kurs where id = $1`, [KURS.profesjonalny]);
  const d3 = await jako(KTO.ania,
    `select count(*)::int n from public.etap e join public.lekcja l on l.id=e.lekcja_id
     where l.kurs_id = $1`, [KURS.mistrzowski]);
  const d4 = await jako(KTO.obcy, `select count(*)::int n from public.kurs`);
  sprawdz(4, 'Znajomość ID kursu nic nie daje — filtr jest w bazie, nie w adresie',
    d1.rows[0].n === 0 && d2.rows[0].n === 0 && d3.rows[0].n === 0 && d4.rows[0].n === 0,
    `Ania pytając wprost o kurs mistrzowski: ${d1.rows[0].n} · o nieopublikowany: ${d2.rows[0].n} · ` +
    `o jego etapy: ${d3.rows[0].n} · kursant bez przypisania widzi kursów: ${d4.rows[0].n}`);

  // ── 5. Maliwan może dodać materiał i przypiąć go do kursu ──────
  const e1 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, opublikowany, dodal_id)
     values ($1,'pdf','Test — sekwencja stóp','kurs/x/pdf/test.pdf', false, $2) returning id`,
    [KURS.mistrzowski, KTO.maliwan]);
  // ale nie do cudzego kursu:
  await db.query(`update public.kurs set instruktor_id = null where id = $1`, [KURS.profesjonalny]);
  const e2 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, dodal_id)
     values ($1,'pdf','Podszywka','kurs/x/y.pdf',$2) returning id`,
    [KURS.profesjonalny, KTO.maliwan]);
  await db.query(`update public.kurs set instruktor_id = $2 where id = $1`,
    [KURS.profesjonalny, KTO.maliwan]);
  sprawdz(5, 'Instruktor dodaje materiał do SWOJEGO kursu, do cudzego nie',
    e1.ok && e1.n === 1 && !e2.ok,
    `do swojego: ${e1.ok ? 'dodany' : 'odmowa'} · do nie swojego: ${e2.ok ? 'DODANY — ŹLE' : 'odrzucony'}`);

  // ── 6. Kursant widzi materiał dopiero po opublikowaniu ─────────
  const r6 = await db.query(
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, opublikowany, dodal_id)
     values ($1,'pdf','Nowy materiał','kurs/p/pdf/nowy.pdf', false, $2) returning id`,
    [KURS.podstawowy, KTO.maliwan]);
  const idNowy = r6.rows[0].id;
  const f1 = await jako(KTO.ania, `select count(*)::int n from public.material where id=$1`, [idNowy]);
  await db.query(`update public.material set opublikowany = true where id = $1`, [idNowy]);
  const f2 = await jako(KTO.ania, `select count(*)::int n from public.material where id=$1`, [idNowy]);
  await db.query(`delete from public.material where id = $1`, [idNowy]);
  sprawdz(6, 'Materiał nieopublikowany jest dla kursanta niewidoczny, opublikowany — widoczny',
    f1.rows[0].n === 0 && f2.rows[0].n === 1,
    `przed publikacją: ${f1.rows[0].n} · po publikacji: ${f2.rows[0].n}`);

  // ── 7. Postęp jednego kursanta niewidoczny dla drugiego ────────
  const idEtapPodst = (await db.query(
    `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
     where l.kurs_id=$1 order by e.kolejnosc limit 1`, [KURS.podstawowy])).rows[0].id;
  await db.query(
    `insert into public.postep (kursant_id, etap_id, status) values ($1,$2,'zrobione')
     on conflict (kursant_id, etap_id) do update set status='zrobione'`,
    [KTO.ania, idEtapPodst]);
  const g1 = await jako(KTO.ania,  `select count(*)::int n from public.postep`);
  const g2 = await jako(KTO.piotr, `select count(*)::int n from public.postep`);
  const g3 = await jako(KTO.piotr,
    `select count(*)::int n from public.postep where kursant_id = $1`, [KTO.ania]);
  const g4 = await jako(KTO.piotr,
    `insert into public.postep (kursant_id, etap_id, status) values ($1,$2,'zrobione') returning id`,
    [KTO.ania, idEtapPodst]);
  const g5 = await jako(KTO.maliwan,
    `select count(*)::int n from public.postep p
     where p.etap_id = $1`, [idEtapPodst]);
  await db.query(`delete from public.postep where kursant_id=$1`, [KTO.ania]);
  sprawdz(7, 'Postęp jest prywatny; instruktor widzi postępy swojego kursu',
    g1.rows[0].n === 1 && g2.rows[0].n === 0 && g3.rows[0].n === 0 &&
    !g4.ok && g5.rows[0].n === 1,
    `Ania widzi swoich: ${g1.rows[0].n} · Piotr widzi cudzych: ${g3.rows[0].n} · ` +
    `Piotr podszywa się pod Anię: ${g4.ok ? 'UDAŁO SIĘ — ŹLE' : 'odrzucone'} · ` +
    `Maliwan widzi postęp kursanta: ${g5.rows[0].n}`);

  // ── 8. Wylogowanie zamyka sesję ────────────────────────────────
  // Po wylogowaniu klient nie ma tokenu → kontekst jak u anonima.
  const h1 = await jako(KTO.ania, `select count(*)::int n from public.etap`);
  const h2 = await jako(null,     `select count(*)::int n from public.etap`);
  const h3 = await jako(null,     `select count(*)::int n from public.postep`);
  sprawdz(8, 'Bez ważnego tokenu (po wylogowaniu) widoczność spada do zera',
    n(h1) > 0 && n(h2) === 0 && n(h3) === 0,
    `zalogowana Ania widzi etapów: ${n(h1)} · po wylogowaniu: ${h2.ok ? n(h2) : 'odmowa dostępu'} · postępów: ${h3.ok ? n(h3) : 'odmowa dostępu'}`);

  // ── DODATKOWE: admin widzi wszystko ────────────────────────────
  const i1 = await jako(KTO.norbert, `select count(*)::int n from public.kurs`);
  const i2 = await jako(KTO.norbert, `select count(*)::int n from public.profile`);
  const i3 = await jako(KTO.maliwan, `select count(*)::int n from public.profile`);
  sprawdz(9, 'Admin widzi wszystko; instruktor tylko swoich kursantów i siebie',
    n(i1) === 3 && n(i2) === 5 && n(i3) === 3,
    `Norbert: kursów ${n(i1)}/3, kont ${n(i2)}/5 · Maliwan: kont ${n(i3)} (Ania, Piotr, ona sama)`);

  // ── PODSUMOWANIE ───────────────────────────────────────────────
  const zdane = wyniki.filter(w => w.zdal).length;
  console.log(`\n═══ WYNIK: ${zdane} / ${wyniki.length} ═══`);
  if (zdane < wyniki.length) {
    console.log('\nNIEZDANE:');
    wyniki.filter(w => !w.zdal).forEach(w => console.log(`  ${w.nr}. ${w.opis}`));
  }
  await db.end();
  process.exit(zdane === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.message); process.exit(2); });
