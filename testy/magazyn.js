#!/usr/bin/env node
/**
 * AsterA Coach — MAGAZYN: S1–S7 przez Core, głosówki, sieroty        [Etap 3]
 *
 * Dwa tryby, jeden zestaw asercji:
 *   lokalnie  — Core + atrapa Cognito + MagazynAtrapa (przełącznik awarii)
 *   na żywo   — MAGAZYN_TEST=s3: prawdziwy bucket, prawdziwe adresy
 *               podpisane; S1 sprawdzany dodatkowo z zewnątrz (anonimowy
 *               GET do bucketu musi dostać 403)
 *
 * Odpowiedniki listy z testy/oczekujace.md:
 *   S1 bucket prywatny            S5 kursant nie pobierze cudzego pliku
 *   S2 uprawnienia jak lokalnie   S6 wgranie pod ścieżkę cudzego kursu odrzucone
 *   S3 link tylko po polityce     S7 nieudany zapis metadanych — bez sieroty
 *   S4 link wygasa
 *   G1–G3 głosówki: klucz zgodny z encją (także w bazie), autoryzacja, link
 */
const fs = require('fs');
const { Client } = require('pg');
const { AtrapaCognito } = require('./cognito_atrapa');
const { TozsamoscAtrapa } = require('../serwer/tozsamosc');
const { MagazynAtrapa, MagazynS3 } = require('../serwer/magazyn');
const { uruchomCore } = require('../serwer/core');

const NA_ZYWO = process.env.MAGAZYN_TEST === 's3';
const BUCKET  = process.env.S3_BUCKET;
const KTO = { norbert: '11111111-1111-1111-1111-111111111111', maliwan: '22222222-2222-2222-2222-222222222222',
              ania: '33333333-3333-3333-3333-333333333333', piotr: '44444444-4444-4444-4444-444444444444' };
const KURS = { podstawowy: 'aaaaaaaa-0000-0000-0000-000000000001', mistrzowski: 'aaaaaaaa-0000-0000-0000-000000000002' };

let wyniki = [];
function sprawdz(nr, opis, ok, szczegol) {
  wyniki.push(!!ok);
  console.log(`${ok ? '  ZDANY ' : '  BŁĄD  '} ${String(nr).padStart(3)}. ${opis}`);
  if (szczegol) console.log(`           ${szczegol}`);
}

(async () => {
  console.log(`\n═══ MAGAZYN — ${NA_ZYWO ? 'S3 NA ŻYWO: ' + BUCKET : 'ATRAPA (lokalnie)'} ═══`);
  const db = new Client(require('./polaczenie').DB); await db.connect();
  const cognito = new AtrapaCognito(); await cognito.uruchom();
  const magazyn = NA_ZYWO ? new MagazynS3({ bucket: BUCKET, region: process.env.AWS_REGION || 'eu-central-1' })
                          : new MagazynAtrapa();
  const core = uruchomCore({ tozsamosc: new TozsamoscAtrapa(), magazyn,
    env: { ...cognito.srodowisko(), PORT: '0', CORE_TOZSAMOSC: 'atrapa',
           DATABASE_URL: process.env.DATABASE_URL_API || process.env.DATABASE_URL || '' } });
  const port = await core.start(); const CORE = `http://127.0.0.1:${port}`;
  const tok = sub => cognito.token(sub, { uzycie: 'access' });

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2000, 7)]);
  async function wgraj(sub, sc, q, cialo, mime) {
    const r = await fetch(`${CORE}${sc}?${new URLSearchParams(q)}`, { method: 'POST',
      headers: { Authorization: 'Bearer ' + tok(sub), 'Content-Type': mime }, body: cialo });
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  const zadanie = async (sc, sub, dane) => {
    const r = await fetch(CORE + sc, { method: dane ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + tok(sub), ...(dane ? { 'Content-Type': 'application/json' } : {}) },
      body: dane ? JSON.stringify(dane) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const posprzataj = [];

  /* ── S2/S6: instruktorka wgrywa do swojego kursu; cudzy kurs — odrzucony ── */
  const w1 = await wgraj(KTO.maliwan, '/api/material/plik', { kurs_id: KURS.mistrzowski, typ: 'pdf', nazwa: 'Mapa stref S3', plik: 'mapa.pdf' }, pdf, 'application/pdf');
  const mat = w1.json?.material; if (mat) posprzataj.push(mat.sciezka);
  const w2 = await wgraj(KTO.ania, '/api/material/plik', { kurs_id: KURS.podstawowy, typ: 'pdf', nazwa: 'Kursantka próbuje', plik: 'x.pdf' }, pdf, 'application/pdf');
  const wObiektach = k => magazyn.istnieje(k);
  sprawdz('S2', 'Instruktorka wgrywa materiał do swojego kursu; plik jest w magazynie pod kluczem kurs/<uuid>/pdf/…',
    w1.status === 200 && mat && /^kurs\/aaaaaaaa-0000-0000-0000-000000000002\/pdf\//.test(mat.sciezka) && await wObiektach(mat.sciezka),
    `status ${w1.status} · klucz ${mat?.sciezka}`);
  sprawdz('S6', 'Kursantka nie wgra pliku pod ścieżkę kursu (nie ma uprawnień do zapisu) — i nic nie ląduje w magazynie',
    w2.status === 403 && !(magazyn.dziennik || []).some(([op, k]) => op === 'zapis' && /Kursantka|x\.pdf/.test(k)),
    `status ${w2.status}`);

  /* ── S3/S5: link tylko po polityce; kursant spoza kursu — 403 ── */
  await zadanie('/api/material/publikuj', KTO.maliwan, { id: mat.id, opublikowany: true });
  const l1 = await zadanie(`/api/material/link?id=${mat.id}`, KTO.piotr);      // zapisany na mistrzowski
  const l2 = await zadanie(`/api/material/link?id=${mat.id}`, KTO.ania);       // nie zapisana
  const l3 = await zadanie(`/api/material/link?id=${mat.id}`, KTO.maliwan);
  sprawdz('S3', 'Adres podpisany powstaje wyłącznie po tym, jak RLS oddał wiersz: zapisany kursant i instruktorka — tak',
    l1.status === 200 && l1.json.link && l1.json.wazny_s === 300 && l3.status === 200,
    `Piotr: ${l1.status} · Maliwan: ${l3.status} · wazny_s: ${l1.json?.wazny_s}`);
  sprawdz('S5', 'Kursantka spoza kursu nie dostaje adresu — 403, bez linku',
    l2.status === 403 && !l2.json?.link, `Ania: ${l2.status}`);

  /* ── S1/S4 na żywo: bucket prywatny, link działa, wygasa ─────── */
  if (NA_ZYWO) {
    const anon = await fetch(`https://${BUCKET}.s3.eu-central-1.amazonaws.com/${mat.sciezka}`);
    const przez = await fetch(l1.json.link);
    const tresc = Buffer.from(await przez.arrayBuffer());
    const krotki = await magazyn.link(mat.sciezka, 'x.pdf', 1);
    await new Promise(r => setTimeout(r, 2500));
    const poCzasie = await fetch(krotki);
    sprawdz('S1', 'Bucket jest prywatny: anonimowy GET obiektu → 403; adres podpisany → 200 i te same bajty',
      anon.status === 403 && przez.status === 200 && tresc.equals(pdf) && /x-amz-server-side-encryption/i.test([...przez.headers.keys()].join(',')),
      `anonimowo: ${anon.status} · podpisany: ${przez.status} · bajty zgodne: ${tresc.equals(pdf)} · SSE: ${przez.headers.get('x-amz-server-side-encryption')}`);
    sprawdz('S4', 'Adres podpisany wygasa — po upływie ważności S3 odmawia',
      poCzasie.status === 403, `po wygaśnięciu: ${poCzasie.status}`);
  } else {
    sprawdz('S1', 'Bucket prywatny — sprawdzane na żywo (MAGAZYN_TEST=s3); lokalnie: front nie zna magazynu, link idzie z Core',
      typeof l1.json.link === 'string' && !/AKIA|Signature=/.test(JSON.stringify(w1.json)), 'lokalnie: adres z atrapy, bez poświadczeń w odpowiedziach');
    sprawdz('S4', 'Link wygasa — sprawdzane na żywo; lokalnie: Core wystawia link z czasem ważności 300 s', l1.json.wazny_s === 300, 'wazny_s=300');
  }

  /* ── S7: nieudany zapis metadanych → bez sieroty; awaria magazynu → bez rekordu ── */
  //  (a) metadane odrzucone przez bazę (ścieżka niezgodna z kursem nie może
  //      powstać w Core, więc wymuszamy odmowę RLS: kursantka)  → w magazynie nic
  const przedA = NA_ZYWO ? null : magazyn.obiekty.size;
  const s7a = await wgraj(KTO.ania, '/api/material/plik', { kurs_id: KURS.mistrzowski, typ: 'pdf', nazwa: 'Sierota A', plik: 'a.pdf' }, pdf, 'application/pdf');
  const poA = NA_ZYWO ? null : magazyn.obiekty.size;
  //  (b) magazyn odmawia zapisu → rekord w bazie musi zniknąć
  let s7b = { status: 0 }, rekordPoAwarii = 1;
  if (!NA_ZYWO) {
    magazyn.awaria = 'zapis';
    s7b = await wgraj(KTO.maliwan, '/api/material/plik', { kurs_id: KURS.mistrzowski, typ: 'pdf', nazwa: 'Sierota B', plik: 'b.pdf' }, pdf, 'application/pdf');
    magazyn.awaria = null;
    rekordPoAwarii = (await db.query(`select count(*)::int n from public.material m join public.material_tekst t on t.material_id=m.id where t.nazwa='Sierota B'`)).rows[0].n;
  } else {
    // na żywo: awarię magazynu symulujemy kluczem, którego rola runnera nie ma prawa zapisać (inny bucket)
    const obcy = new MagazynS3({ bucket: BUCKET + '-nie-istnieje', region: 'eu-central-1' });
    const core2 = uruchomCore({ tozsamosc: new TozsamoscAtrapa(), magazyn: obcy,
      env: { ...cognito.srodowisko(), PORT: '0', CORE_TOZSAMOSC: 'atrapa', DATABASE_URL: process.env.DATABASE_URL_API } });
    const p2 = await core2.start();
    const r = await fetch(`http://127.0.0.1:${p2}/api/material/plik?${new URLSearchParams({ kurs_id: KURS.mistrzowski, typ: 'pdf', nazwa: 'Sierota B', plik: 'b.pdf' })}`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + tok(KTO.maliwan), 'Content-Type': 'application/pdf' }, body: pdf });
    s7b = { status: r.status }; await core2.stop();
    rekordPoAwarii = (await db.query(`select count(*)::int n from public.material m join public.material_tekst t on t.material_id=m.id where t.nazwa='Sierota B'`)).rows[0].n;
  }
  sprawdz('S7', 'Nieudany zapis metadanych nie zostawia sieroty w magazynie; awaria magazynu nie zostawia rekordu w bazie',
    s7a.status === 403 && (NA_ZYWO || poA === przedA) && s7b.status === 500 && rekordPoAwarii === 0,
    `metadane odrzucone: ${s7a.status}, obiektów przed/po: ${przedA ?? '-'}/${poA ?? '-'} · awaria magazynu: ${s7b.status}, rekordów „Sierota B" w bazie: ${rekordPoAwarii}`);

  /* ── G1–G3: głosówki ─────────────────────────────────────────── */
  const { rows: [tech] } = await db.query(`select id from public.technika limit 1`);
  let technikaId = tech?.id;
  if (!technikaId) {
    await db.query('begin'); await db.query('set local role astera_seed'); await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
    technikaId = (await db.query(`insert into public.technika (kod) values ('test-magazyn-'||floor(random()*1e6)) returning id`)).rows[0].id;
    await db.query('commit');
  }
  const { rows: [etapPodst] } = await db.query(`select e.id from public.etap e join public.lekcja l on l.id=e.lekcja_id where l.kurs_id=$1 limit 1`, [KURS.podstawowy]);
  const g1 = await wgraj(KTO.maliwan, '/api/glosowka/plik', { etap_id: etapPodst.id, jezyk: 'th', plik: 'nagranie.mp3' }, mp3, 'audio/mpeg');
  const gl = g1.json?.glosowka; if (gl) posprzataj.push(gl.klucz_s3);
  const g2 = await wgraj(KTO.ania, '/api/glosowka/plik', { etap_id: etapPodst.id, jezyk: 'th', plik: 'x.mp3' }, mp3, 'audio/mpeg');
  const g3 = await wgraj(KTO.maliwan, '/api/glosowka/plik', { technika_id: technikaId, etap_id: etapPodst.id, jezyk: 'th', plik: 'x.mp3' }, mp3, 'audio/mpeg');
  sprawdz('G1', 'Instruktorka wgrywa głosówkę do etapu: klucz glosowka/etap/<uuid etapu>/<uuid>.mp3 zgodny z encją; kursantka — nie',
    g1.status === 200 && gl && gl.klucz_s3 === `glosowka/etap/${etapPodst.id}/${gl.id}.mp3` && await wObiektach(gl.klucz_s3) && g2.status === 403,
    `instruktorka: ${g1.status} (${gl?.klucz_s3}) · kursantka: ${g2.status}`);
  sprawdz('G2', 'Technika i etap naraz → odrzucone zanim cokolwiek trafi do magazynu', g3.status === 400, `status ${g3.status}`);
  // baza pilnuje klucza także wtedy, gdy Core by się pomylił: wstawiamy rekord z kluczem innej encji
  let zlyKlucz;
  // Jako astera_seed (omija RLS) — żeby odrzucenie pochodziło z ograniczenia
  // CHECK, a nie z polityki. Polityki sprawdza G1; tu chodzi o ostatnią linię obrony.
  await db.query('begin'); await db.query('set local role astera_seed');
  await db.query(`select set_config('astera.inicjalizacja','tak',true)`);
  try {
    await db.query(`insert into public.glosowka (technika_id, jezyk_zrodlowy, klucz_s3, nagral_id)
                    values ($1,'th',$2,$3)`,
      [technikaId, `glosowka/etap/${etapPodst.id}/99999999-0000-0000-0000-000000000009.mp3`, KTO.maliwan]);
    zlyKlucz = 'PRZESZŁO — ŹLE';
  } catch (e) { zlyKlucz = e.message.split('\n')[0]; }
  await db.query('rollback');
  const linkG = await zadanie(`/api/glosowka/link?id=${gl.id}`, KTO.ania);          // Ania jest na kursie podstawowym
  const linkGobcy = await zadanie(`/api/glosowka/link?id=${gl.id}`, KTO.piotr);     // Piotr nie
  sprawdz('G3', 'Baza odrzuca klucz wskazujący inną encję (także gdy Core by się pomylił); link do głosówki dostaje tylko kursant tego kursu',
    /glosowka_klucz_zgodny/.test(zlyKlucz) && linkG.status === 200 && linkG.json.link && linkGobcy.status === 403,
    `klucz cudzej encji: ${zlyKlucz.slice(0, 70)} · Ania: ${linkG.status} · Piotr: ${linkGobcy.status}`);

  /* sprzątanie */
  if (mat) await zadanie('/api/material/usun', KTO.maliwan, { id: mat.id });
  if (gl)  await zadanie('/api/glosowka/usun', KTO.maliwan, { id: gl.id });
  const zostalo = [];
  for (const k of posprzataj) if (await magazyn.istnieje(k)) zostalo.push(k);
  sprawdz('S8', 'Usunięcie materiału i głosówki przez Core kasuje też obiekty w magazynie', zostalo.length === 0,
    zostalo.length ? `ZOSTAŁO: ${zostalo.join(', ')}` : `sprawdzone klucze: ${posprzataj.length}`);
  await db.query(`delete from public.technika where kod like 'test-magazyn-%'`);
  await core.stop(); cognito.zatrzymaj(); await db.end();
  const zd = wyniki.filter(Boolean).length;
  console.log(`\n═══ MAGAZYN: ${zd} / ${wyniki.length} ═══`);
  process.exit(zd === wyniki.length ? 0 : 1);
})().catch(e => { console.error('BŁĄD URUCHOMIENIA:', e.stack || e.message); process.exit(2); });
