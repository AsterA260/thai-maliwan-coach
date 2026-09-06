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
# Import wypełnia wersje zatwierdzone (to treść przekazana przez Maliwan
# w arkuszu), a wyzwalacz chron_tekst_zatwierdzony broni takich wersji
# przed edycją. Ta sama wąska furtka co przy nadawaniu pierwszych ról,
# a od Etapu 1a wymaga dwóch świadomych kroków: jawnego wejścia w rolę
# `astera_seed` (NOLOGIN, nieosiągalna dla astera_api) oraz flagi
# transakcyjnej. Żaden z nich osobno nie wystarcza.
w('set local role astera_seed;')
w("select set_config('astera.inicjalizacja', 'tak', true);")
w('')
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
    w(f"""insert into public.lekcja (kurs_id, dzien, kolejnosc, opublikowana)
select id, {d}, {d}, true from public.kurs where kod = '{KURS_KOD}'
on conflict (kurs_id, dzien) do update set opublikowana = excluded.opublikowana;

insert into public.lekcja_tekst (lekcja_id, jezyk, tytul)
select l.id, 'pl', 'Dzień {d}' from public.lekcja l join public.kurs k on k.id=l.kurs_id
 where k.kod = '{KURS_KOD}' and l.dzien = {d}
on conflict (lekcja_id, jezyk) do update set tytul = excluded.tytul;

insert into public.lekcja_tekst (lekcja_id, jezyk, tytul)
select l.id, 'th', 'วันที่ {d}' from public.lekcja l join public.kurs k on k.id=l.kurs_id
 where k.kod = '{KURS_KOD}' and l.dzien = {d}
on conflict (lekcja_id, jezyk) do update set tytul = excluded.tytul;""")
w('')

# ── etapy ─────────────────────────────────────────────────────────
for i, e in enumerate(etapy, 1):
    kod = str(e.get('ID') or '').strip()
    if not kod:
        continue
    t = th.get(kod, {})
    pyt = [p.strip() for p in str(e.get('Pytania kontrolne') or '').split(';') if p.strip()]
    w(f"""-- ── etap {kod} ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, {sql(kod)}, {sql(e.get('Godzina'))}, {sql(e.get('Ikona'))},
 {int(e['Czas (min)']) if e.get('Czas (min)') else 'null'},
 {sql(json.dumps(pyt, ensure_ascii=False))}::jsonb, {i}, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = '{KURS_KOD}' and l.dzien = {int(e.get('Dzień') or 1)}
on conflict (lekcja_id, kod) do update set
 godzina = excluded.godzina, ikona = excluded.ikona,
 czas_min = excluded.czas_min, pytania = excluded.pytania,
 kolejnosc = excluded.kolejnosc;

-- Treść etapu jest WERSJĄ. Import zakłada wersję 1 jako zatwierdzoną,
-- bo to treść, którą Maliwan przekazała w arkuszu. Ponowny import
-- aktualizuje TĘ SAMĄ wersję — dopóki nikt nie utworzył kolejnej.
insert into public.etap_wersja (etap_id, numer, status, autor_id,
                                zatwierdzil_id, zatwierdzone_o, komentarz)
select e.id, 1, 'zatwierdzone', a.id, a.id, now(), 'Import z arkusza treści.'
from public.etap e
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
 cross join (select id from public.profile where rola='admin' and aktywne
              order by utworzone limit 1) a
where k.kod = '{KURS_KOD}' and e.kod = {sql(kod)}
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 {sql(e.get('Nazwa etapu'))}, {sql(e.get('Cel'))},
 {sql(e.get('Agent mówi (głos)'))}, {sql(e.get('Maliwan pokazuje'))},
 {sql(e.get('Kursanci robią'))}, {sql(e.get('Na co uważać'))},
 {sql(e.get('Podsumowanie'))}
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = '{KURS_KOD}' and e.kod = {sql(kod)} and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;""")

    if t:
        w(f"""insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 {sql(t.get('ชื่อขั้นตอน'))}, {sql(t.get('เป้าหมาย'))},
 {sql(t.get('เอเจนต์พูด'))}, {sql(t.get('มะลิวัลย์สาธิต'))},
 {sql(t.get('ผู้เรียนฝึก'))}, {sql(t.get('ข้อควรระวัง'))},
 {sql(t.get('สรุป'))}
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = '{KURS_KOD}' and e.kod = {sql(kod)} and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;""")
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
        w(f"""insert into public.material (kurs_id, etap_id, typ, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and {sql(etap_txt)} like '%'||coalesce(e.godzina,'~')||'%' limit 1),
 '{typ}', 'kurs/'||k.id||'/{typ}/{klucz}', false
from public.kurs k where k.kod = '{KURS_KOD}'
on conflict (sciezka) do update set etap_id = excluded.etap_id;

insert into public.material_tekst (material_id, jezyk, nazwa, opis)
select m.id, 'pl', {sql(nazwa)}, {sql(m.get('Opis'))}
from public.material m join public.kurs k on k.id = m.kurs_id
where k.kod = '{KURS_KOD}' and m.sciezka = 'kurs/'||k.id||'/{typ}/{klucz}'
on conflict (material_id, jezyk) do update set
 nazwa = excluded.nazwa, opis = excluded.opis;""")
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
