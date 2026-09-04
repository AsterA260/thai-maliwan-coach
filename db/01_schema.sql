-- ═══════════════════════════════════════════════════════════════════
--  AsterA Coach — schemat bazy
--  Zgodny z Supabase. auth.users tworzy Supabase Auth; my dokładamy
--  tabelę public.profile powiązaną 1:1 z auth.users.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── TYPY ───────────────────────────────────────────────────────────
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

-- ── UUID KURSU ZE ŚCIEŻKI PLIKU ───────────────────────────────────
--  Ścieżka materiału ma obowiązkowy kształt: kurs/<uuid>/<typ>/<plik>
--  Ta funkcja jest fundamentem kontroli dostępu do plików — używa jej
--  ograniczenie w tabeli material ORAZ polityka Storage.
create or replace function public.kurs_ze_sciezki(p_sciezka text)
returns uuid language sql immutable as $$
  select case
    when split_part(p_sciezka,'/',1) = 'kurs'
     and split_part(p_sciezka,'/',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     and split_part(p_sciezka,'/',3) <> ''
     and split_part(p_sciezka,'/',4) <> ''
     and p_sciezka !~ '\.\.'
    then split_part(p_sciezka,'/',2)::uuid
    else null end
$$;

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
  sciezka       text not null,
  rozmiar_b     bigint,
  mime          text,
  opublikowany  boolean not null default false,
  dodal_id      uuid references public.profile(id) on delete set null,
  utworzone     timestamptz not null default now(),

  -- ZAMKNIĘCIE LUKI: kurs w rekordzie MUSI być tym samym kursem, co
  -- kurs zapisany w ścieżce pliku. Bez tego dałoby się podpiąć rekord
  -- swojego kursu do pliku należącego do cudzego.
  constraint material_sciezka_zgodna_z_kursem
    check (public.kurs_ze_sciezki(sciezka) = kurs_id)
);
comment on constraint material_sciezka_zgodna_z_kursem on public.material is
  'Sciezka musi miec ksztalt kurs/<kurs_id>/<typ>/<plik> i wskazywac ten sam kurs.';

-- Jedna ścieżka = jeden rekord. Chroni przed dublowaniem przy imporcie
-- i przed dwoma rekordami wskazującymi ten sam plik.
create unique index if not exists material_sciezka_unikalna on public.material(sciezka);

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
  odpowiedziano  timestamptz,
  status         public.status_pytania not null default 'nowe',
  utworzone      timestamptz not null default now()
);

-- ── ZAPROSZENIA (zakładanie kont bez rejestracji publicznej) ──────
create table if not exists public.zaproszenie (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  imie         text not null,
  rola         public.rola_uzytkownika not null default 'kursant',
  kurs_id      uuid references public.kurs(id) on delete set null,
  token_hash   text not null,            -- tylko skrót, nigdy sam token
  zaprosil_id  uuid references public.profile(id) on delete set null,
  wygasa       timestamptz not null default now() + interval '7 days',
  wykorzystane timestamptz,
  utworzone    timestamptz not null default now()
);
create index if not exists idx_zaproszenie_email on public.zaproszenie(lower(email));

-- ── INDEKSY ───────────────────────────────────────────────────────
create index if not exists idx_przypisanie_kursant on public.przypisanie(kursant_id);
create index if not exists idx_przypisanie_kurs    on public.przypisanie(kurs_id);
create index if not exists idx_lekcja_kurs         on public.lekcja(kurs_id);
create index if not exists idx_etap_lekcja         on public.etap(lekcja_id);
create index if not exists idx_material_kurs       on public.material(kurs_id);
create index if not exists idx_postep_kursant      on public.postep(kursant_id);
create index if not exists idx_pytanie_kurs        on public.pytanie(kurs_id);

-- ═══════════════════════════════════════════════════════════════════
--  WYZWALACZE — spójność, której nie da się wyrazić polityką RLS
-- ═══════════════════════════════════════════════════════════════════

-- ── Nowe konto z auth.users → profil ──────────────────────────────
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

-- ── Pytanie: etap musi należeć do tego samego kursu ───────────────
create or replace function public.sprawdz_pytanie()
returns trigger language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if new.etap_id is not null then
    select l.kurs_id into k
      from public.etap e join public.lekcja l on l.id = e.lekcja_id
     where e.id = new.etap_id;
    if k is null or k <> new.kurs_id then
      raise exception 'Etap nie nalezy do tego kursu.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists pytanie_spojnosc on public.pytanie;
create trigger pytanie_spojnosc before insert or update on public.pytanie
  for each row execute function public.sprawdz_pytanie();

-- ── Pytanie: instruktor zmienia TYLKO odpowiedź, status i autora odpowiedzi
create or replace function public.chron_pytanie()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.jestem_adminem() then
    return new;                       -- admin może wszystko
  end if;
  -- pola, których nie wolno ruszyć przy aktualizacji
  new.kursant_id := old.kursant_id;
  new.kurs_id    := old.kurs_id;
  new.etap_id    := old.etap_id;
  new.tresc      := old.tresc;
  new.utworzone  := old.utworzone;
  if new.odpowiedz is distinct from old.odpowiedz then
    new.odpowiedziano := now();
  end if;
  return new;
end $$;

drop trigger if exists pytanie_ochrona on public.pytanie;
create trigger pytanie_ochrona before update on public.pytanie
  for each row execute function public.chron_pytanie();

-- ── Postęp: etap musi należeć do kursu, na który kursant jest zapisany
create or replace function public.sprawdz_postep()
returns trigger language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  select l.kurs_id into k
    from public.etap e join public.lekcja l on l.id = e.lekcja_id
   where e.id = new.etap_id;
  if k is null then
    raise exception 'Taki etap nie istnieje.' using errcode = '23503';
  end if;
  if not (public.jestem_adminem()
          or exists (select 1 from public.przypisanie p
                     where p.kurs_id = k and p.kursant_id = new.kursant_id and p.aktywne)) then
    raise exception 'Kursant nie jest zapisany na kurs tego etapu.' using errcode = '42501';
  end if;
  new.zmienione := now();
  return new;
end $$;

drop trigger if exists postep_spojnosc on public.postep;
create trigger postep_spojnosc before insert or update on public.postep
  for each row execute function public.sprawdz_postep();

-- ── Profil: nikt sam sobie nie zmieni e-maila, roli ani aktywności ─
create or replace function public.chron_profil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.jestem_adminem() then
    -- ostatni aktywny administrator nie może zostać wyłączony ani zdegradowany
    if (old.rola = 'admin' and old.aktywne)
       and (new.rola <> 'admin' or new.aktywne = false)
       and (select count(*) from public.profile
             where rola = 'admin' and aktywne and id <> old.id) = 0 then
      raise exception 'To jedyny aktywny administrator — nie mozna go wylaczyc ani zdegradowac.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  new.email   := old.email;
  new.rola    := old.rola;
  new.aktywne := old.aktywne;
  new.id      := old.id;
  return new;
end $$;

drop trigger if exists profil_ochrona on public.profile;
create trigger profil_ochrona before update on public.profile
  for each row execute function public.chron_profil();

-- ── Ostatni administrator nie może zostać skasowany ───────────────
create or replace function public.chron_ostatniego_admina()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.rola = 'admin' and old.aktywne
     and (select count(*) from public.profile
           where rola = 'admin' and aktywne and id <> old.id) = 0 then
    raise exception 'To jedyny aktywny administrator — nie mozna go usunac.'
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists profil_ostatni_admin on public.profile;
create trigger profil_ostatni_admin before delete on public.profile
  for each row execute function public.chron_ostatniego_admina();
