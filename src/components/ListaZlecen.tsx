import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCheck, Plus, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { komunikatPL } from '@/lib/config'
import { ETYKIETY_STATUSU, KOLEJNOSC_STATUSU, KOLORY_STATUSU, dataGodzinaPL, zl } from '@/lib/format'
import { policzSumy } from '@/lib/obliczenia'
import type { Dostawca, Profil, StatusZlecenia } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface Wiersz {
  id: string
  mpk: string
  nr_zamowienia: string | null
  pozycja_zamowienia: number | null
  nazwa: string
  mechanik: string | null
  konto: string | null
  nr_azo: string | null
  status: StatusZlecenia
  zmodyfikowano: string
  komentarz_handlowca: string | null
  pozycje_uslug: { ilosc: number; cena: number; doplata_proc: number; cennik_pozycja_id: number | null }[]
  pozycje_materialowe: { wartosc_zakupu: number; narzut_proc: number; dostawca: Dostawca }[]
  uslugi_obce: { wartosc_zakupu: number; narzut_proc: number }[]
  wartosc: number
}

type Kolumna = 'nr' | 'azo' | 'konto' | 'nazwa' | 'mpk' | 'mechanik' | 'status' | 'wartosc' | 'zmieniono'
interface Sortowanie { kolumna: Kolumna; rosnaco: boolean }

const KLUCZ_SORTOWANIA = 'rozliczenia.lista.sortowanie'
const DOMYSLNE: Sortowanie = { kolumna: 'zmieniono', rosnaco: false }
/** Filtr „otwarte” = wszystko oprócz zakończonych - to, czym trzeba się jeszcze zająć. */
const OTWARTE = '__otwarte'

function wczytajSortowanie(): Sortowanie {
  try {
    const s = JSON.parse(localStorage.getItem(KLUCZ_SORTOWANIA) ?? '') as Sortowanie
    return s && typeof s.kolumna === 'string' ? s : DOMYSLNE
  } catch {
    return DOMYSLNE
  }
}

const tekst = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '', 'pl', { numeric: true, sensitivity: 'base' })

function porownaj(a: Wiersz, b: Wiersz, k: Kolumna): number {
  switch (k) {
    case 'nr': return tekst(a.nr_zamowienia, b.nr_zamowienia) || (a.pozycja_zamowienia ?? 0) - (b.pozycja_zamowienia ?? 0)
    case 'azo': return tekst(a.nr_azo, b.nr_azo)
    case 'konto': return tekst(a.konto, b.konto)
    case 'nazwa': return tekst(a.nazwa, b.nazwa)
    case 'mpk': return tekst(a.mpk, b.mpk)
    case 'mechanik': return tekst(a.mechanik, b.mechanik)
    case 'status': return KOLEJNOSC_STATUSU[a.status] - KOLEJNOSC_STATUSU[b.status]
    case 'wartosc': return a.wartosc - b.wartosc
    case 'zmieniono': return a.zmodyfikowano.localeCompare(b.zmodyfikowano)
  }
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
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusZlecenia | '' | typeof OTWARTE>('')
  const [mpk, setMpk] = useState('')
  const [szukaj, setSzukaj] = useState('')
  const [sortowanie, setSortowanie] = useState<Sortowanie>(wczytajSortowanie)
  const [zaznaczone, setZaznaczone] = useState<Set<string>>(new Set())
  const [potwierdzZakonczenie, setPotwierdzZakonczenie] = useState(false)
  const [zajety, setZajety] = useState(false)
  const handlowiec = profil.rola === 'handlowiec'

  const wczytaj = useCallback(async () => {
    setLadowanie(true)
    const { data, error } = await supabase
      .from('zlecenia')
      .select(`id, mpk, nr_zamowienia, pozycja_zamowienia, nazwa, mechanik, konto, nr_azo, status, zmodyfikowano, komentarz_handlowca,
               pozycje_uslug(ilosc, cena, doplata_proc, cennik_pozycja_id),
               pozycje_materialowe(wartosc_zakupu, narzut_proc, dostawca),
               uslugi_obce(wartosc_zakupu, narzut_proc)`)
      .order('zmodyfikowano', { ascending: false })
      .limit(2000)
    setLadowanie(false)
    if (error) { setBlad(error.message); return }
    setBlad(null)
    setZaznaczone(new Set())
    // Wartość liczymy raz przy wczytaniu - potrzebna do wyświetlenia i do sortowania.
    setWiersze(((data ?? []) as unknown as Omit<Wiersz, 'wartosc'>[]).map((w) => ({
      ...w,
      wartosc: policzSumy(
        w.pozycje_uslug.map((u) => ({ ...u, cena: Number(u.cena), ilosc: Number(u.ilosc), doplata_proc: Number(u.doplata_proc) })),
        w.pozycje_materialowe.map((m) => ({ ...m, wartosc_zakupu: Number(m.wartosc_zakupu), narzut_proc: Number(m.narzut_proc) })),
        cennik,
        (w.uslugi_obce ?? []).map((u) => ({ wartosc_zakupu: Number(u.wartosc_zakupu), narzut_proc: Number(u.narzut_proc) })),
      ).razem,
    })))
  }, [cennik])

  useEffect(() => { void wczytaj() }, [wczytaj])

  function sortuj(kolumna: Kolumna) {
    setSortowanie((s) => {
      // Pierwsze kliknięcie: tekst rosnąco (A→Z), liczby i daty malejąco (najwyższe/najnowsze na górze).
      const nowe = s.kolumna === kolumna ? { kolumna, rosnaco: !s.rosnaco } : { kolumna, rosnaco: ['nr', 'azo', 'konto', 'nazwa', 'mpk', 'mechanik', 'status'].includes(kolumna) }
      try { localStorage.setItem(KLUCZ_SORTOWANIA, JSON.stringify(nowe)) } catch { /* brak pamięci przeglądarki - sortowanie działa bez zapamiętania */ }
      return nowe
    })
  }

  const widoczne = useMemo(() => {
    const fraza = szukaj.trim().toLowerCase()
    const odfiltrowane = wiersze.filter((w) =>
      (!status || (status === OTWARTE ? w.status !== 'zakonczony' : w.status === status))
      && (!mpk || w.mpk === mpk)
      && (!fraza || `${w.nazwa} ${w.nr_zamowienia ?? ''} ${w.mechanik ?? ''} ${w.nr_azo ?? ''} ${w.konto ?? ''}`.toLowerCase().includes(fraza)))
    const kier = sortowanie.rosnaco ? 1 : -1
    // Przy remisie najnowsze zmiany na górze, żeby kolejność była stabilna.
    return [...odfiltrowane].sort((a, b) => kier * porownaj(a, b, sortowanie.kolumna) || b.zmodyfikowano.localeCompare(a.zmodyfikowano))
  }, [wiersze, status, mpk, szukaj, sortowanie])

  const doPoprawki = wiersze.filter((w) => w.status === 'zwrocony').length
  const wybrane = widoczne.filter((w) => zaznaczone.has(w.id))
  const doZakonczenia = widoczne.filter((w) => w.status === 'wyeksportowany')
  const wszystkieZaznaczone = doZakonczenia.length > 0 && doZakonczenia.every((w) => zaznaczone.has(w.id))

  async function zakoncz() {
    setZajety(true)
    setBlad(null)
    const { data, error } = await supabase.rpc('oznacz_zakonczone', { p_ids: wybrane.map((w) => w.id) })
    setZajety(false)
    setPotwierdzZakonczenie(false)
    if (error) { setBlad(komunikatPL(error.message)); return }
    setKomunikat(`Zakończono ${Number(data ?? 0)} zleceń.`)
    await wczytaj()
  }

  const Naglowek = ({ kolumna, children, className }: { kolumna: Kolumna; children: string; className?: string }) => {
    const aktywna = sortowanie.kolumna === kolumna
    const Ikona = !aktywna ? ArrowUpDown : sortowanie.rosnaco ? ArrowUp : ArrowDown
    return (
      <th className={cn('komorka-naglowek', className)} aria-sort={aktywna ? (sortowanie.rosnaco ? 'ascending' : 'descending') : 'none'}>
        <button onClick={() => sortuj(kolumna)} title="Sortuj"
          className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-900', aktywna && 'text-slate-900')}>
          {children}
          <Ikona className={cn('h-3.5 w-3.5', !aktywna && 'opacity-40')} />
        </button>
      </th>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">{handlowiec ? 'Wszystkie zlecenia' : 'Moje zlecenia'}</h2>
          <p className="text-sm text-slate-500">
            {handlowiec ? 'Zlecenia ze wszystkich MPK.' : `MPK: ${profil.mpk.join(', ')}`} Kliknij nagłówek kolumny, aby sortować.
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
        <input className="pole max-w-xs" placeholder="Szukaj: nazwa, nr zamówienia, nr AZO, konto, mechanik" value={szukaj} onChange={(e) => setSzukaj(e.target.value)} />
        <select className="pole w-auto" value={status} onChange={(e) => setStatus(e.target.value as StatusZlecenia | '' | typeof OTWARTE)}>
          <option value="">Wszystkie statusy</option>
          <option value={OTWARTE}>Otwarte (bez zakończonych)</option>
          {(Object.keys(ETYKIETY_STATUSU) as StatusZlecenia[]).sort((a, b) => KOLEJNOSC_STATUSU[a] - KOLEJNOSC_STATUSU[b])
            .map((k) => <option key={k} value={k}>{ETYKIETY_STATUSU[k]}</option>)}
        </select>
        {(handlowiec || profil.mpk.length > 1) && (
          <select className="pole w-auto" value={mpk} onChange={(e) => setMpk(e.target.value)}>
            <option value="">Wszystkie MPK</option>
            {(handlowiec ? listaMpk.map((m) => m.kod) : profil.mpk).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
      </div>

      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}
      {komunikat && <p className="rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">{komunikat}</p>}

      {handlowiec && doZakonczenia.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          <span>Zaznaczono <strong>{wybrane.length}</strong> zleceń wyeksportowanych do SAP.</span>
          <Button className="ml-auto" disabled={!wybrane.length || zajety} onClick={() => setPotwierdzZakonczenie(true)}>
            <CheckCheck className="h-4 w-4" /> Oznacz jako zakończone
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {handlowiec && (
                <th className="komorka-naglowek w-10">
                  <input type="checkbox" aria-label="Zaznacz wszystkie wyeksportowane" disabled={!doZakonczenia.length} checked={wszystkieZaznaczone}
                    title="Zaznacz wszystkie wyeksportowane (do zakończenia)"
                    onChange={() => setZaznaczone(wszystkieZaznaczone ? new Set() : new Set(doZakonczenia.map((w) => w.id)))} />
                </th>
              )}
              <Naglowek kolumna="nr">Nr zamówienia</Naglowek>
              <Naglowek kolumna="azo">Nr AZO</Naglowek>
              <Naglowek kolumna="konto">Konto</Naglowek>
              <Naglowek kolumna="nazwa">Nazwa</Naglowek>
              <Naglowek kolumna="mpk">MPK</Naglowek>
              <Naglowek kolumna="mechanik">Mechanik</Naglowek>
              <Naglowek kolumna="status">Status</Naglowek>
              <Naglowek kolumna="wartosc" className="text-right">Wartość [zł]</Naglowek>
              <Naglowek kolumna="zmieniono">Zmieniono</Naglowek>
            </tr>
          </thead>
          <tbody>
            {widoczne.map((w) => (
              <tr key={w.id} onClick={() => otworz(w.id)} className={cn('cursor-pointer hover:bg-limonka-jasna/40', zaznaczone.has(w.id) && 'bg-limonka-jasna/40')}>
                {handlowiec && (
                  <td className="komorka text-center" onClick={(e) => e.stopPropagation()}>
                    {w.status === 'wyeksportowany' && (
                      <input type="checkbox" aria-label="Zaznacz do zakończenia" checked={zaznaczone.has(w.id)}
                        onChange={() => setZaznaczone((s) => { const n = new Set(s); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n })} />
                    )}
                  </td>
                )}
                <td className="komorka font-mono">
                  {w.nr_zamowienia ?? <span className="text-slate-400">brak</span>}
                  {w.pozycja_zamowienia ? `-${w.pozycja_zamowienia}` : ''}
                </td>
                <td className="komorka whitespace-nowrap font-mono text-sm">{w.nr_azo ?? <span className="text-slate-300">-</span>}</td>
                <td className="komorka whitespace-nowrap text-sm">{w.konto ?? <span className="text-slate-300">-</span>}</td>
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
                <td className="komorka liczba">{zl(w.wartosc)}</td>
                <td className="komorka whitespace-nowrap text-xs text-slate-500">{dataGodzinaPL(w.zmodyfikowano)}</td>
              </tr>
            ))}
            {!ladowanie && widoczne.length === 0 && (
              <tr><td colSpan={handlowiec ? 10 : 9} className="komorka py-8 text-center text-slate-500">Brak zleceń.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {ladowanie && <p className="text-sm text-slate-500">Wczytywanie...</p>}

      <Dialog open={potwierdzZakonczenie} onOpenChange={setPotwierdzZakonczenie}>
        <DialogContent>
          <DialogTitle>Oznaczyć jako zakończone?</DialogTitle>
          <DialogDescription>
            {wybrane.length} zleceń otrzyma status „Zakończony” i zostanie zablokowanych do edycji.
            W razie pomyłki status można zmienić w zleceniu przyciskiem „Zmień status”.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setPotwierdzZakonczenie(false)}>Anuluj</Button>
            <Button wariant="glowny" disabled={zajety} onClick={() => void zakoncz()}>Zakończ</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
