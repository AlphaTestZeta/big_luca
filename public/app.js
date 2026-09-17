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
const oraSec = (t) => new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  $("nastro-scorre").innerHTML = pezzi
    ? pezzi + pezzi
    : `<span>Nessun titolo quotato: il mercato aspetta l'Admin.</span>`;
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
    .join("") ||
    `<tr><td colspan="3" class="vuoto">Il listino è vuoto.</td></tr>`;
  corpo.querySelectorAll("tr[data-sigla]").forEach((tr) => {
    tr.onclick = () => {
      sceltoSigla = tr.dataset.sigla;
      disegnaListino();
      disegnaScheda();
    };
  });
}

/* ---------- Grafici ---------- */

function disegnaGrafico(svg, tip, punti, colore, formattaTempo) {
  const w = 640;
  const h = svg.id === "grafico-portafoglio" ? 200 : 220;
  const padSx = 54, padDx = 12, padSu = 12, padGiu = 12;
  const largh = w - padSx - padDx;
  const alt = h - padSu - padGiu;

  if (tip) tip.hidden = true;

  if (!punti || punti.length < 2) {
    svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#96A0AD" font-size="13" font-family="Archivo, sans-serif">Non ci sono ancora abbastanza dati</text>`;
    return;
  }

  const valori = punti.map((p) => p.v);
  let min = Math.min(...valori), max = Math.max(...valori);
  if (min === max) { const m = Math.abs(min) * 0.05 || 1; min -= m; max += m; }
  const margine = (max - min) * 0.1;
  min -= margine; max += margine;

  const x = (i) => padSx + (i * largh) / (punti.length - 1);
  const y = (v) => padSu + alt - ((v - min) / (max - min)) * alt;

  // Griglia orizzontale con i valori a sinistra
  const PASSI = 4;
  let griglia = "";
  for (let k = 0; k <= PASSI; k++) {
    const v = min + ((max - min) * k) / PASSI;
    const yy = y(v);
    griglia += `<line x1="${padSx}" y1="${yy.toFixed(1)}" x2="${w - padDx}" y2="${yy.toFixed(1)}" stroke="#E7E9ED" stroke-width="1"/>
      <text x="${padSx - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" font-family="Roboto Mono, monospace" fill="#8791A0">${fmt(v)}</text>`;
  }

  const puntiLinea = punti.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" L");
  const area = `M${puntiLinea} L${x(punti.length - 1).toFixed(1)},${padSu + alt} L${x(0).toFixed(1)},${padSu + alt} Z`;
  const gid = svg.id + "-grad";

  svg.innerHTML = `
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${colore}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${colore}" stop-opacity="0"/>
    </linearGradient></defs>
    ${griglia}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="M${puntiLinea}" fill="none" stroke="${colore}" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round"/>
    <line class="linea-al-passaggio" x1="0" y1="${padSu}" x2="0" y2="${padSu + alt}"
          stroke="#8791A0" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>
    <circle class="punto-al-passaggio" r="4.5" fill="${colore}" stroke="#fff" stroke-width="1.5" opacity="0"/>
    <rect class="area-al-passaggio" x="${padSx}" y="${padSu}" width="${largh}" height="${alt}"
          fill="transparent" style="cursor:crosshair;touch-action:none"/>`;

  if (!tip) return;

  const linea = svg.querySelector(".linea-al-passaggio");
  const punto = svg.querySelector(".punto-al-passaggio");
  const area2 = svg.querySelector(".area-al-passaggio");
  const contenitore = svg.parentElement;

  const mostraTip = (clientX) => {
    const box = svg.getBoundingClientRect();
    const scalaX = w / box.width;
    const xLocale = (clientX - box.left) * scalaX;
    let i = Math.round(((xLocale - padSx) / largh) * (punti.length - 1));
    i = Math.max(0, Math.min(punti.length - 1, i));
    const p = punti[i];
    const cx = x(i), cy = y(p.v);

    linea.setAttribute("x1", cx.toFixed(1));
    linea.setAttribute("x2", cx.toFixed(1));
    linea.setAttribute("opacity", "1");
    punto.setAttribute("cx", cx.toFixed(1));
    punto.setAttribute("cy", cy.toFixed(1));
    punto.setAttribute("opacity", "1");

    const boxCont = contenitore.getBoundingClientRect();
    tip.style.left = `${box.left - boxCont.left + (cx / w) * box.width}px`;
    tip.style.top = `${box.top - boxCont.top + (cy / h) * box.height}px`;
    tip.innerHTML = `<b>${fmt(p.v)}</b><small>${(formattaTempo || oraSec)(p.t)}</small>`;
    tip.hidden = false;
  };
  const nascondiTip = () => {
    linea.setAttribute("opacity", "0");
    punto.setAttribute("opacity", "0");
    tip.hidden = true;
  };

  area2.addEventListener("pointermove", (e) => mostraTip(e.clientX));
  area2.addEventListener("pointerdown", (e) => mostraTip(e.clientX));
  area2.addEventListener("pointerleave", nascondiTip);
}

/* ---------- Scheda del titolo ---------- */

function titoloScelto() {
  return S.titoli.find((t) => t.sigla === sceltoSigla);
}

function disegnaScheda() {
  const t = titoloScelto();
  if (!t) {
    $("s-nome").textContent = "Nessun titolo da scambiare";
    $("s-settore").textContent =
      S.io.ruolo === "admin"
        ? "Vai in Amministrazione e quota il primo titolo."
        : "L'Admin non ha ancora quotato nessun titolo. Torna tra poco.";
    $("s-prezzo").textContent = "–";
    $("s-var").textContent = "–";
    $("s-var").className = "pillola";
    disegnaGrafico($("grafico-titolo"), $("tip-titolo"), [], "#67707E");
    $("stat-titolo").innerHTML = "";
    $("posseduto").textContent = "";
    $("costo-stima").textContent = "–";
    $("btn-compra").disabled = true;
    $("btn-vendi").disabled = true;
    return;
  }
  const vTot = variazioneTotale(t);
  const prezzi = t.storico.map((p) => p.p);
  const puntiGrafico = t.storico.map((p) => ({ t: p.t, v: p.p }));

  $("s-nome").textContent = `${t.nome} · ${t.sigla}`;
  $("s-settore").textContent = t.attivo ? t.settore : `${t.settore} — titolo ritirato dal listino`;
  $("s-prezzo").textContent = fmt(t.prezzo);
  const pill = $("s-var");
  pill.textContent = `${conSegno(vTot)}% dalla quotazione`;
  pill.className = `pillola ${segno(vTot)}`;

  const colore = vTot >= 0 ? "#0E8A6A" : "#D1425A";
  disegnaGrafico($("grafico-titolo"), $("tip-titolo"), puntiGrafico, colore, oraSec);

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

  const puntiValore = (io.storicoValore || []).map((p) => ({ t: p.t, v: p.v }));
  disegnaGrafico($("grafico-portafoglio"), $("tip-portafoglio"), puntiValore, rendimento >= 0 ? "#0E8A6A" : "#D1425A", dataOra);

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
  const admin = S.io.ruolo === "admin";
  $("lista-notizie").innerHTML = S.notizie.length
    ? S.notizie
        .map(
          (n) => `<li>
      <time>${ora(n.t)}</time>
      <span class="etichetta ${n.tipo}">${n.tipo === "boom" ? "rialzo" : n.tipo === "crollo" ? "ribasso" : "mercato"}</span>
      <span class="notizia-testo">${esc(n.testo)}${n.variazione ? ` <b class="${segno(n.variazione)}">${conSegno(n.variazione)}%</b>` : ""}</span>
      ${admin ? `<button class="notizia-elimina" title="Elimina questa notizia" data-notizia="${n.id || ""}">✕</button>` : ""}
    </li>`
        )
        .join("")
    : `<li class="vuoto">Nessuna notizia per ora.</li>`;

  if (admin) {
    document.querySelectorAll("[data-notizia]").forEach((b) => {
      b.onclick = () => {
        if (!b.dataset.notizia) return; // notizie storiche senza id, create prima di questo aggiornamento
        azioneAdmin("admin/notizia", { azione: "elimina", id: b.dataset.notizia });
      };
    });
  }
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
    if (dati.messaggio) messaggioAdmin(dati.messaggio);
  } catch (err) {
    messaggioAdmin(err.message, false);
  }
}

function disegnaAdmin() {
  const selezione = $("e-sigla");
  const precedente = selezione.value;
  selezione.innerHTML = S.titoli.map((t) => `<option value="${t.sigla}">${t.sigla} — ${esc(t.nome)}</option>`).join("");
  if (precedente) selezione.value = precedente;

  const valoriInCorso = {};
  document.querySelectorAll("#corpo-admin-titoli input[data-riga]").forEach((inp) => {
    if (document.activeElement === inp || inp.dataset.toccato === "1") {
      valoriInCorso[inp.dataset.riga + ":" + inp.dataset.campo] = inp.value;
    }
  });

  $("corpo-admin-titoli").innerHTML = S.titoli.map((t) => `<tr class="${t.attivo ? "" : "spento-riga"}">
      <td><span class="sigla">${t.sigla}</span></td>
      <td>${esc(t.nome)}</td>
      <td class="num"><input class="input-riga mono" type="number" step="0.01" min="0.01" value="${t.prezzo}" data-riga="${t.sigla}" data-campo="prezzo"></td>
      <td class="num"><input class="input-riga mono" type="number" step="0.001" min="0.002" max="0.2" value="${t.volatilita}" data-riga="${t.sigla}" data-campo="volatilita"></td>
      <td>${t.attivo ? "quotato" : "ritirato"}</td>
      <td class="riga-azioni">
        <button class="mini" data-salva="${t.sigla}">Salva</button>
        <button class="mini" data-titolo="${t.attivo ? "rimuovi" : "riattiva"}" data-sigla="${t.sigla}">${t.attivo ? "Ritira" : "Riquota"}</button>
        <button class="mini pericolo" data-elimina="${t.sigla}">Elimina</button>
      </td>
    </tr>`).join("") ||
    `<tr><td colspan="6" class="vuoto">Nessun titolo quotato. Aggiungine uno qui sopra.</td></tr>`;

  document.querySelectorAll("#corpo-admin-titoli input[data-riga]").forEach((inp) => {
    const chiave = inp.dataset.riga + ":" + inp.dataset.campo;
    if (chiave in valoriInCorso) inp.value = valoriInCorso[chiave];
    inp.addEventListener("input", () => { inp.dataset.toccato = "1"; });
  });

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
  document.querySelectorAll("[data-salva]").forEach((b) => {
    b.onclick = () => {
      const sigla = b.dataset.salva;
      const prezzo = document.querySelector(`[data-riga="${sigla}"][data-campo="prezzo"]`).value;
      const volatilita = document.querySelector(`[data-riga="${sigla}"][data-campo="volatilita"]`).value;
      azioneAdmin("admin/titolo", { azione: "modifica", sigla, prezzo, volatilita }).then(() => {
        document.querySelectorAll(`[data-riga="${sigla}"]`).forEach((inp) => delete inp.dataset.toccato);
      });
    };
  });
  document.querySelectorAll("[data-elimina]").forEach((b) => {
    b.onclick = () => {
      const sigla = b.dataset.elimina;
      const t = S.titoli.find((x) => x.sigla === sigla);
      if (!confirm(`Eliminare ${sigla} per sempre? Sparisce dal listino, dai grafici e dalle notizie, e non si può annullare.`)) return;
      const rimborsa = confirm(
        `Chi possiede ${sigla} cosa riceve?\n\nOK = rimborso al prezzo attuale di ${fmt(t.prezzo)} crediti\nAnnulla = niente, le azioni vanno in fumo`
      );
      azioneAdmin("admin/titolo", { azione: "elimina", sigla, rimborsa });
    };
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
