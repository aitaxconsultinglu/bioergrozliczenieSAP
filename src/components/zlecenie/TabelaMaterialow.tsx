import { Plus, Trash2 } from 'lucide-react'
import { zl } from '@/lib/format'
import { cenaJednMaterialu, nowyKlucz, wartoscMaterialu } from '@/lib/obliczenia'
import type { PozycjaMaterialowa } from '@/lib/types'
import { PoleLiczby } from '../PoleLiczby'

interface Props {
  materialy: PozycjaMaterialowa[]
  ustaw: (m: PozycjaMaterialowa[]) => void
  podpowiedzi: string[]
  edycja: boolean
}

const nowyWiersz = (): PozycjaMaterialowa => ({
  klucz: nowyKlucz(), nazwa: '', ilosc: 1, jm: 'szt.', wartosc_zakupu: 0,
  dostawca: 'bioerg', narzut_proc: 15, numer_faktury: null,
})

/**
 * Materiały jak w dotychczasowej karcie: wpisuje się ŁĄCZNĄ wartość z faktury i ilość,
 * a cena jednostkowa z narzutem liczy się sama. Enter w ostatniej komórce dodaje wiersz.
 */
export function TabelaMaterialow({ materialy, ustaw, podpowiedzi, edycja }: Props) {
  const zmien = (m: PozycjaMaterialowa, zmiana: Partial<PozycjaMaterialowa>) =>
    ustaw(materialy.map((x) => (x === m ? { ...x, ...zmiana } : x)))

  const dodajPrzyEnter = (i: number): React.KeyboardEventHandler => (e) => {
    if (e.key === 'Enter' && i === materialy.length - 1) {
      e.preventDefault()
      ustaw([...materialy, nowyWiersz()])
    }
  }

  const sumaZakupu = materialy.filter((m) => m.dostawca === 'bioerg').reduce((s, m) => s + m.wartosc_zakupu, 0)
  const sumaNarzut = materialy.filter((m) => m.dostawca === 'bioerg').reduce((s, m) => s + wartoscMaterialu(m), 0)

  return (
    <div className="space-y-2">
      <datalist id="podpowiedzi-materialow">
        {podpowiedzi.map((p) => <option key={p} value={p} />)}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Nazwa materiału</th>
              <th className="komorka-naglowek w-20 text-right">Ilość</th>
              <th className="komorka-naglowek w-16">JM</th>
              <th className="komorka-naglowek w-28 text-right">Wartość zakupu [zł]</th>
              <th className="komorka-naglowek w-28">Dostarczył</th>
              <th className="komorka-naglowek w-20 text-right">Narzut %</th>
              <th className="komorka-naglowek w-28 text-right">Cena jedn. + narzut</th>
              <th className="komorka-naglowek w-28 text-right">Wartość + narzut</th>
              <th className="komorka-naglowek w-28">Nr faktury</th>
              <th className="komorka-naglowek w-10" />
            </tr>
          </thead>
          <tbody>
            {materialy.map((m, i) => {
              const synthos = m.dostawca === 'synthos'
              return (
                <tr key={m.klucz} className={synthos ? 'bg-slate-50 text-slate-500' : undefined}>
                  <td className="komorka p-0">
                    <input className="pole-komorki" list="podpowiedzi-materialow" disabled={!edycja} value={m.nazwa}
                      aria-label="Nazwa materiału" autoFocus={edycja && !m.id && i === materialy.length - 1 && m.nazwa === '' && i > 0}
                      onChange={(e) => zmien(m, { nazwa: e.target.value })} placeholder="np. SIMMERING 35X55X10" />
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={m.ilosc} disabled={!edycja} aria-label="Ilość" zmien={(n) => zmien(m, { ilosc: n })} />
                  </td>
                  <td className="komorka p-0">
                    <input className="pole-komorki" disabled={!edycja} value={m.jm} aria-label="Jednostka"
                      onChange={(e) => zmien(m, { jm: e.target.value })} />
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={m.wartosc_zakupu} disabled={!edycja} aria-label="Wartość zakupu"
                      zmien={(n) => zmien(m, { wartosc_zakupu: n })} />
                  </td>
                  <td className="komorka p-0">
                    <select className="pole-komorki" disabled={!edycja} value={m.dostawca} aria-label="Dostarczył"
                      onChange={(e) => {
                        const d = e.target.value as PozycjaMaterialowa['dostawca']
                        zmien(m, { dostawca: d, narzut_proc: d === 'synthos' ? 0 : 15 })
                      }}>
                      <option value="bioerg">Bioerg</option>
                      <option value="synthos">Synthos</option>
                    </select>
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={m.narzut_proc} disabled={!edycja || synthos} aria-label="Narzut"
                      zmien={(n) => zmien(m, { narzut_proc: n })} />
                  </td>
                  <td className="komorka liczba">{synthos ? '-' : zl(cenaJednMaterialu(m))}</td>
                  <td className="komorka liczba font-medium">{synthos ? '-' : zl(wartoscMaterialu(m))}</td>
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
              <tr><td colSpan={10} className="komorka py-4 text-center text-sm text-slate-500">Brak materiałów.</td></tr>
            )}
          </tbody>
          {materialy.length > 0 && (
            <tfoot>
              <tr className="font-medium">
                <td className="komorka text-right" colSpan={3}>Razem (materiał Bioerg)</td>
                <td className="komorka liczba">{zl(sumaZakupu)}</td>
                <td className="komorka" colSpan={3} />
                <td className="komorka liczba">{zl(sumaNarzut)}</td>
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
        Materiał dostarczony przez Synthos jest ewidencjonowany (np. na karcie remontowej), ale bez narzutu i bez wartości w eksporcie do SAP.
      </p>
    </div>
  )
}
