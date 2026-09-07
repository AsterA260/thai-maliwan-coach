/**
 * AsterA Core — MAGAZYN PLIKÓW                                    [Etap 3]
 *
 * Jeden interfejs, trzy wcielenia:
 *
 *   MagazynDysk    katalog na dysku — serwer deweloperski (jak dotąd)
 *   MagazynS3      prywatny bucket, adresy podpisane — produkcja
 *   MagazynAtrapa  pamięć procesu z przełącznikiem awarii — testy sierot
 *
 * ZASADA 1 PLANU w praktyce: front nigdy nie dostaje poświadczeń AWS ani
 * nie wykonuje operacji na S3. Wgranie idzie PRZEZ Core (Core zapisuje
 * do bucketu swoją rolą IAM). Pobranie to krótkotrwały adres podpisany,
 * który Core wystawia dopiero po tym, jak baza (RLS) potwierdziła, że
 * pytający ma prawo do tego wiersza `material` / `glosowka`.
 *
 * Interfejs (wszystkie asynchroniczne):
 *   istnieje(klucz)                       → bool
 *   zapiszZTymczasowego(plikTmp, klucz, mime) — przenosi plik na miejsce
 *   usun(klucz)                           — bez błędu, gdy nie ma
 *   link(klucz, nazwa, sekundy)           → adres do pobrania (podpisany)
 *   wydaj(res, u)                         — tylko dysk: obsługa /plik
 *
 * KLUCZE — dwie konwencje, obie pilnowane także przez bazę
 * (`kurs_ze_sciezki`, `glosowka_z_klucza` w ograniczeniach CHECK):
 *   kurs/<uuid kursu>/<pdf|zdjecie|wideo|audio|inny>/<plik>
 *   glosowka/<technika|etap>/<uuid encji>/<uuid głosówki>.<ext>
 */
const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const RE_MATERIAL = new RegExp(`^kurs/${UUID}/(pdf|zdjecie|wideo|audio|inny)/[A-Za-z0-9._-]+$`);
const RE_GLOSOWKA = new RegExp(`^glosowka/(technika|etap)/${UUID}/${UUID}\\.[a-z0-9]{1,5}$`);

/** Klucz o dozwolonym kształcie, bez `..`, bez ukośników wiodących. */
function bezpiecznyKlucz(k) {
  return typeof k === 'string' && !k.includes('..') && !k.startsWith('/')
      && (RE_MATERIAL.test(k) || RE_GLOSOWKA.test(k));
}

/* ── DYSK ─────────────────────────────────────────────────────────── */
class MagazynDysk {
  constructor({ katalog, sekret }) { this.katalog = katalog; this.sekret = sekret; this.rodzaj = 'dysk'; }
  naDysku(k) { return path.join(this.katalog, k); }
  async istnieje(k) { return bezpiecznyKlucz(k) && fs.existsSync(this.naDysku(k)); }
  async zapiszZTymczasowego(tmp, k) {
    await fsp.mkdir(path.dirname(this.naDysku(k)), { recursive: true });
    await fsp.rename(tmp, this.naDysku(k));
  }
  async usun(k) { if (bezpiecznyKlucz(k)) await fsp.rm(this.naDysku(k), { force: true }); }
  async link(k, _nazwa, sekundy = 300) {
    const doKiedy = Date.now() + sekundy * 1000;
    const sig = crypto.createHmac('sha256', this.sekret).update(k + '|' + doKiedy).digest('hex');
    return `/plik?s=${encodeURIComponent(k)}&do=${doKiedy}&p=${sig}`;
  }
  linkWazny(k, doKiedy, sig) {
    if (!Number(doKiedy) || Number(doKiedy) < Date.now()) return false;
    const ocz = crypto.createHmac('sha256', this.sekret).update(k + '|' + doKiedy).digest('hex');
    const a = Buffer.from(String(sig)), b = Buffer.from(ocz);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  /** Obsługa /plik — odpowiednik pobrania z adresu podpisanego. */
  async wydaj(res, u, odpowiedz) {
    const k = u.searchParams.get('s') || '';
    if (!bezpiecznyKlucz(k)) return odpowiedz(res, 400, { blad: 'Nieprawidłowa ścieżka.' });
    if (!this.linkWazny(k, u.searchParams.get('do'), u.searchParams.get('p')))
      return odpowiedz(res, 403, { blad: 'Link wygasł albo jest nieprawidłowy.' });
    const f = this.naDysku(k);
    if (!fs.existsSync(f)) return odpowiedz(res, 404, { blad: 'Nie ma takiego pliku.' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'inline; filename="' + path.basename(f) + '"', 'Cache-Control': 'private, no-store' });
    fs.createReadStream(f).pipe(res);
  }
}

/* ── S3 ───────────────────────────────────────────────────────────── */
class MagazynS3 {
  constructor({ bucket, region }) {
    // Zależności ładowane leniwie — dev i testy lokalne nie potrzebują SDK.
    const s3 = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    this.s3 = s3; this.getSignedUrl = getSignedUrl;
    this.klient = new s3.S3Client({ region });
    this.bucket = bucket; this.rodzaj = 's3';
  }
  async istnieje(k) {
    if (!bezpiecznyKlucz(k)) return false;
    try { await this.klient.send(new this.s3.HeadObjectCommand({ Bucket: this.bucket, Key: k })); return true; }
    catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false; throw e; }
  }
  async zapiszZTymczasowego(tmp, k, mime) {
    if (!bezpiecznyKlucz(k)) throw new Error('Nieprawidłowy klucz.');
    const { size } = await fsp.stat(tmp);
    await this.klient.send(new this.s3.PutObjectCommand({
      Bucket: this.bucket, Key: k, Body: fs.createReadStream(tmp), ContentLength: size,
      ContentType: mime || 'application/octet-stream', ServerSideEncryption: 'AES256' }));
    await fsp.rm(tmp, { force: true });
  }
  async usun(k) {
    if (!bezpiecznyKlucz(k)) return;
    await this.klient.send(new this.s3.DeleteObjectCommand({ Bucket: this.bucket, Key: k }));
  }
  /** Adres podpisany, ważny `sekundy`; tylko GET; nazwa pliku do wyświetlenia. */
  async link(k, nazwa, sekundy = 300) {
    if (!bezpiecznyKlucz(k)) throw new Error('Nieprawidłowy klucz.');
    const bezpiecznaNazwa = String(nazwa || path.basename(k)).replace(/["\r\n\\]/g, '').slice(0, 120);
    return this.getSignedUrl(this.klient, new this.s3.GetObjectCommand({
      Bucket: this.bucket, Key: k,
      ResponseContentDisposition: `inline; filename="${bezpiecznaNazwa}"`,
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn: sekundy });
  }
  async wydaj(res, _u, odpowiedz) { odpowiedz(res, 404, { blad: 'Pliki wydaje magazyn, nie Core.' }); }
}

/* ── ATRAPA — do testów sierot i autoryzacji bez AWS ──────────────── */
class MagazynAtrapa {
  constructor() { this.obiekty = new Map(); this.rodzaj = 'atrapa'; this.awaria = null; this.dziennik = []; }
  async istnieje(k) { return this.obiekty.has(k); }
  async zapiszZTymczasowego(tmp, k, mime) {
    if (this.awaria === 'zapis') throw new Error('ATRAPA: awaria zapisu do magazynu');
    this.obiekty.set(k, { mime, bajtow: (await fsp.stat(tmp)).size });
    await fsp.rm(tmp, { force: true }); this.dziennik.push(['zapis', k]);
  }
  async usun(k) { this.obiekty.delete(k); this.dziennik.push(['usun', k]); }
  async link(k, nazwa, sekundy = 300) { return `atrapa://magazyn/${k}?wazny=${sekundy}&nazwa=${encodeURIComponent(nazwa || '')}`; }
  async wydaj(res, _u, odpowiedz) { odpowiedz(res, 404, { blad: 'Atrapa nie wydaje plików.' }); }
}

/** Wybór ze środowiska: S3_BUCKET → S3; inaczej dysk. */
function zeSrodowiska(env, { katalog, sekret }) {
  if (env.MAGAZYN === 'atrapa') return new MagazynAtrapa();
  if (env.S3_BUCKET) return new MagazynS3({ bucket: env.S3_BUCKET, region: env.AWS_REGION || env.COGNITO_REGION || 'eu-central-1' });
  return new MagazynDysk({ katalog, sekret });
}

module.exports = { MagazynDysk, MagazynS3, MagazynAtrapa, zeSrodowiska, bezpiecznyKlucz, RE_MATERIAL, RE_GLOSOWKA };
