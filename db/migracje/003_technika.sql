-- ═══════════════════════════════════════════════════════════════════
--  TECHNIKA                                          [Etap 1 migracji]
--
--  Najniższym poziomem był dotąd etap. Ale głosówka Maliwan ma być
--  przypięta „do techniki", a jedna technika wraca w wielu etapach
--  i kursach. Bez osobnego bytu trzeba by duplikować nagrania,
--  transkrypcje i tłumaczenia przy każdym powtórzeniu.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.technika (
  id        uuid primary key default gen_random_uuid(),
  kod       text not null unique,        -- np. 'stopy-rozgrzewka'
  utworzone timestamptz not null default now()
);

comment on table public.technika is
  'Pojedyncza technika masażu. Jedna, niezależnie od tego, w ilu etapach wraca.';

create table if not exists public.technika_wersja (
  id             uuid primary key default gen_random_uuid(),
  technika_id    uuid not null references public.technika(id) on delete cascade,
  numer          int  not null,
  status         public.status_wersji not null default 'draft',

  autor_id       uuid not null references public.profile(id),
  utworzone      timestamptz not null default now(),
  zmienione      timestamptz not null default now(),

  zatwierdzil_id uuid references public.profile(id),
  zatwierdzone_o timestamptz,
  komentarz      text,

  unique (technika_id, numer),
  constraint technika_wersja_zatwierdzenie check (
    (status in ('zatwierdzone','zastapione'))
      = (zatwierdzil_id is not null and zatwierdzone_o is not null))
);

create unique index if not exists technika_wersja_jedna_zatwierdzona
  on public.technika_wersja (technika_id) where status = 'zatwierdzone';

create table if not exists public.technika_tekst (
  technika_wersja_id uuid not null
    references public.technika_wersja(id) on delete cascade,
  jezyk     text not null references public.jezyk(kod),
  nazwa     text not null,
  opis      text,
  wskazowki text,     -- na co zwrócić uwagę
  bledy     text,     -- najczęstsze błędy
  primary key (technika_wersja_id, jezyk)
);

-- ── TECHNIKA W ETAPIE ─────────────────────────────────────────────
--  `on delete restrict` przy technice jest celowe: skasowanie etapu
--  nie może pociągnąć za sobą techniki, która jest używana gdzie
--  indziej. Przy kaskadzie jedno nieuważne usunięcie zabrałoby wiedzę
--  z pozostałych kursów.
create table if not exists public.etap_technika (
  etap_id     uuid not null references public.etap(id)     on delete cascade,
  technika_id uuid not null references public.technika(id) on delete restrict,
  kolejnosc   int  not null default 0,
  primary key (etap_id, technika_id)
);

create index if not exists idx_etap_technika_technika
  on public.etap_technika(technika_id);

drop trigger if exists technika_wersja_przejscie on public.technika_wersja;
create trigger technika_wersja_przejscie before insert or update on public.technika_wersja
  for each row execute function public.sprawdz_przejscie_wersji();
