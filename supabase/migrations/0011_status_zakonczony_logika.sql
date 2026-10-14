-- =============================================================================
-- 0011: obsluga statusu "zakonczony" (typ dodany w 0010)
--  - zakonczone zlecenie jest zablokowane tak samo jak wyeksportowane
--  - dzial handlowy ustawia je recznie ("Zmien status") albo zbiorczo z listy
--    (oznacz_zakonczone) - tylko ze statusu "wyeksportowany"
-- =============================================================================

create or replace function public.moze_edytowac_zlecenie(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.zlecenia z
    where z.id = p_id and (
      (public.jest_handlowcem() and z.status not in ('wyeksportowany', 'zakonczony'))
      or (public.moje_mpk(z.mpk) and z.status in ('roboczy', 'zwrocony'))
    )
  );
$$;

drop policy if exists zl_delete on public.zlecenia;
create policy zl_delete on public.zlecenia for delete to authenticated
  using ((public.jest_handlowcem() and status not in ('wyeksportowany', 'zakonczony'))
         or (public.moje_mpk(mpk) and status = 'roboczy'));

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
       and not (old.status in ('roboczy', 'zwrocony') and new.status = 'zlozony')
       -- wycofanie wlasnego zlozonego zlecenia - tylko przez funkcje wycofaj_zlecenie()
       and not (old.status = 'zlozony' and new.status = 'roboczy' and current_setting('app.wycofanie', true) = 'tak') then
      raise exception 'Niedozwolona zmiana statusu zlecenia.';
    end if;
  else
    if old.status in ('wyeksportowany', 'zakonczony') and new.status = old.status then
      raise exception 'Zlecenie jest % - aby je poprawić, najpierw zmień status (np. cofnij eksport).',
        case old.status when 'zakonczony' then 'zakończone' else 'już wyeksportowane do SAP' end;
    end if;
  end if;

  if new.status = 'zlozony' and old.status is distinct from 'zlozony' and old.status not in ('wyeksportowany', 'zakonczony') then
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

create or replace function public.zmien_status_zlecenia(p_id uuid, p_status status_zlecenia, p_powod text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stary status_zlecenia;
begin
  if not public.jest_handlowcem() then
    raise exception 'Ręczną zmianę statusu wykonuje dział handlowy.';
  end if;
  if coalesce(trim(p_powod), '') = '' then
    raise exception 'Podaj powód zmiany statusu - zapisze się w historii zlecenia.';
  end if;
  select status into v_stary from zlecenia where id = p_id for update;
  if not found then
    raise exception 'Nie znaleziono zlecenia.';
  end if;
  if v_stary = p_status then
    raise exception 'Zlecenie ma już ten status.';
  end if;

  update zlecenia set
    status = p_status,
    komentarz_handlowca = case when p_status = 'zwrocony' then trim(p_powod) else komentarz_handlowca end,
    -- data eksportu zostaje, gdy zlecenie idzie dalej (zakonczony) albo wraca z zakonczonego do wyeksportowanego
    wyeksportowano = case when p_status in ('wyeksportowany', 'zakonczony') then wyeksportowano else null end,
    zlozono = case when p_status in ('roboczy', 'zwrocony') then null else zlozono end
  where id = p_id;

  insert into audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  values (p_id, 'zlecenia', p_id::text, 'zmiana_statusu', auth.uid(), auth.jwt() ->> 'email',
          jsonb_build_object('status', jsonb_build_object('z', v_stary, 'na', p_status), 'powod', trim(p_powod)));
end $$;

-- Zbiorcze zamkniecie zlecen wyeksportowanych (z listy zlecen).
create or replace function public.oznacz_zakonczone(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.jest_handlowcem() then
    raise exception 'Zlecenia zamyka dział handlowy.';
  end if;
  if exists (select 1 from zlecenia where id = any (p_ids) and status <> 'wyeksportowany') then
    raise exception 'Zakończyć można tylko zlecenia wyeksportowane do SAP. Odznacz pozostałe.';
  end if;
  update zlecenia set status = 'zakonczony' where id = any (p_ids);
  get diagnostics v_n = row_count;
  insert into audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  select id, 'zlecenia', id::text, 'zmiana_statusu', auth.uid(), auth.jwt() ->> 'email',
         jsonb_build_object('status', jsonb_build_object('z', 'wyeksportowany', 'na', 'zakonczony'), 'powod', 'Zakończone')
  from unnest(p_ids) id;
  return v_n;
end $$;

revoke execute on function public.oznacz_zakonczone(uuid[]) from public, anon;
grant execute on function public.oznacz_zakonczone(uuid[]) to authenticated;
