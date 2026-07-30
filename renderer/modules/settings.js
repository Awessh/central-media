window.App = window.App || {};

App.settings = (() => {
  const { state, util } = App;
  const api = window.playerAPI;

  const TABS = [
    { key: "general", label: "Général" },
    { key: "video", label: "Réglages image" },
    { key: "subtitles", label: "Sous-titres" },
    { key: "remote", label: "Télécommande" },
    { key: "about", label: "À propos" },
  ];

  function open(initialTab = "general") {
    App.modal.open({
      title: "Paramètres",
      width: 560,
      body: `
        <div class="settings-tabs" id="settingsTabs" style="margin:-16px -18px 0"></div>
        <div id="settingsBody" style="padding-top:14px"></div>`,
      onMount(root) {
        const tabsEl = root.querySelector("#settingsTabs");
        tabsEl.innerHTML = TABS.map((t) => `<button class="settings-tab" data-tab="${t.key}">${t.label}</button>`).join("");
        const bodyEl = root.querySelector("#settingsBody");

        function select(key) {
          tabsEl.querySelectorAll(".settings-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === key));
          bodyEl.innerHTML = renderTab(key);
          wireTab(key, bodyEl);
        }
        tabsEl.querySelectorAll(".settings-tab").forEach((b) => (b.onclick = () => select(b.dataset.tab)));
        select(initialTab);
      },
    });
  }

  function renderTab(key) {
    if (key === "general") return `
      <div class="settings-section">
        <h3>Lecture</h3>
        <div class="settings-row"><label>Volume par défaut</label><input type="range" id="stVolume" min="0" max="100" value="${state.settings.defaultVolume}"></div>
        <div class="settings-row"><label>Lecture automatique de la suite</label><input type="checkbox" id="stAutoplay" ${state.settings.autoplayNext ? "checked" : ""}></div>
      </div>`;

    if (key === "video") return `
      <div class="settings-section">
        <h3>Réglages image</h3>
        ${filterRow("brightness", "Luminosité", state.filters.brightness, 0, 200)}
        ${filterRow("contrast", "Contraste", state.filters.contrast, 0, 200)}
        ${filterRow("saturate", "Saturation", state.filters.saturate, 0, 200)}
        ${filterRow("gamma", "Gamma", state.filters.gamma, 20, 300)}
        <div class="settings-row"><label>Zoom</label><input type="range" id="fZoom" min="20" max="400" value="${state.zoom * 100}"></div>
        <div class="settings-row"><button class="btn" id="fMirrorH">Miroir horizontal</button><button class="btn" id="fMirrorV">Miroir vertical</button><button class="btn" id="fRotate">Rotation 90°</button></div>
        <h3>Recadrage (%)</h3>
        <div class="settings-row"><label>Haut</label><input type="range" id="cTop" min="0" max="45" value="${state.crop.top}"></div>
        <div class="settings-row"><label>Bas</label><input type="range" id="cBottom" min="0" max="45" value="${state.crop.bottom}"></div>
        <div class="settings-row"><label>Gauche</label><input type="range" id="cLeft" min="0" max="45" value="${state.crop.left}"></div>
        <div class="settings-row"><label>Droite</label><input type="range" id="cRight" min="0" max="45" value="${state.crop.right}"></div>
        <div class="settings-row"><button class="btn" id="fReset">Réinitialiser tous les réglages</button></div>
      </div>`;

    if (key === "subtitles") return `
      <div class="settings-section">
        <h3>Style</h3>
        <div class="settings-row"><label>Taille du texte</label><input type="range" id="subSize" min="12" max="48" value="${state.settings.subtitleStyle.fontSize}"></div>
        <div class="settings-row"><label>Couleur du texte</label><input type="color" id="subColor" value="${toHex(state.settings.subtitleStyle.color)}"></div>
        <h3>Ajout</h3>
        <div class="settings-row"><button class="btn" id="subAddFile">Fichier local…</button><button class="btn" id="subAddUrl">Depuis une URL…</button></div>
      </div>`;

    if (key === "remote") return `
      <div class="settings-section" id="remoteSection">
        <h3>Télécommande smartphone</h3>
        <p style="color:var(--text-dim);font-size:12.5px;margin:0">
          Lance un petit serveur local pour piloter le lecteur depuis ton téléphone (même réseau Wi-Fi).
          Une appli Android dédiée sera proposée plus tard ; en attendant, scanne le QR code pour ouvrir la télécommande web.
        </p>
        <div class="settings-row"><label>Activer la télécommande</label><input type="checkbox" id="remoteToggle" ${state.remoteStatus.running ? "checked" : ""}></div>
        <div id="remoteQrHolder"></div>
      </div>`;

    if (key === "about") return App.about.render();

    return "";
  }

  function toHex(c) {
    if (c.startsWith("#")) return c;
    const m = c.match(/rgba?\((\d+),(\d+),(\d+)/);
    if (!m) return "#ffffff";
    return "#" + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  }

  function filterRow(id, label, value, min, max) {
    return `<div class="filter-row"><div class="filter-label"><span>${label}</span><span id="${id}Val">${value}%</span></div><input type="range" id="f_${id}" min="${min}" max="${max}" value="${value}"></div>`;
  }

  function wireTab(key, root) {
    if (key === "general") {
      root.querySelector("#stVolume").oninput = (e) => { App.dom.volume.value = e.target.value; App.dom.volume.oninput(); };
      root.querySelector("#stAutoplay").onchange = (e) => { state.autoplayNext = e.target.checked; App.dom.autoplayNext.classList.toggle("active", state.autoplayNext); api.setSettings({ autoplayNext: e.target.checked }); };
    }

    if (key === "video") {
      ["brightness", "contrast", "saturate", "gamma"].forEach((id) => {
        root.querySelector("#f_" + id).oninput = (e) => { App.filters.set(id, Number(e.target.value)); root.querySelector("#" + id + "Val").textContent = e.target.value + "%"; };
      });
      root.querySelector("#fZoom").oninput = (e) => App.filters.setZoom(Number(e.target.value) / 100);
      root.querySelector("#fMirrorH").onclick = () => App.filters.toggleMirrorH();
      root.querySelector("#fMirrorV").onclick = () => App.filters.toggleMirrorV();
      root.querySelector("#fRotate").onclick = () => App.filters.rotate90();
      root.querySelector("#fReset").onclick = () => { App.filters.reset(); App.modal.closeAll(); open("video"); };
      ["Top", "Bottom", "Left", "Right"].forEach((side) => {
        root.querySelector("#c" + side).oninput = (e) => App.filters.setCrop(side.toLowerCase(), Number(e.target.value));
      });
    }

    if (key === "subtitles") {
      root.querySelector("#subSize").oninput = (e) => { state.settings.subtitleStyle.fontSize = Number(e.target.value); api.setSettings({ subtitleStyle: state.settings.subtitleStyle }); App.subtitles.applyStyle(); };
      root.querySelector("#subColor").oninput = (e) => { state.settings.subtitleStyle.color = e.target.value; api.setSettings({ subtitleStyle: state.settings.subtitleStyle }); App.subtitles.applyStyle(); };
      root.querySelector("#subAddFile").onclick = () => App.subtitles.addFromLocalFile();
      root.querySelector("#subAddUrl").onclick = () => App.subtitles.addFromUrlPrompt();
    }

    if (key === "remote") {
      renderRemoteStatus(root);
      root.querySelector("#remoteToggle").onchange = async (e) => {
        if (e.target.checked) { state.remoteStatus = await api.startRemote(); } else { await api.stopRemote(); state.remoteStatus = { running: false }; }
        App.remote.updateIndicator();
        renderRemoteStatus(root);
      };
    }

    if (key === "about") App.about.wire(root);
  }

  function renderRemoteStatus(root) {
    const holder = root.querySelector("#remoteQrHolder");
    if (!state.remoteStatus.running) { holder.innerHTML = ""; return; }
    holder.innerHTML = `
      <div class="qr-box">
        ${state.remoteStatus.qrDataUrl ? `<img src="${state.remoteStatus.qrDataUrl}">` : ""}
        <div class="qr-url">${state.remoteStatus.url}</div>
      </div>`;
  }

  return { open };
})();
