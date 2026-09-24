// Zakladanie, reset hasla i usuwanie kont. Operacje na auth.users wymagaja klucza
// service_role, ktory nie moze trafic do przegladarki - dlatego siedzi wylacznie tutaj,
// a funkcja sama sprawdza, czy wywolujacy jest dzialem handlowym. Sam wazny token NIE
// wystarcza: token kierownika przejdzie weryfikacje JWT, ale odpadnie na sprawdzeniu roli.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const NAGLOWKI_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MPK = ['P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09']

function odpowiedz(tresc: unknown, status = 200) {
  return new Response(JSON.stringify(tresc), {
    status,
    headers: { ...NAGLOWKI_CORS, 'Content-Type': 'application/json' },
  })
}

/** Haslo tymczasowe spelniajace wymagania aplikacji: min. 6 znakow, min. 1 specjalny. */
function hasloTymczasowe() {
  const znaki = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const losowe = new Uint32Array(8)
  crypto.getRandomValues(losowe)
  return `Bioerg-${[...losowe].map((n) => znaki[n % znaki.length]).join('')}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: NAGLOWKI_CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const serwisowy = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const naglowek = req.headers.get('Authorization')
  if (!naglowek) return odpowiedz({ error: 'Brak autoryzacji' }, 401)

  const { data: { user } } = await createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: naglowek } },
  }).auth.getUser()
  if (!user) return odpowiedz({ error: 'Brak autoryzacji' }, 401)

  const { data: wolajacy } = await serwisowy.from('profiles').select('rola').eq('id', user.id).single()
  if (wolajacy?.rola !== 'handlowiec') {
    return odpowiedz({ error: 'Tylko dział handlowy może zarządzać kontami.' }, 403)
  }

  const { akcja, email, imie_nazwisko, rola, mpk, user_id } = await req.json()

  if (akcja === 'dodaj') {
    const adres = String(email ?? '').trim().toLowerCase()
    if (!adres.includes('@')) return odpowiedz({ error: 'Nieprawidłowy adres e-mail.' }, 400)
    if (!String(imie_nazwisko ?? '').trim()) return odpowiedz({ error: 'Podaj imię i nazwisko.' }, 400)
    const rolaDocelowa = rola === 'handlowiec' ? 'handlowiec' : 'kierownik'
    const listaMpk = (Array.isArray(mpk) ? mpk : []).filter((m: string) => MPK.includes(m))
    if (rolaDocelowa === 'kierownik' && listaMpk.length === 0) {
      return odpowiedz({ error: 'Kierownik musi mieć przypisane co najmniej jedno MPK.' }, 400)
    }

    // Wpis na liscie dostepu MUSI powstac przed kontem: trigger przy zakladaniu
    // uzytkownika czyta z niej role, nazwisko i MPK.
    const { error: bladListy } = await serwisowy.from('uprawnienia_startowe').upsert({
      email: adres, imie_nazwisko: String(imie_nazwisko).trim(), rola: rolaDocelowa,
      mpk: rolaDocelowa === 'kierownik' ? listaMpk : [],
    })
    if (bladListy) return odpowiedz({ error: bladListy.message }, 400)

    const haslo = hasloTymczasowe()
    const { data: utworzony, error } = await serwisowy.auth.admin.createUser({
      email: adres, password: haslo, email_confirm: true,
    })
    if (error) return odpowiedz({ error: error.message }, 400)

    // Haslo nadane przez dzial handlowy jest tymczasowe - wlasne ustawia sie przy 1. logowaniu.
    await serwisowy.from('profiles').update({ wymaga_zmiany_hasla: true }).eq('id', utworzony.user.id)
    return odpowiedz({ ok: true, email: adres, haslo_tymczasowe: haslo })
  }

  if (akcja === 'resetuj') {
    if (!user_id) return odpowiedz({ error: 'Brak identyfikatora konta.' }, 400)
    const { data: konto } = await serwisowy.from('profiles').select('email').eq('id', user_id).single()
    if (!konto) return odpowiedz({ error: 'Nie znaleziono konta.' }, 404)
    const haslo = hasloTymczasowe()
    const { error } = await serwisowy.auth.admin.updateUserById(user_id, { password: haslo })
    if (error) return odpowiedz({ error: error.message }, 400)
    await serwisowy.from('profiles').update({ wymaga_zmiany_hasla: true }).eq('id', user_id)
    return odpowiedz({ ok: true, email: konto.email, haslo_tymczasowe: haslo })
  }

  if (akcja === 'usun') {
    if (!user_id) return odpowiedz({ error: 'Brak identyfikatora konta.' }, 400)
    if (user_id === user.id) return odpowiedz({ error: 'Nie możesz usunąć własnego konta.' }, 400)

    const { data: doUsuniecia } = await serwisowy.from('profiles').select('email, rola').eq('id', user_id).single()
    if (!doUsuniecia) return odpowiedz({ error: 'Nie znaleziono konta.' }, 404)

    // Usuniecie ostatniego konta dzialu handlowego zamykaloby eksport do SAP dla wszystkich.
    if (doUsuniecia.rola === 'handlowiec') {
      const { count } = await serwisowy.from('profiles').select('id', { count: 'exact', head: true }).eq('rola', 'handlowiec')
      if ((count ?? 0) <= 1) return odpowiedz({ error: 'To ostatnie konto działu handlowego - nie można go usunąć.' }, 400)
    }

    const { error } = await serwisowy.auth.admin.deleteUser(user_id)
    if (error) return odpowiedz({ error: error.message }, 400)
    await serwisowy.from('uprawnienia_startowe').delete().eq('email', doUsuniecia.email)
    return odpowiedz({ ok: true })
  }

  return odpowiedz({ error: 'Nieznana akcja.' }, 400)
})
