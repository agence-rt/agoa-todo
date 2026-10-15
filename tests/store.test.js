"use strict";
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { makeFake } = require("./fake-ragic");
const config = require("../src/config");
const { RagicClient, RagicError, detectHost } = require("../src/ragic");
const { RagicStore } = require("../src/store");

const fakes = [];
after(() => fakes.forEach((f) => { f.server.closeAllConnections(); f.server.close(); }));
async function setup(opts) {
  const fake = await makeFake(opts); fakes.push(fake);
  const client = new RagicClient({ host: fake.host, apname: "agoa", apiKey: "KEY", protocol: "http" });
  const store = new RagicStore({ client, config });
  return { fake, client, store };
}
const P = config.ragic.sheets;

test("client : clé refusée -> erreur auth ; détection du serveur", async () => {
  const fake = await makeFake(); fakes.push(fake);
  const bad = new RagicClient({ host: fake.host, apname: "agoa", apiKey: "NOPE", protocol: "http" });
  await assert.rejects(() => bad.list(P.tasks.path), (e) => e instanceof RagicError && e.code === "auth");
  const h = await detectHost("KEY", { apname: "agoa", hosts: ["127.0.0.1:1", fake.host], probePath: P.tasks.path, protocol: "http" });
  assert.equal(h, fake.host);
  await assert.rejects(() => detectHost("NOPE", { apname: "agoa", hosts: [fake.host], probePath: P.tasks.path, protocol: "http" }), (e) => e.code === "auth");
});

test("init : champs résolus par libellé ; erreur claire si « Clé » manque", async () => {
  const { fake, store } = await setup();
  await store.init();
  assert.ok(store.f.tasks.key >= 9000000, "Clé trouvée via le schéma");
  assert.equal(store.f.tasks.ref, 1003101);

  const fake2 = await makeFake(); fakes.push(fake2);
  fake2.schema[P.types.path] = fake2.schema[P.types.path].filter((f) => f.fieldName !== "Nom");
  const client = new RagicClient({ host: fake2.host, apname: "agoa", apiKey: "KEY", protocol: "http" });
  const st = new RagicStore({ client, config });
  await assert.rejects(() => st.init(), (e) => e.code === "missing_field" && /Nom/.test(e.message) && /rendez-vous\/7/.test(e.message));
});

test("sans accès au schéma : retombe sur les identifiants par défaut (Clé manquante -> erreur claire)", async () => {
  const { fake, store } = await setup({ withSchema: false });
  await assert.rejects(() => store.init(), (e) => e.code === "missing_field" && /Clé/.test(e.message));
});

test("création / mise à jour / suppression d'un dossier et conversions", async () => {
  const { fake, store } = await setup();
  await store.init();
  await store.write({ op: "set", coll: "columns", id: "rv", data: { name: "RV", order: 1 } });
  await store.write({ op: "set", coll: "types", id: "urgent", data: { name: "Urgent", color: "red", order: 1 } });
  await store.write({ op: "set", coll: "tasks", id: "t1", data: { person: "rv", order: 1, ref: "JUMIN11-D", note: "façade", types: ["urgent"], els: { dat: "r" }, ragic: "123" } });
  let rec = [...fake.sheets[P.tasks.path].recs.values()][0];
  const f = store.f.tasks;
  assert.equal(rec[f.key], "t1"); assert.equal(rec[f.kind], "Dossier"); assert.equal(rec[f.person], "rv");
  assert.equal(rec[f.types], "urgent"); assert.equal(rec[f.els], '{"dat":"r"}'); assert.ok(!rec[f.done]);

  await store.write({ op: "update", coll: "tasks", id: "t1", data: { done: true, doneAt: "2026-10-13", billing: "tobill", types: ["urgent", "struct"], status: "", drawn: true } });
  rec = [...fake.sheets[P.tasks.path].recs.values()][0];
  assert.equal(rec[f.done], "Yes"); assert.equal(rec[f.doneAt], "2026/10/13"); assert.equal(rec[f.billing], "À facturer"); assert.equal(rec[f.types], "urgent,struct");

  const d = store.docs("tasks").find((x) => x.id === "t1").data;
  assert.deepEqual(d.types, ["urgent", "struct"]); assert.equal(d.done, true); assert.equal(d.doneAt, "2026-10-13");
  assert.equal(d.billing, "tobill"); assert.deepEqual(d.els, { dat: "r" }); assert.equal(d.ragic, "123"); assert.equal(d.order, 1);

  await store.write({ op: "delete", coll: "tasks", id: "t1" });
  assert.equal(fake.sheets[P.tasks.path].recs.size, 0); assert.equal(store.docs("tasks").length, 0);
});

test("séparateurs, listes à facturer et lien dossier -> liste (même si écrits en rafale)", async () => {
  const { fake, store } = await setup();
  await store.init();
  await store.write({ op: "set", coll: "tasks", id: "s1", data: { kind: "sep", label: "Réno globale", person: "gaelle", order: 0 } });
  assert.deepEqual(store.docs("tasks")[0].data, { kind: "sep", label: "Réno globale", person: "gaelle", order: 0 });
  await store.write({ op: "set", coll: "tasks", id: "t1", data: { person: "rv", order: 1, ref: "A", done: true, doneAt: "2026-10-13", billing: "tobill" } });
  const items = [{ ref: "A", note: "", col: "RV", doneAt: "2026-10-13" }];
  const sentAt = "2026-10-13T16:00:00.000Z";
  // rafale : la liste est créée puis le dossier la référence, sans attendre
  const w1 = store.write({ op: "set", coll: "lists", id: "l1", data: { n: 3, sentAt, items } });
  const w2 = store.write({ op: "update", coll: "tasks", id: "t1", data: { billed: "l1" } });
  await Promise.all([w1, w2]);
  const rec = [...fake.sheets[P.tasks.path].recs.values()].find((r) => r[store.f.tasks.key] === "t1");
  assert.equal(rec[store.f.tasks.billed], "3");
  const lrec = [...fake.sheets[P.lists.path].recs.values()][0];
  assert.deepEqual(JSON.parse(lrec[store.f.lists.items]), { n: 3, items });
  assert.equal(lrec[store.f.lists.count], "1");
  const l = store.docs("lists")[0].data;
  assert.equal(l.n, 3); assert.deepEqual(l.items, items); assert.equal(new Date(l.sentAt).toISOString(), sentAt);
  assert.equal(store.docs("tasks").find((x) => x.id === "t1").data.billed, "l1");
});

test("lecture : une modification faite dans Ragic apparaît ; fiche saisie à la main sans Clé", async () => {
  const { fake, store } = await setup();
  await store.init();
  const snaps = []; store.on("snapshot", (c, docs) => snaps.push([c, docs.length]));
  const f = store.f.tasks;
  fake.sheets[P.tasks.path].recs.set(77, { [f.ref]: "MANUEL1", [f.person]: "rv", [f.order]: "5", [f.done]: "Oui" });
  await store.refreshAll();
  const d = store.docs("tasks");
  assert.equal(d.length, 1); assert.equal(d[0].id, "r77"); assert.equal(d[0].data.ref, "MANUEL1"); assert.equal(d[0].data.done, true); assert.equal(d[0].data.order, 5);
  assert.ok(snaps.some(([c]) => c === "tasks"));
  const n = snaps.length; await store.refreshAll(); assert.equal(snaps.length, n, "pas de nouvel instantané si rien n'a changé");
  await store.write({ op: "update", coll: "tasks", id: "r77", data: { note: "ok" } });
  assert.equal(fake.sheets[P.tasks.path].recs.get(77)[f.note], "ok");
});

test("mise à jour d'une fiche inconnue : erreur not_found", async () => {
  const { fake, store } = await setup();
  await store.init();
  await assert.rejects(() => store.write({ op: "update", coll: "tasks", id: "nope", data: { note: "x" } }), (e) => e.code === "not_found");
});

test("Ragic qui refuse (status INVALID) : le message de Ragic remonte", async () => {
  const { RagicClient } = require("../src/ragic");
  const fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "INVALID", msg: "Le champ « CLé » est obligatoire." }) });
  const c = new RagicClient({ host: "www.ragic.com", apname: "agoa", apiKey: "K", fetchImpl: fetch });
  await assert.rejects(() => c.create("/rendez-vous/6", { 1: "x" }), /obligatoire/);
});
test("Ragic qui répond sans identifiant : la réponse brute est indiquée", async () => {
  const { RagicClient } = require("../src/ragic");
  const fetch = async () => ({ ok: true, status: 200, text: async () => "{}" });
  const c = new RagicClient({ host: "www.ragic.com", apname: "agoa", apiKey: "K", fetchImpl: fetch });
  await assert.rejects(() => c.create("/rendez-vous/6", { 1: "x" }), /réponse : \{\}/);
});
