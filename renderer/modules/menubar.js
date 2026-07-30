window.App = window.App || {};

App.menubar = (() => {
  function item(label, icon, onClick, extra = "") {
    return { label, icon, onClick, extra };
  }
  const sep = { sep: true };

  function menus() {
    const el = () => App.activeEl();
    return {
      fichier: [
        item("Ouvrir un fichier…", "fa-file", () => App.player.chooseAndPlay()),
        item("Ouvrir un dossier…", "fa-folder-open", () => App.player.chooseAndPlayFolder()),
        item("Ouvrir une URL / un flux…", "fa-link", () => App.player.openUrlPrompt()),
        sep,
        item("Charger une playlist…", "fa-file-import", () => App.playlist.render() || document.getElementById("loadPlaylistFile").click()),
        item("Enregistrer la playlist…", "fa-file-export", () => document.getElementById("savePlaylistFile").click()),
        sep,
        item("Ajouter un podcast…", "fa-podcast", () => App.podcasts && document.getElementById("addPodcast").click()),
      ],
      lecture: [
        item(el().paused ? "Lecture" : "Pause", "fa-play", () => App.player.togglePlay()),
        item("Stop", "fa-stop", () => App.player.stopPlayback()),
        item("Suivant", "fa-forward-step", () => App.player.playNext()),
        item("Précédent", "fa-backward-step", () => App.player.playPrevious()),
        sep,
        item("Avancer de 10s", "fa-rotate-right", () => App.player.seekBy(10)),
        item("Reculer de 10s", "fa-rotate-left", () => App.player.seekBy(-10)),
        item("Image suivante", "fa-caret-right", () => App.player.stepFrame(1)),
        item("Image précédente", "fa-caret-left", () => App.player.stepFrame(-1)),
        sep,
        item("Répéter", "fa-repeat", () => App.dom.repeat.click(), App.dom.repeat.classList.contains("active-loop") ? "checked" : ""),
        item("Lecture automatique de la suite", "fa-link", () => App.dom.autoplayNext.click(), App.state.autoplayNext ? "checked" : ""),
      ],
      audio: [
        ...App.audioTracks.list().map((t, i) => item(t.label, "fa-headphones", () => App.audioTracks.select(i), t.enabled ? "checked" : "")),
        (App.audioTracks.list().length ? sep : null),
        item("Muet", "fa-volume-xmark", () => App.dom.mute.click(), el().muted ? "checked" : ""),
        item("Volume +5", "fa-volume-high", () => { App.dom.volume.value = Math.min(100, Number(App.dom.volume.value) + 5); App.dom.volume.oninput(); }),
        item("Volume -5", "fa-volume-low", () => { App.dom.volume.value = Math.max(0, Number(App.dom.volume.value) - 5); App.dom.volume.oninput(); }),
      ].filter(Boolean),
      video: [
        item("Réglages image (luminosité, contraste…)", "fa-sliders", () => App.settings.open("video")),
        item("Miroir horizontal", "fa-left-right", () => App.filters.toggleMirrorH(), App.state.mirrorH ? "checked" : ""),
        item("Miroir vertical", "fa-up-down", () => App.filters.toggleMirrorV(), App.state.mirrorV ? "checked" : ""),
        item("Rotation 90°", "fa-rotate", () => App.filters.rotate90()),
        sep,
        item("Réinitialiser les réglages", "fa-arrow-rotate-left", () => App.filters.reset()),
        sep,
        item("Capture d'écran", "fa-camera", () => App.capture.screenshot()),
        item("Image dans l'image", "fa-clone", () => App.dom.pip.click()),
      ],
      soustitres: [
        item("Ajouter un fichier local…", "fa-file-lines", () => App.subtitles.addFromLocalFile()),
        item("Ajouter depuis une URL…", "fa-link", () => App.subtitles.addFromUrlPrompt()),
        item("Désactiver les sous-titres", "fa-ban", () => App.subtitles.disableAll()),
        sep,
        item("Style des sous-titres…", "fa-font", () => App.settings.open("subtitles")),
      ],
      outils: [
        item("Informations média", "fa-circle-info", () => App.mediainfo.show()),
        item("Ajouter un marque-page", "fa-bookmark", () => App.library.addBookmarkAtCurrentTime()),
        item("Enregistrer un extrait audio…", "fa-scissors", () => App.capture.recordAudioClipPrompt()),
        sep,
        item("Télécommande (smartphone)…", "fa-mobile-screen-button", () => App.settings.open("remote")),
        sep,
        item("Paramètres…", "fa-gear", () => App.settings.open()),
        item("À propos…", "fa-circle-question", () => App.settings.open("about")),
      ],
      parametres: [
        item("Général", "fa-gear", () => App.settings.open("general")),
        item("Sous-titres", "fa-font", () => App.settings.open("subtitles")),
        item("Télécommande", "fa-mobile-screen-button", () => App.settings.open("remote")),
        item("Mises à jour & À propos", "fa-circle-info", () => App.settings.open("about")),
      ],
    };
  }

  let openMenuKey = null;

  function closeAll() { App.dom.dropdownLayer.innerHTML = ""; document.querySelectorAll(".menu-btn.open").forEach((b) => b.classList.remove("open")); openMenuKey = null; }

  function toggle(key, btn) {
    if (openMenuKey === key) { closeAll(); return; }
    closeAll();
    openMenuKey = key;
    btn.classList.add("open");

    const list = menus()[key] || [];
    const dd = document.createElement("div");
    dd.className = "dropdown";
    dd.style.left = btn.offsetLeft + "px";
    dd.innerHTML = list.map((it) => it && it.sep
      ? '<div class="dropdown-sep"></div>'
      : `<button class="dropdown-item ${it.extra}"><span><i class="fa-solid ${it.icon} leading"></i> ${App.util.escapeHtml(it.label)}</span></button>`
    ).join("");

    let i = 0;
    dd.querySelectorAll(".dropdown-item").forEach((btnEl) => {
      while (list[i] && list[i].sep) i++;
      const entry = list[i++];
      if (entry) btnEl.onclick = () => { closeAll(); entry.onClick(); };
    });

    App.dom.dropdownLayer.appendChild(dd);
  }

  function bind() {
    document.querySelectorAll(".menu-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(btn.dataset.menu, btn); });
    });
    document.addEventListener("click", closeAll);
  }

  return { bind, closeAll };
})();
