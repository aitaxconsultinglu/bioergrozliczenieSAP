-- Brak materiału jako ILOŚĆ (dział handlowy, 2026-11-25): np. wirnik 3 szt., zamawiający założył 2 -> brak 1 szt.
-- Do sprzedaży idzie ilość minus brak, wartość dzielona proporcjonalnie. Kolumna brak (bool) zostaje
-- jako pochodna (brak_ilosc > 0) dla zgodności.
alter table public.pozycje_materialowe add column if not exists brak_ilosc numeric(12,3) not null default 0;
alter table public.pozycje_materialowe drop constraint if exists pozycje_materialowe_brak_ilosc_check;
alter table public.pozycje_materialowe add constraint pozycje_materialowe_brak_ilosc_check check (brak_ilosc >= 0);
update public.pozycje_materialowe set brak_ilosc = ilosc where brak and brak_ilosc = 0;

do $do$
declare
  d text := pg_get_functiondef('public.zapisz_zlecenie(jsonb, timestamptz)'::regprocedure);
  n integer;
  znacznik constant text := $s$coalesce((v_el ->> 'brak_ilosc')::numeric, 0)$s$;
begin
  if position(znacznik in d) > 0 then
    return; -- już zastosowane
  end if;
  d := replace(d, $s$numer_faktury, kolejnosc, brak)$s$, $s$numer_faktury, kolejnosc, brak, brak_ilosc)$s$);
  d := replace(d, $s$coalesce((v_el ->> 'kolejnosc')::int, 0), coalesce((v_el ->> 'brak')::boolean, false));$s$,
    $s$coalesce((v_el ->> 'kolejnosc')::int, 0), coalesce((v_el ->> 'brak_ilosc')::numeric, 0) > 0, coalesce((v_el ->> 'brak_ilosc')::numeric, 0));$s$);
  d := replace(d, $s$        brak = coalesce((v_el ->> 'brak')::boolean, false)$s$,
    $s$        brak = coalesce((v_el ->> 'brak_ilosc')::numeric, 0) > 0,
        brak_ilosc = coalesce((v_el ->> 'brak_ilosc')::numeric, 0)$s$);
  n := (length(d) - length(replace(d, znacznik, ''))) / length(znacznik);
  if n <> 4 or position('kolejnosc, brak, brak_ilosc)' in d) = 0 then
    raise exception 'zapisz_zlecenie: nie udało się dopisać pola brak_ilosc (trafień: %)', n;
  end if;
  execute d;
end
$do$;
