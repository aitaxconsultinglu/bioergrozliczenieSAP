/**
 * Eksport do SAP w sztywnym układzie kolumn od Justyny (BRIEF 3.5):
 *   Numer linii | Numer usługi | Krótki tekst | Ilość | Pozostało | Podst. t.JM | Cena |
 *   Wartość | Cena Mat. | Ilość Mat. | Nr Mat. dostawcy
 *
 * CAŁE mapowanie danych na kolumny SAP jest w tym jednym pliku - gdy dział handlowy
 * potwierdzi szczegóły na realnym przykładzie, zmienia się tylko funkcja wierszeSap().
 *
 * ZAŁOŻENIA DO POTWIERDZENIA z Justyną (na podstawie cennika i starych kart):
 *  1. "Numer linii" = numer linii ZAMÓWIENIA w SAP - nadaje go Synthos przy tworzeniu
 *     zamówienia (potwierdzone przez dział handlowy 2026-10-13), więc NIE pochodzi z cennika.
 *     Bierzemy go z pozycji (nr_linii_sap), a gdy pusty - z numeru linii zlecenia dla usług
 *     (linia_uslugi) albo materiałów (linia_materialy). Brak = pusta komórka do uzupełnienia w SAP.
 *  2. Materiał idzie pod uniwersalną usługę "Materiał branża mechaniczna +15%" (5004062)
 *     z ceną cennikową 1 zł/JD, więc Ilość = wartość z narzutem, Cena = 1.
 *     Dodatkowo wypełniamy Cena Mat. (cena jedn. z narzutem) i Ilość Mat. (sztuki),
 *     a Krótki tekst = nazwa materiału (max 40 znaków - limit krótkiego tekstu SAP).
 *  3. Dopłata procentowa (przezwojenie +10%) jest wliczona w cenę pozycji.
 *  4. "Pozostało" i "Nr Mat. dostawcy" zostają puste.
 *  5. Materiał dostarczony przez Synthos (narzut 0%) nie jest eksportowany - brak wartości
 *     do rozliczenia. Materiał od innego wpisanego dostawcy jest eksportowany normalnie.
 *  6. Pozycja spoza cennika: pusty "Numer linii" (Synthos nadaje go w SAP), indeks SAP
 *     jeśli kierownik go wpisał, opis/JM/cena wpisane ręcznie. Panel oznacza takie
 *     zlecenia do weryfikacji przez dział handlowy.
 */
import { cenaJednMaterialu, cenaUslugi, czySynthos, grosze, wartoscMaterialu, wartoscUslugi } from './obliczenia'
import type { Dostawca, PozycjaCennika } from './types'

export const KOLUMNY_SAP = [
  'Numer linii', 'Numer usługi', 'Krótki tekst', 'Ilość', 'Pozostało', 'Podst. t.JM',
  'Cena', 'Wartość', 'Cena Mat.', 'Ilość Mat.', 'Nr Mat. dostawcy',
] as const

export type KomorkaSap = string | number | null
export type WierszSap = [number | null, string, string, number, null, string, number, number, number | null, number | null, null]

export const INDEKS_MATERIALU = '5004062'
export const GRUPA_ROBOCIZNY = 310
const MAKS_KROTKI_TEKST = 40

export interface ZlecenieDoEksportu {
  id: string
  mpk: string
  nr_zamowienia: string | null
  pozycja_zamowienia: number | null
  nazwa: string
  linia_uslugi?: number | null
  linia_materialy?: number | null
  pozycje_uslug: {
    ilosc: number
    cena: number
    doplata_proc: number
    kolejnosc: number
    /** null = pozycja spoza cennika */
    cennik_pozycje: PozycjaCennika | null
    wlasny_opis?: string | null
    wlasna_jm?: string | null
    wlasny_indeks?: string | null
    nr_linii_sap?: number | null
  }[]
  pozycje_materialowe: {
    nazwa: string
    ilosc: number
    wartosc_zakupu: number
    narzut_proc: number
    dostawca: Dostawca
    kolejnosc: number
  }[]
}

/** Wszystkie pozycje materiałowe cennika (5004062) wg kategorii - do wyboru numeru linii. */
export type MaterialWgKategorii = Map<number, PozycjaCennika>

/**
 * Pod którą kategorią rozliczyć materiał: tą samą, co pierwsza pozycja cennikowa
 * zlecenia (np. remont pompy -> materiał z grupy pomp), a przy samej robociźnie -
 * z grupy "Wynajem pracowników".
 */
function kategoriaMaterialu(z: ZlecenieDoEksportu, materialy: MaterialWgKategorii): PozycjaCennika | undefined {
  const pierwsza = z.pozycje_uslug
    .map((u) => u.cennik_pozycje?.nr_pozycji)
    .find((nr): nr is number => nr !== undefined && nr !== GRUPA_ROBOCIZNY && materialy.has(nr))
  return materialy.get(pierwsza ?? GRUPA_ROBOCIZNY) ?? materialy.get(GRUPA_ROBOCIZNY)
}

export function wierszeSap(z: ZlecenieDoEksportu, materialy: MaterialWgKategorii): WierszSap[] {
  const wiersze: WierszSap[] = []
  // Pozycje z cennika wg kategorii i linii; pozycje spoza cennika na końcu, w kolejności wpisu.
  const klucz = (u: ZlecenieDoEksportu['pozycje_uslug'][number]) =>
    u.cennik_pozycje ? u.cennik_pozycje.nr_pozycji * 100000 + u.cennik_pozycje.numer_linii : 1e12 + u.kolejnosc
  const uslugi = [...z.pozycje_uslug].sort((a, b) => klucz(a) - klucz(b))
  for (const u of uslugi) {
    const c = u.cennik_pozycje
    if (!c) {
      wiersze.push([
        u.nr_linii_sap ?? z.linia_uslugi ?? null, u.wlasny_indeks ?? '', (u.wlasny_opis ?? '').slice(0, MAKS_KROTKI_TEKST), Number(u.ilosc), null,
        u.wlasna_jm ?? 'JD', cenaUslugi(u, Number(u.cena)), wartoscUslugi(u, Number(u.cena)), null, null, null,
      ])
      continue
    }
    wiersze.push([
      u.nr_linii_sap ?? z.linia_uslugi ?? null, c.indeks_sap, c.opis.slice(0, MAKS_KROTKI_TEKST), Number(u.ilosc), null, c.jm,
      cenaUslugi(u, Number(u.cena)), wartoscUslugi(u, Number(u.cena)), null, null, null,
    ])
  }
  const mat = kategoriaMaterialu(z, materialy)
  for (const m of [...z.pozycje_materialowe].sort((a, b) => a.kolejnosc - b.kolejnosc)) {
    if (czySynthos(m.dostawca)) continue
    const wartosc = wartoscMaterialu(m)
    wiersze.push([
      z.linia_materialy ?? null, INDEKS_MATERIALU, m.nazwa.slice(0, MAKS_KROTKI_TEKST), wartosc, null,
      mat?.jm ?? 'JD', 1, wartosc, cenaJednMaterialu(m), Number(m.ilosc), null,
    ])
  }
  return wiersze
}

/** Czy zlecenie zawiera pozycje spoza cennika - dział handlowy powinien je sprawdzić. */
export function maPozycjeSpozaCennika(z: ZlecenieDoEksportu) {
  return z.pozycje_uslug.some((u) => !u.cennik_pozycje)
}

export function sumaWierszy(wiersze: WierszSap[]) {
  return grosze(wiersze.reduce((s, w) => s + w[7], 0))
}

/** Tekst do schowka: bez nagłówka, tabulatory, przecinek dziesiętny - gotowe do Ctrl+V w SAP. */
export function tekstDoSchowka(wiersze: WierszSap[]) {
  const komorka = (v: KomorkaSap) =>
    v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v.replace(/[\t\n\r]/g, ' ')
  return wiersze.map((w) => w.map(komorka).join('\t')).join('\r\n')
}

export function etykietaZamowienia(z: Pick<ZlecenieDoEksportu, 'nr_zamowienia' | 'pozycja_zamowienia'>) {
  return `${z.nr_zamowienia ?? 'bez numeru'}${z.pozycja_zamowienia ? `-${z.pozycja_zamowienia}` : ''}`
}

const STYL_NAGLOWKA = {
  font: { bold: true },
  fill: { fgColor: { rgb: 'EEF9C4' } },
  border: { bottom: { style: 'thin', color: { rgb: '8FAE0F' } } },
}

/**
 * Plik XLSX: arkusz "Zestawienie" + jeden arkusz na zlecenie (nazwa = nr zamówienia),
 * bo w SAP rozliczenie wprowadza się osobno dla każdego zamówienia.
 */
export async function plikXlsx(zlecenia: ZlecenieDoEksportu[], materialy: MaterialWgKategorii): Promise<Blob> {
  // Biblioteka XLSX (~700 kB) ładowana dopiero przy eksporcie - kierownicy jej nie potrzebują.
  const { default: XLSX } = await import('xlsx-js-style')
  const wb = XLSX.utils.book_new()
  const zestawienie: (string | number)[][] = [['Nr zamówienia', 'MPK', 'Nazwa', 'Liczba linii', 'Wartość']]
  const arkusze: { nazwa: string; ws: ReturnType<typeof XLSX.utils.aoa_to_sheet> }[] = []
  const uzyte = new Set<string>(['Zestawienie'])

  for (const z of zlecenia) {
    const wiersze = wierszeSap(z, materialy)
    zestawienie.push([etykietaZamowienia(z), z.mpk, z.nazwa, wiersze.length, sumaWierszy(wiersze)])

    const ws = XLSX.utils.aoa_to_sheet([[...KOLUMNY_SAP], ...wiersze])
    ws['!cols'] = [8, 12, 42, 10, 10, 10, 10, 12, 10, 10, 14].map((wch) => ({ wch }))
    KOLUMNY_SAP.forEach((_, i) => {
      const adres = XLSX.utils.encode_cell({ r: 0, c: i })
      if (ws[adres]) ws[adres].s = STYL_NAGLOWKA
    })
    // Nazwa arkusza: max 31 znaków, bez znaków zabronionych, unikalna.
    let nazwa = etykietaZamowienia(z).replace(/[\\/?*[\]:]/g, '_').slice(0, 28)
    let n = 2
    while (uzyte.has(nazwa)) nazwa = `${nazwa.slice(0, 26)}_${n++}`
    uzyte.add(nazwa)
    arkusze.push({ nazwa, ws })
  }

  const wsZ = XLSX.utils.aoa_to_sheet(zestawienie)
  wsZ['!cols'] = [16, 6, 50, 12, 14].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, wsZ, 'Zestawienie')
  for (const a of arkusze) XLSX.utils.book_append_sheet(wb, a.ws, a.nazwa)

  const dane = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([dane], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function pobierz(blob: Blob, nazwaPliku: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nazwaPliku
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
