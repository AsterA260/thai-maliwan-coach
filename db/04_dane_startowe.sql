-- ═══════════════════════════════════════════════════════════════════
--  Dane startowe — konta, kursy, przypisania
--
--  UWAGA: na Supabase kont NIE zakłada się tym plikiem. Konta zakłada
--  administrator w panelu (Auth → Invite user) albo przez Admin API.
--  Tutaj ustawiamy tylko ROLE dla kont, które już istnieją.
--  Sekcja 1 (wstawianie do auth.users) działa wyłącznie lokalnie.
-- ═══════════════════════════════════════════════════════════════════

begin;

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
on conflict (id) do update set rola = excluded.rola, imie = excluded.imie;

-- ── 3. KURSY (nazwy zgodne z thaimaliwan.pl/szkola) ──────────────
insert into public.kurs (id, kod, nazwa_pl, nazwa_th, dni, godzin, cena_gr,
                         instruktor_id, opublikowany) values
 ('aaaaaaaa-0000-0000-0000-000000000001','podstawowy',
  'Tradycyjny masaż tajski','นวดแผนไทยดั้งเดิม', 2, 12, 190000,
  '22222222-2222-2222-2222-222222222222', true),
 ('aaaaaaaa-0000-0000-0000-000000000002','mistrzowski',
  'Rozszerzony masaż tajski','นวดแผนไทยขั้นขยาย', 3, 18, 260000,
  '22222222-2222-2222-2222-222222222222', true),
 ('aaaaaaaa-0000-0000-0000-000000000003','profesjonalny',
  'Kompleksowe szkolenie praktyczne','หลักสูตรปฏิบัติแบบครบวงจร', 5, 30, 390000,
  '22222222-2222-2222-2222-222222222222', false)   -- jeszcze nieopublikowany
on conflict (kod) do update set
  nazwa_pl = excluded.nazwa_pl, nazwa_th = excluded.nazwa_th,
  instruktor_id = excluded.instruktor_id, opublikowany = excluded.opublikowany;

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
insert into public.lekcja (id, kurs_id, dzien, tytul_pl, tytul_th, kolejnosc, opublikowana)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
        1,'Dzień 1 — stopy','วันที่ 1 — เท้า',1,true)
on conflict (kurs_id, dzien) do nothing;

insert into public.etap (lekcja_id, kod, godzina, ikona, nazwa_pl, nazwa_th,
                         czas_min, cel_pl, kolejnosc, opublikowany)
values ('bbbbbbbb-0000-0000-0000-000000000001','M1-01','09:00','🙏',
        'Powitanie i zasady','ต้อนรับและกฎ',30,
        'Grupa zna plan i zasady bezpieczeństwa.',1,true)
on conflict (lekcja_id, kod) do nothing;

-- ── 6. MATERIAŁ TYLKO DLA KURSU MISTRZOWSKIEGO ───────────────────
insert into public.material (id, kurs_id, typ, nazwa_pl, sciezka, opublikowany, dodal_id)
values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
        'pdf','Mapa stref na stopie',
        'kurs/aaaaaaaa-0000-0000-0000-000000000002/pdf/mapa-stref.pdf', true,
        '22222222-2222-2222-2222-222222222222')
on conflict (sciezka) do nothing;

commit;
