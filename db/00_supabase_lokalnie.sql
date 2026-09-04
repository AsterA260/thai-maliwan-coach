-- ═══════════════════════════════════════════════════════════════════
--  TYLKO DLA LOKALNYCH TESTÓW
--  Odtwarza to, co w Supabase daje gotowa warstwa Auth:
--  schemat auth, tabelę auth.users, funkcje auth.uid()/auth.role()
--  i role bazodanowe anon / authenticated / service_role.
--
--  NA SUPABASE TEGO PLIKU SIĘ NIE URUCHAMIA — tam to już istnieje.
-- ═══════════════════════════════════════════════════════════════════

create schema if not exists auth;

do $$ begin create role anon          nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin bypassrls; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to postgres;

create table if not exists auth.users (
  id                   uuid primary key default gen_random_uuid(),
  email                text unique not null,
  encrypted_password   text,
  raw_user_meta_data   jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

-- Dokładnie ta sama definicja, której używa Supabase.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true)::json->>'role',''), 'anon')
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
