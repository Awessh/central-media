window.App = window.App || {};

App.subtitles = (() => {
  const { state, dom } = App;
  let trackEls = [];

  function srtToVtt(text) {
    let body = text.replace(/\r+/g, "");
    if (!/^WEBVTT/.test(body.trim())) {
      body = body
        .replace(/^\d+\s*$/gm, "")
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
      body = "WEBVTT\n\n" + body.trim() + "\n";
    }
    return body;
  }

  function reset() {
    trackEls.forEach((t) => t.remove());
    trackEls = [];
    state.subtitleTracks = [];
    applyStyle();
  }

  async function addFromLocalFile() {
    const res = await window.playerAPI.chooseSubtitleFile();
    if (!res) return;
    const ext = App.util.extname(res.path);
    if (ext === "ass" || ext === "ssa" || ext === "sub") {
      App.util.toast("Format " + ext.toUpperCase() + " non converti automatiquement — préfère .srt ou .vtt.");
      return;
    }
    const raw = await (await fetch(res.url)).text();
    addTrackFromText(raw, res.name, "fichier");
  }

  function addFromUrlPrompt() {
    App.modal.open({
      title: "Ajouter des sous-titres depuis une URL",
      body: `<input type="text" id="subUrl" placeholder="https://.../sous-titres.vtt ou .srt" style="width:100%;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:9px;color:var(--text)">`,
      footer: `<button class="btn" data-close>Annuler</button><button class="btn primary" id="subGo">Ajouter</button>`,
      onMount(root) {
        const input = root.querySelector("#subUrl");
        input.focus();
        root.querySelector("#subGo").onclick = async () => {
          const url = input.value.trim();
          if (!url) return;
          App.modal.closeAll();
          try {
            const raw = await (await fetch(url)).text();
            addTrackFromText(raw, App.util.basename(url), "en ligne");
          } catch (e) { App.util.toast("Impossible de charger ces sous-titres."); }
        };
      },
    });
  }

  function addTrackFromText(raw, label, kind) {
    const vtt = srtToVtt(raw);
    const blob = new Blob([vtt], { type: "text/vtt" });
    const src = URL.createObjectURL(blob);

    const el = document.createElement("track");
    el.kind = "subtitles";
    el.label = `${label} (${kind})`;
    el.srclang = "fr";
    el.src = src;
    dom.video.appendChild(el);
    trackEls.push(el);
    state.subtitleTracks.push({ label: el.label });

    // Active automatiquement la piste qui vient d'être ajoutée.
    setTimeout(() => selectTrack(state.subtitleTracks.length - 1), 50);
    App.util.toast("Sous-titres ajoutés : " + label);
  }

  function selectTrack(index) {
    const tt = dom.video.textTracks;
    for (let i = 0; i < tt.length; i++) tt[i].mode = i === index ? "showing" : "disabled";
  }

  function disableAll() {
    const tt = dom.video.textTracks;
    for (let i = 0; i < tt.length; i++) tt[i].mode = "disabled";
  }

  function applyStyle() {
    const s = (state.settings && state.settings.subtitleStyle) || { fontSize: 22, color: "#ffffff", bg: "rgba(0,0,0,0.6)" };
    const styleEl = document.getElementById("subtitle-style") || document.createElement("style");
    styleEl.id = "subtitle-style";
    styleEl.textContent = `
      video::cue {
        font-size: ${s.fontSize}px;
        color: ${s.color};
        background: ${s.bg};
      }`;
    document.head.appendChild(styleEl);
  }

  return { reset, addFromLocalFile, addFromUrlPrompt, selectTrack, disableAll, applyStyle };
})();
