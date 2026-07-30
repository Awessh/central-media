// Utilitaires partagés à tous les modules du renderer.
// Chaque module attache ses fonctions à `window.App` (pas de bundler ici,
// les fichiers sont chargés séquentiellement via <script> dans index.html).
window.App = window.App || {};

App.util = {
  formatTime(sec) {
    sec = Math.floor(sec) || 0;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  },

  formatBytes(bytes) {
    if (!bytes) return "—";
    const units = ["o", "Ko", "Mo", "Go", "To"];
    let i = 0, val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return val.toFixed(val < 10 && i > 0 ? 1 : 0) + " " + units[i];
  },

  formatBitrate(bps) {
    if (!bps) return "—";
    if (bps > 1_000_000) return (bps / 1_000_000).toFixed(2) + " Mb/s";
    return Math.round(bps / 1000) + " kb/s";
  },

  timeAgo(ts) {
    if (!ts) return "";
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return Math.floor(diff / 60) + " min";
    if (diff < 86400) return Math.floor(diff / 3600) + " h";
    return Math.floor(diff / 86400) + " j";
  },

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  },

  debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  },

  extname(p) {
    const m = /\.([a-z0-9]+)$/i.exec(p || "");
    return m ? m[1].toLowerCase() : "";
  },

  basename(p) {
    if (!p) return "";
    if (/^[a-z]+:\/\//i.test(p)) { try { return decodeURIComponent(new URL(p).pathname.split("/").pop() || p); } catch { return p; } }
    return p.split(/[\\/]/).pop();
  },

  isStreamUrl(p) { return /^[a-z]+:\/\//i.test(p); },
  isRtsp(p) { return /^rtsp:\/\//i.test(p); },
  isHls(p) { return /\.m3u8($|\?)/i.test(p); },
  isDash(p) { return /\.mpd($|\?)/i.test(p); },

  uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); },

  toast(text, ms = 2500) {
    const el = document.getElementById("resume-toast");
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(App.util.toast._t);
    App.util.toast._t = setTimeout(() => el.classList.add("hidden"), ms);
  },

  osd(text, ms = 900) {
    const el = document.getElementById("osd");
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(App.util.osd._t);
    App.util.osd._t = setTimeout(() => el.classList.add("hidden"), ms);
  },
};
