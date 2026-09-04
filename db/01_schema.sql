-- ═══════════════════════════════════════════════════════════════════
--  AsterA Coach — schemat bazy
--  Zgodny z Supabase. auth.users tworzy Supabase Auth; my dokładamy
--  tabelę public.profile powiązaną 1:1 z auth.users.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── ROLE ───────────────────────────────────────────────────────────
do $$ begin
  create type public.rola_uzytkownika as enum ('admin','instruktor','kursant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.status_postepu as enum ('nierozpoczety','w_trakcie','zrobione');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.typ_materialu as enum ('zdjecie','wideo','pdf','audio','inny');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.status_pytania as enum ('nowe','odpowiedziane','zamkniete');
exception when duplicate_object then null; end $$;

-- ── PROFILE ────────────────────────────────────────────────────────
create table if not exists public.profile (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  imie         text not null,
  rola         public.rola_uzytkownika not null default 'kursant',
  aktywne      boolean not null default true,
  jezyk        text not null default 'pl' check (jezyk in ('pl','th')),
  utworzone    timestamptz not null default now()
);
comment on table public.profile is 'Konto w systemie. Rola decyduje o wszystkim.';

-- ── KURSY ──────────────────────────────────────────────────────────
create table if not exists public.kurs (
  id            uuid primary key default gen_random_uuid(),
  kod           text not null unique,
  nazwa_pl      text not null,
  nazwa_th      text,
  opis_pl       text,
  opis_th       text,
  instruktor_id uuid references public.profile(id) on delete set null,
  dni           int  not null default 2,
  godzin        int  not null default 12,
  cena_gr       bigint,
  opublikowany  boolean not null default false,
  utworzone     timestamptz not null default now()
);

-- ── PRZYPISANIA KURSANTÓW ─────────────────────────────────────────
create table if not exists public.przypisanie (
  id             uuid primary key default gen_random_uuid(),
  kurs_id        uuid not null references public.kurs(id)    on delete cascade,
  kursant_id     uuid not null references public.profile(id) on delete cascade,
  przypisal_id   uuid references public.profile(id) on delete set null,
  aktywne        boolean not null default true,
  utworzone      timestamptz not null default now(),
  unique (kurs_id, kursant_id)
);

-- ── LEKCJE (dni szkolenia) ────────────────────────────────────────
create table if not exists public.lekcja (
  id           uuid primary key default gen_random_uuid(),
  kurs_id      uuid not null references public.kurs(id) on delete cascade,
  dzien        int  not null,
  tytul_pl     text not null,
  tytul_th     text,
  kolejnosc    int  not null default 0,
  opublikowana boolean not null default false,
  unique (kurs_id, dzien)
);

-- ── ETAPY (bloki wewnątrz dnia) ───────────────────────────────────
create table if not exists public.etap (
  id                uuid primary key default gen_random_uuid(),
  lekcja_id         uuid not null references public.lekcja(id) on delete cascade,
  kod               text not null,
  godzina           text,
  ikona             text,
  nazwa_pl          text not null,
  nazwa_th          text,
  czas_min          int,
  cel_pl            text,
  cel_th            text,
  agent_mowi_pl     text,
  agent_mowi_th     text,
  pokazuje_pl       text,
  pokazuje_th       text,
  kursanci_robia_pl text,
  kursanci_robia_th text,
  uwaga_pl          text,
  uwaga_th          text,
  podsumowanie_pl   text,
  podsumowanie_th   text,
  pytania           jsonb not null default '[]'::jsonb,
  kolejnosc         int not null default 0,
  opublikowany      boolean not null default false,
  unique (lekcja_id, kod)
);

-- ── MATERIAŁY (pliki w prywatnym Storage) ─────────────────────────
create table if not exists public.material (
  id            uuid primary key default gen_random_uuid(),
  kurs_id       uuid not null references public.kurs(id) on delete cascade,
  etap_id       uuid references public.etap(id) on delete set null,
  typ           public.typ_materialu not null default 'inny',
  nazwa_pl      text not null,
  nazwa_th      text,
  opis          text,
  sciezka       text not null,          -- klucz w bucketcie 'materialy'
  rozmiar_b     bigint,
  opublikowany  boolean not null default false,
  dodal_id      uuid references public.profile(id) on delete set null,
  utworzone     timestamptz not null default now()
);
comment on column public.material.sciezka is
  'Klucz w prywatnym buckecie. Zawsze zaczyna sie od kurs/<kurs_id>/';

-- ── POSTĘPY ───────────────────────────────────────────────────────
create table if not exists public.postep (
  id          uuid primary key default gen_random_uuid(),
  kursant_id  uuid not null references public.profile(id) on delete cascade,
  etap_id     uuid not null references public.etap(id)    on delete cascade,
  status      public.status_postepu not null default 'nierozpoczety',
  zmienione   timestamptz not null default now(),
  unique (kursant_id, etap_id)
);

-- ── PYTANIA DO MALIWAN ────────────────────────────────────────────
create table if not exists public.pytanie (
  id             uuid primary key default gen_random_uuid(),
  kursant_id     uuid not null references public.profile(id) on delete cascade,
  kurs_id        uuid not null references public.kurs(id)    on delete cascade,
  etap_id        uuid references public.etap(id) on delete set null,
  tresc          text not null,
  odpowiedz      text,
  odpowiedzial_id uuid references public.profile(id) on delete set null,
  status         public.status_pytania not null default 'nowe',
  utworzone      timestamptz not null default now()
);

-- ── INDEKSY ───────────────────────────────────────────────────────
create index if not exists idx_przypisanie_kursant on public.przypisanie(kursant_id);
create index if not exists idx_przypisanie_kurs    on public.przypisanie(kurs_id);
create index if not exists idx_lekcja_kurs         on public.lekcja(kurs_id);
create index if not exists idx_etap_lekcja         on public.etap(lekcja_id);
create index if not exists idx_material_kurs       on public.material(kurs_id);
create index if not exists idx_postep_kursant      on public.postep(kursant_id);
create index if not exists idx_pytanie_kurs        on public.pytanie(kurs_id);

-- ── NOWE KONTO Z auth.users → profil ──────────────────────────────
-- Rola zawsze 'kursant'. Podniesienie roli robi wyłącznie admin.
create or replace function public.obsluz_nowego_uzytkownika()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id, email, imie, rola)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'imie', split_part(new.email,'@',1)),
          'kursant')
  on conflict (id) do nothing;
  return new;
end $$;
