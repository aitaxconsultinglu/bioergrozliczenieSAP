import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/slowniki', () => ({ useSlowniki: () => ({ narzutDomyslny: 12 }) }))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

describe('tabela materiałów - brak części ilości', () => {
  it('pole „Brak [ilość]” i dopisek z wartością brakujących sztuk', async () => {
    const { TabelaMaterialow } = await import('./TabelaMaterialow')
    const html = renderToStaticMarkup(<TabelaMaterialow edycja ustaw={() => {}} materialy={[
      { klucz: 'a', nazwa: 'WIRNIK SK4 35.4.304.100', ilosc: 3, jm: 'szt', wartosc_zakupu: 1603.5, dostawca: 'bioerg', narzut_proc: 12, numer_faktury: 'PZ/430/07/2025', brak_ilosc: 1 },
      { klucz: 'b', nazwa: 'ŁOŻYSKO KULKOWE 6304-2Z', ilosc: 1, jm: 'szt', wartosc_zakupu: 21.04, dostawca: 'bioerg', narzut_proc: 12, numer_faktury: null },
    ]} />)
    const tekst = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    expect(tekst).toContain('Brak [ilość]')
    expect(tekst).toContain('w tym brak 1 szt = 598,64')
    expect(tekst).toContain('1220,84') // sprzedane: 1197,28 + 23,56
    expect(tekst).toContain('598,64')
  })
})
