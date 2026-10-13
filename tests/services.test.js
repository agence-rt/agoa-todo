"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeFake } = require("./fake-ragic");
const config = require("../src/config");
const { Services } = require("../src/services");

const memVault = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), has: (k) => m.has(k) }; };

async function boot(t, { signedIn = true } = {}) {
  const fake = await makeFake();
  t.after(() => { fake.server.closeAllConnections(); fake.server.close(); });
  const vault = memVault();
  if (signedIn) { vault.set("google_refresh", "R"); vault.set("google_profile", JSON.stringify({ email: "a@remithollet.fr", name: "A", canSend: true })); }
  const svc = new Services({ vault, googleClient: { clientId: "c", clientSecret: "s" }, ragicProtocol: "http", openExternal: async () => {}, fetchImpl: (u, i) => fetch(u, i) });
  t.after(() => svc.stopStore());
  return { fake, vault, svc };
}

test("configuration de la clé : serveur détecté, clé enregistrée, base prête", async (t) => {
  const { fake, vault, svc } = await boot(t);
  const saved = config.ragic.hosts; config.ragic.hosts = ["127.0.0.1:1", fake.host];
  t.after(() => { config.ragic.hosts = saved; });
  const st = await svc.setupRagic("KEY");
  assert.equal(st.ragicConfigured, true); assert.equal(st.ready, true); assert.equal(vault.get("ragic_host"), fake.host);
  await assert.rejects(() => svc.setupRagic("   "), (e) => e.code === "empty");
  svc.forgetRagic();
  await assert.rejects(() => svc.setupRagic("MAUVAISE"), (e) => e.code === "auth");
  assert.equal(vault.has("ragic_key"), false, "une clé refusée n'est pas conservée");
});

test("recherche d'opérations : filtre sur le code, 8 résultats maximum, session exigée", async (t) => {
  const { fake, vault, svc } = await boot(t);
  vault.set("ragic_key", "KEY"); vault.set("ragic_host", fake.host); await svc.startStore();
  const o = config.ragic.operations, ops = fake.sheets[o.path].recs;
  for (let i = 0; i < 12; i++) ops.set(600 + i, { [o.code]: "DELTA" + i, [o.objet]: "Objet " + i });
  ops.set(700, { [o.code]: "AUTRE1" });
  const r = await svc.searchOperations("delta");
  assert.equal(r.length, 8); assert.equal(r[0]["CODE TRAVAUX"], "DELTA0"); assert.equal(r[0].Objet, "Objet 0"); assert.equal(typeof r[0].record_id, "number");
  vault.remove("google_refresh");
  await assert.rejects(() => svc.searchOperations("delta"), (e) => e.code === "needs_reauth");
});

test("courriel : seul le destinataire de la comptabilité est accepté", async (t) => {
  const { fake, vault, svc } = await boot(t);
  vault.set("ragic_key", "KEY"); vault.set("ragic_host", fake.host); await svc.startStore();
  await assert.rejects(() => svc.sendMail({ to: ["autre@exemple.fr"], subject: "s", body: "b" }), (e) => e.code === "forbidden");
});

test("base indisponible : erreur lisible, état « non prêt »", async (t) => {
  const { fake, vault, svc } = await boot(t);
  vault.set("ragic_key", "MAUVAISE"); vault.set("ragic_host", fake.host); await svc.startStore();
  const s = svc.state();
  assert.equal(s.ready, false); assert.equal(s.starting, false); assert.match(s.error.message, /Clé Ragic refusée/);
  assert.throws(() => svc.requireStore(), (e) => e.code === "not_ready");
});
