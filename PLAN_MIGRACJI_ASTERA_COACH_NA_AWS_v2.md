# AsterA Coach — plan migracji na AWS · wersja 2

6 września 2026 · autor: Martin
**Dokument planistyczny. Nic nie jest wykonywane.**
Etap 0 nie rozpoczęty. AWS nietknięty. Supabase nietknięty.

Wersja 2 wprowadza dziewięć decyzji przekazanych po akceptacji wersji 1 oraz
docelowy schemat dla tłumaczeń, technik, wersjonowania i głosówek.

---

## 0 · Decyzje wiążące — co zmieniło się względem wersji 1

| # | decyzja | skutek w planie |
|---|---|---|
| 1 | logowanie: **wariant A**, `USER_SRP_AUTH`, Cognito wyłącznie jako dostawca tożsamości | poprawiona zasada 1 (§1), przepisany etap 5 |
| 2 | A8: **natywna blokada Cognito** po serii błędnych haseł; WAF opcjonalny; Adaptive Authentication niewymagane w v1 | etap 2 + nowy test |
| 3 | tłumaczenia: **model tabelaryczny**, nowy język bez zmiany schematu | §2.2, przepisany etap 1 |
| 4 | **`technika`** jako osobna encja + relacja `etap_technika` | §2.4 |
| 5 | **wersjonowanie** zatwierdzonej wiedzy, statusy `draft` / `do_zmiany` / `zatwierdzone` / `zastapione` | §2.3 |
| 6 | **głosówka** osobną encją domenową, nie `material` | §2.5 |
| 7 | migracja danych: **tylko realna, zatwierdzona treść szkoleniowa**; konta od nowa w Cognito | etap 7 |
| 8 | RDS Proxy: zmierzyć **session pinning**; proxy nie jest obowiązkowe za wszelką cenę | etap 1 + alternatywa |
| 9 | SES: usunąć stwierdzenie „nie ma jak wystąpić" | etap 4 |

Zasada bezpieczeństwa bez zmian:

```
BEGIN → set_config('astera.uzytkownik', $1, true) → zapytania → COMMIT
```

---

## 1 · Trzy zasady nadrzędne

### Zasada 1 — AsterA Core jest bramą dla danych; Cognito jest jedynym świadomym wyjątkiem

```
Coach (przeglądarka)
   │
   ├── Cognito ──────────► wyłącznie uwierzytelnianie (USER_SRP_AUTH)
   │                       front otrzymuje JWT
   │
   └── AsterA Core API ──► WSZYSTKIE dane aplikacyjne
                            ├── Aurora PostgreSQL
                            ├── S3
                            ├── Lambda (zaproszenia)
                            ├── Cognito (operacje administracyjne)
                            └── SES
```

Front **nigdy** nie zna poświadczeń do Aurory ani S3, nie wywołuje Lambdy
i nie otrzymuje adresów zasobów AWS. Pliki dostaje wyłącznie jako gotowe,
krótkotrwałe adresy podpisane przez Core.

Front zna wyłącznie: adres Core API, identyfikator puli Cognito
i identyfikator klienta aplikacji. To dane publiczne.

**Co z tego wynika dla Core:** Core weryfikuje token Cognito samodzielnie —
podpis przez JWKS, `iss`, `aud`, `exp`, `token_use`. Nie ufa niczemu, co
przyszło z przeglądarki, poza poprawnie podpisanym tokenem. Identyfikator
użytkownika do RLS bierze z `sub` zweryfikowanego tokenu, nigdy z ciała
żądania.

**Hasło nie opuszcza urządzenia w postaci jawnej** — `USER_SRP_AUTH` przesyła
dowód znajomości hasła, nie hasło.

### Zasada 2 — tożsamość dla RLS wyłącznie transakcyjna

Bez zmian względem wersji 1, z uzupełnieniem z decyzji 8 (patrz etap 1).

Trzy konkrety, które trzeba zrobić dobrze:

1. **`set_config(..., true)`, nie `SET`.** PostgreSQL nie przyjmuje parametru
   w `SET LOCAL x = $1`; jedyną bezpieczną formą jest
   `select set_config('astera.uzytkownik', $1, true)`. Sklejanie wartości
   w łańcuch SQL wykluczone.

2. **Każde zapytanie w jawnej transakcji.** W autozatwierdzaniu
   `set_config(..., true)` wygasa razem z poleceniem, które je wykonało —
   czyli zanim przyjdzie właściwe zapytanie. To najczęstsza pomyłka przy tym
   wzorcu.

3. **Stan domyślny to „nikt", nie „poprzedni".** Bez ustawionej tożsamości
   funkcja zwraca `NULL`, a polityki nie przepuszczają niczego. Połączenie
   wracające do puli musi być czyste.

Core łączy się rolą `astera_api` — bez `BYPASSRLS`, niebędącą właścicielem
tabel. `force row level security` zostaje na wszystkich tabelach, także nowych.

### Zasada 3 — model danych rozbudowujemy teraz, świadomie

Decyzje 3–6 rozstrzygają cztery sprawy, które w wersji 1 były oznaczone jako
„do rozstrzygnięcia przed etapem 1". Docelowy schemat jest w §2.
**Nie implementuję go bez zatwierdzenia tej wersji planu.**

---

## 2 · Docelowy model danych

### 2.1 Wspólny wzorzec

Wiedza merytoryczna dostaje trzy poziomy. Struktura organizacyjna — dwa.

```
ENCJA          tożsamość, relacje, to co nie zmienia się przy redakcji
  └── WERSJA   treść w jednym stanie: draft / do_zmiany / zatwierdzone / zastapione
        └── TEKST   ta treść w jednym języku
```

**Wersjonowane (wiedza Maliwan):** `etap`, `technika`, `glosowka`.
**Tylko tłumaczone (struktura):** `kurs`, `lekcja`, `material`.

Uzasadnienie podziału: wersjonujemy to, co Maliwan zatwierdza merytorycznie.
Nazwa kursu i tytuł lekcji to etykiety organizacyjne — historia zmian nic tu
nie wnosi, a mnoży tabele. **To jest propozycja, nie decyzja — jeśli chcecie
wersjonować także kurs i lekcję, wzorzec jest ten sam i dokładam dwie pary
tabel.**

Liczba tabel: dziś 9 → docelowo **22**.

### 2.2 Języki i tłumaczenia

```sql
create table public.jezyk (
  kod          text primary key check (kod ~ '^[a-z]{2}$'),
  nazwa_wlasna text not null,
  aktywny      boolean not null default true,
  kolejnosc    int     not null default 100
);
-- pl, th, en wchodzą jako DANE, nie jako schemat.
-- Dodanie kolejnego języka = jeden insert. Zero DDL.
```

Z `kurs`, `lekcja`, `etap`, `material` **znikają wszystkie kolumny `_pl` i `_th`**.
Zastępują je tabele tekstowe:

```sql
create table public.kurs_tekst (
  kurs_id uuid not null references public.kurs(id) on delete cascade,
  jezyk   text not null references public.jezyk(kod),
  nazwa   text not null,
  opis    text,
  primary key (kurs_id, jezyk)
);

create table public.lekcja_tekst (
  lekcja_id uuid not null references public.lekcja(id) on delete cascade,
  jezyk     text not null references public.jezyk(kod),
  tytul     text not null,
  primary key (lekcja_id, jezyk)
);

create table public.material_tekst (
  material_id uuid not null references public.material(id) on delete cascade,
  jezyk       text not null references public.jezyk(kod),
  nazwa       text not null,
  opis        text,
  primary key (material_id, jezyk)
);
```

Wybrałem tabelę tłumaczeń **na encję**, nie jedną uniwersalną tabelę
`tekst`/`tlumaczenie` dla całego systemu. Powód praktyczny: `etap` ma siedem
pól tekstowych. Model uniwersalny oznaczałby siedem złączeń na jeden etap
zamiast jednego. Wymaganie „nowy język bez zmiany schematu" jest spełnione
w obu wariantach — to wiersz w `jezyk`, nie kolumna.

### 2.3 Wersjonowanie

```sql
create type public.status_wersji as enum
  ('draft','do_zmiany','zatwierdzone','zastapione');
```

Wzorzec, identyczny dla `etap`, `technika` i `glosowka` — poniżej na przykładzie
etapu:

```sql
create table public.etap_wersja (
  id              uuid primary key default gen_random_uuid(),
  etap_id         uuid not null references public.etap(id) on delete cascade,
  numer           int  not null,
  status          public.status_wersji not null default 'draft',

  autor_id        uuid not null references public.profile(id),
  utworzone       timestamptz not null default now(),
  zmienione       timestamptz not null default now(),

  zatwierdzil_id  uuid references public.profile(id),
  zatwierdzone_o  timestamptz,
  komentarz       text,          -- uzasadnienie przy 'do_zmiany'

  unique (etap_id, numer),

  -- zatwierdzający i data istnieją dokładnie dla wersji rozstrzygniętych
  constraint etap_wersja_zatwierdzenie check (
    (status in ('zatwierdzone','zastapione'))
      = (zatwierdzil_id is not null and zatwierdzone_o is not null)
  )
);

-- Dokładnie jedna wersja 'zatwierdzone' na etap. Pilnuje baza, nie aplikacja.
create unique index etap_wersja_jedna_zatwierdzona
  on public.etap_wersja (etap_id)
  where status = 'zatwierdzone';

create table public.etap_tekst (
  etap_wersja_id  uuid not null references public.etap_wersja(id) on delete cascade,
  jezyk           text not null references public.jezyk(kod),
  nazwa           text not null,
  cel             text,
  agent_mowi      text,
  pokazuje        text,
  kursanci_robia  text,
  uwaga           text,
  podsumowanie    text,
  primary key (etap_wersja_id, jezyk)
);
```

**Tłumaczenia wiszą na wersji, nie na encji.** To był powód, dla którego pary
kolumn `_pl`/`_th` nie mogły zostać: każda wersja musi mieć własny komplet
tłumaczeń, inaczej zatwierdzenie polskiej treści cicho zmienia treść tajską.

Dozwolone przejścia statusów — do wymuszenia wyzwalaczem:

```
draft ──────► do_zmiany ──────► draft
  │
  └────────► zatwierdzone ────► zastapione
                (poprzednia zatwierdzona przechodzi w 'zastapione'
                 w tej samej transakcji, co nowa w 'zatwierdzone')
```

Wersji `zatwierdzone` i `zastapione` **nie edytujemy** — zmiana treści tworzy
nową wersję. Egzekwuje to wyzwalacz, nie umowa z zespołem.

**Reguła widoczności, do wpisania w RLS:** kursant widzi wyłącznie wersje
`zatwierdzone`. Instruktor widzi wszystkie wersje swoich kursów. Admin widzi
wszystko.

### 2.4 Technika

```sql
create table public.technika (
  id        uuid primary key default gen_random_uuid(),
  kod       text not null unique,       -- np. 'stopy-rozgrzewka'
  utworzone timestamptz not null default now()
);

create table public.technika_wersja (  -- wzorzec jak etap_wersja
  id uuid primary key default gen_random_uuid(),
  technika_id uuid not null references public.technika(id) on delete cascade,
  numer int not null,
  status public.status_wersji not null default 'draft',
  autor_id uuid not null references public.profile(id),
  utworzone timestamptz not null default now(),
  zmienione timestamptz not null default now(),
  zatwierdzil_id uuid references public.profile(id),
  zatwierdzone_o timestamptz,
  komentarz text,
  unique (technika_id, numer),
  constraint technika_wersja_zatwierdzenie check (
    (status in ('zatwierdzone','zastapione'))
      = (zatwierdzil_id is not null and zatwierdzone_o is not null))
);
create unique index technika_wersja_jedna_zatwierdzona
  on public.technika_wersja (technika_id) where status = 'zatwierdzone';

create table public.technika_tekst (
  technika_wersja_id uuid not null
    references public.technika_wersja(id) on delete cascade,
  jezyk      text not null references public.jezyk(kod),
  nazwa      text not null,
  opis       text,
  wskazowki  text,   -- na co zwrócić uwagę
  bledy      text,   -- najczęstsze błędy
  primary key (technika_wersja_id, jezyk)
);

-- Jedna technika w wielu etapach i kursach, bez kopiowania wiedzy.
create table public.etap_technika (
  etap_id     uuid not null references public.etap(id)     on delete cascade,
  technika_id uuid not null references public.technika(id) on delete restrict,
  kolejnosc   int  not null default 0,
  primary key (etap_id, technika_id)
);
```

`on delete restrict` przy technice jest celowe: skasowanie etapu nie może
pociągnąć za sobą techniki używanej gdzie indziej.

### 2.5 Głosówki Maliwan

```sql
create table public.glosowka (
  id             uuid primary key default gen_random_uuid(),

  -- dokładnie jedno z dwóch — technika albo etap
  technika_id    uuid references public.technika(id) on delete restrict,
  etap_id        uuid references public.etap(id)     on delete restrict,

  jezyk_zrodlowy text not null references public.jezyk(kod),
  klucz_s3       text not null unique,
  mime           text,
  czas_s         int,
  rozmiar_b      bigint,

  nagral_id      uuid not null references public.profile(id),
  utworzone      timestamptz not null default now(),

  constraint glosowka_jeden_wlasciciel check (
    (technika_id is not null)::int + (etap_id is not null)::int = 1),

  -- ta sama dyscyplina co przy materiałach: klucz musi zgadzać się z encją
  constraint glosowka_klucz_zgodny check (
    public.glosowka_z_klucza(klucz_s3) = coalesce(technika_id, etap_id))
);

create table public.glosowka_wersja (   -- wzorzec jak wyżej
  id uuid primary key default gen_random_uuid(),
  glosowka_id uuid not null references public.glosowka(id) on delete cascade,
  numer int not null,
  status public.status_wersji not null default 'draft',
  autor_id uuid not null references public.profile(id),
  utworzone timestamptz not null default now(),
  zmienione timestamptz not null default now(),
  zatwierdzil_id uuid references public.profile(id),
  zatwierdzone_o timestamptz,
  komentarz text,
  unique (glosowka_id, numer),
  constraint glosowka_wersja_zatwierdzenie check (
    (status in ('zatwierdzone','zastapione'))
      = (zatwierdzil_id is not null and zatwierdzone_o is not null))
);
create unique index glosowka_wersja_jedna_zatwierdzona
  on public.glosowka_wersja (glosowka_id) where status = 'zatwierdzone';

create table public.glosowka_tekst (
  glosowka_wersja_id uuid not null
    references public.glosowka_wersja(id) on delete cascade,
  jezyk  text not null references public.jezyk(kod),
  tresc  text not null,
  uwagi  text,
  primary key (glosowka_wersja_id, jezyk)
);
```

**Jedna uwaga do potwierdzenia.** Poleciliście przechowywać „transkrypcję,
tłumaczenie". W powyższym modelu jest jedno pole `tresc`, a rola wynika
z porównania z `glosowka.jezyk_zrodlowy`: wiersz w języku źródłowym **jest**
transkrypcją, każdy inny **jest** tłumaczeniem. Dwa osobne pola dawałyby stan,
w którym oba są wypełnione albo oba puste — czyli niespójność do pilnowania
w aplikacji. Rozróżnienie wystawiam widokiem:

```sql
create view public.widok_glosowka_tekst
with (security_invoker = true) as
select t.*,
       case when t.jezyk = g.jezyk_zrodlowy then 'transkrypcja'
            else 'tlumaczenie' end as rodzaj
from public.glosowka_tekst t
join public.glosowka_wersja w on w.id = t.glosowka_wersja_id
join public.glosowka g        on g.id = w.glosowka_id;
```

Jeśli wolicie dwie osobne kolumny, zmieniam — to jedna linijka w schemacie.

**Klucz S3 i jego konwencja.** Ta sama dyscyplina co przy materiałach: klucz
musi wskazywać encję, do której należy plik, a pilnuje tego baza:

```
glosowka/technika/<uuid techniki>/<uuid glosowki>.<ext>
glosowka/etap/<uuid etapu>/<uuid glosowki>.<ext>
```

Funkcja `glosowka_z_klucza(text)` — odpowiednik istniejącej `kurs_ze_sciezki` —
używana zarówno w więzie CHECK powyżej, jak i przy autoryzacji w Core.

Plik audio trafia do S3. W bazie nie ma bajtów, jest klucz.

### 2.6 Co to zmienia w istniejącym schemacie

| tabela | zmiana |
|---|---|
| `kurs` | usunięte `nazwa_pl`, `nazwa_th`, `opis_pl`, `opis_th` → `kurs_tekst` |
| `lekcja` | usunięte `tytul_pl`, `tytul_th` → `lekcja_tekst` |
| `etap` | usunięte **wszystkie 14 kolumn** `_pl`/`_th` → `etap_wersja` + `etap_tekst`; zostaje struktura: `id`, `lekcja_id`, `kod`, `godzina`, `ikona`, `czas_min`, `kolejnosc`, `opublikowany` |
| `material` | usunięte `nazwa_pl`, `nazwa_th` → `material_tekst` |
| `profile`, `przypisanie`, `postep`, `pytanie`, `zaproszenie` | **bez zmian** |

Dochodzi 13 tabel, 1 typ wyliczeniowy, 1 widok, 3 indeksy częściowe,
1 funkcja (`glosowka_z_klucza`) i wyzwalacze pilnujące przejść statusów.

Polityk RLS przybędzie — szacuję **około 25 nowych** do obecnych 27. Napiszę je
przy etapie 1, według reguły widoczności z §2.3.

**Skutek dla importu treści:** `db/import_xlsx.py` generuje dziś SQL z kolumnami
`_pl`/`_th`. Do przepisania pod nowy model. To dobra wiadomość dla decyzji 7 —
treść szkoleniową odtwarzamy z arkusza, nie przenosimy z Supabase.

---

## 3 · Zakres — zostaje / przenosimy / wyrzucamy

### Zostaje

- `profile`, `przypisanie`, `postep`, `pytanie`, `zaproszenie` — bez zmian.
- Struktura `kurs`, `lekcja`, `etap`, `material` — po odjęciu kolumn tekstowych.
- Reguły egzekwowane przez bazę: ochrona ostatniego administratora z blokadą
  doradczą, zgodność ścieżki pliku z kursem, stemplowanie autora odpowiedzi,
  spójność postępu i pytania z kursem.
- Cały front: 6 ekranów, style.
- Kontrakt 24 funkcji, `testy/kontrakty.js`.
- Testy `bezpieczenstwo.js` (21) i `import.js` (5) — działają na czystym
  PostgreSQL. Wymagają aktualizacji tam, gdzie dotykają kolumn `_pl`/`_th`.
- Konwencja ścieżek `kurs/<uuid>/<typ>/<plik>` i `kurs_ze_sciezki` → klucz S3.

### Przenosimy

| element | z | na | funkcji kontraktu |
|---|---|---|---|
| uwierzytelnianie | Supabase Auth | **Cognito, `USER_SRP_AUTH`, bezpośrednio z frontu** | 6 |
| dane aplikacyjne | Supabase REST | **Core API** | 18 |
| pliki | Storage | S3 przez Core (adresy podpisane) | 3 z tych 18 |
| zaproszenia | Edge Function (Deno, 175 linii) | Lambda **wewnątrz Core** | 1 z tych 18 |
| tożsamość w RLS | `auth.uid()` | `astera.uzytkownik` przez `set_config(...,true)` | wszystkie polityki |
| wyzwalacz nowego użytkownika | `auth.users` | zdarzenie z Core po utworzeniu konta w Cognito | 1 wyzwalacz |
| polityki magazynu | `storage.objects` | autoryzacja w Core + polityka bucketu | `03_storage.sql` |
| poczta | SMTP cyber_Folks | SES | konfiguracja |

### Wyrzucamy — dopiero po etapie 7

`narzedzia/zaloz-projekt.js` · `db/00_supabase_lokalnie.sql` ·
sekcje `URUCHOMIENIE.md` o panelu Supabase · konfiguracja SMTP w Supabase.

---

## 4 · Etapy

Każdy odwracalny, każdy kończy się dowodem maszynowym.

---

### Etap 0 — tożsamość i rola bazodanowa (lokalnie, bez AWS)

1. `public.uid()` czytająca `current_setting('astera.uzytkownik', true)`,
   zwracająca `NULL` przy braku ustawienia.
2. Podmiana `auth.uid()` → `public.uid()` w 27 politykach i w funkcjach.
3. Rola `astera_api`: bez `BYPASSRLS`, bez własności tabel, minimalne granty.
4. **Test 22 — brak wycieku tożsamości.** N równoległych transakcji przez jedną
   pulę, każda z inną tożsamością; plus transakcja bez tożsamości → zero
   wierszy, nie dane poprzednika.
5. Wzorzec `BEGIN → set_config → zapytania → COMMIT` w `URUCHOMIENIE.md`
   jako obowiązujący dla Core.

**Dowód:** 21 dotychczasowych testów bezpieczeństwa przechodzi bez zmian
w treści + test 22 + `import.js` (5).

---

### Etap 1 — Aurora, nowy schemat, pomiar puli połączeń

Największy etap. Wchodzi tu zarówno przeniesienie, jak i rozbudowa modelu
z §2 — nie rozdzielam tego na dwa etapy, bo przepisanie `etap` na wersje
i tak wymusza przepisanie importu i testów, a robienie tego dwa razy jest
droższe niż raz.

**Baza**
1. Aurora PostgreSQL zgodna z 16.
2. **Numerowane migracje** zamiast skryptu jednorazowego: `001_…`, `002_…`
   Bez tego dołożenie kolejnych tabel będzie ręcznym zabiegiem na żywej bazie.
3. Schemat docelowy z §2: 22 tabele, `status_wersji`, indeksy częściowe,
   `glosowka_z_klucza`, wyzwalacze przejść statusów.
4. Nowe polityki RLS (~25) według reguły widoczności z §2.3.
5. Przepisany `db/import_xlsx.py` i odtworzenie treści z arkusza.
6. Aktualizacja testów dotykających kolumn `_pl`/`_th`.
7. **Nowe testy:** przejścia statusów (niedozwolone odrzucone), jedna
   zatwierdzona wersja na encję, kursant nie widzi wersji niezatwierdzonych,
   technika w dwóch etapach bez duplikacji, klucz S3 głosówki niezgodny
   z encją odrzucony.

**Pula połączeń — decyzja 8**

`set_config(..., true)` jest ustawieniem transakcyjnym i **nie powinno**
przypinać sesji w RDS Proxy. Ale nie zakładam tego — mierzę. Uwagę zwracam
na drugi element: `zablokuj_licznik_adminow` używa `pg_advisory_xact_lock`.
Blokada transakcyjna nie powinna przypinać; sesyjna przypina na pewno. To
dokładnie ten fragment, który trzeba zmierzyć, a nie wyczytać.

8. Metryka `DatabaseConnectionsCurrentlySessionPinned` pod obciążeniem
   odwzorowującym realny ruch.
9. Test skuteczności puli: ile połączeń do Aurory przypada na N równoległych
   żądań przez Core.
10. Powtórzenie testu 22 **przez proxy** — to jedyne środowisko, w którym
    wyciek tożsamości może naprawdę wystąpić.

**Kryterium decyzji o proxy.** Jeśli udział przypiętych sesji sprawia, że
proxy przestaje multipleksować — rezygnujemy z niego i idziemy
**Core → Aurora z pulą po stronie Core**: pula w procesie Core (rozmiar
dobrany do limitu połączeń instancji), rozdzielenie endpointu zapisu
i odczytu, `DISCARD ALL` przy zwrocie połączenia, twardy limit i kolejkowanie.
Alternatywa jest równorzędna, nie awaryjna — RDS Proxy ma sens tylko wtedy,
gdy faktycznie multipleksuje.

**Dowód:** wszystkie testy z etapu 0 + nowe testy modelu przechodzą na Aurorze;
raport z pomiaru pinningu z rekomendacją proxy albo puli w Core.

---

### Etap 2 — Core API + Cognito (wariant A)

1. Pula użytkowników Cognito, klient aplikacji z `USER_SRP_AUTH`, polityka
   haseł, adresy powrotne.
2. **Natywna blokada Cognito po serii błędnych haseł** (decyzja 2).
   Adaptive Authentication poza zakresem v1. WAF opcjonalny, jako druga
   warstwa, nie zamiast.
3. Szkielet Core API: weryfikacja tokenu (JWKS, `iss`, `aud`, `exp`,
   `token_use`), otwarcie transakcji, `set_config` z `sub`, wykonanie, `COMMIT`.
4. Sześć funkcji Auth po stronie frontu — przeciw Cognito, nie przeciw Core.
5. Zdarzenie „powstał nowy użytkownik" → wiersz w `profile`
   (zamiennik wyzwalacza na `auth.users`).

**Dowód:** odpowiedniki A1, A2, A3, A6, A7 przechodzą.
**A8 — nowy test:** seria błędnych haseł kończy się odmową Cognito
(`Password attempts exceeded`), a nie kolejnym zwykłym błędem logowania.
To jedyna pozycja z listy błędów E2E, która nie znika sama przy zmianie
dostawcy — dlatego ma własny, jawny dowód.

---

### Etap 3 — S3

1. Bucket prywatny, bez dostępu publicznego, szyfrowanie w spoczynku.
2. Klucze: `kurs/<uuid>/<typ>/<plik>` dla materiałów,
   `glosowka/<technika|etap>/<uuid>/<uuid>.<ext>` dla nagrań.
3. Trzy funkcje kontraktu; adresy podpisane wystawia **Core** po sprawdzeniu
   uprawnień w bazie. Front nie zna nazwy bucketu.
4. Odtworzenie w Core reguł czterech polityk `storage.objects`.
5. Więzy zgodności klucza z encją zostają po stronie bazy
   (`kurs_ze_sciezki`, `glosowka_z_klucza`).
6. Sprzątanie po nieudanym zapisie metadanych — plik nie zostaje sierotą.

**Dowód:** odpowiedniki S1–S7, w tym S6 i S7. Dodatkowo: głosówka wgrana pod
klucz niezgodny z techniką — odrzucona.

---

### Etap 4 — zaproszenia i poczta

1. Lambda odtwarzająca logikę `zapros`, **wywoływana przez Core, nie przez
   front**. Kolejność kroków bez zmian, z wycofaniem konta przy błędzie.
2. **SES — pełna lista, bez skrótów** (decyzja 9). SES usuwa konkretną blokadę
   SMTP cyber_Folks. Nie usuwa niczego więcej. Do zrobienia i sprawdzenia:
   - weryfikacja domeny,
   - DKIM (rekordy CNAME),
   - SPF z `include:amazonses.com`,
   - DMARC,
   - własna domena `MAIL FROM`,
   - **wyjście z piaskownicy** — wniosek, limity wysyłki i tempa,
   - obsługa odbić i skarg (SNS), monitorowanie reputacji,
   - **test dostarczalności do prawdziwych skrzynek**, w tym polskich
     (`wp.pl`, `o2.pl`, `interia.pl`, `onet.pl`) i Gmaila — sprawdzamy, czy
     wiadomość trafia do odbiorczej, nie do spamu,
   - sprawdzenie obsługi adresów z plusem, od czego zależy, czy runner E2E
     działa bez przeróbki.

**Dowód:** E1–E9 przechodzą, w tym E3, E4, E8, E9 i A4 — pięć testów, które
w Supabase zatrzymała blokada SMTP. E7 pozostaje ręczny. Do tego raport
dostarczalności ze wskazaniem, dokąd trafiła wiadomość w każdej skrzynce.

---

### Etap 5 — warstwa danych: `dane-aws.js` + klient Cognito

Poprawione względem wersji 1 zgodnie z decyzją 1. Warstwa ma **dwa źródła**,
nie jedno:

```
KONTRAKT 24 funkcji
├── 6 funkcji Auth ──────► Cognito bezpośrednio (USER_SRP_AUTH)
│     zaloguj, wyloguj, ja, wyslijLinkResetu, sesjaZLinku, ustawHaslo
│
└── 18 funkcji danych ───► wyłącznie Core API
      kursy, kurs, zapiszPostep, pytania, zadajPytanie, odpowiedzNaPytanie,
      zamknijPytanie, linkDoMaterialu, wgrajMaterial, publikujMaterial,
      usunMaterial, konta, zmienRole, ustawAktywne, zapros, kursanci,
      przypisz, odepnij
```

1. `auth-cognito.js` — sześć funkcji Auth, obsługa cyklu życia tokenu.
2. `dane-aws.js` — osiemnaście funkcji danych, wyłącznie Core API. **Nie
   dotyka Cognito, Aurory ani S3.**
3. `warstwa-danych.js` — trzeci tryb, składający oba moduły w jeden kontrakt
   24 funkcji. Ekrany nadal widzą jedno `window.DANE`.
4. `testy/kontrakty.js` porównuje **trzy** warstwy — lokalną, Supabase i AWS.
5. **Nowy test rozgraniczenia:** żadna z 18 funkcji danych nie wykonuje
   żądania poza Core API. Sprawdzane przez przechwycenie ruchu sieciowego,
   nie przez przegląd kodu — zasada 1 ma mieć dowód maszynowy.

**Dowód:** test kontraktowy dla trzech warstw + test rozgraniczenia.
Zero zmian w `app.html`, `index.html`, `nowe-haslo.html`. Jeśli okaże się,
że muszę je zmienić — poprawiam warstwę, nie ekran.

---

### Etap 6 — E2E na AWS

Pełny przebieg 26 scenariuszy przeciw AWS, z zapisem odpowiedzi systemu przy
każdym punkcie. Plus test 22 pod obciążeniem równoległym i testy modelu
z etapu 1.

**Warunek przejścia:** PASS 24 · RĘCZNY 2 (A5, E7). Każde FAIL zatrzymuje etap.

---

### Etap 7 — przełączenie i wycofanie Supabase

Zgodnie z decyzją 7:

**Migrujemy:** wyłącznie realną, zatwierdzoną treść szkoleniową. Ponieważ
źródłem treści jest arkusz `AsterA_Coach_Baza_Tresci.xlsx`, a import i tak
przepisujemy pod nowy model — treść **odtwarzamy z arkusza**, nie przenosimy
z Supabase. Jeśli w prototypie powstanie treść niemająca odbicia w arkuszu,
przenosimy ją wyborowo i imiennie, po przeglądzie.

**Nie migrujemy:** kont testowych, postępów z E2E, pytań testowych,
zaproszeń, danych technicznych.

**Konta użytkowników:** tworzone od nowa w Cognito. Pierwszy administrator —
procedurą odpowiadającą dzisiejszej `ustanow_pierwszego_admina`, opisaną
w `URUCHOMIENIE.md`.

Dalej: przełączenie `konfig.js` na tryb AWS. **Supabase zostaje nietknięty
przez uzgodniony okres jako ścieżka wycofania** — powrót to zmiana
konfiguracji, bez zmian w kodzie. Dopiero po tym okresie usuwamy pliki z listy
„wyrzucamy".

---

## 5 · Kolejność

```
Etap 0  tożsamość + rola                    (lokalnie, bez AWS)
   │
Etap 1  Aurora + model docelowy + pomiar puli
   │
Etap 2  Core API + Cognito (wariant A) ─────┐
   │                                        │ 3 i 4 równolegle
Etap 3  S3 ─────────────────────────────────┤ po zamknięciu etapu 2
Etap 4  Lambda + SES ───────────────────────┘
   │
Etap 5  auth-cognito.js + dane-aws.js
   │
Etap 6  E2E na AWS
   │
Etap 7  przełączenie, Supabase jako wycofanie
```

Etap 1 urósł względem wersji 1 — wchodzi w nim rozbudowa modelu z §2.
To świadomy wybór: przepisanie `etap` na wersje wymusza przepisanie importu
i testów, a dwukrotne robienie tego jest droższe niż raz.

---

## 6 · Co pozostało do rozstrzygnięcia

Z siedmiu punktów wersji 1 zostały trzy — pozostałe zamknęły decyzje 1–9.

| # | sprawa | dlaczego pytam |
|---|---|---|
| 1 | Czy wersjonować także `kurs` i `lekcja`, czy zostawić im same tłumaczenia (§2.1)? | proponuję nie wersjonować; wzorzec jest ten sam, koszt to dwie pary tabel |
| 2 | Głosówka: jedno pole `tresc` z rolą wynikającą z języka źródłowego (§2.5), czy dwie osobne kolumny `transkrypcja` i `tlumaczenie`? | proponuję jedno pole — dwa dają stan „oba wypełnione albo oba puste" do pilnowania w aplikacji |
| 3 | Okres, przez jaki Supabase zostaje jako ścieżka wycofania po etapie 7 | wpływa tylko na termin usunięcia plików z listy „wyrzucamy" |

Żadne z tych trzech nie blokuje rozpoczęcia etapu 0.

---

## 7 · Czego ten plan nie zawiera

- Ani jednej wykonanej czynności.
- Bedrock AgentCore — agent korzysta z Core API i wchodzi po migracji.
- Innych obszarów AsterA Core niż Coach.
- Terminów — podam po zatwierdzeniu wersji 2.

---

## 8 · Stan na dziś, niezmieniony

- Supabase `astera-coach-test` — nietknięty, jedno konto: trwały administrator
  testowy. Żadnych nowych tabel produkcyjnych.
- AWS — nietknięty. Etap 0 nierozpoczęty.
- Gałąź `platforma-v7` — lokalna, nic nie poszło na GitHuba.
- Agent Mali na Render (produkcja, `autoDeploy: false`) — nietknięty.

Czekam na zatwierdzenie wersji 2 i trzy odpowiedzi z §6.
