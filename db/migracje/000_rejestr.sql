-- ═══════════════════════════════════════════════════════════════════
--  REJESTR MIGRACJI                                   [Etap 1 migracji]
--
--  Do dziś schemat wgrywało się skryptem jednorazowym, zakładającym
--  pustą bazę. Na produkcji to nie wystarcza: dołożenie tabeli musi
--  być operacją powtarzalną, zapisaną i możliwą do prześledzenia.
--
--  Każdy plik w db/migracje/ uruchamia się DOKŁADNIE RAZ. Pilnuje tego
--  ta tabela i narzędzie narzedzia/migruj.js.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public._migracja (
  nazwa      text primary key,
  suma       text not null,          -- skrót treści pliku w chwili wykonania
  wykonano   timestamptz not null default now(),
  czas_ms    integer
);

comment on table public._migracja is
  'Rejestr wykonanych migracji. Nie ruszać ręcznie.';
