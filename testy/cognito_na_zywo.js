#!/usr/bin/env node
/**
 * AsterA Coach — COGNITO NA ŻYWO: logowanie SRP, blokada, Core z prawdziwym JWKS
 *                                                                   [Etap 2]
 * Tego nie dało się udowodnić lokalnie. Tu biegnie przeciw PRAWDZIWEJ puli:
 *
 *   A1  poprawne hasło → tokeny (USER_SRP_AUTH — hasło nie opuszcza klienta)
 *   A2  złe hasło → odmowa
 *   A3  nieistniejące konto → TA SAMA odmowa co złe hasło (nie zdradzamy, kto ma konto)
 *   A6  wylogowanie globalne → token odświeżania przestaje działać
 *   A7  konto wyłączone → nie zaloguje się; włączone → znów tak
 *   A8  seria błędnych haseł → „Password attempts exceeded", nie kolejne „złe hasło"
 *   Z   zaproszenie przez Core: konto w Cognito + profil; hasło tymczasowe →
 *       wyzwanie NEW_PASSWORD_REQUIRED → nowe hasło → tokeny
 *   C   Core z PRAWDZIWYM JWKS: token dostępu → /api/ja → profil; RLS przez Core
 *
 * Środowisko: COGNITO_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION,
 *             DATABASE_URL (właściciel — bootstrap admina), DATABASE_URL_API,
 *             PGSSLROOTCERT. Poświadczenia AWS z roli instancji.
 *
 * Konta testowe mają adresy @przyklad.pl i są kasowane na końcu.
 * Hasła testowe generuje ten skrypt losowo i NIE wypisuje ich.
 */
const crypto = require('crypto');
const fs = require('fs');
const { Client } = require('pg');
const SDK = require('amazon-cognito-identity-js');
const { CognitoIdentityProviderClient, AdminSetUserPasswordCommand, AdminDeleteUserCommand,
        AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { uruchomCore } = require('../serwer/core');
const { hasloTymczasowe } = require('../serwer/tozsamosc');

const REGION = process.env.COGNITO_REGION || 'eu-central-1';
const PULA   = process.env.COGNITO_POOL_ID, KLIENT = process.env.COGNITO_CLIENT_ID;
const pula   = new SDK.CognitoUserPool({ UserPoolId: PULA, ClientId: KLIENT });
const admin  = new CognitoIdentityProviderClient({ region: REGION });

const CA  = process.env.PGSSLROOTCERT;
const ssl = CA ? { ca: fs.readFileSync(CA, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
const bez = u => { const x = new URL(u); x.searchParams.delete('sslmode'); return x.toString(); };

let wyniki = [];
function sprawdz(nr, opis, ok, szczegol) {
  wyniki.push(!!ok);
  console.log(`${ok ? '  ZDANY ' : '  BŁĄD  '} ${String(nr).padStart(3)}. ${opis}`);
  if (szczegol) console.log(`           ${szczegol}`);
}
const uzytk = email => new SDK.CognitoUser({ Username: email, Pool: pula });

/** Logowanie SRP. Zwraca { ok, sesja } albo { ok:false, kod, msg } albo { wyzwanie:'NOWE_HASLO', user, atr }. */
function zaloguj(email, haslo) {
  const u = uzytk(email);
  return new Promise(ok => u.authenticateUser(
    new SDK.AuthenticationDetails({ Username: email, Password: haslo }), {
      onSuccess: s => ok({ ok: true, sesja: s, user: u }),
      onFailure: e => ok({ ok: false, kod: e.code || e.name, msg: e.message }),
      newPasswordRequired: atr => ok({ wyzwanie: 'NOWE_HASLO', user: u, atr }),
    }));
}

(async () => {
  console.log('\n═══ COGNITO NA ŻYWO — pula ' + PULA + ' ═══');
  const owner = new Client({ connectionString: bez(process.env.DATABASE_URL), ssl }); await owner.connect();
  const HASLO = 'Tst-' + hasloTymczasowe();   // spełnia politykę; nie wypisujemy
  const emailA = `test.a.${Date.now()}@przyklad.pl`;
  const sprzatanie = [];

  /* ── bootstrap: administrator testowy w Cognito + profil (rola astera_seed) ── */
  const core0 = uruchomCore({ env: { PORT: '0', COGNITO_TOKEN_USE: 'access', CORE_LOG_ODMOW: '1',
                                     DATABASE_URL: process.env.DATABASE_URL_API } });
  const adminEmail = `admin.test.${Date.now()}@przyklad.pl`;
  const kontoAdm = await core0.tozsamosc.utworzKonto({ email: adminEmail, imie: 'Admin Test' });
  sprzatanie.push(kontoAdm.id);
  await admin.send(new AdminSetUserPasswordCommand({ UserPoolId: PULA, Username: kontoAdm.id, Password: HASLO, Permanent: true }));
  await owner.query('begin');
  await owner.query('set local role astera_seed');
  await owner.query(`select set_config('astera.inicjalizacja','tak',true)`);
  await owner.query(`insert into public.profile (id, email, imie, rola) values ($1,$2,'Admin Test','admin')
                     on conflict (id) do nothing`, [kontoAdm.id, adminEmail]);
  await owner.query('commit');
  const port = await core0.start();
  const CORE = `http://127.0.0.1:${port}`;
  const zadanie = async (sc, tok, dane) => {
    const r = await fetch(CORE + sc, { method: dane ? 'POST' : 'GET',
      headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(dane ? { 'Content-Type': 'application/json' } : {}) },
      body: dane ? JSON.stringify(dane) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  /* ── A1 / A2 / A3 ───────────────────────────────────────────── */
  const a1 = await zaloguj(adminEmail, HASLO);
  const a2 = await zaloguj(adminEmail, HASLO + 'x');
  const a3 = await zaloguj(`nie.ma.${Date.now()}@przyklad.pl`, HASLO);
  sprawdz('A1', 'Poprawne hasło przez USER_SRP_AUTH → tokeny (access, id, refresh)',
    a1.ok && a1.sesja.getAccessToken().getJwtToken() && a1.sesja.getRefreshToken().getToken(),
    a1.ok ? `token_use=${a1.sesja.getAccessToken().payload.token_use} · client_id zgodny: ${a1.sesja.getAccessToken().payload.client_id === KLIENT}` : a2.msg);
  sprawdz('A2', 'Złe hasło → odmowa', !a2.ok && a2.kod === 'NotAuthorizedException', `${a2.kod}: ${a2.msg}`);
  sprawdz('A3', 'Nieistniejące konto → dokładnie ta sama odmowa co złe hasło (nie zdradzamy istnienia kont)',
    !a3.ok && a3.kod === a2.kod && a3.msg === a2.msg, `${a3.kod}: ${a3.msg}`);

  /* ── C: Core z prawdziwym JWKS ──────────────────────────────── */
  const tokenAdm = a1.sesja.getAccessToken().getJwtToken();
  const c1 = await zadanie('/api/ja', tokenAdm);
  const c2 = await zadanie('/api/konta', tokenAdm);
  const c3 = await zadanie('/api/ja', a1.sesja.getIdToken().getJwtToken());   // token ID zamiast dostępu
  const c4 = await zadanie('/api/ja', tokenAdm.slice(0, -3) + 'abc');        // podpis zepsuty
  sprawdz('C1', 'Core z prawdziwym JWKS Cognito: token dostępu → profil z `sub`; admin widzi konta',
    c1.status === 200 && c1.json?.profil?.id === kontoAdm.id && c1.json.profil.rola === 'admin' && c2.status === 200 && c2.json.length > 1,
    `ja: ${c1.status} (${c1.json?.profil?.rola}) · kont: ${c2.json?.length}`);
  sprawdz('C2', 'Token ID zamiast dostępu i token z zepsutym podpisem → 401',
    c3.status === 401 && c4.status === 401, `id: ${c3.status} · zepsuty: ${c4.status}`);

  /* ── Z: zaproszenie przez Core → NEW_PASSWORD_REQUIRED → nowe hasło ── */
  let hasloTmp = null;
  const coreZ = uruchomCore({ env: { PORT: '0', DATABASE_URL: process.env.DATABASE_URL_API },
                              wyslijZaproszenie: async z => { hasloTmp = z.haslo_tymczasowe; } });
  const portZ = await coreZ.start();
  const rz = await fetch(`http://127.0.0.1:${portZ}/api/zapros`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + tokenAdm, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailA, imie: 'Ania Test', rola: 'kursant' }) });
  const zj = await rz.json();
  const subA = zj?.konto?.id; if (subA) sprzatanie.push(subA);
  const odpNieMaHasla = JSON.stringify(zj).includes(hasloTmp || '@@@');
  const z1 = await zaloguj(emailA, hasloTmp || 'x');
  let z2 = null;
  if (z1.wyzwanie === 'NOWE_HASLO') {
    delete z1.atr.email_verified; delete z1.atr.email;
    z2 = await new Promise(ok => z1.user.completeNewPasswordChallenge(HASLO, {}, {
      onSuccess: s => ok({ ok: true, sesja: s }), onFailure: e => ok({ ok: false, msg: e.message }) }));
  }
  const z3 = z2?.ok ? await zadanie('/api/kursy', z2.sesja.getAccessToken().getJwtToken()) : { status: 0 };
  sprawdz('Z', 'Zaproszenie przez Core: konto + profil; hasło tymczasowe tylko do wysyłki; pierwsze logowanie = NEW_PASSWORD_REQUIRED → nowe hasło → tokeny → dane przez Core',
    rz.status === 200 && subA && hasloTmp && !odpNieMaHasla && z1.wyzwanie === 'NOWE_HASLO' && z2?.ok && z3.status === 200,
    `zapros: ${rz.status} · hasło w odpowiedzi HTTP: ${odpNieMaHasla ? 'JEST — ŹLE' : 'nie ma'} · wyzwanie: ${z1.wyzwanie || z1.kod} · nowe hasło: ${z2?.ok} · /api/kursy kursantki: ${z3.status} (${z3.json?.length ?? '-'} kursów)`);
  await coreZ.stop();

  /* ── A7: wyłączenie przez Core → Cognito blokuje logowanie ─── */
  const w1 = await zadanie('/api/konto/aktywne', tokenAdm, { id: subA, aktywne: false });
  const w2 = await zaloguj(emailA, HASLO);
  const stan = await admin.send(new AdminGetUserCommand({ UserPoolId: PULA, Username: subA }));
  const w3 = await zadanie('/api/konto/aktywne', tokenAdm, { id: subA, aktywne: true });
  const w4 = await zaloguj(emailA, HASLO);
  sprawdz('A7', 'Konto wyłączone przez admina w Core: Cognito odmawia logowania; włączone — znów wpuszcza',
    w1.status === 200 && !w2.ok && stan.Enabled === false && w3.status === 200 && w4.ok,
    `wyłącz: ${w1.status} · logowanie: ${w2.kod} · Cognito Enabled=${stan.Enabled} · włącz: ${w3.status} · logowanie: ${w4.ok}`);

  /* ── A6: wylogowanie globalne unieważnia token odświeżania ──── */
  const refresh = w4.sesja.getRefreshToken();
  await new Promise(ok => w4.user.globalSignOut({ onSuccess: ok, onFailure: ok }));
  const r6 = await new Promise(ok => uzytk(emailA).refreshSession(refresh, (e, s) => ok(e ? { ok: false, kod: e.code || e.name } : { ok: true })));
  sprawdz('A6', 'Wylogowanie globalne: token odświeżania przestaje działać',
    !r6.ok, r6.ok ? 'ODŚWIEŻYŁ — ŹLE' : `odświeżenie: ${r6.kod}`);

  /* ── A8: seria błędnych haseł → blokada natywna ─────────────── */
  const proby = [];
  for (let i = 0; i < 8; i++) { const p = await zaloguj(emailA, 'Zle-Haslo-' + i + 'x'); proby.push(p.msg); if (/attempts exceeded/i.test(p.msg)) break; }
  const zablokowane = proby.some(m => /Password attempts exceeded/i.test(m));
  const dobreWBlokadzie = zablokowane ? await zaloguj(emailA, HASLO) : { ok: null };
  sprawdz('A8', 'Seria błędnych haseł → „Password attempts exceeded" (blokada natywna Cognito), a nie kolejne zwykłe „złe hasło"',
    zablokowane && dobreWBlokadzie.ok === false,
    `prób do blokady: ${proby.length} · komunikat: „${proby[proby.length - 1]}" · poprawne hasło w trakcie blokady: ${dobreWBlokadzie.ok === false ? 'też odrzucone' : 'PRZESZŁO — ŹLE'}`);

  /* sprzątanie: konta testowe w Cognito i profile w bazie */
  await core0.stop();
  for (const id of sprzatanie) await admin.send(new AdminDeleteUserCommand({ UserPoolId: PULA, Username: id })).catch(() => {});
  await owner.query(`delete from public.profile where email like '%.test.%@przyklad.pl' or email like 'test.a.%@przyklad.pl'`);
  await owner.query(`delete from public.zaproszenie where email like 'test.a.%@przyklad.pl'`);
  await owner.end();
  const zd = wyniki.filter(Boolean).length;
  console.log(`\n═══ COGNITO NA ŻYWO: ${zd} / ${wyniki.length} ═══`);
  process.exit(zd === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.stack || e.message); process.exit(2); });
