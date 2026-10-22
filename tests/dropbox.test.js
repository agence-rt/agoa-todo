"use strict";
const test = require("node:test"); const assert = require("node:assert/strict");
const fs = require("fs"); const os = require("os"); const path = require("path");
const { resolveRoot, detectRoot, findDossier } = require("../src/dropbox");

function tree() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-"));
  const ops = path.join(base, "T&K Dropbox", "Agence T&K", "01-OPERATIONS");
  for (const p of ["(A)/ALESIA100/A - TOITURE", "(J)/JUMIN11/D - FACADE RUE", "(J)/JUMIN11/E - CAVES", "(0)/1RUE2/A - DIVERS", "(B)/BANQUIER33-33bis/A - PARTIES COMMUNES", "(S)/STDIDIER55-57/D - MURET RUE", "(S)/STDIDIER55-57/B - RAVALEMENT", "(S)/STOUEN7/A - X"]) fs.mkdirSync(path.join(ops, p), { recursive: true });
  return { base, ops };
}

test("trouve le dossier d'une fiche : lettre, immeuble, puis indice « D - OBJET »", () => {
  const { base, ops } = tree();
  assert.equal(findDossier(ops, "JUMIN11-D"), path.join(ops, "(J)", "JUMIN11", "D - FACADE RUE"));
  assert.equal(findDossier(ops, "jumin11-e"), path.join(ops, "(J)", "JUMIN11", "E - CAVES"));
  assert.equal(findDossier(ops, "1RUE2-A"), path.join(ops, "(0)", "1RUE2", "A - DIVERS"));
  assert.equal(findDossier(ops, "BANQUIER33-33bis-A"), path.join(ops, "(B)", "BANQUIER33-33bis", "A - PARTIES COMMUNES"));
  assert.equal(findDossier(ops, "STOUEN7-J"), path.join(ops, "(S)", "STOUEN7"), "indice absent : dossier de l'immeuble");
  assert.equal(findDossier(ops, "INCONNU1-A"), null);
  assert.equal(findDossier(ops, ""), null);
  fs.rmSync(base, { recursive: true });
});

test("le « / » d'une référence devient « - » ou « _ » dans Dropbox", () => {
  const { base, ops } = tree();
  const want = path.join(ops, "(S)", "STDIDIER55-57", "D - MURET RUE");
  assert.equal(findDossier(ops, "STDIDIER55/57-D"), want);
  assert.equal(findDossier(ops, "STDIDIER55_57-D"), want);
  assert.equal(findDossier(ops, "STDIDIER55-57-D"), want);
  fs.rmSync(base, { recursive: true });
});

test("retrouve 01-OPERATIONS depuis un dossier choisi plus haut, ou par info.json", () => {
  const { base, ops } = tree();
  assert.equal(resolveRoot(ops), ops);
  assert.equal(resolveRoot(path.join(base, "T&K Dropbox")), ops);
  assert.equal(resolveRoot(path.join(base, "absent")), null);
  const appdata = path.join(base, "appdata"); fs.mkdirSync(path.join(appdata, "Dropbox"), { recursive: true });
  fs.writeFileSync(path.join(appdata, "Dropbox", "info.json"), JSON.stringify({ business: { path: path.join(base, "T&K Dropbox") } }));
  assert.equal(detectRoot({ APPDATA: appdata }, path.join(base, "vide")), ops);
  fs.rmSync(base, { recursive: true });
});
