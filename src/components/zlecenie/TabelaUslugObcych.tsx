import { Plus, Trash2 } from 'lucide-react'
import { useSlowniki } from '@/lib/slowniki'
import { zl } from '@/lib/format'
import { grosze, nowyKlucz, wartoscUslugiObcej } from '@/lib/obliczenia'
import type { UslugaObca, Zalacznik } from '@/lib/types'
import { PoleLiczby } from '../PoleLiczby'
import { Zalaczniki } from '../Zalaczniki'

interface Props {
  uslugi: UslugaObca[]
  ustaw: (u: UslugaObca[]) => void
  edycja: boolean
  zlecenieId: string | null
  zalaczniki: Zalacznik[]
  mozeDodacZalacznik: boolean
  odswiezZalaczniki: () => Promise<void>
}

/**
 * Usługi obce (praca zlecona firmie zewnętrznej) - refakturowane z narzutem (domyślnie 10%).
 * Do SAP obowiązkowo idzie skan faktury, więc przy każdej zapisanej usłudze można go wgrać.
 */
export function TabelaUslugObcych({ uslugi, ustaw, edycja, zlecenieId, zalaczniki, mozeDodacZalacznik, odswiezZalaczniki }: Props) {
  const { narzutUslugObcych } = useSlowniki()
  const zmien = (u: UslugaObca, z: Partial<UslugaObca>) => ustaw(uslugi.map((x) => (x === u ? { ...x, ...z } : x)))
  const dodaj = () => ustaw([...uslugi, {
    klucz: nowyKlucz(), opis: '', wykonawca: null, numer_faktury: null, wartosc_zakupu: 0, narzut_proc: narzutUslugObcych, nr_linii_sap: null,
  }])
  const sumaZakupu = grosze(uslugi.reduce((s, u) => s + u.wartosc_zakupu, 0))
  const sumaRazem = grosze(uslugi.reduce((s, u) => s + wartoscUslugiObcej(u), 0))

  return (
    <div className="space-y-2">
      {uslugi.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="komorka-naglowek w-16" title="Numer linii zamówienia SAP (puste = nr linii usług z nagłówka)">Nr linii</th>
                <th className="komorka-naglowek">Opis usługi</th>
                <th className="komorka-naglowek w-40">Wykonawca</th>
                <th className="komorka-naglowek w-32">Nr faktury</th>
                <th className="komorka-naglowek w-28 text-right">Wartość z faktury [zł]</th>
                <th className="komorka-naglowek w-16 text-right">Narzut %</th>
                <th className="komorka-naglowek w-28 text-right">Wartość z narzutem</th>
                <th className="komorka-naglowek w-56">Skan faktury</th>
                <th className="komorka-naglowek w-10" />
              </tr>
            </thead>
            <tbody>
              {uslugi.map((u) => {
                const skany = u.id ? zalaczniki.filter((z) => z.typ === 'faktura_uslugi_obcej' && z.usluga_obca_id === u.id) : []
                return (
                  <tr key={u.klucz} className={u.id && skany.length === 0 ? 'bg-amber-50/50' : undefined}>
                    <td className="komorka p-0">
                      <input className="pole-komorki liczba" inputMode="numeric" disabled={!edycja} value={u.nr_linii_sap ?? ''} placeholder="-"
                        aria-label="Nr linii zamówienia SAP"
                        onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); zmien(u, { nr_linii_sap: v ? Number(v) : null }) }} />
                    </td>
                    <td className="komorka p-0">
                      <input className="pole-komorki" disabled={!edycja} value={u.opis} placeholder="np. Wyważanie wirnika, regeneracja wału"
                        aria-label="Opis usługi" onChange={(e) => zmien(u, { opis: e.target.value })} />
                    </td>
                    <td className="komorka p-0">
                      <input className="pole-komorki" disabled={!edycja} value={u.wykonawca ?? ''} aria-label="Wykonawca"
                        onChange={(e) => zmien(u, { wykonawca: e.target.value || null })} />
                    </td>
                    <td className="komorka p-0">
                      <input className="pole-komorki" disabled={!edycja} value={u.numer_faktury ?? ''} aria-label="Nr faktury"
                        onChange={(e) => zmien(u, { numer_faktury: e.target.value || null })} />
                    </td>
                    <td className="komorka p-0">
                      <PoleLiczby wartosc={u.wartosc_zakupu} disabled={!edycja} aria-label="Wartość z faktury" zmien={(n) => zmien(u, { wartosc_zakupu: n })} />
                    </td>
                    <td className="komorka p-0">
                      <PoleLiczby wartosc={u.narzut_proc} disabled={!edycja} aria-label="Narzut" zmien={(n) => zmien(u, { narzut_proc: n })} />
                    </td>
                    <td className="komorka liczba font-medium">{zl(wartoscUslugiObcej(u))}</td>
                    <td className="komorka">
                      {u.id ? (
                        <Zalaczniki kompaktowo zlecenieId={zlecenieId} zalaczniki={skany} typ="faktura_uslugi_obcej" uslugaObcaId={u.id}
                          mozna={mozeDodacZalacznik} odswiez={odswiezZalaczniki} etykieta="Wgraj skan faktury" />
                      ) : <span className="text-xs text-slate-500">zapisz zlecenie, aby wgrać skan</span>}
                    </td>
                    <td className="komorka text-center">
                      {edycja && (
                        <button aria-label="Usuń usługę" onClick={() => ustaw(uslugi.filter((x) => x !== u))} className="text-slate-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="komorka text-right" colSpan={4}>Razem</td>
                <td className="komorka liczba">{zl(sumaZakupu)}</td>
                <td className="komorka" />
                <td className="komorka liczba">{zl(sumaRazem)}</td>
                <td className="komorka" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {edycja && (
        <button className="inline-flex items-center gap-1 text-sm text-blekit-ciemny hover:underline" onClick={dodaj}>
          <Plus className="h-4 w-4" /> Dodaj usługę obcą
        </button>
      )}
      {!edycja && uslugi.length === 0 && <p className="text-sm text-slate-500">Brak usług obcych.</p>}
      <p className="text-xs text-slate-500">
        Narzut domyślny: <strong>{narzutUslugObcych}%</strong>. W SAP pozycja „Usługa obca + 10%” (indeks 5001720). Do każdej usługi wgraj skan faktury - w SAP jest obowiązkowy;
        wiersze bez skanu są podświetlone.
      </p>
    </div>
  )
}
