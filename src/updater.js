// ============================================================
// Mises à jour automatiques (electron-updater)
// ============================================================
// Le dépôt de Releases est PUBLIC : la vérification/téléchargement des
// mises à jour ne nécessite plus aucun jeton à l'exécution (le flux
// /releases.atom de GitHub fonctionne sans authentification pour un
// dépôt public — c'est le chemin "normal" et fiable d'electron-updater).
//
// GH_TOKEN reste utile UNIQUEMENT côté machine de build/CI, pour que
// `electron-builder --publish` puisse uploader les binaires vers GitHub
// Releases (ça nécessite un droit d'écriture, distinct de la simple
// lecture faite par l'app installée). Voir .env.example / README.md.

let autoUpdater = null;
let loadError = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (err) {
  loadError = err;
}

function initUpdater({ app, ipcMain, dialog, BrowserWindow }) {
  let status = { state: 'idle', version: null, info: null };

  function broadcast() {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('update:status', status);
    });
  }

  function setStatus(state, extra = {}) {
    status = { state, version: null, info: null, ...extra };
    broadcast();
  }

  function checkForUpdates() {
    if (!app.isPackaged) {
      setStatus('unsupported', { info: { reason: 'not-packaged' } });
      return status;
    }
    if (!autoUpdater) {
      setStatus('unsupported', { info: { reason: 'module-missing', message: String(loadError?.message || loadError || '') } });
      return status;
    }
    setStatus('checking');
    autoUpdater.checkForUpdates().catch((err) => {
      setStatus('error', { info: { message: String(err?.message || err) } });
    });
    return status;
  }

  function setup() {
    if (!app.isPackaged || !autoUpdater) {
      checkForUpdates();
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => setStatus('checking'));
    autoUpdater.on('update-available', (info) => setStatus('downloading', { version: info?.version || null }));
    autoUpdater.on('update-not-available', (info) => setStatus('not-available', { version: info?.version || app.getVersion() }));
    autoUpdater.on('download-progress', (progress) => {
      setStatus('downloading', { version: status.version, info: { percent: Math.round(progress?.percent || 0) } });
    });
    autoUpdater.on('update-downloaded', (info) => {
      setStatus('downloaded', { version: info?.version || null });
      dialog.showMessageBox({
        type: 'info',
        title: 'Mise à jour disponible',
        message: `Central Share ${info.version} a été téléchargée.`,
        detail: "Elle sera installée automatiquement à la prochaine fermeture, ou tu peux redémarrer maintenant.",
        buttons: ['Redémarrer maintenant', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
    });
    autoUpdater.on('error', (err) => setStatus('error', { info: { message: String(err?.message || err) } }));

    setTimeout(checkForUpdates, 2500);
  }

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:get-update-status', () => status);
  ipcMain.handle('app:check-for-updates', () => checkForUpdates());
  ipcMain.handle('app:install-update', () => {
    if (!autoUpdater || status.state !== 'downloaded') return false;
    autoUpdater.quitAndInstall();
    return true;
  });

  return { setup };
}

module.exports = { initUpdater };
