// ═══════════════════════════════════════════════════════════════════
//  Edge Function „zapros" — jedyne miejsce z kluczem service_role
//
//  Zakładanie konta wymaga uprawnień, które omijają RLS. Taki klucz
//  nie może trafić do przeglądarki, więc operacja idzie przez tę
//  funkcję. Działa na serwerach Supabase; front wywołuje ją tokenem
//  zalogowanego użytkownika, a funkcja sama sprawdza, czy proszący
//  naprawdę jest administratorem.
//
//  CORS: funkcja wołana z przeglądarki musi obsłużyć zapytanie
//  wstępne OPTIONS i dokładać nagłówki CORS do KAŻDEJ odpowiedzi —
//  także do błędów. Inaczej przeglądarka nie pokaże nawet komunikatu.
//  https://supabase.com/docs/guides/functions/cors
//
//  BRAK POŁOWICZNYCH KONT: jeśli po założeniu konta nie uda się
//  ustawić roli albo przypisać kursu, konto jest kasowane i funkcja
//  zwraca błąd. Nigdy nie odsyłamy sukcesu dla konta, które powstało
//  tylko częściowo.
//
//  Wdrożenie:
//     supabase functions deploy zapros
//     supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... \
//                          ADRES_APLIKACJI=https://coach.thaimaliwan.pl
//  (klucz zostaje po stronie Supabase i nigdy nie schodzi do klienta)
// ═══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL_BAZY   = Deno.env.get('SUPABASE_URL')!;
const KLUCZ_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const KLUCZ_SERW = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADRES_APP  = (Deno.env.get('ADRES_APLIKACJI') ?? '').replace(/\/+$/, '');

const ROLE = ['kursant', 'instruktor', 'admin'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gdy znamy adres aplikacji, wpuszczamy tylko jego. Bez niego '*' —
// i tak każde żądanie musi przynieść ważny token zalogowanego admina.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  ADRES_APP || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age':       '86400',
  'Vary':                         'Origin',
};

function odp(kod: number, dane: unknown) {
  return new Response(JSON.stringify(dane), {
    status: kod,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req) => {
  // 1. Zapytanie wstępne przeglądarki
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return odp(405, { blad: 'Zła metoda.' });

  // 2. Kto pyta — token zalogowanego użytkownika z nagłówka
  const naglowek = req.headers.get('Authorization') ?? '';
  if (!naglowek.startsWith('Bearer ')) return odp(401, { blad: 'Nie jesteś zalogowany.' });

  const jakoUzytkownik = createClient(URL_BAZY, KLUCZ_ANON, {
    global: { headers: { Authorization: naglowek } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: bladUzytkownika } = await jakoUzytkownik.auth.getUser();
  if (bladUzytkownika || !user) return odp(401, { blad: 'Nie jesteś zalogowany.' });

  // 3. Czy to na pewno aktywny administrator — pytamy bazę, nie klienta
  const { data: profil, error: bladProfilu } = await jakoUzytkownik
    .from('profile').select('rola, aktywne').eq('id', user.id).maybeSingle();
  if (bladProfilu) return odp(500, { blad: 'Nie udało się sprawdzić uprawnień.' });
  if (!profil || profil.rola !== 'admin' || profil.aktywne !== true)
    return odp(403, { blad: 'Tylko administrator może zapraszać.' });

  // 4. Dane zaproszenia
  const { imie, email, rola, kurs_id } = await req.json().catch(() => ({}));
  const adres = String(email ?? '').trim().toLowerCase();
  const imieCzyste = String(imie ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(adres)) return odp(400, { blad: 'Podaj poprawny adres e-mail.' });
  if (imieCzyste.length < 2)                         return odp(400, { blad: 'Podaj imię.' });
  if (!ROLE.includes(rola))                          return odp(400, { blad: 'Nieznana rola.' });
  if (kurs_id && !UUID.test(String(kurs_id)))        return odp(400, { blad: 'Nieprawidłowy kurs.' });

  // 5. Zaproszenie — TU i tylko tu używamy klucza serwisowego
  const jakoSerwis = createClient(URL_BAZY, KLUCZ_SERW, { auth: { persistSession: false } });
  const { data: nowy, error } = await jakoSerwis.auth.admin.inviteUserByEmail(adres, {
    data: { imie: imieCzyste },
    redirectTo: ADRES_APP ? ADRES_APP + '/nowe-haslo.html' : undefined,
  });
  if (error || !nowy?.user) {
    const zajete = (error?.message || '').toLowerCase().includes('already');
    return odp(zajete ? 409 : 400,
      { blad: zajete ? 'Konto z tym adresem już istnieje.' : 'Nie udało się wysłać zaproszenia.' });
  }
  const idNowego = nowy.user.id;

  /** Konto powstało, ale dalszy krok padł. Kasujemy je, żeby nie
      zostało konto bez roli albo bez kursu — i mówimy o tym wprost. */
  async function wycofaj(coPadlo: string) {
    const { error: bladKasowania } = await jakoSerwis.auth.admin.deleteUser(idNowego);
    if (bladKasowania)
      return odp(500, {
        blad: `${coPadlo} Konta nie udało się też wycofać — usuń ręcznie ${adres} ` +
              `w panelu Authentication → Users.`,
        stan: 'czesciowe', id: idNowego, email: adres,
      });
    return odp(500, { blad: `${coPadlo} Zaproszenie zostało wycofane — spróbuj jeszcze raz.`,
                      stan: 'wycofane' });
  }

  // 6. Rola — wyzwalacz założył profil z rolą 'kursant'
  if (rola !== 'kursant') {
    const { data: poZmianie, error: bladRoli } = await jakoSerwis
      .from('profile').update({ rola }).eq('id', idNowego).select('rola');
    if (bladRoli || !poZmianie?.length || poZmianie[0].rola !== rola)
      return await wycofaj('Konto powstało, ale nie udało się nadać roli.');
  }

  // 7. Przypisanie do kursu
  if (kurs_id) {
    const { data: poPrzypisaniu, error: bladPrzypisania } = await jakoSerwis
      .from('przypisanie')
      .upsert({ kurs_id, kursant_id: idNowego, przypisal_id: user.id, aktywne: true },
              { onConflict: 'kurs_id,kursant_id' })
      .select('id');
    if (bladPrzypisania || !poPrzypisaniu?.length)
      return await wycofaj('Konto powstało, ale nie udało się przypisać kursu.');
  }

  return odp(200, {
    zaproszenie: { id: idNowego, email: adres, imie: imieCzyste, rola, kurs_id: kurs_id || null },
    uwaga: 'Supabase wysłał wiadomość z linkiem do ustawienia hasła. Link jest ważny 24 godziny.',
  });
});
