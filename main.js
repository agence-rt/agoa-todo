"use strict";
const { app, BrowserWindow, ipcMain, shell, safeStorage, Menu } = require("electron");
const path = require("path");
const { Vault } = require("./src/vault");
const { Services, readGoogleClient } = require("./src/services");

if (!app.requestSingleInstanceLock()) { app.quit(); }

const RENDERER = path.join(__dirname, "renderer");
let win = null, svc = null;
const subscribers = new Set();

/* Windows : chiffrement DPAPI via safeStorage. L'essai sans chiffrement n'existe que hors version installée (essais sous Linux). */
const insecure = () => !app.isPackaged && process.env.AGOA_INSECURE_VAULT === "1";
const cipher = {
  encrypt: (s) => {
    if (insecure()) return Buffer.from(s, "utf8");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Chiffrement Windows indisponible.");
    return safeStorage.encryptString(s);
  },
  decrypt: (b) => (insecure() ? b.toString("utf8") : safeStorage.decryptString(b))
};

function pushToWindow(channel, ...args) { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); }

function boot() {
  const vault = new Vault(path.join(app.getPath("userData"), "vault.json"), cipher);
  const googleClient = readGoogleClient(
    [path.join(process.resourcesPath || "", "google-client.json"), path.join(__dirname, "resources", "google-client.json")], process.env);
  svc = new Services({
    vault, googleClient, ragicProtocol: process.env.AGOA_RAGIC_PROTOCOL || undefined,   // variable réservée aux essais
    openExternal: (url) => shell.openExternal(url),
    log: (m) => console.log("[AGOA TD]", m)
  });
  svc.listeners.add({
    snapshot: (c, docs) => subscribers.has(c) && pushToWindow("db:snapshot", c, docs),
    status: (s) => pushToWindow("db:status", s)
  });
  return svc.startStore();
}

/* Un seul format de réponse : { ok, value } ou { ok:false, code, message } (les erreurs perdent leur code à travers l'IPC). */
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    const url = event.senderFrame && event.senderFrame.url || "";
    if (!url.startsWith("file://") || !decodeURIComponent(url).replace(/\\/g, "/").includes("/renderer/")) return { ok: false, code: "forbidden", message: "Appel refusé." };
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, code: e.code || "error", message: e.message || String(e) }; }
  });
}

function registerIpc() {
  handle("app:state", () => svc.state());
  handle("auth:signIn", async () => { await svc.auth.signIn(); return svc.state(); });
  handle("auth:signOut", async () => { await svc.signOut(); return svc.state(); });
  handle("ragic:setup", (key) => svc.setupRagic(key));
  handle("ragic:forget", () => { svc.forgetRagic(); return svc.state(); });
  handle("ragic:retry", async () => { await svc.startStore(); return svc.state(); });
  handle("db:subscribe", (coll) => { subscribers.add(coll); const st = svc.requireStore(); return st.docs(coll); });
  handle("db:write", (w) => { svc.requireSession(); return svc.requireStore().write(w).then(() => true); });
  handle("ragic:search", (q) => svc.searchOperations(q));
  handle("mail:send", (m) => svc.sendMail(m));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: "#FAF9F6", title: "AGOA TD",
    icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
  win.on("closed", () => { subscribers.clear(); win = null; });
  win.loadFile(path.join(RENDERER, "gate.html"));
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  boot().catch((e) => console.error(e));
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (svc) svc.stopStore(); app.quit(); });
