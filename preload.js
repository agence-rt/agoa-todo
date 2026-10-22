"use strict";
const { contextBridge, ipcRenderer } = require("electron");

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.ok) return r.value;
  /* Le pont d'Electron ne garde que le message d'une erreur : le code y est donc joint (« AGOA|code|texte ») et décodé côté page. */
  const code = (r && r.code) || "error";
  const err = new Error("AGOA|" + code + "|" + ((r && r.message) || "Erreur")); err.code = code; throw err;
}

const snapshotHandlers = new Map();   // collection -> [fn]
ipcRenderer.on("db:snapshot", (_e, coll, docs) => (snapshotHandlers.get(coll) || []).forEach((fn) => fn(docs)));
const statusHandlers = [];
ipcRenderer.on("db:status", (_e, s) => statusHandlers.forEach((fn) => fn(s)));

const info = (e) => {
  const m = /^AGOA\|([^|]*)\|([\s\S]*)$/.exec(String((e && e.message) || ""));
  return m ? { code: m[1], message: m[2] } : { code: (e && e.code) || "error", message: String((e && e.message) || e || "") };
};
contextBridge.exposeInMainWorld("agoa", {
  info,
  state: () => call("app:state"),
  signIn: () => call("auth:signIn"),
  signOut: () => call("auth:signOut"),
  setupRagic: (key) => call("ragic:setup", key),
  forgetRagic: () => call("ragic:forget"),
  retry: () => call("ragic:retry"),
  subscribe: async (coll, onDocs) => {
    if (!snapshotHandlers.has(coll)) snapshotHandlers.set(coll, []);
    snapshotHandlers.get(coll).push(onDocs);
    onDocs(await call("db:subscribe", coll));
  },
  write: (w) => call("db:write", w),
  onStatus: (fn) => { statusHandlers.push(fn); },
  searchOperations: (q) => call("ragic:search", q),
  sendMail: (m) => call("mail:send", m),
  assignArchitect: (a) => call("ragic:architect", a),
  dropboxGet: () => call("dropbox:get"),
  dropboxPick: () => call("dropbox:pick"),
  dropboxClear: () => call("dropbox:clear"),
  dropboxOpen: (ref) => call("dropbox:open", ref)
});
