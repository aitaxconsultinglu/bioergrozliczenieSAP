import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const st = (id: number, stanowisko: string, pora: string, cena: number) => ({ cennik_pozycja_id: id, stanowisko, pora, cena, indeks_sap: String(id), numer_linii: id })
const stawki = [st(1, 'Ślusarz', '7-15', 75), st(2, 'Ślusarz', '15-19', 97), st(3, 'Czyściciel', '7-15', 75), st(4, 'Czyściciel', '15-19', 97)]
vi.mock('@/lib/slowniki', () => ({ useSlowniki: () => ({ stawki, mpk: [] }) }))

describe('siatka - braki wg stawek', () => {
  it('pokazuje stawkę i wartość przy każdej porze oraz rozbicie pod siatką', async () => {
    const { SiatkaRobocizny } = await import('./SiatkaRobocizny')
    const u = (id: number, ilosc: number) => ({ klucz: `u${id}`, cennik_pozycja_id: id, ilosc, doplata_proc: 0, doplata_opis: null, mpk_wykonawcy: null, opis: null })
    const b = (id: number, ilosc_rbg: number) => ({ klucz: `b${id}`, cennik_pozycja_id: id, stanowisko_tekst: null, ilosc_rbg, status: 'zgloszony' as const, opis: null })
    const html = renderToStaticMarkup(<SiatkaRobocizny uslugi={[u(1, 8), u(3, 20), u(4, 10)]} ustaw={() => {}} mpkZlecenia="P04" edycja
      braki={[b(1, 2), b(3, 20), b(4, 5)]} ustawBraki={() => {}} />)
    const tekst = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    expect(tekst).toContain('× 97,00 = 485,00')
    expect(tekst).toContain('× 75,00 = 1500,00')
    expect(tekst).toContain('Czyściciel · 15:00–19:00')
    expect(tekst).not.toContain('27 rbg')
  })
})
