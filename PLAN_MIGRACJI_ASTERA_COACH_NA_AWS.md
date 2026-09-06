# AsterA Coach — plan migracji na AWS

Wersja 1 · 6 września 2026 · autor: Martin
**Dokument planistyczny. Nic nie jest wykonywane.** Rozbudowa bazy w Supabase
pozostaje wstrzymana, projekt `astera-coach-test` nietknięty jako prototyp
odniesienia i ścieżka wycofania.

---

## 0 · Trzy zasady nadrzędne

Przyjęte przed planowaniem, obowiązują każdy etap.

### Zasada 1 — AsterA Core jest jedyną bramą backendową

```
Coach (przeglądarka)
        │  wyłącznie HTTPS do Core API
        ▼
   AsterA Core API
        ├── Aurora PostgreSQL
        ├── S3
        ├── Lambda (zaproszenia)
        ├── Cognito (operacje administracyjne)
        └── SES
```

Front **nigdy** nie trzyma poświadczeń do Aurory, S3 ani kluczy AWS, nie
wywołuje Lambdy i nie dostaje adresów zasobów AWS. Odwołania do plików
otrzymuje wyłącznie jako gotowe, krótkotrwałe adresy podpisane przez Core.
Lambda do zaproszeń jest szczegółem implementacyjnym Core, nie drugim wejściem.

**Jedna rzecz wymaga rozstrzygnięcia i nie podejmuję jej sam** — sposób
logowania. Dwa warianty:

| | A — token z Cognito, dane przez Core | B — wszystko przez Core |
|---|---|---|
| jak działa | front pobiera token z Cognito (SRP w przeglądarce), do Core wysyła go w nagłówku; Core weryfikuje podpis JWT | front wysyła login i hasło do Core, Core rozmawia z Cognito po stronie serwera i zwraca własną sesję |
| zgodność z zasadą 1 | Core pozostaje jedyną bramą **danych**; Cognito to osobna, wąska ścieżka tylko dla tokenu | zasada spełniona dosłownie: jeden adres, jedno wejście |
| hasło w przeglądarce | nie opuszcza urządzenia w postaci jawnej (SRP) | trafia do Core przez HTTPS |
| odświeżanie tokenu | robi biblioteka Cognito w przeglądarce | musi obsłużyć Core |
| koszt wdrożenia | mniejszy | większy — Core przejmuje cały cykl życia sesji |
| ryzyko | front zna identyfikator puli Cognito | całość ruchu uwierzytelniającego przez Core, więcej kodu do napisania i utrzymania |

Rekomendacja: **wariant A**, bo zasada 1 mówi o Lambdzie, Aurorze i S3, a nie
o Cognito, i bo cykl życia tokenu ma po swojej stronie sprawdzoną bibliotekę.
Decyzja należy do Was i wpływa na zakres etapu 2.

### Zasada 2 — tożsamość dla RLS wyłącznie transakcyjna

Zamiennik `auth.uid()` musi być bezpieczny przy poolingu połączeń (RDS Proxy
lub pgbouncer w trybie transakcyjnym). Kontekst użytkownika ustawiany **tylko
w zakresie transakcji**, nigdy na połączeniu.

Trzy konkrety, które trzeba zrobić dobrze:

1. **`set_config(..., true)`, nie `SET`.** PostgreSQL nie przyjmuje parametru
   w `SET LOCAL x = $1`, więc jedyną bezpieczną formą jest
   `select set_config('astera.uzytkownik', $1, true)` — trzeci argument `true`
   oznacza zasięg transakcji. Sklejanie wartości w łańcuch SQL jest wykluczone.
   Ten sam mechanizm działa już dziś w `testy/bezpieczenstwo.js`.

2. **Każde zapytanie w jawnej transakcji.** W trybie autozatwierdzania
   `set_config(..., true)` wygasa razem z poleceniem, które je wykonało — czyli
   **zanim** przyjdzie właściwe zapytanie. To najczęstsza pomyłka przy tym
   wzorcu i daje pozornie działający kod, który po prostu nie widzi żadnych
   danych albo, gorzej, działa bez tożsamości. Wzorzec obowiązkowy:
   `BEGIN` → `set_config` → zapytania → `COMMIT`.

3. **Stan domyślny to „nikt", nie „poprzedni".** Gdy tożsamość nie została
   ustawiona, funkcja musi zwrócić `NULL`, a polityki RLS mają wtedy nie
   przepuścić niczego. Połączenie wracające do puli musi być czyste
   (`DISCARD ALL` albo równoważne ustawienie proxy).

Dodatkowo: Core API łączy się z bazą **rolą bez `BYPASSRLS` i niebędącą
właścicielem tabel**. Mamy już `force row level security` na wszystkich
tabelach, co zamyka drogę obejścia przez właściciela — ale rola aplikacyjna
i tak ma być osobna.

**Nowy test, obowiązkowy przed przełączeniem produkcji:**
N równoległych żądań przez jedną pulę połączeń, każde z inną tożsamością,
sprawdzenie, że żadne nie zobaczyło danych innego; plus żądanie **bez**
ustawionej tożsamości, które musi zobaczyć zero wierszy zamiast danych
poprzednika. Ten test staje się częścią `testy/bezpieczenstwo.js` jako
pozycja 22.

### Zasada 3 — obecnych 9 tabel to fundament, nie zamrożony model

Nie ogłaszam bieżącego schematu modelem produkcyjnym. W kolejnej fazie dojdą:
notatki Maliwan, głosówki przypięte do konkretnego etapu lub techniki,
transkrypcja, tłumaczenie, wersjonowanie i zatwierdzanie wiedzy
(„Tak robię / Zmień / Moja wersja"). **Nie implementuję tego bez zatwierdzenia** —
w planie zabezpieczam wyłącznie możliwość dodania.

Co to znaczy praktycznie, cztery decyzje projektowe do podjęcia **przed**
etapem 1, bo później kosztują migrację danych:

| sprawa | stan dziś | dlaczego to problem przy rozbudowie |
|---|---|---|
| **tłumaczenia** | pary kolumn `nazwa_pl` / `nazwa_th` w `kurs`, `lekcja`, `etap`, `material` | przy wersjonowaniu i zatwierdzaniu każda wersja musi mieć własne tłumaczenia; pary kolumn tego nie udźwigną i trzeci język wymusza zmianę schematu. Docelowo osobna tabela tłumaczeń |
| **technika** | nie istnieje jako byt — najniższy poziom to `etap` | głosówka Maliwan ma być przypięta „do techniki", a technika może wracać w wielu etapach i kursach. Bez osobnej encji trzeba by duplikować nagrania |
| **wersjonowanie** | brak; zapis nadpisuje | „Moja wersja" i zatwierdzanie wymagają historii, a nie nadpisania. To dotyczy `etap`, `material` i przyszłych notatek |
| **materiał a nagranie** | `material` obsługuje plik przypięty do kursu i etapu | głosówka niesie transkrypcję, tłumaczenie, status zatwierdzenia i wersję — to więcej niż plik. Do rozstrzygnięcia: rozszerzyć `material` czy dołożyć osobną encję |

**Konsekwencja dla planu:** od pierwszego dnia na Aurorze wprowadzamy
**numerowane migracje**, a nie skrypt jednorazowy. Dziś `db/01_schema.sql`
zakłada pustą bazę. Na produkcji potrzebny jest łańcuch
`001_schemat.sql`, `002_…` — inaczej dołożenie notatek i głosówek będzie
ręcznym zabiegiem na żywej bazie.

---

## 1 · Zakres — co wchodzi, co zostaje, co odpada

### Zostaje bez zmian albo prawie

- Schemat: 9 tabel, 1 widok, 4 typy wyliczeniowe, 11 funkcji, 6 wyzwalaczy.
- 27 polityk RLS, z `enable` **i `force`**.
- Reguły egzekwowane przez bazę: ochrona ostatniego administratora z blokadą
  doradczą, zgodność ścieżki pliku z kursem, stemplowanie autora odpowiedzi,
  spójność postępu i pytania z kursem.
- Cały front: 6 ekranów, `app.html`, `index.html`, `nowe-haslo.html`, style.
- Kontrakt 24 funkcji i `testy/kontrakty.js`.
- Testy `bezpieczenstwo.js` (21) i `import.js` (5) — działają na czystym
  PostgreSQL, więc na Aurorze też.
- Konwencja ścieżek `kurs/<uuid>/<typ>/<plik>` i funkcja `kurs_ze_sciezki` —
  ta sama forma działa jako klucz S3.

### Przenosimy — do napisania na nowo

| element | z | na | ile funkcji kontraktu |
|---|---|---|---|
| uwierzytelnianie | Supabase Auth | Cognito + Core API | 6: `zaloguj`, `wyloguj`, `ja`, `wyslijLinkResetu`, `sesjaZLinku`, `ustawHaslo` |
| pliki | Storage | S3 przez Core | 3: `linkDoMaterialu`, `wgrajMaterial`, `usunMaterial` |
| zaproszenia | Edge Function (Deno, 175 linii) | Lambda **wewnątrz Core** | 1: `zapros` |
| tożsamość w RLS | `auth.uid()` | `astera.uzytkownik` przez `set_config(...,true)` | dotyczy wszystkich 27 polityk |
| wyzwalacz na nowego użytkownika | `auth.users` | zdarzenie z Core po utworzeniu konta w Cognito | 1 wyzwalacz |
| polityki magazynu | `storage.objects` (4 polityki SQL) | autoryzacja w Core + polityka bucketu | plik `03_storage.sql` |
| warstwa danych | `dane-supabase.js` | nowy `dane-aws.js` nad Core API | 359 linii, nowa implementacja tego samego kontraktu |
| poczta | SMTP cyber_Folks | SES | konfiguracja, nie kod |

### Wyrzucamy

- `narzedzia/zaloz-projekt.js` — zakłada projekt Supabase.
- `db/00_supabase_lokalnie.sql` — atrapa schematu `auth` do testów lokalnych.
- Sekcje `URUCHOMIENIE.md` opisujące panel Supabase.
- Konfiguracja SMTP w Supabase.

Wyrzucamy **dopiero po** przełączeniu produkcji, nie wcześniej — do tego czasu
prototyp musi dać się uruchomić.

---

## 2 · Etapy

Każdy etap ma być **odwracalny** i kończyć się **dowodem maszynowym**, nie
oświadczeniem. Żaden etap nie wymaga ukończenia następnego, żeby dało się
cofnąć. Do końca etapu 7 Supabase pozostaje działającym prototypem.

---

### Etap 0 — tożsamość i rola bazodanowa (bez AWS, lokalnie)

**Po co pierwszy:** to jedyna zmiana w samym schemacie, która dotyka wszystkich
27 polityk. Robimy ją na lokalnym PostgreSQL, gdzie mamy 21 testów
bezpieczeństwa gotowych do potwierdzenia, że nic nie ubyło.

**Co wchodzi**
1. Funkcja `public.uid()` czytająca `current_setting('astera.uzytkownik', true)`,
   zwracająca `NULL` przy braku ustawienia.
2. Podmiana `auth.uid()` → `public.uid()` w 27 politykach i w funkcjach.
3. Rola aplikacyjna `astera_api`: bez `BYPASSRLS`, bez własności tabel,
   z minimalnym zestawem grantów.
4. Test 22 — brak wycieku tożsamości: N równoległych transakcji przez jedną
   pulę, każda z inną tożsamością; plus transakcja bez tożsamości → zero wierszy.
5. Wzorzec `BEGIN → set_config → zapytania → COMMIT` opisany w `URUCHOMIENIE.md`
   jako obowiązujący dla Core API.

**Dowód ukończenia:** 21 dotychczasowych testów bezpieczeństwa przechodzi bez
zmian w treści + test 22 przechodzi + `import.js` (5) przechodzi.

**Ryzyko:** pomyłka opisana w zasadzie 2 punkt 2 — zapytanie poza transakcją.
Test 22 ma ją wychwycić, dlatego powstaje w tym etapie, a nie później.

**Czego nie robię:** nie dotykam AWS, nie zmieniam frontu, nie ruszam Supabase.

---

### Etap 1 — Aurora PostgreSQL, sam schemat

**Co wchodzi**
1. Instancja Aurora PostgreSQL (wersja zgodna z 16).
2. Przepakowanie `db/*.sql` na **numerowane migracje** — `001_schemat.sql`
   i kolejne. Treść ta sama, zmienia się sposób podawania.
3. Uruchomienie migracji, wgranie danych startowych i importu z arkusza.
4. Uruchomienie na Aurorze zestawu z etapu 0.
5. RDS Proxy z pulą połączeń — i powtórzenie testu 22 **przez proxy**,
   bo to jest środowisko, w którym wyciek tożsamości naprawdę może wystąpić.

**Dowód ukończenia:** 21 + 1 + 5 testów przechodzi na Aurorze przez RDS Proxy.
Zrzut liczby tabel, polityk, funkcji i wyzwalaczy zgodny z Supabase.

**Czego nie robię:** żadnego Auth, żadnych plików, front nadal na Supabase.

---

### Etap 2 — AsterA Core API + Cognito

**Warunek wstępny:** rozstrzygnięty wariant logowania (A czy B z zasady 1).

**Co wchodzi**
1. Szkielet Core API: jedno wejście HTTPS, weryfikacja tożsamości, otwarcie
   transakcji, `set_config`, wykonanie, zamknięcie.
2. Pula użytkowników Cognito, polityka haseł, adresy powrotne.
3. Sześć funkcji kontraktu związanych z Auth.
4. Zdarzenie „powstał nowy użytkownik" → utworzenie wiersza w `profile`
   (zamiennik wyzwalacza na `auth.users`).
5. **A8 z E2E — ograniczenie nieudanych logowań.** To jedyna rzecz z listy
   błędów, która nie znika sama przy zmianie dostawcy. Do wyboru: adaptacyjne
   uwierzytelnianie Cognito albo reguła WAF przed Core. Wymaga decyzji.

**Dowód ukończenia:** odpowiedniki A1, A2, A3, A6, A7, A8 z E2E przechodzą
przeciw Core API. A8 przechodzi — czyli po serii błędnych haseł przychodzi
odmowa, a nie kolejne 400.

**Czego nie robię:** nie ruszam plików, nie ruszam zaproszeń, front nadal na
Supabase.

---

### Etap 3 — S3

**Co wchodzi**
1. Bucket prywatny, bez dostępu publicznego, szyfrowanie w spoczynku.
2. Klucze w konwencji `kurs/<uuid>/<typ>/<plik>` — ta sama, co dziś.
3. Trzy funkcje kontraktu: `linkDoMaterialu`, `wgrajMaterial`, `usunMaterial`.
   Adresy podpisane wystawia **Core**, po sprawdzeniu uprawnień w bazie.
   Front nie zna nazwy bucketu.
4. Odtworzenie w Core reguł, które dziś egzekwują 4 polityki `storage.objects`:
   kto czyta, kto zapisuje, kto podmienia, kto kasuje.
5. Zachowanie więzu: ścieżka pliku musi wskazywać ten sam kurs co rekord
   materiału (`kurs_ze_sciezki` zostaje po stronie bazy).
6. Sprzątanie po nieudanym zapisie metadanych — plik nie zostaje sierotą.

**Dowód ukończenia:** odpowiedniki S1–S7 z E2E przechodzą przeciw Core, w tym
S6 (wgranie pod cudzą ścieżkę odrzucone) i S7 (niezgodne metadane odrzucone,
plik skasowany).

---

### Etap 4 — zaproszenia i poczta

**Co wchodzi**
1. Lambda odtwarzająca logikę `zapros` — **wywoływana przez Core, nie przez
   front**. Kolejność kroków bez zmian: token → profil → rola admin i konto
   aktywne → walidacja → utworzenie konta → nadanie roli i kursu → wycofanie
   przy błędzie.
2. SES: domena, DKIM, SPF, DMARC, wyjście z piaskownicy.
3. Adres nadawcy i szablony wiadomości.
4. Sprawdzenie obsługi adresów z plusem — od tego zależy, czy runner E2E
   działa bez przeróbki. cyber_Folks ich nie obsługiwał, SES tak, ale ma to
   być sprawdzone, nie założone.

**Dowód ukończenia:** E1–E9 przechodzą, **łącznie z E3, E4, E8, E9 i A4**,
czyli tymi pięcioma, które w Supabase zatrzymała blokada SMTP cyber_Folks.
E7 pozostaje ręczny.

**Uwaga:** blokada, przez którą te testy nie przechodziły, dotyczyła połączeń
SMTP z adresów chmurowych do cyber_Folks. SES jest w tej samej chmurze co
Core, więc problem nie ma jak wystąpić — ale to też potwierdzamy przebiegiem,
a nie rozumowaniem.

---

### Etap 5 — `dane-aws.js`

**Co wchodzi**
1. Trzecia implementacja kontraktu 24 funkcji, wyłącznie nad Core API.
2. Rozszerzenie `warstwa-danych.js` o trzeci tryb.
3. Rozszerzenie `testy/kontrakty.js` na porównanie **trzech** warstw — lokalnej,
   Supabase i AWS — pole po polu.

**Dowód ukończenia:** test kontraktowy przechodzi dla wszystkich trzech warstw.

**Czego nie robię:** nie zmieniam ani jednej linii w `app.html`, `index.html`
i `nowe-haslo.html`. Jeśli okaże się, że muszę — to znaczy, że kontrakt został
gdzieś naruszony, i wtedy poprawiam warstwę, nie ekran.

---

### Etap 6 — E2E na AWS

Pełny przebieg 26 scenariuszy przeciw środowisku AWS, z zapisem odpowiedzi
systemu przy każdym punkcie, jak w `RAPORT_E2E.md`.

**Warunek przejścia dalej:** PASS 24 · RĘCZNY 2 (A5, E7). Każde FAIL zatrzymuje
etap. Do tego test 22 przez RDS Proxy pod obciążeniem równoległym.

---

### Etap 7 — przełączenie i wycofanie Supabase

1. Konta startowe, materiały, przypisania kursów przeniesione albo utworzone
   od nowa — do decyzji, zależnie od tego, ile realnych danych będzie
   w prototypie.
2. Przełączenie `konfig.js` na tryb AWS.
3. **Supabase zostaje nietknięty jeszcze przez uzgodniony okres** jako ścieżka
   wycofania. Powrót = zmiana konfiguracji, bez zmian w kodzie.
4. Dopiero po tym okresie usunięcie plików z listy „wyrzucamy".

---

## 3 · Kolejność i zależności

```
Etap 0  tożsamość + rola          (lokalnie, bez AWS)
   │
Etap 1  Aurora + migracje + proxy
   │
Etap 2  Core API + Cognito ────────┐
   │                               │  etapy 3 i 4 mogą iść równolegle
Etap 3  S3 ────────────────────────┤  po zamknięciu etapu 2
Etap 4  Lambda + SES ──────────────┘
   │
Etap 5  dane-aws.js
   │
Etap 6  E2E na AWS
   │
Etap 7  przełączenie, Supabase jako wycofanie
```

Etapy 0 i 1 nie wymagają żadnej decyzji projektowej poza numeracją migracji.
Etap 2 wymaga rozstrzygnięcia wariantu logowania i sposobu obsługi A8.

---

## 4 · Decyzje, których nie podejmuję sam

| # | sprawa | dlaczego Wasza |
|---|---|---|
| 1 | wariant logowania A czy B (§0, zasada 1) | zmienia zakres etapu 2 i sposób rozumienia zasady „jedna brama" |
| 2 | ochrona przed zgadywaniem hasła: adaptacyjne uwierzytelnianie czy WAF | koszt i wpływ na wygodę logowania |
| 3 | tłumaczenia: pary kolumn czy osobna tabela | trzeba rozstrzygnąć **przed** etapem 1, później to migracja danych |
| 4 | „technika" jako osobna encja | j.w. — od tego zależy, do czego przypniemy głosówki |
| 5 | wersjonowanie i zatwierdzanie wiedzy: kształt modelu | j.w. |
| 6 | głosówka: rozszerzenie `material` czy nowa encja | j.w. |
| 7 | co robimy z danymi z prototypu przy przełączeniu | zależy, ile realnej treści tam wejdzie do tego czasu |

Punkty 3–6 to bezpośrednia konsekwencja zasady 3. Nie implementuję ich, ale
**proszę o rozstrzygnięcie przed etapem 1**, bo schemat wchodzi na Aurorę
właśnie tam, a zmiana kształtu tłumaczeń po wgraniu danych jest znacznie
droższa niż przed.

---

## 5 · Czego ten plan nie zawiera

- Ani jednej wykonanej czynności — to dokument do zatwierdzenia.
- Bedrock AgentCore. Agent korzysta z Core API i wchodzi po zamknięciu
  migracji; nie miesza się do niej.
- Przenoszenia rezerwacji ani innych obszarów AsterA Core. Ten dokument
  dotyczy wyłącznie Coacha.
- Terminów. Podam je po zatwierdzeniu zakresu i decyzji z §4.

---

## 6 · Stan na dziś, niezmieniony

- Supabase `astera-coach-test` — nietknięty, jedno konto: trwały administrator
  testowy. Żadnych nowych tabel produkcyjnych.
- Gałąź `platforma-v7` — lokalna, nic nie poszło na GitHuba.
- Agent Mali na Render (produkcja, `autoDeploy: false`) — nietknięty.
- Strona szkoły — osobny temat, poprawka wgrana 6 września, backup na serwerze.

Czekam na zatwierdzenie planu i rozstrzygnięcie siedmiu decyzji z §4.
Do tego czasu nie przepisuję niczego.
