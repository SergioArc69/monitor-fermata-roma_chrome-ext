# Stally - Monitor Fermata ATAC Roma — Estensione Chrome — v1.3.0

Disponibile sul [Chrome Web Store](https://chromewebstore.google.com/detail/gggjfmkiafdeembhhglhgeignejpjdnc).

## Novità

- 🪧 **Nuovo nome e nuova icona**: l'estensione ora si chiama "Stally - Monitor Fermata ATAC Roma", come
  l'app per telefono e orologio, con il nuovo cartello (STALLY, con le righe degli orari) nelle icone, nella
  pagina "Informazioni", nelle notifiche e nel tile promozionale dello store.
- 🚌 **Posizione stimata dei bus**: la posizione che arriva dal feed ha già decine di secondi, per cui sulla
  mappa un bus risultava spesso una o due fermate indietro rispetto a dove si trova davvero. Ora ogni mezzo
  viene portato avanti lungo il suo percorso (i tracciati del GTFS statico) al ritmo degli orari previsti per
  le fermate successive. Un bus fermo a una fermata resta lì fino alla partenza prevista, e uno che dalle
  ultime segnalazioni risulta fermo nel traffico avanza molto meno. È la stessa stima del server Stally. Se
  la stima non è possibile (nessun tracciato, segnalazione troppo vecchia, percorso ambiguo) il bus resta
  nella posizione segnalata.
- 🏷️ **Codice e nome della fermata nell'intestazione della mappa**: con il monitoraggio attivo l'intestazione
  riporta ora, ad esempio, "Fermata monitorata: 73953 - BONA, con la posizione dei bus in transito…".

## Note tecniche

- Nessuna modifica ai permessi richiesti: i dati restano quelli di Roma Mobilità, e i tracciati vengono
  letti dallo stesso file GTFS statico già scaricato.
- I tracciati (`shapes.txt`) vengono letti dal file in cache solo quando serve, per i mezzi presenti sulla
  mappa, e non restano in memoria oltre a quelli.
- Aggiunti test automatici della stima (`npm test`).
