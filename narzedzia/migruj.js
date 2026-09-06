#!/usr/bin/env node
/**
 * AsterA Coach — uruchamianie migracji            [Etap 1 migracji na AWS]
 *
 * Wykonuje po kolei pliki z db/migracje/, każdy dokładnie raz.
 * Stan zapisuje w tabeli public._migracja.
 *
 *   node narzedzia/migruj.js              — wykonaj brakujące
 *   node narzedzia/migruj.js --stan       — pokaż, co wykonane, co czeka
 *   node narzedzia/migruj.js --sucho      — pokaż plan, nic nie wykonuj
 *
 * Zasady, na których to stoi:
 *
 *  1. Każda migracja idzie we WŁASNEJ TRANSAKCJI. Błąd w środku pliku
 *     wycofuje cały plik — nigdy nie zostaje połowa zmiany.
 *  2. Kolejność wyznacza nazwa pliku. Numer jest częścią umowy.
 *  3. Treść wykonanego pliku jest zapamiętywana jako skrót. Późniejsza
 *     zmiana pliku, który już poszedł na bazę, jest zgłaszana jako błąd —
 *     bo znaczy, że dwie bazy rozjechały się w niewidoczny sposób.
 *     Poprawka wchodzi jako NOWA migracja, nigdy jako edycja starej.
 *  4. Adres bazy z DATABASE_URL, a gdy go nie ma — lokalny serwer
 *     deweloperski. Żadnych haseł w kodzie.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const KATALOG = path.join(__dirname, '..', 'db', 'migracje');

const POLACZENIE = require('../testy/polaczenie').DB;

const tryb = process.argv.includes('--stan')  ? 'stan'
           : process.argv.includes('--sucho') ? 'sucho'
           : 'wykonaj';

const suma = tresc => crypto.createHash('sha256').update(tresc).digest('hex').slice(0, 16);

function pliki() {
  if (!fs.existsSync(KATALOG)) return [];
  return fs.readdirSync(KATALOG)
    .filter(n => n.endsWith('.sql'))
    .sort()
    .map(nazwa => {
      const tresc = fs.readFileSync(path.join(KATALOG, nazwa), 'utf8');
      return { nazwa, tresc, suma: suma(tresc) };
    });
}

(async () => {
  const db = new Client(POLACZENIE);
  await db.connect();

  // Rejestr musi istnieć, zanim cokolwiek sprawdzimy. Pierwsza migracja
  // sama go zakłada, więc tworzymy go tu tylko awaryjnie i bezpiecznie.
  await db.query(`create table if not exists public._migracja (
    nazwa text primary key, suma text not null,
    wykonano timestamptz not null default now(), czas_ms integer)`);

  const { rows } = await db.query('select nazwa, suma from public._migracja');
  const wykonane = new Map(rows.map(r => [r.nazwa, r.suma]));
  const wszystkie = pliki();

  if (!wszystkie.length) {
    console.log('Brak plików w db/migracje/ — nie ma czego wykonywać.');
    await db.end(); process.exit(0);
  }

  /* ── kontrola spójności: czy wykonany plik nie został zmieniony ── */
  const zmienione = wszystkie.filter(p => wykonane.has(p.nazwa) && wykonane.get(p.nazwa) !== p.suma);
  if (zmienione.length) {
    console.error('\n✗ ZMIENIONO PLIK, KTÓRY JUŻ POSZEDŁ NA BAZĘ:\n');
    zmienione.forEach(p => console.error(`    ${p.nazwa}`));
    console.error(`
  Ta baza ma już wykonaną STARĄ treść tego pliku. Inna baza, na której
  migracje pójdą od zera, dostanie NOWĄ — i obie będą wyglądać na zgodne,
  choć nie są. Dlatego to jest błąd, a nie ostrzeżenie.

  Poprawkę wprowadź jako nową migrację o kolejnym numerze.
`);
    await db.end(); process.exit(1);
  }

  const czekajace = wszystkie.filter(p => !wykonane.has(p.nazwa));

  if (tryb === 'stan' || tryb === 'sucho') {
    console.log('\n═══ STAN MIGRACJI ═══\n');
    wszystkie.forEach(p => {
      const jest = wykonane.has(p.nazwa);
      console.log(`  ${jest ? 'wykonana ' : 'CZEKA    '} ${p.nazwa}`);
    });
    console.log(`\n  wykonanych: ${wszystkie.length - czekajace.length} · czeka: ${czekajace.length}\n`);
    await db.end(); process.exit(0);
  }

  if (!czekajace.length) {
    console.log('Baza jest aktualna — wszystkie migracje wykonane.');
    await db.end(); process.exit(0);
  }

  console.log(`\n═══ MIGRACJE: ${czekajace.length} do wykonania ═══\n`);
  for (const p of czekajace) {
    const start = Date.now();
    try {
      await db.query('begin');
      await db.query(p.tresc);
      await db.query(
        `insert into public._migracja (nazwa, suma, czas_ms) values ($1,$2,$3)`,
        [p.nazwa, p.suma, Date.now() - start]);
      await db.query('commit');
      console.log(`  ✓ ${p.nazwa}  (${Date.now() - start} ms)`);
    } catch (e) {
      await db.query('rollback').catch(() => {});
      console.error(`  ✗ ${p.nazwa}`);
      console.error(`    ${e.message.split('\n')[0]}`);
      console.error('\n  Migracja wycofana w całości. Baza jest w stanie sprzed tego pliku.\n');
      await db.end(); process.exit(1);
    }
  }
  console.log('\n  Gotowe.\n');
  await db.end();
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(2); });
