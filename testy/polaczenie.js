/**
 * Jedno miejsce, z którego testy i serwer deweloperski biorą adres bazy.
 *
 *   DATABASE_URL ustawione  → ta baza (Aurora, RDS Proxy, cokolwiek),
 *                             z TLS — bo poza maszyną hasło idzie po sieci.
 *   DATABASE_URL puste      → lokalny PostgreSQL deweloperski po sockecie.
 *
 * Hasła nie ma w żadnym pliku repozytorium: przychodzi w DATABASE_URL
 * ze środowiska, a to środowisko wypełnia się z menedżera sekretów
 * w chwili uruchomienia — patrz narzedzia/aurora-url.sh.       [Etap 1b]
 */
const URL = process.env.DATABASE_URL;

const DB = URL
  ? { connectionString: URL, ssl: { rejectUnauthorized: false } }
  : { host: '/tmp', port: 5433, user: 'postgres', database: 'coach' };

// `rejectUnauthorized:false` na etapie testów: Aurora podaje certyfikat
// z łańcucha Amazon RDS, którego kontener nie ma w magazynie zaufanych.
// Przed produkcją: pobrać bundle RDS i ustawić `ca` — zanotowane w §8.

module.exports = { DB, zdalna: !!URL };
