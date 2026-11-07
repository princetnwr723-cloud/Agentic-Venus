"use strict";
// AgenticVenus desktop app. The window shows the real website, so plans, limits and payments work exactly as on the web
// (they are decided on the server). This process adds only: login, and the "hands" for a Linux computer on this PC.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, safeStorage, nativeImage, session } = require("electron");
const path = require("path");
const fs = require("fs");
const cfg = require("./config.json");
const { pkce, redeem, signIn, Session } = require("./lib/auth");
const { Vm } = require("./lib/vm");
const { RelayClient } = require("./lib/relay-client");
const { inspect } = require("./lib/host");

const APP_URL = String(process.env.VENUS_APP_URL || cfg.appUrl).replace(/\/+$/, "");
const API_KEY = process.env.VENUS_FIREBASE_API_KEY || cfg.firebaseApiKey;
const APP_ORIGIN = new URL(APP_URL).origin;
const SCHEME = "agenticvenus";
const isApp = (u) => { try { return new URL(u).origin === APP_ORIGIN; } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();
if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(SCHEME);

let win = null, panel = null, tray = null, pending = null, loginToken = null, relay = null, vm = null, host = null;
const dir = () => app.getPath("userData");
const file = (n) => path.join(dir(), n);

// ---- small saved state (device id) and the encrypted refresh token ----
const state = {
  get() { try { return JSON.parse(fs.readFileSync(file("state.json"), "utf8")); } catch { return {}; } },
  set(p) { fs.writeFileSync(file("state.json"), JSON.stringify({ ...this.get(), ...p })); },
};
const sess = new Session(API_KEY, (token) => {
  try {
    if (!token) return fs.rmSync(file("session.bin"), { force: true });
    if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(file("session.bin"), safeStorage.encryptString(token), { mode: 0o600 });
  } catch { /* the user simply signs in again next time */ }
});
function restoreSession() {
  try { if (safeStorage.isEncryptionAvailable()) sess.restore(safeStorage.decryptString(fs.readFileSync(file("session.bin")))); } catch { /* none */ }
}

const snapshot = () => ({ signedIn: sess.signedIn, setUp: Boolean(vm && vm.isSetUp), vm: { state: vm ? vm.state : "stopped", detail: vm ? vm.detail : "" }, host: host || { problems: [], missing: [], ready: false } });
const push = () => { if (panel && !panel.isDestroyed()) panel.webContents.send("panel:state", snapshot()); if (tray) tray.setToolTip("AgenticVenus · " + (vm ? vm.state : "stopped")); };

// ---- windows ----
function openMain(url) {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1280, height: 860, title: "AgenticVenus", backgroundColor: "#0f1115",
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Only the AgenticVenus website may load here. Everything else (Gumroad checkout, Google, links) opens in the real browser.
    win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https:\/\//i.test(u) && !isApp(u)) void shell.openExternal(u); else if (isApp(u)) return { action: "allow" }; return { action: "deny" }; });
    win.webContents.on("will-navigate", (e, u) => { if (!isApp(u)) { e.preventDefault(); if (/^https:\/\//i.test(u)) void shell.openExternal(u); } });
  }
  void win.loadURL(url || APP_URL);
  win.show();
}
function openPanel() {
  if (panel && !panel.isDestroyed()) return panel.show();
  panel = new BrowserWindow({
    width: 520, height: 520, title: "Your AgenticVenus computer", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "renderer", "panel-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  void panel.loadFile(path.join(__dirname, "renderer", "panel.html"));
}

// ---- login (browser, one-time code, verifier) ----
function startLogin() {
  pending = pkce();
  void shell.openExternal(`${APP_URL}/native-login?challenge=${pending.challenge}`);
}
async function handleAuthUrl(url) {
  if (!url.startsWith(SCHEME + "://auth") || !pending) return;
  const code = new URL(url).searchParams.get("code");
  const { verifier } = pending;
  pending = null;
  if (!code) return;
  const custom = await redeem(APP_URL, code, verifier);
  sess.set(await signIn(API_KEY, custom));
  await afterLogin(custom);
}
async function afterLogin(customToken) {
  await ensureServices();
  await relay.register(require("os").hostname()).catch(() => {});
  loginToken = customToken || null;
  openMain(customToken ? APP_URL + "/desktop-login" : APP_URL);
  relay.start();
  push();
  if (vm.isSetUp && host && host.ready) void vm.start({ info: host.info, headless: false }).catch(() => {});
}

async function ensureServices() {
  if (vm) return;
  host = inspect(dir());
  const agentScript = fs.readFileSync(path.join(__dirname, "vm-agent", "venus-agent.py"), "utf8");
  vm = new Vm(dir(), agentScript, push);
  relay = new RelayClient({ appUrl: APP_URL, session: sess, vm, hostInfo: host.info, state, onChange: push });
}

// ---- messages from the website window (only from our own website) and from the panel ----
const fromApp = (e) => isApp(e.senderFrame ? e.senderFrame.url : "");
ipcMain.on("venus:localKey", (e) => { e.returnValue = fromApp(e) && relay ? relay.localKey : (fromApp(e) && state.get().deviceId ? "venus-local:" + state.get().deviceId : null); });
ipcMain.handle("venus:takeLoginToken", (e) => { if (!fromApp(e)) return null; const t = loginToken; loginToken = null; return t; });
ipcMain.handle("panel:state", () => snapshot());
ipcMain.handle("panel:act", async (_e, name) => {
  await ensureServices();
  if (name === "login") startLogin();
  else if (name === "start") { host = inspect(dir()); if (host.ready) void vm.start({ info: host.info, headless: false }).catch(() => {}); }
  else if (name === "stop") await vm.stop();
  else if (name === "reset") await vm.reset();
  else if (name === "open") openMain();
  else if (name === "logout") { relay && relay.stop(); await vm.stop(); sess.clear(); state.set({ deviceId: null }); if (win && !win.isDestroyed()) win.close(); }
  push();
});

app.on("open-url", (e, url) => { e.preventDefault(); void handleAuthUrl(url).catch(() => {}); });
app.on("second-instance", (_e, argv) => {
  const u = argv.find((a) => a.startsWith(SCHEME + "://"));
  if (u) void handleAuthUrl(u).catch(() => {});
  openPanel();
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const icon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPojvlGEmIY1TCqYfhqAAAq1t0QMabSpAAAAABJRU5ErkJggg==");
  tray = new Tray(icon);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open AgenticVenus", click: () => openMain() },
    { label: "My computer…", click: () => openPanel() },
    { label: "Sign in again", click: () => startLogin() },
    { type: "separator" },
    { label: "Quit", click: async () => { relay && relay.stop(); if (vm) await vm.stop().catch(() => {}); app.exit(0); } },
  ]));
  restoreSession();
  await ensureServices();
  if (sess.signedIn) { await afterLogin(null).catch(() => {}); openPanel(); }
  else openPanel();
});
app.on("window-all-closed", (e) => e.preventDefault()); // stays in the tray so the computer keeps working