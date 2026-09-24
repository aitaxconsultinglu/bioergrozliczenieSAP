import { useCallback, useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSlowniki } from '@/lib/slowniki'
import { komunikatPL } from '@/lib/config'
import { dataGodzinaPL } from '@/lib/format'
import type { Profil, Rola } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface WierszUzytkownika {
  id: string
  email: string
  imie_nazwisko: string
  rola: Rola
  wymaga_zmiany_hasla: boolean
  chroniony: boolean
  ostatnie_logowanie: string | null
  mpk: string[]
}

type Odpowiedz = { error?: string; haslo_tymczasowe?: string; email?: string } | null

export function Uzytkownicy({ profil }: { profil: Profil }) {
  const { mpk: listaMpk } = useSlowniki()
  const [uzytkownicy, setUzytkownicy] = useState<WierszUzytkownika[]>([])
  const [doUsuniecia, setDoUsuniecia] = useState<WierszUzytkownika | null>(null)
  const [doResetu, setDoResetu] = useState<WierszUzytkownika | null>(null)
  const [nowy, setNowy] = useState({ email: '', imie_nazwisko: '', rola: 'kierownik' as Rola, mpk: [] as string[] })
  const [hasloDoPrzekazania, setHasloDoPrzekazania] = useState<{ email: string; haslo: string } | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [zajety, setZajety] = useState(false)

  const wczytaj = useCallback(async () => {
    const { data, error } = await supabase.rpc('lista_uzytkownikow')
    if (error) { setBlad(komunikatPL(error.message)); return }
    setUzytkownicy((data ?? []) as WierszUzytkownika[])
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  async function wywolaj(body: Record<string, unknown>): Promise<Odpowiedz> {
    const { data, error } = await supabase.functions.invoke('zarzadzanie-uzytkownikami', { body })
    const odp = data as Odpowiedz
    if (error || odp?.error) {
      // Przy statusie != 2xx treść błędu siedzi w error.context (Response), nie w data.
      let tresc = odp?.error ?? error?.message ?? 'Operacja nie powiodła się.'
      const ctx = (error as { context?: Response } | null)?.context
      if (ctx && typeof ctx.json === 'function') {
        try { tresc = ((await ctx.json()) as { error?: string }).error ?? tresc } catch { /* zostaje ogólny */ }
      }
      setBlad(komunikatPL(tresc))
      return null
    }
    return odp
  }

  async function dodaj(e: React.FormEvent) {
    e.preventDefault()
    setBlad(null)
    if (nowy.rola === 'kierownik' && nowy.mpk.length === 0) { setBlad('Zaznacz co najmniej jedno MPK dla kierownika.'); return }
    setZajety(true)
    const odp = await wywolaj({ akcja: 'dodaj', ...nowy, email: nowy.email.trim() })
    setZajety(false)
    if (!odp) return
    setHasloDoPrzekazania({ email: odp.email!, haslo: odp.haslo_tymczasowe! })
    setNowy({ email: '', imie_nazwisko: '', rola: 'kierownik', mpk: [] })
    await wczytaj()
  }

  async function resetujHaslo() {
    if (!doResetu) return
    setZajety(true)
    setBlad(null)
    const odp = await wywolaj({ akcja: 'resetuj', user_id: doResetu.id })
    setZajety(false)
    setDoResetu(null)
    if (odp) setHasloDoPrzekazania({ email: odp.email!, haslo: odp.haslo_tymczasowe! })
    await wczytaj()
  }

  async function usun() {
    if (!doUsuniecia) return
    setZajety(true)
    setBlad(null)
    await wywolaj({ akcja: 'usun', user_id: doUsuniecia.id })
    setZajety(false)
    setDoUsuniecia(null)
    await wczytaj()
  }

  async function przelaczMpk(u: WierszUzytkownika, kod: string) {
    setBlad(null)
    const { error } = u.mpk.includes(kod)
      ? await supabase.from('profile_mpk').delete().eq('profile_id', u.id).eq('mpk_kod', kod)
      : await supabase.from('profile_mpk').insert({ profile_id: u.id, mpk_kod: kod })
    if (error) setBlad(komunikatPL(error.message))
    await wczytaj()
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Użytkownicy</h2>
      {blad && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{blad}</div>}

      <form onSubmit={dodaj} className="sekcja">
        <h3 className="text-sm font-semibold">Dodaj użytkownika</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label>
            <span className="etykieta">Adres e-mail</span>
            <input type="email" required className="pole w-60" placeholder="j.kowalski@bioerg.pl" value={nowy.email}
              onChange={(e) => setNowy({ ...nowy, email: e.target.value })} />
          </label>
          <label>
            <span className="etykieta">Imię i nazwisko</span>
            <input required className="pole w-56" placeholder="Jan Kowalski" value={nowy.imie_nazwisko}
              onChange={(e) => setNowy({ ...nowy, imie_nazwisko: e.target.value })} />
          </label>
          <label>
            <span className="etykieta">Rola</span>
            <select className="pole w-auto" value={nowy.rola} onChange={(e) => setNowy({ ...nowy, rola: e.target.value as Rola })}>
              <option value="kierownik">kierownik (swoje MPK)</option>
              <option value="handlowiec">dział handlowy (wszystko + eksport)</option>
            </select>
          </label>
          {nowy.rola === 'kierownik' && (
            <div>
              <span className="etykieta">MPK</span>
              <div className="flex gap-2">
                {listaMpk.map((m) => (
                  <label key={m.kod} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={nowy.mpk.includes(m.kod)}
                      onChange={(e) => setNowy({ ...nowy, mpk: e.target.checked ? [...nowy.mpk, m.kod] : nowy.mpk.filter((x) => x !== m.kod) })} />
                    {m.kod}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Button type="submit" wariant="glowny" disabled={zajety}>Dodaj konto</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Konto dostanie hasło tymczasowe, które pokażemy raz po utworzeniu. Przy pierwszym logowaniu użytkownik musi ustawić własne.
        </p>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="komorka-naglowek">Imię i nazwisko</th>
              <th className="komorka-naglowek">Login</th>
              <th className="komorka-naglowek">Rola</th>
              <th className="komorka-naglowek">MPK</th>
              <th className="komorka-naglowek">Ostatnie logowanie</th>
              <th className="komorka-naglowek" />
            </tr>
          </thead>
          <tbody>
            {uzytkownicy.map((u) => (
              <tr key={u.id}>
                <td className="komorka font-medium">
                  {u.imie_nazwisko}
                  {u.id === profil.id && <span className="ml-2 text-xs text-slate-400">(Ty)</span>}
                </td>
                <td className="komorka text-slate-600">{u.email}</td>
                <td className="komorka">
                  {u.chroniony ? (
                    <span title="Konto administratora - nie można go usunąć ani zmienić mu roli"
                      className="inline-flex items-center gap-1 rounded-full bg-limonka-jasna px-2.5 py-0.5 text-xs font-medium text-limonka-ciemna ring-1 ring-limonka">
                      <ShieldCheck className="h-3 w-3" /> administrator
                    </span>
                  ) : u.rola === 'handlowiec' ? 'dział handlowy' : 'kierownik'}
                </td>
                <td className="komorka">
                  {u.rola === 'handlowiec' ? <span className="text-sm text-slate-500">wszystkie</span> : (
                    <div className="flex flex-wrap gap-1">
                      {listaMpk.map((m) => (
                        <button key={m.kod} onClick={() => void przelaczMpk(u, m.kod)}
                          className={cn('rounded px-1.5 py-0.5 text-xs ring-1',
                            u.mpk.includes(m.kod) ? 'bg-limonka-jasna text-slate-900 ring-limonka' : 'text-slate-400 ring-slate-200 hover:text-slate-700')}>
                          {m.kod}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td className="komorka text-sm text-slate-600">
                  {u.ostatnie_logowanie ? dataGodzinaPL(u.ostatnie_logowanie) : <span className="text-amber-700">nigdy</span>}
                </td>
                <td className="komorka">
                  <div className="flex justify-end gap-2">
                    <Button wariant="akcent" title="Nadaj nowe hasło tymczasowe" disabled={zajety} onClick={() => setDoResetu(u)}>
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button wariant="ostrzezenie" disabled={u.id === profil.id || u.chroniony}
                      title={u.chroniony ? 'Konta administratora nie można usunąć' : u.id === profil.id ? 'Nie możesz usunąć własnego konta' : 'Usuń konto'}
                      onClick={() => setDoUsuniecia(u)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!hasloDoPrzekazania} onOpenChange={(o) => !o && setHasloDoPrzekazania(null)}>
        <DialogContent>
          <DialogTitle>Hasło tymczasowe</DialogTitle>
          <DialogDescription>
            Przekaż te dane pracownikowi. <strong>Hasło pokazujemy tylko teraz</strong> - później można je jedynie zresetować ponownie.
          </DialogDescription>
          <div className="mt-4 space-y-2 rounded-md bg-slate-50 p-4 font-mono text-sm">
            <div><span className="text-slate-500">Login:</span> {hasloDoPrzekazania?.email}</div>
            <div><span className="text-slate-500">Hasło:</span> {hasloDoPrzekazania?.haslo}</div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button wariant="glowny" onClick={() => setHasloDoPrzekazania(null)}>Zapisałem, zamknij</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!doResetu} onOpenChange={(o) => !o && setDoResetu(null)}>
        <DialogContent>
          <DialogTitle>Zresetować hasło: {doResetu?.imie_nazwisko}?</DialogTitle>
          <DialogDescription>
            Dotychczasowe hasło przestanie działać. Otrzymasz nowe hasło tymczasowe do przekazania tej osobie.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setDoResetu(null)}>Anuluj</Button>
            <Button wariant="glowny" disabled={zajety} onClick={() => void resetujHaslo()}>Resetuj hasło</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!doUsuniecia} onOpenChange={(o) => !o && setDoUsuniecia(null)}>
        <DialogContent>
          <DialogTitle>Usunąć konto {doUsuniecia?.imie_nazwisko}?</DialogTitle>
          <DialogDescription>
            Użytkownik straci dostęp do aplikacji. Jego zlecenia i historia zmian zostają nienaruszone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setDoUsuniecia(null)}>Anuluj</Button>
            <Button wariant="ostrzezenie" disabled={zajety} onClick={() => void usun()}>Usuń konto</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
