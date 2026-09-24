-- Numeracja kart remontowych (KR nn/mm/rrrr) jest prowadzona najpewniej osobno w kazdym
-- MPK - globalna unikalnosc blokowalaby zapis prawdziwej karty z innego wydzialu.
-- Duplikaty w obrebie jednego zlecenia wylapuje formularz; indeks zostaje do wyszukiwania.
alter table public.karty_remontowe drop constraint if exists karty_remontowe_numer_karty_key;
create index if not exists karty_remontowe_numer_karty_idx on public.karty_remontowe (numer_karty);
