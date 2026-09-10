# Monitor Fermata ATAC Roma — Estensione Chrome — v1.0.3

Disponibile sul [Chrome Web Store](https://chromewebstore.google.com/detail/gggjfmkiafdeembhhglhgeignejpjdnc).

## Novità

- **Orario di partenza per i mezzi fermi**: quando un bus è fermo a una fermata e il feed fornisce
  la previsione di ripartenza, la chip sotto la mappa lo mostra accanto allo stato, ad esempio
  `[443] 5026: fermo (09:20:00 |→) — tra 13 min (→| 09:33:00)`. Il marcatore `→|` sull'orario di
  arrivo compare solo quando è presente anche la partenza `|→`, così i due orari restano
  distinguibili.
- **Aggiornamento posizioni bus ogni 20 secondi** (prima 15), per un tracciamento più regolare.

## Correzioni

- **Marker duplicati sulla mappa**: in caso di aggiornamenti lenti, il ciclo successivo poteva
  partire prima che il precedente avesse finito, lasciando sulla mappa il marker "vecchio" oltre a
  quello nuovo. Ora un nuovo aggiornamento viene saltato se il precedente è ancora in corso, e i
  marker vengono sostituiti in blocco solo a fine ciclo.
- **Mezzi segnalati "già passato" per errore**: un bus in ritardo, ancora in avvicinamento, poteva
  essere marcato come già transitato solo perché l'orario previsto era passato. Ora lo stato "già
  passato" richiede sia che il mezzo sia sparito dal feed della fermata (i dati GTFS-RT rimuovono la
  fermata appena il veicolo la supera) sia che l'ultima previsione sia oltre 90 secondi nel passato.

## Note tecniche

- Nessuna modifica ai permessi richiesti.
