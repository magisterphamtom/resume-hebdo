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
