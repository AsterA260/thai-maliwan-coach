/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — warstwa danych na PRODUKCJI (Supabase)

   Zwykły skrypt, bez `export` — dołącza się tagiem <script>, tak jak
   reszta aplikacji. Wystawia jeden obiekt: window.DANE_SUPABASE.
   Ta sama nazwa i te same argumenty co punkty /api/* serwera
   deweloperskiego, żeby app.html działał bez przeróbek.

   WPIĘCIE (w index.html, app.html i nowe-haslo.html, przed app.js):
     <script src="konfig.js"></script>
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
     <script src="dane-supabase.js"></script>

   konfig.js budowany jest z .env przy wdrożeniu i zawiera WYŁĄCZNIE:
     window.KONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET,
                       ADRES_APLIKACJI };

   KLUCZ service_role NIE POJAWIA SIĘ TUTAJ ANI W ŻADNYM PLIKU WE FRONCIE.
   Omija RLS, więc żyje wyłącznie na serwerze — patrz `zapros` niżej.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (!window.KONFIG || !window.KONFIG.SUPABASE_URL) return;   // tryb lokalny

  const sb = window.supabase.createClient(
    window.KONFIG.SUPABASE_URL,
    window.KONFIG.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );
  const BUCKET = window.KONFIG.SUPABASE_BUCKET || 'materialy';

  const blad = (e, domyslny) => { throw new Error((e && e.message) || domyslny); };
  const czyste = a => (a && a.data) || [];

  /* ── LOGOWANIE ─────────────────────────────────────────────── */
  async function zaloguj(email, haslo) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: haslo });
    if (error) throw new Error('Nieprawidłowy adres e-mail lub hasło.');
    const p = await ja();
    if (!p) { await sb.auth.signOut(); throw new Error('To konto jest wyłączone.'); }
    return p;
  }

  async function wyloguj() {
    await sb.auth.signOut();      // unieważnia token odświeżania po stronie Supabase
  }

  async function wyslijLinkResetu(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: (window.KONFIG.ADRES_APLIKACJI || location.origin) + '/nowe-haslo.html'
    });
    if (error) blad(error, 'Nie udało się wysłać wiadomości.');
  }

  /** Ekran „ustaw hasło" po kliknięciu w link z e-maila (reset). */
  async function ustawHaslo(nowe) {
    const { error } = await sb.auth.updateUser({ password: nowe });
    if (error) blad(error, 'Nie udało się zapisać hasła. Link mógł wygasnąć.');
  }

  /** Ekran „ustaw hasło" po kliknięciu w zaproszenie. */
  async function przyjmijZaproszenie(tokenHash, nowe) {
    const { error: e1 } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
    if (e1) blad(e1, 'Zaproszenie jest nieważne albo wygasło.');
    const { error: e2 } = await sb.auth.updateUser({ password: nowe });
    if (e2) blad(e2, 'Nie udało się zapisać hasła.');
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
    const { data, error } = await sb.from('postep')
      .upsert({ kursant_id: user.id, etap_id: etapId, status },
              { onConflict: 'kursant_id,etap_id' })
      .select().single();
    if (error) blad(error, 'Nie udało się zapisać postępu.');
    return data;
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
    const { data, error } = await sb.from('pytanie')
      .insert({ kursant_id: user.id, kurs_id: kursId, etap_id: etapId || null, tresc })
      .select().single();
    if (error) blad(error, 'Nie udało się wysłać pytania.');
    return data;
  }

  /** Instruktor odpowiada. Wyzwalacz w bazie i tak nie pozwoli mu
      zmienić autora, kursu, etapu ani treści pytania. */
  async function odpowiedzNaPytanie(id, odpowiedz) {
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('pytanie')
      .update({ odpowiedz, odpowiedzial_id: user.id, status: 'odpowiedziane' })
      .eq('id', id).select().maybeSingle();
    if (error || !data) throw new Error('Nie możesz odpowiadać na to pytanie.');
    return data;
  }

  async function zamknijPytanie(id) {
    const { error } = await sb.from('pytanie').update({ status: 'zamkniete' }).eq('id', id);
    if (error) blad(error, 'Nie udało się zamknąć pytania.');
  }

  /* ── PLIKI — prywatny bucket, podpisany link na 5 minut ────── */
  async function linkDoMaterialu(materialId) {
    // RLS zwróci wiersz tylko temu, kto ma prawo go widzieć
    const { data: m } = await sb.from('material')
      .select('sciezka, nazwa_pl').eq('id', materialId).maybeSingle();
    if (!m) throw new Error('Nie masz dostępu do tego materiału.');
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(m.sciezka, 300);
    if (error) throw new Error('Nie masz dostępu do tego pliku.');
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
    if (plik.size > LIMIT_B) throw new Error('Plik jest za duży. Limit to 25 MB.');
    const mime = plik.type || 'application/octet-stream';
    if (!DOZWOLONE[typ] || !DOZWOLONE[typ].includes(mime))
      throw new Error(`Ten format (${mime}) nie jest dozwolony dla typu „${typ}".`);

    const rozszerzenie = (plik.name.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0].toLowerCase();
    const czysta = nazwa.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const sciezka = `kurs/${kurs_id}/${typ}/${Date.now()}-${czysta}${rozszerzenie}`;

    const { error: bladPliku } = await sb.storage.from(BUCKET)
      .upload(sciezka, plik, { upsert: false, contentType: mime });
    if (bladPliku) throw new Error('Nie udało się wgrać pliku: ' + bladPliku.message);

    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('material').insert({
      kurs_id, etap_id: etap_id || null, typ, nazwa_pl: nazwa, opis: opis || null,
      sciezka, rozmiar_b: plik.size, mime, opublikowany: false, dodal_id: user.id
    }).select().single();

    if (error || !data) {
      await sb.storage.from(BUCKET).remove([sciezka]);      // sprzątanie
      throw new Error('Plik nie został zapisany: ' + ((error && error.message) || 'brak uprawnień'));
    }
    return data;
  }

  async function publikujMaterial(id, opublikowany) {
    const { data, error } = await sb.from('material')
      .update({ opublikowany }).eq('id', id).select().maybeSingle();
    if (error || !data) throw new Error('Nie masz uprawnień do tego materiału.');
    return data;
  }

  async function usunMaterial(id) {
    const { data: m } = await sb.from('material').select('sciezka').eq('id', id).maybeSingle();
    const { error } = await sb.from('material').delete().eq('id', id);
    if (error) throw new Error('Nie masz uprawnień do tego materiału.');
    if (m) await sb.storage.from(BUCKET).remove([m.sciezka]);
  }

  /* ── KONTA I PRZYPISANIA ───────────────────────────────────── */
  async function konta() {
    const { data, error } = await sb.from('profile')
      .select('id, imie, email, rola, aktywne, utworzone').order('rola').order('imie');
    if (error) blad(error, 'Nie udało się wczytać kont.');
    return data || [];
  }

  async function zmienRole(id, rola) {
    const { data, error } = await sb.from('profile')
      .update({ rola }).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message.includes('jedyny aktywny administrator')
      ? 'To jedyny aktywny administrator — nie można go zdegradować.'
      : 'Tylko administrator zmienia role.');
    return data;
  }

  async function ustawAktywne(id, aktywne) {
    const { data, error } = await sb.from('profile')
      .update({ aktywne }).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message.includes('jedyny aktywny administrator')
      ? 'To jedyny aktywny administrator — nie można go wyłączyć.'
      : 'Tylko administrator włącza i wyłącza konta.');
    return data;
  }

  /** ZAPROSZENIE — jedyne miejsce, które MUSI iść przez serwer.
      Zakładanie konta wymaga klucza service_role, a ten nie może
      znaleźć się w przeglądarce. Wywołujemy Edge Function, która
      trzyma klucz po stronie Supabase i sama sprawdza, czy proszący
      jest administratorem. Kod funkcji: supabase/functions/zapros/ */
  async function zapros({ imie, email, rola, kurs_id }) {
    const { data, error } = await sb.functions.invoke('zapros', {
      body: { imie, email, rola, kurs_id }
    });
    if (error) throw new Error((error.message || '').includes('403')
      ? 'Tylko administrator może zapraszać.'
      : 'Nie udało się wysłać zaproszenia.');
    return data;
  }

  async function kursanci() {
    const { data, error } = await sb.from('przypisanie')
      .select('kursant:kursant_id (id, imie, email), kurs:kurs_id (id, nazwa_pl)')
      .eq('aktywne', true);
    if (error) blad(error, 'Nie udało się wczytać kursantów.');
    return (data || []).map(z => ({
      id: z.kursant.id, imie: z.kursant.imie, email: z.kursant.email,
      kurs: z.kurs.nazwa_pl, kurs_id: z.kurs.id }));
  }

  async function przypisz(kurs_id, kursant_id) {
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('przypisanie')
      .upsert({ kurs_id, kursant_id, przypisal_id: user.id, aktywne: true },
              { onConflict: 'kurs_id,kursant_id' }).select().maybeSingle();
    if (error || !data) throw new Error('Tylko administrator przypisuje kursantów.');
    return data;
  }

  async function odepnij(kurs_id, kursant_id) {
    const { error } = await sb.from('przypisanie').update({ aktywne: false })
      .eq('kurs_id', kurs_id).eq('kursant_id', kursant_id);
    if (error) throw new Error('Tylko administrator odpina kursantów.');
  }

  /* ── SESJA WYGASŁA → z powrotem na logowanie ────────────────── */
  sb.auth.onAuthStateChange(z => {
    if (z === 'SIGNED_OUT' && !/index\.html|nowe-haslo\.html/.test(location.pathname))
      location.href = 'index.html';
  });

  window.DANE_SUPABASE = {
    zaloguj, wyloguj, wyslijLinkResetu, ustawHaslo, przyjmijZaproszenie, ja,
    kursy, kurs, zapiszPostep,
    pytania, zadajPytanie, odpowiedzNaPytanie, zamknijPytanie,
    linkDoMaterialu, wgrajMaterial, publikujMaterial, usunMaterial,
    konta, zmienRole, ustawAktywne, zapros, kursanci, przypisz, odepnij,
  };
})();
