/**
 * AsterA Core — weryfikacja tokenu Cognito                        [Etap 2]
 *
 * Core nie ufa niczemu, co przyszło z przeglądarki, poza poprawnie
 * podpisanym tokenem. Sprawdzamy WSZYSTKO, co plan v2 wymienia:
 *
 *   podpis     RS256 kluczem z JWKS puli (dobranym po `kid`)
 *   iss        dokładnie https://cognito-idp.<region>.amazonaws.com/<pula>
 *   aud        identyfikator klienta aplikacji (token ID: `aud`,
 *              token dostępu: `client_id`)
 *   exp        z małym marginesem na rozjazd zegarów
 *   token_use  'id' albo 'access' — to, którego oczekujemy, nie „jakikolwiek"
 *
 * Tożsamość do RLS to `sub` ZWERYFIKOWANEGO tokenu. Nigdy z ciała żądania.
 *
 * Zero zależności: JWK → KeyObject robi `crypto.createPublicKey`. JWKS
 * jest buforowany; nieznany `kid` wymusza JEDNO odświeżenie (rotacja
 * kluczy), potem odmowę — żeby wadliwy token nie zamienił Core w maszynkę
 * do odpytywania Cognito.
 *
 * Konfiguracja (środowisko):
 *   COGNITO_REGION, COGNITO_POOL_ID, COGNITO_CLIENT_ID
 *   COGNITO_ISSUER, COGNITO_JWKS_URL — nadpisanie (atrapa w testach)
 */
const crypto = require('crypto');

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function zB64url(s)  { return Buffer.from(s, 'base64url'); }

class Weryfikator {
  constructor(opcje = {}) {
    const region = opcje.region   || process.env.COGNITO_REGION   || 'eu-central-1';
    const pula   = opcje.pula     || process.env.COGNITO_POOL_ID;
    this.klient  = opcje.klient   || process.env.COGNITO_CLIENT_ID;
    this.issuer  = opcje.issuer   || process.env.COGNITO_ISSUER
                || (pula ? `https://cognito-idp.${region}.amazonaws.com/${pula}` : null);
    this.jwksUrl = opcje.jwksUrl  || process.env.COGNITO_JWKS_URL
                || (this.issuer ? `${this.issuer}/.well-known/jwks.json` : null);
    this.margines_s = opcje.margines_s ?? 30;
    this.klucze = new Map();          // kid -> KeyObject
    this.ostatniePobranie = 0;
    this.pobierz = opcje.pobierz || (async url => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`JWKS: HTTP ${r.status}`);
      return r.json();
    });
    if (!this.issuer || !this.klient) throw new Error('Brak konfiguracji Cognito (issuer / client id).');
  }

  async odswiezKlucze() {
    const jwks = await this.pobierz(this.jwksUrl);
    const nowe = new Map();
    for (const k of jwks.keys || []) {
      if (k.kty !== 'RSA' || (k.use && k.use !== 'sig')) continue;
      nowe.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
    }
    this.klucze = nowe;
    this.ostatniePobranie = Date.now();
  }

  async klucz(kid) {
    if (!this.klucze.has(kid)) {
      // rotacja kluczy: jedno odświeżenie, nie częściej niż co 60 s
      if (Date.now() - this.ostatniePobranie > 60_000) await this.odswiezKlucze();
    }
    return this.klucze.get(kid) || null;
  }

  /**
   * Zwraca zweryfikowane claims albo rzuca Error z polem `powod`
   * (krótkim, stałym — do logów, nie do użytkownika).
   */
  async zweryfikuj(token, oczekiwaneUzycie = 'id') {
    const odmowa = powod => { const e = new Error('Token odrzucony: ' + powod); e.powod = powod; return e; };
    if (typeof token !== 'string') throw odmowa('brak');
    const czesci = token.split('.');
    if (czesci.length !== 3) throw odmowa('format');

    let naglowek, claims;
    try {
      naglowek = JSON.parse(zB64url(czesci[0]).toString('utf8'));
      claims   = JSON.parse(zB64url(czesci[1]).toString('utf8'));
    } catch { throw odmowa('format'); }

    if (naglowek.alg !== 'RS256') throw odmowa('alg');
    const klucz = await this.klucz(naglowek.kid);
    if (!klucz) throw odmowa('kid');

    const ok = crypto.verify('sha256',
      Buffer.from(czesci[0] + '.' + czesci[1]), klucz, zB64url(czesci[2]));
    if (!ok) throw odmowa('podpis');

    const teraz = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp + this.margines_s < teraz) throw odmowa('exp');
    if (claims.iss !== this.issuer) throw odmowa('iss');
    if (claims.token_use !== oczekiwaneUzycie) throw odmowa('token_use');
    const odbiorca = oczekiwaneUzycie === 'id' ? claims.aud : claims.client_id;
    if (odbiorca !== this.klient) throw odmowa('aud');
    if (typeof claims.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sub)) throw odmowa('sub');

    return claims;
  }
}

module.exports = { Weryfikator, b64url, zB64url };
