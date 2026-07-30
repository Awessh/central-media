window.App = window.App || {};

App.player = (() => {
  const { dom, state, util } = App;
  const api = window.playerAPI;

  // ------------------------------------------------------------
  // Détermine le type de source et lance la lecture appropriée.
  // ------------------------------------------------------------
  async function playPath(rawPath, opts = {}) {
    if (!rawPath) return;

    App.streaming.teardown(); // ferme hls.js/dash.js/rtsp de la lecture précédente

    const type = opts.type || guessType(rawPath);
    dom.convertingOverlay.classList.remove("hidden");

    try {
      if (type === "rtsp") {
        await playRtsp(rawPath);
      } else if (type === "hls" || type === "dash" || type === "iptv" || type === "url") {
        await playStreamUrl(rawPath, type);
      } else {
        await playLocalFile(rawPath, opts.mediaType);
      }
    } catch (e) {
      util.toast("Lecture impossible : " + (e.message || e));
    } finally {
      dom.convertingOverlay.classList.add("hidden");
    }
  }

  function guessType(p) {
    if (util.isRtsp(p)) return "rtsp";
    if (util.isHls(p)) return "hls";
    if (util.isDash(p)) return "dash";
    if (util.isStreamUrl(p)) return "url";
    return "local";
  }

  async function playLocalFile(filePath, forcedType) {
    const mediaType = forcedType || (App.state.activePlaylistType === "audio" || /\.(mp3|wav|flac|aac|ogg|oga|m4a|wma|opus|aiff|alac)$/i.test(filePath) ? "audio" : "video");

    const res = await api.playMediaItem(mediaType, filePath);
    if (!res || res.error) throw new Error(res && res.message ? res.message : "fichier introuvable");

    setMode(mediaType);
    const el = App.activeEl();

    state.currentPath = res.path;
    state.currentType = "local";
    state.currentTitle = res.title;
    state.pendingResume = res.resumeAt || 0;
    state.resumeHandled = false;

    App.subtitles.reset();
    el.src = res.url;
    el.load();
    await safePlay(el);

    afterLoadUI(res.title);

    if (mediaType === "video") App.mediainfo.prefetch(filePath);
    if (mediaType === "audio") App.lyrics.loadForFile(filePath);

    App.library.refreshAndRender();
    App.player.persistPosition();
  }

  async function playStreamUrl(url, type) {
    setMode("video");
    const el = App.activeEl();
    state.currentPath = url;
    state.currentType = type;
    state.currentTitle = util.basename(url) || url;
    state.pendingResume = 0;
    state.resumeHandled = true;

    App.subtitles.reset();

    if (type === "dash" || util.isDash(url)) {
      App.streaming.attachDash(el, url);
    } else if (type === "hls" || util.isHls(url) || type === "iptv") {
      App.streaming.attachHls(el, url);
    } else {
      el.src = url; // MP4 direct, etc.
      el.load();
    }

    await safePlay(el);
    afterLoadUI(state.currentTitle);
  }

  async function playRtsp(rtspUrl) {
    const session = await api.startRtsp(rtspUrl);
    if (!session || session.error) throw new Error(session && session.message ? session.message : "flux RTSP inaccessible");

    setMode("video");
    const el = App.activeEl();
    state.currentPath = rtspUrl;
    state.currentType = "rtsp";
    state.currentTitle = "Flux RTSP — " + rtspUrl;
    state.rtspSessionId = session.id;
    state.pendingResume = 0;
    state.resumeHandled = true;

    App.subtitles.reset();
    // Laisse quelques secondes à ffmpeg pour produire les premiers segments HLS.
    await new Promise((r) => setTimeout(r, 1500));
    App.streaming.attachHls(el, session.playlistUrl, { liveEdge: true });

    await safePlay(el);
    afterLoadUI(state.currentTitle);
  }

  async function safePlay(el) { try { await el.play(); } catch { /* autoplay bloqué, l'utilisateur relancera */ } }

  function setMode(mode) {
    state.mode = mode;
    dom.video.classList.toggle("hidden", mode !== "video");
    dom.audio.classList.toggle("hidden", mode !== "audio");
    App.dom.videoWrap.style.display = mode === "video" ? "flex" : "none";
    wireMediaEvents(App.activeEl());
  }

  function afterLoadUI(title) {
    dom.filename.textContent = title;
    dom.emptyState.classList.add("hidden");
    dom.topbar.classList.add("visible");
    App.util.osd(title, 1400);
  }

  // ------------------------------------------------------------
  // Ouverture (fichier / dossier / URL)
  // ------------------------------------------------------------
  async function chooseAndPlay(type) {
    const res = await api.chooseMediaFile(type || App.state.activePlaylistType);
    if (!res || !res.paths || !res.paths.length) return;
    await App.library.refreshAndRender();
    await playPath(res.paths[0], { mediaType: type });
  }

  async function chooseAndPlayFolder(type) {
    const res = await api.chooseMediaFolder(type || App.state.activePlaylistType);
    if (res === null) return;
    if (!res.paths || !res.paths.length) { util.toast("Aucun média trouvé dans ce dossier."); return; }
    await App.library.refreshAndRender();
    if (!state.currentPath) await playPath(res.paths[0], { mediaType: type });
  }

  function openUrlPrompt() {
    App.modal.open({
      title: "Ouvrir une URL ou un flux",
      body: `
        <div class="settings-section">
          <p style="color:var(--text-dim);font-size:12.5px;margin:0">
            Vidéo directe, flux HLS (.m3u8), DASH (.mpd), IPTV ou RTSP (rtsp://...).
          </p>
          <input type="text" id="urlInput" placeholder="https://... ou rtsp://..." style="width:100%;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:9px;color:var(--text)">
        </div>`,
      footer: `<button class="btn" data-close>Annuler</button><button class="btn primary" id="urlGo">Lire</button>`,
      onMount(root) {
        const input = root.querySelector("#urlInput");
        input.focus();
        const go = () => { const v = input.value.trim(); if (v) { App.modal.closeAll(); playPath(v); } };
        root.querySelector("#urlGo").onclick = go;
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      },
    });
  }

  // ------------------------------------------------------------
  // Navigation playlist (précédent / suivant)
  // ------------------------------------------------------------
  function currentList() { return state.activePlaylistType === "audio" ? state.library.audioPlaylist : state.library.videoPlaylist; }
  function currentIndex() { return currentList().findIndex((it) => it.path === state.currentPath); }

  function playNext() {
    const list = currentList(); const idx = currentIndex();
    if (idx === -1) { if (list[0]) playPath(list[0].path); return; }
    const next = list[idx + 1];
    if (next) playPath(next.path);
    else util.toast("Fin de la playlist.");
  }

  function playPrevious() {
    const list = currentList(); const idx = currentIndex();
    if (idx <= 0) return;
    playPath(list[idx - 1].path);
  }

  // ------------------------------------------------------------
  // Position / reprise automatique
  // ------------------------------------------------------------
  function persistPosition() {
    const el = App.activeEl();
    if (!state.currentPath || state.currentType !== "local" || !el.duration) return;
    api.saveMediaPosition(state.mode, state.currentPath, el.currentTime, el.duration);
  }

  // ------------------------------------------------------------
  // Câblage des évènements du <video>/<audio> actif
  // ------------------------------------------------------------
  let wiredEl = null;
  function wireMediaEvents(el) {
    if (wiredEl === el) return;
    wiredEl = el;

    el.addEventListener("loadedmetadata", () => {
      dom.duration.textContent = util.formatTime(el.duration);
      if (state.pendingResume && !state.resumeHandled) {
        el.currentTime = state.pendingResume;
        util.toast("Reprise à " + util.formatTime(state.pendingResume));
      }
      state.resumeHandled = true;
      App.chapters.parseFromEl(el);
      persistPosition();
    });

    el.addEventListener("timeupdate", () => {
      dom.currentTime.textContent = util.formatTime(el.currentTime);
      dom.progress.value = el.duration ? Math.round((el.currentTime / el.duration) * 1000) : 0;
      App.lyrics.sync(el.currentTime);
      App.remote.pushState();
    });

    el.addEventListener("play", () => { dom.playPause.innerHTML = '<i class="fa-solid fa-pause"></i>'; App.remote.pushState(); });
    el.addEventListener("pause", () => { dom.playPause.innerHTML = '<i class="fa-solid fa-play"></i>'; persistPosition(); App.remote.pushState(); });
    el.addEventListener("ended", () => {
      persistPosition();
      if (el.loop) return;
      if (state.autoplayNext) playNext();
    });
    el.addEventListener("error", () => { if (el.src) util.toast("Erreur de lecture du média."); });
  }

  // ------------------------------------------------------------
  // Contrôles standards
  // ------------------------------------------------------------
  function togglePlay() { const el = App.activeEl(); if (el.paused) el.play().catch(() => {}); else el.pause(); }
  function stopPlayback() {
    App.streaming.teardown();
    const el = App.activeEl();
    el.pause(); el.removeAttribute("src"); el.load();
    state.currentPath = null; state.pendingResume = 0; state.resumeHandled = false;
    dom.filename.textContent = ""; dom.topbar.classList.remove("visible");
    dom.emptyState.classList.remove("hidden");
    dom.currentTime.textContent = "00:00"; dom.duration.textContent = "00:00"; dom.progress.value = 0;
    App.library.highlightCurrent();
  }
  function seekBy(delta) { const el = App.activeEl(); el.currentTime = Math.max(0, el.currentTime + delta); App.util.osd((delta > 0 ? "+" : "") + delta + "s"); }
  function stepFrame(dir) { const el = App.activeEl(); el.pause(); el.currentTime = Math.max(0, el.currentTime + dir * state.frameStep); App.util.osd(dir > 0 ? "Image suivante" : "Image précédente"); }

  function bindControls() {
    dom.playPause.onclick = togglePlay;
    dom.stop.onclick = stopPlayback;
    dom.back10.onclick = () => seekBy(-10);
    dom.forward10.onclick = () => seekBy(10);
    dom.frameBack.onclick = () => stepFrame(-1);
    dom.frameForward.onclick = () => stepFrame(1);
    dom.nextBtn.onclick = playNext;
    dom.prevBtn.onclick = playPrevious;

    dom.progress.oninput = () => { const el = App.activeEl(); if (el.duration) el.currentTime = (dom.progress.value / 1000) * el.duration; };

    dom.volume.oninput = () => { const el = App.activeEl(); el.volume = dom.volume.value / 100; api.setSettings({ defaultVolume: Number(dom.volume.value) }); };
    dom.mute.onclick = () => { const el = App.activeEl(); el.muted = !el.muted; dom.mute.innerHTML = el.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>'; };

    dom.speed.onchange = () => { App.activeEl().playbackRate = Number(dom.speed.value); };

    dom.autoplayNext.onclick = () => { state.autoplayNext = !state.autoplayNext; dom.autoplayNext.classList.toggle("active", state.autoplayNext); };
    dom.repeat.onclick = () => { const el = App.activeEl(); el.loop = !el.loop; dom.repeat.classList.toggle("active-loop", el.loop); };

    dom.pip.onclick = async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else if (state.mode === "video") await dom.video.requestPictureInPicture();
      } catch (e) { console.log(e); }
    };

    dom.fullscreen.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else App.dom.stage.requestFullscreen(); };
    dom.video.ondblclick = () => dom.fullscreen.click();

    dom.alwaysOnTopBtn.onclick = () => {
      dom.alwaysOnTopBtn.classList.toggle("active");
      // Le "always on top" nécessite une action process principal ; exposé
      // ici pour extension future (actuellement affiché comme préférence UI).
      util.toast(dom.alwaysOnTopBtn.classList.contains("active") ? "Toujours au premier plan activé" : "Désactivé");
    };

    dom.sidebarToggle.onclick = () => dom.sidebar.classList.toggle("collapsed");

    document.getElementById("openFileEmpty").onclick = () => chooseAndPlay();
    document.getElementById("openFolderEmpty").onclick = () => chooseAndPlayFolder();
    document.getElementById("openUrlEmpty").onclick = openUrlPrompt;

    let hideTimer;
    function showControls() {
      document.getElementById("controls").style.opacity = 1;
      dom.topbar.classList.add("visible");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        const el = App.activeEl();
        if (!el.paused && state.mode === "video") { document.getElementById("controls").style.opacity = 0; dom.topbar.classList.remove("visible"); }
      }, 3000);
    }
    App.dom.stage.addEventListener("mousemove", showControls);

    setInterval(() => { const el = App.activeEl(); if (!el.paused) persistPosition(); }, 5000);
    window.addEventListener("beforeunload", persistPosition);

    // Glisser-déposer
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const paths = files.map((f) => f.path).filter(Boolean);
      if (!paths.length) return;
      const res = await api.addMediaPaths(state.activePlaylistType, paths);
      if (!res || !res.added || !res.added.length) return;
      state.library[state.activePlaylistType === "audio" ? "audioPlaylist" : "videoPlaylist"] = res.playlist;
      App.playlist.render();
      playPath(res.added[0]);
    });
  }

  return {
    playPath, chooseAndPlay, chooseAndPlayFolder, openUrlPrompt,
    playNext, playPrevious, persistPosition, togglePlay, stopPlayback, seekBy, stepFrame,
    bindControls, currentList, currentIndex, safePlay, setMode,
  };
})();
