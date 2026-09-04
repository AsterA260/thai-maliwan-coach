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
  select rola::text from public.profile where id = auth.uid() and aktywne
$$;

create or replace function public.jestem_adminem()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rola = 'admin' from public.profile
                   where id = auth.uid() and aktywne), false)
$$;

create or replace function public.jestem_instruktorem()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rola = 'instruktor' from public.profile
                   where id = auth.uid() and aktywne), false)
$$;

-- Czy jestem instruktorem TEGO kursu
create or replace function public.prowadze_kurs(p_kurs uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kurs k
                 where k.id = p_kurs and k.instruktor_id = auth.uid())
     and public.jestem_instruktorem()
$$;

-- Czy jestem kursantem przypisanym do TEGO kursu
create or replace function public.zapisany_na_kurs(p_kurs uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.przypisanie p
    join public.profile pr on pr.id = p.kursant_id
    where p.kurs_id = p_kurs and p.kursant_id = auth.uid()
      and p.aktywne and pr.aktywne
  )
$$;

-- Wspólny warunek czytania kursu
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
alter table public.profile     enable row level security;
alter table public.kurs        enable row level security;
alter table public.przypisanie enable row level security;
alter table public.lekcja      enable row level security;
alter table public.etap        enable row level security;
alter table public.material    enable row level security;
alter table public.postep      enable row level security;
alter table public.pytanie     enable row level security;

alter table public.profile     force row level security;
alter table public.kurs        force row level security;
alter table public.przypisanie force row level security;
alter table public.lekcja      force row level security;
alter table public.etap        force row level security;
alter table public.material    force row level security;
alter table public.postep      force row level security;
alter table public.pytanie     force row level security;

-- ═══ PROFILE ═══════════════════════════════════════════════════════
drop policy if exists profile_select on public.profile;
create policy profile_select on public.profile for select using (
      id = auth.uid()                                  -- swoje konto
   or public.jestem_adminem()                          -- admin widzi wszystkich
   or (public.jestem_instruktorem() and exists (       -- instruktor: tylko
        select 1 from public.przypisanie p             -- kursanci jego kursow
        join public.kurs k on k.id = p.kurs_id
        where p.kursant_id = profile.id
          and k.instruktor_id = auth.uid() and p.aktywne))
);

-- Rolę i aktywność zmienia WYŁĄCZNIE admin.
drop policy if exists profile_update_wlasny on public.profile;
create policy profile_update_wlasny on public.profile for update
  using  (id = auth.uid())
  with check (id = auth.uid()
              and rola = (select rola from public.profile p2 where p2.id = auth.uid())
              and aktywne = (select aktywne from public.profile p2 where p2.id = auth.uid()));

drop policy if exists profile_admin_all on public.profile;
create policy profile_admin_all on public.profile for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══ KURSY ═════════════════════════════════════════════════════════
drop policy if exists kurs_select on public.kurs;
create policy kurs_select on public.kurs for select using (
  public.moge_czytac_kurs(id)
);

drop policy if exists kurs_admin_all on public.kurs;
create policy kurs_admin_all on public.kurs for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- Instruktor może zmieniać swój kurs, ale nie może go sobie przepisać
drop policy if exists kurs_instruktor_update on public.kurs;
create policy kurs_instruktor_update on public.kurs for update
  using (public.prowadze_kurs(id))
  with check (instruktor_id = auth.uid());

-- ═══ PRZYPISANIA — tylko admin przypisuje ═════════════════════════
drop policy if exists przypisanie_select on public.przypisanie;
create policy przypisanie_select on public.przypisanie for select using (
      kursant_id = auth.uid()
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
-- Kursant widzi materiał tylko z przypisanego kursu i tylko opublikowany.
drop policy if exists material_select on public.material;
create policy material_select on public.material for select using (
      public.jestem_adminem()
   or public.prowadze_kurs(kurs_id)
   or (public.zapisany_na_kurs(kurs_id) and opublikowany
       and exists (select 1 from public.kurs k where k.id = kurs_id and k.opublikowany))
);

drop policy if exists material_admin_all on public.material;
create policy material_admin_all on public.material for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

drop policy if exists material_instruktor_all on public.material;
create policy material_instruktor_all on public.material for all
  using (public.prowadze_kurs(kurs_id)) with check (public.prowadze_kurs(kurs_id));

-- ═══ POSTĘPY ═══════════════════════════════════════════════════════
-- Kursant widzi i zmienia WYŁĄCZNIE swoje.
drop policy if exists postep_select on public.postep;
create policy postep_select on public.postep for select using (
      kursant_id = auth.uid()
   or public.jestem_adminem()
   or public.prowadze_kurs(public.kurs_etapu(etap_id))
);

drop policy if exists postep_kursant_insert on public.postep;
create policy postep_kursant_insert on public.postep for insert with check (
  kursant_id = auth.uid()
  and public.zapisany_na_kurs(public.kurs_etapu(etap_id))
);

drop policy if exists postep_kursant_update on public.postep;
create policy postep_kursant_update on public.postep for update
  using (kursant_id = auth.uid()) with check (kursant_id = auth.uid());

drop policy if exists postep_admin_all on public.postep;
create policy postep_admin_all on public.postep for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══ PYTANIA ═══════════════════════════════════════════════════════
drop policy if exists pytanie_select on public.pytanie;
create policy pytanie_select on public.pytanie for select using (
      kursant_id = auth.uid()
   or public.jestem_adminem()
   or public.prowadze_kurs(kurs_id)
);

drop policy if exists pytanie_kursant_insert on public.pytanie;
create policy pytanie_kursant_insert on public.pytanie for insert with check (
  kursant_id = auth.uid() and public.zapisany_na_kurs(kurs_id)
);

drop policy if exists pytanie_instruktor_update on public.pytanie;
create policy pytanie_instruktor_update on public.pytanie for update
  using (public.prowadze_kurs(kurs_id) or public.jestem_adminem())
  with check (public.prowadze_kurs(kurs_id) or public.jestem_adminem());

-- ── UPRAWNIENIA TABELOWE ──────────────────────────────────────────
-- anon nie dostaje nic. Cała reszta i tak przechodzi przez RLS.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.profile, public.kurs, public.przypisanie, public.lekcja,
  public.etap, public.material, public.postep, public.pytanie
  to authenticated;
grant execute on all functions in schema public to authenticated;
