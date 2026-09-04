# RAPORT ZMIAN — po audycie Codexa

Gałąź: **`platforma-poprawki`** · 4 września 2026
Nic nie opublikowane, nic nie wdrożone, nic nie wysłane na GitHub.

Audyt wskazał osiem problemów. Wszystkie zamknięte, każdy z testem,
który by je wychwycił, gdyby wróciły.

---

## 1 · Importer XLSX — bezpieczny upsert

**Było:** import zaczynał się od `delete from public.lekcja where kurs_id = …`.
Kaskada usuwała lekcje, etapy i **postępy kursantów**. Materiały wstawiały się
bez klucza, więc każdy przebieg dokładał kopie.

**Jest:**

- `delete` **usunięty w całości** — importer niczego nie kasuje;
- etapy: `on conflict (lekcja_id, kod) do update` — poprawka w arkuszu
  nadpisuje istniejący wiersz, zachowując jego identyfikator, więc
  postępy przypięte do etapu przeżywają;
- materiały: `on conflict (sciezka) do update`, przy nowym unikalnym
  indeksie na `sciezka` — nie da się zdublować;
- ścieżki materiałów budowane jako `kurs/<prawdziwy uuid>/<typ>/<slug>`
  zamiast dawnego `kurs/…/…/nazwa ze spacjami`.

**Testy** — `testy/import.js`, 5 sztuk:

| test | wynik |
|---|---|
| Trzykrotny import nie dubluje lekcji, etapów ani materiałów | ZDANY |
| Ponowny import **nie kasuje postępów** kursantów | ZDANY |
| Import nie kasuje treści dodanej ręcznie w aplikacji | ZDANY |
| Poprawka w arkuszu nadpisuje etap, ale nie tworzy nowego | ZDANY |
| Wszystkie zaimportowane materiały mają ścieżkę zgodną z kursem | ZDANY |

---

## 2 · Materiały i Storage — luka zamknięta

**Było:** `material.kurs_id` i kurs zapisany w `material.sciezka` mogły
wskazywać dwa różne kursy. Rekord swojego kursu dało się podpiąć do pliku
z cudzego. Kontrola była tylko w JavaScripcie.

**Jest — trzy niezależne zapory:**

1. **Ograniczenie w tabeli** (`db/01_schema.sql`):
   ```sql
   constraint material_sciezka_zgodna_z_kursem
     check (public.kurs_ze_sciezki(sciezka) = kurs_id)
   ```
   `kurs_ze_sciezki` wymaga kształtu `kurs/<uuid>/<typ>/<plik>`, odrzuca
   ścieżki bez poprawnego UUID, bez typu, bez nazwy pliku i każdą z `..`.
2. **`WITH CHECK` w polityce RLS** — instruktor musi prowadzić zarówno kurs
   z rekordu, jak i kurs ze ścieżki.
3. **Polityka Storage** (`db/03_storage.sql`) — przy pobieraniu sprawdza,
   że rekord materiału o tej ścieżce ma **ten sam** `kurs_id` co ścieżka.

Do tego **unikalny indeks na `sciezka`** — jeden plik, jeden rekord.

**Poprawiony test 5.** Miał rację Codex: używał ścieżki `kurs/x/pdf/test.pdf`,
która nie wskazywała żadnego kursu, więc niczego nie sprawdzał. Nowy test 6
w `testy/bezpieczenstwo.js` próbuje czterech wariantów:

| próba | wynik |
|---|---|
| poprawna ścieżka własnego kursu | przyjęta |
| `kurs/x/pdf/test.pdf` (bez UUID) | **odrzucona** |
| ścieżka wskazująca inny kurs | **odrzucona** |
| `kurs/<uuid>/../../etc/passwd` | **odrzucona** |

Plus test 12 w `testy/http.js`: kursant prosi o link do pliku z cudzego
kursu → **403**.

---

## 3 · Utwardzenie RLS

| co | jak |
|---|---|
| Kursant nie przepnie postępu do etapu innego kursu | `WITH CHECK` na `update` + wyzwalacz `postep_spojnosc`, który sprawdza przypisanie |
| `pytanie.etap_id` musi należeć do `pytanie.kurs_id` | wyzwalacz `pytanie_spojnosc` |
| Instruktor zmienia w pytaniu tylko odpowiedź, status i autora odpowiedzi | wyzwalacz `pytanie_ochrona` przywraca `kursant_id`, `kurs_id`, `etap_id`, `tresc`, `utworzone` |
| Nikt sam sobie nie zmieni e-maila, roli ani aktywności | wyzwalacz `profil_ochrona` (RLS nie widzi `OLD`, więc musiał to być wyzwalacz) |
| Ograniczone prawo wykonywania funkcji | `revoke all on all functions … from anon, authenticated, public`, potem `grant execute` na **osiem** funkcji, których naprawdę używa aplikacja |

**Dodatkowo, poza listą audytu:** ostatniego aktywnego administratora nie
da się wyłączyć, zdegradować ani skasować — wyzwalacze `chron_profil`
i `chron_ostatniego_admina`.

**Testy** — `testy/bezpieczenstwo.js`, 15 sztuk, wszystkie zdane.
Zwracam uwagę na test 14: `chron_profil` i `obsluz_nowego_uzytkownika`
są dla roli `authenticated` **niedostępne**, a `zapisany_na_kurs` — tak.

---

## 4 · Prawdziwa warstwa Supabase

| co | jak |
|---|---|
| `dane-supabase.js` miał `export` | przepisany na zwykły skrypt; wystawia `window.DANE_SUPABASE` |
| Adapter był niepełny | ma teraz **wszystkie 21 funkcji**: logowanie, wylogowanie, reset hasła, zaproszenie, profil, kursy, kurs, postęp, pytania (4), pliki (4), konta (3), zaproszenie, kursanci, przypisz, odepnij |
| Brakowało strony ustawienia hasła | `web/nowe-haslo.html` — obsługuje zaproszenie i reset, ze wskaźnikiem siły hasła |
| `service_role` we froncie | **nigdzie go nie ma.** Zakładanie kont przeniesione do Edge Function `supabase/functions/zapros/index.ts`, która sama sprawdza, czy proszący jest aktywnym adminem |

Konfiguracja wstrzykiwana przez `konfig.js` budowany z `.env` przy wdrożeniu
— zawiera wyłącznie `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_BUCKET`
i `ADRES_APLIKACJI`.

---

## 5 · Prawdziwa obsługa plików

**Było:** „Dodaj materiał" zapisywał samą nazwę. Kursant nie miał czym otworzyć.

**Jest:**

- wybór pliku z komputera (`<input type="file">` z podglądem nazwy i rozmiaru);
- prawdziwe wysłanie danych binarnych do prywatnego magazynu;
- **kolejność, o którą prosił audyt**: plik ląduje pod nazwą tymczasową →
  zapis metadanych przez RLS → dopiero po sukcesie plik trafia na docelowe
  miejsce. Gdy metadane nie przejdą, plik jest kasowany;
- kursant ma przycisk **„Otwórz / pobierz"** — link podpisany HMAC-em,
  ważny 300 sekund, wystawiany dopiero po sprawdzeniu uprawnień w bazie;
- limity: **25 MB**, biała lista formatów per typ, odrzucenie pustego pliku;
- czytelne komunikaty zamiast zerwanego połączenia (żądanie jest
  „wypijane" przed odpowiedzią błędem).

**Testy** — `testy/http.js` 8–13: wgranie, zły format (415), przekroczony
rozmiar (413), pusty plik (400), sprzątanie po nieudanych metadanych,
link przed i po publikacji, podrobiony podpis (403), wygasły link (403),
zmyślona ścieżka (403).

---

## 6 · Pytania działają w obie strony

- Maliwan ma pole odpowiedzi przy każdym pytaniu, przycisk „Zapisz odpowiedź"
  i „Zamknij";
- kursant widzi odpowiedź i status (`nowe` / `odpowiedziane` / `zamkniete`);
- licznik nowych pytań przy zakładce instruktora;
- `odpowiedziano` stemplowane czasem przez wyzwalacz.

**Testy:** HTTP 14 (kursant nie odpowie sam sobie — 403; obcy kursant nie
widzi cudzego pytania), baza 10 i 11.

---

## 7 · Konta

- **„Zaproś osobę"** w panelu Norberta: imię, adres, rola;
- na produkcji przez Edge Function z kluczem `service_role` po stronie
  serwera; lokalnie zaproszenie zapisuje się w tabeli `zaproszenie`
  i pokazuje link (bo nie ma poczty);
- w bazie ląduje **wyłącznie skrót SHA-256 tokenu**, nigdy sam token;
- ostatni aktywny administrator chroniony przed wyłączeniem i degradacją
  (HTTP 409 z czytelnym komunikatem);
- **wyłączone konto traci otwartą sesję natychmiast** — serwer kasuje jego
  sesje, a przy każdym żądaniu sprawdza flagę `aktywne`;
- ponowne logowanie na wyłączone konto: **403 „To konto jest wyłączone."**

Przy okazji naprawiony błąd, który wyszedł dopiero w nowym teście:
`/api/konto/rola` zwracał **200** kursantowi próbującemu zmienić sobie rolę.
Rola się nie zmieniała (wyzwalacz ją cofał), ale API kłamało.
Teraz porównuje wynik z żądaniem i zwraca **403**.
Odmowy z RLS mapowane na **403**, nie **400**.

---

## 8 · Testy — trzy zestawy zamiast jednego

| zestaw | plik | ile | co sprawdza |
|---|---|---|---|
| Baza i RLS | `testy/bezpieczenstwo.js` | **15** | polityki, wyzwalacze, uprawnienia funkcji |
| HTTP | `testy/http.js` | **16** | sesje, ciasteczka, wgrywanie plików, podpisane linki, uprawnienia przez API |
| Import | `testy/import.js` | **5** | idempotencja, zachowanie postępów |
| | **razem** | **36** | wszystkie zdane |

`npm run testy` uruchamia wszystkie trzy.

**Test wylogowania robi teraz to, o co prosił audyt.** Nie sprawdza już,
czy anonim czegoś nie widzi. Sprawdza, czy **to samo ciasteczko** po
wylogowaniu przestaje działać — bo sesja została skasowana po stronie
serwera. Przed: 200, po: 401.

**Czego 36/36 NIE znaczy.** Nie znaczy, że system jest przetestowany.
Auth, Storage i Edge Function to usługi Supabase, których lokalnie nie ma.
Dwadzieścia scenariuszy jest **oczekujących** i wypisanych w
`testy/oczekujace.md` — nie udajemy, że zostały wykonane.

---

## 9 · Wygląd — dopiero na końcu

- orbita powiększona z 560 na **700 px**, kafle z 20 na 22,5 %,
  podpisy z 11 na **14 px**, ikony z 19 na 25 px, medalion czytelniejszy;
- **stany**: wskaźnik ładowania przy każdym pobieraniu danych, przyciski
  blokowane na czas pracy z napisem „Zapisuję…", potwierdzenia i błędy
  jako powiadomienia w rogu, potwierdzenie przy usuwaniu materiału;
- rozmiary plików czytelnie (B / KB / MB);
- **widok listy na telefonie bez zmian** — dokładnie tak, jak prosił audyt.

---

## Czego świadomie nie ruszałem

- Wersja produkcyjna strony szkoły — nietknięta.
- Gałąź `main` w repozytorium — nietknięta.
- Nie założyłem projektu Supabase, nie kupiłem niczego, nie podpiąłem domeny.

## Nowe pliki

```
web/nowe-haslo.html                  ustawienie hasła (zaproszenie i reset)
supabase/functions/zapros/index.ts   Edge Function — jedyne miejsce z service_role
testy/http.js                        16 testów przez HTTP
testy/import.js                      5 testów importu
testy/oczekujace.md                  20 scenariuszy do sprawdzenia na Supabase
RAPORT_ZMIAN.md                      ten plik
```
