import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Filter } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** Wszystkie wartości występujące w kolumnie (z powtórzeniami - zliczamy je). */
  wartosci: string[]
  /** Zaznaczone wartości; null = brak filtra (wszystko widoczne). */
  wybrane: Set<string> | null
  zmien: (w: Set<string> | null) => void
  etykieta: string
}

export const PUSTE = '(puste)'

/**
 * Filtr kolumny jak w Excelu: lista wartości z kolumny z licznikami, wyszukiwanie,
 * "zaznacz wszystko". Lista rysowana nad tabelą (portal), żeby nie przycinał jej scroll tabeli.
 */
export function FiltrKolumny({ wartosci, wybrane, zmien, etykieta }: Props) {
  const przycisk = useRef<HTMLButtonElement>(null)
  const [otwarty, setOtwarty] = useState(false)
  const [fraza, setFraza] = useState('')
  const [poz, setPoz] = useState<{ left: number; top: number } | null>(null)

  const unikalne = useMemo(() => {
    const licz = new Map<string, number>()
    for (const w of wartosci) licz.set(w, (licz.get(w) ?? 0) + 1)
    return [...licz.entries()].sort(([a], [b]) => (a === PUSTE ? 1 : b === PUSTE ? -1 : a.localeCompare(b, 'pl', { numeric: true })))
  }, [wartosci])

  const widoczne = unikalne.filter(([w]) => w.toLowerCase().includes(fraza.trim().toLowerCase()))

  useEffect(() => {
    if (!otwarty) return
    const r = przycisk.current!.getBoundingClientRect()
    setPoz({ left: Math.min(r.left, window.innerWidth - 300), top: r.bottom + 4 })
    const zamknij = (e: MouseEvent) => {
      const cel = e.target as HTMLElement
      if (!cel.closest('[data-filtr-kolumny]') && cel !== przycisk.current && !przycisk.current?.contains(cel)) setOtwarty(false)
    }
    const naEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOtwarty(false) }
    document.addEventListener('mousedown', zamknij)
    document.addEventListener('keydown', naEsc)
    return () => { document.removeEventListener('mousedown', zamknij); document.removeEventListener('keydown', naEsc) }
  }, [otwarty])

  function przelacz(w: string) {
    const n = new Set(wybrane ?? unikalne.map(([x]) => x))
    if (n.has(w)) n.delete(w)
    else n.add(w)
    // Wszystko zaznaczone = brak filtra.
    zmien(n.size === unikalne.length ? null : n)
  }

  const aktywny = wybrane !== null
  return (
    <>
      <button ref={przycisk} type="button" onClick={(e) => { e.stopPropagation(); setOtwarty((o) => !o) }}
        title={aktywny ? `Filtr: ${etykieta} (aktywny)` : `Filtruj: ${etykieta}`} aria-label={`Filtruj kolumnę ${etykieta}`}
        className={cn('rounded p-0.5', aktywny ? 'bg-blekit text-slate-900' : 'opacity-40 hover:opacity-100')}>
        <Filter className="h-3.5 w-3.5" />
      </button>
      {otwarty && poz && createPortal(
        <div data-filtr-kolumny className="fixed z-50 w-72 rounded-md border border-slate-300 bg-white p-2 text-sm normal-case shadow-lg"
          style={{ left: poz.left, top: poz.top }}>
          <input className="pole mb-2" autoFocus placeholder={`Szukaj w: ${etykieta}`} value={fraza} onChange={(e) => setFraza(e.target.value)} />
          <div className="mb-1 flex gap-3 text-xs">
            <button className="text-blekit-ciemny hover:underline" onClick={() => zmien(null)}>Zaznacz wszystko</button>
            <button className="text-blekit-ciemny hover:underline" onClick={() => zmien(new Set())}>Odznacz wszystko</button>
            {fraza.trim() && widoczne.length > 0 && (
              <button className="text-blekit-ciemny hover:underline" onClick={() => zmien(new Set(widoczne.map(([w]) => w)))}>Tylko wyszukane</button>
            )}
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {widoczne.map(([w, n]) => (
              <li key={w}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                  <input type="checkbox" checked={wybrane === null || wybrane.has(w)} onChange={() => przelacz(w)} />
                  <span className={cn('flex-1 truncate', w === PUSTE && 'italic text-slate-400')}>{w}</span>
                  <span className="text-xs text-slate-400">{n}</span>
                </label>
              </li>
            ))}
            {widoczne.length === 0 && <li className="px-1 py-2 text-xs text-slate-500">Brak wartości.</li>}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
