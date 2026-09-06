#!/usr/bin/env node
/**
 * AsterA Coach — pierwszy warunek bezpieczeństwa Etapu 1b, NA ŻYWO
 *
 * Test 28 lokalny nie mógł tego udowodnić: łączył się jako właściciel
 * bazy i wchodził w `astera_api` przez SET ROLE, a PostgreSQL sprawdza
 * prawo do SET ROLE względem UŻYTKOWNIKA SESJI. Tutaj sesja NALEŻY do
 * `astera_api` — prawdziwy login, prawdziwe hasło z Secrets Manager,
 * prawdziwa Aurora. Dopiero to jest dowód.
 *
 *   DATABASE_URL_API  — adres z loginem astera_api (narzedzia/aurora-url.sh api)
 *   DATABASE_URL      — adres właściciela, tylko do przygotowania i sprzątania
 */
const { Client } = require('pg');
const fs = require('fs');

const CA  = process.env.PGSSLROOTCERT;
const ssl = CA ? { ca: fs.readFileSync(CA, 'utf8'), rejectUnauthorized: true }
               : { rejectUnauthorized: false };
const bez = u => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };

const API   = { connectionString: bez(process.env.DATABASE_URL_API), ssl };
const OWNER = { connectionString: bez(process.env.DATABASE_URL), ssl };
const ANIA  = '33333333-3333-3333-3333-333333333333';

let wyniki = [];
function sprawdz(nr, opis, ok, szczegol) {
  wyniki.push(ok);
  console.log(`${ok ? '  ZDANY ' : '  BŁĄD  '} ${nr}. ${opis}`);
  if (szczegol) console.log(`          ${szczegol}`);
}
// Każda próba w SAVEPOINT: odmowa jednej nie może unieważnić kolejnych
// (pierwsza wersja testu miała tę wadę — „odmowa" w części C była
// skutkiem przerwanej transakcji, nie ochrony profilu).
const proba = async (c, sql, p = []) => {
  await c.query('savepoint proba');
  try { const r = await c.query(sql, p); await c.query('release savepoint proba');
        return { ok: true, rows: r.rows }; }
  catch (e) { await c.query('rollback to savepoint proba');
        return { ok: false, blad: e.message.split('\n')[0] }; }
};

(async () => {
  const api = new Client(API); await api.connect();
  const owner = new Client(OWNER); await owner.connect();
  console.log('\n═══ ROLA APLIKACYJNA NA ŻYWO — AURORA ═══');
  const kto = (await api.query('select current_user u, session_user s')).rows[0];
  console.log(`sesja: current_user=${kto.u} session_user=${kto.s}\n`);

  /* 1. Sesja naprawdę należy do astera_api, nie do właściciela */
  sprawdz('A', 'Połączenie jest sesją `astera_api` — nie SET ROLE z konta właściciela',
    kto.u === 'astera_api' && kto.s === 'astera_api', `session_user=${kto.s}`);

  /* 2. SET ROLE astera_seed — prawdziwa próba, prawdziwa odmowa */
  await api.query('begin');
  const r1 = await proba(api, 'set local role astera_seed');
  await api.query('rollback');
  sprawdz('B', '`astera_api` NIE może wykonać SET ROLE astera_seed',
    !r1.ok && /permission denied/i.test(r1.blad), r1.ok ? 'WESZŁO — ŹLE' : r1.blad);

  /* 3. Sama flaga nie daje nic: kontekst, zmiana roli, wersje zatwierdzone */
  await api.query('begin');
  await api.query(`select set_config('astera.uzytkownik',$1,true)`, [ANIA]);
  await api.query(`select set_config('astera.inicjalizacja','tak',true)`);
  const r2 = await proba(api, 'select public.kontekst_inicjalizacji()');
  const r3 = await proba(api,
    `update public.profile set rola='admin' where id=public.uid() returning rola`);
  const r4 = await proba(api, `select public.ustanow_pierwszego_admina('ania@przyklad.pl')`);
  await api.query('rollback');
  const rolaPo = r3.ok ? (r3.rows[0]?.rola ?? 'brak wiersza') : 'odmowa';
  sprawdz('C', 'Flaga `astera.inicjalizacja=tak` nie daje `astera_api` żadnych dodatkowych uprawnień',
    !r2.ok && rolaPo !== 'admin' && !r4.ok,
    `kontekst_inicjalizacji: ${r2.ok ? 'DOSTĘPNA — ŹLE' : 'brak uprawnień'} · ` +
    `rola po próbie: ${rolaPo} · ustanow_pierwszego_admina: ${r4.ok ? 'DOSTĘPNA — ŹLE' : 'brak uprawnień'}`);

  /* 4. astera_seed osiągalna wyłącznie przez kontrolowaną rolę */
  const { rows: cz } = await owner.query(`
    select r.rolname, pg_has_role(r.rolname,'astera_seed','member') jest
      from pg_roles r where r.rolname in ('astera_api','authenticated','anon','postgres')
     order by 1`);
  const zle = cz.filter(x => x.jest && x.rolname !== 'postgres').map(x => x.rolname);
  const wl  = cz.find(x => x.rolname === 'postgres')?.jest;
  const seed = (await owner.query(`select rolcanlogin, rolbypassrls, rolsuper
    from pg_roles where rolname='astera_seed'`)).rows[0];
  sprawdz('D', '`astera_seed`: NOLOGIN, członkiem jest wyłącznie rola migracyjna (właściciel)',
    zle.length === 0 && wl === true && seed.rolcanlogin === false && seed.rolsuper === false,
    `członkowie spoza właściciela: ${zle.length ? zle.join(',') + ' — ŹLE' : 'brak'} · ` +
    `właściciel: ${wl} · login: ${seed.rolcanlogin} · bypassrls: ${seed.rolbypassrls}`);

  /* 5. Kontrola: tożsamość transakcyjna działa jako prawdziwy login (bez SET ROLE) */
  await api.query('begin');
  await api.query(`select set_config('astera.uzytkownik',$1,true)`, [ANIA]);
  const r5 = await api.query(`select count(*)::int n from public.kurs`);
  await api.query('rollback');
  const r6 = await api.query(`select count(*)::int n from public.kurs`);   // bez tożsamości
  sprawdz('E', 'RLS działa na prawdziwym loginie: Ania widzi swój kurs, bez tożsamości — nic',
    r5.rows[0].n === 1 && r6.rows[0].n === 0, `z tożsamością: ${r5.rows[0].n} · bez: ${r6.rows[0].n}`);

  await api.end(); await owner.end();
  const zd = wyniki.filter(Boolean).length;
  console.log(`\n═══ ROLA API NA ŻYWO: ${zd} / ${wyniki.length} ═══`);
  process.exit(zd === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.message); process.exit(2); });
