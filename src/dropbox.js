"use strict";
/* Liens vers les dossiers d'opérations de la Dropbox locale.
   Arborescence de l'agence : …\01-OPERATIONS\(A)\ALESIA100-A  (une lettre entre parenthèses, puis un dossier par indice). */
const fs = require("fs");
const path = require("path");

const ROOT_NAME = "01-OPERATIONS";
const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[\s\\/:*?"<>|]+/g, "");

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); }
  catch (e) { return []; }
}

/** Cherche un dossier nommé name (insensible à la casse) sous base, sur au plus maxDepth niveaux. */
function findDir(base, name, maxDepth, budget = { n: 6000 }) {
  const want = strip(name);
  let level = [base];
  for (let depth = 0; depth < maxDepth && level.length; depth++) {
    const next = [];
    for (const dir of level) {
      for (const d of subdirs(dir)) {
        if (--budget.n < 0) return null;
        if (strip(d) === want) return path.join(dir, d);
        next.push(path.join(dir, d));
      }
    }
    level = next;
  }
  return null;
}

/** À partir d'un dossier choisi par l'utilisateur (01-OPERATIONS lui-même, ou un dossier au-dessus), retrouve 01-OPERATIONS. */
function resolveRoot(chosen) {
  if (!chosen) return null;
  try { if (!fs.statSync(chosen).isDirectory()) return null; } catch (e) { return null; }
  if (strip(path.basename(chosen)) === strip(ROOT_NAME)) return chosen;
  return findDir(chosen, ROOT_NAME, 3) || chosen;
}

/** Détection automatique : emplacements indiqués par Dropbox (info.json), puis dossiers « …Dropbox… » du profil. */
function detectRoot(env = process.env, home = require("os").homedir()) {
  const bases = [];
  for (const dir of [env.APPDATA, env.LOCALAPPDATA].filter(Boolean)) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, "Dropbox", "info.json"), "utf8"));
      Object.values(info).forEach((v) => { if (v && v.path) bases.push(v.path); });
    } catch (e) { /* pas de fichier */ }
  }
  subdirs(home).filter((d) => /dropbox/i.test(d)).forEach((d) => bases.push(path.join(home, d)));
  for (const b of bases) { const r = findDir(b, ROOT_NAME, 3); if (r) return r; }
  return null;
}

/** Dossier d'un dossier de l'agence (ex. JUMIN11-D) ; à défaut, dossier de l'opération (JUMIN11). */
function findDossier(root, ref) {
  const code = strip(ref);
  if (!root || !code) return null;
  const first = code[0], letterDirs = subdirs(root).filter((d) => { const m = /^\((.)\)$/.exec(d); return m && (m[1].toUpperCase() === first || (!/[A-Z]/.test(first) && m[1] === "0")); });
  const tryNames = [code];
  const op = code.replace(/-[A-Z]$/, ""); if (op !== code) tryNames.push(op);
  for (const name of tryNames) {
    for (const ld of letterDirs) { const hit = findDir(path.join(root, ld), name, 2); if (hit) return hit; }
    const any = findDir(root, name, 3); if (any) return any;
  }
  return null;
}

module.exports = { ROOT_NAME, resolveRoot, detectRoot, findDossier, findDir };
