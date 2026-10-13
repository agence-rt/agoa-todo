# AGOA TD — to do list des dossiers par personne

Application Windows de l'agence Rémi Thollet Architecte, à la charte graphique de la gamme AGOA
(icône : carré rouge agence, « TD » en gras).

- **Données** : formulaires Ragic « TD … » (onglet `rendez-vous`, apname `agoa`). Tout le monde voit les mêmes données ;
  l'application relit Ragic toutes les 8 secondes et affiche « Synchronisé » / « Hors connexion » en haut à droite.
- **Identification** : compte Google de l'agence (`@remithollet.fr` uniquement). La même connexion sert à envoyer la
  *liste à facturer* à `comptabilite@remithollet.fr` depuis la boîte Gmail de la personne connectée.
- **Références de dossiers** : recherchées dans la feuille Opérations de Ragic (champ « Code travaux »), saisie manuelle sinon.

## 1. Préparer Ragic

Les cinq formulaires existent déjà. Il reste à y ajouter :

| Formulaire | À ajouter |
|---|---|
| Les 5 (`TD Colonnes`, `TD Types`, `TD Éléments`, `TD Dossiers`, `TD Listes à facturer`) | un champ **texte** nommé exactement `Clé` |
| `TD Types` | un champ **texte** nommé `Nom` (il manquait) |

`Clé` est l'identifiant interne de chaque ligne (par exemple `rv`, `urgent`, `t0x9k…`) : c'est ce qui relie un dossier à sa colonne,
à ses types et à ses éléments. Le « N° auto » reste un numéro lisible pour les humains.

Les champs sont retrouvés **par leur libellé** au démarrage (si le compte de la clé API peut lire le schéma) ; sinon l'application
utilise les identifiants de `src/config.js`. Si un champ manque, l'écran de démarrage indique lequel.

Correspondance des champs :

| Formulaire | Champs Ragic → contenu |
|---|---|
| TD Colonnes | `Nom`, `Ordre` |
| TD Types | `Nom`, `Couleur` (`red`, `orange`, `violet`, `blue`, `green`, `teal`, `gray`, un code `#rrggbb`, ou `none` = sans couleur / gras), `Ordre` |
| TD Éléments | `Nom`, `Ordre` |
| TD Dossiers | `Nature` (Dossier / Séparateur), `Colonne` (clé), `Ordre`, `Référence` (pour un séparateur : son nom), `Note`, `Types` (clés séparées par des virgules), `Éléments` (JSON, par exemple `{"dat":"r","sol":"g"}` : r = manquant, g = reçu), `Étude en cours`, `Point à faire`, `Terminé` (valeur `Yes` quand coché), `Date de fin` (`AAAA/MM/JJ`), `Facturation` (`À facturer` / `Sans facturation`), `N° de liste`, `Id opération Ragic` |
| TD Listes à facturer | `Date d’envoi`, `Nombre de dossiers`, `Contenu` (JSON : numéro de la liste et ses dossiers) |

> Si `Terminé`, `Étude en cours` et `Point à faire` sont des cases à cocher Ragic, la valeur `Yes` est celle attendue par défaut.
> Une autre valeur se règle dans `src/config.js` (`boolTrue`).

## 2. Identifiants Google (une seule fois, par un administrateur Google Workspace)

1. Console Google Cloud → nouveau projet « AGOA TD ».
2. *API et services* → activer **Gmail API**.
3. *Écran de consentement OAuth* → type d'utilisateur **Interne** (réserve l'application au domaine de l'agence ; aucune validation Google n'est nécessaire).
   Ajouter la portée `https://www.googleapis.com/auth/gmail.send` (en plus de `openid`, `email`, `profile`).
4. *Identifiants* → **ID client OAuth** → type **Application de bureau**. Noter l'ID client et le code secret.
5. Dans GitHub : *Settings → Secrets and variables → Actions* → créer `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`.

Pour travailler en local : copier `resources/google-client.example.json` en `resources/google-client.json` et le remplir (fichier ignoré par git).
Pour une application de bureau, Google ne considère pas ce « secret » comme confidentiel ; il n'accorde de toute façon l'accès qu'aux comptes `@remithollet.fr`.

## 3. Construire et diffuser l'installateur

- À chaque *push* sur `main` : tests, puis construction de l'installateur Windows (artefact **AGOA-TD-installateur** de l'exécution GitHub Actions).
- Pour publier une version : `git tag v0.1.0 && git push --tags` → l'installateur `AGOA TD Setup 0.1.0.exe` est joint à la *Release* GitHub.
- Windows affichera « Windows a protégé votre ordinateur » tant que l'installateur n'est pas signé : *Informations complémentaires → Exécuter quand même*.
  Pour supprimer l'avertissement, il faut un certificat de signature de code (à ajouter dans le workflow).

## 4. Premier lancement (chaque poste)

1. **Se connecter avec Google** : le navigateur s'ouvre, choisir son compte `@remithollet.fr` et accepter l'envoi de courriels.
2. **Clé API Ragic** (la même que pour le suivi du temps) : elle est vérifiée, le serveur Ragic est détecté automatiquement, puis la clé est conservée **chiffrée** sur le poste (DPAPI de Windows).
3. L'application s'ouvre. La pastille du compte (en haut à droite) permet de changer la clé Ragic ou de se déconnecter.

## 5. Développement

```bash
npm install
npm test                      # 19 tests : client Ragic, base, Google, application complète (faux Ragic et faux Gmail)
npm start                     # lance Electron
npm run icons                 # régénère build/icon.png et build/icon.ico
# essai de lancement réel sous Linux :
xvfb-run -a npx electron --no-sandbox --disable-gpu scripts/electron-demo.js   # capture dans AGOA_SHOT_DIR
```

Organisation : `main.js` (fenêtre, IPC), `preload.js` (pont sécurisé), `src/` (Ragic, base, Google, coffre), `renderer/` (écran de connexion, application).
`renderer/shim.js` donne à la page l'interface de base qu'elle attend ; la page elle-même (`renderer/index.html`) est celle de la version web.

## 6. Limites connues

- Synchronisation par relecture toutes les 8 s (pas instantanée). Si deux personnes modifient la même ligne au même moment, la dernière écriture gagne.
- Pas de mode hors connexion : sans réseau, l'écran reste affiché mais les modifications échouent.
- Le client Ragic a été testé contre un faux serveur reprenant le format de l'API v3, pas encore contre le vrai Ragic de l'agence.
