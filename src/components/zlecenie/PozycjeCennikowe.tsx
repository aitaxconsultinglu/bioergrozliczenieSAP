import { useMemo, useState } from 'react'
import { FileWarning, PenLine, Search, Trash2 } from 'lucide-react'
import { useSlowniki } from '@/lib/slowniki'
import { zl } from '@/lib/format'
import { cenaUslugi, nowyKlucz, wartoscUslugi } from '@/lib/obliczenia'
import { INDEKS_MATERIALU } from '@/lib/eksportSap'
import { szablon } from '@/lib/szablony'
import type { PozycjaUslugi } from '@/lib/types'
import { PoleLiczby } from '../PoleLiczby'

interface Props {
  uslugi: PozycjaUslugi[]
  ustaw: (u: PozycjaUslugi[]) => void
  szablonZlecenia: string
  edycja: boolean
}

const MAKS_WYNIKOW = 40
const INNA_DOPLATA = '__inna__'

/**
 * Pozycje wg cennika (remont pompy, przegląd wagi, ...) - wszystko poza stawkami godzinowymi -
 * oraz pozycje SPOZA cennika (opis i cena wpisane ręcznie), żeby nietypowa praca nigdy nie
 * blokowała rozliczenia. Takie pozycje dział handlowy widzi oznaczone do sprawdzenia.
 */
export function PozycjeCennikowe({ uslugi, ustaw, szablonZlecenia, edycja }: Props) {
  const { pozycje, cennik, kategorie, stawki } = useSlowniki()
  const [fraza, setFraza] = useState('')
  const [kategoria, setKategoria] = useState<number | ''>('')

  const idStawek = useMemo(() => new Set(stawki.map((s) => s.cennik_pozycja_id)), [stawki])
  const doplatySzablonu = szablon(szablonZlecenia).doplaty

  // Stawki godzinowe są w siatce robocizny, a materiał w tabeli materiałów.
  const doWyboru = useMemo(
    () => pozycje.filter((p) => p.aktywna && !idStawek.has(p.id) && p.indeks_sap !== INDEKS_MATERIALU),
    [pozycje, idStawek],
  )

  const wyniki = useMemo(() => {
    const slowa = fraza.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!slowa.length && kategoria === '') return []
    return doWyboru.filter((p) => {
      if (kategoria !== '' && p.nr_pozycji !== kategoria) return false
      const tekst = `${p.indeks_sap} ${p.opis} ${kategorie.get(p.nr_pozycji)?.nazwa ?? ''}`.toLowerCase()
      return slowa.every((s) => tekst.includes(s))
    }).slice(0, MAKS_WYNIKOW)
  }, [doWyboru, fraza, kategoria, kategorie])

  const wiersze = uslugi.filter((u) => u.cennik_pozycja_id === null || !idStawek.has(u.cennik_pozycja_id))

  function dodaj(id: number) {
    const istniejaca = wiersze.find((u) => u.cennik_pozycja_id === id && !u.mpk_wykonawcy)
    if (istniejaca) {
      ustaw(uslugi.map((u) => (u === istniejaca ? { ...u, ilosc: u.ilosc + 1 } : u)))
    } else {
      ustaw([...uslugi, {
        klucz: nowyKlucz(), cennik_pozycja_id: id, ilosc: 1, doplata_proc: 0,
        doplata_opis: null, mpk_wykonawcy: null, opis: null,
      }])
    }
    setFraza('')
  }

  function dodajSpozaCennika() {
    ustaw([...uslugi, {
      klucz: nowyKlucz(), cennik_pozycja_id: null, ilosc: 1, doplata_proc: 0, doplata_opis: null,
      mpk_wykonawcy: null, opis: null, wlasny_opis: fraza.trim() || '', wlasna_jm: 'JD', wlasna_cena: 0, wlasny_indeks: '',
    }])
    setFraza('')
  }

  const zmien = (u: PozycjaUslugi, zmiana: Partial<PozycjaUslugi>) =>
    ustaw(uslugi.map((x) => (x === u ? { ...x, ...zmiana } : x)))

  return (
    <div className="space-y-3">
      {wiersze.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="komorka-naglowek w-24">Indeks SAP</th>
                <th className="komorka-naglowek">Pozycja</th>
                <th className="komorka-naglowek w-20 text-right">Ilość</th>
                <th className="komorka-naglowek w-16">JM</th>
                <th className="komorka-naglowek w-28 text-right">Cena [zł]</th>
                <th className="komorka-naglowek w-44">Dopłata</th>
                <th className="komorka-naglowek w-32 text-right">Wartość [zł]</th>
                <th className="komorka-naglowek w-10" />
              </tr>
            </thead>
            <tbody>
              {wiersze.map((u) => {
                const p = u.cennik_pozycja_id === null ? null : cennik.get(u.cennik_pozycja_id)
                if (u.cennik_pozycja_id !== null && !p) return null
                const cena = p ? (u.cena ?? p.cena) : (u.wlasna_cena ?? 0)
                const kat = p ? kategorie.get(p.nr_pozycji) : undefined
                const znanaDoplata = doplatySzablonu.find((d) => d.opis === u.doplata_opis && d.proc === u.doplata_proc)
                const wyborDoplaty = u.doplata_proc === 0 && !u.doplata_opis ? '' : znanaDoplata ? znanaDoplata.opis : INNA_DOPLATA
                return (
                  <tr key={u.klucz} className={p ? undefined : 'bg-amber-50/40'}>
                    <td className="komorka font-mono text-xs">
                      {p ? p.indeks_sap : (
                        <input className="pole-komorki font-mono" disabled={!edycja} value={u.wlasny_indeks ?? ''} placeholder="(brak)"
                          aria-label="Indeks SAP pozycji spoza cennika" onChange={(e) => zmien(u, { wlasny_indeks: e.target.value })} />
                      )}
                    </td>
                    <td className="komorka">
                      {p ? (
                        <>
                          {p.opis}
                          <span className="ml-2 text-xs text-slate-400">{kat?.nazwa}</span>
                          {kat?.wymaga_karty && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 text-xs text-amber-800 ring-1 ring-amber-300">
                              <FileWarning className="h-3 w-3" /> wymaga karty remontowej
                            </span>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-medium uppercase text-amber-800">spoza cennika</span>
                          <input className="pole-komorki" disabled={!edycja} value={u.wlasny_opis ?? ''} placeholder="Opis pracy (krótko, max 40 znaków trafia do SAP)"
                            aria-label="Opis pozycji spoza cennika" onChange={(e) => zmien(u, { wlasny_opis: e.target.value })} />
                        </div>
                      )}
                      {(edycja || u.opis) && (
                        <input className="pole-komorki mt-0.5 text-xs text-slate-600" disabled={!edycja} value={u.opis ?? ''}
                          placeholder="+ uwagi do pozycji (np. wykaz uszczelek, nr urządzeń)" aria-label="Uwagi do pozycji"
                          onChange={(e) => zmien(u, { opis: e.target.value || null })} />
                      )}
                    </td>
                    <td className="komorka p-0">
                      <PoleLiczby wartosc={u.ilosc} disabled={!edycja} aria-label="Ilość" zmien={(n) => zmien(u, { ilosc: n })} />
                    </td>
                    <td className="komorka text-xs">
                      {p ? p.jm : (
                        <input className="pole-komorki" disabled={!edycja} value={u.wlasna_jm ?? ''} aria-label="JM"
                          onChange={(e) => zmien(u, { wlasna_jm: e.target.value })} />
                      )}
                    </td>
                    <td className="komorka liczba" title={p && u.cena !== undefined && u.cena !== p.cena ? `Cena z chwili wpisu. Obecna w cenniku: ${zl(p.cena)} zł` : undefined}>
                      {p ? (
                        <>
                          {zl(cenaUslugi(u, cena))}
                          {u.doplata_proc > 0 && <span className="block text-[10px] text-slate-400">{zl(cena)} + {u.doplata_proc}%</span>}
                        </>
                      ) : (
                        <PoleLiczby wartosc={u.wlasna_cena ?? 0} disabled={!edycja} aria-label="Cena pozycji spoza cennika"
                          zmien={(n) => zmien(u, { wlasna_cena: n, cena: n })} />
                      )}
                    </td>
                    <td className="komorka">
                      <select className="pole-komorki" disabled={!edycja} value={wyborDoplaty} aria-label="Dopłata"
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '') zmien(u, { doplata_proc: 0, doplata_opis: null })
                          else if (v === INNA_DOPLATA) zmien(u, { doplata_opis: 'Dopłata', doplata_proc: u.doplata_proc || 10 })
                          else {
                            const d = doplatySzablonu.find((x) => x.opis === v)!
                            zmien(u, { doplata_opis: d.opis, doplata_proc: d.proc })
                          }
                        }}>
                        <option value="">brak</option>
                        {doplatySzablonu.map((d) => <option key={d.opis} value={d.opis}>{d.opis} +{d.proc}%</option>)}
                        <option value={INNA_DOPLATA}>inna (wpisz)…</option>
                      </select>
                      {wyborDoplaty === INNA_DOPLATA && (
                        <div className="mt-0.5 flex items-center gap-1">
                          <input className="pole-komorki text-xs" disabled={!edycja} value={u.doplata_opis ?? ''} aria-label="Opis dopłaty"
                            placeholder="za co?" onChange={(e) => zmien(u, { doplata_opis: e.target.value })} />
                          <PoleLiczby wartosc={u.doplata_proc} disabled={!edycja} aria-label="Dopłata %" className="w-14 text-xs"
                            zmien={(n) => zmien(u, { doplata_proc: n })} />
                          <span className="text-xs">%</span>
                        </div>
                      )}
                    </td>
                    <td className="komorka liczba font-medium">{zl(wartoscUslugi(u, cena))}</td>
                    <td className="komorka text-center">
                      {edycja && (
                        <button aria-label="Usuń pozycję" onClick={() => ustaw(uslugi.filter((x) => x !== u))} className="text-slate-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {edycja && (
        <div className="rounded-md border border-dashed border-slate-300 p-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <input
                className="pole pl-8"
                placeholder="Szukaj w cenniku: np. „3x9k”, „siln 7,5 1400”, „uszczelek”, „5000161”"
                value={fraza}
                onChange={(e) => setFraza(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && wyniki.length === 1) dodaj(wyniki[0].id) }}
              />
            </div>
            <select className="pole w-auto max-w-72" value={kategoria} onChange={(e) => setKategoria(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Wszystkie kategorie</option>
              {[...kategorie.values()].filter((k) => k.nr_pozycji !== 310).map((k) => (
                <option key={k.nr_pozycji} value={k.nr_pozycji}>{k.nazwa}</option>
              ))}
            </select>
            <button onClick={dodajSpozaCennika} className="inline-flex items-center gap-1 rounded-md px-3 text-sm text-blekit-ciemny ring-1 ring-blekit hover:bg-blekit-jasny"
              title="Praca, której nie ma w cenniku - wpiszesz opis i cenę ręcznie">
              <PenLine className="h-4 w-4" /> Pozycja spoza cennika
            </button>
          </div>
          {wyniki.length > 0 && (
            <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 bg-white">
              {wyniki.map((p) => (
                <li key={p.id}>
                  <button onClick={() => dodaj(p.id)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-limonka-jasna">
                    <span className="w-20 font-mono text-xs text-slate-500">{p.indeks_sap}</span>
                    <span className="flex-1">{p.opis}</span>
                    <span className="text-xs text-slate-400">{kategorie.get(p.nr_pozycji)?.nazwa}</span>
                    <span className="w-24 text-right tabular-nums">{zl(p.cena)} zł/{p.jm}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(fraza.trim() || kategoria !== '') && wyniki.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">
              Nic nie znaleziono w cenniku. <button className="text-blekit-ciemny underline" onClick={dodajSpozaCennika}>Dodaj „{fraza.trim() || 'pozycję'}” jako pozycję spoza cennika</button>
            </p>
          )}
          {wyniki.length === MAKS_WYNIKOW && <p className="mt-1 text-xs text-slate-500">Pokazano pierwsze {MAKS_WYNIKOW} wyników - doprecyzuj wyszukiwanie.</p>}
        </div>
      )}
      {!edycja && wiersze.length === 0 && <p className="text-sm text-slate-500">Brak pozycji.</p>}
    </div>
  )
}
