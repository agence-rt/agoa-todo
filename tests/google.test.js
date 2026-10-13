"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { GoogleAuth, AuthError, buildMime, b64url } = require("../src/google");

const memVault = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), m }; };
const idToken = (payload) => ["x", b64url(JSON.stringify(payload)), "y"].join(".");
const get = (url) => new Promise((resolve, reject) => http.get(url, (r) => { r.resume(); r.on("end", resolve); }).on("error", reject));

function harness({ email = "dieu@remithollet.fr", hd = "remithollet.fr", verified = true, scope = "openid email profile https://www.googleapis.com/auth/gmail.send", refresh = "R1", answer = "code" } = {}) {
  const calls = []; const vault = memVault();
  const fetchImpl = async (url, init) => {
    const body = init && init.body ? (typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : null;
    calls.push({ url, body, headers: init && init.headers });
    const J = (status, o) => ({ ok: status < 300, status, json: async () => o });
    if (url.includes("oauth2.googleapis.com/token")) {
      if (body.grant_type === "authorization_code") return J(200, { access_token: "AT1", expires_in: 3600, refresh_token: refresh, scope, id_token: idToken({ email, email_verified: verified, hd, name: "Dieu Test" }) });
      if (body.grant_type === "refresh_token") return body.refresh_token === "R1" ? J(200, { access_token: "AT2", expires_in: 3600 }) : J(400, { error: "invalid_grant" });
    }
    if (url.includes("gmail.googleapis.com")) return calls.gmail401 ? J(401, {}) : J(200, { id: "m1" });
    if (url.includes("revoke")) return J(200, {});
    return J(404, {});
  };
  const openExternal = async (url) => {
    const u = new URL(url); const redirect = u.searchParams.get("redirect_uri"), state = u.searchParams.get("state");
    harness.last = { url: u };
    setTimeout(() => get(answer === "code" ? `${redirect}?code=CODE&state=${state}` : `${redirect}?error=access_denied&state=${state}`), 10);
  };
  const auth = new GoogleAuth({ clientId: "CID", clientSecret: "SEC", scopes: ["openid", "email"], allowedDomain: "remithollet.fr", openExternal, vault, fetchImpl, timeoutMs: 3000 });
  return { auth, vault, calls };
}

test("connexion : PKCE, domaine imposé, session enregistrée", async () => {
  const { auth, vault, calls } = harness();
  const p = await auth.signIn();
  assert.equal(p.email, "dieu@remithollet.fr"); assert.equal(p.canSend, true);
  const q = harness.last.url.searchParams;
  assert.equal(q.get("hd"), "remithollet.fr"); assert.equal(q.get("code_challenge_method"), "S256"); assert.equal(q.get("access_type"), "offline");
  const tokenCall = calls.find((c) => c.body && c.body.grant_type === "authorization_code");
  assert.equal(b64url(crypto.createHash("sha256").update(tokenCall.body.code_verifier).digest()), q.get("code_challenge"));
  assert.equal(tokenCall.body.client_secret, "SEC");
  assert.equal(vault.get("google_refresh"), "R1"); assert.equal(auth.signedIn(), true); assert.equal(auth.user().name, "Dieu Test");
});

test("connexion refusée pour un autre domaine ; rien n'est enregistré", async () => {
  const { auth, vault } = harness({ email: "x@gmail.com", hd: undefined });
  await assert.rejects(() => auth.signIn(), (e) => e instanceof AuthError && e.code === "domain");
  assert.equal(vault.get("google_refresh"), null); assert.equal(auth.signedIn(), false);
  const h2 = harness({ verified: false });
  await assert.rejects(() => h2.auth.signIn(), (e) => e.code === "domain");
});

test("connexion annulée dans le navigateur", async () => {
  const { auth } = harness({ answer: "cancel" });
  await assert.rejects(() => auth.signIn(), (e) => e.code === "cancelled");
});

test("non configuré : message explicite", async () => {
  const a = new GoogleAuth({ clientId: "", clientSecret: "", scopes: [], allowedDomain: "remithollet.fr", vault: memVault() });
  await assert.rejects(() => a.signIn(), (e) => e.code === "not_configured");
});

test("jeton d'accès renouvelé avec le jeton durable ; session perdue -> needs_reauth", async () => {
  const { auth, vault } = harness();
  await auth.signIn(); auth.access = null;
  assert.equal(await auth.accessToken(), "AT2");
  vault.set("google_refresh", "REVOKED"); auth.access = null;
  await assert.rejects(() => auth.accessToken(), (e) => e.code === "needs_reauth");
});

test("envoi Gmail : MIME UTF-8 correct ; 401 -> needs_reauth ; autorisation absente -> scope", async () => {
  const { auth, calls } = harness();
  await auth.signIn();
  await auth.sendMail({ to: ["comptabilite@remithollet.fr"], subject: "Liste à facturer n°1 — 13/10/2026", body: "Bonjour,\n\n- ÉTUDE à vérifier" });
  const g = calls.find((c) => c.url.includes("gmail"));
  assert.equal(g.headers.Authorization, "Bearer AT1");
  const raw = Buffer.from(g.body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(raw, /^To: comptabilite@remithollet\.fr\r\n/);
  const subj = raw.match(/Subject: =\?UTF-8\?B\?(.+?)\?=/)[1];
  assert.equal(Buffer.from(subj, "base64").toString("utf8"), "Liste à facturer n°1 — 13/10/2026");
  const body = Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.equal(body, "Bonjour,\r\n\r\n- ÉTUDE à vérifier");

  calls.gmail401 = true;
  await assert.rejects(() => auth.sendMail({ to: "a@b.fr", subject: "s", body: "b" }), (e) => e.code === "needs_reauth");

  const h2 = harness({ scope: "openid email profile" });
  await h2.auth.signIn();
  await assert.rejects(() => h2.auth.sendMail({ to: "a@b.fr", subject: "s", body: "b" }), (e) => e.code === "scope");
});

test("déconnexion : session effacée", async () => {
  const { auth, vault, calls } = harness();
  await auth.signIn(); await auth.signOut();
  assert.equal(vault.get("google_refresh"), null); assert.equal(auth.signedIn(), false);
  assert.ok(calls.some((c) => c.url.includes("revoke")));
});
