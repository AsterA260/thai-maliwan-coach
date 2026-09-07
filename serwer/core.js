#!/usr/bin/env node
/**
 * AsterA Core — API produkcyjne                                    [Etap 2]
 *
 * Jedyna brama do danych Coacha. Ten sam rdzeń handlerów co serwer
 * deweloperski (serwer/api.js), inna skorupa:
 *
 *   tożsamość   z tokenu Cognito w nagłówku `Authorization: Bearer …`,
 *               zweryfikowanego w całości (serwer/cognito-token.js);
 *               `sub` tokenu → set_config('astera.uzytkownik', …, true)
 *   konta       przez dostawcę tożsamości (serwer/tozsamosc.js):
 *               zaproszenie zakłada konto w Cognito i profil w bazie
 *               w JEDNEJ operacji z wycofaniem
 *   baza        własna pula do Aurory jako login `astera_api`
 *               (decyzja Etapu 1b — bez RDS Proxy)
 *   logowanie   NIE MA GO TUTAJ. Przeglądarka rozmawia z Cognito
 *               (USER_SRP_AUTH); Core nigdy nie widzi hasła.
 *
 * Konfiguracja wyłącznie ze środowiska:
 *   DATABASE_URL, PGSSLROOTCERT           baza (narzedzia/aurora-url.sh api)
 *   COGNITO_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID
 *   CORE_ORIGIN                           adres frontu (CORS), np. https://coach.thaimaliwan.pl
 *   SEKRET_LINKOW                         podpis linków do plików
 *   PORT, CORE_HOST                       domyślnie 8920 na 127.0.0.1; za ALB 0.0.0.0
 *
 * Nie ma tu ANI JEDNEJ reguły uprawnień do danych. Baza decyduje.
 */
const crypto = require('crypto');
const { Pool } = require('pg');
const zbudujApi = require('./api');
const { Weryfikator } = require('./cognito-token');
const tozsamoscMod = require('./tozsamosc');

function uruchomCore(opcje = {}) {
  const env = { ...process.env, ...(opcje.env || {}) };
  const PORT   = env.PORT !== undefined ? Number(env.PORT) : 8920;
  const HOST   = env.CORE_HOST || '127.0.0.1';   // za ALB: 0.0.0.0
  const ORIGIN = env.CORE_ORIGIN || null;
  const SEKRET = env.SEKRET_LINKOW || crypto.randomBytes(32).toString('hex');

  const pool = opcje.pool || new Pool({ ...require('../testy/polaczenie').zUrl(env.DATABASE_URL, env.PGSSLROOTCERT), max: Number(env.CORE_PULA || 10) });
  const weryfikator = opcje.weryfikator || new Weryfikator({
    region: env.COGNITO_REGION, pula: env.COGNITO_POOL_ID, klient: env.COGNITO_CLIENT_ID,
    issuer: env.COGNITO_ISSUER, jwksUrl: env.COGNITO_JWKS_URL });
  const tozsamosc = opcje.tozsamosc || tozsamoscMod.zeSrodowiska(env);
  const UZYCIE = env.COGNITO_TOKEN_USE || 'access';

  const api = zbudujApi({
    pool, SEKRET, MAGAZYN: opcje.MAGAZYN,

    // Token jest bezstanowy — nie ma czego unieważniać po naszej stronie.
    // Konto wyłączone odpada na `profil()` przy każdym żądaniu, a Cognito
    // przestaje wydawać nowe tokeny (patrz `wylacz`).
    uniewaznij: null,
    uniewaznijUzytkownika: id => tozsamosc.wylacz(id),
    przywrocUzytkownika:   id => tozsamosc.wlacz(id),

    /** Zaproszenie → konto u dostawcy + profil w bazie, z wycofaniem.
     *  Kolejność: najpierw konto (bo to ono daje `sub`), potem profil
     *  w kontekście administratora. Gdy profil się nie zapisze — konto
     *  znika. Nigdy nie zostaje konto bez profilu. */
    async poZaproszeniu(z, s) {
      const konto = await tozsamosc.utworzKonto({ email: z.email, imie: z.imie });
      try {
        const [p] = await api.zapytaj(s.uid, `
          insert into public.profile (id, email, imie, rola)
          values ($1, $2, $3, $4)
          returning id, email, imie, rola`, [konto.id, z.email, z.imie, z.rola]);
        if (!p) throw new Error('Profil nie został zapisany (polityka odrzuciła zapis).');
        // Hasło tymczasowe idzie WYŁĄCZNIE do wysyłki zaproszenia (Etap 4, SES).
        // Do odpowiedzi HTTP nie trafia nigdy — zwracamy sam identyfikator i rolę.
        if (opcje.wyslijZaproszenie)
          await opcje.wyslijZaproszenie({ email: z.email, imie: z.imie, haslo_tymczasowe: konto.haslo_tymczasowe });
        return { id: p.id, rola: p.rola };
      } catch (e) {
        await tozsamosc.usunKonto(konto.id).catch(() => {});
        throw e;
      }
    },
  });

  // W Core nie ma logowania hasłem. Gdyby ktoś dopisał je do rdzenia,
  // tu zostanie odcięte — to jest granica wariantu A.
  delete api.API['POST /api/logowanie'];
  delete api.API['POST /api/wylogowanie'];

  /** Sesja z nagłówka. Brak/zły token → null → każdy handler odpowiada 401. */
  async function sesjaZ(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    try {
      const claims = await weryfikator.zweryfikuj(m[1].trim(), UZYCIE);
      return { uid: claims.sub, token: null, claims };
    } catch (e) {
      // powód idzie do logu, nie do klienta — klient dostaje tylko 401
      if (env.CORE_LOG_ODMOW) console.log('[core] token odrzucony:', e.powod || e.message);
      return null;
    }
  }

  const wewnetrzny = api.zbudujSerwer(sesjaZ);
  const obsluga = wewnetrzny.listeners('request')[0];
  wewnetrzny.removeAllListeners('request');

  // CORS: front stoi pod innym adresem niż Core. Dozwolony jest JEDEN
  // origin, podany jawnie — nie „*", bo żądania niosą token.
  wewnetrzny.on('request', (req, res) => {
    if (ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', ORIGIN);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    return obsluga(req, res);
  });

  return {
    serwer: wewnetrzny, api, tozsamosc, weryfikator, pool,
    start: () => new Promise(ok => wewnetrzny.listen(PORT, HOST, () => ok(wewnetrzny.address().port))),
    stop:  async () => { await new Promise(ok => wewnetrzny.close(ok)); if (!opcje.pool) await pool.end(); },
  };
}

if (require.main === module) {
  uruchomCore().start().then(port => console.log(`AsterA Core → http://127.0.0.1:${port}`));
}

module.exports = { uruchomCore };
