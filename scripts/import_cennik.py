"""Generuje SQL importu cennika Synthos z pliku CSV (eksport z SAP, separator ';').

Uzycie:  python scripts/import_cennik.py docs/cennik_synthos_pelny.csv > cennik.sql
Wynik wykonac w Supabase (SQL editor). Import jest idempotentny: istniejace pozycje
(kategoria + numer linii) dostaja nowy opis/cene, niczego nie usuwa.

Cennik jest poufny - ani CSV, ani wygenerowany SQL nie trafiaja do repozytorium.
"""
import csv
import sys

# Kategorie, dla ktorych karta remontowa jest obowiazkowa (BRIEF 3.4) i jej szablon.
# Pozostale mozna wlaczyc pozniej w aplikacji (Cennik -> kategorie), bez migracji.
KARTY = {
    100: "urzadzenie",  # Remont pomp
    110: "urzadzenie",  # Remont przekladni
    540: "urzadzenie",  # Remont przekladni - Energetyka
    550: "urzadzenie",  # Remont przekladni Most Przeladunkowy
    120: "silnik",      # Remont silnikow elektrycznych
}


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main(path: str) -> None:
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f, delimiter=";"))
    naglowek, dane = rows[0], rows[1:]
    assert naglowek[5].startswith("Numer us"), f"nieoczekiwany naglowek: {naglowek}"

    kategorie: dict[int, tuple[str, str]] = {}
    pozycje = []
    pominiete = 0
    for r in dane:
        # Wiersze sum na koncu eksportu SAP nie maja numeru pozycji ani uslugi.
        if not r[2].strip() or not r[5].strip():
            pominiete += 1
            continue
        nr = int(r[2])
        kategorie.setdefault(nr, (r[3].strip(), r[1].strip()))
        cena = r[9].strip().replace(" ", "").replace(",", ".")
        pozycje.append((nr, int(r[4]), r[5].strip(), r[6].strip(), r[8].strip(), cena))

    out = sys.stdout
    out.write("begin;\n")
    out.write("insert into public.cennik_kategorie (nr_pozycji, nazwa, dokument_zaopatrzeniowy, wymaga_karty, szablon_karty) values\n")
    out.write(",\n".join(
        f"({nr}, {q(nazwa)}, {q(dok)}, {'true' if nr in KARTY else 'false'}, {q(KARTY[nr]) if nr in KARTY else 'null'})"
        for nr, (nazwa, dok) in sorted(kategorie.items())
    ))
    out.write("\non conflict (nr_pozycji) do update set nazwa = excluded.nazwa, dokument_zaopatrzeniowy = excluded.dokument_zaopatrzeniowy;\n\n")

    out.write("insert into public.cennik_pozycje (nr_pozycji, numer_linii, indeks_sap, opis, jm, cena) values\n")
    out.write(",\n".join(
        f"({nr}, {linia}, {q(idx)}, {q(opis)}, {q(jm)}, {cena})"
        for nr, linia, idx, opis, jm, cena in pozycje
    ))
    out.write("\non conflict (nr_pozycji, numer_linii) do update set indeks_sap = excluded.indeks_sap, "
              "opis = excluded.opis, jm = excluded.jm, cena = excluded.cena;\n")
    out.write("commit;\n")
    print(f"-- kategorie: {len(kategorie)}, pozycje: {len(pozycje)}, pominiete wiersze sum: {pominiete}",
          file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/cennik_synthos_pelny.csv")
