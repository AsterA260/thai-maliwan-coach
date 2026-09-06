-- WYGENEROWANE PRZEZ db/import_xlsx.py — nie edytuj ręcznie
-- Źródło: AsterA_Coach_Baza_Tresci.xlsx
begin;
select set_config('astera.inicjalizacja', 'tak', true);


-- BEZPIECZNY UPSERT. Ponowne uruchomienie:
--   * nie kasuje lekcji ani etapow,
--   * nie rusza postepow kursantow (tabela public.postep),
--   * nie dubluje materialow (klucz: sciezka).
-- Etap dodany recznie w aplikacji zostaje. Zmieniony w arkuszu — uaktualnia sie.

insert into public.lekcja (kurs_id, dzien, kolejnosc, opublikowana)
select id, 1, 1, true from public.kurs where kod = 'podstawowy'
on conflict (kurs_id, dzien) do update set opublikowana = excluded.opublikowana;

insert into public.lekcja_tekst (lekcja_id, jezyk, tytul)
select l.id, 'pl', 'Dzień 1' from public.lekcja l join public.kurs k on k.id=l.kurs_id
 where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, jezyk) do update set tytul = excluded.tytul;

insert into public.lekcja_tekst (lekcja_id, jezyk, tytul)
select l.id, 'th', 'วันที่ 1' from public.lekcja l join public.kurs k on k.id=l.kurs_id
 where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, jezyk) do update set tytul = excluded.tytul;

-- ── etap D1-01 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-01', '09:00', '🙏',
 20,
 '["Czego oczekujesz od kursu?"]'::jsonb, 1, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-01'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Powitanie', 'Grupa czuje się swobodnie i zna plan dnia.',
 'Witajcie w Thai Maliwan Academy. Dziś zbudujemy fundamenty.', 'Wita każdego osobiście, przedstawia szkołę.',
 'Mówią krótko, skąd są i czego oczekują.', 'Zadbaj o luźną, ciepłą atmosferę.',
 'Znamy się i znamy plan — ruszamy.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-01' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'ต้อนรับ', 'ผู้เรียนรู้สึกผ่อนคลายและเข้าใจกำหนดการของวัน',
 'ยินดีต้อนรับสู่ Thai Maliwan Academy วันนี้เราจะวางรากฐาน', 'ทักทายทุกคนเป็นการส่วนตัว แนะนำโรงเรียน',
 'แนะนำตัวสั้นๆ ว่ามาจากไหนและคาดหวังอะไร', 'สร้างบรรยากาศอบอุ่นเป็นกันเอง',
 'เรารู้จักกันและรู้แผนแล้ว เริ่มกันเลย'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-01' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-02 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-02', '09:20', '📖',
 25,
 '["Skąd pochodzi masaż tajski?"]'::jsonb, 2, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-02'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Historia i filozofia', 'Zrozumienie korzeni i szacunku do tradycji.',
 'Masaż tajski to ponad 2500 lat tradycji i uważności.', 'Opowiada osobistą drogę i sens praktyki.',
 'Słuchają, notują pierwsze skojarzenia.', 'Podkreśl szacunek do tradycji.',
 'Wiemy, skąd to pochodzi i po co.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-02' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'ประวัติและปรัชญา', 'เข้าใจรากเหง้าและความเคารพต่อประเพณี',
 'นวดไทยมีประเพณีกว่า 2500 ปี และความมีสติ', 'เล่าเส้นทางส่วนตัวและความหมายของการฝึก',
 'ฟังและจดความคิดแรก', 'เน้นความเคารพต่อประเพณี',
 'เรารู้ที่มาและเหตุผลแล้ว'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-02' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-03 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-03', '09:45', '🛡️',
 30,
 '["Których miejsc nie wolno mocno uciskać?"]'::jsonb, 3, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-03'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Zasady bezpieczeństwa', 'Bezpieczeństwo jest ważniejsze niż siła nacisku.',
 'Niektóre miejsca wymagają ostrożności — zbyt mocny nacisk może sprawić ból.', 'Pokazuje miejsca wrażliwe: kolana, łokcie, kark, zgięcia stawów.',
 'Wskazują na modelu miejsca bezpieczne i ryzykowne.', 'Ból = od razu odpuść nacisk. Najpierw obserwacja, potem siła.',
 'Profesjonalista nie używa siły przypadkowo.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-03' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'กฎความปลอดภัย', 'ความปลอดภัยสำคัญกว่าการกดแรง',
 'บางจุดต้องระวังเป็นพิเศษ — การกดแรงเกินไปอาจทำให้เจ็บ', 'ชี้จุดที่บอบบาง: เข่า ข้อศอก ต้นคอ ข้อพับ',
 'ชี้จุดปลอดภัยและจุดเสี่ยงบนแบบจำลอง', 'เจ็บ = ลดแรงทันที สังเกตก่อน แล้วค่อยเพิ่มแรง',
 'มืออาชีพไม่ใช้แรงแบบสุ่ม'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-03' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-04 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-04', '10:15', '🧘',
 30,
 '["Dlaczego pracujemy całym ciałem?"]'::jsonb, 4, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-04'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Ergonomia pracy', 'Masażysta pracuje całym ciałem, nie tylko rękami.',
 'Twoje ciało to narzędzie — chroń kręgosłup i nadgarstki.', 'Koryguje postawę, pokazuje pracę z bioder.',
 'Ćwiczą przenoszenie ciężaru ciała.', 'Zgięte plecy = szybkie zmęczenie i kontuzje.',
 'Dobra postawa = długa, zdrowa praca.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-04' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'ท่าทางการทำงาน', 'หมอนวดใช้ทั้งร่างกาย ไม่ใช่แค่มือ',
 'ร่างกายคุณคือเครื่องมือ — ปกป้องกระดูกสันหลังและข้อมือ', 'แก้ท่าทาง สาธิตการใช้สะโพก',
 'ฝึกถ่ายน้ำหนักตัว', 'หลังงอ = เมื่อยเร็วและบาดเจ็บ',
 'ท่าทางดี = ทำงานได้นานและสุขภาพดี'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-04' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-05 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-05', '11:00', '👀',
 45,
 '["Jaka jest kolejność ruchów?"]'::jsonb, 5, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-05'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Demonstracja: leżenie na brzuchu', 'Poznanie pozycji wyjściowej.',
 'Obserwujcie tempo, oddech i kolejność ruchów.', 'Wykonuje pełną sekwencję na modelu.',
 'Patrzą, zadają pytania na bieżąco.', 'Nie spiesz się — rytm jest częścią techniki.',
 'Mamy wzorzec, który zaraz powtórzymy.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-05' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'การสาธิต: นอนคว่ำ', 'เรียนรู้ท่าเริ่มต้น',
 'สังเกตจังหวะ ลมหายใจ และลำดับการเคลื่อนไหว', 'สาธิตลำดับเต็มบนแบบจำลอง',
 'ดูและถามคำถามระหว่างทาง', 'อย่ารีบ — จังหวะคือส่วนหนึ่งของเทคนิค',
 'เรามีแบบอย่างที่จะทำตามแล้ว'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-05' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-06 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-06', '12:00', '🤲',
 60,
 '["Jak sprawdzić, czy nacisk jest dobry?"]'::jsonb, 6, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-06'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Praktyka kursantów', 'Pierwsze samodzielne próby w parach.',
 'Pracujcie wolno i pytajcie partnera o odczucia.', 'Chodzi między parami, poprawia dłonie.',
 'Ćwiczą w parach, zmieniają się rolami.', 'Komunikacja z partnerem przez cały czas.',
 'Pierwszy kontakt z techniką za nami.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-06' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'ฝึกปฏิบัติ', 'ลองด้วยตัวเองครั้งแรกเป็นคู่',
 'ทำช้าๆ และถามคู่ของคุณถึงความรู้สึก', 'เดินดูตามคู่ แก้ไขการวางมือ',
 'ฝึกเป็นคู่ สลับบทบาท', 'สื่อสารกับคู่ตลอดเวลา',
 'สัมผัสเทคนิคครั้งแรกผ่านไปแล้ว'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-06' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-07 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-07', '14:00', '💆',
 90,
 '["Gdzie NIE naciskać na plecach?"]'::jsonb, 7, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-07'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Praktyka: plecy, talia, biodra', 'Techniki na partie środkowe ciała.',
 'Te partie lubią równomierny, spokojny nacisk.', 'Demonstruje przejścia między strefami.',
 'Ćwiczą sekwencję plecy → talia → biodra.', 'Omijaj kręgosłup — pracuj po bokach.',
 'Umiemy prowadzić środek ciała.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-07' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'หลัง เอว สะโพก', 'เทคนิคสำหรับส่วนกลางลำตัว',
 'ส่วนเหล่านี้ชอบแรงกดที่สม่ำเสมอและนุ่มนวล', 'สาธิตการเปลี่ยนผ่านระหว่างโซน',
 'ฝึกลำดับ หลัง → เอว → สะโพก', 'หลีกเลี่ยงกระดูกสันหลัง — ทำงานด้านข้าง',
 'เรานำส่วนกลางลำตัวได้แล้ว'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-07' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-08 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-08', '15:30', '🔍',
 60,
 '["Jaki błąd popełniasz najczęściej?"]'::jsonb, 8, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-08'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Najczęstsze błędy', 'Rozpoznawanie i korekta typowych pomyłek.',
 'Większość błędów to za dużo siły, za mało obserwacji.', 'Pokazuje błąd i jego poprawną wersję.',
 'Wychwytują błędy u siebie nawzajem.', 'Błąd to nauka — koryguj bez oceniania.',
 'Wiemy, czego unikać.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-08' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'ข้อผิดพลาดที่พบบ่อย', 'รู้จักและแก้ไขข้อผิดพลาดทั่วไป',
 'ข้อผิดพลาดส่วนใหญ่คือแรงมากไป สังเกตน้อยไป', 'แสดงข้อผิดพลาดและวิธีที่ถูกต้อง',
 'ช่วยกันสังเกตข้อผิดพลาดของกันและกัน', 'ข้อผิดพลาดคือการเรียนรู้ — แก้ไขโดยไม่ตัดสิน',
 'เรารู้แล้วว่าต้องเลี่ยงอะไร'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-08' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-09 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-09', '16:30', '🌟',
 30,
 '["Co zapamiętasz z dziś?"]'::jsonb, 9, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-09'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Podsumowanie dnia', 'Utrwalenie i przygotowanie na jutro.',
 'Dziś położyliśmy fundament: bezpieczeństwo i szacunek.', 'Docenia postępy, wskazuje kierunek na jutro.',
 'Dzielą się jednym wnioskiem z dnia.', 'Zakończ pozytywnie i z wdzięcznością.',
 'Dzień 1 zamknięty — do zobaczenia jutro.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-09' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'สรุปประจำวัน', 'ทบทวนและเตรียมพร้อมสำหรับวันพรุ่งนี้',
 'วันนี้เราวางรากฐาน: ความปลอดภัยและความเคารพ', 'ชื่นชมความก้าวหน้า ชี้ทิศทางวันพรุ่งนี้',
 'แบ่งปันข้อคิดหนึ่งอย่างจากวันนี้', 'จบด้วยความรู้สึกดีและความขอบคุณ',
 'ปิดวันแรกแล้ว — พบกันใหม่พรุ่งนี้'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-09' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
-- ── etap D1-10 ──────────────────────────────────────────────
insert into public.etap
 (lekcja_id, kod, godzina, ikona, czas_min, pytania, kolejnosc, opublikowany)
select l.id, 'D1-10', '17:00', '🍵',
 30,
 '["O co chcesz jeszcze zapytać?"]'::jsonb, 10, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
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
where k.kod = 'podstawowy' and e.kod = 'D1-10'
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'pl',
 'Herbata i pytania', 'Swobodne pytania przy tajskiej herbacie.',
 'Pytajcie o wszystko — w dowolnym języku.', 'Rozmawia nieformalnie, dzieli się historiami.',
 'Zadają pytania, integrują się.', 'To też część nauki — relacja i zaufanie.',
 'Zamykamy dzień w dobrej energii.'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-10' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;
insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel, agent_mowi,
                               pokazuje, kursanci_robia, uwaga, podsumowanie)
select w.id, 'th',
 'ชาและถามตอบ', 'ถามตอบอย่างสบายๆ พร้อมชาไทย',
 'ถามได้ทุกเรื่อง — ภาษาใดก็ได้', 'พูดคุยเป็นกันเอง แบ่งปันเรื่องราว',
 'ถามคำถาม สร้างความสัมพันธ์', 'นี่ก็เป็นส่วนหนึ่งของการเรียนรู้',
 'ปิดท้ายวันด้วยพลังงานที่ดี'
from public.etap_wersja w
 join public.etap e   on e.id = w.etap_id
 join public.lekcja l on l.id = e.lekcja_id
 join public.kurs k   on k.id = l.kurs_id
where k.kod = 'podstawowy' and e.kod = 'D1-10' and w.numer = 1
on conflict (etap_wersja_id, jezyk) do update set
 nazwa = excluded.nazwa, cel = excluded.cel, agent_mowi = excluded.agent_mowi,
 pokazuje = excluded.pokazuje, kursanci_robia = excluded.kursanci_robia,
 uwaga = excluded.uwaga, podsumowanie = excluded.podsumowanie;

insert into public.material (kurs_id, etap_id, typ, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '09:45 Zasady bezpieczeństwa' like '%'||coalesce(e.godzina,'~')||'%' limit 1),
 'zdjecie', 'kurs/'||k.id||'/zdjecie/mapa-ciala-strefy-wrazliwe', false
from public.kurs k where k.kod = 'podstawowy'
on conflict (sciezka) do update set etap_id = excluded.etap_id;

insert into public.material_tekst (material_id, jezyk, nazwa, opis)
select m.id, 'pl', 'Mapa ciała — strefy wrażliwe', 'Zdjęcie z miejscami wrażliwymi'
from public.material m join public.kurs k on k.id = m.kurs_id
where k.kod = 'podstawowy' and m.sciezka = 'kurs/'||k.id||'/zdjecie/mapa-ciala-strefy-wrazliwe'
on conflict (material_id, jezyk) do update set
 nazwa = excluded.nazwa, opis = excluded.opis;
insert into public.material (kurs_id, etap_id, typ, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '09:45 Zasady bezpieczeństwa' like '%'||coalesce(e.godzina,'~')||'%' limit 1),
 'wideo', 'kurs/'||k.id||'/wideo/demo-bezpiecznego-nacisku-40s', false
from public.kurs k where k.kod = 'podstawowy'
on conflict (sciezka) do update set etap_id = excluded.etap_id;

insert into public.material_tekst (material_id, jezyk, nazwa, opis)
select m.id, 'pl', 'Demo bezpiecznego nacisku (40s)', 'Krótkie demo poprawnego nacisku'
from public.material m join public.kurs k on k.id = m.kurs_id
where k.kod = 'podstawowy' and m.sciezka = 'kurs/'||k.id||'/wideo/demo-bezpiecznego-nacisku-40s'
on conflict (material_id, jezyk) do update set
 nazwa = excluded.nazwa, opis = excluded.opis;
insert into public.material (kurs_id, etap_id, typ, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '11:00 Demonstracja' like '%'||coalesce(e.godzina,'~')||'%' limit 1),
 'wideo', 'kurs/'||k.id||'/wideo/pelna-sekwencja-lezenie-na-brzuchu', false
from public.kurs k where k.kod = 'podstawowy'
on conflict (sciezka) do update set etap_id = excluded.etap_id;

insert into public.material_tekst (material_id, jezyk, nazwa, opis)
select m.id, 'pl', 'Pełna sekwencja — leżenie na brzuchu', 'Nagranie całej sekwencji'
from public.material m join public.kurs k on k.id = m.kurs_id
where k.kod = 'podstawowy' and m.sciezka = 'kurs/'||k.id||'/wideo/pelna-sekwencja-lezenie-na-brzuchu'
on conflict (material_id, jezyk) do update set
 nazwa = excluded.nazwa, opis = excluded.opis;
insert into public.material (kurs_id, etap_id, typ, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '14:00 Plecy, talia, biodra' like '%'||coalesce(e.godzina,'~')||'%' limit 1),
 'zdjecie', 'kurs/'||k.id||'/zdjecie/schemat-stref-plecow', false
from public.kurs k where k.kod = 'podstawowy'
on conflict (sciezka) do update set etap_id = excluded.etap_id;

insert into public.material_tekst (material_id, jezyk, nazwa, opis)
select m.id, 'pl', 'Schemat stref pleców', 'Rysunek stref bezpiecznych'
from public.material m join public.kurs k on k.id = m.kurs_id
where k.kod = 'podstawowy' and m.sciezka = 'kurs/'||k.id||'/zdjecie/schemat-stref-plecow'
on conflict (material_id, jezyk) do update set
 nazwa = excluded.nazwa, opis = excluded.opis;

-- Baza wiedzy z arkusza ③ (na razie jako komentarz — do osobnej tabeli FAQ)
--   Jak mocno kursant ma naciskać na początku? / ในช่วงแรกควรกดแรงแค่ไหน?
--   Co robić, gdy klient mówi, że boli? / ถ้าลูกค้าบอกว่าเจ็บทำอย่างไร?
--   Których miejsc nie wolno mocno uciskać? / ห้ามกดแรงตรงไหน?
--   Jak nie męczyć rąk? / จะไม่ให้มือล้าอย่างไร?

commit;
