window.App = window.App || {};

App.library = (() => {
  const { dom, state, util } = App;
  const api = window.playerAPI;

  async function refreshAndRender() {
    state.library = await api.getMediaLibrary();
    App.playlist.render();
    renderHistory();
    renderBookmarks();
    renderNotes();
    renderStats();
  }

  function highlightCurrent() {
    document.querySelectorAll("#playlist-list .media-item").forEach((el) => {
      const isPlaying = decodeURIComponent(el.dataset.path) === state.currentPath;
      el.classList.toggle("playing", isPlaying);
      const meta = el.querySelector(".meta");
      if (meta) meta.textContent = isPlaying ? "▶ En cours de lecture" : "Dans la playlist";
    });
  }

  function renderHistory() {
    const list = state.library.history || [];
    dom.historyEmpty.classList.toggle("hidden", list.length > 0);
    dom.historyList.innerHTML = list.map((item) => {
      const pct = item.duration ? Math.min(100, Math.round((item.position / item.duration) * 100)) : 0;
      return `
      <li class="media-item" data-path="${encodeURIComponent(item.path)}" data-type="${item.type}" data-id="${item.id}">
        <div class="thumb-placeholder"><i class="fa-solid ${item.type === "audio" ? "fa-music" : "fa-film"}"></i></div>
        <div class="info">
          <div class="title">${util.escapeHtml(item.title)}</div>
          <div class="meta">Lu il y a ${util.timeAgo(item.lastPlayedAt)}${pct ? " • " + pct + "%" : ""} • ${item.playCount || 1}x</div>
          ${pct ? `<div class="mini-progress"><div class="mini-progress-fill" style="width:${pct}%"></div></div>` : ""}
        </div>
        <button class="remove" title="Retirer"><i class="fa-solid fa-xmark"></i></button>
      </li>`;
    }).join("");

    dom.historyList.querySelectorAll(".media-item").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.closest(".remove")) return;
        App.player.playPath(decodeURIComponent(li.dataset.path), { mediaType: li.dataset.type });
      });
      li.querySelector(".remove").addEventListener("click", async (e) => {
        e.stopPropagation();
        state.library.history = await api.removeHistory(li.dataset.id);
        renderHistory();
      });
    });

    document.getElementById("clearHistory").onclick = async () => { state.library.history = await api.clearHistory(); renderHistory(); };
  }

  function renderBookmarks() {
    const list = (state.library.bookmarks || []).filter((b) => !state.currentPath || b.path === state.currentPath || true);
    dom.bookmarksEmpty.classList.toggle("hidden", list.length > 0);
    dom.bookmarkList.innerHTML = list.map((b) => `
      <li class="media-item" data-id="${b.id}" data-path="${encodeURIComponent(b.path)}" data-time="${b.time}">
        <div class="thumb-placeholder"><i class="fa-solid fa-bookmark"></i></div>
        <div class="info">
          <div class="title">${util.escapeHtml(b.label)}</div>
          <div class="meta">${util.escapeHtml(util.basename(b.path))} • ${util.formatTime(b.time)}</div>
        </div>
        <button class="remove" title="Supprimer"><i class="fa-solid fa-xmark"></i></button>
      </li>`).join("");

    dom.bookmarkList.querySelectorAll(".media-item").forEach((li) => {
      li.addEventListener("click", async (e) => {
        if (e.target.closest(".remove")) return;
        const path = decodeURIComponent(li.dataset.path);
        if (path !== state.currentPath) await App.player.playPath(path);
        App.activeEl().currentTime = Number(li.dataset.time);
      });
      li.querySelector(".remove").addEventListener("click", async (e) => {
        e.stopPropagation();
        state.library.bookmarks = await api.removeBookmark(li.dataset.id);
        renderBookmarks();
      });
    });
  }

  async function addBookmarkAtCurrentTime() {
    if (!state.currentPath) return;
    const el = App.activeEl();
    const entry = await api.addBookmark(state.currentPath, el.currentTime, null);
    state.library.bookmarks.unshift(entry);
    renderBookmarks();
    util.osd("Marque-page ajouté");
  }

  function renderNotes() {
    const list = (state.library.notes || []);
    dom.notesList.innerHTML = list.map((n) => `
      <li class="media-item" data-id="${n.id}" data-path="${encodeURIComponent(n.path)}" data-time="${n.time}">
        <div class="thumb-placeholder"><i class="fa-solid fa-note-sticky"></i></div>
        <div class="info">
          <div class="title">${util.escapeHtml(n.text)}</div>
          <div class="meta">${util.escapeHtml(util.basename(n.path))} • ${util.formatTime(n.time)}</div>
        </div>
        <button class="remove" title="Supprimer"><i class="fa-solid fa-xmark"></i></button>
      </li>`).join("");

    dom.notesList.querySelectorAll(".media-item").forEach((li) => {
      li.addEventListener("click", async (e) => {
        if (e.target.closest(".remove")) return;
        const path = decodeURIComponent(li.dataset.path);
        if (path !== state.currentPath) await App.player.playPath(path);
        App.activeEl().currentTime = Number(li.dataset.time);
      });
      li.querySelector(".remove").addEventListener("click", async (e) => {
        e.stopPropagation();
        state.library.notes = await api.removeNote(li.dataset.id);
        renderNotes();
      });
    });
  }

  async function addNoteFromInput() {
    const text = dom.noteInput.value.trim();
    if (!text || !state.currentPath) return;
    const entry = await api.addNote(state.currentPath, App.activeEl().currentTime, text);
    state.library.notes.unshift(entry);
    dom.noteInput.value = "";
    renderNotes();
  }

  async function renderStats() {
    const s = await api.getStats();
    document.getElementById("stat-watched").textContent = Math.round(s.watchedSeconds / 3600 * 10) / 10 + "h";
    document.getElementById("stat-count").textContent = s.playCount;
    const remaining = state.library.videoPlaylist.reduce((acc) => acc, 0); // durée non connue sans probe systématique
    document.getElementById("stat-remaining").textContent = state.library.videoPlaylist.length + " restant(s)";
  }

  function bind() {
    document.getElementById("addNoteBtn").onclick = addNoteFromInput;
    dom.noteInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addNoteFromInput(); });
  }

  return { refreshAndRender, highlightCurrent, renderHistory, renderBookmarks, renderNotes, renderStats, addBookmarkAtCurrentTime, bind };
})();
