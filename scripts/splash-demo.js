"use strict";
/* Montre l'écran de chargement dans ses différents états et en fait des captures (xvfb-run npx electron --no-sandbox scripts/splash-demo.js, AGOA_SHOT_DIR=dossier). */
const { app, BrowserWindow } = require("electron");
const fs = require("fs"); const path = require("path"); const os = require("os");
const { createSplash } = require("../src/splash");
const out = process.env.AGOA_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "agoa-splash-"));
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const s = createSplash({ BrowserWindow, version: require("../package.json").version, rendererDir: path.join(__dirname, "..", "renderer") });
  await sleep(1200);
  const states = [
    ["1-recherche", { text: "Recherche de mises à jour…", progress: null }],
    ["2-telechargement", { text: "Téléchargement de la mise à jour… 62 %", progress: 62 }],
    ["3-installation", { text: "Installation de la mise à jour…", progress: 100 }],
    ["4-demarrage", { text: "Démarrage…", progress: null }]
  ];
  for (const [name, st] of states) {
    s.status(st); await sleep(500);
    const img = await s.win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `splash-${name}.png`), img.toPNG()); console.log("SHOT", name);
  }
  app.exit(0);
});
