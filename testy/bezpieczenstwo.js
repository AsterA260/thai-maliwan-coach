#!/usr/bin/env node
/**
 * AsterA Coach — testy bezpieczeństwa na poziomie BAZY
 *
 * Każdy test wykonuje się na prawdziwej bazie z włączonym i wymuszonym
 * RLS, w roli `authenticated` i z ustawionym request.jwt.claims —
 * dokładnie tak, jak Supabase ustawia kontekst zalogowanego.
 * Niezalogowany = rola `anon` bez żadnych claimów.
 *
 * Testy HTTP (sesje, logowanie, wgrywanie plików) są w testy/http.js.
 * Testy Auth i Storage na żywym Supabase są OCZEKUJĄCE — patrz
 * testy/oczekujace.md. Ten plik ich NIE udaje.
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

async function jako(uid, sql, params = []) {
  await db.query('begin');
  try {
    if (uid) {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    } else {
      await db.query('set local role anon');
      await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    }
    const r = await db.query(sql, params);
    await db.query('rollback');
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback');
    return { ok: false, blad: e.message.split('\n')[0] };
  }
}
const n = r => (r.ok ? (r.rows[0] ? Number(r.rows[0].n) : 0) : 0);

/** Jak `jako`, ale ZATWIERDZA zmianę. Potrzebne w przygotowaniu testu:
 *  wyzwalacz `profil_ochrona` cofa zmianę roli i aktywności każdemu,
 *  kto nie jest adminem — w tym połączeniu superużytkownika bez claimów. */
async function jakoTrwale(uid, sql, params = []) {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const r = await db.query(sql, params);
    await db.query('commit');
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await db.query('rollback');
    return { ok: false, blad: e.message.split('\n')[0] };
  }
}

function sprawdz(nr, opis, warunek, szczegol) {
  wyniki.push({ nr, opis, zdal: !!warunek });
  console.log(`${warunek ? '  ZDANY ' : '  BŁĄD  '} ${String(nr).padStart(2)}. ${opis}`);
  if (szczegol) console.log(`          ${szczegol}`);
}

(async () => {
  db = new Client(DB);
  await db.connect();

  console.log('\n═══ TESTY BEZPIECZEŃSTWA — BAZA ═══');
  console.log('PostgreSQL 16, RLS włączony i wymuszony (FORCE) na wszystkich tabelach\n');

  /* ── 1. Niezalogowany nic nie widzi ─────────────────────────── */
  const bez = [];
  for (const t of ['kurs','etap','material','profile','postep','pytanie','zaproszenie'])
    bez.push(await jako(null, `select count(*)::int n from public.${t}`));
  sprawdz(1, 'Niezalogowany nie widzi żadnej tabeli',
    bez.every(r => !r.ok || n(r) === 0),
    'kurs, etap, material, profile, postep, pytanie, zaproszenie → odmowa dostępu');

  /* ── 2. Kursant nie wejdzie do panelu Maliwan ani Norberta ──── */
  const b1 = await jako(KTO.ania, `select public.jestem_adminem() a, public.jestem_instruktorem() i`);
  const b2 = await jako(KTO.ania, `select count(*)::int n from public.profile`);
  const b3 = await jako(KTO.ania,
    `update public.profile set rola='admin' where id=$1 returning rola`, [KTO.ania]);
  const b4 = await jako(KTO.ania, `select count(*)::int n from public.zaproszenie`);
  sprawdz(2, 'Kursant nie ma uprawnień admina ani instruktora i nie podniesie sobie roli',
    b1.rows[0].a === false && b1.rows[0].i === false && n(b2) === 1 &&
    (!b3.ok || b3.rows[0].rola === 'kursant') && n(b4) === 0,
    `widzi kont: ${n(b2)} · zaproszeń: ${n(b4)} · po próbie zmiany roli pozostaje: ` +
    `${b3.ok ? b3.rows[0].rola : 'odmowa'}`);

  /* ── 2b. Kursant nie zmieni sobie e-maila ani aktywności ─────── */
  const b5 = await jako(KTO.ania,
    `update public.profile set email='ja@admin.pl', aktywne=false where id=$1
     returning email, aktywne`, [KTO.ania]);
  sprawdz(3, 'Kursant nie zmieni sobie e-maila ani nie ruszy flagi aktywności',
    !b5.ok || (b5.rows[0].email === 'ania@przyklad.pl' && b5.rows[0].aktywne === true),
    b5.ok ? `po próbie: ${b5.rows[0].email}, aktywne=${b5.rows[0].aktywne} (wyzwalacz przywrócił)`
          : 'odmowa');

  /* ── 4. Materiał z nieprzypisanego kursu ────────────────────── */
  const c1 = await jako(KTO.ania,
    `select count(*)::int n from public.material where kurs_id=$1`, [KURS.mistrzowski]);
  const c2 = await jako(KTO.piotr,
    `select count(*)::int n from public.material where kurs_id=$1`, [KURS.mistrzowski]);
  const c3 = await jako(KTO.ania, `select sciezka from public.material where id=$1`,
    ['cccccccc-0000-0000-0000-000000000001']);
  sprawdz(4, 'Kursant nie widzi materiału z kursu, na który nie jest zapisany',
    n(c1) === 0 && n(c2) === 1 && c3.n === 0,
    `Ania: ${n(c1)} · Piotr (zapisany): ${n(c2)} · ścieżka pliku dla Ani: ` +
    `${c3.n === 0 ? 'niedostępna' : 'WYCIEK'}`);

  /* ── 5. Znajomość ID nic nie daje ───────────────────────────── */
  const d1 = await jako(KTO.ania, `select count(*)::int n from public.kurs where id=$1`, [KURS.mistrzowski]);
  const d2 = await jako(KTO.ania, `select count(*)::int n from public.kurs where id=$1`, [KURS.profesjonalny]);
  const d3 = await jako(KTO.ania, `select count(*)::int n from public.etap e
     join public.lekcja l on l.id=e.lekcja_id where l.kurs_id=$1`, [KURS.mistrzowski]);
  const d4 = await jako(KTO.obcy, `select count(*)::int n from public.kurs`);
  sprawdz(5, 'Znajomość ID kursu nic nie daje — filtr jest w bazie, nie w adresie',
    n(d1) === 0 && n(d2) === 0 && n(d3) === 0 && n(d4) === 0,
    `cudzy kurs: ${n(d1)} · nieopublikowany: ${n(d2)} · jego etapy: ${n(d3)} · ` +
    `kursant bez przypisania: ${n(d4)}`);

  /* ── 6. Materiał: ścieżka musi wskazywać ten sam kurs ────────
     To jest luka wskazana w audycie. Test sprawdza wszystkie trzy
     zabezpieczenia: ograniczenie w tabeli, WITH CHECK w polityce
     i wymóg uprawnień do kursu ze ścieżki.                        */
  const sc = k => `kurs/${k}/pdf/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
  const e1 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, dodal_id)
     values ($1,'pdf','Poprawny',$2,$3) returning id`,
    [KURS.mistrzowski, sc(KURS.mistrzowski), KTO.maliwan]);
  // ścieżka bez UUID kursu — dawniej przechodziła
  const e2 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, dodal_id)
     values ($1,'pdf','Bez UUID','kurs/x/pdf/test.pdf',$2) returning id`,
    [KURS.mistrzowski, KTO.maliwan]);
  // ścieżka wskazująca INNY kurs — próba podczepienia się pod cudzy plik
  const e3 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, dodal_id)
     values ($1,'pdf','Podszywka',$2,$3) returning id`,
    [KURS.mistrzowski, sc(KURS.podstawowy), KTO.maliwan]);
  // ucieczka ze ścieżki
  const e4 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, dodal_id)
     values ($1,'pdf','Ucieczka',$2,$3) returning id`,
    [KURS.mistrzowski, `kurs/${KURS.mistrzowski}/../../etc/passwd`, KTO.maliwan]);
  sprawdz(6, 'Ścieżka pliku musi wskazywać dokładnie ten sam kurs co rekord materiału',
    e1.ok && !e2.ok && !e3.ok && !e4.ok,
    `poprawna: ${e1.ok ? 'przyjęta' : 'ODRZUCONA — źle'} · bez UUID: ${e2.ok ? 'PRZESZŁA — źle' : 'odrzucona'} · ` +
    `cudzy kurs: ${e3.ok ? 'PRZESZŁA — źle' : 'odrzucona'} · ".." w ścieżce: ${e4.ok ? 'PRZESZŁA — źle' : 'odrzucona'}`);

  /* ── 7. Instruktor tylko do swojego kursu ───────────────────── */
  await db.query(`update public.kurs set instruktor_id=null where id=$1`, [KURS.profesjonalny]);
  const f1 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, dodal_id)
     values ($1,'pdf','Cudzy kurs',$2,$3) returning id`,
    [KURS.profesjonalny, sc(KURS.profesjonalny), KTO.maliwan]);
  await db.query(`update public.kurs set instruktor_id=$2 where id=$1`,
    [KURS.profesjonalny, KTO.maliwan]);
  sprawdz(7, 'Instruktor nie doda materiału do kursu, którego nie prowadzi',
    !f1.ok, f1.ok ? 'DODANY — ŹLE' : 'odrzucony');

  /* ── 8. Publikacja odsłania materiał ────────────────────────── */
  const sciezkaNowa = sc(KURS.podstawowy);
  const { rows:[nowy] } = await db.query(
    `insert into public.material (kurs_id, typ, nazwa_pl, sciezka, opublikowany, dodal_id)
     values ($1,'pdf','Nowy materiał',$2,false,$3) returning id`,
    [KURS.podstawowy, sciezkaNowa, KTO.maliwan]);
  const g1 = await jako(KTO.ania, `select count(*)::int n from public.material where id=$1`, [nowy.id]);
  await db.query(`update public.material set opublikowany=true where id=$1`, [nowy.id]);
  const g2 = await jako(KTO.ania, `select count(*)::int n from public.material where id=$1`, [nowy.id]);
  await db.query(`delete from public.material where id=$1`, [nowy.id]);
  sprawdz(8, 'Materiał nieopublikowany jest dla kursanta niewidoczny, opublikowany — widoczny',
    n(g1) === 0 && n(g2) === 1, `przed: ${n(g1)} · po: ${n(g2)}`);

  /* ── 9. Postęp: prywatny i nie do przepięcia ────────────────── */
  const { rows:[ep] } = await db.query(
    `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
     where l.kurs_id=$1 order by e.kolejnosc limit 1`, [KURS.podstawowy]);
  const { rows:[em] } = await db.query(
    `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
     where l.kurs_id=$1 limit 1`, [KURS.mistrzowski]);
  // Czyścimy przed testem — inaczej dane zostawione przez aplikację
  // albo wcześniejszy przebieg fałszowałyby liczby.
  await db.query(`delete from public.postep where kursant_id=$1`, [KTO.ania]);
  await db.query(`insert into public.postep (kursant_id, etap_id, status)
    values ($1,$2,'zrobione') on conflict (kursant_id,etap_id) do update set status='zrobione'`,
    [KTO.ania, ep.id]);
  const h1 = await jako(KTO.ania,  `select count(*)::int n from public.postep`);
  const h2 = await jako(KTO.piotr, `select count(*)::int n from public.postep where kursant_id=$1`, [KTO.ania]);
  const h3 = await jako(KTO.piotr, `insert into public.postep (kursant_id, etap_id, status)
     values ($1,$2,'zrobione') returning id`, [KTO.ania, ep.id]);
  // przepięcie własnego postępu na etap CUDZEGO kursu
  const h4 = await jako(KTO.ania, `insert into public.postep (kursant_id, etap_id, status)
     values (auth.uid(),$1,'zrobione') returning id`, [em.id]);
  const h5 = await jako(KTO.ania, `update public.postep set etap_id=$1
     where kursant_id=auth.uid() returning id`, [em.id]);
  const h6 = await jako(KTO.maliwan, `select count(*)::int n from public.postep where etap_id=$1`, [ep.id]);
  await db.query(`delete from public.postep where kursant_id=$1`, [KTO.ania]);
  sprawdz(9, 'Postęp jest prywatny i nie da się go przepiąć do etapu innego kursu',
    n(h1) === 1 && n(h2) === 0 && !h3.ok && !h4.ok && !h5.ok && n(h6) === 1,
    `swoje: ${n(h1)} · cudze: ${n(h2)} · podszycie: ${h3.ok?'UDAŁO SIĘ — ŹLE':'odrzucone'} · ` +
    `wstawienie na cudzy etap: ${h4.ok?'PRZESZŁO — ŹLE':'odrzucone'} · ` +
    `przepięcie: ${h5.ok?'PRZESZŁO — ŹLE':'odrzucone'} · instruktor widzi: ${n(h6)}`);

  /* ── 10. Pytanie: etap musi należeć do kursu ────────────────── */
  const i1 = await jako(KTO.ania, `insert into public.pytanie (kursant_id, kurs_id, etap_id, tresc)
     values (auth.uid(),$1,$2,'Test') returning id`, [KURS.podstawowy, em.id]);
  const i2 = await jako(KTO.ania, `insert into public.pytanie (kursant_id, kurs_id, etap_id, tresc)
     values (auth.uid(),$1,$2,'Test poprawny') returning id`, [KURS.podstawowy, ep.id]);
  const i3 = await jako(KTO.ania, `insert into public.pytanie (kursant_id, kurs_id, tresc)
     values (auth.uid(),$1,'Nie moj kurs') returning id`, [KURS.mistrzowski]);
  sprawdz(10, 'Pytanie: etap musi należeć do tego samego kursu, a kurs musi być własny',
    !i1.ok && i2.ok && !i3.ok,
    `etap z innego kursu: ${i1.ok?'PRZESZŁO — ŹLE':'odrzucone'} · poprawne: ` +
    `${i2.ok?'przyjęte':'ODRZUCONE — źle'} · cudzy kurs: ${i3.ok?'PRZESZŁO — ŹLE':'odrzucone'}`);

  /* ── 11. Instruktor zmienia w pytaniu tylko odpowiedź ───────── */
  const { rows:[pyt] } = await db.query(
    `insert into public.pytanie (kursant_id, kurs_id, tresc)
     values ($1,$2,'Pytanie oryginalne') returning id`, [KTO.ania, KURS.podstawowy]);
  const j1 = await jako(KTO.maliwan, `update public.pytanie
     set odpowiedz='Odpowiedź Maliwan', status='odpowiedziane', odpowiedzial_id=auth.uid(),
         tresc='PODMIENIONA TREŚĆ', kursant_id=$2, kurs_id=$3
     where id=$1 returning tresc, kursant_id, kurs_id, odpowiedz, status, odpowiedziano`,
     [pyt.id, KTO.piotr, KURS.mistrzowski]);
  await db.query(`delete from public.pytanie where id=$1`, [pyt.id]);
  sprawdz(11, 'Instruktor zapisuje odpowiedź, ale nie podmieni autora, kursu ani treści',
    j1.ok && j1.rows[0].tresc === 'Pytanie oryginalne' &&
    j1.rows[0].kursant_id === KTO.ania && j1.rows[0].kurs_id === KURS.podstawowy &&
    j1.rows[0].odpowiedz === 'Odpowiedź Maliwan' && j1.rows[0].odpowiedziano !== null,
    j1.ok ? `treść: „${j1.rows[0].tresc}" · autor bez zmian · odpowiedź zapisana i ostemplowana czasem`
          : 'odmowa — źle');

  /* ── 12. Ostatni administrator ──────────────────────────────── */
  const k1 = await jako(KTO.norbert,
    `update public.profile set aktywne=false where id=$1 returning id`, [KTO.norbert]);
  const k2 = await jako(KTO.norbert,
    `update public.profile set rola='kursant' where id=$1 returning id`, [KTO.norbert]);
  const k3 = await jako(KTO.norbert, `delete from public.profile where id=$1 returning id`, [KTO.norbert]);
  sprawdz(12, 'Ostatniego aktywnego administratora nie da się wyłączyć, zdegradować ani skasować',
    !k1.ok && !k2.ok && !k3.ok,
    `wyłączenie: ${k1.ok?'PRZESZŁO — ŹLE':'zablokowane'} · degradacja: ` +
    `${k2.ok?'PRZESZŁO — ŹLE':'zablokowana'} · usunięcie: ${k3.ok?'PRZESZŁO — ŹLE':'zablokowane'}`);

  /* ── 13. Wyłączone konto przestaje cokolwiek widzieć ────────── */
  const wyl = await jakoTrwale(KTO.norbert,
    `update public.profile set aktywne=false where id=$1 returning aktywne`, [KTO.ania]);
  const l1 = await jako(KTO.ania, `select count(*)::int n from public.kurs`);
  const l2 = await jako(KTO.ania, `select count(*)::int n from public.etap`);
  await jakoTrwale(KTO.norbert,
    `update public.profile set aktywne=true where id=$1`, [KTO.ania]);
  const l3 = await jako(KTO.ania, `select count(*)::int n from public.kurs`);
  sprawdz(13, 'Konto wyłączone traci dostęp do danych, włączone odzyskuje',
    n(l1) === 0 && n(l2) === 0 && n(l3) === 1,
    `wyłączenie przez admina: ${wyl.ok ? 'ok' : 'nie udało się'} · ` +
    `wyłączona widzi kursów: ${n(l1)}, etapów: ${n(l2)} · po włączeniu: ${n(l3)}`);

  /* ── 14. Uprawnienia do funkcji ─────────────────────────────── */
  const m1 = await jako(KTO.ania, `select public.zapisany_na_kurs($1) w`, [KURS.podstawowy]);
  const m2 = await jako(KTO.ania, `select public.chron_profil()`);
  const m3 = await jako(KTO.ania, `select public.obsluz_nowego_uzytkownika()`);
  sprawdz(14, 'Rola authenticated może wywołać tylko funkcje potrzebne aplikacji',
    m1.ok && !m2.ok && !m3.ok,
    `zapisany_na_kurs: dostępna · chron_profil: ${m2.ok?'DOSTĘPNA — ŹLE':'zablokowana'} · ` +
    `obsluz_nowego_uzytkownika: ${m3.ok?'DOSTĘPNA — ŹLE':'zablokowana'}`);

  /* ── 15. Admin widzi wszystko, instruktor swoich ────────────── */
  const o1 = await jako(KTO.norbert, `select count(*)::int n from public.kurs`);
  const o2 = await jako(KTO.norbert, `select count(*)::int n from public.profile`);
  const o3 = await jako(KTO.maliwan, `select count(*)::int n from public.profile`);
  sprawdz(15, 'Admin widzi wszystko; instruktor tylko swoich kursantów i siebie',
    n(o1) === 3 && n(o2) === 5 && n(o3) === 3,
    `Norbert: kursów ${n(o1)}/3, kont ${n(o2)}/5 · Maliwan: kont ${n(o3)}`);

  /* ── 16. WYŚCIG: dwie równoczesne transakcje wyłączające dwóch
         ostatnich adminów. Samo count(*) tego nie łapie — każda
         transakcja widziałaby drugiego admina jeszcze aktywnym.
         Blokada doradcza ustawia je w kolejkę.                    ── */
  await jakoTrwale(KTO.norbert,
    `update public.profile set rola='admin' where id=$1`, [KTO.maliwan]);

  const A = new Client(DB), B = new Client(DB);
  await A.connect(); await B.connect();
  const jakoAdmin = async k => {
    await k.query('begin');
    await k.query('set local role authenticated');
    await k.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: KTO.norbert, role: 'authenticated' })]);
  };
  await jakoAdmin(A); await jakoAdmin(B);

  await A.query(`update public.profile set aktywne=false where id=$1`, [KTO.maliwan]);
  let wynikB = null;
  const czekaB = B.query(`update public.profile set aktywne=false where id=$1`, [KTO.norbert])
    .then(() => { wynikB = 'PRZESZŁO'; })
    .catch(e => { wynikB = e.message.split('\n')[0]; });
  await new Promise(r => setTimeout(r, 400));
  const drugaCzeka = wynikB === null;            // stoi na blokadzie
  await A.query('commit');
  await czekaB;
  await B.query('rollback').catch(() => {});
  await A.end(); await B.end();

  await jakoTrwale(KTO.norbert,
    `update public.profile set aktywne=true, rola='instruktor' where id=$1`, [KTO.maliwan]);
  const poWyscigu = await jako(KTO.norbert,
    `select count(*)::int n from public.profile where rola='admin' and aktywne`);

  sprawdz(16, 'Dwie równoczesne transakcje nie wyłączą dwóch ostatnich administratorów',
    drugaCzeka && /jedyny aktywny administrator/i.test(wynikB || '') && n(poWyscigu) === 1,
    `druga transakcja czekała na blokadę: ${drugaCzeka} · wynik: „${wynikB}" · ` +
    `aktywnych adminów po wszystkim: ${n(poWyscigu)}`);

  const zdane = wyniki.filter(w => w.zdal).length;
  console.log(`\n═══ BAZA: ${zdane} / ${wyniki.length} ═══`);
  if (zdane < wyniki.length) {
    console.log('\nNIEZDANE:');
    wyniki.filter(w => !w.zdal).forEach(w => console.log(`  ${w.nr}. ${w.opis}`));
  }
  await db.end();
  process.exit(zdane === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.message); process.exit(2); });
