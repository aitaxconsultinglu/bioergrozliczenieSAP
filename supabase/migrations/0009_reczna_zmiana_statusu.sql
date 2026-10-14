-- =============================================================================
-- 0009: reczna zmiana statusu zlecenia "w razie pomylki"
--  - dzial handlowy: dowolny status (roboczy / zlozony / zwrocony / wyeksportowany),
--    z obowiazkowym powodem zapisywanym w historii zlecenia
--  - kierownik: moze wycofac WLASNE zlozone zlecenie do roboczego, dopoki nie zostalo
--    wyeksportowane do SAP
-- Walidacja zlozenia (nr zamowienia, karty) nadal dziala przy przejsciu roboczy/zwrocony
-- -> zlozony, bo pilnuje jej trigger pilnuj_zlecenia.
-- =============================================================================

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
    -- Zwrot bez komentarza bylby dla kierownika niezrozumialy - powod staje sie komentarzem.
    komentarz_handlowca = case when p_status = 'zwrocony' then trim(p_powod) else komentarz_handlowca end,
    wyeksportowano = case when p_status = 'wyeksportowany' then wyeksportowano else null end,
    zlozono = case when p_status in ('roboczy', 'zwrocony') then null else zlozono end
  where id = p_id;

  insert into audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  values (p_id, 'zlecenia', p_id::text, 'zmiana_statusu', auth.uid(), auth.jwt() ->> 'email',
          jsonb_build_object('status', jsonb_build_object('z', v_stary, 'na', p_status), 'powod', trim(p_powod)));
end $$;

-- Kierownik nie moze sam zmienic statusu ze "zlozony" (RLS + trigger). Ta funkcja ustawia
-- lokalna flage transakcji, ktora trigger pilnuj_zlecenia przepuszcza tylko dla przejscia
-- zlozony -> roboczy. Uzytkownik pozostaje ten sam, wiec historia pokazuje, kto wycofal.
create or replace function public.wycofaj_zlecenie(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_z zlecenia%rowtype;
begin
  select * into v_z from zlecenia where id = p_id for update;
  if not found or not (public.moje_mpk(v_z.mpk) or public.jest_handlowcem()) then
    raise exception 'Nie znaleziono zlecenia albo nie masz do niego dostępu.';
  end if;
  if v_z.status <> 'zlozony' then
    raise exception 'Wycofać można tylko zlecenie złożone, które nie zostało jeszcze wyeksportowane do SAP.';
  end if;

  perform set_config('app.wycofanie', 'tak', true);
  update zlecenia set status = 'roboczy', zlozono = null where id = p_id;
  perform set_config('app.wycofanie', '', true);

  insert into audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  values (p_id, 'zlecenia', p_id::text, 'zmiana_statusu', auth.uid(), auth.jwt() ->> 'email',
          jsonb_build_object('status', jsonb_build_object('z', 'zlozony', 'na', 'roboczy'), 'powod', 'Wycofane do poprawy'));
end $$;

-- Trigger z nowym wyjatkiem dla wycofania (reszta regul bez zmian wzgledem 0007).
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

revoke execute on function public.zmien_status_zlecenia(uuid, status_zlecenia, text), public.wycofaj_zlecenie(uuid) from public, anon;
grant execute on function public.zmien_status_zlecenia(uuid, status_zlecenia, text), public.wycofaj_zlecenie(uuid) to authenticated;
