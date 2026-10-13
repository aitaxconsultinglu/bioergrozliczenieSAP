import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const CO_ILE_MS = 5 * 60 * 1000

/** Nazwa pliku skryptu aplikacji (Vite dodaje do niej skrót treści, więc zmienia się przy każdym wdrożeniu). */
function skryptZHtml(html: string) {
  return /src="[^"]*\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1] ?? null
}

/**
 * Pasek "dostępna nowa wersja". Karta otwarta od rana nie widzi poprawek wdrożonych
 * w ciągu dnia - a stara wersja potrafi wyglądać jak błąd ("nie mogę zmienić roli").
 * Co 5 minut i po powrocie do karty porównujemy skrypt z serwera z tym, który działa.
 */
export function NowaWersja() {
  const [jest, setJest] = useState(false)

  useEffect(() => {
    const biezacy = [...document.scripts].map((s) => /\/assets\/(index-[^/]+\.js)$/.exec(s.src)?.[1]).find(Boolean)
    if (!biezacy) return // tryb deweloperski - brak zbudowanego skryptu
    let aktywne = true
    const sprawdz = async () => {
      try {
        const odp = await fetch(`${import.meta.env.BASE_URL}index.html?t=${Date.now()}`, { cache: 'no-store' })
        const nowy = skryptZHtml(await odp.text())
        if (aktywne && nowy && nowy !== biezacy) setJest(true)
      } catch { /* brak sieci - sprawdzimy następnym razem */ }
    }
    const id = setInterval(sprawdz, CO_ILE_MS)
    const przyPowrocie = () => { if (document.visibilityState === 'visible') void sprawdz() }
    document.addEventListener('visibilitychange', przyPowrocie)
    void sprawdz()
    return () => { aktywne = false; clearInterval(id); document.removeEventListener('visibilitychange', przyPowrocie) }
  }, [])

  if (!jest) return null
  return (
    <div className="bez-druku flex flex-wrap items-center justify-center gap-3 bg-blekit-jasny px-4 py-2 text-sm text-blekit-ciemny">
      Dostępna jest nowa wersja aplikacji. Zapisz bieżącą pracę i odśwież stronę.
      <button onClick={() => window.location.reload()} className="inline-flex items-center gap-1 rounded bg-blekit px-3 py-1 font-medium text-slate-900 hover:bg-blekit-ciemny hover:text-white">
        <RefreshCw className="h-4 w-4" /> Odśwież
      </button>
    </div>
  )
}
