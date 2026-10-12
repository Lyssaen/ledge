# L'île en haut de l'écran — design

Date : 2026-10-12 · Projet personnel, hors story Jira · Auteur : Joffrey Desantoine avec Claude Code

Maquette validée : https://claude.ai/artifact/FYXdzkjen3SBYseeRrnVme, copie locale [docs/mockups/ledge-island.html](../../mockups/ledge-island.html) avec sa capture. Vingt et un scénarios simulés, Signal en sombre, Galet en clair.

Statut : implémenté le 2026-10-12 (plan : [2026-10-12-island.md](../plans/2026-10-12-island.md)). Cette spec remplace, pour la géométrie de la surface, les sections « La surface vivante », « La poignée » et « La bulle » de la [spec de design](2026-10-09-ledge-design.md) (section 5). Tout ce qu'elle ne mentionne pas reste tel que la spec de design et les specs suivantes le décrivent.

## 1. Objectif

La poignée vit au bord gauche de l'écran, verticalement centrée, et tout s'ouvre vers la droite. Elle devient une **île** posée au centre du bord supérieur, à la manière de la Dynamic Island d'Apple : une pastille sombre découpée dans le haut de l'écran, qui porte les compagnons au repos et qui grandit vers le bas pour la bulle, la liste, une session, le chat, le lancement, le lecteur, l'aide et les réglages.

Succès :

- Même contenu, mêmes raccourcis, mêmes décisions : rien de ce que la poignée fait n'est perdu.
- L'île lit comme une découpe dans le bord supérieur, pas comme une fenêtre posée dessus : fond `--notch`, sans bordure, contre-arrondi de chaque côté à la jonction avec le bord.
- Le haut de l'écran reste utilisable : l'île compacte ne dépasse pas 300 px de large ni 38 px de haut, et un mode discret la réduit à un trait sous une fenêtre maximisée.

Hors périmètre : une île déplaçable à la souris, une île par écran, un retour optionnel à la poignée gauche (la poignée disparaît).

## 2. Parcours validé

Les scénarios de la maquette, dans l'ordre du rail. Les quatre premiers sont nouveaux dans leur forme ; les autres reprennent les écrans existants, ancrés sous l'île.

| Scénario | Ce que montre la maquette |
| --- | --- |
| Au repos | La mascotte de Ledge à gauche, un trait vertical, puis un compagnon par session de gauche à droite. Chacun porte le halo de son état ; ceux qui attendent respirent ; celui qui travaille saute de 2 px. |
| Journée chargée | Six mascottes au plus, puis un compteur « +n ». Les demandes passent devant. |
| Mode discret | Un trait de 10 px, un point par session dans la couleur de son état. Un survol redéploie l'île. |
| Ne pas déranger | Les halos s'éteignent, une lune à droite des mascottes, aucune bulle. |
| Une demande | L'île s'étire à 440 px : compagnon à 40 px, « Otto attend votre accord », la commande et le dossier en mono, Refuser et Autoriser dessous, « +1 autre » à droite, le compte à rebours en trait rouge au bas de l'île. |
| Tour terminé | Même geste en vert : « Otto a terminé », durée et dépôt, OK et Ouvrir, six secondes. |
| La liste, ouverte au clavier, douze sessions, liste vide | Le panneau descend depuis l'île. Le coachmark des trois premières ouvertures clavier se pose sous le panneau, centré. |
| Session : accord, question, réponse lue comme un plan, au travail, lecture seule | Inchangées dans leur contenu, ancrées sous l'île à 480 px. |
| Demander à Ledge, Nouvelle session, choisir un dossier, lecteur Markdown | Inchangés, ancrés sous l'île. Le lecteur est la vue la plus large. |
| Raccourcis, Réglages | L'onglet Affichage gagne « Position de l'île » et « Mode discret sous une fenêtre » ; « Taille de la poignée » devient « Taille de l'île ». |

## 3. Géométrie

### L'ancrage

- L'île est centrée sur l'axe vertical de l'écran choisi (réglage « Écran », inchangé), collée au bord supérieur de sa zone de travail. Avec une barre des tâches en haut, la zone de travail commence sous la barre : l'île se pose sous la barre, jamais dessus.
- Toute vue garde son bord supérieur sur le bord de l'écran et s'étend vers le bas, centrée sur le même axe. Les largeurs des vues ne changent pas : `SIZES.listW`, `sessionW`, `readingW`, `readerW` et `readerExpandedW` restent la référence. La hauteur maximale est la hauteur de la zone de travail moins `SIZES.margin` en bas.
- Les coins inférieurs sont arrondis à 22 px pour les panneaux, 19 px pour l'île compacte, 6 px pour le trait du mode discret. Les coins supérieurs sont droits : l'île sort du bord.
- L'ombre `shadow-overlay` tombe vers le bas, comme aujourd'hui.

### Le contre-arrondi

C'est ce qui fait qu'elle semble découpée dans l'écran. De chaque côté de l'île, à la jonction avec le bord supérieur, un congé concave dans la couleur `--notch` : un carré de rayon `r` dont le quart de cercle extérieur, en bas, est retiré. Le bord de l'écran est tangent au congé, qui rejoint l'île tangentiellement.

- `r` = 12 px pour toutes les vues, 6 px pour le trait du mode discret. Jamais plus que la moitié de la largeur de l'île.
- Les congés suivent la largeur de l'île en temps réel, y compris pendant une transition : ils sont dessinés par la surface, pas par une couche séparée.
- Même couleur que l'île (`#000` en sombre, `#fff` en clair), sans bordure, et un chevauchement d'un pixel dans l'île pour éviter le liseré aux échelles fractionnaires (150 %), comme le font déjà les congés de la poignée.

C'est le même objet que les deux congés qui raccordent aujourd'hui la poignée au bord gauche (`Shoulders.tsx`, rayon `SHOULDER_R` = 14) : ils tournent d'un quart de tour et passent de part et d'autre au lieu d'au-dessus et en dessous. La fenêtre native inclut les congés dans sa boîte englobante, comme aujourd'hui.

### L'île compacte

- 38 px de haut. De gauche à droite : 12 px de marge, la mascotte de Ledge à 22 px, un trait de 1 px × 16 px, les compagnons à 22 px espacés de 8 px, 14 px de marge.
- Au-delà de six compagnons, les six premiers de l'ordre de la liste (demandes d'abord) puis une pastille mono « +n ». La largeur ne dépasse donc jamais 300 px.
- Sans aucune session : la mascotte de Ledge seule, sans trait.
- Halo, respiration, saut de travail, mouvements réduits : la spec de design, section 6, s'applique. Le saut reste de 2 px, vers le haut.

### Le mode discret

- Un trait de 10 px de haut, un point de 6 × 4 px par session dans la couleur de son état, six au plus. Ses congés sont de 6 px.
- Actif quand le réglage est coché et qu'une fenêtre maximisée ou plein écran occupe l'écran de l'île. Sinon l'île compacte.
- Un survol, `Ctrl+Alt+L`, une demande ou un tour terminé redéploient l'île comme d'habitude ; elle redevient trait 500 ms après le repli.

## 4. Interactions

- **Survol.** La zone chaude est l'île elle-même, plus une bande de 10 px le long du bord supérieur qui la déborde de 40 px de chaque côté (c'est elle qui redéploie le trait du mode discret). Après 180 ms la liste descend ; elle remonte 500 ms après que le curseur a quitté le panneau, sauf saisie dans un champ, jamais quand une session est ouverte. Le poller natif de proximité (`CURSOR_NEAR_EVENT`) couvre cette zone au lieu du bord gauche.
- **Clic.** Sur une mascotte : sa session. Sur la mascotte de Ledge : la liste, ou le chat du jour si une réponse non lue l'attend. Sur le trait du mode discret : la liste.
- **La bulle.** Elle n'est plus une fenêtre à côté de la poignée : c'est l'île qui s'étire. Séquence : le compagnon grossit dans l'île (280 ms), puis l'île s'élargit vers les deux côtés et descend (260 ms plus tard). Le compte à rebours est le trait de 2 px au bas de l'île (4 s pour une demande, 6 s pour un tour terminé), suspendu au survol, au focus et fenêtre masquée. Une demande remplace toujours un avis de fin.
- **Clavier.** Inchangé : `Ctrl+Alt+L`, `Ctrl+Alt+N`, `Ctrl+Alt+T`, `J` `K`, `Y` `N`, chiffres, `Alt ←` `Alt →`, `Entrée`, `Échap`, `/`, `?`. Le coachmark se pose sous le panneau, centré sur l'axe.
- **Clic en dehors.** Replie l'île, comme aujourd'hui.

## 5. Réglages

Affichage, deux réglages nouveaux et un renommé :

| Réglage | Valeurs | Défaut |
| --- | --- | --- |
| Position de l'île | Centre · Décalée à gauche · Décalée à droite | Centre |
| Mode discret sous une fenêtre | Interrupteur | Activé |
| Taille de l'île (ex-Taille de la poignée) | Auto, 100 à 200 % | Auto |

« Décalée » place l'axe de l'île au quart de la largeur de l'écran, à gauche ou à droite, pour laisser libre le centre où se tiennent les titres de fenêtres et les onglets d'un navigateur maximisé. Les autres réglages ne changent pas.

## 6. Architecture proposée

Ce que l'implémentation touche, sans détailler le plan :

- `geometry.ts` : `layout()` calcule un `left` en plus de `top`, `w`, `h`. L'île compacte devient une rangée (slots en x) ; les vues gardent leurs largeurs et prennent `top = 0`. `slotSizes` devient 22 px fixes avec un plafond de six.
- `frame.ts` et `main.rs` : `set_frame` reçoit `left` (aujourd'hui la fenêtre est toujours à `x = 0`) ; `frame_rect` l'applique à la zone de travail. `FRAME_PAD` perd son `top` et gagne un `left`.
- `Shoulders.tsx` : les congés passent de part et d'autre de la surface, rayon 12 (6 pour le trait), même chevauchement d'un pixel.
- `Handle.tsx` et `ResidentMascot.tsx` : disposition horizontale, le trait entre la mascotte de Ledge et les compagnons, la pastille « +n », la variante trait du mode discret.
- `Bubble.tsx` : plus d'ancrage à la position d'un bot ; la bulle est la surface elle-même, centrée.
- Le poller natif de proximité (`cursor-near` dans `main.rs`, `handleEnter` / `handleLeave` dans `Surface.tsx`) : la zone testée devient la bande du bord supérieur, largeur de l'île plus 40 px de chaque côté.
- Détection d'une fenêtre maximisée sous l'île (mode discret) : `GetForegroundWindow` + `IsZoomed`, ou la zone de travail comparée à la fenêtre au premier plan ; à préciser dans le plan.
- Réglages : `islandPosition` et `discreet` dans les settings, l'onglet Affichage, et la migration du libellé.

## 7. Acceptation

- Au repos, l'île tient en 38 px × 300 px au plus, centrée, collée au bord supérieur, congés de 12 px dans la couleur du thème, sans liseré à 100 %, 125 %, 150 % et 200 %.
- Une demande étire l'île sans ouvrir de seconde fenêtre ; le compte à rebours est le trait du bas ; survol et focus le suspendent.
- Chaque vue existante s'ouvre sous l'île à sa largeur actuelle et replie à l'île ; les tests e2e des écrans (`screenshots.spec.ts`) sont recapturés.
- Le mode discret se déclenche sous une fenêtre maximisée et se redéploie au survol ; désactivé, l'île reste compacte.
- Les réglages de position déplacent l'île sans redémarrage ; le réglage « Écran » continue de la déplacer d'écran.
- Clavier et clic en dehors inchangés ; une session ouverte n'est jamais repliée par le survol.

## 8. Points ouverts

- La bande chaude de 10 px au bord supérieur est-elle assez confortable à viser avec une barre d'onglets de navigateur juste en dessous ? À mesurer sur la version native, quitte à l'épaissir à 14 px comme l'ancienne zone du bord gauche.
- Écran avec barre des tâches en haut : la maquette place l'île sous la barre ; à valider en vrai, l'île pourrait sembler flotter.
- La maquette dessine la liste à 440 px pour la lisibilité ; la spec garde `SIZES.listW` = 380 px. Trancher à la première capture native.
- Plusieurs écrans : l'île suit le réglage « Écran », sans île secondaire. Une bulle sur l'autre écran reste hors périmètre.
