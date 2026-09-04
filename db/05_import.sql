-- WYGENEROWANE PRZEZ db/import_xlsx.py — nie edytuj ręcznie
-- Źródło: AsterA_Coach_Baza_Tresci.xlsx
begin;

-- Idempotentnie: czyścimy poprzedni import tego kursu
delete from public.lekcja where kurs_id = (select id from public.kurs where kod = 'podstawowy');

insert into public.lekcja (kurs_id, dzien, tytul_pl, tytul_th, kolejnosc, opublikowana)
select id, 1, 'Dzień 1', 'วันที่ 1', 1, true from public.kurs where kod = 'podstawowy'
on conflict (kurs_id, dzien) do update set opublikowana = excluded.opublikowana;

insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-01', '09:00', '🙏',
 'Powitanie', 'ต้อนรับ',
 20,
 'Grupa czuje się swobodnie i zna plan dnia.', 'ผู้เรียนรู้สึกผ่อนคลายและเข้าใจกำหนดการของวัน',
 'Witajcie w Thai Maliwan Academy. Dziś zbudujemy fundamenty.', 'ยินดีต้อนรับสู่ Thai Maliwan Academy วันนี้เราจะวางรากฐาน',
 'Wita każdego osobiście, przedstawia szkołę.', 'ทักทายทุกคนเป็นการส่วนตัว แนะนำโรงเรียน',
 'Mówią krótko, skąd są i czego oczekują.', 'แนะนำตัวสั้นๆ ว่ามาจากไหนและคาดหวังอะไร',
 'Zadbaj o luźną, ciepłą atmosferę.', 'สร้างบรรยากาศอบอุ่นเป็นกันเอง',
 'Znamy się i znamy plan — ruszamy.', 'เรารู้จักกันและรู้แผนแล้ว เริ่มกันเลย',
 '["Czego oczekujesz od kursu?"]'::jsonb, 1, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-02', '09:20', '📖',
 'Historia i filozofia', 'ประวัติและปรัชญา',
 25,
 'Zrozumienie korzeni i szacunku do tradycji.', 'เข้าใจรากเหง้าและความเคารพต่อประเพณี',
 'Masaż tajski to ponad 2500 lat tradycji i uważności.', 'นวดไทยมีประเพณีกว่า 2500 ปี และความมีสติ',
 'Opowiada osobistą drogę i sens praktyki.', 'เล่าเส้นทางส่วนตัวและความหมายของการฝึก',
 'Słuchają, notują pierwsze skojarzenia.', 'ฟังและจดความคิดแรก',
 'Podkreśl szacunek do tradycji.', 'เน้นความเคารพต่อประเพณี',
 'Wiemy, skąd to pochodzi i po co.', 'เรารู้ที่มาและเหตุผลแล้ว',
 '["Skąd pochodzi masaż tajski?"]'::jsonb, 2, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-03', '09:45', '🛡️',
 'Zasady bezpieczeństwa', 'กฎความปลอดภัย',
 30,
 'Bezpieczeństwo jest ważniejsze niż siła nacisku.', 'ความปลอดภัยสำคัญกว่าการกดแรง',
 'Niektóre miejsca wymagają ostrożności — zbyt mocny nacisk może sprawić ból.', 'บางจุดต้องระวังเป็นพิเศษ — การกดแรงเกินไปอาจทำให้เจ็บ',
 'Pokazuje miejsca wrażliwe: kolana, łokcie, kark, zgięcia stawów.', 'ชี้จุดที่บอบบาง: เข่า ข้อศอก ต้นคอ ข้อพับ',
 'Wskazują na modelu miejsca bezpieczne i ryzykowne.', 'ชี้จุดปลอดภัยและจุดเสี่ยงบนแบบจำลอง',
 'Ból = od razu odpuść nacisk. Najpierw obserwacja, potem siła.', 'เจ็บ = ลดแรงทันที สังเกตก่อน แล้วค่อยเพิ่มแรง',
 'Profesjonalista nie używa siły przypadkowo.', 'มืออาชีพไม่ใช้แรงแบบสุ่ม',
 '["Których miejsc nie wolno mocno uciskać?"]'::jsonb, 3, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-04', '10:15', '🧘',
 'Ergonomia pracy', 'ท่าทางการทำงาน',
 30,
 'Masażysta pracuje całym ciałem, nie tylko rękami.', 'หมอนวดใช้ทั้งร่างกาย ไม่ใช่แค่มือ',
 'Twoje ciało to narzędzie — chroń kręgosłup i nadgarstki.', 'ร่างกายคุณคือเครื่องมือ — ปกป้องกระดูกสันหลังและข้อมือ',
 'Koryguje postawę, pokazuje pracę z bioder.', 'แก้ท่าทาง สาธิตการใช้สะโพก',
 'Ćwiczą przenoszenie ciężaru ciała.', 'ฝึกถ่ายน้ำหนักตัว',
 'Zgięte plecy = szybkie zmęczenie i kontuzje.', 'หลังงอ = เมื่อยเร็วและบาดเจ็บ',
 'Dobra postawa = długa, zdrowa praca.', 'ท่าทางดี = ทำงานได้นานและสุขภาพดี',
 '["Dlaczego pracujemy całym ciałem?"]'::jsonb, 4, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-05', '11:00', '👀',
 'Demonstracja: leżenie na brzuchu', 'การสาธิต: นอนคว่ำ',
 45,
 'Poznanie pozycji wyjściowej.', 'เรียนรู้ท่าเริ่มต้น',
 'Obserwujcie tempo, oddech i kolejność ruchów.', 'สังเกตจังหวะ ลมหายใจ และลำดับการเคลื่อนไหว',
 'Wykonuje pełną sekwencję na modelu.', 'สาธิตลำดับเต็มบนแบบจำลอง',
 'Patrzą, zadają pytania na bieżąco.', 'ดูและถามคำถามระหว่างทาง',
 'Nie spiesz się — rytm jest częścią techniki.', 'อย่ารีบ — จังหวะคือส่วนหนึ่งของเทคนิค',
 'Mamy wzorzec, który zaraz powtórzymy.', 'เรามีแบบอย่างที่จะทำตามแล้ว',
 '["Jaka jest kolejność ruchów?"]'::jsonb, 5, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-06', '12:00', '🤲',
 'Praktyka kursantów', 'ฝึกปฏิบัติ',
 60,
 'Pierwsze samodzielne próby w parach.', 'ลองด้วยตัวเองครั้งแรกเป็นคู่',
 'Pracujcie wolno i pytajcie partnera o odczucia.', 'ทำช้าๆ และถามคู่ของคุณถึงความรู้สึก',
 'Chodzi między parami, poprawia dłonie.', 'เดินดูตามคู่ แก้ไขการวางมือ',
 'Ćwiczą w parach, zmieniają się rolami.', 'ฝึกเป็นคู่ สลับบทบาท',
 'Komunikacja z partnerem przez cały czas.', 'สื่อสารกับคู่ตลอดเวลา',
 'Pierwszy kontakt z techniką za nami.', 'สัมผัสเทคนิคครั้งแรกผ่านไปแล้ว',
 '["Jak sprawdzić, czy nacisk jest dobry?"]'::jsonb, 6, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-07', '14:00', '💆',
 'Praktyka: plecy, talia, biodra', 'หลัง เอว สะโพก',
 90,
 'Techniki na partie środkowe ciała.', 'เทคนิคสำหรับส่วนกลางลำตัว',
 'Te partie lubią równomierny, spokojny nacisk.', 'ส่วนเหล่านี้ชอบแรงกดที่สม่ำเสมอและนุ่มนวล',
 'Demonstruje przejścia między strefami.', 'สาธิตการเปลี่ยนผ่านระหว่างโซน',
 'Ćwiczą sekwencję plecy → talia → biodra.', 'ฝึกลำดับ หลัง → เอว → สะโพก',
 'Omijaj kręgosłup — pracuj po bokach.', 'หลีกเลี่ยงกระดูกสันหลัง — ทำงานด้านข้าง',
 'Umiemy prowadzić środek ciała.', 'เรานำส่วนกลางลำตัวได้แล้ว',
 '["Gdzie NIE naciskać na plecach?"]'::jsonb, 7, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-08', '15:30', '🔍',
 'Najczęstsze błędy', 'ข้อผิดพลาดที่พบบ่อย',
 60,
 'Rozpoznawanie i korekta typowych pomyłek.', 'รู้จักและแก้ไขข้อผิดพลาดทั่วไป',
 'Większość błędów to za dużo siły, za mało obserwacji.', 'ข้อผิดพลาดส่วนใหญ่คือแรงมากไป สังเกตน้อยไป',
 'Pokazuje błąd i jego poprawną wersję.', 'แสดงข้อผิดพลาดและวิธีที่ถูกต้อง',
 'Wychwytują błędy u siebie nawzajem.', 'ช่วยกันสังเกตข้อผิดพลาดของกันและกัน',
 'Błąd to nauka — koryguj bez oceniania.', 'ข้อผิดพลาดคือการเรียนรู้ — แก้ไขโดยไม่ตัดสิน',
 'Wiemy, czego unikać.', 'เรารู้แล้วว่าต้องเลี่ยงอะไร',
 '["Jaki błąd popełniasz najczęściej?"]'::jsonb, 8, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-09', '16:30', '🌟',
 'Podsumowanie dnia', 'สรุปประจำวัน',
 30,
 'Utrwalenie i przygotowanie na jutro.', 'ทบทวนและเตรียมพร้อมสำหรับวันพรุ่งนี้',
 'Dziś położyliśmy fundament: bezpieczeństwo i szacunek.', 'วันนี้เราวางรากฐาน: ความปลอดภัยและความเคารพ',
 'Docenia postępy, wskazuje kierunek na jutro.', 'ชื่นชมความก้าวหน้า ชี้ทิศทางวันพรุ่งนี้',
 'Dzielą się jednym wnioskiem z dnia.', 'แบ่งปันข้อคิดหนึ่งอย่างจากวันนี้',
 'Zakończ pozytywnie i z wdzięcznością.', 'จบด้วยความรู้สึกดีและความขอบคุณ',
 'Dzień 1 zamknięty — do zobaczenia jutro.', 'ปิดวันแรกแล้ว — พบกันใหม่พรุ่งนี้',
 '["Co zapamiętasz z dziś?"]'::jsonb, 9, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;
insert into public.etap
 (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th, czas_min, cel_pl, cel_th,
  agent_mowi_pl, agent_mowi_th, pokazuje_pl, pokazuje_th,
  kursanci_robia_pl, kursanci_robia_th, uwaga_pl, uwaga_th,
  podsumowanie_pl, podsumowanie_th, pytania, kolejnosc, opublikowany)
select l.id, 'D1-10', '17:00', '🍵',
 'Herbata i pytania', 'ชาและถามตอบ',
 30,
 'Swobodne pytania przy tajskiej herbacie.', 'ถามตอบอย่างสบายๆ พร้อมชาไทย',
 'Pytajcie o wszystko — w dowolnym języku.', 'ถามได้ทุกเรื่อง — ภาษาใดก็ได้',
 'Rozmawia nieformalnie, dzieli się historiami.', 'พูดคุยเป็นกันเอง แบ่งปันเรื่องราว',
 'Zadają pytania, integrują się.', 'ถามคำถาม สร้างความสัมพันธ์',
 'To też część nauki — relacja i zaufanie.', 'นี่ก็เป็นส่วนหนึ่งของการเรียนรู้',
 'Zamykamy dzień w dobrej energii.', 'ปิดท้ายวันด้วยพลังงานที่ดี',
 '["O co chcesz jeszcze zapytać?"]'::jsonb, 10, true
from public.lekcja l join public.kurs k on k.id = l.kurs_id
where k.kod = 'podstawowy' and l.dzien = 1
on conflict (lekcja_id, kod) do nothing;

insert into public.material (kurs_id, etap_id, typ, nazwa_pl, opis, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '09:45 Zasady bezpieczeństwa' like '%'||e.godzina||'%' limit 1),
 'zdjecie', 'Mapa ciała — strefy wrażliwe', 'Zdjęcie z miejscami wrażliwymi',
 'kurs/'||k.id||'/zdjecie/'||replace(lower('Mapa ciała — strefy wrażliwe'),' ','-'), false
from public.kurs k where k.kod = 'podstawowy';
insert into public.material (kurs_id, etap_id, typ, nazwa_pl, opis, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '09:45 Zasady bezpieczeństwa' like '%'||e.godzina||'%' limit 1),
 'wideo', 'Demo bezpiecznego nacisku (40s)', 'Krótkie demo poprawnego nacisku',
 'kurs/'||k.id||'/wideo/'||replace(lower('Demo bezpiecznego nacisku (40s)'),' ','-'), false
from public.kurs k where k.kod = 'podstawowy';
insert into public.material (kurs_id, etap_id, typ, nazwa_pl, opis, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '11:00 Demonstracja' like '%'||e.godzina||'%' limit 1),
 'wideo', 'Pełna sekwencja — leżenie na brzuchu', 'Nagranie całej sekwencji',
 'kurs/'||k.id||'/wideo/'||replace(lower('Pełna sekwencja — leżenie na brzuchu'),' ','-'), false
from public.kurs k where k.kod = 'podstawowy';
insert into public.material (kurs_id, etap_id, typ, nazwa_pl, opis, sciezka, opublikowany)
select k.id,
 (select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id
   where l.kurs_id=k.id and '14:00 Plecy, talia, biodra' like '%'||e.godzina||'%' limit 1),
 'zdjecie', 'Schemat stref pleców', 'Rysunek stref bezpiecznych',
 'kurs/'||k.id||'/zdjecie/'||replace(lower('Schemat stref pleców'),' ','-'), false
from public.kurs k where k.kod = 'podstawowy';

-- Baza wiedzy z arkusza ③ (na razie jako komentarz — do osobnej tabeli FAQ)
--   Jak mocno kursant ma naciskać na początku? / ในช่วงแรกควรกดแรงแค่ไหน?
--   Co robić, gdy klient mówi, że boli? / ถ้าลูกค้าบอกว่าเจ็บทำอย่างไร?
--   Których miejsc nie wolno mocno uciskać? / ห้ามกดแรงตรงไหน?
--   Jak nie męczyć rąk? / จะไม่ให้มือล้าอย่างไร?

commit;
