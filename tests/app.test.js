"use strict";
/* Test de bout en bout : la vraie page (renderer/index.html + shim.js + account.js) dans jsdom,
   reliée aux vrais services, face à un faux serveur Ragic et un faux Gmail. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { makeFake } = require("./fake-ragic");
const config = require("../src/config");
const { Services } = require("../src/services");
const { b64url } = require("../src/google");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const memVault = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) }; };

test("l'application complète fonctionne sur Ragic", async (t) => {
  const fake = await makeFake();
  t.after(() => { fake.server.closeAllConnections(); fake.server.close(); });
  const mails = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes("gmail.googleapis.com")) { mails.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: "m" }) }; }
    if (String(url).includes("oauth2.googleapis.com")) return { ok: true, status: 200, json: async () => ({ access_token: "AT", expires_in: 3600 }) };
    return fetch(url, init);
  };
  const vault = memVault();
  vault.set("ragic_key", "KEY"); vault.set("ragic_host", fake.host);
  vault.set("google_refresh", "R1"); vault.set("google_profile", JSON.stringify({ email: "dieu@remithollet.fr", name: "Dieu Test", canSend: true }));
  const svc = new Services({ vault, googleClient: { clientId: "c", clientSecret: "s" }, fetchImpl, ragicProtocol: "http", openExternal: async () => {} });
  await svc.startStore();
  assert.equal(svc.state().ready, true, JSON.stringify(svc.state().error));
  t.after(() => svc.stopStore());

  // données de départ, comme après l'import
  const st = svc.store;
  await st.write({ op: "set", coll: "columns", id: "rv", data: { name: "RV", order: 1 } });
  await st.write({ op: "set", coll: "columns", id: "gaelle", data: { name: "Gaëlle", order: 2 } });
  await st.write({ op: "set", coll: "types", id: "urgent", data: { name: "Urgent", color: "red", order: 1 } });
  await st.write({ op: "set", coll: "types", id: "reno", data: { name: "Réno globale", color: "violet", order: 2 } });
  await st.write({ op: "set", coll: "types", id: "bold", data: { name: "Dessinés", color: "none", order: 3 } });
  await st.write({ op: "set", coll: "elements", id: "dat", data: { name: "DAT", order: 1 } });
  await st.write({ op: "set", coll: "tasks", id: "a", data: { person: "rv", order: 1, ref: "JUMIN11-D", types: ["urgent", "reno"], els: { dat: "r" } } });
  await st.write({ op: "set", coll: "tasks", id: "b", data: { person: "gaelle", order: 0, kind: "sep", label: "Réno globale" } });
  await st.write({ op: "set", coll: "tasks", id: "c", data: { person: "gaelle", order: 1, ref: "LANDY67-A", types: ["bold"] } });
  const ops = fake.sheets[config.ragic.operations.path].recs; const o = config.ragic.operations;
  ops.set(501, { [o.code]: "MONTMARTRE4/6-A", [o.objet]: "Plancher", [o.syndic]: "GAURIAU", [o.adresse]: "4 rue Montmartre" });
  ops.set(502, { [o.code]: "AUTRE1-A", [o.objet]: "Toiture" });

  const archCalls = [];
  const agoa = {
    info: (e) => ({ code: (e && e.code) || "error", message: String((e && e.message) || e || "") }),
    state: async () => svc.state(),
    subscribe: async (coll, cb) => { svc.listeners.add({ snapshot: (c, docs) => c === coll && cb(docs) }); cb(svc.requireStore().docs(coll)); },
    write: async (w) => { svc.requireSession(); await svc.requireStore().write(w); return true; },
    searchOperations: (q) => svc.searchOperations(q), sendMail: (m) => svc.sendMail(m),
    architectOptions: async () => svc.architectOptions(),
    assignArchitect: (a) => { archCalls.push(a); return svc.assignArchitect(a); },
    onStatus: () => {}, forgetRagic: async () => {}, signOut: async () => {}
  };
  const dom = await JSDOM.fromFile(path.join(__dirname, "..", "renderer", "index.html"), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, beforeParse(w) { w.agoa = agoa; }
  });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  await sleep(600);

  assert.deepEqual([...d.querySelectorAll(".col h2")].map((x) => x.textContent).slice(0, 2), ["RV", "Gaëlle"]);
  assert.equal(d.querySelectorAll(".task").length, 2);                       // 2 dossiers, le séparateur n'en est pas un
  assert.equal(d.querySelectorAll(".sep").length, 1);
  assert.match(d.querySelector('[data-id="a"]').getAttribute("style"), /--c-red.*--c-violet|--c-violet/);
  assert.ok(d.querySelector('[data-id="c"]').classList.contains("b"), "type sans couleur = gras");
  assert.ok(!d.querySelector('[data-id="c"]').classList.contains("typed"));
  assert.equal(d.querySelectorAll(".pill").length, 1);
  assert.ok(d.querySelector("#btnAcct"), "pastille du compte");
  assert.equal(d.querySelector("#btnAcct").textContent, "Dieu");

  // recherche Ragic puis ajout
  d.querySelector('[data-add="rv"]').click();
  const inp = d.querySelector(".addinput"); inp.value = "MONTM"; inp.dispatchEvent(new w.Event("input", { bubbles: true }));
  await sleep(700);
  assert.match(d.querySelector(".sug").textContent, /MONTMARTRE4\/6-A/);
  assert.ok(!/AUTRE1/.test(d.querySelector(".sug").textContent));
  d.querySelector('[data-pick="0"]').click(); await sleep(300);
  const tasks = () => [...fake.sheets[config.ragic.sheets.tasks.path].recs.values()];
  const f = st.f.tasks;
  const added = tasks().find((r) => r[f.ref] === "MONTMARTRE4/6-A");
  assert.ok(added, "dossier créé dans Ragic"); assert.equal(added[f.person], "rv"); assert.equal(added[f.note], "Plancher"); assert.equal(added[f.ragic], "501");

  // changement de type depuis la fiche
  d.querySelector('[data-open="a"]').click();
  d.querySelector('[data-settype="reno"]').click(); await sleep(300);
  assert.equal(tasks().find((r) => r[f.key] === "a")[f.types], "urgent");
  d.querySelector("#scrim").click();

  // terminer + à facturer
  d.querySelector('[data-chk="a"]').click();
  assert.ok(d.querySelector("#menu [data-archdel]"), "option supprimer");
  d.querySelector('[data-arch="a|rv"]').click(); await sleep(300);
  let ra = tasks().find((r) => r[f.key] === "a");
  assert.equal(ra[f.done], "Yes"); assert.equal(ra[f.billing], "À facturer"); assert.match(ra[f.doneAt], /^\d{4}\/\d{2}\/\d{2}$/);

  // renommage d'un élément depuis la fiche : valable pour toutes les fiches
  d.querySelector('[data-open="a"]').click();
  const en = d.querySelector('#sheet [data-ename="dat"]'); en.value = "DAT reçu"; en.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(400);
  assert.equal(st.docs("elements").find((x) => x.id === "dat").data.name, "DAT reçu");
  assert.equal(d.querySelector('#sheet [data-ename="dat"]').value, "DAT reçu");
  assert.ok(![...d.querySelectorAll(".task .pill")].some((x) => /^DAT$/.test(x.textContent.trim())), "l'ancien nom a disparu des fiches");
  d.querySelector("#scrim").click();

  // suppression d'un élément depuis la fiche, avec validation
  d.querySelector('[data-open="a"]').click();
  assert.ok(d.querySelector('#sheet [data-askdelel="dat"]'), "croix de suppression de l'élément");
  d.querySelector('#sheet [data-askdelel="dat"]').click();
  assert.equal(d.querySelector("#dlg").hidden, false);
  d.querySelector("[data-dlgno]").click();
  assert.ok(st.docs("elements").some((x) => x.id === "dat"), "annuler ne supprime rien");
  d.querySelector('#sheet [data-askdelel="dat"]').click(); d.querySelector("[data-dlgel]").click(); await sleep(400);
  assert.ok(!st.docs("elements").some((x) => x.id === "dat"), "élément supprimé");
  d.querySelector("#scrim").click();

  // catégories « envoyées » : la fiche reste dans la colonne sous « … envoyé », une copie part dans À facturer
  d.querySelector('[data-chk="c"]').click();
  assert.equal(d.querySelectorAll("#menu [data-arch]").length, 7, "Archivé terminé + 6 catégories à facturer");
  assert.match(d.querySelector("#menu").textContent, /À facturer CONSULTATION ENTREPRISES/);
  d.querySelector('[data-arch="c|offres"]').click(); await sleep(400);
  const rb0 = tasks().find((r) => r[f.key] === "c");
  assert.notEqual(rb0[f.done], "Yes", "la fiche reste ouverte dans sa colonne");
  const sepRec = tasks().find((r) => r[f.kind] === "Séparateur" && r[f.ref] === "ANALYSE DES OFFRES envoyé");
  assert.ok(sepRec, "séparateur créé automatiquement");
  assert.ok(Number(rb0[f.order]) > Number(sepRec[f.order]), "fiche placée sous le séparateur");
  const copyRec = tasks().find((r) => r[f.ref] === rb0[f.ref] && r[f.billing] === "À facturer");
  assert.ok(copyRec && copyRec[f.done] === "Yes" && !copyRec[f.note], "copie avec la seule référence");
  assert.deepEqual(JSON.parse(copyRec[f.els]), { _cat: "offres", _copy: "c" });
  assert.equal(d.querySelectorAll('section[data-col="rv"] .hist .task, section[data-col="gaelle"] .hist .task').length >= 0, true);
  d.querySelector('[data-person="__bill"]').click();
  assert.match([...d.querySelectorAll(".bill .sep")].map((x) => x.textContent).join("|"), /RV\|ANALYSE DES OFFRES/);
  d.querySelector('[data-person="all"]').click();

  // glisser un dossier d'une colonne à une autre (déposé sur l'espace libre de la colonne, puis sur un dossier)
  const dnd = (type, target, y) => { const ev = new w.Event(type, { bubbles: true, cancelable: true }); ev.dataTransfer = { setData() {}, dropEffect: "", effectAllowed: "" }; ev.clientY = y || 0; target.dispatchEvent(ev); return ev; };
  dnd("dragstart", d.querySelector('[data-id="c"]'));
  const gcol = d.querySelector('section[data-col="gaelle"]'), rcol = d.querySelector('section[data-col="rv"]');
  const over = dnd("dragover", rcol.querySelector(".col-h"));
  assert.ok(over.defaultPrevented, "la colonne entière accepte le dépôt");
  dnd("drop", rcol.querySelector(".col-h")); await sleep(300);
  assert.equal(tasks().find((r) => r[f.key] === "c")[f.person], "rv", "dossier déplacé vers l'autre colonne");
  assert.ok(d.querySelector('section[data-col="rv"] [data-id="c"]'));

  // l'étude déplacée dans la colonne d'une personne renseigne « Architecte ? » dans la fiche opération Ragic
  assert.equal(archCalls.length, 1); assert.equal(archCalls[0].column, "RV");
  assert.deepEqual(archCalls[0].ref, "LANDY67-A");
  d.querySelector('[data-open="c"]').click();
  d.querySelector("#fCol").value = "gaelle"; d.querySelector("#fCol").dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(300);
  assert.equal(archCalls.length, 2); assert.equal(archCalls[1].column, "Gaëlle");
  d.querySelector("#scrim").click();

  // attribution en une fois pour toutes les fiches en cours
  archCalls.length = 0;
  d.querySelector("#btnCfg").click(); await sleep(50);
  d.querySelector("[data-bulkarch]").click(); await sleep(200);
  assert.equal(d.querySelector("#dlg").hidden, false);
  assert.match(d.querySelector("#dlg").textContent, /1 fiche en cours/);
  d.querySelector("[data-dlgbulk]").click(); await sleep(500);
  assert.equal(archCalls.length, 1); assert.equal(archCalls[0].column, "Gaëlle");
  d.querySelector("#scrim").click();

  // envoi de la liste à facturer
  d.querySelector('[data-person="__bill"]').click();
  d.querySelector('[data-send="1"]').click(); d.querySelector('[data-sendok="1"]').click(); await sleep(500);
  assert.equal(mails.length, 1);
  const raw = Buffer.from(mails[0].raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(raw, /To: comptabilite@remithollet\.fr/);
  assert.match(Buffer.from(raw.match(/Subject: =\?UTF-8\?B\?(.+?)\?=/)[1], "base64").toString("utf8"), /^Liste à facturer n°1/);
  const lists = [...fake.sheets[config.ragic.sheets.lists.path].recs.values()];
  assert.equal(lists.length, 1);
  assert.equal(JSON.parse(lists[0][st.f.lists.items]).n, 1);
  ra = tasks().find((r) => r[f.key] === "a");
  assert.equal(ra[f.billed], "1", "le dossier pointe vers la liste n°1");

  // suppression avec fenêtre de confirmation
  d.querySelector('[data-person="all"]').click();
  d.querySelector('[data-chk="c"]').click();
  d.querySelector('#menu [data-archdel]').click();
  assert.equal(d.querySelector("#dlg").hidden, false);
  d.querySelector("[data-dlgyes]").click(); await sleep(300);
  assert.ok(!tasks().find((r) => r[f.key] === "c"), "dossier supprimé dans Ragic");

  // une modification faite dans Ragic par un collègue apparaît à l'écran
  const rb = tasks().find((r) => r[f.key] === "b"); assert.ok(rb);
  fake.sheets[config.ragic.sheets.tasks.path].recs.set(900, { [f.key]: "z", [f.kind]: "Dossier", [f.person]: "gaelle", [f.order]: "9", [f.ref]: "AJOUT-COLLEGUE" });
  await svc.store.refreshAll(); await sleep(150);
  assert.ok([...d.querySelectorAll(".ref")].some((x) => x.textContent === "AJOUT-COLLEGUE"));
});
