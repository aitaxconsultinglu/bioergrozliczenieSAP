/**
 * Wczytanie eksportu z Comarch ERP Optima (np. "Handel -> Zasoby" zapisany do Excela).
 * Kolumny rozpoznajemy po nagłówkach, nie po pozycji - dzięki temu ten sam import
 * przyjmie też inny eksport (np. pozycje dokumentów PZ/FZ), jeśli ma kod, nazwę,
 * cenę zakupu i numer dokumentu. Plik czytany jest w przeglądarce; do bazy idą tylko
 * oczyszczone kolumny potrzebne do podpowiedzi cen.
 */

export interface WierszOptimy {
  kod: string
  nazwa: string
  jm: string | null
  cena: number
  dokument: string | null
  dostawca: string | null
  data: string | null
}

export interface WynikParsowania {
  wiersze: WierszOptimy[]
  pominiete: number
  kolumny: Record<string, string>
}

type Pole = keyof WierszOptimy | 'typ'

// Kolejność ma znaczenie: pierwsze dopasowanie wygrywa (np. "C. zakupu" przed "W. zakupu").
const WZORCE: [Pole, RegExp][] = [
  ['kod', /^kod( towaru)?$/i],
  ['nazwa', /^nazwa( towaru)?$/i],
  ['jm', /^j\.?\s?m\.?$/i],
  ['cena', /^(c\.|cena)\s*(zakupu|netto|jedn)/i],
  ['dokument', /^(pz|fz|dokument|numer dokumentu|nr dokumentu)$/i],
  ['dostawca', /^(dostpz|dostawca|kontrahent)/i],
  ['data', /^data/i],
  ['typ', /^typ$/i],
]

/** Nazwy z Optimy mają spacje na początku i znaki końca wiersza (_x000d_). */
export function oczyscNazwe(s: unknown): string {
  return String(s ?? '').replace(/_x000d_/gi, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export function liczbaZOptimy(v: unknown): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/\s/g, '').replace(/zł|pln/gi, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function dataZKomorki(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  const pl = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s)
  if (pl) return `${pl[3]}-${pl[2].padStart(2, '0')}-${pl[1].padStart(2, '0')}`
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

/** Z tablicy wierszy (pierwszy wiersz z nagłówkami gdzieś na górze) robi listę zakupów. */
export function parsujWiersze(tabela: unknown[][]): WynikParsowania {
  const idxNaglowka = tabela.findIndex((r) => {
    const t = r.map((c) => String(c ?? '').trim().toLowerCase())
    return t.includes('kod') && t.includes('nazwa')
  })
  if (idxNaglowka < 0) {
    throw new Error('Nie znaleziono wiersza nagłówków z kolumnami „Kod” i „Nazwa”. Czy to eksport listy z Optimy?')
  }
  const naglowki = tabela[idxNaglowka].map((c) => String(c ?? '').trim())
  const indeks: Partial<Record<Pole, number>> = {}
  const kolumny: Record<string, string> = {}
  for (const [pole, wzorzec] of WZORCE) {
    const i = naglowki.findIndex((h, j) => wzorzec.test(h) && !Object.values(indeks).includes(j))
    if (i >= 0) { indeks[pole] = i; kolumny[pole] = naglowki[i] }
  }
  if (indeks.cena === undefined) {
    throw new Error('Nie znaleziono kolumny z ceną zakupu (np. „C. zakupu-PLN”). Dodaj ją do widoku listy w Optimie przed eksportem.')
  }

  const wiersze: WierszOptimy[] = []
  let pominiete = 0
  for (const r of tabela.slice(idxNaglowka + 1)) {
    const kod = String(r[indeks.kod!] ?? '').trim()
    const nazwa = oczyscNazwe(r[indeks.nazwa!])
    const cena = liczbaZOptimy(r[indeks.cena])
    const typ = indeks.typ !== undefined ? String(r[indeks.typ] ?? '').trim().toUpperCase() : ''
    // Usługi (typy U*) to nie materiał; bez ceny nie ma czego podpowiadać.
    if (!kod || !nazwa || !(cena > 0) || typ.startsWith('U')) { pominiete++; continue }
    wiersze.push({
      kod,
      nazwa,
      jm: indeks.jm !== undefined ? String(r[indeks.jm] ?? '').trim() || null : null,
      cena: Math.round(cena * 10000) / 10000,
      dokument: indeks.dokument !== undefined ? String(r[indeks.dokument] ?? '').trim() || null : null,
      dostawca: indeks.dostawca !== undefined ? oczyscNazwe(r[indeks.dostawca]) || null : null,
      data: indeks.data !== undefined ? dataZKomorki(r[indeks.data]) : null,
    })
  }
  return { wiersze, pominiete, kolumny }
}

export async function parsujPlik(plik: File): Promise<WynikParsowania> {
  const { default: XLSX } = await import('xlsx-js-style')
  const wb = XLSX.read(await plik.arrayBuffer(), { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const tabela = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
  return parsujWiersze(tabela)
}
