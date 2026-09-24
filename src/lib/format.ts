import type { StatusBraku, StatusZlecenia } from './types'

const ZL = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const LICZBA = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 })

export function zl(wartosc: number | null | undefined) {
  return ZL.format(Number(wartosc ?? 0))
}

export function liczba(wartosc: number | null | undefined) {
  return LICZBA.format(Number(wartosc ?? 0))
}

/** Parsuje liczbę wpisaną po polsku ("12,5", "1 234,50") albo po angielsku ("12.5"). */
export function parsujLiczbe(tekst: string): number {
  const czysty = tekst.replace(/\s/g, '').replace(',', '.')
  if (czysty === '' || czysty === '-') return 0
  const n = Number(czysty)
  return Number.isFinite(n) ? n : NaN
}

export function dataPL(iso: string | null | undefined) {
  if (!iso) return ''
  const [r, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${r}`
}

export function dataGodzinaPL(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

export function dzisiajISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const ETYKIETY_STATUSU: Record<StatusZlecenia, string> = {
  roboczy: 'Roboczy',
  zlozony: 'Złożony do rozliczenia',
  zwrocony: 'Zwrócony do poprawki',
  wyeksportowany: 'Wyeksportowany do SAP',
}

/** Limonka = zamknięte, błękit = czeka na dział handlowy, bursztyn = wymaga reakcji kierownika. */
export const KOLORY_STATUSU: Record<StatusZlecenia, string> = {
  roboczy: 'bg-slate-100 text-slate-700 ring-slate-300',
  zlozony: 'bg-blekit-jasny text-blekit-ciemny ring-blekit',
  zwrocony: 'bg-amber-50 text-amber-800 ring-amber-400',
  wyeksportowany: 'bg-limonka-jasna text-limonka-ciemna ring-limonka',
}

export const ETYKIETY_BRAKU: Record<StatusBraku, string> = {
  zgloszony: 'Zgłoszony',
  uzupelniony: 'Uzupełniony przez klienta',
  rozliczony: 'Rozliczony',
}

export const ETYKIETY_PORY: Record<string, string> = {
  '7-15': '7:00–15:00',
  '15-19': '15:00–19:00',
  '19-7': '19:00–7:00',
  wolne: 'dni wolne',
  stala: 'stawka stała',
}
