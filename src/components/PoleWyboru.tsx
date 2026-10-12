import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Opcja {
  wartosc: string
  etykieta: string
}

interface Props {
  wartosc: string
  zmien: (w: string) => void
  opcje: Opcja[]
  disabled?: boolean
  /** Styl pola w komórce tabeli (bez ramki) zamiast zwykłego pola formularza. */
  wKomorce?: boolean
  pusta?: string
  placeholderInne?: string
  'aria-label'?: string
}

const INNE = '__inne__'

/**
 * "Otwarta" lista wyboru: typowe opcje z listy + "inne (wpisz)", po którym pojawia się
 * pole tekstowe. Aplikacja nigdy nie blokuje niestandardowego przypadku - zawsze da się
 * wpisać coś spoza listy. Wartość spoza listy jest pokazywana od razu jako tekst.
 */
export function PoleWyboru({ wartosc, zmien, opcje, disabled, wKomorce, pusta, placeholderInne, ...reszta }: Props) {
  const naLiscie = wartosc === '' || opcje.some((o) => o.wartosc === wartosc)
  const [wpisywanie, setWpisywanie] = useState(!naLiscie)
  const klasa = wKomorce ? 'pole-komorki' : 'pole'

  if (wpisywanie || !naLiscie) {
    return (
      <div className="flex items-center gap-1">
        <input
          className={cn(klasa, 'min-w-0 flex-1')}
          value={wartosc}
          disabled={disabled}
          autoFocus={wpisywanie && naLiscie}
          placeholder={placeholderInne ?? 'wpisz...'}
          aria-label={reszta['aria-label']}
          // Tryb wpisywania zostaje włączony, nawet gdy ktoś wyczyści pole do zera.
          onChange={(e) => { setWpisywanie(true); zmien(e.target.value) }}
        />
        {!disabled && (
          <button
            type="button"
            title="Wróć do listy"
            className="shrink-0 text-slate-400 hover:text-slate-700"
            onClick={() => { setWpisywanie(false); zmien(opcje[0]?.wartosc ?? '') }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <select
      className={klasa}
      value={wartosc}
      disabled={disabled}
      aria-label={reszta['aria-label']}
      onChange={(e) => {
        if (e.target.value === INNE) { setWpisywanie(true); zmien(''); return }
        zmien(e.target.value)
      }}
    >
      {pusta !== undefined && <option value="">{pusta}</option>}
      {opcje.map((o) => <option key={o.wartosc} value={o.wartosc}>{o.etykieta}</option>)}
      <option value={INNE}>inne (wpisz)…</option>
    </select>
  )
}
