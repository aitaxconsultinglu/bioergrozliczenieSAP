import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { komunikatPL } from '@/lib/config'
import { ETYKIETY_BRAKU, dataPL, liczba } from '@/lib/format'
import type { Profil, StatusBraku } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

interface Wiersz {
  id: number
  ilosc_rbg: number
  status: StatusBraku
  opis: string | null
  utworzono: string
  zmieniono_status: string | null
  zlecenie_id: string
  zlecenia: { mpk: string; nazwa: string; nr_zamowienia: string | null }
  cennik_pozycje: { opis: string } | null
}

const KOLORY: Record<StatusBraku, string> = {
  zgloszony: 'bg-amber-50 text-amber-800 ring-amber-300',
  uzupelniony: 'bg-blekit-jasny text-blekit-ciemny ring-blekit',
  rozliczony: 'bg-limonka-jasna text-limonka-ciemna ring-limonka',
}

/** Rejestr braków godzin - zamiast wpisów „BRAK 4 RBG” w komórkach Excela. */
export function BrakiGodzin({ profil, otworz }: { profil: Profil; otworz: (id: string) => void }) {
  const [wiersze, setWiersze] = useState<Wiersz[]>([])
  const [filtr, setFiltr] = useState<StatusBraku | ''>('zgloszony')
  const [blad, setBlad] = useState<string | null>(null)
  const handlowiec = profil.rola === 'handlowiec'

  const wczytaj = useCallback(async () => {
    const { data, error } = await supabase
      .from('braki_godzin')
      .select('id, ilosc_rbg, status, opis, utworzono, zmieniono_status, zlecenie_id, zlecenia(mpk, nazwa, nr_zamowienia), cennik_pozycje(opis)')
      .order('utworzono', { ascending: false })
      .limit(2000)
    if (error) { setBlad(komunikatPL(error.message)); return }
    setBlad(null)
    setWiersze(((data ?? []) as unknown as Wiersz[]).map((w) => ({ ...w, ilosc_rbg: Number(w.ilosc_rbg) })))
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  const podsumowanie = useMemo(() => {
    const wgMpk = new Map<string, Record<StatusBraku, number>>()
    for (const w of wiersze) {
      const m = wgMpk.get(w.zlecenia.mpk) ?? { zgloszony: 0, uzupelniony: 0, rozliczony: 0 }
      m[w.status] += w.ilosc_rbg
      wgMpk.set(w.zlecenia.mpk, m)
    }
    return [...wgMpk.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [wiersze])

  async function zmienStatus(id: number, status: StatusBraku) {
    const { error } = await supabase.rpc('zmien_status_braku', { p_id: id, p_status: status })
    if (error) { setBlad(komunikatPL(error.message)); return }
    await wczytaj()
  }

  const widoczne = wiersze.filter((w) => !filtr || w.status === filtr)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">Braki godzin</h2>
          <p className="text-sm text-slate-500">Godziny, których zabrakło w zamówieniu klienta - do uzupełnienia i rozliczenia.</p>
        </div>
        <Button className="ml-auto" onClick={() => void wczytaj()} title="Odśwież"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {podsumowanie.map(([mpk, s]) => (
          <div key={mpk} className="sekcja">
            <p className="text-sm font-semibold">{mpk}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">{liczba(s.zgloszony)} <span className="text-sm font-normal text-slate-500">rbg otwartych</span></p>
            <p className="text-xs text-slate-500">uzupełnione: {liczba(s.uzupelniony)} · rozliczone: {liczba(s.rozliczony)}</p>
          </div>
        ))}
        {podsumowanie.length === 0 && <p className="text-sm text-slate-500">Brak zgłoszonych braków.</p>}
      </div>

      <div className="flex gap-1">
        {(['', 'zgloszony', 'uzupelniony', 'rozliczony'] as const).map((s) => (
          <button key={s} onClick={() => setFiltr(s)}
            className={cn('rounded-md px-3 py-1 text-sm', filtr === s ? 'bg-limonka-jasna font-medium' : 'text-slate-600 hover:bg-slate-100')}>
            {s ? ETYKIETY_BRAKU[s] : 'Wszystkie'}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Zgłoszono</th>
              <th className="komorka-naglowek">MPK</th>
              <th className="komorka-naglowek">Zlecenie</th>
              <th className="komorka-naglowek">Stanowisko</th>
              <th className="komorka-naglowek text-right">Rbg</th>
              <th className="komorka-naglowek">Opis</th>
              <th className="komorka-naglowek">Status</th>
            </tr>
          </thead>
          <tbody>
            {widoczne.map((w) => (
              <tr key={w.id}>
                <td className="komorka whitespace-nowrap text-xs">{dataPL(w.utworzono)}</td>
                <td className="komorka">{w.zlecenia.mpk}</td>
                <td className="komorka">
                  <button className="text-left hover:underline" onClick={() => otworz(w.zlecenie_id)}>
                    <span className="font-mono text-xs">{w.zlecenia.nr_zamowienia ?? '-'}</span> {w.zlecenia.nazwa}
                  </button>
                </td>
                <td className="komorka text-sm">{w.cennik_pozycje?.opis ?? '-'}</td>
                <td className="komorka liczba font-medium">{liczba(w.ilosc_rbg)}</td>
                <td className="komorka text-sm">{w.opis}</td>
                <td className="komorka">
                  {handlowiec ? (
                    <select className={cn('rounded px-2 py-0.5 text-xs ring-1', KOLORY[w.status])} value={w.status}
                      onChange={(e) => void zmienStatus(w.id, e.target.value as StatusBraku)}>
                      {Object.entries(ETYKIETY_BRAKU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (
                    <span className={cn('rounded px-2 py-0.5 text-xs ring-1', KOLORY[w.status])}>{ETYKIETY_BRAKU[w.status]}</span>
                  )}
                </td>
              </tr>
            ))}
            {widoczne.length === 0 && <tr><td colSpan={7} className="komorka py-6 text-center text-slate-500">Brak pozycji.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
