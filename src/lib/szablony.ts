/**
 * Szablony kart / zleceń.
 *
 * Dodanie nowego typu karty (np. przekładnia, wentylator, dźwignica) = dopisanie obiektu
 * do SZABLONY poniżej i ustawienie `szablon_karty` przy odpowiednich kategoriach cennika
 * (Panel handlowca -> Cennik). Schemat bazy się NIE zmienia: pola wspólne (numer karty,
 * urządzenie, daty, mechanicy) są zwykłymi kolumnami, a pola specyficzne dla szablonu
 * lądują w kolumnie jsonb `dane` (karta) albo `dane_szablonu` (zlecenie).
 */

export type TypPola = 'tekst' | 'liczba' | 'data' | 'dlugi' | 'wybor' | 'tak_nie'

export interface Pole {
  klucz: string
  etykieta: string
  typ: TypPola
  opcje?: string[]
  jednostka?: string
  /** Pole musi być wypełnione, żeby karta liczyła się jako kompletna. */
  wymagane?: boolean
  szerokie?: boolean
}

export interface Szablon {
  id: string
  nazwa: string
  opis: string
  /** Etykiety pól wspólnych karty - różne szablony nazywają je inaczej. */
  etykiety: {
    urzadzenie_nazwa: string
    urzadzenie_typ: string
    urzadzenie_nr: string
    mechanik_przekazujacy: string
    mechanik_przyjmujacy: string
    opis_uszkodzenia: string
  }
  /** Dodatkowe pola nagłówka zlecenia (zapisywane w zlecenia.dane_szablonu). */
  polaZlecenia: Pole[]
  /** Dodatkowe pola karty (zapisywane w karty_remontowe.dane). */
  polaKarty: Pole[]
  /** Checklista zakresu remontu (karty_remontowe.dane.zakres = lista zaznaczonych kluczy). */
  zakresRemontu: { klucz: string; etykieta: string }[]
  /** Dopłaty procentowe dostępne przy pozycjach cennikowych tego szablonu. */
  doplaty: { opis: string; proc: number }[]
}

const WYNIK_KONTROLI = ['pozytywny', 'negatywny', 'warunkowo pozytywny']

export const SZABLONY: Record<string, Szablon> = {
  urzadzenie: {
    id: 'urzadzenie',
    nazwa: 'Pompa / urządzenie ogólne',
    opis: 'Karta remontowa: pompy, mieszadła, przekładnie i urządzenia ogólne.',
    etykiety: {
      urzadzenie_nazwa: 'Nazwa urządzenia',
      urzadzenie_typ: 'Typ urządzenia',
      urzadzenie_nr: 'Nr fabryczny / inwentarzowy',
      mechanik_przekazujacy: 'Mechanik przekazujący (Synthos)',
      mechanik_przyjmujacy: 'Mechanik przyjmujący (Bioerg)',
      opis_uszkodzenia: 'Opis uszkodzenia',
    },
    polaZlecenia: [],
    polaKarty: [
      { klucz: 'miejsce_pracy', etykieta: 'Miejsce pracy urządzenia (budynek / instalacja)', typ: 'tekst' },
      { klucz: 'wykonane_elementy', etykieta: 'Wykonane elementy / części dorobione', typ: 'dlugi', szerokie: true },
      { klucz: 'kontrola_wynik', etykieta: 'Kontrola końcowa - wynik', typ: 'wybor', opcje: WYNIK_KONTROLI, wymagane: true },
      { klucz: 'kontrola_osoba', etykieta: 'Kontrolę przeprowadził', typ: 'tekst', wymagane: true },
      { klucz: 'gwarancja_mies', etykieta: 'Gwarancja', typ: 'liczba', jednostka: 'mies.' },
      { klucz: 'uwagi', etykieta: 'Uwagi', typ: 'dlugi', szerokie: true },
    ],
    // Wstępna lista - do uzgodnienia 1:1 z papierową kartą remontową (skan od Żogały).
    zakresRemontu: [
      { klucz: 'demontaz', etykieta: 'Demontaż' },
      { klucz: 'mycie', etykieta: 'Mycie i czyszczenie' },
      { klucz: 'weryfikacja', etykieta: 'Weryfikacja części' },
      { klucz: 'lozyska', etykieta: 'Wymiana łożysk' },
      { klucz: 'uszczelnienia', etykieta: 'Wymiana uszczelnień (simmeringi, O-ringi)' },
      { klucz: 'uszczelnienie_mech', etykieta: 'Wymiana uszczelnienia mechanicznego' },
      { klucz: 'wal', etykieta: 'Regeneracja / wymiana wału' },
      { klucz: 'wirnik', etykieta: 'Regeneracja / wymiana wirnika' },
      { klucz: 'korpus', etykieta: 'Regeneracja korpusu' },
      { klucz: 'sprzeglo', etykieta: 'Sprzęgło' },
      { klucz: 'montaz', etykieta: 'Montaż' },
      { klucz: 'proba_szczelnosci', etykieta: 'Próba szczelności' },
      { klucz: 'proba_ruchowa', etykieta: 'Próba ruchowa' },
      { klucz: 'malowanie', etykieta: 'Malowanie' },
    ],
    doplaty: [],
  },
  silnik: {
    id: 'silnik',
    nazwa: 'Silnik elektryczny',
    opis: 'Karta rozliczeniowa silnika: parametry, przezwojenie +10%, podmiany.',
    etykiety: {
      urzadzenie_nazwa: 'Silnik (nazwa / opis)',
      urzadzenie_typ: 'Typ silnika',
      urzadzenie_nr: 'Numer silnika',
      mechanik_przekazujacy: 'Przekazał (Synthos)',
      mechanik_przyjmujacy: 'Wykonał / przyjął (Bioerg)',
      opis_uszkodzenia: 'Opis uszkodzenia',
    },
    polaZlecenia: [],
    polaKarty: [
      { klucz: 'budynek', etykieta: 'Budynek', typ: 'tekst', wymagane: true },
      { klucz: 'stanowisko', etykieta: 'Stanowisko', typ: 'tekst' },
      { klucz: 'moc_kw', etykieta: 'Moc', typ: 'liczba', jednostka: 'kW', wymagane: true },
      { klucz: 'napiecie_v', etykieta: 'Napięcie', typ: 'liczba', jednostka: 'V' },
      { klucz: 'obroty', etykieta: 'Obroty', typ: 'liczba', jednostka: 'obr/min', wymagane: true },
      { klucz: 'przezwojenie', etykieta: 'Przezwojenie', typ: 'tak_nie' },
      { klucz: 'podmiany', etykieta: 'Podmiany', typ: 'dlugi', szerokie: true },
      { klucz: 'uwagi', etykieta: 'Uwagi', typ: 'dlugi', szerokie: true },
    ],
    zakresRemontu: [
      { klucz: 'pomiary', etykieta: 'Pomiary elektryczne (izolacja, rezystancja)' },
      { klucz: 'demontaz', etykieta: 'Demontaż' },
      { klucz: 'czyszczenie', etykieta: 'Czyszczenie, suszenie uzwojeń' },
      { klucz: 'lozyska', etykieta: 'Wymiana łożysk' },
      { klucz: 'przezwojenie', etykieta: 'Przezwojenie' },
      { klucz: 'impregnacja', etykieta: 'Impregnacja' },
      { klucz: 'wentylator', etykieta: 'Wentylator / osłona' },
      { klucz: 'tabliczka', etykieta: 'Tabliczka zaciskowa' },
      { klucz: 'montaz', etykieta: 'Montaż' },
      { klucz: 'proba', etykieta: 'Próba biegu jałowego' },
      { klucz: 'malowanie', etykieta: 'Malowanie' },
    ],
    doplaty: [{ opis: 'Przezwojenie', proc: 10 }],
  },
}

export const SZABLON_DOMYSLNY = 'urzadzenie'

export function szablon(id: string | null | undefined): Szablon {
  return SZABLONY[id ?? ''] ?? SZABLONY[SZABLON_DOMYSLNY]
}

/** Lista brakujących pól karty (wspólnych i z szablonu) - pusta = karta kompletna. */
export function brakiKarty(k: {
  numer_karty: string
  urzadzenie_nazwa: string
  data_zakonczenia: string
  mechanik_przyjmujacy: string
  szablon: string
  dane: Record<string, unknown>
}): string[] {
  const s = szablon(k.szablon)
  const braki: string[] = []
  if (!k.numer_karty.trim()) braki.push('numer karty')
  if (!k.urzadzenie_nazwa.trim()) braki.push(s.etykiety.urzadzenie_nazwa.toLowerCase())
  if (!k.data_zakonczenia) braki.push('data zakończenia')
  if (!k.mechanik_przyjmujacy.trim()) braki.push(s.etykiety.mechanik_przyjmujacy.toLowerCase())
  for (const p of s.polaKarty) {
    if (!p.wymagane) continue
    const w = k.dane[p.klucz]
    if (w === undefined || w === null || String(w).trim() === '') braki.push(p.etykieta.toLowerCase())
  }
  return braki
}
