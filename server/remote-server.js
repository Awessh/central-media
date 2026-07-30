"use strict";

// Petit serveur local (HTTP + WebSocket) permettant de contrôler le lecteur
// depuis un smartphone sur le même réseau. Sert aussi une mini page web de
// secours (playable dans un navigateur mobile) en attendant l'appli Android
// dédiée. Protocole volontairement simple et documenté pour que l'appli
// Android puisse s'y brancher directement.
//
// GET  /api/state              -> état courant du lecteur (JSON)
// POST /api/command  {type,...}-> envoie une commande au lecteur
// WS   /ws                     -> même chose en push temps réel
//   Messages serveur -> client : { type: "state", state: {...} }
//   Messages client -> serveur : { type: "command", command: {...} }

const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const os = require("os");

let server = null;
let wss = null;
let currentPort = null;
let onCommand = null;
let lastState = { status: "idle" };

function localIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

async function start(port, opts = {}) {
  if (server) return getStatus();

  onCommand = opts.onCommand || null;
  const app = express();
  app.use(express.json());

  app.get("/api/state", (_req, res) => res.json(lastState));

  app.post("/api/command", (req, res) => {
    if (onCommand) onCommand(req.body);
    res.json({ ok: true });
  });

  app.get("/remote", (_req, res) => {
    res.type("html").send(REMOTE_PAGE_HTML);
  });

  server = http.createServer(app);
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "state", state: lastState }));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "command" && onCommand) onCommand(msg.command);
      } catch { /* message invalide ignoré */ }
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(port, "0.0.0.0", resolve);
    server.on("error", reject);
  });

  currentPort = port;
  return getStatus();
}

async function stop() {
  if (wss) { wss.clients.forEach((c) => c.close()); wss.close(); wss = null; }
  if (server) { await new Promise((resolve) => server.close(resolve)); server = null; }
  currentPort = null;
}

function pushState(state) {
  lastState = state;
  if (!wss) return;
  const payload = JSON.stringify({ type: "state", state });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(payload); });
}

function getStatus() {
  if (!currentPort) return { running: false };
  const ip = localIPv4();
  return {
    running: true,
    port: currentPort,
    ip,
    url: `http://${ip}:${currentPort}/remote`,
    wsUrl: `ws://${ip}:${currentPort}/ws`,
  };
}

// Mini page web de secours, utilisable directement depuis le navigateur du
// téléphone tant que l'appli Android dédiée n'est pas disponible.
const REMOTE_PAGE_HTML = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Télécommande</title>
<style>
  body{margin:0;background:#111;color:#eee;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:24px;gap:16px}
  h1{font-size:18px;opacity:.8}
  .row{display:flex;gap:12px}
  button{background:#2a2a30;color:#fff;border:none;border-radius:12px;padding:16px 20px;font-size:20px;min-width:64px}
  button:active{background:#3d3d46}
  #now{opacity:.7;font-size:14px;text-align:center}
</style></head>
<body>
  <h1>Télécommande</h1>
  <div id="now">En attente…</div>
  <div class="row"><button data-c="prev">⏮</button><button data-c="play-pause">⏯</button><button data-c="next">⏭</button></div>
  <div class="row"><button data-c="back10">-10s</button><button data-c="forward10">+10s</button></div>
  <div class="row"><button data-c="vol-down">🔉</button><button data-c="mute">🔇</button><button data-c="vol-up">🔊</button></div>
<script>
  const ws = new WebSocket("ws://" + location.host + "/ws");
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") document.getElementById("now").textContent = msg.state.title || "En attente…";
  };
  document.querySelectorAll("button").forEach((b) => {
    b.onclick = () => ws.send(JSON.stringify({ type: "command", command: { type: b.dataset.c } }));
  });
</script>
</body></html>`;

module.exports = { start, stop, pushState, getStatus, get lastState() { return lastState; } };
