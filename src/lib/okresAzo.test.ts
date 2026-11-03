import { describe, expect, it } from 'vitest'
import { kluczOkresu, okresZAzo, zbudujDrzewoOkresow } from './okresAzo'
import { WSZYSTKO, pasujeDoOkresu } from '../components/NawigatorOkresow'

/** Numery o takim samym KSZTALCIE jak produkcyjne, ale zmyslone.
 *  Repozytorium jest publiczne, a numery AZO to identyfikatory zamowien Synthosu -
 *  prawdziwe nie moga trafic do testow (ten blad zdarzyl sie juz raz z cenami z Optimy). */
const ZLECENIA = [
  { nr_azo: 'AZO/11/09/2026' },
  { nr_azo: 'AZO/12/10/2026' },
  { nr_azo: 'AZO/13/10/2026' },
  { nr_azo: 'AZO/14/10/2026, AZO/15/10/2026' },
  { nr_azo: 'AZO/16/11/2026' },
  { nr_azo: 'AZO/17/01/2027' },
  { nr_azo: null },
  { nr_azo: 'do uzupełnienia' },
]

describe('okresZAzo', () => {
  it('czyta miesiąc i rok z typowego numeru', () => {
    expect(okresZAzo('AZO/105/10/2026')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
  })

  it('radzi sobie z numerem kolejnym o różnej długości', () => {
    // Wszystkie trzy warianty występują w danych produkcyjnych.
    expect(okresZAzo('AZO/31/10/2026')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
    expect(okresZAzo('AZO/176/10/2026')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
    expect(okresZAzo('AZO/7/1/2027')).toEqual({ rok: 2027, miesiac: 1, mieszany: false })
  })

  it('bierze okres z pierwszego numeru, gdy pole ma ich kilka', () => {
    expect(okresZAzo('AZO/115/10/2026, AZO/159/10/2026'))
      .toEqual({ rok: 2026, miesiac: 10, mieszany: false })
  })

  it('oznacza jako mieszany, gdy numery wskazują różne miesiące', () => {
    const o = okresZAzo('AZO/115/10/2026, AZO/159/11/2026')
    expect(o).toEqual({ rok: 2026, miesiac: 10, mieszany: true })
  })

  it('znosi nietypowy zapis przedrostka i spacje', () => {
    expect(okresZAzo('AZO 105/10/2026')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
    expect(okresZAzo('105/10/2026')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
    expect(okresZAzo('  AZO/105/10/2026  ')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
  })

  it('przyjmuje rok dwucyfrowy', () => {
    expect(okresZAzo('AZO/105/10/26')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
  })

  it('zwraca null, gdy okresu nie da się odczytać', () => {
    expect(okresZAzo(null)).toBeNull()
    expect(okresZAzo('')).toBeNull()
    expect(okresZAzo('   ')).toBeNull()
    expect(okresZAzo('AZO')).toBeNull()
    expect(okresZAzo('AZO/105')).toBeNull()
    // Miesiąc poza zakresem - lepiej wrzucić do „bez okresu” niż zgadywać.
    expect(okresZAzo('AZO/105/13/2026')).toBeNull()
    // Trzycyfrowa „miesiąc” to na pewno nie miesiąc.
    expect(okresZAzo('AZO/105/100/2026')).toBeNull()
    // Sam numer kolejny nie może udawać roku.
    expect(okresZAzo('AZO/1234')).toBeNull()
  })

  it('nie myli numeru pozycji z rokiem przy dodatkowym członie', () => {
    // Gdyby kiedyś doszedł sufiks, miesiąc i rok nadal stoją na końcu.
    expect(okresZAzo('AZO/105/10/2026')).toEqual({ rok: 2026, miesiac: 10, mieszany: false })
  })
})

describe('kluczOkresu', () => {
  it('dopełnia miesiąc do dwóch cyfr, żeby klucze dały się sortować tekstowo', () => {
    expect(kluczOkresu({ rok: 2027, miesiac: 1 })).toBe('2027-01')
    expect(kluczOkresu({ rok: 2026, miesiac: 10 })).toBe('2026-10')
    expect(['2026-10', '2027-01'].sort()).toEqual(['2026-10', '2027-01'])
  })
})

describe('zbudujDrzewoOkresow', () => {
  it('grupuje po roku i miesiącu, od najnowszego', () => {
    const d = zbudujDrzewoOkresow([
      { nr_azo: 'AZO/1/10/2026' },
      { nr_azo: 'AZO/2/10/2026' },
      { nr_azo: 'AZO/3/11/2026' },
      { nr_azo: 'AZO/4/1/2027' },
    ])
    expect(d.bezOkresu).toBe(0)
    expect(d.lata.map((r) => r.rok)).toEqual([2027, 2026])
    expect(d.lata[0]).toEqual({ rok: 2027, ile: 1, miesiace: [{ miesiac: 1, ile: 1 }] })
    expect(d.lata[1].ile).toBe(3)
    expect(d.lata[1].miesiace).toEqual([
      { miesiac: 11, ile: 1 },
      { miesiac: 10, ile: 2 },
    ])
  })

  it('zlicza osobno zlecenia bez czytelnego okresu', () => {
    const d = zbudujDrzewoOkresow([
      { nr_azo: 'AZO/1/10/2026' },
      { nr_azo: null },
      { nr_azo: 'brak' },
    ])
    expect(d.bezOkresu).toBe(2)
    expect(d.lata).toHaveLength(1)
    expect(d.lata[0].ile).toBe(1)
  })

  it('pokazuje tylko miesiące, które są w danych', () => {
    const d = zbudujDrzewoOkresow([{ nr_azo: 'AZO/1/3/2026' }])
    expect(d.lata[0].miesiace).toEqual([{ miesiac: 3, ile: 1 }])
  })

  it('nie gubi ani nie dubluje żadnego zlecenia', () => {
    const zlecenia = [
      { nr_azo: 'AZO/1/10/2026' },
      { nr_azo: 'AZO/2/10/2026, AZO/3/11/2026' },
      { nr_azo: null },
      { nr_azo: 'AZO/4/1/2027' },
    ]
    const d = zbudujDrzewoOkresow(zlecenia)
    const wOkresach = d.lata.reduce((s, r) => s + r.ile, 0)
    expect(wOkresach + d.bezOkresu).toBe(zlecenia.length)
  })
})

describe('pasujeDoOkresu', () => {
  const pazdziernik = { rok: 2026, miesiac: 10 }

  it('„wszystkie” przepuszcza każde zlecenie, także bez okresu', () => {
    expect(pasujeDoOkresu(WSZYSTKO, pazdziernik)).toBe(true)
    expect(pasujeDoOkresu(WSZYSTKO, null)).toBe(true)
  })

  it('miesiąc przepuszcza tylko ten miesiąc tego roku', () => {
    const w = { rodzaj: 'miesiac', rok: 2026, miesiac: 10 } as const
    expect(pasujeDoOkresu(w, pazdziernik)).toBe(true)
    expect(pasujeDoOkresu(w, { rok: 2026, miesiac: 11 })).toBe(false)
    expect(pasujeDoOkresu(w, { rok: 2027, miesiac: 10 })).toBe(false)
    expect(pasujeDoOkresu(w, null)).toBe(false)
  })

  it('rok przepuszcza wszystkie miesiące tego roku', () => {
    const w = { rodzaj: 'rok', rok: 2026 } as const
    expect(pasujeDoOkresu(w, pazdziernik)).toBe(true)
    expect(pasujeDoOkresu(w, { rok: 2026, miesiac: 1 })).toBe(true)
    expect(pasujeDoOkresu(w, { rok: 2027, miesiac: 1 })).toBe(false)
  })

  it('„bez okresu” łapie wyłącznie zlecenia bez czytelnego numeru', () => {
    const w = { rodzaj: 'bezOkresu' } as const
    expect(pasujeDoOkresu(w, null)).toBe(true)
    expect(pasujeDoOkresu(w, pazdziernik)).toBe(false)
  })
})

describe('podział na okresy jako całość', () => {
  it('każde zlecenie trafia do DOKŁADNIE jednej zakładki miesiąca', () => {
    const drzewo = zbudujDrzewoOkresow(ZLECENIA)
    const zakladki = drzewo.lata.flatMap((r) =>
      r.miesiace.map((m) => ({ rodzaj: 'miesiac', rok: r.rok, miesiac: m.miesiac } as const)))

    for (const z of ZLECENIA) {
      const okres = okresZAzo(z.nr_azo)
      const trafienia = zakladki.filter((w) => pasujeDoOkresu(w, okres)).length
      const bezOkresu = pasujeDoOkresu({ rodzaj: 'bezOkresu' }, okres) ? 1 : 0
      expect(trafienia + bezOkresu, `zlecenie ${z.nr_azo}`).toBe(1)
    }
  })

  it('suma liczników w zakładkach równa się liczbie zleceń', () => {
    const drzewo = zbudujDrzewoOkresow(ZLECENIA)
    const wMiesiacach = drzewo.lata.flatMap((r) => r.miesiace).reduce((s, m) => s + m.ile, 0)
    expect(wMiesiacach + drzewo.bezOkresu).toBe(ZLECENIA.length)
  })

  it('licznik roku równa się sumie jego miesięcy', () => {
    for (const r of zbudujDrzewoOkresow(ZLECENIA).lata) {
      expect(r.miesiace.reduce((s, m) => s + m.ile, 0), `rok ${r.rok}`).toBe(r.ile)
    }
  })

  it('rozdziela lata 2026 i 2027 na osobne zakładki z własnymi miesiącami', () => {
    const drzewo = zbudujDrzewoOkresow(ZLECENIA)
    expect(drzewo.lata.map((r) => r.rok)).toEqual([2027, 2026])
    expect(drzewo.lata.find((r) => r.rok === 2026)?.miesiace.map((m) => m.miesiac))
      .toEqual([11, 10, 9])
    expect(drzewo.lata.find((r) => r.rok === 2027)?.miesiace.map((m) => m.miesiac))
      .toEqual([1])
    // Zlecenie wpisane w listopadzie, ale z numerem AZO za październik, rozlicza się
    // w październiku - o to w tym filtrze chodzi.
    expect(drzewo.lata.find((r) => r.rok === 2026)?.miesiace.find((m) => m.miesiac === 10)?.ile)
      .toBe(3)
  })
})
