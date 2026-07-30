window.App = window.App || {};

App.keyboard = (() => {
  function bind() {
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const el = App.activeEl();

      switch (e.code) {
        case "Space": case "KeyK": e.preventDefault(); App.player.togglePlay(); break;
        case "ArrowLeft": App.player.seekBy(-5); break;
        case "ArrowRight": App.player.seekBy(5); break;
        case "ArrowUp": e.preventDefault(); setVolume(el.volume * 100 + 5); break;
        case "ArrowDown": e.preventDefault(); setVolume(el.volume * 100 - 5); break;
        case "KeyM": App.dom.mute.click(); break;
        case "KeyF": App.dom.fullscreen.click(); break;
        case "KeyP": App.dom.pip.click(); break;
        case "KeyN": App.player.playNext(); break;
        case "KeyB": App.library.addBookmarkAtCurrentTime(); break;
        case "KeyS": App.capture.screenshot(); break;
        case "KeyI": App.mediainfo.show(); break;
        case "KeyR": App.dom.repeat.click(); break;
        case "Comma": App.player.stepFrame(-1); break;
        case "Period": App.player.stepFrame(1); break;
        case "BracketLeft": App.chapters.jumpToPrevious(); break;
        case "BracketRight": App.chapters.jumpToNext(); break;
        case "Digit0": case "Home": el.currentTime = 0; break;
        case "Escape": if (document.fullscreenElement) document.exitFullscreen(); break;
      }

      if (e.code === "Backspace") App.player.playPrevious();
    });
  }

  function setVolume(v) {
    v = Math.max(0, Math.min(100, v));
    App.dom.volume.value = v;
    App.activeEl().volume = v / 100;
    App.util.osd("Volume " + Math.round(v) + "%");
  }

  return { bind };
})();
