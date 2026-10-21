-- Nowy status "Braki zgłoszone do SAP" (dział handlowy, 2026-10-21): zlecenie wyeksportowane, ale braki
-- (np. godzin) zgłoszone w SAP i czekają na uzupełnienie. Leży między "wyeksportowany" a "zakonczony".
-- Wartość enuma musi być dodana w osobnej transakcji, zanim użyją jej funkcje (0016).
alter type public.status_zlecenia add value if not exists 'braki_zgloszone' before 'zakonczony';
