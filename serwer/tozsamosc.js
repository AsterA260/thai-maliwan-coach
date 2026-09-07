/**
 * AsterA Core — dostawca tożsamości                               [Etap 2]
 *
 * Core wykonuje na kontach dokładnie cztery operacje i tylko przez ten
 * interfejs — reszta (logowanie, hasła, reset) dzieje się między
 * przeglądarką a Cognito, bez udziału Core (wariant A, USER_SRP_AUTH).
 *
 *   utworzKonto({ email, imie })  → { id, haslo_tymczasowe }
 *                                              zaproszenie: konto z hasłem
 *                                              tymczasowym, które wysyła Core
 *                                              we WŁASNEJ wiadomości (Etap 4,
 *                                              SES). Cognito z MessageAction=
 *                                              SUPPRESS nie wysyła nic — więc
 *                                              hasło musimy wygenerować sami,
 *                                              inaczej nikt by go nie poznał.
 *                                              Nigdy do odpowiedzi HTTP, nigdy
 *                                              do logu, nigdy do bazy.
 *   usunKonto(id)                              wycofanie po nieudanym zapisie
 *                                              profilu — konto nie może
 *                                              zostać sierotą bez profilu
 *   wylacz(id)                                 admin wyłączył konto: Cognito
 *                                              blokuje logowanie i unieważnia
 *                                              wydane tokeny odświeżania
 *   wlacz(id)                                  admin włączył z powrotem
 *
 * Dwa wcielenia:
 *   Cognito — prawdziwa pula (AWS SDK v3); poświadczenia z roli IAM
 *             instancji/Lambdy, NIGDY z pliku w repozytorium
 *   Atrapa  — pamięć procesu; do testów Core bez AWS
 */
const crypto = require('crypto');

/** Hasło tymczasowe zgodne z polityką puli (≥10 znaków, wielkie, małe, cyfry).
 *  Bez znaków, które mylą się w wiadomości (0/O, 1/l/I). */
function hasloTymczasowe() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghjkmnpqrstuvwxyz', c = '23456789';
  const z = s => s[crypto.randomInt(s.length)];
  const p = [z(A), z(A), z(a), z(a), z(a), z(c), z(c), z(A + a + c), z(A + a + c), z(A + a + c), z(a), z(c)];
  for (let i = p.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  return p.join('');
}

class TozsamoscAtrapa {
  constructor() { this.konta = new Map(); this.dziennik = []; }
  async utworzKonto({ email, imie }) {
    if ([...this.konta.values()].some(k => k.email === email))
      throw Object.assign(new Error('UsernameExistsException'), { name: 'UsernameExistsException' });
    const id = crypto.randomUUID();
    this.konta.set(id, { id, email, imie, aktywne: true });
    this.dziennik.push(['utworz', id]);
    return { id, haslo_tymczasowe: hasloTymczasowe() };
  }
  async usunKonto(id) { this.konta.delete(id); this.dziennik.push(['usun', id]); }
  async wylacz(id)    { const k = this.konta.get(id); if (k) k.aktywne = false; this.dziennik.push(['wylacz', id]); }
  async wlacz(id)     { const k = this.konta.get(id); if (k) k.aktywne = true;  this.dziennik.push(['wlacz', id]); }
}

class TozsamoscCognito {
  constructor({ region, pula }) {
    // Zależność ładowana leniwie: dev i testy lokalne nie potrzebują SDK.
    const sdk = require('@aws-sdk/client-cognito-identity-provider');
    this.sdk = sdk;
    this.klient = new sdk.CognitoIdentityProviderClient({ region });
    this.pula = pula;
  }
  async utworzKonto({ email, imie }) {
    const { sdk } = this;
    const haslo_tymczasowe = hasloTymczasowe();
    const r = await this.klient.send(new sdk.AdminCreateUserCommand({
      UserPoolId: this.pula,
      Username: email,
      TemporaryPassword: haslo_tymczasowe,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: imie },
      ],
      // Wiadomość z zaproszeniem wysyła Core przez SES (Etap 4), nie Cognito —
      // treść, język i nadawca mają być nasze.
      MessageAction: 'SUPPRESS',
      DesiredDeliveryMediums: ['EMAIL'],
    }));
    const sub = (r.User.Attributes || []).find(a => a.Name === 'sub')?.Value;
    if (!sub) throw new Error('Cognito nie zwróciło sub.');
    return { id: sub, nazwa: r.User.Username, haslo_tymczasowe };
  }
  async usunKonto(id) {
    await this.klient.send(new this.sdk.AdminDeleteUserCommand({ UserPoolId: this.pula, Username: id }));
  }
  async wylacz(id) {
    await this.klient.send(new this.sdk.AdminDisableUserCommand({ UserPoolId: this.pula, Username: id }));
    await this.klient.send(new this.sdk.AdminUserGlobalSignOutCommand({ UserPoolId: this.pula, Username: id }));
  }
  async wlacz(id) {
    await this.klient.send(new this.sdk.AdminEnableUserCommand({ UserPoolId: this.pula, Username: id }));
  }
}

/** Wybór wcielenia ze środowiska. */
function zeSrodowiska(env = process.env) {
  if (env.CORE_TOZSAMOSC === 'atrapa') return new TozsamoscAtrapa();
  if (env.COGNITO_POOL_ID) return new TozsamoscCognito({
    region: env.COGNITO_REGION || 'eu-central-1', pula: env.COGNITO_POOL_ID });
  throw new Error('Brak COGNITO_POOL_ID (albo CORE_TOZSAMOSC=atrapa do testów).');
}

module.exports = { TozsamoscAtrapa, TozsamoscCognito, zeSrodowiska, hasloTymczasowe };
