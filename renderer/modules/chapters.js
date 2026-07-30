window.App = window.App || {};

// Les chapitres embarqués dans certains conteneurs (MP4/MKV) sont exposés
// par Chromium comme une TextTrack de kind "chapters" quand ils existent.
// On les récupère pour peupler le sélecteur de navigation rapide de la
// barre de contrôle. À défaut, le sélecteur reste masqué (aucune norme
// fiable multiplateforme pour extraire les chapitres autrement sans un
// passage ffprobe dédié, hors-scope pour un simple <video>).
App.chapters = (() => {
  const { dom, state } = App;

  function parseFromEl(el) {
    state.chapters = [];
    dom.chapterSelect.innerHTML = "";
    dom.chapterSelect.classList.add("hidden");

    const tracks = Array.from(el.textTracks || []).filter((t) => t.kind === "chapters");
    if (!tracks.length) return;

    const track = tracks[0];
    track.mode = "hidden";

    const collect = () => {
      const cues = Array.from(track.cues || []);
      if (!cues.length) return;
      state.chapters = cues.map((c) => ({ start: c.startTime, end: c.endTime, label: c.text || "" }));
      render();
    };

    if (track.cues && track.cues.length) collect();
    else track.addEventListener("load", collect);
  }

  function render() {
    dom.chapterSelect.innerHTML = state.chapters
      .map((c, i) => `<option value="${i}">${App.util.escapeHtml(c.label || "Chapitre " + (i + 1))} — ${App.util.formatTime(c.start)}</option>`)
      .join("");
    dom.chapterSelect.classList.toggle("hidden", state.chapters.length === 0);

    dom.chapterSelect.onchange = () => {
      const chap = state.chapters[Number(dom.chapterSelect.value)];
      if (chap) App.activeEl().currentTime = chap.start;
    };

    renderTrackMarks();
  }

  function renderTrackMarks() {
    const el = App.activeEl();
    if (!el.duration || !state.chapters.length) { dom.chaptersTrack.innerHTML = ""; return; }
    dom.chaptersTrack.innerHTML = state.chapters.map((c) => {
      const pct = (c.start / el.duration) * 100;
      return `<div style="position:absolute;left:${pct}%;width:1px;height:100%;background:var(--accent-2)"></div>`;
    }).join("");
  }

  function jumpToNext() {
    const el = App.activeEl();
    const next = state.chapters.find((c) => c.start > el.currentTime + 0.5);
    if (next) el.currentTime = next.start;
  }

  function jumpToPrevious() {
    const el = App.activeEl();
    const prevList = state.chapters.filter((c) => c.start < el.currentTime - 0.5);
    if (prevList.length) el.currentTime = prevList[prevList.length - 1].start;
  }

  return { parseFromEl, jumpToNext, jumpToPrevious };
})();
