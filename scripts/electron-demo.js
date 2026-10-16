"use strict";
/* Lance la vraie application Electron face à un faux Ragic rempli d'exemples, et enregistre une capture.
   xvfb-run -a npx electron --no-sandbox --disable-gpu scripts/electron-demo.js   (AGOA_SHOT_DIR=dossier) */
process.env.AGOA_INSECURE_VAULT = "1";
process.env.AGOA_NO_SPLASH = "1";
const { app } = require("electron");
const fs = require("fs"); const os = require("os"); const path = require("path");
const out = process.env.AGOA_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "agoa-shot-"));
fs.mkdirSync(out, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), "agoa-ud-"));
app.setPath("userData", ud);

(async () => {
  await app.whenReady();
  const { makeFake } = require("../tests/fake-ragic");
  const config = require("../src/config");
  const { RagicClient } = require("../src/ragic");
  const { RagicStore } = require("../src/store");
  const { Vault } = require("../src/vault");
  const fake = await makeFake();
  const client = new RagicClient({ host: fake.host, apname: "agoa", apiKey: "KEY", protocol: "http" });
  const st = new RagicStore({ client, config }); await st.init();
  const w = (coll, id, data) => st.write({ op: "set", coll, id, data });
  const cols = [["rv", "RV"], ["dtg", "DTG"], ["gaelle", "Gaëlle"], ["marie", "Marie"], ["hernan", "Hernan"]];
  for (let i = 0; i < cols.length; i++) await w("columns", cols[i][0], { name: cols[i][1], order: i + 1 });
  await w("types", "urgent", { name: "Urgent", color: "red", order: 1 }); await w("types", "reno", { name: "Réno globale", color: "violet", order: 2 });
  await w("types", "struct", { name: "Structure", color: "#f08000", order: 3 }); await w("types", "draw", { name: "Dessinés", color: "none", order: 4 });
  await w("elements", "dat", { name: "DAT", order: 1 }); await w("elements", "sol", { name: "Étude sol", order: 2 });
  const T = [
    ["rv", "JUMIN11-D", "façade rue", ["urgent", "reno"], { dat: "r", sol: "g" }], ["rv", "STOUEN7-J", "attente DAT, VMC", ["reno", "draw"], { dat: "r" }],
    ["dtg", "DESGRAIS1-7-75019", "", ["struct"], {}], ["gaelle", "DELTA14-E", "façade rue simple", ["draw"], { dat: "g" }],
    ["gaelle", "LANDY67-A", "", ["urgent", "reno", "struct"], {}], ["marie", "GERMAIN3-D", "", ["draw"], {}], ["hernan", "VESALE9-C", "façade cour", [], { dat: "g" }]];
  for (let i = 0; i < T.length; i++) await w("tasks", "t" + i, { person: T[i][0], order: i, ref: T[i][1], note: T[i][2], types: T[i][3], els: T[i][4] });
  await w("tasks", "s1", { kind: "sep", label: "Études", person: "gaelle", order: 9 });
  const day = (n) => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const D = [["gaelle", "OLD1-A", 45], ["gaelle", "MONTH1-B", 25], ["gaelle", "WEEK1-C", 8], ["gaelle", "NOW1-D", 1]];
  for (let i = 0; i < D.length; i++) await w("tasks", "d" + i, { person: D[i][0], order: 50 + i, ref: D[i][1], note: "", types: [], els: {}, done: true, doneAt: day(D[i][2]), billing: "none" });
  await w("tasks", "s2", { kind: "sep", label: "ANALYSE DES OFFRES envoyé", person: "gaelle", order: 20 });
  await w("tasks", "b1", { person: "rv", order: 30, ref: "PIGALLE67-A", note: "", types: [], els: {}, done: true, doneAt: day(1), billing: "tobill", billCat: "dtg" });
  await w("tasks", "b2", { person: "dtg", order: 31, ref: "BELLEVILLE112-D", note: "", types: [], els: {}, done: true, doneAt: day(2), billing: "tobill", billCat: "rv" });
  await w("tasks", "b3", { person: "gaelle", order: 32, ref: "LANDY67-A", note: "", types: [], els: {}, done: true, doneAt: day(0), billing: "tobill", billCat: "offres", copyOf: "t4" });
  st.stop();

  const vault = new Vault(path.join(ud, "vault.json"), { encrypt: (s) => Buffer.from(s, "utf8"), decrypt: (b) => b.toString("utf8") });
  vault.set("ragic_key", "KEY"); vault.set("ragic_host", fake.host);
  vault.set("google_refresh", "R"); vault.set("google_profile", JSON.stringify({ email: "dieu@remithollet.fr", name: "Dieu Test", canSend: true }));
  process.env.AGOA_RAGIC_PROTOCOL = "http";
  require("../main.js");

  app.on("browser-window-created", (_e, win) => {
    const shoot = async () => {
      await new Promise((r) => setTimeout(r, 2500));
      const url = win.webContents.getURL();
      if (process.env.AGOA_DEMO_JS) { await win.webContents.executeJavaScript(process.env.AGOA_DEMO_JS); await new Promise((r) => setTimeout(r, 600)); }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, "app.png"), img.toPNG());
      console.log("DEMO url=" + url.split("/").pop(), "shot=" + path.join(out, "app.png"));
      app.exit(/index\.html/.test(url) ? 0 : 2);
    };
    win.webContents.on("did-finish-load", () => { if (!shoot.started && /gate\.html/.test(win.webContents.getURL())) { /* attend la redirection */ } });
    win.webContents.on("did-navigate-in-page", () => {});
    setTimeout(shoot, 100);
  });
})().catch((e) => { console.error("DEMO-ERR", e); app.exit(3); });
