# Monitor Fermata ATAC Roma — Estensione Chrome — v1.2.0

Disponibile sul [Chrome Web Store](https://chromewebstore.google.com/detail/gggjfmkiafdeembhhglhgeignejpjdnc).

## Novità

- 🔤 **Parola chiave "LINEE" nella ricerca**: quando non si ricorda il codice esatto di una fermata, scrivere
  "LINEE" nel campo di ricerca elenca tutte le linee note; sceglierne una rimette il suo codice nel campo,
  che a quel punto lista le fermate di quella linea in ordine di percorso.
- 🚏 **Fermate metro/tram/treno distinguibili sulla mappa**: in modalità ricerca, le fermate servite anche
  da un mezzo diverso dal bus hanno ora un pin rosso invece che blu — colore, non forma, per restare leggibile
  senza bisogno di una legenda.
- 🎯 **Pin più precisi in modalità ricerca**: sostituita l'emoji 📍 (colore fisso, diverso da sistema a
  sistema) con un pin disegnato via CSS, ancorato esattamente sulla posizione della fermata.
- 🧭 **Filtro per linea anche in modalità ricerca**: prima disponibile solo col monitoraggio attivo, ora la
  barra del filtro compare anche mentre si esplora la mappa, con l'elenco di tutte le linee note — selezionarne
  una o più mostra solo le fermate che servono.
- 👁️ **Nuovo checkbox "Solo linee visibili"**: in modalità ricerca, restringe l'elenco delle linee selezionabili
  a quelle per cui è disegnato almeno un pin nella vista corrente, invece di scorrere tutte le linee della città.
  Si aggiorna da solo muovendo o zoomando la mappa.
- 🚌 **"Vedi tutti i mezzi della linea"**: con monitoraggio attivo e una sola linea selezionata nel filtro, un
  nuovo checkbox mostra sulla mappa ogni bus di quella linea in circolazione in città, non solo quelli già
  visti dalla fermata monitorata.
- ⏱️ **Aggiornamento posizione bus ogni 10 secondi** (prima 20): allineato alla cadenza reale con cui Roma
  Mobilità pubblica i dati.
- 📋 **Lista arrivi più leggibile**: quando tutte le corse di una linea vanno verso la stessa destinazione, la
  destinazione compare una sola volta nell'intestazione invece che ripetuta su ogni riga; minuti e orario in
  una colonna, ritardo separato a destra.

## Correzioni

- Un codice fermata inesistente non avvia più un polling inutile né si aggiunge alle "fermate recenti": viene
  rifiutato subito, prima di avviare il monitoraggio.
- "—" (destinazione sconosciuta) non viene più trattato come una destinazione condivisa da tutte le corse di
  una linea, evitando di nascondere per errore le destinazioni reali sotto un'intestazione fittizia.
- Corretta la scritta della mappa che riportava ancora "aggiornata ogni 20 secondi" dopo il passaggio a 10s.
- Avviare o fermare il monitoraggio (da popup o da mappa) ora azzera sempre il filtro per linea condiviso:
  prima poteva restare una selezione invisibile e non più raggiungibile da un'altra modalità.
- Nella barra del filtro linee, ora solo l'elenco delle linee scorre orizzontalmente quando non ci sta nello
  spazio disponibile: le due checkbox ai lati restano sempre visibili, invece di scorrere via con il resto.
- Le chip delle linee in modalità ricerca a volte non comparivano affatto finché non si muoveva la mappa,
  anche a scansione dei dati statici completata.

## Note tecniche

- Nessuna modifica ai permessi richiesti.
- Le funzionalità di ricerca per linea, filtro sulla mappa e distinzione bus/non-bus dipendono da una
  scansione in background dei dati statici che richiede qualche secondo dopo l'avvio: fino ad allora restano
  semplicemente vuote o non disponibili, senza bloccare il resto dell'estensione.
