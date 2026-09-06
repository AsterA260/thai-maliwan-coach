-- ═══════════════════════════════════════════════════════════════════
--  WERSJONOWANIE WIEDZY + ETAP NA WERSJACH        [Etap 1 migracji]
--
--  Zatwierdzonej wiedzy nie nadpisujemy. Każda zmiana tworzy nową
--  wersję, a poprzednia zatwierdzona przechodzi w 'zastapione'.
--  Dzięki temu „Tak robię / Zmień / Moja wersja" ma na czym stanąć,
--  a zatwierdzenie polskiej treści nie rusza tajskiej.
-- ═══════════════════════════════════════════════════════════════════

do $$ begin
  create type public.status_wersji as enum
    ('draft','do_zmiany','zatwierdzone','zastapione');
exception when duplicate_object then null; end $$;

-- ═══════════════════════════════════════════════════════════════════
--  ETAP — treść przenosi się z kolumn do wersji
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.etap_wersja (
  id             uuid primary key default gen_random_uuid(),
  etap_id        uuid not null references public.etap(id) on delete cascade,
  numer          int  not null,
  status         public.status_wersji not null default 'draft',

  autor_id       uuid not null references public.profile(id),
  utworzone      timestamptz not null default now(),
  zmienione      timestamptz not null default now(),

  zatwierdzil_id uuid references public.profile(id),
  zatwierdzone_o timestamptz,
  komentarz      text,                 -- uzasadnienie przy 'do_zmiany'

  unique (etap_id, numer),

  -- Zatwierdzający i data istnieją dokładnie dla wersji rozstrzygniętych.
  -- Ani wcześniej, ani „czasem".
  constraint etap_wersja_zatwierdzenie check (
    (status in ('zatwierdzone','zastapione'))
      = (zatwierdzil_id is not null and zatwierdzone_o is not null))
);

-- Jedna zatwierdzona wersja na etap. Pilnuje baza, nie aplikacja —
-- indeks częściowy jest tu tańszy i pewniejszy niż wyzwalacz.
create unique index if not exists etap_wersja_jedna_zatwierdzona
  on public.etap_wersja (etap_id) where status = 'zatwierdzone';

create table if not exists public.etap_tekst (
  etap_wersja_id uuid not null references public.etap_wersja(id) on delete cascade,
  jezyk          text not null references public.jezyk(kod),
  nazwa          text not null,
  cel            text,
  agent_mowi     text,
  pokazuje       text,
  kursanci_robia text,
  uwaga          text,
  podsumowanie   text,
  primary key (etap_wersja_id, jezyk)
);

-- ── PRZENIESIENIE TREŚCI ETAPÓW ───────────────────────────────────
--  Istniejąca treść staje się wersją 1 o statusie 'zatwierdzone' —
--  bo to jest treść, z której dziś realnie korzystamy. Autorem
--  i zatwierdzającym jest pierwszy administrator; gdy go nie ma
--  (baza świeża), migracja treści po prostu nie ma czego przenosić.
do $$
declare kto uuid;
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='etap' and column_name='nazwa_pl') then

    select id into kto from public.profile where rola = 'admin' and aktywne
     order by utworzone limit 1;

    if kto is null then
      select id into kto from public.profile order by utworzone limit 1;
    end if;

    if kto is not null then
      insert into public.etap_wersja (etap_id, numer, status, autor_id,
                                      zatwierdzil_id, zatwierdzone_o, komentarz)
        select e.id, 1, 'zatwierdzone', kto, kto, now(),
               'Treść sprzed wprowadzenia wersjonowania (Etap 1 migracji).'
          from public.etap e
      on conflict (etap_id, numer) do nothing;

      insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel,
                                     agent_mowi, pokazuje, kursanci_robia,
                                     uwaga, podsumowanie)
        select w.id, 'pl', e.nazwa_pl, e.cel_pl, e.agent_mowi_pl, e.pokazuje_pl,
               e.kursanci_robia_pl, e.uwaga_pl, e.podsumowanie_pl
          from public.etap e
          join public.etap_wersja w on w.etap_id = e.id and w.numer = 1
         where e.nazwa_pl is not null
      on conflict do nothing;

      insert into public.etap_tekst (etap_wersja_id, jezyk, nazwa, cel,
                                     agent_mowi, pokazuje, kursanci_robia,
                                     uwaga, podsumowanie)
        select w.id, 'th', e.nazwa_th, e.cel_th, e.agent_mowi_th, e.pokazuje_th,
               e.kursanci_robia_th, e.uwaga_th, e.podsumowanie_th
          from public.etap e
          join public.etap_wersja w on w.etap_id = e.id and w.numer = 1
         where e.nazwa_th is not null and e.nazwa_th <> ''
      on conflict do nothing;

      raise notice 'Treść etapów przeniesiona do wersji 1 (zatwierdzone).';
    else
      raise notice 'Brak jakiegokolwiek profilu — treści etapów nie przenoszę.';
    end if;
  else
    raise notice 'Kolumny _pl/_th w etapie już nie istnieją.';
  end if;
end $$;

alter table public.etap drop column if exists nazwa_pl,
                        drop column if exists nazwa_th,
                        drop column if exists cel_pl,
                        drop column if exists cel_th,
                        drop column if exists agent_mowi_pl,
                        drop column if exists agent_mowi_th,
                        drop column if exists pokazuje_pl,
                        drop column if exists pokazuje_th,
                        drop column if exists kursanci_robia_pl,
                        drop column if exists kursanci_robia_th,
                        drop column if exists uwaga_pl,
                        drop column if exists uwaga_th,
                        drop column if exists podsumowanie_pl,
                        drop column if exists podsumowanie_th;

-- ── PRZEJŚCIA STATUSÓW ────────────────────────────────────────────
--  draft ──► do_zmiany ──► draft
--    └─────► zatwierdzone ──► zastapione
--
--  Wersji rozstrzygniętych (zatwierdzone, zastapione) NIE EDYTUJEMY.
--  Zmiana treści tworzy nową wersję. Umowa z zespołem tego nie
--  wyegzekwuje — wyzwalacz tak.
--  Funkcja jest WSPÓLNA dla etap_wersja, technika_wersja i glosowka_wersja,
--  więc nie wolno jej odwoływać się do kolumn, które ma tylko jedna z nich
--  (etap_id, technika_id, glosowka_id). Sprawdza wyłącznie to, co mają
--  wszystkie: status i numer.
create or replace function public.sprawdz_przejscie_wersji()
returns trigger language plpgsql as $$
declare dozwolone boolean;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft','zatwierdzone') then
      raise exception 'Nowa wersja może powstać jako draft albo zatwierdzone, nie %.',
        new.status using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = new.status then
    -- numeru wersji rozstrzygniętej nie przestawiamy
    if old.status in ('zatwierdzone','zastapione') and new.numer is distinct from old.numer then
      raise exception 'Numeru wersji % nie wolno zmieniać — utwórz nową.', old.status
        using errcode = '23514';
    end if;
    return new;
  end if;

  dozwolone := case old.status
    when 'draft'        then new.status in ('do_zmiany','zatwierdzone')
    when 'do_zmiany'    then new.status = 'draft'
    when 'zatwierdzone' then new.status = 'zastapione'
    else false                       -- z 'zastapione' nie ma wyjścia
  end;

  if not dozwolone then
    raise exception 'Niedozwolone przejście statusu: % → %.', old.status, new.status
      using errcode = '23514';
  end if;

  new.zmienione := now();
  return new;
end $$;

drop trigger if exists etap_wersja_przejscie on public.etap_wersja;
create trigger etap_wersja_przejscie before insert or update on public.etap_wersja
  for each row execute function public.sprawdz_przejscie_wersji();

-- ── TREŚĆ WERSJI ROZSTRZYGNIĘTEJ JEST NIETYKALNA ──────────────────
--  Sam status pilnuje przejść, ale treść siedzi w tabelach tekstowych.
--  Bez tego dałoby się podmienić słowa w zatwierdzonej wersji, nie
--  zmieniając statusu — czyli obejść całe wersjonowanie bokiem.
--  Funkcja jest wspólna dla wszystkich tabel *_tekst; nazwę tabeli
--  z wersjami dostaje argumentem wyzwalacza.
create or replace function public.chron_tekst_zatwierdzony()
returns trigger language plpgsql as $$
declare
  tabela_wersji text := tg_argv[0];
  kolumna_id    text := tg_argv[1];
  st            text;
  wersja        uuid;
begin
  -- Migracje i dane startowe wypełniają wersje zatwierdzone z definicji —
  -- ta sama furtka co przy nadawaniu pierwszych ról, i tak samo wąska:
  -- działa wyłącznie w transakcji i tylko gdy nikt nie jest zalogowany.
  if public.kontekst_inicjalizacji() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  wersja := case when tg_op = 'DELETE' then (to_jsonb(old)->>kolumna_id)::uuid
                 else (to_jsonb(new)->>kolumna_id)::uuid end;

  execute format('select status::text from public.%I where id = $1', tabela_wersji)
    into st using wersja;

  if st in ('zatwierdzone','zastapione') then
    raise exception 'Treść wersji % jest zamknięta — utwórz nową wersję.', st
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists etap_tekst_zamkniety on public.etap_tekst;
create trigger etap_tekst_zamkniety
  before insert or update or delete on public.etap_tekst
  for each row execute function public.chron_tekst_zatwierdzony('etap_wersja','etap_wersja_id');
