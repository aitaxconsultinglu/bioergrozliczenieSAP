export type Rola = 'kierownik' | 'handlowiec'
export type StatusZlecenia = 'roboczy' | 'zlozony' | 'zwrocony' | 'wyeksportowany'
export type StatusBraku = 'zgloszony' | 'uzupelniony' | 'rozliczony'
export type Dostawca = 'bioerg' | 'synthos'

export interface Profil {
  id: string
  email: string
  imie_nazwisko: string | null
  rola: Rola
  wymaga_zmiany_hasla: boolean
  mpk: string[]
}

export interface Kategoria {
  nr_pozycji: number
  nazwa: string
  wymaga_karty: boolean
  szablon_karty: string | null
}

export interface PozycjaCennika {
  id: number
  nr_pozycji: number
  numer_linii: number
  indeks_sap: string
  opis: string
  jm: string
  cena: number
  aktywna: boolean
}

export interface Stawka {
  cennik_pozycja_id: number
  stanowisko: string
  pora: Pora
  indeks_sap: string
  cena: number
  numer_linii: number
}
export type Pora = '7-15' | '15-19' | '19-7' | 'wolne' | 'stala'

export interface Zlecenie {
  id: string
  mpk: string
  nr_zamowienia: string | null
  pozycja_zamowienia: number | null
  konto: string | null
  nazwa: string
  mechanik: string | null
  szablon: string
  dane_szablonu: Record<string, unknown>
  data_przyjecia: string | null
  data_zakonczenia: string | null
  status: StatusZlecenia
  uwagi: string | null
  komentarz_handlowca: string | null
  utworzono: string
  zmodyfikowano: string
  zlozono: string | null
  wyeksportowano: string | null
}

/** Wiersz formularza - id puste dla wierszy jeszcze niezapisanych. */
export interface PozycjaUslugi {
  id?: number
  klucz: string
  cennik_pozycja_id: number
  ilosc: number
  cena?: number
  doplata_proc: number
  doplata_opis: string | null
  mpk_wykonawcy: string | null
  opis: string | null
}

export interface PozycjaMaterialowa {
  id?: number
  klucz: string
  nazwa: string
  ilosc: number
  jm: string
  wartosc_zakupu: number
  dostawca: Dostawca
  narzut_proc: number
  numer_faktury: string | null
}

export interface KartaRemontowa {
  id?: string
  klucz: string
  numer_karty: string
  szablon: string
  urzadzenie_nazwa: string
  urzadzenie_typ: string
  urzadzenie_nr: string
  klient: string
  data_przyjecia: string
  data_zakonczenia: string
  mechanik_przekazujacy: string
  mechanik_przyjmujacy: string
  opis_uszkodzenia: string
  dane: Record<string, unknown>
}

export interface BrakGodzin {
  id?: number
  klucz: string
  cennik_pozycja_id: number | null
  ilosc_rbg: number
  status: StatusBraku
  opis: string | null
}
