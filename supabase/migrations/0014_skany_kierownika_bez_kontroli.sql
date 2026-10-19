-- Uwagi kierownika (2026-10-19):
-- 1. Kierownik nie mógł wgrać skanu karty remontowej do złożonego zlecenia (przycisk znikał po złożeniu).
--    Papierową kartę wypełnia produkcja, skan często jest gotowy dopiero później - kierownik może teraz
--    dodawać załączniki do zleceń swojego MPK na każdym etapie. Usuwać/poprawiać może dopóki edytuje
--    zlecenie, a po złożeniu tylko własne pliki i tylko przed eksportem do SAP.
-- 2. Pola "mechanik przyjmujący (Bioerg)" i "kontrola końcowa" nie są potrzebne do rozliczenia -
--    karta jest kompletna bez osoby przyjmującej (kolumna zostaje dla starych danych).

create or replace function public.moze_dodac_zalacznik(p_zlecenie uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.zlecenia where id = p_zlecenie)
     and public.moze_czytac_zlecenie(p_zlecenie);
$$;

create or replace function public.moze_zmienic_zalacznik(p_zlecenie uuid, p_utworzyl uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.jest_handlowcem()
      or public.moze_edytowac_zlecenie(p_zlecenie)
      or (p_utworzyl = auth.uid()
          and exists (select 1 from public.zlecenia z
                      where z.id = p_zlecenie and public.moje_mpk(z.mpk)
                        and z.status not in ('wyeksportowany', 'zakonczony')));
$$;
revoke execute on function public.moze_zmienic_zalacznik(uuid, uuid) from public, anon;
grant execute on function public.moze_zmienic_zalacznik(uuid, uuid) to authenticated;

drop policy if exists za_update on public.zalaczniki;
drop policy if exists za_delete on public.zalaczniki;
create policy za_update on public.zalaczniki for update to authenticated
  using (public.moze_zmienic_zalacznik(zlecenie_id, utworzyl))
  with check (public.moze_zmienic_zalacznik(zlecenie_id, utworzyl));
create policy za_delete on public.zalaczniki for delete to authenticated
  using (public.moze_zmienic_zalacznik(zlecenie_id, utworzyl));

drop policy if exists zal_usuniecie on storage.objects;
create policy zal_usuniecie on storage.objects for delete to authenticated
  using (bucket_id = 'zalaczniki'
         and public.moze_czytac_zlecenie(public.zlecenie_z_sciezki(name))
         and (public.jest_handlowcem()
              or public.moze_edytowac_zlecenie(public.zlecenie_z_sciezki(name))
              or owner_id = auth.uid()::text));

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
