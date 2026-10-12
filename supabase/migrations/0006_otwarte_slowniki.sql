-- =============================================================================
-- 0006: "otwarte katalogi" - aplikacja nie moze blokowac niestandardowych przypadkow
--  - dostawca materialu: dowolny tekst (Bioerg / Synthos / cokolwiek innego);
--    materialy Synthos (rozpoznawane po nazwie) zawsze z narzutem 0%
--  - pozycja uslugi spoza cennika: wlasny opis, cena, JM i (opcjonalnie) indeks SAP
--  - brak godzin: stanowisko z cennika albo wpisane recznie
-- =============================================================================

-- --- Dostawca: enum -> tekst -----------------------------------------------------
alter table public.pozycje_materialowe alter column dostawca drop default;
alter table public.pozycje_materialowe alter column dostawca type text using dostawca::text;
alter table public.pozycje_materialowe alter column dostawca set default 'bioerg';
alter table public.pozycje_materialowe add constraint pozycje_materialowe_dostawca_niepusty
  check (length(trim(dostawca)) > 0);
drop type public.dostawca_materialu;

-- Material Synthos = kazdy wpis zawierajacy "synthos" (np. "Synthos", "magazyn Synthos").
create or replace function public.czy_synthos(p_dostawca text) returns boolean
language sql immutable as $$ select coalesce(p_dostawca, '') ~* 'synthos' $$;

create or replace function public.ustaw_narzut_materialu() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.czy_synthos(new.dostawca) then
    new.narzut_proc := 0;
  elsif tg_op = 'UPDATE' and public.czy_synthos(old.dostawca) and new.narzut_proc = 0 then
    new.narzut_proc := 15;
  end if;
  return new;
end $$;
revoke execute on function public.ustaw_narzut_materialu() from public, anon, authenticated;

-- --- Pozycje spoza cennika ---------------------------------------------------------
alter table public.pozycje_uslug alter column cennik_pozycja_id drop not null;
alter table public.pozycje_uslug
  add column wlasny_opis   text,
  add column wlasna_jm     text,
  add column wlasna_cena   numeric(12,2) check (wlasna_cena >= 0),
  add column wlasny_indeks text,
  add constraint pozycje_uslug_cennik_albo_wlasna
    check (cennik_pozycja_id is not null or (coalesce(trim(wlasny_opis), '') <> '' and wlasna_cena is not null));

create or replace function public.ustaw_cene_uslugi() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.cennik_pozycja_id is null then
    new.cena := coalesce(new.wlasna_cena, 0);
  elsif tg_op = 'INSERT' or new.cennik_pozycja_id is distinct from old.cennik_pozycja_id then
    select cena into new.cena from public.cennik_pozycje where id = new.cennik_pozycja_id;
  end if;
  return new;
end $$;
revoke execute on function public.ustaw_cene_uslugi() from public, anon, authenticated;

-- --- Braki: stanowisko wpisane recznie --------------------------------------------
alter table public.braki_godzin add column stanowisko_tekst text;

-- --- Zapis formularza z nowymi polami ------------------------------------------------
create or replace function public.zapisz_zlecenie(p jsonb, p_oczekiwana_wersja timestamptz default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_wersja timestamptz;
  v_el jsonb;
  v_ids bigint[];
  v_karty_ids uuid[];
begin
  if v_id is null then
    insert into zlecenia (mpk, nr_zamowienia, pozycja_zamowienia, konto, nazwa, mechanik, szablon,
                          dane_szablonu, data_przyjecia, data_zakonczenia, uwagi)
    values (p ->> 'mpk', nullif(trim(p ->> 'nr_zamowienia'), ''), nullif(p ->> 'pozycja_zamowienia', '')::int,
            nullif(trim(p ->> 'konto'), ''), trim(p ->> 'nazwa'), nullif(trim(p ->> 'mechanik'), ''),
            coalesce(p ->> 'szablon', 'urzadzenie'), coalesce(p -> 'dane_szablonu', '{}'),
            nullif(p ->> 'data_przyjecia', '')::date, nullif(p ->> 'data_zakonczenia', '')::date,
            nullif(p ->> 'uwagi', ''))
    returning id into v_id;
  else
    select zmodyfikowano into v_wersja from zlecenia where id = v_id;
    if not found then
      raise exception 'Zlecenie nie istnieje albo nie masz do niego dostępu.';
    end if;
    if p_oczekiwana_wersja is not null and v_wersja > p_oczekiwana_wersja + interval '1 millisecond' then
      raise exception 'Ktoś inny zapisał to zlecenie w międzyczasie. Odśwież stronę i wprowadź zmiany ponownie.';
    end if;
    update zlecenia set
      mpk = p ->> 'mpk',
      nr_zamowienia = nullif(trim(p ->> 'nr_zamowienia'), ''),
      pozycja_zamowienia = nullif(p ->> 'pozycja_zamowienia', '')::int,
      konto = nullif(trim(p ->> 'konto'), ''),
      nazwa = trim(p ->> 'nazwa'),
      mechanik = nullif(trim(p ->> 'mechanik'), ''),
      szablon = coalesce(p ->> 'szablon', 'urzadzenie'),
      dane_szablonu = coalesce(p -> 'dane_szablonu', '{}'),
      data_przyjecia = nullif(p ->> 'data_przyjecia', '')::date,
      data_zakonczenia = nullif(p ->> 'data_zakonczenia', '')::date,
      uwagi = nullif(p ->> 'uwagi', '')
    where id = v_id;
    if not found then
      raise exception 'Tego zlecenia nie można już edytować (zostało złożone lub wyeksportowane).';
    end if;
  end if;

  -- Karty
  select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_karty_ids
  from jsonb_array_elements(coalesce(p -> 'karty', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from karty_remontowe where zlecenie_id = v_id and id <> all (v_karty_ids);
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'karty', '[]')) loop
    if nullif(v_el ->> 'id', '') is null then
      insert into karty_remontowe (zlecenie_id, numer_karty, szablon, urzadzenie_nazwa, urzadzenie_typ, urzadzenie_nr,
        klient, data_przyjecia, data_zakonczenia, mechanik_przekazujacy, mechanik_przyjmujacy, opis_uszkodzenia, dane)
      values (v_id, nullif(trim(v_el ->> 'numer_karty'), ''), coalesce(v_el ->> 'szablon', 'urzadzenie'),
        nullif(trim(v_el ->> 'urzadzenie_nazwa'), ''), nullif(trim(v_el ->> 'urzadzenie_typ'), ''),
        nullif(trim(v_el ->> 'urzadzenie_nr'), ''), coalesce(nullif(trim(v_el ->> 'klient'), ''), 'Synthos'),
        nullif(v_el ->> 'data_przyjecia', '')::date, nullif(v_el ->> 'data_zakonczenia', '')::date,
        nullif(trim(v_el ->> 'mechanik_przekazujacy'), ''), nullif(trim(v_el ->> 'mechanik_przyjmujacy'), ''),
        nullif(v_el ->> 'opis_uszkodzenia', ''), coalesce(v_el -> 'dane', '{}'));
    else
      update karty_remontowe set
        numer_karty = nullif(trim(v_el ->> 'numer_karty'), ''),
        szablon = coalesce(v_el ->> 'szablon', 'urzadzenie'),
        urzadzenie_nazwa = nullif(trim(v_el ->> 'urzadzenie_nazwa'), ''),
        urzadzenie_typ = nullif(trim(v_el ->> 'urzadzenie_typ'), ''),
        urzadzenie_nr = nullif(trim(v_el ->> 'urzadzenie_nr'), ''),
        klient = coalesce(nullif(trim(v_el ->> 'klient'), ''), 'Synthos'),
        data_przyjecia = nullif(v_el ->> 'data_przyjecia', '')::date,
        data_zakonczenia = nullif(v_el ->> 'data_zakonczenia', '')::date,
        mechanik_przekazujacy = nullif(trim(v_el ->> 'mechanik_przekazujacy'), ''),
        mechanik_przyjmujacy = nullif(trim(v_el ->> 'mechanik_przyjmujacy'), ''),
        opis_uszkodzenia = nullif(v_el ->> 'opis_uszkodzenia', ''),
        dane = coalesce(v_el -> 'dane', '{}')
      where id = (v_el ->> 'id')::uuid and zlecenie_id = v_id;
    end if;
  end loop;

  -- Pozycje uslug: z cennika (cene ustawia trigger) albo spoza cennika (wlasna cena).
  select coalesce(array_agg((e ->> 'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from pozycje_uslug where zlecenie_id = v_id and id <> all (v_ids);
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) loop
    if (v_el ->> 'ilosc')::numeric <= 0 then continue; end if;
    if nullif(v_el ->> 'id', '') is null then
      insert into pozycje_uslug (zlecenie_id, cennik_pozycja_id, ilosc, cena, doplata_proc, doplata_opis,
                                 mpk_wykonawcy, opis, kolejnosc, wlasny_opis, wlasna_jm, wlasna_cena, wlasny_indeks)
      values (v_id, nullif(v_el ->> 'cennik_pozycja_id', '')::bigint, (v_el ->> 'ilosc')::numeric, 0,
              coalesce((v_el ->> 'doplata_proc')::numeric, 0), nullif(v_el ->> 'doplata_opis', ''),
              nullif(v_el ->> 'mpk_wykonawcy', ''), nullif(v_el ->> 'opis', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0), nullif(trim(v_el ->> 'wlasny_opis'), ''),
              nullif(trim(v_el ->> 'wlasna_jm'), ''), nullif(v_el ->> 'wlasna_cena', '')::numeric,
              nullif(trim(v_el ->> 'wlasny_indeks'), ''));
    else
      update pozycje_uslug set
        cennik_pozycja_id = nullif(v_el ->> 'cennik_pozycja_id', '')::bigint,
        ilosc = (v_el ->> 'ilosc')::numeric,
        doplata_proc = coalesce((v_el ->> 'doplata_proc')::numeric, 0),
        doplata_opis = nullif(v_el ->> 'doplata_opis', ''),
        mpk_wykonawcy = nullif(v_el ->> 'mpk_wykonawcy', ''),
        opis = nullif(v_el ->> 'opis', ''),
        kolejnosc = coalesce((v_el ->> 'kolejnosc')::int, 0),
        wlasny_opis = nullif(trim(v_el ->> 'wlasny_opis'), ''),
        wlasna_jm = nullif(trim(v_el ->> 'wlasna_jm'), ''),
        wlasna_cena = nullif(v_el ->> 'wlasna_cena', '')::numeric,
        wlasny_indeks = nullif(trim(v_el ->> 'wlasny_indeks'), '')
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id;
    end if;
  end loop;
  delete from pozycje_uslug pu using jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) e
  where pu.zlecenie_id = v_id and nullif(e ->> 'id', '') is not null
    and pu.id = (e ->> 'id')::bigint and (e ->> 'ilosc')::numeric <= 0;

  -- Materialy
  select coalesce(array_agg((e ->> 'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(p -> 'materialy', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from pozycje_materialowe where zlecenie_id = v_id and id <> all (v_ids);
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'materialy', '[]')) loop
    if nullif(v_el ->> 'id', '') is null then
      insert into pozycje_materialowe (zlecenie_id, nazwa, ilosc, jm, wartosc_zakupu, dostawca, narzut_proc,
                                       numer_faktury, kolejnosc)
      values (v_id, trim(v_el ->> 'nazwa'), (v_el ->> 'ilosc')::numeric, coalesce(nullif(v_el ->> 'jm', ''), 'szt.'),
              coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0), coalesce(nullif(trim(v_el ->> 'dostawca'), ''), 'bioerg'),
              coalesce((v_el ->> 'narzut_proc')::numeric, 15), nullif(v_el ->> 'numer_faktury', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0));
    else
      update pozycje_materialowe set
        nazwa = trim(v_el ->> 'nazwa'),
        ilosc = (v_el ->> 'ilosc')::numeric,
        jm = coalesce(nullif(v_el ->> 'jm', ''), 'szt.'),
        wartosc_zakupu = coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0),
        dostawca = coalesce(nullif(trim(v_el ->> 'dostawca'), ''), 'bioerg'),
        narzut_proc = coalesce((v_el ->> 'narzut_proc')::numeric, 15),
        numer_faktury = nullif(v_el ->> 'numer_faktury', ''),
        kolejnosc = coalesce((v_el ->> 'kolejnosc')::int, 0)
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id;
    end if;
  end loop;

  -- Braki godzin: status zmienia tylko dzial handlowy (w panelu), tu tylko tresc.
  select coalesce(array_agg((e ->> 'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(p -> 'braki', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from braki_godzin where zlecenie_id = v_id and id <> all (v_ids) and status = 'zgloszony';
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'braki', '[]')) loop
    if nullif(v_el ->> 'id', '') is null then
      insert into braki_godzin (zlecenie_id, cennik_pozycja_id, stanowisko_tekst, ilosc_rbg, opis)
      values (v_id, nullif(v_el ->> 'cennik_pozycja_id', '')::bigint, nullif(trim(v_el ->> 'stanowisko_tekst'), ''),
              (v_el ->> 'ilosc_rbg')::numeric, nullif(v_el ->> 'opis', ''));
    else
      update braki_godzin set
        cennik_pozycja_id = nullif(v_el ->> 'cennik_pozycja_id', '')::bigint,
        stanowisko_tekst = nullif(trim(v_el ->> 'stanowisko_tekst'), ''),
        ilosc_rbg = (v_el ->> 'ilosc_rbg')::numeric,
        opis = nullif(v_el ->> 'opis', '')
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id and status = 'zgloszony';
    end if;
  end loop;

  return v_id;
end $$;
revoke execute on function public.zapisz_zlecenie(jsonb, timestamptz) from public, anon;
grant execute on function public.zapisz_zlecenie(jsonb, timestamptz) to authenticated;
