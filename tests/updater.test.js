"use strict";
const test = require("node:test"); const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { runUpdateCheck } = require("../src/updater");

function fake(script) {
  const u = new EventEmitter();
  u.checkForUpdates = async () => { setImmediate(() => script(u)); return {}; };
  u.downloadUpdate = async () => { setImmediate(() => { u.emit("download-progress", { percent: 40.4 }); u.emit("update-downloaded", { version: "1.2.3" }); }); };
  return u;
}
const run = (u, extra = {}) => { const log = []; return runUpdateCheck({ updater: u, onStatus: (s) => log.push(s), isPackaged: true, ...extra }).then((r) => ({ r, log })); };

test("développement : pas de recherche", async () => {
  const { r } = await run(fake(() => assert.fail("ne doit pas chercher")), { isPackaged: false });
  assert.deepStrictEqual([r.action, r.reason], ["continue", "dev"]);
});
test("à jour : on continue", async () => {
  const { r, log } = await run(fake((u) => { u.emit("checking-for-update"); u.emit("update-not-available", {}); }));
  assert.strictEqual(r.action, "continue"); assert.strictEqual(log.at(-1).text, "Application à jour");
});
test("mise à jour disponible : téléchargement puis redémarrage", async () => {
  const { r, log } = await run(fake((u) => u.emit("update-available", { version: "1.2.3" })));
  assert.deepStrictEqual([r.action, r.version], ["restart", "1.2.3"]);
  assert.ok(log.some((s) => s.progress === 40));
});
test("erreur réseau : on continue sans bloquer", async () => {
  const { r, log } = await run(fake((u) => u.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))));
  assert.strictEqual(r.action, "continue"); assert.match(log.at(-1).text, /Pas de connexion/);
});
test("checkForUpdates qui échoue : on continue", async () => {
  const u = new EventEmitter(); u.checkForUpdates = () => Promise.reject(new Error("boom"));
  const { r } = await run(u); assert.strictEqual(r.reason, "error");
});
test("pas de réponse : délai dépassé", async () => {
  const { r } = await run(fake(() => {}), { checkTimeoutMs: 50 });
  assert.strictEqual(r.reason, "timeout");
});
test("les écouteurs sont retirés", async () => {
  const u = fake((x) => x.emit("update-not-available", {})); await run(u);
  assert.strictEqual(u.listenerCount("error"), 0);
});

const { startPeriodicCheck } = require("../src/updater");
const periodic = (script, opts = {}) => {
  const u = fake(script); const calls = { asked: [], progress: [], ready: [] };
  const p = startPeriodicCheck({ updater: u, intervalMs: 3600000, ask: async (i) => { calls.asked.push(i.version); return opts.yes !== false; }, onProgress: (x) => calls.progress.push(x), onReady: async (i) => calls.ready.push(i.version), checkTimeoutMs: 200, downloadTimeoutMs: 500 });
  return { u, p, calls };
};
test("vérification périodique : rien de nouveau, aucune fenêtre", async () => {
  const { p, calls } = periodic((u) => u.emit("update-not-available", {}));
  const r = await p.checkNow(); p.stop();
  assert.strictEqual(r.reason, "none"); assert.deepStrictEqual(calls.asked, []);
});
test("vérification périodique : version disponible, acceptée -> téléchargée puis installée", async () => {
  const { u, p, calls } = periodic((x) => x.emit("update-available", { version: "1.2.3" }));
  const r = await p.checkNow(); p.stop();
  assert.strictEqual(r.reason, "installed"); assert.deepStrictEqual(calls.asked, ["1.2.3"]); assert.deepStrictEqual(calls.ready, ["1.2.3"]);
  assert.ok(calls.progress.includes(40)); assert.strictEqual(u.listenerCount("update-available"), 0, "écouteurs retirés");
});
test("vérification périodique : « Plus tard » ne télécharge rien et sera reproposé", async () => {
  let downloads = 0;
  const { u, p, calls } = periodic((x) => x.emit("update-available", { version: "1.2.3" }), { yes: false });
  const orig = u.downloadUpdate; u.downloadUpdate = async () => { downloads++; return orig(); };
  assert.strictEqual((await p.checkNow()).reason, "declined"); assert.strictEqual((await p.checkNow()).reason, "declined"); p.stop();
  assert.strictEqual(downloads, 0); assert.deepStrictEqual(calls.asked, ["1.2.3", "1.2.3"]);
});
test("vérification périodique : erreur réseau ou absence de réponse -> silence", async () => {
  const a = periodic((u) => u.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED")));
  assert.strictEqual((await a.p.checkNow()).reason, "error"); a.p.stop(); assert.deepStrictEqual(a.calls.asked, []);
  const b = periodic(() => {}); assert.strictEqual((await b.p.checkNow()).reason, "error"); b.p.stop();
});
