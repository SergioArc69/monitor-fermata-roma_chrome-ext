# Listing Chrome Web Store — bozza (italiano)

## Titolo (max 45 caratteri)
Monitor Fermata ATAC Roma

## Descrizione breve (max 132 caratteri)
Orari bus in tempo reale per le fermate di Roma, con mappa e notifiche di arrivo. Dati aperti Roma Mobilità.

## Descrizione estesa
Monitor Fermata ATAC Roma mostra gli orari di arrivo dei bus (e metro/tram) a Roma in tempo
reale, usando i dati aperti GTFS-RT di Roma Mobilità — comodo da controllare mentre sei ancora
alla scrivania, prima di uscire verso la fermata.

Funzionalità principali:
• Ricerca fermata per codice, nome o linea, con fermate recenti
• Arrivi in tempo reale, con fallback automatico sull'orario schedulato quando i dati live non
  sono disponibili
• Notifiche configurabili: scegli quanti minuti prima dell'arrivo vuoi essere avvisato e in quale
  fascia oraria
• Filtro per linea, utile nelle fermate con molte linee
• Mappa interattiva con la posizione dei bus in transito in tempo reale
• Aggiornamento automatico dei dati orari: nessun pulsante da premere

Nessun account richiesto, nessuna pubblicità, nessun tracciamento. Il codice è open source.

## Categoria
Strumenti (Tools) / Trasporti

## Lingua
Italiano

## Privacy policy URL
https://sergioarc69.github.io/monitor-fermata-roma_chrome-ext/privacy.html

## Sito web / supporto
https://github.com/SergioArc69/monitor-fermata-roma_chrome-ext

## Singolo scopo
Mostrare gli orari di arrivo in tempo reale dei bus (e metro/tram) a una fermata di Roma scelta
dall'utente, con mappa e notifiche di avviso, usando i dati aperti GTFS/GTFS-RT di Roma Mobilità.

## Uso di codice remoto
No. Tutto il codice JavaScript eseguito dall'estensione è incluso nel pacchetto caricato (bundle
generato in fase di build) e nessuno script esterno viene caricato o eseguito a runtime — la
Content Security Policy dell'estensione (`script-src 'self'`) lo impedisce esplicitamente.
L'estensione scarica da romamobilita.it solo dati (orari GTFS e aggiornamenti GTFS-RT in formato
protobuf/JSON), non codice eseguibile.

## Giustificazione permessi (richiesta in fase di submission)
- storage: salvare fermata monitorata, impostazioni notifiche/filtro linee e cache dati GTFS, solo
  in locale
- alarms: aggiornare periodicamente in background gli arrivi della fermata monitorata (poll ogni
  minuto)
- notifications: mostrare la notifica di bus in arrivo
- host permission romamobilita.it: scaricare i dati aperti GTFS/GTFS-RT (orari e posizioni bus)
  necessari al funzionamento dell'estensione
