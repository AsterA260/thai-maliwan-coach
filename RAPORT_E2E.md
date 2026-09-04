# RAPORT E2E — stan na 4 września 2026

Gałąź: **`platforma-v5`** · paczka **v5**

---

## WERDYKT: **NIEGOTOWE DO PRODUKCJI**

Powód jest jeden i jest jednoznaczny: **26 testów E2E nie zostało
wykonanych, bo nie powstał projekt Supabase.** Nie zrobię tego kroku sam
i nie będę udawał, że da się go obejść.

**Czego nie zrobię, nawet na wyraźne polecenie:** nie zakładam kont
w cudzych serwisach i nie wpisuję nigdzie haseł. To dotyczy też
rejestracji w Supabase. Konto zakłada człowiek — Ty.

To nie jest cała prawda o blokadzie, więc od razu druga połowa: **gdy
konto już istnieje, resztę mogę zrobić sam.** Projekt zakłada się przez
API zarządzania, na osobistym tokenie dostępu, który wygenerujesz
w swoim panelu. Napisałem do tego narzędzie. Poniżej dokładnie, co jest
gotowe i co dzieli nas od wyniku.

---

## 1 · Co zrobiłem w tej rundzie

| # | zadanie z listy | stan |
|---|---|---|
| 1 | Utworzyć projekt testowy Supabase | **ZABLOKOWANE** — wymaga konta; narzędzie gotowe (`npm run projekt:testowy`) |
| 2 | Nie używać prawdziwych danych kursantów | **ZROBIONE** — testy pracują wyłącznie na kontach `@e2e.przyklad.pl`, zakładanych i kasowanych w tym samym przebiegu |
| 3 | Wdrożyć schemat, RLS, bucket, Edge Function, Redirect URLs | **PRZYGOTOWANE** — kolejność i treść w `URUCHOMIENIE.md` §2.2–2.5; wykonanie po punkcie 1 |
| 4 | Pierwszy administrator | **PRZYGOTOWANE I SPRAWDZONE LOKALNIE** — `ustanow_pierwszego_admina()`, testy bazy 19 i 20 |
| 5 | Uruchomić 26 testów | **NIEWYKONANE** — kod gotowy: `npm run e2e` |
| 6 | Zapisywać dowód każdego testu | **PRZYGOTOWANE** — runner sam pisze `testy/WYNIK_E2E.md` i `wynik_e2e.json` z odpowiedziami systemu |
| 7 | Zatrzymać wdrożenie przy błędzie ról albo bezpieczeństwa | **PRZYGOTOWANE** — runner kończy się kodem 1 i wypisuje listę nieudanych scenariuszy |
| 8 | Nie podpinać domeny, nie wdrażać produkcji, nie ruszać `main` | **DOTRZYMANE** — nic nie wysłane, `main` nietknięty |
| 9 | Poprawić mylący fragment o odzyskiwaniu administratora | **ZROBIONE** — i sprawdzone na bazie, opis niżej |

---

## 2 · Punkt 9 — sprostowanie, które było potrzebne

Instrukcja v4 pisała: *„wyłącz albo zdegraduj pozostałych adminów
z aplikacji, a gdy nie ma już żadnego aktywnego — funkcja znów
zadziała"*. Sprawdziłem to na bazie i **tak się nie da**:

```
update public.profile set aktywne=false where id=<jedyny admin>;
ERROR:  To jedyny aktywny administrator — nie mozna go wylaczyc ani zdegradowac.
```

Stan „zero aktywnych administratorów" nigdy tą drogą nie powstanie, więc
opisana procedura prowadziła donikąd. `URUCHOMIENIE.md` ma teraz sekcję
**2.6a** z czterema realnymi scenariuszami (zapomniane hasło, niedostępna
skrzynka, drugi admin, brak dostępu do wszystkiego) i jedną procedurą
ratunkową w SQL Editorze — **sprawdzoną**: po `commit` nowy adres ma rolę
`admin`, po `rollback` nic się nie zmienia.

---

## 3 · Co dokładnie jest gotowe do uruchomienia

### `npm run projekt:testowy`
Zakłada projekt na planie darmowym w regionie Frankfurt, czeka, aż
wstanie, pobiera klucze i zapisuje `.env` z prawami 600. **Nie wypisuje
żadnego klucza ani tokenu** — ani na ekran, ani do raportu. Jeśli projekt
o tej nazwie już istnieje, używa go zamiast zakładać drugi.

### `npm run e2e`
Wykonuje wszystkie 26 scenariuszy przeciwko żywemu projektowi i zapisuje
`testy/WYNIK_E2E.md` — tabelę z PASS/FAIL, opisem i **surową odpowiedzią
systemu** przy każdym punkcie. Na koniec kasuje wszystko, co założył,
i wypisuje, gdyby czegoś nie udało się posprzątać.

Rozkład scenariuszy:

| grupa | zautomatyzowane | do potwierdzenia ręcznie |
|---|---|---|
| Auth A1–A10 | A1, A2, A3, A4, A6, A7, A8, A9, A10 | **A5** — kliknięcie w link ze skrzynki |
| Storage S1–S7 | wszystkie siedem | — |
| Edge E1–E9 | E1, E2, E3, E4, E5, E6, E8, E9 | **E7** — wymusza awarię nadania roli |

Dwa scenariusze ręczne są tak oznaczone w kodzie i wyjdą w raporcie jako
`RĘCZNY`, nie jako `PASS`. Nie zaliczam sobie punktów za coś, czego
maszyna nie sprawdziła.

**Uczciwie o samym runnerze:** do pierwszego uruchomienia przeciwko
żywemu projektowi to kod **nieprzetestowany**. Pierwszy przebieg będzie
jednocześnie testem skryptu i pewnie coś w nim poprawię. Napisałem to
w nagłówku pliku, żeby nikt nie wziął jego istnienia za dowód, że testy
przeszły.

---

## 4 · Co musisz zrobić Ty — jakieś trzy minuty

1. **supabase.com → Start your project** → załóż konto (GitHub albo e-mail).
   To jedyny krok, którego nie zrobię.
2. **Account → Access Tokens → Generate new token**, nazwij np. `astera-coach`.
3. Wklej token do pliku
   `~/Desktop/Claude outputs/ASTERA_COACH_PLATFORMA_KANDYDAT_v5/.supabase-token`
   (sam plik, nic więcej; jest w `.gitignore`, nie wypisuję jego treści).
4. Powiedz mi „jest" — resztę prowadzę sam: projekt, schemat, RLS, bucket,
   Edge Function, Redirect URLs, pierwszy administrator, 26 testów i raport.

Nie wklejaj tokenu do rozmowy. Ma leżeć w pliku.

---

## 5 · Co pozostaje do zrobienia

**Zanim ruszy test E2E**
- konto Supabase i token (punkt wyżej);
- `supabase` CLI do wdrożenia Edge Function — albo wgranie funkcji z panelu.

**Po zielonym E2E, przed produkcją**
- decyzja: plan darmowy czy Pro (darmowy usypia bazę po tygodniu bezczynności);
- adres `coach.thaimaliwan.pl` + Redirect URLs pod ten adres;
- lista kont na start: imię, e-mail, rola;
- materiały do wgrania (PDF-y, zdjęcia, nagrania) i przypisania Maliwan;
- tłumaczenie tajskie etapów poza kursem podstawowym;
- regulamin i informacja o danych osobowych — platforma trzyma imiona,
  adresy i postępy, więc potrzebna jest podstawa prawna;
- ograniczenie prób logowania: na Supabase jest wbudowane, ale trzeba
  potwierdzić limity (scenariusz A8).

**Świadomie poza zakresem teraz**
- płatności, tłumacz na żywo, nagrywanie sesji, eksport do XLSX.

---

## 6 · Adres projektu testowego

**Nie istnieje.** Pojawi się tutaj po wykonaniu punktu 4 z sekcji 4,
w postaci `https://<ref>.supabase.co` — bez żadnych kluczy.

---

## 7 · Werdykt

**NIEGOTOWE DO PRODUKCJI.**

Kod jest gotowy do testu: 57 testów lokalnych przechodzi, bloker z ról
naprawiony i potwierdzony testami na bazie z wyzwalaczami, instrukcja
sprostowana. Ale **żaden z 26 scenariuszy E2E nie został wykonany**,
a bez nich nie wolno mówić o gotowości — tak samo, jak nie wolno było
przy 36/36 w v2 i przy 57/57 teraz.

Do zielonego światła brakuje jednego kroku po Twojej stronie i jednego
przebiegu po mojej.
