import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

/* ------------------------------------------------------------------ */
/* Impostazioni generali                                               */
/* ------------------------------------------------------------------ */

const CREDITI_INIZIALI = 100000;   // crediti regalati a ogni nuovo account
const TICK_MS = 20_000;            // un aggiornamento dei prezzi ogni 20 secondi
const MAX_RECUPERO = 360;          // al massimo 2 ore di prezzi recuperati (360 x 20s)
const MAX_STORICO = 360;           // punti tenuti nel grafico di ogni titolo (2 ore a 20s)
const SEGRETO = process.env.SESSION_SECRET || "cambia-questa-chiave-nelle-variabili-netlify";

const db = () => getStore({ name: "borsa", consistency: "strong" });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

class ErroreUtente extends Error {
  constructor(messaggio, stato = 400) {
    super(messaggio);
    this.stato = stato;
  }
}

/* ------------------------------------------------------------------ */
/* Password e sessioni                                                 */
/* ------------------------------------------------------------------ */

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

function verificaPassword(password, salt, hash) {
  const prova = crypto.scryptSync(password, salt, 32).toString("hex");
  const a = Buffer.from(prova, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function firma(payload) {
  return crypto.createHmac("sha256", SEGRETO).update(payload).digest("base64url");
}

function creaToken(username) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })
  ).toString("base64url");
  return `${payload}.${firma(payload)}`;
}

function leggiToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const atteso = firma(payload);
  if (sig.length !== atteso.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(atteso))) return null;
  try {
    const dati = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!dati.exp || dati.exp < Date.now()) return null;
    return dati.u;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Utenti                                                              */
/* ------------------------------------------------------------------ */

const chiaveUtente = (nome) => `user:${nome.trim().toLowerCase()}`;

const leggiUtente = (s, nome) => s.get(chiaveUtente(nome), { type: "json" });
const salvaUtente = (s, utente) =>
  s.set(chiaveUtente(utente.username), JSON.stringify(utente));

function nuovoUtente(username, password, ruolo = "user") {
  const { salt, hash } = hashPassword(password);
  return {
    username,
    salt,
    hash,
    ruolo,
    crediti: CREDITI_INIZIALI,
    posizioni: {},        // { SIGLA: { quantita, prezzoMedio } }
    operazioni: [],       // storico completo
    realizzato: 0,        // utile/perdita già incassato
    storicoValore: [],    // { t, v } per il grafico del portafoglio
    bloccato: false,
    creatoIl: Date.now(),
  };
}

async function creaAdminSeNonEsiste(s) {
  const esistente = await leggiUtente(s, "Admin");
  if (esistente) return esistente;
  const admin = nuovoUtente("Admin", "Password123!", "admin");
  await salvaUtente(s, admin);
  return admin;
}

async function autentica(req, s) {
  const header = req.headers.get("authorization") || "";
  const nome = leggiToken(header.replace(/^Bearer\s+/i, ""));
  if (!nome) throw new ErroreUtente("Sessione scaduta. Accedi di nuovo.", 401);
  const utente = await leggiUtente(s, nome);
  if (!utente) throw new ErroreUtente("Account non trovato.", 401);
  if (utente.bloccato) throw new ErroreUtente("Questo account è sospeso.", 403);
  return utente;
}

function soloAdmin(utente) {
  if (utente.ruolo !== "admin")
    throw new ErroreUtente("Serve il profilo Admin per questa operazione.", 403);
}

/* ------------------------------------------------------------------ */
/* Mercato                                                             */
/* ------------------------------------------------------------------ */

// Il listino parte vuoto: i titoli li quota l'Admin dal pannello.
// Se vuoi dei titoli già pronti al primo avvio, aggiungili qui prima di
// pubblicare il sito, nel formato: ["SIGLA", "Nome", "Settore", prezzo, volatilità]
const TITOLI_INIZIALI = [];

function mercatoIniziale() {
  const ora = Date.now();
  return {
    ultimoTick: ora,
    numeroTick: 0,
    titoli: TITOLI_INIZIALI.map(([sigla, nome, settore, prezzo, vol]) => ({
      sigla,
      nome,
      settore,
      prezzo,
      prezzoIniziale: prezzo,
      volatilita: vol,
      tendenza: 0.0004,
      attivo: true,
      scambi: 0,
      storico: [{ t: ora, p: prezzo }],
    })),
    notizie: [
      {
        id: crypto.randomUUID(),
        t: ora,
        testo: "Il listino è vuoto: l'Admin deve ancora quotare il primo titolo.",
        tipo: "neutro",
      },
    ],
    classifica: [],
  };
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const arrotonda = (n) => Math.round(n * 100) / 100;

const TITOLI_NOTIZIE_BUONE = [
  (n) => `${n} firma un contratto a sorpresa: gli investitori applaudono.`,
  (n) => `Conti trimestrali sopra le attese per ${n}.`,
  (n) => `${n} annuncia un nuovo prodotto e il titolo vola.`,
  (n) => `Voci di fusione intorno a ${n}: acquisti a raffica.`,
];

const TITOLI_NOTIZIE_CATTIVE = [
  (n) => `Guasto negli impianti di ${n}: produzione ferma.`,
  (n) => `${n} taglia le stime per l'anno in corso.`,
  (n) => `Indagine sui conti di ${n}: vendite pesanti.`,
  (n) => `Il capo di ${n} lascia all'improvviso.`,
];

const NOTIZIE_NEUTRE = [
  (n, v) => `${n} chiude la seduta a ${v} crediti senza scosse.`,
  (n) => `Scambi tranquilli su ${n}.`,
  (n) => `Gli analisti restano cauti su ${n}.`,
];

function scegli(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function passoMercato(m) {
  m.numeroTick += 1;
  const attivi = m.titoli.filter((t) => t.attivo);
  if (!attivi.length) return;

  for (const t of attivi) {
    const variazione = t.tendenza + gauss() * t.volatilita;
    t.prezzo = Math.min(100000, Math.max(0.5, arrotonda(t.prezzo * Math.exp(variazione))));
  }

  // Evento straordinario: crollo o boom su un titolo
  if (Math.random() < 0.06) {
    const t = scegli(attivi);
    const salita = Math.random() < 0.5;
    const forza = 0.08 + Math.random() * 0.22;
    t.prezzo = Math.max(0.5, arrotonda(t.prezzo * (salita ? 1 + forza : 1 - forza)));
    m.notizie.unshift({
      id: crypto.randomUUID(),
      t: m.ultimoTick,
      testo: scegli(salita ? TITOLI_NOTIZIE_BUONE : TITOLI_NOTIZIE_CATTIVE)(t.nome),
      tipo: salita ? "boom" : "crollo",
      sigla: t.sigla,
      variazione: arrotonda((salita ? forza : -forza) * 100),
    });
  } else if (Math.random() < 0.15) {
    const t = scegli(attivi);
    m.notizie.unshift({
      id: crypto.randomUUID(),
      t: m.ultimoTick,
      testo: scegli(NOTIZIE_NEUTRE)(t.nome, t.prezzo.toFixed(2)),
      tipo: "neutro",
      sigla: t.sigla,
    });
  }

  for (const t of m.titoli) {
    if (!t.attivo) continue;
    t.storico.push({ t: m.ultimoTick, p: t.prezzo });
    if (t.storico.length > MAX_STORICO) t.storico.splice(0, t.storico.length - MAX_STORICO);
  }
  if (m.notizie.length > 60) m.notizie.length = 60;
}

function avanzaMercato(m) {
  const ora = Date.now();
  if (ora - m.ultimoTick > TICK_MS * MAX_RECUPERO) {
    m.ultimoTick = ora - TICK_MS * MAX_RECUPERO;
  }
  let passi = 0;
  while (m.ultimoTick + TICK_MS <= ora) {
    m.ultimoTick += TICK_MS;
    passoMercato(m);
    passi++;
  }
  return passi;
}

const titolo = (m, sigla) =>
  m.titoli.find((t) => t.sigla === String(sigla || "").toUpperCase());

function patrimonio(utente, m) {
  let totale = utente.crediti;
  for (const [sigla, pos] of Object.entries(utente.posizioni || {})) {
    const t = titolo(m, sigla);
    if (t && t.attivo) totale += pos.quantita * t.prezzo;
  }
  return arrotonda(totale);
}

async function ricostruisciClassifica(s, m) {
  const { blobs } = await s.list({ prefix: "user:" });
  const righe = [];
  for (const b of blobs) {
    const u = await s.get(b.key, { type: "json" });
    if (!u) continue;
    righe.push({
      username: u.username,
      ruolo: u.ruolo,
      bloccato: !!u.bloccato,
      crediti: arrotonda(u.crediti),
      patrimonio: patrimonio(u, m),
      operazioni: (u.operazioni || []).length,
    });
  }
  righe.sort((a, b) => b.patrimonio - a.patrimonio);
  m.classifica = righe;
  return righe;
}

function ripulisciDoppioni(m) {
  // Difesa contro corse critiche: se due richieste dell'admin arrivano
  // quasi insieme possono entrambe superare il controllo "esiste già" prima
  // che una delle due venga salvata, creando due titoli con la stessa sigla.
  // Qui li fondiamo tenendo il primo (preferendo quello attivo).
  const visti = new Map();
  let cambiato = false;
  for (const t of m.titoli) {
    const esistente = visti.get(t.sigla);
    if (!esistente) {
      visti.set(t.sigla, t);
    } else {
      cambiato = true;
      if (!esistente.attivo && t.attivo) visti.set(t.sigla, t);
    }
  }
  if (cambiato) m.titoli = [...visti.values()];
  return cambiato;
}

async function caricaMercato(s, { forzaClassifica = false } = {}) {
  let m = await s.get("market", { type: "json" });
  let nuovo = false;
  if (!m) {
    m = mercatoIniziale();
    nuovo = true;
    await creaAdminSeNonEsiste(s);
  }
  const passi = avanzaMercato(m);
  const doppioniRimossi = ripulisciDoppioni(m);
  if (passi > 0 || nuovo || forzaClassifica || doppioniRimossi) {
    await ricostruisciClassifica(s, m);
    await s.set("market", JSON.stringify(m));
  }
  return m;
}

const salvaMercato = (s, m) => s.set("market", JSON.stringify(m));

/* ------------------------------------------------------------------ */
/* Risposta con lo stato completo                                      */
/* ------------------------------------------------------------------ */

function statoPubblico(utente, m) {
  return {
    ora: Date.now(),
    prossimoTick: Math.max(0, m.ultimoTick + TICK_MS - Date.now()),
    titoli: m.titoli.map((t) => ({
      sigla: t.sigla,
      nome: t.nome,
      settore: t.settore,
      prezzo: arrotonda(t.prezzo),
      prezzoIniziale: t.prezzoIniziale,
      volatilita: t.volatilita,
      attivo: t.attivo,
      scambi: t.scambi || 0,
      storico: t.storico.slice(-MAX_STORICO),
    })),
    notizie: m.notizie.slice(0, 30),
    classifica: m.classifica || [],
    io: {
      username: utente.username,
      ruolo: utente.ruolo,
      crediti: arrotonda(utente.crediti),
      posizioni: utente.posizioni || {},
      operazioni: (utente.operazioni || []).slice(0, 100),
      realizzato: arrotonda(utente.realizzato || 0),
      storicoValore: utente.storicoValore || [],
      patrimonio: patrimonio(utente, m),
      creditiIniziali: CREDITI_INIZIALI,
    },
  };
}

async function registraValore(s, utente, m) {
  const storia = utente.storicoValore || (utente.storicoValore = []);
  const ultimo = storia[storia.length - 1];
  if (!ultimo || Date.now() - ultimo.t >= TICK_MS) {
    storia.push({ t: Date.now(), v: patrimonio(utente, m) });
    if (storia.length > MAX_STORICO) storia.splice(0, storia.length - MAX_STORICO);
    await salvaUtente(s, utente);
  }
}

/* ------------------------------------------------------------------ */
/* Rotte                                                               */
/* ------------------------------------------------------------------ */

async function registrazione(s, body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!/^[A-Za-z0-9_ .-]{3,20}$/.test(username))
    throw new ErroreUtente("Il nome può avere da 3 a 20 caratteri, senza simboli strani.");
  if (password.length < 6)
    throw new ErroreUtente("La password deve avere almeno 6 caratteri.");
  if (await leggiUtente(s, username))
    throw new ErroreUtente("Questo nome è già occupato.");

  const utente = nuovoUtente(username, password);
  await salvaUtente(s, utente);
  const m = await caricaMercato(s, { forzaClassifica: true });
  return json({ token: creaToken(utente.username), stato: statoPubblico(utente, m) });
}

async function accesso(s, body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (username.toLowerCase() === "admin") await creaAdminSeNonEsiste(s);
  const utente = await leggiUtente(s, username);
  if (!utente || !verificaPassword(password, utente.salt, utente.hash))
    throw new ErroreUtente("Nome o password non corrispondono.", 401);
  if (utente.bloccato) throw new ErroreUtente("Questo account è sospeso.", 403);
  const m = await caricaMercato(s);
  await registraValore(s, utente, m);
  return json({ token: creaToken(utente.username), stato: statoPubblico(utente, m) });
}

async function scambio(s, utente, body) {
  const m = await caricaMercato(s);
  const t = titolo(m, body.sigla);
  if (!t || !t.attivo) throw new ErroreUtente("Titolo non disponibile.");
  const quantita = Math.floor(Number(body.quantita));
  if (!Number.isFinite(quantita) || quantita <= 0)
    throw new ErroreUtente("Inserisci una quantità intera maggiore di zero.");

  const prezzo = arrotonda(t.prezzo);
  const totale = arrotonda(prezzo * quantita);
  const posizioni = utente.posizioni || (utente.posizioni = {});
  const pos = posizioni[t.sigla] || { quantita: 0, prezzoMedio: 0 };

  if (body.operazione === "compra") {
    if (totale > utente.crediti)
      throw new ErroreUtente(`Ti servono ${totale.toFixed(2)} crediti, ne hai ${utente.crediti.toFixed(2)}.`);
    const nuovaQta = pos.quantita + quantita;
    pos.prezzoMedio = arrotonda((pos.prezzoMedio * pos.quantita + totale) / nuovaQta);
    pos.quantita = nuovaQta;
    utente.crediti = arrotonda(utente.crediti - totale);
    posizioni[t.sigla] = pos;
  } else if (body.operazione === "vendi") {
    if (pos.quantita < quantita)
      throw new ErroreUtente(`Possiedi solo ${pos.quantita} azioni di ${t.sigla}.`);
    const guadagno = arrotonda((prezzo - pos.prezzoMedio) * quantita);
    utente.realizzato = arrotonda((utente.realizzato || 0) + guadagno);
    pos.quantita -= quantita;
    utente.crediti = arrotonda(utente.crediti + totale);
    if (pos.quantita === 0) delete posizioni[t.sigla];
    else posizioni[t.sigla] = pos;
  } else {
    throw new ErroreUtente("Operazione sconosciuta.");
  }

  utente.operazioni = utente.operazioni || [];
  utente.operazioni.unshift({
    t: Date.now(),
    sigla: t.sigla,
    operazione: body.operazione,
    quantita,
    prezzo,
    totale,
  });
  if (utente.operazioni.length > 200) utente.operazioni.length = 200;

  t.scambi = (t.scambi || 0) + quantita;
  await salvaUtente(s, utente);
  await salvaMercato(s, m);
  return json({ stato: statoPubblico(utente, m) });
}

async function adminTitolo(s, utente, body) {
  soloAdmin(utente);
  const m = await caricaMercato(s);
  const azione = body.azione;

  if (azione === "aggiungi") {
    const sigla = String(body.sigla || "").trim().toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(sigla))
      throw new ErroreUtente("La sigla deve avere da 2 a 5 lettere.");
    if (titolo(m, sigla)) throw new ErroreUtente("Questa sigla esiste già.");
    const prezzo = Number(body.prezzo);
    if (!(prezzo > 0)) throw new ErroreUtente("Il prezzo deve essere maggiore di zero.");
    m.titoli.push({
      sigla,
      nome: String(body.nome || sigla).trim().slice(0, 40),
      settore: String(body.settore || "Varie").trim().slice(0, 24),
      prezzo: arrotonda(prezzo),
      prezzoIniziale: arrotonda(prezzo),
      volatilita: Math.min(0.2, Math.max(0.002, Number(body.volatilita) || 0.02)),
      tendenza: 0.0004,
      attivo: true,
      scambi: 0,
      storico: [{ t: Date.now(), p: arrotonda(prezzo) }],
    });
    m.notizie.unshift({ id: crypto.randomUUID(), t: Date.now(), testo: `Nuova quotazione: ${sigla}.`, tipo: "neutro", sigla });
    await ricostruisciClassifica(s, m);
    await salvaMercato(s, m);
    return json({ stato: statoPubblico(utente, m), messaggio: `${sigla} quotato in borsa.` });
  } else if (azione === "rimuovi") {
    const t = titolo(m, body.sigla);
    if (!t) throw new ErroreUtente("Titolo non trovato.");
    t.attivo = false;
    m.notizie.unshift({ id: crypto.randomUUID(), t: Date.now(), testo: `${t.nome} esce dal listino.`, tipo: "crollo", sigla: t.sigla });
    await ricostruisciClassifica(s, m);
    await salvaMercato(s, m);
    return json({ stato: statoPubblico(utente, m), messaggio: `${t.sigla} ritirato dagli scambi.` });
  } else if (azione === "riattiva") {
    const t = titolo(m, body.sigla);
    if (!t) throw new ErroreUtente("Titolo non trovato.");
    t.attivo = true;
    await ricostruisciClassifica(s, m);
    await salvaMercato(s, m);
    return json({ stato: statoPubblico(utente, m), messaggio: `${t.sigla} rimesso in listino.` });
  } else if (azione === "elimina") {
    // Cancellazione definitiva: il titolo sparisce dal listino e dai grafici.
    // Le azioni in circolazione vanno liquidate, altrimenti restano in mano
    // agli utenti senza un prezzo a cui valutarle.
    const t = titolo(m, body.sigla);
    if (!t) throw new ErroreUtente("Titolo non trovato.");
    const rimborsa = body.rimborsa !== false;
    const prezzoFinale = arrotonda(t.prezzo);
    let azionisti = 0;

    const { blobs } = await s.list({ prefix: "user:" });
    for (const b of blobs) {
      const u = await s.get(b.key, { type: "json" });
      const pos = u?.posizioni?.[t.sigla];
      if (!pos) continue;
      azionisti++;
      if (rimborsa) {
        const totale = arrotonda(pos.quantita * prezzoFinale);
        u.crediti = arrotonda(u.crediti + totale);
        u.realizzato = arrotonda(
          (u.realizzato || 0) + (prezzoFinale - pos.prezzoMedio) * pos.quantita
        );
        u.operazioni = u.operazioni || [];
        u.operazioni.unshift({
          t: Date.now(),
          sigla: t.sigla,
          operazione: "vendi",
          quantita: pos.quantita,
          prezzo: prezzoFinale,
          totale,
          nota: "liquidazione del titolo eliminato",
        });
      }
      delete u.posizioni[t.sigla];
      await salvaUtente(s, u);
    }

    m.titoli = m.titoli.filter((x) => x.sigla !== t.sigla);
    m.notizie = m.notizie.filter((n) => n.sigla !== t.sigla);
    m.notizie.unshift({
      id: crypto.randomUUID(),
      t: Date.now(),
      testo: rimborsa
        ? `${t.nome} lascia la borsa: le azioni sono state liquidate a ${prezzoFinale.toFixed(2)} crediti.`
        : `${t.nome} fallisce: le azioni non valgono più nulla.`,
      tipo: rimborsa ? "neutro" : "crollo",
    });
    await ricostruisciClassifica(s, m);
    await salvaMercato(s, m);
    return json({
      stato: statoPubblico(utente, m),
      messaggio: azionisti
        ? `${t.sigla} eliminato. ${azionisti} ${
            azionisti === 1
              ? rimborsa ? "azionista rimborsato" : "azionista azzerato"
              : rimborsa ? "azionisti rimborsati" : "azionisti azzerati"
          }.`
        : `${t.sigla} eliminato.`,
    });
  } else if (azione === "modifica") {
    const t = titolo(m, body.sigla);
    if (!t) throw new ErroreUtente("Titolo non trovato.");
    if (body.prezzo !== undefined && body.prezzo !== "") {
      const p = Number(body.prezzo);
      if (!(p > 0)) throw new ErroreUtente("Il prezzo deve essere maggiore di zero.");
      t.prezzo = arrotonda(p);
    }
    if (body.volatilita !== undefined && body.volatilita !== "") {
      const v = Number(body.volatilita);
      if (!Number.isFinite(v)) throw new ErroreUtente("Volatilità non valida.");
      t.volatilita = Math.min(0.2, Math.max(0.002, v));
    }
    if (body.nome) t.nome = String(body.nome).trim().slice(0, 40);
    t.storico.push({ t: Date.now(), p: t.prezzo });
    await ricostruisciClassifica(s, m);
    await salvaMercato(s, m);
    return json({ stato: statoPubblico(utente, m), messaggio: `${t.sigla} aggiornato: prezzo e volatilità salvati.` });
  } else {
    throw new ErroreUtente("Azione sconosciuta.");
  }

  await ricostruisciClassifica(s, m);
  await salvaMercato(s, m);
  return json({ stato: statoPubblico(utente, m) });
}

async function adminCrediti(s, utente, body) {
  soloAdmin(utente);
  const bersaglio = await leggiUtente(s, String(body.username || ""));
  if (!bersaglio) throw new ErroreUtente("Utente non trovato.");
  const importo = Number(body.importo);
  if (!Number.isFinite(importo)) throw new ErroreUtente("Importo non valido.");
  bersaglio.crediti = arrotonda(Math.max(0, bersaglio.crediti + importo));
  await salvaUtente(s, bersaglio);
  const m = await caricaMercato(s, { forzaClassifica: true });
  return json({ stato: statoPubblico(utente, m), messaggio: `Crediti aggiornati per ${bersaglio.username}.` });
}

async function adminUtente(s, utente, body) {
  soloAdmin(utente);
  const nome = String(body.username || "");
  if (nome.toLowerCase() === "admin" && body.azione !== "reimposta")
    throw new ErroreUtente("Il profilo Admin non si può toccare.");
  const bersaglio = await leggiUtente(s, nome);
  if (!bersaglio) throw new ErroreUtente("Utente non trovato.");

  if (body.azione === "sospendi") bersaglio.bloccato = true;
  else if (body.azione === "riattiva") bersaglio.bloccato = false;
  else if (body.azione === "reimposta") {
    bersaglio.crediti = CREDITI_INIZIALI;
    bersaglio.posizioni = {};
    bersaglio.operazioni = [];
    bersaglio.realizzato = 0;
    bersaglio.storicoValore = [];
  } else if (body.azione === "elimina") {
    await db().delete(chiaveUtente(nome));
    const m = await caricaMercato(s, { forzaClassifica: true });
    return json({ stato: statoPubblico(utente, m), messaggio: `${nome} eliminato.` });
  } else if (body.azione === "promuovi") bersaglio.ruolo = "admin";
  else if (body.azione === "declassa") bersaglio.ruolo = "user";
  else throw new ErroreUtente("Azione sconosciuta.");

  await salvaUtente(s, bersaglio);
  const m = await caricaMercato(s, { forzaClassifica: true });
  return json({ stato: statoPubblico(utente, m), messaggio: `${bersaglio.username} aggiornato.` });
}

async function adminEvento(s, utente, body) {
  soloAdmin(utente);
  const m = await caricaMercato(s);
  const t = titolo(m, body.sigla);
  if (!t) throw new ErroreUtente("Titolo non trovato.");
  const percentuale = Number(body.percentuale);
  if (!Number.isFinite(percentuale) || percentuale === 0)
    throw new ErroreUtente("Indica una percentuale diversa da zero.");
  t.prezzo = Math.max(0.5, arrotonda(t.prezzo * (1 + percentuale / 100)));
  t.storico.push({ t: Date.now(), p: t.prezzo });
  m.notizie.unshift({
    id: crypto.randomUUID(),
    t: Date.now(),
    testo:
      body.testo?.trim() ||
      (percentuale > 0
        ? `${t.nome} vola dopo un annuncio a sorpresa.`
        : `${t.nome} affonda: gli investitori scappano.`),
    tipo: percentuale > 0 ? "boom" : "crollo",
    sigla: t.sigla,
    variazione: arrotonda(percentuale),
  });
  await ricostruisciClassifica(s, m);
  await salvaMercato(s, m);
  return json({ stato: statoPubblico(utente, m), messaggio: `Evento applicato a ${t.sigla}.` });
}

async function adminNotizia(s, utente, body) {
  soloAdmin(utente);
  const m = await caricaMercato(s);

  if (body.azione === "elimina") {
    const id = String(body.id || "");
    const prima = m.notizie.length;
    m.notizie = m.notizie.filter((n) => n.id !== id);
    if (m.notizie.length === prima) throw new ErroreUtente("Notizia non trovata: probabilmente qualcuno l'ha già eliminata.");
    await salvaMercato(s, m);
    return json({ stato: statoPubblico(utente, m), messaggio: "Notizia eliminata." });
  }

  const testo = String(body.testo || "").trim().slice(0, 160);
  if (!testo) throw new ErroreUtente("Scrivi il testo della notizia.");
  m.notizie.unshift({ id: crypto.randomUUID(), t: Date.now(), testo, tipo: "neutro", autore: utente.username });
  if (m.notizie.length > 60) m.notizie.length = 60;
  await salvaMercato(s, m);
  return json({ stato: statoPubblico(utente, m), messaggio: "Notizia pubblicata." });
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async (req) => {
  const s = db();
  const rotta = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  try {
    if (rotta === "registrazione") return await registrazione(s, body);
    if (rotta === "accesso") return await accesso(s, body);

    const utente = await autentica(req, s);

    if (rotta === "stato") {
      const m = await caricaMercato(s);
      await registraValore(s, utente, m);
      return json({ stato: statoPubblico(utente, m) });
    }
    if (rotta === "scambio") return await scambio(s, utente, body);
    if (rotta === "admin/titolo") return await adminTitolo(s, utente, body);
    if (rotta === "admin/crediti") return await adminCrediti(s, utente, body);
    if (rotta === "admin/utente") return await adminUtente(s, utente, body);
    if (rotta === "admin/evento") return await adminEvento(s, utente, body);
    if (rotta === "admin/notizia") return await adminNotizia(s, utente, body);

    return json({ errore: "Indirizzo non valido." }, 404);
  } catch (e) {
    if (e instanceof ErroreUtente) return json({ errore: e.message }, e.stato);
    console.error(e);
    return json({ errore: "Il server ha avuto un problema. Riprova." }, 500);
  }
};

export const config = { path: "/api/*" };
