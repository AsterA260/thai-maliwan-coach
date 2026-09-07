/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — konfiguracja frontu

   TEN PLIK JEST GENEROWANY. Nie wpisuj tu nic ręcznie na produkcji —
   uruchom `npm run konfig`, które zbuduje go z pliku .env.

   Puste wszystko         = tryb lokalny (serwer deweloperski /api/*).
   CORE_URL + Cognito     = tryb AWS (docelowy).
   SUPABASE_URL + klucz   = tryb Supabase (prototyp, ścieżka wycofania).

   Trafiają tu WYŁĄCZNIE wartości jawne, widoczne i tak w każdym
   zapytaniu przeglądarki: adres projektu i klucz PUBLICZNY
   (`sb_publishable_…`, albo starszy `anon`). Klucz sekretny
   (`sb_secret_…` / `service_role`) omija RLS i NIE MOŻE znaleźć się
   w żadnym pliku frontu — generator go pomija i sprawdza wynik.
   ═══════════════════════════════════════════════════════════════════ */
window.KONFIG = {
  SUPABASE_URL:             '',
  SUPABASE_PUBLISHABLE_KEY: '',
  SUPABASE_ANON_KEY:        '',
  SUPABASE_BUCKET:          'materialy',
  ADRES_APLIKACJI:          '',
  // Tryb AWS (Etap 2): wszystkie trzy to dane PUBLICZNE — adres Core
  // i identyfikatory puli/klienta Cognito. Żadnych sekretów, nigdy.
  CORE_URL:                 '',
  COGNITO_POOL_ID:          '',
  COGNITO_CLIENT_ID:        '',
};
