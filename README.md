# 🎄 Calendario dell'Avvento Musicale

Progetto completo per **VS Code** con HTML, CSS, JavaScript e backend Node.js **senza dipendenze da installare**.

## Funzionalità

- **23 canzoni** in ordine, una per ciascun giorno dall'1 al 23 dicembre.
- **24 dicembre** con messaggio finale di Natale (non è una 24ª canzone).
- 24 caselle natalizie responsive, ispirate al poster fornito.
- Premendo su una casella: compare il tuo **slogan** e viene avviato il lettore del brano (nel rispetto delle restrizioni autoplay di browser e YouTube).
- Ogni casella resta **aperta definitivamente**, anche dopo aver chiuso il popup, aggiornato la pagina o riavviato il server.
- Aperture **condivise** tra le persone che visitano lo stesso server (sincronizzazione ogni 15 secondi).
- Area **Gestisci** con password per scrivere slogan, modificare titoli, inserire URL video ufficiali YouTube e caricare file audio autorizzati.

## Avvio in Visual Studio Code

1. Installa [Node.js LTS](https://nodejs.org/) versione 20 o superiore.
2. Apri la cartella `calendario-avvento-musicale` in **VS Code**.
3. Apri **Terminale → Nuovo terminale**.
4. Digita:

   ```bash
   node server.js
   ```

5. Apri **http://127.0.0.1:3000** nel browser.

Non serve `npm install`. In alternativa usa `npm start`.

**Non aprire `index.html` direttamente o con Live Server**: serve l'indirizzo di Node.js, perché lo stato viene salvato dal backend.

## Scrivere gli slogan e configurare le canzoni

1. Premi **Gestisci**.
2. Inserisci la password organizzatore mostrata nel terminale di VS Code al primo avvio (resta salvata nel file `data/admin-password.txt`).
3. Seleziona una casella (01–23) e scrivi il tuo **slogan**.
4. Inserisci, se manca, il link al **video YouTube ufficiale** del brano. Oppure scegli **Carica audio** per un file MP3, M4A, OGG o WAV che hai diritto di utilizzare (max 30 MB).
5. Premi **Salva modifiche**; per i file audio premi separatamente **Carica audio**.

Sono già configurati i link per molti successi celebri. Alcune caselle (es. **BALLETTOPOLO** e **YO YO YOMINO**) non hanno un video precompilato, per evitare di associare la registrazione sbagliata. Aggiungilo una volta dall'area Gestisci e poi potrai aprire la casella.

## Attivare lo sblocco giornaliero a dicembre

Per effettuare test, per impostazione predefinita tutte le caselle sono apribili da subito. Per consentire l'apertura solo **dal giorno previsto di dicembre 2026**:

1. Copia `.env.example` in un file chiamato `.env` nella cartella principale.
2. Configura:

   ```env
   PORT=3000
   HOST=127.0.0.1
   ADMIN_PASSWORD=UNA-PASSWORD-LUNGA-E-PRIVATA
   LOCK_BY_DATE=1
   EVENT_YEAR=2026
   ```

3. Riavvia il server.

La data viene controllata nel backend nel fuso **Europe/Rome**. Le caselle già aperte in fase di prova **resteranno aperte**, come richiesto. Se devi *intenzionalmente* ripartire da zero, elimina `data/calendar.json` **prima** del lancio: non farlo su un calendario già in uso.

## Dove vengono conservati i dati

- `data/seed.json` — elenco iniziale delle 23 canzoni + finale.
- `data/calendar.json` — generato automaticamente, contiene slogan, link e data di apertura di ogni casella.
- `uploads/` — eventuali file audio caricati.
- `data/admin-password.txt` — password generata automaticamente se non presente in `.env`.

**Fai il backup di `data/` e `uploads/`** per preservare aperture e audio. In hosting sono necessarie cartelle o volumi persistenti.

## Riproduzione e diritti

I video ufficiali YouTube incorporati vengono riprodotti da YouTube: **nessun brano protetto è incluso o scaricato nel progetto**. Il lettore prova ad avviarsi automaticamente al clic; se YouTube o il browser bloccano l'autoplay, bisogna premere **▶** sul video. Alcuni video possono disattivare l'incorporamento: è sempre disponibile un link per aprirli su YouTube.

I file locali possono rendere l'avvio più affidabile, ma devono essere caricati **solo se disponi dei diritti necessari**. L'audio caricato ha precedenza sul link YouTube.

## Uso con i colleghi

Per accedere dalla rete interna imposta `HOST=0.0.0.0`, riavvia il server e apri `http://INDIRIZZO-IP-DEL-PC:3000` dai loro dispositivi (compatibilmente col firewall). Per esporlo su Internet servono **HTTPS**, una password robusta e spazio di archiviazione persistente.

Le aperture sono **globali**: tutti vedono una casella aperta dallo stesso backend. Non sono per singolo utente.

## Struttura

```text
calendario-avvento-musicale/
├── server.js          # API, password, apertura e salvataggio
├── package.json
├── .env.example
├── public/
│   ├── index.html     # Pagina e finestre di dialogo
│   ├── style.css      # Stile natalizio responsive
│   └── app.js         # Interazioni e gestione
├── data/
│   └── seed.json      # 23 canzoni + casella di Natale
└── uploads/           # Audio caricati
```
# CalendarioAvvento
