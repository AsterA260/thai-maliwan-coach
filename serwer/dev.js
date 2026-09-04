#!/usr/bin/env node
/**
 * AsterA Coach — serwer deweloperski
 *
 * PO CO ISTNIEJE
 * Na produkcji rolę backendu pełni Supabase: Auth wydaje token, PostgREST
 * wykonuje zapytania w roli `authenticated` z ustawionym request.jwt.claims,
 * a RLS decyduje, co użytkownik zobaczy.
 *
 * Ten plik robi DOKŁADNIE TO SAMO lokalnie, żeby dało się uruchomić
 * i przetestować całość bez zakładania konta w Supabase:
 *   1. sprawdza hasło,
 *   2. zakłada sesję (ciasteczko httpOnly, podpisane),
 *   3. przed każdym zapytaniem ustawia rolę i claims,
 *   4. wszystko inne zostawia politykom RLS w bazie.
 *
 * Nie ma tu ANI JEDNEJ reguły uprawnień. Gdyby ktoś obszedł ten serwer,
 * baza i tak nic mu nie odda.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 8910);
const SEKRET = process.env.SEKRET_SESJI || crypto.randomBytes(32).toString('hex');
const pool = new Pool({ host: '/tmp', port: 5433, user: 'postgres', database: 'coach', max: 8 });

// ── SESJE ─────────────────────────────────────────────────────────
const sesje = new Map();           // token -> { uid, wygasa }
const ZYCIE_SESJI = 1000 * 60 * 60 * 8;

function podpisz(t){ return crypto.createHmac('sha256', SEKRET).update(t).digest('hex').slice(0,16); }
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
  if (!t || sig !== podpisz(t)) return null;
  const s = sesje.get(t);
  if (!s || s.wygasa < Date.now()) { sesje.delete(t); return null; }
  return { token: t, uid: s.uid };
}

// ── ZAPYTANIE W KONTEKŚCIE UŻYTKOWNIKA ───────────────────────────
async function zapytaj(uid, sql, params = []) {
  const k = await pool.connect();
  try {
    await k.query('begin');
    if (uid) {
      await k.query('set local role authenticated');
      await k.query(`select set_config('request.jwt.claims',$1,true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    } else {
      await k.query('set local role anon');
      await k.query(`select set_config('request.jwt.claims','',true)`);
    }
    const r = await k.query(sql, params);
    await k.query('commit');
    return r.rows;
  } catch (e) {
    await k.query('rollback').catch(()=>{});
    throw e;
  } finally { k.release(); }
}

// ── HASŁA (tylko dev; na produkcji robi to Supabase Auth) ────────
function hash(haslo, sol){ return crypto.pbkdf2Sync(haslo, sol, 60000, 32, 'sha256').toString('hex'); }
const HASLA_DEV = {                      // wyłącznie do lokalnego demo
  'norbert@thaimaliwan.pl': 'demo-norbert',
  'maliwan@thaimaliwan.pl': 'demo-maliwan',
  'ania@przyklad.pl':       'demo-ania',
  'piotr@przyklad.pl':      'demo-piotr',
  'ktos@obcy.pl':           'demo-obcy',
};

// ── ROUTING API ──────────────────────────────────────────────────
const API = {
  async 'POST /api/logowanie'(ciało){
    const { email, haslo } = ciało;
    if (!email || !haslo) return [400, { blad: 'Podaj adres e-mail i hasło.' }];
    if (HASLA_DEV[email] !== haslo)
      return [401, { blad: 'Nieprawidłowy adres e-mail lub hasło.' }];
    const [u] = await zapytaj(null, `select id from auth.users where email = $1`, [email])
      .catch(async () => (await pool.query(`select id from auth.users where email=$1`, [email])).rows);
    if (!u) return [401, { blad: 'Nieprawidłowy adres e-mail lub hasło.' }];
    const [p] = await zapytaj(u.id, `select id, imie, email, rola, jezyk from public.profile where id = auth.uid()`);
    if (!p) return [403, { blad: 'To konto nie ma jeszcze profilu. Odezwij się do administratora.' }];
    if (p.aktywne === false) return [403, { blad: 'To konto jest wyłączone.' }];
    return [200, { profil: p }, nowaSesja(u.id)];
  },

  async 'POST /api/wylogowanie'(_c, sesja){
    if (sesja) sesje.delete(sesja.token);
    return [200, { ok: true }, 'WYLOGUJ'];
  },

  async 'GET /api/ja'(_c, sesja){
    if (!sesja) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const [p] = await zapytaj(sesja.uid,
      `select id, imie, email, rola, jezyk from public.profile where id = auth.uid()`);
    return p ? [200, { profil: p }] : [401, { blad: 'Sesja wygasła.' }];
  },

  // ── dane wspólne dla wszystkich ról; RLS przycina co trzeba ────
  async 'GET /api/kursy'(_c, s){
    return [200, await zapytaj(s?.uid, `
      select k.*, p.imie as instruktor,
        (select count(*) from public.przypisanie z where z.kurs_id=k.id and z.aktywne) as kursantow
      from public.kurs k left join public.profile p on p.id = k.instruktor_id
      order by k.dni`)];
  },

  async 'GET /api/kurs'(c, s){
    const lekcje = await zapytaj(s?.uid,
      `select * from public.lekcja where kurs_id=$1 order by kolejnosc`, [c.id]);
    const etapy = await zapytaj(s?.uid,
      `select e.* from public.etap e join public.lekcja l on l.id=e.lekcja_id
       where l.kurs_id=$1 order by e.kolejnosc`, [c.id]);
    const materialy = await zapytaj(s?.uid,
      `select * from public.material where kurs_id=$1 order by nazwa_pl`, [c.id]);
    const postepy = await zapytaj(s?.uid,
      `select p.* from public.postep p join public.etap e on e.id=p.etap_id
       join public.lekcja l on l.id=e.lekcja_id where l.kurs_id=$1`, [c.id]);
    return [200, { lekcje, etapy, materialy, postepy }];
  },

  async 'POST /api/postep'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid, `
      insert into public.postep (kursant_id, etap_id, status)
      values (auth.uid(), $1, $2)
      on conflict (kursant_id, etap_id) do update set status=$2, zmienione=now()
      returning *`, [c.etap_id, c.status]);
    return [200, r[0] || null];
  },

  async 'POST /api/pytanie'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid, `
      insert into public.pytanie (kursant_id, kurs_id, etap_id, tresc)
      values (auth.uid(), $1, $2, $3) returning *`,
      [c.kurs_id, c.etap_id || null, c.tresc]);
    return [200, r[0]];
  },

  async 'GET /api/pytania'(_c, s){
    return [200, await zapytaj(s?.uid, `
      select p.*, pr.imie as kursant, k.nazwa_pl as kurs
      from public.pytanie p
      join public.profile pr on pr.id = p.kursant_id
      join public.kurs k on k.id = p.kurs_id
      order by p.utworzone desc`)];
  },

  // ── instruktor ────────────────────────────────────────────────
  async 'POST /api/material'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid, `
      insert into public.material (kurs_id, etap_id, typ, nazwa_pl, opis, sciezka, opublikowany, dodal_id)
      values ($1,$2,$3,$4,$5,$6,$7,auth.uid()) returning *`,
      [c.kurs_id, c.etap_id || null, c.typ || 'inny', c.nazwa_pl, c.opis || null,
       `kurs/${c.kurs_id}/${c.typ || 'inny'}/${(c.nazwa_pl||'plik').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,
       !!c.opublikowany]);
    return [200, r[0]];
  },

  async 'POST /api/material/publikuj'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid,
      `update public.material set opublikowany=$2 where id=$1 returning *`, [c.id, !!c.opublikowany]);
    if (!r.length) return [403, { blad: 'Nie masz uprawnień do tego materiału.' }];
    return [200, r[0]];
  },

  async 'GET /api/kursanci'(_c, s){
    return [200, await zapytaj(s?.uid, `
      select pr.id, pr.imie, pr.email, k.nazwa_pl as kurs, k.id as kurs_id,
        (select count(*) from public.postep po
          join public.etap e on e.id=po.etap_id join public.lekcja l on l.id=e.lekcja_id
          where po.kursant_id=pr.id and l.kurs_id=k.id and po.status='zrobione') as zrobione,
        (select count(*) from public.etap e join public.lekcja l on l.id=e.lekcja_id
          where l.kurs_id=k.id) as etapow
      from public.przypisanie z
      join public.profile pr on pr.id = z.kursant_id
      join public.kurs k on k.id = z.kurs_id
      where z.aktywne order by pr.imie`)];
  },

  // ── admin ─────────────────────────────────────────────────────
  async 'GET /api/konta'(_c, s){
    return [200, await zapytaj(s?.uid,
      `select id, imie, email, rola, aktywne, utworzone from public.profile order by rola, imie`)];
  },

  async 'POST /api/konto/rola'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid,
      `update public.profile set rola=$2 where id=$1 returning id, imie, rola`, [c.id, c.rola]);
    if (!r.length) return [403, { blad: 'Tylko administrator zmienia role.' }];
    return [200, r[0]];
  },

  async 'POST /api/konto/aktywne'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid,
      `update public.profile set aktywne=$2 where id=$1 returning id, imie, aktywne`, [c.id, !!c.aktywne]);
    if (!r.length) return [403, { blad: 'Tylko administrator włącza i wyłącza konta.' }];
    return [200, r[0]];
  },

  async 'POST /api/przypisz'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid, `
      insert into public.przypisanie (kurs_id, kursant_id, przypisal_id)
      values ($1,$2,auth.uid())
      on conflict (kurs_id, kursant_id) do update set aktywne = true
      returning *`, [c.kurs_id, c.kursant_id]);
    if (!r.length) return [403, { blad: 'Tylko administrator przypisuje kursantów.' }];
    return [200, r[0]];
  },

  async 'POST /api/odepnij'(c, s){
    if (!s) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid,
      `update public.przypisanie set aktywne=false where kurs_id=$1 and kursant_id=$2 returning id`,
      [c.kurs_id, c.kursant_id]);
    if (!r.length) return [403, { blad: 'Tylko administrator odpina kursantów.' }];
    return [200, { ok: true }];
  },
};

// ── SERWER ───────────────────────────────────────────────────────
const TYPY = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json' };

const serwer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const sesja = zSesji(req.headers.cookie);

  if (u.pathname.startsWith('/api/')) {
    let ciało = {};
    if (req.method === 'POST') {
      const buf = []; for await (const c of req) buf.push(c);
      try { ciało = JSON.parse(Buffer.concat(buf).toString() || '{}'); } catch { ciało = {}; }
    }
    for (const [k, v] of u.searchParams) ciało[k] = v;

    const fn = API[`${req.method} ${u.pathname}`];
    if (!fn) { res.writeHead(404).end('{}'); return; }
    try {
      const [kod, dane, ciastko] = await fn(ciało, sesja);
      const naglowki = { 'Content-Type': 'application/json; charset=utf-8' };
      if (ciastko === 'WYLOGUJ')
        naglowki['Set-Cookie'] = 'coach_sesja=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
      else if (ciastko)
        naglowki['Set-Cookie'] = `coach_sesja=${encodeURIComponent(ciastko)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
      res.writeHead(kod, naglowki).end(JSON.stringify(dane));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
         .end(JSON.stringify({ blad: 'Nie udało się wykonać operacji.', szczegol: e.message.split('\n')[0] }));
    }
    return;
  }

  // pliki statyczne
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const plik = path.join(__dirname, '..', 'web', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(plik, (err, buf) => {
    if (err) { res.writeHead(404).end('Nie ma takiej strony.'); return; }
    res.writeHead(200, { 'Content-Type': TYPY[path.extname(plik)] || 'application/octet-stream' }).end(buf);
  });
});

serwer.listen(PORT, () => console.log(`AsterA Coach (dev) → http://127.0.0.1:${PORT}`));
