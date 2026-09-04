# Testy OCZEKUJĄCE — czego jeszcze nie sprawdziliśmy

Uczciwie: **52 testy, które przechodzą, nie są pełnym testem systemu.**
Poniższe scenariusze wymagają żywego projektu Supabase. Nikt takiego
nie założył, więc te testy **nie zostały wykonane** i nie udajemy,
że jest inaczej.

Stan na 4 września 2026, gałąź `platforma-v3`.

---

## Trzy poziomy — tak je rozdzielamy

| poziom | co to znaczy | ile testów |
|---|---|---|
| **1. Lokalne — wykonane** | prawdziwy PostgreSQL, prawdziwy serwer, prawdziwe pliki | **37** |
| **2. Adapter produkcyjny — wykonane** | kod warstwy Supabase uruchomiony na atrapie klienta, na **prawdziwych wierszach z bazy**; sprawdzamy kontrakt i kształt danych, nie sieć | **15** |
| **3. Żywy Supabase — OCZEKUJĄCE** | Auth, Storage, Edge Function po HTTP | **0 z 20** |

### Poziom 1 — lokalne, wykonane

| zestaw | plik | ile | na czym |
|---|---|---|---|
| Baza i RLS | `testy/bezpieczenstwo.js` | 16 | PostgreSQL 16, RLS włączony i **wymuszony** |
| HTTP, sesje, pliki | `testy/http.js` | 16 | prawdziwy serwer, prawdziwe ciasteczka i żądania |
| Import z arkusza | `testy/import.js` | 5 | prawdziwy arkusz, prawdziwa baza |

### Poziom 2 — adapter produkcyjny, wykonane

`testy/kontrakty.js` — 15 testów. Uruchamiają **ten sam plik**
`web/dane-supabase.js`, który pojedzie na produkcję, i porównują jego
odpowiedzi z odpowiedziami warstwy lokalnej, pole po polu.

Co to łapie: brakujące funkcje, inny kształt odpowiedzi (`ja()`,
`kursanci()`, `kurs()`, `pytania()`, `linkDoMaterialu()`), pozostawione
w ekranach wywołania `/api/*`, zły adres powrotny przy resecie hasła,
wylogowanie omijające Supabase.

Czego to **nie** łapie: zachowania samego Supabase po drugiej stronie
sieci — czyli dokładnie tego, co jest niżej.

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
| A4 | Reset hasła: link z e-maila → sesja z fragmentu adresu → `updateUser({password})` | brak poczty i sesji odzyskiwania |
| A5 | Zaproszenie: `inviteUserByEmail` → link → ustawienie hasła | wymaga Admin API i klucza service_role |
| A6 | Publiczna rejestracja jest wyłączona (`Allow new users to sign up: off`) | ustawienie w panelu Supabase |
| A7 | Wyłączone konto nie odświeży już tokenu | Auth przechowuje sesje po swojej stronie |
| A8 | Ograniczenie liczby prób logowania | Supabase ma to wbudowane; wersja dev **nie ma tego wcale** |
| A9 | Adresy powrotne (Redirect URLs) przepuszczają `/nowe-haslo.html`, a odrzucają obce | lista jest w panelu Supabase |

**Uwaga do A8:** to jedyna rzecz z listy, której brak jest realną luką
w wersji deweloperskiej. Na produkcji obsługuje ją Supabase.

**Uwaga do A9:** to najczęstszy powód, dla którego zaproszenia „nie
działają". Adres musi być dopisany co do znaku — patrz `URUCHOMIENIE.md` §2.5.

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
| E6 | Zapytanie wstępne `OPTIONS` dostaje nagłówki CORS i 200 |
| E7 | Błąd nadania roli **wycofuje** konto — po nieudanym zaproszeniu nie zostaje osierocony użytkownik |

---

## Jak je uruchomić, gdy projekt Supabase już będzie

1. `db/01_schema.sql`, `db/02_rls.sql`, `db/03_storage.sql` w SQL Editor.
   Wyzwalacz `na_nowego_uzytkownika` zakłada się **sam**, w migracji.
2. Bucket `materialy`, prywatny.
3. `Allow new users to sign up` → **wyłączone**; Redirect URLs uzupełnione.
4. `supabase functions deploy zapros` + sekrety.
5. `.env` → `npm run konfig` → front sam przełącza się na Supabase.
   **Nie ma żadnej ręcznej podmiany kodu.**
6. Przejść listę A1–A9, S1–S7 i E1–E7 ręcznie albo dopisać testy
   przeciwko żywemu projektowi.

Dopiero po zamknięciu tej listy wolno mówić, że system jest przetestowany
od końca do końca.
