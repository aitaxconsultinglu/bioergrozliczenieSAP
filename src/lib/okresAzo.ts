/** Okres rozliczeniowy odczytany z numeru AZO.
 *
 *  Numer AZO ma postać `AZO/<nr>/<MM>/<RRRR>`, np. `AZO/105/10/2026` - miesiąc i rok są
 *  w nim zawsze, więc to one, a nie data utworzenia zlecenia w aplikacji, wyznaczają
 *  okres rozliczenia. Zlecenie wprowadzone 2 listopada z numerem `AZO/176/10/2026`
 *  należy do rozliczenia za PAŹDZIERNIK i w listopadzie nie ma czego szukać.
 *
 *  Pole bywa wypełnione KILKOMA numerami rozdzielonymi przecinkiem
 *  (`AZO/115/10/2026, AZO/159/10/2026`) - to jedno zlecenie obejmujące dwa AZO.
 *  Okres bierzemy wtedy z pierwszego numeru; gdyby numery wskazywały różne miesiące,
 *  mówi o tym `mieszany`, żeby lista mogła to pokazać zamiast cicho wybrać jeden.
 */

export interface Okres {
  rok: number
  miesiac: number
}

export interface OkresZAzo extends Okres {
  /** Pole zawierało więcej niż jeden numer AZO i wskazywały różne miesiące. */
  mieszany: boolean
}

export const MIESIACE_PL = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
]

/** Klucz okresu do porównań i do zapamiętania wyboru: `2026-10`. */
export function kluczOkresu(o: Okres) {
  return `${o.rok}-${String(o.miesiac).padStart(2, '0')}`
}

export function nazwaMiesiaca(miesiac: number) {
  return MIESIACE_PL[miesiac - 1] ?? String(miesiac)
}

/** Okres z JEDNEGO numeru AZO albo null, gdy nie da się go odczytać.
 *
 *  Bierzemy DWIE OSTATNIE grupy cyfr, a nie drugą i trzecią od początku: numer kolejny
 *  bywa jedno-, dwu- i trzycyfrowy, a zapis przedrostka nie jest pewny (`AZO/105/10/2026`,
 *  `AZO 105/10/2026`, `105/10/2026`). Miesiąc i rok stoją zawsze na końcu, więc liczenie
 *  od końca jest jedyną regułą, która nie wywraca się na nietypowym zapisie. */
function okresZJednego(tekst: string): Okres | null {
  const grupy = tekst.match(/\d+/g)
  if (!grupy || grupy.length < 2) return null

  const rokTekst = grupy[grupy.length - 1]
  const miesiacTekst = grupy[grupy.length - 2]
  // Rok musi być zapisany czterocyfrowo albo dwucyfrowo - inaczej nie wiadomo, czy
  // „10/26” to październik 2026, czy dziesiąty numer z roku 26.
  if (rokTekst.length !== 4 && rokTekst.length !== 2) return null
  if (miesiacTekst.length > 2) return null

  const rok = rokTekst.length === 2 ? 2000 + Number(rokTekst) : Number(rokTekst)
  const miesiac = Number(miesiacTekst)
  if (miesiac < 1 || miesiac > 12) return null
  // Zakres chroni przed uznaniem numeru kolejnego za rok, np. „AZO/1234” -> rok 1234.
  if (rok < 2000 || rok > 2100) return null
  return { rok, miesiac }
}

/** Okres rozliczeniowy z pola `nr_azo` (może zawierać kilka numerów). */
export function okresZAzo(nrAzo: string | null | undefined): OkresZAzo | null {
  if (!nrAzo) return null
  const okresy = nrAzo
    .split(/[,;]/)
    .map((czesc) => okresZJednego(czesc))
    .filter((o): o is Okres => o !== null)
  if (okresy.length === 0) return null

  const pierwszy = okresy[0]
  const mieszany = okresy.some((o) => o.rok !== pierwszy.rok || o.miesiac !== pierwszy.miesiac)
  return { ...pierwszy, mieszany }
}

/** Lata i miesiące FAKTYCZNIE występujące w danych, od najnowszego.
 *
 *  Buduje się z wczytanych zleceń, a nie z kalendarza: zakładka ma być tylko dla
 *  miesięcy, w których coś wprowadzono - inaczej przy rosnącej bazie lista zamieniłaby
 *  się w pustą ścianę dwunastu miesięcy na każdy rok. */
export interface DrzewoOkresow {
  lata: {
    rok: number
    ile: number
    miesiace: { miesiac: number; ile: number }[]
  }[]
  /** Zlecenia, z których nie dało się odczytać okresu (brak albo nietypowy numer AZO). */
  bezOkresu: number
}

export function zbudujDrzewoOkresow(
  zlecenia: { nr_azo: string | null }[],
): DrzewoOkresow {
  const wgRoku = new Map<number, Map<number, number>>()
  let bezOkresu = 0

  for (const z of zlecenia) {
    const o = okresZAzo(z.nr_azo)
    if (!o) { bezOkresu++; continue }
    const miesiace = wgRoku.get(o.rok) ?? new Map<number, number>()
    miesiace.set(o.miesiac, (miesiace.get(o.miesiac) ?? 0) + 1)
    wgRoku.set(o.rok, miesiace)
  }

  const lata = [...wgRoku.entries()]
    .map(([rok, miesiace]) => ({
      rok,
      ile: [...miesiace.values()].reduce((s, n) => s + n, 0),
      miesiace: [...miesiace.entries()]
        .map(([miesiac, ile]) => ({ miesiac, ile }))
        .sort((a, b) => b.miesiac - a.miesiac),
    }))
    .sort((a, b) => b.rok - a.rok)

  return { lata, bezOkresu }
}
