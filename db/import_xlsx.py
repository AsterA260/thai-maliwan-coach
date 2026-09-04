#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Import bazy treści z AsterA_Coach_Baza_Tresci.xlsx do SQL.

XLSX jest ŹRÓDŁEM STARTOWYM. Po uruchomieniu systemu żywym źródłem
prawdy jest baza; XLSX służy do importu, eksportu i kopii.

Użycie:
    python3 db/import_xlsx.py AsterA_Coach_Baza_Tresci.xlsx > db/05_import.sql
"""
import sys, json
import openpyxl

PLIK = sys.argv[1] if len(sys.argv) > 1 else 'AsterA_Coach_Baza_Tresci.xlsx'
KURS_KOD = 'podstawowy'

def sql(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return 'null'
    return "'" + str(v).strip().replace("'", "''") + "'"

ZNAKI = str.maketrans('ąćęłńóśżźĄĆĘŁŃÓŚŻŹ', 'acelnoszzACELNOSZZ')
def slug(s):
    import re as _re
    s = str(s).translate(ZNAKI).lower()
    s = _re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'plik'

def wiersze(ws):
    it = ws.iter_rows(values_only=True)
    naglowki = [str(c).strip() if c else '' for c in next(it)]
    for r in it:
        if not any(r):
            continue
        yield dict(zip(naglowki, r))

wb = openpyxl.load_workbook(PLIK, data_only=True)

def arkusz(*kandydaci):
    for n in wb.sheetnames:
        for k in kandydaci:
            if k in n:
                return wb[n]
    return None

proc_pl = arkusz('Procedura')
proc_th = arkusz('โครงสร้าง')
wiedza  = arkusz('Baza wiedzy', 'ฐานความรู้')
mat_pl  = arkusz('Materiały (PL)')

out = []
w = out.append
w('-- WYGENEROWANE PRZEZ db/import_xlsx.py — nie edytuj ręcznie')
w('-- Źródło: ' + PLIK)
w('begin;')
w('')
w("-- BEZPIECZNY UPSERT. Ponowne uruchomienie:")
w("--   * nie kasuje lekcji ani etapow,")
w("--   * nie rusza postepow kursantow (tabela public.postep),")
w("--   * nie dubluje materialow (klucz: sciezka).")
w("-- Etap dodany recznie w aplikacji zostaje. Zmieniony w arkuszu — uaktualnia sie.")
w('')

# ── etapy po tajsku, po kluczu ID ─────────────────────────────────
th = {}
if proc_th:
    for r in wiersze(proc_th):
        kod = r.get('รหัส')
        if kod:
            th[str(kod).strip()] = r

# ── lekcje = dni ──────────────────────────────────────────────────
etapy = list(wiersze(proc_pl)) if proc_pl else []
dni = sorted({int(e['Dzień']) for e in etapy if e.get('Dzień')})

for d in dni:
    w(f"""insert into public.lekcja (kurs_id, dzien, tytul_pl, tytul_th, kolejnosc, opublikowana)
select id, {d}, 'Dzień {d}', 'วันที่ {d}', {d}, true from public.kurs where kod = '{KURS_KOD}'
on conflict (kurs_id, dzien) do update set opublikowana = excluded.opublikowana;""")
w('')

# ── etapy ─────────────────────────────────────────────────────────
for i, e in enumerate(etapy, 1):
    kod = str(e.get('ID') or '').strip()
    if not kod:
        continue
    t = th.get(kod, {})
    pyt = [p.strip() for p in str(e.get('Pytania kontrolne') or '').split(';') if p.strip()]
    w(f"""insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, {sql(kod)}, {sql(e.get('Godzina'))}, {sql(e.get('Ikona'))},
 {sql(e.get('Nazwa etapu'))}, {sql(t.get('ชื่อขั้นตอน'))},
 {int(e['Czas (min)']) if e.get('Czas (min)') else 'null'},
 {sql(e.get('Cel'))}, {sql(t.get('เป้าหมาย'))},
 {sql(e.get('Agent mówi (głos)'))}, {sql(t.get('เอเจนต์พูด'))},
 {sql(e.get('Maliwan pokazuje'))}, {sql(t.get('มะลิวัลย์สาธิต'))},
 {sql(e.get('Kursanci robią'))}, {sql(t.get('ผู้เรียนฝึก'))},
 {sql(e.get('Na co uważać'))}, {sql(t.get('ข้อควรระวัง'))},
 {sql(e.get('Podsumowanie'))}, {sql(t.get('สรุป'))},
 {sql(json.dumps(pyt, ensure_ascii=False))}::jsonb, {i}, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = '{KURS_KOD}' and l.dzien = {int(e.get('Dzień') or 1)}
on conflict (lekcja_id, kod) do update set
 godzina = excluded.godzina, ikona = excluded.ikona,
 nazwa_pl = excluded.nazwa_pl, nazwa_th = excluded.nazwa_th,
 czas_min = excluded.czas_min, cel_pl = excluded.cel_pl, cel_th = excluded.cel_th,
 agent_mowi_pl = excluded.agent_mowi_pl, agent_mowi_th = excluded.agent_mowi_th,
 pokazuje_pl = excluded.pokazuje_pl, pokazuje_th = excluded.pokazuje_th,
 kursanci_robia_pl = excluded.kursanci_robia_pl, kursanci_robia_th = excluded.kursanci_robia_th,
 uwaga_pl = excluded.uwaga_pl, uwaga_th = excluded.uwaga_th,
 podsumowanie_pl = excluded.podsumowanie_pl, podsumowanie_th = excluded.podsumowanie_th,
 pytania = excluded.pytania, kolejnosc = excluded.kolejnosc;""")
w('')

# ── materiały ─────────────────────────────────────────────────────
TYPY = {'zdjęcie':'zdjecie','zdjecie':'zdjecie','foto':'zdjecie',
        'wideo':'wideo','video':'wideo','pdf':'pdf','audio':'audio'}
if mat_pl:
    for m in wiersze(mat_pl):
        nazwa = m.get('Nazwa')
        if not nazwa:
            continue
        typ = TYPY.get(str(m.get('Typ (foto/wideo/pdf/audio)') or '').strip().lower(), 'inny')
        etap_txt = str(m.get('Etap') or '').strip()
        klucz = slug(nazwa)
        w(f"""insert into public.material (kurs_id, etap_id, typ, nazwa_pl, opis, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and {sql(etap_txt)} like '%'||coalesce(e.godzina,'~')||'%' limit 1),
 '{typ}', {sql(nazwa)}, {sql(m.get('Opis'))},
 'kurs/'||k.id||'/{typ}/{klucz}', false
from public.kurs k where k.kod = '{KURS_KOD}'
on conflict (sciezka) do update set
 nazwa_pl = excluded.nazwa_pl, opis = excluded.opis, etap_id = excluded.etap_id;""")
w('')

# ── baza wiedzy → pytania kontrolne przy etapach ──────────────────
if wiedza:
    w('-- Baza wiedzy z arkusza ③ (na razie jako komentarz — do osobnej tabeli FAQ)')
    for r in wiersze(wiedza):
        q = r.get('Pytanie / คำถาม')
        if q:
            w('--   ' + str(q).replace('\n', ' ')[:100])
w('')
w('commit;')
print('\n'.join(out))
