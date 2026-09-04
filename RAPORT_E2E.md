# RAPORT E2E — stan przed uruchomieniem

Gałąź: **`platforma-v7`** · paczka **v7** · 4 września 2026

---

## WERDYKT: **NIEGOTOWE DO PRODUKCJI**

Powód niezmienny: **żaden z 26 scenariuszy E2E nie został wykonany**,
bo nie ma jeszcze projektu Supabase. Kod jest gotowy do testu, ale
gotowość kodu to nie to samo co wynik testu.

---

## 1 · Co się zmieniło od v5

Ten plik w v5 opisywał stan sprzed dwóch rund poprawek automatu. Teraz
jest aktualny.

**v6 — osiem poprawek automatu** (potwierdzone):
E8 przestało być liczone dwa razy i doszła kontrola kompletu 26 pozycji ·
A9 sprawdza przekierowanie po nagłówku `Location`, dwustronnie, zamiast
wpisanego PASS · A4 dostało stan `CZĘŚCIOWY` · A7 naprawdę próbuje
odświeżyć token · pierwszego administratora automat już nie nadaje
kluczem sekretnym, tylko zatrzymuje się i podaje komendę do SQL Editora ·
organizacja Supabase musi być wskazana jawnie · limit czasu na wstanie
projektu kończy się błędem · sprzątanie działa też po błędzie i Ctrl+C.

**v7 — korekta końcowa** (ta runda):

| # | poprawka |
|---|---|
| 1 | Z kodu zniknęły domyślne `E2E_ADMIN` i `E2E_HASLO`. Obie wartości są obowiązkowe i pochodzą z `.env`; ich brak kończy przebieg **przed** założeniem jakiegokolwiek konta (kod wyjścia 2). Hasło krótsze niż 12 znaków też jest odrzucane. |
| 2 | `.env.example` ma sekcję testów E2E z czterema zmiennymi — wszystkie **puste**, z opisem, po co są. |
| 3 | Doszła `E2E_SKRZYNKA`: prawdziwy adres, z którego robimy adresy z plusem (`ktos+e2e-zapros-instr-m1x@…`). Konta dostające pocztę powstają właśnie tak, więc reset i zaproszenie **naprawdę dolatują** i da się zamknąć A4, A5 i E3. Fikcyjna domena zostaje tylko dla kont, które niczego nie odbierają — i też jest opcjonalna. |
| 4 | A7 nie sprawdza już własnego profilu z `aktywne=false` (to była tautologia). Sprawdza **dostęp do chronionego kursu**: przed wyłączeniem kursant widzi kurs A, po wyłączeniu ma zniknąć kurs, etapy i materiały; do tego odpowiedź `ja()` w postaci, którą aplikacja czyta jako „wyloguj", odświeżenie tokenu po samym `aktywne=false` i po blokadzie w Auth. |
| 5 | Ten raport. |

Przy okazji: **A8 przeniesione na koniec przebiegu.** Dwanaście złych
logowań potrafi włączyć limit na cały adres IP — gdyby szło wcześniej,
zatrułoby logowania w dalszej części i dostalibyśmy FAIL-e, które nic
nie znaczą.

**Produktu ani bazy nie ruszałem.** Zmiany v6 i v7 dotyczą wyłącznie
`testy/e2e_supabase.js`, `narzedzia/zaloz-projekt.js`, `.env.example`
i dokumentacji. Testy lokalne: 57/57 bez zmian.

---

## 2 · Podział 26 scenariuszy — stan obecny

| stan | ile | które |
|---|---|---|
| **PASS / FAIL** — rozstrzygane maszynowo | **22** | A1, A2, A3, A6, A7, A8, A9, A10, S1–S7, E1, E2, E4, E5, E6, E8, E9 |
| **CZĘŚCIOWY** — część maszynowo, reszta wymaga skrzynki | **2** | A4 (reset przyjęty, doręczenie do potwierdzenia), E3 (konto założone, wiadomość do potwierdzenia) |
| **RĘCZNY** — maszynowo się nie da | **2** | A5 (kliknięcie w link i ustawienie hasła), E7 (wymuszona awaria nadania roli) |

Żaden z tych stanów nie jest wpisany w kodzie na sztywno — wszystkie
wynikają z odpowiedzi systemu. Raport `testy/WYNIK_E2E.md` przy każdej
pozycji pokazuje surową odpowiedź, a na końcu sprawdza, czy pozycji jest
dokładnie 26 i czy żadna się nie powtórzyła.

---

## 3 · Czego potrzebuję, żeby ruszyć

**Od Ciebie — konto i token:**

1. `supabase.com` → Start your project → załóż konto. **Tego nie zrobię
   za Ciebie**: nie zakładam kont w cudzych serwisach i nie wpisuję
   nigdzie haseł.
2. Account → Access Tokens → Generate new token.
3. Wklej sam token do pliku `.supabase-token` w katalogu paczki.
4. Napisz „jest".

**Ode mnie — reszta:**

```bash
ORG_SUPABASE="<nazwa organizacji>" npm run projekt:testowy
#   projekt na planie darmowym, Frankfurt, klucze prosto do .env (600)
#   organizacji nie wybieram sam — bez wskazania wypisuję listę i staję

# schemat, RLS, Storage w SQL Editorze; bucket `materialy` prywatny;
# supabase functions deploy zapros; Redirect URLs (URUCHOMIENIE.md §2.5)

npm run konfig && npm run e2e
#   pierwszy przebieg zatrzyma się i poda jedną komendę do SQL Editora:
#   select public.ustanow_pierwszego_admina('<E2E_ADMIN>');
#   po jej wykonaniu — drugie uruchomienie robi całość
```

Do `.env` dojdą jeszcze `E2E_SKRZYNKA`, `E2E_ADMIN` i `E2E_HASLO` —
podasz mi adres skrzynki, hasło wygeneruję.

---

## 4 · Co pozostaje do zrobienia

**Zanim ruszy E2E**
- konto Supabase i token dostępu;
- adres skrzynki testowej (najlepiej Twój firmowy — użyjemy adresów z plusem);
- `supabase` CLI albo wgranie Edge Function z panelu.

**Po zielonym E2E, przed produkcją**
- decyzja: darmowy czy Pro (darmowy usypia bazę po tygodniu bezczynności);
- adres `coach.thaimaliwan.pl` i Redirect URLs pod ten adres;
- lista kont na start: imię, e-mail, rola;
- materiały do wgrania i przypisania Maliwan;
- tajskie tłumaczenia etapów poza kursem podstawowym;
- regulamin i informacja o danych osobowych — platforma trzyma imiona,
  adresy i postępy;
- potwierdzenie limitów logowania (A8) i przegląd logów Edge Function (E5).

**Świadomie poza zakresem**
- płatności, tłumacz na żywo, nagrywanie sesji, eksport do XLSX.

---

## 5 · Adres projektu testowego

**Nie istnieje.** Pojawi się tutaj po utworzeniu, w postaci
`https://<ref>.supabase.co` — bez żadnych kluczy.

---

## 6 · Werdykt

**NIEGOTOWE DO PRODUKCJI.**

Za nami: 57 testów lokalnych, naprawiony bloker ról, sprostowana
instrukcja, automat E2E po dwóch rundach poprawek. Przed nami: jedno
konto do założenia po Twojej stronie i pierwszy przebieg po mojej.
Dopiero jego wynik — nie istnienie skryptu — będzie podstawą do zmiany
tego werdyktu.
