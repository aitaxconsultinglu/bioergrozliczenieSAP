Buduję aplikację webową dla firmy Bioerg Sp. z o.o., zastępującą dzisiejszy ręczny proces rozliczania prac remontowych wykonywanych dla klienta Synthos (rozliczanych przez SAP klienta). Pełny kontekst biznesowy, ustalone ograniczenia, model danych i otwarte pytania są w pliku BRIEF_aplikacja_rozliczenia_Synthos.md w tym repo — przeczytaj go najpierw w całości, zanim zaczniesz cokolwiek pisać.

Kontynuujemy styl poprzednich projektów dla tej samej firmy (Bioerg-ewidencja-VAT, Bioerg-karty-dostawy) — statyczny frontend hostowany na GitHub Pages. Tutaj jednak z wielu stanowisk (kierownicy różnych MPK) będą równolegle wpisywane dane, więc potrzebujemy współdzielonej bazy danych, nie lokalnego storage — użyj Supabase (Postgres + Auth) jako backendu.

Zakres pierwszej iteracji (MVP):

1. Zaimportuj załączony `cennik_synthos_pelny.csv` (1183 pozycje cennikowe, 54 kategorie) jako tabelę referencyjną w bazie — to jest źródło prawdy dla cen, indeksów SAP i stawek robocizny (grupa "Wynajem pracowników" w tym pliku to stawki per stanowisko × pora dnia, patrz BRIEF sekcja 3.3).

2. Zaprojektuj i zaimplementuj schemat bazy dla: zleceń, pozycji robocizny (z podziałem godzin między MPK przy kooperacji), pozycji materiałowych (z rozróżnieniem czy materiał kupił Bioerg czy dostarczył Synthos — to wpływa na naliczenie narzutu +15%), kart remontowych i rejestru braków godzinowych. Punkt wyjścia do schematu jest w BRIEF sekcja 4 — zweryfikuj go i dopracuj, to szkic, nie ostateczna wersja.

3. Zbuduj formularz dla kierowników do wprowadzania zlecenia, obsługujący **co najmniej dwa różne szablony karty** (opisane w BRIEF sekcja 3.4): (a) "pompa/urządzenie ogólne" — karta remontowa z checklistą zakresu remontu, wykazem materiałów i mechanikiem przekazującym/przyjmującym; (b) "silnik elektryczny" — tabela z parametrami silnika (budynek, stanowisko, moc, napięcie, obroty) i osobnym polem "przezwojenie +10%". Zaprojektuj to tak, żeby dodanie kolejnego szablonu w przyszłości nie wymagało przebudowy schematu.

4. Formularz musi mieć twardą walidację: nie da się zapisać zlecenia z pozycją cennikową wymagającą karty remontowej bez wypełnionej karty. Numer zamówienia SAP to pole tekstowe z podpowiadaniem z historii (nie ma możliwości automatycznego pobrania z SAP — brak API/eksportu, to potwierdzone ograniczenie).

5. Panel dla Justyny (rola z szerszym dostępem): widok wszystkich zleceń, dashboard braków godzinowych, oraz eksport zaznaczonych zleceń do pliku w dokładnym układzie kolumn wymaganym przez SAP: `Numer linii | Numer usługi | Krótki tekst | Ilość | Pozostało | Podst. t.JM | Cena | Wartość | Cena Mat. | Ilość Mat. | Nr Mat. dostawcy` (BRIEF sekcja 3.5).

6. Prosta autentykacja przez Supabase Auth — rola "kierownik" (przypisana do konkretnego MPK, widzi tylko swoje zlecenia) i rola "handlowiec" (Justyna, widzi wszystko + eksport).

Nie buduj żadnej integracji ani odniesienia do systemu Registo — to wyraźnie wykluczone przez klienta (BRIEF sekcja 2).

Zanim zaczniesz pisać kod: przedstaw mi krótko proponowany schemat bazy danych i strukturę stron/komponentów, żebym mógł to zatwierdzić — zwłaszcza podejście do obsługi wielu szablonów kart, bo to najbardziej niejednoznaczna część specyfikacji. Po mojej akceptacji buduj iteracyjnie, zaczynając od schematu bazy i importu cennika, potem formularz dla jednego szablonu (pompa), potem drugi szablon (silnik), na końcu panel Justyny i eksport do SAP.
