// Klucz "publishable" jest z założenia jawny - dostępu do danych pilnuje RLS po stronie
// Supabase, a nie utajnienie tego ciągu. Klucz service_role NIGDY tu nie trafia.
// Celowo || zamiast ??: nieustawiona zmienna w GitHub Actions podstawia pusty ciąg,
// a nie undefined, więc ?? nie sięgnęłoby po wartość domyślną.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://uitznyuencrhndagqxpg.supabase.co'

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_UNLgoBclwc-Wwzt-JVJJiQ_s5KFu2c8'

export const MIN_DLUGOSC_HASLA = 6
const ZNAKI_SPECJALNE = /[^A-Za-z0-9]/

/** Zwraca komunikat o błędzie albo null, gdy hasło spełnia wymagania. */
export function sprawdzHaslo(haslo: string): string | null {
  if (haslo.length < MIN_DLUGOSC_HASLA) {
    return `Hasło musi mieć co najmniej ${MIN_DLUGOSC_HASLA} znaków.`
  }
  if (!ZNAKI_SPECJALNE.test(haslo)) {
    return 'Hasło musi zawierać co najmniej jeden znak specjalny (np. ! @ # ? -).'
  }
  return null
}

// Supabase zwraca część komunikatów po angielsku, a interfejs jest polski.
const KOMUNIKATY: [RegExp, string][] = [
  [/different from the old password/i, 'Nowe hasło musi różnić się od dotychczasowego.'],
  [/should be at least (\d+) characters/i, 'Hasło jest za krótkie.'],
  [/invalid login credentials/i, 'Nieprawidłowy login lub hasło.'],
  [/email rate limit exceeded/i, 'Za dużo wiadomości w krótkim czasie. Spróbuj ponownie za kilka minut.'],
  [/you can only request this after (\d+) seconds/i, 'Odczekaj chwilę przed kolejną próbą.'],
  [/token has expired or is invalid/i, 'Link wygasł lub został już użyty. Poproś o nowy.'],
  [/password is known to be weak|pwned/i, 'To hasło wyciekło w znanych naruszeniach danych. Wybierz inne.'],
  [/karty_remontowe_numer_karty_key/i, 'Karta o takim numerze już istnieje w innym zleceniu. Zmień numer karty.'],
  [/failed to fetch|network/i, 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie - nic nie zostało utracone, formularz jest nadal wypełniony.'],
  [/JWT expired/i, 'Sesja wygasła. Zaloguj się ponownie.'],
]

export function komunikatPL(wiadomosc: string) {
  for (const [wzorzec, tlumaczenie] of KOMUNIKATY) {
    if (wzorzec.test(wiadomosc)) return tlumaczenie
  }
  return wiadomosc
}
