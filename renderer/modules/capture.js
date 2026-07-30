window.App = window.App || {};

App.capture = (() => {
  const { dom, state, util } = App;

  function screenshot() {
    if (state.mode !== "video" || !dom.video.videoWidth) { util.toast("Aucune vidéo en cours de lecture."); return; }
    const canvas = document.getElementById("capture-canvas");
    canvas.width = dom.video.videoWidth;
    canvas.height = dom.video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(dom.video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    const name = `capture-${util.basename(state.currentTitle || "media").replace(/\.[a-z0-9]+$/i, "")}-${util.formatTime(dom.video.currentTime).replace(/:/g, "-")}.png`;
    window.playerAPI.saveScreenshot(dataUrl, name).then((path) => { if (path) util.toast("Capture enregistrée : " + path); });
  }

  function recordAudioClipPrompt() {
    if (state.currentType !== "local" || !state.currentPath) { util.toast("Extraction audio disponible uniquement pour un fichier local."); return; }
    const el = App.activeEl();
    const start = Math.max(0, Math.floor(el.currentTime));

    App.modal.open({
      title: "Enregistrer un extrait audio",
      body: `
        <div class="settings-row"><label>Début (s)</label><input type="number" id="clipStart" value="${start}" min="0" style="width:100px"></div>
        <div class="settings-row"><label>Durée (s)</label><input type="number" id="clipDur" value="15" min="1" max="300" style="width:100px"></div>`,
      footer: `<button class="btn" data-close>Annuler</button><button class="btn primary" id="clipGo">Extraire</button>`,
      onMount(root) {
        root.querySelector("#clipGo").onclick = async () => {
          const s = Number(root.querySelector("#clipStart").value);
          const d = Number(root.querySelector("#clipDur").value);
          App.modal.closeAll();
          util.toast("Extraction en cours…");
          const res = await window.playerAPI.recordAudioClip(state.currentPath, s, d);
          if (res && res.path) util.toast("Extrait enregistré : " + res.path);
          else util.toast("Échec de l'extraction : " + (res && res.message));
        };
      },
    });
  }

  function bind() { document.getElementById("screenshotBtn").onclick = screenshot; }

  return { screenshot, recordAudioClipPrompt, bind };
})();
