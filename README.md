# STALLY - Monitor Fermata ATAC Roma — estensione Chrome

Stally - Estensione per Chrome (e browser basati su Chromium: Edge, Brave, Opera, Vivaldi) che mostra
gli orari di arrivo dei bus a Roma in tempo reale, usando i dati aperti GTFS / GTFS-RT di
[Roma Mobilità](https://romamobilita.it/).

### Versione "sorella" dell'app desktop Windows [Stally - Monitor Fermata ATAC Roma](https://github.com/SergioArc69/monitor-fermata-atac-roma).

## Funzionalità

- Ricerca fermata per codice, nome o linea, con suggerimenti e fermate recenti, oltre alla ricerca sulla mappa, usando se disponibile anche la posizione corrente dell'utente
- Arrivi in tempo reale (GTFS-RT), con fallback sull'orario schedulato quando i dati realtime non sono disponibili
- Notifiche configurabili (soglia minuti, fascia oraria)
- Filtri per linea, sia in ricerca che in monitoraggio
- Mappa interattiva (MapLibre GL JS + OpenFreeMap) con evidenziazione delle fermate e posizione dei bus in tempo reale
- Posizione stimata dei bus: la posizione del feed ha già decine di secondi, quindi sulla mappa ogni mezzo viene portato avanti lungo il suo percorso (shapes del GTFS statico) al ritmo degli orari previsti, tenendo conto dei mezzi fermi nel traffico. Stessa stima del server Stally (`src/estimate/`); se non è possibile resta la posizione segnalata. Test: `npm test`
- Aggiornamento automatico e periodico dei dati statici GTFS, nessun pulsante manuale

## Dati e licenze

- Orari e posizioni bus: [Roma Mobilità](https://romamobilita.it/) (GTFS / GTFS-RT, dati aperti)
- Mappe: [OpenFreeMap](https://openfreemap.org/), con dati cartografici © collaboratori di [OpenStreetMap](https://www.openstreetmap.org/copyright)
- Codice: rilasciato nel pubblico dominio ([Unlicense](LICENSE))

## Autore

Sergio Arcangeli

## Privacy

Vedi [privacy policy](docs/privacy.html).
