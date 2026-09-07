/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — warstwa danych na AWS: osiemnaście funkcji przez Core
                                                                   [Etap 2]
   Zwykły skrypt, bez `export`. Dociąga go `warstwa-danych.js` w trybie
   AWS, po auth-cognito.js. Wystawia window.DANE_AWS o pełnym kontrakcie
   24 funkcji: sześć Auth deleguje do window.AUTH_COGNITO, osiemnaście
   danych woła WYŁĄCZNIE AsterA Core.

   ZASADA 1 PLANU, w kodzie: ten plik zna jeden adres — KONFIG.CORE_URL.
   Nie zna Aurory, S3, Lambdy ani Cognito. Test rozgraniczenia
   (testy/kontrakty.js) przechwytuje każdy fetch i sprawdza, że nie ma
   ani jednego żądania poza Core.

   Token idzie w nagłówku `Authorization: Bearer <token dostępu>`; bierze
   go z AUTH_COGNITO.token(), które samo odświeża wygasłą sesję.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const K = window.KONFIG || {};
  if (!K.CORE_URL) return;                                       // nie ten tryb
  const CORE = String(K.CORE_URL).replace(/\/+$/, '');
  const AUTH = () => window.AUTH_COGNITO;

  const NA_LOGOWANIE = () => {
    if (!/index\.html|nowe-haslo\.html/.test(location.pathname) && location.pathname !== '/')
      location.href = 'index.html';
  };

  async function naglowki(dodatkowe = {}) {
    const t = await AUTH().token();
    return { ...(t ? { Authorization: 'Bearer ' + t } : {}), ...dodatkowe };
  }

  async function zapytaj(sciezka, dane, opcje = {}) {
    const o = dane
      ? { method: 'POST', headers: await naglowki({ 'Content-Type': 'application/json' }), body: JSON.stringify(dane) }
      : { headers: await naglowki() };
    const r = await fetch(CORE + sciezka, o);
    if (r.status === 401 && !opcje.bezPrzekierowania) { NA_LOGOWANIE(); throw new Error('Sesja wygasła.'); }
    const d = await r.json().catch(() => ({ blad: 'Zła odpowiedź serwera.' }));
    if (!r.ok) throw new Error(d.blad || 'Nie udało się wykonać operacji.');
    return d;
  }

  const DANE_AWS = {
    /* ── Auth: Cognito, nie Core ─────────────────────────────── */
    zaloguj:          (e, h) => AUTH().zaloguj(e, h),
    wyloguj:          ()     => AUTH().wyloguj(),
    wyslijLinkResetu: e      => AUTH().wyslijLinkResetu(e),
    sesjaZLinku:      ()     => AUTH().sesjaZLinku(),
    ustawHaslo:       (n, t) => AUTH().ustawHaslo(n, t),
    async ja() {
      if (!(await AUTH().token())) return null;
      try { return (await zapytaj('/api/ja', null, { bezPrzekierowania: true })).profil; }
      catch { return null; }
    },

    /* ── dane: wyłącznie Core ────────────────────────────────── */
    kursy()               { return zapytaj('/api/kursy'); },
    kurs(id)              { return zapytaj('/api/kurs?id=' + encodeURIComponent(id)); },
    zapiszPostep(etapId, status) { return zapytaj('/api/postep', { etap_id: etapId, status }); },

    pytania()             { return zapytaj('/api/pytania'); },
    zadajPytanie(kursId, etapId, tresc) {
      return zapytaj('/api/pytanie', { kurs_id: kursId, etap_id: etapId || null, tresc });
    },
    odpowiedzNaPytanie(id, odpowiedz) { return zapytaj('/api/pytanie/odpowiedz', { id, odpowiedz }); },
    async zamknijPytanie(id) { await zapytaj('/api/pytanie/zamknij', { id }); },

    linkDoMaterialu(id)   { return zapytaj('/api/material/link?id=' + encodeURIComponent(id)); },

    /** Plik idzie do Core, Core do magazynu (S3 od Etapu 3). Front nie zna bucketu. */
    async wgrajMaterial({ kurs_id, typ, nazwa, opis, etap_id, plik }) {
      if (!plik) throw new Error('Najpierw wybierz plik z komputera.');
      const q = new URLSearchParams({ kurs_id, typ, nazwa, plik: plik.name });
      if (opis)    q.set('opis', opis);
      if (etap_id) q.set('etap_id', etap_id);
      const r = await fetch(CORE + '/api/material/plik?' + q, {
        method: 'POST',
        headers: await naglowki({ 'Content-Type': plik.type || 'application/octet-stream' }),
        body: plik,
      });
      if (r.status === 401) { NA_LOGOWANIE(); throw new Error('Sesja wygasła.'); }
      const d = await r.json().catch(() => ({ blad: 'Zła odpowiedź serwera.' }));
      if (!r.ok) throw new Error(d.blad || 'Nie udało się wgrać pliku.');
      return d.material;
    },
    publikujMaterial(id, opublikowany) { return zapytaj('/api/material/publikuj', { id, opublikowany }); },
    async usunMaterial(id) { await zapytaj('/api/material/usun', { id }); },

    konta()                    { return zapytaj('/api/konta'); },
    zmienRole(id, rola)        { return zapytaj('/api/konto/rola', { id, rola }); },
    ustawAktywne(id, aktywne)  { return zapytaj('/api/konto/aktywne', { id, aktywne }); },
    /** Core zakłada konto w Cognito i profil; wiadomość wysyła Core (Etap 4). */
    async zapros(z) {
      const d = await zapytaj('/api/zapros', z);
      delete d.link_lokalny;          // link na ekranie to wyłącznie tryb lokalny
      return d;
    },

    kursanci()                       { return zapytaj('/api/kursanci'); },
    przypisz(kurs_id, kursant_id)    { return zapytaj('/api/przypisz', { kurs_id, kursant_id }); },
    async odepnij(kurs_id, kursant_id) { await zapytaj('/api/odepnij', { kurs_id, kursant_id }); },
  };

  window.DANE_AWS = DANE_AWS;
})();
