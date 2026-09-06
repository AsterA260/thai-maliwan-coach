-- ═══════════════════════════════════════════════════════════════════
--  JĘZYKI I TŁUMACZENIA                              [Etap 1 migracji]
--
--  Do dziś każdy tekst miał parę kolumn: nazwa_pl / nazwa_th.
--  Trzeci język oznaczał zmianę schematu, a wersjonowanie wiedzy
--  Maliwan było niewykonalne — jedna wersja miała jeden komplet kolumn,
--  więc zatwierdzenie polskiej treści po cichu zmieniałoby tajską.
--
--  Od tej migracji język jest DANĄ, nie kolumną.
-- ═══════════════════════════════════════════════════════════════════

-- ── LISTA JĘZYKÓW ─────────────────────────────────────────────────
--  Dodanie kolejnego języka to jeden insert. Zero DDL.
create table if not exists public.jezyk (
  kod          text primary key check (kod ~ '^[a-z]{2}$'),
  nazwa_wlasna text not null,
  aktywny      boolean not null default true,
  kolejnosc    int  not null default 100
);

comment on table public.jezyk is
  'Języki treści. Nowy język = jeden wiersz, bez zmiany schematu.';

insert into public.jezyk (kod, nazwa_wlasna, aktywny, kolejnosc) values
  ('pl', 'polski',   true, 10),
  ('th', 'ไทย',      true, 20),
  ('en', 'English', false, 30)      -- przygotowany, jeszcze nieużywany
on conflict (kod) do nothing;

-- ── JĘZYK PROFILU: było ograniczenie na sztywno ───────────────────
--  `check (jezyk in ('pl','th'))` blokował dodanie języka bez zmiany
--  schematu — czyli dokładnie to, czego pozbywamy się tą migracją.
--  Zastępuje je klucz obcy do tabeli jezyk.
alter table public.profile drop constraint if exists profile_jezyk_check;
do $$ begin
  alter table public.profile
    add constraint profile_jezyk_fk foreign key (jezyk) references public.jezyk(kod);
exception when duplicate_object then null; end $$;

-- ═══════════════════════════════════════════════════════════════════
--  TABELE TEKSTOWE — struktura organizacyjna (bez wersjonowania)
--
--  Kurs, lekcja i materiał mają wyłącznie etykiety. Historia zmian
--  nic tu nie wnosi, więc tłumaczenie wisi wprost na encji.
--  Wiedza merytoryczna — etap, technika, głosówka — dostaje wersje
--  w migracji 002.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.kurs_tekst (
  kurs_id uuid not null references public.kurs(id) on delete cascade,
  jezyk   text not null references public.jezyk(kod),
  nazwa   text not null,
  opis    text,
  primary key (kurs_id, jezyk)
);

create table if not exists public.lekcja_tekst (
  lekcja_id uuid not null references public.lekcja(id) on delete cascade,
  jezyk     text not null references public.jezyk(kod),
  tytul     text not null,
  primary key (lekcja_id, jezyk)
);

create table if not exists public.material_tekst (
  material_id uuid not null references public.material(id) on delete cascade,
  jezyk       text not null references public.jezyk(kod),
  nazwa       text not null,
  opis        text,
  primary key (material_id, jezyk)
);

-- ── PRZENIESIENIE ISTNIEJĄCEJ TREŚCI ──────────────────────────────
--  Migracja musi działać zarówno na bazie z danymi, jak i na pustej.
--  Kolumny źródłowe znikają dopiero po przepisaniu — kolejność ma
--  znaczenie i nie wolno jej odwracać.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='kurs' and column_name='nazwa_pl') then

    insert into public.kurs_tekst (kurs_id, jezyk, nazwa, opis)
      select id, 'pl', nazwa_pl, opis_pl from public.kurs
      where nazwa_pl is not null
    on conflict do nothing;

    insert into public.kurs_tekst (kurs_id, jezyk, nazwa, opis)
      select id, 'th', nazwa_th, opis_th from public.kurs
      where nazwa_th is not null and nazwa_th <> ''
    on conflict do nothing;

    insert into public.lekcja_tekst (lekcja_id, jezyk, tytul)
      select id, 'pl', tytul_pl from public.lekcja where tytul_pl is not null
    on conflict do nothing;

    insert into public.lekcja_tekst (lekcja_id, jezyk, tytul)
      select id, 'th', tytul_th from public.lekcja
      where tytul_th is not null and tytul_th <> ''
    on conflict do nothing;

    insert into public.material_tekst (material_id, jezyk, nazwa, opis)
      select id, 'pl', nazwa_pl, opis from public.material where nazwa_pl is not null
    on conflict do nothing;

    insert into public.material_tekst (material_id, jezyk, nazwa, opis)
      select id, 'th', nazwa_th, opis from public.material
      where nazwa_th is not null and nazwa_th <> ''
    on conflict do nothing;

    raise notice 'Treść przeniesiona do tabel tłumaczeń.';
  else
    raise notice 'Kolumny _pl/_th już nie istnieją — nie ma czego przenosić.';
  end if;
end $$;

-- ── WIDOK KURSANTÓW TRZYMA SIĘ STAREJ KOLUMNY ─────────────────────
--  `widok_kursanci` wybiera `k.nazwa_pl`, więc PostgreSQL nie pozwoli
--  usunąć tej kolumny, dopóki widok istnieje. Przebudowujemy go tutaj,
--  przy okazji naprawiając rzecz, która była zaszyta na sztywno:
--  nazwa kursu pokazuje się teraz w JĘZYKU KURSANTA, a nie zawsze po
--  polsku. Gdy tłumaczenia w jego języku nie ma — wraca polskie.
drop view if exists public.widok_kursanci;

create view public.widok_kursanci
with (security_invoker = true) as
select pr.id,
       pr.imie,
       pr.email,
       coalesce(kt.nazwa, kpl.nazwa) as kurs,
       k.id as kurs_id,
       (select count(*)::int from public.postep po
          join public.etap e   on e.id = po.etap_id
          join public.lekcja l on l.id = e.lekcja_id
         where po.kursant_id = pr.id and l.kurs_id = k.id
           and po.status = 'zrobione') as zrobione,
       (select count(*)::int from public.etap e
          join public.lekcja l on l.id = e.lekcja_id
         where l.kurs_id = k.id) as etapow
  from public.przypisanie z
  join public.profile pr on pr.id = z.kursant_id
  join public.kurs k     on k.id  = z.kurs_id
  left join public.kurs_tekst kt  on kt.kurs_id = k.id and kt.jezyk = pr.jezyk
  left join public.kurs_tekst kpl on kpl.kurs_id = k.id and kpl.jezyk = 'pl'
 where z.aktywne;

-- Widok został odtworzony, więc traci uprawnienia nadane wcześniej
-- w 02_rls.sql. Nadajemy je ponownie — bez tego każde zapytanie
-- o listę kursantów kończy się „permission denied for view".
grant select on public.widok_kursanci to authenticated, astera_api;

-- ── USUNIĘCIE STARYCH KOLUMN ──────────────────────────────────────
--  Zostawienie ich „na wszelki wypadek" znaczyłoby dwa źródła prawdy
--  dla tego samego tekstu. Tego typu wygoda kończy się rozjazdem.
alter table public.kurs     drop column if exists nazwa_pl,
                            drop column if exists nazwa_th,
                            drop column if exists opis_pl,
                            drop column if exists opis_th;

alter table public.lekcja   drop column if exists tytul_pl,
                            drop column if exists tytul_th;

alter table public.material drop column if exists nazwa_pl,
                            drop column if exists nazwa_th;
-- `material.opis` zostaje w tabeli tekstowej; kolumna źródłowa znika
alter table public.material drop column if exists opis;

-- ── ODCZYT TEKSTU W ŻĄDANYM JĘZYKU ────────────────────────────────
--  Reguła zapasowa: jeśli tekstu w wybranym języku nie ma, oddaj
--  polski. Pusty ekran jest gorszy niż ekran w drugim języku.
create or replace function public.tekst_kursu(p_kurs uuid, p_jezyk text)
returns table (nazwa text, opis text)
language sql stable security definer set search_path = public as $$
  select coalesce(w.nazwa, pl.nazwa), coalesce(w.opis, pl.opis)
  from (select 1) x
  left join public.kurs_tekst w  on w.kurs_id = p_kurs and w.jezyk = p_jezyk
  left join public.kurs_tekst pl on pl.kurs_id = p_kurs and pl.jezyk = 'pl'
$$;

comment on function public.tekst_kursu(uuid, text) is
  'Nazwa i opis kursu w podanym języku; gdy brak — polski.';
