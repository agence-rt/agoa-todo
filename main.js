"use strict";
const { app, BrowserWindow, ipcMain, shell, safeStorage, Menu, dialog } = require("electron");
const dropbox = require("./src/dropbox");
const path = require("path");
const { Vault } = require("./src/vault");
const { Services, readGoogleClient } = require("./src/services");
const { createSplash } = require("./src/splash");
const { readShared } = require("./src/shared");
const { runUpdateCheck } = require("./src/updater");

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
    shared: () => readShared(),
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
  handle("app:state", async () => {      // reprend les connexions d'AGOA Launcher si elles ont changé (clé Ragic, compte Google)
    const ch = await svc.refreshShared();
    if (ch.ragic && !svc.starting) await svc.startStore();
    return svc.state();
  });
  handle("auth:signIn", async () => { await svc.auth.signIn(); return svc.state(); });
  handle("auth:signOut", async () => { await svc.signOut(); return svc.state(); });
  handle("ragic:setup", (key) => svc.setupRagic(key));
  handle("ragic:forget", () => { svc.forgetRagic(); return svc.state(); });
  handle("ragic:retry", async () => { await svc.startStore(); return svc.state(); });
  handle("db:subscribe", (coll) => { subscribers.add(coll); const st = svc.requireStore(); return st.docs(coll); });
  handle("db:write", (w) => { svc.requireSession(); return svc.requireStore().write(w).then(() => true); });
  handle("ragic:search", (q) => svc.searchOperations(q));
  handle("mail:send", (m) => svc.sendMail(m));
  handle("ragic:architect", (a) => svc.assignArchitect(a || {}));
  handle("ragic:architectOptions", () => svc.architectOptions());
  /* Dossiers Dropbox : l'emplacement est propre à chaque poste (coffre local) */
  const dbxRoot = () => svc.vault.get("dropbox_root") || "";
  handle("dropbox:get", () => { const saved = dbxRoot(), auto = saved ? "" : (dropbox.detectRoot() || ""); return { root: saved, auto }; });
  handle("dropbox:pick", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Choisir le dossier 01-OPERATIONS de la Dropbox", properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return { root: dbxRoot(), auto: "" };
    const root = dropbox.resolveRoot(r.filePaths[0]); svc.vault.set("dropbox_root", root);
    return { root, auto: "" };
  });
  handle("dropbox:clear", () => { svc.vault.remove("dropbox_root"); return { root: "", auto: dropbox.detectRoot() || "" }; });
  handle("dropbox:open", async (ref) => {
    const root = dbxRoot() || dropbox.detectRoot();
    if (!root) throw Object.assign(new Error("Emplacement de la Dropbox non défini : indiquez le dossier 01-OPERATIONS dans Réglages."), { code: "dropbox_root" });
    const dir = dropbox.findDossier(root, ref);
    if (!dir) throw Object.assign(new Error("Aucun dossier « " + ref + " » trouvé dans " + root + "."), { code: "dropbox_notfound" });
    const err = await shell.openPath(dir);
    if (err) throw Object.assign(new Error("Ouverture impossible : " + err), { code: "dropbox_open" });
    return dir;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: "#FAF9F6", title: "AGOA TD", show: false,
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function startup() {
  const noSplash = process.env.AGOA_NO_SPLASH === "1";
  const splash = noSplash ? null : createSplash({ BrowserWindow, version: app.getVersion(), rendererDir: RENDERER });
  const t0 = Date.now();
  let result = { action: "continue" };
  if (splash) {
    let updater = null;
    if (app.isPackaged) { try { updater = require("electron-updater").autoUpdater; } catch (e) { console.error(e); } }
    result = await runUpdateCheck({
      updater: updater || { on() {}, removeListener() {}, checkForUpdates: () => Promise.reject(new Error("indisponible")) },
      onStatus: (s) => splash.status(s), isPackaged: app.isPackaged && !!updater,
      checkTimeoutMs: Number(process.env.AGOA_UPDATE_TIMEOUT_MS) || 12000
    });
    if (result.action === "restart") {
      await sleep(900);
      try { updater.quitAndInstall(false, true); return; } catch (e) { console.error(e); }
    }
    splash.status({ text: "Démarrage…", progress: null });
    const wait = 1200 - (Date.now() - t0); if (wait > 0) await sleep(wait);
  }
  createWindow();
  win.once("ready-to-show", () => { win.show(); if (splash) splash.close(); });
  boot().catch((e) => console.error(e));
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  await startup();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) { createWindow(); win.once("ready-to-show", () => win.show()); } });
});
app.on("window-all-closed", () => { if (svc) svc.stopStore(); app.quit(); });
