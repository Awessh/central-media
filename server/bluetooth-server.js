"use strict";

// Canal Bluetooth (SPP / RFCOMM) — EXPÉRIMENTAL.
//
// Pourquoi "expérimental" : Node.js / Electron n'a pas d'API Bluetooth
// classique fiable et multiplateforme permettant à un PC (surtout sous
// Windows) d'agir comme serveur Bluetooth découvrable et d'accepter des
// connexions RFCOMM entrantes. Les librairies existantes ciblent soit le
// rôle "client" (scanner/se connecter à un périphérique), soit le BLE, soit
// Linux uniquement. Il n'existe pas d'équivalent Windows fiable et maintenu.
//
// -> Le téléphone (Android), lui, gère très bien ce rôle nativement.
// -> Ce module tente donc de démarrer un serveur RFCOMM si un module natif
//    compatible est disponible sur la machine ; s'il ne l'est pas (cas très
//    probable sous Windows sans configuration supplémentaire), il échoue
//    proprement et le mode Bluetooth reste simplement indisponible dans
//    l'appli — le WiFi/QR restent le chemin garanti (c'est aussi ce que la
//    doc recommande : Bluetooth = bonus, WiFi = priorité).
//
// Protocole (identique au WS, pour que la logique de commande soit
// partagée) : lignes JSON terminées par \n.
//   PC   -> téléphone : {"type":"state","state":{...}}\n
//   Téléphone -> PC    : {"type":"command","command":{...}}\n
//
// UUID SPP standard utilisé : 00001101-0000-1000-8000-00805F9B34FB

const SPP_UUID = "00001101-0000-1000-8000-00805F9B34FB";

let btModule = null;
let available = false;
let reason = "";

// On ne charge le module natif qu'à la demande, et on encaisse tout échec
// (binaire absent, plateforme non supportée, module non installé...).
function tryLoad() {
  if (btModule || !available === false) { /* déjà tenté */ }
  try {
    // Dépendance optionnelle : à ajouter uniquement si vous voulez tenter
    // le Bluetooth réel (npm i node-bluetooth-serial-port), sait
    // fonctionner sur Linux/macOS ; sous Windows le succès n'est pas garanti.
    // eslint-disable-next-line global-require
    btModule = require("node-bluetooth-serial-port");
    available = true;
  } catch (e) {
    available = false;
    reason = "Module Bluetooth natif indisponible sur cette machine (" + e.message + "). " +
      "Le mode Bluetooth reste désactivé ; utilisez le WiFi ou le QR code.";
  }
  return available;
}

let connections = new Set();
let onCommand = null;
let lastState = { status: "idle" };

function isAvailable() {
  if (btModule === null) tryLoad();
  return available;
}

function getStatusReason() {
  if (btModule === null) tryLoad();
  return reason;
}

async function start(opts = {}) {
  onCommand = opts.onCommand || null;
  if (!isAvailable()) return { running: false, reason };

  try {
    const bt = new btModule.BluetoothSerialPort();
    bt.on("data", (buffer) => {
      buffer
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          try {
            const msg = JSON.parse(line);
            if (msg.type === "command" && onCommand) onCommand(msg.command);
          } catch { /* ligne invalide ignorée */ }
        });
    });
    bt.listenForConnections(SPP_UUID, () => {
      connections.add(bt);
      bt.write(Buffer.from(JSON.stringify({ type: "state", state: lastState }) + "\n"), () => {});
    });
    return { running: true, uuid: SPP_UUID };
  } catch (e) {
    return { running: false, reason: "Échec du démarrage du serveur Bluetooth : " + e.message };
  }
}

function pushState(state) {
  lastState = state;
  const payload = Buffer.from(JSON.stringify({ type: "state", state }) + "\n");
  connections.forEach((c) => { try { c.write(payload, () => {}); } catch {} });
}

async function stop() {
  connections.forEach((c) => { try { c.close(); } catch {} });
  connections.clear();
}

module.exports = { start, stop, pushState, isAvailable, getStatusReason, SPP_UUID };
