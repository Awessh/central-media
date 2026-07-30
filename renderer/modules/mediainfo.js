window.App = window.App || {};

App.mediainfo = (() => {
  const { state, util } = App;
  let cache = new Map();

  async function prefetch(filePath) {
    if (cache.has(filePath)) return;
    const info = await window.playerAPI.getMediaInfo(filePath);
    cache.set(filePath, info);
  }

  async function show() {
    if (!state.currentPath) { util.toast("Aucun média en cours de lecture."); return; }

    let info;
    if (state.currentType === "local") {
      info = cache.get(state.currentPath) || await window.playerAPI.getMediaInfo(state.currentPath);
      cache.set(state.currentPath, info);
    } else {
      info = { streamType: state.currentType };
    }

    const el = App.activeEl();
    const rows = [];
    rows.push(["Titre", util.basename(state.currentTitle || state.currentPath)]);
    rows.push(["Type de source", state.currentType]);
    if (info && !info.error) {
      if (info.codecVideo) rows.push(["Codec vidéo", info.codecVideo]);
      if (info.codecAudio) rows.push(["Codec audio", info.codecAudio]);
      if (info.width) rows.push(["Résolution", `${info.width} × ${info.height}`]);
      if (info.fps) rows.push(["FPS / Framerate", info.fps]);
      if (info.bitrate) rows.push(["Bitrate", util.formatBitrate(info.bitrate)]);
      if (info.size) rows.push(["Taille", util.formatBytes(info.size)]);
      if (info.duration) rows.push(["Durée", util.formatTime(info.duration)]);
      if (info.audioTracks && info.audioTracks.length) rows.push(["Pistes audio", info.audioTracks.map((a) => a.language || a.codec).join(", ")]);
      if (info.subtitleTracks && info.subtitleTracks.length) rows.push(["Sous-titres embarqués", info.subtitleTracks.map((s) => s.language || s.codec).join(", ")]);
    }
    rows.push(["Résolution affichée", el.videoWidth ? `${el.videoWidth} × ${el.videoHeight}` : "—"]);

    App.modal.open({
      title: "Informations média",
      body: `<table class="mediainfo-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${util.escapeHtml(String(v))}</td></tr>`).join("")}</table>`,
      footer: `<button class="btn primary" data-close>Fermer</button>`,
    });
  }

  return { prefetch, show };
})();
