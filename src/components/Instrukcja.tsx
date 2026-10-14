import type { ReactNode } from 'react'
import type { Profil } from '@/lib/types'

function Krok({ nr, tytul, children }: { nr: number | string; tytul: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-limonka text-sm font-semibold">{nr}</span>
      <div className="pb-2">
        <p className="font-medium">{tytul}</p>
        <div className="mt-0.5 space-y-1 text-sm text-slate-700">{children}</div>
      </div>
    </li>
  )
}

const Uwaga = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">{children}</p>
)

/** Instrukcja wbudowana w aplikację - kierownik widzi swoją część, dział handlowy obie. */
export function Instrukcja({ profil }: { profil: Profil }) {
  const handlowiec = profil.rola === 'handlowiec'
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Instrukcja</h2>
        <p className="text-sm text-slate-500">
          Jak rozliczyć pracę dla Synthos od karty kierownika do wpisu w SAP. Publiczna wersja do wysłania innym (bez logowania):{' '}
          <a className="text-blekit-ciemny underline" href={`${import.meta.env.BASE_URL}instrukcja.html`} target="_blank" rel="noopener">
            {`${window.location.origin}${import.meta.env.BASE_URL}instrukcja.html`}
          </a>
        </p>
      </div>

      <section className="sekcja space-y-3">
        <h3 className="font-semibold">Jak to działa w skrócie</h3>
        <ol className="grid gap-3 sm:grid-cols-3">
          <li className="rounded-md bg-slate-50 p-3 text-sm">
            <p className="font-semibold">1. Kierownik wydziału</p>
            Po remoncie wpisuje zlecenie: numer zamówienia SAP, robociznę, materiały i karty remontowe.
            Klika <strong>„Złóż do rozliczenia”</strong>.
          </li>
          <li className="rounded-md bg-slate-50 p-3 text-sm">
            <p className="font-semibold">2. Dział handlowy</p>
            Widzi złożone zlecenia, sprawdza je i jednym kliknięciem kopiuje gotowe linie w układzie SAP
            (albo pobiera plik XLSX).
          </li>
          <li className="rounded-md bg-slate-50 p-3 text-sm">
            <p className="font-semibold">3. SAP Synthos</p>
            Dział handlowy wkleja linie w rozliczenie zamówienia w SAP i oznacza zlecenie w aplikacji jako
            <strong> „wyeksportowane”</strong>.
          </li>
        </ol>
        <p className="text-sm text-slate-700">
          Gdy coś się nie zgadza, dział handlowy <strong>zwraca zlecenie do poprawki</strong> z komentarzem. Kierownik
          poprawia je i składa ponownie. Ceny i indeksy SAP pochodzą zawsze z cennika kontraktowego, więc nikt nie musi
          ich przepisywać ani pilnować aktualnych stawek.
        </p>
        <p className="text-sm text-slate-700">
          <strong>Pierwsze logowanie:</strong> login to służbowy e-mail, hasło tymczasowe dostajesz od administratora.
          Aplikacja od razu poprosi o ustawienie własnego hasła (min. 6 znaków, w tym jeden znak specjalny).
        </p>
      </section>

      <section className="sekcja space-y-3">
        <h3 className="font-semibold">Dla kierownika - wpisanie zlecenia</h3>
        <ol className="space-y-2">
          <Krok nr={1} tytul="Nowe zlecenie">
            <p>„Moje zlecenia” → <strong>Nowe zlecenie</strong>. Gdy robisz kolejny remont tego samego typu (np. znowu pompa 3X9K),
              otwórz poprzednie i kliknij <strong>„Kopiuj jako nowe”</strong>. Przepisze się nagłówek i pozycje, a numer zamówienia, materiały i karty wpisujesz na nowo.</p>
          </Krok>
          <Krok nr={2} tytul="Dane zlecenia (to, co było na górze karty w Excelu)">
            <p><strong>Nazwa</strong>: np. „POMPA 3X9K NR 422”. <strong>Nr zamówienia SAP</strong>: numer 4200… z FIORI. Aplikacja podpowiada numery wpisane wcześniej.
              <strong> Pozycja zamówienia</strong>: końcówka typu -10 / -20, jeśli zamówienie ma kilka pozycji.
              <strong> Konto</strong> (np. URR/1/2026/BZ), <strong>Mechanik</strong>, daty.</p>
            <p><strong>Rodzaj karty</strong>: pompa/urządzenie, silnik elektryczny albo „inne” dla nietypowej pracy.</p>
            <p><strong>Nr linii zam. - usługi / materiały</strong>: numery linii nadaje Synthos przy tworzeniu zamówienia w SAP (często 10 dla usług i 20 dla materiału). Przepisz je z zamówienia.
              Jeśli ich nie znasz, zostaw puste - dział handlowy uzupełni je w SAP. Inny numer dla pojedynczej pozycji wpiszesz w kolumnie „Nr linii”.</p>
          </Krok>
          <Krok nr={3} tytul="Robocizna wg cennika">
            <p>Wpisz w wyszukiwarkę fragment nazwy z umowy, np. <em>„3x9k”</em>, <em>„siln 7,5 1400”</em> albo <em>„uszczelek”</em>, i kliknij pozycję.
              <strong> Ilość</strong> to liczba sztuk (5 pomp = 5). Cena podstawia się sama z cennika.</p>
            <p><strong>Dopłata</strong>: przy silniku wybierz „Przezwojenie +10%”, a każdą inną dopłatę wpisz przez „inna (wpisz)”.
              Pod pozycją możesz dopisać uwagi, np. wykaz uszczelek albo numery urządzeń.</p>
            <p>Kolumna <strong>„Karta”</strong>: zaznaczona, gdy pozycja wymaga karty remontowej. Dla pomp, przekładni i silników zaznacza się sama, ale możesz ją odznaczyć, jeśli w tym zleceniu karta nie jest potrzebna.</p>
            <p>Pracy nie ma w cenniku? Użyj przycisku <strong>„Pozycja spoza cennika”</strong> i wpisz opis oraz cenę ręcznie. Dział handlowy zobaczy ją oznaczoną do sprawdzenia.</p>
          </Krok>
          <Krok nr={4} tytul="Robocizna wg rbg (godziny)">
            <p>Wpisz liczbę roboczogodzin w kratce <strong>stanowisko × pora dnia</strong> (7–15, 15–19, 19–7, dni wolne). Stawka bierze się z cennika.</p>
            <p>Godziny przepracowane przez ludzi z innego MPK dodaj w części <strong>„Kooperacja z innym MPK”</strong>. Zastępuje to dopiski typu „20 RBG DLA SPORYSZ”.</p>
          </Krok>
          <Krok nr={5} tytul="Materiały">
            <p>Zacznij pisać nazwę, np. „łożysko 6308”. Aplikacja pokaże pasujące towary z <strong>cenami zakupu z Optimy</strong> (dokument PZ/FZ, dostawca, miesiąc)
              i z wcześniejszych rozliczeń, do 5 ostatnich zakupów na towar. Kliknij cenę, a wstawią się nazwa, cena zakupu i dokument.</p>
            <p>Możesz też wpisać ręcznie <strong>cenę za jednostkę</strong> albo <strong>łączną wartość z faktury</strong>, a drugie pole policzy się samo.
              Narzut (domyślnie 12%) i wartość z narzutem liczą się automatycznie i są widoczne w osobnych kolumnach. Enter w ostatniej kolumnie dodaje wiersz.</p>
            <p><strong>Dostarczył</strong>: Bioerg, <strong>Synthos (narzut 0%, nie idzie do rozliczenia)</strong> albo „inne (wpisz)”, np. „z demontażu”. Przy innym dostawcy narzut ustawiasz sam.</p>
          </Krok>
          <Krok nr={6} tytul="Karty remontowe">
            <p>Pompy, przekładnie i silniki z umowy wymagają karty remontowej, <strong>jednej na każdą sztukę</strong>. Aplikacja pokazuje, ile kart brakuje.
              Przycisk <strong>„Dodaj brakujące karty”</strong> tworzy je z podpowiedzianym numerem KR.</p>
            <p>Pola z czerwoną gwiazdką są obowiązkowe. Zakres remontu zaznaczasz na liście, a czynności spoza listy wpisujesz w polu „Inne czynności”.</p>
            <p>Przycisk <strong>PDF</strong> przy karcie pobiera ją jako plik do załączenia w Synthosie. „PDF wszystkich kart” daje jeden plik z kartami całego zlecenia.</p>
          </Krok>
          <Krok nr={7} tytul="Braki godzin">
            <p>Jeśli zleceniodawca założył w zamówieniu za mało godzin, kliknij „+ Zgłoś brak godzin”. Dział handlowy będzie pilnował uzupełnienia.</p>
          </Krok>
          <Krok nr={8} tytul="Zapisz i złóż">
            <p><strong>Zapisz</strong> możesz klikać w każdej chwili, nawet z niepełnymi danymi, bo to wersja robocza.
              Na koniec kliknij <strong>„Złóż do rozliczenia”</strong>. Aplikacja nie przepuści zlecenia bez numeru zamówienia i bez kompletnych kart.</p>
            <p>Złożyłeś za wcześnie albo z błędem? Dopóki dział handlowy nie wyeksportował zlecenia do SAP, kliknij <strong>„Wycofaj do poprawy”</strong> - wróci do wersji roboczej.</p>
            <p>Po złożeniu zlecenie jest zablokowane. Jeśli dział handlowy je zwróci, zobaczysz żółty komunikat z opisem, co poprawić. Popraw i złóż ponownie.</p>
            <p><strong>Drukuj</strong> drukuje zlecenie z kartami, np. do podpisu.</p>
          </Krok>
        </ol>
      </section>

      {handlowiec && (
        <section className="sekcja space-y-3">
          <h3 className="font-semibold">Dla działu handlowego - wprowadzenie do SAP</h3>
          <ol className="space-y-2">
            <Krok nr={1} tytul="Zakładka „Eksport do SAP”">
              <p>Lista zleceń złożonych przez kierowników. Strzałka przy zleceniu pokazuje dokładnie te linie, które trafią do SAP
                (Numer linii, Numer usługi, Krótki tekst, Ilość, …). Klik w nazwę otwiera całe zlecenie.</p>
              <p>Zlecenia z żółtym oznaczeniem <strong>„pozycja spoza cennika”</strong> wymagają sprawdzenia opisu, ceny i indeksu.
                Szare oznaczenie <strong>„bez nr linii”</strong> znaczy, że kierownik nie wpisał numeru linii zamówienia. Uzupełnij go w zleceniu albo w SAP po wklejeniu.</p>
            </Krok>
            <Krok nr={2} tytul="Wklejenie do SAP">
              <p><strong>Kopiuj</strong> przy zleceniu kopiuje jego linie do schowka. W SAP otwórz rozliczenie tego zamówienia i wklej (Ctrl+V).</p>
              <p>Można też zaznaczyć kilka zleceń i kliknąć <strong>„Pobierz XLSX”</strong>. W pliku:</p>
              <ul className="list-disc pl-5">
                <li><strong>„Linie SAP”</strong> (pierwszy arkusz) - wszystkie zamówienia jedno pod drugim, gotowe do skopiowania;</li>
                <li><strong>„Szczegóły”</strong> - całe rozliczenie: pozycje z cennika, roboczogodziny i materiał z ceną zakupu, narzutem i dokumentem PZ/FZ;</li>
                <li><strong>„Zestawienie”</strong> - suma na zamówienie, oraz osobny arkusz dla każdego zamówienia.</li>
              </ul>
              <p>Ten sam plik dla pojedynczego zlecenia pobierzesz przyciskiem <strong>„XLSX”</strong> u góry zlecenia.</p>
            </Krok>
            <Krok nr={3} tytul="Oznacz jako wyeksportowane">
              <p>Po wprowadzeniu do SAP zaznacz zlecenia i kliknij <strong>„Oznacz jako wyeksportowane”</strong>. Znikną z listy i będą zablokowane, więc nic nie zostanie wklejone dwa razy.
                Pomyłka? Otwórz zlecenie i kliknij <strong>„Cofnij eksport”</strong>. „Ostatnie eksporty” pozwalają pobrać dawny plik ponownie.</p>
            </Krok>
            <Krok nr={4} tytul="Poprawki">
              <p><strong>„Zakończony”</strong> - ostatni status, gdy zlecenie jest już rozliczone. Ustawisz go przyciskiem „Zakończ” w wyeksportowanym zleceniu
                albo zbiorczo na liście zleceń (zaznacz wyeksportowane → „Oznacz jako zakończone”). Na liście możesz sortować po każdej kolumnie (klik w nagłówek), także po statusie,
                a filtr „Otwarte” ukrywa zakończone.</p>
              <p><strong>„Zmień status”</strong> (w zleceniu, na dole) pozwala ręcznie ustawić dowolny status: roboczy, złożony, zwrócony, wyeksportowany, zakończony - np. gdy coś oznaczono przez pomyłkę.
                Trzeba podać powód; zmiana i powód zapisują się w „Historii zmian” zlecenia. Status braku godzin (zgłoszony / uzupełniony / rozliczony) zmienisz w każdą stronę w zakładce „Braki godzin”.</p>
              <p>Drobny błąd możesz poprawić sama w zleceniu i kliknąć „Zapisz”. Jeśli poprawić musi kierownik, kliknij <strong>„Zwróć do poprawki”</strong> i napisz, co nie gra.</p>
            </Krok>
            <Krok nr={5} tytul="Ceny z Optimy">
              <p>W zakładce <strong>„Ceny z Optimy”</strong> wgrywasz eksport listy <strong>Handel → Zasoby</strong> (Excel). Od tej chwili przy wpisywaniu materiału
                aplikacja podpowiada towary z Optimy z ceną zakupu, dokumentem PZ/FZ i dostawcą.</p>
              <p>Lista „Zasoby” zawiera tylko <strong>ostatni</strong> zakup każdego towaru. Wgrywaj nowy eksport np. raz w tygodniu: każdy import dopisuje nowe zakupy,
                więc historia „5 ostatnich zakupów” będzie rosła.</p>
            </Krok>
            <Krok nr={6} tytul="Braki godzin, cennik, użytkownicy">
              <p><strong>Braki godzin</strong>: lista zgłoszonych braków z podsumowaniem na MPK. Zmieniasz w niej status: zgłoszony → uzupełniony przez klienta → rozliczony.</p>
              <p><strong>Cennik</strong>: podgląd umowy, <strong>domyślny narzut na materiał</strong> (obecnie 12%) i ustawienie, które kategorie domyślnie wymagają karty remontowej.</p>
              <p><strong>Użytkownicy</strong>: zakładanie kont (hasło tymczasowe pokazuje się raz), zmiana roli (kierownik / dział handlowy), przypisywanie MPK kierownikom, reset hasła.</p>
            </Krok>
          </ol>
          <Uwaga>
            Układ eksportu jest wstępny: numer linii z zamówienia (wpisany przez kierownika albo pusty), materiał jako pozycja 5004062 z ilością = wartość z narzutem po 1 zł.
            Sprawdź go na pierwszych zleceniach i zgłoś, czym różni się od tego, co faktycznie wklejasz do SAP. Poprawka jest szybka.
          </Uwaga>
        </section>
      )}
    </div>
  )
}
