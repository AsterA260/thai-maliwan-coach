-- ═══════════════════════════════════════════════════════════════════
--  PRYWATNY STORAGE — materiały szkoleniowe
--
--  Bucket 'materialy' jest PRYWATNY (public = false). Nie ma publicznych
--  adresów. Plik pobiera się wyłącznie przez podpisany, wygasający link,
--  a Supabase wyda go tylko wtedy, gdy poniższe polityki przepuszczą.
--
--  Układ ścieżek — obowiązkowy:
--      kurs/<kurs_id>/<typ>/<nazwa-pliku>
--
--  DWIE NIEZALEŻNE KONTROLE (zamknięcie luki z audytu):
--    1. `public.kurs_ze_sciezki(name)` wyciąga UUID kursu ze ścieżki
--       i sprawdza uprawnienia do TEGO kursu;
--    2. rekord w `public.material` musi mieć TEN SAM `kurs_id`.
--  Sam rekord nie może się z tym rozjechać, bo pilnuje tego
--  ograniczenie `material_sciezka_zgodna_z_kursem` w tabeli.
--
--  Uruchom na Supabase w SQL Editor PO utworzeniu bucketu.
-- ═══════════════════════════════════════════════════════════════════

-- Bucket zakłada się w panelu (Storage → New bucket → Private) albo tak:
-- insert into storage.buckets (id, name, public) values ('materialy','materialy',false);

-- Funkcja `public.kurs_ze_sciezki` jest zdefiniowana w db/01_schema.sql —
-- odrzuca ścieżki bez prefiksu `kurs/`, bez poprawnego UUID, bez typu
-- i nazwy pliku oraz każdą zawierającą `..`.

-- ── ODCZYT / POBRANIE ────────────────────────────────────────────
drop policy if exists materialy_odczyt on storage.objects;
create policy materialy_odczyt on storage.objects for select using (
  bucket_id = 'materialy'
  and public.kurs_ze_sciezki(name) is not null
  and (
       public.jestem_adminem()
    or public.prowadze_kurs(public.kurs_ze_sciezki(name))
    -- kursant: zapisany na kurs ZE ŚCIEŻKI, materiał opublikowany,
    -- a rekord materiału wskazuje dokładnie ten sam kurs
    or exists (
         select 1 from public.material m
         where m.sciezka = storage.objects.name
           and m.kurs_id = public.kurs_ze_sciezki(storage.objects.name)
           and m.opublikowany
           and public.zapisany_na_kurs(m.kurs_id))
  )
);

-- ── WGRYWANIE — tylko admin i instruktor TEGO kursu ──────────────
drop policy if exists materialy_zapis on storage.objects;
create policy materialy_zapis on storage.objects for insert with check (
  bucket_id = 'materialy'
  and public.kurs_ze_sciezki(name) is not null
  and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name)))
);

drop policy if exists materialy_podmiana on storage.objects;
create policy materialy_podmiana on storage.objects for update
  using (bucket_id = 'materialy'
         and public.kurs_ze_sciezki(name) is not null
         and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name))))
  with check (bucket_id = 'materialy'
         and public.kurs_ze_sciezki(name) is not null
         and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name))));

drop policy if exists materialy_kasowanie on storage.objects;
create policy materialy_kasowanie on storage.objects for delete using (
  bucket_id = 'materialy'
  and public.kurs_ze_sciezki(name) is not null
  and (public.jestem_adminem() or public.prowadze_kurs(public.kurs_ze_sciezki(name)))
);

-- ── ZASADA DLA APLIKACJI ─────────────────────────────────────────
-- Nigdy nie budujemy adresu pliku ręcznie. Zawsze:
--   supabase.storage.from('materialy').createSignedUrl(sciezka, 300)
-- Link żyje 5 minut i jest wystawiany tylko po przejściu polityki.
