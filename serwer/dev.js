#!/usr/bin/env node
/**
 * AsterA Coach — serwer deweloperski
 *
 * PO CO ISTNIEJE
 * Na produkcji rolę backendu pełni AsterA Core (serwer/core.js) — a wcześniej Supabase: Auth wydaje token, PostgREST
 * wykonuje zapytania w roli `astera_api` z tożsamością ustawianą transakcyjnie,
 * Storage wydaje podpisane linki, a RLS decyduje o wszystkim.
 *
 * Ten plik robi to samo lokalnie, żeby dało się uruchomić i przetestować
 * całość bez zakładania konta w Supabase:
 *   1. sprawdza hasło,
 *   2. zakłada sesję (ciasteczko httpOnly, podpisane),
 *   3. przed każdym zapytaniem ustawia rolę i claims,
 *   4. sprawdza, czy konto nie zostało w międzyczasie wyłączone,
 *   5. wszystko inne zostawia politykom RLS w bazie.
 *
 * Nie ma tu ANI JEDNEJ reguły uprawnień do danych. Gdyby ktoś obszedł
 * ten serwer, baza i tak nic mu nie odda.
 */
const crypto = require('crypto');
const { Pool } = require('pg');
const zbudujApi = require('./api');

const PORT   = Number(process.env.PORT || 8910);
const SEKRET = process.env.SEKRET_SESJI || crypto.randomBytes(32).toString('hex');
const pool   = new Pool({ ...require('../testy/polaczenie').DB, max: 8 });

/* ══ SESJE ═══════════════════════════════════════════════════════ */
const sesje = new Map();                     // token -> { uid, wygasa }
const ZYCIE_SESJI = 1000 * 60 * 60 * 8;

const podpisz = t => crypto.createHmac('sha256', SEKRET).update(t).digest('hex').slice(0, 32);

function nowaSesja(uid){
  const t = crypto.randomBytes(24).toString('hex');
  sesje.set(t, { uid, wygasa: Date.now() + ZYCIE_SESJI });
  return t + '.' + podpisz(t);
}
function zSesji(ciastko){
  if (!ciastko) return null;
  const m = /coach_sesja=([^;]+)/.exec(ciastko);
  if (!m) return null;
  const [t, sig] = decodeURIComponent(m[1]).split('.');
  if (!t || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(podpisz(t));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const s = sesje.get(t);
  if (!s || s.wygasa < Date.now()) { sesje.delete(t); return null; }
  return { token: t, uid: s.uid };
}
function zabijSesje(token){ sesje.delete(token); }
function zabijSesjeUzytkownika(uid){
  for (const [t, s] of sesje) if (s.uid === uid) sesje.delete(t);
}

/* ══ RDZEŃ API — wspólny z AsterA Core ═══════════════════════════ */
const api = zbudujApi({
  pool, SEKRET,
  uniewaznij:            s  => zabijSesje(s.token),
  uniewaznijUzytkownika: id => zabijSesjeUzytkownika(id),
});
const { API, zapytaj } = api;

/* ══ HASŁA (tylko dev; na produkcji robi to Supabase Auth) ════════ */
const HASLA_DEV = {
  'norbert@thaimaliwan.pl': 'demo-norbert',
  'maliwan@thaimaliwan.pl': 'demo-maliwan',
  'ania@przyklad.pl':       'demo-ania',
  'piotr@przyklad.pl':      'demo-piotr',
  'ktos@obcy.pl':           'demo-obcy',
};

/* ══ LOGOWANIE — tylko dev; na produkcji front rozmawia z Cognito ═ */
Object.assign(API, {
  async 'POST /api/logowanie'(c){
    const email = String(c.email || '').trim().toLowerCase();
    if (!email || !c.haslo) return [400, { blad: 'Podaj adres e-mail i hasło.' }];
    if (HASLA_DEV[email] !== c.haslo)
      return [401, { blad: 'Nieprawidłowy adres e-mail lub hasło.' }];
    const { rows:[u] } = await pool.query(`select id from auth.users where lower(email)=$1`, [email]);
    if (!u) return [401, { blad: 'Nieprawidłowy adres e-mail lub hasło.' }];
    const [p] = await zapytaj(u.id,
      `select id, imie, email, rola, jezyk, aktywne from public.profile where id = public.uid()`);
    if (!p) return [403, { blad: 'To konto nie ma jeszcze profilu. Odezwij się do administratora.' }];
    if (p.aktywne === false) return [403, { blad: 'To konto jest wyłączone.' }];
    return [200, { profil: p }, nowaSesja(u.id)];
  },

  async 'POST /api/wylogowanie'(_c, s){
    if (s) zabijSesje(s.token);
    return [200, { ok: true }, 'WYLOGUJ'];
  },
});

/* ══ SERWER ══════════════════════════════════════════════════════ */
const serwer = api.zbudujSerwer(req => zSesji(req.headers.cookie));
serwer.listen(PORT, () => console.log(`AsterA Coach (dev) → http://127.0.0.1:${PORT}`));
module.exports = { serwer, sesje };
