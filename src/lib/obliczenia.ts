import type { PozycjaCennika, PozycjaMaterialowa, PozycjaUslugi } from './types'

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
 * też trigger w bazie) i nie trafia do eksportu wartościowego.
 */
export function wartoscMaterialu(m: Pick<PozycjaMaterialowa, 'wartosc_zakupu' | 'narzut_proc'>) {
  return grosze(m.wartosc_zakupu * (1 + (m.narzut_proc || 0) / 100))
}

export function cenaJednMaterialu(m: Pick<PozycjaMaterialowa, 'wartosc_zakupu' | 'narzut_proc' | 'ilosc'>) {
  if (!m.ilosc) return 0
  return grosze(wartoscMaterialu(m) / m.ilosc)
}

export interface Sumy {
  robocizna: number
  cennik: number
  materialy: number
  razem: number
}

export function policzSumy(
  uslugi: Pick<PozycjaUslugi, 'cennik_pozycja_id' | 'ilosc' | 'doplata_proc' | 'cena'>[],
  materialy: Pick<PozycjaMaterialowa, 'wartosc_zakupu' | 'narzut_proc' | 'dostawca'>[],
  cennik: Map<number, PozycjaCennika>,
): Sumy {
  let robocizna = 0
  let pozycjeCennikowe = 0
  for (const u of uslugi) {
    const poz = cennik.get(u.cennik_pozycja_id)
    if (!poz) continue
    // Zapisana pozycja ma zamrożoną cenę z chwili wpisu; nowa - bieżącą z cennika.
    const w = wartoscUslugi(u, u.cena ?? poz.cena)
    if (poz.nr_pozycji === 310) robocizna += w
    else pozycjeCennikowe += w
  }
  const mat = materialy.filter((m) => m.dostawca === 'bioerg').reduce((s, m) => s + wartoscMaterialu(m), 0)
  return {
    robocizna: grosze(robocizna),
    cennik: grosze(pozycjeCennikowe),
    materialy: grosze(mat),
    razem: grosze(robocizna + pozycjeCennikowe + mat),
  }
}

/** Unikalny klucz wiersza formularza (React key) dla wierszy bez id z bazy. */
export function nowyKlucz() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
