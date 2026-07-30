window.App = window.App || {};

// Lecture basique des tags ID3v2 (TIT2/TPE1/TALB/TCON/TYER/TDRC/APIC) pour
// afficher titre/artiste/album/genre/année/pochette, et affichage de
// paroles synchronisées au format .lrc (recherché à côté du fichier audio,
// ou chargeable manuellement).
App.lyrics = (() => {
  let lines = [];      // [{time, text}]
  let activeIndex = -1;

  function readSynchsafe(bytes, offset) {
    return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
  }

  function parseId3(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"
    const size = readSynchsafe(bytes, 6);
    let offset = 10;
    const end = Math.min(bytes.length, 10 + size);
    const tags = {};

    while (offset < end - 10) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
      const frameStart = offset + 10;
      if (frameSize <= 0 || frameStart + frameSize > bytes.length) break;

      if (["TIT2", "TPE1", "TALB", "TCON", "TYER", "TDRC"].includes(id)) {
        const enc = bytes[frameStart];
        const raw = bytes.slice(frameStart + 1, frameStart + frameSize);
        tags[id] = decodeText(raw, enc).replace(/\u0000+$/, "");
      } else if (id === "APIC") {
        let p = frameStart + 1;
        while (bytes[p] !== 0 && p < frameStart + frameSize) p++; // mime type
        p += 1;
        const pictureType = bytes[p]; p += 1;
        while (bytes[p] !== 0 && p < frameStart + frameSize) p++; // description
        p += 1;
        const imgBytes = bytes.slice(p, frameStart + frameSize);
        const mime = "image/jpeg";
        tags.APIC = URL.createObjectURL(new Blob([imgBytes], { type: mime }));
      }
      offset = frameStart + frameSize;
    }
    return tags;
  }

  function decodeText(bytes, enc) {
    try {
      if (enc === 1 || enc === 2) return new TextDecoder("utf-16").decode(bytes);
      return new TextDecoder("iso-8859-1").decode(bytes);
    } catch { return ""; }
  }

  async function loadForFile(filePath) {
    resetView();
    try {
      const res = await fetch(App.util.isStreamUrl(filePath) ? filePath : "file://" + encodeURI(filePath).replace(/#/g, "%23"));
      const buf = await res.arrayBuffer();
      const tags = parseId3(buf.slice(0, Math.min(buf.byteLength, 512 * 1024)));
      if (tags) applyTags(tags, filePath);
      else document.getElementById("lyrics-title").textContent = App.util.basename(filePath);
    } catch {
      document.getElementById("lyrics-title").textContent = App.util.basename(filePath);
    }

    tryAutoLoadLrc(filePath);
  }

  function applyTags(tags, filePath) {
    document.getElementById("lyrics-title").textContent = tags.TIT2 || App.util.basename(filePath);
    document.getElementById("lyrics-artist").textContent = tags.TPE1 || "";
    document.getElementById("lyrics-album-year").textContent = [tags.TALB, tags.TYER || tags.TDRC, tags.TCON].filter(Boolean).join(" • ");
    const cover = document.getElementById("lyrics-cover");
    cover.innerHTML = tags.APIC ? `<img src="${tags.APIC}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">` : '<i class="fa-solid fa-compact-disc"></i>';
  }

  function resetView() {
    lines = []; activeIndex = -1;
    document.getElementById("lyrics-lines").innerHTML = "";
    document.getElementById("lyrics-title").textContent = "—";
    document.getElementById("lyrics-artist").textContent = "—";
    document.getElementById("lyrics-album-year").textContent = "";
    document.getElementById("lyrics-cover").innerHTML = '<i class="fa-solid fa-compact-disc"></i>';
  }

  function parseLrc(text) {
    const out = [];
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (m) out.push({ time: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
    });
    return out.sort((a, b) => a.time - b.time);
  }

  async function tryAutoLoadLrc(filePath) {
    if (App.util.isStreamUrl(filePath)) return;
    const lrcPath = filePath.replace(/\.[a-z0-9]+$/i, ".lrc");
    try {
      const res = await fetch("file://" + encodeURI(lrcPath).replace(/#/g, "%23"));
      if (res.ok) setLines(await res.text());
    } catch { /* pas de .lrc à côté du fichier, pas grave */ }
  }

  async function loadFromFilePicker() {
    const res = await window.playerAPI.chooseLyricsFile();
    if (!res) return;
    const raw = await (await fetch(res.url)).text();
    setLines(raw);
  }

  function setLines(raw) {
    lines = parseLrc(raw);
    activeIndex = -1;
    document.getElementById("lyrics-lines").innerHTML = lines.map((l, i) => `<div class="lyric-line" data-i="${i}">${App.util.escapeHtml(l.text)}</div>`).join("");
  }

  function sync(currentTime) {
    if (!lines.length) return;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].time <= currentTime) idx = i; else break; }
    if (idx === activeIndex) return;
    activeIndex = idx;
    document.querySelectorAll(".lyric-line").forEach((el) => el.classList.remove("active"));
    if (idx >= 0) {
      const el = document.querySelector(`.lyric-line[data-i="${idx}"]`);
      if (el) { el.classList.add("active"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }
  }

  function bind() { document.getElementById("loadLyricsFile").onclick = loadFromFilePicker; }

  return { loadForFile, sync, bind, resetView };
})();
