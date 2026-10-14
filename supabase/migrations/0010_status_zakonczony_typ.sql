-- 0010: nowy status "zakonczony" - zlecenie wyeksportowane do SAP i zamkniete po stronie Bioerg
-- (np. rozliczone/zafakturowane). Osobna migracja: nowej wartosci enuma nie mozna uzyc
-- w tej samej transakcji, w ktorej zostala dodana (funkcje i polityki sa w 0011).
alter type public.status_zlecenia add value if not exists 'zakonczony' after 'wyeksportowany';
alter table public.zlecenia add column if not exists zakonczono timestamptz;
