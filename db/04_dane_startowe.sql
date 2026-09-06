-- ═══════════════════════════════════════════════════════════════════
--  Dane startowe — konta, kursy, przypisania
--
--  UWAGA: na Supabase kont NIE zakłada się tym plikiem. Konta zakłada
--  administrator w panelu (Auth → Invite user) albo przez Admin API.
--  Tutaj ustawiamy tylko ROLE dla kont, które już istnieją.
--  Sekcja 1 (wstawianie do auth.users) działa wyłącznie lokalnie.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0. KONTEKST INICJALIZACJI ────────────────────────────────────
--  Bez tego wyzwalacz `chron_profil` cicho cofa nadanie ról: profil
--  powstaje z rolą 'kursant' (wyzwalacz na auth.users), a UPDATE
--  w sekcji 2 mówi „UPDATE 1" i nic nie zmienia — bo nie ma
--  zalogowanego administratora, który mógłby rolę nadać.
--  Ta sama furtka co przy zakładaniu pierwszego administratora:
--  flaga działa wyłącznie w transakcji i tylko wtedy, gdy nikt nie
--  jest zalogowany (patrz public.kontekst_inicjalizacji()).
select set_config('astera.inicjalizacja', 'tak', true);

-- ── 1. KONTA (lokalnie; na Supabase pomiń tę sekcję) ─────────────
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','norbert@thaimaliwan.pl','{"imie":"Norbert"}'),
 ('22222222-2222-2222-2222-222222222222','maliwan@thaimaliwan.pl','{"imie":"Maliwan"}'),
 ('33333333-3333-3333-3333-333333333333','ania@przyklad.pl',      '{"imie":"Ania"}'),
 ('44444444-4444-4444-4444-444444444444','piotr@przyklad.pl',     '{"imie":"Piotr"}'),
 ('55555555-5555-5555-5555-555555555555','ktos@obcy.pl',          '{"imie":"Ktoś Obcy"}')
on conflict (id) do nothing;

-- ── 2. PROFILE I ROLE ────────────────────────────────────────────
insert into public.profile (id, email, imie, rola, jezyk) values
 ('11111111-1111-1111-1111-111111111111','norbert@thaimaliwan.pl','Norbert','admin','pl'),
 ('22222222-2222-2222-2222-222222222222','maliwan@thaimaliwan.pl','Maliwan','instruktor','th'),
 ('33333333-3333-3333-3333-333333333333','ania@przyklad.pl',      'Ania',   'kursant','pl'),
 ('44444444-4444-4444-4444-444444444444','piotr@przyklad.pl',     'Piotr',  'kursant','pl'),
 ('55555555-5555-5555-5555-555555555555','ktos@obcy.pl',          'Ktoś Obcy','kursant','pl')
on conflict (id) do update set rola  = excluded.rola,
                               imie  = excluded.imie,
                               jezyk = excluded.jezyk;
--  `jezyk` doszedł do listy aktualizowanych pól świadomie: profil
--  powstaje z wyzwalacza z domyślnym 'pl', więc bez tego Maliwan
--  zostawała po polsku mimo wpisu 'th' wyżej — i tajski nie miał jak
--  się pokazać nawet po wprowadzeniu tłumaczeń.

-- ── 3. KURSY (nazwy zgodne z thaimaliwan.pl/szkola) ──────────────
insert into public.kurs (id, kod, dni, godzin, cena_gr, instruktor_id, opublikowany) values
 ('aaaaaaaa-0000-0000-0000-000000000001','podstawowy',    2, 12, 190000,
  '22222222-2222-2222-2222-222222222222', true),
 ('aaaaaaaa-0000-0000-0000-000000000002','mistrzowski',   3, 18, 260000,
  '22222222-2222-2222-2222-222222222222', true),
 ('aaaaaaaa-0000-0000-0000-000000000003','profesjonalny', 5, 30, 390000,
  '22222222-2222-2222-2222-222222222222', false)   -- jeszcze nieopublikowany
on conflict (kod) do update set
  instruktor_id = excluded.instruktor_id, opublikowany = excluded.opublikowany;

-- Nazwy i opisy kursów — po jednym wierszu na język.
insert into public.kurs_tekst (kurs_id, jezyk, nazwa) values
 ('aaaaaaaa-0000-0000-0000-000000000001','pl','Tradycyjny masaż tajski'),
 ('aaaaaaaa-0000-0000-0000-000000000001','th','นวดแผนไทยดั้งเดิม'),
 ('aaaaaaaa-0000-0000-0000-000000000002','pl','Rozszerzony masaż tajski'),
 ('aaaaaaaa-0000-0000-0000-000000000002','th','นวดแผนไทยขั้นขยาย'),
 ('aaaaaaaa-0000-0000-0000-000000000003','pl','Kompleksowe szkolenie praktyczne'),
 ('aaaaaaaa-0000-0000-0000-000000000003','th','หลักสูตรปฏิบัติแบบครบวงจร')
on conflict (kurs_id, jezyk) do update set nazwa = excluded.nazwa;

-- ── 4. PRZYPISANIA ───────────────────────────────────────────────
--  Ania  → podstawowy
--  Piotr → mistrzowski
--  Ktoś Obcy → nigdzie (konto bez kursu)
insert into public.przypisanie (kurs_id, kursant_id, przypisal_id) values
 ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111'),
 ('aaaaaaaa-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111')
on conflict (kurs_id, kursant_id) do nothing;

-- ── 5. LEKCJA I ETAPY KURSU MISTRZOWSKIEGO (skrót, do testów) ────
insert into public.lekcja (id, kurs_id, dzien, kolejnosc, opublikowana)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
        1, 1, true)
on conflict (kurs_id, dzien) do nothing;

insert into public.lekcja_tekst (lekcja_id, jezyk, tytul) values
 ('bbbbbbbb-0000-0000-0000-000000000001','pl','Dzień 1 — stopy'),
 ('bbbbbbbb-0000-0000-0000-000000000001','th','วันที่ 1 — เท้า')
on conflict (lekcja_id, jezyk) do update set tytul = excluded.tytul;

insert into public.etap (id, lekcja_id, kod, godzina, ikona, czas_min, kolejnosc, opublikowany)
values ('dddddddd-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001','M1-01','09:00','🙏',30,1,true)
on conflict (lekcja_id, kod) do nothing;

-- Treść etapu jest teraz WERSJĄ. Dane startowe wstawiają ją od razu
-- jako zatwierdzoną — to treść, z której realnie się korzysta.
insert into public.etap_wersja (id, etap_id, numer, status, autor_id,
                                zatwierdzil_id, zatwierdzone_o, komentarz)
values ('eeeeeeee-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 1, 'zatwierdzone',
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', now(),
        'Treść startowa.')
on conflict (etap_id, numer) do nothing;

insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel) values
 ('eeeeeeee-0000-0000-0000-000000000001','pl','Powitanie i zasady',
  'Grupa zna plan i zasady bezpieczeństwa.'),
 ('eeeeeeee-0000-0000-0000-000000000001','th','ต้อนรับและกฎ',
  'กลุ่มรู้แผนและกฎความปลอดภัย')
on conflict (etap_wersja_id, jezyk) do update set nazwa = excluded.nazwa;

-- ── 6. MATERIAŁ TYLKO DLA KURSU MISTRZOWSKIEGO ───────────────────
insert into public.material (id, kurs_id, typ, sciezka, opublikowany, dodal_id)
values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
        'pdf','kurs/aaaaaaaa-0000-0000-0000-000000000002/pdf/mapa-stref.pdf', true,
        '22222222-2222-2222-2222-222222222222')
on conflict (sciezka) do nothing;

insert into public.material_tekst (material_id, jezyk, nazwa) values
 ('cccccccc-0000-0000-0000-000000000001','pl','Mapa stref na stopie'),
 ('cccccccc-0000-0000-0000-000000000001','th','แผนที่โซนบนเท้า')
on conflict (material_id, jezyk) do update set nazwa = excluded.nazwa;

commit;
