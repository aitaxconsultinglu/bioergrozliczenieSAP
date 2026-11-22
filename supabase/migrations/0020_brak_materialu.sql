-- Braki (dział handlowy, 2026-11-21): materiał można oznaczyć jako brak - nie jest sprzedawany w tym
-- zleceniu (zamawiający nie założył go w zamówieniu), w eksporcie XLSX pokazuje się na czerwono.
-- Braki godzin od teraz liczą się per komórka siatki (stanowisko x pora) - bez zmian w schemacie,
-- braki_godzin.cennik_pozycja_id wskazuje już konkretną stawkę.
alter table public.pozycje_materialowe add column if not exists brak boolean not null default false;

do $do$
declare
  d text := pg_get_functiondef('public.zapisz_zlecenie(jsonb, timestamptz)'::regprocedure);
  n integer;
  znacznik constant text := $s$coalesce((v_el ->> 'brak')::boolean, false)$s$;
begin
  if position(znacznik in d) > 0 then
    return; -- już zastosowane
  end if;
  d := replace(d, $s$insert into pozycje_materialowe (zlecenie_id, nazwa, ilosc, jm, wartosc_zakupu, dostawca, narzut_proc,
                                       numer_faktury, kolejnosc)$s$, $s$insert into pozycje_materialowe (zlecenie_id, nazwa, ilosc, jm, wartosc_zakupu, dostawca, narzut_proc,
                                       numer_faktury, kolejnosc, brak)$s$);
  d := replace(d, $s$nullif(v_el ->> 'numer_faktury', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0));$s$, $s$nullif(v_el ->> 'numer_faktury', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0), coalesce((v_el ->> 'brak')::boolean, false));$s$);
  d := replace(d, $s$        numer_faktury = nullif(v_el ->> 'numer_faktury', ''),
        kolejnosc = coalesce((v_el ->> 'kolejnosc')::int, 0)
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id;$s$, $s$        numer_faktury = nullif(v_el ->> 'numer_faktury', ''),
        kolejnosc = coalesce((v_el ->> 'kolejnosc')::int, 0),
        brak = coalesce((v_el ->> 'brak')::boolean, false)
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id;$s$);
  n := (length(d) - length(replace(d, znacznik, ''))) / length(znacznik);
  if n <> 2 or position('numer_faktury, kolejnosc, brak)' in d) = 0 then
    raise exception 'zapisz_zlecenie: nie udało się dopisać pola brak (trafień: %)', n;
  end if;
  execute d;
end
$do$;
