# Brief projektowy: Aplikacja do rozliczeń prac dla Synthos (Bioerg)

Ten dokument to pełny kontekst do rozpoczęcia budowy w Claude Code. Zbiera wszystko, co ustalono w rozmowie analitycznej — źródła, ograniczenia, model danych i otwarte pytania — żeby nowa sesja nie musiała niczego odkrywać od nowa.

---

## 1. Kontekst biznesowy

Bioerg Sp. z o.o. wykonuje prace remontowe (mechanika, elektryka, urządzenia przemysłowe) dla klienta Synthos, rozliczane przez SAP klienta. Proces dziś:

1. **Kierownik/technolog** (np. Mariusz Żogała, Kierownik Wydziału) wykonuje remont i ręcznie wypełnia "kartę rozliczeniową" w Excelu — jedna zakładka na zlecenie. Wpisuje: dane nagłówkowe, numer zamówienia (ręcznie wyszukany w SAP/FIORI), godziny robocizny per stanowisko, materiały (ceny z faktur opisywanych w DMS, drukowane jako dowód), ewentualną kooperację między MPK (np. "20 RBG DLA SPORYSZ" jako wolny tekst), braki godzin.
2. Dla urządzeń objętych umową serwisową (pompy, przekładnie, silniki itd.) obowiązkowo dołącza się **kartę remontową** — dziś papierową, wypełnianą odręcznie.
3. Dane trafiają do **Justyny Korzeniowskiej** (Kierownik Działu Handlowo-Logistycznego), która generuje AZO w Comarch Optima, a następnie **ręcznie wkleja (Ctrl+C/Ctrl+V)** rozliczenie do SAP klienta w sztywnym układzie kolumn.
4. Skala: **60–100 zleceń miesięcznie na jedno MPK**, proces dotyczy **MPK P03–P09** (P04 i P07 są najbardziej czasochłonne — remontują urządzenia i silniki).

Firma chce zbudować własną aplikację (analogicznie do wcześniej zbudowanych z Claude Code: `Bioerg-ewidencja-VAT`, `Bioerg-karty-dostawy`, oba hostowane jako GitHub Pages), która zastąpi ręczny obieg Excela i przyspieszy pracę Justyny.

**Szerszy kontekst:** to jeden z kilku projektów automatyzacji dla Bioerg — docelowo firma chce zbudować spójny zestaw narzędzi/workflow, nie tylko punktowe łatki. Warto projektować z myślą o wspólnym stylu/stackowi z poprzednimi aplikacjami.

---

## 2. Twarde ograniczenia (potwierdzone przez Bioerg, nie negocjowalne)

- **Brak cyklicznego eksportu z SAP/FIORI.** Nie da się automatycznie pobrać listy zamówień ani numerów zamówień — kierownik nadal musi znać/wyszukać numer zamówienia ręcznie (aplikacja może go tylko *przechować i podpowiadać z historii*, nie *pobrać* z SAP).
- **Układ kolumn importu do SAP jest sztywny**, ale nie da się pobrać jego pustego szablonu z SAP — trzeba go odtworzyć ręcznie (patrz sekcja 4, mamy zrzut ekranu nagłówków). Import Excela do SAP jest możliwy dopiero, gdy arkusz rozliczeniowy jest już wypełniony (czyli: eksportujemy plik w tym układzie, Justyna go importuje/wkleja do SAP — to jest do zautomatyzowania).
- **Registo (wewnętrzny system rejestru czasu pracy Bioerg) NIE MOŻE być w żaden sposób powiązany z tym procesem.** To wyraźna instrukcja klienta/firmy — nie budować żadnej integracji ani odniesień do Registo.
- Numeracja linii zamówienia w SAP (10/20/30...) jest nadawana przez Synthos i **nie jest stała** — nie da się założyć "pozycja 20 = zawsze materiał" jako reguły twardej (to tylko heurystyka ok. 90% przypadków).

---

## 3. Kluczowe ustalenia z danych źródłowych

### 3.1 Cennik kontraktowy (plik `cennik_synthos_pelny.csv` w załączeniu)

Pełny cennik kontraktu Bioerg–Synthos: **1183 pozycje cennikowe w 54 kategoriach usług** (nie tylko pompy/przekładnie — także remonty wentylatorów, wag, dźwignic, kotłów, młynów węglowych, wynajem pracowników, badania NDT itd.). Kolumny źródłowe:

`Kontrahent | Numer dokumentu zaopatrzeniowego | Numer pozycji kontraktu | Krótki tekst pozycji | Numer linii | Numer usługi | Krótki tekst | Ilość ze znakiem | Podstawowa jednostka miary | Cena brutto | Kod waluty`

Każda pozycja usługi ma **własny, sztywny indeks SAP** ("Numer usługi", np. `5001471`). To jest właściwy "indeks materiałowy/usługowy" Synthosu — jeden do jednego z pozycją cennikową.

### 3.2 Rozwiązana zagadka indeksu "5004062"

Ten kod pojawiał się identyczny przy każdej pozycji materiałowej w przykładowych rozliczeniach. To **nie błąd** — to jedna konkretna, uniwersalna pozycja cennikowa: **"Materiał branża mechaniczna +15%"** (indeks `5004062`), używana zawsze, gdy zużyty materiał nie ma własnej dedykowanej pozycji cennikowej. Model danych musi to odzwierciedlać: materiał domyślnie leci pod ten uniwersalny indeks z narzutem +15%, chyba że jest osobna pozycja cennikowa.

### 3.3 Stawki robocizny — pełna tabela z indeksami SAP

Grupa cennikowa "310 — Wynajem pracowników" zawiera **4 stawki czasowe na każde stanowisko**, każda z osobnym indeksem SAP:

| Stanowisko | Pora | Stawka | Indeks SAP |
|---|---|---|---|
| Ślusarz | 7:00–15:00 | 75 zł | 5000000 |
| Ślusarz | 15:00–19:00 | 97 zł | 5000001 |
| Ślusarz | 19:00–7:00 | 103 zł | 5000002 |
| Ślusarz | dni wolne | 100 zł | 5000003 |
| Spawacz | 7:00–15:00 | 81 zł | 5000008 |
| Spawacz | 15:00–19:00 | 97 zł | 5000009 |
| Spawacz | 19:00–7:00 | 103 zł | 5000010 |
| Spawacz | dni wolne | 103 zł | 5000011 |
| Tokarz/frezer/szlifierz | 7:00–15:00 | 94 zł | 5000032 |
| Tokarz/frezer/szlifierz | 15:00–19:00 | 116 zł | 5000033 |
| Tokarz/frezer/szlifierz | 19:00–7:00 | 116 zł | 5000034 |
| Tokarz/frezer/szlifierz | dni wolne | 127 zł | 5000035 |

(Pełne, dokładne wartości i wszystkie stanowiska — w załączonym CSV, wiersze z grupy "Wynajem pracowników".) To wyjaśnia rozbieżności stawek widoczne we wcześniejszych przykładowych rozliczeniach (65/75/97/100 zł dla ślusarza) — to różne pory dnia, nie błędy.

### 3.4 Dwa różne szablony kart — aplikacja potrzebuje obu

1. **Karta remontowa (pompy, mieszadła, urządzenia ogólne)** — dziś papierowa, wypełniana odręcznie: numer karty, numer zlecenia, nazwa/typ urządzenia, nazwa klienta, daty przyjęcia/zakończenia, mechanik przekazujący/przyjmujący, opis uszkodzenia, zakres remontu (checklist), wykaz użytych materiałów i części (z kolumną "Dostarczył" — **materiał bywa dostarczony przez Synthos, nie kupowany przez Bioerg** — taki materiał nie powinien dostawać narzutu +15%, to trzeba potwierdzić z Żogałą), wykonane elementy, podpisy, kontrola końcowa, gwarancja.
2. **Karta rozliczeniowa silnika elektrycznego (np. budynek E-139)** — już istnieje jako cyfrowa tabela: Budynek, Stanowisko, Numer silnika, Moc, Napięcie, Obroty, Robocizna, Robocizna dodatkowa, tabela materiałów (Wartość / Cena jednostkowa / Ilość / Wartość +15%), "Przezwojenie +10%", "Podmiany", "Uwagi".

Aplikacja powinna obsługiwać **oba typy** jako osobne szablony formularza (prawdopodobnie więcej typów pojawi się przy pilotażu — projektować model danych tak, by łatwo dodawać kolejne szablony/kategorie zlecenia).

### 3.5 Układ kolumn eksportu do SAP (od Justyny)

Nagłówki wymaganego układu importu do SAP:

`Numer linii | Numer usługi | Krótki tekst | Ilość | Pozostało | Podst. t.JM | Cena | Wartość | Cena Mat. | Ilość Mat. | Nr Mat. dostawcy`

Aplikacja powinna generować eksport (CSV/XLSX) w dokładnie tym układzie kolumn, gotowy do wklejenia/importu przez Justynę.

### 3.6 Raporty z Optimy (AZO) — osobny, już częściowo rozpracowany temat

Justyna generuje z Optimy raporty w starym formacie Crystal Reports (`.XLS`, BIFF, nie XLSX) ze scalonymi komórkami i pustymi wierszami rozdzielającymi bloki — dziś nienadające się do dalszej automatycznej obróbki. Przykłady takich raportów zostały już przeanalizowane (struktura jest przewidywalna: bloki rozdzielone pustymi wierszami, nagłówki typu "MPK: P06 Błaszczyk", wiersze "Suma:"). **To osobne zadanie** (konwerter/czyszczenie raportu) — może być drugim, mniejszym modułem tej samej aplikacji albo osobnym narzędziem, w stylu podobnym do wcześniej zbudowanego `Bioerg-karty-dostawy`.

---

## 4. Proponowany model danych (do dopracowania w Claude Code)

- **`cennik_pozycje`** — import z `cennik_synthos_pelny.csv`: numer_pozycji_kontraktu, kategoria, numer_linii, indeks_sap (numer usługi), opis, jednostka, cena_bazowa. To jest tabela referencyjna, ładowana raz, aktualizowana przy zmianie umowy.
- **`stawki_robocizny`** — wyciąg z cennika: stanowisko, pora_dnia (7-15 / 15-19 / 19-7 / dni_wolne), stawka, indeks_sap.
- **`zlecenia`** — nr_zlecenia_wewn, MPK, konto (np. URR/4/2026/BZ), numer_zamowienia_sap (pole tekstowe z historią/podpowiadaniem, nie automatyczne pobieranie), nazwa_urzadzenia, typ_szablonu (pompa/silnik/inny), mechanik, data_przyjecia, data_zakonczenia, status.
- **`pozycje_robocizny`** — zlecenie_id, stanowisko, pora_dnia, ilość_rbg, MPK_docelowe (nullable — wypełniane przy kooperacji między MPK), czy_oddane.
- **`pozycje_materialowe`** — zlecenie_id, nazwa, ilość, jednostka, cena_zakupu, dostarczyciel (Bioerg/Synthos — determinuje czy nalicza się +15%), indeks_sap (domyślnie 5004062, chyba że pozycja z cennika).
- **`karty_remontowe`** — zlecenie_id, numer_karty, dane specyficzne dla szablonu (JSON lub osobne tabele per typ), checklist zakresu remontu, podpisy/statusy.
- **`braki_godzin`** — zlecenie_id, ilość_brakująca, status (zgłoszony/uzupełniony/rozliczony).

To szkielet — Claude Code powinien go zweryfikować i dopracować względem realnych przykładów w plikach źródłowych.

---

## 5. Rekomendowany stack

Kontynuacja stylu poprzednich projektów: **statyczny frontend hostowany na GitHub Pages**. Do rozważenia z Claude Code na starcie:

- Jeśli aplikacja ma być używana przez wielu kierowników jednocześnie (10+ osób z P03–P09 wpisujących dane równolegle) — potrzebna jest współdzielona baza danych, nie lokalny storage w przeglądarce. Rekomendacja: **Supabase (Postgres + auth) jako backend**, frontend nadal statyczny na GitHub Pages — dokładnie ten wzorzec, co dotychczasowe projekty Bioerg, tylko z prawdziwą bazą zamiast pojedynczego pliku.
- Autentykacja: prosty login per kierownik/MPK (Supabase Auth) + rola Justyny (podgląd wszystkiego + generowanie eksportu SAP).

---

## 6. Otwarte pytania do potwierdzenia z Żogałą/Justyną w trakcie budowy

1. Czy materiał oznaczony w karcie remontowej jako dostarczony przez "Synthos" powinien być wykluczony z narzutu +15% i/lub w ogóle z rozliczenia wartościowego (bo klient go już opłacił inaczej)?
2. Czy pojawią się inne typy kart/szablonów poza "pompa/urządzenie ogólne" i "silnik elektryczny" — np. dla przekładni, wentylatorów, dźwignic? (Cennik sugeruje bardzo szeroki zakres kategorii).
3. Czy każde MPK (P03–P09) ma dokładnie ten sam zestaw stanowisk/stawek, czy się różni?
4. Czy numer zamówienia SAP, raz wpisany dla danego zlecenia/urządzenia, powtarza się przy kolejnych remontach tego samego urządzenia (czy da się budować podpowiadanie po numerze/nazwie urządzenia)?

---

## 7. Załączniki do tego brief'u

- `cennik_synthos_pelny.csv` — pełny, oczyszczony cennik (1183 wiersze).
- Wcześniejszy plik `przykładowe_rozliczenie.xlsx` (303 zakładki przykładowych zleceń) — źródło do zrozumienia dotychczasowego formatu Excela i pól potrzebnych w formularzu.
- Zrzuty/przykłady kart remontowych (pompa, silnik) — do wzorowania szablonów formularza.
