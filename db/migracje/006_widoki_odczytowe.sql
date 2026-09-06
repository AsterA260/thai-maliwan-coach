-- ═══════════════════════════════════════════════════════════════════
--  WIDOKI ODCZYTOWE                                  [Etap 1 migracji]
--
--  Po rozbiciu tekstów na tabele każde zapytanie o kurs czy etap
--  wymagałoby złączenia z tłumaczeniem i wyboru języka. Robienie tego
--  w każdym miejscu kodu z osobna to prosta droga do tego, że gdzieś
--  zostanie zaszyte „pl" na sztywno — dokładnie tak, jak było dotąd.
--
--  Dlatego język wybiera BAZA, raz, w tych widokach:
--    1. język z profilu zalogowanego,
--    2. gdy w tym języku nie ma tekstu — polski.
--
--  Dzięki temu aplikacja pyta o `nazwa`, nie o `nazwa_pl`, i tajski
--  zaczyna działać bez jednej linijki w kodzie ekranu.
--
--  Wszystkie widoki mają `security_invoker`, więc RLS tabel źródłowych
--  obowiązuje tak samo jak przy zapytaniu wprost.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.moj_jezyk()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select jezyk from public.profile where id = public.uid()), 'pl')
$$;

comment on function public.moj_jezyk() is
  'Język zalogowanego; gdy nie ma tożsamości albo profilu — polski.';

-- ── KURS ──────────────────────────────────────────────────────────
create or replace view public.widok_kurs
with (security_invoker = true) as
select k.id, k.kod,
       coalesce(t.nazwa, pl.nazwa) as nazwa,
       coalesce(t.opis,  pl.opis)  as opis,
       k.instruktor_id, k.dni, k.godzin, k.cena_gr, k.opublikowany, k.utworzone
  from public.kurs k
  left join public.kurs_tekst t  on t.kurs_id  = k.id and t.jezyk  = public.moj_jezyk()
  left join public.kurs_tekst pl on pl.kurs_id = k.id and pl.jezyk = 'pl';

-- ── LEKCJA ────────────────────────────────────────────────────────
create or replace view public.widok_lekcja
with (security_invoker = true) as
select l.id, l.kurs_id, l.dzien,
       coalesce(t.tytul, pl.tytul) as tytul,
       l.kolejnosc, l.opublikowana
  from public.lekcja l
  left join public.lekcja_tekst t  on t.lekcja_id  = l.id and t.jezyk  = public.moj_jezyk()
  left join public.lekcja_tekst pl on pl.lekcja_id = l.id and pl.jezyk = 'pl';

-- ── MATERIAŁ ──────────────────────────────────────────────────────
create or replace view public.widok_material
with (security_invoker = true) as
select m.id, m.kurs_id, m.etap_id, m.typ,
       coalesce(t.nazwa, pl.nazwa) as nazwa,
       coalesce(t.opis,  pl.opis)  as opis,
       m.sciezka, m.rozmiar_b, m.mime, m.opublikowany, m.dodal_id, m.utworzone
  from public.material m
  left join public.material_tekst t  on t.material_id  = m.id and t.jezyk  = public.moj_jezyk()
  left join public.material_tekst pl on pl.material_id = m.id and pl.jezyk = 'pl';

-- ── ETAP ──────────────────────────────────────────────────────────
--  Pokazuje treść z wersji ZATWIERDZONEJ. Etap bez zatwierdzonej
--  wersji jest widoczny strukturalnie (kod, godzina, kolejność), ale
--  bez treści — i to jest zachowanie zamierzone: kursant nie ma prawa
--  zobaczyć słów, których Maliwan jeszcze nie zatwierdziła.
create or replace view public.widok_etap
with (security_invoker = true) as
select e.id, e.lekcja_id, e.kod, e.godzina, e.ikona, e.czas_min,
       e.pytania, e.kolejnosc, e.opublikowany,
       w.id     as wersja_id,
       w.numer  as wersja_numer,
       coalesce(t.nazwa,          pl.nazwa)          as nazwa,
       coalesce(t.cel,            pl.cel)            as cel,
       coalesce(t.agent_mowi,     pl.agent_mowi)     as agent_mowi,
       coalesce(t.pokazuje,       pl.pokazuje)       as pokazuje,
       coalesce(t.kursanci_robia, pl.kursanci_robia) as kursanci_robia,
       coalesce(t.uwaga,          pl.uwaga)          as uwaga,
       coalesce(t.podsumowanie,   pl.podsumowanie)   as podsumowanie
  from public.etap e
  left join public.etap_wersja w
         on w.etap_id = e.id and w.status = 'zatwierdzone'
  left join public.etap_tekst t
         on t.etap_wersja_id = w.id and t.jezyk = public.moj_jezyk()
  left join public.etap_tekst pl
         on pl.etap_wersja_id = w.id and pl.jezyk = 'pl';

-- ── TECHNIKA ──────────────────────────────────────────────────────
create or replace view public.widok_technika
with (security_invoker = true) as
select tech.id, tech.kod,
       w.id    as wersja_id,
       w.numer as wersja_numer,
       coalesce(t.nazwa,     pl.nazwa)     as nazwa,
       coalesce(t.opis,      pl.opis)      as opis,
       coalesce(t.wskazowki, pl.wskazowki) as wskazowki,
       coalesce(t.bledy,     pl.bledy)     as bledy
  from public.technika tech
  left join public.technika_wersja w
         on w.technika_id = tech.id and w.status = 'zatwierdzone'
  left join public.technika_tekst t
         on t.technika_wersja_id = w.id and t.jezyk = public.moj_jezyk()
  left join public.technika_tekst pl
         on pl.technika_wersja_id = w.id and pl.jezyk = 'pl';

-- ── GŁOSÓWKA ──────────────────────────────────────────────────────
create or replace view public.widok_glosowka
with (security_invoker = true) as
select g.id, g.technika_id, g.etap_id, g.jezyk_zrodlowy, g.klucz_s3,
       g.mime, g.czas_s, g.rozmiar_b, g.nagral_id, g.utworzone,
       w.id    as wersja_id,
       w.numer as wersja_numer,
       coalesce(t.tresc, zr.tresc) as tresc,
       case when public.moj_jezyk() = g.jezyk_zrodlowy then 'transkrypcja'
            when t.tresc is not null                   then 'tlumaczenie'
            else 'transkrypcja' end as rodzaj
  from public.glosowka g
  left join public.glosowka_wersja w
         on w.glosowka_id = g.id and w.status = 'zatwierdzone'
  left join public.glosowka_tekst t
         on t.glosowka_wersja_id = w.id and t.jezyk = public.moj_jezyk()
  left join public.glosowka_tekst zr
         on zr.glosowka_wersja_id = w.id and zr.jezyk = g.jezyk_zrodlowy;

grant select on public.widok_kurs, public.widok_lekcja, public.widok_material,
                public.widok_etap, public.widok_technika, public.widok_glosowka
  to authenticated, astera_api;

grant execute on function public.moj_jezyk() to authenticated, astera_api;
