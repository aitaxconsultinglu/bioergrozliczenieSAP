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
    jm?: string
    numer_faktury?: string | null
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
/** Wiersze arkusza "Szczegóły": całe rozliczenie zlecenia, także to, czego nie ma w układzie SAP. */
export const KOLUMNY_SZCZEGOLOW = [
  'Nr zamówienia', 'Zlecenie', 'MPK', 'Rodzaj', 'Nr linii SAP', 'Indeks SAP', 'Opis', 'Ilość', 'JM',
  'Cena', 'Wartość', 'Zakup (materiał)', 'Narzut %', 'Narzut [zł]', 'Dokument (PZ/FZ)', 'Dostarczył',
] as const

export function wierszeSzczegolow(z: ZlecenieDoEksportu): (string | number | null)[][] {
  const nr = etykietaZamowienia(z)
  const wynik: (string | number | null)[][] = []
  for (const u of z.pozycje_uslug) {
    const c = u.cennik_pozycje
    const rodzaj = !c ? 'Spoza cennika' : c.nr_pozycji === GRUPA_ROBOCIZNY ? 'Robocizna wg rbg' : 'Robocizna wg cennika'
    wynik.push([
      nr, z.nazwa, z.mpk, rodzaj, u.nr_linii_sap ?? z.linia_uslugi ?? null, c?.indeks_sap ?? u.wlasny_indeks ?? '',
      c?.opis ?? u.wlasny_opis ?? '', Number(u.ilosc), c?.jm ?? u.wlasna_jm ?? '',
      cenaUslugi(u, Number(u.cena)), wartoscUslugi(u, Number(u.cena)), null,
      u.doplata_proc ? u.doplata_proc : null, null, null, null,
    ])
  }
  for (const m of [...z.pozycje_materialowe].sort((a, b) => a.kolejnosc - b.kolejnosc)) {
    const synthos = czySynthos(m.dostawca)
    const zNarzutem = synthos ? 0 : wartoscMaterialu(m)
    wynik.push([
      nr, z.nazwa, z.mpk, synthos ? 'Materiał Synthos (bez rozliczenia)' : 'Materiał', synthos ? null : z.linia_materialy ?? null,
      synthos ? '' : INDEKS_MATERIALU, m.nazwa, Number(m.ilosc), m.jm ?? '',
      synthos ? 0 : cenaJednMaterialu(m), zNarzutem, synthos ? 0 : m.wartosc_zakupu,
      synthos ? 0 : m.narzut_proc, synthos ? 0 : grosze(zNarzutem - m.wartosc_zakupu), m.numer_faktury ?? '',
      synthos ? 'Synthos' : m.dostawca === 'bioerg' ? 'Bioerg' : m.dostawca,
    ])
  }
  return wynik
}

/**
 * Plik XLSX - na pierwszym arkuszu od razu wszystko, co trzeba wkleić do SAP:
 *   1. "Linie SAP"   - wszystkie zaznaczone zamówienia jedno pod drugim (nagłówek bloku = zamówienie),
 *   2. "Szczegóły"   - całe rozliczenie: cennik, roboczogodziny, materiał z zakupem/narzutem/dokumentem,
 *   3. "Zestawienie" - jedno zamówienie = jeden wiersz z sumą,
 *   4. arkusz na każde zamówienie - sam układ SAP, do kopiowania 1:1.
 */
export async function plikXlsx(zlecenia: ZlecenieDoEksportu[], materialy: MaterialWgKategorii): Promise<Blob> {
  // Biblioteka XLSX (~700 kB) ładowana dopiero przy eksporcie - kierownicy jej nie potrzebują.
  const { default: XLSX } = await import('xlsx-js-style')
  type Arkusz = ReturnType<typeof XLSX.utils.aoa_to_sheet>
  const wb = XLSX.utils.book_new()
  const styluj = (ws: Arkusz, wiersz: number, kolumn: number, styl: object) => {
    for (let c = 0; c < kolumn; c++) {
      const adres = XLSX.utils.encode_cell({ r: wiersz, c })
      if (ws[adres]) ws[adres].s = styl
    }
  }
  const STYL_BLOKU = { font: { bold: true, sz: 12 }, fill: { fgColor: { rgb: 'DFF3FB' } } }

  // 1. Linie SAP - wszystko na jednym arkuszu
  const linie: (string | number | null)[][] = []
  const naglowkiBlokow: number[] = []
  const naglowkiKolumn: number[] = []
  const zestawienie: (string | number)[][] = [['Nr zamówienia', 'MPK', 'Nazwa', 'Liczba linii', 'Wartość']]
  const arkusze: { nazwa: string; ws: Arkusz }[] = []
  const uzyte = new Set<string>(['Linie SAP', 'Szczegóły', 'Zestawienie'])
  let razem = 0

  for (const z of zlecenia) {
    const wiersze = wierszeSap(z, materialy)
    const suma = sumaWierszy(wiersze)
    razem += suma
    naglowkiBlokow.push(linie.length)
    linie.push([`Zamówienie ${etykietaZamowienia(z)}  ·  ${z.nazwa}  ·  MPK ${z.mpk}  ·  razem ${suma.toFixed(2).replace('.', ',')} zł`])
    naglowkiKolumn.push(linie.length)
    linie.push([...KOLUMNY_SAP])
    linie.push(...wiersze)
    linie.push([])
    zestawienie.push([etykietaZamowienia(z), z.mpk, z.nazwa, wiersze.length, suma])

    const ws = XLSX.utils.aoa_to_sheet([[...KOLUMNY_SAP], ...wiersze])
    ws['!cols'] = [8, 12, 42, 10, 10, 10, 10, 12, 10, 10, 14].map((wch) => ({ wch }))
    styluj(ws, 0, KOLUMNY_SAP.length, STYL_NAGLOWKA)
    // Nazwa arkusza: max 31 znaków, bez znaków zabronionych, unikalna.
    let nazwa = etykietaZamowienia(z).replace(/[\\/?*[\]:]/g, '_').slice(0, 28)
    let n = 2
    while (uzyte.has(nazwa)) nazwa = `${nazwa.slice(0, 26)}_${n++}`
    uzyte.add(nazwa)
    arkusze.push({ nazwa, ws })
  }
  zestawienie.push(['RAZEM', '', '', '', grosze(razem)])

  const wsL = XLSX.utils.aoa_to_sheet(linie)
  wsL['!cols'] = [8, 12, 42, 10, 10, 10, 10, 12, 10, 10, 14].map((wch) => ({ wch }))
  naglowkiBlokow.forEach((r) => styluj(wsL, r, 1, STYL_BLOKU))
  naglowkiKolumn.forEach((r) => styluj(wsL, r, KOLUMNY_SAP.length, STYL_NAGLOWKA))
  XLSX.utils.book_append_sheet(wb, wsL, 'Linie SAP')

  // 2. Szczegóły - całe rozliczenie
  const szczegoly = [[...KOLUMNY_SZCZEGOLOW], ...zlecenia.flatMap((z) => wierszeSzczegolow(z))]
  const wsS = XLSX.utils.aoa_to_sheet(szczegoly)
  wsS['!cols'] = [14, 26, 6, 22, 8, 10, 40, 8, 6, 10, 12, 12, 8, 10, 18, 14].map((wch) => ({ wch }))
  styluj(wsS, 0, KOLUMNY_SZCZEGOLOW.length, STYL_NAGLOWKA)
  XLSX.utils.book_append_sheet(wb, wsS, 'Szczegóły')

  // 3. Zestawienie
  const wsZ = XLSX.utils.aoa_to_sheet(zestawienie)
  wsZ['!cols'] = [16, 6, 50, 12, 14].map((wch) => ({ wch }))
  styluj(wsZ, 0, 5, STYL_NAGLOWKA)
  styluj(wsZ, zestawienie.length - 1, 5, { font: { bold: true } })
  XLSX.utils.book_append_sheet(wb, wsZ, 'Zestawienie')

  // 4. Arkusz na zamówienie
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
