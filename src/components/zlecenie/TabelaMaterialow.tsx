import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { History, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { dataPL, zl } from '@/lib/format'
import { cenaJednMaterialu, czySynthos, grosze, nowyKlucz, wartoscMaterialu } from '@/lib/obliczenia'
import type { PozycjaMaterialowa } from '@/lib/types'
import { PoleLiczby } from '../PoleLiczby'
import { PoleWyboru } from '../PoleWyboru'

const DOSTAWCY = [
  { wartosc: 'bioerg', etykieta: 'Bioerg' },
  { wartosc: 'synthos', etykieta: 'Synthos' },
]

interface Props {
  materialy: PozycjaMaterialowa[]
  ustaw: (m: PozycjaMaterialowa[]) => void
  edycja: boolean
}

interface Zakup {
  nazwa: string
  jm: string
  cena_jedn: number
  ilosc: number
  numer_faktury: string | null
  dostawca: string
  data: string
}

/**
 * Materiały: nazwa (z podpowiedzią 5 ostatnich zakupów - cena i nr faktury), ilość,
 * cena zakupu za jednostkę ALBO łączna wartość z faktury (jedno liczy się z drugiego),
 * narzut domyślny z ustawień (obecnie 12%). Enter w ostatniej komórce dodaje wiersz.
 */
export function TabelaMaterialow({ materialy, ustaw, edycja }: Props) {
  const { narzutDomyslny } = useSlowniki()

  const nowyWiersz = (): PozycjaMaterialowa => ({
    klucz: nowyKlucz(), nazwa: '', ilosc: 1, jm: 'szt.', wartosc_zakupu: 0,
    dostawca: 'bioerg', narzut_proc: narzutDomyslny, numer_faktury: null,
  })

  const zmien = (m: PozycjaMaterialowa, zmiana: Partial<PozycjaMaterialowa>) =>
    ustaw(materialy.map((x) => (x === m ? { ...x, ...zmiana } : x)))

  // Zmiana ilości zachowuje cenę jednostkową (jak na fakturze): wartość = cena × nowa ilość.
  const zmienIlosc = (m: PozycjaMaterialowa, n: number) => {
    const cena = m.ilosc > 0 ? m.wartosc_zakupu / m.ilosc : 0
    zmien(m, { ilosc: n, wartosc_zakupu: cena > 0 ? grosze(cena * n) : m.wartosc_zakupu })
  }

  const dodajPrzyEnter = (i: number): React.KeyboardEventHandler => (e) => {
    if (e.key === 'Enter' && i === materialy.length - 1) {
      e.preventDefault()
      ustaw([...materialy, nowyWiersz()])
    }
  }

  const doRozliczenia = materialy.filter((m) => !czySynthos(m.dostawca))
  const sumaZakupu = grosze(doRozliczenia.reduce((s, m) => s + m.wartosc_zakupu, 0))
  const sumaRazem = grosze(doRozliczenia.reduce((s, m) => s + wartoscMaterialu(m), 0))

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Nazwa materiału</th>
              <th className="komorka-naglowek w-20 text-right">Ilość</th>
              <th className="komorka-naglowek w-14">JM</th>
              <th className="komorka-naglowek w-24 text-right">Cena zakupu / jedn.</th>
              <th className="komorka-naglowek w-28 text-right">Wartość zakupu [zł]</th>
              <th className="komorka-naglowek w-36">Dostarczył</th>
              <th className="komorka-naglowek w-16 text-right">Narzut %</th>
              <th className="komorka-naglowek w-24 text-right">Narzut [zł]</th>
              <th className="komorka-naglowek w-28 text-right">Wartość z narzutem</th>
              <th className="komorka-naglowek w-28">Nr faktury</th>
              <th className="komorka-naglowek w-10" />
            </tr>
          </thead>
          <tbody>
            {materialy.map((m, i) => {
              const synthos = czySynthos(m.dostawca)
              const zNarzutem = wartoscMaterialu(m)
              return (
                <tr key={m.klucz} className={synthos ? 'bg-slate-50 text-slate-500' : undefined}>
                  <td className="komorka p-0">
                    <KomorkaNazwy
                      wartosc={m.nazwa}
                      disabled={!edycja}
                      autoFocus={edycja && !m.id && i === materialy.length - 1 && m.nazwa === '' && i > 0}
                      zmien={(nazwa) => zmien(m, { nazwa })}
                      wybierz={(z) => zmien(m, {
                        nazwa: z.nazwa,
                        jm: z.jm || m.jm,
                        wartosc_zakupu: grosze(z.cena_jedn * (m.ilosc || 1)),
                        ilosc: m.ilosc || 1,
                        numer_faktury: z.numer_faktury,
                      })}
                    />
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={m.ilosc} disabled={!edycja} aria-label="Ilość" zmien={(n) => zmienIlosc(m, n)} />
                  </td>
                  <td className="komorka p-0">
                    <input className="pole-komorki" disabled={!edycja} value={m.jm} aria-label="Jednostka"
                      onChange={(e) => zmien(m, { jm: e.target.value })} />
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={m.ilosc > 0 ? grosze(m.wartosc_zakupu / m.ilosc) : 0} disabled={!edycja} aria-label="Cena zakupu za jednostkę"
                      zmien={(c) => zmien(m, { wartosc_zakupu: grosze(c * (m.ilosc || 1)) })} />
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={m.wartosc_zakupu} disabled={!edycja} aria-label="Wartość zakupu"
                      zmien={(n) => zmien(m, { wartosc_zakupu: n })} />
                  </td>
                  <td className="komorka p-0">
                    <PoleWyboru wKomorce disabled={!edycja} aria-label="Dostarczył" opcje={DOSTAWCY} wartosc={m.dostawca}
                      placeholderInne="kto dostarczył?"
                      zmien={(d) => zmien(m, {
                        dostawca: d,
                        // Synthos zawsze bez narzutu; po zmianie z Synthosa na innego wraca narzut domyślny.
                        narzut_proc: czySynthos(d) ? 0 : czySynthos(m.dostawca) ? narzutDomyslny : m.narzut_proc,
                      })} />
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={m.narzut_proc} disabled={!edycja || synthos} aria-label="Narzut"
                      zmien={(n) => zmien(m, { narzut_proc: n })} />
                  </td>
                  <td className="komorka liczba">{synthos ? '-' : zl(grosze(zNarzutem - m.wartosc_zakupu))}</td>
                  <td className="komorka liczba font-medium">
                    {synthos ? '-' : zl(zNarzutem)}
                    {!synthos && m.ilosc > 0 && <span className="block text-[10px] font-normal text-slate-400">{zl(cenaJednMaterialu(m))} / {m.jm}</span>}
                  </td>
                  <td className="komorka p-0">
                    <input className="pole-komorki" disabled={!edycja} value={m.numer_faktury ?? ''} aria-label="Nr faktury"
                      onKeyDown={dodajPrzyEnter(i)}
                      onChange={(e) => zmien(m, { numer_faktury: e.target.value || null })} />
                  </td>
                  <td className="komorka text-center">
                    {edycja && (
                      <button aria-label="Usuń materiał" onClick={() => ustaw(materialy.filter((x) => x !== m))} className="text-slate-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {materialy.length === 0 && (
              <tr><td colSpan={11} className="komorka py-4 text-center text-sm text-slate-500">Brak materiałów.</td></tr>
            )}
          </tbody>
          {materialy.length > 0 && (
            <tfoot>
              <tr className="font-medium">
                <td className="komorka text-right" colSpan={4}>Razem (bez materiału Synthos)</td>
                <td className="komorka liczba">{zl(sumaZakupu)}</td>
                <td className="komorka" colSpan={2} />
                <td className="komorka liczba">{zl(grosze(sumaRazem - sumaZakupu))}</td>
                <td className="komorka liczba">{zl(sumaRazem)}</td>
                <td className="komorka" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {edycja && (
        <button className="inline-flex items-center gap-1 text-sm text-blekit-ciemny hover:underline" onClick={() => ustaw([...materialy, nowyWiersz()])}>
          <Plus className="h-4 w-4" /> Dodaj materiał
        </button>
      )}
      <p className="text-xs text-slate-500">
        Narzut domyślny: <strong>{narzutDomyslny}%</strong> (zmienia go dział handlowy w zakładce Cennik). Wpisz cenę za jednostkę albo łączną wartość z faktury - drugie pole policzy się samo.
        Podczas wpisywania nazwy aplikacja podpowiada 5 ostatnich zakupów tego materiału z ceną i numerem faktury.
        Materiał od Synthosu: bez narzutu i bez wartości w eksporcie do SAP.
      </p>
    </div>
  )
}

/** Pole nazwy z podpowiedzią ostatnich zakupów (lista rysowana nad tabelą, żeby jej nie przycinał scroll). */
function KomorkaNazwy({ wartosc, zmien, wybierz, disabled, autoFocus }: {
  wartosc: string
  zmien: (n: string) => void
  wybierz: (z: Zakup) => void
  disabled: boolean
  autoFocus: boolean
}) {
  const pole = useRef<HTMLInputElement>(null)
  const [otwarte, setOtwarte] = useState(false)
  const [wyniki, setWyniki] = useState<Zakup[]>([])
  const [poz, setPoz] = useState<{ left: number; top: number; width: number } | null>(null)

  useEffect(() => {
    if (!otwarte || wartosc.trim().length < 2) { setWyniki([]); return }
    let anulowane = false
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('historia_zakupow', { p_fraza: wartosc.trim() })
      if (!anulowane) setWyniki(((data ?? []) as Zakup[]).map((z) => ({ ...z, cena_jedn: Number(z.cena_jedn), ilosc: Number(z.ilosc) })))
    }, 250)
    return () => { anulowane = true; clearTimeout(t) }
  }, [wartosc, otwarte])

  useEffect(() => {
    if (!otwarte || !pole.current) return
    const ustawPoz = () => {
      const r = pole.current!.getBoundingClientRect()
      setPoz({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 520) })
    }
    ustawPoz()
    window.addEventListener('scroll', ustawPoz, true)
    window.addEventListener('resize', ustawPoz)
    return () => { window.removeEventListener('scroll', ustawPoz, true); window.removeEventListener('resize', ustawPoz) }
  }, [otwarte])

  const grupy = new Map<string, Zakup[]>()
  for (const z of wyniki) {
    const k = z.nazwa.trim().toUpperCase()
    if (!grupy.has(k)) grupy.set(k, [])
    grupy.get(k)!.push(z)
  }

  return (
    <>
      <input
        ref={pole}
        className="pole-komorki"
        disabled={disabled}
        value={wartosc}
        autoFocus={autoFocus}
        aria-label="Nazwa materiału"
        placeholder="np. ŁOŻYSKO 6308"
        onFocus={() => setOtwarte(true)}
        onBlur={() => setTimeout(() => setOtwarte(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOtwarte(false) }}
        onChange={(e) => { zmien(e.target.value); setOtwarte(true) }}
      />
      {otwarte && poz && wyniki.length > 0 && createPortal(
        <div
          className="fixed z-50 max-h-80 overflow-y-auto rounded-md border border-slate-300 bg-white text-sm shadow-lg"
          style={{ left: poz.left, top: poz.top, width: poz.width, maxWidth: 'calc(100vw - 16px)' }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="flex items-center gap-1 border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
            <History className="h-3.5 w-3.5" /> Ostatnie zakupy - kliknij cenę, żeby ją wstawić
          </p>
          {[...grupy.values()].map((zakupy) => (
            <div key={zakupy[0].nazwa} className="border-b border-slate-100 px-3 py-1.5 last:border-0">
              <p className="font-medium">{zakupy[0].nazwa}</p>
              {zakupy.map((z, i) => (
                <button key={i} type="button" onClick={() => { wybierz(z); setOtwarte(false) }}
                  className="flex w-full items-center gap-3 rounded px-1 py-0.5 text-left hover:bg-limonka-jasna">
                  <span className="w-20 text-xs text-slate-500">{dataPL(z.data)}</span>
                  <span className="flex-1 truncate text-xs text-slate-600">{z.numer_faktury ? `FV ${z.numer_faktury}` : 'bez nr faktury'}</span>
                  <span className="text-xs text-slate-400">{z.ilosc.toLocaleString('pl-PL')} {z.jm}</span>
                  <span className="w-28 text-right font-medium tabular-nums">{zl(z.cena_jedn)} zł/{z.jm}</span>
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
