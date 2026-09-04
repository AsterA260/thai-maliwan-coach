# RAPORT RÓŻNIC v3 → v4

Gałąź: **`platforma-v4`** · 4 września 2026
Nic nie wdrożone, nic nie opublikowane, nic na GitHubie, wygląd nietknięty.

Krótka wersja: **audyt miał rację co do blokera i co do wszystkich
dziewięciu pozostałych punktów.** Bloker był prawdziwy — sprawdziłem go
na żywej bazie, zanim cokolwiek zmieniłem:

```sql
update public.profile set rola = 'admin' where email = 'ania@przyklad.pl';
-- UPDATE 1
select rola from public.profile where email = 'ania@przyklad.pl';
-- kursant        ← baza po cichu cofnęła zmianę
```

Poprzednie raporty: `RAPORT_ZMIAN_v3.md`, `RAPORT_ZMIAN_v2.md`.

---

## 1 · BLOKER: rola nadawana przy zaproszeniu

**Diagnoza audytu — trafiona co do joty.** `chron_profil()` przepuszcza
zmianę chronionych pól tylko wtedy, gdy `jestem_adminem()` = prawda,
czyli gdy `auth.uid()` wskazuje na zalogowanego administratora. Klient
`service_role` omija RLS, ale **nie jest nikim zalogowanym** — `auth.uid()`
jest puste. Wyzwalacz cofał rolę do `kursant`, funkcja to wykrywała
(dzięki kontroli z v3!) i **kasowała świeżo założone konto**. Zaproszenie
instruktora i administratora było więc trwale zepsute.

**Poprawka.** Klucz serwisowy robi w Edge Function już tylko dwie rzeczy:
`inviteUserByEmail` i — przy wycofywaniu — `deleteUser`. Rolę i przypisanie
kursu zapisuje **klient z tokenem zweryfikowanego administratora**:

```ts
// było: jakoSerwis.from('profile').update({ rola })      ← cicho cofane
const { data } = await jakoUzytkownik.from('profile')
  .update({ rola }).eq('id', idNowego).select('rola');
```

Dla tego klienta `auth.uid()` to identyfikator Norberta, więc wyzwalacz
przepuszcza zmianę, a polityka `profile_admin_all` i tak sprawdza jeszcze
raz, czy proszący jest adminem. Przypisanie do kursu — tak samo.

**Testy 17 i 18** (`testy/bezpieczenstwo.js`) odtwarzają obie drogi na
prawdziwej bazie: konto z `auth.users` → profil `kursant` → nadanie roli
w kontekście admina → `instruktor` / `admin`. Test 18 sprawdza dodatkowo
drogę **bez** tożsamości i pokazuje, że kończy się na `kursant`.

---

## 2 · Pierwszy administrator — droga, która naprawdę działa

Instrukcja v3 kazała nadać pierwszą rolę zwykłym `UPDATE` w SQL Editorze.
Tam też nikt nie jest zalogowany, więc **to nigdy nie mogło zadziałać**.

**Nowa droga — `db/01_schema.sql`:**

```sql
select public.ustanow_pierwszego_admina('norbert@thaimaliwan.pl');
```

Cztery zabezpieczenia, żeby nie powstała furtka do podnoszenia roli:

| zabezpieczenie | co daje |
|---|---|
| odmawia, gdy istnieje aktywny administrator | działa **tylko** przy inicjalizacji |
| brak `EXECUTE` dla `anon`, `authenticated` i `service_role` | nieosiągalna przez PostgREST i przez aplikację |
| `pg_advisory_xact_lock` | dwa równoczesne wywołania nie zrobią dwóch „pierwszych" adminów |
| flaga `astera.inicjalizacja` tylko w tej jednej transakcji | poza nią wyzwalacz działa jak zwykle |

**Tu wyszedł mój własny błąd — i to test go złapał.** Pierwsza wersja
warunku sprawdzała `current_user`. Wewnątrz funkcji `security definer`
`current_user` to **właściciel funkcji**, nie ten, kto ją wywołał, więc
kursant, który sam ustawił sobie flagę, przechodził. Test 20 wypisał
wtedy: *„z własnoręczną flagą: admin"*. Poprawione — warunek patrzy na
GUC `role` **i** na rolę z tokenu, bo obie są odporne na `security definer`.
Teraz test wypisuje `kursant`.

Instrukcja `URUCHOMIENIE.md` §2.6 jest napisana od nowa: cztery kroki,
z wyjaśnieniem, dlaczego zwykły `UPDATE` mówi „UPDATE 1" i nic nie robi.

---

## 3 · Nowe testy PostgreSQL (5 sztuk)

| # | co sprawdza | wynik |
|---|---|---|
| 17 | zaproszenie instruktora kończy się profilem `instruktor` | ZDANY |
| 18 | zaproszenie administratora kończy się profilem `admin`; bez tożsamości — nie | ZDANY |
| 19 | pierwszego admina da się utworzyć zgodnie z instrukcją, i tylko raz | ZDANY |
| 20 | kursant nie podniesie sobie roli — ani funkcją, ani własnoręczną flagą | ZDANY |
| 21 | autora i czas odpowiedzi stempluje baza — nie da się podpisać cudzym nazwiskiem | ZDANY |

Wszystkie na prawdziwym PostgreSQL, z wyzwalaczami — atrapa Supabase
faktycznie by tego nie wychwyciła, bo wyzwalaczy nie uruchamia.

---

## 4 · Podszywanie się pod autora odpowiedzi

`chron_pytanie()` stemplowało czas, ale `odpowiedzial_id` przyjmowało
z żądania. Instruktorka mogła podpisać odpowiedź kimkolwiek.

Teraz przy każdej zmianie treści odpowiedzi baza ustawia **sama**:

```sql
new.odpowiedzial_id := auth.uid();
new.odpowiedziano   := now();
```

a gdy odpowiedź się nie zmienia — oba pola wracają do poprzednich wartości.
Dotyczy to także administratora. **Test 21**: Maliwan próbuje podać
Norberta i rok 2000, baza zapisuje Maliwan i rok bieżący.

---

## 5 · `kurs()` — cztery zapytania, cztery sprawdzenia

Awaria któregokolwiek z czterech zapytań wyglądała jak pusty kurs.
Teraz każde ma sprawdzany `error`, a użytkownik dostaje komunikat
z nazwą tego, co się nie wczytało — zamiast pustego ekranu udającego
kurs bez treści.

## 6 · Błędy Storage przestały być niewidzialne

- **sprzątanie po nieudanym zapisie metadanych**: gdy `remove()` też
  zawiedzie, komunikat mówi wprost, że w magazynie została sierota,
  i podaje jej ścieżkę;
- **usuwanie materiału**: rekord znika zawsze, plik czasem nie —
  wtedy interfejs pokazuje ostrzeżenie zamiast pełnego sukcesu.

## 7 · `.gitignore`

Był w repozytorium, ale **nie było go w paczce** — audyt zobaczył jego
brak i miał rację, bo to właśnie paczka jest tym, co się przegląda.
Teraz jest w obu miejscach i obejmuje: `.env` i `.env.*`, klucze i pliki
`*.pem`/`*.key`, `node_modules/`, `magazyn/`, bazy lokalne, logi, `zrzuty/`
oraz śmieci systemowe i edytorów.

## 8 · Generator konfiguracji mówi prawdę

v3 obiecywał odmowę, a tylko ostrzegał. Teraz jedno i drugie jest
uczciwe:

- klucz sekretny w `.env` → **głośne ostrzeżenie**, że jest pomijany
  (bo na produkcji podaje go sama platforma, nie ustawia się go ręcznie);
- gotowy plik jest **sprawdzany**: gdyby klucz sekretny mimo wszystko
  w nim był, skrypt **kończy się błędem i nic nie zapisuje**;
- brak jakiegokolwiek klucza publicznego przy podanym `SUPABASE_URL`
  też jest błędem, nie cichym „trybem lokalnym".

## 9 · Arytmetyka oczekujących

Było „20", z listy wychodziły 23. Teraz w `testy/oczekujace.md` jest
rachunek na widoku:

```
Auth     A1–A10   10
Storage  S1–S7     7
Edge     E1–E9     9
                 ────
razem             26
```

Doszły: **A10** (nowe klucze), **E8** i **E9** (role przy zaproszeniu —
lokalnie sprawdzone testami 17–18, ale nie przez samą Edge Function).

## 10 · Nowe klucze Supabase (2026)

Sprawdziłem w aktualnej dokumentacji: nowe projekty dostają
**`sb_publishable_…`** (przeglądarka) i **`sb_secret_…`** (serwer),
a klucze `anon` i `service_role` Supabase **wygasza do końca 2026 roku**.
Edge Functions dostają je od platformy w `SUPABASE_PUBLISHABLE_KEYS`
i `SUPABASE_SECRET_KEYS` — jako słowniki JSON; starsze zmienne nadal są.

Co z tym zrobiłem:

- `.env` i generator znają `SUPABASE_PUBLISHABLE_KEY`; stary `anon`
  działa dalej, ale wypisuje ostrzeżenie o wygaszaniu;
- front bierze `SUPABASE_PUBLISHABLE_KEY`, a `anon` tylko awaryjnie;
- Edge Function czyta po kolei: słownik nowych kluczy → pojedynczy nowy
  klucz → stary. Radzi sobie z obydwoma formatami;
- z instrukcji **zniknęło** `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=…`
  — to było zbędne, bo klucz podaje platforma.

**Uczciwie:** kształt słowników `SUPABASE_SECRET_KEYS` znam z dokumentacji,
nie z uruchomionego projektu. Kod bierze z nich pierwszą niepustą wartość
i cofa się do starszych zmiennych. Weryfikacja na żywym projekcie to
scenariusz **A10** — oczekujący.

---

## Wyniki

```
BAZA        21 / 21     testy/bezpieczenstwo.js   (+5 wobec v3)
HTTP        16 / 16     testy/http.js
IMPORT       5 /  5     testy/import.js
KONTRAKTY   15 / 15     testy/kontrakty.js
razem       57 / 57
```

| poziom | ile | stan |
|---|---|---|
| Testy lokalne (baza, HTTP, import) | 42 | **wykonane** |
| Testy adaptera produkcyjnego (kontrakty) | 15 | **wykonane** |
| Testy żywego Supabase (Auth, Storage, Edge) | 26 | **OCZEKUJĄCE** |

Status paczki nadal: **kandydat**. Gotowa na test od końca do końca na
darmowym projekcie Supabase — i dopiero on rozstrzygnie.

## Czego nie ruszałem

- Wyglądu — ani jednego piksela. Zrzuty są identyczne jak w v3.
- Rzeczy, które działały: warstwy danych, kontraktów, RLS, importu.
- Wersji produkcyjnej strony szkoły, gałęzi `main`, `platforma`,
  `platforma-poprawki`, `platforma-v3`.
- Nie założyłem projektu Supabase i niczego nie kupiłem.
