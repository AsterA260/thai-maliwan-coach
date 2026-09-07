/**
 * AsterA Coach — RDZEŃ API                                       [Etap 2]
 *
 * Jeden zestaw handlerów, dwie skorupy:
 *   serwer/dev.js   — sesje w ciasteczku, hasła demo, lokalna atrapa Auth
 *   serwer/core.js  — AsterA Core: token Cognito w nagłówku, prawdziwe konta
 *
 * Ciała handlerów są DOKŁADNIE te, które przeszły 16 testów HTTP
 * i 15 testów kontraktu. Różnice między skorupami wchodzą wyłącznie
 * przez zależności podane do `zbudujApi()`:
 *
 *   pool                    pula połączeń (rola astera_api, tożsamość transakcyjna)
 *   SEKRET                  do podpisywania linków do plików
 *   MAGAZYN                 katalog plików (odpowiednik bucketu — do Etapu 3)
 *   uniewaznij(sesja)       konto wyłączone w trakcie sesji — dev kasuje sesję,
 *                           Core nic (token wygaśnie, a profil i tak odmawia)
 *   uniewaznijUzytkownika   admin wyłączył konto — dev kasuje sesje, Core
 *                           unieważnia tokeny w Cognito
 *   poZaproszeniu(z, s)     Core zakłada konto u dostawcy tożsamości; dev nic
 *
 * Nie ma tu ANI JEDNEJ reguły uprawnień do danych. Gdyby ktoś obszedł
 * ten serwer, baza i tak nic mu nie odda.
 */
const http   = require('http');
const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');

module.exports = function zbudujApi(zal) {
const { pool, SEKRET } = zal;
const MAGAZYN = zal.MAGAZYN || path.join(__dirname, '..', 'magazyn', 'materialy');
// Etap 3: pliki żyją w magazynie za interfejsem — dysk (dev), S3 (Core), atrapa (testy).
const magazynMod = require('./magazyn');
const magazyn = zal.magazyn || new magazynMod.MagazynDysk({ katalog: MAGAZYN, sekret: SEKRET });
const TMP = zal.TMP || MAGAZYN;   // pliki tymczasowe zawsze na dysku Core, także przy S3
const LIMIT_B = 25 * 1024 * 1024;                                     // 25 MB
const DOZWOLONE = {
  pdf:     ['application/pdf'],
  zdjecie: ['image/jpeg','image/png','image/webp','image/gif'],
  wideo:   ['video/mp4','video/quicktime','video/webm'],
  audio:   ['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/x-m4a'],
  inny:    ['application/octet-stream','text/plain'],
};

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

/** Kilka zapytań w JEDNEJ transakcji, z jedną tożsamością.
 *  Potrzebne wszędzie tam, gdzie drugi zapis zależy od pierwszego —
 *  na przykład materiał i jego tłumaczenie. Zapisu takiego NIE DA SIĘ
 *  zrobić jednym poleceniem z CTE: wiersz wstawiony w CTE nie jest
 *  jeszcze widoczny dla polityki RLS drugiego zapisu, więc polityka
 *  odrzuca go jako sierotę. Dwa polecenia w jednej transakcji widzą
 *  się nawzajem i zachowują atomowość. */
async function wTransakcji(uid, praca) {
  const k = await pool.connect();
  try {
    await k.query('begin');
    await k.query('set local role astera_api');
    if (uid) await k.query(`select set_config('astera.uzytkownik',$1,true)`, [uid]);
    const wynik = await praca(async (sql, params = []) => (await k.query(sql, params)).rows);
    await k.query('commit');
    return wynik;
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
  if (!p || p.aktywne === false) { if (zal.uniewaznij) zal.uniewaznij(sesja); return null; }
  return p;
}
async function zabijSesjeUzytkownika(uid){ if (zal.uniewaznijUzytkownika) await zal.uniewaznijUzytkownika(uid); }

/* ══ MAGAZYN PLIKÓW ══════════════════════════════════════════════ */
const bezpiecznaSciezka = k => magazynMod.bezpiecznyKlucz(k) && magazynMod.RE_MATERIAL.test(k);

/* ══ API ═════════════════════════════════════════════════════════ */
const API = {

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
      from public.widok_kurs k left join public.profile p on p.id = k.instruktor_id
      order by k.dni`)];
  },

  async 'GET /api/kurs'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const [lekcje, etapy, materialy, postepy] = await Promise.all([
      zapytaj(s.uid, `select * from public.widok_lekcja where kurs_id=$1 order by kolejnosc`, [c.id]),
      zapytaj(s.uid, `select e.* from public.widok_etap e join public.lekcja l on l.id=e.lekcja_id
                      where l.kurs_id=$1 order by e.kolejnosc`, [c.id]),
      zapytaj(s.uid, `select * from public.widok_material where kurs_id=$1 order by nazwa`, [c.id]),
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
      select p.*, pr.imie as kursant, k.nazwa as kurs, od.imie as odpowiedzial
      from public.pytanie p
      join public.profile pr on pr.id = p.kursant_id
      join public.widok_kurs k on k.id = p.kurs_id
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
      `select sciezka, nazwa, typ from public.widok_material where id = $1`, [c.id]);
    if (!m) return [403, { blad: 'Nie masz dostępu do tego materiału.' }];
    if (!bezpiecznaSciezka(m.sciezka)) return [400, { blad: 'Nieprawidłowa ścieżka pliku.' }];
    if (!await magazyn.istnieje(m.sciezka))
      return [404, { blad: 'Plik nie został jeszcze wgrany.' }];
    // Adres podpisany powstaje DOPIERO tutaj — po tym, jak RLS oddał wiersz.
    return [200, { link: await magazyn.link(m.sciezka, m.nazwa, 300), nazwa: m.nazwa, wazny_s: 300 }];
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
    if (m && bezpiecznaSciezka(m.sciezka)) await magazyn.usun(m.sciezka).catch(() => {});
    return [200, { ok: true }];
  },

  /* ── głosówki Maliwan (Etap 3) ─────────────────────────────── */
  async 'GET /api/glosowka/link'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    // RLS: kursant widzi głosówki z etapów/technik swoich kursów, instruktor swoje, admin wszystko.
    const [g] = await zapytaj(s.uid,
      `select klucz_s3, mime from public.glosowka where id = $1`, [c.id]);
    if (!g) return [403, { blad: 'Nie masz dostępu do tej głosówki.' }];
    if (!magazynMod.RE_GLOSOWKA.test(g.klucz_s3)) return [400, { blad: 'Nieprawidłowy klucz nagrania.' }];
    if (!await magazyn.istnieje(g.klucz_s3)) return [404, { blad: 'Nagranie nie zostało jeszcze wgrane.' }];
    return [200, { link: await magazyn.link(g.klucz_s3, path.basename(g.klucz_s3), 300), wazny_s: 300 }];
  },

  async 'POST /api/glosowka/usun'(c, s){
    if (!await profil(s)) return [401, { blad: 'Nie jesteś zalogowany.' }];
    const [g] = await zapytaj(s.uid, `select klucz_s3 from public.glosowka where id=$1`, [c.id]);
    const r = await zapytaj(s.uid, `delete from public.glosowka where id=$1 returning id`, [c.id]);
    if (!r.length) return [403, { blad: 'Nie masz uprawnień do tej głosówki.' }];
    if (g && magazynMod.RE_GLOSOWKA.test(g.klucz_s3)) await magazyn.usun(g.klucz_s3).catch(() => {});
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
      if (!c.aktywne) await zabijSesjeUzytkownika(c.id);
      else if (zal.przywrocUzytkownika) await zal.przywrocUzytkownika(c.id);
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
    // Core: w tym miejscu powstaje konto u dostawcy tożsamości (Cognito)
    // i wiersz profilu. Dev: nic — konto lokalne zakłada test albo seed.
    const konto = zal.poZaproszeniu ? await zal.poZaproszeniu(r[0], s) : null;
    return [200, { zaproszenie: r[0], konto,
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
  if (/glosowka_klucz_zgodny|glosowka_jeden_wlasciciel/.test(m))
    return 'Klucz nagrania nie pasuje do techniki ani etapu.';
  if (/profile_email_key/.test(m))
    return 'Konto z tym adresem e-mail już istnieje.';
  return 'Nie udało się wykonać operacji.';
}

/* ══ WGRYWANIE PLIKU ═════════════════════════════════════════════
   Kolejność jest ważna:
     1. plik ląduje pod nazwą tymczasową,
     2. dopiero potem zapisujemy metadane (przez RLS),
     3. jeżeli zapis metadanych się nie uda — kasujemy plik.
   Dzięki temu nie zostaje ani osierocony plik, ani rekord bez pliku. */
/** Odbiór treści żądania do pliku tymczasowego, z twardym limitem.
 *  Wspólne dla materiałów i głosówek. Zwraca { tymczasowy, bajtow }
 *  albo null — wtedy odpowiedź już poszła. */
async function odbierzDoTymczasowego(req, res){
  const tymczasowy = path.join(TMP, '.tmp-' + crypto.randomBytes(8).toString('hex'));
  try { await fsp.mkdir(TMP, { recursive: true }); }
  catch (e) { req.resume(); odpowiedz(res, 500, { blad: 'Magazyn plików jest niedostępny.' }); return null; }

  let bajtow = 0, zaDuzy = false, bladOdczytu = null, bladZapisu = null;
  let strumien;
  try { strumien = fs.createWriteStream(tymczasowy); }
  catch (e) { req.resume(); odpowiedz(res, 500, { blad: 'Magazyn plików jest niedostępny.' }); return null; }

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
    odpowiedz(res, 500, { blad: 'Nie udało się zapisać pliku w magazynie.' }); return null;
  }
  if (zaDuzy || bladOdczytu) {
    await fsp.rm(tymczasowy, { force: true });
    odpowiedz(res, zaDuzy ? 413 : 400,
      { blad: zaDuzy ? 'Plik jest za duży. Limit to 25 MB.' : 'Nie udało się odebrać pliku.' }); return null;
  }
  if (bajtow === 0) {
    await fsp.rm(tymczasowy, { force: true });
    odpowiedz(res, 400, { blad: 'Plik jest pusty.' }); return null;
  }
  return { tymczasowy, bajtow };
}

/* ══ WGRYWANIE MATERIAŁU ═════════════════════════════════════════
   Kolejność jest ważna:
     1. plik ląduje pod nazwą tymczasową NA DYSKU CORE,
     2. dopiero potem zapisujemy metadane (przez RLS),
     3. jeżeli zapis metadanych się nie uda — kasujemy plik tymczasowy
        (do magazynu S3 nic jeszcze nie poszło: SIEROTA NIEMOŻLIWA),
     4. dopiero teraz plik trafia do magazynu; gdy to się nie uda —
        kasujemy metadane (rekord bez pliku niemożliwy). */
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

  // 1. plik do pliku tymczasowego
  const odebrany = await odbierzDoTymczasowego(req, res);
  if (!odebrany) return;
  const { tymczasowy, bajtow } = odebrany;

  // 2. metadane — przez RLS, w kontekście zalogowanego
  let rekord;
  try {
    rekord = await wTransakcji(sesja.uid, async q => {
      const [m] = await q(`
        insert into public.material (kurs_id, etap_id, typ, sciezka,
                                     rozmiar_b, mime, opublikowany, dodal_id)
        values ($1,$2,$3,$4,$5,$6,false,public.uid()) returning *`,
        [kurs_id, u.searchParams.get('etap_id') || null, typ, sciezka, bajtow, mime]);
      if (!m) return null;
      await q(`insert into public.material_tekst (material_id, jezyk, nazwa, opis)
               values ($1, public.moj_jezyk(), $2, $3)`,
        [m.id, nazwa, u.searchParams.get('opis') || null]);
      return { ...m, nazwa };
    });
  } catch (e) {
    await fsp.rm(tymczasowy, { force: true });          // 3. sprzątanie
    return odpowiedz(res, 403, { blad: czytelnyBlad(e) });
  }
  if (!rekord) {
    await fsp.rm(tymczasowy, { force: true });
    return odpowiedz(res, 403, { blad: 'Nie masz uprawnień do tego kursu.' });
  }

  // 4. dopiero teraz plik trafia do magazynu
  try {
    await magazyn.zapiszZTymczasowego(tymczasowy, sciezka, mime);
  } catch (e) {
    await zapytaj(sesja.uid, `delete from public.material where id=$1`, [rekord.id]).catch(()=>{});
    await fsp.rm(tymczasowy, { force: true }).catch(()=>{});
    return odpowiedz(res, 500, { blad: 'Nie udało się zapisać pliku.' });
  }
  return odpowiedz(res, 200, { material: rekord });
}

/* ══ WGRYWANIE GŁOSÓWKI (Etap 3) ═════════════════════════════════
   Ta sama dyscyplina. Klucz S3 buduje Core z identyfikatorów, a baza
   (ograniczenie `glosowka_klucz_zgodny`) odrzuci każdy, który nie
   wskazuje dokładnie tej techniki albo etapu — nawet gdyby Core się
   pomylił. Parametry: technika_id ALBO etap_id, jezyk, plik. */
async function wgrajGlosowke(req, res, u, sesja){
  const odrzuc = (kod, dane) => { req.resume(); odpowiedz(res, kod, dane); };
  const p = await profil(sesja);
  if (!p) return odrzuc(401, { blad: 'Nie jesteś zalogowany.' });

  const technika_id = u.searchParams.get('technika_id') || null;
  const etap_id     = u.searchParams.get('etap_id') || null;
  const jezyk       = (u.searchParams.get('jezyk') || 'th').toLowerCase();
  const plik        = (u.searchParams.get('plik') || '').trim();
  const mime        = (req.headers['content-type'] || 'application/octet-stream').split(';')[0];
  const UUID = /^[0-9a-fA-F-]{36}$/;
  if ((technika_id ? 1 : 0) + (etap_id ? 1 : 0) !== 1) return odrzuc(400, { blad: 'Podaj technikę ALBO etap.' });
  if (![technika_id, etap_id].filter(Boolean).every(x => UUID.test(x))) return odrzuc(400, { blad: 'Zły identyfikator.' });
  if (!DOZWOLONE.audio.includes(mime)) return odrzuc(415, { blad: `Ten format (${mime}) nie jest nagraniem audio.` });
  if (!/^[a-z]{2}$/.test(jezyk)) return odrzuc(400, { blad: 'Zły kod języka.' });

  const ext = ((plik.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || { 'audio/mpeg':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/wav':'wav','audio/ogg':'ogg' }[mime] || 'bin').toLowerCase();
  const id = crypto.randomUUID();
  const klucz = technika_id ? `glosowka/technika/${technika_id}/${id}.${ext}` : `glosowka/etap/${etap_id}/${id}.${ext}`;
  if (!magazynMod.RE_GLOSOWKA.test(klucz)) return odrzuc(400, { blad: 'Nieprawidłowy klucz nagrania.' });

  const odebrany = await odbierzDoTymczasowego(req, res);
  if (!odebrany) return;
  const { tymczasowy, bajtow } = odebrany;

  let rekord;
  try {
    [rekord] = await zapytaj(sesja.uid, `
      insert into public.glosowka (id, technika_id, etap_id, jezyk_zrodlowy, klucz_s3, mime, rozmiar_b, nagral_id)
      values ($1,$2,$3,$4,$5,$6,$7,public.uid()) returning id, klucz_s3, jezyk_zrodlowy, mime, rozmiar_b`,
      [id, technika_id, etap_id, jezyk, klucz, mime, bajtow]);
  } catch (e) {
    await fsp.rm(tymczasowy, { force: true });
    return odpowiedz(res, 403, { blad: czytelnyBlad(e) });
  }
  if (!rekord) { await fsp.rm(tymczasowy, { force: true }); return odpowiedz(res, 403, { blad: 'Nie masz uprawnień do tej techniki lub etapu.' }); }

  try { await magazyn.zapiszZTymczasowego(tymczasowy, klucz, mime); }
  catch (e) {
    await zapytaj(sesja.uid, `delete from public.glosowka where id=$1`, [rekord.id]).catch(()=>{});
    await fsp.rm(tymczasowy, { force: true }).catch(()=>{});
    return odpowiedz(res, 500, { blad: 'Nie udało się zapisać nagrania.' });
  }
  return odpowiedz(res, 200, { glosowka: rekord });
}

/* ══ POBIERANIE PLIKU ════════════════════════════════════════════
   Link jest podpisany i wygasa. Podpis sprawdzamy zawsze — tak samo
   działa podpisany adres w Supabase Storage. */
async function wydajPlik(res, u){ return magazyn.wydaj(res, u, odpowiedz); }

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

function zbudujSerwer(sesjaZ){
  return http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const sesja = await sesjaZ(req);

  if (u.pathname === '/api/material/plik' && req.method === 'POST')
    return wgrajPlik(req, res, u, sesja).catch(() =>
      odpowiedz(res, 500, { blad: 'Nie udało się wgrać pliku.' }));

  if (u.pathname === '/api/glosowka/plik' && req.method === 'POST')
    return wgrajGlosowke(req, res, u, sesja).catch(() =>
      odpowiedz(res, 500, { blad: 'Nie udało się wgrać nagrania.' }));

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
}

return { API, zapytaj, wTransakcji, profil, odpowiedz, zbudujSerwer, toOdmowa, czytelnyBlad, magazyn };
};
