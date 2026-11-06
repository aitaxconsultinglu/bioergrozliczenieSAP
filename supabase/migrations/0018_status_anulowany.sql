-- Status "anulowany" (2026-11-06): zlecenie odwołane - zostaje w historii, ale nie jest rozliczane.
-- Wartość enuma w osobnej transakcji, zanim użyją jej funkcje (0019).
alter type public.status_zlecenia add value if not exists 'anulowany' after 'zakonczony';
