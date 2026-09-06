-- ═══════════════════════════════════════════════════════════════════
--  DOMKNIĘCIE KONTEKSTU INICJALIZACJI                       [Etap 1a]
--
--  Sama zasada — czym JEST inicjalizacja — mieszka w stanie bazowym:
--  `public.kontekst_inicjalizacji()` w db/01_schema.sql oraz rola
--  `astera_seed` w db/02_rls.sql. Tam jest jej miejsce, bo to definicja
--  uprawnień, a nie zmiana modelu danych.
--
--  Tutaj jest tylko to, czego w stanie bazowym poprawić się NIE DA:
--  wyzwalacz `chron_tekst_zatwierdzony()` powstał w migracji 002,
--  a migracji wykonanej nie wolno edytować — pilnuje tego suma
--  kontrolna w narzedzia/migruj.js. Poprawka wchodzi jako nowa
--  migracja. Taka jest umowa i nie robimy dla siebie wyjątku.
-- ═══════════════════════════════════════════════════════════════════

-- ── PRAWDZIWY BŁĄD, KTÓRY WYSZEDŁ PRZY OKAZJI ─────────────────────
--  `chron_tekst_zatwierdzony()` był funkcją z prawami WYWOŁUJĄCEGO,
--  a wywołuje `public.kontekst_inicjalizacji()`, do której rola
--  aplikacyjna prawa wykonania nie ma i mieć nie powinna.
--
--  Skutek nie był teoretyczny: Maliwan, poprawiając WŁASNY draft przez
--  AsterA Core, dostawała
--
--      ERROR: permission denied for function kontekst_inicjalizacji
--
--  zamiast zapisu. Cała ścieżka redagowania treści była martwa.
--  Nie wykryły tego dotychczasowe testy, bo żaden nie ZAPISYWAŁ do
--  tabel `*_tekst` w roli `astera_api` — czytały wszystkie.
--
--  Rozwiązanie to samo co przy `chron_profil()`: prawa właściciela
--  plus przybity `search_path`. Wyzwalacz i tak nie oddaje niczego
--  wywołującemu — albo przepuszcza zapis, albo rzuca wyjątkiem.
create or replace function public.chron_tekst_zatwierdzony()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tabela_wersji text := tg_argv[0];
  kolumna_id    text := tg_argv[1];
  st            text;
  wersja        uuid;
begin
  -- Kontrolowany seed (rola `astera_seed` + flaga transakcyjna) wypełnia
  -- wersje zatwierdzone z definicji. Od Etapu 1a to JEDYNA droga tędy:
  -- brak tożsamości nie jest już kontekstem inicjalizacji.
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

comment on function public.chron_tekst_zatwierdzony() is
  'Broni tresci wersji zatwierdzonych. SECURITY DEFINER, bo siega po kontekst_inicjalizacji(), do ktorej rola aplikacyjna prawa nie ma.';

-- ── TA SAMA PUŁAPKA, ZANIM ZDĄŻY WYBUCHNĄĆ ────────────────────────
--  `sprawdz_przejscie_wersji()` dziś nie woła niczego zastrzeżonego,
--  więc działa. Ale to jedyny powód, dla którego działa — a wyzwalacz
--  pilnujący przejść statusów prędzej czy później będzie musiał
--  o coś zapytać. Wyrównujemy prawa teraz, przy okazji, zamiast
--  czekać na ten sam błąd drugi raz.
--  Ciało funkcji jest przepisane z migracji 002 BEZ ZMIAN. Różnica to
--  wyłącznie `security definer set search_path = public` w nagłówku.
create or replace function public.sprawdz_przejscie_wersji()
returns trigger language plpgsql security definer set search_path = public as $$
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
