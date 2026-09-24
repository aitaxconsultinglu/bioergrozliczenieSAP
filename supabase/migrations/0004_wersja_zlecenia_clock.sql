-- Znacznik wersji zlecenia (zmodyfikowano) z zegara, nie z poczatku transakcji:
-- now() jest stale w obrebie transakcji, wiec dwa zapisy w jednej transakcji mialyby
-- te sama "wersje". Trigger trg_zmodyfikowano odpala sie po trg_pilnuj_zlecenia
-- (kolejnosc alfabetyczna) i nadpisuje wartosc ustawiona tam przez now().
create or replace function public.dotknij_zmodyfikowano() returns trigger
language plpgsql set search_path = public as $$
begin
  new.zmodyfikowano := clock_timestamp();
  return new;
end $$;
revoke execute on function public.dotknij_zmodyfikowano() from public, anon, authenticated;

create trigger trg_zmodyfikowano before update on public.zlecenia
  for each row execute function public.dotknij_zmodyfikowano();
