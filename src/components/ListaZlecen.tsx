import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { ETYKIETY_STATUSU, KOLORY_STATUSU, dataGodzinaPL, zl } from '@/lib/format'
import { policzSumy } from '@/lib/obliczenia'
import type { Dostawca, Profil, StatusZlecenia } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

interface Wiersz {
  id: string
  mpk: string
  nr_zamowienia: string | null
  pozycja_zamowienia: number | null
  nazwa: string
  mechanik: string | null
  status: StatusZlecenia
  zmodyfikowano: string
  komentarz_handlowca: string | null
  pozycje_uslug: { ilosc: number; cena: number; doplata_proc: number; cennik_pozycja_id: number }[]
  pozycje_materialowe: { wartosc_zakupu: number; narzut_proc: number; dostawca: Dostawca }[]
}

interface Props {
  profil: Profil
  otworz: (id: string) => void
}

export function ListaZlecen({ profil, otworz }: Props) {
  const { cennik, mpk: listaMpk } = useSlowniki()
  const [wiersze, setWiersze] = useState<Wiersz[]>([])
  const [ladowanie, setLadowanie] = useState(true)
  const [blad, setBlad] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusZlecenia | ''>('')
  const [mpk, setMpk] = useState('')
  const [szukaj, setSzukaj] = useState('')
  const handlowiec = profil.rola === 'handlowiec'

  const wczytaj = useCallback(async () => {
    setLadowanie(true)
    const { data, error } = await supabase
      .from('zlecenia')
      .select(`id, mpk, nr_zamowienia, pozycja_zamowienia, nazwa, mechanik, status, zmodyfikowano, komentarz_handlowca,
               pozycje_uslug(ilosc, cena, doplata_proc, cennik_pozycja_id),
               pozycje_materialowe(wartosc_zakupu, narzut_proc, dostawca)`)
      .order('zmodyfikowano', { ascending: false })
      .limit(2000)
    setLadowanie(false)
    if (error) { setBlad(error.message); return }
    setBlad(null)
    setWiersze((data ?? []) as unknown as Wiersz[])
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  const widoczne = useMemo(() => {
    const fraza = szukaj.trim().toLowerCase()
    return wiersze.filter((w) =>
      (!status || w.status === status)
      && (!mpk || w.mpk === mpk)
      && (!fraza || `${w.nazwa} ${w.nr_zamowienia ?? ''} ${w.mechanik ?? ''}`.toLowerCase().includes(fraza)))
  }, [wiersze, status, mpk, szukaj])

  const doPoprawki = wiersze.filter((w) => w.status === 'zwrocony').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">{handlowiec ? 'Wszystkie zlecenia' : 'Moje zlecenia'}</h2>
          <p className="text-sm text-slate-500">
            {handlowiec ? 'Zlecenia ze wszystkich MPK.' : `MPK: ${profil.mpk.join(', ')}`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => void wczytaj()} title="Odśwież"><RefreshCw className="h-4 w-4" /></Button>
          <Button wariant="glowny" onClick={() => otworz('nowe')}><Plus className="h-4 w-4" /> Nowe zlecenie</Button>
        </div>
      </div>

      {doPoprawki > 0 && !handlowiec && (
        <button
          onClick={() => setStatus('zwrocony')}
          className="w-full rounded-md bg-amber-50 px-4 py-2 text-left text-sm text-amber-900 ring-1 ring-amber-300"
        >
          Masz {doPoprawki} {doPoprawki === 1 ? 'zlecenie zwrócone' : 'zlecenia zwrócone'} do poprawki przez dział handlowy. Kliknij, aby pokazać.
        </button>
      )}

      <div className="flex flex-wrap gap-3">
        <input className="pole max-w-xs" placeholder="Szukaj: nazwa, nr zamówienia, mechanik" value={szukaj} onChange={(e) => setSzukaj(e.target.value)} />
        <select className="pole w-auto" value={status} onChange={(e) => setStatus(e.target.value as StatusZlecenia | '')}>
          <option value="">Wszystkie statusy</option>
          {Object.entries(ETYKIETY_STATUSU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {(handlowiec || profil.mpk.length > 1) && (
          <select className="pole w-auto" value={mpk} onChange={(e) => setMpk(e.target.value)}>
            <option value="">Wszystkie MPK</option>
            {(handlowiec ? listaMpk.map((m) => m.kod) : profil.mpk).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
      </div>

      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Nr zamówienia</th>
              <th className="komorka-naglowek">Nazwa</th>
              <th className="komorka-naglowek">MPK</th>
              <th className="komorka-naglowek">Mechanik</th>
              <th className="komorka-naglowek">Status</th>
              <th className="komorka-naglowek text-right">Wartość [zł]</th>
              <th className="komorka-naglowek">Zmieniono</th>
            </tr>
          </thead>
          <tbody>
            {widoczne.map((w) => {
              const sumy = policzSumy(w.pozycje_uslug.map((u) => ({ ...u, cena: Number(u.cena), ilosc: Number(u.ilosc), doplata_proc: Number(u.doplata_proc) })),
                w.pozycje_materialowe.map((m) => ({ ...m, wartosc_zakupu: Number(m.wartosc_zakupu), narzut_proc: Number(m.narzut_proc) })), cennik)
              return (
                <tr key={w.id} onClick={() => otworz(w.id)} className="cursor-pointer hover:bg-limonka-jasna/40">
                  <td className="komorka font-mono">
                    {w.nr_zamowienia ?? <span className="text-slate-400">brak</span>}
                    {w.pozycja_zamowienia ? `-${w.pozycja_zamowienia}` : ''}
                  </td>
                  <td className="komorka">
                    {w.nazwa}
                    {w.status === 'zwrocony' && w.komentarz_handlowca && (
                      <p className="text-xs text-amber-800">Do poprawki: {w.komentarz_handlowca}</p>
                    )}
                  </td>
                  <td className="komorka">{w.mpk}</td>
                  <td className="komorka">{w.mechanik}</td>
                  <td className="komorka">
                    <span className={cn('inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs ring-1', KOLORY_STATUSU[w.status])}>
                      {ETYKIETY_STATUSU[w.status]}
                    </span>
                  </td>
                  <td className="komorka liczba">{zl(sumy.razem)}</td>
                  <td className="komorka whitespace-nowrap text-xs text-slate-500">{dataGodzinaPL(w.zmodyfikowano)}</td>
                </tr>
              )
            })}
            {!ladowanie && widoczne.length === 0 && (
              <tr><td colSpan={7} className="komorka py-8 text-center text-slate-500">Brak zleceń.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {ladowanie && <p className="text-sm text-slate-500">Wczytywanie...</p>}
    </div>
  )
}
