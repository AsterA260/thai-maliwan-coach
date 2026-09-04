-- ═══════════════════════════════════════════════════════════════════
--  PRYWATNY STORAGE — materiały szkoleniowe
--
--  Bucket 'materialy' jest PRYWATNY (public = false). Nie ma publicznych
--  adresów. Plik pobiera się wyłącznie przez podpisany, wygasający link,
--  a Supabase wyda go tylko wtedy, gdy poniższe polityki przepuszczą.
--
--  Układ ścieżek — obowiązkowy:
--      kurs/<kurs_id>/<typ>/<nazwa-pliku>
--  Pierwszy segment to zawsze 'kurs', drugi to UUID kursu. Na tym
--  opiera się cała kontrola dostępu.
--
--  Uruchom na Supabase w SQL Editor PO utworzeniu bucketu.
-- ═══════════════════════════════════════════════════════════════════

-- Bucket zakłada się w panelu (Storage → New bucket → Private)
-- albo tak:
-- insert into storage.buckets (id, name, public) values ('materialy','materialy',false);

-- ── UUID kursu wyciągnięty ze ścieżki pliku ──────────────────────
create or replace function public.kurs_ze_sciezki(p_sciezka text)
returns uuid language sql immutable as $$
  select case
    when split_part(p_sciezka,'/',1) = 'kurs'
     and split_part(p_sciezka,'/',2) ~ '^[0-9a-f-]{36}$'
    then split_part(p_sciezka,'/',2)::uuid
    else null end
$$;

-- ── ODCZYT / POBRANIE ────────────────────────────────────────────
drop policy if exists materialy_odczyt on storage.objects;
create policy materialy_odczyt on storage.objects for select using (
  bucket_id = 'materialy'
  and public.kurs_ze_sciezki(name) is not null
  and (
       public.jestem_adminem()
    or public.prowadze_kurs(public.kurs_ze_sciezki(name))
    -- kursant: musi być zapisany na kurs I mieć materiał opublikowany
    or exists (
         select 1 from public.material m
         where m.sciezka = storage.objects.name
           and m.opublikowany
           and public.zapisany_na_kurs(m.kurs_id))
  )
);

-- ── WGRYWANIE — tylko admin i instruktor tego kursu ──────────────
drop policy if exists materialy_zapis on storage.objects;
create policy materialy_zapis on storage.objects for insert with check (
  bucket_id = 'materialy'
  and public.kurs_ze_sciezki(name) is not null
  and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name)))
);

drop policy if exists materialy_podmiana on storage.objects;
create policy materialy_podmiana on storage.objects for update
  using (bucket_id = 'materialy'
         and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name))))
  with check (bucket_id = 'materialy'
         and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name))));

drop policy if exists materialy_kasowanie on storage.objects;
create policy materialy_kasowanie on storage.objects for delete using (
  bucket_id = 'materialy'
  and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name)))
);

-- ── ZASADA DLA APLIKACJI ─────────────────────────────────────────
-- Nigdy nie budujemy adresu pliku ręcznie. Zawsze:
--   supabase.storage.from('materialy').createSignedUrl(sciezka, 300)
-- Link żyje 5 minut i jest wystawiany tylko po przejściu polityki.
