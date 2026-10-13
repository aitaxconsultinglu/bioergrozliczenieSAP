import { describe, expect, it } from 'vitest'
import { cenaJednMaterialu, cenaUslugi, czySynthos, grosze, wartoscMaterialu, wartoscUslugi } from './obliczenia'
import { maPozycjeSpozaCennika, tekstDoSchowka, wierszeSap, type ZlecenieDoEksportu } from './eksportSap'
import type { PozycjaCennika } from './types'

describe('grosze', () => {
  it('zaokrągla połówki w górę mimo szumu binarnego (jak Excel)', () => {
    expect(83.5 * 1.15).not.toBe(96.025) // pułapka, przed którą chroni grosze()
    expect(grosze(83.5 * 1.15)).toBe(96.03)
    expect(grosze(1.005)).toBe(1.01)
    expect(grosze(0.1 + 0.2)).toBe(0.3)
    expect(grosze(-2.345)).toBe(-2.35)
  })
})

describe('materiały - wartości z przykładowej karty 102057-10', () => {
  // SIMMERING 35X55X10: 10 szt., faktura 83,50 zł, narzut 15%
  const m = { wartosc_zakupu: 83.5, narzut_proc: 15, ilosc: 10 }
  it('wartość z narzutem', () => expect(wartoscMaterialu(m)).toBe(96.03))
  it('cena jednostkowa z narzutem', () => expect(cenaJednMaterialu(m)).toBe(9.6))
  it('materiał Synthos bez narzutu', () => expect(wartoscMaterialu({ wartosc_zakupu: 70, narzut_proc: 0 })).toBe(70))
})

describe('usługi', () => {
  it('robocizna: 3,5 rbg × 75 zł', () => expect(wartoscUslugi({ ilosc: 3.5, doplata_proc: 0 }, 75)).toBe(262.5))
  it('pozycja cennika × sztuki: 639 zł × 5 pomp', () => expect(wartoscUslugi({ ilosc: 5, doplata_proc: 0 }, 639)).toBe(3195))
  it('przezwojenie +10%', () => {
    expect(cenaUslugi({ doplata_proc: 10 }, 1146)).toBe(1260.6)
    expect(wartoscUslugi({ ilosc: 2, doplata_proc: 10 }, 1146)).toBe(2521.2)
  })
})

describe('eksport SAP', () => {
  const poz = (p: Partial<PozycjaCennika>): PozycjaCennika => ({
    id: 1, nr_pozycji: 100, numer_linii: 10, indeks_sap: '5000161', opis: 'Remont pompy typ 3X9K', jm: 'JD', cena: 639, aktywna: true, ...p,
  })
  const materialy = new Map([
    [100, poz({ id: 2, numer_linii: 2000, indeks_sap: '5004062', opis: 'Materiał branża mechaniczna +15%', cena: 1 })],
    [310, poz({ id: 3, nr_pozycji: 310, numer_linii: 369, indeks_sap: '5004062', opis: 'Materiał branża mechaniczna +15%', cena: 1 })],
  ])
  const z: ZlecenieDoEksportu = {
    id: 'x', mpk: 'P04', nr_zamowienia: '4200102057', pozycja_zamowienia: 10, nazwa: 'POMPA 3X9K',
    linia_uslugi: 10, linia_materialy: 20,
    pozycje_uslug: [
      { ilosc: 10, cena: 94, doplata_proc: 0, kolejnosc: 1, nr_linii_sap: 30, cennik_pozycje: poz({ id: 4, nr_pozycji: 310, numer_linii: 300, indeks_sap: '5000032', opis: 'Tokarz/frezer/szlifierz (7.00-15.00)', jm: 'H', cena: 94 }) },
      { ilosc: 5, cena: 639, doplata_proc: 0, kolejnosc: 0, cennik_pozycje: poz({}) },
    ],
    pozycje_materialowe: [
      { nazwa: 'SIMMERING 35X55X10', ilosc: 10, wartosc_zakupu: 83.5, narzut_proc: 15, dostawca: 'bioerg', kolejnosc: 0 },
      { nazwa: 'ŁOŻYSKO od klienta', ilosc: 1, wartosc_zakupu: 0, narzut_proc: 0, dostawca: 'synthos', kolejnosc: 1 },
    ],
  }
  const wiersze = wierszeSap(z, materialy)

  it('ma 11 kolumn w każdym wierszu', () => wiersze.forEach((w) => expect(w).toHaveLength(11)))
  it('numer linii z zamówienia, nie z cennika; bez numeru = pusta komórka', () => {
    const bez = wierszeSap({ ...z, linia_uslugi: null, linia_materialy: null }, materialy)
    expect(bez[0][0]).toBeNull()
    expect(bez[2][0]).toBeNull()
  })
  it('pozycja cennikowa przed robocizną (sort wg kategorii i linii)', () => {
    expect(wiersze[0].slice(0, 4)).toEqual([10, '5000161', 'Remont pompy typ 3X9K', 5])
    expect(wiersze[0][7]).toBe(3195)
    expect(wiersze[1].slice(0, 2)).toEqual([30, '5000032']) // nr linii z pozycji nadpisuje linię zlecenia
  })
  it('materiał pod numerem linii materiałów z zamówienia, ilość = wartość z narzutem, cena 1', () => {
    expect(wiersze[2]).toEqual([20, '5004062', 'SIMMERING 35X55X10', 96.03, null, 'JD', 1, 96.03, 9.6, 10, null])
  })
  it('materiał Synthos nie trafia do eksportu', () => expect(wiersze).toHaveLength(3))
  it('schowek: tabulatory, przecinek dziesiętny, bez nagłówka', () => {
    expect(tekstDoSchowka([wiersze[2]])).toBe('20\t5004062\tSIMMERING 35X55X10\t96,03\t\tJD\t1\t96,03\t9,6\t10\t')
  })
})

describe('otwarte listy', () => {
  it('Synthos rozpoznawany po nazwie, niezależnie od wielkości liter', () => {
    expect(czySynthos('synthos')).toBe(true)
    expect(czySynthos('Magazyn SYNTHOS')).toBe(true)
    expect(czySynthos('bioerg')).toBe(false)
    expect(czySynthos('z demontażu')).toBe(false)
  })

  it('pozycja spoza cennika: pusty numer linii, ręczny opis/JM/cena', () => {
    const z: ZlecenieDoEksportu = {
      id: 'y', mpk: 'P04', nr_zamowienia: '4200000001', pozycja_zamowienia: null, nazwa: 'Test',
      pozycje_uslug: [{ ilosc: 2, cena: 150, doplata_proc: 0, kolejnosc: 0, cennik_pozycje: null,
        wlasny_opis: 'Dorobienie tulei', wlasna_jm: 'szt', wlasny_indeks: null }],
      pozycje_materialowe: [
        { nazwa: 'Tuleja z demontażu', ilosc: 1, wartosc_zakupu: 100, narzut_proc: 10, dostawca: 'z demontażu', kolejnosc: 0 },
        { nazwa: 'Uszczelka', ilosc: 1, wartosc_zakupu: 0, narzut_proc: 0, dostawca: 'Magazyn Synthos', kolejnosc: 1 },
      ],
    }
    const w = wierszeSap(z, new Map())
    expect(w[0]).toEqual([null, '', 'Dorobienie tulei', 2, null, 'szt', 150, 300, null, null, null])
    expect(w).toHaveLength(2) // materiał "z demontażu" jest, Synthos nie
    expect(w[1][3]).toBe(110)
    expect(maPozycjeSpozaCennika(z)).toBe(true)
  })
})
