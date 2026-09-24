import { useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSlowniki } from '@/lib/slowniki'
import { ETYKIETY_PORY, zl } from '@/lib/format'
import { nowyKlucz, wartoscUslugi } from '@/lib/obliczenia'
import type { Pora, PozycjaUslugi, Stawka } from '@/lib/types'
import { PoleLiczby } from '../PoleLiczby'

const PORY: Pora[] = ['7-15', '15-19', '19-7', 'wolne']

interface Props {
  uslugi: PozycjaUslugi[]
  ustaw: (u: PozycjaUslugi[]) => void
  mpkZlecenia: string
  edycja: boolean
}

/**
 * Robocizna jak w dotychczasowym Excelu: wiersz = stanowisko, kolumny = pory dnia.
 * Stawki i indeksy SAP pochodzą wyłącznie z cennika (widok stawki_robocizny) -
 * żadna komórka nie "zamraża" starej stawki, co było źródłem błędów w Excelu.
 * Godziny przepracowane przez inne MPK (kooperacja) są osobnymi wierszami poniżej.
 */
export function SiatkaRobocizny({ uslugi, ustaw, mpkZlecenia, edycja }: Props) {
  const { stawki, mpk } = useSlowniki()
  const idStawek = useMemo(() => new Set(stawki.map((s) => s.cennik_pozycja_id)), [stawki])

  const stanowiska = useMemo(() => {
    const m = new Map<string, Map<Pora, Stawka>>()
    for (const s of stawki) {
      if (!m.has(s.stanowisko)) m.set(s.stanowisko, new Map())
      m.get(s.stanowisko)!.set(s.pora, s)
    }
    return [...m.entries()]
  }, [stawki])

  const wlasne = uslugi.filter((u) => idStawek.has(u.cennik_pozycja_id) && !u.mpk_wykonawcy)
  const kooperacja = uslugi.filter((u) => idStawek.has(u.cennik_pozycja_id) && u.mpk_wykonawcy)

  function ustawGodziny(stawka: Stawka, godziny: number) {
    const istniejaca = wlasne.find((u) => u.cennik_pozycja_id === stawka.cennik_pozycja_id)
    if (istniejaca) {
      ustaw(godziny > 0
        ? uslugi.map((u) => (u === istniejaca ? { ...u, ilosc: godziny } : u))
        : uslugi.filter((u) => u !== istniejaca))
    } else if (godziny > 0) {
      ustaw([...uslugi, {
        klucz: nowyKlucz(), cennik_pozycja_id: stawka.cennik_pozycja_id, ilosc: godziny,
        doplata_proc: 0, doplata_opis: null, mpk_wykonawcy: null, opis: null,
      }])
    }
  }

  function cenaWiersza(u: PozycjaUslugi) {
    return u.cena ?? stawki.find((s) => s.cennik_pozycja_id === u.cennik_pozycja_id)?.cena ?? 0
  }

  const sumaGodzin = wlasne.reduce((s, u) => s + u.ilosc, 0)
  const sumaWartosci = [...wlasne, ...kooperacja].reduce((s, u) => s + wartoscUslugi(u, cenaWiersza(u)), 0)
  const inneMpk = mpk.filter((m) => m.kod !== mpkZlecenia)

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Stanowisko</th>
              {PORY.map((p) => <th key={p} className="komorka-naglowek text-right">{ETYKIETY_PORY[p]}</th>)}
              <th className="komorka-naglowek text-right">Wartość [zł]</th>
            </tr>
          </thead>
          <tbody>
            {stanowiska.map(([nazwa, pory]) => {
              const wartosc = [...pory.values()].reduce((s, st) => {
                const u = wlasne.find((x) => x.cennik_pozycja_id === st.cennik_pozycja_id)
                return s + (u ? wartoscUslugi(u, cenaWiersza(u)) : 0)
              }, 0)
              const stala = pory.get('stala')
              return (
                <tr key={nazwa}>
                  <td className="komorka whitespace-nowrap font-medium">{nazwa}</td>
                  {stala ? (
                    <td colSpan={4} className="komorka">
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap text-xs text-slate-500">stawka stała {zl(stala.cena)} zł/h</span>
                        <PoleLiczby
                          aria-label={`${nazwa} - godziny`}
                          wartosc={wlasne.find((u) => u.cennik_pozycja_id === stala.cennik_pozycja_id)?.ilosc ?? 0}
                          zmien={(n) => ustawGodziny(stala, n)}
                          disabled={!edycja}
                          className="max-w-24"
                          placeholder="rbg"
                        />
                      </div>
                    </td>
                  ) : PORY.map((p) => {
                    const st = pory.get(p)
                    if (!st) return <td key={p} className="komorka bg-slate-50" />
                    const u = wlasne.find((x) => x.cennik_pozycja_id === st.cennik_pozycja_id)
                    return (
                      <td key={p} className="komorka p-0" title={`${zl(st.cena)} zł/h · indeks SAP ${st.indeks_sap}`}>
                        <div className="flex items-center">
                          <PoleLiczby
                            aria-label={`${nazwa} ${ETYKIETY_PORY[p]}`}
                            wartosc={u?.ilosc ?? 0}
                            zmien={(n) => ustawGodziny(st, n)}
                            disabled={!edycja}
                            placeholder="0"
                          />
                          <span className="whitespace-nowrap pr-2 text-[10px] text-slate-400">× {zl(u?.cena ?? st.cena)}</span>
                        </div>
                      </td>
                    )
                  })}
                  <td className="komorka liczba">{wartosc ? zl(wartosc) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-3">
          <h4 className="text-sm font-semibold">Kooperacja z innym MPK</h4>
          <p className="text-xs text-slate-500">Godziny przepracowane w tym zleceniu przez ludzi z innego MPK (zamiast wpisu typu „20 RBG DLA SPORYSZ”).</p>
        </div>
        {kooperacja.length > 0 && (
          <table className="mb-2 w-full border-collapse">
            <thead>
              <tr>
                <th className="komorka-naglowek w-28">MPK</th>
                <th className="komorka-naglowek">Stawka</th>
                <th className="komorka-naglowek w-24 text-right">Rbg</th>
                <th className="komorka-naglowek w-32 text-right">Wartość [zł]</th>
                <th className="komorka-naglowek w-10" />
              </tr>
            </thead>
            <tbody>
              {kooperacja.map((u) => (
                <tr key={u.klucz}>
                  <td className="komorka p-0">
                    <select className="pole-komorki" disabled={!edycja} value={u.mpk_wykonawcy ?? ''}
                      onChange={(e) => ustaw(uslugi.map((x) => (x === u ? { ...x, mpk_wykonawcy: e.target.value } : x)))}>
                      {inneMpk.map((m) => <option key={m.kod} value={m.kod}>{m.kod}{m.nazwa ? ` ${m.nazwa}` : ''}</option>)}
                    </select>
                  </td>
                  <td className="komorka p-0">
                    <select className="pole-komorki" disabled={!edycja} value={u.cennik_pozycja_id}
                      onChange={(e) => ustaw(uslugi.map((x) => (x === u ? { ...x, cennik_pozycja_id: Number(e.target.value), cena: undefined } : x)))}>
                      {stawki.map((s) => (
                        <option key={s.cennik_pozycja_id} value={s.cennik_pozycja_id}>
                          {s.stanowisko} - {ETYKIETY_PORY[s.pora]} ({zl(s.cena)} zł)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="komorka p-0">
                    <PoleLiczby wartosc={u.ilosc} disabled={!edycja} aria-label="Rbg kooperacji"
                      zmien={(n) => ustaw(uslugi.map((x) => (x === u ? { ...x, ilosc: n } : x)))} />
                  </td>
                  <td className="komorka liczba">{zl(wartoscUslugi(u, cenaWiersza(u)))}</td>
                  <td className="komorka text-center">
                    {edycja && (
                      <button aria-label="Usuń wiersz" onClick={() => ustaw(uslugi.filter((x) => x !== u))} className="text-slate-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {edycja && inneMpk.length > 0 && (
          <button
            className="inline-flex items-center gap-1 text-sm text-blekit-ciemny hover:underline"
            onClick={() => ustaw([...uslugi, {
              klucz: nowyKlucz(), cennik_pozycja_id: stawki[0].cennik_pozycja_id, ilosc: 0,
              doplata_proc: 0, doplata_opis: null, mpk_wykonawcy: inneMpk[0].kod, opis: null,
            }])}
          >
            <Plus className="h-4 w-4" /> Dodaj godziny innego MPK
          </button>
        )}
      </div>

      <p className="text-right text-sm text-slate-600">
        Własne: <strong>{sumaGodzin.toLocaleString('pl-PL')} rbg</strong> · Robocizna razem: <strong>{zl(sumaWartosci)} zł</strong>
      </p>
    </div>
  )
}
