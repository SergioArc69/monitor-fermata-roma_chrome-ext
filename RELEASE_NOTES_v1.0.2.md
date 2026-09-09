# Monitor Fermata ATAC Roma — Estensione Chrome — v1.0.2

Disponibile sul [Chrome Web Store](https://chromewebstore.google.com/detail/gggjfmkiafdeembhhglhgeignejpjdnc).

## Novità

- **Bus già passati visibili sulla mappa**: i mezzi che hanno appena superato la fermata monitorata
  restano visibili per 10 minuti, evidenziati in blu con l'etichetta "già passato"/"passato X min
  fa", con la posizione aggiornata in tempo reale (non restano fermi nel punto di passaggio).
- **Identificativo linea sui bus in mappa**: l'etichetta di ogni bus mostra ora anche la linea, ad
  esempio `[443] 5045: fermo — tra 11 min (16:02:22)` — utile nelle fermate servite da più linee.
- **Pulsante "Ferma monitoraggio" sulla mappa**: permette di interrompere il monitoraggio e tornare
  alla ricerca delle fermate vicine senza dover chiudere e riaprire la mappa.
- **Orario del giorno successivo come fallback**: se si attiva il monitoraggio di una fermata dopo
  l'ultima corsa della giornata, la lista non resta più vuota — vengono mostrate le prime corse
  schedulate del giorno dopo.

## Correzioni

- I bus già passati non sparivano più dopo 10 minuti come previsto, ma dopo circa 1 minuto: il feed
  GTFS-RT non mantiene l'informazione di una fermata già transitata per più di un minuto, quindi ora
  l'estensione la ricorda autonomamente per l'intera finestra di 10 minuti, indipendentemente da
  cosa riporta il feed in quel momento.

## Note tecniche

- Nessuna modifica ai permessi richiesti.
