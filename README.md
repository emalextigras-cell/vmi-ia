# VMI Purevent — version 13 modulaire

Copie de travail indépendante du dépôt source `emalextigras-cell/Vmi`. Le dépôt d'origine reste intact.

## Organisation des fichiers

- `index.html` : structure et composants de l'interface.
- `css/style.css` : styles, affichage mobile et thèmes.
- `js/app.js` : orchestration de l'application, connexion BLE, stockage, historique, import/export et événements.
- `js/modules/bluetooth-protocol.js` : UUID, CRC et construction des trames Bluetooth VMI.
- `js/modules/psychrometry.js` : humidité absolue, point de rosée et indicateurs hygrométriques.
- `js/modules/date-utils.js` : dates, normalisation et constantes partagées.
- `js/modules/chart-renderer.js` : graphiques SVG, gestion des courbes et infobulles tactiles.
- `manifest.json` : configuration de l'application installable.
- `sw.js` : service worker et cache des ressources.

## Déploiement GitHub Pages

Dans **Settings → Pages**, sélectionner la branche `main` et le dossier `/(root)`. Ouvrir ensuite l'adresse HTTPS dans Chrome sur Android pour utiliser Web Bluetooth.

Fermer VMI+ avant de se connecter : la VMI n'accepte qu'une seule connexion simultanée.

## Sécurité et limites

- Les changements de vitesse, boost et mode vacances restent manuels.
- Les commandes sont envoyées séquentiellement et leur état est vérifié par retour de la VMI.
- Aucun pilotage automatique par IA n'est activé.
- Les données sont conservées localement dans IndexedDB.
- Les indicateurs hygrométriques sont indicatifs. Sans mesure de débit et de consommation électrique, l'application ne peut pas calculer un optimum énergétique réel.

## Vérifications à effectuer sur la VMI réelle

1. Connexion et déconnexion Bluetooth.
2. Mesures en direct et état de la VMI.
3. Téléchargement de l'historique depuis la VMI.
4. Import d'un export XLSX VMI+.
5. Graphiques et comparaison des vitesses.
6. Export CSV, sauvegarde JSON et restauration.
7. Commandes manuelles, en vérifiant leur effet réel sur la VMI.

La version modulaire doit être validée sur l'appareil avant de remplacer l'application utilisée au quotidien.


## Organisation JavaScript (v13)

Le point d'entrée reste `js/app.js`. Les responsabilités sont réparties dans les modules :

- `core.js` : utilitaires communs et version de l'application.
- `analysis.js` : statistiques et médianes.
- `store.js` : persistance IndexedDB.
- `charts.js` : point d'entrée du rendu graphique.
- `ble.js` : protocole et trames Bluetooth (UUID, CRC, commandes).
- `sync.js` : temporisation du téléchargement de l'historique.
- `dataio.js` : lecture des dates et conversion des lignes CSV/tableur.
- `app.js` : orchestration de l'interface et coordination des modules.

Les modules historiques `date-utils.js`, `psychrometry.js`, `bluetooth-protocol.js` et `chart-renderer.js` sont conservés pour limiter les changements et préserver les calculs et le protocole de la v13.
