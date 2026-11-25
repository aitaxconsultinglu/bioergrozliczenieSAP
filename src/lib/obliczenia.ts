import type { PozycjaCennika, PozycjaMaterialowa, PozycjaUslugi, UslugaObca } from './types'

/**
 * Zaokrąglenie do groszy (połówki w górę, jak ZAOKR w Excelu) - każda wartość pokazana
 * i eksportowana przechodzi przez to samo. toPrecision(12) zdejmuje szum binarny:
 * 83,5 × 1,15 to w JS 96,02499999999999, a musi wyjść 96,03, tak jak w Excelu.
 */
export function grosze(x: number) {
  const setne = Number((x * 100).toPrecision(12))
  return (Math.sign(setne) * Math.round(Math.abs(setne))) / 100
}

/** Cena jednostkowa pozycji usługi po dopłacie (np. przezwojenie +10%). */
export function cenaUslugi(p: Pick<PozycjaUslugi, 'doplata_proc'>, cenaCennikowa: number) {
  return grosze(cenaCennikowa * (1 + (p.doplata_proc || 0) / 100))
}

export function wartoscUslugi(p: Pick<PozycjaUslugi, 'ilosc' | 'doplata_proc'>, cenaCennikowa: number) {
  return grosze(p.ilosc * cenaUslugi(p, cenaCennikowa))
}

/**
 * Materiał: wpisywana jest ŁĄCZNA wartość z faktury (tak jak w dotychczasowym Excelu),
 * narzut liczony od niej. Materiał dostarczony przez Synthos ma narzut 0 (pilnuje tego
 * też trigger w bazie) i nie trafia do eksportu wartościowego. Inny wpisany dostawca
 * (np. "z demontażu") liczy się normalnie, z narzutem ustawionym w wierszu.
 */
export function wartoscMaterialu(m: Pick<PozycjaMaterialowa, 'wartosc_zakupu' | 'narzut_proc'>) {
  return grosze(m.wartosc_zakupu * (1 + (m.narzut_proc || 0) / 100))
}

export function cenaJednMaterialu(m: Pick<PozycjaMaterialowa, 'wartosc_zakupu' | 'narzut_proc' | 'ilosc'>) {
  if (!m.ilosc) return 0
  return grosze(wartoscMaterialu(m) / m.ilosc)
}

/**
 * Podział materiału na część sprzedaną i brak (np. wirnik 3 szt., zamawiający założył 2 -> brak 1 szt.).
 * Wartość z narzutem i zakup dzielone proporcjonalnie do ilości; sprzedane = całość minus brak,
 * żeby suma obu części zawsze dawała wartość wiersza co do grosza.
 */
export function podzialMaterialu(m: Pick<PozycjaMaterialowa, 'wartosc_zakupu' | 'narzut_proc' | 'ilosc' | 'brak_ilosc'>) {
  const wartosc = wartoscMaterialu(m)
  const ilosc = Number(m.ilosc) || 0
  const brakIlosc = Math.min(Math.max(Number(m.brak_ilosc) || 0, 0), ilosc)
  if (!brakIlosc) {
    return { sprzedane: { ilosc, wartosc, zakup: m.wartosc_zakupu }, brak: { ilosc: 0, wartosc: 0, zakup: 0 } }
  }
  const czesc = brakIlosc / ilosc
  const wartoscBraku = brakIlosc >= ilosc ? wartosc : grosze(wartosc * czesc)
  const zakupBraku = brakIlosc >= ilosc ? m.wartosc_zakupu : grosze(m.wartosc_zakupu * czesc)
  return {
    sprzedane: { ilosc: ilosc - brakIlosc, wartosc: grosze(wartosc - wartoscBraku), zakup: grosze(m.wartosc_zakupu - zakupBraku) },
    brak: { ilosc: brakIlosc, wartosc: wartoscBraku, zakup: zakupBraku },
  }
}

/** Materiał Synthos rozpoznajemy po nazwie dostawcy - tak samo jak funkcja czy_synthos() w bazie. */
export function czySynthos(dostawca: string | null | undefined) {
  return /synthos/i.test(dostawca ?? '')
}

/** Usługa obca: wartość netto z faktury + narzut (domyślnie 10%). */
export function wartoscUslugiObcej(u: Pick<UslugaObca, 'wartosc_zakupu' | 'narzut_proc'>) {
  return grosze(u.wartosc_zakupu * (1 + (u.narzut_proc || 0) / 100))
}

export interface Sumy {
  robocizna: number
  cennik: number
  materialy: number
  uslugiObce: number
  /** Sprzedawane w tym zleceniu (bez braków). */
  razem: number
  /** Wartość braków: godzin i materiału, których zamawiający nie założył w zamówieniu. */
  braki: number
}

/** Brak godzin w komórce siatki: stawka (stanowisko x pora) i liczba brakujących rbg. */
export interface BrakGodzinDoRozliczenia {
  cennik_pozycja_id: number | null
  ilosc_rbg: number
}

/**
 * Brak godzin to CZĘŚĆ przepracowanych godzin z danej komórki (np. 20 rbg przepracowane, zamawiający
 * założył 14 -> 14 sprzedane, 6 brak). Rozdziela braki na wiersze robocizny własnej o tej samej stawce
 * (kooperacja innego MPK nie ma braków). `nadwyzka` = brak bez godzin w komórce (stare wpisy) - liczony
 * w brakach po cenie z cennika, sprzedaży nie zmniejsza.
 */
export function przydzielBraki<T extends { cennik_pozycja_id: number | null; ilosc: number; mpk_wykonawcy?: string | null }>(
  uslugi: T[], braki: BrakGodzinDoRozliczenia[],
): { naWiersz: Map<T, number>; nadwyzka: Map<number, number> } {
  const pozostalo = new Map<number, number>()
  for (const b of braki) {
    if (b.cennik_pozycja_id === null || !(b.ilosc_rbg > 0)) continue
    pozostalo.set(b.cennik_pozycja_id, (pozostalo.get(b.cennik_pozycja_id) ?? 0) + b.ilosc_rbg)
  }
  const naWiersz = new Map<T, number>()
  for (const u of uslugi) {
    if (u.mpk_wykonawcy || u.cennik_pozycja_id === null) continue
    const reszta = pozostalo.get(u.cennik_pozycja_id) ?? 0
    const ile = Math.min(reszta, u.ilosc)
    if (ile > 0) {
      naWiersz.set(u, ile)
      pozostalo.set(u.cennik_pozycja_id, reszta - ile)
    }
  }
  for (const [k, v] of pozostalo) if (v <= 0) pozostalo.delete(k)
  return { naWiersz, nadwyzka: pozostalo }
}

export function policzSumy(
  uslugi: (Pick<PozycjaUslugi, 'cennik_pozycja_id' | 'ilosc' | 'doplata_proc' | 'cena' | 'wlasna_cena'> & { mpk_wykonawcy?: string | null })[],
  materialy: Pick<PozycjaMaterialowa, 'wartosc_zakupu' | 'narzut_proc' | 'dostawca' | 'ilosc' | 'brak_ilosc'>[],
  cennik: Map<number, PozycjaCennika>,
  uslugiObce: Pick<UslugaObca, 'wartosc_zakupu' | 'narzut_proc'>[] = [],
  brakiGodzin: BrakGodzinDoRozliczenia[] = [],
): Sumy {
  let robocizna = 0
  let pozycjeCennikowe = 0
  let braki = 0
  const { naWiersz, nadwyzka } = przydzielBraki(uslugi, brakiGodzin)
  for (const [id, ile] of nadwyzka) braki += grosze(ile * (cennik.get(id)?.cena ?? 0))
  for (const wiersz of uslugi) {
    // Brak zmniejsza sprzedaż wiersza i liczy się osobno.
    const brak = naWiersz.get(wiersz) ?? 0
    const u = brak ? { ...wiersz, ilosc: wiersz.ilosc - brak } : wiersz
    if (brak) {
      const cena = wiersz.cena ?? (wiersz.cennik_pozycja_id === null ? undefined : cennik.get(wiersz.cennik_pozycja_id)?.cena) ?? 0
      braki += wartoscUslugi({ ...wiersz, ilosc: brak }, cena)
    }
    if (u.cennik_pozycja_id === null) {
      // Pozycja spoza cennika - cena wpisana ręcznie.
      pozycjeCennikowe += wartoscUslugi(u, u.cena ?? u.wlasna_cena ?? 0)
      continue
    }
    const poz = cennik.get(u.cennik_pozycja_id)
    if (!poz) continue
    // Zapisana pozycja ma zamrożoną cenę z chwili wpisu; nowa - bieżącą z cennika.
    const w = wartoscUslugi(u, u.cena ?? poz.cena)
    if (poz.nr_pozycji === 310) robocizna += w
    else pozycjeCennikowe += w
  }
  const doRozliczenia = materialy.filter((m) => !czySynthos(m.dostawca))
  const mat = doRozliczenia.reduce((s, m) => s + podzialMaterialu(m).sprzedane.wartosc, 0)
  braki += doRozliczenia.reduce((s, m) => s + podzialMaterialu(m).brak.wartosc, 0)
  const obce = uslugiObce.reduce((s, u) => s + wartoscUslugiObcej(u), 0)
  return {
    robocizna: grosze(robocizna),
    cennik: grosze(pozycjeCennikowe),
    materialy: grosze(mat),
    uslugiObce: grosze(obce),
    razem: grosze(robocizna + pozycjeCennikowe + mat + obce),
    braki: grosze(braki),
  }
}

/** Unikalny klucz wiersza formularza (React key) dla wierszy bez id z bazy. */
export function nowyKlucz() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
