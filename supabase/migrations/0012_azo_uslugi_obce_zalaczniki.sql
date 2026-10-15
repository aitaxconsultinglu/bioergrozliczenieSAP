-- =============================================================================
-- 0012: uwagi dzialu handlowego (2026-10-15)
--  - nr AZO (z Optimy) na zleceniu - uzupelnia dzial handlowy, takze po eksporcie
--  - uslugi obce (sprzedawane z narzutem 10%, w SAP pod "Usluga obca + 10%")
--  - zalaczniki: skany kart remontowych (PDF od pracownikow bez dostepu do aplikacji)
--    i skany faktur uslug obcych; prywatny bucket Storage, dostep jak do zlecenia
-- =============================================================================

alter table public.zlecenia add column nr_azo text;
create index zlecenia_nr_azo on public.zlecenia (nr_azo);
create index zlecenia_konto on public.zlecenia (konto);

insert into public.ustawienia (klucz, wartosc, opis)
values ('narzut_uslugi_obce_proc', '10', 'Domyślny narzut na usługi obce [%]')
on conflict (klucz) do nothing;

create or replace function public.domyslny_narzut_uslug_obcych() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (wartosc #>> '{}')::numeric from public.ustawienia where klucz = 'narzut_uslugi_obce_proc'), 10);
$$;

-- --- Uslugi obce ----------------------------------------------------------------------
create table public.uslugi_obce (
  id             bigint generated always as identity primary key,
  zlecenie_id    uuid not null references public.zlecenia(id) on delete cascade,
  opis           text not null check (length(trim(opis)) > 0),
  wykonawca      text,
  numer_faktury  text,
  wartosc_zakupu numeric(12,2) not null default 0 check (wartosc_zakupu >= 0),  -- netto z faktury
  narzut_proc    numeric(5,2) not null default public.domyslny_narzut_uslug_obcych() check (narzut_proc >= 0),
  nr_linii_sap   integer,
  kolejnosc      integer not null default 0,
  utworzono      timestamptz not null default now()
);
create index on public.uslugi_obce (zlecenie_id);
alter table public.uslugi_obce enable row level security;
create policy uo_select on public.uslugi_obce for select to authenticated using (public.moze_czytac_zlecenie(zlecenie_id));
create policy uo_write on public.uslugi_obce for all to authenticated
  using (public.moze_edytowac_zlecenie(zlecenie_id)) with check (public.moze_edytowac_zlecenie(zlecenie_id));
create trigger trg_audyt after insert or update or delete on public.uslugi_obce
  for each row execute function public.audytuj();

-- --- Zalaczniki -------------------------------------------------------------------------
create table public.zalaczniki (
  id             uuid primary key default gen_random_uuid(),
  zlecenie_id    uuid not null references public.zlecenia(id) on delete cascade,
  typ            text not null check (typ in ('karta_remontowa', 'faktura_uslugi_obcej', 'inne')),
  usluga_obca_id bigint references public.uslugi_obce(id) on delete set null,
  liczba_kart    integer not null default 1 check (liczba_kart between 1 and 50),  -- ile kart jest w jednym skanie
  nazwa_pliku    text not null,
  sciezka        text not null unique,   -- {zlecenie_id}/{uuid}-{nazwa} w buckecie "zalaczniki"
  rozmiar        bigint,
  mime           text,
  utworzyl       uuid default auth.uid() references public.profiles(id) on delete set null,
  utworzono      timestamptz not null default now()
);
create index on public.zalaczniki (zlecenie_id);

-- Dzial handlowy dodaje zalaczniki na kazdym etapie (np. skan faktury po eksporcie),
-- kierownik - dopoki moze edytowac zlecenie.
create or replace function public.moze_dodac_zalacznik(p_zlecenie uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.moze_edytowac_zlecenie(p_zlecenie)
      or (public.jest_handlowcem() and exists (select 1 from public.zlecenia where id = p_zlecenie));
$$;

alter table public.zalaczniki enable row level security;
create policy za_select on public.zalaczniki for select to authenticated using (public.moze_czytac_zlecenie(zlecenie_id));
create policy za_insert on public.zalaczniki for insert to authenticated with check (public.moze_dodac_zalacznik(zlecenie_id));
create policy za_update on public.zalaczniki for update to authenticated
  using (public.moze_dodac_zalacznik(zlecenie_id)) with check (public.moze_dodac_zalacznik(zlecenie_id));
create policy za_delete on public.zalaczniki for delete to authenticated using (public.moze_dodac_zalacznik(zlecenie_id));
create trigger trg_audyt after insert or update or delete on public.zalaczniki
  for each row execute function public.audytuj();

-- Storage: prywatny bucket, pliki w folderze o nazwie = id zlecenia.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zalaczniki', 'zalaczniki', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function public.zlecenie_z_sciezki(p_nazwa text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_nazwa, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create policy zal_odczyt on storage.objects for select to authenticated
  using (bucket_id = 'zalaczniki' and public.moze_czytac_zlecenie(public.zlecenie_z_sciezki(name)));
create policy zal_dodanie on storage.objects for insert to authenticated
  with check (bucket_id = 'zalaczniki' and public.moze_dodac_zalacznik(public.zlecenie_z_sciezki(name)));
create policy zal_usuniecie on storage.objects for delete to authenticated
  using (bucket_id = 'zalaczniki' and public.moze_dodac_zalacznik(public.zlecenie_z_sciezki(name)));

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

  -- Uslugi obce (narzut domyslnie z ustawien - obecnie 10%)
  select coalesce(array_agg((e ->> 'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(coalesce(p -> 'uslugi_obce', '[]')) e where nullif(e ->> 'id', '') is not null;
  delete from uslugi_obce where zlecenie_id = v_id and id <> all (v_ids);
  for v_el in select * from jsonb_array_elements(coalesce(p -> 'uslugi_obce', '[]')) loop
    if nullif(v_el ->> 'id', '') is null then
      insert into uslugi_obce (zlecenie_id, opis, wykonawca, numer_faktury, wartosc_zakupu, narzut_proc, nr_linii_sap, kolejnosc)
      values (v_id, trim(v_el ->> 'opis'), nullif(trim(v_el ->> 'wykonawca'), ''), nullif(trim(v_el ->> 'numer_faktury'), ''),
              coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0),
              coalesce((v_el ->> 'narzut_proc')::numeric, public.domyslny_narzut_uslug_obcych()),
              nullif(v_el ->> 'nr_linii_sap', '')::int, coalesce((v_el ->> 'kolejnosc')::int, 0));
    else
      update uslugi_obce set
        opis = trim(v_el ->> 'opis'),
        wykonawca = nullif(trim(v_el ->> 'wykonawca'), ''),
        numer_faktury = nullif(trim(v_el ->> 'numer_faktury'), ''),
        wartosc_zakupu = coalesce((v_el ->> 'wartosc_zakupu')::numeric, 0),
        narzut_proc = coalesce((v_el ->> 'narzut_proc')::numeric, public.domyslny_narzut_uslug_obcych()),
        nr_linii_sap = nullif(v_el ->> 'nr_linii_sap', '')::int,
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
    if new.nr_azo is distinct from old.nr_azo then
      raise exception 'Numer AZO uzupełnia dział handlowy.';
    end if;
    if new.status is distinct from old.status
       and not (old.status in ('roboczy', 'zwrocony') and new.status = 'zlozony')
       -- wycofanie wlasnego zlozonego zlecenia - tylko przez funkcje wycofaj_zlecenie()
       and not (old.status = 'zlozony' and new.status = 'roboczy' and current_setting('app.wycofanie', true) = 'tak') then
      raise exception 'Niedozwolona zmiana statusu zlecenia.';
    end if;
  else
    if old.status in ('wyeksportowany', 'zakonczony') and new.status = old.status
       and (to_jsonb(new) - 'nr_azo' - 'zmodyfikowano') is distinct from (to_jsonb(old) - 'nr_azo' - 'zmodyfikowano') then
      raise exception 'Zlecenie jest % - aby je poprawić, najpierw zmień status (np. cofnij eksport).',
        case old.status when 'zakonczony' then 'zakończone' else 'już wyeksportowane do SAP' end;
    end if;
  end if;

  if new.status = 'zlozony' and old.status is distinct from 'zlozony' and old.status not in ('wyeksportowany', 'zakonczony') then
    if coalesce(trim(new.nr_zamowienia), '') = '' then
      raise exception 'Nie można złożyć zlecenia bez numeru zamówienia SAP.';
    end if;
    if not exists (select 1 from public.pozycje_uslug where zlecenie_id = new.id)
       and not exists (select 1 from public.pozycje_materialowe where zlecenie_id = new.id)
       and not exists (select 1 from public.uslugi_obce where zlecenie_id = new.id) then
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

    v_karty := v_karty - v_niepelne
      + coalesce((select sum(liczba_kart) from public.zalaczniki where zlecenie_id = new.id and typ = 'karta_remontowa'), 0);
    if v_karty < v_wymagane then
      raise exception 'Zlecenie wymaga % kart(y) remontowej, a jest %. Wypełnij karty, wgraj skan karty (PDF) albo odznacz „karta” przy pozycji, jeśli nie jest potrzebna.', v_wymagane, v_karty;
    end if;
    if v_niepelne > 0 then
      raise exception 'Niekompletne karty remontowe (%): uzupełnij numer karty, urządzenie, datę zakończenia i osobę odbierającą.', v_niepelne;
    end if;
    new.zlozono := now();
  end if;

  if new.status = 'wyeksportowany' and old.status is distinct from 'wyeksportowany' and old.status <> 'zakonczony' then
    new.wyeksportowano := now();
  end if;
  if new.status = 'zakonczony' and old.status is distinct from 'zakonczony' then
    new.zakonczono := now();
  elsif new.status <> 'zakonczony' then
    new.zakonczono := null;
  end if;
  return new;
end $$;
revoke execute on function public.pilnuj_zlecenia() from public, anon, authenticated;

revoke execute on function public.domyslny_narzut_uslug_obcych(), public.moze_dodac_zalacznik(uuid) from public, anon;
grant execute on function public.domyslny_narzut_uslug_obcych(), public.moze_dodac_zalacznik(uuid) to authenticated;
