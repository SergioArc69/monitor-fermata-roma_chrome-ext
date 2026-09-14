# Monitor Fermata ATAC Roma — Estensione Chrome — v1.0.5

Disponibile sul [Chrome Web Store](https://chromewebstore.google.com/detail/gggjfmkiafdeembhhglhgeignejpjdnc).

## Correzioni

- **Mappa ancora poco affidabile dopo la v1.0.4**: il passaggio ai tile di Wikimedia (v1.0.4)
  risolveva il blocco di `tile.openstreetmap.org`, ma Wikimedia applica un rate-limit aggressivo
  che lasciava buona parte della mappa vuota/grigia durante un uso normale (pan/zoom con molte
  richieste in parallelo). La mappa ora usa [OpenFreeMap](https://openfreemap.org/) — gratuito,
  senza limiti di richieste e senza chiave API — il che però significa tile **vettoriali** invece
  che immagini raster: il motore di rendering della mappa è stato quindi sostituito, da Leaflet a
  **MapLibre GL JS**.
- Corretto il caricamento del worker di MapLibre GL JS, che nel contesto di un'estensione
  (`chrome-extension://`) non riusciva a risolvere automaticamente la propria posizione: ora viene
  indicata esplicitamente in fase di inizializzazione della mappa.

## Note tecniche

- Nuova dipendenza: `maplibre-gl` (sostituisce `leaflet`).
- Nessuna modifica ai permessi richiesti.
- Aggiornata l'informativa sulla privacy per riflettere il nuovo servizio di tile contattato.
