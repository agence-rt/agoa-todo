"use strict";
/* Recherche, télécharge et prépare une mise à jour au démarrage. Ne lève jamais d'erreur et ne bloque pas
   le démarrage au-delà des délais indiqués : en cas de souci (hors connexion, GitHub injoignable…), l'application s'ouvre.
   `updater` est l'objet autoUpdater d'electron-updater (ou un faux dans les tests). */

const errText = (e) => {
  const m = String((e && (e.code || e.message)) || e || "");
  if (/ENOTFOUND|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|EAI_AGAIN|net::/i.test(m)) return "Pas de connexion";
  if (/404|latest\.yml|Cannot find/i.test(m)) return "Aucune version publiée";
  return "Mise à jour impossible";
};

function runUpdateCheck({ updater, onStatus, isPackaged, checkTimeoutMs = 12000, downloadTimeoutMs = 10 * 60 * 1000 }) {
  const say = (text, progress) => { try { onStatus({ text, progress: progress == null ? null : progress }); } catch (e) { /* sans importance */ } };
  if (!isPackaged) { say("Mode développement"); return Promise.resolve({ action: "continue", reason: "dev" }); }

  return new Promise((resolve) => {
    let done = false, timer = null;
    const handlers = {};
    const finish = (result, text) => {
      if (done) return; done = true; clearTimeout(timer);
      Object.entries(handlers).forEach(([ev, fn]) => updater.removeListener(ev, fn));
      if (text) say(text);
      resolve(result);
    };
    const on = (ev, fn) => { handlers[ev] = fn; updater.on(ev, fn); };

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.logger = null;

    on("checking-for-update", () => say("Recherche de mises à jour…"));
    on("update-not-available", () => finish({ action: "continue", reason: "none" }, "Application à jour"));
    on("update-available", (info) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ action: "continue", reason: "timeout" }, "Téléchargement trop long — démarrage…"), downloadTimeoutMs);
      say(`Mise à jour ${info && info.version ? info.version + " " : ""}disponible`, 0);
      Promise.resolve(updater.downloadUpdate()).catch((e) => finish({ action: "continue", reason: "error", error: e }, errText(e) + " — démarrage…"));
    });
    on("download-progress", (p) => say(`Téléchargement de la mise à jour… ${Math.round((p && p.percent) || 0)} %`, Math.round((p && p.percent) || 0)));
    on("update-downloaded", (info) => finish({ action: "restart", reason: "downloaded", version: info && info.version }, "Installation de la mise à jour…"));
    on("error", (e) => finish({ action: "continue", reason: "error", error: e }, errText(e) + " — démarrage…"));

    timer = setTimeout(() => finish({ action: "continue", reason: "timeout" }, "Pas de réponse — démarrage…"), checkTimeoutMs);
    say("Recherche de mises à jour…");
    Promise.resolve().then(() => updater.checkForUpdates()).catch((e) => finish({ action: "continue", reason: "error", error: e }, errText(e) + " — démarrage…"));
  });
}

/* Vérification périodique pendant que l'application tourne : si une version est disponible, ask(info) propose
   l'installation (fenêtre) ; sur « oui », téléchargement puis onReady(info) (redémarrage). Ne lève jamais d'erreur.
   Une vérification à la fois ; un refus (« Plus tard ») est reproposé à la vérification suivante. */
function startPeriodicCheck({ updater, ask, onProgress = () => {}, onReady, intervalMs = 60 * 60 * 1000, checkTimeoutMs = 30000, downloadTimeoutMs = 15 * 60 * 1000, log = () => {} }) {
  let busy = false, stopped = false, timer = null;
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowPrerelease = false;

  const waitFor = (start, events, timeoutMs) => new Promise((resolve) => {
    const handlers = {}; let t = null, over = false;
    const end = (v) => { if (over) return; over = true; clearTimeout(t); Object.entries(handlers).forEach(([ev, fn]) => updater.removeListener(ev, fn)); resolve(v); };
    Object.entries(events).forEach(([ev, map]) => { handlers[ev] = (arg) => { const v = map(arg); if (v !== undefined) end(v); }; updater.on(ev, handlers[ev]); });
    handlers.error = (e) => end({ error: e }); updater.on("error", handlers.error);
    t = setTimeout(() => end({ error: new Error("délai dépassé") }), timeoutMs);
    Promise.resolve().then(start).catch((e) => end({ error: e }));
  });

  async function checkNow() {
    if (busy || stopped) return { reason: "busy" };
    busy = true;
    try {
      const found = await waitFor(() => updater.checkForUpdates(), { "update-available": (info) => ({ info }), "update-not-available": () => ({ none: true }) }, checkTimeoutMs);
      if (found.error) { log("vérification : " + (found.error.message || found.error)); return { reason: "error" }; }
      if (!found.info) return { reason: "none" };
      let yes = false;
      try { yes = await ask(found.info); } catch (e) { log(String(e)); }
      if (!yes) return { reason: "declined", version: found.info.version };
      const got = await waitFor(() => updater.downloadUpdate(), {
        "download-progress": (p) => { onProgress(Math.round((p && p.percent) || 0)); return undefined; },
        "update-downloaded": (info) => ({ info })
      }, downloadTimeoutMs);
      if (got.error) { onProgress(-1); log("téléchargement : " + (got.error.message || got.error)); return { reason: "error", version: found.info.version }; }
      onProgress(-1);
      await onReady(got.info || found.info);
      return { reason: "installed", version: found.info.version };
    } finally { busy = false; }
  }
  const tick = () => { if (stopped) return; checkNow().catch((e) => log(String(e))).then(() => { if (!stopped) { timer = setTimeout(tick, intervalMs); if (timer.unref) timer.unref(); } }); };
  timer = setTimeout(tick, intervalMs); if (timer.unref) timer.unref();
  return { checkNow, stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { runUpdateCheck, startPeriodicCheck, errText };
