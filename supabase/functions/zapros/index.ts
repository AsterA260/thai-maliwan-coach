// ═══════════════════════════════════════════════════════════════════
//  Edge Function „zapros" — jedyne miejsce z kluczem service_role
//
//  Zakładanie konta wymaga uprawnień, które omijają RLS. Taki klucz
//  nie może trafić do przeglądarki, więc operacja idzie przez tę
//  funkcję. Działa na serwerach Supabase; front wywołuje ją tokenem
//  zalogowanego użytkownika, a funkcja sama sprawdza, czy proszący
//  naprawdę jest administratorem.
//
//  Wdrożenie:
//     supabase functions deploy zapros
//     supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
//  (klucz zostaje po stronie Supabase i nigdy nie schodzi do klienta)
// ═══════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL_BAZY   = Deno.env.get('SUPABASE_URL')!;
const KLUCZ_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const KLUCZ_SERW = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADRES_APP  = Deno.env.get('ADRES_APLIKACJI') ?? '';

const ROLE = ['kursant', 'instruktor', 'admin'];

function odp(kod: number, dane: unknown) {
  return new Response(JSON.stringify(dane), {
    status: kod, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return odp(405, { blad: 'Zła metoda.' });

  // 1. Kto pyta — token zalogowanego użytkownika z nagłówka
  const naglowek = req.headers.get('Authorization') ?? '';
  if (!naglowek.startsWith('Bearer ')) return odp(401, { blad: 'Nie jesteś zalogowany.' });

  const jakoUzytkownik = createClient(URL_BAZY, KLUCZ_ANON, {
    global: { headers: { Authorization: naglowek } },
  });
  const { data: { user } } = await jakoUzytkownik.auth.getUser();
  if (!user) return odp(401, { blad: 'Nie jesteś zalogowany.' });

  // 2. Czy to na pewno aktywny administrator — pytamy bazę, nie klienta
  const { data: profil } = await jakoUzytkownik
    .from('profile').select('rola, aktywne').eq('id', user.id).maybeSingle();
  if (!profil || profil.rola !== 'admin' || profil.aktywne !== true)
    return odp(403, { blad: 'Tylko administrator może zapraszać.' });

  // 3. Dane zaproszenia
  const { imie, email, rola, kurs_id } = await req.json().catch(() => ({}));
  const adres = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(adres)) return odp(400, { blad: 'Podaj poprawny adres e-mail.' });
  if (String(imie ?? '').trim().length < 2)          return odp(400, { blad: 'Podaj imię.' });
  if (!ROLE.includes(rola))                          return odp(400, { blad: 'Nieznana rola.' });

  // 4. Zaproszenie — TU i tylko tu używamy klucza serwisowego
  const jakoSerwis = createClient(URL_BAZY, KLUCZ_SERW, { auth: { persistSession: false } });
  const { data: nowy, error } = await jakoSerwis.auth.admin.inviteUserByEmail(adres, {
    data: { imie: String(imie).trim() },
    redirectTo: ADRES_APP ? ADRES_APP + '/nowe-haslo.html' : undefined,
  });
  if (error) {
    const zajete = (error.message || '').toLowerCase().includes('already');
    return odp(zajete ? 409 : 400,
      { blad: zajete ? 'Konto z tym adresem już istnieje.' : 'Nie udało się wysłać zaproszenia.' });
  }

  // 5. Rola i przypisanie — wyzwalacz założył profil z rolą 'kursant'
  if (rola !== 'kursant')
    await jakoSerwis.from('profile').update({ rola }).eq('id', nowy.user!.id);
  if (kurs_id)
    await jakoSerwis.from('przypisanie')
      .upsert({ kurs_id, kursant_id: nowy.user!.id, przypisal_id: user.id, aktywne: true },
              { onConflict: 'kurs_id,kursant_id' });

  return odp(200, {
    zaproszenie: { id: nowy.user!.id, email: adres, imie: String(imie).trim(), rola },
    uwaga: 'Supabase wysłał wiadomość z linkiem do ustawienia hasła.',
  });
});
