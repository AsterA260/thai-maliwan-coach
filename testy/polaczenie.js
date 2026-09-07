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
 *
 * TLS. Sterownik `pg` traktuje `sslmode=require` w adresie jak
 * `verify-full` i odrzuca certyfikat Amazon RDS, którego system nie zna.
 * Dlatego parametr `sslmode` jest z adresu ZDEJMOWANY, a TLS ustawiany
 * wprost:
 *   PGSSLROOTCERT=/sciezka/global-bundle.pem → pełna weryfikacja (Aurora),
 *   brak                                     → szyfrowanie bez weryfikacji
 *                                              wystawcy (tylko do testów).
 * Bundle RDS: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
 */
const fs = require('fs');

const URL = process.env.DATABASE_URL;
const CA  = process.env.PGSSLROOTCERT;

function bezSslmode(u) {
  const x = new (require('url').URL)(u);
  x.searchParams.delete('sslmode');
  return x.toString();
}

/** Konfiguracja dla PODANEGO adresu (Core dostaje adres ze swojego env). */
function zUrl(url, ca = CA) {
  return url
    ? { connectionString: bezSslmode(url),
        ssl: ca ? { ca: fs.readFileSync(ca, 'utf8'), rejectUnauthorized: true }
                : { rejectUnauthorized: false } }
    : { host: '/tmp', port: 5433, user: 'postgres', database: 'coach' };
}
const DB = zUrl(URL);

module.exports = { DB, zUrl, zdalna: !!URL, weryfikacjaTls: !!CA };
