# Borsa di Classe

Simulatore di borsa con titoli inventati, account, crediti finti, grafici, classifica e pannello di amministrazione. Gira interamente su Netlify: niente database esterni da configurare, perché usa Netlify Blobs (l'archivio dati incluso in Netlify).

## Cosa c'è dentro

```
public/        il sito (index.html, style.css, app.js)
netlify/functions/api.mjs   il "cervello": account, prezzi, scambi, admin
netlify.toml   configurazione di Netlify
package.json   dipendenze
```

## Come metterlo online (10 minuti)

Serve un account gratuito su github.com e uno su netlify.com.

1. Crea un repository nuovo su GitHub (per esempio `borsa-di-classe`) e carica dentro questi file, mantenendo le cartelle così come sono.
2. Su Netlify: **Add new site → Import an existing project → GitHub**, e scegli il repository.
3. Netlify legge già tutto da `netlify.toml`: lascia i campi come li propone e premi **Deploy**.
4. Al primo avvio il sito crea da solo l'archivio dati, gli 8 titoli di partenza e il profilo amministratore.

Non usare il caricamento "drag & drop" della cartella: in quel caso Netlify non installa le dipendenze e le funzioni non partono.

### Subito dopo la pubblicazione

- Entra con **Admin** e password **Password123!**.
- Per usare un'altra password dell'Admin, cambia `"Password123!"` nella funzione `creaAdminSeNonEsiste` di `netlify/functions/api.mjs` *prima* di pubblicare il sito. Se il sito è già in uso, crea un tuo account normale e promuovilo ad amministratore dal pannello («Rendi admin»): da lì in poi userai quello.
- Su Netlify, in **Site configuration → Environment variables**, aggiungi `SESSION_SECRET` con una frase lunga a caso. Serve a firmare le sessioni: senza, chiunque conosca il codice potrebbe falsificare un accesso.

## Come funziona il mercato

- Ogni titolo si muove una volta al minuto con una variazione casuale, tarata sulla sua volatilità.
- I minuti passati mentre nessuno guardava vengono recuperati alla prima visita (fino a 2 ore: così di notte il mercato non impazzisce).
- A ogni minuto c'è circa il 6% di probabilità che un titolo abbia un crollo o un boom tra l'8% e il 30%, con la notizia relativa.
- L'amministratore può forzare un evento di qualsiasi percentuale e pubblicare notizie sue.

## Manopole da regolare

In `netlify/functions/api.mjs`, in cima al file:

| Riga | Cosa cambia |
|---|---|
| `CREDITI_INIZIALI` | crediti regalati a ogni nuovo account |
| `TICK_MS` | ogni quanto si muovono i prezzi (60000 = un minuto) |
| `MAX_RECUPERO` | quanti minuti di assenza vengono recuperati |
| `MAX_STORICO` | quanti punti tiene il grafico |
| `TITOLI_INIZIALI` | i titoli di partenza: sigla, nome, settore, prezzo, volatilità |

Volatilità: `0.01` è un titolo tranquillo, `0.04` è un titolo che fa venire l'ansia.

## Note

I crediti non hanno alcun valore e i titoli non esistono. È un gioco: nessun dato reale di borsa viene usato.
