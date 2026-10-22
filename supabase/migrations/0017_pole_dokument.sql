-- Pole "Dokument" w nagłówku zlecenia (prośba 2026-10-22): kierownik wpisuje, jaki dokument jest potrzebny
-- do rozliczenia (karta remontowa / jej numer, protokół z wyważania, pomiarów...), a dział handlowy od razu
-- widzi na liście, czego brakuje. Zwykły tekst, edytowalny tak jak reszta nagłówka.
alter table public.zlecenia add column if not exists dokument text;

-- zapisz_zlecenie: dopisanie kolumny do insert/update bez przepisywania całej funkcji z 0012.
do $do$
declare
  d text := pg_get_functiondef('public.zapisz_zlecenie(jsonb, timestamptz)'::regprocedure);
  n integer;
begin
  if position('dokument' in d) > 0 then
    return; -- już zastosowane
  end if;
  d := replace(d, 'uwagi, linia_uslugi, linia_materialy)', 'uwagi, linia_uslugi, linia_materialy, dokument)');
  d := replace(d, $s$nullif(p ->> 'linia_materialy', '')::int)
    returning id into v_id;$s$, $s$nullif(p ->> 'linia_materialy', '')::int, nullif(trim(p ->> 'dokument'), ''))
    returning id into v_id;$s$);
  d := replace(d, $s$      linia_materialy = nullif(p ->> 'linia_materialy', '')::int
    where id = v_id;$s$, $s$      linia_materialy = nullif(p ->> 'linia_materialy', '')::int,
      dokument = nullif(trim(p ->> 'dokument'), '')
    where id = v_id;$s$);
  n := (length(d) - length(replace(d, 'dokument', ''))) / length('dokument');
  if n <> 4 then
    raise exception 'zapisz_zlecenie: nie udało się dopisać pola dokument (trafień: %)', n;
  end if;
  execute d;
end
$do$;
