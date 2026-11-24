# État du module resume-hebdo

## Fait (v1.3.0, non testé dans Foundry)
- Fenêtre ApplicationV2 + Handlebars avec l'image, zoom molette/glisser/double-clic (transform CSS, dézoom limité à l'image entière, zoom max x3 de la taille réelle), bouton MJ « Montrer à tous » (socket).
- Ouverture automatique à la connexion, une fois par résumé et par client (réglages `stamp` monde / `lastSeen` client).
- Bouton dans les contrôles de scène (groupe Jetons).
- Fichier fixe `worlds/<monde>/resume/dernier-resume.(webp|png|jpg|jpeg)` (premier trouvé dans cet ordre), version détectée par la date de modification (requête HEAD), sans réglage ni action du MJ.
- Réglages : image facultative (FilePicker), ouverture auto.
- Workflow GitHub de release.

- Onglets par séance à gauche (liste `resume/index.json`, tri par numéro décroissant, repère « Nouveau » sur le plus récent). Sans index : comportement de la v1.2.

## À tester
- Onglets : changement d'image, zoom réajusté à chaque onglet, onglet « Nouveau », fenêtre étroite.
- Zoom molette centré sur le curseur, glisser, double-clic, redimensionnement de la fenêtre.
- Pas de pincement tactile (tablette) pour l'instant.
- Le bouton apparaît bien chez un joueur en v14 (hook `getSceneControlButtons`, groupe `tokens`).
- Ouverture auto à la connexion chez un joueur, puis pas de réouverture à la reconnexion.
- Fermeture puis réouverture par le bouton.
- « Montrer à tous » chez un joueur déjà connecté.
- Remplacement du fichier : nouvelle ouverture automatique chez les joueurs (en-tête Last-Modified bien renvoyé par Foundry).

## À faire / idées
- Galerie des résumés précédents (écartée pour la v1).
- Séparation par monde : le réglage `imagePath` est déjà propre à chaque monde.

## v1.4.0 (24/11/2026)
- **Recto / verso** (demande de Stéphane) : un résumé peut avoir une seconde page. Clé `verso` facultative dans `index.json`, sinon le module cherche tout seul `<nom>-verso.<ext>` à côté du recto (aussi pour `dernier-resume`). Clic sur l'image (sans glisser) ou bouton « Tourner la page » : la feuille pivote sur sa tranche avec assombrissement, l'image change, la page revient ; double-clic = ajuster. Indicateur « Page 1 / 2 », coin corné, repère « 2 pages » sur l'onglet.
- **Habillage fantasy** : réglage monde « Habillage de la fenêtre » (Automatique / Fantasy / Classique ; automatique = fantasy pour dnd5e, pf2e, pf1, a5e, black-flag, dragonbane, forbidden-lands, tormenta20). Barre de titre de cuir et titre doré (Cinzel Decorative), boutons de laiton, onglets en marque-pages (« Séance 107 », titre en italique), sceau de cire « Nouveau », lecture sur parchemin à double filet d'or. Polices Cinzel, Cinzel Decorative, EB Garamond (OFL) ajoutées, incluses dans le zip.
- **Voir en grand** (demande de Stéphane) : le bouton « Voir en grand » ouvre le résumé par-dessus tout l'écran, hors de la fenêtre : image à la taille de l'écran, molette pour zoomer (x4), glisser pour déplacer, double-clic pour revenir, « Tourner la page » s'il y a un verso ; Échap, clic sur le fond ou ✕ pour fermer (la fenêtre reprend la page affichée). Habillé lui aussi en fantasy.
- Dans la fenêtre, la page se tourne par un clic sur l'image (choix de Stéphane), le bouton « Tourner la page » ou le coin corné.
- Zoom calculé sur la feuille (en retrait du cadre dans l'habillage fantasy).
- Vérifié : syntaxe ; aperçu statique de l'habillage. À tester dans Foundry : retournement, zoom après retournement, onglets avec et sans verso, réglage d'habillage.
