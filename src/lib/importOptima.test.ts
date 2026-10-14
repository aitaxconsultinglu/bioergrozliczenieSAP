import { describe, expect, it } from 'vitest'
import { liczbaZOptimy, oczyscNazwe, parsujWiersze } from './importOptima'

// Nagłówki jak w eksporcie "Handel -> Zasoby" z Optimy; wiersze fikcyjne (repo jest publiczne).
const NAGLOWKI = ['Kod', 'Nazwa', 'Typ', 'Stan zasobów', 'Ilość', 'Ilość dostępna', 'Jm', 'Kod CN', 'C. zakupu-PLN',
  'W. zakupu-PLN', 'VAT', 'Braki', 'PZ', 'DostPZ', 'Kody JPK_V7', 'Jmp']

describe('import eksportu Zasoby z Optimy', () => {
  const wynik = parsujWiersze([
    NAGLOWKI,
    ['000101', 'ŁOŻYSKO 6308 2Z  TEST', 'TP', 'Brak towaru', 0, 0, 'szt', '', 50.5, 0, '23,00 %', 0, 'PZ/1/01/2026', 'DOSTAWCA PRZYKŁADOWY SP. Z O.O.', '', ''],
    ['032916', ' 2924B TIMKEN pierścień zewnętrzny                                _x000d_\n', 'TP', 'Brak towaru', 0, 0, 'szt', '', 0, 0, '23,00 %', 0, '', '', '', ''],
    ['023348', ' FARBA NA DACH BRĄZ RAL8017 0,75 L ŚNIEŻKA_x000d_\n', 'TP', 'Brak towaru', 0, 0, 'szt', '', 54.89, 0, '23,00 %', 0, 'PZ/132/05/2025', 'SEWERA', '', ''],
    ['900001', 'Usługa transportowa', 'UZ', 'Usługa', 0, 0, 'usł', '', 100, 0, '23,00 %', 0, '', '', '', ''],
  ])

  it('rozpoznaje kolumny po nagłówkach (cena zakupu, nie wartość)', () => {
    expect(wynik.kolumny).toMatchObject({ kod: 'Kod', nazwa: 'Nazwa', jm: 'Jm', cena: 'C. zakupu-PLN', dokument: 'PZ', dostawca: 'DostPZ' })
  })
  it('bierze towary z ceną, pomija bez ceny i usługi', () => {
    expect(wynik.wiersze.map((w) => w.kod)).toEqual(['000101', '000103'])
    expect(wynik.pominiete).toBe(2)
  })
  it('czyści nazwy z Optimy', () => {
    expect(wynik.wiersze[0]).toMatchObject({ nazwa: 'ŁOŻYSKO 6308 2Z TEST', cena: 50.5, dokument: 'PZ/1/01/2026', jm: 'szt' })
    expect(wynik.wiersze[1].nazwa).toBe('FARBA TESTOWA RAL8017 0,75 L')
    expect(oczyscNazwe(' A_x000d_\nB ')).toBe('A B')
  })
  it('liczby po polsku', () => {
    expect(liczbaZOptimy('1 234,56')).toBe(1234.56)
    expect(liczbaZOptimy(12.5)).toBe(12.5)
  })
  it('czytelny błąd dla złego pliku', () => {
    expect(() => parsujWiersze([['Nr zamówienia', 'MPK']])).toThrow(/Kod/)
  })
})
