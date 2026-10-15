"use strict";
/* Client minimal de l'API REST Ragic (v3). Aucune dépendance : utilise fetch (Node 18+ / Electron). */

class RagicError extends Error {
  constructor(code, message, status) { super(message); this.name = "RagicError"; this.code = code; this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RagicClient {
  constructor({ host, apname, apiKey, fetchImpl, protocol }) {
    this.host = host; this.apname = apname; this.apiKey = apiKey;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.protocol = protocol || "https";
  }

  url(path, params) {
    let u = `${this.protocol}://${this.host}/${encodeURIComponent(this.apname)}${path}?api&v=3&APIKey=${encodeURIComponent(this.apiKey)}`;
    (params || []).forEach(([k, v]) => { u += `&${k}=${v}`; });
    return u;
  }

  async _call(method, url, body, tries = 3, hops = 0) {
    let res, text;
    try {
      /* Redirections gérées ici : un navigateur/fetch qui suit une redirection 301/302 transforme un POST en GET,
         et Ragic répond alors par la liste de la feuille (« {} » si elle est vide) au lieu de créer la fiche. */
      res = await this.fetch(url, {
        method, redirect: "manual",
        headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
        body: body ? new URLSearchParams(body).toString() : undefined
      });
      if (res.status >= 300 && res.status < 400 && res.headers && res.headers.get && res.headers.get("location")) {
        if (hops >= 3) throw new Error("trop de redirections");
        const next = new URL(res.headers.get("location"), url);
        const orig = new URL(url);
        if (!/(^|\.)ragic\.com$/i.test(next.hostname) && next.hostname !== orig.hostname) throw new Error("redirection vers un serveur inattendu (" + next.hostname + ")");
        if (next.hostname !== orig.hostname) { this.host = next.host; orig.host = next.host; }
        return this._call(method, orig.toString(), body, tries, hops + 1);   // même méthode, même corps, même chemin
      }
      text = await res.text();
    } catch (e) {
      throw new RagicError("network", "Ragic est injoignable : " + (e && e.message || e));
    }
    if (res.status === 401 || res.status === 403) throw new RagicError("auth", "Clé Ragic refusée ou droits insuffisants sur ce formulaire (" + res.status + ").", res.status);
    if (res.status === 404) throw new RagicError("not_found", "Formulaire ou fiche introuvable : " + url.split("?")[0].replace(/^https?:\/\/[^/]+/, "") + ".", res.status);
    if (!res.ok) throw new RagicError("http", "Ragic a répondu " + res.status + " : " + String(text).slice(0, 160), res.status);
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new RagicError("bad_response", "Réponse Ragic illisible (serveur incorrect ?)."); }
    if (json && json.status === "ERROR") {
      if (String(json.code) === "204" && tries > 1) { await sleep(1200); return this._call(method, url, body, tries - 1); }
      throw new RagicError(String(json.code || "ragic"), json.msg || "Erreur Ragic.");
    }
    return json;
  }

  /** Liste toutes les fiches d'un formulaire : tableau d'objets { _ragicId, "<fieldId>": valeur, … }. */
  async list(path, { where = [], fetchIds = [], pageSize = 500, maxRecords = 20000 } = {}) {
    const out = [];
    for (let offset = 0; offset < maxRecords; offset += pageSize) {
      const params = [["naming", "EID"], ["limit", pageSize], ["offset", offset]];
      where.forEach(([f, op, v]) => params.push(["where", `${f},${op},${encodeURIComponent(v)}`]));
      fetchIds.forEach((id) => params.push(["fetchDomainIds", id]));
      const json = await this._call("GET", this.url(path, params));
      const recs = Object.keys(json || {}).filter((k) => json[k] && typeof json[k] === "object")
        .map((k) => Object.assign({ _ragicId: Number(k) }, json[k], json[k]._ragicId ? { _ragicId: Number(json[k]._ragicId) } : {}));
      out.push(...recs);
      if (recs.length < pageSize) break;
    }
    return out;
  }

  /** Crée une fiche. fields : { fieldId: valeur }. Retourne l'identifiant Ragic (rootNodeId). */
  async create(path, fields) {
    const json = await this._call("POST", this.url(path, []), fields);
    if (!json || json.status !== "SUCCESS" && !json.rv && !json.ragicId) throw new RagicError("bad_response", "Ragic a refusé la création : " + JSON.stringify(json).slice(0, 200));
    return Number(json.rv || json.ragicId || (json.data && json.data.ragicId)) || null;
  }

  async update(path, rid, fields) {
    await this._call("POST", this.url(`${path}/${rid}`, []), fields);
  }

  async remove(path, rid) {
    await this._call("DELETE", this.url(`${path}/${rid}`, []));
  }

  /** Schéma des champs (nécessite un compte gestionnaire) : [{ fieldId, fieldName }]. */
  async schema(path) {
    const json = await this._call("GET", this.url(`${path}/metadata/schema`, []));
    return (json && json.fields) || [];
  }
}

/** Cherche le bon serveur Ragic parmi les serveurs connus. Retourne le nom d'hôte, ou lève une erreur. */
async function detectHost(apiKey, { apname, hosts, probePath, fetchImpl, protocol }) {
  let lastErr = null;
  for (const host of hosts) {
    try {
      const c = new RagicClient({ host, apname, apiKey, fetchImpl, protocol });
      await c._call("GET", c.url(probePath, [["limit", 1], ["naming", "EID"]]), null, 1);
      return c.host;      // le serveur réel, si Ragic nous a redirigés
    } catch (e) {
      lastErr = e;
      if (e.code === "auth") break;       // la clé est refusée : inutile d'essayer les autres serveurs
    }
  }
  throw lastErr || new RagicError("network", "Aucun serveur Ragic ne répond.");
}

module.exports = { RagicClient, RagicError, detectHost };
