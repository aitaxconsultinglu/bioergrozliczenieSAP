import { useMemo } from 'react'
import type { DrzewoOkresow } from '@/lib/okresAzo'
import { nazwaMiesiaca } from '@/lib/okresAzo'
import { cn } from '@/lib/utils'

/** Który okres rozliczeniowy jest wybrany.
 *
 *  `bezOkresu` to nie błąd, a kosz na zlecenia, z których numeru AZO nie da się odczytać
 *  miesiąca. Musi być widoczny, bo inaczej takie zlecenie wypadłoby ze wszystkich
 *  zakładek i przestało istnieć dla osoby, która go szuka. */
export type WyborOkresu =
  | { rodzaj: 'wszystko' }
  | { rodzaj: 'rok'; rok: number }
  | { rodzaj: 'miesiac'; rok: number; miesiac: number }
  | { rodzaj: 'bezOkresu' }

export const WSZYSTKO: WyborOkresu = { rodzaj: 'wszystko' }

/** Czy zlecenie o danym okresie wpada do wyboru. `okres` null = nie dało się odczytać. */
export function pasujeDoOkresu(
  wybor: WyborOkresu,
  okres: { rok: number; miesiac: number } | null,
) {
  switch (wybor.rodzaj) {
    case 'wszystko': return true
    case 'bezOkresu': return okres === null
    case 'rok': return okres !== null && okres.rok === wybor.rok
    case 'miesiac':
      return okres !== null && okres.rok === wybor.rok && okres.miesiac === wybor.miesiac
  }
}

export function opisOkresu(wybor: WyborOkresu) {
  switch (wybor.rodzaj) {
    case 'wszystko': return 'wszystkie okresy'
    case 'bezOkresu': return 'bez czytelnego numeru AZO'
    case 'rok': return `cały ${wybor.rok}`
    case 'miesiac': return `${nazwaMiesiaca(wybor.miesiac)} ${wybor.rok}`
  }
}

/** Rok, który ma być rozwinięty: wybrany albo najnowszy z danych. */
function rokDoRozwiniecia(wybor: WyborOkresu, drzewo: DrzewoOkresow) {
  if (wybor.rodzaj === 'rok' || wybor.rodzaj === 'miesiac') return wybor.rok
  return drzewo.lata[0]?.rok ?? null
}

interface Props {
  drzewo: DrzewoOkresow
  wybor: WyborOkresu
  zmien: (w: WyborOkresu) => void
  /** Ile zleceń widać po WSZYSTKICH filtrach - do podpisu pod zakładkami. */
  ileWidocznych: number
}

/** Zakładki lat z rozwinięciem miesięcy, które faktycznie są w danych.
 *
 *  Rok jest zakładką, miesiąc „podzakładką” - tak jak prosił klient: za 2026 zakładka
 *  i rozwinięcie wprowadzonych miesięcy, za 2027 tak samo. Lata i miesiące biorą się
 *  z danych, nie z kalendarza: dopóki w 2027 nic nie ma, nie ma zakładki 2027, a gdy
 *  pojawi się pierwsze zlecenie z `AZO/1/1/2027`, zakładka dołoży się sama. */
export function NawigatorOkresow({ drzewo, wybor, zmien, ileWidocznych }: Props) {
  const rokOtwarty = useMemo(() => rokDoRozwiniecia(wybor, drzewo), [wybor, drzewo])
  const miesiace = drzewo.lata.find((r) => r.rok === rokOtwarty)?.miesiace ?? []
  const razem = drzewo.lata.reduce((s, r) => s + r.ile, 0) + drzewo.bezOkresu

  const zakladka = (aktywna: boolean) => cn(
    'rounded-md px-3 py-1.5 text-sm font-medium',
    aktywna ? 'bg-limonka-jasna text-slate-900' : 'text-slate-600 hover:bg-slate-100',
  )
  const podzakladka = (aktywna: boolean) => cn(
    'rounded-md px-2.5 py-1 text-sm',
    aktywna ? 'bg-limonka text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-100',
  )

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1">
        <span className="pr-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Okres rozliczenia
        </span>
        <button className={zakladka(wybor.rodzaj === 'wszystko')} onClick={() => zmien(WSZYSTKO)}>
          Wszystkie <span className="text-slate-500">({razem})</span>
        </button>
        {drzewo.lata.map((r) => (
          <button
            key={r.rok}
            className={zakladka(
              (wybor.rodzaj === 'rok' || wybor.rodzaj === 'miesiac') && wybor.rok === r.rok,
            )}
            // Klik w rok pokazuje CAŁY rok i zarazem rozwija jego miesiące - jedno
            // kliknięcie zamiast dwóch, a i tak widać, z czego rok się składa.
            onClick={() => zmien({ rodzaj: 'rok', rok: r.rok })}
          >
            {r.rok} <span className="text-slate-500">({r.ile})</span>
          </button>
        ))}
        {drzewo.bezOkresu > 0 && (
          <button
            className={cn(
              zakladka(wybor.rodzaj === 'bezOkresu'),
              wybor.rodzaj !== 'bezOkresu' && 'text-amber-800 hover:bg-amber-50',
            )}
            title="Zlecenia, w których numer AZO nie zawiera czytelnego miesiąca i roku"
            onClick={() => zmien({ rodzaj: 'bezOkresu' })}
          >
            Bez okresu <span className="opacity-70">({drzewo.bezOkresu})</span>
          </button>
        )}
      </div>

      {rokOtwarty !== null && miesiace.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
          <span className="pr-2 text-xs text-slate-400">{rokOtwarty}:</span>
          <button
            className={podzakladka(wybor.rodzaj === 'rok' && wybor.rok === rokOtwarty)}
            onClick={() => zmien({ rodzaj: 'rok', rok: rokOtwarty })}
          >
            cały rok
          </button>
          {miesiace.map((m) => (
            <button
              key={m.miesiac}
              className={podzakladka(
                wybor.rodzaj === 'miesiac' && wybor.rok === rokOtwarty && wybor.miesiac === m.miesiac,
              )}
              onClick={() => zmien({ rodzaj: 'miesiac', rok: rokOtwarty, miesiac: m.miesiac })}
            >
              {nazwaMiesiaca(m.miesiac)} <span className="text-slate-500">({m.ile})</span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-slate-500">
        Pokazano <strong>{ileWidocznych}</strong>{' '}
        {ileWidocznych === 1 ? 'zlecenie' : 'zleceń'} · {opisOkresu(wybor)}. Miesiąc bierze
        się z numeru AZO, a nie z dnia wprowadzenia - zlecenie wpisane w listopadzie
        z numerem AZO za październik rozlicza się w październiku.
      </p>
    </div>
  )
}
