-- =============================================================================
-- Bioerg - rozliczenia prac dla Synthos (SAP)
-- 0001: schemat bazy, RLS, walidacja zlozenia zlecenia, audyt
-- =============================================================================

-- --- Typy ---------------------------------------------------------------------
create type public.rola_uzytkownika as enum ('kierownik', 'handlowiec');
create type public.status_zlecenia  as enum ('roboczy', 'zlozony', 'zwrocony', 'wyeksportowany');
create type public.dostawca_materialu as enum ('bioerg', 'synthos');
create type public.status_braku as enum ('zgloszony', 'uzupelniony', 'rozliczony');

-- --- Slowniki -----------------------------------------------------------------
create table public.mpk (
  kod     text primary key check (kod ~ '^P[0-9]{2}$'),
  nazwa   text,
  aktywne boolean not null default true
);
insert into public.mpk (kod) values ('P03'),('P04'),('P05'),('P06'),('P07'),('P08'),('P09');

-- Kategoria = "Numer pozycji kontraktu" z cennika (10, 20, ... 560).
-- wymaga_karty + szablon_karty sterują walidacją - zmiana to UPDATE, nie migracja.
create table public.cennik_kategorie (
  nr_pozycji     integer primary key,
  nazwa          text not null,
  dokument_zaopatrzeniowy text,
  wymaga_karty   boolean not null default false,
  szablon_karty  text,
  check (not wymaga_karty or szablon_karty is not null)
);

-- Indeks SAP NIE jest unikalny (5004062 wystepuje w 23 kategoriach z roznym
-- numerem linii) - kluczem jest para (kategoria, numer linii).
create table public.cennik_pozycje (
  id          bigint generated always as identity primary key,
  nr_pozycji  integer not null references public.cennik_kategorie(nr_pozycji),
  numer_linii integer not null,
  indeks_sap  text not null,
  opis        text not null,
  jm          text not null,
  cena        numeric(12,2) not null check (cena >= 0),
  aktywna     boolean not null default true,
  unique (nr_pozycji, numer_linii)
);
create index on public.cennik_pozycje (indeks_sap);

-- Stawki robocizny = widok na grupe 310, a nie kopia. Jedno zrodlo prawdy.
create view public.stawki_robocizny with (security_invoker = true) as
select
  p.id as cennik_pozycja_id,
  trim(regexp_replace(p.opis, '\s*\([^)]*\)\s*$', '')) as stanowisko,
  case substring(p.opis from '\(([^)]*)\)\s*$')
    when '7.00-15.00'  then '7-15'
    when '15.00-19.00' then '15-19'
    when '19.00-7.00'  then '19-7'
    when 'dni wolne'   then 'wolne'
    else 'stala'
  end as pora,
  p.indeks_sap, p.cena, p.numer_linii
from public.cennik_pozycje p
where p.nr_pozycji = 310 and p.jm = 'H' and p.aktywna;

-- --- Uzytkownicy ----------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  imie_nazwisko       text,
  rola                public.rola_uzytkownika not null default 'kierownik',
  chroniony           boolean not null default false,
  wymaga_zmiany_hasla boolean not null default false,
  utworzono           timestamptz not null default now()
);

create table public.profile_mpk (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mpk_kod    text not null references public.mpk(kod),
  primary key (profile_id, mpk_kod)
);

-- Uprawnienia nadawane przy pierwszym utworzeniu konta (konta auth nie istnieja w chwili seedowania).
create table public.uprawnienia_startowe (
  email         text primary key,
  imie_nazwisko text,
  rola          public.rola_uzytkownika not null default 'kierownik',
  mpk           text[] not null default '{}',
  chroniony     boolean not null default false
);
insert into public.uprawnienia_startowe (email, imie_nazwisko, rola, chroniony)
values ('aitaxconsultinglu@gmail.com', 'Administrator', 'handlowiec', true);

-- --- Zlecenia -----------------------------------------------------------------
create table public.zlecenia (
  id                 uuid primary key default gen_random_uuid(),
  mpk                text not null references public.mpk(kod),
  nr_zamowienia      text,             -- wpisywany recznie (brak API/eksportu z SAP)
  pozycja_zamowienia integer,          -- sufiks -10 / -20 z numeru zamowienia
  konto              text,             -- np. URR/1/2026/BZ
  nazwa              text not null,    -- np. POMPA 3X9K NR 422
  mechanik           text,
  szablon            text not null default 'urzadzenie',
  dane_szablonu      jsonb not null default '{}',
  data_przyjecia     date,
  data_zakonczenia   date,
  status             public.status_zlecenia not null default 'roboczy',
  uwagi              text,
  komentarz_handlowca text,
  utworzyl           uuid default auth.uid() references public.profiles(id) on delete set null,
  utworzono          timestamptz not null default now(),
  zmodyfikowano      timestamptz not null default now(),
  zlozono            timestamptz,
  wyeksportowano     timestamptz
);
create index on public.zlecenia (mpk, status);
create index on public.zlecenia (nr_zamowienia);

create table public.karty_remontowe (
  id                    uuid primary key default gen_random_uuid(),
  zlecenie_id           uuid not null references public.zlecenia(id) on delete cascade,
  numer_karty           text unique,   -- np. KR 17/12/2025
  szablon               text not null default 'urzadzenie',
  urzadzenie_nazwa      text,
  urzadzenie_typ        text,
  urzadzenie_nr         text,
  klient                text not null default 'Synthos',
  data_przyjecia        date,
  data_zakonczenia      date,
  mechanik_przekazujacy text,
  mechanik_przyjmujacy  text,
  opis_uszkodzenia      text,
  dane                  jsonb not null default '{}',  -- pola specyficzne dla szablonu
  utworzono             timestamptz not null default now(),
  zmodyfikowano         timestamptz not null default now()
);
create index on public.karty_remontowe (zlecenie_id);

-- Pozycje cennikowe ORAZ robocizna (robocizna to tez pozycja cennika - grupa 310).
create table public.pozycje_uslug (
  id                bigint generated always as identity primary key,
  zlecenie_id       uuid not null references public.zlecenia(id) on delete cascade,
  cennik_pozycja_id bigint not null references public.cennik_pozycje(id),
  ilosc             numeric(12,3) not null check (ilosc > 0),
  cena              numeric(12,2) not null check (cena >= 0), -- zamrozona w chwili wpisu
  doplata_proc      numeric(5,2) not null default 0 check (doplata_proc >= 0), -- np. przezwojenie +10%
  doplata_opis      text,
  mpk_wykonawcy     text references public.mpk(kod), -- kooperacja miedzy MPK
  karta_id          uuid references public.karty_remontowe(id) on delete set null,
  opis              text,
  kolejnosc         integer not null default 0,
  utworzono         timestamptz not null default now()
);
create index on public.pozycje_uslug (zlecenie_id);

create table public.pozycje_materialowe (
  id                bigint generated always as identity primary key,
  zlecenie_id       uuid not null references public.zlecenia(id) on delete cascade,
  karta_id          uuid references public.karty_remontowe(id) on delete set null,
  nazwa             text not null,
  ilosc             numeric(12,3) not null check (ilosc > 0),
  jm                text not null default 'szt.',
  wartosc_zakupu    numeric(12,2) not null default 0 check (wartosc_zakupu >= 0), -- laczna z faktury
  dostawca          public.dostawca_materialu not null default 'bioerg',
  narzut_proc       numeric(5,2) not null default 15 check (narzut_proc >= 0),
  cennik_pozycja_id bigint references public.cennik_pozycje(id), -- null = "Material +15%" z kategorii
  numer_faktury     text,
  kolejnosc         integer not null default 0,
  utworzono         timestamptz not null default now()
);
create index on public.pozycje_materialowe (zlecenie_id);

create table public.braki_godzin (
  id                bigint generated always as identity primary key,
  zlecenie_id       uuid not null references public.zlecenia(id) on delete cascade,
  cennik_pozycja_id bigint references public.cennik_pozycje(id),
  ilosc_rbg         numeric(8,2) not null check (ilosc_rbg > 0),
  status            public.status_braku not null default 'zgloszony',
  opis              text,
  utworzono         timestamptz not null default now(),
  zmieniono_status  timestamptz
);
create index on public.braki_godzin (status);

create table public.eksporty (
  id          uuid primary key default gen_random_uuid(),
  utworzyl    uuid default auth.uid() references public.profiles(id) on delete set null,
  utworzono   timestamptz not null default now(),
  nazwa_pliku text
);
create table public.eksporty_zlecenia (
  eksport_id  uuid not null references public.eksporty(id) on delete cascade,
  zlecenie_id uuid not null references public.zlecenia(id) on delete cascade,
  primary key (eksport_id, zlecenie_id)
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  zlecenie_id uuid,
  tabela      text not null,
  rekord_id   text,
  akcja       text not null,
  user_id     uuid,
  user_email  text,
  zmiany      jsonb,
  czas        timestamptz not null default now()
);
create index on public.audit_log (zlecenie_id, czas);

-- --- Funkcje pomocnicze (RLS) ---------------------------------------------------
create function public.jest_handlowcem() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rola = 'handlowiec' from public.profiles where id = auth.uid()), false);
$$;

create function public.moje_mpk(p_kod text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profile_mpk where profile_id = auth.uid() and mpk_kod = p_kod);
$$;

create function public.moze_czytac_zlecenie(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.jest_handlowcem()
      or exists (select 1 from public.zlecenia z where z.id = p_id and public.moje_mpk(z.mpk));
$$;

-- Kierownik edytuje tylko robocze/zwrocone; handlowiec wszystko poza wyeksportowanym.
create function public.moze_edytowac_zlecenie(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.zlecenia z
    where z.id = p_id and (
      (public.jest_handlowcem() and z.status <> 'wyeksportowany')
      or (public.moje_mpk(z.mpk) and z.status in ('roboczy', 'zwrocony'))
    )
  );
$$;

-- --- Triggery: uzytkownicy ------------------------------------------------------
create function public.obsluz_nowego_uzytkownika() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_seed public.uprawnienia_startowe%rowtype;
begin
  select * into v_seed from public.uprawnienia_startowe where lower(email) = lower(new.email);
  insert into public.profiles (id, email, imie_nazwisko, rola, chroniony)
  values (new.id, new.email,
          coalesce(v_seed.imie_nazwisko, split_part(new.email, '@', 1)),
          coalesce(v_seed.rola, 'kierownik'),
          coalesce(v_seed.chroniony, false))
  on conflict (id) do nothing;
  -- Brak wpisu startowego = konto bez MPK = nie widzi zadnych danych.
  if v_seed.mpk is not null then
    insert into public.profile_mpk (profile_id, mpk_kod)
    select new.id, unnest(v_seed.mpk) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_nowy_uzytkownik after insert on auth.users
  for each row execute function public.obsluz_nowego_uzytkownika();

create function public.chron_konto_administratora() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = old.id and chroniony) then
    raise exception 'Konto % jest kontem administratora aplikacji i nie moze zostac usuniete.', old.email
      using errcode = 'check_violation';
  end if;
  return old;
end $$;
create trigger trg_chron_konto_administratora before delete on auth.users
  for each row execute function public.chron_konto_administratora();

create function public.chron_role_administratora() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.chroniony and (new.rola is distinct from old.rola or not new.chroniony) then
    raise exception 'Nie mozna zmienic roli ani zdjac ochrony z konta administratora (%).', old.email
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_chron_role_administratora before update on public.profiles
  for each row execute function public.chron_role_administratora();

create function public.potwierdz_ustawienie_hasla() returns void
language sql security definer set search_path = public as $$
  update public.profiles set wymaga_zmiany_hasla = false where id = auth.uid();
$$;

-- --- Triggery: pozycje ----------------------------------------------------------
-- Cena zamrazana z cennika przy wpisie; zmiana umowy nie przepisuje historii.
create function public.ustaw_cene_uslugi() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.cennik_pozycja_id is distinct from old.cennik_pozycja_id then
    select cena into new.cena from public.cennik_pozycje where id = new.cennik_pozycja_id;
  end if;
  return new;
end $$;
create trigger trg_cena_uslugi before insert or update on public.pozycje_uslug
  for each row execute function public.ustaw_cene_uslugi();

-- Material dostarczony przez Synthos: bez narzutu (zalozenie do potwierdzenia z Zogala - BRIEF 6.1).
create function public.ustaw_narzut_materialu() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.dostawca = 'synthos' then
    new.narzut_proc := 0;
  elsif tg_op = 'UPDATE' and old.dostawca = 'synthos' and new.narzut_proc = 0 then
    new.narzut_proc := 15;
  end if;
  return new;
end $$;
create trigger trg_narzut_materialu before insert or update on public.pozycje_materialowe
  for each row execute function public.ustaw_narzut_materialu();

create function public.dotknij_zmodyfikowano() returns trigger
language plpgsql set search_path = public as $$
begin
  new.zmodyfikowano := now();
  return new;
end $$;
create trigger trg_zmodyfikowano before update on public.karty_remontowe
  for each row execute function public.dotknij_zmodyfikowano();

-- --- Walidacja i przejscia statusow zlecenia --------------------------------------
create function public.pilnuj_zlecenia() returns trigger
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
      raise exception 'Tylko dzial handlowy moze zmieniac komentarz handlowca.';
    end if;
    if new.status is distinct from old.status
       and not (old.status in ('roboczy', 'zwrocony') and new.status = 'zlozony') then
      raise exception 'Niedozwolona zmiana statusu: % -> %.', old.status, new.status;
    end if;
  else
    if old.status = 'wyeksportowany' and new.status = 'wyeksportowany' then
      raise exception 'Zlecenie jest wyeksportowane do SAP. Aby je poprawic, najpierw cofnij eksport.';
    end if;
  end if;

  if new.status = 'zlozony' and old.status is distinct from 'zlozony' and old.status <> 'wyeksportowany' then
    if coalesce(trim(new.nr_zamowienia), '') = '' then
      raise exception 'Nie mozna zlozyc zlecenia bez numeru zamowienia SAP.';
    end if;
    if not exists (select 1 from public.pozycje_uslug where zlecenie_id = new.id)
       and not exists (select 1 from public.pozycje_materialowe where zlecenie_id = new.id) then
      raise exception 'Zlecenie nie ma zadnych pozycji do rozliczenia.';
    end if;

    -- Twarda regula: pozycja z kategorii wymagajacej karty => tyle kart, ile sztuk.
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
      raise exception 'Zlecenie wymaga % kart(y) remontowej, wypelniono %.', v_wymagane, v_karty;
    end if;
    if v_niepelne > 0 then
      raise exception 'Karty remontowe niekompletne (%): wymagany numer karty, urzadzenie, data zakonczenia i mechanik przyjmujacy.', v_niepelne;
    end if;

    new.zlozono := now();
  end if;

  if new.status = 'wyeksportowany' and old.status is distinct from 'wyeksportowany' then
    new.wyeksportowano := now();
  end if;

  return new;
end $$;
create trigger trg_pilnuj_zlecenia before update on public.zlecenia
  for each row execute function public.pilnuj_zlecenia();

-- --- Audyt (zapis tylko przez triggery; brak polityk INSERT/UPDATE/DELETE) ---------
create function public.audytuj() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_zmiany jsonb;
  v_rek jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('z', v_old -> n.key, 'na', n.value))
      into v_zmiany
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key and n.key not in ('zmodyfikowano');
    if v_zmiany is null then return null; end if;
  else
    v_zmiany := coalesce(v_new, v_old);
  end if;

  insert into public.audit_log (zlecenie_id, tabela, rekord_id, akcja, user_id, user_email, zmiany)
  values (
    case when tg_table_name = 'zlecenia' then (v_rek ->> 'id')::uuid else (v_rek ->> 'zlecenie_id')::uuid end,
    tg_table_name, v_rek ->> 'id', lower(tg_op), auth.uid(), auth.jwt() ->> 'email', v_zmiany
  );
  return null;
end $$;

create trigger trg_audyt after insert or update or delete on public.zlecenia
  for each row execute function public.audytuj();
create trigger trg_audyt after insert or update or delete on public.pozycje_uslug
  for each row execute function public.audytuj();
create trigger trg_audyt after insert or update or delete on public.pozycje_materialowe
  for each row execute function public.audytuj();
create trigger trg_audyt after insert or update or delete on public.karty_remontowe
  for each row execute function public.audytuj();
create trigger trg_audyt after insert or update or delete on public.braki_godzin
  for each row execute function public.audytuj();

-- --- RLS ----------------------------------------------------------------------
alter table public.mpk                  enable row level security;
alter table public.cennik_kategorie     enable row level security;
alter table public.cennik_pozycje       enable row level security;
alter table public.profiles             enable row level security;
alter table public.profile_mpk          enable row level security;
alter table public.uprawnienia_startowe enable row level security;
alter table public.zlecenia             enable row level security;
alter table public.karty_remontowe      enable row level security;
alter table public.pozycje_uslug        enable row level security;
alter table public.pozycje_materialowe  enable row level security;
alter table public.braki_godzin         enable row level security;
alter table public.eksporty             enable row level security;
alter table public.eksporty_zlecenia    enable row level security;
alter table public.audit_log            enable row level security;

-- Slowniki: czytaja wszyscy zalogowani, zmienia handlowiec.
create policy mpk_select on public.mpk for select to authenticated using (true);
create policy mpk_update on public.mpk for update to authenticated
  using (public.jest_handlowcem()) with check (public.jest_handlowcem());

create policy kat_select on public.cennik_kategorie for select to authenticated using (true);
create policy kat_update on public.cennik_kategorie for update to authenticated
  using (public.jest_handlowcem()) with check (public.jest_handlowcem());

create policy cen_select on public.cennik_pozycje for select to authenticated using (true);
create policy cen_insert on public.cennik_pozycje for insert to authenticated
  with check (public.jest_handlowcem());
create policy cen_update on public.cennik_pozycje for update to authenticated
  using (public.jest_handlowcem()) with check (public.jest_handlowcem());

-- Profile: celowo BEZ polityki UPDATE (inaczej ktos moglby nadac sobie role handlowca).
create policy prof_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.jest_handlowcem());
create policy pmpk_select on public.profile_mpk for select to authenticated
  using (profile_id = auth.uid() or public.jest_handlowcem());
create policy ups_select on public.uprawnienia_startowe for select to authenticated
  using (public.jest_handlowcem());

-- Zlecenia
create policy zl_select on public.zlecenia for select to authenticated
  using (public.jest_handlowcem() or public.moje_mpk(mpk));
create policy zl_insert on public.zlecenia for insert to authenticated
  with check (status = 'roboczy' and (public.jest_handlowcem() or public.moje_mpk(mpk)));
create policy zl_update on public.zlecenia for update to authenticated
  using ((public.jest_handlowcem())
         or (public.moje_mpk(mpk) and status in ('roboczy', 'zwrocony')))
  with check (public.jest_handlowcem() or public.moje_mpk(mpk));
create policy zl_delete on public.zlecenia for delete to authenticated
  using ((public.jest_handlowcem() and status <> 'wyeksportowany')
         or (public.moje_mpk(mpk) and status = 'roboczy'));

-- Tabele podrzedne zlecenia - ta sama regula dla wszystkich.
create policy kr_select on public.karty_remontowe for select to authenticated
  using (public.moze_czytac_zlecenie(zlecenie_id));
create policy kr_write on public.karty_remontowe for all to authenticated
  using (public.moze_edytowac_zlecenie(zlecenie_id))
  with check (public.moze_edytowac_zlecenie(zlecenie_id));

create policy pu_select on public.pozycje_uslug for select to authenticated
  using (public.moze_czytac_zlecenie(zlecenie_id));
create policy pu_write on public.pozycje_uslug for all to authenticated
  using (public.moze_edytowac_zlecenie(zlecenie_id))
  with check (public.moze_edytowac_zlecenie(zlecenie_id));

create policy pm_select on public.pozycje_materialowe for select to authenticated
  using (public.moze_czytac_zlecenie(zlecenie_id));
create policy pm_write on public.pozycje_materialowe for all to authenticated
  using (public.moze_edytowac_zlecenie(zlecenie_id))
  with check (public.moze_edytowac_zlecenie(zlecenie_id));

-- Braki: kierownik zglasza przy edytowalnym zleceniu; status zmienia handlowiec.
create policy bg_select on public.braki_godzin for select to authenticated
  using (public.moze_czytac_zlecenie(zlecenie_id));
create policy bg_write on public.braki_godzin for all to authenticated
  using (public.jest_handlowcem() or public.moze_edytowac_zlecenie(zlecenie_id))
  with check (public.jest_handlowcem() or public.moze_edytowac_zlecenie(zlecenie_id));

create policy eks_all on public.eksporty for all to authenticated
  using (public.jest_handlowcem()) with check (public.jest_handlowcem());
create policy eksz_all on public.eksporty_zlecenia for all to authenticated
  using (public.jest_handlowcem()) with check (public.jest_handlowcem());

create policy audit_select on public.audit_log for select to authenticated
  using (public.jest_handlowcem() or (zlecenie_id is not null and public.moze_czytac_zlecenie(zlecenie_id)));

-- Funkcje pomocnicze nie sa dla anonimow.
revoke execute on function public.jest_handlowcem(), public.moje_mpk(text),
  public.moze_czytac_zlecenie(uuid), public.moze_edytowac_zlecenie(uuid),
  public.potwierdz_ustawienie_hasla() from anon, public;
grant execute on function public.jest_handlowcem(), public.moje_mpk(text),
  public.moze_czytac_zlecenie(uuid), public.moze_edytowac_zlecenie(uuid),
  public.potwierdz_ustawienie_hasla() to authenticated;
