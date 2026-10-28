import { CheckCircle2, CircleAlert, FileDown, Plus, Trash2 } from 'lucide-react'
import { SZABLONY, brakiKarty, szablon, type ParametrySilnika, type Pole } from '@/lib/szablony'
import { nowyKlucz } from '@/lib/obliczenia'
import type { KartaRemontowa, Zalacznik } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PoleWyboru } from '../PoleWyboru'
import { Zalaczniki } from '../Zalaczniki'

/** Silnik z pozycji cennika zlecenia - źródło mocy, napięcia i obrotów dla karty. */
export interface SilnikZPozycji extends ParametrySilnika {
  opis: string
}

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
  /** Pobranie PDF wskazanych kart (do załączenia w Synthosie). */
  pdf: (karty: KartaRemontowa[]) => void
  /** Skany kart wgrane jako PDF (wypełnione odręcznie na stanowisku remontu). */
  skany: Zalacznik[]
  zlecenieId: string | null
  mozeDodacZalacznik: boolean
  mozeUsunacZalacznik: (z: Zalacznik) => boolean
  odswiezZalaczniki: () => Promise<void>
  /** Nowe zlecenie: wgranie skanu najpierw zapisuje je jako robocze. */
  zapiszNowe?: { zapisz: () => Promise<string | null>; otworz: (id: string) => void }
  /** Silniki z pozycji cennika - po jednym wpisie na sztukę. */
  silniki: SilnikZPozycji[]
}

const tylkoParametry = (s: SilnikZPozycji): Record<string, string> => {
  const w: Record<string, string> = {}
  if (s.moc_kw) w.moc_kw = s.moc_kw
  if (s.napiecie_v) w.napiecie_v = s.napiecie_v
  if (s.obroty) w.obroty = s.obroty
  return w
}

export function nowaKarta(szablonId: string, numer: string, nazwa: string, mechanik: string): KartaRemontowa {
  return {
    klucz: nowyKlucz(), numer_karty: numer, szablon: szablonId, urzadzenie_nazwa: nazwa,
    urzadzenie_typ: '', urzadzenie_nr: '', klient: 'Synthos', data_przyjecia: '', data_zakonczenia: '',
    mechanik_przekazujacy: '', mechanik_przyjmujacy: mechanik, opis_uszkodzenia: '', dane: {},
  }
}

export function KartyRemontowe({ karty, ustaw, wymagane, szablonZlecenia, nazwaZlecenia, mechanik, numerKarty, edycja, pdf,
  skany, zlecenieId, mozeDodacZalacznik, mozeUsunacZalacznik, odswiezZalaczniki, zapiszNowe, silniki }: Props) {
  const kartWSkanach = skany.reduce((s, z) => s + z.liczba_kart, 0)
  const brakuje = Math.max(0, wymagane - karty.length - kartWSkanach)

  function dodaj(ile: number) {
    // Karta silnika dostaje moc, napięcie i obroty z kolejnego silnika z pozycji cennika.
    const kartSilnikow = karty.filter((k) => k.szablon === 'silnik').length
    const nowe = Array.from({ length: ile }, (_, i) => {
      const k = nowaKarta(szablonZlecenia, numerKarty(i), nazwaZlecenia, mechanik)
      const silnik = szablonZlecenia === 'silnik' ? silniki[kartSilnikow + i] : undefined
      return silnik ? { ...k, urzadzenie_nazwa: k.urzadzenie_nazwa || silnik.opis, dane: tylkoParametry(silnik) } : k
    })
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
          ? <>Pozycje cennikowe tego zlecenia wymagają <strong>{wymagane}</strong> {wymagane === 1 ? 'karty' : 'kart'} remontowych (1 na sztukę). Wypełniono w aplikacji: <strong>{karty.length}</strong>{kartWSkanach > 0 && <>, w skanach PDF: <strong>{kartWSkanach}</strong></>}.</>
          : <>Żadna pozycja tego zlecenia nie wymaga karty remontowej (zaznaczenie „Karta” przy pozycji). Kartę można dodać dobrowolnie.</>}
        {karty.length > 0 && (
          <button onClick={() => pdf(karty)} className="inline-flex items-center gap-1 rounded bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100">
            <FileDown className="h-4 w-4" /> PDF {karty.length > 1 ? `wszystkich kart (${karty.length})` : 'karty'}
          </button>
        )}
        {edycja && brakuje > 0 && (
          <button onClick={() => dodaj(brakuje)} className="ml-auto rounded bg-amber-500 px-3 py-1 text-white hover:bg-amber-600">
            Dodaj brakujące karty ({brakuje})
          </button>
        )}
      </div>

      <div className="rounded-md border border-dashed border-slate-300 p-3">
        <p className="mb-1 text-sm font-medium">Skan karty remontowej (PDF)</p>
        <p className="mb-2 text-xs text-slate-500">
          Karta wypełniona odręcznie na produkcji (własny wzór Bioerg)? Wgraj jej skan - liczy się jak wypełniona karta,
          więc nie trzeba wypełniać karty w aplikacji. Jeśli w jednym pliku jest kilka kart, ustaw ich liczbę.
          Skan można dołożyć także po złożeniu zlecenia.
        </p>
        <Zalaczniki zlecenieId={zlecenieId} zalaczniki={skany} typ="karta_remontowa" mozna={mozeDodacZalacznik}
          mozeUsunac={mozeUsunacZalacznik} zapiszNowe={zapiszNowe} odswiez={odswiezZalaczniki} etykieta="Wgraj skan karty (PDF / zdjęcie)" liczbaKart />
      </div>

      {karty.map((k, i) => (
        <Karta key={k.klucz} karta={k} nr={i + 1} edycja={edycja} zmien={(z) => zmien(k, z)} pdf={() => pdf([k])} silniki={silniki}
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

function Karta({ karta, nr, edycja, zmien, usun, pdf, silniki }: {
  karta: KartaRemontowa
  nr: number
  edycja: boolean
  zmien: (z: Partial<KartaRemontowa>) => void
  usun: () => void
  pdf: () => void
  silniki: SilnikZPozycji[]
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
        <button onClick={pdf} className="ml-auto inline-flex items-center gap-1 text-xs text-blekit-ciemny hover:underline" title="Pobierz kartę jako PDF">
          <FileDown className="h-4 w-4" /> PDF
        </button>
        {edycja && (
          <button onClick={usun} className="text-slate-400 hover:text-red-600" aria-label="Usuń kartę">
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
        <label className="block sm:col-span-2">
          <span className="etykieta">{s.etykiety.opis_uszkodzenia}</span>
          <textarea className="pole" rows={2} disabled={!edycja} value={karta.opis_uszkodzenia}
            onChange={(e) => zmien({ opis_uszkodzenia: e.target.value })} />
        </label>

        {karta.szablon === 'silnik' && silniki.length > 0 && edycja && (
          <label className="block sm:col-span-2">
            <span className="etykieta">Uzupełnij moc / napięcie / obroty z pozycji cennika</span>
            <select className="pole" value="" onChange={(e) => {
              const s = silniki.find((x) => x.opis === e.target.value)
              if (s) zmien({ dane: { ...karta.dane, ...tylkoParametry(s) }, urzadzenie_nazwa: karta.urzadzenie_nazwa || s.opis })
            }}>
              <option value="">wybierz silnik z pozycji zlecenia…</option>
              {[...new Map(silniki.map((s) => [s.opis, s])).values()].map((s) => (
                <option key={s.opis} value={s.opis}>{s.opis}</option>
              ))}
            </select>
          </label>
        )}
        {s.polaKarty.map((p) => (
          <PoleSzablonu key={p.klucz} pole={p} wartosc={karta.dane[p.klucz]} edycja={edycja} zmien={(w) => ustawDane(p.klucz, w)} />
        ))}
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <p className="etykieta">Zakres remontu</p>
        {s.zakresRemontu.length > 0 && (
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {s.zakresRemontu.map((z) => {
              const zaznaczone = zakres.includes(z.klucz)
              return (
                <div key={z.klucz} className="text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={!edycja} checked={zaznaczone}
                      onChange={(e) => {
                        const nowyZakres = e.target.checked ? [...zakres, z.klucz] : zakres.filter((x) => x !== z.klucz)
                        // Odznaczenie czynności czyści jej pomiar, żeby na karcie nie został wynik czynności, której nie było.
                        const dane: Record<string, unknown> = { ...karta.dane, zakres: nowyZakres }
                        if (!e.target.checked && z.pomiar) delete dane[z.pomiar.klucz]
                        zmien({ dane })
                      }} />
                    {z.etykieta}
                  </label>
                  {z.pomiar && (
                    <label className={cn('ml-6 mt-0.5 flex items-center gap-1 text-xs', zaznaczone ? 'text-slate-700' : 'text-slate-400')}>
                      {z.pomiar.etykieta}:
                      <input className="pole w-24 py-0.5 text-right text-sm" inputMode="decimal" disabled={!edycja || !zaznaczone}
                        aria-label={`${z.pomiar.etykieta} [${z.pomiar.jednostka}]`} placeholder={zaznaczone ? '0' : ''}
                        value={String(karta.dane[z.pomiar.klucz] ?? '')}
                        onChange={(e) => ustawDane(z.pomiar!.klucz, e.target.value.replace(/[^\d.,]/g, ''))} />
                      {z.pomiar.jednostka}
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {/* Lista czynności jest otwarta - wszystko, czego nie ma na liście, wpisuje się tutaj. */}
        <input className="pole mt-2" disabled={!edycja} value={String(karta.dane.zakres_inne ?? '')}
          placeholder="Inne czynności, których nie ma na liście (wpisz)" aria-label="Inne czynności"
          onChange={(e) => ustawDane('zakres_inne', e.target.value)} />
      </div>
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
        <PoleWyboru disabled={!edycja} pusta="-" wartosc={String(wartosc ?? '')} zmien={zmien}
          opcje={(pole.opcje ?? []).map((o) => ({ wartosc: o, etykieta: o }))} />
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
