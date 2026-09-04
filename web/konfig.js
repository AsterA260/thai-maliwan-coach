/* ═══════════════════════════════════════════════════════════════════
   AsterA Coach — konfiguracja frontu

   TEN PLIK JEST GENEROWANY. Nie wpisuj tu nic ręcznie na produkcji —
   uruchom `npm run konfig`, które zbuduje go z pliku .env.

   Puste SUPABASE_URL = tryb lokalny (serwer deweloperski /api/*).
   Uzupełnione       = tryb produkcyjny (Supabase).

   Trafiają tu WYŁĄCZNIE wartości jawne, widoczne i tak w każdym
   zapytaniu przeglądarki. Klucz `service_role` omija RLS i NIE MOŻE
   znaleźć się w żadnym pliku frontu — żyje tylko w sekretach Supabase,
   po stronie Edge Function.
   ═══════════════════════════════════════════════════════════════════ */
window.KONFIG = {
  SUPABASE_URL:      '',
  SUPABASE_ANON_KEY: '',
  SUPABASE_BUCKET:   'materialy',
  ADRES_APLIKACJI:   '',
};
