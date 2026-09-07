#!/usr/bin/env node
/**
 * .env  →  web/konfig.js
 *
 * Jedyny krok, który dzieli wersję lokalną od produkcyjnej. Nie ma
 * podmieniania kodu, nie ma odkomentowywania — jest jeden generowany
 * plik konfiguracyjny.
 *
 *     npm run konfig
 *
 * KLUCZE. Supabase wygasza klucze `anon` i `service_role` do końca
 * 2026 roku; nowe projekty dostają `sb_publishable_…` (przeglądarka)
 * i `sb_secret_…` (wyłącznie serwer). Ten skrypt woli nowy klucz
 * publiczny, a stary `anon` przyjmuje jako awaryjny i mówi o tym wprost.
 *
 * CO NIE TRAFIA DO FRONTU. Klucz sekretny (`sb_secret_…` albo stary
 * `service_role`) omija RLS. Jest w .env tylko dla narzędzi po stronie
 * serwera. Skrypt go **pomija**, mówi o tym ostrzeżeniem, a na koniec
 * sprawdza wygenerowany plik i **kończy się błędem**, gdyby ten klucz
 * mimo wszystko się w nim znalazł.
 */
const fs   = require('fs');
const path = require('path');

const KATALOG = path.join(__dirname, '..');
const ENV     = path.join(KATALOG, '.env');
const WYJSCIE = path.join(KATALOG, 'web', 'konfig.js');

const DOZWOLONE = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY',
                   'SUPABASE_BUCKET', 'ADRES_APLIKACJI',
                   // tryb AWS (Etap 2) — wyłącznie dane publiczne
                   'CORE_URL', 'COGNITO_POOL_ID', 'COGNITO_CLIENT_ID'];
const SEKRETNE  = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
                   // AWS: nic z tego nie ma prawa trafić do przeglądarki
                   'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
                   'DATABASE_URL', 'COGNITO_CLIENT_SECRET', 'SEKRET_LINKOW'];

function wczytaj(plik) {
  if (!fs.existsSync(plik)) {
    console.error(`Nie ma pliku ${plik}. Skopiuj .env.example do .env i uzupełnij.`);
    process.exit(1);
  }
  const w = {};
  for (const linia of fs.readFileSync(plik, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(linia);
    if (m) w[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return w;
}

const env = wczytaj(ENV);

const znalezioneSekrety = SEKRETNE.filter(k => env[k]);
if (znalezioneSekrety.length)
  console.warn(`UWAGA: ${znalezioneSekrety.join(' i ')} ${znalezioneSekrety.length > 1 ? 'są' : 'jest'} ` +
               'w .env i ZOSTANIE POMINIĘTY — klucz sekretny omija RLS i nie może\n' +
               '       trafić do przeglądarki. Na produkcji podaje go sama platforma\n' +
               '       Edge Function; nie ustawia się go ręcznie.');

const dane = {};
for (const k of DOZWOLONE) dane[k] = env[k] || '';
if (!dane.SUPABASE_BUCKET) dane.SUPABASE_BUCKET = 'materialy';

if (dane.SUPABASE_URL && !dane.SUPABASE_PUBLISHABLE_KEY && dane.SUPABASE_ANON_KEY)
  console.warn('UWAGA: używasz starego klucza `anon`. Supabase wygasza go do końca 2026 —\n' +
               '       w panelu API Keys wygeneruj `sb_publishable_…` i wpisz go\n' +
               '       jako SUPABASE_PUBLISHABLE_KEY.');
if (dane.CORE_URL && !(dane.COGNITO_POOL_ID && dane.COGNITO_CLIENT_ID)) {
  console.error('BŁĄD: podano CORE_URL, ale brak COGNITO_POOL_ID albo COGNITO_CLIENT_ID.');
  process.exit(1);
}
if (dane.SUPABASE_URL && !dane.SUPABASE_PUBLISHABLE_KEY && !dane.SUPABASE_ANON_KEY) {
  console.error('BŁĄD: podano SUPABASE_URL, ale żadnego klucza publicznego.');
  process.exit(1);
}

const tresc = `/* PLIK GENEROWANY PRZEZ \`npm run konfig\` — nie edytuj ręcznie. */
window.KONFIG = ${JSON.stringify(dane, null, 2)};
`;

// Ostatnia zapora: czy w gotowym pliku nie ma klucza sekretnego.
for (const k of znalezioneSekrety) {
  if (env[k] && env[k].length > 12 && tresc.includes(env[k])) {
    console.error(`BŁĄD: ${k} znalazł się w pliku frontu. Przerywam, nic nie zapisuję.`);
    process.exit(1);
  }
}
if (/sb_secret_|service_role|AKIA[0-9A-Z]{16}|postgresql:\/\//.test(tresc)) {
  console.error('BŁĄD: w konfiguracji frontu jest coś, co wygląda na klucz sekretny. Przerywam.');
  process.exit(1);
}

fs.writeFileSync(WYJSCIE, tresc);
console.log(`Zapisano ${WYJSCIE}`);
console.log(dane.SUPABASE_URL ? 'Tryb: PRODUKCJA (Supabase)' : 'Tryb: LOKALNY (serwer dev /api/*)');
