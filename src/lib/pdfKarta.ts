/**
 * PDF karty remontowej - do załączenia do arkusza rozliczeniowego w Synthosie.
 * Układ wg pól karty z briefu (BRIEF 3.4). Gdy dział handlowy prześle wzór, dopasowuje się
 * tylko tę funkcję. jsPDF ładowany dynamicznie - kierownik pobiera go dopiero przy wydruku.
 * Font DejaVu Sans z public/fonts: wbudowane fonty jsPDF nie mają polskich znaków.
 */
import type { jsPDF as JsPDF } from 'jspdf'
import { szablon } from './szablony'
import { czySynthos } from './obliczenia'
import { dataPL } from './format'
import type { KartaRemontowa, PozycjaMaterialowa } from './types'

export interface KontekstKarty {
  nazwaZlecenia: string
  nrZamowienia: string
  konto: string
  mpk: string
}

let font: Promise<string | null> | null = null
function pobierzFont() {
  font ??= (async () => {
    try {
      const odp = await fetch(`${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf`)
      if (!odp.ok) return null
      const bajty = new Uint8Array(await odp.arrayBuffer())
      let binarne = ''
      for (let i = 0; i < bajty.length; i += 8192) binarne += String.fromCharCode(...bajty.subarray(i, i + 8192))
      return btoa(binarne)
    } catch {
      return null
    }
  })()
  return font
}

const KROJ = 'DejaVuSans'
const MARGINES = 14

function naglowekSekcji(doc: JsPDF, tekst: string, y: number) {
  doc.setFillColor(238, 249, 196)
  doc.rect(MARGINES, y - 4.2, 210 - 2 * MARGINES, 6, 'F')
  doc.setFontSize(10)
  doc.setTextColor(30, 30, 30)
  doc.text(tekst.toUpperCase(), MARGINES + 2, y)
  return y + 5
}

function blokTekstu(doc: JsPDF, tekst: string, y: number, minWys = 12) {
  doc.setFontSize(9)
  const linie = doc.splitTextToSize(tekst || ' ', 210 - 2 * MARGINES - 4) as string[]
  const wys = Math.max(minWys, linie.length * 4.2 + 3)
  doc.setDrawColor(180)
  doc.rect(MARGINES, y - 1, 210 - 2 * MARGINES, wys)
  doc.text(linie, MARGINES + 2, y + 3)
  return y + wys + 4
}

export async function pdfKart(karty: KartaRemontowa[], kontekst: KontekstKarty, materialy: PozycjaMaterialowa[]): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }, fontB64] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), pobierzFont(),
  ])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  if (fontB64) {
    doc.addFileToVFS('DejaVuSans.ttf', fontB64)
    doc.addFont('DejaVuSans.ttf', KROJ, 'normal')
  }
  const kroj = fontB64 ? KROJ : 'helvetica'
  const stylTabeli = {
    styles: { font: kroj, fontStyle: 'normal' as const, fontSize: 8.5, cellPadding: 1.2, lineColor: 190, lineWidth: 0.2, textColor: 30 },
    headStyles: { font: kroj, fontStyle: 'normal' as const, fillColor: [238, 241, 232] as [number, number, number], textColor: 30 },
    margin: { left: MARGINES, right: MARGINES },
  }

  karty.forEach((k, idx) => {
    if (idx > 0) doc.addPage()
    const s = szablon(k.szablon)
    doc.setFont(kroj, 'normal')

    // Nagłówek
    doc.setFontSize(9)
    doc.setTextColor(90)
    doc.text('Bioerg Sp. z o.o.', MARGINES, 14)
    doc.text(`Klient: ${k.klient || 'Synthos'}`, 210 - MARGINES, 14, { align: 'right' })
    doc.setTextColor(20)
    doc.setFontSize(16)
    doc.text('KARTA REMONTOWA', MARGINES, 23)
    doc.setFontSize(12)
    doc.text(`nr ${k.numer_karty || '..........'}`, 210 - MARGINES, 23, { align: 'right' })
    doc.setFontSize(9)
    doc.setTextColor(90)
    doc.text(s.nazwa, MARGINES, 28.5)
    doc.setDrawColor(196, 232, 42)
    doc.setLineWidth(0.8)
    doc.line(MARGINES, 31, 210 - MARGINES, 31)
    doc.setLineWidth(0.2)
    doc.setTextColor(20)

    // Dane podstawowe - pary etykieta/wartość w 4 kolumnach
    const krotkie = s.polaKarty.filter((p) => p.typ !== 'dlugi' && !['kontrola_wynik', 'kontrola_osoba', 'gwarancja_mies'].includes(p.klucz))
    const wartoscPola = (klucz: string, typ: string) => {
      const w = k.dane[klucz]
      if (typ === 'tak_nie') return w === true ? 'TAK' : 'NIE'
      return w === undefined || w === null ? '' : String(w)
    }
    const pary: [string, string][] = [
      ['Nr zamówienia', kontekst.nrZamowienia],
      ['Zlecenie', kontekst.nazwaZlecenia],
      [s.etykiety.urzadzenie_nazwa, k.urzadzenie_nazwa],
      [s.etykiety.urzadzenie_typ, k.urzadzenie_typ],
      [s.etykiety.urzadzenie_nr, k.urzadzenie_nr],
      ['Konto / MPK', [kontekst.konto, kontekst.mpk].filter(Boolean).join(' / ')],
      ['Data przyjęcia', dataPL(k.data_przyjecia)],
      ['Data zakończenia', dataPL(k.data_zakonczenia)],
      [s.etykiety.mechanik_przekazujacy, k.mechanik_przekazujacy],
      [s.etykiety.mechanik_przyjmujacy, k.mechanik_przyjmujacy],
      ...krotkie.map((p): [string, string] => [`${p.etykieta}${p.jednostka ? ` [${p.jednostka}]` : ''}`, wartoscPola(p.klucz, p.typ)]),
    ]
    const wiersze: string[][] = []
    for (let i = 0; i < pary.length; i += 2) wiersze.push([pary[i][0], pary[i][1], pary[i + 1]?.[0] ?? '', pary[i + 1]?.[1] ?? ''])
    autoTable(doc, {
      ...stylTabeli,
      startY: 35,
      body: wiersze,
      columnStyles: { 0: { cellWidth: 46, textColor: 90 }, 1: { cellWidth: 45 }, 2: { cellWidth: 46, textColor: 90 }, 3: { cellWidth: 45 } },
    })
    let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

    y = naglowekSekcji(doc, s.etykiety.opis_uszkodzenia, y)
    y = blokTekstu(doc, k.opis_uszkodzenia, y + 1, 9)

    // Zakres remontu - checklista
    const zakres = (k.dane.zakres as string[] | undefined) ?? []
    y = naglowekSekcji(doc, 'Zakres remontu', y)
    doc.setFontSize(9)
    const kolumny = 2
    const szer = (210 - 2 * MARGINES) / kolumny
    s.zakresRemontu.forEach((z, i) => {
      const x = MARGINES + 2 + (i % kolumny) * szer
      const yy = y + 3 + Math.floor(i / kolumny) * 4.4
      doc.text(`${zakres.includes(z.klucz) ? '☒' : '☐'}  ${z.etykieta}`, x, yy)
    })
    y += 3 + Math.ceil(s.zakresRemontu.length / kolumny) * 4.4
    const inne = String(k.dane.zakres_inne ?? '').trim()
    if (inne) {
      const linie = doc.splitTextToSize(`Inne czynności: ${inne}`, 210 - 2 * MARGINES - 4) as string[]
      doc.text(linie, MARGINES + 2, y + 2)
      y += linie.length * 4.2 + 2
    }
    y += 4

    // Materiały i części
    y = naglowekSekcji(doc, 'Wykaz użytych materiałów i części', y)
    autoTable(doc, {
      ...stylTabeli,
      startY: y,
      head: [['Lp.', 'Nazwa materiału / części', 'Ilość', 'JM', 'Dostarczył']],
      body: materialy.length
        ? materialy.map((m, i) => [String(i + 1), m.nazwa, m.ilosc.toLocaleString('pl-PL'), m.jm,
            czySynthos(m.dostawca) ? 'Synthos' : m.dostawca === 'bioerg' ? 'Bioerg' : m.dostawca])
        : [['', '(brak)', '', '', '']],
      columnStyles: { 0: { cellWidth: 10 }, 2: { cellWidth: 18, halign: 'right' }, 3: { cellWidth: 14 }, 4: { cellWidth: 32 } },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
    if (karty.length > 1) {
      doc.setFontSize(7.5)
      doc.setTextColor(110)
      doc.text('Wykaz obejmuje materiał całego zlecenia.', MARGINES, y - 2)
      doc.setTextColor(20)
      y += 2
    }

    // Pola opisowe szablonu (wykonane elementy, podmiany, uwagi...)
    for (const p of s.polaKarty.filter((x) => x.typ === 'dlugi')) {
      if (y > 262) { doc.addPage(); y = 20 }
      y = naglowekSekcji(doc, p.etykieta, y)
      y = blokTekstu(doc, wartoscPola(p.klucz, p.typ), y + 1, 8)
    }

    // Kontrola końcowa, gwarancja, podpisy
    // Sekcja kontroli z podpisami zajmuje ~40 mm - stopka strony jest na 290 mm.
    if (y > 252) { doc.addPage(); y = 20 }
    y = naglowekSekcji(doc, 'Kontrola końcowa i gwarancja', y)
    doc.setFontSize(9)
    doc.text(`Wynik kontroli: ${wartoscPola('kontrola_wynik', 'tekst') || '....................'}`, MARGINES + 2, y + 3)
    doc.text(`Kontrolę przeprowadził: ${wartoscPola('kontrola_osoba', 'tekst') || '....................'}`, MARGINES + 75, y + 3)
    const gw = wartoscPola('gwarancja_mies', 'tekst')
    doc.text(`Gwarancja: ${gw ? `${gw} mies.` : '..........'}`, MARGINES + 150, y + 3)
    y += 17

    const podpisy = [s.etykiety.mechanik_przekazujacy, s.etykiety.mechanik_przyjmujacy, 'Kontrola końcowa']
    const szerP = (210 - 2 * MARGINES - 8) / 3
    podpisy.forEach((etykieta, i) => {
      const x = MARGINES + i * (szerP + 4)
      doc.setDrawColor(120)
      doc.line(x, y, x + szerP, y)
      doc.setFontSize(7.5)
      doc.setTextColor(90)
      doc.text(doc.splitTextToSize(`data i podpis: ${etykieta}`, szerP) as string[], x, y + 4)
    })
    doc.setTextColor(20)

    doc.setFontSize(7)
    doc.setTextColor(140)
    doc.text(`Wygenerowano z aplikacji Rozliczenia SAP · ${new Date().toLocaleString('pl-PL')} · karta ${idx + 1}/${karty.length}`,
      MARGINES, 290)
    doc.setTextColor(20)
  })

  return doc.output('blob')
}

export function nazwaPlikuKart(karty: KartaRemontowa[], nrZamowienia: string) {
  const nr = karty.length === 1 ? karty[0].numer_karty : `${karty.length}_kart`
  return `Karta_remontowa_${nr || 'bez_numeru'}_${nrZamowienia || 'bez_zamowienia'}.pdf`.replace(/[\\/:*?"<>|\s]+/g, '_')
}
