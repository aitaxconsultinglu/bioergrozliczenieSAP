-- Funkcje triggerow nie sa API - zamkniecie ich w /rest/v1/rpc (lint 0028/0029).
-- Funkcje pomocnicze RLS (jest_handlowcem, moje_mpk, moze_*) zostaja dla authenticated celowo:
-- zwracaja tylko informacje o uprawnieniach samego wywolujacego.
revoke execute on function
  public.audytuj(),
  public.chron_konto_administratora(),
  public.chron_role_administratora(),
  public.obsluz_nowego_uzytkownika(),
  public.pilnuj_zlecenia(),
  public.ustaw_cene_uslugi(),
  public.ustaw_narzut_materialu(),
  public.dotknij_zmodyfikowano()
from public, anon, authenticated;
