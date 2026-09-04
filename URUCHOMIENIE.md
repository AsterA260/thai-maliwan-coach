# AsterA Coach — jak to uruchomić

Zamknięta platforma szkoleniowa z prawdziwym logowaniem i trzema rolami.
Nic nie jest opublikowane, nic nie poszło na GitHuba, wersja produkcyjna
strony szkoły nietknięta. Gałąź: **`platforma-poprawki`**.

Co zmieniło się po audycie — patrz `RAPORT_ZMIAN.md`.
Czego jeszcze nie sprawdziliśmy — `testy/oczekujace.md`.

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

# wszystkie testy (baza + HTTP + import)
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

Potem podłącz zakładanie profilu przy nowym koncie:

```sql
create trigger na_nowego_uzytkownika
  after insert on auth.users
  for each row execute function public.obsluz_nowego_uzytkownika();
```

### 2.3 Magazyn plików

**Storage → New bucket** → nazwa `materialy`, **Public: WYŁĄCZONE**.
Polityki zakłada `db/03_storage.sql`.

### 2.4 Edge Function do zapraszania

```bash
supabase functions deploy zapros
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... ADRES_APLIKACJI=https://coach.thaimaliwan.pl
```

Klucz `service_role` zostaje po stronie Supabase. Front go nigdy nie widzi.

### 2.5 Wyłączenie publicznej rejestracji

**Authentication → Providers → Email**:

- `Enable email provider`: ✅
- `Allow new users to sign up`: ❌ **WYŁĄCZ** — konta zakłada wyłącznie admin
- `Confirm email`: ✅

**Authentication → URL Configuration** → `Site URL` = adres aplikacji
(np. `https://coach.thaimaliwan.pl`).

### 2.6 Pierwsze konta

**Authentication → Users → Invite user** dla każdej osoby. Po założeniu,
w SQL Editor, nadaj role:

```sql
update public.profile set rola = 'admin'      where email = 'norbert@thaimaliwan.pl';
update public.profile set rola = 'instruktor' where email = 'maliwan@thaimaliwan.pl';
```

### 2.7 Kursy i treść

```sql
-- kursy zgodne ze stroną szkoły
insert into public.kurs (kod, nazwa_pl, nazwa_th, dni, godzin, cena_gr, instruktor_id, opublikowany)
values ('podstawowy','Tradycyjny masaż tajski','นวดแผนไทยดั้งเดิม',2,12,190000,
        (select id from public.profile where email='maliwan@thaimaliwan.pl'), true);
```

Potem uruchom `db/05_import.sql` (wygenerowany z arkusza).

### 2.8 Front

W `.env` (z `.env.example`) uzupełnij `SUPABASE_URL` i `SUPABASE_ANON_KEY`,
a w `app.html` podmień funkcję `api` na moduł `web/dane-supabase.js`.
Klucz **service role** nie pojawia się we froncie **nigdy**.

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
| `web/dane-supabase.js` | warstwa danych na produkcji |
| `testy/bezpieczenstwo.js` | 15 testów bazy i polityk RLS |
| `testy/http.js` | 16 testów przez HTTP: sesje, pliki, uprawnienia |
| `testy/import.js` | 5 testów importu (idempotencja, postępy) |
| `testy/oczekujace.md` | **20 scenariuszy, których lokalnie nie da się sprawdzić** |
| `web/nowe-haslo.html` | ustawienie hasła z zaproszenia albo resetu |
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
