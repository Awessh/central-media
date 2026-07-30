window.App = window.App || {};

App.playlist = (() => {
  const { dom, state, util } = App;
  const api = window.playerAPI;

  function currentList() { return state.activePlaylistType === "audio" ? state.library.audioPlaylist : state.library.videoPlaylist; }

  function thumbHtml(item) {
    if (item.thumbnail) return `<img class="thumb" src="${item.thumbnail}">`;
    return `<div class="thumb-placeholder"><i class="fa-solid ${state.activePlaylistType === "audio" ? "fa-music" : "fa-film"}"></i></div>`;
  }

  function render() {
    const list = currentList();
    dom.playlistEmpty.classList.toggle("hidden", list.length > 0);
    dom.playlistList.innerHTML = list.map((item) => `
      <li class="media-item${item.path === state.currentPath ? " playing" : ""}" draggable="true" data-id="${item.id}" data-path="${encodeURIComponent(item.path)}">
        ${thumbHtml(item)}
        <div class="info">
          <div class="title">${util.escapeHtml(item.title)}</div>
          <div class="meta">${item.path === state.currentPath ? "▶ En cours de lecture" : "Dans la playlist"}</div>
        </div>
        <button class="remove" title="Retirer"><i class="fa-solid fa-xmark"></i></button>
      </li>`).join("");
    attachEvents();
  }

  function attachEvents() {
    let dragSrc = null;
    dom.playlistList.querySelectorAll(".media-item").forEach((li) => {
      li.addEventListener("click", (e) => { if (!e.target.closest(".remove")) App.player.playPath(decodeURIComponent(li.dataset.path)); });
      li.querySelector(".remove").addEventListener("click", async (e) => {
        e.stopPropagation();
        const list = await api.removeFromPlaylist(state.activePlaylistType, li.dataset.id);
        state.library[state.activePlaylistType === "audio" ? "audioPlaylist" : "videoPlaylist"] = list;
        render();
      });

      li.addEventListener("dragstart", () => { dragSrc = li.dataset.id; li.classList.add("dragging"); });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
      li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drag-over"); });
      li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
      li.addEventListener("drop", async (e) => {
        e.preventDefault();
        li.classList.remove("drag-over");
        if (!dragSrc || dragSrc === li.dataset.id) return;
        const ids = Array.from(dom.playlistList.querySelectorAll(".media-item")).map((el) => el.dataset.id);
        const from = ids.indexOf(dragSrc), to = ids.indexOf(li.dataset.id);
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        const list = await api.reorderPlaylist(state.activePlaylistType, ids);
        state.library[state.activePlaylistType === "audio" ? "audioPlaylist" : "videoPlaylist"] = list;
        render();
      });
    });
  }

  async function addFiles() {
    const res = await api.chooseMediaFile(state.activePlaylistType);
    if (res && res.paths && res.paths.length) { await App.library.refreshAndRender(); }
  }

  async function addFolder() {
    const res = await api.chooseMediaFolder(state.activePlaylistType);
    if (res && res.paths && res.paths.length) { await App.library.refreshAndRender(); }
  }

  async function clearAll() {
    await api.clearPlaylist(state.activePlaylistType);
    state.library[state.activePlaylistType === "audio" ? "audioPlaylist" : "videoPlaylist"] = [];
    render();
  }

  async function loadFromFile() {
    const res = await api.importPlaylistFile();
    if (!res) return;
    if (res.error) { util.toast("Import impossible : " + res.message); return; }
    const paths = res.items.map((it) => it.path);
    const addRes = await api.addMediaPaths(state.activePlaylistType, paths);
    await App.library.refreshAndRender();
    if (addRes.added && addRes.added.length) App.player.playPath(addRes.added[0]);
    util.toast(`Playlist "${res.name}" importée (${res.items.length} éléments).`);
  }

  async function saveToFile() {
    const list = currentList();
    if (!list.length) { util.toast("Playlist vide."); return; }
    const res = await api.exportPlaylistFile(list.map((it) => ({ path: it.path, title: it.title })), "playlist.m3u8");
    if (res && res.path) util.toast("Playlist exportée : " + res.path);
  }

  function bind() {
    document.getElementById("addFiles").onclick = addFiles;
    document.getElementById("loadFolder").onclick = addFolder;
    document.getElementById("clearPlaylist").onclick = clearAll;
    document.getElementById("loadPlaylistFile").onclick = loadFromFile;
    document.getElementById("savePlaylistFile").onclick = saveToFile;
  }

  return { render, bind, currentList };
})();
