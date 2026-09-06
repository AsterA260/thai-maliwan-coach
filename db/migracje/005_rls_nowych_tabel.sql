-- ═══════════════════════════════════════════════════════════════════
--  RLS DLA NOWYCH TABEL                              [Etap 1 migracji]
--
--  Reguła nadrzędna, ta sama we wszystkich politykach niżej:
--
--    KURSANT     widzi wyłącznie wersje ZATWIERDZONE, i tylko z kursów,
--                na które jest zapisany.
--    INSTRUKTOR  widzi wszystkie wersje swoich kursów i redaguje je.
--    ADMIN       widzi wszystko.
--
--  Kursant nie może zobaczyć wersji roboczej ani odrzuconej. To nie
--  jest kwestia wygody — to treść, której Maliwan jeszcze nie
--  zatwierdziła, i nie wolno jej uczyć.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'jezyk','kurs_tekst','lekcja_tekst','material_tekst',
    'etap_wersja','etap_tekst',
    'technika','technika_wersja','technika_tekst','etap_technika',
    'glosowka','glosowka_wersja','glosowka_tekst'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
  end loop;
end $$;

-- ── FUNKCJE POMOCNICZE ────────────────────────────────────────────

--  Kurs, do którego należy etap — mamy już jako public.kurs_etapu().
--  Tu dokładamy odpowiednik dla wersji etapu i dla techniki.

create or replace function public.kurs_wersji_etapu(p_wersja uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select l.kurs_id
    from public.etap_wersja w
    join public.etap e   on e.id = w.etap_id
    join public.lekcja l on l.id = e.lekcja_id
   where w.id = p_wersja
$$;

--  Czy technika pojawia się w JAKIMKOLWIEK kursie, do którego mam dostęp.
--  Technika jest wspólna, więc nie ma jednego „swojego" kursu.
create or replace function public.technika_dostepna(p_technika uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.jestem_adminem()
      or exists (
           select 1
             from public.etap_technika et
             join public.etap e   on e.id = et.etap_id
             join public.lekcja l on l.id = e.lekcja_id
            where et.technika_id = p_technika
              and (public.prowadze_kurs(l.kurs_id) or public.zapisany_na_kurs(l.kurs_id)))
$$;

create or replace function public.technika_redagowalna(p_technika uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.jestem_adminem()
      or exists (
           select 1
             from public.etap_technika et
             join public.etap e   on e.id = et.etap_id
             join public.lekcja l on l.id = e.lekcja_id
            where et.technika_id = p_technika and public.prowadze_kurs(l.kurs_id))
$$;

-- ═══ JĘZYKI — lista publiczna dla zalogowanych, zmienia tylko admin ═
drop policy if exists jezyk_select on public.jezyk;
create policy jezyk_select on public.jezyk for select using (public.uid() is not null);

drop policy if exists jezyk_admin_all on public.jezyk;
create policy jezyk_admin_all on public.jezyk for all
  using (public.jestem_adminem()) with check (public.jestem_adminem());

-- ═══ TŁUMACZENIA STRUKTURY ═════════════════════════════════════════
--  Widoczność tekstu = widoczność encji, do której należy. Bez tego
--  nazwa kursu wyciekałaby komuś, kto samego kursu nie widzi.

drop policy if exists kurs_tekst_select on public.kurs_tekst;
create policy kurs_tekst_select on public.kurs_tekst for select
  using (public.moge_czytac_kurs(kurs_id));

drop policy if exists kurs_tekst_zapis on public.kurs_tekst;
create policy kurs_tekst_zapis on public.kurs_tekst for all
  using  (public.jestem_adminem() or public.prowadze_kurs(kurs_id))
  with check (public.jestem_adminem() or public.prowadze_kurs(kurs_id));

drop policy if exists lekcja_tekst_select on public.lekcja_tekst;
create policy lekcja_tekst_select on public.lekcja_tekst for select using (
  exists (select 1 from public.lekcja l where l.id = lekcja_tekst.lekcja_id and (
        public.jestem_adminem()
     or public.prowadze_kurs(l.kurs_id)
     or (public.moge_czytac_kurs(l.kurs_id) and l.opublikowana))));

drop policy if exists lekcja_tekst_zapis on public.lekcja_tekst;
create policy lekcja_tekst_zapis on public.lekcja_tekst for all
  using  (exists (select 1 from public.lekcja l where l.id = lekcja_tekst.lekcja_id
                  and (public.jestem_adminem() or public.prowadze_kurs(l.kurs_id))))
  with check (exists (select 1 from public.lekcja l where l.id = lekcja_tekst.lekcja_id
                  and (public.jestem_adminem() or public.prowadze_kurs(l.kurs_id))));

drop policy if exists material_tekst_select on public.material_tekst;
create policy material_tekst_select on public.material_tekst for select using (
  exists (select 1 from public.material m where m.id = material_tekst.material_id and (
        public.jestem_adminem()
     or public.prowadze_kurs(m.kurs_id)
     or (public.zapisany_na_kurs(m.kurs_id) and m.opublikowany))));

drop policy if exists material_tekst_zapis on public.material_tekst;
create policy material_tekst_zapis on public.material_tekst for all
  using  (exists (select 1 from public.material m where m.id = material_tekst.material_id
                  and (public.jestem_adminem() or public.prowadze_kurs(m.kurs_id))))
  with check (exists (select 1 from public.material m where m.id = material_tekst.material_id
                  and (public.jestem_adminem() or public.prowadze_kurs(m.kurs_id))));

-- ═══ WERSJE ETAPU ══════════════════════════════════════════════════
--  Tu wchodzi reguła zatwierdzenia. Kursant nie zobaczy draftu.
drop policy if exists etap_wersja_select on public.etap_wersja;
create policy etap_wersja_select on public.etap_wersja for select using (
      public.jestem_adminem()
   or public.prowadze_kurs(public.kurs_wersji_etapu(id))
   or (status = 'zatwierdzone'
       and public.zapisany_na_kurs(public.kurs_wersji_etapu(id)))
);

drop policy if exists etap_wersja_zapis on public.etap_wersja;
create policy etap_wersja_zapis on public.etap_wersja for all
  using  (public.jestem_adminem() or public.prowadze_kurs(public.kurs_wersji_etapu(id)))
  with check (public.jestem_adminem() or public.prowadze_kurs(public.kurs_wersji_etapu(id)));

drop policy if exists etap_tekst_select on public.etap_tekst;
create policy etap_tekst_select on public.etap_tekst for select using (
  exists (select 1 from public.etap_wersja w where w.id = etap_tekst.etap_wersja_id));
  -- widoczność wersji rozstrzyga polityka wyżej; tu nie powtarzamy warunku,
  -- bo `exists` i tak przechodzi przez RLS tabeli etap_wersja

drop policy if exists etap_tekst_zapis on public.etap_tekst;
create policy etap_tekst_zapis on public.etap_tekst for all
  using  (exists (select 1 from public.etap_wersja w
                  where w.id = etap_tekst.etap_wersja_id
                    and (public.jestem_adminem()
                         or public.prowadze_kurs(public.kurs_wersji_etapu(w.id)))))
  with check (exists (select 1 from public.etap_wersja w
                  where w.id = etap_tekst.etap_wersja_id
                    and (public.jestem_adminem()
                         or public.prowadze_kurs(public.kurs_wersji_etapu(w.id)))));

-- ═══ TECHNIKA ══════════════════════════════════════════════════════
drop policy if exists technika_select on public.technika;
create policy technika_select on public.technika for select
  using (public.technika_dostepna(id));

drop policy if exists technika_zapis on public.technika;
create policy technika_zapis on public.technika for all
  using  (public.jestem_adminem() or public.technika_redagowalna(id))
  with check (public.jestem_adminem());
  -- nową technikę zakłada admin; instruktor redaguje istniejące

drop policy if exists technika_wersja_select on public.technika_wersja;
create policy technika_wersja_select on public.technika_wersja for select using (
      public.jestem_adminem()
   or public.technika_redagowalna(technika_id)
   or (status = 'zatwierdzone' and public.technika_dostepna(technika_id))
);

drop policy if exists technika_wersja_zapis on public.technika_wersja;
create policy technika_wersja_zapis on public.technika_wersja for all
  using  (public.jestem_adminem() or public.technika_redagowalna(technika_id))
  with check (public.jestem_adminem() or public.technika_redagowalna(technika_id));

drop policy if exists technika_tekst_select on public.technika_tekst;
create policy technika_tekst_select on public.technika_tekst for select using (
  exists (select 1 from public.technika_wersja w where w.id = technika_tekst.technika_wersja_id));

drop policy if exists technika_tekst_zapis on public.technika_tekst;
create policy technika_tekst_zapis on public.technika_tekst for all
  using  (exists (select 1 from public.technika_wersja w
                  where w.id = technika_tekst.technika_wersja_id
                    and (public.jestem_adminem() or public.technika_redagowalna(w.technika_id))))
  with check (exists (select 1 from public.technika_wersja w
                  where w.id = technika_tekst.technika_wersja_id
                    and (public.jestem_adminem() or public.technika_redagowalna(w.technika_id))));

drop policy if exists etap_technika_select on public.etap_technika;
create policy etap_technika_select on public.etap_technika for select using (
      public.jestem_adminem()
   or public.prowadze_kurs(public.kurs_etapu(etap_id))
   or public.zapisany_na_kurs(public.kurs_etapu(etap_id))
);

drop policy if exists etap_technika_zapis on public.etap_technika;
create policy etap_technika_zapis on public.etap_technika for all
  using  (public.jestem_adminem() or public.prowadze_kurs(public.kurs_etapu(etap_id)))
  with check (public.jestem_adminem() or public.prowadze_kurs(public.kurs_etapu(etap_id)));

-- ═══ GŁOSÓWKI ══════════════════════════════════════════════════════
--  Nagranie dziedziczy widoczność po encji, do której jest przypięte.
drop policy if exists glosowka_select on public.glosowka;
create policy glosowka_select on public.glosowka for select using (
      public.jestem_adminem()
   or (technika_id is not null and public.technika_dostepna(technika_id))
   or (etap_id is not null and (
         public.prowadze_kurs(public.kurs_etapu(etap_id))
      or public.zapisany_na_kurs(public.kurs_etapu(etap_id))))
);

drop policy if exists glosowka_zapis on public.glosowka;
create policy glosowka_zapis on public.glosowka for all
  using  (public.jestem_adminem()
       or (technika_id is not null and public.technika_redagowalna(technika_id))
       or (etap_id is not null and public.prowadze_kurs(public.kurs_etapu(etap_id))))
  with check (public.jestem_adminem()
       or (technika_id is not null and public.technika_redagowalna(technika_id))
       or (etap_id is not null and public.prowadze_kurs(public.kurs_etapu(etap_id))));

drop policy if exists glosowka_wersja_select on public.glosowka_wersja;
create policy glosowka_wersja_select on public.glosowka_wersja for select using (
  exists (select 1 from public.glosowka g where g.id = glosowka_wersja.glosowka_id)
  and (public.jestem_adminem()
       or status = 'zatwierdzone'
       or exists (select 1 from public.glosowka g
                   where g.id = glosowka_wersja.glosowka_id
                     and ((g.technika_id is not null and public.technika_redagowalna(g.technika_id))
                       or (g.etap_id is not null and public.prowadze_kurs(public.kurs_etapu(g.etap_id))))))
);

drop policy if exists glosowka_wersja_zapis on public.glosowka_wersja;
create policy glosowka_wersja_zapis on public.glosowka_wersja for all
  using  (exists (select 1 from public.glosowka g where g.id = glosowka_wersja.glosowka_id
                    and (public.jestem_adminem()
                      or (g.technika_id is not null and public.technika_redagowalna(g.technika_id))
                      or (g.etap_id is not null and public.prowadze_kurs(public.kurs_etapu(g.etap_id))))))
  with check (exists (select 1 from public.glosowka g where g.id = glosowka_wersja.glosowka_id
                    and (public.jestem_adminem()
                      or (g.technika_id is not null and public.technika_redagowalna(g.technika_id))
                      or (g.etap_id is not null and public.prowadze_kurs(public.kurs_etapu(g.etap_id))))));

drop policy if exists glosowka_tekst_select on public.glosowka_tekst;
create policy glosowka_tekst_select on public.glosowka_tekst for select using (
  exists (select 1 from public.glosowka_wersja w where w.id = glosowka_tekst.glosowka_wersja_id));

drop policy if exists glosowka_tekst_zapis on public.glosowka_tekst;
create policy glosowka_tekst_zapis on public.glosowka_tekst for all
  using  (exists (select 1 from public.glosowka_wersja w
                  join public.glosowka g on g.id = w.glosowka_id
                  where w.id = glosowka_tekst.glosowka_wersja_id
                    and (public.jestem_adminem()
                      or (g.technika_id is not null and public.technika_redagowalna(g.technika_id))
                      or (g.etap_id is not null and public.prowadze_kurs(public.kurs_etapu(g.etap_id))))))
  with check (exists (select 1 from public.glosowka_wersja w
                  join public.glosowka g on g.id = w.glosowka_id
                  where w.id = glosowka_tekst.glosowka_wersja_id
                    and (public.jestem_adminem()
                      or (g.technika_id is not null and public.technika_redagowalna(g.technika_id))
                      or (g.etap_id is not null and public.prowadze_kurs(public.kurs_etapu(g.etap_id))))));

-- ═══ UPRAWNIENIA ═══════════════════════════════════════════════════
revoke all on public.jezyk, public.kurs_tekst, public.lekcja_tekst,
              public.material_tekst, public.etap_wersja, public.etap_tekst,
              public.technika, public.technika_wersja, public.technika_tekst,
              public.etap_technika, public.glosowka, public.glosowka_wersja,
              public.glosowka_tekst
  from public, anon, authenticated, astera_api;

grant select, insert, update, delete on
  public.jezyk, public.kurs_tekst, public.lekcja_tekst, public.material_tekst,
  public.etap_wersja, public.etap_tekst,
  public.technika, public.technika_wersja, public.technika_tekst,
  public.etap_technika, public.glosowka, public.glosowka_wersja, public.glosowka_tekst
  to authenticated, astera_api;

grant select on public.widok_glosowka_tekst to authenticated, astera_api;

grant execute on function public.kurs_wersji_etapu(uuid)   to authenticated, astera_api;
grant execute on function public.technika_dostepna(uuid)   to authenticated, astera_api;
grant execute on function public.technika_redagowalna(uuid) to authenticated, astera_api;
grant execute on function public.glosowka_z_klucza(text)   to authenticated, astera_api;
grant execute on function public.tekst_kursu(uuid, text)   to authenticated, astera_api;

-- Wyzwalaczy i funkcji inicjalizacyjnych nie udostępniamy nikomu z zewnątrz.
revoke all on function public.sprawdz_przejscie_wersji()  from public, anon, authenticated, astera_api;
revoke all on function public.chron_tekst_zatwierdzony()  from public, anon, authenticated, astera_api;
