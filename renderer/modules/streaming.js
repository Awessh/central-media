window.App = window.App || {};

// Encapsule hls.js et dash.js pour lire HLS (.m3u8), DASH (.mpd), IPTV
// (playlists de flux live, généralement HLS/MPEG-TS) et RTSP (transcodé en
// HLS local côté main process, cf. player.js `playRtsp`).
App.streaming = (() => {
  const { state } = App;

  function attachHls(videoEl, url, opts = {}) {
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: !!opts.liveEdge,
        liveSyncDurationCount: opts.liveEdge ? 3 : 6,
        enableWorker: true,
      });
      hls.loadSource(url);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Pistes audio multiples exposées par hls.js (flux HLS avec audio
        // alternatif) -> remontées au sélecteur de piste audio.
        App.audioTracks.setFromHls(hls);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          App.util.toast("Flux interrompu : " + data.type);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
            case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
            default: teardown(); break;
          }
        }
      });

      state.hls = hls;
    } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / WebKit : lecture native du HLS.
      videoEl.src = url;
    } else {
      App.util.toast("HLS non supporté sur cet environnement.");
      videoEl.src = url;
    }
  }

  function attachDash(videoEl, url) {
    if (window.dashjs) {
      const player = dashjs.MediaPlayer().create();
      player.initialize(videoEl, url, true);
      player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
        App.audioTracks.setFromDash(player);
      });
      player.on(dashjs.MediaPlayer.events.ERROR, (e) => App.util.toast("Erreur DASH : " + (e?.error?.message || e?.error || "inconnue")));
      state.dash = player;
    } else {
      App.util.toast("dash.js non disponible (npm install requis).");
      videoEl.src = url;
    }
  }

  function teardown() {
    if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; }
    if (state.dash) { try { state.dash.reset(); } catch {} state.dash = null; }
    if (state.rtspSessionId) { window.playerAPI.stopRtsp(state.rtspSessionId); state.rtspSessionId = null; }
    App.audioTracks.reset();
  }

  return { attachHls, attachDash, teardown };
})();

// ------------------------------------------------------------
// Sélection de la piste audio (quand plusieurs pistes sont
// disponibles). Le HTMLMediaElement expose `audioTracks` pour les
// médias multi-pistes (Chromium) ; hls.js/dash.js exposent leur
// propre API pour les flux adaptatifs.
// ------------------------------------------------------------
App.audioTracks = (() => {
  let mode = "native"; // "native" | "hls" | "dash"
  let hlsRef = null, dashRef = null;

  function reset() { mode = "native"; hlsRef = null; dashRef = null; }

  function listNative() {
    const el = App.activeEl();
    const tracks = el.audioTracks;
    if (!tracks || !tracks.length) return [];
    const out = [];
    for (let i = 0; i < tracks.length; i++) out.push({ index: i, label: tracks[i].label || tracks[i].language || `Piste ${i + 1}`, enabled: tracks[i].enabled });
    return out;
  }

  function setFromHls(hls) { mode = "hls"; hlsRef = hls; }
  function setFromDash(player) { mode = "dash"; dashRef = player; }

  function list() {
    if (mode === "hls" && hlsRef) return (hlsRef.audioTracks || []).map((t, i) => ({ index: i, label: t.name || t.lang || `Piste ${i + 1}`, enabled: i === hlsRef.audioTrack }));
    if (mode === "dash" && dashRef) {
      try {
        const tracks = dashRef.getTracksFor("audio") || [];
        const current = dashRef.getCurrentTrackFor("audio");
        return tracks.map((t, i) => ({ index: i, label: (t.lang || `Piste ${i + 1}`) + (t.roles ? " " + t.roles.join(",") : ""), enabled: current && current.index === t.index }));
      } catch { return []; }
    }
    return listNative();
  }

  function select(index) {
    if (mode === "hls" && hlsRef) { hlsRef.audioTrack = index; return; }
    if (mode === "dash" && dashRef) {
      try { const tracks = dashRef.getTracksFor("audio") || []; if (tracks[index]) dashRef.setCurrentTrack(tracks[index]); } catch {}
      return;
    }
    const el = App.activeEl();
    if (!el.audioTracks) return;
    for (let i = 0; i < el.audioTracks.length; i++) el.audioTracks[i].enabled = i === index;
  }

  return { list, select, setFromHls, setFromDash, reset };
})();
