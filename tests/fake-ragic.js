"use strict";
/* Faux serveur Ragic (HTTP local) pour les tests : mêmes URL, mêmes formats que l'API v3. */
const http = require("http");
const config = require("../src/config");

function makeFake({ apiKey = "KEY", withSchema = true } = {}) {
  const sheets = {}; const schema = {}; let seq = 1000;
  let synthetic = 9000000;
  for (const [coll, sh] of Object.entries(config.ragic.sheets)) {
    sheets[sh.path] = { coll, recs: new Map() };
    schema[sh.path] = Object.values(sh.fields).map((d) => ({ fieldId: d.id || ++synthetic, fieldName: d.label }));
  }
  sheets[config.ragic.operations.path] = { coll: "ops", recs: new Map() };
  const calls = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push(`${req.method} ${u.pathname}`);
      const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (u.searchParams.get("APIKey") !== apiKey) return send(401, { status: "ERROR", msg: "bad key" });
      const m = u.pathname.match(/^\/agoa(\/[^/]+\/\d+)(?:\/(\d+|metadata\/schema))?$/);
      if (!m) return send(404, { status: "ERROR" });
      const sh = sheets[m[1]]; if (!sh) return send(404, { status: "ERROR" });
      if (m[2] === "metadata/schema") return withSchema ? send(200, { fields: schema[m[1]], status: "SUCCESS" }) : send(403, { status: "ERROR" });
      if (req.method === "GET") {
        let recs = [...sh.recs.entries()];
        for (const w of u.searchParams.getAll("where")) {
          const [fid, op, ...rest] = w.split(","); const val = decodeURIComponent(rest.join(",")).toLowerCase();
          recs = recs.filter(([, r]) => String(r[fid] || "").toLowerCase().includes(val));
        }
        const off = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1000);
        const out = {}; recs.slice(off, off + lim).forEach(([id, r]) => { out[id] = Object.assign({ _ragicId: id }, r); });
        return send(200, out);
      }
      const form = Object.fromEntries(new URLSearchParams(body));
      if (req.method === "POST" && !m[2]) { const id = ++seq; sh.recs.set(id, form); return send(200, { status: "SUCCESS", rv: String(id) }); }
      if (req.method === "POST") { const r = sh.recs.get(Number(m[2])); if (!r) return send(200, { status: "ERROR", msg: "no record" }); Object.assign(r, form); return send(200, { status: "SUCCESS", rv: m[2] }); }
      if (req.method === "DELETE") { sh.recs.delete(Number(m[2])); return send(200, { status: "SUCCESS" }); }
      send(400, {});
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    server, sheets, schema, calls, host: `127.0.0.1:${server.address().port}`,
    fieldId: (path, label) => schema[path].find((f) => f.fieldName === label).fieldId,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); }
  })));
}
module.exports = { makeFake };
