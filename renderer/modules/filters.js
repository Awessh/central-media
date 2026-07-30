window.App = window.App || {};

// Réglages image appliqués au <video> via CSS filter (+ un filtre SVG pour
// le gamma, non disponible nativement en CSS) et des transformations
// (rotation/zoom/miroir/recadrage).
App.filters = (() => {
  const { state, dom } = App;

  function ensureGammaSvg() {
    if (document.getElementById("gamma-svg-defs")) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "gamma-svg-defs");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.innerHTML = `
      <filter id="gammaFilter">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="1" exponent="1" offset="0" id="gammaR"/>
          <feFuncG type="gamma" amplitude="1" exponent="1" offset="0" id="gammaG"/>
          <feFuncB type="gamma" amplitude="1" exponent="1" offset="0" id="gammaB"/>
        </feComponentTransfer>
      </filter>`;
    document.body.appendChild(svg);
  }

  function apply() {
    ensureGammaSvg();
    const f = state.filters;
    // exponent inverse : gamma%>100 = image plus claire dans les tons moyens
    const exponent = 100 / Math.max(1, f.gamma);
    ["gammaR", "gammaG", "gammaB"].forEach((id) => document.getElementById(id)?.setAttribute("exponent", exponent));

    const cssFilter = `url(#gammaFilter) brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%)`;
    dom.video.style.filter = cssFilter;

    const scaleX = (state.mirrorH ? -1 : 1) * state.zoom;
    const scaleY = (state.mirrorV ? -1 : 1) * state.zoom;
    dom.video.style.transform = `rotate(${state.rotation}deg) scale(${scaleX}, ${scaleY})`;

    const c = state.crop;
    dom.video.style.clipPath = `inset(${c.top}% ${c.right}% ${c.bottom}% ${c.left}%)`;
  }

  function set(key, value) { state.filters[key] = value; apply(); }
  function toggleMirrorH() { state.mirrorH = !state.mirrorH; apply(); }
  function toggleMirrorV() { state.mirrorV = !state.mirrorV; apply(); }
  function rotate90() { state.rotation = (state.rotation + 90) % 360; apply(); }
  function setZoom(z) { state.zoom = Math.max(0.2, Math.min(4, z)); apply(); }
  function setCrop(side, value) { state.crop[side] = Math.max(0, Math.min(45, value)); apply(); }

  function reset() {
    state.filters = { brightness: 100, contrast: 100, saturate: 100, gamma: 100 };
    state.mirrorH = false; state.mirrorV = false; state.rotation = 0; state.zoom = 1;
    state.crop = { top: 0, right: 0, bottom: 0, left: 0 };
    apply();
  }

  return { apply, set, toggleMirrorH, toggleMirrorV, rotate90, setZoom, setCrop, reset };
})();
