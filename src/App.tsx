import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { DostawcaSlownikow, useSlowniki } from '@/lib/slowniki'
import type { Profil } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Logowanie } from './components/Logowanie'
import { UstawHaslo } from './components/UstawHaslo'
import { ListaZlecen } from './components/ListaZlecen'
import { EdytorZlecenia } from './components/EdytorZlecenia'
import { PanelEksportu } from './components/PanelEksportu'
import { BrakiGodzin } from './components/BrakiGodzin'
import { Cennik } from './components/Cennik'
import { Uzytkownicy } from './components/Uzytkownicy'
import { Button } from './components/ui/button'

type Widok = 'zlecenia' | 'eksport' | 'braki' | 'cennik' | 'uzytkownicy'

export default function App() {
  const [sesja, setSesja] = useState<Session | null>(null)
  const [profil, setProfil] = useState<Profil | null>(null)
  const [ladowanie, setLadowanie] = useState(true)
  const [odzyskiwanie, setOdzyskiwanie] = useState(false)
  const [zmianaHasla, setZmianaHasla] = useState(false)

  const wczytajProfil = useCallback(async (userId: string) => {
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from('profiles').select('id, email, imie_nazwisko, rola, wymaga_zmiany_hasla').eq('id', userId).maybeSingle(),
      supabase.from('profile_mpk').select('mpk_kod').eq('profile_id', userId).order('mpk_kod'),
    ])
    setProfil(p ? ({ ...p, mpk: (m ?? []).map((x) => x.mpk_kod) } as Profil) : null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesja(data.session)
      setLadowanie(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((zdarzenie, s) => {
      if (zdarzenie === 'PASSWORD_RECOVERY') setOdzyskiwanie(true)
      setSesja(s)
      if (!s) {
        setProfil(null)
        setOdzyskiwanie(false)
        setZmianaHasla(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (sesja) void wczytajProfil(sesja.user.id)
  }, [sesja?.user.id, wczytajProfil]) // eslint-disable-line react-hooks/exhaustive-deps

  if (ladowanie) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Wczytywanie...</div>
  }
  if (!sesja) return <Logowanie />

  if (odzyskiwanie || zmianaHasla) {
    return (
      <UstawHaslo
        powod="odzyskiwanie"
        email={sesja.user.email ?? ''}
        gotowe={() => {
          setOdzyskiwanie(false)
          setZmianaHasla(false)
          void wczytajProfil(sesja.user.id)
        }}
      />
    )
  }
  if (profil?.wymaga_zmiany_hasla) {
    return <UstawHaslo powod="pierwsze-logowanie" email={sesja.user.email ?? ''} gotowe={() => void wczytajProfil(sesja.user.id)} />
  }
  if (!profil) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Wczytywanie profilu...</div>
  }
  if (profil.rola === 'kierownik' && profil.mpk.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="max-w-md text-slate-700">
          Konto <strong>{profil.email}</strong> nie ma jeszcze przypisanego żadnego MPK.
          Poproś dział handlowy o nadanie dostępu.
        </p>
        <Button onClick={() => supabase.auth.signOut()}>Wyloguj</Button>
      </div>
    )
  }

  return (
    <DostawcaSlownikow>
      <Aplikacja profil={profil} zmienHaslo={() => setZmianaHasla(true)} />
    </DostawcaSlownikow>
  )
}

function Aplikacja({ profil, zmienHaslo }: { profil: Profil; zmienHaslo: () => void }) {
  const { gotowe, blad, odswiez } = useSlowniki()
  const [widok, setWidok] = useState<Widok>('zlecenia')
  // null = lista, 'nowe' = nowe zlecenie, uuid = edycja istniejącego
  const [otwarte, setOtwarte] = useState<string | null>(null)
  const handlowiec = profil.rola === 'handlowiec'

  const zakladki: { id: Widok; etykieta: string }[] = handlowiec
    ? [
        { id: 'zlecenia', etykieta: 'Zlecenia' },
        { id: 'eksport', etykieta: 'Eksport do SAP' },
        { id: 'braki', etykieta: 'Braki godzin' },
        { id: 'cennik', etykieta: 'Cennik' },
        { id: 'uzytkownicy', etykieta: 'Użytkownicy' },
      ]
    : [
        { id: 'zlecenia', etykieta: 'Moje zlecenia' },
        { id: 'braki', etykieta: 'Braki godzin' },
        { id: 'cennik', etykieta: 'Cennik' },
      ]

  return (
    <div className="min-h-screen">
      <header className="bez-druku border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1.5 rounded bg-limonka" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">Rozliczenia prac Synthos</h1>
              <p className="text-xs text-slate-500">Bioerg Sp. z o.o. · eksport do SAP</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1">
            {zakladki.map((z) => (
              <button
                key={z.id}
                onClick={() => { setWidok(z.id); setOtwarte(null) }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium',
                  widok === z.id && !otwarte ? 'bg-limonka-jasna text-slate-900' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {z.etykieta}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{profil.imie_nazwisko}</p>
              <p className="text-xs text-slate-500">
                {handlowiec ? 'dział handlowy' : `kierownik · ${profil.mpk.join(', ')}`}
              </p>
            </div>
            <Button onClick={zmienHaslo}>Zmień hasło</Button>
            <Button onClick={() => supabase.auth.signOut()}>Wyloguj</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {blad ? (
          <div className="sekcja text-center">
            <p className="text-red-700">Nie udało się wczytać cennika: {blad}</p>
            <Button className="mt-3" onClick={() => void odswiez()}>Spróbuj ponownie</Button>
          </div>
        ) : !gotowe ? (
          <p className="text-center text-slate-500">Wczytywanie cennika...</p>
        ) : otwarte ? (
          <EdytorZlecenia
            key={otwarte}
            zlecenieId={otwarte === 'nowe' ? null : otwarte}
            profil={profil}
            zamknij={() => setOtwarte(null)}
            otworzInne={setOtwarte}
          />
        ) : widok === 'zlecenia' ? (
          <ListaZlecen profil={profil} otworz={setOtwarte} />
        ) : widok === 'eksport' && handlowiec ? (
          <PanelEksportu otworz={setOtwarte} />
        ) : widok === 'braki' ? (
          <BrakiGodzin profil={profil} otworz={setOtwarte} />
        ) : widok === 'cennik' ? (
          <Cennik profil={profil} />
        ) : widok === 'uzytkownicy' && handlowiec ? (
          <Uzytkownicy profil={profil} />
        ) : null}
      </main>
    </div>
  )
}
