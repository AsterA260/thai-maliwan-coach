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
  --  `is not null` jest częścią warunku, nie ozdobą: ścieżka o złym
  --  kształcie daje z funkcji NULL, a `NULL = kurs_id` to NULL, którego
  --  CHECK nie odrzuca — odrzuca wyłącznie FALSE. Dotąd ratowała nas
  --  tu polityka RLS (prowadze_kurs(NULL) = false), ale opieranie
  --  całej obrony na jednej warstwie jest kruche.
  constraint material_sciezka_zgodna_z_kursem
    check (public.kurs_ze_sciezki(sciezka) is not null
           and public.kurs_ze_sciezki(sciezka) = kurs_id)
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
--  TOŻSAMOŚĆ ZALOGOWANEGO — public.uid()            [Etap 0 migracji]
-- ═══════════════════════════════════════════════════════════════════
--  Zamiennik `public.uid()` Supabase. Czyta identyfikator użytkownika
--  z ustawienia `astera.uzytkownik`, które AsterA Core ustawia
--  W ZAKRESIE TRANSAKCJI, bezpośrednio po jej otwarciu:
--
--      BEGIN
--      select set_config('astera.uzytkownik', $1, true);   -- true = LOCAL
--      … zapytania …
--      COMMIT
--
--  DLACZEGO `set_config(..., true)`, A NIE `SET LOCAL`
--  `SET LOCAL x = $1` nie istnieje — PostgreSQL nie przyjmuje w tym
--  poleceniu parametru. Jedyną formą, która pozwala podać wartość
--  bezpiecznie (bez sklejania SQL-a), jest `set_config` z trzecim
--  argumentem `true`, oznaczającym zasięg transakcji.
--
--  DLACZEGO KAŻDE ZAPYTANIE MUSI BYĆ W JAWNEJ TRANSAKCJI
--  W trybie autozatwierdzania ustawienie lokalne wygasa razem
--  z poleceniem, które je wykonało — czyli ZANIM przyjdzie właściwe
--  zapytanie. Kod wygląda wtedy na poprawny, a tożsamości nie ma.
--
--  DLACZEGO STAN DOMYŚLNY TO „NIKT", A NIE „POPRZEDNI"
--  Bez ustawienia funkcja zwraca NULL, a polityki RLS nie przepuszczają
--  niczego. To warunek bezpieczeństwa przy poolingu połączeń: połączenie
--  wracające do puli nie może zabrać ze sobą cudzej tożsamości.
--  Sprawdza to test 22 w `testy/bezpieczenstwo.js`.
--
--  Wartość niebędąca UUID podniesie błąd rzutowania — celowo. Odmowa
--  jest bezpieczniejsza niż ciche wpuszczenie przy błędnej konfiguracji.
create or replace function public.uid()
returns uuid language sql stable set search_path = public as $$
  select nullif(current_setting('astera.uzytkownik', true), '')::uuid
$$;

comment on function public.uid() is
  'Tożsamość zalogowanego, ustawiana transakcyjnie przez AsterA Core: '
  'set_config(''astera.uzytkownik'', <uuid>, true). Brak ustawienia = NULL.';

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

-- ── Pytanie: instruktor zmienia TYLKO odpowiedź i status ──────────
--  Autora odpowiedzi i czas STEMPLUJE BAZA. Nikt — także admin — nie
--  poda ich z zewnątrz, więc nie da się podpisać cudzym nazwiskiem.
create or replace function public.chron_pytanie()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.odpowiedz is distinct from old.odpowiedz then
    -- zmiana odpowiedzi = stempel: kto i kiedy, z sesji, nie z żądania
    new.odpowiedzial_id := public.uid();
    new.odpowiedziano   := now();
  else
    -- bez zmiany odpowiedzi te pola zostają takie, jakie były
    new.odpowiedzial_id := old.odpowiedzial_id;
    new.odpowiedziano   := old.odpowiedziano;
  end if;

  if public.jestem_adminem() then
    return new;                       -- admin może zmienić resztę pól
  end if;
  -- pola, których instruktor nie może ruszyć
  new.kursant_id := old.kursant_id;
  new.kurs_id    := old.kurs_id;
  new.etap_id    := old.etap_id;
  new.tresc      := old.tresc;
  new.utworzone  := old.utworzone;
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

-- ── Ochrona ostatniego administratora — bez wyścigu ───────────────
--  Samo `count(*)` nie wystarcza: dwie równoczesne transakcje, każda
--  wyłączająca innego z dwóch ostatnich adminów, widziałyby po jednym
--  pozostałym i obie przeszłyby. Blokada doradcza ustawia je w kolejkę,
--  więc druga liczy JUŻ PO zatwierdzeniu pierwszej i dostaje odmowę.
--  Blokadę bierzemy dopiero wtedy, gdy zmiana naprawdę dotyka admina,
--  żeby nie serializować zwykłych aktualizacji profilu.
create or replace function public.zablokuj_licznik_adminow()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('astera_coach_ostatni_admin')::bigint);
end $$;

create or replace function public.ilu_innych_aktywnych_adminow(p_pomin uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.profile
   where rola = 'admin' and aktywne and id <> p_pomin
$$;

-- ── KONTEKST INICJALIZACYJNY ──────────────────────────────────────
--  Audyt trafił w sedno: `chron_profil` przepuszczał zmianę roli tylko
--  wtedy, gdy `jestem_adminem()` = prawda, czyli gdy w sesji siedzi
--  zalogowany administrator. Ale przy zakładaniu pierwszego konta
--  ŻADNEGO administratora jeszcze nie ma, a SQL Editor i klient
--  `service_role` nie mają `public.uid()`. Efekt: `UPDATE ... SET
--  rola='admin'` mówił „UPDATE 1" i po cichu nic nie zmieniał.
--
--  Rozwiązanie: jedna, wąska furtka. Wyzwalacz przepuszcza zmianę,
--  gdy w transakcji ustawiona jest flaga `astera.inicjalizacja`,
--  ORAZ gdy robi to rola bazodanowa, a nie klient z przeglądarki.
--  Flagę ustawia wyłącznie `ustanow_pierwszego_admina()` — funkcja
--  bez prawa wykonania dla `anon` i `authenticated`, która odmawia
--  działania, gdy administrator już istnieje.
--
--  Zwykły użytkownik nie ma jak tu wejść: przez PostgREST wywoła
--  tylko funkcje ze schematu `public`, do których ma EXECUTE, a jego
--  rola to `authenticated` albo `anon` — obie odrzucone.
--
--  UWAGA NA PUŁAPKĘ. Pierwsza wersja sprawdzała `current_user` i była
--  DZIURAWA: wewnątrz funkcji `security definer` current_user to
--  właściciel funkcji (postgres), a nie ten, kto ją wywołał. Kursant,
--  który sam ustawił sobie flagę, przechodził. Wychwycił to test 20.
--  Rolę wywołującego widać w GUC `role` (ustawianym przez SET ROLE)
--  i w roli z tokenu — sprawdzamy OBIE, bo obie są odporne na
--  `security definer`. Brak tokenu = SQL Editor, czyli migracja.
--  ETAP 1a — DOMKNIĘCIE. Poprzednia wersja opierała się na dwóch
--  rzeczach, które trzeba było usunąć:
--
--   1. LISTA WYKLUCZEŃ. Warunek brzmiał „rola NIE JEST jedną z:
--      astera_api, authenticated, anon". Lista wykluczeń chroni
--      wyłącznie przed tym, co ktoś zdążył na nią wpisać. Każda nowa
--      rola bazodanowa — dodana za pół roku przy Aurorze, przy
--      raportach, przy czymkolwiek — z miejsca przechodziła.
--
--   2. `public.uid() is null` JAKO CZĘŚĆ DEFINICJI. Brak tożsamości
--      ma znaczyć „nikt, czyli zero uprawnień" — i nic ponadto.
--      Wpisanie go do definicji inicjalizacji zrównywało dwa różne
--      pojęcia. Technicznie zawężało, nie rozszerzało, ale zasada
--      była zła, a na złej zasadzie prędzej czy później ktoś się
--      oprze przy kolejnej zmianie.
--
--  Teraz są dwa warunki i oba trzeba włączyć ŚWIADOMIE:
--
--    • flaga `astera.inicjalizacja` ustawiona TRANSAKCYJNIE, oraz
--    • jawne wejście w rolę `astera_seed` przez SET LOCAL ROLE.
--
--  Rola `astera_seed` jest NOLOGIN — nikt się nią nie połączy — i nie
--  jest nadana ani `astera_api`, ani `authenticated`, ani `anon`.
--  Wejść w nią może wyłącznie właściciel bazy. Sama flaga nie daje
--  nic: ustawić ją może każdy, i o to chodzi — jest przełącznikiem
--  intencji, a nie zabezpieczeniem. Zabezpieczeniem jest rola.
--
--  Rolę wywołującego czytamy z GUC `role`, a NIE z `current_user`.
--  To nie jest drobiazg: wewnątrz funkcji `security definer`
--  `current_user` to właściciel funkcji, więc oparcie się na nim
--  przepuszczało kursanta, który sam ustawił sobie flagę. Wychwycił
--  to swego czasu test 20. GUC `role` odzwierciedla wyłącznie jawne
--  SET ROLE i jest na `security definer` odporny.
create or replace function public.kontekst_inicjalizacji()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('astera.inicjalizacja', true), '') = 'tak'
     and coalesce(current_setting('role', true), 'none') = 'astera_seed'
$$;

comment on function public.kontekst_inicjalizacji() is
  'Prawda wylacznie dla kontrolowanego seedu: flaga transakcyjna ORAZ jawne SET LOCAL ROLE astera_seed. Brak tozsamosci NIE jest kontekstem inicjalizacji.';

-- ── Profil: nikt sam sobie nie zmieni e-maila, roli ani aktywności ─
create or replace function public.chron_profil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.kontekst_inicjalizacji() then
    return new;                       -- zakładanie pierwszego administratora
  end if;
  if public.jestem_adminem() then
    -- ostatni aktywny administrator nie może zostać wyłączony ani zdegradowany
    if (old.rola = 'admin' and old.aktywne)
       and (new.rola <> 'admin' or new.aktywne = false) then
      perform public.zablokuj_licznik_adminow();
      if public.ilu_innych_aktywnych_adminow(old.id) = 0 then
        raise exception 'To jedyny aktywny administrator — nie mozna go wylaczyc ani zdegradowac.'
          using errcode = '42501';
      end if;
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
  if old.rola = 'admin' and old.aktywne then
    perform public.zablokuj_licznik_adminow();
    if public.ilu_innych_aktywnych_adminow(old.id) = 0 then
      raise exception 'To jedyny aktywny administrator — nie mozna go usunac.'
        using errcode = '42501';
    end if;
  end if;
  return old;
end $$;

drop trigger if exists profil_ostatni_admin on public.profile;
create trigger profil_ostatni_admin before delete on public.profile
  for each row execute function public.chron_ostatniego_admina();

-- ═══════════════════════════════════════════════════════════════════
--  PIERWSZY ADMINISTRATOR — jedyna droga, i tylko raz
--
--  Wywołanie (SQL Editor w panelu Supabase, po założeniu konta przez
--  Authentication → Invite user):
--
--      select public.ustanow_pierwszego_admina('norbert@thaimaliwan.pl');
--
--  Zabezpieczenia:
--   • odmawia, gdy istnieje choć jeden AKTYWNY administrator — więc
--     nie da się jej użyć drugi raz do podniesienia sobie roli;
--   • nie ma prawa wykonania dla `anon` ani `authenticated`, czyli
--     jest nieosiągalna przez PostgREST i przez aplikację;
--   • bierze tę samą blokadę co ochrona ostatniego admina, więc dwa
--     równoczesne wywołania nie zrobią dwóch „pierwszych" adminów;
--   • flagę inicjalizacji ustawia i gasi sama, w jednej transakcji.
-- ═══════════════════════════════════════════════════════════════════
--  ETAP 1a — DWIE ZMIANY, OBIE WYMUSZONE PRZEZ NOWĄ ZASADĘ.
--
--  1. Funkcja NIE jest już `security definer`. Próba wejścia w rolę
--     inicjalizacyjną z jej wnętrza kończy się twardym błędem
--     PostgreSQL: „cannot set parameter role within security-definer
--     function". Nie da się tego obejść i dobrze — to znaczy, że
--     w rolę uprzywilejowaną musi wejść CZŁOWIEK, świadomie, a nie
--     funkcja po cichu za niego.
--
--  2. Wywołanie wymaga więc jednej linijki więcej:
--
--         begin;
--           set local role astera_seed;
--           select public.ustanow_pierwszego_admina('norbert@thaimaliwan.pl');
--         commit;
--
--     Flagę funkcja ustawia sobie sama. Rola i flaga pochodzą z dwóch
--     różnych miejsc i obie są konieczne — o to w tym chodziło.
--
--  Utrata praw właściciela niczego nie osłabia: prawa wykonania i tak
--  nie ma ani `anon`, ani `authenticated`, ani `astera_api`, a kto
--  wchodzi w `astera_seed`, ten jest właścicielem bazy.
create or replace function public.ustanow_pierwszego_admina(p_email text)
returns public.profile
language plpgsql set search_path = public as $$
declare w public.profile;
begin
  perform public.zablokuj_licznik_adminow();

  if exists (select 1 from public.profile where rola = 'admin' and aktywne) then
    raise exception 'Administrator juz istnieje — role nadaje sie w panelu Konta.'
      using errcode = '42501';
  end if;

  if coalesce(current_setting('role', true), 'none') <> 'astera_seed' then
    raise exception 'Wejdz najpierw w role inicjalizacyjna: SET LOCAL ROLE astera_seed;'
      using errcode = '42501';
  end if;

  perform set_config('astera.inicjalizacja', 'tak', true);

  update public.profile
     set rola = 'admin', aktywne = true
   where lower(email) = lower(trim(p_email))
   returning * into w;

  perform set_config('astera.inicjalizacja', 'nie', true);

  if w.id is null then
    raise exception 'Nie ma konta o adresie %. Najpierw zapros je w Authentication → Users.', p_email
      using errcode = '23503';
  end if;
  return w;
end $$;

comment on function public.ustanow_pierwszego_admina(text) is
  'Jedyna droga do pierwszego administratora. Odmawia, gdy admin juz istnieje.';

-- ═══════════════════════════════════════════════════════════════════
--  WIDOK KURSANTÓW — jedno źródło liczb dla obu warstw danych
--
--  Serwer deweloperski i adapter Supabase czytają dokładnie ten sam
--  widok, więc `zrobione` i `etapow` nie mogą się rozjechać między
--  wersją lokalną a produkcyjną. `security_invoker` sprawia, że widok
--  działa w uprawnieniach pytającego — czyli obowiązuje RLS tabel pod
--  spodem, a nie prawa właściciela widoku.
-- ═══════════════════════════════════════════════════════════════════
create or replace view public.widok_kursanci
with (security_invoker = true) as
select
  pr.id, pr.imie, pr.email,
  k.nazwa_pl as kurs,
  k.id       as kurs_id,
  (select count(*)::int from public.postep po
     join public.etap e   on e.id = po.etap_id
     join public.lekcja l on l.id = e.lekcja_id
    where po.kursant_id = pr.id and l.kurs_id = k.id and po.status = 'zrobione') as zrobione,
  (select count(*)::int from public.etap e
     join public.lekcja l on l.id = e.lekcja_id
    where l.kurs_id = k.id) as etapow
from public.przypisanie z
join public.profile pr on pr.id = z.kursant_id
join public.kurs    k  on k.id  = z.kurs_id
where z.aktywne;

comment on view public.widok_kursanci is
  'Kursanci z postepem. Ten sam kontrakt dla serwera dev i dla Supabase.';

-- ═══════════════════════════════════════════════════════════════════
--  WYZWALACZ NOWEGO KONTA — część migracji, nie ręczny krok
--
--  Audyt słusznie zauważył, że instrukcja kazała dokleić ten wyzwalacz
--  ręcznie w panelu. Teraz zakłada go sama migracja, idempotentnie.
--  Lokalnie auth.users tworzy db/00_supabase_lokalnie.sql, na Supabase
--  istnieje od zawsze. Gdyby zabrakło uprawnień — mówimy o tym wprost,
--  zamiast po cichu zostawić system bez profili.
-- ═══════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'auth' and table_name = 'users') then
    execute 'drop trigger if exists na_nowego_uzytkownika on auth.users';
    execute 'create trigger na_nowego_uzytkownika after insert on auth.users
               for each row execute function public.obsluz_nowego_uzytkownika()';
    raise notice 'Wyzwalacz na_nowego_uzytkownika zalozony na auth.users.';
  else
    raise warning 'Brak tabeli auth.users — wyzwalacz na_nowego_uzytkownika NIE zostal zalozony.';
  end if;
exception when insufficient_privilege then
  raise warning 'Brak uprawnien do auth.users — wyzwalacz na_nowego_uzytkownika NIE zostal zalozony.';
end $$;
