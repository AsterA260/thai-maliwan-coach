-- ═══════════════════════════════════════════════════════════════════
--  AsterA Coach — Row Level Security
--
--  ZASADA: nie ufamy niczemu, co przychodzi z przeglądarki.
--  Uprawnienia są pilnowane w bazie. Zmiana adresu, otwarcie panelu
--  „na siłę", ręczne wywołanie API — wszystko trafia na te polityki.
--
--  Funkcje pomocnicze są SECURITY DEFINER, bo muszą czytać profil
--  bez wpadania w rekurencję własnych polityk.
-- ═══════════════════════════════════════════════════════════════════

-- ── FUNKCJE POMOCNICZE ────────────────────────────────────────────
create or replace function public.moja_rola()
returns text language sql stable security definer set search_path = public as $$
  select rola::text from public.profile where id = public.uid() and aktywne
$$;

create or replace function public.jestem_adminem()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rola = 'admin' from public.profile
                   where id = public.uid() and aktywne), false)
$$;

create or replace function public.jestem_instruktorem()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rola = 'instruktor' from public.profile
                   where id = public.uid() and aktywne), false)
$$;

create or replace function public.prowadze_kurs(p_kurs uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kurs k
                 where k.id = p_kurs and k.instruktor_id = public.uid())
     and public.jestem_instruktorem()
$$;

create or replace function public.zapisany_na_kurs(p_kurs uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.przypisanie p
    join public.profile pr on pr.id = p.kursant_id
    where p.kurs_id = p_kurs and p.kursant_id = public.uid()
      and p.aktywne and pr.aktywne
  )
$$;

create or replace function public.moge_czytac_kurs(p_kurs uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.jestem_adminem()
      or public.prowadze_kurs(p_kurs)
      or (public.zapisany_na_kurs(p_kurs)
          and exists (select 1 from public.kurs k where k.id = p_kurs and k.opublikowany))
$$;

create or replace function public.kurs_etapu(p_etap uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select l.kurs_id from public.etap e join public.lekcja l on l.id = e.lekcja_id
  where e.id = p_etap
$$;

-- ── WŁĄCZ RLS WSZĘDZIE ────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['profile','kurs','przypisanie','lekcja','etap',
                           'material','postep','pytanie','zaproszenie'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
  end loop;
end $$;

-- ═══ PROFILE ═══════════════════════════════════════════════════════
drop policy if exists profile_select on public.profile;
create policy profile_select on public.profile for select using (
      id = public.uid()
   or public.jestem_adminem()
   or (public.jestem_instruktorem() and exists (
        select 1 from public.przypisanie p
        join public.kurs k on k.id = p.kurs_id
        where p.kursant_id = profile.id
          and k.instruktor_id = public.uid() and p.aktywne))
);

-- Zmiana własnego profilu: dozwolona, ale wyzwalacz `profil_ochrona`
-- i tak przywraca e-mail, rolę i aktywność do poprzednich wartości.
drop policy if exists profile_update_wlasny on public.profile;
create policy profile_update_wlasny on public.profile for update
  using  (id = public.uid()) with check (id = public.uid());

drop policy if exists profile_admin_all on public.profile;
create policy profile_admin_all on public.profile for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══ KURSY ═════════════════════════════════════════════════════════
drop policy if exists kurs_select on public.kurs;
create policy kurs_select on public.kurs for select using (public.moge_czytac_kurs(id));

drop policy if exists kurs_admin_all on public.kurs;
create policy kurs_admin_all on public.kurs for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

drop policy if exists kurs_instruktor_update on public.kurs;
create policy kurs_instruktor_update on public.kurs for update
  using (public.prowadze_kurs(id))
  with check (instruktor_id = public.uid());

-- ═══ PRZYPISANIA — tylko admin przypisuje ═════════════════════════
drop policy if exists przypisanie_select on public.przypisanie;
create policy przypisanie_select on public.przypisanie for select using (
      kursant_id = public.uid()
   or public.jestem_adminem()
   or public.prowadze_kurs(kurs_id)
);

drop policy if exists przypisanie_admin_all on public.przypisanie;
create policy przypisanie_admin_all on public.przypisanie for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══ LEKCJE ════════════════════════════════════════════════════════
drop policy if exists lekcja_select on public.lekcja;
create policy lekcja_select on public.lekcja for select using (
      public.jestem_adminem()
   or public.prowadze_kurs(kurs_id)
   or (public.moge_czytac_kurs(kurs_id) and opublikowana)
);

drop policy if exists lekcja_admin_all on public.lekcja;
create policy lekcja_admin_all on public.lekcja for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

drop policy if exists lekcja_instruktor_all on public.lekcja;
create policy lekcja_instruktor_all on public.lekcja for all
  using (public.prowadze_kurs(kurs_id)) with check (public.prowadze_kurs(kurs_id));

-- ═══ ETAPY ═════════════════════════════════════════════════════════
drop policy if exists etap_select on public.etap;
create policy etap_select on public.etap for select using (
  exists (select 1 from public.lekcja l where l.id = etap.lekcja_id and (
        public.jestem_adminem()
     or public.prowadze_kurs(l.kurs_id)
     or (public.moge_czytac_kurs(l.kurs_id) and l.opublikowana and etap.opublikowany)))
);

drop policy if exists etap_admin_all on public.etap;
create policy etap_admin_all on public.etap for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

drop policy if exists etap_instruktor_all on public.etap;
create policy etap_instruktor_all on public.etap for all
  using  (exists (select 1 from public.lekcja l
                  where l.id = etap.lekcja_id and public.prowadze_kurs(l.kurs_id)))
  with check (exists (select 1 from public.lekcja l
                  where l.id = etap.lekcja_id and public.prowadze_kurs(l.kurs_id)));

-- ═══ MATERIAŁY ═════════════════════════════════════════════════════
--  Kursant widzi materiał tylko z przypisanego kursu i tylko opublikowany.
--  Dodatkowo ograniczenie CHECK w tabeli pilnuje, żeby kurs w ścieżce
--  pliku był tym samym kursem co kurs_id — zapisu obok nie da się zrobić.
drop policy if exists material_select on public.material;
create policy material_select on public.material for select using (
      public.jestem_adminem()
   or public.prowadze_kurs(kurs_id)
   or (public.zapisany_na_kurs(kurs_id) and opublikowany
       and exists (select 1 from public.kurs k where k.id = kurs_id and k.opublikowany))
);

drop policy if exists material_admin_all on public.material;
create policy material_admin_all on public.material for all
  using (public.jestem_adminem())
  with check (public.jestem_adminem()
              and public.kurs_ze_sciezki(sciezka) = kurs_id);

drop policy if exists material_instruktor_all on public.material;
create policy material_instruktor_all on public.material for all
  using (public.prowadze_kurs(kurs_id))
  with check (public.prowadze_kurs(kurs_id)
              and public.kurs_ze_sciezki(sciezka) = kurs_id
              and public.prowadze_kurs(public.kurs_ze_sciezki(sciezka)));

-- ═══ POSTĘPY ═══════════════════════════════════════════════════════
--  Kursant widzi i zmienia WYŁĄCZNIE swoje, i tylko na kursach,
--  na które jest zapisany. Przepięcie postępu na etap innego kursu
--  odrzuca polityka i dodatkowo wyzwalacz `postep_spojnosc`.
drop policy if exists postep_select on public.postep;
create policy postep_select on public.postep for select using (
      kursant_id = public.uid()
   or public.jestem_adminem()
   or public.prowadze_kurs(public.kurs_etapu(etap_id))
);

drop policy if exists postep_kursant_insert on public.postep;
create policy postep_kursant_insert on public.postep for insert with check (
  kursant_id = public.uid()
  and public.zapisany_na_kurs(public.kurs_etapu(etap_id))
);

drop policy if exists postep_kursant_update on public.postep;
create policy postep_kursant_update on public.postep for update
  using  (kursant_id = public.uid())
  with check (kursant_id = public.uid()
              and public.zapisany_na_kurs(public.kurs_etapu(etap_id)));

drop policy if exists postep_kursant_delete on public.postep;
create policy postep_kursant_delete on public.postep for delete
  using (kursant_id = public.uid());

drop policy if exists postep_admin_all on public.postep;
create policy postep_admin_all on public.postep for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══ PYTANIA ═══════════════════════════════════════════════════════
drop policy if exists pytanie_select on public.pytanie;
create policy pytanie_select on public.pytanie for select using (
      kursant_id = public.uid()
   or public.jestem_adminem()
   or public.prowadze_kurs(kurs_id)
);

drop policy if exists pytanie_kursant_insert on public.pytanie;
create policy pytanie_kursant_insert on public.pytanie for insert with check (
  kursant_id = public.uid() and public.zapisany_na_kurs(kurs_id)
);

-- Instruktor odpowiada. Wyzwalacz `pytanie_ochrona` przywraca
-- autora, kurs, etap i treść — może zmienić tylko odpowiedź i status.
drop policy if exists pytanie_instruktor_update on public.pytanie;
create policy pytanie_instruktor_update on public.pytanie for update
  using (public.prowadze_kurs(kurs_id) or public.jestem_adminem())
  with check (public.prowadze_kurs(kurs_id) or public.jestem_adminem());

drop policy if exists pytanie_admin_all on public.pytanie;
create policy pytanie_admin_all on public.pytanie for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══ ZAPROSZENIA — wyłącznie admin ═════════════════════════════════
drop policy if exists zaproszenie_admin on public.zaproszenie;
create policy zaproszenie_admin on public.zaproszenie for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══════════════════════════════════════════════════════════════════
--  ROLA APLIKACYJNA `astera_api`                     [Etap 0 migracji]
-- ═══════════════════════════════════════════════════════════════════
--  Tą rolą łączy się z bazą AsterA Core — i tylko ona. Warunki:
--
--    NOBYPASSRLS   nie omija polityk. Zapisane jawnie, choć jest to
--                  wartość domyślna: to zbyt ważne, żeby zostawić
--                  domyślności.
--    NOSUPERUSER   superużytkownik omija RLS niezależnie od FORCE.
--    NOCREATEROLE  nie nadaje uprawnień sobie ani nikomu.
--    nie jest właścicielem tabel — właściciel omija RLS wszędzie tam,
--                  gdzie nie ma `force row level security`. Mamy FORCE
--                  na wszystkich tabelach, ale rozdział własności
--                  i dostępu zostaje drugą warstwą zabezpieczenia.
--
--  Lokalnie rola jest NOLOGIN — testy wchodzą w nią przez SET ROLE.
--  Na Aurorze dostaje LOGIN i poświadczenia z menedżera sekretów;
--  hasła nie ma w żadnym pliku repozytorium.
do $$ begin
  create role astera_api nologin nosuperuser nocreatedb nocreaterole
                         noinherit nobypassrls;
exception when duplicate_object then
  alter role astera_api nosuperuser nocreatedb nocreaterole nobypassrls;
end $$;

-- Żeby testy i migracje mogły wejść w tę rolę przez SET ROLE.
do $$ begin
  execute format('grant astera_api to %I', current_user);
exception when others then null; end $$;

-- ═══════════════════════════════════════════════════════════════════
--  UPRAWNIENIA TABELOWE I FUNKCYJNE
--  Domyślnie nic. Nadajemy tylko to, co naprawdę potrzebne.
-- ═══════════════════════════════════════════════════════════════════
revoke all on all tables    in schema public from anon, authenticated, astera_api;
revoke all on all functions in schema public from anon, authenticated, astera_api, public;
revoke all on all routines  in schema public from anon, authenticated, astera_api, public;

grant usage on schema public to anon, authenticated, astera_api;

grant select, insert, update, delete on
  public.profile, public.kurs, public.przypisanie, public.lekcja,
  public.etap, public.material, public.postep, public.pytanie, public.zaproszenie
  to authenticated, astera_api;

-- Widok kursantów: tylko do odczytu. Ma `security_invoker`, więc i tak
-- pokazuje wyłącznie to, co pytającemu przepuszczą polityki tabel.
grant select on public.widok_kursanci to authenticated, astera_api;

-- Tożsamość zalogowanego. Wywołują ją polityki RLS bezpośrednio
-- (np. `id = public.uid()`), więc rola aplikacyjna musi mieć do niej
-- prawo wykonania — inaczej każde zapytanie kończy się
-- „permission denied for function uid". Funkcja tylko czyta ustawienie
-- transakcyjne, niczego nie zmienia i nie omija RLS.
grant execute on function public.uid()                      to authenticated, astera_api;

-- Tylko funkcje, których naprawdę używa aplikacja i polityki.
-- Wyzwalacze i funkcje SECURITY DEFINER wywołują się z wnętrza bazy,
-- więc nie muszą być dostępne dla roli `authenticated`.
grant execute on function public.moja_rola()                to authenticated, astera_api;
grant execute on function public.jestem_adminem()           to authenticated, astera_api;
grant execute on function public.jestem_instruktorem()      to authenticated, astera_api;
grant execute on function public.prowadze_kurs(uuid)        to authenticated, astera_api;
grant execute on function public.zapisany_na_kurs(uuid)     to authenticated, astera_api;
grant execute on function public.moge_czytac_kurs(uuid)     to authenticated, astera_api;
grant execute on function public.kurs_etapu(uuid)           to authenticated, astera_api;
grant execute on function public.kurs_ze_sciezki(text)      to authenticated, astera_api;

-- NIE nadajemy prawa wykonania:
--   ustanow_pierwszego_admina(text)  — droga inicjalizacyjna, tylko z SQL Editora
--   kontekst_inicjalizacji()         — używana wyłącznie przez wyzwalacz
--   zablokuj_licznik_adminow(), ilu_innych_aktywnych_adminow(uuid)
--   chron_profil(), chron_pytanie(), sprawdz_postep(), sprawdz_pytanie(),
--   obsluz_nowego_uzytkownika()      — wywoływane z wnętrza bazy
-- Blokuje je `revoke all on all functions` wyżej. Gdyby ktoś kiedyś
-- dopisał tu grant na `ustanow_pierwszego_admina`, powstałaby publiczna
-- droga podniesienia roli. Pilnuje tego test bazy 20.
revoke all on function public.ustanow_pierwszego_admina(text)
  from public, anon, authenticated, astera_api, service_role;
revoke all on function public.kontekst_inicjalizacji()
  from public, anon, authenticated, astera_api, service_role;
