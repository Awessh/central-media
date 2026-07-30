window.App = window.App || {};

App.contextmenu = (() => {
  const { state, dom } = App;

  function buildContext() {
    const el = App.activeEl();
    const audioTracks = App.audioTracks.list();
    const currentAudioTrack = audioTracks.findIndex((t) => t.enabled);

    return {
      hasMedia: !!state.currentPath,
      isPaused: el.paused,
      isVideo: state.mode === "video",
      speed: el.playbackRate,
      audioTracks,
      currentAudioTrack: currentAudioTrack >= 0 ? currentAudioTrack : 0,
      subtitleTracks: state.subtitleTracks,
      currentSubtitle: currentSubtitleIndex(),
      mirrorH: state.mirrorH,
      mirrorV: state.mirrorV,
      isFullscreen: !!document.fullscreenElement,
      alwaysOnTop: dom.alwaysOnTopBtn.classList.contains("active"),
    };
  }

  function currentSubtitleIndex() {
    const tt = dom.video.textTracks;
    for (let i = 0; i < tt.length; i++) if (tt[i].mode === "showing") return i;
    return null;
  }

  function open(e) {
    e.preventDefault();
    window.playerAPI.openContextMenu(buildContext());
  }

  function handleAction(action) {
    if (typeof action === "string") {
      switch (action) {
        case "play-pause": App.player.togglePlay(); break;
        case "stop": App.player.stopPlayback(); break;
        case "forward10": App.player.seekBy(10); break;
        case "back10": App.player.seekBy(-10); break;
        case "next-frame": App.player.stepFrame(1); break;
        case "screenshot": App.capture.screenshot(); break;
        case "record-clip": App.capture.recordAudioClipPrompt(); break;
        case "add-bookmark": App.library.addBookmarkAtCurrentTime(); break;
        case "mirror-h": App.filters.toggleMirrorH(); break;
        case "mirror-v": App.filters.toggleMirrorV(); break;
        case "rotate": App.filters.rotate90(); break;
        case "media-info": App.mediainfo.show(); break;
        case "open-file": App.player.chooseAndPlay(); break;
        case "open-folder": App.player.chooseAndPlayFolder(); break;
        case "open-url": App.player.openUrlPrompt(); break;
        case "fullscreen": dom.fullscreen.click(); break;
        case "always-on-top": dom.alwaysOnTopBtn.click(); break;
        case "open-settings": App.settings.open(); break;
        case "add-subtitle-file": App.subtitles.addFromLocalFile(); break;
        case "add-subtitle-url": App.subtitles.addFromUrlPrompt(); break;
      }
      return;
    }
    switch (action.type) {
      case "speed": dom.speed.value = action.value; App.activeEl().playbackRate = action.value; break;
      case "audio-track": App.audioTracks.select(action.value); break;
      case "subtitle": if (action.value == null) App.subtitles.disableAll(); else App.subtitles.selectTrack(action.value); break;
    }
  }

  function bind() {
    document.addEventListener("contextmenu", open);
    window.playerAPI.onContextMenuAction(handleAction);
  }

  return { bind };
})();
