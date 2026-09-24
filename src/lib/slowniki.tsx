import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Kategoria, PozycjaCennika, Stawka } from './types'
import { INDEKS_MATERIALU, type MaterialWgKategorii } from './eksportSap'

interface Slowniki {
  kategorie: Map<number, Kategoria>
  cennik: Map<number, PozycjaCennika>
  pozycje: PozycjaCennika[]
  stawki: Stawka[]
  mpk: { kod: string; nazwa: string | null }[]
  materialWgKategorii: MaterialWgKategorii
  gotowe: boolean
  blad: string | null
  odswiez: () => Promise<void>
}

const Kontekst = createContext<Slowniki | null>(null)

// PostgREST oddaje maksymalnie 1000 wierszy na zapytanie - cennik ma ich więcej.
async function calyCennik(): Promise<PozycjaCennika[]> {
  const wynik: PozycjaCennika[] = []
  for (let od = 0; ; od += 1000) {
    const { data, error } = await supabase
      .from('cennik_pozycje')
      .select('*')
      .order('nr_pozycji')
      .order('numer_linii')
      .range(od, od + 999)
    if (error) throw error
    wynik.push(...(data as PozycjaCennika[]).map((p) => ({ ...p, cena: Number(p.cena) })))
    if (!data || data.length < 1000) return wynik
  }
}

export function DostawcaSlownikow({ children }: { children: ReactNode }) {
  const [pozycje, setPozycje] = useState<PozycjaCennika[]>([])
  const [kategorie, setKategorie] = useState<Kategoria[]>([])
  const [stawki, setStawki] = useState<Stawka[]>([])
  const [mpk, setMpk] = useState<{ kod: string; nazwa: string | null }[]>([])
  const [gotowe, setGotowe] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  const odswiez = useCallback(async () => {
    try {
      const [poz, kat, st, m] = await Promise.all([
        calyCennik(),
        supabase.from('cennik_kategorie').select('*').order('nr_pozycji'),
        supabase.from('stawki_robocizny').select('*').order('numer_linii'),
        supabase.from('mpk').select('kod, nazwa').eq('aktywne', true).order('kod'),
      ])
      if (kat.error) throw kat.error
      if (st.error) throw st.error
      if (m.error) throw m.error
      setPozycje(poz)
      setKategorie(kat.data as Kategoria[])
      setStawki((st.data as Stawka[]).map((s) => ({ ...s, cena: Number(s.cena) })))
      setMpk(m.data ?? [])
      setBlad(null)
      setGotowe(true)
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => { void odswiez() }, [odswiez])

  const wartosc = useMemo<Slowniki>(() => {
    const materialWgKategorii: MaterialWgKategorii = new Map()
    for (const p of pozycje) {
      if (p.indeks_sap === INDEKS_MATERIALU) materialWgKategorii.set(p.nr_pozycji, p)
    }
    return {
      kategorie: new Map(kategorie.map((k) => [k.nr_pozycji, k])),
      cennik: new Map(pozycje.map((p) => [p.id, p])),
      pozycje,
      stawki,
      mpk,
      materialWgKategorii,
      gotowe,
      blad,
      odswiez,
    }
  }, [pozycje, kategorie, stawki, mpk, gotowe, blad, odswiez])

  return <Kontekst.Provider value={wartosc}>{children}</Kontekst.Provider>
}

export function useSlowniki() {
  const s = useContext(Kontekst)
  if (!s) throw new Error('useSlowniki poza DostawcaSlownikow')
  return s
}
