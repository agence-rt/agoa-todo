/* Pastille du compte (nom, état de synchronisation, changer la clé Ragic, se déconnecter).
   Renvoie vers la page de connexion tant que Google et Ragic ne sont pas prêts. */
(function () {
  "use strict";
  var agoa = window.agoa;
  if (!agoa) return;
  var css = document.createElement("style");
  css.textContent =
    "#acct{position:relative;display:inline-flex;align-items:center;gap:8px}" +
    "#sync{display:inline-flex;align-items:center;gap:6px;font-size:12px;opacity:.9}" +
    "#sync i{width:8px;height:8px;border-radius:50%;background:#6FBF86;display:inline-block}" +
    "#sync.off i{background:#F0B429}" +
    "#acctMenu{position:absolute;right:0;top:calc(100% + 8px);z-index:60;min-width:240px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:8px;display:flex;flex-direction:column;gap:6px}" +
    "#acctMenu .who{padding:4px 6px 8px;border-bottom:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}" +
    "#acctMenu .who small{display:block;color:var(--ink-soft)}" +
    "#acctMenu button{text-align:left;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);font:inherit;cursor:pointer}" +
    "#acctMenu button:hover{background:var(--hover)}";
  document.head.appendChild(css);

  agoa.state().then(function (st) {
    if (!st.signedIn || !st.ragicConfigured || !st.ready) { location.replace("gate.html"); return; }
    var right = document.querySelector(".tb-right"), cfg = document.getElementById("btnCfg");
    if (!right) return;
    var box = document.createElement("div");
    box.id = "acct";
    box.innerHTML = '<span id="sync" title="Synchronisation avec Ragic"><i></i><span>Synchronisé</span></span>' +
      '<button id="btnAcct" class="btn btn-ghost small" type="button" aria-haspopup="menu" aria-expanded="false"></button>';
    right.insertBefore(box, cfg);
    var btn = document.getElementById("btnAcct");
    btn.textContent = (st.user && st.user.name || "Compte").split(" ")[0];
    var menu = null;
    function close() { if (menu) { menu.remove(); menu = null; btn.setAttribute("aria-expanded", "false"); } }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu) { close(); return; }
      menu = document.createElement("div"); menu.id = "acctMenu"; menu.setAttribute("role", "menu");
      menu.innerHTML = '<div class="who"></div><button type="button" data-a="key" role="menuitem">Changer la clé Ragic</button><button type="button" data-a="out" role="menuitem">Se déconnecter</button>';
      var who = menu.querySelector(".who");
      who.textContent = st.user ? st.user.name : "";
      var sm = document.createElement("small"); sm.textContent = st.user ? st.user.email : ""; who.appendChild(sm);
      box.appendChild(menu); btn.setAttribute("aria-expanded", "true");
      menu.addEventListener("click", function (ev) {
        var b = ev.target.closest("button"); if (!b) return;
        var act = b.dataset.a === "key" ? agoa.forgetRagic() : agoa.signOut();
        act.then(function () { location.replace("gate.html"); });
      });
    });
    document.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    agoa.onStatus(function (s) {
      var el = document.getElementById("sync"); if (!el) return;
      el.classList.toggle("off", !s.ok);
      el.querySelector("span").textContent = s.ok ? "Synchronisé" : "Hors connexion";
      el.title = s.ok ? "Synchronisation avec Ragic" : (s.message || "Ragic est injoignable") + " — nouvelle tentative automatique";
    });
  }).catch(function () { location.replace("gate.html"); });
})();
