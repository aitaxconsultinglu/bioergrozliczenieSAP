-- =============================================================================
-- 0008: zakupy z Comarch ERP Optima (import pliku "Handel -> Zasoby" i podobnych)
--
-- Plik "Zasoby" ma JEDEN wiersz na towar: ostatnia cena zakupu + ostatni dokument (PZ).
-- Kazdy import DOPISUJE nowe pary (towar, dokument) i nie kasuje starych, wiec historia
-- 5 ostatnich zakupow buduje sie z kolejnych importow. Ten sam mechanizm przyjmie tez
-- eksport pozycji dokumentow (jesli dzial handlowy go wyciagnie) - wtedy historia
-- bedzie pelna od razu.
-- Zadnego polaczenia z serwerem Optimy: dane wchodza wylacznie przez plik wgrany
-- przez dzial handlowy.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create table public.importy_optima (
  id          uuid primary key default gen_random_uuid(),
  plik        text,
  wierszy     integer not null default 0,
  utworzyl    uuid default auth.uid() references public.profiles(id) on delete set null,
  utworzono   timestamptz not null default now()
);

create table public.zakupy_optima (
  id              bigint generated always as identity primary key,
  kod             text not null,
  nazwa           text not null,
  jm              text,
  cena            numeric(14,4) not null check (cena >= 0),   -- cena zakupu netto za JM
  dokument        text,                                        -- np. PZ/461/03/2026
  dokument_klucz  text generated always as (coalesce(dokument, '')) stored,
  typ_dokumentu   text,                                        -- PZ / PZKOR / FZ ...
  data_dokumentu  date,                                        -- z numeru (1. dzien miesiaca) albo z pliku
  nr_dokumentu    integer,                                     -- kolejny numer w miesiacu - do sortowania
  dostawca        text,
  import_id       uuid references public.importy_optima(id) on delete set null,
  zaimportowano   timestamptz not null default now(),
  unique (kod, dokument_klucz)
);
create index zakupy_optima_nazwa_trgm on public.zakupy_optima using gin (nazwa extensions.gin_trgm_ops);
create index zakupy_optima_kod on public.zakupy_optima (kod);

alter table public.importy_optima enable row level security;
alter table public.zakupy_optima enable row level security;
-- Odczyt dla zalogowanych (podpowiedzi cen dla kierownikow); zapis tylko przez funkcje ponizej.
create policy io_select on public.importy_optima for select to authenticated using (public.jest_handlowcem());
create policy zo_select on public.zakupy_optima for select to authenticated using (true);

-- --- Import (partiami po ~1500 wierszy) -------------------------------------------------
create or replace function public.rozpocznij_import_optima(p_plik text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.jest_handlowcem() then
    raise exception 'Import z Optimy wykonuje dział handlowy.';
  end if;
  insert into importy_optima (plik, utworzyl) values (p_plik, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- p_wiersze: [{kod, nazwa, jm, cena, dokument, dostawca, data}] - juz oczyszczone w przegladarce.
create or replace function public.importuj_zakupy_optima(p_import uuid, p_wiersze jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.jest_handlowcem() then
    raise exception 'Import z Optimy wykonuje dział handlowy.';
  end if;
  with dane as (
    select trim(e ->> 'kod') as kod,
           trim(e ->> 'nazwa') as nazwa,
           nullif(trim(e ->> 'jm'), '') as jm,
           (e ->> 'cena')::numeric as cena,
           nullif(trim(e ->> 'dokument'), '') as dokument,
           nullif(trim(e ->> 'dostawca'), '') as dostawca,
           nullif(e ->> 'data', '')::date as data
    from jsonb_array_elements(p_wiersze) e
    where coalesce(trim(e ->> 'kod'), '') <> '' and coalesce(trim(e ->> 'nazwa'), '') <> ''
      and (e ->> 'cena')::numeric > 0
  ), z_numerem as (
    -- Numer dokumentu Optimy: TYP/numer/MM/RRRR
    select d.*, m[1] as typ, m[2]::int as nr,
           coalesce(d.data, make_date(m[4]::int, m[3]::int, 1)) as data_dok
    from dane d
    left join lateral regexp_match(coalesce(d.dokument, ''), '^([A-Za-z]+)\s*/\s*(\d+)\s*/\s*(\d{1,2})\s*/\s*(\d{4})$') m on true
  ), bez_duplikatow as (
    select distinct on (kod, coalesce(dokument, '')) * from z_numerem
  )
  insert into zakupy_optima (kod, nazwa, jm, cena, dokument, typ_dokumentu, data_dokumentu, nr_dokumentu, dostawca, import_id)
  select kod, nazwa, jm, cena, dokument, upper(typ), data_dok, nr, dostawca, p_import from bez_duplikatow
  on conflict (kod, dokument_klucz) do update set
    nazwa = excluded.nazwa, jm = excluded.jm, cena = excluded.cena, typ_dokumentu = excluded.typ_dokumentu,
    data_dokumentu = excluded.data_dokumentu, nr_dokumentu = excluded.nr_dokumentu, dostawca = excluded.dostawca,
    import_id = excluded.import_id, zaimportowano = now();
  get diagnostics v_n = row_count;
  update importy_optima set wierszy = wierszy + v_n where id = p_import;
  return v_n;
end $$;

-- --- Historia zakupow: aplikacja + Optima ------------------------------------------------
drop function if exists public.historia_zakupow(text);
create function public.historia_zakupow(p_fraza text)
returns table (towar text, kod text, nazwa text, jm text, cena_jedn numeric, ilosc numeric,
               numer_faktury text, dostawca text, data date, zrodlo text)
language sql stable security definer set search_path = public, extensions as $$
  with slowa as (
    select array_agg(w) as w from unnest(string_to_array(trim(coalesce(p_fraza, '')), ' ')) w where w <> ''
  ), wszystkie as (
    -- zakupy wpisane w aplikacji (grupowane po nazwie)
    select upper(trim(m.nazwa)) as towar, null::text as kod, m.nazwa, m.jm,
           round(m.wartosc_zakupu / nullif(m.ilosc, 0), 2) as cena_jedn, m.ilosc,
           m.numer_faktury, null::text as dostawca, m.utworzono::date as data, 'aplikacja' as zrodlo,
           extract(epoch from m.utworzono)::bigint as sort
    from pozycje_materialowe m, slowa s
    where not public.czy_synthos(m.dostawca) and m.wartosc_zakupu > 0
      and not exists (select 1 from unnest(s.w) x where m.nazwa not ilike '%' || x || '%')
    union all
    -- zakupy z Optimy (grupowane po kodzie towaru)
    select 'OPT:' || z.kod, z.kod, z.nazwa, z.jm, round(z.cena, 2), null::numeric,
           z.dokument, z.dostawca, z.data_dokumentu, 'Optima',
           coalesce(extract(epoch from z.data_dokumentu)::bigint, 0) + coalesce(z.nr_dokumentu, 0)
    from zakupy_optima z, slowa s
    where (z.kod = trim(p_fraza)
           or not exists (select 1 from unnest(s.w) x where z.nazwa not ilike '%' || x || '%'))
  ), numerowane as (
    select w.*, row_number() over (partition by towar order by sort desc) as nr,
           max(sort) over (partition by towar) as ostatni
    from wszystkie w
  ), towary as (
    select towar from numerowane where nr = 1 order by ostatni desc limit 12
  )
  select n.towar, n.kod, n.nazwa, n.jm, n.cena_jedn, n.ilosc, n.numer_faktury, n.dostawca, n.data, n.zrodlo
  from numerowane n join towary t using (towar)
  where n.nr <= 5 and auth.uid() is not null and length(trim(coalesce(p_fraza, ''))) >= 2
  order by n.ostatni desc, n.towar, n.sort desc;
$$;

revoke execute on function public.rozpocznij_import_optima(text), public.importuj_zakupy_optima(uuid, jsonb),
  public.historia_zakupow(text) from public, anon;
grant execute on function public.rozpocznij_import_optima(text), public.importuj_zakupy_optima(uuid, jsonb),
  public.historia_zakupow(text) to authenticated;
