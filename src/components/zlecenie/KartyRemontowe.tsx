import { CheckCircle2, CircleAlert, Plus, Trash2 } from 'lucide-react'
import { SZABLONY, brakiKarty, szablon, type Pole } from '@/lib/szablony'
import { nowyKlucz } from '@/lib/obliczenia'
import type { KartaRemontowa } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Props {
  karty: KartaRemontowa[]
  ustaw: (k: KartaRemontowa[]) => void
  wymagane: number
  szablonZlecenia: string
  nazwaZlecenia: string
  mechanik: string
  /** Kolejny wolny numer karty; przesunięcie > 0 przy dodawaniu kilku kart naraz. */
  numerKarty: (przesuniecie: number) => string
  edycja: boolean
}

export function nowaKarta(szablonId: string, numer: string, nazwa: string, mechanik: string): KartaRemontowa {
  return {
    klucz: nowyKlucz(), numer_karty: numer, szablon: szablonId, urzadzenie_nazwa: nazwa,
    urzadzenie_typ: '', urzadzenie_nr: '', klient: 'Synthos', data_przyjecia: '', data_zakonczenia: '',
    mechanik_przekazujacy: '', mechanik_przyjmujacy: mechanik, opis_uszkodzenia: '', dane: {},
  }
}

export function KartyRemontowe({ karty, ustaw, wymagane, szablonZlecenia, nazwaZlecenia, mechanik, numerKarty, edycja }: Props) {
  const brakuje = Math.max(0, wymagane - karty.length)

  function dodaj(ile: number) {
    const nowe = Array.from({ length: ile }, (_, i) =>
      nowaKarta(szablonZlecenia, numerKarty(i), nazwaZlecenia, mechanik))
    ustaw([...karty, ...nowe])
  }

  const zmien = (k: KartaRemontowa, zmiana: Partial<KartaRemontowa>) =>
    ustaw(karty.map((x) => (x === k ? { ...x, ...zmiana } : x)))

  return (
    <div className="space-y-4">
      <div className={cn(
        'flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm ring-1',
        brakuje > 0 ? 'bg-amber-50 text-amber-900 ring-amber-300' : 'bg-slate-50 text-slate-700 ring-slate-200',
      )}>
        {wymagane > 0
          ? <>Pozycje cennikowe tego zlecenia wymagają <strong>{wymagane}</strong> {wymagane === 1 ? 'karty' : 'kart'} remontowych (1 na sztukę). Wypełniono: <strong>{karty.length}</strong>.</>
          : <>Żadna pozycja tego zlecenia nie wymaga karty remontowej. Kartę można dodać dobrowolnie.</>}
        {edycja && brakuje > 0 && (
          <button onClick={() => dodaj(brakuje)} className="ml-auto rounded bg-amber-500 px-3 py-1 text-white hover:bg-amber-600">
            Dodaj brakujące karty ({brakuje})
          </button>
        )}
      </div>

      {karty.map((k, i) => (
        <Karta key={k.klucz} karta={k} nr={i + 1} edycja={edycja} zmien={(z) => zmien(k, z)}
          usun={() => ustaw(karty.filter((x) => x !== k))} />
      ))}

      {edycja && (
        <button className="inline-flex items-center gap-1 text-sm text-blekit-ciemny hover:underline" onClick={() => dodaj(1)}>
          <Plus className="h-4 w-4" /> Dodaj kartę remontową
        </button>
      )}
    </div>
  )
}

function Karta({ karta, nr, edycja, zmien, usun }: {
  karta: KartaRemontowa
  nr: number
  edycja: boolean
  zmien: (z: Partial<KartaRemontowa>) => void
  usun: () => void
}) {
  const s = szablon(karta.szablon)
  const braki = brakiKarty(karta)
  const zakres = (karta.dane.zakres as string[] | undefined) ?? []
  const ustawDane = (klucz: string, w: unknown) => zmien({ dane: { ...karta.dane, [klucz]: w } })

  const poleTekstowe = (klucz: keyof KartaRemontowa, etykieta: string, typ: 'text' | 'date' = 'text', wymagane = false) => (
    <label className="block">
      <span className="etykieta">{etykieta}{wymagane && <span className="text-red-600"> *</span>}</span>
      <input type={typ} className="pole" disabled={!edycja} value={String(karta[klucz] ?? '')}
        onChange={(e) => zmien({ [klucz]: e.target.value } as Partial<KartaRemontowa>)} />
    </label>
  )

  return (
    <div className="rounded-lg border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <h4 className="font-semibold">Karta {nr}: {karta.numer_karty || 'bez numeru'}</h4>
        <select className="pole w-auto py-1 text-xs" disabled={!edycja} value={karta.szablon}
          onChange={(e) => zmien({ szablon: e.target.value })} aria-label="Szablon karty">
          {Object.values(SZABLONY).map((sz) => <option key={sz.id} value={sz.id}>{sz.nazwa}</option>)}
        </select>
        {braki.length === 0
          ? <span className="inline-flex items-center gap-1 text-xs text-limonka-ciemna"><CheckCircle2 className="h-4 w-4" /> kompletna</span>
          : <span className="inline-flex items-center gap-1 text-xs text-amber-700"><CircleAlert className="h-4 w-4" /> brakuje: {braki.join(', ')}</span>}
        {edycja && (
          <button onClick={usun} className="ml-auto text-slate-400 hover:text-red-600" aria-label="Usuń kartę">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {poleTekstowe('numer_karty', 'Numer karty', 'text', true)}
        {poleTekstowe('urzadzenie_nazwa', s.etykiety.urzadzenie_nazwa, 'text', true)}
        {poleTekstowe('urzadzenie_typ', s.etykiety.urzadzenie_typ)}
        {poleTekstowe('urzadzenie_nr', s.etykiety.urzadzenie_nr)}
        {poleTekstowe('klient', 'Klient')}
        {poleTekstowe('data_przyjecia', 'Data przyjęcia', 'date')}
        {poleTekstowe('data_zakonczenia', 'Data zakończenia', 'date', true)}
        <div />
        {poleTekstowe('mechanik_przekazujacy', s.etykiety.mechanik_przekazujacy)}
        {poleTekstowe('mechanik_przyjmujacy', s.etykiety.mechanik_przyjmujacy, 'text', true)}
        <label className="block sm:col-span-2">
          <span className="etykieta">{s.etykiety.opis_uszkodzenia}</span>
          <textarea className="pole" rows={2} disabled={!edycja} value={karta.opis_uszkodzenia}
            onChange={(e) => zmien({ opis_uszkodzenia: e.target.value })} />
        </label>

        {s.polaKarty.map((p) => (
          <PoleSzablonu key={p.klucz} pole={p} wartosc={karta.dane[p.klucz]} edycja={edycja} zmien={(w) => ustawDane(p.klucz, w)} />
        ))}
      </div>

      {s.zakresRemontu.length > 0 && (
        <div className="border-t border-slate-200 px-4 py-3">
          <p className="etykieta">Zakres remontu</p>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {s.zakresRemontu.map((z) => (
              <label key={z.klucz} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!edycja} checked={zakres.includes(z.klucz)}
                  onChange={(e) => ustawDane('zakres', e.target.checked ? [...zakres, z.klucz] : zakres.filter((x) => x !== z.klucz))} />
                {z.etykieta}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PoleSzablonu({ pole, wartosc, edycja, zmien }: { pole: Pole; wartosc: unknown; edycja: boolean; zmien: (w: unknown) => void }) {
  const etykieta = (
    <span className="etykieta">
      {pole.etykieta}{pole.jednostka ? ` [${pole.jednostka}]` : ''}{pole.wymagane && <span className="text-red-600"> *</span>}
    </span>
  )
  const klasa = pole.szerokie ? 'block sm:col-span-2' : 'block'
  if (pole.typ === 'tak_nie') {
    return (
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" disabled={!edycja} checked={wartosc === true} onChange={(e) => zmien(e.target.checked)} />
        {pole.etykieta}
      </label>
    )
  }
  if (pole.typ === 'wybor') {
    return (
      <label className={klasa}>
        {etykieta}
        <select className="pole" disabled={!edycja} value={String(wartosc ?? '')} onChange={(e) => zmien(e.target.value)}>
          <option value="">-</option>
          {pole.opcje?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    )
  }
  if (pole.typ === 'dlugi') {
    return (
      <label className={klasa}>
        {etykieta}
        <textarea className="pole" rows={2} disabled={!edycja} value={String(wartosc ?? '')} onChange={(e) => zmien(e.target.value)} />
      </label>
    )
  }
  return (
    <label className={klasa}>
      {etykieta}
      <input
        className="pole"
        type={pole.typ === 'data' ? 'date' : 'text'}
        inputMode={pole.typ === 'liczba' ? 'decimal' : undefined}
        disabled={!edycja}
        value={String(wartosc ?? '')}
        onChange={(e) => zmien(e.target.value)}
      />
    </label>
  )
}
