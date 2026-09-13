"use strict";

// Serveur local (HTTP + WebSocket) permettant de contrôler le lecteur depuis
// l'appli Android "Central Media Remote", sur le même réseau WiFi, ou via le
// QR code de pairage généré au démarrage (voir main.js).
//
// Sécurité : un token de pairage est généré à chaque démarrage du serveur.
// Le QR code encode { ip, port, token, name }. Toutes les routes /api/*
// (sauf /api/ping) exigent l'en-tête "X-Pair-Token" avec ce token.
//
// Routes HTTP :
//   GET  /api/ping                -> { ok, name }                (pas de token requis, sert à tester une IP saisie à la main)
//   POST /api/pair/request {deviceName} -> demande d'appairage sans QR, sur le même réseau (pas de token requis)
//   GET  /api/pair/status?requestId=... -> statut de la demande, renvoie le token si acceptée (pas de token requis)
//   GET  /api/state               -> état courant du lecteur
//   POST /api/command   {type,...}-> envoie une commande (voir handleCommand côté renderer)
//   GET  /api/library?type=video|audio -> playlist en cours (fichiers ajoutés au lecteur)
//   GET  /api/playlists            -> playlists nommées sauvegardées dans le lecteur
//   GET  /api/browse?path=...      -> parcourt le système de fichiers du PC (dossiers/fichiers lisibles)
//   GET  /api/file?path=...        -> diffuse un fichier (lecture à distance sur le téléphone, avec support Range)
//   GET  /api/screen/frame?quality=... -> derniere capture JPEG de la fenetre Central Media (aperçu ecran)
//   POST /api/upload   (multipart, champ "file") -> envoie un fichier du téléphone pour lecture immédiate sur le PC
// WS   /ws  (?token=...)          -> même chose en push temps réel
//   Serveur -> client : { type: "state", state }
//   Serveur -> client : { type: "playlist", video, audio, playlists } (après une mutation de playlist)
//   Client  -> serveur: { type: "command", command }

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");
const multer = require("multer");

let server = null;
let wss = null;
let currentPort = null;
let onCommand = null;
let getContext = null; // () => { library, playlists, browse(p), onUpload(filePath, mediaType) }
let onPairRequest = null; // (request) => void — affiche la boite Accepter/Refuser cote PC
const pairRequests = new Map(); // requestId -> { id, deviceName, ip, status, createdAt }
const PAIR_REQUEST_TTL_MS = 60_000;
let lastState = { status: "idle" };
let pairToken = null;

function networkCandidates() {
  const nets = os.networkInterfaces();
  const virtualAdapter = /virtualbox|vmware|hyper-v|vethernet|docker|wsl|loopback|tailscale|zerotier|tap-windows|tap\d|tun\d|ppp|bluetooth|npcap|isatap/i;
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) candidates.push({ name, address: net.address });
    }
  }
  const real = candidates.filter((c) => !virtualAdapter.test(c.name));
  return real.length ? real : candidates;
}

function localIPv4() {
  // Bug corrige : l'ancienne version prenait la premiere IPv4 non-interne
  // trouvee, sans distinguer une vraie carte Wi-Fi/Ethernet d'un
  // adaptateur virtuel (VPN, VMware/VirtualBox, Hyper-V, Docker/WSL,
  // Tailscale/ZeroTier...). Ces adaptateurs virtuels apparaissent souvent
  // AVANT la vraie carte reseau dans os.networkInterfaces(), ce qui
  // faisait afficher dans le QR code une IP injoignable depuis le
  // telephone meme si les deux appareils sont sur le meme Wi-Fi.
  const pool = networkCandidates();
  const preferred = pool.find((c) => /wi-?fi|wlan|ethernet|^eth\d|^en\d/i.test(c.name));
  return (preferred || pool[0] || { address: "127.0.0.1" }).address;
}

function checkToken(req, res, next) {
  const token = req.header("X-Pair-Token") || req.query.token;
  if (!pairToken || token !== pairToken) return res.status(401).json({ error: "unauthorized" });
  next();
}

// Parcours du système de fichiers du PC, restreint aux répertoires lisibles.
// Sous Windows, un chemin vide renvoie la liste des lecteurs (C:\, D:\, ...).
function browseFs(reqPath) {
  const exts = /\.(mp4|mkv|avi|mov|webm|flv|wmv|mp3|wav|flac|aac|ogg|m4a|m3u8?|pls|xspf)$/i;

  if (!reqPath) {
    if (os.platform() === "win32") {
      const drives = [];
      for (let c = 65; c <= 90; c++) {
        const letter = String.fromCharCode(c) + ":\\";
        try { if (fs.existsSync(letter)) drives.push({ name: letter, path: letter, isDir: true }); } catch {}
      }
      return { path: "", parent: null, entries: drives };
    }
    reqPath = "/";
  }

  const abs = path.resolve(reqPath);
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error("not-a-directory");

  const rawEntries = fs.readdirSync(abs, { withFileTypes: true });
  const entries = [];
  for (const d of rawEntries) {
    if (d.name.startsWith(".") || d.name === "$RECYCLE.BIN" || d.name === "System Volume Information") continue;
    const full = path.join(abs, d.name);
    if (d.isDirectory()) {
      entries.push({ name: d.name, path: full, isDir: true });
    } else if (exts.test(d.name)) {
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      entries.push({ name: d.name, path: full, isDir: false, size });
    }
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

  const parent = path.dirname(abs) === abs ? null : path.dirname(abs);
  return { path: abs, parent, entries };
}

async function start(port, opts = {}) {
  if (server) return getStatus();

  onCommand = opts.onCommand || null;
  getContext = opts.getContext || (() => ({}));
  onPairRequest = opts.onPairRequest || null;
  pairToken = crypto.randomBytes(16).toString("hex");

  const uploadDir = opts.uploadDir || path.join(os.tmpdir(), "central-media-incoming");
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch {}
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => cb(null, Date.now() + "_" + file.originalname.replace(/[^\w.\-]+/g, "_")),
    }),
    limits: { fileSize: 8 * 1024 * 1024 * 1024 }, // 8 Go, LAN uniquement
  });

  const app = express();
  app.use(express.json());

  app.get("/api/ping", (_req, res) => res.json({ ok: true, name: "Central Media" }));

  // POST /api/pair/request { deviceName } -> demande d'appairage sans QR
  // code, pour deux appareils deja sur le meme reseau. Le PC affiche une
  // boite de dialogue Accepter/Refuser (main.js -> onPairRequest) ; le
  // telephone poll /api/pair/status en attendant la reponse. Le token
  // renvoye en cas d'acceptation est le meme pairToken global que celui
  // du QR code — pas de notion de token par appareil dans ce serveur.
  app.post("/api/pair/request", (req, res) => {
    if (!pairToken) return res.status(503).json({ error: "remote-control-disabled" });
    const requestId = crypto.randomBytes(8).toString("hex");
    const deviceName = String(req.body?.deviceName || "Telephone").slice(0, 60);
    const request = {
      id: requestId,
      deviceName,
      ip: req.ip?.replace("::ffff:", "") || "?",
      status: "pending",
      createdAt: Date.now(),
    };
    pairRequests.set(requestId, request);
    // Expire automatiquement une demande jamais traitee (utilisateur qui
    // ignore la boite de dialogue, ou app PC fermee entre-temps).
    setTimeout(() => {
      const r = pairRequests.get(requestId);
      if (r && r.status === "pending") r.status = "expired";
    }, PAIR_REQUEST_TTL_MS);
    if (onPairRequest) onPairRequest(request);
    res.json({ requestId });
  });

  app.get("/api/pair/status", (req, res) => {
    const request = pairRequests.get(req.query.requestId);
    if (!request) return res.status(404).json({ status: "not-found" });
    if (request.status === "accepted") {
      return res.json({ status: "accepted", token: pairToken, name: "Central Media" });
    }
    res.json({ status: request.status });
  });

  // /ping et /pair/* restent accessibles sans token : ce sont justement
  // les routes qui permettent de decouvrir le PC et de demander un
  // appairage sans en avoir un au prealable.
  const publicPaths = new Set(["/ping", "/pair/request", "/pair/status"]);
  app.use("/api", (req, res, next) => (publicPaths.has(req.path) ? next() : checkToken(req, res, next)));

  app.get("/api/state", (_req, res) => res.json(lastState));

  app.post("/api/command", (req, res) => {
    if (onCommand) onCommand(req.body);
    res.json({ ok: true });
  });

  app.get("/api/library", (req, res) => {
    const ctx = getContext();
    const type = req.query.type === "audio" ? "audio" : "video";
    res.json(ctx.library ? ctx.library(type) : []);
  });

  app.get("/api/playlists", (_req, res) => {
    const ctx = getContext();
    res.json(ctx.playlists ? ctx.playlists() : []);
  });

  app.get("/api/browse", (req, res) => {
    try {
      res.json(browseFs(req.query.path || ""));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // GET /api/file?path=... -> diffuse un fichier deja visible via
  // /api/browse, pour lecture a distance dans le Mobile Player du
  // telephone (sens PC -> telephone de la lecture bidirectionnelle).
  // Meme regex que browseFs() : on ne sert jamais un fichier qui ne
  // serait pas deja un media reconnu par le reste de l'application.
  app.get("/api/file", (req, res) => {
    const filePath = req.query.path;
    const exts = /\.(mp4|mkv|avi|mov|webm|flv|wmv|mp3|wav|flac|aac|ogg|m4a)$/i;
    if (!filePath || !exts.test(filePath)) {
      return res.status(400).json({ error: "invalid-path" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "not-found" });
    }
    // res.sendFile gere nativement les en-tetes Range (necessaire pour
    // que le lecteur mobile puisse avancer/reculer sans tout
    // retelecharger) via le module "send" utilise en interne par Express.
    res.sendFile(path.resolve(filePath));
  });

  // GET /api/screen/frame?quality=low|medium|high -> derniere capture de
  // la fenetre Central Media, en JPEG (voir captureFrame() dans main.js
  // pour la resolution/qualite par niveau et le cache court-terme).
  app.get("/api/screen/frame", async (req, res) => {
    const quality = ["low", "medium", "high"].includes(req.query.quality) ? req.query.quality : "medium";
    try {
      const ctx = getContext();
      if (!ctx.captureFrame) return res.status(501).json({ error: "not-supported" });
      const buffer = await ctx.captureFrame(quality);
      if (!buffer) return res.status(503).json({ error: "capture-unavailable" });
      res.type("image/jpeg").send(buffer);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/upload", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "no-file" });
    const mediaType = req.body.mediaType === "audio" ? "audio" : "video";
    const ctx = getContext();
    if (ctx.onUpload) ctx.onUpload(req.file.path, mediaType);
    res.json({ ok: true, path: req.file.path });
  });

  app.get("/remote", (_req, res) => res.type("html").send(REMOTE_PAGE_HTML));

  server = http.createServer(app);
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://x");
    if (url.searchParams.get("token") !== pairToken) { ws.close(1008, "unauthorized"); return; }
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
  pairToken = null;
  pairRequests.clear();
}

function pushState(state) {
  lastState = state;
  if (!wss) return;
  const payload = JSON.stringify({ type: "state", state });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(payload); });
}

// Pousse le contenu de la playlist/mediatheque a tous les telephones
// connectes, pour eviter qu'ils doivent faire un pull-to-refresh manuel
// apres une mutation declenchee a distance (remove/reorder/clear) ou un
// upload. `payload` : { video, audio, playlists }.
function pushPlaylists(payload) {
  if (!wss) return;
  const message = JSON.stringify({ type: "playlist", ...payload });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(message); });
}

// Appelee par main.js une fois que l'utilisateur a Accepte/Refuse la
// demande d'appairage dans la boite de dialogue Electron.
function resolvePairRequest(requestId, accepted) {
  const request = pairRequests.get(requestId);
  if (!request) return;
  request.status = accepted ? "accepted" : "refused";
}

function getStatus() {
  if (!currentPort) return { running: false };
  const ip = localIPv4();
  // Autres IP reelles detectees, pour diagnostiquer manuellement le cas
  // (rare) ou la mauvaise carte reseau serait quand meme choisie sur une
  // machine avec plusieurs interfaces physiques actives (Wi-Fi + Ethernet).
  const alternativeIps = networkCandidates().map((c) => c.address).filter((a) => a !== ip);
  return {
    running: true,
    port: currentPort,
    ip,
    alternativeIps,
    token: pairToken,
    url: `http://${ip}:${currentPort}/remote`,
    wsUrl: `ws://${ip}:${currentPort}/ws?token=${pairToken}`,
    // Payload complet encodé dans le QR code : tout ce qu'il faut pour se
    // connecter en un scan, sans ressaisir l'IP ni le token.
    pairPayload: JSON.stringify({ v: 1, name: "Central Media", ip, port: currentPort, token: pairToken }),
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
  <h1>Télécommande (page de secours)</h1>
  <div id="now">Utilisez plutôt l'appli Android Central Media Remote pour toutes les fonctionnalités.</div>
  <div class="row"><button data-c="prev">⏮</button><button data-c="play-pause">⏯</button><button data-c="next">⏭</button></div>
  <div class="row"><button data-c="back10">-10s</button><button data-c="forward10">+10s</button></div>
  <div class="row"><button data-c="vol-down">🔉</button><button data-c="mute">🔇</button><button data-c="vol-up">🔊</button></div>
<script>
  const token = new URLSearchParams(location.search).get("token") || "";
  const ws = new WebSocket("ws://" + location.host + "/ws?token=" + token);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") document.getElementById("now").textContent = msg.state.title || "En attente…";
  };
  document.querySelectorAll("button").forEach((b) => {
    b.onclick = () => ws.send(JSON.stringify({ type: "command", command: { type: b.dataset.c } }));
  });
</script>
</body></html>`;

module.exports = { start, stop, pushState, pushPlaylists, resolvePairRequest, getStatus, get lastState() { return lastState; } };
