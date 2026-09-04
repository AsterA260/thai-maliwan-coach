# RAPORT ZMIAN v3 — po drugim audycie Codexa

Gałąź: **`platforma-v3`** · 4 września 2026
Nic nie opublikowane, nic nie wdrożone, nic nie wysłane na GitHuba.

Poprzedni audyt zamknął osiem punktów, ale postawił diagnozę, która była
trafna: **ekrany dalej chodziły po `/api/*`, a warstwa Supabase leżała
obok, nieużywana i o innym kształcie danych.** Ten raport opisuje
dziesięć punktów drugiej listy. Zmiany wyglądu — żadnych.

Historia raportu poprzedniej rundy: `RAPORT_ZMIAN_v2.md`.

---

## 1 · Supabase naprawdę podłączony do trzech ekranów

**Było:** `index.html` wołał `fetch('/api/logowanie')`, `app.html` miał
własną funkcję `api()` do `/api/*`, `nowe-haslo.html` sprawdzał
`window.DANE_SUPABASE`, którego nikt nigdy nie wczytywał. Ani jeden ekran
nie dołączał `konfig.js`, biblioteki Supabase czy `dane-supabase.js`.

**Jest:** każdy z trzech ekranów dołącza dwa skrypty:

```html
<script src="konfig.js"></script>
<script src="warstwa-danych.js"></script>
```

i woła wyłącznie `DANE.<funkcja>()`. W `app.html` **nie ma już ani
jednego `fetch('/api/…')`** — funkcja `api()` została usunięta.
Bibliotekę Supabase i `dane-supabase.js` dociąga sama warstwa danych,
i tylko w trybie produkcyjnym (dzięki temu wersja lokalna nadal działa
bez internetu).

**Test:** `testy/kontrakty.js` 1 i 2 — przeszukują pliki ekranów
i przewracają się, gdy ktoś zostawi w nich `/api/`.

---

## 2 · Jeden przełącznik warstwy danych, zero podmieniania kodu

**Było:** instrukcja kazała ręcznie „podmienić funkcję `api` na moduł
`web/dane-supabase.js`". Taki krok zawsze ktoś kiedyś przeoczy.

**Jest:** `web/warstwa-danych.js`:

| warunek | co siedzi pod `DANE` | `window.TRYB` |
|---|---|---|
| `konfig.js` ma puste `SUPABASE_URL` | adapter na serwer dev `/api/*` | `lokalny` |
| `konfig.js` ma adres Supabase | `window.DANE_SUPABASE` | `supabase` |

`web/konfig.js` **jest generowany** z `.env` przez `npm run konfig`
(`narzedzia/zbuduj-konfig.js`). Skrypt przepisuje cztery jawne wartości
i **odmawia** przeniesienia klucza `service_role` do frontu.

Warstwa sprawdza też sama siebie: jeśli któraś z 24 funkcji kontraktu
nie istnieje, aplikacja **przewraca się od razu, przy starcie**, zamiast
udawać, że działa, aż ktoś kliknie w zepsute miejsce.

**Test:** `testy/kontrakty.js` 5 — ten sam plik uruchomiony dwa razy:
raz bez konfiguracji (wychodzi `lokalny`), raz z konfiguracją (`supabase`).

---

## 3 · Kontrakty danych ujednolicone

| co | było | jest |
|---|---|---|
| `ja()` | lokalnie `{ profil: {...} }`, na Supabase samo `{...}` | **oba zwracają sam profil** |
| `kursanci()` | Supabase nie zwracał `zrobione` ani `etapow` — pasek postępu dzielił przez `undefined` | **oba czytają widok `public.widok_kursanci`**, ten sam SQL |
| wgrywanie pliku | ekran budował własny `fetch` z `URLSearchParams`; wersja Supabase miała nieużywane `wgrajMaterial()` | **oba wołają `wgrajMaterial({ …, plik })` z prawdziwym obiektem pliku** |
| wylogowanie | zawsze `fetch('/api/wylogowanie')`, także na produkcji | **`DANE.wyloguj()`** — lokalnie kasuje sesję, na produkcji woła `signOut()` |
| zaproszenie | ekran zawsze pokazywał `d.link_lokalny`, którego produkcja nie zwraca | **link pokazuje się tylko wtedy, gdy istnieje** (czyli lokalnie) |

Nowy widok `public.widok_kursanci` ma `security_invoker = true`, więc
działa w uprawnieniach pytającego — obowiązuje go RLS tabel pod spodem,
a nie prawa właściciela widoku. Instruktor widzi przez niego dokładnie
tyle, ile widział wcześniej.

**Testy:** `testy/kontrakty.js` 6–13 — porównanie pól obu warstw,
z prawdziwym wgraniem pliku i prawdziwym podpisanym linkiem po stronie
lokalnej.

---

## 4 · Logowanie i reset hasła

- **„Ustaw nowe" naprawdę wysyła.** Wcześniej link tylko wypisywał
  komunikat. Teraz bierze adres z formularza i woła
  `resetPasswordForEmail`. Odpowiedź jest zawsze taka sama („jeśli konto
  istnieje…") — żeby nie dało się sprawdzać, kto ma u nas konto.
- **`nowe-haslo.html` ładuje warstwę danych.** Wcześniej nie ładował
  niczego, więc `window.DANE_SUPABASE` z definicji było puste.
- **Jeden wariant linku.** Zaproszenie i reset prowadzą pod ten sam adres
  `/nowe-haslo.html`; Supabase dokleja fragment `#access_token=…&type=…`,
  klient zakłada z niego sesję (`detectSessionInUrl`), a ekran robi
  `updateUser({ password })`. Świadomie **nie** używamy PKCE: przy
  zaproszeniu link powstaje po stronie serwera, więc w przeglądarce
  zapraszanego nie ma `code_verifier` i przepływ PKCE by się wywalił.
  Zniknęły warianty `?zaproszenie=…`, `?token=…` i `verifyOtp`.
- **Redirect URLs w instrukcji** — `URUCHOMIENIE.md` §2.5 podaje adresy
  co do znaku i mówi wprost, co się stanie, gdy ich zabraknie.

**Testy:** `testy/kontrakty.js` 14 (adres powrotu resetu) i 15
(wylogowanie idzie przez Supabase). Sam ruch do Auth pozostaje
**oczekujący** — A1–A9 w `testy/oczekujace.md`.

---

## 5 · Edge Function `zapros`

| co | jak |
|---|---|
| `OPTIONS` | obsłużone, zwraca 200 z nagłówkami CORS |
| CORS | nagłówki doklejane do **każdej** odpowiedzi, także do błędów — inaczej przeglądarka nie pokaże nawet komunikatu |
| `Allow-Origin` | `ADRES_APLIKACJI`, gdy jest znany; `*` tylko w ostateczności (i tak wymagany jest token admina) |
| błąd nadania roli | sprawdzany — i **weryfikowany na zwróconym wierszu**, nie po samym braku błędu |
| błąd przypisania kursu | sprawdzany tak samo |
| konto połowiczne | **kasowane** (`auth.admin.deleteUser`), funkcja zwraca 500 z wyjaśnieniem |
| gdy nie da się skasować | odpowiedź mówi wprost: `stan: "czesciowe"` + adres do ręcznego usunięcia w panelu |

Nie ma już ścieżki, w której funkcja zwraca 200, a konto nie ma roli albo
kursu.

**Testy:** E1–E7 w `testy/oczekujace.md` — **oczekujące**, wymagają
wdrożonej funkcji.

---

## 6 · Wyzwalacz nowego konta w migracji

**Było:** `create trigger na_nowego_uzytkownika …` jako ręczny krok
w instrukcji. Pominięcie go = konta bez profili i nikt nie może się
zalogować.

**Jest:** blok `do $$ … $$` na końcu `db/01_schema.sql`. Idempotentny
(`drop trigger if exists` + `create`), sprawdza istnienie `auth.users`
i **mówi, co zrobił**: `NOTICE` przy sukcesie, `WARNING` przy braku
tabeli albo uprawnień. Lokalnie i na Supabase — ten sam plik.

---

## 7 · Zapisy, które muszą zmienić wiersz

**Było:** `zamknijPytanie`, `odepnij`, `usunMaterial`, zmiana roli
i aktywności sprawdzały tylko `error`. RLS przy braku uprawnień nie
zgłasza błędu — po prostu nie ma czego zmienić. Aplikacja pokazywała
sukces tam, gdzie baza nie zrobiła nic.

**Jest:** wspólny pomocnik `zmieniony()` w `dane-supabase.js`. Każdy
zapis kończy się `.select()`, a brak zwróconego wiersza to **błąd**.
Tam, gdzie wyzwalacz może po cichu cofnąć zmianę (`rola`, `aktywne`,
`opublikowany`), porównujemy dodatkowo wartość w zwróconym wierszu
z tym, o co prosiliśmy.

Serwer deweloperski robił to już po poprzedniej rundzie — teraz obie
warstwy zachowują się tak samo.

---

## 8 · Ostatni administrator — koniec z wyścigiem

**Było:** `select count(*) … where id <> old.id`. Dwie równoczesne
transakcje, każda wyłączająca innego z dwóch ostatnich adminów, widziały
po jednym pozostałym i **obie przechodziły**. System zostawał bez
administratora.

**Jest:** `pg_advisory_xact_lock` (`public.zablokuj_licznik_adminow()`)
brany **tylko wtedy**, gdy zmiana naprawdę dotyka aktywnego admina — więc
zwykłe aktualizacje profilu nie są serializowane. Druga transakcja czeka,
liczy już po zatwierdzeniu pierwszej i dostaje odmowę.

**Test:** `testy/bezpieczenstwo.js` 16 — dwa równoległe połączenia,
prawdziwa równoczesność.

**Sprawdziłem, że test nie jest pusty.** Po tymczasowym opróżnieniu
funkcji blokującej test wypisuje: *„druga transakcja czekała na blokadę:
false · wynik: PRZESZŁO"* i **nie przechodzi**. Wyścig był realny.

---

## 9 · `esc()` koduje też cudzysłowy

**Było:** `esc()` zamieniało `&`, `<` i `>`. Te same dane trafiają
jednak do atrybutów (`data-nazwa`, `title`), gdzie zwykły `"` zamyka
atrybut — a wystarczyłby materiał o nazwie z cudzysłowem.

**Jest:** dochodzą `"` → `&quot;` i `'` → `&#39;`. Wszystkie miejsca,
w których wartość z bazy trafia do atrybutu, idą przez `esc()`.

---

## 10 · Test kontraktów front ↔ Supabase

Nowy plik `testy/kontrakty.js`, **15 testów**. Uruchamia **ten sam
plik** `web/dane-supabase.js`, który pojedzie na produkcję, na atrapie
klienta odpowiadającej **prawdziwymi wierszami z lokalnej bazy**, i
porównuje jego odpowiedzi z odpowiedziami warstwy lokalnej — pole po polu.

Łapie dokładnie to, co przegapiliśmy: brakujące funkcje, inny kształt
odpowiedzi, zostawione w ekranach `/api/*`, zły adres powrotny resetu,
wylogowanie omijające Supabase.

Atrapa **honoruje listę kolumn** z `select()`, więc porównanie dotyczy
tego, co adapter naprawdę pobierze, a nie całego wiersza. Pierwsza wersja
tego nie robiła i test 6 wywalił się na `utworzone` — dopiero po poprawce
porównanie ma sens.

---

## Co jeszcze wyszło przy okazji

**Serwer padał od jednego nieudanego zapisu pliku.** `fs.createWriteStream`
bez `on('error')` — brak praw do katalogu magazynu albo pełny dysk
kończył się nieobsłużonym zdarzeniem i **śmiercią całego procesu**.
Wyszło, kiedy `testy/kontrakty.js` po raz pierwszy wgrał plik jako inny
użytkownik systemu. Teraz to jeden czytelny błąd 500 dla jednego żądania.

---

## Wyniki

```
BAZA        16 / 16     testy/bezpieczenstwo.js
HTTP        16 / 16     testy/http.js
IMPORT       5 /  5     testy/import.js
KONTRAKTY   15 / 15     testy/kontrakty.js
razem       52 / 52
```

Z podziałem, o który prosił audyt:

| poziom | ile | stan |
|---|---|---|
| Testy lokalne (baza, HTTP, import) | 37 | **wykonane** |
| Testy adaptera produkcyjnego (kontrakty) | 15 | **wykonane** |
| Testy żywego Supabase (Auth, Storage, Edge) | 20 | **OCZEKUJĄCE** |

**Nie mówię, że „wszystko zamknięte".** Dopóki nie przejdzie test od
końca do końca na osobnym projekcie Supabase — logowanie, reset,
zaproszenie, trzy role, przypisanie, postęp, pytanie i odpowiedź,
wgranie, publikacja, pobranie, usunięcie i wyłączenie konta — status
tej paczki to **kandydat**, nie produkcja.

---

## Czego świadomie nie ruszałem

- Wygląd — ani jednego piksela. Audyt prosił, żeby nie analizować go ponownie.
- Wersja produkcyjna strony szkoły — nietknięta.
- Gałęzie `main` i `platforma` w repozytorium — nietknięte.
- Nie założyłem projektu Supabase, nie kupiłem niczego, nie podpiąłem domeny.

## Nowe pliki

```
web/warstwa-danych.js          przełącznik warstwy danych + adapter lokalny
web/konfig.js                  generowana konfiguracja frontu (tu: pusta)
narzedzia/zbuduj-konfig.js     .env → web/konfig.js
testy/kontrakty.js             15 testów zgodności front ↔ obie warstwy
RAPORT_ZMIAN_v2.md             raport poprzedniej rundy
```
