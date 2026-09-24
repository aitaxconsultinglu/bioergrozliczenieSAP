import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ClipboardCopy, Download, FileCheck2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { komunikatPL } from '@/lib/config'
import { dataGodzinaPL, dzisiajISO, zl } from '@/lib/format'
import {
  KOLUMNY_SAP, etykietaZamowienia, pobierz, plikXlsx, sumaWierszy, tekstDoSchowka, wierszeSap,
  type ZlecenieDoEksportu,
} from '@/lib/eksportSap'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

const ZAPYTANIE = `id, mpk, nr_zamowienia, pozycja_zamowienia, nazwa, mechanik, zlozono,
  pozycje_uslug(ilosc, cena, doplata_proc, kolejnosc, cennik_pozycje(*)),
  pozycje_materialowe(nazwa, ilosc, wartosc_zakupu, narzut_proc, dostawca, kolejnosc)`

type ZlecenieZPanelu = ZlecenieDoEksportu & { mechanik: string | null; zlozono: string | null }

interface Eksport {
  id: string
  utworzono: string
  nazwa_pliku: string | null
  eksporty_zlecenia: { zlecenie_id: string }[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizuj(z: any): ZlecenieZPanelu {
  return {
    ...z,
    pozycje_uslug: z.pozycje_uslug.map((u: any) => ({
      ...u, ilosc: Number(u.ilosc), cena: Number(u.cena), doplata_proc: Number(u.doplata_proc),
      cennik_pozycje: { ...u.cennik_pozycje, cena: Number(u.cennik_pozycje.cena) },
    })),
    pozycje_materialowe: z.pozycje_materialowe.map((m: any) => ({
      ...m, ilosc: Number(m.ilosc), wartosc_zakupu: Number(m.wartosc_zakupu), narzut_proc: Number(m.narzut_proc),
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function PanelEksportu({ otworz }: { otworz: (id: string) => void }) {
  const { materialWgKategorii, mpk: listaMpk } = useSlowniki()
  const [zlecenia, setZlecenia] = useState<ZlecenieZPanelu[]>([])
  const [eksporty, setEksporty] = useState<Eksport[]>([])
  const [zaznaczone, setZaznaczone] = useState<Set<string>>(new Set())
  const [rozwiniete, setRozwiniete] = useState<Set<string>>(new Set())
  const [mpk, setMpk] = useState('')
  const [blad, setBlad] = useState<string | null>(null)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [zajety, setZajety] = useState(false)
  const [potwierdz, setPotwierdz] = useState(false)

  const wczytaj = useCallback(async () => {
    const [z, e] = await Promise.all([
      supabase.from('zlecenia').select(ZAPYTANIE).eq('status', 'zlozony').order('zlozono'),
      supabase.from('eksporty').select('id, utworzono, nazwa_pliku, eksporty_zlecenia(zlecenie_id)').order('utworzono', { ascending: false }).limit(15),
    ])
    if (z.error) { setBlad(komunikatPL(z.error.message)); return }
    setZlecenia((z.data ?? []).map(normalizuj))
    setEksporty((e.data ?? []) as Eksport[])
    setZaznaczone(new Set())
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  const widoczne = useMemo(() => zlecenia.filter((z) => !mpk || z.mpk === mpk), [zlecenia, mpk])
  const wybrane = widoczne.filter((z) => zaznaczone.has(z.id))
  const wszystkieZaznaczone = widoczne.length > 0 && wybrane.length === widoczne.length

  const przelacz = (zbior: Set<string>, id: string) => {
    const n = new Set(zbior)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }

  const nazwaPliku = () => `SAP_rozliczenie_${mpk || 'wszystkie'}_${dzisiajISO()}.xlsx`

  async function pobierzXlsx() {
    if (!wybrane.length) return
    pobierz(await plikXlsx(wybrane, materialWgKategorii), nazwaPliku())
    setKomunikat(`Pobrano plik z ${wybrane.length} zleceniami. Po wprowadzeniu do SAP oznacz je jako wyeksportowane.`)
  }

  async function oznacz() {
    setZajety(true)
    const { error } = await supabase.rpc('oznacz_wyeksportowane', { p_ids: wybrane.map((z) => z.id), p_nazwa_pliku: nazwaPliku() })
    setZajety(false)
    setPotwierdz(false)
    if (error) { setBlad(komunikatPL(error.message)); return }
    setKomunikat(`Oznaczono ${wybrane.length} zleceń jako wyeksportowane do SAP.`)
    await wczytaj()
  }

  async function pobierzPonownie(e: Eksport) {
    const ids = e.eksporty_zlecenia.map((x) => x.zlecenie_id)
    const { data, error } = await supabase.from('zlecenia').select(ZAPYTANIE).in('id', ids)
    if (error) { setBlad(komunikatPL(error.message)); return }
    pobierz(await plikXlsx((data ?? []).map(normalizuj), materialWgKategorii), e.nazwa_pliku ?? `SAP_eksport_${e.utworzono.slice(0, 10)}.xlsx`)
  }

  async function kopiuj(z: ZlecenieZPanelu) {
    await navigator.clipboard.writeText(tekstDoSchowka(wierszeSap(z, materialWgKategorii)))
    setKomunikat(`Skopiowano linie zamówienia ${etykietaZamowienia(z)} - wklej w SAP (Ctrl+V).`)
  }

  const sumaWybranych = wybrane.reduce((s, z) => s + sumaWierszy(wierszeSap(z, materialWgKategorii)), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">Eksport do SAP</h2>
          <p className="text-sm text-slate-500">Zlecenia złożone przez kierowników, czekające na wprowadzenie do SAP.</p>
        </div>
        <select className="pole ml-auto w-auto" value={mpk} onChange={(e) => { setMpk(e.target.value); setZaznaczone(new Set()) }}>
          <option value="">Wszystkie MPK</option>
          {listaMpk.map((m) => <option key={m.kod} value={m.kod}>{m.kod}</option>)}
        </select>
        <Button onClick={() => void wczytaj()} title="Odśwież"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}
      {komunikat && <p className="rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">{komunikat}</p>}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <span className="text-sm">Zaznaczono <strong>{wybrane.length}</strong> z {widoczne.length} · wartość <strong>{zl(sumaWybranych)} zł</strong></span>
        <div className="ml-auto flex gap-2">
          <Button wariant="akcent" disabled={!wybrane.length} onClick={() => void pobierzXlsx()}><Download className="h-4 w-4" /> Pobierz XLSX</Button>
          <Button wariant="glowny" disabled={!wybrane.length} onClick={() => setPotwierdz(true)}><FileCheck2 className="h-4 w-4" /> Oznacz jako wyeksportowane</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek w-10">
                <input type="checkbox" aria-label="Zaznacz wszystkie" checked={wszystkieZaznaczone}
                  onChange={() => setZaznaczone(wszystkieZaznaczone ? new Set() : new Set(widoczne.map((z) => z.id)))} />
              </th>
              <th className="komorka-naglowek w-8" />
              <th className="komorka-naglowek">Nr zamówienia</th>
              <th className="komorka-naglowek">Nazwa</th>
              <th className="komorka-naglowek">MPK</th>
              <th className="komorka-naglowek">Złożono</th>
              <th className="komorka-naglowek text-right">Linii</th>
              <th className="komorka-naglowek text-right">Wartość [zł]</th>
              <th className="komorka-naglowek w-32" />
            </tr>
          </thead>
          <tbody>
            {widoczne.map((z) => {
              const wiersze = wierszeSap(z, materialWgKategorii)
              const otwarte = rozwiniete.has(z.id)
              return (
                <Fragment key={z.id}>
                  <tr className={cn(zaznaczone.has(z.id) && 'bg-limonka-jasna/40')}>
                    <td className="komorka text-center">
                      <input type="checkbox" aria-label="Zaznacz" checked={zaznaczone.has(z.id)} onChange={() => setZaznaczone((s) => przelacz(s, z.id))} />
                    </td>
                    <td className="komorka text-center">
                      <button aria-label="Pokaż linie SAP" onClick={() => setRozwiniete((s) => przelacz(s, z.id))}>
                        {otwarte ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="komorka font-mono">{etykietaZamowienia(z)}</td>
                    <td className="komorka">
                      <button className="text-left hover:underline" onClick={() => otworz(z.id)}>{z.nazwa}</button>
                    </td>
                    <td className="komorka">{z.mpk}</td>
                    <td className="komorka whitespace-nowrap text-xs text-slate-500">{dataGodzinaPL(z.zlozono)}</td>
                    <td className="komorka liczba">{wiersze.length}</td>
                    <td className="komorka liczba font-medium">{zl(sumaWierszy(wiersze))}</td>
                    <td className="komorka">
                      <button className="inline-flex items-center gap-1 text-sm text-blekit-ciemny hover:underline" onClick={() => void kopiuj(z)}>
                        <ClipboardCopy className="h-4 w-4" /> Kopiuj
                      </button>
                    </td>
                  </tr>
                  {otwarte && (
                    <tr>
                      <td colSpan={9} className="komorka bg-slate-50 p-2">
                        <table className="w-full border-collapse text-xs">
                          <thead><tr>{KOLUMNY_SAP.map((k) => <th key={k} className="komorka-naglowek">{k}</th>)}</tr></thead>
                          <tbody>
                            {wiersze.map((w, i) => (
                              <tr key={i} className="bg-white">
                                {w.map((c, j) => <td key={j} className={cn('komorka', typeof c === 'number' && 'liczba')}>{typeof c === 'number' && j >= 6 ? zl(c) : c ?? ''}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {widoczne.length === 0 && (
              <tr><td colSpan={9} className="komorka py-8 text-center text-slate-500">Brak zleceń czekających na eksport.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {eksporty.length > 0 && (
        <div className="sekcja">
          <h3 className="mb-2 font-semibold">Ostatnie eksporty</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {eksporty.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-1.5">
                <span className="w-36 text-slate-500">{dataGodzinaPL(e.utworzono)}</span>
                <span className="flex-1">{e.nazwa_pliku} · {e.eksporty_zlecenia.length} zleceń</span>
                <button className="inline-flex items-center gap-1 text-blekit-ciemny hover:underline" onClick={() => void pobierzPonownie(e)}>
                  <Download className="h-4 w-4" /> Pobierz ponownie
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={potwierdz} onOpenChange={setPotwierdz}>
        <DialogContent>
          <DialogTitle>Oznaczyć jako wyeksportowane?</DialogTitle>
          <DialogDescription>
            {wybrane.length} zleceń na łączną kwotę {zl(sumaWybranych)} zł zostanie oznaczonych jako wprowadzone do SAP
            i zablokowanych do edycji. W razie pomyłki eksport pojedynczego zlecenia można cofnąć z jego karty.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setPotwierdz(false)}>Anuluj</Button>
            <Button wariant="glowny" disabled={zajety} onClick={() => void oznacz()}>Oznacz</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
