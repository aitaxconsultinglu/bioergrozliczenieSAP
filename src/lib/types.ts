export type Rola = 'kierownik' | 'handlowiec'
export type StatusZlecenia = 'roboczy' | 'zlozony' | 'zwrocony' | 'wyeksportowany' | 'zakonczony'
export type StatusBraku = 'zgloszony' | 'uzupelniony' | 'rozliczony'
/** 'bioerg', 'synthos' albo dowolny wpisany tekst (lista jest otwarta). */
export type Dostawca = string

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
  linia_uslugi: number | null
  linia_materialy: number | null
  nr_azo: string | null
  uwagi: string | null
  komentarz_handlowca: string | null
  utworzono: string
  zmodyfikowano: string
  zlozono: string | null
  wyeksportowano: string | null
  zakonczono: string | null
}

/** Wiersz formularza - id puste dla wierszy jeszcze niezapisanych. */
export interface PozycjaUslugi {
  id?: number
  klucz: string
  /** null = pozycja spoza cennika (wlasny_opis + wlasna_cena) */
  cennik_pozycja_id: number | null
  ilosc: number
  cena?: number
  wlasny_opis?: string | null
  wlasna_jm?: string | null
  wlasna_cena?: number | null
  wlasny_indeks?: string | null
  /** null/undefined = jak w kategorii cennika; false = karta niepotrzebna mimo kategorii */
  wymaga_karty?: boolean | null
  /** Nr linii zamówienia SAP dla tej pozycji (nadaje Synthos); pusty = nr linii zlecenia */
  nr_linii_sap?: number | null
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
  /** Tylko w formularzu: cena zakupu za JM - trzymana osobno, żeby nie zginęła, gdy ilość chwilowo = 0 (np. przy wpisywaniu „0,5”). */
  cena_zakupu?: number
}

/** Usługa obca (np. wyważanie zlecone firmie zewnętrznej) - sprzedawana z narzutem, w SAP pod „Usługa obca + 10%”. */
export interface UslugaObca {
  id?: number
  klucz: string
  opis: string
  wykonawca: string | null
  numer_faktury: string | null
  wartosc_zakupu: number
  narzut_proc: number
  nr_linii_sap: number | null
}

export type TypZalacznika = 'karta_remontowa' | 'faktura_uslugi_obcej' | 'inne'

export interface Zalacznik {
  id: string
  zlecenie_id: string
  typ: TypZalacznika
  usluga_obca_id: number | null
  liczba_kart: number
  nazwa_pliku: string
  sciezka: string
  rozmiar: number | null
  utworzono: string
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
  stanowisko_tekst: string | null
  ilosc_rbg: number
  status: StatusBraku
  opis: string | null
}
