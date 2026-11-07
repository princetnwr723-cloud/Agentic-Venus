"use strict";
// Runs in the website window. It only hands the page two harmless things: this PC's local-computer key
// (not a secret on its own: it only works together with the signed-in account) and the one-time login token.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("venusDesktop", {
  isDesktop: true,
  platform: process.platform,
  localKey: ipcRenderer.sendSync("venus:localKey"),
  takeLoginToken: () => ipcRenderer.invoke("venus:takeLoginToken"),
});