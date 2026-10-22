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
  constructor({ vault, openExternal, googleClient, fetchImpl, ragicProtocol, log, shared }) {
    this.vault = vault; this.shared = shared || (async () => ({})); this.sharedInfo = { ragic: false, google: false }; this.fetchImpl = fetchImpl; this.protocol = ragicProtocol; this.log = log || (() => {});
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
      ragicConfigured: !!key, sharedRagic: this.sharedInfo.ragic, sharedGoogle: this.sharedInfo.google, ready: this.ready, starting: this.starting, error: this.error,
      allowedDomain: config.allowedDomain, mailTo: config.mailTo
    };
  }

  /** Reprend les connexions saisies dans AGOA Launcher (prioritaires sur celles de ce poste). Retourne { ragic, google } : ce qui a changé. */
  async refreshShared() {
    let sh = {};
    try { sh = (await this.shared()) || {}; } catch (e) { sh = {}; }
    const changed = { ragic: false, google: false };
    const r = sh.ragic;
    this.sharedInfo.ragic = !!(r && r.key && r.host);
    if (this.sharedInfo.ragic && (this.vault.get("ragic_key") !== r.key || this.vault.get("ragic_host") !== r.host)) {
      this.vault.set("ragic_key", r.key); this.vault.set("ragic_host", r.host); changed.ragic = true;
    }
    const g = sh.google;     // le jeton n'est utilisable qu'avec l'identifiant client qui l'a émis
    const sameClient = g && (!g.client_id || g.client_id === this.auth.clientId);
    this.sharedInfo.google = !!(g && g.refresh_token && g.email && sameClient && String(g.email).toLowerCase().endsWith("@" + config.allowedDomain));
    if (this.sharedInfo.google && this.vault.get("google_refresh") !== g.refresh_token) {
      this.vault.set("google_refresh", g.refresh_token);
      this.vault.set("google_profile", JSON.stringify({ email: String(g.email).toLowerCase(), name: g.name || g.email, picture: "", canSend: String(g.scopes || "gmail.send").includes("gmail.send") }));
      this.auth.access = null; changed.google = true;
    }
    return changed;
  }

  async startStore() {
    await this.refreshShared();
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
    /* Une clé collée peut contenir espaces, retours à la ligne, guillemets ou caractères invisibles : on ne garde que les caractères valides. */
    const key = String(apiKey || "").replace(/[^A-Za-z0-9+\/=_-]/g, "");
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

  /* Une étude déplacée dans la colonne d'une personne : cette personne devient « Architecte ? » de la fiche opération Ragic. */
  architectFor(column) {
    const o = config.ragic.operations, n = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const opt = o.architects.find((a) => n(a) === n(column));
    return opt && !o.architectsExcluded.includes(opt) ? opt : null;
  }
  architectOptions() { const o = config.ragic.operations; return o.architects.filter((a) => !o.architectsExcluded.includes(a)); }
  async assignArchitect({ ragic, ref, column }) {
    this.requireSession();
    const name = this.architectFor(column); if (!name) return { assigned: null };
    const st = this.requireStore(), o = config.ragic.operations;
    let rid = ragic ? String(ragic) : "";
    if (!rid && ref) {
      const recs = await st.client.list(o.path, { where: [[o.code, "like", String(ref)]], fetchIds: [o.code], pageSize: 8, maxRecords: 8 });
      const hit = recs.find((r) => String(r[o.code] || "").trim().toUpperCase() === String(ref).trim().toUpperCase());
      rid = hit ? String(hit._ragicId) : "";
    }
    if (!rid) return { assigned: null, reason: "not_found" };
    await st.client.update(o.path, rid, { [o.architect]: name });
    return { assigned: name };
  }

  async sendMail(m) {
    this.requireSession();
    const to = Array.isArray(m.to) ? m.to : [m.to];
    if (to.some((a) => String(a).toLowerCase() !== config.mailTo.toLowerCase())) throw Object.assign(new Error("Destinataire non autorisé."), { code: "forbidden" });
    return this.auth.sendMail({ to, subject: String(m.subject || ""), body: String(m.body || "") });
  }
}

module.exports = { Services, readGoogleClient };
