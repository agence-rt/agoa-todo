"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeFake } = require("./fake-ragic");
const config = require("../src/config");
const { Services } = require("../src/services");
const { readShared, fromEnv } = require("../src/shared");

const memVault = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), has: (k) => m.has(k) }; };

test("variables d'environnement du launcher", () => {
  const s = fromEnv({ AGOA_RAGIC_KEY: "K", AGOA_RAGIC_HOST: "eu2.ragic.com", AGOA_GOOGLE_REFRESH_TOKEN: "R", AGOA_GOOGLE_EMAIL: "a@remithollet.fr", AGOA_GOOGLE_CLIENT_ID: "cid", AGOA_ANTHROPIC_API_KEY: "sk-ant-x" });
  assert.equal(s.ragic.host, "eu2.ragic.com"); assert.equal(s.google.client_id, "cid"); assert.equal(s.anthropic.key, "sk-ant-x");
  assert.deepEqual(fromEnv({}), {});
});

test("fichier chiffré lu via PowerShell (Windows), repli sur l'environnement", async () => {
  const exec = (cmd, args, opts, cb) => { assert.equal(cmd, "powershell"); assert.match(opts.env.AGOA_CONN_FILE, /_connexions[\\/]connexions\.dat$/); cb(null, "﻿" + JSON.stringify({ ragic: { key: "FILEKEY", host: "h" } })); };
  const s = await readShared({ env: { AGOA_RAGIC_KEY: "ENVKEY", AGOA_RAGIC_HOST: "h" }, platform: "win32", exec });
  assert.equal(s.ragic.key, "FILEKEY", "le fichier (à jour) prime sur l'environnement");
  const bad = (cmd, args, opts, cb) => cb(new Error("absent"));
  const s2 = await readShared({ env: { AGOA_RAGIC_KEY: "ENVKEY", AGOA_RAGIC_HOST: "h" }, platform: "win32", exec: bad });
  assert.equal(s2.ragic.key, "ENVKEY");
  assert.deepEqual(await readShared({ env: {}, platform: "linux" }), {});
});

async function boot(t, shared) {
  const fake = await makeFake();
  t.after(() => { fake.server.closeAllConnections(); fake.server.close(); });
  const vault = memVault();
  const svc = new Services({ vault, googleClient: { clientId: "cid", clientSecret: "s" }, ragicProtocol: "http", openExternal: async () => {}, fetchImpl: (u, i) => fetch(u, i), shared: async () => shared(fake) });
  t.after(() => svc.stopStore());
  return { fake, vault, svc };
}

test("connexions du launcher : Ragic et Google repris sans saisie", async (t) => {
  const { vault, svc } = await boot(t, (fake) => ({
    ragic: { key: "KEY", host: fake.host },
    google: { refresh_token: "RT", email: "Dieu@remithollet.fr", name: "Dieu", scopes: "openid gmail.send", client_id: "cid" }
  }));
  await svc.startStore();
  const st = svc.state();
  assert.equal(st.ragicConfigured, true); assert.equal(st.ready, true); assert.equal(st.signedIn, true);
  assert.equal(st.sharedRagic, true); assert.equal(st.sharedGoogle, true);
  assert.equal(vault.get("google_refresh"), "RT"); assert.equal(svc.auth.user().email, "dieu@remithollet.fr"); assert.equal(svc.auth.user().canSend, true);
});

test("jeton Google d'un autre identifiant client ou d'un autre domaine : ignoré", async (t) => {
  let g = { refresh_token: "RT", email: "a@remithollet.fr", client_id: "autre" };
  const { svc } = await boot(t, () => ({ google: g }));
  await svc.refreshShared(); assert.equal(svc.state().signedIn, false); assert.equal(svc.state().sharedGoogle, false);
  g = { refresh_token: "RT", email: "a@gmail.com", client_id: "cid" };
  await svc.refreshShared(); assert.equal(svc.state().signedIn, false);
});

test("sans connexion partagée : la configuration de ce poste est conservée", async (t) => {
  const { vault, svc } = await boot(t, () => ({}));
  vault.set("ragic_key", "LOCAL"); vault.set("ragic_host", "x");
  const ch = await svc.refreshShared();
  assert.deepEqual(ch, { ragic: false, google: false }); assert.equal(vault.get("ragic_key"), "LOCAL");
});

test("clé Ragic modifiée dans le launcher : reprise au contrôle suivant", async (t) => {
  let key = "A";
  const { vault, svc } = await boot(t, (fake) => ({ ragic: { key, host: fake.host } }));
  await svc.refreshShared(); assert.equal(vault.get("ragic_key"), "A");
  key = "B"; const ch = await svc.refreshShared(); assert.equal(ch.ragic, true); assert.equal(vault.get("ragic_key"), "B");
});
