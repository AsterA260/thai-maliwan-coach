/**
 * ATRAPA COGNITO — tylko do testów lokalnych                       [Etap 2]
 *
 * Nie udaje Cognito. Robi dokładnie dwie rzeczy, których Core potrzebuje,
 * żeby jego ścieżka weryfikacji była TĄ SAMĄ ścieżką co na produkcji:
 *
 *   1. serwuje JWKS pod /.well-known/jwks.json (para RSA z pamięci),
 *   2. wydaje tokeny RS256 o kształcie tokenów Cognito — poprawne
 *      i celowo zepsute (wygasłe, zły odbiorca, zły wystawca, obcy klucz,
 *      zły token_use), żeby testy odmowy miały co odrzucać.
 *
 * Różni się od prawdziwego Cognito WYŁĄCZNIE kluczem prywatnym.
 * SRP, hasła, blokada po błędnych próbach — tego tu nie ma i nie będzie:
 * to sprawdza się przeciw prawdziwej puli (A8 w Etapie 2 na AWS).
 */
const http   = require('http');
const crypto = require('crypto');
const { b64url } = require('../serwer/cognito-token');

class AtrapaCognito {
  constructor({ region = 'eu-central-1', pula = 'eu-central-1_ATRAPA', klient = 'atrapa-klient-id' } = {}) {
    this.pula = pula; this.klient = klient;
    this.issuer = `https://cognito-idp.${region}.amazonaws.com/${pula}`;
    this.kid = 'atrapa-' + crypto.randomBytes(4).toString('hex');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.prywatny = privateKey;
    this.jwk = { ...publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig', alg: 'RS256' };
    // drugi, OBCY klucz — do testu „podpis nie z tej puli"
    this.obcy = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }

  /** Token jak z Cognito. `zmiany` nadpisują claims; `opcje.klucz` = 'obcy' podpisuje cudzym kluczem. */
  token(sub, { uzycie = 'id', zmiany = {}, klucz = 'wlasny', kid } = {}) {
    const teraz = Math.floor(Date.now() / 1000);
    const claims = uzycie === 'id'
      ? { sub, iss: this.issuer, aud: this.klient, token_use: 'id',
          exp: teraz + 3600, iat: teraz, 'cognito:username': sub, email_verified: true, ...zmiany }
      : { sub, iss: this.issuer, client_id: this.klient, token_use: 'access',
          exp: teraz + 3600, iat: teraz, scope: 'aws.cognito.signin.user.admin', ...zmiany };
    const naglowek = { alg: 'RS256', kid: kid || this.kid };
    const tresc = b64url(JSON.stringify(naglowek)) + '.' + b64url(JSON.stringify(claims));
    const podpis = crypto.sign('sha256', Buffer.from(tresc), klucz === 'obcy' ? this.obcy : this.prywatny);
    return tresc + '.' + b64url(podpis);
  }

  /** Serwer JWKS na losowym porcie. Zwraca adres. */
  async uruchom() {
    this.serwer = http.createServer((req, res) => {
      this.pobran = (this.pobran || 0) + 1;
      if (req.url === '/.well-known/jwks.json')
        return res.writeHead(200, { 'Content-Type': 'application/json' })
                  .end(JSON.stringify({ keys: [this.jwk] }));
      res.writeHead(404).end();
    });
    await new Promise(ok => this.serwer.listen(0, '127.0.0.1', ok));
    this.jwksUrl = `http://127.0.0.1:${this.serwer.address().port}/.well-known/jwks.json`;
    return this.jwksUrl;
  }
  zatrzymaj() { this.serwer && this.serwer.close(); }

  /** Zmienne środowiskowe, jakimi Core ma się skonfigurować na tę atrapę. */
  srodowisko() {
    return { COGNITO_ISSUER: this.issuer, COGNITO_CLIENT_ID: this.klient, COGNITO_JWKS_URL: this.jwksUrl };
  }
}

module.exports = { AtrapaCognito };
