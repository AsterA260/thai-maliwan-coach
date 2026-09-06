#!/usr/bin/env node
/**
 * AsterA Coach — testy bezpieczeństwa na poziomie BAZY
 *
 * Każdy test wykonuje się na prawdziwej bazie z włączonym i wymuszonym
 * RLS, w roli `astera_api` i z tożsamością ustawioną TRANSAKCYJNIE:
 *   BEGIN → set_config('astera.uzytkownik', <uuid>, true) → … → COMMIT
 * dokładnie tak, jak robi to AsterA Core.
 * Niezalogowany = ta sama rola, tylko bez set_config — bo Core łączy się
 * jedną rolą, a brak tokenu to brak tożsamości, nie inna rola.
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
    // ETAP 0: tożsamość ustawiana TRANSAKCYJNIE, dokładnie tak jak robi
    // to AsterA Core. Rola bazodanowa zawsze `astera_api` — także dla
    // niezalogowanego, bo Core łączy się jedną rolą, a brak tokenu
    // oznacza po prostu brak set_config, nie inną rolę.
    await db.query('set local role astera_api');
    if (uid) {
      await db.query(`select set_config('astera.uzytkownik', $1, true)`, [uid]);
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
    await db.query('set local role astera_api');
    await db.query(`select set_config('astera.uzytkownik', $1, true)`, [uid]);
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
    `insert into public.material (kurs_id, typ, sciezka, dodal_id)
     values ($1,'pdf',$2,$3) returning id`,
    [KURS.mistrzowski, sc(KURS.mistrzowski), KTO.maliwan]);
  // ścieżka bez UUID kursu — dawniej przechodziła
  const e2 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, sciezka, dodal_id)
     values ($1,'pdf','kurs/x/pdf/test.pdf',$2) returning id`,
    [KURS.mistrzowski, KTO.maliwan]);
  // ścieżka wskazująca INNY kurs — próba podczepienia się pod cudzy plik
  const e3 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, sciezka, dodal_id)
     values ($1,'pdf',$2,$3) returning id`,
    [KURS.mistrzowski, sc(KURS.podstawowy), KTO.maliwan]);
  // ucieczka ze ścieżki
  const e4 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, sciezka, dodal_id)
     values ($1,'pdf',$2,$3) returning id`,
    [KURS.mistrzowski, `kurs/${KURS.mistrzowski}/../../etc/passwd`, KTO.maliwan]);
  sprawdz(6, 'Ścieżka pliku musi wskazywać dokładnie ten sam kurs co rekord materiału',
    e1.ok && !e2.ok && !e3.ok && !e4.ok,
    `poprawna: ${e1.ok ? 'przyjęta' : 'ODRZUCONA — źle'} · bez UUID: ${e2.ok ? 'PRZESZŁA — źle' : 'odrzucona'} · ` +
    `cudzy kurs: ${e3.ok ? 'PRZESZŁA — źle' : 'odrzucona'} · ".." w ścieżce: ${e4.ok ? 'PRZESZŁA — źle' : 'odrzucona'}`);

  /* ── 7. Instruktor tylko do swojego kursu ───────────────────── */
  await db.query(`update public.kurs set instruktor_id=null where id=$1`, [KURS.profesjonalny]);
  const f1 = await jako(KTO.maliwan,
    `insert into public.material (kurs_id, typ, sciezka, dodal_id)
     values ($1,'pdf',$2,$3) returning id`,
    [KURS.profesjonalny, sc(KURS.profesjonalny), KTO.maliwan]);
  await db.query(`update public.kurs set instruktor_id=$2 where id=$1`,
    [KURS.profesjonalny, KTO.maliwan]);
  sprawdz(7, 'Instruktor nie doda materiału do kursu, którego nie prowadzi',
    !f1.ok, f1.ok ? 'DODANY — ŹLE' : 'odrzucony');

  /* ── 8. Publikacja odsłania materiał ────────────────────────── */
  const sciezkaNowa = sc(KURS.podstawowy);
  const { rows:[nowy] } = await db.query(
    `insert into public.material (kurs_id, typ, sciezka, opublikowany, dodal_id)
     values ($1,'pdf',$2,false,$3) returning id`,
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
     values (public.uid(),$1,'zrobione') returning id`, [em.id]);
  const h5 = await jako(KTO.ania, `update public.postep set etap_id=$1
     where kursant_id=public.uid() returning id`, [em.id]);
  const h6 = await jako(KTO.maliwan, `select count(*)::int n from public.postep where etap_id=$1`, [ep.id]);
  await db.query(`delete from public.postep where kursant_id=$1`, [KTO.ania]);
  sprawdz(9, 'Postęp jest prywatny i nie da się go przepiąć do etapu innego kursu',
    n(h1) === 1 && n(h2) === 0 && !h3.ok && !h4.ok && !h5.ok && n(h6) === 1,
    `swoje: ${n(h1)} · cudze: ${n(h2)} · podszycie: ${h3.ok?'UDAŁO SIĘ — ŹLE':'odrzucone'} · ` +
    `wstawienie na cudzy etap: ${h4.ok?'PRZESZŁO — ŹLE':'odrzucone'} · ` +
    `przepięcie: ${h5.ok?'PRZESZŁO — ŹLE':'odrzucone'} · instruktor widzi: ${n(h6)}`);

  /* ── 10. Pytanie: etap musi należeć do kursu ────────────────── */
  const i1 = await jako(KTO.ania, `insert into public.pytanie (kursant_id, kurs_id, etap_id, tresc)
     values (public.uid(),$1,$2,'Test') returning id`, [KURS.podstawowy, em.id]);
  const i2 = await jako(KTO.ania, `insert into public.pytanie (kursant_id, kurs_id, etap_id, tresc)
     values (public.uid(),$1,$2,'Test poprawny') returning id`, [KURS.podstawowy, ep.id]);
  const i3 = await jako(KTO.ania, `insert into public.pytanie (kursant_id, kurs_id, tresc)
     values (public.uid(),$1,'Nie moj kurs') returning id`, [KURS.mistrzowski]);
  sprawdz(10, 'Pytanie: etap musi należeć do tego samego kursu, a kurs musi być własny',
    !i1.ok && i2.ok && !i3.ok,
    `etap z innego kursu: ${i1.ok?'PRZESZŁO — ŹLE':'odrzucone'} · poprawne: ` +
    `${i2.ok?'przyjęte':'ODRZUCONE — źle'} · cudzy kurs: ${i3.ok?'PRZESZŁO — ŹLE':'odrzucone'}`);

  /* ── 11. Instruktor zmienia w pytaniu tylko odpowiedź ───────── */
  const { rows:[pyt] } = await db.query(
    `insert into public.pytanie (kursant_id, kurs_id, tresc)
     values ($1,$2,'Pytanie oryginalne') returning id`, [KTO.ania, KURS.podstawowy]);
  const j1 = await jako(KTO.maliwan, `update public.pytanie
     set odpowiedz='Odpowiedź Maliwan', status='odpowiedziane', odpowiedzial_id=public.uid(),
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
    await k.query('set local role astera_api');
    await k.query(`select set_config('astera.uzytkownik', $1, true)`, [KTO.norbert]);
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

  /* ═══ ROLE PRZY ZAPRASZANIU — sedno drugiego audytu ══════════════
     Klucz `service_role` omija RLS, ale NIE jest zalogowanym adminem:
     `public.uid()` jest wtedy puste, więc wyzwalacz `chron_profil`
     cofał nadaną rolę. Poniższe testy odtwarzają obie drogi na
     PRAWDZIWEJ bazie — atrapa Supabase by tego nie wychwyciła,
     bo nie uruchamia wyzwalaczy.                                   */

  const nowyUzytkownik = async (email, imie) => {
    const r = await db.query(
      `insert into auth.users (email, raw_user_meta_data)
       values ($1, jsonb_build_object('imie', $2::text)) returning id`, [email, imie]);
    return r.rows[0].id;
  };
  const rolaKonta = async id =>
    (await db.query(`select rola from public.profile where id=$1`, [id])).rows[0]?.rola;

  /* ── 17. Zaproszenie instruktora kończy się profilem instruktor ── */
  const idInstruktora = await nowyUzytkownik('nowy.instruktor@przyklad.pl', 'Nowa Instruktorka');
  const rolaPoZalozeniu = await rolaKonta(idInstruktora);
  // tak robi teraz Edge Function: zapis w kontekście zalogowanego admina
  const nadanieI = await jakoTrwale(KTO.norbert,
    `update public.profile set rola='instruktor' where id=$1 returning rola`, [idInstruktora]);
  const rolaInstruktora = await rolaKonta(idInstruktora);
  sprawdz(17, 'Zaproszenie instruktora kończy się profilem „instruktor"',
    rolaPoZalozeniu === 'kursant' && nadanieI.ok && rolaInstruktora === 'instruktor',
    `po założeniu konta: ${rolaPoZalozeniu} → po nadaniu roli przez admina: ${rolaInstruktora}`);

  /* ── 18. Zaproszenie administratora kończy się profilem admin ─── */
  const idAdmina = await nowyUzytkownik('nowy.admin@przyklad.pl', 'Nowy Admin');
  await jakoTrwale(KTO.norbert,
    `update public.profile set rola='admin' where id=$1`, [idAdmina]);
  const rolaAdmina = await rolaKonta(idAdmina);

  // ta sama zmiana kluczem serwisowym — czyli BEZ public.uid() — musi się nie udać
  const idKontrolny = await nowyUzytkownik('kontrola.roli@przyklad.pl', 'Kontrola');
  await db.query(`update public.profile set rola='admin' where id=$1`, [idKontrolny]);
  const rolaBezTozsamosci = await rolaKonta(idKontrolny);

  sprawdz(18, 'Zaproszenie administratora kończy się profilem „admin"; bez tożsamości — nie',
    rolaAdmina === 'admin' && rolaBezTozsamosci === 'kursant',
    `przez admina: ${rolaAdmina} · bez public.uid() (klucz serwisowy / SQL Editor): ` +
    `${rolaBezTozsamosci} — po cichu cofnięte, dlatego istnieje ustanow_pierwszego_admina()`);

  /* ── 19. Pierwszy administrator zgodnie z instrukcją ───────────── */
  const gdyAdminIstnieje = await db.query(
    `select public.ustanow_pierwszego_admina('ania@przyklad.pl')`).then(() => 'PRZESZŁO')
    .catch(e => e.message.split('\n')[0]);

  await db.query('begin');
  // Od Etapu 1a przygotowanie stanu wymaga jawnej roli inicjalizacyjnej,
  // nie samej flagi. Po przygotowaniu wracamy do roli domyślnej, żeby
  // `ustanow_pierwszego_admina()` musiała poradzić sobie sama.
  await db.query('set local role astera_seed');
  await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
  await db.query(`update public.profile set rola='instruktor'
                   where rola='admin' and aktywne`);          // stan sprzed pierwszego admina
  await db.query(`select set_config('astera.inicjalizacja','nie',true)`);
  const bezAdmina = (await db.query(
    `select count(*)::int n from public.profile where rola='admin' and aktywne`)).rows[0].n;
  // Wywołanie zgodne z instrukcją: w roli inicjalizacyjnej, flagę
  // funkcja ustawia sobie sama.
  await db.query(`select public.ustanow_pierwszego_admina('ania@przyklad.pl')`);
  const poUstanowieniu = (await db.query(
    `select rola from public.profile where email='ania@przyklad.pl'`)).rows[0].rola;
  await db.query('rollback');

  sprawdz(19, 'Pierwszego administratora da się utworzyć zgodnie z instrukcją — i tylko raz',
    bezAdmina === 0 && poUstanowieniu === 'admin' &&
    /Administrator juz istnieje/i.test(gdyAdminIstnieje),
    `na czystym systemie: ${poUstanowieniu} · przy istniejącym adminie: „${gdyAdminIstnieje}"`);

  /* ── 20. Kursant nie użyje tej drogi do podniesienia sobie roli ── */
  const p1 = await jako(KTO.ania, `select public.ustanow_pierwszego_admina('ania@przyklad.pl')`);
  const p2 = await jako(KTO.ania,
    `update public.profile set rola='admin' where id = public.uid() returning rola`);
  // najtwardsza próba: kursant sam ustawia flagę inicjalizacji
  await db.query('begin');
  await db.query('set local role astera_api');
  await db.query(`select set_config('astera.uzytkownik', $1, true)`, [KTO.ania]);
  let p3;
  try {
    await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
    p3 = (await db.query(
      `update public.profile set rola='admin' where id = public.uid() returning rola`)).rows[0]?.rola;
  } catch (e) { p3 = 'odmowa: ' + e.message.split('\n')[0]; }
  await db.query('rollback');

  sprawdz(20, 'Kursant nie podniesie sobie roli — ani funkcją, ani flagą inicjalizacji',
    !p1.ok && (p2.rows?.[0]?.rola ?? 'kursant') === 'kursant' && p3 !== 'admin',
    `funkcja: ${p1.ok ? 'DOSTĘPNA — ŹLE' : 'brak uprawnień'} · zwykła zmiana: ` +
    `${p2.rows?.[0]?.rola ?? '—'} · z własnoręczną flagą: ${p3}`);

  /* ── 21. Instruktor nie podpisze odpowiedzi cudzym nazwiskiem ──── */
  // Przygotowanie stanu, tak samo jak w teście 9: pytania tworzone
  // w `jako()` znikają wraz z rollbackiem, a dane startowe żadnego nie
  // zawierają. Bez tego test nie miałby czego sprawdzić i zgłaszał
  // „brak pytania" zamiast wyniku.
  await db.query(`delete from public.pytanie where tresc = 'Pytanie kontrolne do testu 21'`);
  await db.query(
    `insert into public.pytanie (kursant_id, kurs_id, tresc)
     values ($1, $2, 'Pytanie kontrolne do testu 21')`, [KTO.ania, KURS.podstawowy]);
  const [pytanieDoTestu] = (await jako(KTO.norbert,
    `select id from public.pytanie where kurs_id=$1 limit 1`, [KURS.podstawowy])).rows || [];
  const podszycie = pytanieDoTestu ? await jako(KTO.maliwan,
    `update public.pytanie
        set odpowiedz = 'Odpowiedź testowa',
            odpowiedzial_id = $2,
            odpowiedziano = timestamptz '2000-01-01'
      where id = $1
      returning odpowiedzial_id, odpowiedziano`, [pytanieDoTestu.id, KTO.norbert]) : { ok:false };
  const w21 = podszycie.rows?.[0];
  sprawdz(21, 'Autora i czas odpowiedzi stempluje baza — nie da się podpisać cudzym nazwiskiem',
    !!w21 && w21.odpowiedzial_id === KTO.maliwan &&
    new Date(w21.odpowiedziano).getFullYear() > 2020,
    w21 ? `podała Norberta i rok 2000, baza zapisała: ${w21.odpowiedzial_id === KTO.maliwan
      ? 'Maliwan' : w21.odpowiedzial_id}, ${new Date(w21.odpowiedziano).getFullYear()}`
        : 'brak pytania do sprawdzenia');

  /* ── 23. Wersja: dozwolone tylko przejścia z maszyny stanów ───── */
  {
    const etap = (await db.query(
      `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
        where l.kurs_id=$1 limit 1`, [KURS.podstawowy])).rows[0];

    await db.query(`delete from public.etap_wersja where komentarz = 'test 23'`);
    const { rows:[w] } = await db.query(
      `insert into public.etap_wersja (etap_id, numer, status, autor_id, komentarz)
       values ($1, 900, 'draft', $2, 'test 23') returning id`, [etap.id, KTO.maliwan]);

    const przejscie = async docelowy => {
      try {
        await db.query('begin');
        const rozstrzygniety = ['zatwierdzone','zastapione'].includes(docelowy);
        await db.query(
          `update public.etap_wersja
              set status = $2::public.status_wersji,
                  zatwierdzil_id = $3::uuid,
                  zatwierdzone_o = case when $3::uuid is null then null else now() end
            where id = $1`,
          [w.id, docelowy, rozstrzygniety ? KTO.norbert : null]);
        await db.query('rollback');
        return 'przeszło';
      } catch (e) { await db.query('rollback'); return 'odrzucone'; }
    };

    const doZmiany  = await przejscie('do_zmiany');     // draft → do_zmiany : wolno
    const zastapione= await przejscie('zastapione');    // draft → zastapione : nie wolno
    await db.query(`delete from public.etap_wersja where id=$1`, [w.id]);

    sprawdz(23, 'Wersja przechodzi tylko po dozwolonych ścieżkach maszyny stanów',
      doZmiany === 'przeszło' && zastapione === 'odrzucone',
      `draft→do_zmiany: ${doZmiany} · draft→zastapione: ${zastapione}`);
  }

  /* ── 24. Tylko JEDNA zatwierdzona wersja na etap ──────────────── */
  {
    const etap = (await db.query(
      `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
        where l.kurs_id=$1 limit 1`, [KURS.podstawowy])).rows[0];
    let druga;
    try {
      await db.query('begin');
      await db.query(
        `insert into public.etap_wersja (etap_id, numer, status, autor_id,
                                         zatwierdzil_id, zatwierdzone_o, komentarz)
         values ($1, 901, 'zatwierdzone', $2, $3, now(), 'test 24')`,
        [etap.id, KTO.maliwan, KTO.norbert]);
      await db.query('rollback');
      druga = 'PRZESZŁA — ŹLE';
    } catch (e) { await db.query('rollback'); druga = 'odrzucona'; }

    const ile = (await db.query(
      `select count(*)::int n from public.etap_wersja
        where etap_id=$1 and status='zatwierdzone'`, [etap.id])).rows[0].n;

    sprawdz(24, 'Etap ma dokładnie jedną zatwierdzoną wersję — drugiej baza nie przyjmie',
      druga === 'odrzucona' && ile === 1,
      `druga zatwierdzona: ${druga} · zatwierdzonych w bazie: ${ile}`);
  }

  /* ── 25. Kursant nie widzi wersji niezatwierdzonych ───────────── */
  {
    const etap = (await db.query(
      `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
        where l.kurs_id=$1 limit 1`, [KURS.podstawowy])).rows[0];

    await db.query(`delete from public.etap_wersja where komentarz = 'test 25'`);
    await db.query(
      `insert into public.etap_wersja (etap_id, numer, status, autor_id, komentarz)
       values ($1, 902, 'draft', $2, 'test 25')`, [etap.id, KTO.maliwan]);

    const kursant    = await jako(KTO.ania,    `select count(*)::int n from public.etap_wersja where etap_id=$1`, [etap.id]);
    const instruktor = await jako(KTO.maliwan, `select count(*)::int n from public.etap_wersja where etap_id=$1`, [etap.id]);
    const drafty     = await jako(KTO.ania,    `select count(*)::int n from public.etap_wersja where etap_id=$1 and status='draft'`, [etap.id]);

    await db.query(`delete from public.etap_wersja where komentarz = 'test 25'`);

    sprawdz(25, 'Kursant widzi wyłącznie wersje zatwierdzone — draftów Maliwan nie zobaczy',
      n(kursant) === 1 && n(instruktor) === 2 && n(drafty) === 0,
      `kursant widzi: ${n(kursant)} (z ${n(instruktor)}, które widzi instruktorka) · draftów u kursanta: ${n(drafty)}`);
  }

  /* ── 26. Technika w dwóch etapach — jedna, bez kopiowania ─────── */
  {
    await db.query(`delete from public.technika where kod = 'test-26'`);
    const { rows:[tech] } = await db.query(
      `insert into public.technika (kod) values ('test-26') returning id`);
    const etapy = (await db.query(
      `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
        where l.kurs_id=$1 order by e.kolejnosc limit 2`, [KURS.podstawowy])).rows;

    for (const e of etapy)
      await db.query(`insert into public.etap_technika (etap_id, technika_id) values ($1,$2)`,
        [e.id, tech.id]);

    const ileTechnik = (await db.query(
      `select count(*)::int n from public.technika where kod='test-26'`)).rows[0].n;
    const ilePowiazan = (await db.query(
      `select count(*)::int n from public.etap_technika where technika_id=$1`, [tech.id])).rows[0].n;

    // skasowanie etapu NIE MOŻE zabrać techniki używanej gdzie indziej
    let kasowanie;
    try {
      await db.query('begin');
      await db.query(`delete from public.etap where id=$1`, [etapy[0].id]);
      const zostala = (await db.query(
        `select count(*)::int n from public.technika where id=$1`, [tech.id])).rows[0].n;
      await db.query('rollback');
      kasowanie = zostala === 1 ? 'technika przetrwała' : 'TECHNIKA ZNIKNĘŁA — ŹLE';
    } catch (e) { await db.query('rollback'); kasowanie = 'technika przetrwała'; }

    await db.query(`delete from public.etap_technika where technika_id=$1`, [tech.id]);
    await db.query(`delete from public.technika where id=$1`, [tech.id]);

    sprawdz(26, 'Jedna technika w wielu etapach — bez kopiowania i bez utraty przy kasowaniu etapu',
      ileTechnik === 1 && ilePowiazan === 2 && kasowanie === 'technika przetrwała',
      `technik w bazie: ${ileTechnik} · powiązań z etapami: ${ilePowiazan} · po usunięciu etapu: ${kasowanie}`);
  }

  /* ── 27. Głosówka: klucz S3 musi wskazywać swoją encję ────────── */
  {
    await db.query(`delete from public.technika where kod in ('test-27a','test-27b')`);
    const { rows:[ta] } = await db.query(`insert into public.technika (kod) values ('test-27a') returning id`);
    const { rows:[tb] } = await db.query(`insert into public.technika (kod) values ('test-27b') returning id`);

    const wstaw = async (technika, klucz, etap = null) => {
      try {
        await db.query('begin');
        await db.query(
          `insert into public.glosowka (technika_id, etap_id, jezyk_zrodlowy, klucz_s3, nagral_id)
           values ($1,$2,'th',$3,$4)`, [technika, etap, klucz, KTO.maliwan]);
        await db.query('rollback');
        return 'przyjęte';
      } catch (e) { await db.query('rollback'); return 'odrzucone'; }
    };

    const dobry  = await wstaw(ta.id, `glosowka/technika/${ta.id}/${Date.now()}.m4a`);
    const cudzy  = await wstaw(ta.id, `glosowka/technika/${tb.id}/${Date.now()}.m4a`);
    const bezSensu = await wstaw(ta.id, 'glosowka/technika/x/plik.m4a');
    const oba   = await wstaw(ta.id, `glosowka/technika/${ta.id}/${Date.now()}.m4a`,
                              (await db.query(`select id from public.etap limit 1`)).rows[0].id);

    await db.query(`delete from public.technika where kod in ('test-27a','test-27b')`);

    sprawdz(27, 'Głosówka: klucz S3 musi wskazywać jej encję, i tylko jedną — technikę albo etap',
      dobry === 'przyjęte' && cudzy === 'odrzucone' &&
      bezSensu === 'odrzucone' && oba === 'odrzucone',
      `własny klucz: ${dobry} · klucz cudzej techniki: ${cudzy} · klucz bez UUID: ${bezSensu} · ` +
      `technika i etap naraz: ${oba}`);
  }

  /* ── 22. Tożsamość nie wycieka między równoległymi transakcjami ──
     To jest test warunku bezpieczeństwa Etapu 0. Sprawdza trzy rzeczy:

       A. Przy współdzielonej puli połączeń każda transakcja widzi
          WYŁĄCZNIE dane swojego użytkownika — mimo że fizycznych
          połączeń jest kilkakrotnie mniej niż żądań.
       B. Żądanie BEZ ustawionej tożsamości widzi zero wierszy,
          a nie dane poprzedniego użytkownika tego połączenia.
       C. Test ma moc wykrywczą: ten sam scenariusz z ustawieniem
          SESYJNYM (`set_config(..., false)`) tożsamość ZOSTAWIA —
          gdyby ten podtest wyszedł „czysto", znaczyłoby to, że test
          nie potrafi wykryć błędu i jest bezwartościowy.            */
  {
    const { Pool } = require('pg');
    const POLACZEN = 3, ZADAN = 30;
    const pula = new Pool({ ...DB, max: POLACZEN });

    // Kto ile kursów widzi — wartości oczekiwane, policzone raz.
    const oczekiwane = {};
    for (const [imie, uid] of Object.entries(KTO)) {
      const r = await jako(uid, `select count(*)::int n from public.kurs`);
      oczekiwane[uid] = n(r);
    }

    async function zadanie(uid) {
      const k = await pula.connect();
      try {
        await k.query('begin');
        await k.query('set local role astera_api');
        if (uid) await k.query(`select set_config('astera.uzytkownik', $1, true)`, [uid]);
        // odrobina losowego opóźnienia, żeby transakcje faktycznie się przeplatały
        await k.query('select pg_sleep($1)', [Math.random() * 0.05]);
        const r = await k.query(`select count(*)::int n, public.uid()::text u from public.kurs`);
        await k.query('commit');
        return { uid, widzi: r.rows[0].n, tozsamosc: r.rows[0].u };
      } catch (e) {
        await k.query('rollback').catch(() => {});
        return { uid, blad: e.message.split('\n')[0] };
      } finally {
        k.release();
      }
    }

    const uidy = Object.values(KTO);
    const plan = Array.from({ length: ZADAN }, (_, i) =>
      i % 6 === 5 ? null : uidy[i % uidy.length]);      // co szóste bez tożsamości
    const wynikiA = await Promise.all(plan.map(zadanie));

    const zTozsamoscia = wynikiA.filter(w => w.uid);
    const bezTozsamosci = wynikiA.filter(w => !w.uid);

    const aOk = zTozsamoscia.every(w =>
      !w.blad && w.tozsamosc === w.uid && w.widzi === oczekiwane[w.uid]);
    const bOk = bezTozsamosci.every(w =>
      !w.blad && w.tozsamosc === null && w.widzi === 0);

    // C — kontrola mocy wykrywczej: ustawienie SESYJNE na jednym połączeniu
    const pula1 = new Pool({ ...DB, max: 1 });
    const k1 = await pula1.connect();
    await k1.query(`select set_config('astera.uzytkownik', $1, false)`, [KTO.norbert]);
    k1.release();
    const k2 = await pula1.connect();
    const zostalo = (await k2.query(`select public.uid()::text u`)).rows[0].u;
    k2.release();
    await pula1.end();
    const cOk = zostalo === KTO.norbert;   // MA zostać — inaczej test nic nie wykrywa

    await pula.end();

    sprawdz(22, 'Tożsamość nie wycieka między transakcjami przez wspólną pulę połączeń',
      aOk && bOk && cOk,
      `${ZADAN} żądań przez ${POLACZEN} połączenia · z tożsamością: ${zTozsamoscia.length} ` +
      `(${aOk ? 'każde widzi tylko swoje' : 'WYCIEK — ŹLE'}) · bez tożsamości: ` +
      `${bezTozsamosci.length} (${bOk ? 'zero wierszy' : 'WIDZĄ DANE — ŹLE'}) · ` +
      `kontrola: ustawienie sesyjne ${cOk ? 'zostaje na połączeniu (test ma moc wykrywczą)'
        : 'NIE ZOSTAJE — test niczego nie sprawdza'}`);
  }

  /* ── 28. Tryb inicjalizacji wymaga jawnej roli, nie braku tożsamości ──

     Do Etapu 1a `kontekst_inicjalizacji()` opierał się na liście
     wykluczonych ról i na warunku `public.uid() is null`. Zasada była
     zła w obie strony: lista wykluczeń przepuszcza każdą rolę, której
     nikt na nią nie wpisał, a brak tożsamości ma znaczyć „nikt", a nie
     „tryb uprzywilejowany".

     Teraz inicjalizacja to koniunkcja dwóch świadomych kroków — flagi
     transakcyjnej i roli `astera_seed` — i ten test pilnuje trzech
     rzeczy naraz.                                            [Etap 1a] */
  {
    // ── A. Brak tożsamości sam z siebie nie daje NIC ──────────────
    //  Połączenie właściciela bazy, bez SET ROLE i bez public.uid().
    //  Dokładnie ten stan, który dawniej BYŁ kontekstem inicjalizacji.
    await db.query('begin');
    await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
    const kontekstBezRoli = (await db.query(
      `select public.kontekst_inicjalizacji() k`)).rows[0].k;
    await db.query('rollback');

    const idProby = await nowyUzytkownik('proba.seed@przyklad.pl', 'Próba Seed');
    await db.query('begin');
    await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
    await db.query(`update public.profile set rola='admin' where id=$1`, [idProby]);
    await db.query('commit');
    const poProbieBezRoli = await rolaKonta(idProby);

    const aOk = kontekstBezRoli === false && poProbieBezRoli === 'kursant';

    // ── B. `astera_api` nie wejdzie w tę ścieżkę żadnym sposobem ──
    //  B1: rola aplikacyjna nie jest członkiem roli inicjalizacyjnej.
    //
    //  UWAGA NA POZORNY TEST. Pierwsza wersja próbowała po prostu
    //  `set local role astera_api; set local role astera_seed;`
    //  — i PRZESZŁA, co wyglądało na dziurę, a było wadą testu:
    //  PostgreSQL sprawdza prawo do SET ROLE względem UŻYTKOWNIKA
    //  SESJI, a testy łączą się jako właściciel bazy. Lokalnie takim
    //  wywołaniem nie da się udowodnić niczego.
    //
    //  Tym, co naprawdę chroni produkcję — gdzie Core łączy się JAKO
    //  `astera_api` — jest graf członkostwa ról. I to sprawdzamy.
    const { rows: czlonkostwa } = await db.query(`
      select r.rolname,
             pg_has_role(r.rolname, 'astera_seed', 'member') jest
        from pg_roles r
       where r.rolname in ('astera_api','authenticated','anon')`);
    const wejscieWRole = czlonkostwa.every(r => r.jest === false)
      ? 'brak członkostwa (' + czlonkostwa.map(r => r.rolname).join(', ') + ')'
      : 'MA CZŁONKOSTWO — ŹLE: ' +
        czlonkostwa.filter(r => r.jest).map(r => r.rolname).join(', ');

    //  B2: własnoręczna flaga nie daje mu kontekstu inicjalizacji
    //      ani nie odblokowuje zmiany roli.
    await db.query('begin');
    await db.query('set local role astera_api');
    await db.query(`select set_config('astera.uzytkownik', $1, true)`, [KTO.ania]);
    await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
    const rolaPoFladze = (await db.query(
      `update public.profile set rola='admin' where id = public.uid() returning rola`
    )).rows[0]?.rola ?? 'brak wiersza';
    await db.query('rollback');

    //  B3: sama ścieżka inicjalizacyjna jest dla niego zamknięta —
    //      nie wywoła ani funkcji pierwszego admina, ani funkcji
    //      rozstrzygającej o kontekście.
    const drogaFunkcja = await jako(KTO.norbert,
      `select public.ustanow_pierwszego_admina('ania@przyklad.pl')`);
    const drogaKontekst = await jako(KTO.norbert,
      `select public.kontekst_inicjalizacji()`);

    //  B4: flaga nie otwiera furtki na ostatniego administratora.
    //      Stan doprowadzamy do jednego admina W TEJ SAMEJ transakcji,
    //      żeby test nie zależał od kolejności wcześniejszych prób —
    //      pierwsza wersja tego nie robiła i „przechodziła" tylko
    //      dlatego, że test 18 zostawiał w bazie drugiego admina.
    let ostatniAdmin;
    await db.query('begin');
    try {
      await db.query('set local role astera_seed');
      await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
      await db.query(`update public.profile set rola='instruktor'
                       where rola='admin' and aktywne and id <> $1`, [KTO.norbert]);
      await db.query(`select set_config('astera.inicjalizacja','nie',true)`);
      await db.query('set local role astera_api');
      await db.query(`select set_config('astera.uzytkownik', $1, true)`, [KTO.norbert]);
      await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
      await db.query(`update public.profile set rola='instruktor' where id = public.uid()`);
      ostatniAdmin = 'PRZESZŁO — ŹLE';
    } catch (e) { ostatniAdmin = 'zablokowane'; }
    await db.query('rollback');

    const bOk = !/ŹLE/.test(wejscieWRole)
             && rolaPoFladze !== 'admin'
             && !drogaFunkcja.ok && !drogaKontekst.ok
             && ostatniAdmin === 'zablokowane';

    // ── C. Prawidłowa, kontrolowana inicjalizacja nadal działa ────
    await db.query('begin');
    await db.query('set local role astera_seed');
    await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
    const kontekstZRola = (await db.query(
      `select public.kontekst_inicjalizacji() k`)).rows[0].k;
    await db.query(`update public.profile set rola='instruktor' where id=$1`, [idProby]);
    await db.query('commit');
    const poPrawidlowymSeedzie = await rolaKonta(idProby);

    const cOk = kontekstZRola === true && poPrawidlowymSeedzie === 'instruktor';

    sprawdz(28, 'Inicjalizacja wymaga jawnej roli `astera_seed` — brak tożsamości nią nie jest',
      aOk && bOk && cOk,
      `bez roli (sama flaga): kontekst=${kontekstBezRoli}, rola konta=${poProbieBezRoli} · ` +
      `astera_seed: ${wejscieWRole} · z własną flagą: ${rolaPoFladze} · ` +
      `ustanow_pierwszego_admina: ${drogaFunkcja.ok ? 'DOSTĘPNA — ŹLE' : 'brak uprawnień'} · ` +
      `kontekst_inicjalizacji: ${drogaKontekst.ok ? 'DOSTĘPNA — ŹLE' : 'brak uprawnień'} · ` +
      `ostatni admin: ${ostatniAdmin} · ` +
      `kontrolowany seed: kontekst=${kontekstZRola}, rola konta=${poPrawidlowymSeedzie}`);

    await db.query(`delete from auth.users where email = 'proba.seed@przyklad.pl'`);
  }

  /* ── 29. Instruktorka MOŻE redagować własny draft ──────────────────

     Test istnieje, bo zabezpieczenie z testu 28 miało skutek uboczny,
     którego nie wykryła żadna dotychczasowa próba: wyzwalacz broniący
     treści zatwierdzonych sięgał po `kontekst_inicjalizacji()` prawami
     WYWOŁUJĄCEGO, a rola aplikacyjna prawa do tej funkcji nie ma
     i mieć nie powinna. Maliwan dostawała „permission denied" zamiast
     zapisu — cała ścieżka redagowania była martwa.

     Żaden test tego nie łapał, bo wszystkie CZYTAŁY tabele `*_tekst`.
     Ten jako pierwszy do nich PISZE.                          [Etap 1a] */
  {
    const WERSJA = '99999999-0000-0000-0000-000000000029';

    // Etap kursu podstawowego (prowadzi go Maliwan) wraz z jego wersją
    // ZATWIERDZONĄ, która przyszła z importu arkusza.
    const { rows: [cel] } = await db.query(
      `select w.id zatwierdzona, w.etap_id
         from public.etap_wersja w
         join public.etap e   on e.id = w.etap_id
         join public.lekcja l on l.id = e.lekcja_id
        where l.kurs_id = $1 and w.status = 'zatwierdzone' limit 1`,
      [KURS.podstawowy]);

    // Obok niej — draft. Reguła „jedna zatwierdzona na etap" dotyczy
    // wyłącznie statusu 'zatwierdzone', więc draft ma prawo tu być.
    await db.query('begin');
    await db.query('set local role astera_seed');
    await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
    await db.query(
      `insert into public.etap_wersja (id, etap_id, numer, status, autor_id)
       values ($1, $2, 29, 'draft', $3)`, [WERSJA, cel.etap_id, KTO.maliwan]);
    await db.query('commit');

    // zapis draftu przez Core, w roli aplikacyjnej i z tożsamością Maliwan
    const zapis = await jako(KTO.maliwan,
      `insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel)
       values ($1,'pl','Poprawka Maliwan','cel próbny') returning nazwa`,
      [WERSJA]);

    // dla kontrastu: treść wersji ZATWIERDZONEJ ma pozostać zamknięta
    const zamkniete = await jako(KTO.maliwan,
      `update public.etap_tekst set nazwa = 'Podmiana bez nowej wersji'
        where etap_wersja_id = $1 and jezyk = 'pl'`, [cel.zatwierdzona]);

    await db.query(`delete from public.etap_wersja where id=$1`, [WERSJA]);

    sprawdz(29, 'Instruktorka redaguje własny draft przez Core — a wersji zatwierdzonej już nie',
      zapis.ok && !zamkniete.ok && /zamkni/i.test(zamkniete.blad || ''),
      `draft: ${zapis.ok ? 'zapisany' : 'ODMOWA — ' + zapis.blad} · ` +
      `zatwierdzona: ${zamkniete.ok ? 'ZAPISANA — ŹLE' : zamkniete.blad}`);
  }

  /* sprzątanie po testach 17–18 i 21 */
  await db.query(`delete from auth.users where email in
    ('nowy.instruktor@przyklad.pl','nowy.admin@przyklad.pl','kontrola.roli@przyklad.pl')`);
  await db.query(`delete from public.pytanie where tresc = 'Pytanie kontrolne do testu 21'`);

  const zdane = wyniki.filter(w => w.zdal).length;
  console.log(`\n═══ BAZA: ${zdane} / ${wyniki.length} ═══`);
  if (zdane < wyniki.length) {
    console.log('\nNIEZDANE:');
    wyniki.filter(w => !w.zdal).forEach(w => console.log(`  ${w.nr}. ${w.opis}`));
  }
  await db.end();
  process.exit(zdane === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.message); process.exit(2); });
