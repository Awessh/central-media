// ============================================================
// Préchargeur — reste affiché le temps de l'animation du logo,
// et jusqu'à ce que l'appli soit effectivement prête (le plus long
// des deux gagne, pour ne jamais couper l'animation ni faire
// attendre inutilement si tout est déjà chargé).
// ============================================================
const PRELOADER_MIN_MS = 4200;
const preloaderStartedAt = Date.now();
function hidePreloader() {
    const elapsed = Date.now() - preloaderStartedAt;
    const remaining = Math.max(0, PRELOADER_MIN_MS - elapsed);
    setTimeout(() => {
        const node = document.getElementById('preloader');
        if (!node) return;
        node.classList.add('hide');
        setTimeout(() => node.remove(), 550);
    }, remaining);
}

// ============================================================
// Initialisation
// ============================================================
(async function init() {
    hidePreloader();
})();