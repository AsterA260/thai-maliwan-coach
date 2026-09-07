-- ═══════════════════════════════════════════════════════════════════
--  PROFIL NIE ZALEŻY JUŻ OD auth.users                        [Etap 2]
--
--  Do dziś `profile.id` był kluczem obcym do `auth.users(id)` — tabeli,
--  którą na Supabase utrzymywał Auth, a lokalnie atrapa
--  (db/00_supabase_lokalnie.sql). Wyzwalacz na `auth.users` zakładał
--  profil dla każdego nowego konta.
--
--  W docelowej architekturze konta żyją w Cognito, a bazę o nowym
--  użytkowniku informuje AsterA Core — jawnym zapisem do `profile`
--  w tej samej transakcji, w której administrator zaprasza. Klucz obcy
--  do `auth.users` stał się więc kotwicą do warstwy, która odchodzi:
--  identyfikator z Cognito (`sub`, UUID) nie ma i nie będzie miał
--  wiersza w `auth.users`.
--
--  Ta migracja zdejmuje wyłącznie klucz obcy. Wyzwalacz na `auth.users`
--  zostaje, dopóki istnieje atrapa — lokalne testy i seed nadal
--  zakładają konta tą drogą. Zniknie razem z atrapą po Etapie 7.
-- ═══════════════════════════════════════════════════════════════════

alter table public.profile drop constraint if exists profile_id_fkey;

comment on column public.profile.id is
  'Tozsamosc z dostawcy (Cognito `sub`). Nie jest kluczem obcym do niczego — konta zyja poza baza.';

-- Zdejmując klucz obcy, tracimy `on delete cascade` z auth.users.
-- Kasowanie konta jest sprawą Core (Cognito + profil w jednej operacji),
-- więc nic nie zastępuje kaskady po stronie bazy — i tak ma być.
