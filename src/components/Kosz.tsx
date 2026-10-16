import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { komunikatPL } from '@/lib/config'
import { ETYKIETY_STATUSU, dataGodzinaPL } from '@/lib/format'
import type { StatusZlecenia } from '@/lib/types'
import { Button } from './ui/button'

interface Usuniete {
  id: string
  nr_zamowienia: string | null
  nazwa: string | null
  mpk: string | null
  status: StatusZlecenia | null
  nr_azo: string | null
  usunieto: string
  usunal: string | null
}

/**
 * Kosz: zlecenia usunięte z aplikacji. Usunięcie zapisuje pełną kopię zlecenia (z pozycjami,
 * materiałami, kartami i załącznikami) w dzienniku zmian, więc da się je odtworzyć 1:1.
 */
export function Kosz({ otworz }: { otworz: (id: string) => void }) {
  const [lista, setLista] = useState<Usuniete[]>([])
  const [blad, setBlad] = useState<string | null>(null)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [przywrocone, setPrzywrocone] = useState<string | null>(null)
  const [zajety, setZajety] = useState<string | null>(null)

  const wczytaj = useCallback(async () => {
    const { data, error } = await supabase.rpc('usuniete_zlecenia')
    if (error) { setBlad(komunikatPL(error.message)); return }
    setLista(((data ?? []) as Usuniete[]).sort((a, b) => b.usunieto.localeCompare(a.usunieto)))
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  async function przywroc(z: Usuniete) {
    setZajety(z.id); setBlad(null); setKomunikat(null)
    const { error } = await supabase.rpc('przywroc_zlecenie', { p_id: z.id })
    setZajety(null)
    if (error) { setBlad(komunikatPL(error.message)); return }
    setKomunikat(`Przywrócono zlecenie „${z.nazwa ?? z.nr_zamowienia}”.`)
    setPrzywrocone(z.id)
    await wczytaj()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">Kosz - usunięte zlecenia</h2>
          <p className="text-sm text-slate-500">Każde usunięte zlecenie można przywrócić razem z pozycjami, materiałami, kartami i załącznikami.</p>
        </div>
        <Button className="ml-auto" onClick={() => void wczytaj()} title="Odśwież"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}
      {komunikat && (
        <p className="flex flex-wrap items-center gap-3 rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">
          {komunikat}
          {przywrocone && <button className="underline" onClick={() => otworz(przywrocone)}>Otwórz zlecenie</button>}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Usunięto</th>
              <th className="komorka-naglowek">Usunął</th>
              <th className="komorka-naglowek">Nr zamówienia</th>
              <th className="komorka-naglowek">Nazwa</th>
              <th className="komorka-naglowek">MPK</th>
              <th className="komorka-naglowek">Status w chwili usunięcia</th>
              <th className="komorka-naglowek" />
            </tr>
          </thead>
          <tbody>
            {lista.map((z) => (
              <tr key={z.id}>
                <td className="komorka whitespace-nowrap text-sm">{dataGodzinaPL(z.usunieto)}</td>
                <td className="komorka text-sm">{z.usunal ?? 'system'}</td>
                <td className="komorka font-mono">{z.nr_zamowienia}</td>
                <td className="komorka">{z.nazwa}</td>
                <td className="komorka">{z.mpk}</td>
                <td className="komorka text-sm">{z.status ? ETYKIETY_STATUSU[z.status] : ''}</td>
                <td className="komorka">
                  <div className="flex justify-end gap-2">
                    <Button disabled={zajety === z.id} onClick={() => void przywroc(z)}>
                      <RotateCcw className="h-4 w-4" /> {zajety === z.id ? 'Przywracam…' : 'Przywróć'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={7} className="komorka py-8 text-center text-slate-500">Kosz jest pusty.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
