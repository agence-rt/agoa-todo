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

test("init : champs résolus par libellé, identifiants par défaut en secours", async () => {
  const { fake, store } = await setup();
  await store.init();
  assert.equal(store.f.tasks.key, 1003122, "Clé résolue");
  assert.equal(store.f.tasks.ref, 1003101);

  const fake2 = await makeFake(); fakes.push(fake2);
  fake2.schema[P.types.path] = fake2.schema[P.types.path].filter((f) => f.fieldName !== "Nom");
  const client = new RagicClient({ host: fake2.host, apname: "agoa", apiKey: "KEY", protocol: "http" });
  const st = new RagicStore({ client, config });
  await st.init();   // « Nom » absent du schéma : l'identifiant par défaut prend le relais
  assert.equal(st.f.types.name, 1003118);
});

test("sans accès au schéma (clé non gestionnaire) : retombe sur les identifiants par défaut, « Clé » comprise", async () => {
  const { fake, store } = await setup({ withSchema: false });
  await store.init();
  assert.equal(store.f.columns.key, 1003120); assert.equal(store.f.tasks.key, 1003122); assert.equal(store.f.lists.key, 1003123);
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

  // catégorie de facturation et copie : conservées à côté des éléments, sans les polluer
  await store.write({ op: "update", coll: "tasks", id: "t1", data: { billCat: "dtg", copyOf: "x9" } });
  let d2 = store.docs("tasks").find((x) => x.id === "t1").data;
  assert.equal(d2.billCat, "dtg"); assert.equal(d2.copyOf, "x9"); assert.deepEqual(d2.els, { dat: "r" });
  await store.write({ op: "update", coll: "tasks", id: "t1", data: { els: { dat: "g" } } });
  d2 = store.docs("tasks").find((x) => x.id === "t1").data;
  assert.equal(d2.billCat, "dtg", "modifier les éléments garde la catégorie"); assert.deepEqual(d2.els, { dat: "g" });

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

test("redirection Ragic : le POST reste un POST et suit le bon serveur", async () => {
  const { RagicClient } = require("../src/ragic");
  const calls = [];
  const fetchImpl = async (url, o) => {
    calls.push([o.method, new URL(url).host, o.body]);
    if (new URL(url).host === "www.ragic.com") return { status: 302, ok: false, headers: { get: () => "https://eu2.ragic.com/agoa/rendez-vous/6?api&v=3&APIKey=K" }, text: async () => "" };
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ status: "SUCCESS", rv: "77" }) };
  };
  const c = new RagicClient({ host: "www.ragic.com", apname: "agoa", apiKey: "K", fetchImpl });
  assert.equal(await c.create("/rendez-vous/6", { 1003085: "RV" }), 77);
  assert.deepEqual(calls.map((x) => x[0] + " " + x[1]), ["POST www.ragic.com", "POST eu2.ragic.com"]);
  assert.equal(calls[1][2], "1003085=RV");
  assert.equal(c.host, "eu2.ragic.com");
});

test("clé valide mais sans droit sur la feuille : message clair, pas « invité » du dernier serveur", async () => {
  const { detectHost } = require("../src/ragic");
  const fetchImpl = async (url) => {
    const h = new URL(url).host;
    const msg = h === "eu2.ragic.com" ? "This sheet is access right protected. You are currently accessing as: paul@remithollet.fr" : "This sheet is access right protected. You are currently accessing as: guest account";
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ status: "ERROR", code: 403, msg }) };
  };
  await assert.rejects(() => detectHost("K", { apname: "agoa", hosts: ["www.ragic.com", "eu2.ragic.com", "ap5.ragic.com"], probePath: "/rendez-vous/9", fetchImpl }), /paul@remithollet\.fr.*n’a pas accès/);
});

test("tous les champs ont un identifiant par défaut (clé non gestionnaire : pas de schéma Ragic)", () => {
  for (const [coll, sh] of Object.entries(config.ragic.sheets))
    for (const [k, d] of Object.entries(sh.fields)) assert.ok(d.id, coll + "." + k + " sans identifiant");
});

test("rattacher un dossier à une liste absente de l'état local : relecture, puis erreur claire (jamais d'écriture vide)", async () => {
  const { fake, store } = await setup();
  await store.init();
  await store.write({ op: "set", coll: "columns", id: "rv", data: { name: "RV", order: 1 } });
  await store.write({ op: "set", coll: "tasks", id: "a", data: { person: "rv", order: 1, ref: "X", done: true, doneAt: "2026-10-15", billing: "tobill" } });
  await store.write({ op: "set", coll: "lists", id: "L1", data: { n: 1, sentAt: new Date().toISOString(), items: [] } });
  store.raw.lists.delete("L1");                     // état local périmé
  await store.write({ op: "update", coll: "tasks", id: "a", data: { billed: "L1" } });
  assert.equal(store.docs("tasks").find((d) => d.id === "a").data.billed, "L1");
  await assert.rejects(() => store.write({ op: "update", coll: "tasks", id: "a", data: { billed: "NOPE" } }), (e) => e.code === "list_missing");
});
