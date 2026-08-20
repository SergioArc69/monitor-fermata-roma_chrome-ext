# Monitor Fermata ATAC Roma — Chrome-Extension — v. 1.0.1

Disponibile sul [Chrome Web Store](https://chromewebstore.google.com/detail/gggjfmkiafdeembhhglhgeignejpjdnc).

Prima release ufficiale dell'estensione, versione "sorella" dell'app desktop per Windows
[Monitor Fermata ATAC Roma](https://github.com/SergioArc69/monitor-fermata-atac-roma),
pensata per essere installata nei browser "Chromium".

## Funzionalità principali

- **Ricerca fermata** per codice, nome o linea, con suggerimenti e lista delle fermate cercate di
  recente.
- **Arrivi in tempo reale** (GTFS-RT di Roma Mobilità), con **fallback automatico sull'orario
  schedulato** quando i dati live non sono disponibili, e integrazione delle linee con un solo bus
  in tempo reale con le corse schedulate successive, per non far sembrare una linea più rada di
  quanto sia davvero.
- **Notifiche** configurabili: soglia in minuti prima dell'arrivo e fascia oraria in cui riceverle,
  con deduplica per non essere avvisati più volte per la stessa corsa.
- **Filtro per linea**, utile nelle fermate servite da molte linee.
- **Mappa interattiva** (Leaflet + OpenStreetMap):
  - modalità "ricerca": mostra le fermate vicino alla posizione corrente (o al centro di Roma se
    non disponibile), selezionabili con un click per avviarne il monitoraggio, con ricerca
    dinamica delle fermate mentre si sposta o si zooma la mappa;
  - modalità "monitoraggio": centra sulla fermata scelta e mostra la posizione dei bus in transito,
    aggiornata ogni 15 secondi.
- **Aggiornamento automatico dei dati statici GTFS**: nessun pulsante manuale, il controllo
  avviene in background con richiesta condizionale (If-Modified-Since) quando i dati in cache non
  sono più recenti.
- **Pagina "Informazioni"**: raggiungibile dal popup (ℹ), con versione dell'estensione, autore,
  link al repository GitHub, crediti dati (Roma Mobilità, OpenStreetMap) e licenza (Unlicense).
- **Informativa sulla privacy**: disponibile sia offline dentro l'estensione sia pubblicata online
  su GitHub Pages, come richiesto dal Chrome Web Store per l'uso della posizione.

## Rifiniture d'uso

- **Indicatore di ricerca in corso**: dopo aver premuto "Monitora" (o alla riapertura del popup con
  monitoraggio già attivo), compare subito un indicatore visivo di caricamento, così l'attesa dei
  primi dati non sembra un malfunzionamento.
- **Riapertura più rapida del popup**: se il monitoraggio è già attivo, gli ultimi arrivi noti
  (raccolti dall'aggiornamento periodico in background) vengono mostrati subito, mentre in
  parallelo viene richiesto un aggiornamento aggiornato.
- **Niente schede duplicate**: sia il pulsante mappa (🗺) sia quello informazioni (ℹ) riutilizzano
  una scheda già aperta invece di aprirne una nuova a ogni click.

## Correzioni rispetto alle prime build di sviluppo

- Risolto un problema per cui, in alcuni casi, il tempo di arrivo veniva mostrato come "NaN min"
  invece che con un valore leggibile.
- Risolto un problema di layout nella barra dei bus in transito sulla mappa, che troncava in alto
  le "pillole" con lo stato dei bus.
- Risolto un problema per cui, uscendo dal monitoraggio sulla mappa, le fermate restavano
  cliccabili pur mostrando ancora lo stato "monitoraggio non attivo".
- Gli errori di rete transitori del feed GTFS-RT (feed temporaneamente non raggiungibile) non
  vengono più segnalati come errori nella console del browser, ma come avvisi: sono situazioni
  attese e gestite automaticamente al ciclo di aggiornamento successivo.

## Note tecniche

- Manifest V3, service worker in background per il polling e le notifiche periodiche.
- Nessun server proprio: l'estensione comunica direttamente, dal browser, con i feed aperti di
  Roma Mobilità e con i tile OpenStreetMap — nessuna raccolta né trasmissione di dati personali.
  