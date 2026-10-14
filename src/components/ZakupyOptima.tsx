import { useCallback, useEffect, useState } from 'react'
import { Search, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { komunikatPL } from '@/lib/config'
import { dataGodzinaPL, zl } from '@/lib/format'
import { parsujPlik } from '@/lib/importOptima'
import { Button } from './ui/button'

const PARTIA = 1500

interface Import { id: string; plik: string | null; wierszy: number; utworzono: string }
interface Wynik { towar: string; kod: string | null; nazwa: string; jm: string; cena_jedn: number; numer_faktury: string | null; dostawca: string | null; data: string | null; zrodlo: string }

/**
 * Ceny zakupu z Comarch ERP Optima. Bez połączenia z serwerem Optimy: dział handlowy
 * eksportuje listę "Handel -> Zasoby" do Excela i wgrywa plik tutaj. Każdy import
 * dopisuje nowe zakupy, więc historia (5 ostatnich zakupów towaru) rośnie z czasem.
 */
export function ZakupyOptima() {
  const [importy, setImporty] = useState<Import[]>([])
  const [liczba, setLiczba] = useState<number | null>(null)
  const [postep, setPostep] = useState<{ zrobione: number; wszystkie: number } | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [fraza, setFraza] = useState('')
  const [wyniki, setWyniki] = useState<Wynik[]>([])

  const wczytaj = useCallback(async () => {
    const [i, c] = await Promise.all([
      supabase.from('importy_optima').select('id, plik, wierszy, utworzono').order('utworzono', { ascending: false }).limit(10),
      supabase.from('zakupy_optima').select('id', { count: 'exact', head: true }),
    ])
    setImporty((i.data ?? []) as Import[])
    setLiczba(c.count ?? 0)
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  async function importuj(plik: File) {
    setBlad(null); setKomunikat(null)
    try {
      setPostep({ zrobione: 0, wszystkie: 0 })
      const { wiersze, pominiete } = await parsujPlik(plik)
      if (!wiersze.length) throw new Error('W pliku nie ma towarów z ceną zakupu.')
      const { data: idImportu, error: e1 } = await supabase.rpc('rozpocznij_import_optima', { p_plik: plik.name })
      if (e1) throw e1
      let zapisane = 0
      for (let i = 0; i < wiersze.length; i += PARTIA) {
        setPostep({ zrobione: i, wszystkie: wiersze.length })
        const { data, error } = await supabase.rpc('importuj_zakupy_optima', { p_import: idImportu, p_wiersze: wiersze.slice(i, i + PARTIA) })
        if (error) throw error
        zapisane += Number(data ?? 0)
      }
      setKomunikat(`Wczytano ${zapisane.toLocaleString('pl-PL')} pozycji z pliku „${plik.name}” (pominięto ${pominiete.toLocaleString('pl-PL')} bez ceny zakupu lub usług). Podpowiedzi cen w materiałach już z nich korzystają.`)
    } catch (e) {
      setBlad(komunikatPL(e instanceof Error ? e.message : String(e)))
    } finally {
      setPostep(null)
      await wczytaj()
    }
  }

  async function szukaj() {
    const { data, error } = await supabase.rpc('historia_zakupow', { p_fraza: fraza })
    if (error) { setBlad(komunikatPL(error.message)); return }
    setWyniki(((data ?? []) as Wynik[]).map((w) => ({ ...w, cena_jedn: Number(w.cena_jedn) })))
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Ceny zakupu z Optimy</h2>
        <p className="text-sm text-slate-500">
          Źródło podpowiedzi „5 ostatnich zakupów” przy wpisywaniu materiałów. W bazie jest {liczba === null ? '…' : liczba.toLocaleString('pl-PL')} zakupów z Optimy.
        </p>
      </div>
      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}
      {komunikat && <p className="rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">{komunikat}</p>}

      <section className="sekcja space-y-3">
        <h3 className="font-semibold">Wgraj eksport z Optimy</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>W Optimie: <strong>Handel → Zasoby</strong>. Lista musi mieć kolumny <em>Kod, Nazwa, Jm, C. zakupu, PZ, DostPZ</em> (tak jak w pliku z 14.10.2026).</li>
          <li>Eksportuj listę do Excela (.xlsx) i wybierz plik poniżej.</li>
          <li>Wgrywaj nowy eksport co jakiś czas, np. raz w tygodniu. Nowe zakupy dopiszą się do historii, a stare zostaną.</li>
        </ol>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-limonka px-4 py-2 text-sm font-medium hover:bg-limonka-ciemna hover:text-white">
          <Upload className="h-4 w-4" /> Wybierz plik .xlsx
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={!!postep}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importuj(f) }} />
        </label>
        {postep && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded bg-slate-200">
              <div className="h-full bg-limonka transition-all" style={{ width: postep.wszystkie ? `${(postep.zrobione / postep.wszystkie) * 100}%` : '5%' }} />
            </div>
            <p className="text-xs text-slate-500">
              {postep.wszystkie ? `Zapisuję ${postep.zrobione.toLocaleString('pl-PL')} / ${postep.wszystkie.toLocaleString('pl-PL')}…` : 'Czytam plik…'} Nie zamykaj strony.
            </p>
          </div>
        )}
        {importy.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="komorka-naglowek">Wgrano</th><th className="komorka-naglowek">Plik</th><th className="komorka-naglowek text-right">Pozycji</th></tr></thead>
            <tbody>
              {importy.map((i) => (
                <tr key={i.id}><td className="komorka">{dataGodzinaPL(i.utworzono)}</td><td className="komorka">{i.plik}</td><td className="komorka liczba">{i.wierszy.toLocaleString('pl-PL')}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sekcja space-y-3">
        <h3 className="font-semibold">Sprawdź podpowiedź</h3>
        <div className="flex gap-2">
          <input className="pole max-w-sm" placeholder="np. łożysko 6308" value={fraza} onChange={(e) => setFraza(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void szukaj() }} />
          <Button onClick={() => void szukaj()}><Search className="h-4 w-4" /> Szukaj</Button>
        </div>
        {wyniki.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="komorka-naglowek">Towar</th><th className="komorka-naglowek">Dokument</th><th className="komorka-naglowek">Dostawca</th>
                <th className="komorka-naglowek">Data</th><th className="komorka-naglowek text-right">Cena zakupu</th><th className="komorka-naglowek">Źródło</th>
              </tr>
            </thead>
            <tbody>
              {wyniki.map((w, i) => (
                <tr key={i}>
                  <td className="komorka">{w.nazwa}{w.kod && <span className="ml-1 text-xs text-slate-400">[{w.kod}]</span>}</td>
                  <td className="komorka font-mono text-xs">{w.numer_faktury ?? '-'}</td>
                  <td className="komorka text-xs">{w.dostawca ?? '-'}</td>
                  <td className="komorka text-xs">{w.data ? (w.zrodlo === 'Optima' ? w.data.slice(5, 7) + '.' + w.data.slice(0, 4) : w.data) : '-'}</td>
                  <td className="komorka liczba">{zl(w.cena_jedn)} zł/{w.jm}</td>
                  <td className="komorka text-xs">{w.zrodlo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
