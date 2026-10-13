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
