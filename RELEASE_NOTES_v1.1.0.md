# Monitor Fermata ATAC Roma — Estensione Chrome — v1.1.0

Disponibile sul [Chrome Web Store](https://chromewebstore.google.com/detail/gggjfmkiafdeembhhglhgeignejpjdnc).

## Novità

- 🚌 **Filtro per linea anche sulla mappa**: quando il monitoraggio è attivo, l'header della mappa mostra ora
  gli stessi checkbox per linea del filtro del popup — modificabili anche da lì, con sincronizzazione
  immediata in entrambe le direzioni (popup e mappa condividono la stessa impostazione). Prima, il
  tracciamento dei bus sulla mappa ignorava il filtro e mostrava sempre tutte le linee.
- 🗺️ **Apertura mappa centrata sulla fermata cercata**: cliccando su "Mappa" con un codice fermata valido
  già scritto nella casella di ricerca (e nessun monitoraggio attivo), la mappa si apre centrata su quella
  fermata invece che sulla posizione utente o sul centro di Roma.

## Correzioni

- I tooltip delle fermate sulla mappa potevano restare bloccati a video, senza modo di chiuderli, se il
  marker veniva rimosso (es. da un aggiornamento della vista al pan/zoom) mentre il mouse ci era ancora
  sopra.
- Rimosso un avviso innocuo ma ripetuto in console, relativo ad alcune icone dello stile della mappa non
  presenti nel set di icone associato (già corretto in locale dopo la v1.0.5, ora incluso nel rilascio).
- Aggiornato lo stile della mappa da "bright" a "liberty", ora mantenuto come predefinito da OpenFreeMap.
- Il checkbox "Filtra per linea" (popup e mappa) resta ora disattivato e deselezionato di default finché non si seleziona almeno una linea.

## Note tecniche

- Nessuna modifica ai permessi richiesti.
