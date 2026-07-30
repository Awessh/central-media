# Media Player — lecteur vidéo & audio autonome

Projet Electron externalisé depuis Central Browser (module « Lecteur vidéo & audio »),
avec fonctionnalités étendues : streaming (HLS/DASH/IPTV/RTSP), podcasts, playlists
avancées, sous-titres, réglages image, capture, chapitres, marque-pages, notes,
historique, statistiques, fonctionnalités musicales et télécommande smartphone.

## Installation

```bash
npm install
npm start
```

Certaines bibliothèques front (`hls.js`, `dashjs`) sont chargées directement depuis
`node_modules` par `index.html` (`<script src="node_modules/hls.js/dist/hls.min.js">`) :
**`npm install` est donc obligatoire avant le premier lancement**, même en dev.

## Build (Windows, installeur NSIS)

```bash
npm run dist:win
```

## Fonctionnalités

- **Streaming** : URL vidéo directe, HLS (`.m3u8`, via hls.js), DASH (`.mpd`, via dash.js),
  IPTV (playlists de flux live), **RTSP** — transcodé à la volée en HLS local par ffmpeg
  (les navigateurs/Chromium ne savent pas lire RTSP nativement, voir `main.js:startRtspSession`).
- **Podcasts** : ajout par URL de flux RSS, liste d'épisodes, lecture directe.
- **Playlists** : ajout multi-fichiers, glisser-déposer, réorganisation par glisser-déposer,
  suppression, sauvegarde/chargement de playlists nommées, **import/export** aux formats
  `m3u`, `m3u8`, `pls`, `xspf`.
- **Sous-titres** : fichier local (`.srt`/`.vtt`, conversion SRT→VTT automatique) ou URL en ligne.
  Le format `.ass/.ssa` n'est pas converti automatiquement (limitation volontaire, cf. `subtitles.js`).
- **Audio** : sélection de piste audio quand plusieurs pistes sont disponibles (natif, hls.js ou dash.js
  selon la source — cf. `streaming.js` → `App.audioTracks`).
- **Réglages image** : luminosité, contraste, saturation, gamma (filtre SVG), rotation, zoom,
  recadrage, miroir horizontal/vertical (`filters.js`).
- **Clic droit** : menu contextuel natif complet, actif pendant la lecture et sur interface vierge
  (`main.js` → `buildContextMenu`, `contextmenu.js`).
- **Barre horizontale** : Fichier / Lecture / Audio / Vidéo / Sous-titres / Outils / Paramètres
  (`menubar.js`).
- **Lecture image par image**, **capture d'écran** (PNG), **enregistrement d'un extrait audio**
  (ffmpeg, mp3).
- **Informations média** : codec, résolution, FPS, bitrate, taille, durée, pistes audio/sous-titres
  (via ffprobe, `main.js` → `probeMedia`).
- **Reprise automatique**, **chapitres** (si embarqués dans le fichier), **marque-pages**,
  **notes synchronisées**, **historique**, **statistiques**.
- **Fonctionnalités musicales** : tags ID3 (titre/artiste/album/genre/année/pochette) et
  paroles synchronisées `.lrc` (chargées automatiquement si un fichier `.lrc` de même nom
  existe à côté du morceau, ou manuellement).
- **Mise à jour automatique** : même mécanisme qu'sur le navigateur principal (electron-updater
  + dépôt GitHub), avec statut visible dans **Paramètres → À propos**.
- **Télécommande smartphone** : petit serveur local (HTTP + WebSocket, `server/remote-server.js`)
  avec QR code de pairage et une page web de secours ; une appli Android dédiée est prévue plus tard
  et pourra se brancher sur le même protocole JSON (`/api/state`, `/api/command`, `ws://.../ws`).

## Points d'attention importants

1. **Jeton GitHub retiré du code.** Le `main.js` d'origine contenait un jeton GitHub
   (`GH_TOKEN`) **codé en dur** pour l'auto-updater sur dépôt privé — c'est un risque de
   sécurité (extractible depuis l'app installée, `app.asar`). Ici, `setupAutoUpdater()` lit
   `process.env.GH_TOKEN` et n'embarque plus aucun secret. Si vous utilisez un dépôt privé,
   injectez le jeton (fine-grained, lecture seule, limité à ce dépôt) au moment du build,
   ou passez le dépôt de mise à jour en **public**. Je vous recommande aussi de **révoquer**
   l'ancien jeton s'il n'a pas déjà été régénéré.
2. **RTSP** nécessite ffmpeg (fourni via `ffmpeg-static`) pour transcoder en HLS local ;
   il y a quelques secondes de latence au démarrage (temps que les premiers segments
   soient générés).
3. **hls.js / dashjs** ne sont pas vendus dans ce zip (poids), ils s'installent via `npm install`.
4. **Application Android de télécommande** : non incluse ici (mentionnée comme fonctionnalité
   future dans votre cahier des charges). Le serveur expose déjà un protocole simple et stable
   pour qu'elle puisse s'y connecter directement le moment venu.
5. **"Toujours au premier plan"** : le bouton bascule un état visuel ; le branchement réel sur
   `BrowserWindow.setAlwaysOnTop()` est à un IPC près si vous le souhaitez (facile à ajouter dans
   `main.js`, je ne l'ai pas activé par défaut pour ne pas geler la fenêtre au-dessus des autres
   sans confirmation explicite de votre part).
6. **Icône manquante** : `build/icon.ico` n'est pas fourni (fichier binaire) — ajoutez la vôtre
   avant `npm run dist:win`, sinon electron-builder échouera au packaging.

## Structure

```
media-player/
├── main.js                  # process principal (fenêtre, store, ffmpeg, IPC, updater)
├── preload.js                # pont contextBridge sécurisé
├── index.html                 # UI (toolbar horizontale + sidebar + scène + contrôles)
├── server/remote-server.js    # serveur HTTP+WS pour la télécommande
└── renderer/
    ├── index.css
    └── modules/
        ├── utils.js, state.js, modal.js          # fondations partagées
        ├── menubar.js, keyboard.js, contextmenu.js # entrées utilisateur
        ├── player.js, streaming.js, chapters.js    # moteur de lecture
        ├── filters.js, subtitles.js                # image & sous-titres
        ├── playlist.js, library.js, podcasts.js     # playlists / historique / podcasts
        ├── lyrics.js, capture.js, mediainfo.js       # musique, capture, infos média
        ├── settings.js, about.js, remote.js, init.js # paramètres, à propos, télécommande, bootstrap
```
