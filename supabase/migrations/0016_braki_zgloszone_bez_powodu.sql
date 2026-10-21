-- Dział handlowy 2026-10-21:
-- 1. Status "braki_zgloszone" (enum dodany w 0015) - zablokowany do edycji jak "wyeksportowany".
-- 2. Powód ręcznej zmiany statusu NIE jest już wymagany (przy "Zakończony" był zbędny). Jeśli jest podany,
--    zapisuje się w historii, a przy zwrocie do poprawki trafia do komentarza dla kierownika.
-- 3. "Zakończ" działa z "wyeksportowany" i z "braki_zgloszone".

create or replace function public.moze_edytowac_zlecenie(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.zlecenia z
    where z.id = p_id and (
      (public.jest_handlowcem() and z.status not in ('wyeksportowany', 'braki_zgloszone', 'zakonczony'))
      or (public.moje_mpk(z.mpk) and z.status in ('roboczy', 'zwrocony'))
    )
  );
$$;

drop policy if exists zl_delete on public.zlecenia;
create policy zl_delete on public.zlecenia for delete to authenticated
  using ((public.jest_handlowcem() and status not in ('wyeksportowany', 'braki_zgloszone', 'zakonczony'))
         or (public.moje_mpk(mpk) and status = 'roboczy'));

create or replace function public.moze_zmienic_zalacznik(p_zlecenie uuid, p_utworzyl uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.jest_handlowcem()
      or public.moze_edytowac_zlecenie(p_zlecenie)
      or (p_utworzyl = auth.uid()
          and exists (select 1 from public.zlecenia z
                      where z.id = p_zlecenie and public.moje_mpk(z.mpk)
                        and z.status not in ('wyeksportowany', 'braki_zgloszone', 'zakonczony')));
$$;

create or replace function public.zmien_status_zlecenia(p_id uuid, p_status status_zlecenia, p_powod text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_stary status_zlecenia;
  v_powod text := nullif(trim(coalesce(p_powod, '')), '');
begin
  if not public.jest_handlowcem() then
    raise exception 'Ręczną zmianę statusu wykonuje dział handlowy.';
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
    komentarz_handlowca = case when p_status = 'zwrocony' and v_powod is not null then v_powod else komentarz_handlowca end,
    wyeksportowano = case when p_status in ('wyeksportowany', 'braki_zgloszone', 'zakonczony') then wyeksportowano else null end,
    zlozono = case when p_status in ('roboczy', 'zwrocony') then null else zlozono end
  where id = p_id;

  insert into audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  values (p_id, 'zlecenia', p_id::text, 'zmiana_statusu', auth.uid(), auth.jwt() ->> 'email',
          jsonb_strip_nulls(jsonb_build_object('status', jsonb_build_object('z', v_stary, 'na', p_status), 'powod', v_powod)));
end $$;

create or replace function public.oznacz_zakonczone(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.jest_handlowcem() then
    raise exception 'Zlecenia zamyka dział handlowy.';
  end if;
  if exists (select 1 from zlecenia where id = any (p_ids) and status not in ('wyeksportowany', 'braki_zgloszone')) then
    raise exception 'Zakończyć można tylko zlecenia wyeksportowane do SAP (lub z brakami zgłoszonymi do SAP). Odznacz pozostałe.';
  end if;
  insert into audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  select id, 'zlecenia', id::text, 'zmiana_statusu', auth.uid(), auth.jwt() ->> 'email',
         jsonb_build_object('status', jsonb_build_object('z', status, 'na', 'zakonczony'))
  from zlecenia where id = any (p_ids);
  update zlecenia set status = 'zakonczony' where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

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
       and not (old.status = 'zlozony' and new.status = 'roboczy' and current_setting('app.wycofanie', true) = 'tak') then
      raise exception 'Niedozwolona zmiana statusu zlecenia.';
    end if;
  else
    if old.status in ('wyeksportowany', 'braki_zgloszone', 'zakonczony') and new.status = old.status
       and (to_jsonb(new) - 'nr_azo' - 'zmodyfikowano') is distinct from (to_jsonb(old) - 'nr_azo' - 'zmodyfikowano') then
      raise exception 'Zlecenie jest % - aby je poprawić, najpierw zmień status (np. cofnij eksport).',
        case old.status when 'zakonczony' then 'zakończone' when 'braki_zgloszone' then 'w statusie „braki zgłoszone do SAP”' else 'już wyeksportowane do SAP' end;
    end if;
  end if;

  if new.status = 'zlozony' and old.status is distinct from 'zlozony' and old.status not in ('wyeksportowany', 'braki_zgloszone', 'zakonczony') then
    if coalesce(trim(new.nr_zamowienia), '') = '' then
      raise exception 'Nie można złożyć zlecenia bez numeru zamówienia SAP.';
    end if;
    if not exists (select 1 from public.pozycje_uslug where zlecenie_id = new.id)
       and not exists (select 1 from public.pozycje_materialowe where zlecenie_id = new.id)
       and not exists (select 1 from public.uslugi_obce where zlecenie_id = new.id) then
      raise exception 'Zlecenie nie ma żadnych pozycji do rozliczenia.';
    end if;

    select coalesce(ceil(sum(pu.ilosc)), 0) into v_wymagane
    from public.pozycje_uslug pu
    left join public.cennik_pozycje cp on cp.id = pu.cennik_pozycja_id
    left join public.cennik_kategorie ck on ck.nr_pozycji = cp.nr_pozycji
    where pu.zlecenie_id = new.id and coalesce(pu.wymaga_karty, ck.wymaga_karty, false);

    select count(*),
           count(*) filter (where coalesce(trim(numer_karty), '') = ''
                               or coalesce(trim(urzadzenie_nazwa), '') = ''
                               or data_zakonczenia is null)
      into v_karty, v_niepelne
    from public.karty_remontowe where zlecenie_id = new.id;

    v_karty := v_karty - v_niepelne
      + coalesce((select sum(liczba_kart) from public.zalaczniki where zlecenie_id = new.id and typ = 'karta_remontowa'), 0);
    if v_karty < v_wymagane then
      raise exception 'Zlecenie wymaga % kart(y) remontowej, a jest %. Wypełnij karty, wgraj skan karty (PDF) albo odznacz „karta” przy pozycji, jeśli nie jest potrzebna.', v_wymagane, v_karty;
    end if;
    if v_niepelne > 0 then
      raise exception 'Niekompletne karty remontowe (%): uzupełnij numer karty, urządzenie i datę zakończenia (albo usuń pustą kartę i wgraj skan).', v_niepelne;
    end if;
    new.zlozono := now();
  end if;

  if new.status = 'wyeksportowany' and old.status is distinct from 'wyeksportowany' and old.status not in ('braki_zgloszone', 'zakonczony') then
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
