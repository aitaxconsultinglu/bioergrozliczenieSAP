import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ClipboardCopy, Copy, Printer, Save, Send, Trash2, Undo2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { komunikatPL } from '@/lib/config'
import { ETYKIETY_BRAKU, ETYKIETY_STATUSU, KOLORY_STATUSU, dataGodzinaPL, zl } from '@/lib/format'
import { nowyKlucz, policzSumy } from '@/lib/obliczenia'
import { SZABLONY, brakiKarty, szablon } from '@/lib/szablony'
import { KOLUMNY_SAP, tekstDoSchowka, wierszeSap, type ZlecenieDoEksportu } from '@/lib/eksportSap'
import type {
  BrakGodzin, KartaRemontowa, PozycjaMaterialowa, PozycjaUslugi, Profil, StatusZlecenia, Zlecenie,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { PoleLiczby } from './PoleLiczby'
import { SiatkaRobocizny } from './zlecenie/SiatkaRobocizny'
import { PozycjeCennikowe } from './zlecenie/PozycjeCennikowe'
import { TabelaMaterialow } from './zlecenie/TabelaMaterialow'
import { KartyRemontowe } from './zlecenie/KartyRemontowe'

interface Props {
  /** null = nowe zlecenie, 'kopia:<uuid>' = nowe na wzór istniejącego, uuid = edycja */
  zlecenieId: string | null
  profil: Profil
  zamknij: () => void
  otworzInne: (id: string) => void
}

interface Naglowek {
  mpk: string
  nr_zamowienia: string
  pozycja_zamowienia: string
  konto: string
  nazwa: string
  mechanik: string
  szablon: string
  dane_szablonu: Record<string, unknown>
  data_przyjecia: string
  data_zakonczenia: string
  uwagi: string
}

interface Stan {
  naglowek: Naglowek
  uslugi: PozycjaUslugi[]
  materialy: PozycjaMaterialowa[]
  karty: KartaRemontowa[]
  braki: BrakGodzin[]
}

interface Historia {
  zamowienia: { nr: string; nazwa: string }[]
  konta: string[]
  mechanicy: string[]
  materialy: string[]
  numeryKart: string[]
}

const pustyNaglowek = (mpk: string): Naglowek => ({
  mpk, nr_zamowienia: '', pozycja_zamowienia: '', konto: '', nazwa: '', mechanik: '',
  szablon: 'urzadzenie', dane_szablonu: {}, data_przyjecia: '', data_zakonczenia: '', uwagi: '',
})

/* eslint-disable @typescript-eslint/no-explicit-any */
function zBazy(z: any): Stan {
  return {
    naglowek: {
      mpk: z.mpk, nr_zamowienia: z.nr_zamowienia ?? '', pozycja_zamowienia: z.pozycja_zamowienia?.toString() ?? '',
      konto: z.konto ?? '', nazwa: z.nazwa ?? '', mechanik: z.mechanik ?? '', szablon: z.szablon,
      dane_szablonu: z.dane_szablonu ?? {}, data_przyjecia: z.data_przyjecia ?? '',
      data_zakonczenia: z.data_zakonczenia ?? '', uwagi: z.uwagi ?? '',
    },
    uslugi: [...(z.pozycje_uslug ?? [])].sort((a: any, b: any) => a.kolejnosc - b.kolejnosc || a.id - b.id).map((u: any) => ({
      id: u.id, klucz: `u${u.id}`, cennik_pozycja_id: u.cennik_pozycja_id, ilosc: Number(u.ilosc), cena: Number(u.cena),
      doplata_proc: Number(u.doplata_proc), doplata_opis: u.doplata_opis, mpk_wykonawcy: u.mpk_wykonawcy, opis: u.opis,
    })),
    materialy: [...(z.pozycje_materialowe ?? [])].sort((a: any, b: any) => a.kolejnosc - b.kolejnosc || a.id - b.id).map((m: any) => ({
      id: m.id, klucz: `m${m.id}`, nazwa: m.nazwa, ilosc: Number(m.ilosc), jm: m.jm, wartosc_zakupu: Number(m.wartosc_zakupu),
      dostawca: m.dostawca, narzut_proc: Number(m.narzut_proc), numer_faktury: m.numer_faktury,
    })),
    karty: [...(z.karty_remontowe ?? [])].sort((a: any, b: any) => a.utworzono.localeCompare(b.utworzono)).map((k: any) => ({
      id: k.id, klucz: `k${k.id}`, numer_karty: k.numer_karty ?? '', szablon: k.szablon, urzadzenie_nazwa: k.urzadzenie_nazwa ?? '',
      urzadzenie_typ: k.urzadzenie_typ ?? '', urzadzenie_nr: k.urzadzenie_nr ?? '', klient: k.klient ?? 'Synthos',
      data_przyjecia: k.data_przyjecia ?? '', data_zakonczenia: k.data_zakonczenia ?? '',
      mechanik_przekazujacy: k.mechanik_przekazujacy ?? '', mechanik_przyjmujacy: k.mechanik_przyjmujacy ?? '',
      opis_uszkodzenia: k.opis_uszkodzenia ?? '', dane: k.dane ?? {},
    })),
    braki: [...(z.braki_godzin ?? [])].sort((a: any, b: any) => a.id - b.id).map((b: any) => ({
      id: b.id, klucz: `b${b.id}`, cennik_pozycja_id: b.cennik_pozycja_id, ilosc_rbg: Number(b.ilosc_rbg), status: b.status, opis: b.opis,
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const bezPustychMaterialow = (m: PozycjaMaterialowa[]) =>
  m.filter((x) => x.nazwa.trim() || x.wartosc_zakupu > 0 || x.numer_faktury)

export function EdytorZlecenia({ zlecenieId, profil, zamknij, otworzInne }: Props) {
  const { cennik, kategorie, stawki, materialWgKategorii } = useSlowniki()
  const handlowiec = profil.rola === 'handlowiec'
  const kopia = zlecenieId?.startsWith('kopia:') ?? false
  const idZrodla = kopia ? zlecenieId!.slice(6) : zlecenieId
  const nowe = !idZrodla || kopia
  const mpkDomyslne = profil.mpk[0] ?? 'P04'

  const [stan, setStan] = useState<Stan>({ naglowek: pustyNaglowek(mpkDomyslne), uslugi: [], materialy: [], karty: [], braki: [] })
  const [zapisany, setZapisany] = useState<string>('')
  const [meta, setMeta] = useState<Pick<Zlecenie, 'status' | 'komentarz_handlowca' | 'zmodyfikowano' | 'zlozono' | 'wyeksportowano'> | null>(null)
  const [historia, setHistoria] = useState<Historia>({ zamowienia: [], konta: [], mechanicy: [], materialy: [], numeryKart: [] })
  const [ladowanie, setLadowanie] = useState(!!idZrodla)
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [komunikat, setKomunikat] = useState<string | null>(null)
  const [zwrot, setZwrot] = useState<{ otwarty: boolean; tekst: string }>({ otwarty: false, tekst: '' })
  const [potwierdzUsun, setPotwierdzUsun] = useState(false)
  const [wpisyAudytu, setWpisyAudytu] = useState<{ czas: string; user_email: string | null; tabela: string; akcja: string }[] | null>(null)

  const status: StatusZlecenia = meta?.status ?? 'roboczy'
  const edycja = nowe || (handlowiec ? status !== 'wyeksportowany' : status === 'roboczy' || status === 'zwrocony')
  const { naglowek, uslugi, materialy, karty, braki } = stan
  const zmieniony = JSON.stringify(stan) !== zapisany

  const wczytaj = useCallback(async (id: string) => {
    setLadowanie(true)
    const { data, error } = await supabase
      .from('zlecenia')
      .select('*, pozycje_uslug(*), pozycje_materialowe(*), karty_remontowe(*), braki_godzin(*)')
      .eq('id', id)
      .maybeSingle()
    setLadowanie(false)
    if (error || !data) {
      setBlad(error ? komunikatPL(error.message) : 'Nie znaleziono zlecenia albo nie masz do niego dostępu.')
      return
    }
    const s = zBazy(data)
    if (kopia) {
      // Kopia: ten sam typ pracy (nagłówek + pozycje cennikowe + robocizna), bez numeru
      // zamówienia, dat, materiałów z faktur, kart i braków - to zawsze nowe dane.
      const nowy: Stan = {
        naglowek: { ...s.naglowek, nr_zamowienia: '', pozycja_zamowienia: '', data_przyjecia: '', data_zakonczenia: '', uwagi: '' },
        uslugi: s.uslugi.map((u) => ({ ...u, id: undefined, cena: undefined, klucz: nowyKlucz() })),
        materialy: [], karty: [], braki: [],
      }
      setStan(nowy)
      setZapisany('')
      return
    }
    setStan(s)
    setZapisany(JSON.stringify(s))
    setMeta({
      status: data.status, komentarz_handlowca: data.komentarz_handlowca, zmodyfikowano: data.zmodyfikowano,
      zlozono: data.zlozono, wyeksportowano: data.wyeksportowano,
    })
  }, [kopia])

  useEffect(() => {
    if (idZrodla) void wczytaj(idZrodla)
    else setZapisany(JSON.stringify(stan))
  }, [idZrodla, wczytaj]) // eslint-disable-line react-hooks/exhaustive-deps

  // Podpowiedzi z historii: nr zamówienia SAP nie da się pobrać z SAP (brak API/eksportu),
  // więc aplikacja podpowiada to, co już kiedyś wpisano (w obrębie widocznych MPK).
  useEffect(() => {
    void (async () => {
      const [z, m, k] = await Promise.all([
        supabase.from('zlecenia').select('nr_zamowienia, nazwa, konto, mechanik').order('zmodyfikowano', { ascending: false }).limit(1500),
        supabase.from('pozycje_materialowe').select('nazwa').order('utworzono', { ascending: false }).limit(2000),
        supabase.from('karty_remontowe').select('numer_karty').not('numer_karty', 'is', null).order('utworzono', { ascending: false }).limit(2000),
      ])
      const unik = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))]
      const zamowienia = new Map<string, string>()
      for (const r of z.data ?? []) if (r.nr_zamowienia && !zamowienia.has(r.nr_zamowienia)) zamowienia.set(r.nr_zamowienia, r.nazwa)
      setHistoria({
        zamowienia: [...zamowienia.entries()].map(([nr, nazwa]) => ({ nr, nazwa })),
        konta: unik((z.data ?? []).map((r) => r.konto)),
        mechanicy: unik((z.data ?? []).map((r) => r.mechanik)),
        materialy: unik((m.data ?? []).map((r) => r.nazwa)),
        numeryKart: unik((k.data ?? []).map((r) => r.numer_karty)),
      })
    })()
  }, [])

  useEffect(() => {
    if (!zmieniony || !edycja) return
    const ostrzez = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', ostrzez)
    return () => window.removeEventListener('beforeunload', ostrzez)
  }, [zmieniony, edycja])

  const ustaw = <K extends keyof Stan>(klucz: K) => (wartosc: Stan[K]) => setStan((s) => ({ ...s, [klucz]: wartosc }))
  const ustawNaglowek = (zmiana: Partial<Naglowek>) => setStan((s) => ({ ...s, naglowek: { ...s.naglowek, ...zmiana } }))

  const sumy = useMemo(() => policzSumy(uslugi, materialy, cennik), [uslugi, materialy, cennik])

  const wymaganeKarty = useMemo(() => Math.ceil(uslugi.reduce((s, u) => {
    const p = cennik.get(u.cennik_pozycja_id)
    return p && kategorie.get(p.nr_pozycji)?.wymaga_karty ? s + u.ilosc : s
  }, 0)), [uslugi, cennik, kategorie])

  // Numer kolejnej karty: KR nn/mm/rrrr, nn = następny wolny w bieżącym miesiącu.
  const numerKarty = useCallback((przesuniecie: number) => {
    const d = new Date()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const rrrr = d.getFullYear()
    const wzorzec = new RegExp(`^KR\\s*(\\d+)\\s*/\\s*${mm}\\s*/\\s*${rrrr}$`, 'i')
    const numery = [...historia.numeryKart, ...karty.map((k) => k.numer_karty)]
      .map((n) => wzorzec.exec(n.trim())?.[1]).filter(Boolean).map(Number)
    const nast = (numery.length ? Math.max(...numery) : 0) + 1 + przesuniecie
    return `KR ${String(nast).padStart(2, '0')}/${mm}/${rrrr}`
  }, [historia.numeryKart, karty])

  function bledyZapisu(): string | null {
    if (!naglowek.nazwa.trim()) return 'Wpisz nazwę zlecenia (np. „POMPA 3X9K NR 422”).'
    if (!naglowek.mpk) return 'Wybierz MPK.'
    if (naglowek.pozycja_zamowienia && !/^\d+$/.test(naglowek.pozycja_zamowienia)) return 'Pozycja zamówienia musi być liczbą (np. 10, 20).'
    const mat = bezPustychMaterialow(materialy)
    if (mat.some((m) => !m.nazwa.trim())) return 'Uzupełnij nazwę materiału we wszystkich wierszach (albo usuń puste wiersze).'
    if (mat.some((m) => !(m.ilosc > 0))) return 'Ilość materiału musi być większa od zera.'
    return null
  }

  function bledyZlozenia(): string | null {
    if (!naglowek.nr_zamowienia.trim()) return 'Wpisz numer zamówienia SAP - bez niego nie da się rozliczyć zlecenia.'
    if (!uslugi.some((u) => u.ilosc > 0) && !bezPustychMaterialow(materialy).length) return 'Zlecenie nie ma żadnych pozycji do rozliczenia.'
    if (karty.length < wymaganeKarty) {
      return `Pozycje cennikowe wymagają ${wymaganeKarty} kart remontowych, a jest ${karty.length}. Uzupełnij karty w sekcji „Karty remontowe”.`
    }
    const niepelne = karty.map((k, i) => ({ i, braki: brakiKarty(k) })).filter((x) => x.braki.length)
    if (niepelne.length) return `Karta ${niepelne[0].i + 1} jest niekompletna - brakuje: ${niepelne[0].braki.join(', ')}.`
    const numery = karty.map((k) => k.numer_karty.trim().toUpperCase())
    if (new Set(numery).size !== numery.length) return 'Dwie karty w tym zleceniu mają ten sam numer.'
    return null
  }

  async function zapiszWBazie(): Promise<string | null> {
    const problem = bledyZapisu()
    if (problem) { setBlad(problem); return null }
    const p = {
      id: nowe ? null : idZrodla,
      ...naglowek,
      uslugi: uslugi.map((u, i) => ({ ...u, kolejnosc: i })),
      materialy: bezPustychMaterialow(materialy).map((m, i) => ({ ...m, kolejnosc: i })),
      karty,
      braki: braki.filter((b) => b.ilosc_rbg > 0),
    }
    const { data, error } = await supabase.rpc('zapisz_zlecenie', {
      p, p_oczekiwana_wersja: nowe ? null : meta?.zmodyfikowano ?? null,
    })
    if (error) { setBlad(komunikatPL(error.message)); return null }
    return data as string
  }

  async function zapisz() {
    setBlad(null); setKomunikat(null); setZajety(true)
    const id = await zapiszWBazie()
    setZajety(false)
    if (!id) return
    if (nowe) { otworzInne(id); return }
    await wczytaj(id)
    setKomunikat('Zapisano.')
  }

  async function zloz() {
    setBlad(null); setKomunikat(null)
    const problem = bledyZapisu() ?? bledyZlozenia()
    if (problem) { setBlad(problem); return }
    setZajety(true)
    const id = await zapiszWBazie()
    if (!id) { setZajety(false); return }
    const { error } = await supabase.from('zlecenia').update({ status: 'zlozony' }).eq('id', id)
    setZajety(false)
    if (error) {
      setBlad(komunikatPL(error.message))
      if (nowe) otworzInne(id)
      else await wczytaj(id)
      return
    }
    if (nowe) { otworzInne(id); return }
    await wczytaj(id)
    setKomunikat('Zlecenie złożone do rozliczenia. Dział handlowy je zobaczy.')
  }

  async function zwroc() {
    if (!idZrodla) return
    setZajety(true)
    const { error } = await supabase.rpc('zwroc_zlecenie', { p_id: idZrodla, p_komentarz: zwrot.tekst })
    setZajety(false)
    if (error) { setBlad(komunikatPL(error.message)); return }
    setZwrot({ otwarty: false, tekst: '' })
    await wczytaj(idZrodla)
    setKomunikat('Zlecenie zwrócone kierownikowi do poprawki.')
  }

  async function cofnijEksport() {
    if (!idZrodla) return
    setZajety(true)
    const { error } = await supabase.rpc('cofnij_eksport', { p_id: idZrodla })
    setZajety(false)
    if (error) { setBlad(komunikatPL(error.message)); return }
    await wczytaj(idZrodla)
    setKomunikat('Eksport cofnięty - zlecenie znów ma status „złożone” i można je poprawić.')
  }

  async function usun() {
    if (!idZrodla) return
    setZajety(true)
    const { error, count } = await supabase.from('zlecenia').delete({ count: 'exact' }).eq('id', idZrodla)
    setZajety(false)
    setPotwierdzUsun(false)
    if (error || !count) { setBlad(error ? komunikatPL(error.message) : 'Tego zlecenia nie można usunąć.'); return }
    zamknij()
  }

  function wroc() {
    if (zmieniony && edycja && !window.confirm('Masz niezapisane zmiany. Wyjść bez zapisywania?')) return
    zamknij()
  }

  async function pokazHistorie() {
    if (!idZrodla) return
    const { data } = await supabase.from('audit_log').select('czas, user_email, tabela, akcja')
      .eq('zlecenie_id', idZrodla).order('czas', { ascending: false }).limit(200)
    setWpisyAudytu(data ?? [])
  }

  // Podgląd eksportu SAP z bieżącego stanu formularza.
  const podgladSap = useMemo(() => {
    const z: ZlecenieDoEksportu = {
      id: idZrodla ?? '', mpk: naglowek.mpk, nr_zamowienia: naglowek.nr_zamowienia, nazwa: naglowek.nazwa,
      pozycja_zamowienia: naglowek.pozycja_zamowienia ? Number(naglowek.pozycja_zamowienia) : null,
      pozycje_uslug: uslugi.filter((u) => u.ilosc > 0 && cennik.has(u.cennik_pozycja_id)).map((u, i) => ({
        ilosc: u.ilosc, cena: u.cena ?? cennik.get(u.cennik_pozycja_id)!.cena, doplata_proc: u.doplata_proc,
        kolejnosc: i, cennik_pozycje: cennik.get(u.cennik_pozycja_id)!,
      })),
      pozycje_materialowe: bezPustychMaterialow(materialy).map((m, i) => ({ ...m, kolejnosc: i })),
    }
    return wierszeSap(z, materialWgKategorii)
  }, [idZrodla, naglowek, uslugi, materialy, cennik, materialWgKategorii])

  if (ladowanie) return <p className="text-slate-500">Wczytywanie zlecenia...</p>

  const sz = szablon(naglowek.szablon)
  const mpkDoWyboru = handlowiec ? [...new Set([naglowek.mpk, ...['P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09']])] : profil.mpk

  return (
    <div className="space-y-4 pb-24">
      <datalist id="hist-zamowienia">{historia.zamowienia.map((z) => <option key={z.nr} value={z.nr}>{z.nazwa}</option>)}</datalist>
      <datalist id="hist-konta">{historia.konta.map((k) => <option key={k} value={k} />)}</datalist>
      <datalist id="hist-mechanicy">{historia.mechanicy.map((k) => <option key={k} value={k} />)}</datalist>

      <div className="bez-druku flex flex-wrap items-center gap-3">
        <Button onClick={wroc}><ArrowLeft className="h-4 w-4" /> Lista</Button>
        <h2 className="text-lg font-semibold">
          {nowe ? (kopia ? 'Nowe zlecenie (kopia)' : 'Nowe zlecenie') : naglowek.nazwa || 'Zlecenie'}
        </h2>
        {!nowe && (
          <span className={cn('rounded px-2 py-0.5 text-xs ring-1', KOLORY_STATUSU[status])}>{ETYKIETY_STATUSU[status]}</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {!nowe && <Button onClick={() => otworzInne(`kopia:${idZrodla}`)} title="Nowe zlecenie z tym samym nagłówkiem i pozycjami"><Copy className="h-4 w-4" /> Kopiuj jako nowe</Button>}
          {!nowe && <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Drukuj</Button>}
          {!nowe && ((handlowiec && status !== 'wyeksportowany') || (!handlowiec && status === 'roboczy')) && (
            <Button onClick={() => setPotwierdzUsun(true)}><Trash2 className="h-4 w-4" /> Usuń</Button>
          )}
        </div>
      </div>

      {meta?.komentarz_handlowca && status === 'zwrocony' && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-300">
          <strong>Do poprawki (dział handlowy):</strong> {meta.komentarz_handlowca}
        </div>
      )}
      {!edycja && (
        <div className="bez-druku rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700">
          {status === 'wyeksportowany'
            ? `Zlecenie wyeksportowane do SAP ${dataGodzinaPL(meta?.wyeksportowano)} - tylko do odczytu.`
            : `Zlecenie złożone do rozliczenia ${dataGodzinaPL(meta?.zlozono)} - edycja zablokowana. Jeśli trzeba coś zmienić, poproś dział handlowy o zwrot do poprawki.`}
        </div>
      )}

      {/* --- Nagłówek --- */}
      <section className="sekcja">
        <h3 className="mb-3 font-semibold">Dane zlecenia</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="etykieta">Nazwa (urządzenie / zakres) <span className="text-red-600">*</span></span>
            <input className="pole" disabled={!edycja} value={naglowek.nazwa} placeholder="np. POMPA 3X9K NR 422"
              onChange={(e) => ustawNaglowek({ nazwa: e.target.value })} />
          </label>
          <label className="block">
            <span className="etykieta">Rodzaj karty</span>
            <select className="pole" disabled={!edycja} value={naglowek.szablon} onChange={(e) => ustawNaglowek({ szablon: e.target.value })}>
              {Object.values(SZABLONY).map((s) => <option key={s.id} value={s.id}>{s.nazwa}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="etykieta">MPK <span className="text-red-600">*</span></span>
            <select className="pole" disabled={!edycja || mpkDoWyboru.length < 2} value={naglowek.mpk} onChange={(e) => ustawNaglowek({ mpk: e.target.value })}>
              {mpkDoWyboru.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="etykieta">Nr zamówienia SAP</span>
            <input className="pole font-mono" list="hist-zamowienia" disabled={!edycja} value={naglowek.nr_zamowienia}
              placeholder="4200..." onChange={(e) => ustawNaglowek({ nr_zamowienia: e.target.value.trim() })} />
          </label>
          <label className="block">
            <span className="etykieta">Pozycja zamówienia</span>
            <input className="pole" disabled={!edycja} value={naglowek.pozycja_zamowienia} placeholder="np. 10"
              inputMode="numeric" onChange={(e) => ustawNaglowek({ pozycja_zamowienia: e.target.value.trim() })} />
          </label>
          <label className="block">
            <span className="etykieta">Konto</span>
            <input className="pole" list="hist-konta" disabled={!edycja} value={naglowek.konto} placeholder="URR/1/2026/BZ"
              onChange={(e) => ustawNaglowek({ konto: e.target.value })} />
          </label>
          <label className="block">
            <span className="etykieta">Mechanik</span>
            <input className="pole" list="hist-mechanicy" disabled={!edycja} value={naglowek.mechanik}
              onChange={(e) => ustawNaglowek({ mechanik: e.target.value })} />
          </label>
          <label className="block">
            <span className="etykieta">Data przyjęcia</span>
            <input type="date" className="pole" disabled={!edycja} value={naglowek.data_przyjecia}
              onChange={(e) => ustawNaglowek({ data_przyjecia: e.target.value })} />
          </label>
          <label className="block">
            <span className="etykieta">Data zakończenia</span>
            <input type="date" className="pole" disabled={!edycja} value={naglowek.data_zakonczenia}
              onChange={(e) => ustawNaglowek({ data_zakonczenia: e.target.value })} />
          </label>
          {sz.polaZlecenia.map((p) => (
            <label key={p.klucz} className="block">
              <span className="etykieta">{p.etykieta}{p.jednostka ? ` [${p.jednostka}]` : ''}</span>
              <input className="pole" disabled={!edycja} value={String(naglowek.dane_szablonu[p.klucz] ?? '')}
                onChange={(e) => ustawNaglowek({ dane_szablonu: { ...naglowek.dane_szablonu, [p.klucz]: e.target.value } })} />
            </label>
          ))}
          <label className="block sm:col-span-2">
            <span className="etykieta">Uwagi</span>
            <input className="pole" disabled={!edycja} value={naglowek.uwagi} onChange={(e) => ustawNaglowek({ uwagi: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="sekcja">
        <h3 className="mb-3 font-semibold">Robocizna wg cennika <span className="font-normal text-slate-500">(pozycje z umowy: remont pompy, silnika, przegląd...)</span></h3>
        <PozycjeCennikowe uslugi={uslugi} ustaw={ustaw('uslugi')} szablonZlecenia={naglowek.szablon} edycja={edycja} />
      </section>

      <section className="sekcja">
        <h3 className="mb-3 font-semibold">Robocizna wg rbg <span className="font-normal text-slate-500">(godziny × stawka z cennika)</span></h3>
        <SiatkaRobocizny uslugi={uslugi} ustaw={ustaw('uslugi')} mpkZlecenia={naglowek.mpk} edycja={edycja} />
      </section>

      <section className="sekcja">
        <h3 className="mb-3 font-semibold">Materiały</h3>
        <TabelaMaterialow materialy={materialy} ustaw={ustaw('materialy')} podpowiedzi={historia.materialy} edycja={edycja} />
      </section>

      <section className="sekcja">
        <h3 className="mb-3 font-semibold">Karty remontowe</h3>
        <KartyRemontowe karty={karty} ustaw={ustaw('karty')} wymagane={wymaganeKarty} szablonZlecenia={naglowek.szablon}
          nazwaZlecenia={naglowek.nazwa} mechanik={naglowek.mechanik} numerKarty={numerKarty} edycja={edycja} />
      </section>

      <section className="sekcja">
        <h3 className="mb-1 font-semibold">Braki godzin</h3>
        <p className="mb-3 text-xs text-slate-500">Gdy zleceniodawca założył za mało godzin w zamówieniu - dział handlowy pilnuje ich uzupełnienia.</p>
        {braki.length > 0 && (
          <table className="mb-2 w-full border-collapse">
            <thead>
              <tr>
                <th className="komorka-naglowek">Stanowisko</th>
                <th className="komorka-naglowek w-24 text-right">Rbg</th>
                <th className="komorka-naglowek">Opis</th>
                <th className="komorka-naglowek w-48">Status</th>
                <th className="komorka-naglowek w-10" />
              </tr>
            </thead>
            <tbody>
              {braki.map((b) => {
                const edytowalny = edycja && b.status === 'zgloszony'
                const zmien = (z: Partial<BrakGodzin>) => ustaw('braki')(braki.map((x) => (x === b ? { ...x, ...z } : x)))
                return (
                  <tr key={b.klucz}>
                    <td className="komorka p-0">
                      <select className="pole-komorki" disabled={!edytowalny} value={b.cennik_pozycja_id ?? ''}
                        onChange={(e) => zmien({ cennik_pozycja_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">(nie dotyczy stanowiska)</option>
                        {stawki.map((s) => <option key={s.cennik_pozycja_id} value={s.cennik_pozycja_id}>{s.stanowisko} {s.pora !== 'stala' ? `(${s.pora})` : ''}</option>)}
                      </select>
                    </td>
                    <td className="komorka p-0"><PoleLiczby wartosc={b.ilosc_rbg} disabled={!edytowalny} zmien={(n) => zmien({ ilosc_rbg: n })} aria-label="Rbg braku" /></td>
                    <td className="komorka p-0"><input className="pole-komorki" disabled={!edytowalny} value={b.opis ?? ''} onChange={(e) => zmien({ opis: e.target.value })} /></td>
                    <td className="komorka text-sm">{ETYKIETY_BRAKU[b.status]}</td>
                    <td className="komorka text-center">
                      {edytowalny && (
                        <button aria-label="Usuń brak" onClick={() => ustaw('braki')(braki.filter((x) => x !== b))} className="text-slate-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {edycja && (
          <button className="text-sm text-blekit-ciemny hover:underline"
            onClick={() => ustaw('braki')([...braki, { klucz: nowyKlucz(), cennik_pozycja_id: null, ilosc_rbg: 0, status: 'zgloszony', opis: null }])}>
            + Zgłoś brak godzin
          </button>
        )}
      </section>

      <details className="sekcja bez-druku">
        <summary className="cursor-pointer font-semibold">Podgląd eksportu do SAP ({podgladSap.length} linii)</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr>{KOLUMNY_SAP.map((k) => <th key={k} className="komorka-naglowek">{k}</th>)}</tr></thead>
            <tbody>
              {podgladSap.map((w, i) => (
                <tr key={i}>{w.map((c, j) => <td key={j} className={cn('komorka', typeof c === 'number' && 'liczba')}>{typeof c === 'number' && j >= 6 ? zl(c) : c ?? ''}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-2" onClick={() => void navigator.clipboard.writeText(tekstDoSchowka(podgladSap)).then(() => setKomunikat('Skopiowano wiersze SAP do schowka.'))}>
            <ClipboardCopy className="h-4 w-4" /> Kopiuj do schowka (Ctrl+V w SAP)
          </Button>
        </div>
      </details>

      {!nowe && (
        <details className="sekcja bez-druku" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !wpisyAudytu) void pokazHistorie() }}>
          <summary className="cursor-pointer font-semibold">Historia zmian</summary>
          <ul className="mt-2 max-h-64 overflow-y-auto text-xs text-slate-600">
            {(wpisyAudytu ?? []).map((w, i) => (
              <li key={i}>{dataGodzinaPL(w.czas)} · {w.user_email ?? 'system'} · {w.akcja} · {w.tabela}</li>
            ))}
          </ul>
        </details>
      )}

      {/* --- Pasek dolny: sumy i akcje --- */}
      <div className="bez-druku fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <span>Robocizna: <strong className="tabular-nums">{zl(sumy.robocizna)}</strong></span>
          <span>Cennik: <strong className="tabular-nums">{zl(sumy.cennik)}</strong></span>
          <span>Materiały: <strong className="tabular-nums">{zl(sumy.materialy)}</strong></span>
          <span className="text-base">Razem: <strong className="tabular-nums">{zl(sumy.razem)} zł</strong></span>
          {blad && <span className="rounded bg-red-50 px-2 py-1 text-red-700">{blad}</span>}
          {komunikat && !blad && <span className="rounded bg-limonka-jasna px-2 py-1 text-limonka-ciemna">{komunikat}</span>}
          <div className="ml-auto flex gap-2">
            {handlowiec && status === 'zlozony' && !nowe && (
              <Button wariant="ostrzezenie" disabled={zajety || zmieniony} onClick={() => setZwrot({ otwarty: true, tekst: '' })}>
                <Undo2 className="h-4 w-4" /> Zwróć do poprawki
              </Button>
            )}
            {handlowiec && status === 'wyeksportowany' && (
              <Button disabled={zajety} onClick={() => void cofnijEksport()}><Undo2 className="h-4 w-4" /> Cofnij eksport</Button>
            )}
            {edycja && (
              <Button wariant={zmieniony ? 'akcent' : 'zwykly'} disabled={zajety} onClick={() => void zapisz()}>
                <Save className="h-4 w-4" /> {zajety ? 'Zapisuję...' : 'Zapisz'}
              </Button>
            )}
            {edycja && (nowe || status === 'roboczy' || status === 'zwrocony') && (
              <Button wariant="glowny" disabled={zajety} onClick={() => void zloz()}>
                <Send className="h-4 w-4" /> Złóż do rozliczenia
              </Button>
            )}
          </div>
        </div>
      </div>

      <Dialog open={zwrot.otwarty} onOpenChange={(o) => setZwrot((z) => ({ ...z, otwarty: o }))}>
        <DialogContent>
          <DialogTitle>Zwrot do poprawki</DialogTitle>
          <DialogDescription>Kierownik zobaczy ten komentarz przy zleceniu i będzie mógł je poprawić i złożyć ponownie.</DialogDescription>
          <textarea className="pole mt-4" rows={3} autoFocus value={zwrot.tekst} placeholder="Co trzeba poprawić?"
            onChange={(e) => setZwrot((z) => ({ ...z, tekst: e.target.value }))} />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setZwrot({ otwarty: false, tekst: '' })}>Anuluj</Button>
            <Button wariant="ostrzezenie" disabled={zajety || !zwrot.tekst.trim()} onClick={() => void zwroc()}>Zwróć</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={potwierdzUsun} onOpenChange={setPotwierdzUsun}>
        <DialogContent>
          <DialogTitle>Usunąć zlecenie?</DialogTitle>
          <DialogDescription>„{naglowek.nazwa}” zostanie usunięte razem z pozycjami, materiałami i kartami. Tej operacji nie da się cofnąć.</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setPotwierdzUsun(false)}>Anuluj</Button>
            <Button wariant="ostrzezenie" disabled={zajety} onClick={() => void usun()}>Usuń</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
