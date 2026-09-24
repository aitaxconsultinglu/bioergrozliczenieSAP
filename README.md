# Rozliczenia prac Synthos → SAP (Bioerg)

Aplikacja dla kierowników MPK P03–P09 i działu handlowego: zastępuje ręczny obieg kart
rozliczeniowych w Excelu i generuje plik / schowek w sztywnym układzie importu do SAP.
Kontekst biznesowy: [`docs/BRIEF_aplikacja_rozliczenia_Synthos.md`](docs/BRIEF_aplikacja_rozliczenia_Synthos.md).

- **Frontend:** React + Vite + TypeScript + Tailwind, GitHub Pages (`.github/workflows/deploy.yml`).
- **Backend:** Supabase `bioerg-rozliczenia-sap` (`uitznyuencrhndagqxpg`, eu-central-1) - Postgres + Auth + RLS.
- **Registo:** celowo brak jakiejkolwiek integracji (wymóg klienta).

## Jak to działa

| Rola | Widzi | Może |
|---|---|---|
| kierownik | zlecenia swoich MPK | tworzyć/edytować zlecenia robocze i zwrócone, składać do rozliczenia |
| handlowiec (dział handlowy) | wszystko | poprawiać, zwracać, eksportować do SAP, cofać eksport, zarządzać kontami, cennikiem i brakami |

Status zlecenia: `roboczy → złożony → wyeksportowany` (albo `złożony → zwrócony → złożony`).
Reguły pilnuje **baza** (triggery + RLS), nie tylko formularz:
- złożenie wymaga numeru zamówienia SAP i tylu kompletnych kart remontowych, ile sztuk
  pozycji z kategorii oznaczonych „wymaga karty”;
- ceny są zamrażane z cennika w chwili wpisu, stawki robocizny pochodzą wyłącznie z cennika;
- materiał dostarczony przez Synthos ma zawsze narzut 0% i nie idzie do eksportu;
- cały formularz zapisuje się jedną transakcją (`zapisz_zlecenie`), z ochroną przed
  nadpisaniem cudzego zapisu;
- każda zmiana trafia do `audit_log` (zapis tylko przez triggery).

## Szablony kart

`src/lib/szablony.ts` - obecnie „Pompa / urządzenie ogólne” i „Silnik elektryczny”.
Nowy szablon = nowy obiekt w tym pliku + ustawienie kategorii w zakładce **Cennik**.
Pola specyficzne dla szablonu siedzą w `jsonb`, więc schemat bazy się nie zmienia.

## Eksport do SAP

Całe mapowanie na kolumny `Numer linii | Numer usługi | Krótki tekst | Ilość | Pozostało |
Podst. t.JM | Cena | Wartość | Cena Mat. | Ilość Mat. | Nr Mat. dostawcy` jest w
`src/lib/eksportSap.ts` (z listą założeń do potwierdzenia na realnym przykładzie).

## Cennik

`docs/cennik_synthos_pelny.csv` jest **poza repozytorium** (repo jest publiczne, cennik
kontraktowy - poufny). Import/aktualizacja: `python scripts/import_cennik.py <csv> > cennik.sql`
i wykonanie SQL w Supabase. Import jest idempotentny.

## Rozwój

```bash
npm install
npm run dev      # http://localhost:5173/bioergrozliczenieSAP/
npm test         # testy obliczeń i eksportu SAP
npm run build
```

Migracje: `supabase/migrations/` (stosowane w tej kolejności). Funkcja brzegowa
`zarzadzanie-uzytkownikami` - zakładanie kont / reset hasła / usuwanie (tylko handlowiec).
