/* ==================================================================
   Borsa di Classe — interfaccia
   ================================================================== */

const $ = (id) => document.getElementById(id);
const CHIAVE_TOKEN = "borsa_token";

let token = localStorage.getItem(CHIAVE_TOKEN);
let S = null;              // ultimo stato ricevuto dal server
let sceltoSigla = null;    // titolo selezionato nel listino
let vista = "mercato";
let timerSondaggio = null;
let modoGate = "accesso";

const numero = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intero = new Intl.NumberFormat("it-IT");
const fmt = (n) => numero.format(Number(n) || 0);
const ora = (t) => new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const dataOra = (t) => new Date(t).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const segno = (n) => (n > 0 ? "su" : n < 0 ? "giu" : "pari");
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const conSegno = (n) => (n > 0 ? "+" : "") + fmt(n);

/* ---------- Chiamate al server ---------- */

async function api(rotta, corpo) {
  const risposta = await fetch(`/api/${rotta}`, {
    method: corpo ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dati = await risposta.json().catch(() => ({ errore: "Risposta non leggibile." }));
  if (!risposta.ok) {
    if (risposta.status === 401) esci(false);
    throw new Error(dati.errore || "Qualcosa non ha funzionato.");
  }
  return dati;
}

/* ---------- Accesso ---------- */

function impostaModo(nuovo) {
  modoGate = nuovo;
  $("tab-accesso").classList.toggle("switch-on", nuovo === "accesso");
  $("tab-registrazione").classList.toggle("switch-on", nuovo === "registrazione");
  $("gate-submit").textContent = nuovo === "accesso" ? "Entra nel mercato" : "Crea l'account";
  $("gate-hint").textContent =
    nuovo === "accesso"
      ? "Nuovo qui? Passa a «Crea account»: ricevi 100.000 crediti."
      : "Scegli un nome riconoscibile: comparirà in classifica.";
  $("g-password").autocomplete = nuovo === "accesso" ? "current-password" : "new-password";
  $("gate-error").hidden = true;
}

$("tab-accesso").onclick = () => impostaModo("accesso");
$("tab-registrazione").onclick = () => impostaModo("registrazione");

$("form-auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bottone = $("gate-submit");
  bottone.disabled = true;
  $("gate-error").hidden = true;
  try {
    const dati = await api(modoGate, {
      username: $("g-username").value,
      password: $("g-password").value,
    });
    token = dati.token;
    localStorage.setItem(CHIAVE_TOKEN, token);
    avvia(dati.stato);
  } catch (err) {
    $("gate-error").textContent = err.message;
    $("gate-error").hidden = false;
  } finally {
    bottone.disabled = false;
  }
});

function esci(ricarica = true) {
  token = null;
  localStorage.removeItem(CHIAVE_TOKEN);
  clearInterval(timerSondaggio);
  if (ricarica) location.reload();
  else {
    $("app").hidden = true;
    $("gate").hidden = false;
  }
}
$("esci").onclick = () => esci();

/* ---------- Avvio ---------- */

function avvia(stato) {
  $("gate").hidden = true;
  $("app").hidden = false;
  aggiorna(stato);
  clearInterval(timerSondaggio);
  timerSondaggio = setInterval(sondaggio, 10000);
  setInterval(disegnaConteggio, 1000);
}

async function sondaggio() {
  try {
    const dati = await api("stato");
    aggiorna(dati.stato);
  } catch { /* riproveremo tra 10 secondi */ }
}

function aggiorna(stato) {
  S = stato;
  if (!sceltoSigla || !S.titoli.some((t) => t.sigla === sceltoSigla && t.attivo)) {
    sceltoSigla = (S.titoli.find((t) => t.attivo) || {}).sigla || null;
  }
  disegnaTestata();
  disegnaNastro();
  disegnaListino();
  disegnaScheda();
  disegnaPortafoglio();
  disegnaClassifica();
  disegnaNotizie();
  if (S.io.ruolo === "admin") {
    $("voce-admin").hidden = false;
    disegnaAdmin();
  }
}

/* ---------- Navigazione ---------- */

document.querySelectorAll("#menu button").forEach((b) => {
  b.onclick = () => {
    vista = b.dataset.vista;
    document.querySelectorAll("#menu button").forEach((x) => x.classList.toggle("attivo", x === b));
    ["mercato", "portafoglio", "classifica", "notizie", "admin"].forEach((v) => {
      $(`vista-${v}`).hidden = v !== vista;
    });
  };
});

/* ---------- Testata e nastro ---------- */

function disegnaTestata() {
  $("h-utente").textContent = S.io.username + (S.io.ruolo === "admin" ? " · admin" : "");
  $("h-crediti").textContent = fmt(S.io.crediti);
  $("h-patrimonio").textContent = fmt(S.io.patrimonio);
}

function variazioneTick(t) {
  const s = t.storico;
  if (!s || s.length < 2) return 0;
  const prima = s[s.length - 2].p;
  return prima ? ((t.prezzo - prima) / prima) * 100 : 0;
}

function variazioneTotale(t) {
  return t.prezzoIniziale ? ((t.prezzo - t.prezzoIniziale) / t.prezzoIniziale) * 100 : 0;
}

function disegnaNastro() {
  const pezzi = S.titoli
    .filter((t) => t.attivo)
    .map((t) => {
      const v = variazioneTick(t);
      return `<span><b>${t.sigla}</b> ${fmt(t.prezzo)} <em class="${segno(v)}">${conSegno(v)}%</em></span>`;
    })
    .join("");
  $("nastro-scorre").innerHTML = pezzi + pezzi;
}

function disegnaConteggio() {
  if (!S) return;
  const restano = Math.max(0, Math.round((S.prossimoTick - (Date.now() - S.ora)) / 1000));
  $("conto-tick").textContent = `prossimo prezzo tra ${restano}s`;
}

/* ---------- Listino ---------- */

function disegnaListino() {
  const corpo = $("corpo-listino");
  corpo.innerHTML = S.titoli
    .map((t) => {
      const v = variazioneTick(t);
      return `<tr data-sigla="${t.sigla}" class="${t.sigla === sceltoSigla ? "scelto" : ""} ${t.attivo ? "" : "spento-riga"}">
        <td><span class="sigla">${t.sigla}</span><span class="nome-piccolo">${esc(t.nome)}</span></td>
        <td class="num mono">${fmt(t.prezzo)}</td>
        <td class="num mono ${segno(v)}">${conSegno(v)}%</td>
      </tr>`;
    })
    .join("");
  corpo.querySelectorAll("tr").forEach((tr) => {
    tr.onclick = () => {
      sceltoSigla = tr.dataset.sigla;
      disegnaListino();
      disegnaScheda();
    };
  });
}

/* ---------- Grafici ---------- */

function disegnaLinea(svg, valori, colore) {
  const w = 640, h = svg.id === "grafico-portafoglio" ? 200 : 220, pad = 14;
  if (!valori || valori.length < 2) {
    svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#67707E" font-size="13" font-family="Archivo">Non ci sono ancora abbastanza dati</text>`;
    return { min: 0, max: 0 };
  }
  const min = Math.min(...valori), max = Math.max(...valori);
  const spazio = max - min || Math.abs(max) * 0.05 || 1;
  const x = (i) => pad + (i * (w - pad * 2)) / (valori.length - 1);
  const y = (v) => h - pad - ((v - min) / spazio) * (h - pad * 2);
  const punti = valori.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
  const area = `M${punti.replace(/ L/g, " L")} L${x(valori.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`;
  const id = svg.id + "-grad";
  svg.innerHTML = `
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${colore}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${colore}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="M${punti}" fill="none" stroke="${colore}" stroke-width="2"
          vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
  return { min, max };
}

/* ---------- Scheda del titolo ---------- */

function titoloScelto() {
  return S.titoli.find((t) => t.sigla === sceltoSigla);
}

function disegnaScheda() {
  const t = titoloScelto();
  if (!t) return;
  const vTot = variazioneTotale(t);
  const prezzi = t.storico.map((p) => p.p);

  $("s-nome").textContent = `${t.nome} · ${t.sigla}`;
  $("s-settore").textContent = t.attivo ? t.settore : `${t.settore} — titolo ritirato dal listino`;
  $("s-prezzo").textContent = fmt(t.prezzo);
  const pill = $("s-var");
  pill.textContent = `${conSegno(vTot)}% dalla quotazione`;
  pill.className = `pillola ${segno(vTot)}`;

  const colore = vTot >= 0 ? "#0E8A6A" : "#D1425A";
  const { min, max } = disegnaLinea($("grafico-titolo"), prezzi, colore);
  $("g-min").textContent = prezzi.length > 1 ? `minimo ${fmt(min)}` : "";
  $("g-max").textContent = prezzi.length > 1 ? `massimo ${fmt(max)}` : "";

  const media = prezzi.reduce((a, b) => a + b, 0) / (prezzi.length || 1);
  const vari = prezzi.length > 1
    ? Math.sqrt(prezzi.reduce((a, p) => a + (p - media) ** 2, 0) / prezzi.length) / media * 100
    : 0;
  const vUltimo = variazioneTick(t);
  $("stat-titolo").innerHTML = `
    <div class="stat"><b class="${segno(vUltimo)}">${conSegno(vUltimo)}%</b><small>ultimo minuto</small></div>
    <div class="stat"><b>${fmt(t.prezzoIniziale)}</b><small>prezzo di quotazione</small></div>
    <div class="stat"><b>${fmt(media)}</b><small>media del periodo</small></div>
    <div class="stat"><b>${fmt(vari)}%</b><small>oscillazione tipica</small></div>
    <div class="stat"><b>${intero.format(t.scambi)}</b><small>azioni scambiate</small></div>`;

  const pos = S.io.posizioni[t.sigla];
  $("posseduto").textContent = pos
    ? `Hai ${intero.format(pos.quantita)} azioni a un prezzo medio di ${fmt(pos.prezzoMedio)} crediti.`
    : "Non possiedi ancora questo titolo.";

  aggiornaCosto();
  $("btn-compra").disabled = !t.attivo;
  $("btn-vendi").disabled = !pos;
}

function aggiornaCosto() {
  const t = titoloScelto();
  const q = Math.max(0, Math.floor(Number($("quantita").value) || 0));
  $("costo-stima").textContent = t ? fmt(q * t.prezzo) : "–";
}
$("quantita").addEventListener("input", aggiornaCosto);

async function ordina(operazione) {
  const msg = $("msg-ordine");
  try {
    const dati = await api("scambio", {
      sigla: sceltoSigla,
      quantita: $("quantita").value,
      operazione,
    });
    aggiorna(dati.stato);
    msg.textContent =
      operazione === "compra"
        ? `Comprate ${intero.format(Math.floor($("quantita").value))} azioni di ${sceltoSigla}.`
        : `Vendute ${intero.format(Math.floor($("quantita").value))} azioni di ${sceltoSigla}.`;
    msg.className = "msg ok";
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "msg ko";
  }
  msg.hidden = false;
}
$("btn-compra").onclick = () => ordina("compra");
$("btn-vendi").onclick = () => ordina("vendi");

/* ---------- Portafoglio ---------- */

const COLORI = ["#3B49DF", "#0E8A6A", "#D1425A", "#E08A1E", "#7A4BD8", "#1D9FD0", "#C0562F", "#4A5568"];

function disegnaPortafoglio() {
  const io = S.io;
  const investito = Object.entries(io.posizioni).reduce((somma, [sigla, p]) => {
    const t = S.titoli.find((x) => x.sigla === sigla);
    return somma + (t ? p.quantita * t.prezzo : 0);
  }, 0);
  const rendimento = ((io.patrimonio - io.creditiIniziali) / io.creditiIniziali) * 100;
  const latente = Object.entries(io.posizioni).reduce((somma, [sigla, p]) => {
    const t = S.titoli.find((x) => x.sigla === sigla);
    return somma + (t ? (t.prezzo - p.prezzoMedio) * p.quantita : 0);
  }, 0);

  $("riepilogo").innerHTML = `
    <div><b>${fmt(io.patrimonio)}</b><small>patrimonio totale</small></div>
    <div><b>${fmt(io.crediti)}</b><small>crediti liberi</small></div>
    <div><b>${fmt(investito)}</b><small>valore delle azioni</small></div>
    <div><b class="${segno(latente)}">${conSegno(latente)}</b><small>utile non ancora incassato</small></div>
    <div><b class="${segno(io.realizzato)}">${conSegno(io.realizzato)}</b><small>utile già incassato</small></div>
    <div><b class="${segno(rendimento)}">${conSegno(rendimento)}%</b><small>rispetto ai 100.000 iniziali</small></div>`;

  const valori = (io.storicoValore || []).map((p) => p.v);
  const { min, max } = disegnaLinea($("grafico-portafoglio"), valori, rendimento >= 0 ? "#0E8A6A" : "#D1425A");
  $("p-min").textContent = valori.length > 1 ? `minimo ${fmt(min)}` : "";
  $("p-max").textContent = valori.length > 1 ? `massimo ${fmt(max)}` : "";

  // Composizione
  const fette = [{ etichetta: "Crediti liberi", valore: io.crediti }].concat(
    Object.entries(io.posizioni).map(([sigla, p]) => {
      const t = S.titoli.find((x) => x.sigla === sigla);
      return { etichetta: sigla, valore: t ? p.quantita * t.prezzo : 0 };
    })
  ).filter((f) => f.valore > 0);
  const totale = fette.reduce((a, f) => a + f.valore, 0) || 1;
  $("barra-composizione").innerHTML = fette
    .map((f, i) => `<i style="width:${(f.valore / totale) * 100}%;background:${i === 0 ? "#C9CEDA" : COLORI[(i - 1) % COLORI.length]}"></i>`)
    .join("");
  $("legenda-composizione").innerHTML = fette
    .map((f, i) => `<span><i style="background:${i === 0 ? "#C9CEDA" : COLORI[(i - 1) % COLORI.length]}"></i>${f.etichetta} ${((f.valore / totale) * 100).toFixed(1)}%</span>`)
    .join("");

  // Posizioni
  const righe = Object.entries(io.posizioni);
  $("corpo-posizioni").innerHTML = righe.length
    ? righe.map(([sigla, p]) => {
        const t = S.titoli.find((x) => x.sigla === sigla);
        const prezzo = t ? t.prezzo : 0;
        const valore = prezzo * p.quantita;
        const pl = (prezzo - p.prezzoMedio) * p.quantita;
        const plPerc = p.prezzoMedio ? ((prezzo - p.prezzoMedio) / p.prezzoMedio) * 100 : 0;
        return `<tr>
          <td><span class="sigla">${sigla}</span><span class="nome-piccolo">${t ? esc(t.nome) : "titolo ritirato"}</span></td>
          <td class="num mono">${intero.format(p.quantita)}</td>
          <td class="num mono">${fmt(p.prezzoMedio)}</td>
          <td class="num mono">${fmt(prezzo)}</td>
          <td class="num mono">${fmt(valore)}</td>
          <td class="num mono ${segno(pl)}">${conSegno(pl)} (${conSegno(plPerc)}%)</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="vuoto">Nessuna azione in portafoglio. Scegli un titolo nel mercato e comincia.</td></tr>`;

  // Operazioni
  $("corpo-operazioni").innerHTML = io.operazioni.length
    ? io.operazioni.map((o) => `<tr>
        <td class="mono">${dataOra(o.t)}</td>
        <td class="${o.operazione === "compra" ? "su" : "giu"}">${o.operazione === "compra" ? "Acquisto" : "Vendita"}</td>
        <td class="sigla">${o.sigla}</td>
        <td class="num mono">${intero.format(o.quantita)}</td>
        <td class="num mono">${fmt(o.prezzo)}</td>
        <td class="num mono">${fmt(o.totale)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="vuoto">Qui comparirà ogni acquisto e ogni vendita.</td></tr>`;
}

/* ---------- Classifica ---------- */

function disegnaClassifica() {
  const righe = S.classifica.filter((r) => r.ruolo !== "admin");
  $("corpo-classifica").innerHTML = righe.length
    ? righe.map((r, i) => {
        const rend = ((r.patrimonio - S.io.creditiIniziali) / S.io.creditiIniziali) * 100;
        return `<tr${r.username === S.io.username ? ' style="background:#EEF0FF"' : ""}>
          <td class="mono">${i + 1}</td>
          <td>${esc(r.username)}${r.bloccato ? " <small class='sotto'>sospeso</small>" : ""}</td>
          <td class="num mono">${fmt(r.patrimonio)}</td>
          <td class="num mono">${fmt(r.crediti)}</td>
          <td class="num mono ${segno(rend)}">${conSegno(rend)}%</td>
          <td class="num mono">${intero.format(r.operazioni)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="vuoto">Ancora nessun investitore in gara.</td></tr>`;
}

/* ---------- Notizie ---------- */

function disegnaNotizie() {
  $("lista-notizie").innerHTML = S.notizie
    .map((n) => `<li>
      <time>${ora(n.t)}</time>
      <span class="etichetta ${n.tipo}">${n.tipo === "boom" ? "rialzo" : n.tipo === "crollo" ? "ribasso" : "mercato"}</span>
      <span>${esc(n.testo)}${n.variazione ? ` <b class="${segno(n.variazione)}">${conSegno(n.variazione)}%</b>` : ""}</span>
    </li>`)
    .join("");
}

/* ---------- Amministrazione ---------- */

function messaggioAdmin(testo, ok = true) {
  const m = $("msg-admin");
  m.textContent = testo;
  m.className = `msg ${ok ? "ok" : "ko"}`;
  m.hidden = false;
}

async function azioneAdmin(rotta, corpo) {
  try {
    const dati = await api(rotta, corpo);
    aggiorna(dati.stato);
    messaggioAdmin(dati.messaggio || "Fatto.");
  } catch (err) {
    messaggioAdmin(err.message, false);
  }
}

function disegnaAdmin() {
  const selezione = $("e-sigla");
  const precedente = selezione.value;
  selezione.innerHTML = S.titoli.map((t) => `<option value="${t.sigla}">${t.sigla} — ${esc(t.nome)}</option>`).join("");
  if (precedente) selezione.value = precedente;

  $("corpo-admin-titoli").innerHTML = S.titoli.map((t) => `<tr>
      <td class="sigla">${t.sigla}</td>
      <td>${esc(t.nome)}</td>
      <td class="num mono">${fmt(t.prezzo)}</td>
      <td class="num mono">${t.volatilita}</td>
      <td>${t.attivo ? "quotato" : "ritirato"}</td>
      <td class="riga-azioni">
        <button class="mini" data-titolo="${t.attivo ? "rimuovi" : "riattiva"}" data-sigla="${t.sigla}">${t.attivo ? "Ritira" : "Riquota"}</button>
      </td>
    </tr>`).join("");

  $("corpo-admin-utenti").innerHTML = S.classifica.map((u) => `<tr>
      <td>${esc(u.username)}${u.ruolo === "admin" ? " <small class='sotto'>admin</small>" : ""}</td>
      <td class="num mono">${fmt(u.crediti)}</td>
      <td class="num mono">${fmt(u.patrimonio)}</td>
      <td>${u.bloccato ? "sospeso" : "attivo"}</td>
      <td>
        <div class="campo-crediti">
          <input type="number" step="100" placeholder="±" data-importo="${u.username}">
          <button class="mini" data-crediti="${u.username}">Applica</button>
        </div>
      </td>
      <td class="riga-azioni">
        <button class="mini" data-utente="${u.bloccato ? "riattiva" : "sospendi"}" data-nome="${u.username}">${u.bloccato ? "Riattiva" : "Sospendi"}</button>
        <button class="mini" data-utente="reimposta" data-nome="${u.username}">Azzera</button>
        ${u.username.toLowerCase() === "admin" ? "" : `<button class="mini" data-utente="${u.ruolo === "admin" ? "declassa" : "promuovi"}" data-nome="${u.username}">${u.ruolo === "admin" ? "Togli admin" : "Rendi admin"}</button>
        <button class="mini" data-utente="elimina" data-nome="${u.username}">Elimina</button>`}
      </td>
    </tr>`).join("");

  document.querySelectorAll("[data-titolo]").forEach((b) => {
    b.onclick = () => azioneAdmin("admin/titolo", { azione: b.dataset.titolo, sigla: b.dataset.sigla });
  });
  document.querySelectorAll("[data-crediti]").forEach((b) => {
    b.onclick = () => {
      const campo = document.querySelector(`[data-importo="${b.dataset.crediti}"]`);
      azioneAdmin("admin/crediti", { username: b.dataset.crediti, importo: campo.value });
    };
  });
  document.querySelectorAll("[data-utente]").forEach((b) => {
    b.onclick = () => {
      const azione = b.dataset.utente;
      const testi = {
        elimina: `Eliminare definitivamente ${b.dataset.nome}?`,
        reimposta: `Azzerare il portafoglio di ${b.dataset.nome} e riportarlo a 100.000 crediti?`,
      };
      if (testi[azione] && !confirm(testi[azione])) return;
      azioneAdmin("admin/utente", { azione, username: b.dataset.nome });
    };
  });
}

$("a-aggiungi").onclick = () =>
  azioneAdmin("admin/titolo", {
    azione: "aggiungi",
    sigla: $("a-sigla").value,
    nome: $("a-nome").value,
    settore: $("a-settore").value,
    prezzo: $("a-prezzo").value,
    volatilita: $("a-vol").value || 0.02,
  }).then(() => { $("a-sigla").value = ""; $("a-nome").value = ""; $("a-prezzo").value = ""; });

$("e-lancia").onclick = () =>
  azioneAdmin("admin/evento", {
    sigla: $("e-sigla").value,
    percentuale: $("e-perc").value,
    testo: $("e-testo").value,
  }).then(() => { $("e-perc").value = ""; $("e-testo").value = ""; });

$("n-pubblica").onclick = () =>
  azioneAdmin("admin/notizia", { testo: $("n-testo").value }).then(() => { $("n-testo").value = ""; });

/* ---------- Sessione salvata ---------- */

(async function inizio() {
  impostaModo("accesso");
  if (!token) return;
  try {
    const dati = await api("stato");
    avvia(dati.stato);
  } catch {
    esci(false);
  }
})();
