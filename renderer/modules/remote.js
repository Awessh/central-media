window.App = window.App || {};

App.remote = (() => {
  const { state, dom } = App;
  const api = window.playerAPI;
  let lastPushAt = 0;

  function pushState() {
    if (!state.remoteStatus.running) return;
    const now = Date.now();
    if (now - lastPushAt < 500) return; // throttle
    lastPushAt = now;
    const el = App.activeEl();
    api.pushRemoteState({
      title: state.currentTitle,
      mode: state.mode,
      paused: el.paused,
      currentTime: el.currentTime,
      duration: el.duration || 0,
      volume: el.volume,
      brightness: state.filters.brightness,
    });
  }

  function handleCommand(cmd) {
    if (!cmd || !cmd.type) return;
    switch (cmd.type) {
      case "play-pause": App.player.togglePlay(); break;
      case "next": App.player.playNext(); break;
      case "prev": App.player.playPrevious(); break;
      case "back10": App.player.seekBy(-10); break;
      case "forward10": App.player.seekBy(10); break;
      case "mute": dom.mute.click(); break;
      case "vol-up": dom.volume.value = Math.min(100, Number(dom.volume.value) + 5); dom.volume.oninput(); break;
      case "vol-down": dom.volume.value = Math.max(0, Number(dom.volume.value) - 5); dom.volume.oninput(); break;
      case "seek": if (typeof cmd.value === "number") App.activeEl().currentTime = cmd.value; break;
      case "seek-by": if (typeof cmd.seconds === "number") App.player.seekBy(cmd.seconds); break;
      case "brightness-up": App.filters.set("brightness", Math.min(200, App.state.filters.brightness + 10)); break;
      case "brightness-down": App.filters.set("brightness", Math.max(0, App.state.filters.brightness - 10)); break;
      case "brightness-set": if (typeof cmd.value === "number") App.filters.set("brightness", Math.max(0, Math.min(200, cmd.value))); break;
      case "play-item":
        // Fichier choisi depuis la télécommande (bibliothèque du PC, playlist
        // nommée, ou fichier envoyé/uploadé depuis le téléphone).
        if (cmd.path) App.player.playPath(cmd.path, { mediaType: cmd.mediaType || "video" });
        break;
    }
    pushState();
  }

  async function updateIndicator() {
    dom.remoteIndicator.classList.toggle("active", !!state.remoteStatus.running);
    dom.remoteIndicator.title = state.remoteStatus.running ? "Télécommande active — " + state.remoteStatus.url : "Télécommande";
  }

  async function init() {
    state.remoteStatus = await api.getRemoteStatus();
    updateIndicator();
    api.onRemoteCommand(handleCommand);
    dom.remoteIndicator.onclick = () => App.settings.open("remote");
  }

  return { pushState, handleCommand, updateIndicator, init };
})();
