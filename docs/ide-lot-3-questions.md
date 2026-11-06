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
