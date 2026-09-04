#!/usr/bin/env node
/**
 * Zakłada TESTOWY projekt Supabase na planie darmowym i przygotowuje .env
 *
 *     npm run projekt:testowy
 *
 * CZEGO POTRZEBUJE. Jednego pliku `.supabase-token` w katalogu projektu,
 * z osobistym tokenem dostępu (Supabase → Account → Access Tokens →
 * Generate new token). Plik jest w `.gitignore`.
 *
 * CZEGO NIE ROBI. Nie zakłada konta Supabase — konto zakłada człowiek.
 * Nie wypisuje żadnego klucza ani tokenu: ani na ekran, ani do raportu.
 * Klucze trafiają wyłącznie do `.env` z prawami 600.
 *
 * Po sukcesie wypisuje adres projektu (jawny, jest w każdym zapytaniu
 * przeglądarki) i mówi, co uruchomić dalej.
 */
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const KATALOG = path.join(__dirname, '..');
const API     = 'https://api.supabase.com/v1';

const NAZWA  = process.env.NAZWA_PROJEKTU || 'astera-coach-test';
const REGION = process.env.REGION_PROJEKTU || 'eu-central-1';   // Frankfurt — dane w UE

function token() {
  const zPliku = path.join(KATALOG, '.supabase-token');
  const t = process.env.SUPABASE_PAT ||
    (fs.existsSync(zPliku) ? fs.readFileSync(zPliku, 'utf8').trim() : '');
  if (!t) {
    console.error(
      'Brak osobistego tokenu dostępu.\n' +
      'Supabase → Account → Access Tokens → Generate new token,\n' +
      `potem zapisz go do pliku: ${zPliku}\n` +
      '(plik jest w .gitignore i nigdzie nie jest wypisywany)');
    process.exit(2);
  }
  return t;
}

async function api(sciezka, { metoda = 'GET', dane } = {}) {
  const o = { method: metoda, headers: {
    Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' } };
  if (dane) o.body = JSON.stringify(dane);
  const r = await fetch(API + sciezka, o);
  const tekst = await r.text();
  let json = null; try { json = JSON.parse(tekst); } catch {}
  if (r.status >= 300) {
    // komunikat błędu może zawierać dane organizacji, ale nigdy kluczy
    throw new Error(`${metoda} ${sciezka} → ${r.status}: ${tekst.slice(0, 300)}`);
  }
  return json;
}

const spij = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('Zakładam testowy projekt Supabase (plan darmowy)…\n');

  /* ── ORGANIZACJA — zawsze wskazana wprost ──────────────────────
     Nigdy „pierwsza z brzegu": na koncie może być organizacja firmowa
     obok prywatnej, a projekt założony w niepowołanym miejscu to
     rachunek i dane w cudzym rozliczeniu.                            */
  const organizacje = await api('/organizations');
  if (!organizacje.length) { console.error('Konto nie ma żadnej organizacji.'); process.exit(1); }

  const wskazana = process.env.ORG_SUPABASE || '';
  const org = wskazana
    ? organizacje.find(o => o.id === wskazana || o.name === wskazana ||
                            o.slug === wskazana)
    : null;

  if (!org) {
    console.error(wskazana
      ? `\nNie znalazłem organizacji „${wskazana}".`
      : '\nNie wskazano organizacji — nie wybieram jej za Ciebie.');
    console.error('\nDostępne organizacje na tym koncie:\n');
    for (const o of organizacje)
      console.error(`  ${o.name}${o.slug ? `  (slug: ${o.slug})` : ''}\n      id: ${o.id}`);
    console.error('\nUruchom ponownie, wskazując organizację nazwą, slugiem albo id:\n');
    console.error(`  ORG_SUPABASE="${organizacje[0].name}" npm run projekt:testowy\n`);
    process.exit(2);
  }
  console.log(`organizacja: ${org.name} (${org.id})`);

  const istnieje = (await api('/projects')).find(p => p.name === NAZWA);
  let projekt = istnieje;
  if (istnieje) {
    console.log(`projekt „${NAZWA}" już istnieje — używam go, nie zakładam drugiego`);
  } else {
    const hasloBazy = crypto.randomBytes(24).toString('base64url');
    projekt = await api('/projects', { metoda: 'POST', dane: {
      name: NAZWA, organization_id: org.id, region: REGION,
      db_pass: hasloBazy, plan: 'free' } });
    fs.writeFileSync(path.join(KATALOG, '.haslo-bazy-testowej'), hasloBazy + '\n', { mode: 0o600 });
    console.log(`projekt założony: ${projekt.id} (region ${REGION})`);
    console.log('hasło do bazy zapisane w .haslo-bazy-testowej (plik 600, w .gitignore)');
  }

  /* ── CZEKANIE — z twardym końcem ──────────────────────────────
     Po limicie czasu KOŃCZYMY BŁĘDEM. Wcześniej pętla po prostu się
     wyczerpywała i skrypt szedł dalej po klucze do projektu, który
     jeszcze nie wstał — a to kończyłoby się mylącym błędem kilka
     linijek później.                                                */
  const LIMIT_PROB = 60, ODSTEP_MS = 5000;         // ~5 minut
  process.stdout.write('czekam, aż projekt wstanie');
  let gotowy = false, ostatniStan = 'nieznany';
  for (let i = 0; i < LIMIT_PROB; i++) {
    const p = await api(`/projects/${projekt.id}`);
    ostatniStan = p.status;
    if (p.status === 'ACTIVE_HEALTHY') { console.log(' — gotowy'); gotowy = true; break; }
    if (['INACTIVE', 'INIT_FAILED', 'REMOVED', 'RESTORE_FAILED'].includes(p.status)) {
      console.error(`\nProjekt zatrzymał się w stanie ${p.status}. Sprawdź panel Supabase.`);
      process.exit(1);
    }
    process.stdout.write('.');
    await spij(ODSTEP_MS);
  }
  if (!gotowy) {
    console.error(`\nBŁĄD: projekt nie wstał w ciągu ${LIMIT_PROB * ODSTEP_MS / 60000} minut.`);
    console.error(`Ostatni stan: ${ostatniStan}. Projekt ${projekt.id} istnieje — sprawdź panel`);
    console.error('i uruchom to polecenie ponownie, gdy będzie ACTIVE_HEALTHY.');
    process.exit(1);
  }

  const klucze = await api(`/projects/${projekt.id}/api-keys?reveal=true`);
  const publ = klucze.find(k => k.type === 'publishable' || k.name === 'anon');
  const sekr = klucze.find(k => k.type === 'secret'      || k.name === 'service_role');
  if (!publ || !sekr) { console.error('Nie dostałem kompletu kluczy z API.'); process.exit(1); }

  const adres = `https://${projekt.id}.supabase.co`;
  const env = [
    '# Wygenerowane przez `npm run projekt:testowy`. NIE commitować.',
    `SUPABASE_URL=${adres}`,
    `SUPABASE_PUBLISHABLE_KEY=${publ.api_key}`,
    `SUPABASE_SECRET_KEY=${sekr.api_key}`,
    'SUPABASE_BUCKET=materialy',
    `ADRES_APLIKACJI=${process.env.ADRES_APLIKACJI || 'http://127.0.0.1:8910'}`,
    'E2E_DOMENA=e2e.przyklad.pl',
    '', '# serwer deweloperski',
    'PORT=8910', 'SEKRET_SESJI=', '',
  ].join('\n');
  fs.writeFileSync(path.join(KATALOG, '.env'), env, { mode: 0o600 });

  console.log(`\nadres projektu: ${adres}`);
  console.log('klucze zapisane w .env (prawa 600) — nie pokazuję ich i nie loguję\n');
  console.log('Dalej:');
  console.log('  1. wgraj db/01_schema.sql, db/02_rls.sql, db/03_storage.sql w SQL Editor');
  console.log('  2. Storage → New bucket → `materialy`, Public: WYŁĄCZONE');
  console.log('  3. supabase functions deploy zapros --project-ref ' + projekt.id);
  console.log('  4. Authentication → URL Configuration → Redirect URLs (patrz URUCHOMIENIE.md §2.5)');
  console.log('  5. npm run konfig && npm run e2e');
  console.log('\n  Przy pierwszym `npm run e2e` skrypt zatrzyma się i poda jedną komendę');
  console.log('  do SQL Editora (`select public.ustanow_pierwszego_admina(...)`). Tak ma być —');
  console.log('  roli admin nie nadaje się kluczem sekretnym.');
})().catch(e => { console.error('\nBŁĄD:', e.message); process.exit(1); });
