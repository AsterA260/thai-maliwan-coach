#!/usr/bin/env node
/**
 * AsterA Coach — serwer deweloperski
 *
 * PO CO ISTNIEJE
 * Na produkcji rolę backendu pełni Supabase: Auth wydaje token, PostgREST
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
const http   = require('http');
const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT    = Number(process.env.PORT || 8910);
const SEKRET  = process.env.SEKRET_SESJI || crypto.randomBytes(32).toString('hex');
const MAGAZYN = path.join(__dirname, '..', 'magazyn', 'materialy');   // odpowiednik prywatnego bucketu
const LIMIT_B = 25 * 1024 * 1024;                                     // 25 MB
const DOZWOLONE = {
  pdf:     ['application/pdf'],
  zdjecie: ['image/jpeg','image/png','image/webp','image/gif'],
  wideo:   ['video/mp4','video/quicktime','video/webm'],
  audio:   ['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/x-m4a'],
  inny:    ['application/octet-stream','text/plain'],
};

const pool = new Pool({ host: '/tmp', port: 5433, user: 'postgres', database: 'coach', max: 8 });

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

/* ══ ZAPYTANIE W KONTEKŚCIE UŻYTKOWNIKA ══════════════════════════ */
async function zapytaj(uid, sql, params = []) {
  const k = await pool.connect();
  try {
    await k.query('begin');
    // ETAP 0: ten sam wzorzec, który obowiązuje AsterA Core —
    // BEGIN → set_config('astera.uzytkownik', <uuid>, true) → … → COMMIT.
    // Rola zawsze `astera_api`; brak tożsamości to brak set_config,
    // a nie inna rola bazodanowa.
    await k.query('set local role astera_api');
    if (uid) {
      await k.query(`select set_config('astera.uzytkownik',$1,true)`, [uid]);
    }
    const r = await k.query(sql, params);
    await k.query('commit');
    return r.rows;
  } catch (e) {
    await k.query('rollback').catch(()=>{});
    throw e;
  } finally { k.release(); }
}

/** Profil zalogowanego. Konto wyłączone → sesja natychmiast unieważniona. */
async function profil(sesja){
  if (!sesja) return null;
  const [p] = await zapytaj(sesja.uid,
    `select id, imie, email, rola, jezyk, aktywne from public.profile where id = public.uid()`);
  if (!p || p.aktywne === false) { zabijSesje(sesja.token); return null; }
  return p;
}

/* ══ MAGAZYN PLIKÓW ══════════════════════════════════════════════ */
const RE_SCIEZKA = /^kurs\/[0-9a-fA-F-]{36}\/(pdf|zdjecie|wideo|audio|inny)\/[A-Za-z0-9._-]+$/;

function bezpiecznaSciezka(s){
  return typeof s === 'string' && !s.includes('..') && RE_SCIEZKA.test(s);
}
function naDysku(s){ return path.join(MAGAZYN, s); }

/** Odpowiednik createSignedUrl — link ważny 5 minut. */
function podpisanyLink(sciezka, sekundy = 300){
  const doKiedy = Date.now() + sekundy * 1000;
  const sig = crypto.createHmac('sha256', SEKRET).update(sciezka + '|' + doKiedy).digest('hex');
  return `/plik?s=${encodeURIComponent(sciezka)}&do=${doKiedy}&p=${sig}`;
}
function linkWazny(sciezka, doKiedy, sig){
  if (!Number(doKiedy) || Number(doKiedy) < Date.now()) return false;
  const ocz = crypto.createHmac('sha256', SEKRET).update(sciezka + '|' + doKiedy).digest('hex');
  const a = Buffer.from(String(sig)), b = Buffer.from(ocz);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ══ HASŁA (tylko dev; na produkcji robi to Supabase Auth) ════════ */
const HASLA_DEV = {
  'norbert@thaimaliwan.pl': 'demo-norbert',
  'maliwan@thaimaliwan.pl': 'demo-maliwan',
  'ania@przyklad.pl':       'demo-ania',
  'piotr@przyklad.pl':      'demo-piotr',
  'ktos@obcy.pl':           'demo-obcy',
};

/* ══ API ═════════════════════════════════════════════════════════ */
const API = {

  /* ── logowanie ─────────────────────────────────────────────── */
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

  async 'GET /api/ja'(_c, s){
    const p = await profil(s);
    return p ? [200, { profil: p }] : [401, { blad: 'Nie jesteś zalogowany.' }];
  },

  /* ── dane wspólne; RLS przycina co trzeba ──────────────────── */
  async 'GET /api/kursy'(_c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    return [200, await zapytaj(s.uid, `
      select k.*, p.imie as instruktor,
        (select count(*) from public.przypisanie z where z.kurs_id=k.id and z.aktywne) as kursantow
      from public.kurs k left join public.profile p on p.id = k.instruktor_id
      order by k.dni`)];
  },

  async 'GET /api/kurs'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const [lekcje, etapy, materialy, postepy] = await Promise.all([
      zapytaj(s.uid, `select * from public.lekcja where kurs_id=$1 order by kolejnosc`, [c.id]),
      zapytaj(s.uid, `select e.* from public.etap e join public.lekcja l on l.id=e.lekcja_id
                      where l.kurs_id=$1 order by e.kolejnosc`, [c.id]),
      zapytaj(s.uid, `select * from public.material where kurs_id=$1 order by nazwa_pl`, [c.id]),
      zapytaj(s.uid, `select p.* from public.postep p join public.etap e on e.id=p.etap_id
                      join public.lekcja l on l.id=e.lekcja_id where l.kurs_id=$1`, [c.id]),
    ]);
    return [200, { lekcje, etapy, materialy, postepy }];
  },

  async 'POST /api/postep'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid, `
      insert into public.postep (kursant_id, etap_id, status)
      values (public.uid(), $1, $2)
      on conflict (kursant_id, etap_id) do update set status=$2, zmienione=now()
      returning *`, [c.etap_id, c.status]);
    return [200, r[0] || null];
  },

  /* ── pytania ──────────────────────────────────────────────── */
  async 'GET /api/pytania'(_c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    return [200, await zapytaj(s.uid, `
      select p.*, pr.imie as kursant, k.nazwa_pl as kurs, od.imie as odpowiedzial
      from public.pytanie p
      join public.profile pr on pr.id = p.kursant_id
      join public.kurs k on k.id = p.kurs_id
      left join public.profile od on od.id = p.odpowiedzial_id
      order by (p.status = 'nowe') desc, p.utworzone desc`)];
  },

  async 'POST /api/pytanie'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const tresc = String(c.tresc || '').trim();
    if (tresc.length < 3)  return [400, { blad: 'Napisz treść pytania.' }];
    if (tresc.length > 1000) return [400, { blad: 'Pytanie jest za długie — zmieść się w 1000 znakach.' }];
    const r = await zapytaj(s.uid, `
      insert into public.pytanie (kursant_id, kurs_id, etap_id, tresc)
      values (public.uid(), $1, $2, $3) returning *`, [c.kurs_id, c.etap_id || null, tresc]);
    return [200, r[0]];
  },

  async 'POST /api/pytanie/odpowiedz'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const odp = String(c.odpowiedz || '').trim();
    if (odp.length < 2) return [400, { blad: 'Napisz odpowiedź.' }];
    const r = await zapytaj(s.uid, `
      update public.pytanie
         set odpowiedz = $2, odpowiedzial_id = public.uid(), status = 'odpowiedziane'
       where id = $1 returning *`, [c.id, odp]);
    if (!r.length) return [403, { blad: 'Nie możesz odpowiadać na to pytanie.' }];
    return [200, r[0]];
  },

  async 'POST /api/pytanie/zamknij'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid,
      `update public.pytanie set status='zamkniete' where id=$1 returning id`, [c.id]);
    if (!r.length) return [403, { blad: 'Nie możesz zamknąć tego pytania.' }];
    return [200, { ok: true }];
  },

  /* ── materiały ────────────────────────────────────────────── */
  async 'GET /api/material/link'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    // RLS zwróci wiersz tylko wtedy, gdy ten użytkownik ma prawo go widzieć
    const [m] = await zapytaj(s.uid,
      `select sciezka, nazwa_pl, typ from public.material where id = $1`, [c.id]);
    if (!m) return [403, { blad: 'Nie masz dostępu do tego materiału.' }];
    if (!bezpiecznaSciezka(m.sciezka)) return [400, { blad: 'Nieprawidłowa ścieżka pliku.' }];
    if (!fs.existsSync(naDysku(m.sciezka)))
      return [404, { blad: 'Plik nie został jeszcze wgrany.' }];
    return [200, { link: podpisanyLink(m.sciezka), nazwa: m.nazwa_pl, wazny_s: 300 }];
  },

  async 'POST /api/material/publikuj'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid,
      `update public.material set opublikowany=$2 where id=$1 returning *`, [c.id, !!c.opublikowany]);
    if (!r.length) return [403, { blad: 'Nie masz uprawnień do tego materiału.' }];
    return [200, r[0]];
  },

  async 'POST /api/material/usun'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const [m] = await zapytaj(s.uid, `select sciezka from public.material where id=$1`, [c.id]);
    const r = await zapytaj(s.uid, `delete from public.material where id=$1 returning id`, [c.id]);
    if (!r.length) return [403, { blad: 'Nie masz uprawnień do tego materiału.' }];
    if (m && bezpiecznaSciezka(m.sciezka)) await fsp.rm(naDysku(m.sciezka), { force: true });
    return [200, { ok: true }];
  },

  /* ── konta ────────────────────────────────────────────────── */
  async 'GET /api/kursanci'(_c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    // Ten sam widok, z którego korzysta warstwa Supabase — jeden
    // kontrakt, jedno miejsce liczenia postępów.
    return [200, await zapytaj(s.uid,
      `select * from public.widok_kursanci order by imie`)];
  },

  async 'GET /api/konta'(_c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    return [200, await zapytaj(s.uid,
      `select id, imie, email, rola, aktywne, utworzone from public.profile order by rola, imie`)];
  },

  async 'POST /api/konto/rola'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    try {
      const r = await zapytaj(s.uid,
        `update public.profile set rola=$2 where id=$1 returning id, imie, rola`, [c.id, c.rola]);
      // Wyzwalacz `profil_ochrona` po cichu cofa zmianę osobie bez uprawnień.
      // Nie udajemy sukcesu — sprawdzamy, czy rola faktycznie się zmieniła.
      if (!r.length || r[0].rola !== c.rola)
        return [403, { blad: 'Tylko administrator zmienia role.' }];
      return [200, r[0]];
    } catch (e) { return [409, { blad: czytelnyBlad(e) }]; }
  },

  async 'POST /api/konto/aktywne'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    try {
      const r = await zapytaj(s.uid,
        `update public.profile set aktywne=$2 where id=$1 returning id, imie, aktywne`,
        [c.id, !!c.aktywne]);
      if (!r.length || r[0].aktywne !== !!c.aktywne)
        return [403, { blad: 'Tylko administrator włącza i wyłącza konta.' }];
      // wyłączone konto traci wszystkie otwarte sesje natychmiast
      if (!c.aktywne) zabijSesjeUzytkownika(c.id);
      return [200, r[0]];
    } catch (e) { return [409, { blad: czytelnyBlad(e) }]; }
  },

  /* ── zaproszenia (zamiast rejestracji publicznej) ──────────── */
  async 'POST /api/zapros'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const email = String(c.email || '').trim().toLowerCase();
    const imie  = String(c.imie  || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return [400, { blad: 'Podaj poprawny adres e-mail.' }];
    if (imie.length < 2) return [400, { blad: 'Podaj imię.' }];
    if (!['kursant','instruktor','admin'].includes(c.rola)) return [400, { blad: 'Nieznana rola.' }];

    // Token widzi tylko zapraszający; w bazie ląduje wyłącznie jego skrót.
    const token = crypto.randomBytes(24).toString('base64url');
    const hash  = crypto.createHash('sha256').update(token).digest('hex');
    let r;
    try {
      r = await zapytaj(s.uid, `
        insert into public.zaproszenie (email, imie, rola, kurs_id, token_hash, zaprosil_id)
        values ($1,$2,$3,$4,$5,public.uid()) returning id, email, imie, rola, wygasa`,
        [email, imie, c.rola, c.kurs_id || null, hash]);
    } catch (e) { return [403, { blad: 'Tylko administrator może zapraszać.' }]; }
    if (!r.length) return [403, { blad: 'Tylko administrator może zapraszać.' }];

    /* NA PRODUKCJI: w tym miejscu backend wywołuje Supabase Admin API
       (auth.admin.inviteUserByEmail) kluczem service_role, który NIGDY
       nie opuszcza serwera. Supabase sam wysyła wiadomość z linkiem.
       Lokalnie pokazujemy link w odpowiedzi, bo nie ma poczty.        */
    return [200, { zaproszenie: r[0],
      link_lokalny: `/nowe-haslo.html?zaproszenie=${token}`,
      uwaga: 'Lokalnie link pokazujemy na ekranie. Na produkcji wysyła go Supabase e-mailem.' }];
  },

  async 'GET /api/zaproszenia'(_c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    return [200, await zapytaj(s.uid,
      `select id, email, imie, rola, wygasa, wykorzystane, utworzone
         from public.zaproszenie order by utworzone desc`)];
  },

  /* ── przypisania ──────────────────────────────────────────── */
  async 'POST /api/przypisz'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid, `
      insert into public.przypisanie (kurs_id, kursant_id, przypisal_id)
      values ($1,$2,public.uid())
      on conflict (kurs_id, kursant_id) do update set aktywne = true
      returning *`, [c.kurs_id, c.kursant_id]);
    if (!r.length) return [403, { blad: 'Tylko administrator przypisuje kursantów.' }];
    return [200, r[0]];
  },

  async 'POST /api/odepnij'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const r = await zapytaj(s.uid,
      `update public.przypisanie set aktywne=false where kurs_id=$1 and kursant_id=$2 returning id`,
      [c.kurs_id, c.kursant_id]);
    if (!r.length) return [403, { blad: 'Tylko administrator odpina kursantów.' }];
    return [200, { ok: true }];
  },
};

/** Czy błąd to odmowa z polityki RLS albo z wyzwalacza pilnującego uprawnień. */
function toOdmowa(e){
  const kod = e && e.code, m = (e && e.message || '');
  return kod === '42501' || /row-level security|violates row-level/i.test(m)
      || /nie jest zapisany na kurs|jedyny aktywny administrator/i.test(m);
}

function czytelnyBlad(e){
  const m = (e && e.message || '').split('\n')[0];
  if (/row-level security|violates row-level/i.test(m))
    return 'Nie masz uprawnień do tej operacji.';
  if (/jedyny aktywny administrator/i.test(m))
    return 'To jedyny aktywny administrator — nie można go wyłączyć ani zdegradować.';
  if (/material_sciezka_zgodna_z_kursem/.test(m))
    return 'Ścieżka pliku nie pasuje do kursu.';
  if (/material_sciezka_unikalna/.test(m))
    return 'Materiał o takiej ścieżce już istnieje.';
  if (/Etap nie nalezy do tego kursu/i.test(m))
    return 'Ten etap nie należy do wybranego kursu.';
  if (/nie jest zapisany na kurs/i.test(m))
    return 'Nie jesteś zapisany na kurs tego etapu.';
  return 'Nie udało się wykonać operacji.';
}

/* ══ WGRYWANIE PLIKU ═════════════════════════════════════════════
   Kolejność jest ważna:
     1. plik ląduje pod nazwą tymczasową,
     2. dopiero potem zapisujemy metadane (przez RLS),
     3. jeżeli zapis metadanych się nie uda — kasujemy plik.
   Dzięki temu nie zostaje ani osierocony plik, ani rekord bez pliku. */
async function wgrajPlik(req, res, u, sesja){
  // Odrzucając żądanie, najpierw wypijamy jego treść — inaczej klient
  // dostaje zerwane połączenie zamiast czytelnego komunikatu.
  const odrzuc = (kod, dane) => { req.resume(); odpowiedz(res, kod, dane); };

  const p = await profil(sesja);
  if (!p) return odrzuc(401, { blad: 'Nie jesteś zalogowany.' });

  const kurs_id = u.searchParams.get('kurs_id');
  const typ     = u.searchParams.get('typ') || 'inny';
  const nazwa   = (u.searchParams.get('nazwa') || '').trim();
  const plik    = (u.searchParams.get('plik')  || '').trim();
  const mime    = (req.headers['content-type'] || 'application/octet-stream').split(';')[0];

  if (!/^[0-9a-fA-F-]{36}$/.test(kurs_id || ''))  return odrzuc(400, { blad: 'Brak kursu.' });
  if (!DOZWOLONE[typ])                             return odrzuc(400, { blad: 'Nieznany typ materiału.' });
  if (!nazwa)                                      return odrzuc(400, { blad: 'Podaj nazwę materiału.' });
  if (!DOZWOLONE[typ].includes(mime))
    return odrzuc(415, { blad: `Ten format (${mime}) nie jest dozwolony dla typu „${typ}".` });

  const rozszerzenie = (plik.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0].toLowerCase();
  const bezpiecznaNazwa = Date.now() + '-' +
    nazwa.normalize('NFD').replace(/[̀-ͯ]/g, '')
         .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + rozszerzenie;
  const sciezka = `kurs/${kurs_id}/${typ}/${bezpiecznaNazwa}`;
  if (!bezpiecznaSciezka(sciezka)) return odrzuc(400, { blad: 'Nieprawidłowa nazwa pliku.' });

  // 1. plik do pliku tymczasowego, z twardym limitem rozmiaru
  const tymczasowy = path.join(MAGAZYN, '.tmp-' + crypto.randomBytes(8).toString('hex'));
  try { await fsp.mkdir(MAGAZYN, { recursive: true }); }
  catch (e) { return odrzuc(500, { blad: 'Magazyn plików jest niedostępny.' }); }

  let bajtow = 0, zaDuzy = false, bladOdczytu = null, bladZapisu = null;
  let strumien;
  try { strumien = fs.createWriteStream(tymczasowy); }
  catch (e) { return odrzuc(500, { blad: 'Magazyn plików jest niedostępny.' }); }

  // Bez tej obsługi każdy błąd zapisu (brak praw, pełny dysk) leciał
  // jako nieobsłużone zdarzenie i ZABIJAŁ CAŁY SERWER. Teraz kończy
  // się jednym czytelnym błędem tego jednego żądania.
  await new Promise(ok => {
    let skonczone = false;
    const koniec = () => { if (!skonczone) { skonczone = true; ok(); } };
    strumien.on('error', e => { bladZapisu = e; koniec(); });
    req.on('data', d => {
      if (bladZapisu) return;
      bajtow += d.length;
      // Nie zrywamy połączenia — dopiero wtedy klient dostałby błąd sieci
      // zamiast czytelnego komunikatu. Resztę po prostu wyrzucamy.
      if (bajtow > LIMIT_B) { zaDuzy = true; return; }
      strumien.write(d);
    });
    req.on('end',   () => strumien.end(koniec));
    req.on('error', e  => { bladOdczytu = e; strumien.end(koniec); });
  });
  if (bladZapisu) {
    req.resume();
    await fsp.rm(tymczasowy, { force: true }).catch(() => {});
    return odpowiedz(res, 500, { blad: 'Nie udało się zapisać pliku w magazynie.' });
  }
  if (zaDuzy || bladOdczytu) {
    await fsp.rm(tymczasowy, { force: true });
    return odpowiedz(res, zaDuzy ? 413 : 400,
      { blad: zaDuzy ? 'Plik jest za duży. Limit to 25 MB.' : 'Nie udało się odebrać pliku.' });
  }
  if (bajtow === 0) {
    await fsp.rm(tymczasowy, { force: true });
    return odpowiedz(res, 400, { blad: 'Plik jest pusty.' });
  }

  // 2. metadane — przez RLS, w kontekście zalogowanego
  let rekord;
  try {
    const r = await zapytaj(sesja.uid, `
      insert into public.material (kurs_id, etap_id, typ, nazwa_pl, opis, sciezka,
                                   rozmiar_b, mime, opublikowany, dodal_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,false,public.uid()) returning *`,
      [kurs_id, u.searchParams.get('etap_id') || null, typ, nazwa,
       u.searchParams.get('opis') || null, sciezka, bajtow, mime]);
    rekord = r[0];
  } catch (e) {
    await fsp.rm(tymczasowy, { force: true });          // 3. sprzątanie
    return odpowiedz(res, 403, { blad: czytelnyBlad(e) });
  }
  if (!rekord) {
    await fsp.rm(tymczasowy, { force: true });
    return odpowiedz(res, 403, { blad: 'Nie masz uprawnień do tego kursu.' });
  }

  // 4. dopiero teraz plik trafia na docelowe miejsce
  try {
    await fsp.mkdir(path.dirname(naDysku(sciezka)), { recursive: true });
    await fsp.rename(tymczasowy, naDysku(sciezka));
  } catch (e) {
    await zapytaj(sesja.uid, `delete from public.material where id=$1`, [rekord.id]).catch(()=>{});
    await fsp.rm(tymczasowy, { force: true });
    return odpowiedz(res, 500, { blad: 'Nie udało się zapisać pliku.' });
  }
  return odpowiedz(res, 200, { material: rekord });
}

/* ══ POBIERANIE PLIKU ════════════════════════════════════════════
   Link jest podpisany i wygasa. Podpis sprawdzamy zawsze — tak samo
   działa podpisany adres w Supabase Storage. */
async function wydajPlik(res, u){
  const sciezka = u.searchParams.get('s') || '';
  if (!bezpiecznaSciezka(sciezka)) return odpowiedz(res, 400, { blad: 'Nieprawidłowa ścieżka.' });
  if (!linkWazny(sciezka, u.searchParams.get('do'), u.searchParams.get('p')))
    return odpowiedz(res, 403, { blad: 'Link wygasł albo jest nieprawidłowy.' });
  const f = naDysku(sciezka);
  if (!fs.existsSync(f)) return odpowiedz(res, 404, { blad: 'Nie ma takiego pliku.' });
  res.writeHead(200, { 'Content-Type': 'application/octet-stream',
                       'Content-Disposition': 'inline; filename="' + path.basename(f) + '"',
                       'Cache-Control': 'private, no-store' });
  fs.createReadStream(f).pipe(res);
}

/* ══ SERWER ══════════════════════════════════════════════════════ */
const TYPY = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json' };

function odpowiedz(res, kod, dane, ciastko){
  const n = { 'Content-Type': 'application/json; charset=utf-8' };
  if (ciastko === 'WYLOGUJ')
    n['Set-Cookie'] = 'coach_sesja=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
  else if (ciastko)
    n['Set-Cookie'] = `coach_sesja=${encodeURIComponent(ciastko)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
  res.writeHead(kod, n).end(JSON.stringify(dane));
}

const serwer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const sesja = zSesji(req.headers.cookie);

  if (u.pathname === '/api/material/plik' && req.method === 'POST')
    return wgrajPlik(req, res, u, sesja).catch(() =>
      odpowiedz(res, 500, { blad: 'Nie udało się wgrać pliku.' }));

  if (u.pathname === '/plik') return wydajPlik(res, u);

  if (u.pathname.startsWith('/api/')) {
    let ciało = {};
    if (req.method === 'POST') {
      const buf = []; for await (const c of req) buf.push(c);
      try { ciało = JSON.parse(Buffer.concat(buf).toString() || '{}'); } catch { ciało = {}; }
    }
    for (const [k, v] of u.searchParams) ciało[k] = v;

    const fn = API[`${req.method} ${u.pathname}`];
    if (!fn) return odpowiedz(res, 404, { blad: 'Nie ma takiego zasobu.' });
    try {
      const [kod, dane, ciastko] = await fn(ciało, sesja);
      odpowiedz(res, kod, dane, ciastko);
    } catch (e) {
      odpowiedz(res, toOdmowa(e) ? 403 : 400, { blad: czytelnyBlad(e) });
    }
    return;
  }

  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const plik = path.join(__dirname, '..', 'web', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(plik, (err, buf) => {
    if (err) { res.writeHead(404).end('Nie ma takiej strony.'); return; }
    res.writeHead(200, { 'Content-Type': TYPY[path.extname(plik)] || 'application/octet-stream' }).end(buf);
  });
});

serwer.listen(PORT, () => console.log(`AsterA Coach (dev) → http://127.0.0.1:${PORT}`));
module.exports = { serwer, sesje };
