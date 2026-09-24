import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { komunikatPL } from '@/lib/config'
import { zl } from '@/lib/format'
import { SZABLONY } from '@/lib/szablony'
import type { Profil } from '@/lib/types'

/**
 * Podgląd cennika kontraktowego. Dział handlowy ustawia tu, które kategorie wymagają
 * karty remontowej i jakiego szablonu - to steruje walidacją bez zmian w kodzie.
 */
export function Cennik({ profil }: { profil: Profil }) {
  const { pozycje, kategorie, odswiez } = useSlowniki()
  const [fraza, setFraza] = useState('')
  const [kategoria, setKategoria] = useState<number | ''>('')
  const [blad, setBlad] = useState<string | null>(null)
  const handlowiec = profil.rola === 'handlowiec'

  const widoczne = useMemo(() => {
    const slowa = fraza.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return pozycje.filter((p) =>
      (kategoria === '' || p.nr_pozycji === kategoria)
      && slowa.every((s) => `${p.indeks_sap} ${p.opis}`.toLowerCase().includes(s)))
  }, [pozycje, fraza, kategoria])

  async function ustawKarte(nr: number, szablonKarty: string) {
    const { error } = await supabase.from('cennik_kategorie')
      .update({ wymaga_karty: !!szablonKarty, szablon_karty: szablonKarty || null })
      .eq('nr_pozycji', nr)
    if (error) { setBlad(komunikatPL(error.message)); return }
    setBlad(null)
    await odswiez()
  }

  const kat = kategoria === '' ? null : kategorie.get(kategoria)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Cennik kontraktowy Synthos</h2>
        <p className="text-sm text-slate-500">{pozycje.length} pozycji w {kategorie.size} kategoriach. Ceny i indeksy SAP są źródłem prawdy dla wszystkich rozliczeń.</p>
      </div>
      {blad && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{blad}</p>}

      <div className="flex flex-wrap gap-3">
        <input className="pole max-w-sm" placeholder="Szukaj: opis lub indeks SAP" value={fraza} onChange={(e) => setFraza(e.target.value)} />
        <select className="pole w-auto max-w-md" value={kategoria} onChange={(e) => setKategoria(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Wszystkie kategorie</option>
          {[...kategorie.values()].map((k) => (
            <option key={k.nr_pozycji} value={k.nr_pozycji}>{k.nr_pozycji} - {k.nazwa}{k.wymaga_karty ? ' (karta)' : ''}</option>
          ))}
        </select>
      </div>

      {kat && (
        <div className="sekcja flex flex-wrap items-center gap-3 text-sm">
          <span>Kategoria <strong>{kat.nazwa}</strong>:</span>
          {handlowiec ? (
            <label className="flex items-center gap-2">
              karta remontowa
              <select className="pole w-auto" value={kat.szablon_karty ?? ''} onChange={(e) => void ustawKarte(kat.nr_pozycji, e.target.value)}>
                <option value="">nie jest wymagana</option>
                {Object.values(SZABLONY).map((s) => <option key={s.id} value={s.id}>wymagana - {s.nazwa}</option>)}
              </select>
            </label>
          ) : (
            <span>{kat.wymaga_karty ? `wymaga karty remontowej (${SZABLONY[kat.szablon_karty ?? '']?.nazwa ?? kat.szablon_karty})` : 'karta remontowa nie jest wymagana'}</span>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Kategoria</th>
              <th className="komorka-naglowek text-right">Nr linii</th>
              <th className="komorka-naglowek">Indeks SAP</th>
              <th className="komorka-naglowek">Opis</th>
              <th className="komorka-naglowek">JM</th>
              <th className="komorka-naglowek text-right">Cena [zł]</th>
            </tr>
          </thead>
          <tbody>
            {widoczne.slice(0, 500).map((p) => (
              <tr key={p.id}>
                <td className="komorka text-xs text-slate-500">{kategorie.get(p.nr_pozycji)?.nazwa}</td>
                <td className="komorka liczba">{p.numer_linii}</td>
                <td className="komorka font-mono text-xs">{p.indeks_sap}</td>
                <td className="komorka">{p.opis}</td>
                <td className="komorka text-xs">{p.jm}</td>
                <td className="komorka liczba">{zl(p.cena)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {widoczne.length > 500 && <p className="text-xs text-slate-500">Pokazano 500 z {widoczne.length} pozycji - zawęź wyszukiwanie.</p>}
    </div>
  )
}
