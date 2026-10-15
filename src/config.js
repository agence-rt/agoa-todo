"use strict";
/* Configuration de AGOA TD. Les identifiants de champs sont ceux des formulaires Ragic « TD … »
   (apname agoa, onglet rendez-vous). Au démarrage, l'application relit les libellés des champs
   (si l'accès le permet) et ne garde ces identifiants que par défaut. */
module.exports = {
  appName: "AGOA TD",
  allowedDomain: "remithollet.fr",          // seuls les comptes Google de ce domaine peuvent se connecter
  mailTo: "comptabilite@remithollet.fr",    // destinataire de la liste à facturer
  googleScopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send"],
  ragic: {
    apname: "agoa",
    hosts: ["www.ragic.com", "eu2.ragic.com", "na3.ragic.com", "ap5.ragic.com"],
    pollMs: 8000,
    boolTrue: "Yes",                         // valeur écrite quand une case est cochée
    boolFalse: "",                           // valeur écrite quand elle ne l'est pas
    operations: {                            // recherche des références (feuille Opérations)
      path: "/operations/10",
      code: 1000295, objet: 1000280, syndic: 1000309, adresse: 1000307
    },
    sheets: {
      columns:  { path: "/rendez-vous/6",  fields: {
        key: { label: "Clé", id: 1003120 }, name: { label: "Nom", id: 1003085 }, order: { label: "Ordre", id: 1003086 } } },
      types:    { path: "/rendez-vous/7",  fields: {
        key: { label: "Clé", id: 1003119 }, name: { label: "Nom", id: 1003118 }, color: { label: "Couleur", id: 1003089 }, order: { label: "Ordre", id: 1003090 } } },
      elements: { path: "/rendez-vous/8",  fields: {
        key: { label: "Clé", id: 1003121 }, name: { label: "Nom", id: 1003093 }, order: { label: "Ordre", id: 1003094 } } },
      tasks:    { path: "/rendez-vous/9",  fields: {
        key: { label: "Clé", id: 1003122 },
        kind: { label: "Nature", id: 1003097 }, person: { label: "Colonne", id: 1003100 }, order: { label: "Ordre", id: 1003098 },
        ref: { label: "Référence", id: 1003101 }, note: { label: "Note", id: 1003102 },
        types: { label: "Types", id: 1003103 }, els: { label: "Éléments", id: 1003104 },
        study: { label: "Étude en cours", id: 1003105 }, todo: { label: "Point à faire", id: 1003106 },
        done: { label: "Terminé", id: 1003107 }, doneAt: { label: "Date de fin", id: 1003108 },
        billing: { label: "Facturation", id: 1003109 }, billed: { label: "N° de liste", id: 1003110 },
        ragic: { label: "Id opération Ragic", id: 1003111 } } },
      lists:    { path: "/rendez-vous/10", fields: {
        key: { label: "Clé", id: 1003123 }, sentAt: { label: "Date d’envoi", id: 1003116 },
        count: { label: "Nombre de dossiers", id: 1003114 }, items: { label: "Contenu", id: 1003117 } } }
    }
  }
};
