import { useEffect, useState } from 'react'
import { parsujLiczbe } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  wartosc: number
  zmien: (n: number) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  autoFocus?: boolean
  'aria-label'?: string
}

/**
 * Pole liczbowe przyjmujące przecinek i kropkę. Trzyma własny tekst podczas pisania
 * ("12," nie jest jeszcze liczbą), a do rodzica oddaje liczbę dopiero, gdy jest poprawna.
 * Niepoprawny wpis podświetla się na czerwono i nie zmienia zapisanej wartości.
 */
export function PoleLiczby({ wartosc, zmien, disabled, className, placeholder, onKeyDown, autoFocus, ...reszta }: Props) {
  const [tekst, setTekst] = useState(wartosc ? String(wartosc).replace('.', ',') : '')
  const [zle, setZle] = useState(false)

  useEffect(() => {
    // Zmiana z zewnątrz (np. wczytanie z bazy) - nadpisz tekst, jeśli się rozjechał.
    const obecna = parsujLiczbe(tekst)
    if (obecna !== wartosc && !(Number.isNaN(obecna) && zle)) {
      setTekst(wartosc ? String(wartosc).replace('.', ',') : '')
      setZle(false)
    }
  }, [wartosc]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      inputMode="decimal"
      value={tekst}
      disabled={disabled}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      aria-label={reszta['aria-label']}
      aria-invalid={zle}
      onChange={(e) => {
        setTekst(e.target.value)
        const n = parsujLiczbe(e.target.value)
        if (Number.isNaN(n) || n < 0) { setZle(true); return }
        setZle(false)
        zmien(n)
      }}
      className={cn('pole-komorki liczba', zle && 'bg-red-100 text-red-800', className)}
    />
  )
}
