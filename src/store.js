"use strict";
/* Base de données d'AGOA TD, stockée dans les formulaires Ragic « TD … ».
   Expose la même forme que la base de la version web : cinq collections (columns, types, elements,
   tasks, lists) de documents { id, data }, avec abonnement (snapshot) par interrogation régulière. */
const { EventEmitter } = require("events");

const COLLS = ["columns", "types", "elements", "tasks", "lists"];
const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'").trim().toLowerCase();
const TRUE_RE = /^(yes|oui|true|1|x|vrai|on)$/i;

/* ---------- conversions de valeurs ---------- */
const V = {
  str: { read: (v) => (v == null ? "" : String(v)), write: (v) => (v == null ? "" : String(v)) },
  num: {
    read: (v) => { const n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) && String(v).trim() !== "" ? n : 0; },
    write: (v) => (v === "" || v == null ? "" : String(v))
  },
  bool: { read: (v) => TRUE_RE.test(String(v == null ? "" : v).trim()), write: (v, cfg) => (v ? cfg.boolTrue : cfg.boolFalse) },
  date: {
    read: (v) => { const m = String(v == null ? "" : v).match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : ""; },
    write: (v) => String(v || "").replace(/-/g, "/")
  },
  csv: {
    read: (v) => String(v == null ? "" : v).split(",").map((s) => s.trim()).filter(Boolean),
    write: (v) => (Array.isArray(v) ? v.join(",") : "")
  },
  json: {
    read: (v) => { try { const o = JSON.parse(String(v || "")); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } },
    write: (v) => (v && Object.keys(v).length ? JSON.stringify(v) : "")
  },
  billing: {
    read: (v) => { const s = norm(v); return s.startsWith("sans") ? "none" : s.includes("factur") ? "tobill" : ""; },
    write: (v) => (v === "tobill" ? "À facturer" : v === "none" ? "Sans facturation" : "")
  }
};

const SPEC = {
  columns: { name: "str", order: "num" },
  types: { name: "str", color: "str", order: "num" },
  elements: { name: "str", order: "num" },
  tasks: { person: "str", order: "num", ref: "str", note: "str", types: "csv", els: "json", study: "bool", todo: "bool", done: "bool", doneAt: "date", billing: "billing", ragic: "str" }
};

const pad = (n) => String(n).padStart(2, "0");
const isoToRagicDateTime = (iso) => { const d = new Date(iso); if (isNaN(d)) return ""; return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const ragicDateTimeToIso = (s) => {
  const m = String(s || "").match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return "";
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +m[5] || 0, +(m[6] || 0)).toISOString();
};

class RagicStore extends EventEmitter {
  constructor({ client, config, log }) {
    super();
    this.client = client; this.cfg = config.ragic; this.log = log || (() => {});
    this.f = {};                       // coll -> { logical: fieldId }
    this.raw = {}; COLLS.forEach((c) => { this.raw[c] = new Map(); });
    this.sig = {};
    this.busy = 0; this.refreshing = false; this.timer = null; this.stopped = true;
    this.locks = new Map();
  }

  /* ---------- champs ---------- */
  async resolveFields() {
    for (const coll of COLLS) {
      const sheet = this.cfg.sheets[coll];
      let byLabel = new Map();
      try { (await this.client.schema(sheet.path)).forEach((x) => byLabel.set(norm(x.fieldName), x.fieldId)); }
      catch (e) { if (e.code === "auth" && e.status === 401) throw e; this.log("schéma indisponible pour " + sheet.path + " : " + e.message); }
      const map = {};
      for (const [logical, d] of Object.entries(sheet.fields)) {
        const id = byLabel.get(norm(d.label)) || d.id || null;
        if (id) map[logical] = Number(id);
      }
      const missing = Object.entries(sheet.fields).filter(([l]) => !map[l]).map(([, d]) => d.label);
      if (missing.length) {
        const err = new Error(`Champ(s) introuvable(s) dans le formulaire ${sheet.path} : ${missing.map((m) => "« " + m + " »").join(", ")}.`);
        err.code = "missing_field"; throw err;
      }
      this.f[coll] = map;
    }
  }

  /* ---------- lecture ---------- */
  keyOf(coll, rec) { const k = String(rec[this.f[coll].key] == null ? "" : rec[this.f[coll].key]).trim(); return k || "r" + rec._ragicId; }

  async fetchColl(coll) {
    const recs = await this.client.list(this.cfg.sheets[coll].path);
    const m = new Map();
    const ids = Object.values(this.f[coll]);
    recs.forEach((r) => {
      if (ids.every((id) => r[id] == null || String(r[id]).trim() === "")) return;   // fiche vide (résidu d'un essai) : ignorée
      m.set(this.keyOf(coll, r), { rid: r._ragicId, rec: r });
    });
    return m;
  }
  sigOf(m) { return JSON.stringify([...m.entries()].map(([k, v]) => [k, v.rid, v.rec]).sort((a, b) => (a[0] < b[0] ? -1 : 1))); }

  async refreshAll() {
    const next = {}, v0 = this.wver || 0;
    for (const c of COLLS) next[c] = await this.fetchColl(c);
    if (this.busy || (this.wver || 0) !== v0) return;   // une écriture a eu lieu pendant la lecture : cette lecture est périmée, on garde l'état local
    const changed = new Set();
    for (const c of COLLS) { const s = this.sigOf(next[c]); if (s !== this.sig[c]) { this.sig[c] = s; this.raw[c] = next[c]; changed.add(c); } }
    if (changed.has("lists")) changed.add("tasks");
    changed.forEach((c) => this.emit("snapshot", c, this.docs(c)));
    if (!this.loaded) { this.loaded = true; }
  }

  async init() {
    await this.resolveFields();
    await this.refreshAll();
    this.loaded = true;
    COLLS.forEach((c) => { if (!this.sig[c]) this.sig[c] = this.sigOf(this.raw[c]); });
  }

  start() {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      if (!this.busy && !this.refreshing) {
        this.refreshing = true;
        try { await this.refreshAll(); this.emit("status", { ok: true }); }
        catch (e) { this.emit("status", { ok: false, error: e }); }
        finally { this.refreshing = false; }
      }
      if (!this.stopped) this.timer = setTimeout(tick, this.cfg.pollMs);
    };
    this.timer = setTimeout(tick, this.cfg.pollMs);
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }

  docs(coll) {
    const out = [];
    for (const [key, { rec }] of this.raw[coll]) out.push({ id: key, data: this.toDoc(coll, rec) });
    return out;
  }

  /* ---------- conversion fiche Ragic -> document ---------- */
  toDoc(coll, rec) {
    const f = this.f[coll], d = {};
    if (coll === "lists") {
      const body = V.json.read(rec[f.items]);
      d.n = Number(body.n) || 0; d.items = Array.isArray(body.items) ? body.items : [];
      d.sentAt = ragicDateTimeToIso(rec[f.sentAt]);
      return d;
    }
    const spec = SPEC[coll];
    for (const [k, t] of Object.entries(spec)) d[k] = V[t].read(rec[f[k]]);
    if (coll === "tasks") {
      const n = V.num.read(rec[f.billed]);
      d.billed = n ? this.listKeyByN(n) : "";
      if (norm(rec[f.kind]).startsWith("separ")) return { kind: "sep", label: d.ref, person: d.person, order: d.order };
      delete d.ragic; if (rec[f.ragic]) d.ragic = String(rec[f.ragic]);
    }
    return d;
  }
  listKeyByN(n) {
    for (const [key, { rec }] of this.raw.lists) { if ((Number(V.json.read(rec[this.f.lists.items]).n) || 0) === n) return key; }
    return "";
  }
  listNByKey(key) {
    const e = this.raw.lists.get(key); if (!e) return "";
    return Number(V.json.read(e.rec[this.f.lists.items]).n) || "";
  }

  /* ---------- conversion document -> champs Ragic ---------- */
  toFields(coll, data, creating, current) {
    const f = this.f[coll], out = {};
    const put = (logical, value) => { out[f[logical]] = value; };
    if (coll === "lists") {
      const cur = current ? V.json.read(current[f.items]) : {};
      const n = data.n != null ? data.n : cur.n, items = data.items != null ? data.items : cur.items;
      if (data.n != null || data.items != null || creating) { put("items", JSON.stringify({ n: n || 0, items: items || [] })); put("count", String((items || []).length)); }
      if (data.sentAt != null || creating) put("sentAt", isoToRagicDateTime(data.sentAt || new Date().toISOString()));
      return out;
    }
    const spec = SPEC[coll];
    for (const [k, v] of Object.entries(data)) {
      if (coll === "tasks") {
        if (k === "label") { put("ref", V.str.write(v)); continue; }
        if (k === "kind") { put("kind", v === "sep" ? "Séparateur" : "Dossier"); continue; }
        if (k === "billed") { put("billed", v ? String(this.listNByKey(v)) : ""); continue; }
      }
      if (spec[k]) put(k, V[spec[k]].write(v, this.cfg));
    }
    if (coll === "tasks" && creating && out[f.kind] === undefined) put("kind", "Dossier");
    return out;
  }

  /* ---------- écriture ---------- */
  _serial(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(key, next);
    next.catch(() => {}).then(() => { if (this.locks.get(key) === next) this.locks.delete(key); });
    return next;
  }

  async write({ op, coll, id, data }) {
    if (!COLLS.includes(coll)) throw Object.assign(new Error("Collection inconnue."), { code: "bad_collection" });
    this.busy++;
    try {
      return await this._serial(coll + "/" + id, () => this._write(op, coll, id, data || {}));
    } finally {
      this.busy--; this.wver = (this.wver || 0) + 1;
      if (!this.busy) setTimeout(() => { if (!this.stopped && !this.busy && !this.refreshing) this.refreshAll().catch(() => {}); }, 1500);
    }
  }

  async _write(op, coll, id, data) {
    const path = this.cfg.sheets[coll].path, f = this.f[coll];
    if (coll === "tasks" && data.billed) {            // la liste doit exister avant qu'un dossier y fasse référence
      const pendingList = this.locks.get("lists/" + data.billed);
      if (pendingList) await pendingList.catch(() => {});
      if (!this.listNByKey(data.billed)) {              // liste absente de l'état local (lecture périmée) : on la relit dans Ragic
        const lists = await this.fetchColl("lists"); lists.forEach((v, k) => this.raw.lists.set(k, v));
        if (!this.listNByKey(data.billed)) throw Object.assign(new Error("La liste envoyée est introuvable dans Ragic : le dossier n’a pas pu y être rattaché."), { code: "list_missing" });
      }
    }
    const ent = this.raw[coll].get(id);
    if (op === "set") {
      const fields = this.toFields(coll, data, true);
      fields[f.key] = id;
      if (coll === "types" && data.name == null) fields[f.name] = "";
      const rid = await this.client.create(path, fields);
      if (rid) { const rec = { _ragicId: rid }; Object.entries(fields).forEach(([k, v]) => { rec[k] = v; }); this.raw[coll].set(id, { rid, rec }); }
    } else if (op === "update") {
      if (!ent) throw Object.assign(new Error("Fiche introuvable."), { code: "not_found" });
      const fields = this.toFields(coll, data, false, ent.rec);
      if (Object.keys(fields).length) { await this.client.update(path, ent.rid, fields); Object.entries(fields).forEach(([k, v]) => { ent.rec[k] = v; }); }
    } else if (op === "delete") {
      if (ent) { await this.client.remove(path, ent.rid); this.raw[coll].delete(id); }
    } else throw Object.assign(new Error("Opération inconnue."), { code: "bad_op" });
    this.sig[coll] = this.sigOf(this.raw[coll]);
    this.emit("snapshot", coll, this.docs(coll));
    if (coll === "lists") this.emit("snapshot", "tasks", this.docs("tasks"));
  }
}

module.exports = { RagicStore, COLLS, norm, V, isoToRagicDateTime, ragicDateTimeToIso };
