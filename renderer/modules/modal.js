window.App = window.App || {};

App.modal = (() => {
  function open({ title, body, footer = "", onMount, width }) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="${width ? `width:${width}px` : ""}">
        <div class="modal-header"><h2>${App.util.escapeHtml(title)}</h2><button class="modal-close"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ""}
      </div>`;
    document.getElementById("modal-layer").appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector(".modal-close").onclick = close;
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));

    if (onMount) onMount(backdrop, close);
    return close;
  }

  function closeAll() { document.getElementById("modal-layer").innerHTML = ""; }

  return { open, closeAll };
})();
