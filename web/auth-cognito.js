/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — sześć funkcji Auth przeciw Cognito (wariant A)  [Etap 2]

   Zwykły skrypt, bez `export`. Dociąga go `warstwa-danych.js` w trybie
   AWS, po bibliotece amazon-cognito-identity-js (UMD → window.AmazonCognitoIdentity).
   Wystawia window.AUTH_COGNITO z sześcioma funkcjami kontraktu:

     zaloguj, wyloguj, ja, wyslijLinkResetu, sesjaZLinku, ustawHaslo

   oraz `token()` — bieżący token DOSTĘPU dla dane-aws.js.

   ZASADA 1 PLANU: przeglądarka rozmawia z Cognito wyłącznie o tożsamości.
   USER_SRP_AUTH przesyła dowód znajomości hasła, nie hasło — to domyślny
   przepływ `authenticateUser` w tej bibliotece. Core nigdy nie widzi hasła.

   Front zna wyłącznie dane publiczne: identyfikator puli i klienta.
   Nie ma tu żadnego sekretu i nie może być.

   PRZEPŁYWY LINKÓW Z POCZTY (wiadomości wysyła Core przez SES — Etap 4):
     reset        …/nowe-haslo.html?typ=reset&email=<e-mail>&kod=<kod z Cognito>
     zaproszenie  …/nowe-haslo.html?typ=zaproszenie&email=<e-mail>
                  konto ma hasło tymczasowe; pierwsze logowanie kończy się
                  wyzwaniem NEW_PASSWORD_REQUIRED, które domyka ustawHaslo()

   STAN: SZKIELET. Lokalnie nie ma jak tego uruchomić — SRP i wyzwania
   istnieją tylko w prawdziwej puli. Dowód: Etap 2 na AWS (A1–A3, A6–A8).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const K = window.KONFIG || {};
  if (!K.COGNITO_POOL_ID || !K.COGNITO_CLIENT_ID) return;      // nie ten tryb

  const SDK = window.AmazonCognitoIdentity;
  const pula = new SDK.CognitoUserPool({ UserPoolId: K.COGNITO_POOL_ID, ClientId: K.COGNITO_CLIENT_ID });

  const uzytkownik = email => new SDK.CognitoUser({ Username: String(email).trim().toLowerCase(), Pool: pula });
  let oczekujaceWyzwanie = null;       // { user, atrybuty } po NEW_PASSWORD_REQUIRED

  const CZYTELNE = {
    NotAuthorizedException:      'Nieprawidłowy adres e-mail lub hasło.',
    UserNotFoundException:       'Nieprawidłowy adres e-mail lub hasło.',
    PasswordResetRequiredException: 'To konto wymaga ustawienia nowego hasła.',
    UserNotConfirmedException:   'To konto nie zostało jeszcze aktywowane.',
    CodeMismatchException:       'Kod z wiadomości jest nieprawidłowy.',
    ExpiredCodeException:        'Kod z wiadomości wygasł. Poproś o nowy.',
    LimitExceededException:      'Za dużo prób. Odczekaj chwilę.',
    InvalidPasswordException:    'Hasło nie spełnia wymagań.',
  };
  // A8: po serii błędnych haseł Cognito odpowiada NotAuthorizedException
  // z treścią „Password attempts exceeded" — pokazujemy to WPROST, a nie
  // jako kolejne „złe hasło", żeby użytkownik wiedział, że ma odczekać.
  function bladNaCzytelny(e) {
    if (e && /Password attempts exceeded/i.test(e.message || ''))
      return new Error('Za dużo nieudanych prób logowania. Odczekaj kilka minut i spróbuj ponownie.');
    return new Error(CZYTELNE[e && e.code] || (e && e.message) || 'Nie udało się wykonać operacji.');
  }

  /** Sesja z pamięci SDK (odświeża token, gdy trzeba). null = niezalogowany. */
  function sesja() {
    return new Promise(ok => {
      const u = pula.getCurrentUser();
      if (!u) return ok(null);
      u.getSession((err, s) => ok(!err && s && s.isValid() ? { u, s } : null));
    });
  }

  async function token() {
    const x = await sesja();
    return x ? x.s.getAccessToken().getJwtToken() : null;
  }

  async function zaloguj(email, haslo) {
    const u = uzytkownik(email);
    const dane = new SDK.AuthenticationDetails({ Username: u.getUsername(), Password: haslo });
    await new Promise((ok, zle) => u.authenticateUser(dane, {
      onSuccess: ok,
      onFailure: e => zle(bladNaCzytelny(e)),
      newPasswordRequired: atrybuty => {
        oczekujaceWyzwanie = { u, atrybuty };
        zle(Object.assign(new Error('Ustaw nowe hasło, żeby dokończyć aktywację konta.'),
                          { kod: 'NOWE_HASLO', email: u.getUsername() }));
      },
    }));
    // profil bierze Core — tu tylko tożsamość
    return window.DANE_AWS ? window.DANE_AWS.ja() : { email: u.getUsername() };
  }

  async function wyloguj() {
    const x = await sesja();
    if (x) x.u.signOut();
    oczekujaceWyzwanie = null;
  }

  async function ja() {
    return (await token()) ? (window.DANE_AWS ? window.DANE_AWS.ja() : {}) : null;
  }

  async function wyslijLinkResetu(email) {
    await new Promise((ok, zle) => uzytkownik(email).forgotPassword({
      onSuccess: ok, onFailure: e => zle(bladNaCzytelny(e)) }));
  }

  /** Co niesie adres strony nowe-haslo.html. */
  async function sesjaZLinku() {
    const p = new URLSearchParams(location.search);
    const typ = p.get('typ');
    if (typ === 'reset' && p.get('email') && p.get('kod'))
      return { jest: true, typ: 'recovery', email: p.get('email'), kod: p.get('kod') };
    if (typ === 'zaproszenie' && p.get('email'))
      return { jest: true, typ: 'invite', email: p.get('email') };
    return { jest: false, typ: null };
  }

  /**
   * Ustawienie hasła — dwie drogi, wybierane po tym, co niesie adres:
   *   reset       potwierdzenie kodem z wiadomości (confirmPassword)
   *   zaproszenie hasło tymczasowe z wiadomości → wyzwanie NEW_PASSWORD_REQUIRED
   *               (`tymczasowe` podaje ekran; bez niego najpierw zaloguj())
   */
  async function ustawHaslo(nowe, tymczasowe) {
    const z = await sesjaZLinku();
    if (z.typ === 'recovery') {
      await new Promise((ok, zle) => uzytkownik(z.email).confirmPassword(z.kod, nowe, {
        onSuccess: ok, onFailure: e => zle(bladNaCzytelny(e)) }));
      return;
    }
    if (!oczekujaceWyzwanie && z.typ === 'invite' && tymczasowe) {
      try { await zaloguj(z.email, tymczasowe); }
      catch (e) { if (e.kod !== 'NOWE_HASLO') throw e; }
    }
    if (!oczekujaceWyzwanie) throw new Error('Brak oczekującego ustawienia hasła. Zaloguj się hasłem tymczasowym.');
    const { u, atrybuty } = oczekujaceWyzwanie;
    delete atrybuty.email_verified; delete atrybuty.email;      // atrybutów tylko do odczytu Cognito nie przyjmie z powrotem
    await new Promise((ok, zle) => u.completeNewPasswordChallenge(nowe, {}, {
      onSuccess: ok, onFailure: e => zle(bladNaCzytelny(e)) }));
    oczekujaceWyzwanie = null;
  }

  window.AUTH_COGNITO = { zaloguj, wyloguj, ja, wyslijLinkResetu, sesjaZLinku, ustawHaslo, token };
})();
