#!/usr/bin/env node
/**
 * AsterA Coach — testy importu z XLSX
 *
 * Audyt wskazał, że ponowny import mógł skasować postępy kursantów
 * i zdublować materiały. Te testy sprawdzają, że tak się już nie dzieje.
 *
 * Scenariusz jest wprost taki, jak w życiu: Maliwan poprawia arkusz
 * i prosi o ponowny import, kiedy kursanci są już w połowie kursu.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const KATALOG = path.join(__dirname, '..');
const XLSX    = path.join(KATALOG, 'AsterA_Coach_Baza_Tresci.xlsx');
const ANIA    = '33333333-3333-3333-3333-333333333333';

let db, wyniki = [];

function sprawdz(nr, opis, warunek, szczegol) {
  wyniki.push({ nr, opis, zdal: !!warunek });
  console.log(`${warunek ? '  ZDANY ' : '  BŁĄD  '} ${String(nr).padStart(2)}. ${opis}`);
  if (szczegol) console.log(`          ${szczegol}`);
}

function zaimportuj() {
  const sql = execFileSync('python3', [path.join(KATALOG,'db','import_xlsx.py'), XLSX],
    { encoding: 'utf8', maxBuffer: 32*1024*1024 });
  execFileSync('psql', ['-h','/tmp','-p','5433','-U','postgres','-d','coach',
    '-v','ON_ERROR_STOP=1','-q','-f','-'], { input: sql, encoding: 'utf8' });
}

const licz = async (sql, p=[]) => Number((await db.query(sql, p)).rows[0].n);

(async () => {
  console.log('\n═══ TESTY IMPORTU Z XLSX ═══');
  console.log('Ponowny import nie może niczego skasować ani zdublować\n');

  db = new Client({ host:'/tmp', port:5433, user:'postgres', database:'coach' });
  await db.connect();

  /* ── stan wyjściowy ─────────────────────────────────────────── */
  zaimportuj();
  const lekcje0 = await licz(`select count(*)::int n from public.lekcja
     where kurs_id=(select id from public.kurs where kod='podstawowy')`);
  const etapy0  = await licz(`select count(*)::int n from public.etap e
     join public.lekcja l on l.id=e.lekcja_id
     join public.kurs k on k.id=l.kurs_id where k.kod='podstawowy'`);
  const mat0    = await licz(`select count(*)::int n from public.material
     where kurs_id=(select id from public.kurs where kod='podstawowy')`);

  /* ── kursantka robi postępy i dostaje materiał ręcznie ─────── */
  const { rows: etapy } = await db.query(
    `select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
     join public.kurs k on k.id=l.kurs_id where k.kod='podstawowy'
     order by e.kolejnosc limit 3`);
  for (const e of etapy)
    await db.query(`insert into public.postep (kursant_id, etap_id, status)
      values ($1,$2,'zrobione') on conflict (kursant_id,etap_id)
      do update set status='zrobione'`, [ANIA, e.id]);

  const { rows:[kurs] } = await db.query(`select id from public.kurs where kod='podstawowy'`);
  const sciezkaRecznie = `kurs/${kurs.id}/pdf/dodany-recznie-w-aplikacji.pdf`;
  await db.query(`insert into public.material (kurs_id, typ, nazwa_pl, sciezka, opublikowany)
    values ($1,'pdf','Dodany ręcznie w aplikacji',$2,true)
    on conflict (sciezka) do nothing`, [kurs.id, sciezkaRecznie]);

  const { rows:[lekcjaRecznie] } = await db.query(
    `insert into public.lekcja (kurs_id, dzien, tytul_pl, kolejnosc, opublikowana)
     values ($1, 99, 'Dzień dodany ręcznie', 99, true)
     on conflict (kurs_id, dzien) do update set tytul_pl=excluded.tytul_pl returning id`,
    [kurs.id]);
  await db.query(`insert into public.etap (lekcja_id, kod, nazwa_pl, kolejnosc, opublikowany)
    values ($1,'RECZNY-01','Etap dodany ręcznie',1,true)
    on conflict (lekcja_id, kod) do nothing`, [lekcjaRecznie.id]);

  const postepy0 = await licz(`select count(*)::int n from public.postep where kursant_id=$1`, [ANIA]);

  /* ── DRUGI I TRZECI IMPORT ──────────────────────────────────── */
  zaimportuj();
  zaimportuj();

  const lekcje1 = await licz(`select count(*)::int n from public.lekcja
     where kurs_id=$1`, [kurs.id]);
  const etapy1  = await licz(`select count(*)::int n from public.etap e
     join public.lekcja l on l.id=e.lekcja_id where l.kurs_id=$1`, [kurs.id]);
  const mat1    = await licz(`select count(*)::int n from public.material where kurs_id=$1`, [kurs.id]);
  const postepy1 = await licz(`select count(*)::int n from public.postep where kursant_id=$1`, [ANIA]);
  const zrobione = await licz(
    `select count(*)::int n from public.postep where kursant_id=$1 and status='zrobione'`, [ANIA]);

  sprawdz(1, 'Trzykrotny import nie dubluje lekcji, etapów ani materiałów',
    lekcje1 === lekcje0 + 1 && etapy1 === etapy0 + 1 && mat1 === mat0 + 1,
    `lekcje ${lekcje0}→${lekcje1} (+1 dodana ręcznie) · etapy ${etapy0}→${etapy1} (+1 ręczny) · ` +
    `materiały ${mat0}→${mat1} (+1 ręczny)`);

  sprawdz(2, 'Ponowny import NIE kasuje postępów kursantów',
    postepy1 === postepy0 && zrobione === 3,
    `postępów przed: ${postepy0}, po dwóch importach: ${postepy1} · oznaczonych „zrobione": ${zrobione}`);

  const zostalRecznyEtap = await licz(
    `select count(*)::int n from public.etap where kod='RECZNY-01'`);
  const zostalRecznyMat  = await licz(
    `select count(*)::int n from public.material where sciezka=$1`, [sciezkaRecznie]);
  sprawdz(3, 'Import nie kasuje treści dodanej ręcznie w aplikacji',
    zostalRecznyEtap === 1 && zostalRecznyMat === 1,
    `etap ręczny: ${zostalRecznyEtap} · materiał ręczny: ${zostalRecznyMat}`);

  /* ── zmiana w arkuszu ma się przenieść ──────────────────────── */
  const { rows:[przed] } = await db.query(
    `select id, nazwa_pl from public.etap where kod='D1-01'`);
  await db.query(`update public.etap set nazwa_pl='STARA NAZWA DO NADPISANIA' where kod='D1-01'`);
  zaimportuj();
  const { rows:[po] } = await db.query(
    `select id, nazwa_pl from public.etap where kod='D1-01'`);
  sprawdz(4, 'Poprawka w arkuszu nadpisuje etap, ale nie tworzy nowego',
    po.nazwa_pl === przed.nazwa_pl && po.id === przed.id,
    `„${przed.nazwa_pl}" → podmienione → po imporcie znów „${po.nazwa_pl}", ten sam identyfikator`);

  /* ── każdy materiał ma ścieżkę zgodną z kursem ─────────────── */
  const zle = await licz(`select count(*)::int n from public.material
    where public.kurs_ze_sciezki(sciezka) is distinct from kurs_id`);
  sprawdz(5, 'Wszystkie zaimportowane materiały mają ścieżkę zgodną ze swoim kursem',
    zle === 0, `materiałów z niezgodną ścieżką: ${zle}`);

  /* ── sprzątanie ─────────────────────────────────────────────── */
  await db.query(`delete from public.postep where kursant_id=$1`, [ANIA]);
  await db.query(`delete from public.material where sciezka=$1`, [sciezkaRecznie]);
  await db.query(`delete from public.lekcja where kurs_id=$1 and dzien=99`, [kurs.id]);

  const zdane = wyniki.filter(w => w.zdal).length;
  console.log(`\n═══ IMPORT: ${zdane} / ${wyniki.length} ═══`);
  if (zdane < wyniki.length) {
    console.log('\nNIEZDANE:');
    wyniki.filter(w => !w.zdal).forEach(w => console.log(`  ${w.nr}. ${w.opis}`));
  }
  await db.end();
  process.exit(zdane === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.message); process.exit(2); });
