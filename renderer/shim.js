/* Fait le lien entre la page (écrite pour la base partagée de la version web) et le processus principal d'Electron :
   window.claude.use("db") -> base Ragic ; window.claude.use("mcp") -> recherche Ragic et envoi Gmail. */
(function () {
  "use strict";
  var agoa = window.agoa;
  if (!agoa) return;

  function snapshot(docs) {
    return { docs: docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; }) };
  }
  function fail(e) { return Promise.reject({ code: (e && e.code) || "error", message: e && e.message }); }

  function collection(name) {
    return {
      onSnapshot: function (ok, ko) {
        agoa.subscribe(name, function (docs) { ok(snapshot(docs)); }).catch(function (e) { if (ko) ko({ code: e && e.code, message: e && e.message }); });
        return function () {};
      },
      doc: function (id) {
        return {
          update: function (patch) { return agoa.write({ op: "update", coll: name, id: id, data: patch }).catch(fail); },
          set: function (data) { return agoa.write({ op: "set", coll: name, id: id, data: data }).catch(fail); },
          delete: function () { return agoa.write({ op: "delete", coll: name, id: id }).catch(fail); }
        };
      }
    };
  }

  function callTool(server, tool, args) {
    if (server === "Ragic" && tool === "list_page") {
      var f = args && args.filters && Object.keys(args.filters)[0];
      var q = f ? args.filters[f].value : "";
      return agoa.searchOperations(q).then(function (records) { return { payload: { records: records } }; }).catch(fail);
    }
    if (server === "Gmail" && tool === "send_message") {
      return agoa.sendMail({ to: args.to, subject: args.subject, body: args.body }).then(function () { return { payload: {} }; }).catch(fail);
    }
    return Promise.reject({ code: "not_in_manifest" });
  }

  window.claude = {
    use: function (name) {
      if (name === "db") return Promise.resolve({ collection: collection });
      if (name === "mcp") return Promise.resolve({ callTool: callTool });
      return Promise.reject({ code: "unknown_capability" });
    }
  };
})();
