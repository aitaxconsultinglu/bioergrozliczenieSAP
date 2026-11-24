import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCheck, Plus, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { komunikatPL } from '@/lib/config'
import { ETYKIETY_STATUSU, KOLEJNOSC_STATUSU, KOLORY_STATUSU, dataGodzinaPL, zl } from '@/lib/format'
import { grosze, policzSumy } from '@/lib/obliczenia'
import type { Dostawca, Profil, StatusZlecenia } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { FiltrKolumny, PUSTE } from './FiltrKolumny'
import type { WyborOkresu } from './NawigatorOkresow'
import { NawigatorOkresow, WSZYSTKO, opisOkresu, pasujeDoOkresu } from './NawigatorOkresow'
import type { OkresZAzo } from '@/lib/okresAzo'
import { okresZAzo, zbudujDrzewoOkresow } from '@/lib/okresAzo'

interface Wiersz {
  id: string
  mpk: string
  nr_zamowienia: string | null
  pozycja_zamowienia: number | null
  nazwa: string
  mechanik: string | null
  konto: string | null
  nr_azo: string | null
  dokument: string | null
  status: StatusZlecenia
  zmodyfikowano: string
  komentarz_handlowca: string | null
  pozycje_uslug: { ilosc: number; cena: number; doplata_proc: number; cennik_pozycja_id: number | null; mpk_wykonawcy: string | null }[]
  pozycje_materialowe: { wartosc_zakupu: number; narzut_proc: number; dostawca: Dostawca; brak: boolean }[]
  uslugi_obce: { wartosc_zakupu: number; narzut_proc: number }[]
  /** Braki godzin - wartość zlecenia na liście to sprzedaż bez braków. */
  braki_godzin: { cennik_pozycja_id: number | null; ilosc_rbg: number }[]
  wartosc: number
  /** Okres rozliczenia odczytany z numeru AZO; null, gdy numer go nie zawiera. */
  okres: OkresZAzo | null
}

type Kolumna = 'nr' | 'azo' | 'konto' | 'nazwa' | 'mpk' | 'mechanik' | 'status' | 'dokument' | 'wartosc' | 'zmieniono'
interface Sortowanie { kolumna: Kolumna; rosnaco: boolean }

const KLUCZ_SORTOWANIA = 'rozliczenia.lista.sortowanie'
const KLUCZ_OKRESU = 'rozliczenia.lista.okres'
const KLUCZ_FILTROW = 'rozliczenia.lista.filtry'
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

/** Zapamiętany wybór okresu. Przy nieznanym zapisie wracamy do „wszystkie” - lepiej
 *  pokazać za dużo niż ukryć zlecenia przez stary wpis w pamięci przeglądarki. */
function wczytajOkres(): WyborOkresu {
  try {
    const w = JSON.parse(localStorage.getItem(KLUCZ_OKRESU) ?? '') as WyborOkresu
    if (w?.rodzaj === 'wszystko' || w?.rodzaj === 'bezOkresu') return w
    if (w?.rodzaj === 'rok' && typeof w.rok === 'number') return w
    if (w?.rodzaj === 'miesiac' && typeof w.rok === 'number' && typeof w.miesiac === 'number') return w
    return WSZYSTKO
  } catch {
    return WSZYSTKO
  }
}

/** Filtry listy (pasek + kolumny) - pamiętane po wejściu w zlecenie i powrocie, do wylogowania. */
interface ZapisFiltrow {
  status: string
  mpk: string
  szukaj: string
  filtry: Record<string, string[]>
}

function wczytajFiltry(): ZapisFiltrow {
  const puste: ZapisFiltrow = { status: '', mpk: '', szukaj: '', filtry: {} }
  try {
    const z = JSON.parse(localStorage.getItem(KLUCZ_FILTROW) ?? '') as Partial<ZapisFiltrow>
    const status = z.status === OTWARTE || (z.status && z.status in ETYKIETY_STATUSU) ? z.status : ''
    const filtry: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(z.filtry ?? {})) if (Array.isArray(v)) filtry[k] = v.map(String)
    return { status, mpk: typeof z.mpk === 'string' ? z.mpk : '', szukaj: typeof z.szukaj === 'string' ? z.szukaj : '', filtry }
  } catch {
    return puste
  }
}

/** Czyści zapamiętane filtry i okres listy zleceń - wywoływane przy wylogowaniu. */
export function wyczyscZapamietaneFiltry() {
  try {
    localStorage.removeItem(KLUCZ_FILTROW)
    localStorage.removeItem(KLUCZ_OKRESU)
  } catch { /* brak pamięci przeglądarki - nie ma czego czyścić */ }
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
    case 'dokument': return tekst(a.dokument, b.dokument)
    case 'wartosc': return a.wartosc - b.wartosc
    case 'zmieniono': return a.zmodyfikowano.localeCompare(b.zmodyfikowano)
  }
}

type KolumnaFiltra = Exclude<Kolumna, 'wartosc'>

/** Wartość komórki tak, jak pokazuje ją filtr kolumny. */
function wartoscDoFiltra(w: Wiersz, k: KolumnaFiltra): string {
  switch (k) {
    case 'nr': return w.nr_zamowienia ? `${w.nr_zamowienia}${w.pozycja_zamowienia ? `-${w.pozycja_zamowienia}` : ''}` : PUSTE
    case 'azo': return w.nr_azo?.trim() || PUSTE
    case 'konto': return w.konto?.trim() || PUSTE
    case 'nazwa': return w.nazwa.trim() || PUSTE
    case 'mpk': return w.mpk
    case 'mechanik': return w.mechanik?.trim() || PUSTE
    case 'status': return ETYKIETY_STATUSU[w.status]
    case 'dokument': return w.dokument?.trim() || PUSTE
    case 'zmieniono': return `${w.zmodyfikowano.slice(5, 7)}.${w.zmodyfikowano.slice(0, 4)}` // miesiąc zmiany
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
  // Filtry wracają po wejściu w zlecenie i powrocie na listę (komponent jest wtedy montowany od nowa).
  const [zapisane] = useState(wczytajFiltry)
  const [status, setStatus] = useState<StatusZlecenia | '' | typeof OTWARTE>(zapisane.status as StatusZlecenia | '' | typeof OTWARTE)
  const [mpk, setMpk] = useState(zapisane.mpk)
  const [szukaj, setSzukaj] = useState(zapisane.szukaj)
  const [sortowanie, setSortowanie] = useState<Sortowanie>(wczytajSortowanie)
  const [filtry, setFiltry] = useState<Partial<Record<KolumnaFiltra, Set<string>>>>(
    () => Object.fromEntries(Object.entries(zapisane.filtry).map(([k, v]) => [k, new Set(v)])),
  )
  const [okres, setOkres] = useState<WyborOkresu>(wczytajOkres)
  const [zaznaczone, setZaznaczone] = useState<Set<string>>(new Set())
  const [potwierdzZakonczenie, setPotwierdzZakonczenie] = useState(false)
  const [zajety, setZajety] = useState(false)
  const handlowiec = profil.rola === 'handlowiec'

  const wczytaj = useCallback(async () => {
    setLadowanie(true)
    const { data, error } = await supabase
      .from('zlecenia')
      .select(`id, mpk, nr_zamowienia, pozycja_zamowienia, nazwa, mechanik, konto, nr_azo, dokument, status, zmodyfikowano, komentarz_handlowca,
               pozycje_uslug(ilosc, cena, doplata_proc, cennik_pozycja_id, mpk_wykonawcy),
               braki_godzin(cennik_pozycja_id, ilosc_rbg),
               pozycje_materialowe(wartosc_zakupu, narzut_proc, dostawca, brak),
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
      okres: okresZAzo(w.nr_azo),
      wartosc: policzSumy(
        w.pozycje_uslug.map((u) => ({ ...u, cena: Number(u.cena), ilosc: Number(u.ilosc), doplata_proc: Number(u.doplata_proc) })),
        w.pozycje_materialowe.map((m) => ({ ...m, wartosc_zakupu: Number(m.wartosc_zakupu), narzut_proc: Number(m.narzut_proc) })),
        cennik,
        (w.uslugi_obce ?? []).map((u) => ({ wartosc_zakupu: Number(u.wartosc_zakupu), narzut_proc: Number(u.narzut_proc) })),
        (w.braki_godzin ?? []).map((b) => ({ cennik_pozycja_id: b.cennik_pozycja_id, ilosc_rbg: Number(b.ilosc_rbg) })),
      ).razem,
    })))
  }, [cennik])

  useEffect(() => { void wczytaj() }, [wczytaj])

  function sortuj(kolumna: Kolumna) {
    setSortowanie((s) => {
      // Pierwsze kliknięcie: tekst rosnąco (A→Z), liczby i daty malejąco (najwyższe/najnowsze na górze).
      const nowe = s.kolumna === kolumna ? { kolumna, rosnaco: !s.rosnaco } : { kolumna, rosnaco: ['nr', 'azo', 'konto', 'nazwa', 'mpk', 'mechanik', 'status', 'dokument'].includes(kolumna) }
      try { localStorage.setItem(KLUCZ_SORTOWANIA, JSON.stringify(nowe)) } catch { /* brak pamięci przeglądarki - sortowanie działa bez zapamiętania */ }
      return nowe
    })
  }

  // Filtry z paska (szukaj / status / MPK) + filtry kolumn; `pomin` pozwala policzyć wartości
  // do listy w filtrze danej kolumny z uwzględnieniem pozostałych filtrów (jak w Excelu).
  const pasuje = useCallback((w: Wiersz, pomin?: KolumnaFiltra, pominOkres = false) => {
    const fraza = szukaj.trim().toLowerCase()
    if (!pominOkres && !pasujeDoOkresu(okres, w.okres)) return false
    if (status && (status === OTWARTE ? w.status === 'zakonczony' || w.status === 'anulowany' : w.status !== status)) return false
    if (mpk && w.mpk !== mpk) return false
    if (fraza && !`${w.nazwa} ${w.nr_zamowienia ?? ''} ${w.mechanik ?? ''} ${w.nr_azo ?? ''} ${w.konto ?? ''} ${w.dokument ?? ''}`.toLowerCase().includes(fraza)) return false
    for (const [k, wybrane] of Object.entries(filtry) as [KolumnaFiltra, Set<string>][]) {
      if (k !== pomin && !wybrane.has(wartoscDoFiltra(w, k))) return false
    }
    return true
  }, [szukaj, status, mpk, filtry, okres])

  const widoczne = useMemo(() => {
    const kier = sortowanie.rosnaco ? 1 : -1
    // Przy remisie najnowsze zmiany na górze, żeby kolejność była stabilna.
    return wiersze.filter((w) => pasuje(w))
      .sort((a, b) => kier * porownaj(a, b, sortowanie.kolumna) || b.zmodyfikowano.localeCompare(a.zmodyfikowano))
  }, [wiersze, pasuje, sortowanie])

  function zmienOkres(w: WyborOkresu) {
    setOkres(w)
    setZaznaczone(new Set())
    try { localStorage.setItem(KLUCZ_OKRESU, JSON.stringify(w)) } catch { /* brak pamięci przeglądarki - filtr działa bez zapamiętania */ }
  }

  /** Drzewo lat i miesięcy liczone z zleceń przechodzących POZOSTAŁE filtry (status, MPK,
   *  szukaj, filtry kolumn), ale bez filtra okresu - tak jak w Excelu: liczba przy
   *  miesiącu mówi, ile zleceń tam zobaczysz przy obecnych ustawieniach. Kierownik widzi
   *  tu wyłącznie swoje MPK, bo RLS nie przysyła mu innych - nie trzeba tego filtrować
   *  drugi raz w przeglądarce. */
  const drzewo = useMemo(
    () => zbudujDrzewoOkresow(wiersze.filter((w) => pasuje(w, undefined, true))),
    [wiersze, pasuje],
  )

  const ileFiltrow = Object.keys(filtry).length
  const saFiltry = ileFiltrow > 0 || !!status || !!mpk || !!szukaj.trim()

  useEffect(() => {
    try {
      // Po odznaczeniu wszystkich filtrów nic nie zostaje w pamięci przeglądarki.
      if (!saFiltry) localStorage.removeItem(KLUCZ_FILTROW)
      else localStorage.setItem(KLUCZ_FILTROW, JSON.stringify({
        status, mpk, szukaj, filtry: Object.fromEntries(Object.entries(filtry).map(([k, v]) => [k, [...(v ?? [])]])),
      } satisfies ZapisFiltrow))
    } catch { /* brak pamięci przeglądarki - filtry działają bez zapamiętania */ }
  }, [status, mpk, szukaj, filtry, saFiltry])

  function wyczyscFiltry() {
    setStatus('')
    setMpk('')
    setSzukaj('')
    setFiltry({})
  }
  const ustawFiltr = (k: KolumnaFiltra, w: Set<string> | null) =>
    setFiltry((f) => { const n = { ...f }; if (w === null) delete n[k]; else n[k] = w; return n })

  const doPoprawki = wiersze.filter((w) => w.status === 'zwrocony').length
  // Anulowane zlecenia nie są rozliczane - nie wchodzą do sum.
  const suma = (lista: Wiersz[]) => grosze(lista.filter((w) => w.status !== 'anulowany').reduce((s, w) => s + w.wartosc, 0))
  const anulowanych = widoczne.filter((w) => w.status === 'anulowany').length
  const sumaWidocznych = suma(widoczne)
  const sumaWszystkich = suma(wiersze)
  const zawezone = widoczne.length !== wiersze.length
  const kolumnPrzedWartoscia = handlowiec ? 9 : 8
  const wybrane = widoczne.filter((w) => zaznaczone.has(w.id))
  const doZakonczenia = widoczne.filter((w) => w.status === 'wyeksportowany' || w.status === 'braki_zgloszone')
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

  // Funkcja, nie komponent: komponent zdefiniowany w środku listy byłby przy każdym renderze
  // nowym typem - React montowałby nagłówek od nowa i zamykał otwarty filtr.
  const naglowek = (kolumna: Kolumna, etykieta: string, className?: string) => {
    const aktywna = sortowanie.kolumna === kolumna
    const Ikona = !aktywna ? ArrowUpDown : sortowanie.rosnaco ? ArrowUp : ArrowDown
    return (
      <th className={cn('komorka-naglowek', className)} aria-sort={aktywna ? (sortowanie.rosnaco ? 'ascending' : 'descending') : 'none'}>
        <span className="inline-flex items-center gap-1">
          <button onClick={() => sortuj(kolumna)} title="Sortuj"
            className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-900', aktywna && 'text-slate-900')}>
            {etykieta}
            <Ikona className={cn('h-3.5 w-3.5', !aktywna && 'opacity-40')} />
          </button>
          {kolumna !== 'wartosc' && (
            <FiltrKolumny etykieta={etykieta} wybrane={filtry[kolumna] ?? null} zmien={(w) => ustawFiltr(kolumna, w)}
              wartosci={wiersze.filter((w) => pasuje(w, kolumna)).map((w) => wartoscDoFiltra(w, kolumna))} />
          )}
        </span>
      </th>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">{handlowiec ? 'Wszystkie zlecenia' : 'Moje zlecenia'}</h2>
          <p className="text-sm text-slate-500">
            {handlowiec ? 'Zlecenia ze wszystkich MPK.' : `MPK: ${profil.mpk.join(', ')}`} Zakładki okresu dzielą zlecenia po miesiącu z numeru AZO. Kliknij nagłówek kolumny, aby sortować; ikonka lejka obok filtruje po wartościach.
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
        <input className="pole max-w-xs" placeholder="Szukaj: nazwa, nr zamówienia, nr AZO, konto, mechanik, dokument" value={szukaj} onChange={(e) => setSzukaj(e.target.value)} />
        <select className="pole w-auto" value={status} onChange={(e) => setStatus(e.target.value as StatusZlecenia | '' | typeof OTWARTE)}>
          <option value="">Wszystkie statusy</option>
          <option value={OTWARTE}>Otwarte (bez zakończonych i anulowanych)</option>
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

      <NawigatorOkresow drzewo={drzewo} wybor={okres} zmien={zmienOkres} ileWidocznych={widoczne.length} />

      {saFiltry && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">
            Filtry są zapamiętane do wylogowania
            {ileFiltrow > 0 && <> · filtry kolumn: <strong>{ileFiltrow}</strong></>} · pokazano {widoczne.length} z {wiersze.length} zleceń
          </span>
          {ileFiltrow > 0 && <button className="text-blekit-ciemny underline" onClick={() => setFiltry({})}>Wyczyść filtry kolumn</button>}
          <button className="text-blekit-ciemny underline" onClick={wyczyscFiltry}>Wyczyść wszystkie filtry</button>
        </div>
      )}
      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}
      {komunikat && <p className="rounded bg-limonka-jasna px-3 py-2 text-sm text-limonka-ciemna">{komunikat}</p>}

      {handlowiec && doZakonczenia.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          <span>Zaznaczono <strong>{wybrane.length}</strong> zleceń wyeksportowanych do SAP{wybrane.length > 0 && <> na kwotę <strong>{zl(suma(wybrane))} zł</strong></>}.</span>
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
              {naglowek('nr', 'Nr zamówienia')}
              {naglowek('azo', 'Nr AZO')}
              {naglowek('konto', 'Konto')}
              {naglowek('nazwa', 'Nazwa')}
              {naglowek('mpk', 'MPK')}
              {naglowek('mechanik', 'Mechanik')}
              {naglowek('status', 'Status')}
              {naglowek('dokument', 'Dokument')}
              {naglowek('wartosc', 'Wartość [zł]', 'text-right')}
              {naglowek('zmieniono', 'Zmieniono')}
            </tr>
          </thead>
          <tbody>
            {widoczne.map((w) => (
              <tr key={w.id} onClick={() => otworz(w.id)} className={cn('cursor-pointer hover:bg-limonka-jasna/40', zaznaczone.has(w.id) && 'bg-limonka-jasna/40')}>
                {handlowiec && (
                  <td className="komorka text-center" onClick={(e) => e.stopPropagation()}>
                    {(w.status === 'wyeksportowany' || w.status === 'braki_zgloszone') && (
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
                <td className="komorka text-sm">{w.dokument ?? <span className="text-slate-300">-</span>}</td>
                <td className="komorka liczba">{zl(w.wartosc)}</td>
                <td className="komorka whitespace-nowrap text-xs text-slate-500">{dataGodzinaPL(w.zmodyfikowano)}</td>
              </tr>
            ))}
            {!ladowanie && widoczne.length === 0 && (
              <tr><td colSpan={handlowiec ? 11 : 10} className="komorka py-8 text-center text-slate-500">
                Brak zleceń{okres.rodzaj !== 'wszystko' && <> w wybranym okresie ({opisOkresu(okres)})</>}.
                {okres.rodzaj !== 'wszystko' && wiersze.length > 0 && (
                  <> <button className="text-blekit-ciemny underline" onClick={() => zmienOkres(WSZYSTKO)}>Pokaż wszystkie okresy</button></>
                )}
              </td></tr>
            )}
          </tbody>
          {!ladowanie && wiersze.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={kolumnPrzedWartoscia} className="komorka text-right">
                  {zawezone ? `Suma po filtrach (${widoczne.length} z ${wiersze.length} zleceń)` : `Suma wszystkich zleceń (${wiersze.length})`}
                  {anulowanych > 0 && <span className="font-normal text-slate-500"> · bez {anulowanych} anulowanych</span>}
                </td>
                <td className="komorka liczba whitespace-nowrap">{zl(sumaWidocznych)}</td>
                <td className="komorka" />
              </tr>
              {zawezone && (
                <tr className="bg-slate-50 text-slate-600">
                  <td colSpan={kolumnPrzedWartoscia} className="komorka text-right">Suma wszystkich zleceń ({wiersze.length})</td>
                  <td className="komorka liczba whitespace-nowrap">{zl(sumaWszystkich)}</td>
                  <td className="komorka" />
                </tr>
              )}
            </tfoot>
          )}
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
