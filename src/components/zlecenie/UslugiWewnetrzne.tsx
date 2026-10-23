import { useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSlowniki } from '@/lib/slowniki'
import { zl } from '@/lib/format'
import { grosze, nowyKlucz, wartoscUslugi } from '@/lib/obliczenia'
import type { PozycjaUslugi } from '@/lib/types'
import { PoleLiczby } from '../PoleLiczby'

/** Kategoria cennika „Wyważanie, osiowanie, metrologia” - typowe usługi innych działów. */
export const KATEGORIA_USLUG_WEWNETRZNYCH = 20
const MPK_DOMYSLNE = 'P07'

interface Props {
  uslugi: PozycjaUslugi[]
  ustaw: (u: PozycjaUslugi[]) => void
  mpkZlecenia: string
  edycja: boolean
}

/**
 * Usługi wewnętrzne: pozycja z cennika wykonana przez inny dział (MPK), np. wyważanie, osiowanie
 * albo metrologia w P07. Do Synthosu idzie jak zwykła pozycja cennikowa (cena z umowy), a w aplikacji
 * i w arkuszu „Szczegóły” widać, które MPK ją wykonało - do rozliczenia wewnętrznego.
 * Zapisywane w pozycje_uslug z mpk_wykonawcy (jak kooperacja godzinowa, ale dla pozycji cennika).
 */
export function UslugiWewnetrzne({ uslugi, ustaw, mpkZlecenia, edycja }: Props) {
  const { pozycje, cennik, stawki, mpk } = useSlowniki()
  const idStawek = useMemo(() => new Set(stawki.map((s) => s.cennik_pozycja_id)), [stawki])
  const doWyboru = useMemo(
    () => pozycje.filter((p) => p.aktywna && p.nr_pozycji === KATEGORIA_USLUG_WEWNETRZNYCH).sort((a, b) => a.numer_linii - b.numer_linii),
    [pozycje],
  )
  const inneMpk = mpk.filter((m) => m.kod !== mpkZlecenia)
  const wiersze = uslugi.filter((u) => u.mpk_wykonawcy && u.cennik_pozycja_id !== null && !idStawek.has(u.cennik_pozycja_id))

  const zmien = (u: PozycjaUslugi, zmiana: Partial<PozycjaUslugi>) =>
    ustaw(uslugi.map((x) => (x === u ? { ...x, ...zmiana } : x)))
  const cenaWiersza = (u: PozycjaUslugi) => u.cena ?? cennik.get(u.cennik_pozycja_id!)?.cena ?? 0

  function dodaj() {
    const mpkWykonawcy = inneMpk.find((m) => m.kod === MPK_DOMYSLNE)?.kod ?? inneMpk[0]?.kod
    if (!mpkWykonawcy || !doWyboru.length) return
    ustaw([...uslugi, {
      klucz: nowyKlucz(), cennik_pozycja_id: doWyboru[0].id, ilosc: 1, doplata_proc: 0, doplata_opis: null,
      mpk_wykonawcy: mpkWykonawcy, opis: null, wymaga_karty: false,
    }])
  }

  // Suma per MPK - do rozliczenia wewnętrznego między działami.
  const wgMpk = new Map<string, number>()
  for (const u of wiersze) wgMpk.set(u.mpk_wykonawcy!, (wgMpk.get(u.mpk_wykonawcy!) ?? 0) + wartoscUslugi(u, cenaWiersza(u)))

  return (
    <div className="space-y-3">
      {wiersze.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="komorka-naglowek w-28">MPK wykonawcy</th>
                <th className="komorka-naglowek w-16" title="Numer linii zamówienia SAP (nadaje Synthos). Puste = numer linii usług z nagłówka zlecenia.">Nr linii</th>
                <th className="komorka-naglowek">Usługa (cennik)</th>
                <th className="komorka-naglowek w-20 text-right">Ilość</th>
                <th className="komorka-naglowek w-12">JM</th>
                <th className="komorka-naglowek w-28 text-right">Cena [zł]</th>
                <th className="komorka-naglowek w-32 text-right">Wartość [zł]</th>
                <th className="komorka-naglowek w-10" />
              </tr>
            </thead>
            <tbody>
              {wiersze.map((u) => {
                const p = cennik.get(u.cennik_pozycja_id!)
                // Pozycja spoza kategorii 20 (np. dodana wcześniej) też musi dać się wybrać w liście.
                const opcje = p && !doWyboru.some((x) => x.id === p.id) ? [p, ...doWyboru] : doWyboru
                return (
                  <tr key={u.klucz}>
                    <td className="komorka p-0">
                      <select className="pole-komorki" disabled={!edycja} value={u.mpk_wykonawcy ?? ''} aria-label="MPK wykonawcy"
                        onChange={(e) => zmien(u, { mpk_wykonawcy: e.target.value })}>
                        {inneMpk.map((m) => <option key={m.kod} value={m.kod}>{m.kod}{m.nazwa ? ` ${m.nazwa}` : ''}</option>)}
                      </select>
                    </td>
                    <td className="komorka p-0">
                      <input className="pole-komorki liczba" inputMode="numeric" disabled={!edycja} aria-label="Nr linii zamówienia SAP"
                        value={u.nr_linii_sap ?? ''} placeholder="-"
                        onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); zmien(u, { nr_linii_sap: v ? Number(v) : null }) }} />
                    </td>
                    <td className="komorka p-0">
                      <select className="pole-komorki" disabled={!edycja} value={u.cennik_pozycja_id ?? ''} aria-label="Usługa"
                        onChange={(e) => zmien(u, { cennik_pozycja_id: Number(e.target.value), cena: undefined })}>
                        {opcje.map((x) => <option key={x.id} value={x.id}>{x.opis} ({x.indeks_sap})</option>)}
                      </select>
                      {(edycja || u.opis) && (
                        <input className="pole-komorki mt-0.5 text-xs text-slate-600" disabled={!edycja} value={u.opis ?? ''}
                          placeholder="+ uwagi (np. nr protokołu, urządzenie)" aria-label="Uwagi do usługi"
                          onChange={(e) => zmien(u, { opis: e.target.value || null })} />
                      )}
                    </td>
                    <td className="komorka p-0">
                      <PoleLiczby wartosc={u.ilosc} disabled={!edycja} aria-label="Ilość" zmien={(n) => zmien(u, { ilosc: n })} />
                    </td>
                    <td className="komorka text-xs">{p?.jm}</td>
                    <td className="komorka liczba">{zl(cenaWiersza(u))}</td>
                    <td className="komorka liczba font-medium">{zl(wartoscUslugi(u, cenaWiersza(u)))}</td>
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
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {edycja && inneMpk.length > 0 && doWyboru.length > 0 && (
          <button className="inline-flex items-center gap-1 text-sm text-blekit-ciemny hover:underline" onClick={dodaj}>
            <Plus className="h-4 w-4" /> Dodaj usługę wewnętrzną
          </button>
        )}
        {wgMpk.size > 0 && (
          <p className="ml-auto text-sm text-slate-600">
            Rozliczenie wewnętrzne: {[...wgMpk.entries()].map(([k, w], i) => (
              <span key={k}>{i > 0 && ' · '}<strong>{k}</strong> {zl(grosze(w))} zł</span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}
