# Monitor Fermata ATAC Roma — estensione Chrome

Estensione per Chrome (e browser basati su Chromium: Edge, Brave, Opera, Vivaldi) che mostra gli
orari di arrivo dei bus a Roma in tempo reale, usando i dati aperti GTFS / GTFS-RT di
[Roma Mobilità](https://romamobilita.it/).

Versione "sorella" dell'app desktop Windows [Monitor Fermata ATAC Roma](https://github.com/SergioArc69/monitor-fermata-atac-roma).

## Funzionalità

- Ricerca fermata per codice, nome o linea, con suggerimenti e fermate recenti
- Arrivi in tempo reale (GTFS-RT), con fallback sull'orario schedulato quando i dati realtime non sono disponibili
- Notifiche configurabili (soglia minuti, fascia oraria)
- Filtro per linea
- Mappa interattiva (Leaflet + OpenStreetMap) con posizione dei bus in tempo reale
- Aggiornamento automatico e periodico dei dati statici GTFS, nessun pulsante manuale

## Sviluppo

```bash
npm install
npm run generate-proto   # rigenera src/data/generated/gtfsRealtime.* dal .proto
npm run build             # build di produzione in dist/
npm run watch              # build in watch mode
npm run typecheck
```

Per caricare l'estensione in Chrome: `chrome://extensions` → attiva "Modalità sviluppatore" →
"Carica estensione non pacchettizzata" → seleziona la cartella del repository (non `dist/`, il
`manifest.json` è alla radice).

## Dati e licenze

- Orari e posizioni bus: [Roma Mobilità](https://romamobilita.it/) (GTFS / GTFS-RT, dati aperti)
- Mappe: © collaboratori di [OpenStreetMap](https://www.openstreetmap.org/copyright)
- Codice: rilasciato nel pubblico dominio ([Unlicense](LICENSE))

## Privacy

Vedi [privacy policy](docs/privacy.html).
