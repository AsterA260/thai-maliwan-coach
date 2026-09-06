#!/usr/bin/env node
/**
 * AsterA Coach — test 22 PRZEZ RDS PROXY + obciążenie do pomiaru pinningu
 *
 * Test 22 lokalny udowodnił, że tożsamość transakcyjna nie wycieka przez
 * wspólną pulę w JEDNYM procesie. RDS Proxy dokłada drugą warstwę
 * współdzielenia: wiele klientów na mniejszej liczbie połączeń do bazy.
 * Pytanie Etapu 1b brzmi: czy przez tę warstwę tożsamość też nie
 * przecieka — i ile to kosztuje w pinningu.
 *
 *   DATABASE_URL_API  — login astera_api przez RDS Proxy
 *   WZORZEC           — set_config (docelowy Core) | set_role (jak testy)
 *   SEKUNDY           — długość obciążenia (domyślnie 150)
 *   KLIENTOW          — równoległych klientów (domyślnie 20)
 */
const { Pool } = require('pg');
const fs = require('fs');

const CA  = process.env.PGSSLROOTCERT;
const ssl = CA ? { ca: fs.readFileSync(CA, 'utf8'), rejectUnauthorized: true }
               : { rejectUnauthorized: false };
const bez = u => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };
const DB  = { connectionString: bez(process.env.DATABASE_URL_API), ssl };

const KTO = {
  norbert: '11111111-1111-1111-1111-111111111111',
  maliwan: '22222222-2222-2222-2222-222222222222',
  ania:    '33333333-3333-3333-3333-333333333333',
  piotr:   '44444444-4444-4444-4444-444444444444',
  obcy:    '55555555-5555-5555-5555-555555555555',
};
const WZORZEC  = process.env.WZORZEC || 'set_config';
const SEKUNDY  = Number(process.env.SEKUNDY || 150);
const KLIENTOW = Number(process.env.KLIENTOW || 20);
const PAUZA_MS = Number(process.env.PAUZA_MS || 0);   // cisza między transakcjami — tu widać multipleksowanie
// WZORZEC=nic — kontrola: zwykłe zapytania bez parametrów i bez set_config.
// Jeśli i to jest przypinane, przyczyną nie jest nasz wzorzec tożsamości.

async function wTransakcji(pula, uid, praca) {
  const k = await pula.connect();
  try {
    await k.query('begin');
    if (WZORZEC === 'set_role') await k.query('set local role astera_api');
    if (uid && WZORZEC !== 'nic') await k.query(`select set_config('astera.uzytkownik',$1,true)`, [uid]);
    const w = await praca(k);
    await k.query('commit');
    return w;
  } catch (e) { await k.query('rollback').catch(() => {}); throw e; }
  finally { k.release(); }
}

(async () => {
  console.log(`\n═══ TEST 22 PRZEZ RDS PROXY · wzorzec: ${WZORZEC} ═══`);
  const pula = new Pool({ ...DB, max: 3 });
  const kto = (await pula.query('select current_user u, session_user s')).rows[0];
  console.log(`sesja: current_user=${kto.u} session_user=${kto.s}`);

  /* A+B — 30 żądań przez 3 połączenia, każde widzi tylko swoje */
  const osoby = [KTO.norbert, KTO.maliwan, KTO.ania, KTO.piotr, KTO.obcy];
  const zadania = [];
  for (let i = 0; i < 30; i++) {
    const uid = i % 6 === 5 ? null : osoby[i % 5];
    zadania.push(wTransakcji(pula, uid, async k => {
      const r = await k.query(`select public.uid()::text u, count(*)::int n from public.profile
                               where id = public.uid() group by 1`);
      return { uid, widzi: r.rows[0]?.u ?? null, n: r.rows[0]?.n ?? 0 };
    }));
  }
  const w = await Promise.all(zadania);
  const zT = w.filter(x => x.uid), bT = w.filter(x => !x.uid);
  const aOk = zT.every(x => x.widzi === x.uid && x.n === 1);
  const bOk = bT.every(x => x.n === 0);

  /* C — moc wykrywcza: ustawienie SESYJNE zostaje na połączeniu */
  const pula1 = new Pool({ ...DB, max: 1 });
  let k1 = await pula1.connect();
  await k1.query(`select set_config('astera.uzytkownik',$1,false)`, [KTO.norbert]);
  k1.release();
  k1 = await pula1.connect();
  const zostalo = (await k1.query('select public.uid()::text u')).rows[0].u;
  k1.release(); await pula1.end();
  const cOk = zostalo === KTO.norbert;

  const ok22 = aOk && bOk && cOk;
  console.log(`${ok22 ? '  ZDANY ' : '  BŁĄD  '} 22. Tożsamość nie wycieka przez RDS Proxy`);
  console.log(`          z tożsamością: ${zT.length} (${aOk ? 'każde widzi tylko swoje' : 'WYCIEK — ŹLE'}) · ` +
              `bez: ${bT.length} (${bOk ? 'zero wierszy' : 'WIDZĄ DANE — ŹLE'}) · ` +
              `kontrola sesyjna: ${cOk ? 'zostaje (moc wykrywcza)' : 'NIE ZOSTAJE'}`);
  await pula.end();

  /* OBCIĄŻENIE — do odczytu metryk proxy w CloudWatch */
  console.log(`\n═══ OBCIĄŻENIE: ${KLIENTOW} klientów × ${SEKUNDY}s · wzorzec ${WZORZEC} · pauza ${PAUZA_MS} ms ═══`);
  const pulaL = new Pool({ ...DB, max: KLIENTOW });
  const start = Date.now(); let n = 0, bledy = 0;
  const koniec = start + SEKUNDY * 1000;
  await Promise.all(Array.from({ length: KLIENTOW }, async (_, i) => {
    const uid = osoby[i % 5];
    while (Date.now() < koniec) {
      try {
        await wTransakcji(pulaL, uid, async k => {
          await k.query('select count(*) from public.widok_kurs');
          await k.query('select count(*) from public.widok_etap');
        });
        n++;
        if (PAUZA_MS) await new Promise(r => setTimeout(r, PAUZA_MS));
      } catch (e) { bledy++; if (bledy < 3) console.log('  błąd:', e.message.split('\n')[0]); }
    }
  }));
  await pulaL.end();
  const s = (Date.now() - start) / 1000;
  console.log(`transakcji: ${n} · błędów: ${bledy} · ${(n / s).toFixed(1)} tx/s · ` +
              `okno: ${new Date(start).toISOString()} → ${new Date().toISOString()}`);
  process.exit(ok22 && bledy === 0 ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.message); process.exit(2); });
