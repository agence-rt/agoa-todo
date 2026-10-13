"use strict";
const { contextBridge, ipcRenderer } = require("electron");

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.ok) return r.value;
  const err = new Error((r && r.message) || "Erreur"); err.code = (r && r.code) || "error"; throw err;
}

const snapshotHandlers = new Map();   // collection -> [fn]
ipcRenderer.on("db:snapshot", (_e, coll, docs) => (snapshotHandlers.get(coll) || []).forEach((fn) => fn(docs)));
const statusHandlers = [];
ipcRenderer.on("db:status", (_e, s) => statusHandlers.forEach((fn) => fn(s)));

contextBridge.exposeInMainWorld("agoa", {
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
  sendMail: (m) => call("mail:send", m)
});
