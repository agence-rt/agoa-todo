"use strict";
/* Assemble les services (coffre, Google, Ragic) indépendamment d'Electron : testable avec Node seul. */
const fs = require("fs");
const config = require("./config");
const { GoogleAuth } = require("./google");
const { RagicClient, detectHost } = require("./ragic");
const { RagicStore } = require("./store");

function readGoogleClient(candidates, env) {
  for (const f of candidates) {
    try { const j = JSON.parse(fs.readFileSync(f, "utf8")); if (j.clientId && j.clientSecret) return j; } catch (e) { /* suivant */ }
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  return { clientId: "", clientSecret: "" };
}

class Services {
  constructor({ vault, openExternal, googleClient, fetchImpl, ragicProtocol, log }) {
    this.vault = vault; this.fetchImpl = fetchImpl; this.protocol = ragicProtocol; this.log = log || (() => {});
    this.auth = new GoogleAuth({
      clientId: googleClient.clientId, clientSecret: googleClient.clientSecret, scopes: config.googleScopes,
      allowedDomain: config.allowedDomain, openExternal, vault, fetchImpl
    });
    this.store = null; this.error = null; this.ready = false; this.starting = false; this.listeners = new Set();
  }

  state() {
    const key = this.vault.get("ragic_key");
    return {
      googleConfigured: this.auth.configured,
      signedIn: this.auth.signedIn(), user: this.auth.user(),
      ragicConfigured: !!key, ready: this.ready, starting: this.starting, error: this.error,
      allowedDomain: config.allowedDomain, mailTo: config.mailTo
    };
  }

  async startStore() {
    this.stopStore();
    const key = this.vault.get("ragic_key"), host = this.vault.get("ragic_host");
    if (!key || !host) { this.error = null; return; }
    const client = new RagicClient({ host, apname: config.ragic.apname, apiKey: key, fetchImpl: this.fetchImpl, protocol: this.protocol });
    const store = new RagicStore({ client, config, log: this.log });
    store.on("snapshot", (c, docs) => this.listeners.forEach((l) => l.snapshot && l.snapshot(c, docs)));
    store.on("status", (s) => this.listeners.forEach((l) => l.status && l.status({ ok: s.ok, message: s.error ? s.error.message : "" })));
    this.starting = true;
    try { await store.init(); this.store = store; this.ready = true; this.error = null; store.start(); }
    catch (e) { this.error = { code: e.code || "error", message: e.message }; this.ready = false; }
    finally { this.starting = false; }
  }
  stopStore() { if (this.store) this.store.stop(); this.store = null; this.ready = false; }

  async setupRagic(apiKey) {
    const key = String(apiKey || "").trim();
    if (!key) throw Object.assign(new Error("Saisissez la clé API Ragic."), { code: "empty" });
    const host = await detectHost(key, {
      apname: config.ragic.apname, hosts: config.ragic.hosts, probePath: config.ragic.sheets.tasks.path,
      fetchImpl: this.fetchImpl, protocol: this.protocol
    });
    this.vault.set("ragic_key", key); this.vault.set("ragic_host", host);
    await this.startStore();
    return this.state();
  }
  forgetRagic() { this.stopStore(); this.vault.remove("ragic_key"); this.vault.remove("ragic_host"); this.error = null; }

  async signOut() { await this.auth.signOut(); }

  requireStore() {
    if (!this.store || !this.ready) throw Object.assign(new Error("Base Ragic non connectée."), { code: "not_ready" });
    return this.store;
  }
  requireSession() {
    if (!this.auth.signedIn()) throw Object.assign(new Error("Connectez-vous à Google."), { code: "needs_reauth" });
  }

  async searchOperations(q) {
    this.requireSession();
    const st = this.requireStore(), o = config.ragic.operations;
    const recs = await st.client.list(o.path, { where: [[o.code, "like", String(q)]], fetchIds: [o.code, o.objet, o.syndic, o.adresse], pageSize: 8, maxRecords: 8 });
    return recs.map((r) => ({ record_id: r._ragicId, "CODE TRAVAUX": r[o.code] || "", Objet: r[o.objet] || "", syndic: r[o.syndic] || "", adresse: r[o.adresse] || "" }));
  }

  async sendMail(m) {
    this.requireSession();
    const to = Array.isArray(m.to) ? m.to : [m.to];
    if (to.some((a) => String(a).toLowerCase() !== config.mailTo.toLowerCase())) throw Object.assign(new Error("Destinataire non autorisé."), { code: "forbidden" });
    return this.auth.sendMail({ to, subject: String(m.subject || ""), body: String(m.body || "") });
  }
}

module.exports = { Services, readGoogleClient };
