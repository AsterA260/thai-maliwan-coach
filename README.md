# AsterA Coach — Thai Maliwan Academy

Inteligentny asystent procedury, który prowadzi instruktora i kursantów krok po kroku
przez szkolenie — z tłumaczeniem na żywo i nagraniami sesji. Pierwsze wdrożenie:
kurs masażu tajskiego w Thai Maliwan Academy.

## Co jest w tym repozytorium

| Plik / folder | Co to jest |
|---|---|
| `index.html` | Interaktywna makieta Coacha (pokrętło etapów, PL ⇄ TH, tłumacz, nagrania) |
| `AsterA_Coach_Baza_Tresci.xlsx` | Dwujęzyczna baza treści (PL/TH) — źródło danych do przycisków |
| `AsterA_Coach_Koncepcja.docx` | Koncepcja architektury modułu |
| `AsterA_Coach_Mockup_Premium.html` | Alternatywna wersja makiety (PL) |
| `AsterA_Coach_Mockup_TH.html` | Alternatywna wersja makiety (tajska) |

## Makieta na żywo (GitHub Pages)

1. W repozytorium: **Settings → Pages**.
2. Source: **Deploy from a branch** → gałąź `main`, folder `/ (root)`.
3. Po chwili strona działa pod: `https://astera260.github.io/thaimaliwan/`.

### Własna domena (opcjonalnie)
- W **Settings → Pages → Custom domain** wpisz np. `coach.thaimaliwan.pl`.
- U rejestratora domeny dodaj rekord DNS **CNAME**: `coach` → `astera260.github.io`.

## Status

To jest **makieta** — pokazuje wygląd i przepływ. Przyciski 🪷 Tłumacz na żywo
i 🎙️ Nagrania działają „na niby". Prawdziwe tłumaczenie i audio wymagają backendu
(kolejny etap).

## Języki

Interfejs: polski i tajski (przełącznik u góry). Tłumacz pokazuje odpowiedzi
w PL / TH / EN / DE.

---
AsterA · moduł Coach — wersja koncepcyjna 1.0
