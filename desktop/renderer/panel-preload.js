"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("venusPanel", {
  state: () => ipcRenderer.invoke("panel:state"),
  act: (name) => ipcRenderer.invoke("panel:act", name),
  onState: (cb) => ipcRenderer.on("panel:state", (_e, s) => cb(s)),
});