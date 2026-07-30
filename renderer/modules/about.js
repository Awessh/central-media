window.App = window.App || {};

App.about = (() => {
  const api = window.playerAPI;
  let version = "…";
  let status = { state: "idle" };

  function render() {
    return `
      <div class="settings-section">
        <div class="about-header">
          <div class="about-logo"><i class="fa-solid fa-photo-film"></i></div>
          <div>
            <div style="font-weight:600;font-size:15px">Media Player</div>
            <div class="about-version" id="aboutVersion">Version ${version}</div>
          </div>
        </div>

        <h3>Mises à jour</h3>
        <div class="update-status" id="updateStatus">${statusLabel(status)}</div>
        <div class="settings-row">
          <button class="btn" id="checkUpdateBtn"><i class="fa-solid fa-rotate"></i> Vérifier les mises à jour</button>
          <button class="btn primary hidden" id="installUpdateBtn">Redémarrer et installer</button>
        </div>

        <h3>À propos</h3>
        <p style="color:var(--text-dim);font-size:12.5px;line-height:1.6;margin:0">
          Lecteur vidéo & audio autonome — streaming (HLS/DASH/IPTV/RTSP), podcasts, playlists,
          sous-titres, réglages image, marque-pages, notes synchronisées, historique, statistiques,
          fonctionnalités musicales et télécommande smartphone.
        </p>
      </div>`;
  }

  function statusLabel(s) {
    switch (s.state) {
      case "checking": return "Vérification des mises à jour…";
      case "downloading": return `Téléchargement en cours${s.info && s.info.percent != null ? " — " + s.info.percent + "%" : ""}…`;
      case "downloaded": return `Mise à jour ${s.version || ""} prête à installer.`;
      case "not-available": return "Vous utilisez la dernière version.";
      case "unsupported": return "Mises à jour indisponibles (mode développement ou build non packagée).";
      case "error": return "Erreur : " + (s.info && s.info.message ? s.info.message : "inconnue");
      default: return "—";
    }
  }

  async function wire(root) {
    version = await api.getAppVersion();
    status = await api.getUpdateStatus();
    root.querySelector("#aboutVersion").textContent = "Version " + version;
    refresh(root);

    root.querySelector("#checkUpdateBtn").onclick = async () => { status = await api.checkForUpdates(); refresh(root); };
    root.querySelector("#installUpdateBtn").onclick = () => api.installUpdate();

    api.onUpdateStatus((s) => { status = s; refresh(root); });
  }

  function refresh(root) {
    const el = root.querySelector("#updateStatus");
    if (el) el.textContent = statusLabel(status);
    const installBtn = root.querySelector("#installUpdateBtn");
    if (installBtn) installBtn.classList.toggle("hidden", status.state !== "downloaded");
  }

  return { render, wire };
})();
