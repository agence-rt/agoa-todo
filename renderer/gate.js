(function () {
  "use strict";
  var agoa = window.agoa, card = document.getElementById("card"), busy = false;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function steps(n) {
    var t = ["Google", "Ragic", "Prêt"];
    return '<ol class="steps">' + t.map(function (x, i) { return '<li class="' + (i + 1 < n ? "done" : i + 1 === n ? "on" : "") + '">' + (i + 1) + ". " + x + "</li>"; }).join("") + "</ol>";
  }
  function show(html) { card.innerHTML = html; }
  function err(m) { return m ? '<div class="err" role="alert">' + esc(m) + "</div>" : ""; }

  function render(st, message) {
    if (st.signedIn && st.ragicConfigured && st.ready) { location.replace("index.html"); return; }
    if (!st.signedIn) {
      show(steps(1) + "<h1>Connexion</h1><p>Connectez-vous avec votre compte Google de l’agence (@" + esc(st.allowedDomain) + ").</p>" + err(message) +
        (st.googleConfigured ? "" : err("Cette version n’a pas d’identifiants Google : voir le README du dépôt (section Google).")) +
        '<button class="primary" id="go"' + (st.googleConfigured ? "" : " disabled") + ">Se connecter avec Google</button>" +
        "<p><small>Une fenêtre de votre navigateur va s’ouvrir. L’autorisation d’envoyer des courriels sert uniquement à transmettre la liste à facturer à la comptabilité.</small></p>");
      document.getElementById("go").onclick = function () {
        if (busy) return; busy = true; this.disabled = true; this.textContent = "En attente de Google…";
        agoa.signIn().then(refresh, function (e) { busy = false; refresh(agoa.info(e).message); });
      };
      return;
    }
    if (!st.ragicConfigured) {
      show(steps(2) + "<h1>Base Ragic</h1><p>Bonjour " + esc((st.user && st.user.name) || "") + ". Saisissez la clé API Ragic de l’agence (la même que pour le suivi du temps). Elle est conservée, chiffrée, sur ce poste.</p>" + err(message) +
        '<label for="k">Clé API Ragic</label><input id="k" type="password" autocomplete="off" spellcheck="false"><button class="primary" id="ok">Valider</button>' +
        '<button class="link" id="out" type="button">Changer de compte Google</button>');
      var k = document.getElementById("k"); k.focus();
      var go = function () {
        if (busy || !k.value.trim()) return; busy = true; var b = document.getElementById("ok"); b.disabled = true; b.textContent = "Vérification…";
        agoa.setupRagic(k.value).then(render0, function (e) { busy = false; refresh(agoa.info(e).message); });
      };
      document.getElementById("ok").onclick = go; k.onkeydown = function (e) { if (e.key === "Enter") go(); };
      document.getElementById("out").onclick = function () { agoa.signOut().then(function () { refresh(); }); };
      return;
    }
    if (st.starting) { show(steps(2) + "<h1>Connexion à Ragic…</h1><p>Chargement des données de l’agence.</p>"); setTimeout(refresh, 700); return; }
    // clé enregistrée mais base inaccessible
    var detail = st.error ? st.error.message : "La base Ragic ne répond pas.";
    show(steps(2) + "<h1>Base Ragic indisponible</h1>" + err(detail) +
      '<button class="primary" id="retry">Réessayer</button><button class="link" id="key" type="button">Changer la clé Ragic</button>');
    document.getElementById("retry").onclick = function () { this.disabled = true; agoa.retry().then(render0, function (e) { refresh(agoa.info(e).message); }); };
    document.getElementById("key").onclick = function () { agoa.forgetRagic().then(function () { refresh(); }); };
  }
  function render0(st) { busy = false; render(st); }
  function refresh(message) { busy = false; agoa.state().then(function (st) { render(st, message); }); }
  refresh();
})();
