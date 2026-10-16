-- =============================================================================
-- 0013: kosz - przywracanie usunietych zlecen z dziennika zmian (audit_log)
-- Usuniecie zlecenia zapisuje w audit_log pelne kopie wierszy (zlecenie + pozycje,
-- materialy, karty, braki, uslugi obce, zalaczniki - kaskada w tej samej transakcji).
-- Dzial handlowy moze z nich odtworzyc zlecenie 1:1, z zamrozonymi cenami.
-- Pliki zalacznikow nie sa kasowane z magazynu przy usuwaniu zlecenia, wiec wracaja tez skany.
-- =============================================================================

-- Przy przywracaniu cena ma zostac ta zapisana (zamrozona), a nie biezaca z cennika.
create or replace function public.ustaw_cene_uslugi() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_setting('app.przywracanie', true) = 'tak' then
    return new;
  end if;
  if new.cennik_pozycja_id is null then
    new.cena := coalesce(new.wlasna_cena, 0);
  elsif tg_op = 'INSERT' or new.cennik_pozycja_id is distinct from old.cennik_pozycja_id then
    select cena into new.cena from public.cennik_pozycje where id = new.cennik_pozycja_id;
  end if;
  return new;
end $$;
revoke execute on function public.ustaw_cene_uslugi() from public, anon, authenticated;

create or replace function public.usuniete_zlecenia()
returns table (id uuid, nr_zamowienia text, nazwa text, mpk text, status text, nr_azo text,
               usunieto timestamptz, usunal text)
language sql stable security definer set search_path = public as $$
  select distinct on (a.rekord_id) a.rekord_id::uuid, a.zmiany ->> 'nr_zamowienia', a.zmiany ->> 'nazwa', a.zmiany ->> 'mpk',
         a.zmiany ->> 'status', a.zmiany ->> 'nr_azo', a.czas, a.user_email
  from audit_log a
  where public.jest_handlowcem() and a.tabela = 'zlecenia' and a.akcja = 'delete'
    and not exists (select 1 from zlecenia z where z.id = a.rekord_id::uuid)
  order by a.rekord_id, a.czas desc;
$$;

create or replace function public.przywroc_zlecenie(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_czas timestamptz;
  v_dane jsonb;
begin
  if not public.jest_handlowcem() then
    raise exception 'Zlecenia przywraca dział handlowy.';
  end if;
  if exists (select 1 from zlecenia where id = p_id) then
    raise exception 'To zlecenie już istnieje.';
  end if;
  select czas, zmiany into v_czas, v_dane from audit_log
  where tabela = 'zlecenia' and akcja = 'delete' and rekord_id = p_id::text order by czas desc limit 1;
  if v_dane is null then
    raise exception 'Nie znaleziono kopii tego zlecenia w dzienniku zmian.';
  end if;

  perform set_config('app.przywracanie', 'tak', true);

  insert into zlecenia select (jsonb_populate_record(null::zlecenia, v_dane)).*;

  -- Wiersze podrzedne usuniete kaskadowo razem ze zleceniem (ten sam czas transakcji).
  insert into karty_remontowe select (jsonb_populate_record(null::karty_remontowe, zmiany)).*
  from audit_log where tabela = 'karty_remontowe' and akcja = 'delete' and zlecenie_id = p_id and czas = v_czas;

  insert into uslugi_obce overriding system value select (jsonb_populate_record(null::uslugi_obce, zmiany)).*
  from audit_log where tabela = 'uslugi_obce' and akcja = 'delete' and zlecenie_id = p_id and czas = v_czas;

  insert into pozycje_uslug overriding system value select (jsonb_populate_record(null::pozycje_uslug, zmiany)).*
  from audit_log where tabela = 'pozycje_uslug' and akcja = 'delete' and zlecenie_id = p_id and czas = v_czas;

  insert into pozycje_materialowe overriding system value select (jsonb_populate_record(null::pozycje_materialowe, zmiany)).*
  from audit_log where tabela = 'pozycje_materialowe' and akcja = 'delete' and zlecenie_id = p_id and czas = v_czas;

  insert into braki_godzin overriding system value select (jsonb_populate_record(null::braki_godzin, zmiany)).*
  from audit_log where tabela = 'braki_godzin' and akcja = 'delete' and zlecenie_id = p_id and czas = v_czas;

  insert into zalaczniki select (jsonb_populate_record(null::zalaczniki, zmiany)).*
  from audit_log where tabela = 'zalaczniki' and akcja = 'delete' and zlecenie_id = p_id and czas = v_czas;

  perform set_config('app.przywracanie', '', true);

  insert into audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  values (p_id, 'zlecenia', p_id::text, 'przywrocenie', auth.uid(), auth.jwt() ->> 'email',
          jsonb_build_object('usunieto', v_czas));
end $$;

revoke execute on function public.usuniete_zlecenia(), public.przywroc_zlecenie(uuid) from public, anon;
grant execute on function public.usuniete_zlecenia(), public.przywroc_zlecenie(uuid) to authenticated;
