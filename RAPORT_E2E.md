# RAPORT E2E — WYKONANY na żywym Supabase

4 września 2026 · projekt testowy **`astera-coach-test`**
Adres: `https://idgrxrkviyntwmiceywi.supabase.co` · region Central EU (Frankfurt)
Organizacja: Thai Maliwan (plan **Free**) · **bez kluczy w tym dokumencie**

---

## WERDYKT: **NIEGOTOWE DO PRODUKCJI** — ale z zupełnie innego powodu niż wczoraj

**18 z 26 scenariuszy przeszło maszynowo.** Cała warstwa, która decyduje
o bezpieczeństwie — RLS, Storage, role, uprawnienia Edge Function — działa
na żywym Supabase tak samo jak lokalnie.

Zostało sześć niezaliczonych i dwa ręczne. **Pięć z sześciu to nie jest
błąd kodu** — to limit wbudowanej poczty darmowego planu. Szósty to realne
odkrycie o produkcie, opisane niżej.

---

## 1 · Co zostało wdrożone

| krok | stan | dowód |
|---|---|---|
| Projekt testowy, plan Free, Frankfurt | zrobione | `ACTIVE_HEALTHY` |
| `db/01_schema.sql` | zrobione | 9 tabel, 1 widok |
| Wyzwalacz `na_nowego_uzytkownika` | **założył się sam** | `select tgname from pg_trigger` → istnieje |
| `db/02_rls.sql` | zrobione | polityki i granty na miejscu |
| Bucket `materialy` | zrobione | `public: false` |
| `db/03_storage.sql` | zrobione | 4 polityki: odczyt, zapis, podmiana, kasowanie |
| Rejestracja publiczna | **wyłączona** | `disable_signup: true` |
| Redirect URLs | ustawione | `/nowe-haslo.html`, `/index.html` |
| Edge Function `zapros` | wdrożona | status `ACTIVE`, wersja 2 |
| Pierwszy administrator | **utworzony instrukcją z §2.6** | `kursant` → `admin` |

Nic nie poszło na GitHuba, domena niepodpięta, produkcja nietknięta.

---

## 2 · Wynik: 26 scenariuszy

```
PASS 18 · FAIL 6 · RĘCZNY 2 · razem 26
```

### Przeszły (18)

**Auth:** A1 logowanie · A2 odświeżenie tokenu · A3 wylogowanie unieważnia
token odświeżania (`refresh_token_not_found`) · A6 rejestracja wyłączona
(`signup_disabled`) · A7 wyłączone konto traci dostęp do kursu, etapów
i materiałów · A9 adresy powrotne · A10 nowe klucze `sb_publishable_`/`sb_secret_`

**Storage (komplet 7/7):** S1 bucket prywatny · S2 instruktor wgrywa ·
S3 kursant dostaje podpisany link · S4 link wygasa · S5 obcy kursant nie
dostaje linku · S6 nie wgra pod cudzą ścieżkę (`new row violates row-level
security policy`) · S7 niezgodne metadane odrzucone

**Edge Function:** E1 bez tokenu → 401 · E2 kursant i instruktor → 403 ·
E5 klucz sekretny nie wycieka · E6 OPTIONS z nagłówkami CORS
(`Allow-Origin: http://127.0.0.1:8910`)

### Nie przeszły (6)

| # | co się stało | przyczyna |
|---|---|---|
| A4 | reset hasła → 400 `email_address_invalid` | poczta |
| E3 | zaproszenie → 400 | poczta |
| E4 | ponowne zaproszenie → 400 zamiast 409 | poczta (pierwsze nie doszło) |
| E8 | brak profilu instruktora | poczta (konto nie powstało) |
| E9 | brak profilu admina | poczta (jw.) |
| A8 | 12 nieudanych logowań, **ani jednego 429** | patrz §4 |

### Ręczne (2)

A5 — kliknięcie w link z poczty. E7 — wymuszona awaria nadania roli.

---

## 3 · Pięć porażek z jednego powodu: poczta

Sprawdzone u źródła, nie zgadywane:

```
GET  /v1/projects/{ref}/config/auth
     rate_limit_email_sent: 2       ← dwa maile na godzinę
     smtp_host: None                ← brak własnego SMTP

POST /auth/v1/invite
     429 {"error_code":"over_email_send_rate_limit"}

PATCH rate_limit_email_sent = 30
     401 {"message":"Custom SMTP required to configure … RATE_LIMIT_EMAIL_SENT.
          Missing SMTP_ADMIN_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS"}
```

Wbudowana poczta Supabase wysyła **dwie wiadomości na godzinę** i tylko na
adresy powiązane z zespołem. Limitu nie da się podnieść bez własnego SMTP —
Supabase odmawia wprost. Jeden przebieg E2E potrzebuje trzech wiadomości.

**Co to znaczy dla kodu.** Sama Edge Function działa: E1, E2, E5 i E6
przechodzą, czyli sprawdzanie tokenu, ról, CORS i szczelność klucza są
w porządku. Zawodzi wyłącznie ostatni krok — wysyłka. Tego nie naprawi
zmiana w kodzie.

**Co odblokowuje.** Własny SMTP w Authentication → Emails → SMTP Settings.
Hasła SMTP nie wpisuję — to wpisujesz Ty. Kandydaci: poczta w cyber_Folks
(masz ją do thaimaliwan.pl), Resend, Brevo, SendGrid.

---

## 4 · A8 — to jest prawdziwe odkrycie, nie usterka testu

Dwanaście kolejnych logowań ze złym hasłem: **dwanaście razy 400, ani razu
429**. Konfiguracja projektu potwierdza, czego brakuje:

```
rate_limit_anonymous_users: 30    rate_limit_otp: 30
rate_limit_token_refresh: 150     rate_limit_verify: 30
```

Nie ma pozycji ograniczającej **nieudane logowania hasłem**.

W `testy/oczekujace.md` pisałem, że brak takiego limitu to „jedyna realna
luka wersji deweloperskiej, bo na produkcji obsługuje to Supabase".
**To było błędne założenie i E2E je obaliło.** Zdanie do poprawienia.

Do zamknięcia przed produkcją: włączyć CAPTCHA (Cloudflare Turnstile)
w Authentication → Attack Protection, albo dołożyć własne ograniczenie
przed logowaniem. Decyzja Norberta — Turnstile wymaga darmowego konta
Cloudflare i klucza.

---

## 5 · Jedna poprawka kodu, którą wymusił E2E

Pierwszy deploy funkcji dawał `BOOT_ERROR` i siedem testów E leciało na 503.
Przyczyna: import `https://esm.sh/@supabase/supabase-js@2`, którego nowe
środowisko Edge Functions nie wstaje. Zmiana na `npm:@supabase/supabase-js@2`
i po redeployu E1, E2, E5, E6 przeszły.

To jedyna zmiana w produkcie w tej rundzie — i dokładnie ten rodzaj błędu,
którego żaden test lokalny ani atrapa nie mogły wychwycić.

---

## 6 · Co pozostaje do zrobienia

**Żeby domknąć E2E (5 testów + 1 ręczny)**
1. Własny SMTP — Ty wpisujesz dane, ja powtarzam przebieg.
2. Po SMTP: A4, E3, E4, E8, E9 automatycznie, A5 ręcznie (klik w link).

**Zanim w ogóle mowa o produkcji**
3. A8 — ochrona przed zgadywaniem hasła (Turnstile albo własna).
4. E7 — ręczna próba awarii nadania roli.
5. Decyzja Free czy Pro (Free usypia bazę po tygodniu bezczynności).
6. Adres `coach.thaimaliwan.pl` + Redirect URLs pod niego.
7. Lista kont startowych, materiały, przypisania Maliwan.
8. Regulamin i podstawa przetwarzania danych.

**Sprzątanie po testach** — runner sam skasował wszystkie konta testowe
po każdym przebiegu. Zostaje jedno, celowo: `norbert+coach-admin@…`,
bo ma nadaną rolę admin i pozwala uruchamiać E2E bez powtarzania SQL-a.

---

## 7 · Werdykt

**NIEGOTOWE DO PRODUKCJI.**

Ale to inne „niegotowe" niż wczoraj. Bezpieczeństwo — RLS, Storage, role,
uprawnienia funkcji, pierwszy administrator — **zostało sprawdzone na żywym
Supabase i działa**. Blokują dwie rzeczy spoza kodu: poczta na darmowym
planie i brak ochrony przed zgadywaniem hasła. Obie wymagają Twojej decyzji,
nie kolejnej rundy programowania.
