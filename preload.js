"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const listener = (_e, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("playerAPI", {
  // Fichiers / dossiers (le type vidéo/audio est déterminé par extension
  // côté main process, plus besoin de le préciser depuis le renderer)
  chooseMediaFile: () => ipcRenderer.invoke("dialog:choose-media-file"),
  chooseMediaFolder: () => ipcRenderer.invoke("dialog:choose-media-folder"),
  addMediaPaths: (paths) => ipcRenderer.invoke("media:add-paths", { paths }),
  removeFromPlaylist: (type, id) => ipcRenderer.invoke("media:remove-from-playlist", { type, id }),
  reorderPlaylist: (type, orderedIds) => ipcRenderer.invoke("media:reorder-playlist", { type, orderedIds }),
  clearPlaylist: (type) => ipcRenderer.invoke("media:clear-playlist", type),
  getMediaLibrary: () => ipcRenderer.invoke("media:get-library"),
  playMediaItem: (type, filePath) => ipcRenderer.invoke("media:play-item", { type, filePath }),
  saveMediaPosition: (type, filePath, position, duration) => ipcRenderer.invoke("media:save-position", { type, filePath, position, duration }),
  getMediaInfo: (filePath) => ipcRenderer.invoke("media:get-info", filePath),
  removeHistory: (id) => ipcRenderer.invoke("media:remove-history", id),
  clearHistory: () => ipcRenderer.invoke("media:clear-history"),

  // Marque-pages / notes
  addBookmark: (filePath, time, label) => ipcRenderer.invoke("bookmarks:add", { filePath, time, label }),
  removeBookmark: (id) => ipcRenderer.invoke("bookmarks:remove", id),
  listBookmarks: (filePath) => ipcRenderer.invoke("bookmarks:list", filePath),
  addNote: (filePath, time, text) => ipcRenderer.invoke("notes:add", { filePath, time, text }),
  removeNote: (id) => ipcRenderer.invoke("notes:remove", id),
  listNotes: (filePath) => ipcRenderer.invoke("notes:list", filePath),
  getStats: () => ipcRenderer.invoke("stats:get"),

  // Playlists nommées + import/export
  savePlaylist: (name, type, items) => ipcRenderer.invoke("playlists:save", { name, type, items }),
  listPlaylists: () => ipcRenderer.invoke("playlists:list"),
  deletePlaylist: (id) => ipcRenderer.invoke("playlists:delete", id),
  importPlaylistFile: () => ipcRenderer.invoke("playlists:import-file"),
  exportPlaylistFile: (items, defaultName) => ipcRenderer.invoke("playlists:export-file", { items, defaultName }),

  // Sous-titres
  chooseSubtitleFile: () => ipcRenderer.invoke("subtitles:choose-file"),

  // Paroles
  chooseLyricsFile: () => ipcRenderer.invoke("lyrics:choose-file"),

  // RTSP
  startRtsp: (url) => ipcRenderer.invoke("rtsp:start", url),
  stopRtsp: (id) => ipcRenderer.invoke("rtsp:stop", id),

  // Capture
  saveScreenshot: (dataUrl, suggestedName) => ipcRenderer.invoke("capture:save-screenshot", { dataUrl, suggestedName }),
  recordAudioClip: (filePath, startSec, durationSec) => ipcRenderer.invoke("capture:record-audio-clip", { filePath, startSec, durationSec }),

  // Podcasts
  savePodcast: (podcast) => ipcRenderer.invoke("podcasts:save", podcast),
  listPodcasts: () => ipcRenderer.invoke("podcasts:list"),
  removePodcast: (id) => ipcRenderer.invoke("podcasts:remove", id),

  // Paramètres
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),

  // Télécommande
  startRemote: () => ipcRenderer.invoke("remote:start"),
  stopRemote: () => ipcRenderer.invoke("remote:stop"),
  pushRemoteState: (state) => ipcRenderer.invoke("remote:push-state", state),
  getRemoteStatus: () => ipcRenderer.invoke("remote:get-status"),
  onRemoteCommand: (cb) => on("remote:command", cb),

  // Menu contextuel
  openContextMenu: (ctx) => ipcRenderer.send("ctxmenu:open", ctx),
  onContextMenuAction: (cb) => on("ctxmenu:action", cb),

  // Mises à jour
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  getUpdateStatus: () => ipcRenderer.invoke("app:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  onUpdateStatus: (cb) => on("update:status", cb),

  // Divers
  validateStreamUrl: (url) => ipcRenderer.invoke("stream:validate-url", url),
  showInFolder: (filePath) => ipcRenderer.invoke("shell:show-in-folder", filePath),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),

  // Événements venant du processus principal
  onThumbnailReady: (cb) => on("media:thumbnail-ready", cb),
  onMediaAddedExternally: (cb) => on("media:added-externally", cb),

  // Intégration au menu contextuel de l'Explorateur Windows
  getExplorerIntegrationStatus: () => ipcRenderer.invoke("explorer:get-status"),
  enableExplorerIntegration: () => ipcRenderer.invoke("explorer:enable"),
  disableExplorerIntegration: () => ipcRenderer.invoke("explorer:disable"),
});
