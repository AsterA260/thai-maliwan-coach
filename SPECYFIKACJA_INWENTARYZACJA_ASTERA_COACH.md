# AsterA Coach — pełna inwentaryzacja przed decyzją o migracji na AWS

Stan na 6 września 2026 · gałąź `platforma-v7` · autor: Martin
Dokument opisowy. **Nic nie kasuję, nic nie przebudowuję, nie zakładam nowych
tabel produkcyjnych w Supabase.** Rozbudowa docelowej bazy zatrzymana.

---

## 0 · Streszczenie dla decyzji

**Co jest.** Działający, przetestowany system szkoleniowy: baza z rolami
i pełnym RLS, front bez frameworków, prywatny magazyn plików, zapraszanie
użytkowników, 83 przechodzące testy plus wykonany przebieg E2E na żywym
Supabase (18/26).

**Co z tego jest przywiązane do Supabase.** Cztery rzeczy: uwierzytelnianie,
magazyn plików, funkcja brzegowa `zapros` i jedna funkcja SQL `auth.uid()`
w politykach. **Reszta — czyli schemat, logika, reguły dostępu i cały front —
to zwykły PostgreSQL 16 i zwykły JavaScript.**

**Dlaczego migracja jest tania.** Warstwa danych została zbudowana jako punkt
wymiany backendu (`web/warstwa-danych.js`, kontrakt 24 funkcji, test
kontraktowy pilnujący zgodności). Przełączenie na AWS to napisanie trzeciej
implementacji tego samego kontraktu — **bez dotykania ekranów**.

**Sprawa poczty nie jest argumentem za ani przeciw Supabase.** Zdiagnozowana:
to blokada po stronie cyber_Folks, nie Supabase. Szczegóły w §6.

---

## 1 · Co zostało zbudowane — inwentarz

### 1.1 Baza danych (`db/`)

| plik | zawartość |
|---|---|
| `01_schema.sql` | 9 tabel, 1 widok, 4 typy wyliczeniowe, 11 funkcji, 6 wyzwalaczy |
| `02_rls.sql` | 27 polityk RLS + granty; RLS `enable` **i `force`** na wszystkich tabelach |
| `03_storage.sql` | 4 polityki magazynu plików (odczyt, zapis, podmiana, kasowanie) |
| `04_dane_startowe.sql` | dane demonstracyjne do testów lokalnych |
| `05_import.sql` | wygenerowany z arkusza treści szkoleń |
| `import_xlsx.py` | generator SQL z `AsterA_Coach_Baza_Tresci.xlsx` |

**Tabele i ich kolumny**

```
profile      id, email, imie, rola, aktywne, jezyk, utworzone
kurs         id, kod, nazwa_pl, nazwa_th, opis_pl, opis_th, instruktor_id,
             dni, godzin, cena_gr, opublikowany, utworzone
przypisanie  id, kurs_id, kursant_id, przypisal_id, aktywne, utworzone
lekcja       id, kurs_id, dzien, tytul_pl, tytul_th, kolejnosc, opublikowana
etap         id, lekcja_id, kod, godzina, ikona, nazwa_pl/th, czas_min,
             cel_pl/th, agent_mowi_pl/th, pokazuje_pl/th, kursanci_robia_pl/th,
             uwaga_pl/th, podsumowanie_pl/th, pytania, kolejnosc, opublikowany
material     id, kurs_id, etap_id, typ, nazwa_pl/th, opis, sciezka,
             rozmiar_b, mime, opublikowany, dodal_id, utworzone
postep       id, kursant_id, etap_id, status, zmienione
pytanie      id, kursant_id, kurs_id, etap_id, tresc, odpowiedz,
             odpowiedzial_id, odpowiedziano, status, utworzone
zaproszenie  id, email, imie, rola, kurs_id, token_hash, zaprosil_id,
             wygasa, wykorzystane, utworzone
```

**Typy wyliczeniowe:** `rola_uzytkownika` (admin/instruktor/kursant),
`status_postepu` (nierozpoczety/w_trakcie/zrobione),
`typ_materialu` (zdjecie/wideo/pdf/audio/inny),
`status_pytania` (nowe/odpowiedziane/zamkniete).

**Widok:** `widok_kursanci` — z `security_invoker = true`, czyli RLS tabel
źródłowych obowiązuje także przez widok.

**Funkcje (11):** `chron_profil`, `chron_pytanie`, `chron_ostatniego_admina`,
`ilu_innych_aktywnych_adminow`, `zablokuj_licznik_adminow`,
`kontekst_inicjalizacji`, `ustanow_pierwszego_admina`, `kurs_ze_sciezki`,
`obsluz_nowego_uzytkownika`, `sprawdz_postep`, `sprawdz_pytanie`.

**Wyzwalacze (6):** `na_nowego_uzytkownika`, `profil_ochrona`,
`profil_ostatni_admin`, `pytanie_ochrona`, `pytanie_spojnosc`,
`postep_spojnosc`.

**Reguły, które baza egzekwuje sama** (nie front, nie API):
- kursant nie podniesie sobie roli ani nie ruszy flagi aktywności,
- ostatniego aktywnego administratora nie da się wyłączyć, zdegradować ani
  skasować — z blokadą doradczą `pg_advisory_xact_lock` przeciw wyścigowi
  dwóch równoczesnych transakcji,
- ścieżka pliku w magazynie musi wskazywać ten sam kurs co rekord materiału
  (ta sama funkcja `kurs_ze_sciezki` w więzie CHECK i w polityce magazynu),
- autora i czas odpowiedzi na pytanie stempluje baza,
- postęp i pytanie nie przepną się do etapu z cudzego kursu.

### 1.2 Front (`web/`) — bez frameworków, bez kroku budowania

| plik | linii | rola |
|---|---|---|
| `app.html` | 708 | cała aplikacja po zalogowaniu |
| `index.html` | 116 | logowanie i reset hasła |
| `nowe-haslo.html` | 131 | ustawienie hasła z linku |
| `warstwa-danych.js` | 157 | **przełącznik backendu** + kontrakt |
| `dane-supabase.js` | 359 | implementacja kontraktu na Supabase |
| `konfig.js` | 22 | generowany przez `npm run konfig` |
| `wspolne.css` | — | style |

**Ekrany w aplikacji:** Szkolenie · Kursanci i postępy · Materiały · Pytania ·
Konta i role · Przypisania do kursów.

### 1.3 Warstwa danych — to jest najważniejszy element dla migracji

`web/warstwa-danych.js` wybiera implementację **w czasie działania**:

```js
const PRODUKCJA = !!(K.SUPABASE_URL &&
                    (K.SUPABASE_PUBLISHABLE_KEY || K.SUPABASE_ANON_KEY));
```

i udostępnia `window.DANE`, `window.GOTOWE`, `window.TRYB`.

Kontrakt — **24 nazwy funkcji**, sprawdzane przy starcie
(`sprawdzKontrakt()` rzuca wyjątkiem, gdy czegoś brakuje):

```
zaloguj  wyloguj  ja  wyslijLinkResetu  sesjaZLinku  ustawHaslo
kursy  kurs  zapiszPostep
pytania  zadajPytanie  odpowiedzNaPytanie  zamknijPytanie
linkDoMaterialu  wgrajMaterial  publikujMaterial  usunMaterial
konta  zmienRole  ustawAktywne  zapros
kursanci  przypisz  odepnij
```

Istnieją dziś **dwie** implementacje tego kontraktu: lokalna (nad `/api/*`
serwera deweloperskiego) i produkcyjna (Supabase). Test `testy/kontrakty.js`
uruchamia obie na tych samych danych i porównuje odpowiedzi pole po polu.

**Konsekwencja dla AWS:** trzecia implementacja (`dane-aws.js`) nad Core API
to jedyna rzecz, którą trzeba napisać po stronie frontu. Ekrany nie wiedzą,
skąd biorą dane, i nie trzeba ich ruszać.

### 1.4 Serwer deweloperski (`serwer/dev.js`, 564 linie)

Nie jest przeznaczony na produkcję. Odwzorowuje ten sam kontrakt nad
PostgreSQL, żeby dało się testować bez chmury. Trasy:

```
/api/logowanie  /api/wylogowanie  /api/ja
/api/kursy  /api/kurs  /api/postep
/api/pytania  /api/pytanie
/api/material  /api/kursanci  /api/przypisz  /api/odepnij
/api/konta  /api/konto  /api/zapros  /api/zaproszenia
```

### 1.5 Funkcja brzegowa `zapros` (`supabase/functions/zapros/index.ts`, 175 linii)

Jedyny fragment logiki serwerowej poza bazą. Kolejność działań:

1. `OPTIONS` → 200 z nagłówkami CORS; inna metoda niż POST → 405.
2. Brak nagłówka `Bearer` → 401.
3. Token sprawdzany klientem **użytkownika**, nie serwisowym.
4. Profil czytany jako użytkownik; `rola !== 'admin'` lub `aktywne !== true` → 403.
5. Walidacja: adres e-mail, imię (min. 2 znaki), rola z listy, `kurs_id` jako UUID.
6. Konto zakładane kluczem serwisowym (`inviteUserByEmail`); istniejący adres → 409.
7. **Rola i kurs zapisywane tokenem administratora**, nie kluczem serwisowym —
   to była poprawka blokera z audytu v4: wyzwalacz `chron_profil` cofa zmianę
   roli, gdy nie widzi `auth.uid()`.
8. `wycofaj()` — przy błędzie na kroku 7 konto jest kasowane, żeby nie zostawał
   osierocony użytkownik.

### 1.6 Testy

| zestaw | ile | na czym |
|---|---|---|
| `testy/bezpieczenstwo.js` | 21 | prawdziwy PostgreSQL 16, RLS `enable` + `force`, tożsamość podstawiana przez `request.jwt.claims` |
| `testy/http.js` | 16 | prawdziwy serwer, prawdziwe ciasteczka, prawdziwe pliki |
| `testy/import.js` | 5 | prawdziwy arkusz, prawdziwa baza |
| `testy/kontrakty.js` | 15 | `dane-supabase.js` na atrapie klienta, na prawdziwych wierszach |
| **razem lokalnie** | **57** | wszystkie przechodzą |
| `testy/e2e_supabase.js` | 26 | żywy Supabase po HTTP |

Przykłady z zestawu bezpieczeństwa (pełne nazwy w pliku):
niezalogowany nie widzi żadnej tabeli · kursant nie podniesie sobie roli ·
znajomość ID kursu nic nie daje · ścieżka pliku musi wskazywać ten sam kurs ·
ostatniego administratora nie da się wyłączyć · dwie równoczesne transakcje
nie wyłączą dwóch ostatnich adminów · rola `authenticated` może wywołać tylko
funkcje potrzebne aplikacji.

---

## 2 · Co konkretnie siedzi w Supabase

Projekt testowy `astera-coach-test` (`idgrxrkviyntwmiceywi`), region
eu-central-1 (Frankfurt), plan Free. **To jedyne środowisko chmurowe tego
systemu. Produkcji nie ma. Domena niepodpięta. Nic nie poszło na GitHuba.**

| usługa Supabase | do czego użyta | czy przenośne |
|---|---|---|
| **PostgreSQL 16** | schemat, funkcje, wyzwalacze, RLS | **tak, 1:1** — to zwykły Postgres |
| **Auth** | logowanie hasłem, tokeny, reset, zaproszenia, `auth.uid()`, `auth.users` | nie — do zastąpienia |
| **Storage** | prywatny bucket `materialy`, podpisane linki 300 s, ścieżka `kurs/<uuid>/<typ>/<plik>` | nie — do zastąpienia S3 |
| **Edge Function** | `zapros` (Deno) | nie — do zastąpienia Lambdą |
| **Panel/API zarządzania** | wdrożenie schematu, konfiguracja, klucze | narzędziowe, bez znaczenia |

**Punkty styku z Supabase w kodzie bazy — dokładnie trzy:**

1. `auth.uid()` w politykach RLS i funkcjach — czyta `request.jwt.claims`.
2. Odwołanie do `auth.users` w wyzwalaczu `na_nowego_uzytkownika`.
3. `storage.objects` w `03_storage.sql`.

Poza tym schemat nie wie, że działa na Supabase.

---

## 3 · Co działa — potwierdzone na żywym środowisku

Przebieg E2E z 4 września: **PASS 18 · FAIL 6 · RĘCZNY 2**.

**Przeszło:**
- Auth: logowanie, odświeżenie tokenu, wylogowanie unieważniające token
  odświeżania, wyłączona rejestracja publiczna, wyłączone konto traci dostęp
  do kursu/etapów/materiałów, adresy powrotne, nowe klucze
  `sb_publishable_`/`sb_secret_`.
- **Storage — komplet 7/7:** bucket prywatny, instruktor wgrywa, kursant
  dostaje podpisany link, link wygasa, obcy kursant linku nie dostaje,
  wgranie pod cudzą ścieżkę odrzucone przez RLS, niezgodne metadane odrzucone.
- Edge Function: bez tokenu 401, kursant i instruktor 403, klucz sekretny nie
  wycieka, `OPTIONS` zwraca CORS.

**Wdrożone i sprawdzone:** schemat (9 tabel + widok), RLS, bucket, 4 polityki
magazynu, wyłączona rejestracja, adresy powrotne, funkcja `zapros` w stanie
`ACTIVE`, pierwszy administrator utworzony procedurą `ustanow_pierwszego_admina`.

---

## 4 · Co nie działa i dlaczego

### 4.1 Pięć testów blokowanych przez pocztę

A4 (reset hasła), E3 (zaproszenie), E4 (ponowne zaproszenie), E8 (profil
instruktora), E9 (profil admina). **Wszystkie z jednego powodu — nie kodu.**
Szczegóły w §6.

### 4.2 A8 — brak ograniczenia nieudanych logowań

Dwanaście kolejnych prób ze złym hasłem: dwanaście razy 400, **ani razu 429**.
Konfiguracja projektu potwierdza brak takiej pozycji:

```
rate_limit_anonymous_users: 30    rate_limit_otp: 30
rate_limit_token_refresh: 150     rate_limit_verify: 30
```

Nie ma limitu nieudanych logowań hasłem. To realne odkrycie o produkcie —
**i sprawa niezależna od wyboru dostawcy.** W Cognito rozwiązuje to
adaptacyjne uwierzytelnianie lub WAF; w Supabase — CAPTCHA (Turnstile).
Wcześniejsze zdanie w `testy/oczekujace.md`, że „na produkcji obsługuje to
Supabase", było błędne i E2E je obaliło.

### 4.3 Dwa testy wymagające człowieka

A5 — kliknięcie w link z poczty. E7 — wymuszona awaria nadania roli.

---

## 5 · Jedyna zmiana w produkcie wymuszona przez E2E

Pierwsze wdrożenie funkcji dawało `BOOT_ERROR`; przyczyną był import
`https://esm.sh/@supabase/supabase-js@2`, którego nowe środowisko Edge
Functions nie uruchamia. Po zmianie na `npm:@supabase/supabase-js@2`
i ponownym wdrożeniu E1, E2, E5 i E6 przeszły.

---

## 6 · Sprawa maili — pełna diagnoza

Szukaliśmy przyczyny sekwencyjnie, każdy krok potwierdzony odpowiedzią systemu.

| krok | wynik |
|---|---|
| Wbudowana poczta Supabase | `rate_limit_email_sent: 2` na godzinę, `smtp_host: None` |
| Próba podniesienia limitu | 401 — „Custom SMTP required to configure RATE_LIMIT_EMAIL_SENT" |
| Konfiguracja własnego SMTP (cyber_Folks) | zapisana; `rate_limit_email_sent` skoczył 2 → 30, czego Supabase **nie pozwala** zrobić bez przyjętego SMTP |
| Pierwsza próba wysyłki | `535 "Incorrect authentication data"` — złe hasło skrzynki |
| Hasło ustawione na nowo i zweryfikowane bezpośrednio na serwerze poczty | serwer przyjął logowanie; błąd 535 zniknął |
| Kolejna próba | `550 "No such recipient here"` przy adresie z plusem — Exim w cyber_Folks **nie obsługuje adresów plus-addressing** dla własnych domen |
| Próba na adres bez plusa | `context deadline exceeded`, następnie `504` |

**Rozstrzygnięcie — połączenie na `195.78.67.71` (s32.cyber-folks.pl):**

```
z komputera w Polsce   port 587 → 220 ESMTP Exim   w 0,3 s
z serwera w chmurze    port 587 → timeout          po 20 s
z serwera w chmurze    port 465 → timeout          po 20 s
z serwera w chmurze    port  25 → timeout          po 20 s
```

**Wniosek: cyber_Folks odcina SMTP z adresów chmurowych.** Supabase Auth
stoi w AWS Frankfurt i trafia w tę blokadę. To nie jest wada Supabase, nie
jest to wada naszego kodu i **nie da się tego naprawić po naszej stronie** —
ani hasłem, ani portem, ani zmianą w aplikacji.

**Dodatkowo, do uwzględnienia niezależnie od dostawcy:**
- domena `thaimaliwan-szkolenia.pl` nie ma **żadnego rekordu MX ani SPF** —
  do wysyłki nie przeszkadza, ale bez SPF część wiadomości trafi do spamu,
  a na tę skrzynkę nic nie przyjdzie;
- runner E2E opiera się na adresach z plusem — przy każdym dostawcy trzeba
  sprawdzić, czy je obsługuje (Gmail i dostawcy transakcyjni tak, cyber_Folks nie).

**Rozwiązanie niezależne od architektury:** dostawca poczty transakcyjnej
(Brevo, Resend, SES). Przy przejściu na AWS naturalnym wyborem jest
**Amazon SES** — ta sama chmura, ten sam rachunek, brak problemu z blokadą IP.

**Sprawa bezpieczeństwa do odnotowania:** w trakcie diagnozy hasło skrzynki
`coach@thaimaliwan-szkolenia.pl` wyświetliło się jawnie w oknie terminala
i trafiło na zrzut ekranu. Zostało zmienione; tamto hasło należy traktować
jako spalone.

---

## 7 · Moja ocena przenośności — materiał do trzech kolumn

Bez rekomendacji co do decyzji architektonicznej, ta należy do Was.
Poniżej wyłącznie to, co wiem o kodzie.

### Przenosi się bez zmian albo prawie bez zmian

- **Cały schemat** — `01_schema.sql` uruchomi się na Aurora PostgreSQL
  praktycznie bez zmian. Wyjątki: `auth.uid()` → własna funkcja czytająca
  tożsamość z kontekstu połączenia; odwołanie do `auth.users` w wyzwalaczu.
- **Wszystkie 27 polityk RLS** — to standardowy mechanizm PostgreSQL.
  Aurora obsługuje go identycznie, łącznie z `force row level security`.
- **Reguły biznesowe w wyzwalaczach i funkcjach** — bez zmian.
- **Front w całości** — 6 ekranów, style, logika. Nie dotyka backendu wprost.
- **Testy bezpieczeństwa (21) i importu (5)** — działają na zwykłym
  PostgreSQL, więc będą działać na Aurorze. To gotowy zestaw regresyjny
  dla nowego rdzenia.
- **Kontrakt 24 funkcji i test kontraktowy** — to szablon, według którego
  pisze się i weryfikuje implementację AWS.
- **Ścieżka plików `kurs/<uuid>/<typ>/<plik>`** i funkcja `kurs_ze_sciezki` —
  ta sama konwencja działa na kluczach S3.

### Do napisania od nowa

- **Uwierzytelnianie** — Supabase Auth → Cognito. Dotyczy: `zaloguj`,
  `wyloguj`, `ja`, `wyslijLinkResetu`, `sesjaZLinku`, `ustawHaslo`
  (6 z 24 funkcji kontraktu) oraz sposobu przekazywania tożsamości do RLS.
- **Magazyn plików** — Storage → S3 z presigned URL. Dotyczy:
  `linkDoMaterialu`, `wgrajMaterial`, `usunMaterial` (3 z 24) i pliku
  `03_storage.sql` (4 polityki → polityki bucketu / logika w API).
- **Zapraszanie** — Edge Function → Lambda. 175 linii, logika opisana
  w §1.5 przenosi się co do kroku; zmienia się tylko klient.
- **Implementacja warstwy danych** — nowy `dane-aws.js` nad Core API.
- **Serwer deweloperski** — do decyzji: zostawić jako atrapę do testów
  lokalnych czy zastąpić lokalnym środowiskiem AWS.

### Do wyrzucenia albo zamknięcia

- `narzedzia/zaloz-projekt.js` — zakłada projekt Supabase, bezużyteczne po
  migracji.
- `db/00_supabase_lokalnie.sql` — atrapa schematu `auth` dla testów lokalnych.
- Fragmenty `URUCHOMIENIE.md` opisujące panel Supabase.
- Konfiguracja SMTP w Supabase — zastąpiona przez SES.

### Sprawy otwarte niezależne od architektury

1. Ochrona przed zgadywaniem hasła (§4.2) — do rozwiązania w każdym wariancie.
2. Dostawca poczty transakcyjnej.
3. SPF/DKIM/MX dla domeny.
4. Regulamin i podstawa przetwarzania danych — czeka na prawnika.
5. Konta startowe, materiały, przypisania kursów Maliwan, tłumaczenia tajskie.

---

## 8 · Stan środowiska — czego nie ruszam

- Projekt `astera-coach-test` zostaje **nietknięty**, jako prototyp odniesienia.
- W bazie jedno konto: trwały administrator testowy. Wszystkie konta z testów
  posprzątane przez runner.
- Żadnych nowych tabel produkcyjnych.
- Nic nie poszło na GitHuba. Gałąź `platforma-v7` pozostaje lokalna.
- Agent Mali na Render (produkcja, `autoDeploy: false`) — nietknięty.
- `szkola_10_AI.html` — wersja do wycofania strony szkoły, nietknięta.

Czekam na rozdzielenie na trzy kolumny i prompt migracyjny.
Do tego czasu nie przepisuję niczego.
