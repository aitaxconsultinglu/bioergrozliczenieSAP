-- =============================================================================
-- 0007: uwagi dzialu handlowego (Justyna, 2026-10-13)
--  - narzut na material: domyslnie 12% (ustawienie zmieniane w aplikacji), nie 15%
--  - karta remontowa NIE na sztywno: flaga na kazdej pozycji (domyslnie z kategorii),
--    kierownik/handlowiec moze ja odznaczyc
--  - numer linii SAP nadaje Synthos w zamowieniu: pola na zleceniu (uslugi/materialy)
--    i opcjonalnie na pozycji; pusty = do uzupelnienia w SAP
--  - historia zakupow materialu (5 ostatnich zakupow z cena i nr faktury) do podpowiedzi
--  - zmiana roli uzytkownika przez dzial handlowy
-- =============================================================================

-- --- Ustawienia aplikacji ------------------------------------------------------------
create table public.ustawienia (
  klucz   text primary key,
  wartosc jsonb not null,
  opis    text
);
insert into public.ustawienia (klucz, wartosc, opis)
values ('narzut_material_proc', '12', 'Domyślny narzut na materiał kupiony przez Bioerg [%]');
alter table public.ustawienia enable row level security;
create policy ust_select on public.ustawienia for select to authenticated using (true);
create policy ust_update on public.ustawienia for update to authenticated
  using (public.jest_handlowcem()) with check (public.jest_handlowcem());

create or replace function public.domyslny_narzut() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (wartosc #>> '{}')::numeric from public.ustawienia where klucz = 'narzut_material_proc'), 12);
$$;
alter table public.pozycje_materialowe alter column narzut_proc set default public.domyslny_narzut();

create or replace function public.ustaw_narzut_materialu() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.czy_synthos(new.dostawca) then
    new.narzut_proc := 0;
  elsif tg_op = 'UPDATE' and public.czy_synthos(old.dostawca) and new.narzut_proc = 0 then
    new.narzut_proc := public.domyslny_narzut();
  end if;
  return new;
end $$;
revoke execute on function public.ustaw_narzut_materialu() from public, anon, authenticated;

-- --- Karta na pozycji + numery linii SAP ---------------------------------------------
alter table public.pozycje_uslug
  add column wymaga_karty boolean,      -- null = jak w kategorii cennika
  add column nr_linii_sap integer;      -- nadpisuje numer linii zlecenia dla tej pozycji
alter table public.zlecenia
  add column linia_uslugi integer,      -- nr linii zamowienia SAP dla uslug/robocizny
  add column linia_materialy integer;   -- nr linii zamowienia SAP dla materialu

create or replace function public.pilnuj_zlecenia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_handlowiec boolean := public.jest_handlowcem();
  v_wymagane   integer;
  v_karty      integer;
  v_niepelne   integer;
begin
  new.zmodyfikowano := now();
  if auth.uid() is null then
    return new;
  end if;

  if not v_handlowiec then
    if new.komentarz_handlowca is distinct from old.komentarz_handlowca then
      raise exception 'Tylko dział handlowy może zmieniać komentarz do zlecenia.';
    end if;
    if new.status is distinct from old.status
       and not (old.status in ('roboczy', 'zwrocony') and new.status = 'zlozony') then
      raise exception 'Niedozwolona zmiana statusu zlecenia.';
    end if;
  else
    if old.status = 'wyeksportowany' and new.status = 'wyeksportowany' then
      raise exception 'Zlecenie jest już wyeksportowane do SAP. Aby je poprawić, najpierw cofnij eksport.';
    end if;
  end if;

  if new.status = 'zlozony' and old.status is distinct from 'zlozony' and old.status <> 'wyeksportowany' then
    if coalesce(trim(new.nr_zamowienia), '') = '' then
      raise exception 'Nie można złożyć zlecenia bez numeru zamówienia SAP.';
    end if;
    if not exists (select 1 from public.pozycje_uslug where zlecenie_id = new.id)
       and not exists (select 1 from public.pozycje_materialowe where zlecenie_id = new.id) then
      raise exception 'Zlecenie nie ma żadnych pozycji do rozliczenia.';
    end if;

    -- Karta wymagana tylko dla pozycji, przy ktorych flaga jest wlaczona (domyslnie z kategorii).
    select coalesce(ceil(sum(pu.ilosc)), 0) into v_wymagane
    from public.pozycje_uslug pu
    left join public.cennik_pozycje cp on cp.id = pu.cennik_pozycja_id
    left join public.cennik_kategorie ck on ck.nr_pozycji = cp.nr_pozycji
    where pu.zlecenie_id = new.id and coalesce(pu.wymaga_karty, ck.wymaga_karty, false);

    select count(*),
           count(*) filter (where coalesce(trim(numer_karty), '') = ''
                               or coalesce(trim(urzadzenie_nazwa), '') = ''
                               or data_zakonczenia is null
                               or coalesce(trim(mechanik_przyjmujacy), '') = '')
      into v_karty, v_niepelne
    from public.karty_remontowe where zlecenie_id = new.id;

    if v_karty < v_wymagane then
      raise exception 'Zlecenie wymaga % kart(y) remontowej, a wypełniono %. Dodaj karty albo odznacz „karta” przy pozycji, jeśli nie jest potrzebna.', v_wymagane, v_karty;
    end if;
    if v_niepelne > 0 then
      raise exception 'Niekompletne karty remontowe (%): uzupełnij numer karty, urządzenie, datę zakończenia i osobę odbierającą.', v_niepelne;
    end if;
    new.zlozono := now();
  end if;

  if new.status = 'wyeksportowany' and old.status is distinct from 'wyeksportowany' then
    new.wyeksportowano := now();
  end if;
  return new;
end $$;
revoke execute on function public.pilnuj_zlecenia() from public, anon, authenticated;

-- --- Zapis formularza ------------------------------------------------------------------
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
                          dane_szablonu, data_przyjecia, data_zakonczenia, uwagi, linia_uslugi, linia_materialy)
    values (p ->> 'mpk', nullif(trim(p ->> 'nr_zamowienia'), ''), nullif(p ->> 'pozycja_zamowienia', '')::int,
            nullif(trim(p ->> 'konto'), ''), trim(p ->> 'nazwa'), nullif(trim(p ->> 'mechanik'), ''),
            coalesce(p ->> 'szablon', 'urzadzenie'), coalesce(p -> 'dane_szablonu', '{}'),
            nullif(p ->> 'data_przyjecia', '')::date, nullif(p ->> 'data_zakonczenia', '')::date,
            nullif(p ->> 'uwagi', ''), nullif(p ->> 'linia_uslugi', '')::int, nullif(p ->> 'linia_materialy', '')::int)
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
      uwagi = nullif(p ->> 'uwagi', ''),
      linia_uslugi = nullif(p ->> 'linia_uslugi', '')::int,
      linia_materialy = nullif(p ->> 'linia_materialy', '')::int
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

  -- Pozycje uslug
  select coalesce(array_agg((e ->> 'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from pozycje_uslug where zlecenie_id = v_id and id <> all (v_ids);
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) loop
    if (v_el ->> 'ilosc')::numeric <= 0 then continue; end if;
    if nullif(v_el ->> 'id', '') is null then
      insert into pozycje_uslug (zlecenie_id, cennik_pozycja_id, ilosc, cena, doplata_proc, doplata_opis,
                                 mpk_wykonawcy, opis, kolejnosc, wlasny_opis, wlasna_jm, wlasna_cena, wlasny_indeks,
                                 wymaga_karty, nr_linii_sap)
      values (v_id, nullif(v_el ->> 'cennik_pozycja_id', '')::bigint, (v_el ->> 'ilosc')::numeric, 0,
              coalesce((v_el ->> 'doplata_proc')::numeric, 0), nullif(v_el ->> 'doplata_opis', ''),
              nullif(v_el ->> 'mpk_wykonawcy', ''), nullif(v_el ->> 'opis', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0), nullif(trim(v_el ->> 'wlasny_opis'), ''),
              nullif(trim(v_el ->> 'wlasna_jm'), ''), nullif(v_el ->> 'wlasna_cena', '')::numeric,
              nullif(trim(v_el ->> 'wlasny_indeks'), ''),
              (v_el ->> 'wymaga_karty')::boolean, nullif(v_el ->> 'nr_linii_sap', '')::int);
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
        wlasny_indeks = nullif(trim(v_el ->> 'wlasny_indeks'), ''),
        wymaga_karty = (v_el ->> 'wymaga_karty')::boolean,
        nr_linii_sap = nullif(v_el ->> 'nr_linii_sap', '')::int
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id;
    end if;
  end loop;
  delete from pozycje_uslug pu using jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) e
  where pu.zlecenie_id = v_id and nullif(e ->> 'id', '') is not null
    and pu.id = (e ->> 'id')::bigint and (e ->> 'ilosc')::numeric <= 0;

  -- Materialy (brak narzutu w payloadzie = domyslny z ustawien)
  select coalesce(array_agg((e ->> 'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(p -> 'materialy', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from pozycje_materialowe where zlecenie_id = v_id and id <> all (v_ids);
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'materialy', '[]')) loop
    if nullif(v_el ->> 'id', '') is null then
      insert into pozycje_materialowe (zlecenie_id, nazwa, ilosc, jm, wartosc_zakupu, dostawca, narzut_proc,
                                       numer_faktury, kolejnosc)
      values (v_id, trim(v_el ->> 'nazwa'), (v_el ->> 'ilosc')::numeric, coalesce(nullif(v_el ->> 'jm', ''), 'szt.'),
              coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0), coalesce(nullif(trim(v_el ->> 'dostawca'), ''), 'bioerg'),
              coalesce((v_el ->> 'narzut_proc')::numeric, public.domyslny_narzut()), nullif(v_el ->> 'numer_faktury', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0));
    else
      update pozycje_materialowe set
        nazwa = trim(v_el ->> 'nazwa'),
        ilosc = (v_el ->> 'ilosc')::numeric,
        jm = coalesce(nullif(v_el ->> 'jm', ''), 'szt.'),
        wartosc_zakupu = coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0),
        dostawca = coalesce(nullif(trim(v_el ->> 'dostawca'), ''), 'bioerg'),
        narzut_proc = coalesce((v_el ->> 'narzut_proc')::numeric, public.domyslny_narzut()),
        numer_faktury = nullif(v_el ->> 'numer_faktury', ''),
        kolejnosc = coalesce((v_el ->> 'kolejnosc')::int, 0)
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id;
    end if;
  end loop;

  -- Braki godzin
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

-- --- Historia zakupow materialu --------------------------------------------------------
-- 5 ostatnich zakupow kazdego pasujacego materialu ze WSZYSTKICH MPK (ceny zakupu nie sa
-- tajemnica miedzy wydzialami, a im wiecej historii, tym lepsza podpowiedz).
-- Docelowo ta sama funkcja moze doczytywac zakupy zaimportowane z Optimy.
create or replace function public.historia_zakupow(p_fraza text)
returns table (nazwa text, jm text, cena_jedn numeric, ilosc numeric, wartosc_zakupu numeric,
               numer_faktury text, dostawca text, data date, zrodlo text)
language sql stable security definer set search_path = public as $$
  with dopasowane as (
    select m.nazwa, m.jm, round(m.wartosc_zakupu / nullif(m.ilosc, 0), 2) as cena_jedn, m.ilosc, m.wartosc_zakupu,
           m.numer_faktury, m.dostawca, m.utworzono::date as data,
           row_number() over (partition by upper(trim(m.nazwa)) order by m.utworzono desc) as nr
    from pozycje_materialowe m
    where auth.uid() is not null
      and length(trim(coalesce(p_fraza, ''))) >= 2
      and m.nazwa ilike '%' || trim(p_fraza) || '%'
      and not public.czy_synthos(m.dostawca)
      and m.wartosc_zakupu > 0
  )
  select nazwa, jm, cena_jedn, ilosc, wartosc_zakupu, numer_faktury, dostawca, data, 'aplikacja'
  from dopasowane where nr <= 5
  order by upper(nazwa), data desc
  limit 60;
$$;
revoke execute on function public.historia_zakupow(text) from public, anon;
grant execute on function public.historia_zakupow(text) to authenticated;

-- --- Zmiana roli uzytkownika ----------------------------------------------------------
create or replace function public.zmien_role(p_user uuid, p_rola rola_uzytkownika)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.jest_handlowcem() then
    raise exception 'Tylko dział handlowy może zmieniać role.';
  end if;
  if p_user = auth.uid() then
    raise exception 'Nie możesz zmienić roli własnego konta.';
  end if;
  -- Konta chronione pilnuje trigger trg_chron_role_administratora.
  update profiles set rola = p_rola where id = p_user;
end $$;
revoke execute on function public.zmien_role(uuid, rola_uzytkownika) from public, anon;
grant execute on function public.zmien_role(uuid, rola_uzytkownika) to authenticated;
