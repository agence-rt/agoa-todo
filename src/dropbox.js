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

/* Clé de comparaison : sans accents ni casse ni séparateurs, car « / » devient « - » ou « _ » dans Dropbox (STDIDIER55/57 -> STDIDIER55-57) */
const loose = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "");

/** Sépare une référence en immeuble et indice : « STDIDIER55/57-D » -> { building: "STDIDIER55/57", index: "D" } */
function splitRef(ref) {
  const r = String(ref || "").trim();
  const m = /^(.*?)[\s_-]+([A-Za-z]{1,2})$/.exec(r);
  return m && m[1] ? { building: m[1], index: m[2] } : { building: r, index: "" };
}

/** Dossier d'une fiche : 01-OPERATIONS\(S)\STDIDIER55-57\D - MURET RUE ; à défaut de l'indice, le dossier de l'immeuble. */
function findDossier(root, ref) {
  const { building, index } = splitRef(ref);
  const key = loose(building);
  if (!root || !key) return null;
  const first = key[0];
  const letterDirs = subdirs(root).filter((d) => { const m = /^\((.)\)$/.exec(d); return m && (m[1].toUpperCase() === first || (/[0-9]/.test(first) && m[1] === "0")); });
  const matchIn = (dir) => subdirs(dir).find((d) => loose(d) === key);
  let op = null;
  for (const ld of letterDirs) { const hit = matchIn(path.join(root, ld)); if (hit) { op = path.join(root, ld, hit); break; } }
  if (!op) op = findDir2(root, key);
  if (!op) return null;
  if (index) {
    const want = index.toUpperCase();
    const sub = subdirs(op).find((d) => { const m = /^([A-Za-z]{1,2})(?:\s*-\s*.*)?$/.exec(d.trim()); return m && m[1].toUpperCase() === want && (d.trim().length === m[1].length || /^\S+\s*-/.test(d.trim())); });
    if (sub) return path.join(op, sub);
  }
  return op;
}
function findDir2(root, key) {
  let level = [root];
  for (let depth = 0; depth < 2; depth++) {
    const next = [];
    for (const dir of level) for (const d of subdirs(dir)) { if (loose(d) === key) return path.join(dir, d); next.push(path.join(dir, d)); }
    level = next;
  }
  return null;
}

module.exports = { ROOT_NAME, resolveRoot, detectRoot, findDossier, findDir };
