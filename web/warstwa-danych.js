/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — JEDNA warstwa danych

   Ekrany (index.html, app.html, nowe-haslo.html) nie wiedzą, skąd biorą
   się dane. Wołają wyłącznie `DANE.<funkcja>()`. Ten plik decyduje, co
   pod tym siedzi:

     • jest konfiguracja Supabase (konfig.js z niepustym SUPABASE_URL)
         → dociąga bibliotekę Supabase i dane-supabase.js,
           DANE = window.DANE_SUPABASE            → TRYB 'supabase'
     • nie ma jej
         → adapter na serwer deweloperski /api/*  → TRYB 'lokalny'

   Żadnej ręcznej podmiany kodu przed wdrożeniem. Wdrożenie podmienia
   wyłącznie konfig.js (`npm run konfig` buduje go z .env).

   Biblioteka Supabase dociągana jest DOPIERO w trybie produkcyjnym —
   dzięki temu wersja lokalna działa bez internetu.

   KONTRAKT — obie warstwy zwracają dokładnie to samo. Pilnuje tego
   test `testy/kontrakty.js`, który wywołuje wszystkie funkcje obu
   warstw i porównuje kształt odpowiedzi.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const K = window.KONFIG || {};
  const PRODUKCJA = !!(K.SUPABASE_URL && K.SUPABASE_ANON_KEY);

  /* ── nazwy funkcji, które MUSI mieć każda warstwa ─────────────── */
  const KONTRAKT = [
    'zaloguj', 'wyloguj', 'ja', 'wyslijLinkResetu', 'sesjaZLinku', 'ustawHaslo',
    'kursy', 'kurs', 'zapiszPostep',
    'pytania', 'zadajPytanie', 'odpowiedzNaPytanie', 'zamknijPytanie',
    'linkDoMaterialu', 'wgrajMaterial', 'publikujMaterial', 'usunMaterial',
    'konta', 'zmienRole', 'ustawAktywne', 'zapros',
    'kursanci', 'przypisz', 'odepnij',
  ];

  /* ═══ WARSTWA LOKALNA — serwer deweloperski ════════════════════ */
  const NA_LOGOWANIE = () => {
    if (!/index\.html|nowe-haslo\.html/.test(location.pathname) && location.pathname !== '/')
      location.href = 'index.html';
  };

  async function zapytaj(sciezka, dane, opcje = {}) {
    const o = dane ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify(dane) } : {};
    const r = await fetch(sciezka, o);
    if (r.status === 401 && !opcje.bezPrzekierowania) { NA_LOGOWANIE(); throw new Error('Sesja wygasła.'); }
    const d = await r.json().catch(() => ({ blad: 'Zła odpowiedź serwera.' }));
    if (!r.ok) throw new Error(d.blad || 'Nie udało się wykonać operacji.');
    return d;
  }

  const TYLKO_SUPABASE =
    'Hasłami zarządza Supabase Auth. Wersja lokalna nie wysyła wiadomości — ' +
    'hasło ustawia administrator w bazie.';

  const LOKALNA = {
    async zaloguj(email, haslo) {
      const d = await zapytaj('/api/logowanie', { email, haslo });
      return d.profil;
    },
    async wyloguj() { await zapytaj('/api/wylogowanie', {}); },
    async ja() {
      try { return (await zapytaj('/api/ja', null, { bezPrzekierowania: true })).profil; }
      catch { return null; }
    },
    async wyslijLinkResetu()   { throw new Error(TYLKO_SUPABASE); },
    async ustawHaslo()         { throw new Error(TYLKO_SUPABASE); },
    async sesjaZLinku()        { return { jest: false, typ: null }; },

    kursy()               { return zapytaj('/api/kursy'); },
    kurs(id)              { return zapytaj('/api/kurs?id=' + encodeURIComponent(id)); },
    zapiszPostep(etapId, status) { return zapytaj('/api/postep', { etap_id: etapId, status }); },

    pytania()             { return zapytaj('/api/pytania'); },
    zadajPytanie(kursId, etapId, tresc) {
      return zapytaj('/api/pytanie', { kurs_id: kursId, etap_id: etapId || null, tresc });
    },
    odpowiedzNaPytanie(id, odpowiedz) {
      return zapytaj('/api/pytanie/odpowiedz', { id, odpowiedz });
    },
    async zamknijPytanie(id) { await zapytaj('/api/pytanie/zamknij', { id }); },

    linkDoMaterialu(id)   { return zapytaj('/api/material/link?id=' + encodeURIComponent(id)); },

    /** Ten sam argument co na produkcji: prawdziwy obiekt File. */
    async wgrajMaterial({ kurs_id, typ, nazwa, opis, etap_id, plik }) {
      if (!plik) throw new Error('Najpierw wybierz plik z komputera.');
      const q = new URLSearchParams({ kurs_id, typ, nazwa, plik: plik.name });
      if (opis)    q.set('opis', opis);
      if (etap_id) q.set('etap_id', etap_id);
      const r = await fetch('/api/material/plik?' + q, {
        method: 'POST',
        headers: { 'Content-Type': plik.type || 'application/octet-stream' },
        body: plik,
      });
      if (r.status === 401) { NA_LOGOWANIE(); throw new Error('Sesja wygasła.'); }
      const d = await r.json().catch(() => ({ blad: 'Zła odpowiedź serwera.' }));
      if (!r.ok) throw new Error(d.blad || 'Nie udało się wgrać pliku.');
      return d.material;
    },
    publikujMaterial(id, opublikowany) {
      return zapytaj('/api/material/publikuj', { id, opublikowany });
    },
    async usunMaterial(id) { await zapytaj('/api/material/usun', { id }); },

    konta()                    { return zapytaj('/api/konta'); },
    zmienRole(id, rola)        { return zapytaj('/api/konto/rola', { id, rola }); },
    ustawAktywne(id, aktywne)  { return zapytaj('/api/konto/aktywne', { id, aktywne }); },
    zapros(z)                  { return zapytaj('/api/zapros', z); },

    kursanci()                       { return zapytaj('/api/kursanci'); },
    przypisz(kurs_id, kursant_id)    { return zapytaj('/api/przypisz', { kurs_id, kursant_id }); },
    async odepnij(kurs_id, kursant_id) { await zapytaj('/api/odepnij', { kurs_id, kursant_id }); },
  };

  /* ═══ WYBÓR WARSTWY ════════════════════════════════════════════ */
  function dociagnij(adres) {
    return new Promise((ok, zle) => {
      const s = document.createElement('script');
      s.src = adres; s.async = false;
      s.onload = ok;
      s.onerror = () => zle(new Error('Nie udało się wczytać ' + adres));
      document.head.appendChild(s);
    });
  }

  function sprawdzKontrakt(warstwa, nazwaWarstwy) {
    const brak = KONTRAKT.filter(f => typeof warstwa[f] !== 'function');
    if (brak.length)
      throw new Error(`Warstwa „${nazwaWarstwy}" nie ma funkcji: ${brak.join(', ')}`);
    return warstwa;
  }

  window.TRYB = PRODUKCJA ? 'supabase' : 'lokalny';

  window.GOTOWE = (async () => {
    if (!PRODUKCJA) {
      window.DANE = sprawdzKontrakt(LOKALNA, 'lokalna');
      return window.DANE;
    }
    if (!window.supabase)
      await dociagnij('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js');
    if (!window.DANE_SUPABASE) await dociagnij('dane-supabase.js');
    if (!window.DANE_SUPABASE)
      throw new Error('Konfiguracja wskazuje Supabase, ale warstwa danych się nie wczytała.');
    window.DANE = sprawdzKontrakt(window.DANE_SUPABASE, 'supabase');
    return window.DANE;
  })();

  window.KONTRAKT_DANYCH = KONTRAKT;
  if (typeof module === 'object' && module.exports) module.exports = { KONTRAKT };
})();
