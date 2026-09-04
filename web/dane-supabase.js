/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — warstwa danych na PRODUKCJI (Supabase)

   Zwykły skrypt, bez `export`. Nie wpina się go ręcznie do ekranów —
   dociąga go `warstwa-danych.js`, gdy konfig.js wskazuje Supabase.
   Wystawia jeden obiekt: window.DANE_SUPABASE, o dokładnie tym samym
   kontrakcie co warstwa lokalna (pilnuje tego testy/kontrakty.js).

   konfig.js zawiera WYŁĄCZNIE:
     window.KONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET,
                       ADRES_APLIKACJI };

   KLUCZ service_role NIE POJAWIA SIĘ TUTAJ ANI W ŻADNYM PLIKU FRONTU.
   Omija RLS, więc żyje wyłącznie w sekretach Supabase — patrz `zapros`.

   PRZEPŁYW LINKÓW Z POCZTY — jeden wariant, nie trzy.
   Zaproszenie i reset hasła prowadzą do tego samego adresu
   `<ADRES_APLIKACJI>/nowe-haslo.html`. Supabase dokleja do niego
   fragment `#access_token=…&type=invite|recovery`, a klient z
   `detectSessionInUrl` zakłada z niego sesję. Potem wystarczy
   `updateUser({ password })`. Świadomie NIE używamy PKCE: przy
   zaproszeniu link powstaje po stronie serwera, więc w przeglądarce
   zapraszanego nie ma czego weryfikować (`code_verifier`), i przepływ
   PKCE by się wywalił.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (!window.KONFIG || !window.KONFIG.SUPABASE_URL) return;   // tryb lokalny

  const sb = window.supabase.createClient(
    window.KONFIG.SUPABASE_URL,
    window.KONFIG.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true,
              detectSessionInUrl: true, flowType: 'implicit' } }
  );
  const BUCKET = window.KONFIG.SUPABASE_BUCKET || 'materialy';
  const ADRES  = (window.KONFIG.ADRES_APLIKACJI || location.origin).replace(/\/+$/, '');

  const blad = (e, domyslny) => { throw new Error((e && e.message) || domyslny); };
  const czyste = a => (a && a.data) || [];

  /** Zapis, który MUSI zmienić wiersz.
      RLS nie zgłasza błędu, kiedy po prostu nie ma czego zmienić —
      zwraca pustkę. Bez tej kontroli aplikacja pokazywałaby sukces
      tam, gdzie baza nic nie zrobiła. */
  function zmieniony({ data, error }, komunikat) {
    if (error) throw new Error(
      /jedyny aktywny administrator/i.test(error.message || '')
        ? 'To jedyny aktywny administrator — nie można go wyłączyć ani zdegradować.'
        : komunikat);
    const wiersze = Array.isArray(data) ? data : (data ? [data] : []);
    if (!wiersze.length) throw new Error(komunikat);
    return wiersze[0];
  }

  /* ── LOGOWANIE ─────────────────────────────────────────────── */
  async function zaloguj(email, haslo) {
    const { error } = await sb.auth.signInWithPassword({ email, password: haslo });
    if (error) throw new Error('Nieprawidłowy adres e-mail lub hasło.');
    const p = await ja();
    if (!p) { await sb.auth.signOut(); throw new Error('To konto jest wyłączone.'); }
    return p;
  }

  async function wyloguj() {
    const { error } = await sb.auth.signOut();      // unieważnia token po stronie Supabase
    if (error) throw new Error('Nie udało się wylogować. Spróbuj jeszcze raz.');
  }

  async function wyslijLinkResetu(email) {
    const { error } = await sb.auth.resetPasswordForEmail(String(email || '').trim(), {
      redirectTo: ADRES + '/nowe-haslo.html'
    });
    if (error) blad(error, 'Nie udało się wysłać wiadomości.');
  }

  /** Czy link z poczty (zaproszenie albo reset) założył już sesję.
      `detectSessionInUrl` robi to sam, ale asynchronicznie — czekamy
      na wynik, zamiast zgadywać po zawartości adresu. */
  async function sesjaZLinku() {
    const typ = (new URLSearchParams(location.hash.replace(/^#/, ''))).get('type') || null;
    for (let i = 0; i < 25; i++) {                       // maks. ~5 s
      const { data: { session } } = await sb.auth.getSession();
      if (session) return { jest: true, typ };
      if (!location.hash.includes('access_token')) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const { data: { session } } = await sb.auth.getSession();
    return { jest: !!session, typ };
  }

  /** Ustawienie hasła — ten sam kod dla zaproszenia i dla resetu,
      bo w obu wypadkach sesja jest już założona z linku. */
  async function ustawHaslo(nowe) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Link wygasł albo został już użyty. Poproś o nowy.');
    const { error } = await sb.auth.updateUser({ password: nowe });
    if (error) blad(error, 'Nie udało się zapisać hasła. Link mógł wygasnąć.');
  }

  /* ── KTO JESTEM ────────────────────────────────────────────── */
  async function ja() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('profile')
      .select('id, imie, email, rola, jezyk, aktywne').eq('id', user.id).maybeSingle();
    if (!data || data.aktywne === false) { await sb.auth.signOut(); return null; }
    return data;
  }

  /* ── DANE ────────────────────────────────────────────────────
     Nigdzie nie ma warunku „jeśli rola == kursant, to…".
     Zapytania są takie same dla wszystkich — przycina je RLS.     */
  async function kursy() {
    const { data, error } = await sb.from('kurs')
      .select('*, profile:instruktor_id (imie)').order('dni');
    if (error) blad(error, 'Nie udało się wczytać kursów.');
    return (data || []).map(k => ({ ...k, instruktor: k.profile && k.profile.imie }));
  }

  async function kurs(kursId) {
    const [lekcje, etapy, materialy, postepy] = await Promise.all([
      sb.from('lekcja').select('*').eq('kurs_id', kursId).order('kolejnosc'),
      sb.from('etap').select('*, lekcja!inner(kurs_id)')
        .eq('lekcja.kurs_id', kursId).order('kolejnosc'),
      sb.from('material').select('*').eq('kurs_id', kursId).order('nazwa_pl'),
      sb.from('postep').select('*, etap!inner(lekcja!inner(kurs_id))')
        .eq('etap.lekcja.kurs_id', kursId),
    ]);
    return { lekcje: czyste(lekcje), etapy: czyste(etapy),
             materialy: czyste(materialy), postepy: czyste(postepy) };
  }

  async function zapiszPostep(etapId, status) {
    const { data: { user } } = await sb.auth.getUser();
    const w = await sb.from('postep')
      .upsert({ kursant_id: user.id, etap_id: etapId, status },
              { onConflict: 'kursant_id,etap_id' })
      .select();
    return zmieniony(w, 'Nie udało się zapisać postępu.');
  }

  /* ── PYTANIA ───────────────────────────────────────────────── */
  async function pytania() {
    const { data, error } = await sb.from('pytanie')
      .select('*, kursant:kursant_id (imie), kurs:kurs_id (nazwa_pl), odp:odpowiedzial_id (imie)')
      .order('utworzone', { ascending: false });
    if (error) blad(error, 'Nie udało się wczytać pytań.');
    return (data || []).map(p => ({ ...p,
      kursant: p.kursant && p.kursant.imie,
      kurs: p.kurs && p.kurs.nazwa_pl,
      odpowiedzial: p.odp && p.odp.imie }));
  }

  async function zadajPytanie(kursId, etapId, tresc) {
    const { data: { user } } = await sb.auth.getUser();
    const w = await sb.from('pytanie')
      .insert({ kursant_id: user.id, kurs_id: kursId, etap_id: etapId || null, tresc })
      .select();
    return zmieniony(w, 'Nie udało się wysłać pytania.');
  }

  /** Instruktor odpowiada. Wyzwalacz w bazie i tak nie pozwoli mu
      zmienić autora, kursu, etapu ani treści pytania. */
  async function odpowiedzNaPytanie(id, odpowiedz) {
    const { data: { user } } = await sb.auth.getUser();
    const w = await sb.from('pytanie')
      .update({ odpowiedz, odpowiedzial_id: user.id, status: 'odpowiedziane' })
      .eq('id', id).select();
    return zmieniony(w, 'Nie możesz odpowiadać na to pytanie.');
  }

  async function zamknijPytanie(id) {
    const w = await sb.from('pytanie')
      .update({ status: 'zamkniete' }).eq('id', id).select();
    zmieniony(w, 'Nie możesz zamknąć tego pytania.');
  }

  /* ── PLIKI — prywatny bucket, podpisany link na 5 minut ────── */
  async function linkDoMaterialu(materialId) {
    // RLS zwróci wiersz tylko temu, kto ma prawo go widzieć
    const { data: m } = await sb.from('material')
      .select('sciezka, nazwa_pl').eq('id', materialId).maybeSingle();
    if (!m) throw new Error('Nie masz dostępu do tego materiału.');
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(m.sciezka, 300);
    if (error || !data) throw new Error('Nie masz dostępu do tego pliku.');
    return { link: data.signedUrl, nazwa: m.nazwa_pl, wazny_s: 300 };
  }

  const LIMIT_B = 25 * 1024 * 1024;
  const DOZWOLONE = {
    pdf: ['application/pdf'],
    zdjecie: ['image/jpeg','image/png','image/webp','image/gif'],
    wideo: ['video/mp4','video/quicktime','video/webm'],
    audio: ['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/x-m4a'],
    inny: ['application/octet-stream','text/plain'],
  };

  /** Kolejność ma znaczenie: najpierw plik, potem metadane,
      a jeśli metadane się nie zapiszą — plik jest kasowany. */
  async function wgrajMaterial({ kurs_id, typ, nazwa, opis, etap_id, plik }) {
    if (!plik) throw new Error('Najpierw wybierz plik z komputera.');
    if (plik.size === 0) throw new Error('Plik jest pusty.');
    if (plik.size > LIMIT_B) throw new Error('Plik jest za duży. Limit to 25 MB.');
    const mime = plik.type || 'application/octet-stream';
    if (!DOZWOLONE[typ] || !DOZWOLONE[typ].includes(mime))
      throw new Error(`Ten format (${mime}) nie jest dozwolony dla typu „${typ}".`);

    const rozszerzenie = (plik.name.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0].toLowerCase();
    const czysta = String(nazwa).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const sciezka = `kurs/${kurs_id}/${typ}/${Date.now()}-${czysta || 'plik'}${rozszerzenie}`;

    const { error: bladPliku } = await sb.storage.from(BUCKET)
      .upload(sciezka, plik, { upsert: false, contentType: mime });
    if (bladPliku) throw new Error('Nie udało się wgrać pliku: ' + bladPliku.message);

    const { data: { user } } = await sb.auth.getUser();
    const w = await sb.from('material').insert({
      kurs_id, etap_id: etap_id || null, typ, nazwa_pl: nazwa, opis: opis || null,
      sciezka, rozmiar_b: plik.size, mime, opublikowany: false, dodal_id: user.id
    }).select();

    try {
      return zmieniony(w, 'Nie masz uprawnień do tego kursu — plik nie został zapisany.');
    } catch (e) {
      await sb.storage.from(BUCKET).remove([sciezka]);      // sprzątanie
      throw e;
    }
  }

  async function publikujMaterial(id, opublikowany) {
    const w = await sb.from('material')
      .update({ opublikowany: !!opublikowany }).eq('id', id).select();
    const wiersz = zmieniony(w, 'Nie masz uprawnień do tego materiału.');
    if (wiersz.opublikowany !== !!opublikowany)
      throw new Error('Nie masz uprawnień do tego materiału.');
    return wiersz;
  }

  async function usunMaterial(id) {
    const { data: m } = await sb.from('material').select('sciezka').eq('id', id).maybeSingle();
    const w = await sb.from('material').delete().eq('id', id).select();
    zmieniony(w, 'Nie masz uprawnień do tego materiału.');
    if (m && m.sciezka) await sb.storage.from(BUCKET).remove([m.sciezka]);
  }

  /* ── KONTA I PRZYPISANIA ───────────────────────────────────── */
  async function konta() {
    const { data, error } = await sb.from('profile')
      .select('id, imie, email, rola, aktywne, utworzone').order('rola').order('imie');
    if (error) blad(error, 'Nie udało się wczytać kont.');
    return data || [];
  }

  async function zmienRole(id, rola) {
    const w = await sb.from('profile')
      .update({ rola }).eq('id', id).select('id, imie, rola');
    const wiersz = zmieniony(w, 'Tylko administrator zmienia role.');
    // Wyzwalacz `profil_ochrona` po cichu cofa zmianę osobie bez uprawnień.
    if (wiersz.rola !== rola) throw new Error('Tylko administrator zmienia role.');
    return wiersz;
  }

  async function ustawAktywne(id, aktywne) {
    const w = await sb.from('profile')
      .update({ aktywne: !!aktywne }).eq('id', id).select('id, imie, aktywne');
    const wiersz = zmieniony(w, 'Tylko administrator włącza i wyłącza konta.');
    if (wiersz.aktywne !== !!aktywne)
      throw new Error('Tylko administrator włącza i wyłącza konta.');
    return wiersz;
  }

  /** ZAPROSZENIE — jedyne miejsce, które MUSI iść przez serwer.
      Zakładanie konta wymaga klucza service_role, a ten nie może
      znaleźć się w przeglądarce. Wywołujemy Edge Function, która
      trzyma klucz po stronie Supabase i sama sprawdza, czy proszący
      jest administratorem. Kod funkcji: supabase/functions/zapros/ */
  async function zapros({ imie, email, rola, kurs_id }) {
    const { data, error } = await sb.functions.invoke('zapros', {
      body: { imie, email, rola, kurs_id: kurs_id || null }
    });
    if (error) {
      let komunikat = 'Nie udało się wysłać zaproszenia.';
      try {                                   // funkcja odsyła {blad: "…"}
        const tresc = error.context && await error.context.json();
        if (tresc && tresc.blad) komunikat = tresc.blad;
      } catch (_) { /* zostaje komunikat domyślny */ }
      throw new Error(komunikat);
    }
    if (!data || !data.zaproszenie) throw new Error('Zaproszenie nie zostało utworzone.');
    return data;                              // { zaproszenie: {...}, uwaga: '…' }
  }

  /** Ten sam widok co u serwera deweloperskiego — te same `zrobione`
      i `etapow`, policzone w bazie, nie w przeglądarce. */
  async function kursanci() {
    const { data, error } = await sb.from('widok_kursanci').select('*').order('imie');
    if (error) blad(error, 'Nie udało się wczytać kursantów.');
    return (data || []).map(k => ({ ...k,
      zrobione: Number(k.zrobione) || 0, etapow: Number(k.etapow) || 0 }));
  }

  async function przypisz(kurs_id, kursant_id) {
    const { data: { user } } = await sb.auth.getUser();
    const w = await sb.from('przypisanie')
      .upsert({ kurs_id, kursant_id, przypisal_id: user.id, aktywne: true },
              { onConflict: 'kurs_id,kursant_id' }).select();
    return zmieniony(w, 'Tylko administrator przypisuje kursantów.');
  }

  async function odepnij(kurs_id, kursant_id) {
    const w = await sb.from('przypisanie').update({ aktywne: false })
      .eq('kurs_id', kurs_id).eq('kursant_id', kursant_id).select();
    zmieniony(w, 'Tylko administrator odpina kursantów.');
  }

  /* ── SESJA WYGASŁA → z powrotem na logowanie ────────────────── */
  sb.auth.onAuthStateChange(z => {
    if (z === 'SIGNED_OUT' && !/index\.html|nowe-haslo\.html/.test(location.pathname))
      location.href = 'index.html';
  });

  window.DANE_SUPABASE = {
    zaloguj, wyloguj, ja, wyslijLinkResetu, sesjaZLinku, ustawHaslo,
    kursy, kurs, zapiszPostep,
    pytania, zadajPytanie, odpowiedzNaPytanie, zamknijPytanie,
    linkDoMaterialu, wgrajMaterial, publikujMaterial, usunMaterial,
    konta, zmienRole, ustawAktywne, zapros, kursanci, przypisz, odepnij,
  };
})();
