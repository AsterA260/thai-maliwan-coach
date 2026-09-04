# AsterA Coach — jak to uruchomić

Zamknięta platforma szkoleniowa z prawdziwym logowaniem i trzema rolami.
Nic nie jest opublikowane, nic nie poszło na GitHuba, wersja produkcyjna
strony szkoły nietknięta. Gałąź: **`platforma-v7`**.

Co zmieniło się po audycie — patrz `RAPORT_ZMIAN.md`.
Czego jeszcze nie sprawdziliśmy — `testy/oczekujace.md`.

## Jedna rzecz, którą warto wiedzieć na starcie

Ekrany **nie wiedzą**, skąd biorą dane. Wołają `DANE.<funkcja>()`,
a `web/warstwa-danych.js` podstawia pod to jedno z dwojga:

| kiedy | co siedzi pod spodem |
|---|---|
| `web/konfig.js` ma puste `SUPABASE_URL` | serwer deweloperski `/api/*` |
| `web/konfig.js` ma adres Supabase | `web/dane-supabase.js` |

Przejście na produkcję to **wygenerowanie konfig.js** (`npm run konfig`),
nie przepisywanie kodu.

---

## 1 · Uruchomienie lokalne — bez zakładania czegokolwiek

Działa na PostgreSQL na tej maszynie. Zero kont, zero opłat, zero internetu.

```bash
# baza
initdb -D /var/lib/pgcoach -U postgres --auth=trust
pg_ctl -D /var/lib/pgcoach -o "-p 5433 -k /tmp" start
createdb -h /tmp -p 5433 -U postgres coach

# schemat, uprawnienia, dane
cd coach
psql -h /tmp -p 5433 -U postgres -d coach -f db/00_supabase_lokalnie.sql
psql -h /tmp -p 5433 -U postgres -d coach -f db/01_schema.sql
psql -h /tmp -p 5433 -U postgres -d coach -f db/02_rls.sql
psql -h /tmp -p 5433 -U postgres -d coach -f db/04_dane_startowe.sql

# import treści z arkusza
python3 db/import_xlsx.py AsterA_Coach_Baza_Tresci.xlsx > db/05_import.sql
psql -h /tmp -p 5433 -U postgres -d coach -f db/05_import.sql

# aplikacja
npm install
npm start                   # → http://127.0.0.1:8910

# wszystkie testy (baza + HTTP + import + kontrakty)
npm run testy
```

Wgrane pliki lądują w `magazyn/materialy/kurs/<id>/<typ>/…` — to lokalny
odpowiednik prywatnego bucketu. Katalog jest w `.gitignore`.

**Konta demonstracyjne** (tylko lokalnie, hasła w `serwer/dev.js`):

| konto | hasło | rola |
|---|---|---|
| norbert@thaimaliwan.pl | demo-norbert | administrator |
| maliwan@thaimaliwan.pl | demo-maliwan | instruktor |
| ania@przyklad.pl | demo-ania | kursantka, kurs podstawowy |
| piotr@przyklad.pl | demo-piotr | kursant, kurs mistrzowski |
| ktos@obcy.pl | demo-obcy | kursant bez przypisania |

---

## 2 · Przeniesienie na Supabase

**Niczego nie zakładałem i nie płaciłem.** Poniższe kroki wykonuje Norbert.

### 2.1 Projekt

1. Załóż projekt na supabase.com (plan darmowy wystarcza na start).
2. Region: **Frankfurt (eu-central-1)** — dane zostają w UE.
3. Zapisz w bezpiecznym miejscu hasło do bazy.

### 2.2 Schemat

W panelu → **SQL Editor** → uruchom po kolei:

1. `db/01_schema.sql`
2. `db/02_rls.sql`
3. `db/03_storage.sql`

**`db/00_supabase_lokalnie.sql` POMIŃ** — to atrapa warstwy Auth, potrzebna
tylko lokalnie. Na Supabase `auth.users` i `auth.uid()` już istnieją.

Wyzwalacz `na_nowego_uzytkownika` (profil dla każdego nowego konta)
**zakłada się sam** — jest częścią `db/01_schema.sql` i można go
uruchomić wielokrotnie. W logu SQL Editora zobaczysz:
`NOTICE: Wyzwalacz na_nowego_uzytkownika zalozony na auth.users.`
Gdyby zamiast tego pojawiło się `WARNING`, zatrzymaj się — bez tego
wyzwalacza zaproszone osoby nie dostaną profilu i nie zalogują się.

### 2.3 Magazyn plików

**Storage → New bucket** → nazwa `materialy`, **Public: WYŁĄCZONE**.
Polityki zakłada `db/03_storage.sql`.

### 2.4 Edge Function do zapraszania

```bash
supabase functions deploy zapros
supabase secrets set ADRES_APLIKACJI=https://coach.thaimaliwan.pl
```

**Kluczy Supabase NIE ustawiasz ręcznie.** Platforma sama podaje je
funkcji w zmiennych środowiskowych — nowe `SUPABASE_SECRET_KEYS`
i `SUPABASE_PUBLISHABLE_KEYS`, starsze `SUPABASE_SERVICE_ROLE_KEY`
i `SUPABASE_ANON_KEY`. Funkcja bierze pierwszy, który zastanie.
Klucz sekretny nigdy nie schodzi do przeglądarki.

Funkcja używa klucza sekretnego **wyłącznie** do założenia konta
w Auth (i do jego wycofania, gdy coś pójdzie nie tak). Rolę i kurs
zapisuje już tokenem zalogowanego administratora — patrz 2.6.

### 2.5 Rejestracja i adresy powrotne

**Authentication → Providers → Email**:

- `Enable email provider`: ✅
- `Allow new users to sign up`: ❌ **WYŁĄCZ** — konta zakłada wyłącznie admin
- `Confirm email`: ✅

**Authentication → URL Configuration**:

| pole | wartość |
|---|---|
| `Site URL` | `https://coach.thaimaliwan.pl` |
| `Redirect URLs` | `https://coach.thaimaliwan.pl/nowe-haslo.html` |
| `Redirect URLs` | `https://coach.thaimaliwan.pl/index.html` |
| `Redirect URLs` (tylko gdy testujesz lokalnie) | `http://127.0.0.1:8910/nowe-haslo.html` |

**To nie jest ozdobnik.** Zaproszenie i reset hasła odsyłają pod
`/nowe-haslo.html`. Adresu, którego nie ma na tej liście, Supabase nie
przepuści — link z poczty wyrzuci użytkownika na stronę główną i hasła
nie da się ustawić. Adres musi się zgadzać co do znaku, razem z `https://`.

### 2.6 PIERWSZY ADMINISTRATOR — przeczytaj w całości

To jedyne miejsce, które trzeba zrobić dokładnie tak, jak niżej.

**Dlaczego nie zwykłym UPDATE-em.** Wyzwalacz `chron_profil` przepuszcza
zmianę roli tylko wtedy, gdy w sesji siedzi zalogowany administrator
(`auth.uid()` wskazuje na konto z rolą `admin`). W SQL Editorze nikt nie
jest zalogowany, więc:

```sql
update public.profile set rola = 'admin' where email = 'norbert@thaimaliwan.pl';
-- UPDATE 1   ← i rola DALEJ jest 'kursant'. Baza cofa zmianę po cichu.
```

To był realny błąd w poprzedniej wersji instrukcji. Teraz jest jedna,
sprawdzona droga:

**Krok 1.** Authentication → Users → **Invite user** → `norbert@thaimaliwan.pl`.
Wyzwalacz założy profil z rolą `kursant`.

**Krok 2.** SQL Editor:

```sql
select public.ustanow_pierwszego_admina('norbert@thaimaliwan.pl');
```

Funkcja:

- **odmawia**, gdy istnieje już choć jeden aktywny administrator — więc
  nie da się jej użyć drugi raz;
- **nie jest dostępna** dla `anon` ani `authenticated`, czyli aplikacja
  i przeglądarka nie mają do niej dostępu (test bazy 20);
- bierze tę samą blokadę co ochrona ostatniego admina, więc dwa
  równoczesne wywołania nie zrobią dwóch „pierwszych" adminów.

**Krok 3.** Sprawdź:

```sql
select imie, email, rola, aktywne from public.profile order by rola;
```

**Krok 4.** Wszystkie kolejne konta — instruktorkę Maliwan, kursantów —
zakładasz już **z aplikacji**: Konta → „Zaproś osobę". Tam rola nadaje
się automatycznie, bo zapis idzie Twoim tokenem administratora.
Do SQL Editora nie wracasz.

### 2.6a Odzyskanie administratora — sprostowanie

**Poprzednia wersja tej instrukcji była myląca.** Pisała: „wyłącz albo
zdegraduj pozostałych adminów z aplikacji, a gdy nie ma już żadnego
aktywnego — funkcja znów zadziała". **Tak się nie da** i sprawdziłem to
na bazie: ostatniego aktywnego administratora chroni wyzwalacz, więc
próba z aplikacji kończy się błędem:

```
ERROR: To jedyny aktywny administrator — nie mozna go wylaczyc ani zdegradowac.
```

Czyli stan „zero aktywnych adminów" nigdy nie powstanie tą drogą.
Prawdziwe scenariusze wyglądają tak:

| sytuacja | co zrobić |
|---|---|
| **Zapomniane hasło administratora** | „Ustaw nowe" na ekranie logowania. Konto i rola zostają bez zmian. To 99 % przypadków. |
| **Skrzynka administratora niedostępna** | Authentication → Users → zmień adres konta albo wyślij link resetu z panelu. |
| **Jest drugi administrator** | On nadaje rolę w aplikacji: Konta → wybierz osobę → `admin`. Nic więcej nie trzeba. |
| **Naprawdę nie ma dostępu do żadnego konta admina** | Procedura ratunkowa niżej — **tylko z panelu Supabase**. |

**Procedura ratunkowa** (SQL Editor, wymaga dostępu do panelu Supabase,
czyli najwyższych uprawnień, jakie w ogóle są). Cała w jednej transakcji,
żeby dało się ją przerwać:

```sql
begin;
  select set_config('astera.inicjalizacja', 'tak', true);
  update public.profile set rola = 'instruktor' where rola = 'admin' and aktywne;
  select set_config('astera.inicjalizacja', 'nie', true);

  select public.ustanow_pierwszego_admina('nowy.admin@thaimaliwan.pl');
  select imie, email, rola from public.profile where rola = 'admin';
-- sprawdź wynik powyżej. Dobrze? → commit;   Źle? → rollback;
commit;
```

Sprawdzone na bazie: po `commit` nowy adres ma rolę `admin`, po
`rollback` nic się nie zmienia.

**Dlaczego to nie jest furtka.** Wykonać to może wyłącznie osoba
zalogowana do panelu Supabase — a kto ma panel, ma i tak pełną władzę
nad bazą. Z aplikacji, z przeglądarki i z klucza publicznego ta droga
jest niedostępna: flaga `astera.inicjalizacja` działa tylko poza rolami
`authenticated` i `anon` (test bazy 20), a sama funkcja nie ma dla nich
prawa wykonania.

### 2.7 Kursy i treść

```sql
-- kursy zgodne ze stroną szkoły
insert into public.kurs (kod, nazwa_pl, nazwa_th, dni, godzin, cena_gr, instruktor_id, opublikowany)
values ('podstawowy','Tradycyjny masaż tajski','นวดแผนไทยดั้งเดิม',2,12,190000,
        (select id from public.profile where email='maliwan@thaimaliwan.pl'), true);
```

Potem uruchom `db/05_import.sql` (wygenerowany z arkusza).

### 2.8 Front — jedno polecenie

```bash
cp .env.example .env        # i uzupełnij SUPABASE_URL,
                            # SUPABASE_PUBLISHABLE_KEY, ADRES_APLIKACJI
npm run konfig              # → web/konfig.js
```

**Który klucz.** Project Settings → **API Keys**. Nowe projekty (2026)
mają dwa: **publishable** (`sb_publishable_…`) — ten idzie do frontu —
i **secret** (`sb_secret_…`), który omija RLS i zostaje po stronie
serwera. Starsze projekty mają odpowiedniki `anon` i `service_role`;
Supabase wygasza je **do końca 2026 roku**, więc dla nowego projektu
bierzemy od razu nowe. Skrypt przyjmie jeden i drugi, ale przy starym
kluczu wypisze ostrzeżenie.

To wszystko. **Nie podmienia się żadnego kodu.** Od tej chwili wszystkie
trzy ekrany chodzą po Supabase; przy pustym `SUPABASE_URL` wracają na
serwer deweloperski. Sprawdzić można w konsoli przeglądarki: `window.TRYB`
pokaże `supabase` albo `lokalny`.

`npm run konfig` przepisuje do frontu **wyłącznie** adres projektu,
klucz publiczny, nazwę bucketu i adres aplikacji. Klucz **sekretny**
nie pojawia się we froncie **nigdy**: skrypt go pomija, mówi o tym
ostrzeżeniem, a na koniec sprawdza gotowy plik i **przerywa z błędem**,
gdyby ten klucz mimo wszystko w nim był.

---

## 3 · Co jest czym w repozytorium

| ścieżka | co to |
|---|---|
| `db/00_supabase_lokalnie.sql` | atrapa warstwy Auth — **tylko lokalnie** |
| `db/01_schema.sql` | tabele, typy, wyzwalacz nowego konta |
| `db/02_rls.sql` | **całe bezpieczeństwo** — polityki dla trzech ról |
| `db/03_storage.sql` | polityki prywatnego magazynu plików |
| `db/04_dane_startowe.sql` | konta i kursy demonstracyjne |
| `db/import_xlsx.py` | arkusz → SQL |
| `serwer/dev.js` | serwer deweloperski; **nie zawiera żadnej reguły uprawnień** |
| `web/index.html` | ekran logowania |
| `web/app.html` | aplikacja — orbita na laptopie, lista na telefonie |
| `web/nowe-haslo.html` | ustawienie hasła z zaproszenia albo resetu |
| `web/warstwa-danych.js` | **przełącznik**: lokalnie `/api/*`, na produkcji Supabase |
| `web/dane-supabase.js` | warstwa danych na produkcji |
| `web/konfig.js` | generowany z `.env` przez `npm run konfig` |
| `narzedzia/zbuduj-konfig.js` | generator konfiguracji frontu |
| `testy/bezpieczenstwo.js` | 21 testów bazy, polityk RLS i ról |
| `testy/http.js` | 16 testów przez HTTP: sesje, pliki, uprawnienia |
| `testy/import.js` | 5 testów importu (idempotencja, postępy) |
| `testy/kontrakty.js` | 15 testów zgodności front ↔ obie warstwy danych |
| `testy/oczekujace.md` | **26 scenariuszy, których lokalnie nie da się sprawdzić** |
| `.gitignore` | co nigdy nie trafia do repozytorium — na czele z `.env` |
| `supabase/functions/zapros/` | Edge Function — jedyne miejsce z `service_role` |

---

## 4 · Zasada, na której to stoi

**Uprawnienia są w bazie, nie w przeglądarce.**

Menu i panele w `app.html` to wyłącznie wygoda. Gdyby ktoś podmienił
JavaScript, wpisał `#konta` w adres albo strzelił prosto do API —
zapytanie i tak przechodzi przez polityki RLS i nie zwraca nic,
czego mu nie wolno. Serwer deweloperski nie ma ani jednego warunku
typu „jeśli rola == admin". Ustawia tylko tożsamość i oddaje decyzję bazie.

---

## 5 · Czego potrzebuję od Ciebie, żeby ruszyć na produkcję

| # | co | dlaczego |
|---|---|---|
| 1 | **Zgoda na założenie projektu Supabase** i decyzja: darmowy czy Pro (~25 USD/mies.) | darmowy usypia bazę po tygodniu bezczynności i ma 1 GB plików |
| 2 | **Adres, pod którym ma stać** — np. `coach.thaimaliwan.pl` | rekord DNS + Site URL w Supabase |
| 3 | **Lista kont na start**: imię + e-mail + rola | konta zakłada admin, nie ma rejestracji |
| 4 | **Decyzja o Maliwan**: instruktor wszystkich trzech kursów czy tylko wybranych | od tego zależy, co widzi |
| 5 | **Materiały do wgrania** — pliki PDF, zdjęcia, nagrania | teraz w bazie są tylko nazwy z arkusza, bez plików |
| 6 | **Kto zakłada konta kursantom** — Ty czy Maliwan | jeśli Maliwan, trzeba jej dołożyć uprawnienie do zapraszania |
| 7 | **Czy kursant ma widzieć materiał po kursie, czy tylko w trakcie** | dziś: bezterminowo, dopóki przypisanie jest aktywne |
| 8 | **Tłumaczenie tajskie treści etapów** | arkusz ma tajski dla dziesięciu etapów kursu podstawowego, reszta pusta |
| 9 | **Regulamin i informacja o danych osobowych** | platforma przechowuje imiona, e-maile i postępy — potrzebna podstawa prawna |

Bez punktów 1–3 nie da się wystartować. Reszta może poczekać.

---

## 6 · Czego świadomie NIE ma

- rejestracji publicznej (wyłączona z założenia)
- płatności i sprzedaży kursów
- tłumacza na żywo i nagrywania sesji (osobny etap, wymaga backendu)
- powiadomień e-mail poza tymi, które wysyła Supabase Auth
- eksportu do XLSX (import działa; eksport dopiszę, gdy będzie potrzebny)
