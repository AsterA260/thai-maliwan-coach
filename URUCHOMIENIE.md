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

# migracje — od Etapu 1 schemat rozwija się WYŁĄCZNIE tą drogą
node narzedzia/migruj.js

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

**Krok 2.** SQL Editor — **jako właściciel bazy**, w transakcji:

```sql
begin;
  set local role astera_seed;
  select public.ustanow_pierwszego_admina('norbert@thaimaliwan.pl');
commit;
```

Linijka `set local role astera_seed` **nie jest ozdobnikiem** — bez niej
funkcja odmawia. Od Etapu 1a tryb inicjalizacyjny wymaga jawnego wejścia
w rolę `astera_seed`; sam brak zalogowanego użytkownika nie daje już
żadnych dodatkowych praw (§4.2, test bazy 28).

Funkcja:

- **odmawia**, gdy istnieje już choć jeden aktywny administrator — więc
  nie da się jej użyć drugi raz;
- **odmawia**, gdy wywołujący nie jest w roli `astera_seed`;
- **nie jest dostępna** dla `anon`, `authenticated` ani `astera_api`,
  czyli aplikacja i przeglądarka nie mają do niej dostępu (testy 20, 28);
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
  set local role astera_seed;
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

### 4.1 Tożsamość zalogowanego — mechanizm obowiązujący

Wprowadzone w Etapie 0 migracji na AWS. Zastępuje `auth.uid()` Supabase.

**Wzorzec, od którego nie ma odstępstw.** Każde zapytanie w imieniu
użytkownika wykonuje się w jawnej transakcji, z tożsamością ustawioną
na jej zakres:

```
BEGIN
select set_config('astera.uzytkownik', <uuid>, true);   -- true = LOCAL
… zapytania …
COMMIT
```

Czyta to funkcja `public.uid()`. Bez ustawienia zwraca `NULL`, a polityki
RLS nie przepuszczają wtedy niczego.

**Trzy rzeczy, które trzeba wiedzieć, żeby tego nie zepsuć.**

**1. `set_config(..., true)`, nigdy `SET`.**
`SET LOCAL x = $1` nie istnieje — PostgreSQL nie przyjmuje w tym poleceniu
parametru. Jedyną formą pozwalającą podać wartość bezpiecznie, bez sklejania
SQL-a z danych, jest `set_config` z trzecim argumentem `true`. Wariant
`false` ustawia wartość **na całe połączenie** i przy współdzielonej puli
przenosi tożsamość na kolejnego użytkownika. To jest dokładnie ten błąd,
który test 22 potrafi wykryć.

**2. Bez jawnej transakcji to nie działa.**
W trybie autozatwierdzania ustawienie lokalne wygasa razem z poleceniem,
które je wykonało — czyli **zanim** przyjdzie właściwe zapytanie. Kod wygląda
poprawnie, a tożsamości nie ma. Objaw: zapytania zwracają zero wierszy bez
żadnego błędu.

**3. Stan domyślny to „nikt", nie „poprzedni".**
Połączenie wracające do puli nie może zabrać ze sobą cudzej tożsamości.
Przy własnej puli po stronie Core należy zwracać połączenie czyste
(`DISCARD ALL` albo równoważne ustawienie proxy).

**Rola bazodanowa.** Aplikacja łączy się rolą `astera_api`: bez
`BYPASSRLS`, bez `SUPERUSER`, niebędącą właścicielem tabel. Lokalnie rola
jest `NOLOGIN` i wchodzi się w nią przez `SET ROLE`; na Aurorze dostanie
`LOGIN` i poświadczenia z menedżera sekretów — hasła nie ma w repozytorium.

**Kontekst inicjalizacji.** Flaga `astera.inicjalizacja` przepuszcza nadanie
pierwszych ról przy zakładaniu bazy. Działa wyłącznie w transakcji i tylko
wtedy, gdy **nikt nie jest zalogowany** (`public.uid() is null`) i gdy robi
to rola inna niż aplikacyjna. Ktokolwiek działa przez Core ma ustawioną
tożsamość i tym samym jest tu odcięty, niezależnie od tego, jaką flagę sobie
ustawi. Pilnują tego testy 19 i 20.

**Czym to jest sprawdzone.** Test 22 w `testy/bezpieczenstwo.js`: 30 żądań
przez pulę 3 połączeń, każde z inną tożsamością — żadne nie widzi cudzych
danych; żądania bez tożsamości widzą zero wierszy. Trzecia część testu
celowo używa ustawienia sesyjnego i sprawdza, że tożsamość **zostaje** na
połączeniu — bez tego nie wiedzielibyśmy, czy test w ogóle potrafi wykryć
błąd.

### 4.2 Kto może zakładać dane — rola `astera_seed`      [Etap 1a]

Zakładanie danych startowych i pierwszego administratora omija ochronę,
której podlega cały normalny ruch. Trzeba więc powiedzieć wprost, kto ma
do tego prawo — i powiedzieć to tak, żeby nie dało się w to wejść
przypadkiem.

**Zasada brzmi: brak tożsamości = nikt = zero uprawnień.** Nic ponadto.

Do Etapu 1a było inaczej. Kontekst inicjalizacji rozpoznawało się po
dwóch rzeczach, z których obie były słabe:

| co sprawdzano | dlaczego to było złe |
|---|---|
| rola **nie jest** jedną z `astera_api`, `authenticated`, `anon` | lista wykluczeń chroni tylko przed tym, co ktoś zdążył na nią wpisać — każda nowa rola przechodziła z marszu |
| `public.uid() is null` | zrównywało „nikt tu nie jest zalogowany" z „wolno mi więcej"; technicznie zawężało, ale na złej zasadzie ktoś prędzej czy później by się oparł |

Teraz kontekstem inicjalizacji jest **koniunkcja dwóch świadomych
kroków**, pochodzących z dwóch różnych miejsc:

```sql
begin;
  set local role astera_seed;                              -- 1. rola
  select set_config('astera.inicjalizacja','tak',true);    -- 2. flaga
  ...
commit;
```

Rola `astera_seed` jest `NOLOGIN` — nikt się nią nie połączy. Wejść w nią
może wyłącznie właściciel bazy przez `SET LOCAL ROLE`. Nie jest nadana
ani `astera_api`, ani `authenticated`, ani `anon`, a `02_rls.sql` odbiera
ją im jawnie, zamiast zakładać, że nikt jej nie nada.

Sama flaga nie daje nic i **taki jest zamysł**: ustawić ją może każdy,
bo jest deklaracją intencji, a nie zabezpieczeniem. Zabezpieczeniem jest
rola.

Rola ma `BYPASSRLS`, bo seed wstawia dane, zanim istnieje ktokolwiek,
kto mógłby je zobaczyć. To jest dokładnie ta moc, dla której musi być
odcięta od ruchu aplikacyjnego. **Na Aurorze nadaje się ją wyłącznie
roli migracyjnej — nigdy tej, którą łączy się AsterA Core.**

**Dwie pułapki, na które się nadziałem, warte zapamiętania:**

1. `SET ROLE` **nie działa wewnątrz funkcji `security definer`** —
   PostgreSQL odmawia: *„cannot set parameter role within
   security-definer function"*. Dlatego `ustanow_pierwszego_admina()`
   przestała być `security definer`, a w rolę wchodzi wywołujący. Wyszło
   to na dobre: w tryb uprzywilejowany wchodzi teraz człowiek, świadomie,
   a nie funkcja po cichu za niego.

2. Ograniczenia `CHECK` i wyzwalacze z prawami wywołującego wołają
   funkcje **prawami tego, kto pisze**. Rola `astera_seed` musi mieć
   `EXECUTE` na funkcjach schematu `public`, inaczej seed kończy się
   `permission denied for function ...`, a nie odmową merytoryczną.
   Nadania obejmują też tabele i funkcje **przyszłe** (`alter default
   privileges`), bo migracje tworzą je po `02_rls.sql`.

**Czym to jest sprawdzone.** Test 28: bez roli sama flaga nie daje
kontekstu i nie zmienia roli konta; `astera_api` nie jest członkiem
`astera_seed` i nie wywoła ani `ustanow_pierwszego_admina()`, ani
`kontekst_inicjalizacji()`; własna flaga nie odblokowuje mu zmiany roli
ani ochrony ostatniego administratora; a prawidłowy, kontrolowany seed
nadal działa. Test sprawdzony pod kątem mocy wykrywczej: **na starej
definicji funkcji nie przechodzi.**

Test 29 pilnuje skutku ubocznego, który przy tej zmianie wyszedł na jaw:
instruktorka musi móc redagować **własny draft** przez Core, a treści
wersji zatwierdzonej — nie.

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

---

## 7 · Migracje i model treści                      [Etap 1 migracji]

### 7.1 Schemat zmienia się tylko migracjami

Pliki `db/01_schema.sql` i `db/02_rls.sql` to **stan bazowy** — uruchamia się
je raz, na pustej bazie. Wszystko, co dochodzi później, jest numerowaną
migracją w `db/migracje/`.

```bash
node narzedzia/migruj.js           # wykonaj brakujące
node narzedzia/migruj.js --stan    # co wykonane, co czeka
node narzedzia/migruj.js --sucho   # plan, bez wykonania
```

Każda migracja idzie we własnej transakcji — błąd w środku pliku wycofuje
cały plik, nigdy nie zostaje połowa zmiany.

**Pliku, który już poszedł na bazę, nie edytujemy.** Narzędzie zapamiętuje
skrót treści i przy zmianie zatrzymuje się z błędem. Powód nie jest
formalny: baza, na której migracja poszła w starej wersji, i baza zbudowana
od zera z nowej wyglądałyby na zgodne, nie będąc nimi. Poprawka wchodzi jako
kolejna migracja.

### 7.2 Język jest daną, nie kolumną

Do Etapu 1 każdy tekst miał parę kolumn `nazwa_pl` / `nazwa_th`. Trzeci
język oznaczał zmianę schematu, a wersjonowanie wiedzy było niewykonalne.

Teraz teksty leżą w tabelach `*_tekst`, a języki w tabeli `jezyk`.
**Dodanie języka to jeden wiersz, zero DDL.**

Aplikacja nie wybiera języka sama — robi to baza, w widokach odczytowych:

```
widok_kurs · widok_lekcja · widok_etap · widok_material
widok_technika · widok_glosowka
```

Każdy zwraca płaskie `nazwa`, `opis`, `tytul` w języku zalogowanego,
a gdy tłumaczenia w jego języku nie ma — po polsku. Ekran pyta o `nazwa`
i nie wie, że języki w ogóle istnieją.

Skutek uboczny, ale istotny: **tajski wreszcie działa**. Wcześniej kolumny
`_th` były w bazie od początku, a front czytał wyłącznie `_pl` — w 22
miejscach, na sztywno.

### 7.3 Wiedza Maliwan jest wersjonowana

`etap`, `technika` i `glosowka` mają wersje. Zatwierdzonej treści nie
nadpisujemy — każda zmiana tworzy nową wersję.

```
draft ──► do_zmiany ──► draft
  └─────► zatwierdzone ──► zastapione
```

Pilnuje tego baza, nie umowa z zespołem:

- wyzwalacz odrzuca przejścia spoza tej ścieżki,
- indeks częściowy dopuszcza **jedną** wersję `zatwierdzone` na encję,
- osobny wyzwalacz broni treści wersji rozstrzygniętej przed edycją,
- **kursant widzi wyłącznie wersje zatwierdzone** — draftu Maliwan nie
  zobaczy, bo to treść, której jeszcze nie zatwierdziła.

Tłumaczenia wiszą na **wersji**, nie na encji. Bez tego zatwierdzenie
polskiej treści po cichu zmieniałoby tajską.

### 7.4 Technika i głosówki

`technika` jest osobnym bytem, bo jedna technika wraca w wielu etapach
i kursach — a głosówka Maliwan ma być przypięta do techniki, nie do
miejsca w programie. Powiązanie idzie przez `etap_technika`, z
`on delete restrict`: skasowanie etapu nie zabierze techniki używanej
gdzie indziej.

`glosowka` trzyma klucz S3, język źródłowy i powiązanie z **dokładnie
jedną** encją — techniką albo etapem. Transkrypcja i tłumaczenia to
wiersze w `glosowka_tekst`; rola wynika z porównania z językiem źródłowym,
co pokazuje widok `widok_glosowka_tekst`.

Klucz S3 musi wskazywać encję, do której nagranie należy:

```
glosowka/technika/<uuid techniki>/<uuid glosowki>.<ext>
glosowka/etap/<uuid etapu>/<uuid glosowki>.<ext>
```

Pilnuje tego więz CHECK — z jawnym `is not null`. To nie jest ozdobnik:
klucz o złym kształcie daje z funkcji `NULL`, a `NULL = uuid` to `NULL`,
którego CHECK **nie odrzuca**, bo odrzuca wyłącznie `FALSE`. Ten sam człon
dołożyliśmy przy materiałach, gdzie dotąd ratowała nas polityka RLS.
Wykrył to test 27.

---

## 8 · Aurora i RDS Proxy — jak to uruchomić naprawdę        [Etap 1b]

Wszystko poniżej zostało wykonane i zmierzone 6 września 2026 na koncie
AWS Norberta, w regionie `eu-central-1` (Frankfurt). To nie jest plan.

### 8.1 Adres bazy i hasła

Żaden plik w repozytorium nie zawiera hasła. Adres bazy powstaje
w chwili uruchomienia z AWS Secrets Manager:

```sh
export AWS_REGION=eu-central-1
export DATABASE_URL="$(narzedzia/aurora-url.sh)"            # właściciel (postgres)
export DATABASE_URL="$(narzedzia/aurora-url.sh api)"        # login astera_api
export DATABASE_URL="$(narzedzia/aurora-url.sh api proxy)"  # astera_api przez RDS Proxy
```

Sekrety: hasło właściciela zarządza sam AWS (`ManageMasterUserPassword`),
hasło `astera_api` leży w `astera-coach/etap1b/astera_api`. Nikt go nie
widział — wygenerował je `get-random-password` prosto do sekretu.

### 8.2 TLS — dwa różne łańcuchy

Aurora ma certyfikat z łańcucha **Amazon RDS**, RDS Proxy — z **Amazon
Trust Services** (systemowe CA). Pełna weryfikacja na obu drogach wymaga
jednego pliku z oboma zestawami:

```sh
curl -sSo /opt/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
cat /opt/global-bundle.pem /etc/pki/tls/certs/ca-bundle.crt > /opt/ca-aurora-i-proxy.pem
export PGSSLROOTCERT=/opt/ca-aurora-i-proxy.pem
```

`testy/polaczenie.js` zdejmuje `sslmode` z adresu i ustawia TLS wprost:
z `PGSSLROOTCERT` weryfikacja jest pełna, bez — tylko szyfrowanie
(wyłącznie do testów). Sterownik `pg` traktuje `sslmode=require` jak
`verify-full`, stąd ta gimnastyka.

### 8.3 Skąd uruchamiać

Z kontenera Martina nie wychodzi nic poza portami 80/443 — do bazy
(5432) nie ma jak się dostać. RDS Proxy nie ma publicznego adresu
w ogóle. Dlatego testy biegną z małej maszyny EC2 **wewnątrz VPC**
(`astera-etap1b-runner`, t4g.small), sterowanej po HTTPS przez SSM:

```sh
narzedzia/runner.sh 'cd /opt/coach && node testy/bezpieczenstwo.js'
narzedzia/runner.sh - < skrypt.sh
```

Runner klonuje repo z GitHuba kluczem deploy (tylko odczyt) trzymanym
w Secrets Manager. Po etapie: instancję zatrzymać albo usunąć.

### 8.4 Kolejność na świeżej Aurorze

Dokładnie ta sama co lokalnie — i to jest cały sens stanu bazowego
plus migracji: `00` (atrapa Auth, do czasu Cognito) → `01` → `02` →
`node narzedzia/migruj.js` → `04` → `05`. Potem:

```sh
printf "alter role astera_api login password :'pw';\n" \
  | psql "$DATABASE_URL" -v pw="$(aws secretsmanager get-secret-value \
      --secret-id astera-coach/etap1b/astera_api --query SecretString --output text | jq -r .password)"
```

Właściciel na RDS to `rds_superuser`, nie superużytkownik — `CREATE ROLE
... BYPASSRLS` dla `astera_seed` mimo to przeszło.

### 8.5 Co zostało zmierzone

**Pierwszy warunek bezpieczeństwa** — `testy/rola_api_na_zywo.js`, jako
prawdziwa sesja `astera_api` (nie SET ROLE z konta właściciela): 5/5.
`SET ROLE astera_seed` → `permission denied`; flaga inicjalizacji nie
daje nic; `astera_seed` ma jednego członka — właściciela.

**Pełny zestaw testów na Aurorze:** baza 29/29, HTTP 16/16, import 5/5,
kontrakty 15/15 — 65/65, ten sam kod co lokalnie, zero zmian w testach.

**Test 22 przez RDS Proxy** — `testy/proxy_22_i_pinning.js`: tożsamość
nie wycieka; 30 żądań przez 3 połączenia, każde widzi tylko swoje.

**Pinning** (metryki `AWS/RDS` dla `ProxyName`):

| wariant | klientów | pauza | tx/s | poł. do bazy | przypięte |
|---|---|---|---|---|---|
| set_config (Core) | 20 | 0 | 176 | 21 | = pożyczone |
| set_local_role (jak testy) | 20 | 0 | 178 | 21 | = pożyczone |
| set_config (Core) | 60 | 1,5 s | 39 | **31** | = pożyczone |
| kontrola: nic | 60 | 1,5 s | 38 | 33 | brak |

Wnioski: `set_config(..., true)` przypina połączenie, ale **tylko na
czas transakcji** — liczba przypiętych była zawsze równa liczbie
pożyczonych, nigdy nie rosła do liczby klientów. Multipleksowanie
działa: 60 klientów na 31 połączeniach do bazy. Bez przerw między
transakcjami (20 klientów bez pauzy) proxy nie ma czego dzielić —
to własność obciążenia, nie proxy.

### 8.6 Decyzja: WŁASNA PULA Core → Aurora. Proxy nie — i to jest wynik pomiaru

Proxy zdało wszystko, co miało zdać: tożsamość nie wycieka, pinning
kończy się z transakcją, 60 klientów szło na 31 połączeniach. Gdyby
pytanie brzmiało „czy działa" — tak. Ale pytanie brzmi „czy się opłaca",
i tu rozstrzygnął pomiar, którego w planie nie było:

| stan | połączeń do bazy | ACU po 10 min ciszy |
|---|---|---|
| przed utworzeniem Proxy (20:44) | 0 | **0 — baza zasnęła** |
| Proxy bez klientów, `MaxIdleConnectionsPercent=0` (22:06–22:15) | **2** (własne, health-check) | **0,5 — nie zasnęła** |

RDS Proxy trzyma dwa własne połączenia niezależnie od ustawień puli.
Aurora Serverless v2 usypia się tylko przy zerze połączeń. Skutek:
z Proxy baza **nigdy** nie schodzi do 0 ACU — minimum 0,5 ACU × 24 h
≈ 0,06 USD/h ≈ **40–45 USD miesięcznie**, na stałe, za sam fakt
istnienia Proxy. Nie za ruch. Rachunek za Proxy jako taki
(~0,015 USD/ACU-h) jest przy tym pomijalny.

Dla zamkniętej platformy szkoły — kilkudziesięciu użytkowników,
długie okresy ciszy — to jest cały rachunek za bazę, i to w
najspokojniejszym miesiącu.

**Dlatego:**

1. AsterA Core łączy się z Aurorą **własną pulą** (`pg.Pool`, ok. 10
   połączeń), jako `astera_api`, z tożsamością przez
   `set_config(..., true)` — czyli dokładnie tak, jak robi to dziś
   `serwer/dev.js` w `wTransakcji()`. Test 22 udowodnił szczelność
   tej puli w procesie — i lokalnie, i na Aurorze.
2. Proxy **usunięte**. Rola `astera-etap1b-proxy` zostaje: odtworzenie
   Proxy to jedno polecenie i 10 minut, a kod się nie zmienia — tylko
   `DATABASE_URL`.
3. **Kiedy wrócić do Proxy:** gdy Core stanie się rojem krótko
   żyjących Lambd, które otwierają połączenia lawinowo. Dziś nim nie
   jest. Wtedy też ~45 USD/mies. będzie kosztem uzasadnionym ruchem,
   a nie ciszą.

### 8.7 Przed produkcją — zanotowane, nie zrobione

- klaster jest `publicly-accessible` (tylko z IP sesji, port 5432) —
  przełączyć na prywatny, gdy Core stanie w VPC;
- `00_supabase_lokalnie.sql` zastąpi Cognito (Etap 2);
- rola migracyjna na Aurorze to dziś właściciel; docelowo osobny login
  z `astera_seed`, bez praw dla ruchu aplikacyjnego;
- klucz `martin-etap1b` i klucz deploy: usunąć po etapie;
- runner EC2 `astera-etap1b-runner` jest ZATRZYMANY (nie usunięty) — start
  jednym poleceniem, gdy będzie potrzebny do Etapu 2.

---

## 9 · AsterA Core + Cognito — część lokalna                     [Etap 2]

Przygotowane bez tworzenia czegokolwiek w AWS. Wszystko poniżej działa
na lokalnej bazie z atrapą Cognito; ścieżka weryfikacji tokenu jest
DOKŁADNIE produkcyjna, różni się wyłącznie kluczem prywatnym wystawcy.

### 9.1 Dwie skorupy, jeden rdzeń

```
serwer/api.js          rdzeń: 18 handlerów danych, zapytaj/wTransakcji,
                       pliki, serwer HTTP — ciała bajt w bajt z dev.js
serwer/dev.js          skorupa lokalna: sesje w ciasteczku, hasła demo
serwer/core.js         skorupa produkcyjna: token Cognito w nagłówku,
                       konta w Cognito, CORS na jeden origin
serwer/cognito-token.js weryfikacja RS256/JWKS/iss/aud/exp/token_use — bez zależności
serwer/tozsamosc.js    dostawca kont: Cognito (SDK) albo atrapa (testy)
```

Core **nie ma** `POST /api/logowanie` ani `/api/wylogowanie` — przeglądarka
rozmawia z Cognito (USER_SRP_AUTH), Core nigdy nie widzi hasła. Test Core 5
pilnuje, żeby nikt tego nie dopisał.

### 9.2 Zaproszenie w Core = konto + profil, z wycofaniem

```
admin → POST /api/zapros
  1. zaproszenie w bazie (skrót tokenu, jak dotąd)
  2. tozsamosc.utworzKonto(email, imie)  → Cognito AdminCreateUser, MessageAction=SUPPRESS
                                            (wiadomość wyśle Core przez SES — Etap 4)
  3. insert public.profile (id = sub, rola z zaproszenia)  w kontekście admina
  4. profil się nie zapisał? → tozsamosc.usunKonto(sub). Nigdy konto bez profilu.
```

Migracja `008` zdejmuje klucz obcy `profile.id → auth.users` — `sub`
z Cognito nie ma i nie będzie miał wiersza w atrapie Auth. Skutek uboczny,
którego pilnują testy: profil **nie kasuje się kaskadą** — kasowanie konta
jest sprawą Core.

### 9.3 Front — trzeci tryb

`konfig.js` z `CORE_URL + COGNITO_POOL_ID + COGNITO_CLIENT_ID` → tryb `aws`:
`auth-cognito.js` (6 funkcji Auth, SDK amazon-cognito-identity-js z CDN)
+ `dane-aws.js` (18 funkcji danych, wyłącznie Core). Ekrany bez zmian.
Test kontraktów 20: żadna z 18 funkcji nie wykonała żądania poza Core —
sprawdzone przechwyceniem ruchu, nie przeglądem kodu.

`auth-cognito.js` to **szkielet nietestowany lokalnie** — SRP i wyzwanie
NEW_PASSWORD_REQUIRED istnieją tylko w prawdziwej puli.

### 9.4 Uruchomienie Core

```sh
export DATABASE_URL="$(narzedzia/aurora-url.sh api)" PGSSLROOTCERT=/opt/global-bundle.pem
export COGNITO_REGION=eu-central-1 COGNITO_POOL_ID=… COGNITO_CLIENT_ID=…
export CORE_ORIGIN=https://coach.thaimaliwan.pl CORE_HOST=0.0.0.0 PORT=8920
npm run core
```

Poświadczenia AWS dla SDK Cognito bierze rola IAM instancji — nic w plikach.

### 9.5 Cognito na żywo — wykonane                                [Etap 2 AWS]

Pula `astera-coach-etap2` (eu-central-1): e-mail jako login, konta zakłada
wyłącznie administrator, hasło ≥10 znaków z wielką, małą literą i cyfrą,
odzyskiwanie przez zweryfikowany e-mail, ochrona przed usunięciem.
Klient `coach-web`: bez sekretu, **wyłącznie** `USER_SRP_AUTH` +
`REFRESH_TOKEN_AUTH` (hasłem wprost logować się nie da), tokeny 60 min,
odświeżanie 30 dni, `PreventUserExistenceErrors` — nieistniejące konto
dostaje tę samą odmowę co złe hasło.

`testy/cognito_na_zywo.js` — 9/9 przeciw prawdziwej puli, z runnera:
A1 SRP → tokeny · A2 złe hasło · A3 nieistniejące konto = ta sama odmowa ·
C1 Core z prawdziwym JWKS · C2 token ID i zepsuty podpis → 401 ·
Z zaproszenie przez Core → NEW_PASSWORD_REQUIRED → nowe hasło → dane ·
A7 wyłączenie w Core = odmowa w Cognito · A6 wylogowanie globalne ·
**A8 blokada natywna po 6 błędnych próbach** („Password attempts
exceeded"), poprawne hasło w trakcie blokady też odrzucone.

**Hasło tymczasowe.** `AdminCreateUser` z `MessageAction=SUPPRESS` nie
wysyła nic — więc Core generuje hasło tymczasowe sam i oddaje je
wyłącznie do wysyłki zaproszenia (`opcje.wyslijZaproszenie`, Etap 4).
Do odpowiedzi HTTP nie trafia nigdy; test Z to sprawdza.

**Pierwszy administrator na AWS:** konto w Cognito (`utworzKonto`) →
profil z `id = sub` w roli `astera_seed` → od tej chwili wszystko
z aplikacji. Runner ma `cognito-idp:AdminSetUserPassword` **wyłącznie
do testów** (hasła kont testowych) — przed produkcją zdjąć.

Czeka: wysyłka zaproszeń i resetów (SES, Etap 4), Core za HTTPS pod
własnym adresem (Etap 6), front w trybie `aws` przeciw żywej puli (Etap 5).
