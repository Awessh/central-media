window.App = window.App || {};

App.podcasts = (() => {
  const { util } = App;
  const api = window.playerAPI;
  let podcasts = [];
  let activePodcastId = null;

  async function fetchFeed(feedUrl) {
    const xmlText = await (await fetch(feedUrl)).text();
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const channel = doc.querySelector("channel");
    const title = channel?.querySelector("title")?.textContent?.trim() || feedUrl;

    const episodes = Array.from(doc.querySelectorAll("item")).map((item) => {
      const enclosure = item.querySelector("enclosure");
      return {
        title: item.querySelector("title")?.textContent?.trim() || "Épisode",
        url: enclosure ? enclosure.getAttribute("url") : null,
        pubDate: item.querySelector("pubDate")?.textContent?.trim() || null,
        duration: item.getElementsByTagName("itunes:duration")[0]?.textContent?.trim() || null,
      };
    }).filter((ep) => ep.url);

    return { title, feedUrl, episodes };
  }

  function addPrompt() {
    App.modal.open({
      title: "Ajouter un podcast",
      body: `<input type="text" id="podUrl" placeholder="URL du flux RSS" style="width:100%;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:9px;color:var(--text)">`,
      footer: `<button class="btn" data-close>Annuler</button><button class="btn primary" id="podGo">Ajouter</button>`,
      onMount(root) {
        root.querySelector("#podUrl").focus();
        root.querySelector("#podGo").onclick = async () => {
          const url = root.querySelector("#podUrl").value.trim();
          if (!url) return;
          App.modal.closeAll();
          try {
            const feed = await fetchFeed(url);
            const saved = await api.savePodcast(feed);
            await load();
            util.toast(`Podcast ajouté : ${feed.title} (${feed.episodes.length} épisodes)`);
          } catch (e) { util.toast("Flux RSS invalide ou inaccessible."); }
        };
      },
    });
  }

  async function load() {
    podcasts = await api.listPodcasts();
    render();
  }

  function render() {
    const list = document.getElementById("podcast-list");
    list.innerHTML = podcasts.map((p) => `
      <li class="media-item${p.id === activePodcastId ? " playing" : ""}" data-id="${p.id}">
        <div class="thumb-placeholder"><i class="fa-solid fa-podcast"></i></div>
        <div class="info"><div class="title">${util.escapeHtml(p.title)}</div><div class="meta">${p.episodes.length} épisodes</div></div>
        <button class="remove" title="Supprimer"><i class="fa-solid fa-xmark"></i></button>
      </li>`).join("");

    list.querySelectorAll(".media-item").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.closest(".remove")) return;
        activePodcastId = li.dataset.id;
        render();
        renderEpisodes(podcasts.find((p) => p.id === li.dataset.id));
      });
      li.querySelector(".remove").addEventListener("click", async (e) => {
        e.stopPropagation();
        podcasts = await api.removePodcast(li.dataset.id);
        render();
      });
    });
  }

  function renderEpisodes(podcast) {
    const el = document.getElementById("podcast-episodes");
    if (!podcast) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    el.innerHTML = podcast.episodes.map((ep, i) => `
      <li class="media-item" data-url="${encodeURIComponent(ep.url)}" data-title="${util.escapeHtml(ep.title)}">
        <div class="thumb-placeholder"><i class="fa-solid fa-headphones"></i></div>
        <div class="info"><div class="title">${util.escapeHtml(ep.title)}</div><div class="meta">${ep.pubDate || ""}</div></div>
      </li>`).join("");

    el.querySelectorAll(".media-item").forEach((li) => {
      li.addEventListener("click", () => App.player.playPath(decodeURIComponent(li.dataset.url), { type: "url", mediaType: "audio" }));
    });
  }

  function bind() { document.getElementById("addPodcast").onclick = addPrompt; }

  return { load, bind };
})();
