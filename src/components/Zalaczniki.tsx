import { useRef, useState } from 'react'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { komunikatPL } from '@/lib/config'
import { dataPL } from '@/lib/format'
import type { TypZalacznika, Zalacznik } from '@/lib/types'

const MAKS_MB = 25
const DOZWOLONE = ['application/pdf', 'image/jpeg', 'image/png']

/** Nazwa pliku bezpieczna dla Storage (bez polskich znaków i spacji), ale czytelna. */
function bezpiecznaNazwa(n: string) {
  const mapa: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }
  return n.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => mapa[c]).replace(/[^a-z0-9._-]+/g, '_').slice(-80)
}

export async function otworzZalacznik(z: Zalacznik) {
  // Bucket jest prywatny - link ważny 5 minut, generowany na żądanie dla zalogowanego.
  const { data, error } = await supabase.storage.from('zalaczniki').createSignedUrl(z.sciezka, 300)
  if (error || !data) throw new Error(error?.message ?? 'Nie udało się otworzyć pliku.')
  window.open(data.signedUrl, '_blank', 'noopener')
}

interface Props {
  zlecenieId: string | null
  zalaczniki: Zalacznik[]
  typ: TypZalacznika
  uslugaObcaId?: number
  mozna: boolean
  /** Czy można usunąć / poprawić konkretny plik (domyślnie = mozna). */
  mozeUsunac?: (z: Zalacznik) => boolean
  /** Nowe, niezapisane zlecenie: zapisz je w tle przed wgraniem pliku, a potem otwórz zapisane. */
  zapiszNowe?: { zapisz: () => Promise<string | null>; otworz: (id: string) => void }
  odswiez: () => Promise<void> | void
  etykieta: string
  /** Pokaż wybór "ile kart jest w pliku" (dla skanów kart remontowych). */
  liczbaKart?: boolean
  kompaktowo?: boolean
}

/** Lista załączników + wgrywanie (PDF/JPG/PNG do 25 MB) do prywatnego magazynu plików. */
export function Zalaczniki({ zlecenieId: idZlecenia, zalaczniki, typ, uslugaObcaId, mozna, mozeUsunac, zapiszNowe, odswiez, etykieta, liczbaKart, kompaktowo }: Props) {
  const plik = useRef<HTMLInputElement>(null)
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  const usuwalny = (z: Zalacznik) => (mozeUsunac ? mozeUsunac(z) : mozna)

  async function wgraj(f: File) {
    setBlad(null)
    if (!DOZWOLONE.includes(f.type)) { setBlad('Dozwolone pliki: PDF, JPG, PNG.'); return }
    if (f.size > MAKS_MB * 1024 * 1024) { setBlad(`Plik jest za duży (max ${MAKS_MB} MB).`); return }
    setZajety(true)
    let zlecenieId = idZlecenia
    if (!zlecenieId && zapiszNowe) {
      zlecenieId = await zapiszNowe.zapisz()
      if (!zlecenieId) { setZajety(false); setBlad('Nie udało się zapisać zlecenia - popraw błąd pokazany u góry i spróbuj ponownie.'); return }
      // Zlecenie już jest w bazie - po wgraniu (udanym czy nie) trzeba otworzyć zapisaną wersję,
      // inaczej kolejne „Zapisz” utworzyłoby drugie, zdublowane zlecenie.
      const problem = await wyslij(zlecenieId, f)
      setZajety(false)
      if (problem) window.alert(`Zlecenie zapisano jako robocze, ale pliku nie udało się wgrać: ${problem}`)
      zapiszNowe.otworz(zlecenieId)
      return
    }
    if (!zlecenieId) { setZajety(false); setBlad('Najpierw zapisz zlecenie.'); return }
    const problem = await wyslij(zlecenieId, f)
    setZajety(false)
    if (problem) setBlad(problem)
    await odswiez()
  }

  /** Wgrywa plik do magazynu i zapisuje wpis w tabeli. Zwraca opis błędu albo null. */
  async function wyslij(zlecenieId: string, f: File): Promise<string | null> {
    const sciezka = `${zlecenieId}/${crypto.randomUUID()}-${bezpiecznaNazwa(f.name)}`
    const { error: e1 } = await supabase.storage.from('zalaczniki').upload(sciezka, f, { contentType: f.type })
    if (e1) return komunikatPL(e1.message)
    const { error: e2 } = await supabase.from('zalaczniki').insert({
      zlecenie_id: zlecenieId, typ, usluga_obca_id: uslugaObcaId ?? null, nazwa_pliku: f.name, sciezka, rozmiar: f.size, mime: f.type,
    })
    if (e2) {
      // Bez wpisu w tabeli plik byłby niewidoczny - sprzątamy, żeby nie zostawiać sierot.
      await supabase.storage.from('zalaczniki').remove([sciezka])
      return komunikatPL(e2.message)
    }
    return null
  }

  async function usun(z: Zalacznik) {
    if (!window.confirm(`Usunąć plik „${z.nazwa_pliku}”?`)) return
    setBlad(null)
    const { error } = await supabase.from('zalaczniki').delete().eq('id', z.id)
    if (error) { setBlad(komunikatPL(error.message)); return }
    await supabase.storage.from('zalaczniki').remove([z.sciezka])
    await odswiez()
  }

  async function ustawLiczbeKart(z: Zalacznik, n: number) {
    const { error } = await supabase.from('zalaczniki').update({ liczba_kart: n }).eq('id', z.id)
    if (error) setBlad(komunikatPL(error.message))
    await odswiez()
  }

  async function otworz(z: Zalacznik) {
    try { await otworzZalacznik(z) } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className={kompaktowo ? 'space-y-1' : 'space-y-2'}>
      {zalaczniki.map((z) => (
        <div key={z.id} className="flex flex-wrap items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-slate-500" />
          <button className="max-w-xs truncate text-blekit-ciemny underline" onClick={() => void otworz(z)} title="Otwórz plik">{z.nazwa_pliku}</button>
          {!kompaktowo && <span className="text-xs text-slate-400">{dataPL(z.utworzono)}</span>}
          {liczbaKart && (
            <label className="flex items-center gap-1 text-xs text-slate-600">
              kart w pliku:
              <select className="rounded border border-slate-300 px-1 py-0.5" disabled={!usuwalny(z)} value={z.liczba_kart}
                onChange={(e) => void ustawLiczbeKart(z, Number(e.target.value))}>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          {usuwalny(z) && (
            <button className="text-slate-400 hover:text-red-600" aria-label="Usuń plik" onClick={() => void usun(z)}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {mozna && (
        <>
          <input ref={plik} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void wgraj(f) }} />
          <button disabled={zajety || (!idZlecenia && !zapiszNowe)} onClick={() => plik.current?.click()}
            title={idZlecenia || zapiszNowe ? undefined : 'Najpierw zapisz zlecenie'}
            className="inline-flex items-center gap-1 text-sm text-blekit-ciemny hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
            <Paperclip className="h-4 w-4" /> {zajety ? 'Wgrywam…' : etykieta}
          </button>
          {!idZlecenia && !kompaktowo && (
            <span className="ml-2 text-xs text-slate-500">
              {zapiszNowe ? '(zlecenie zapisze się automatycznie jako robocze)' : '(dostępne po pierwszym zapisaniu zlecenia)'}
            </span>
          )}
        </>
      )}
      {blad && <p className="text-xs text-red-700">{blad}</p>}
    </div>
  )
}
