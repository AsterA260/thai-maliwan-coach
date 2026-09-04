/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — warstwa danych na produkcji (Supabase)

   Ten plik zastępuje wywołania /api/* z serwera deweloperskiego.
   Interfejs jest identyczny, więc app.html nie wymaga przeróbek —
   podmienia się tylko funkcję `api`.

   Wpiąć tak (zamiast obecnej funkcji api w app.html):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
     <script src="dane-supabase.js"></script>

   ŻADNYCH KLUCZY W TYM PLIKU. Adres i klucz anon wstrzykuje się
   przy budowaniu z .env — klucz anon jest publiczny z założenia
   i sam z siebie nic nie otwiera, bo o wszystkim decyduje RLS.
   ═══════════════════════════════════════════════════════════════════ */

const sb = window.supabase.createClient(
  window.KONFIG.SUPABASE_URL,
  window.KONFIG.SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

/* ── LOGOWANIE ──────────────────────────────────────────────────── */
export async function zaloguj(email, haslo) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: haslo });
  if (error) throw new Error('Nieprawidłowy adres e-mail lub hasło.');
  return data.user;
}

export async function wyloguj() {
  await sb.auth.signOut();                 // kasuje token po stronie klienta
  location.href = 'index.html';            // i sesję w Supabase
}

export async function ustawNoweHaslo(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.KONFIG.ADRES_APLIKACJI + '/nowe-haslo.html'
  });
  if (error) throw new Error('Nie udało się wysłać wiadomości.');
}

/* ── KTO JESTEM ─────────────────────────────────────────────────── */
export async function ja() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  // RLS przepuści tylko własny profil (albo więcej, jeśli admin)
  const { data } = await sb.from('profile')
    .select('id, imie, email, rola, jezyk, aktywne').eq('id', user.id).single();
  if (!data || data.aktywne === false) { await sb.auth.signOut(); return null; }
  return data;
}

/* ── DANE ───────────────────────────────────────────────────────────
   Uwaga: nigdzie nie ma tu warunku „jeśli rola == kursant, to…".
   Zapytania są takie same dla wszystkich — przycina je RLS w bazie.  */

export async function kursy() {
  const { data } = await sb.from('kurs')
    .select('*, instruktor:profile!kurs_instruktor_id_fkey(imie)').order('dni');
  return data || [];
}

export async function kurs(kursId) {
  const [lekcje, etapy, materialy, postepy] = await Promise.all([
    sb.from('lekcja').select('*').eq('kurs_id', kursId).order('kolejnosc'),
    sb.from('etap').select('*, lekcja!inner(kurs_id)')
      .eq('lekcja.kurs_id', kursId).order('kolejnosc'),
    sb.from('material').select('*').eq('kurs_id', kursId).order('nazwa_pl'),
    sb.from('postep').select('*, etap!inner(lekcja!inner(kurs_id))')
      .eq('etap.lekcja.kurs_id', kursId),
  ]);
  return { lekcje: lekcje.data || [], etapy: etapy.data || [],
           materialy: materialy.data || [], postepy: postepy.data || [] };
}

export async function zapiszPostep(etapId, status) {
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from('postep')
    .upsert({ kursant_id: user.id, etap_id: etapId, status, zmienione: new Date() },
            { onConflict: 'kursant_id,etap_id' })
    .select().single();
  if (error) throw new Error('Nie udało się zapisać postępu.');
  return data;
}

export async function zadajPytanie(kursId, etapId, tresc) {
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from('pytanie')
    .insert({ kursant_id: user.id, kurs_id: kursId, etap_id: etapId, tresc })
    .select().single();
  if (error) throw new Error('Nie udało się wysłać pytania.');
  return data;
}

/* ── PLIKI — prywatny bucket, podpisany link na 5 minut ─────────── */
export async function linkDoMaterialu(sciezka) {
  const { data, error } = await sb.storage
    .from(window.KONFIG.SUPABASE_BUCKET).createSignedUrl(sciezka, 300);
  if (error) throw new Error('Nie masz dostępu do tego pliku.');
  return data.signedUrl;
}

export async function wgrajMaterial(kursId, typ, plik) {
  // Ścieżka MUSI zaczynać się od kurs/<kurs_id>/ — na tym opiera się polityka Storage
  const nazwa = plik.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  const sciezka = `kurs/${kursId}/${typ}/${Date.now()}-${nazwa}`;
  const { error } = await sb.storage
    .from(window.KONFIG.SUPABASE_BUCKET).upload(sciezka, plik, { upsert: false });
  if (error) throw new Error('Nie udało się wgrać pliku.');
  return sciezka;
}

/* ── SESJA WYGASŁA → z powrotem na logowanie ────────────────────── */
sb.auth.onAuthStateChange((zdarzenie) => {
  if (zdarzenie === 'SIGNED_OUT' && !location.pathname.endsWith('index.html'))
    location.href = 'index.html';
});
