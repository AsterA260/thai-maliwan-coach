# Testy OCZEKUJĄCE — czego jeszcze nie sprawdziliśmy

Uczciwie: **36 testów, które przechodzą, nie są pełnym testem systemu.**
Poniższe scenariusze wymagają żywego projektu Supabase. Nikt takiego
nie założył, więc te testy **nie zostały wykonane** i nie udajemy,
że jest inaczej.

Stan na 4 września 2026, gałąź `platforma-poprawki`.

---

## Co jest sprawdzone naprawdę

| zestaw | plik | ile | na czym |
|---|---|---|---|
| Baza i RLS | `testy/bezpieczenstwo.js` | 15 | PostgreSQL 16, RLS włączony i **wymuszony** |
| HTTP, sesje, pliki | `testy/http.js` | 16 | prawdziwy serwer, prawdziwe ciasteczka i żądania |
| Import z arkusza | `testy/import.js` | 5 | prawdziwy arkusz, prawdziwa baza |

RLS w Supabase to **ten sam mechanizm** co w lokalnym PostgreSQL,
z tym samym `auth.uid()` czytanym z `request.jwt.claims`. Polityki
przetestowane lokalnie zachowają się tak samo. Reszta warstwy — Auth,
Storage, Edge Functions — to usługi Supabase, których lokalnie nie ma.

---

## OCZEKUJĄCE — Supabase Auth

| # | co sprawdzić | dlaczego lokalnie się nie da |
|---|---|---|
| A1 | Logowanie prawdziwym hasłem przez `signInWithPassword` | lokalnie hasła są w `serwer/dev.js`, nie w Auth |
| A2 | Token JWT wygasa i sam się odświeża | brak wystawcy tokenów |
| A3 | `signOut()` unieważnia token odświeżania po stronie Supabase | j.w. |
| A4 | Reset hasła: link z e-maila → `updateUser({password})` | brak poczty i sesji odzyskiwania |
| A5 | Zaproszenie: `inviteUserByEmail` → `verifyOtp` → ustawienie hasła | wymaga Admin API i klucza service_role |
| A6 | Publiczna rejestracja jest wyłączona (`Allow new users to sign up: off`) | ustawienie w panelu Supabase |
| A7 | Wyłączone konto nie odświeży już tokenu | Auth przechowuje sesje po swojej stronie |
| A8 | Ograniczenie liczby prób logowania | Supabase ma to wbudowane; wersja dev **nie ma tego wcale** |

**Uwaga do A8:** to jedyna rzecz z listy, której brak jest realną luką
w wersji deweloperskiej. Na produkcji obsługuje ją Supabase.

## OCZEKUJĄCE — Supabase Storage

| # | co sprawdzić | dlaczego lokalnie się nie da |
|---|---|---|
| S1 | Bucket `materialy` jest naprawdę prywatny (`public = false`) | tworzy się go w panelu |
| S2 | Polityki z `db/03_storage.sql` przepuszczają i blokują tak jak lokalne | `storage.objects` istnieje tylko w Supabase |
| S3 | `createSignedUrl` wystawia link tylko po przejściu polityki | j.w. |
| S4 | Link wygasa po 300 s i przestaje działać | j.w. |
| S5 | Kursant nie pobierze pliku z kursu, na który nie jest zapisany | logika jest w polityce Storage |
| S6 | Wgranie pliku pod ścieżkę cudzego kursu jest odrzucone | j.w. |
| S7 | Nieudany zapis metadanych kasuje plik z bucketu | `storage.remove` po błędzie |

**Odpowiedniki tych scenariuszy są przetestowane lokalnie** na magazynie
plikowym z tymi samymi regułami ścieżek i podpisanymi linkami
(`testy/http.js`, testy 8–13). To nie zastępuje testu na Supabase,
ale pokazuje, że logika jest poprawna.

## OCZEKUJĄCE — Edge Function `zapros`

| # | co sprawdzić |
|---|---|
| E1 | Funkcja odrzuca wywołanie bez tokenu (401) |
| E2 | Funkcja odrzuca wywołanie kursanta i instruktora (403) |
| E3 | Administrator zaprasza, Supabase wysyła wiadomość |
| E4 | Ponowne zaproszenie na istniejący adres daje 409 |
| E5 | Klucz `service_role` nie wycieka w odpowiedzi ani w logach |

---

## Jak je uruchomić, gdy projekt Supabase już będzie

1. `db/01_schema.sql`, `db/02_rls.sql`, `db/03_storage.sql` w SQL Editor.
2. Bucket `materialy`, prywatny.
3. `Allow new users to sign up` → **wyłączone**.
4. Konta przez Auth → Invite user, potem role w SQL.
5. `.env` z `SUPABASE_URL` i `SUPABASE_ANON_KEY`, front przełączony
   na `web/dane-supabase.js`.
6. Przejść listę A1–A8, S1–S7 i E1–E5 ręcznie albo dopisać testy
   przeciwko żywemu projektowi.

Dopiero po zamknięciu tej listy wolno mówić, że system jest przetestowany.
