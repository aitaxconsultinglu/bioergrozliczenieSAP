-- =============================================================================
-- 0003: funkcje wywolywane przez aplikacje
--  - zapisz_zlecenie: caly formularz w JEDNEJ transakcji (naglowek + pozycje + karty
--    + braki). Albo zapisuje sie wszystko, albo nic - nie ma stanu "pol zapisane".
--  - polskie komunikaty walidacji
--  - operacje panelu handlowca: zwrot, eksport, cofniecie eksportu
--  - zarzadzanie przypisaniem MPK
-- =============================================================================

-- --- Walidacja: te same reguly, komunikaty z polskimi znakami ----------------------
create or replace function public.pilnuj_zlecenia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_handlowiec boolean := public.jest_handlowcem();
  v_wymagane   integer;
  v_karty      integer;
  v_niepelne   integer;
begin
  new.zmodyfikowano := now();

  -- Wywolania serwerowe (service_role, SQL editor) - bez ograniczen rol.
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

    -- Twarda reguła: pozycja z kategorii wymagającej karty => tyle kart, ile sztuk.
    select coalesce(ceil(sum(pu.ilosc)), 0) into v_wymagane
    from public.pozycje_uslug pu
    join public.cennik_pozycje cp on cp.id = pu.cennik_pozycja_id
    join public.cennik_kategorie ck on ck.nr_pozycji = cp.nr_pozycji
    where pu.zlecenie_id = new.id and ck.wymaga_karty;

    select count(*),
           count(*) filter (where coalesce(trim(numer_karty), '') = ''
                               or coalesce(trim(urzadzenie_nazwa), '') = ''
                               or data_zakonczenia is null
                               or coalesce(trim(mechanik_przyjmujacy), '') = '')
      into v_karty, v_niepelne
    from public.karty_remontowe where zlecenie_id = new.id;

    if v_karty < v_wymagane then
      raise exception 'Zlecenie wymaga % kart(y) remontowej, a wypełniono %. Dodaj brakujące karty.', v_wymagane, v_karty;
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

-- --- Zapis calego formularza --------------------------------------------------------
-- SECURITY INVOKER: wszystkie operacje przechodza przez RLS zalogowanego uzytkownika.
-- p_oczekiwana_wersja = zmodyfikowano wczytane przez formularz; gdy ktos zapisal
-- zlecenie w miedzyczasie, zapis jest odrzucany zamiast nadpisac cudza prace.
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

  -- Karty najpierw - pozycje moga sie do nich odwolywac.
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

  -- Pozycje uslug (cennik + robocizna). Cene ustawia trigger z cennika.
  select coalesce(array_agg((e ->> 'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from pozycje_uslug where zlecenie_id = v_id and id <> all (v_ids);
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'uslugi', '[]')) loop
    if (v_el ->> 'ilosc')::numeric <= 0 then continue; end if;
    if nullif(v_el ->> 'id', '') is null then
      insert into pozycje_uslug (zlecenie_id, cennik_pozycja_id, ilosc, cena, doplata_proc, doplata_opis,
                                 mpk_wykonawcy, opis, kolejnosc)
      values (v_id, (v_el ->> 'cennik_pozycja_id')::bigint, (v_el ->> 'ilosc')::numeric, 0,
              coalesce((v_el ->> 'doplata_proc')::numeric, 0), nullif(v_el ->> 'doplata_opis', ''),
              nullif(v_el ->> 'mpk_wykonawcy', ''), nullif(v_el ->> 'opis', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0));
    else
      update pozycje_uslug set
        cennik_pozycja_id = (v_el ->> 'cennik_pozycja_id')::bigint,
        ilosc = (v_el ->> 'ilosc')::numeric,
        doplata_proc = coalesce((v_el ->> 'doplata_proc')::numeric, 0),
        doplata_opis = nullif(v_el ->> 'doplata_opis', ''),
        mpk_wykonawcy = nullif(v_el ->> 'mpk_wykonawcy', ''),
        opis = nullif(v_el ->> 'opis', ''),
        kolejnosc = coalesce((v_el ->> 'kolejnosc')::int, 0)
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id;
    end if;
  end loop;
  -- Wiersze wyzerowane w formularzu (ilosc 0) znikaja.
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
              coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0), coalesce(v_el ->> 'dostawca', 'bioerg')::dostawca_materialu,
              coalesce((v_el ->> 'narzut_proc')::numeric, 15), nullif(v_el ->> 'numer_faktury', ''),
              coalesce((v_el ->> 'kolejnosc')::int, 0));
    else
      update pozycje_materialowe set
        nazwa = trim(v_el ->> 'nazwa'),
        ilosc = (v_el ->> 'ilosc')::numeric,
        jm = coalesce(nullif(v_el ->> 'jm', ''), 'szt.'),
        wartosc_zakupu = coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0),
        dostawca = coalesce(v_el ->> 'dostawca', 'bioerg')::dostawca_materialu,
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
      insert into braki_godzin (zlecenie_id, cennik_pozycja_id, ilosc_rbg, opis)
      values (v_id, nullif(v_el ->> 'cennik_pozycja_id', '')::bigint, (v_el ->> 'ilosc_rbg')::numeric,
              nullif(v_el ->> 'opis', ''));
    else
      update braki_godzin set
        cennik_pozycja_id = nullif(v_el ->> 'cennik_pozycja_id', '')::bigint,
        ilosc_rbg = (v_el ->> 'ilosc_rbg')::numeric,
        opis = nullif(v_el ->> 'opis', '')
      where id = (v_el ->> 'id')::bigint and zlecenie_id = v_id and status = 'zgloszony';
    end if;
  end loop;

  return v_id;
end $$;

-- --- Panel handlowca --------------------------------------------------------------
create or replace function public.zwroc_zlecenie(p_id uuid, p_komentarz text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.jest_handlowcem() then
    raise exception 'Tylko dział handlowy może zwracać zlecenia.';
  end if;
  if coalesce(trim(p_komentarz), '') = '' then
    raise exception 'Podaj, co trzeba poprawić - kierownik zobaczy ten komentarz.';
  end if;
  update zlecenia set status = 'zwrocony', komentarz_handlowca = trim(p_komentarz)
  where id = p_id and status = 'zlozony';
  if not found then
    raise exception 'Zwrócić można tylko zlecenie złożone do rozliczenia.';
  end if;
end $$;

-- Oznacza zlecenia jako wyeksportowane i zapisuje, co trafilo do ktorego pliku.
create or replace function public.oznacz_wyeksportowane(p_ids uuid[], p_nazwa_pliku text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_eksport uuid;
  v_n integer;
begin
  if not public.jest_handlowcem() then
    raise exception 'Tylko dział handlowy może eksportować do SAP.';
  end if;
  select count(*) into v_n from zlecenia where id = any (p_ids) and status <> 'zlozony';
  if v_n > 0 then
    raise exception 'Część zaznaczonych zleceń nie ma statusu "złożone" (%). Odśwież listę.', v_n;
  end if;
  insert into eksporty (nazwa_pliku) values (p_nazwa_pliku) returning id into v_eksport;
  insert into eksporty_zlecenia (eksport_id, zlecenie_id) select v_eksport, unnest(p_ids);
  update zlecenia set status = 'wyeksportowany' where id = any (p_ids);
  return v_eksport;
end $$;

create or replace function public.cofnij_eksport(p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.jest_handlowcem() then
    raise exception 'Tylko dział handlowy może cofnąć eksport.';
  end if;
  update zlecenia set status = 'zlozony' where id = p_id and status = 'wyeksportowany';
  if not found then
    raise exception 'To zlecenie nie jest wyeksportowane.';
  end if;
end $$;

create or replace function public.zmien_status_braku(p_id bigint, p_status status_braku)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.jest_handlowcem() then
    raise exception 'Status braku zmienia dział handlowy.';
  end if;
  update braki_godzin set status = p_status, zmieniono_status = now() where id = p_id;
end $$;

-- --- Uzytkownicy i MPK --------------------------------------------------------------
create policy pmpk_insert on public.profile_mpk for insert to authenticated
  with check (public.jest_handlowcem());
create policy pmpk_delete on public.profile_mpk for delete to authenticated
  using (public.jest_handlowcem());

create or replace function public.lista_uzytkownikow()
returns table (id uuid, email text, imie_nazwisko text, rola rola_uzytkownika, wymaga_zmiany_hasla boolean,
               chroniony boolean, ostatnie_logowanie timestamptz, mpk text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.imie_nazwisko, p.rola, p.wymaga_zmiany_hasla, p.chroniony, u.last_sign_in_at,
         coalesce((select array_agg(pm.mpk_kod order by pm.mpk_kod) from profile_mpk pm where pm.profile_id = p.id), '{}')
  from profiles p join auth.users u on u.id = p.id
  where public.jest_handlowcem()
  order by p.chroniony desc, p.rola, p.imie_nazwisko;
$$;

revoke execute on function public.zapisz_zlecenie(jsonb, timestamptz), public.zwroc_zlecenie(uuid, text),
  public.oznacz_wyeksportowane(uuid[], text), public.cofnij_eksport(uuid),
  public.zmien_status_braku(bigint, status_braku), public.lista_uzytkownikow() from public, anon;
grant execute on function public.zapisz_zlecenie(jsonb, timestamptz), public.zwroc_zlecenie(uuid, text),
  public.oznacz_wyeksportowane(uuid[], text), public.cofnij_eksport(uuid),
  public.zmien_status_braku(bigint, status_braku), public.lista_uzytkownikow() to authenticated;
