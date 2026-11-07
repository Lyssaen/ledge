# IDE lot 3 : questions pour design-ux

Les états que la maquette (`docs/mockups/ledge-ide-interactive.html`) ne dessine pas. En attendant une réponse, le lot fait le choix le plus sobre, décrit à chaque question.

## Q1. La même session en terminal dans deux groupes (R2)

Le daemon n'a qu'une surveillance par session : un seul onglet peut afficher l'écran de l'agent. C'est l'onglet qui l'a demandé en dernier (ouvert ou affiché en terminal, ou « Afficher ici »).

L'autre onglet affiche aujourd'hui :
- un bandeau neutre, comme ceux du terminal : « Terminal affiché dans l’autre groupe », avec le bouton « Afficher ici » ;
- sous le bandeau, l'aperçu des dernières lignes (lecture seule), comme pour une session sans écran ;
- un pied sans état, avec le point éteint et la cible tmux.

Quand l'onglet qui tient l'écran le lâche (retour au fil, onglet fermé), l'autre onglet visible le reprend tout seul.

Questions :
1. Ce bandeau et ce texte vous conviennent-ils ? Faut-il nommer le groupe ou l'onglet qui tient l'écran ?
2. Sous le bandeau, l'aperçu des dernières lignes, ou une zone vide ?
3. Le focus sur ce groupe (clic, Ctrl + ²) doit-il ramener l'écran tout seul, sans passer par « Afficher ici » ?

## Q2. Ce que montre un groupe sous l'onglet glissé

La maquette entoure d'un pointillé violet le groupe survolé (`.dragging .pane.drop-on`) : déposé là, l'onglet rejoint ce groupe. Elle ne dessine pas les deux autres arrivées que le lot 3 accepte :
- sur un onglet de la barre : l'onglet se range à cette place ;
- sur le bord droit d'un groupe : un nouveau groupe s'ouvre à sa droite.

Aujourd'hui, le pointillé violet entoure la partie du groupe où l'onglet arriverait : tout le groupe au centre, sa moitié droite près du bord droit, l'onglet visé dans la barre. Les bords haut, bas et gauche ne montrent rien et refusent le dépôt.

Questions :
1. La moitié droite en pointillé dit-elle assez « nouveau groupe » ? Faut-il plutôt un texte, comme la zone « Déposer ici : nouveau groupe » ?
2. Dans la barre d'onglets, un trait vertical à l'endroit d'arrivée plutôt que l'onglet entouré ?

## Q3. Le menu de l'explorateur et Réglages › Espace de travail (tâche 6)

La maquette dessine le menu (`menuHtml()`, `ctx`) et la section (`settingsPage()`), pas ces points :
- **Un siège OMP arrêté** n'a pas d'écran : « Capture dans un terminal » n'est pas proposé.
- **`Ctrl`+clic dans l'arbre** ouvre à droite, comme le dit la maquette. La sélection de plusieurs sessions pour leur écrire ensemble (diffusion), qui prenait `Ctrl`+clic, passe à `Maj`+clic dans l'IDE ; interrupteur coupé, rien ne change. design-ux peut confirmer ce geste.
- **La phrase sous le titre** de la section : la maquette dit « Chaque option agit tout de suite sur cette page : essaie-les » (une phrase de maquette). L'app dit « Les groupes d’onglets de l’interface IDE : où s’ouvre une session. »
- **Les icônes du menu** : les entrées de la maquette n'en ont pas ; l'app garde celles du menu de session actuel (ouvrir, diviser, terminal, enveloppe).
- **Le menu de l'atelier** (son « … » et son clic droit) partage le même menu de session : interrupteur allumé, il a aussi les entrées de l'IDE (« Ouvrir », « Ouvrir à droite », « Son terminal »…). La fenêtre détachée de l'atelier garde le menu d'aujourd'hui.
