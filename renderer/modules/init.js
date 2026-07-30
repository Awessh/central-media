window.App = window.App || {};

(async function init() {
  const api = window.playerAPI;

  // Paramètres persistés
  App.state.settings = await api.getSettings();
  App.state.autoplayNext = App.state.settings.autoplayNext;
  App.dom.autoplayNext.classList.toggle("active", App.state.autoplayNext);
  App.dom.volume.value = App.state.settings.defaultVolume;
  App.subtitles.applyStyle();

  // Mode par défaut = vidéo (élément affiché) tant qu'aucun média n'est chargé
  App.player.setMode("video");
  App.dom.video.volume = App.state.settings.defaultVolume / 100;
  App.dom.audio.volume = App.state.settings.defaultVolume / 100;

  // Onglets de la barre latérale
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add("active");
    });
  });

  // Câblage des modules
  App.player.bindControls();
  App.playlist.bind();
  App.library.bind();
  App.podcasts.bind();
  App.lyrics.bind();
  App.capture.bind();
  App.menubar.bind();
  App.keyboard.bind();
  App.contextmenu.bind();

  // Miniatures générées après coup (playlist vidéo)
  api.onThumbnailReady(({ id, thumbnail }) => {
    const entry = App.state.library.videoPlaylist.find((it) => it.id === id);
    if (entry) { entry.thumbnail = thumbnail; App.playlist.render(); }
  });

  // Bibliothèque (playlists, historique, marque-pages, notes, stats)
  await App.library.refreshAndRender();
  await App.podcasts.load();

  // Télécommande
  await App.remote.init();

  // Bascule automatique du type de playlist actif selon l'onglet ouvert
  // (Playlist affiche toujours la liste vidéo par défaut ; un bouton dédié
  // pourra être ajouté pour basculer vers la playlist audio si besoin).
})();
