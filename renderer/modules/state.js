window.App = window.App || {};

App.dom = {
  video: document.getElementById("video"),
  audio: document.getElementById("audio"),
  videoWrap: document.getElementById("video-wrap"),
  emptyState: document.getElementById("empty-state"),
  topbar: document.getElementById("topbar"),
  filename: document.getElementById("filename"),
  convertingOverlay: document.getElementById("converting-overlay"),
  stage: document.getElementById("stage"),

  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),

  playPause: document.getElementById("playPause"),
  stop: document.getElementById("stop"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  back10: document.getElementById("back10"),
  forward10: document.getElementById("forward10"),
  frameBack: document.getElementById("frameBack"),
  frameForward: document.getElementById("frameForward"),
  progress: document.getElementById("progress"),
  currentTime: document.getElementById("currentTime"),
  duration: document.getElementById("duration"),
  volume: document.getElementById("volume"),
  mute: document.getElementById("mute"),
  speed: document.getElementById("speed"),
  autoplayNext: document.getElementById("autoplayNext"),
  repeat: document.getElementById("repeat"),
  pip: document.getElementById("pip"),
  fullscreen: document.getElementById("fullscreen"),
  alwaysOnTopBtn: document.getElementById("alwaysOnTopBtn"),
  screenshotBtn: document.getElementById("screenshotBtn"),
  chapterSelect: document.getElementById("chapterSelect"),
  chaptersTrack: document.getElementById("chapters-track"),
  bookmarksTrack: document.getElementById("bookmarks-track"),
  remoteIndicator: document.getElementById("remoteIndicator"),

  playlistList: document.getElementById("playlist-list"),
  playlistEmpty: document.getElementById("playlist-empty"),
  historyList: document.getElementById("history-list"),
  historyEmpty: document.getElementById("history-empty"),
  bookmarkList: document.getElementById("bookmark-list"),
  bookmarksEmpty: document.getElementById("bookmarks-empty"),
  notesList: document.getElementById("notes-list"),
  noteInput: document.getElementById("noteInput"),

  modalLayer: document.getElementById("modal-layer"),
  dropdownLayer: document.getElementById("dropdown-layer"),
};

App.state = {
  mode: null,              // "video" | "audio"
  currentPath: null,
  currentType: null,       // "local" | "hls" | "dash" | "rtsp" | "iptv"
  currentTitle: null,
  library: { videoPlaylist: [], audioPlaylist: [], history: [], bookmarks: [], notes: [], playlists: [], podcasts: [], stats: {} },
  activePlaylistType: "video",
  autoplayNext: true,
  pendingResume: 0,
  resumeHandled: false,
  rtspSessionId: null,
  hls: null,
  dash: null,
  chapters: [],
  subtitleTracks: [], // { label, kind: 'file'|'url', src }
  audioTrackCount: 1,
  mirrorH: false,
  mirrorV: false,
  rotation: 0,
  zoom: 1,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  filters: { brightness: 100, contrast: 100, saturate: 100, gamma: 100 },
  frameStep: 1 / 30,       // approximation utilisée pour l'avance image par image
  settings: null,
  remoteStatus: { running: false },
};

App.el = (type) => (type === "audio" ? App.dom.audio : App.dom.video);
App.activeEl = () => App.el(App.state.mode || "video");
