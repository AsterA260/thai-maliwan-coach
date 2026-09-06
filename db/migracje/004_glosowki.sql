-- ═══════════════════════════════════════════════════════════════════
--  GŁOSÓWKI MALIWAN                                  [Etap 1 migracji]
--
--  Nagranie nie jest zwykłym `material`. Niesie transkrypcję,
--  tłumaczenie, wersję, status zatwierdzenia i autora — a plik audio
--  leży w S3, nie w bazie. Dlatego osobna encja domenowa.
-- ═══════════════════════════════════════════════════════════════════

-- ── UUID WŁAŚCICIELA Z KLUCZA S3 ──────────────────────────────────
--  Ta sama dyscyplina, którą mamy przy materiałach: klucz pliku musi
--  wskazywać encję, do której nagranie należy. Bez tego dałoby się
--  podpiąć rekord swojej techniki do cudzego nagrania.
--
--    glosowka/technika/<uuid techniki>/<uuid glosowki>.<ext>
--    glosowka/etap/<uuid etapu>/<uuid glosowki>.<ext>
create or replace function public.glosowka_z_klucza(p_klucz text)
returns uuid language sql immutable as $$
  select case
    when split_part(p_klucz,'/',1) = 'glosowka'
     and split_part(p_klucz,'/',2) in ('technika','etap')
     and split_part(p_klucz,'/',3) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     and split_part(p_klucz,'/',4) <> ''
     and p_klucz !~ '\.\.'
    then split_part(p_klucz,'/',3)::uuid
    else null end
$$;

comment on function public.glosowka_z_klucza(text) is
  'UUID techniki albo etapu wyjęty z klucza S3 nagrania. NULL, gdy klucz ma zły kształt.';

create table if not exists public.glosowka (
  id             uuid primary key default gen_random_uuid(),

  -- dokładnie jedno z dwóch: technika albo etap
  technika_id    uuid references public.technika(id) on delete restrict,
  etap_id        uuid references public.etap(id)     on delete restrict,

  jezyk_zrodlowy text not null references public.jezyk(kod),
  klucz_s3       text not null unique,
  mime           text,
  czas_s         int,
  rozmiar_b      bigint,

  nagral_id      uuid not null references public.profile(id),
  utworzone      timestamptz not null default now(),

  constraint glosowka_jeden_wlasciciel check (
    (technika_id is not null)::int + (etap_id is not null)::int = 1),

  -- `is not null` NIE JEST tu ozdobnikiem. Klucz o złym kształcie daje
  -- z funkcji NULL, a warunek `NULL = uuid` to NULL — czego CHECK
  -- w PostgreSQL NIE odrzuca, bo odrzuca wyłącznie FALSE. Bez tego
  -- członu klucz `glosowka/technika/x/plik.m4a` przechodziłby bez
  -- mrugnięcia. Wykrył to test 22... a właściwie 27.
  constraint glosowka_klucz_zgodny check (
    public.glosowka_z_klucza(klucz_s3) is not null
    and public.glosowka_z_klucza(klucz_s3) = coalesce(technika_id, etap_id))
);

comment on constraint glosowka_klucz_zgodny on public.glosowka is
  'Klucz S3 musi wskazywac dokladnie te encje, do ktorej nagranie nalezy.';

create index if not exists idx_glosowka_technika on public.glosowka(technika_id);
create index if not exists idx_glosowka_etap     on public.glosowka(etap_id);

create table if not exists public.glosowka_wersja (
  id             uuid primary key default gen_random_uuid(),
  glosowka_id    uuid not null references public.glosowka(id) on delete cascade,
  numer          int  not null,
  status         public.status_wersji not null default 'draft',

  autor_id       uuid not null references public.profile(id),
  utworzone      timestamptz not null default now(),
  zmienione      timestamptz not null default now(),

  zatwierdzil_id uuid references public.profile(id),
  zatwierdzone_o timestamptz,
  komentarz      text,

  unique (glosowka_id, numer),
  constraint glosowka_wersja_zatwierdzenie check (
    (status in ('zatwierdzone','zastapione'))
      = (zatwierdzil_id is not null and zatwierdzone_o is not null))
);

create unique index if not exists glosowka_wersja_jedna_zatwierdzona
  on public.glosowka_wersja (glosowka_id) where status = 'zatwierdzone';

-- ── TRANSKRYPCJA I TŁUMACZENIE ────────────────────────────────────
--  Jedno pole `tresc`, a nie dwa. Rola wynika z porównania z językiem
--  źródłowym nagrania: wiersz w języku źródłowym JEST transkrypcją,
--  każdy inny JEST tłumaczeniem. Dwie osobne kolumny dawałyby stan,
--  w którym obie są wypełnione albo obie puste — czyli niespójność
--  do pilnowania w aplikacji zamiast w bazie.
create table if not exists public.glosowka_tekst (
  glosowka_wersja_id uuid not null
    references public.glosowka_wersja(id) on delete cascade,
  jezyk text not null references public.jezyk(kod),
  tresc text not null,
  uwagi text,
  primary key (glosowka_wersja_id, jezyk)
);

create or replace view public.widok_glosowka_tekst
with (security_invoker = true) as
select t.glosowka_wersja_id,
       t.jezyk,
       t.tresc,
       t.uwagi,
       w.glosowka_id,
       w.numer   as numer_wersji,
       w.status,
       case when t.jezyk = g.jezyk_zrodlowy then 'transkrypcja'
            else 'tlumaczenie' end as rodzaj
from public.glosowka_tekst t
join public.glosowka_wersja w on w.id = t.glosowka_wersja_id
join public.glosowka g        on g.id = w.glosowka_id;

drop trigger if exists glosowka_wersja_przejscie on public.glosowka_wersja;
create trigger glosowka_wersja_przejscie before insert or update on public.glosowka_wersja
  for each row execute function public.sprawdz_przejscie_wersji();

drop trigger if exists glosowka_tekst_zamkniety on public.glosowka_tekst;
create trigger glosowka_tekst_zamkniety
  before insert or update or delete on public.glosowka_tekst
  for each row execute function public.chron_tekst_zatwierdzony('glosowka_wersja','glosowka_wersja_id');

drop trigger if exists technika_tekst_zamkniety on public.technika_tekst;
create trigger technika_tekst_zamkniety
  before insert or update or delete on public.technika_tekst
  for each row execute function public.chron_tekst_zatwierdzony('technika_wersja','technika_wersja_id');
