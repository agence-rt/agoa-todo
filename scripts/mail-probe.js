"use strict";
/* Essai : que voit la page quand l'envoi de courriel échoue ? (xvfb-run npx electron --no-sandbox scripts/mail-probe.js) */
process.env.AGOA_INSECURE_VAULT = "1"; process.env.AGOA_NO_SPLASH = "1";
const { app } = require("electron");
const fs = require("fs"), os = require("os"), path = require("path");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "agoa-ud-")));
(async () => {
  await app.whenReady();
  const { makeFake } = require("../tests/fake-ragic"); const { Vault } = require("../src/vault");
  const fake = await makeFake();
  const vault = new Vault(path.join(app.getPath("userData"), "vault.json"), { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() });
  vault.set("ragic_key", "KEY"); vault.set("ragic_host", fake.host); vault.set("google_refresh", "R");
  vault.set("google_profile", JSON.stringify({ email: "d@remithollet.fr", name: "D", canSend: true }));
  process.env.AGOA_RAGIC_PROTOCOL = "http";
  require("../main.js");
  app.on("browser-window-created", (_e, win) => win.webContents.on("did-finish-load", async () => {
    if (!/gate|index/.test(win.webContents.getURL())) return;
    await new Promise((r) => setTimeout(r, 2500));
    const out = await win.webContents.executeJavaScript(`window.agoa.sendMail({to:["comptabilite@remithollet.fr"],subject:"t",body:"b"}).then(()=>"ok",e=>JSON.stringify({isErr:e instanceof Error,code:e&&e.code,name:e&&e.name,message:e&&e.message,str:String(e)}))`);
    console.log("PROBE", out); app.exit(0);
  }));
})();
