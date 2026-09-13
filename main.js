"use strict";

// Charge le fichier .env (à la racine du projet) s'il existe, pour lire
// GH_TOKEN sans jamais l'écrire dans le code source. Ne fait rien si le
// fichier .env est absent (ex: en production où GH_TOKEN est fourni
// autrement par l'environnement).
require("dotenv").config();

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const os = require("os");
const { pathToFileURL } = require("url");
const { initUpdater } = require('./src/updater');

// ------------------------------------------------------------
// Binaires ffmpeg / ffprobe (utilisés pour les infos média, les
// miniatures, l'extraction audio et la conversion RTSP -> HLS)
// ------------------------------------------------------------
let ffmpegPath = null;
let ffprobePath = null;
try { ffmpegPath = require("ffmpeg-static"); } catch { ffmpegPath = null; }
try { ffprobePath = require("ffprobe-static").path; } catch { ffprobePath = null; }
// En build packagée, ces chemins pointent dans l'asar -> on les redirige
// vers app.asar.unpacked (cf. "asarUnpack" dans package.json).
function unpackPath(p) {
  if (!p) return p;
  return p.replace("app.asar", "app.asar.unpacked");
}

let mainWindow = null;
const updater = initUpdater({ app, ipcMain, dialog, BrowserWindow });

// ------------------------------------------------------------
// Instance unique + réception de fichiers depuis l'extérieur
// (glisser un média sur l'icône, "Ouvrir avec", ou le menu
// contextuel Windows "Ajouter à Media Player" ajouté plus bas).
// ------------------------------------------------------------
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    handleIncomingArgv(argv);
  });
}

// Ne garde que les chemins de fichiers existants avec une extension média
// reconnue (ignore les flags --xxx, le chemin de l'exe, etc.).
function extractMediaPathsFromArgv(argv) {
  const out = [];
  for (const arg of argv) {
    if (!arg || arg.startsWith("-")) continue;
    const cleaned = arg.replace(/^"|"$/g, "");
    if (!mediaTypeForExt(cleaned)) continue;
    try { if (fs.statSync(cleaned).isFile()) out.push(cleaned); } catch { /* pas un chemin valide, ignoré */ }
  }
  return out;
}

function handleIncomingArgv(argv) {
  const paths = extractMediaPathsFromArgv(argv);
  if (!paths.length) return;
  addPathsFromExternal(paths);
}

function addPathsFromExternal(paths) {
  const video = [], audio = [];
  paths.forEach((p) => {
    const t = mediaTypeForExt(p);
    if (!t) return;
    addToPlaylist(t, p);
    (t === "audio" ? audio : video).push(p);
  });
  if (!video.length && !audio.length) return;
  broadcast("media:added-externally", { video, audio });
}



// ------------------------------------------------------------
// Store JSON persistant (playlists, historique, marque-pages,
// notes, statistiques, paramètres) — équivalent local d'un
// electron-store minimal, sans dépendance supplémentaire.
// ------------------------------------------------------------
const USER_DATA = () => app.getPath("userData");
const STORE_PATH = () => path.join(USER_DATA(), "media-player-store.json");
const THUMBS_DIR = () => path.join(USER_DATA(), "thumbnails");
const MEDIA_CACHE_DIR = () => path.join(USER_DATA(), "media-cache");
const CAPTURES_DIR = () => path.join(app.getPath("pictures") || USER_DATA(), "Media Player", "Captures");
const CLIPS_DIR = () => path.join(app.getPath("music") || USER_DATA(), "Media Player", "Extraits");
const RTSP_CACHE_DIR = () => path.join(USER_DATA(), "rtsp-live");

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

const defaultStore = {
  media: {
    videoPlaylist: [],
    audioPlaylist: [],
    history: [],
    bookmarks: [],   // { id, path, time, label, createdAt }
    notes: [],       // { id, path, time, text, createdAt }
    playlists: [],   // playlists nommées sauvegardées { id, name, type, items:[path], createdAt }
    podcasts: [],    // { id, title, feedUrl, episodes:[{title,url,pubDate,duration}] }
    stats: { watchedSeconds: 0, playCount: 0 },
  },
  settings: {
    theme: "dark",
    autoplayNext: true,
    defaultVolume: 100,
    subtitleStyle: { fontSize: 22, color: "#ffffff", bg: "rgba(0,0,0,0.6)" },
    remoteControl: { enabled: false, port: 8787 },
    updates: { channel: "stable" },
    explorerIntegration: false,
  },
};

let store = loadStore();

function loadStore() {
  try {
    ensureDir(USER_DATA());
    if (fs.existsSync(STORE_PATH())) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH(), "utf-8"));
      return deepMerge(structuredClone(defaultStore), raw);
    }
  } catch (e) { console.error("Store: lecture impossible ->", e.message); }
  return structuredClone(defaultStore);
}

function deepMerge(base, extra) {
  for (const k of Object.keys(extra || {})) {
    if (extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k]) && base[k] && typeof base[k] === "object") {
      deepMerge(base[k], extra[k]);
    } else {
      base[k] = extra[k];
    }
  }
  return base;
}

let persistTimer = null;
function persistStore() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      ensureDir(USER_DATA());
      fs.writeFileSync(STORE_PATH(), JSON.stringify(store, null, 2));
    } catch (e) { console.error("Store: écriture impossible ->", e.message); }
  }, 200);
}

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send(channel, payload); });
}

// ------------------------------------------------------------
// Fenêtre principale
// ------------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#0e0e10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadFile("index.html");

  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ------------------------------------------------------------
// Scan de dossiers (vidéo / audio) + formats supportés
// ------------------------------------------------------------
const VIDEO_EXT = ["mp4", "mkv", "webm", "avi", "mov", "wmv", "flv", "m4v", "mpg", "mpeg", "ts", "m2ts", "3gp"];
const AUDIO_EXT = ["mp3", "wav", "flac", "aac", "ogg", "oga", "m4a", "wma", "opus", "aiff", "alac"];
const ALL_MEDIA_EXT = [...VIDEO_EXT, ...AUDIO_EXT];
// Formats que <video>/<audio> ne décodent pas nativement dans Chromium et
// que l'on remuxe/réencode à la volée via ffmpeg avant lecture.
const NEEDS_CONVERSION_EXT = ["avi", "wmv", "flv", "mkv", "m2ts", "ts", "3gp", "wma"];

// Détermine si un fichier est vidéo ou audio d'après son extension, pour ne
// plus dépendre d'un type "actif" côté renderer quand on scanne un dossier
// (un dossier peut contenir un mélange, ou être 100% musique).
function mediaTypeForExt(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (VIDEO_EXT.includes(ext)) return "video";
  return null;
}

function scanFolder(folderPath, exts) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.includes(path.extname(entry.name).toLowerCase().replace(".", ""))) results.push(full);
    }
  }
  walk(folderPath);
  results.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: "base" }));
  return results;
}

function hashPath(p) { return crypto.createHash("md5").update(p).digest("hex"); }
function needsConversion(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  return NEEDS_CONVERSION_EXT.includes(ext);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = unpackPath(ffmpegPath);
    if (!bin) { reject(new Error("FFmpeg indisponible")); return; }
    const proc = spawn(bin, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => { if (code === 0) resolve(); else reject(new Error(stderr.slice(-800))); });
  });
}

function runFfprobe(args) {
  return new Promise((resolve, reject) => {
    const bin = unpackPath(ffprobePath);
    if (!bin) { reject(new Error("FFprobe indisponible")); return; }
    const proc = spawn(bin, args);
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => { if (code === 0) resolve(stdout); else reject(new Error(stderr.slice(-800))); });
  });
}

async function resolvePlayableUrl(filePath) {
  if (!needsConversion(filePath) || !ffmpegPath) return pathToFileURL(filePath).href;

  ensureDir(MEDIA_CACHE_DIR());
  const outputPath = path.join(MEDIA_CACHE_DIR(), hashPath(filePath) + ".mp4");
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return pathToFileURL(outputPath).href;

  try {
    await runFfmpeg(["-y", "-i", filePath, "-c", "copy", "-movflags", "+faststart", outputPath]);
  } catch {
    try { fs.unlinkSync(outputPath); } catch {}
    await runFfmpeg(["-y", "-i", filePath, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", outputPath]);
  }
  return pathToFileURL(outputPath).href;
}

async function generateThumbnail(filePath) {
  if (!ffmpegPath) return null;
  ensureDir(THUMBS_DIR());
  const outputPath = path.join(THUMBS_DIR(), hashPath(filePath) + ".jpg");
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return pathToFileURL(outputPath).href;
  try {
    await runFfmpeg(["-y", "-ss", "00:00:01", "-i", filePath, "-frames:v", "1", "-vf", "scale=240:-1", outputPath]);
  } catch {
    try { await runFfmpeg(["-y", "-ss", "00:00:00", "-i", filePath, "-frames:v", "1", "-vf", "scale=240:-1", outputPath]); }
    catch { return null; }
  }
  return fs.existsSync(outputPath) ? pathToFileURL(outputPath).href : null;
}

// Informations média détaillées (codec, résolution, fps, bitrate, pistes...)
async function probeMedia(filePath) {
  if (!ffprobePath) return { error: "ffprobe indisponible" };
  try {
    const out = await runFfprobe(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath]);
    const data = JSON.parse(out);
    const video = (data.streams || []).find((s) => s.codec_type === "video");
    const audioTracks = (data.streams || []).filter((s) => s.codec_type === "audio");
    const subtitleTracks = (data.streams || []).filter((s) => s.codec_type === "subtitle");
    const fmt = data.format || {};

    let fps = null;
    if (video && video.r_frame_rate) {
      const [n, d] = video.r_frame_rate.split("/").map(Number);
      if (d) fps = Math.round((n / d) * 100) / 100;
    }

    let size = null;
    try { size = fs.statSync(filePath).size; } catch {}

    return {
      codecVideo: video ? video.codec_name : null,
      codecAudio: audioTracks[0] ? audioTracks[0].codec_name : null,
      width: video ? video.width : null,
      height: video ? video.height : null,
      fps,
      bitrate: fmt.bit_rate ? Number(fmt.bit_rate) : null,
      duration: fmt.duration ? Number(fmt.duration) : null,
      size,
      audioTracks: audioTracks.map((a, i) => ({
        index: i, codec: a.codec_name, channels: a.channels,
        language: (a.tags && (a.tags.language || a.tags.LANGUAGE)) || null,
        title: (a.tags && (a.tags.title || a.tags.TITLE)) || null,
      })),
      subtitleTracks: subtitleTracks.map((s, i) => ({
        index: i, codec: s.codec_name,
        language: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || null,
        title: (s.tags && (s.tags.title || s.tags.TITLE)) || null,
      })),
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ------------------------------------------------------------
// RTSP -> HLS local (les navigateurs/Chromium ne savent pas lire
// RTSP nativement : on transcode en direct vers un flux HLS local
// que hls.js peut ensuite lire dans le lecteur).
// ------------------------------------------------------------
const rtspSessions = new Map(); // id -> { proc, dir }

function startRtspSession(rtspUrl) {
  if (!ffmpegPath) throw new Error("FFmpeg indisponible : impossible de convertir le flux RTSP.");
  const id = crypto.randomUUID();
  const dir = path.join(RTSP_CACHE_DIR(), id);
  ensureDir(dir);
  const playlistPath = path.join(dir, "stream.m3u8");

  const args = [
    "-y", "-rtsp_transport", "tcp", "-i", rtspUrl,
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-c:a", "aac", "-ac", "2",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "6",
    "-hls_flags", "delete_segments+append_list",
    playlistPath,
  ];

  const proc = spawn(unpackPath(ffmpegPath), args);
  proc.stderr.on("data", () => {}); // silencieux (verbeux par défaut chez ffmpeg)
  proc.on("close", () => { rtspSessions.delete(id); });

  rtspSessions.set(id, { proc, dir, playlistPath });
  return { id, playlistUrl: pathToFileURL(playlistPath).href };
}

function stopRtspSession(id) {
  const s = rtspSessions.get(id);
  if (!s) return false;
  try { s.proc.kill("SIGKILL"); } catch {}
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
  rtspSessions.delete(id);
  return true;
}

function stopAllRtspSessions() {
  for (const id of Array.from(rtspSessions.keys())) stopRtspSession(id);
}

// ------------------------------------------------------------
// Capture : extrait audio (via ffmpeg) — la capture d'écran vidéo
// se fait côté renderer (canvas.drawImage) car c'est instantané et
// ne nécessite pas de réencodage.
// ------------------------------------------------------------
async function extractAudioClip(filePath, startSec, durationSec) {
  if (!ffmpegPath) throw new Error("FFmpeg indisponible");
  ensureDir(CLIPS_DIR());
  const name = `extrait-${path.basename(filePath, path.extname(filePath))}-${Math.floor(startSec)}s.mp3`;
  const outputPath = path.join(CLIPS_DIR(), name);
  await runFfmpeg(["-y", "-ss", String(startSec), "-t", String(durationSec), "-i", filePath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outputPath]);
  return outputPath;
}

// ------------------------------------------------------------
// Playlists externes : m3u / m3u8 / pls / xspf (import + export)
// ------------------------------------------------------------
function parsePlaylistFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, "utf-8");
  const baseDir = path.dirname(filePath);

  function resolveEntry(p) {
    if (/^[a-z]+:\/\//i.test(p)) return p; // URL distante (http, rtsp, etc.)
    return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
  }

  if (ext === ".m3u" || ext === ".m3u8") {
    const lines = raw.split(/\r?\n/);
    const items = [];
    let title = null;
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith("#EXTINF")) {
        const m = l.match(/,(.*)$/);
        title = m ? m[1].trim() : null;
      } else if (!l.startsWith("#")) {
        items.push({ path: resolveEntry(l), title: title || path.basename(l) });
        title = null;
      }
    }
    return items;
  }

  if (ext === ".pls") {
    const items = {};
    raw.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^File(\d+)=(.*)$/i);
      const t = line.match(/^Title(\d+)=(.*)$/i);
      if (m) { items[m[1]] = items[m[1]] || {}; items[m[1]].path = resolveEntry(m[2].trim()); }
      if (t) { items[t[1]] = items[t[1]] || {}; items[t[1]].title = t[2].trim(); }
    });
    return Object.values(items).map((it) => ({ path: it.path, title: it.title || path.basename(it.path) }));
  }

  if (ext === ".xspf") {
    const items = [];
    const trackBlocks = raw.match(/<track>([\s\S]*?)<\/track>/g) || [];
    for (const block of trackBlocks) {
      const locMatch = block.match(/<location>([\s\S]*?)<\/location>/);
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      if (!locMatch) continue;
      let loc = locMatch[1].trim();
      loc = loc.startsWith("file://") ? decodeURIComponent(loc.replace("file://", "")) : loc;
      items.push({ path: resolveEntry(loc), title: titleMatch ? titleMatch[1].trim() : path.basename(loc) });
    }
    return items;
  }

  throw new Error("Format de playlist non reconnu : " + ext);
}

function writePlaylistFile(filePath, items, format) {
  const fmt = (format || path.extname(filePath).replace(".", "")).toLowerCase();

  function toHref(p) { return /^[a-z]+:\/\//i.test(p) ? p : pathToFileURL(p).href; }

  let content;
  if (fmt === "m3u" || fmt === "m3u8") {
    content = "#EXTM3U\n" + items.map((it) => `#EXTINF:-1,${it.title || path.basename(it.path)}\n${it.path}`).join("\n") + "\n";
  } else if (fmt === "pls") {
    content = "[playlist]\n" + items.map((it, i) => `File${i + 1}=${it.path}\nTitle${i + 1}=${it.title || path.basename(it.path)}\nLength${i + 1}=-1`).join("\n")
      + `\nNumberOfEntries=${items.length}\nVersion=2\n`;
  } else if (fmt === "xspf") {
    const tracks = items.map((it) => `  <track>\n    <location>${toHref(it.path)}</location>\n    <title>${escapeXml(it.title || path.basename(it.path))}</title>\n  </track>`).join("\n");
    content = `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n <trackList>\n${tracks}\n </trackList>\n</playlist>\n`;
  } else {
    throw new Error("Format d'export non reconnu : " + fmt);
  }

  fs.writeFileSync(filePath, content, "utf-8");
}

function escapeXml(s) { return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])); }

// ------------------------------------------------------------
// Bibliothèque média (playlist courante + historique)
// ------------------------------------------------------------
function playlistKey(type) { return type === "audio" ? "audioPlaylist" : "videoPlaylist"; }

function addToPlaylist(type, filePath) {
  const key = playlistKey(type);
  const list = store.media[key];
  let entry = list.find((it) => it.path === filePath);
  if (entry) return entry;

  entry = { id: crypto.randomUUID(), path: filePath, title: path.basename(filePath), addedAt: Date.now(), thumbnail: null };
  list.push(entry);
  persistStore();

  if (type === "video") {
    generateThumbnail(filePath).then((thumb) => {
      if (!thumb) return;
      entry.thumbnail = thumb;
      persistStore();
      broadcast("media:thumbnail-ready", { id: entry.id, thumbnail: thumb });
    }).catch(() => {});
  }
  return entry;
}

function addHistoryEntry(type, filePath, { position = 0, duration = 0 } = {}) {
  const list = store.media.history;
  let entry = list.find((it) => it.path === filePath);
  if (entry) list.splice(list.indexOf(entry), 1);
  else entry = { id: crypto.randomUUID(), path: filePath, title: path.basename(filePath), playCount: 0 };

  list.unshift(entry);
  entry.type = type;
  entry.lastPlayedAt = Date.now();
  entry.playCount = (entry.playCount || 0) + 1;
  if (typeof position === "number") entry.position = position;
  if (duration) entry.duration = duration;
  if (list.length > 500) list.length = 500;

  store.media.stats.playCount += 1;
  persistStore();
  return entry;
}

function getResumePosition(filePath) {
  const entry = store.media.history.find((it) => it.path === filePath);
  if (!entry || !entry.position || !entry.duration) return 0;
  if (entry.position < 5 || entry.position > entry.duration - 8) return 0;
  return entry.position;
}

// ------------------------------------------------------------
// Menu contextuel natif (clic droit)
// ------------------------------------------------------------
function buildContextMenu(win, ctx) {
  const template = [];

  if (ctx.hasMedia) {
    template.push(
      { label: ctx.isPaused ? "Lecture" : "Pause", click: () => win.webContents.send("ctxmenu:action", "play-pause") },
      { label: "Stop", click: () => win.webContents.send("ctxmenu:action", "stop") },
      { type: "separator" },
      { label: "Avancer de 10s", click: () => win.webContents.send("ctxmenu:action", "forward10") },
      { label: "Reculer de 10s", click: () => win.webContents.send("ctxmenu:action", "back10") },
      { label: "Image suivante", click: () => win.webContents.send("ctxmenu:action", "next-frame") },
      { type: "separator" },
      {
        label: "Vitesse de lecture", submenu: [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({
          label: v + "x", type: "radio", checked: ctx.speed === v,
          click: () => win.webContents.send("ctxmenu:action", { type: "speed", value: v }),
        })),
      },
      {
        label: "Piste audio", submenu: (ctx.audioTracks || []).map((t, i) => ({
          label: t.label || `Piste ${i + 1}`, type: "radio", checked: ctx.currentAudioTrack === i,
          click: () => win.webContents.send("ctxmenu:action", { type: "audio-track", value: i }),
        })),
      },
      {
        label: "Sous-titres", submenu: [
          { label: "Aucun", type: "radio", checked: ctx.currentSubtitle == null, click: () => win.webContents.send("ctxmenu:action", { type: "subtitle", value: null }) },
          ...(ctx.subtitleTracks || []).map((t, i) => ({
            label: t.label || `Piste ${i + 1}`, type: "radio", checked: ctx.currentSubtitle === i,
            click: () => win.webContents.send("ctxmenu:action", { type: "subtitle", value: i }),
          })),
          { type: "separator" },
          { label: "Ajouter un fichier de sous-titres…", click: () => win.webContents.send("ctxmenu:action", "add-subtitle-file") },
          { label: "Ajouter depuis une URL…", click: () => win.webContents.send("ctxmenu:action", "add-subtitle-url") },
        ],
      },
      { type: "separator" },
      { label: "Capture d'écran", click: () => win.webContents.send("ctxmenu:action", "screenshot"), visible: ctx.isVideo },
      { label: "Enregistrer un extrait audio…", click: () => win.webContents.send("ctxmenu:action", "record-clip") },
      { label: "Ajouter un marque-page", click: () => win.webContents.send("ctxmenu:action", "add-bookmark") },
      { type: "separator" },
      { label: "Miroir horizontal", type: "checkbox", checked: ctx.mirrorH, click: () => win.webContents.send("ctxmenu:action", "mirror-h"), visible: ctx.isVideo },
      { label: "Miroir vertical", type: "checkbox", checked: ctx.mirrorV, click: () => win.webContents.send("ctxmenu:action", "mirror-v"), visible: ctx.isVideo },
      { label: "Rotation 90°", click: () => win.webContents.send("ctxmenu:action", "rotate"), visible: ctx.isVideo },
      { type: "separator" },
      { label: "Informations média", click: () => win.webContents.send("ctxmenu:action", "media-info") },
      { type: "separator" },
    );
  }

  template.push(
    { label: "Ouvrir un fichier…", click: () => win.webContents.send("ctxmenu:action", "open-file") },
    { label: "Ouvrir un dossier…", click: () => win.webContents.send("ctxmenu:action", "open-folder") },
    { label: "Ouvrir une URL / un flux…", click: () => win.webContents.send("ctxmenu:action", "open-url") },
    { type: "separator" },
    { label: ctx.isFullscreen ? "Quitter le plein écran" : "Plein écran", click: () => win.webContents.send("ctxmenu:action", "fullscreen") },
    { label: "Toujours au premier plan", type: "checkbox", checked: ctx.alwaysOnTop, click: () => win.webContents.send("ctxmenu:action", "always-on-top") },
    { type: "separator" },
    { label: "Paramètres", click: () => win.webContents.send("ctxmenu:action", "open-settings") },
  );

  Menu.buildFromTemplate(template).popup({ window: win });
}


// ------------------------------------------------------------
// Serveur de télécommande (smartphone) : petit serveur HTTP + WS
// local exposant l'état de lecture et acceptant des commandes.
// Une appli Android dédiée pourra s'y connecter (protocole simple
// documenté dans server/remote-server.js) ; un QR code de pairage
// est fourni pour la config rapide en attendant.
// ------------------------------------------------------------
const remote = require("./server/remote-server.js");
const remoteBt = require("./server/bluetooth-server.js");

// Commandes reçues du téléphone qui n'ont pas besoin de repasser par le
// renderer (elles concernent le process principal directement).
function handleRemoteCommand(cmd) {
  if (!cmd || !cmd.type) return;
  if (cmd.type === "close-player") {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return;
  }
  if (cmd.type === "play-item") {
    // { path, mediaType }
    addToPlaylist(cmd.mediaType || "video", cmd.path);
    broadcast("remote:command", cmd);
    pushPlaylistsToPhones();
    return;
  }
  if (cmd.type === "play-playlist") {
    const pl = store.media.playlists.find((p) => p.id === cmd.id);
    if (pl && pl.items.length) {
      pl.items.forEach((p) => addToPlaylist(pl.type, p));
      broadcast("remote:command", { type: "play-item", path: pl.items[0], mediaType: pl.type });
      pushPlaylistsToPhones();
    }
    return;
  }
  // Mutations de playlist declenchees a distance depuis le telephone
  // (ecran Playlist). store.media vit dans le process principal, donc
  // on mutualise directement la meme logique que les handlers IPC
  // media:remove-from-playlist / media:reorder-playlist /
  // media:clear-playlist utilises par l'UI locale, puis on notifie a
  // la fois le renderer (pour rafraichir l'UI si la fenetre est ouverte
  // sur la playlist) et les telephones connectes.
  if (cmd.type === "remove-item") {
    // { type, id }
    const key = playlistKey(cmd.type || "video");
    store.media[key] = store.media[key].filter((it) => it.id !== cmd.id);
    persistStore();
    broadcast("media:library-changed");
    pushPlaylistsToPhones();
    return;
  }
  if (cmd.type === "reorder-item") {
    // { type, orderedIds }
    const key = playlistKey(cmd.type || "video");
    const byId = new Map(store.media[key].map((it) => [it.id, it]));
    store.media[key] = (cmd.orderedIds || []).map((id) => byId.get(id)).filter(Boolean);
    persistStore();
    broadcast("media:library-changed");
    pushPlaylistsToPhones();
    return;
  }
  if (cmd.type === "clear-playlist") {
    // { type }
    store.media[playlistKey(cmd.type || "video")] = [];
    persistStore();
    broadcast("media:library-changed");
    pushPlaylistsToPhones();
    return;
  }
  // Tout le reste (volume, next/prev, seek, luminosité, play-pause,
  // stop, navigation, menu, plein écran...) est géré côté renderer, qui
  // a directement la main sur l'élément <video>/<audio> et l'UI.
  broadcast("remote:command", cmd);
}

// Pousse l'etat courant de la playlist/mediatheque a tous les
// telephones connectes (voir remote-server.js -> pushPlaylists).
function pushPlaylistsToPhones() {
  remote.pushPlaylists({
    video: store.media.videoPlaylist,
    audio: store.media.audioPlaylist,
    playlists: store.media.playlists,
  });
}

// Capture de la fenetre Central Media pour l'aperçu ecran a distance
// (GET /api/screen/frame). Capture volontairement la fenetre plutot
// que l'ecran entier : c'est exactement le contenu qui interesse
// l'utilisateur ("voir le lecteur"), et ça evite toute permission de
// capture d'ecran Windows supplementaire.
//
// Cache par niveau de qualite (250ms) : si plusieurs telephones
// demandent une frame au meme moment, ou si le meme telephone poll plus
// vite que prevu, on evite de relancer capturePage() (couteux) a
// chaque requete.
const FRAME_CACHE_TTL_MS = 250;
const frameCache = { low: null, medium: null, high: null };
const frameCacheAt = { low: 0, medium: 0, high: 0 };
const QUALITY_PRESETS = {
  low: { scale: 0.25, jpeg: 40 },
  medium: { scale: 0.5, jpeg: 60 },
  high: { scale: 0.75, jpeg: 75 },
};

async function captureFrame(quality) {
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;
  const now = Date.now();
  if (frameCache[quality] && now - frameCacheAt[quality] < FRAME_CACHE_TTL_MS) {
    return frameCache[quality];
  }
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const image = await mainWindow.webContents.capturePage();
  const { width } = image.getSize();
  const resized = width > 0 ? image.resize({ width: Math.round(width * preset.scale) }) : image;
  const buffer = resized.toJPEG(preset.jpeg);
  frameCache[quality] = buffer;
  frameCacheAt[quality] = now;
  return buffer;
}

// Contexte fourni au serveur HTTP pour les routes de lecture à distance.
function remoteContext() {
  return {
    library: (type) => store.media[playlistKey(type)],
    playlists: () => store.media.playlists,
    onUpload: (filePath, mediaType) => {
      addToPlaylist(mediaType, filePath);
      broadcast("remote:command", { type: "play-item", path: filePath, mediaType });
      pushPlaylistsToPhones();
    },
    captureFrame,
  };
}

// Affiche une boite de dialogue Accepter/Refuser quand un telephone sur
// le meme reseau demande a s'appairer sans QR code (section 15 du
// cahier des charges de la telecommande : "accepter/refuser une
// demande d'appairage"). Non-bloquant : dialog.showMessageBox est deja
// asynchrone, la fenetre principale reste utilisable pendant l'attente.
async function handlePairRequest(request) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    remote.resolvePairRequest(request.id, false);
    return;
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Refuser", "Accepter"],
    defaultId: 1,
    cancelId: 0,
    title: "Demande d'appairage",
    message: `"${request.deviceName}" (${request.ip}) demande à se connecter à Central Media en tant que télécommande.`,
    detail: "Accepte uniquement si tu reconnais cet appareil sur ton réseau.",
  });
  remote.resolvePairRequest(request.id, response === 1);
}

ipcMain.handle("remote:start", async () => {
  store.settings.remoteControl.enabled = true;
  persistStore();
  const info = await remote.start(store.settings.remoteControl.port, {
    onCommand: handleRemoteCommand,
    getContext: remoteContext,
    onPairRequest: handlePairRequest,
  });
  if (info.running) {
    try {
      const QRCode = require("qrcode");
      // Le QR encode le payload complet de pairage (ip+port+token), pas
      // juste l'URL, pour que le scan côté Android configure tout d'un coup.
      info.qrDataUrl = await QRCode.toDataURL(info.pairPayload, { margin: 1, width: 260 });
    } catch { info.qrDataUrl = null; }
  }
  // Bluetooth : best-effort, ne bloque jamais le démarrage du WiFi/QR.
  const btInfo = await remoteBt.start({ onCommand: handleRemoteCommand });
  info.bluetooth = btInfo.running
    ? { available: true }
    : { available: false, reason: btInfo.reason || remoteBt.getStatusReason() };
  return info;
});
ipcMain.handle("remote:stop", async () => {
  store.settings.remoteControl.enabled = false;
  persistStore();
  await remote.stop();
  await remoteBt.stop();
  return true;
});
ipcMain.handle("remote:push-state", (_e, state) => { remote.pushState(state); remoteBt.pushState(state); return true; });
ipcMain.handle("remote:get-status", () => ({ ...remote.getStatus(), bluetoothAvailable: remoteBt.isAvailable() }));

// ------------------------------------------------------------
// IPC — dialogues fichiers / dossiers
// ------------------------------------------------------------
ipcMain.handle("dialog:choose-media-file", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Ouvrir des fichiers médias",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Tous les médias", extensions: ALL_MEDIA_EXT },
      { name: "Vidéo", extensions: VIDEO_EXT },
      { name: "Audio / Musique", extensions: AUDIO_EXT },
      { name: "Tous les fichiers", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { paths: [], video: [], audio: [] };

  const video = [], audio = [];
  res.filePaths.forEach((p) => {
    const t = mediaTypeForExt(p) || "video";
    addToPlaylist(t, p);
    (t === "audio" ? audio : video).push(p);
  });
  return { paths: res.filePaths, video, audio };
});

ipcMain.handle("dialog:choose-media-folder", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { title: "Choisir un dossier", properties: ["openDirectory"] });
  if (res.canceled || !res.filePaths.length) return null;

  // On scanne TOUJOURS vidéo + audio ensemble : un dossier de musique doit
  // être détecté même si la playlist "active" côté interface est la vidéo.
  const found = scanFolder(res.filePaths[0], ALL_MEDIA_EXT);
  const video = [], audio = [];
  found.forEach((p) => {
    const t = mediaTypeForExt(p);
    if (!t) return;
    addToPlaylist(t, p);
    (t === "audio" ? audio : video).push(p);
  });
  return { video, audio };
});

ipcMain.handle("media:add-paths", (_e, { paths }) => {
  const video = [], audio = [];
  for (const p of paths) {
    let stat;
    try { stat = fs.statSync(p); } catch { continue; }
    if (stat.isDirectory()) {
      scanFolder(p, ALL_MEDIA_EXT).forEach((f) => {
        const t = mediaTypeForExt(f);
        if (!t) return;
        addToPlaylist(t, f);
        (t === "audio" ? audio : video).push(f);
      });
    } else {
      const t = mediaTypeForExt(p);
      if (!t) continue;
      addToPlaylist(t, p);
      (t === "audio" ? audio : video).push(p);
    }
  }
  return { video, audio, videoPlaylist: store.media.videoPlaylist, audioPlaylist: store.media.audioPlaylist };

});

ipcMain.handle("media:remove-from-playlist", (_e, { type, id }) => {
  const key = playlistKey(type);
  store.media[key] = store.media[key].filter((it) => it.id !== id);
  persistStore();
  return store.media[key];
});

ipcMain.handle("media:reorder-playlist", (_e, { type, orderedIds }) => {
  const key = playlistKey(type);
  const byId = new Map(store.media[key].map((it) => [it.id, it]));
  store.media[key] = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  persistStore();
  return store.media[key];
});

ipcMain.handle("media:clear-playlist", (_e, type) => { store.media[playlistKey(type)] = []; persistStore(); return []; });

ipcMain.handle("media:get-library", () => store.media);

ipcMain.handle("media:play-item", async (_e, { type, filePath }) => {
  try {
    if (!fs.existsSync(filePath) && !/^[a-z]+:\/\//i.test(filePath)) return { error: true, message: "Fichier introuvable." };
    const url = /^[a-z]+:\/\//i.test(filePath) ? filePath : await resolvePlayableUrl(filePath);
    addToPlaylist(type, filePath);
    const resumeAt = getResumePosition(filePath);
    addHistoryEntry(type, filePath, { position: resumeAt });
    return { path: filePath, url, title: path.basename(filePath), resumeAt };
  } catch (e) {
    return { error: true, message: e.message };
  }
});

ipcMain.handle("media:save-position", (_e, { type, filePath, position, duration }) => {
  addHistoryEntry(type, filePath, { position, duration });
  if (duration) store.media.stats.watchedSeconds += 5; // approx., appelé toutes les 5s pendant la lecture
  persistStore();
  return true;
});

ipcMain.handle("media:get-info", async (_e, filePath) => probeMedia(filePath));

ipcMain.handle("media:remove-history", (_e, id) => {
  store.media.history = store.media.history.filter((it) => it.id !== id);
  persistStore();
  return store.media.history;
});
ipcMain.handle("media:clear-history", () => { store.media.history = []; persistStore(); return []; });

// Marque-pages
ipcMain.handle("bookmarks:add", (_e, { filePath, time, label }) => {
  const entry = { id: crypto.randomUUID(), path: filePath, time, label: label || `Marque-page ${format(time)}`, createdAt: Date.now() };
  store.media.bookmarks.unshift(entry);
  persistStore();
  return entry;
});
ipcMain.handle("bookmarks:remove", (_e, id) => { store.media.bookmarks = store.media.bookmarks.filter((b) => b.id !== id); persistStore(); return store.media.bookmarks; });
ipcMain.handle("bookmarks:list", (_e, filePath) => filePath ? store.media.bookmarks.filter((b) => b.path === filePath) : store.media.bookmarks);

// Notes synchronisées
ipcMain.handle("notes:add", (_e, { filePath, time, text }) => {
  const entry = { id: crypto.randomUUID(), path: filePath, time, text, createdAt: Date.now() };
  store.media.notes.unshift(entry);
  persistStore();
  return entry;
});
ipcMain.handle("notes:remove", (_e, id) => { store.media.notes = store.media.notes.filter((n) => n.id !== id); persistStore(); return store.media.notes; });
ipcMain.handle("notes:list", (_e, filePath) => filePath ? store.media.notes.filter((n) => n.path === filePath) : store.media.notes);

// Statistiques
ipcMain.handle("stats:get", () => ({
  watchedSeconds: store.media.stats.watchedSeconds,
  playCount: store.media.stats.playCount,
  itemsInHistory: store.media.history.length,
  remainingEstimate: store.media.videoPlaylist.reduce((acc) => acc, 0),
}));

function format(sec) {
  sec = Math.floor(sec) || 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h > 0 ? String(h).padStart(2, "0") + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// Playlists nommées (sauvegarder / charger une sélection de fichiers)
ipcMain.handle("playlists:save", (_e, { name, type, items }) => {
  const entry = { id: crypto.randomUUID(), name, type, items, createdAt: Date.now() };
  store.media.playlists.unshift(entry);
  persistStore();
  return entry;
});
ipcMain.handle("playlists:list", () => store.media.playlists);
ipcMain.handle("playlists:delete", (_e, id) => { store.media.playlists = store.media.playlists.filter((p) => p.id !== id); persistStore(); return store.media.playlists; });

// Import / export de playlists externes (m3u, m3u8, pls, xspf)
ipcMain.handle("playlists:import-file", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Importer une playlist",
    properties: ["openFile"],
    filters: [{ name: "Playlists", extensions: ["m3u", "m3u8", "pls", "xspf"] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  try {
    const items = parsePlaylistFile(res.filePaths[0]);
    return { name: path.basename(res.filePaths[0]), items };
  } catch (e) {
    return { error: true, message: e.message };
  }
});

ipcMain.handle("playlists:export-file", async (_e, { items, defaultName }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: "Exporter la playlist",
    defaultPath: defaultName || "playlist.m3u8",
    filters: [
      { name: "M3U8", extensions: ["m3u8"] },
      { name: "M3U", extensions: ["m3u"] },
      { name: "PLS", extensions: ["pls"] },
      { name: "XSPF", extensions: ["xspf"] },
    ],
  });
  if (res.canceled || !res.filePath) return false;
  try { writePlaylistFile(res.filePath, items); return { path: res.filePath }; }
  catch (e) { return { error: true, message: e.message }; }
});

// Sous-titres : choix d'un fichier local (srt/vtt/ass...)
ipcMain.handle("subtitles:choose-file", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Ajouter des sous-titres",
    properties: ["openFile"],
    filters: [{ name: "Sous-titres", extensions: ["srt", "vtt", "ass", "ssa", "sub"] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return { path: res.filePaths[0], url: pathToFileURL(res.filePaths[0]).href, name: path.basename(res.filePaths[0]) };
});

// Paroles synchronisées (.lrc)
ipcMain.handle("lyrics:choose-file", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Charger un fichier de paroles",
    properties: ["openFile"],
    filters: [{ name: "Paroles LRC", extensions: ["lrc"] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return { path: res.filePaths[0], url: pathToFileURL(res.filePaths[0]).href, name: path.basename(res.filePaths[0]) };
});

// RTSP
ipcMain.handle("rtsp:start", (_e, url) => {
  try { return startRtspSession(url); } catch (e) { return { error: true, message: e.message }; }
});
ipcMain.handle("rtsp:stop", (_e, id) => stopRtspSession(id));

// Capture
ipcMain.handle("capture:save-screenshot", async (_e, { dataUrl, suggestedName }) => {
  ensureDir(CAPTURES_DIR());
  const res = await dialog.showSaveDialog(mainWindow, {
    title: "Enregistrer la capture",
    defaultPath: path.join(CAPTURES_DIR(), suggestedName || `capture-${Date.now()}.png`),
    filters: [{ name: "Image PNG", extensions: ["png"] }],
  });
  if (res.canceled || !res.filePath) return null;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(res.filePath, Buffer.from(base64, "base64"));
  return res.filePath;
});

ipcMain.handle("capture:record-audio-clip", async (_e, { filePath, startSec, durationSec }) => {
  try { const out = await extractAudioClip(filePath, startSec, durationSec); return { path: out }; }
  catch (e) { return { error: true, message: e.message }; }
});

// Podcasts : ajout par flux RSS (parsing basique côté renderer via fetch+DOMParser,
// mais on stocke ici le résultat pour persistance / affichage hors-ligne)
ipcMain.handle("podcasts:save", (_e, podcast) => {
  const idx = store.media.podcasts.findIndex((p) => p.feedUrl === podcast.feedUrl);
  const entry = { id: idx >= 0 ? store.media.podcasts[idx].id : crypto.randomUUID(), ...podcast };
  if (idx >= 0) store.media.podcasts[idx] = entry; else store.media.podcasts.unshift(entry);
  persistStore();
  return entry;
});
ipcMain.handle("podcasts:list", () => store.media.podcasts);
ipcMain.handle("podcasts:remove", (_e, id) => { store.media.podcasts = store.media.podcasts.filter((p) => p.id !== id); persistStore(); return store.media.podcasts; });

// Paramètres
ipcMain.handle("settings:get", () => store.settings);
ipcMain.handle("settings:set", (_e, patch) => { deepMerge(store.settings, patch); persistStore(); return store.settings; });

// Menu contextuel
ipcMain.on("ctxmenu:open", (e, ctx) => { const win = BrowserWindow.fromWebContents(e.sender); if (win) buildContextMenu(win, ctx || {}); });

// Ouvrir une URL de flux (http/https/rtsp/m3u8) — validation simple
ipcMain.handle("stream:validate-url", (_e, url) => {
  try { new URL(url); return true; } catch { return false; }
});

ipcMain.handle("shell:show-in-folder", (_e, filePath) => { shell.showItemInFolder(filePath); return true; });
ipcMain.handle("shell:open-external", (_e, url) => { shell.openExternal(url); return true; });

// ------------------------------------------------------------
// Menu contextuel de l'Explorateur Windows : "Ajouter à Media Player".
// Ajoute, pour chaque extension média reconnue, une clé de registre sous
// HKEY_CURRENT_USER\Software\Classes\SystemFileAssociations\.ext\shell\...
// (aucun droit administrateur requis, contrairement à HKEY_CLASSES_ROOT).
// MultiSelectModel=Player permet à Explorer d'invoquer une seule fois la
// commande avec tous les fichiers sélectionnés, plutôt qu'un process par
// fichier.
// ------------------------------------------------------------
const EXPLORER_VERB = "CentralMediaAddToPlaylist";

function regKeyFor(ext) {
  return `HKCU\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\${EXPLORER_VERB}`;
}

function runReg(args) {
  return new Promise((resolve) => {
    const proc = spawn("reg.exe", args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", () => resolve({ ok: false, message: "reg.exe introuvable (Windows uniquement)." }));
    proc.on("close", (code) => resolve({ ok: code === 0, message: code === 0 ? null : stderr.trim() }));
  });
}

async function enableExplorerIntegration() {
  if (process.platform !== "win32") return { ok: false, message: "Fonctionnalité disponible uniquement sur Windows." };
  const exePath = app.isPackaged ? process.execPath : process.execPath; // en dev : electron.exe (utile pour tester le principe)
  const label = "Ajouter à Central Media Player";
  const iconPath = exePath;

  const results = await Promise.all(ALL_MEDIA_EXT.map(async (ext) => {
    const key = regKeyFor(ext);
    const r1 = await runReg(["add", key, "/ve", "/d", label, "/f"]);
    const r2 = await runReg(["add", key, "/v", "Icon", "/d", `"${iconPath}",0`, "/f"]);
    const r3 = await runReg(["add", key, "/v", "MultiSelectModel", "/d", "Player", "/f"]);
    const cmd = app.isPackaged
      ? `"${exePath}" "--add-to-playlist" "%1"`
      : `"${exePath}" "${path.join(__dirname, "main.js")}" "--add-to-playlist" "%1"`;
    const r4 = await runReg(["add", key + "\\command", "/ve", "/d", cmd, "/f"]);
    return [r1, r2, r3, r4].every((r) => r.ok);
  }));

  const ok = results.every(Boolean);
  if (ok) { store.settings.explorerIntegration = true; persistStore(); }
  return { ok, message: ok ? null : "Certaines clés de registre n'ont pas pu être créées." };
}

async function disableExplorerIntegration() {
  if (process.platform !== "win32") return { ok: false, message: "Fonctionnalité disponible uniquement sur Windows." };
  await Promise.all(ALL_MEDIA_EXT.map((ext) => runReg(["delete", regKeyFor(ext), "/f"])));
  store.settings.explorerIntegration = false;
  persistStore();
  return { ok: true };
}

ipcMain.handle("explorer:get-status", () => ({
  supported: process.platform === "win32",
  enabled: !!store.settings.explorerIntegration,
}));
ipcMain.handle("explorer:enable", () => enableExplorerIntegration());
ipcMain.handle("explorer:disable", () => disableExplorerIntegration());

// ------------------------------------------------------------
// Cycle de vie de l'application
// ------------------------------------------------------------
app.whenReady().then(() => {
  createMainWindow();
  updater.setup(); 

  if (store.settings.remoteControl.enabled) {
    // Meme options completes que le demarrage manuel (ipcMain "remote:start")
    // — la version precedente ne passait pas getContext, ce qui aurait
    // silencieusement casse /api/library, /api/browse, l'apercu ecran,
    // etc. lorsque la telecommande demarre automatiquement au lancement.
    remote.start(store.settings.remoteControl.port, {
      onCommand: handleRemoteCommand,
      getContext: remoteContext,
      onPairRequest: handlePairRequest,
    }).catch(() => {});
  }

  // Démarrage "à froid" via le menu contextuel Windows : les chemins
  // arrivent dans process.argv. On laisse le temps à la fenêtre/au
  // renderer de charger avant de les pousser.
  setTimeout(() => handleIncomingArgv(process.argv), 1200);
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { stopAllRtspSessions(); remote.stop().catch(() => {}); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
