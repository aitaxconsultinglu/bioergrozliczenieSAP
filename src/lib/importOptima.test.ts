import { describe, expect, it } from 'vitest'
import { liczbaZOptimy, oczyscNazwe, parsujWiersze } from './importOptima'

// Nagłówki i wiersze skopiowane z prawdziwego eksportu "Handel -> Zasoby" (14.10.2026).
const NAGLOWKI = ['Kod', 'Nazwa', 'Typ', 'Stan zasobów', 'Ilość', 'Ilość dostępna', 'Jm', 'Kod CN', 'C. zakupu-PLN',
  'W. zakupu-PLN', 'VAT', 'Braki', 'PZ', 'DostPZ', 'Kody JPK_V7', 'Jmp']

describe('import eksportu Zasoby z Optimy', () => {
  const wynik = parsujWiersze([
    NAGLOWKI,
    ['005924', 'ŁOŻYSKO 6308 2Z  SKF', 'TP', 'Brak towaru', 0, 0, 'szt', '', 73.91, 0, '23,00 %', 0, 'PZ/325/09/2025', 'WIKA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', '', ''],
    ['032916', ' 2924B TIMKEN pierścień zewnętrzny                                _x000d_\n', 'TP', 'Brak towaru', 0, 0, 'szt', '', 0, 0, '23,00 %', 0, '', '', '', ''],
    ['023348', ' FARBA NA DACH BRĄZ RAL8017 0,75 L ŚNIEŻKA_x000d_\n', 'TP', 'Brak towaru', 0, 0, 'szt', '', 54.89, 0, '23,00 %', 0, 'PZ/132/05/2025', 'SEWERA', '', ''],
    ['900001', 'Usługa transportowa', 'UZ', 'Usługa', 0, 0, 'usł', '', 100, 0, '23,00 %', 0, '', '', '', ''],
  ])

  it('rozpoznaje kolumny po nagłówkach (cena zakupu, nie wartość)', () => {
    expect(wynik.kolumny).toMatchObject({ kod: 'Kod', nazwa: 'Nazwa', jm: 'Jm', cena: 'C. zakupu-PLN', dokument: 'PZ', dostawca: 'DostPZ' })
  })
  it('bierze towary z ceną, pomija bez ceny i usługi', () => {
    expect(wynik.wiersze.map((w) => w.kod)).toEqual(['005924', '023348'])
    expect(wynik.pominiete).toBe(2)
  })
  it('czyści nazwy z Optimy', () => {
    expect(wynik.wiersze[0]).toMatchObject({ nazwa: 'ŁOŻYSKO 6308 2Z SKF', cena: 73.91, dokument: 'PZ/325/09/2025', jm: 'szt' })
    expect(wynik.wiersze[1].nazwa).toBe('FARBA NA DACH BRĄZ RAL8017 0,75 L ŚNIEŻKA')
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
