# Lot 6 : questions pour design-ux

Fichier de travail du lot 6 (plan `docs/superpowers/plans/2026-11-08-ide-lot-6-settings-atelier.md`), à supprimer avant la PR. Les captures viennent de `apps/desktop/e2e/ide-settings-atelier.spec.ts` (`e2e/.results/ide-lot6-*.png`).

1. **L'atelier dans un groupe étroit (R8).** À 480 px, la barre de zoom de l'atelier (`.zoom-controls`, en position absolue) déborde à gauche du groupe : « − » et le pourcentage sont coupés. Les salles se lisent encore, en une colonne. À 720 px, l'atelier tient. Faut-il une règle pour la barre de zoom dans un groupe étroit, par exemple sans l'indice « Ctrl + molette… », ou rien ?

2. **Les Réglages dans un groupe étroit.** À 480 px, la colonne des sections prend la moitié de la largeur. Dans Général, les libellés passent un mot par ligne et « English » déborde à droite. La page OpenRig a une règle pour ce cas (« la colonne de gauche devient une rangée d'onglets au-dessus du contenu »). Faut-il la même règle pour les Réglages ?

3. **« Taper dans un terminal attaché sans confirmation » (R5, renvoyé par le R13 du lot 5).** La maquette a la case, mais aucune confirmation n'est dessinée et aucune n'existe dans le code. Quand s'ouvre-t-elle (première frappe dans le tmux d'un agent qui travaille ? dans tout terminal attaché ?) ? Quel est son texte ? Vaut-elle une fois par terminal, ou une fois par session ? En attendant, la case n'est pas posée.

4. **« Figer les animations » dans la barre de l'atelier (R3).** Il est absent de la maquette, mais existait dans l'ancienne barre du haut. Il est gardé en bouton icône (⏸ / ▶) entre « Masquer les sous-agents » et « Détacher ». Le garder ici, le déplacer, ou le retirer de l'IDE ?

5. **Le filtre de projet dans la barre de l'atelier (R2).** Il est absent de la maquette. Il prend la forme de l'ancien fil d'Ariane : `Atelier / ● Website ×`. Dans l'IDE, Échap ne retire pas le filtre, la croix est le seul moyen. Cette forme convient-elle ?

6. **« Alerte à » sans aucune machine qui donne ses limites (R6).** Les boutons − et + sont grisés, et la ligne reprend l'indice de Général : « Aucune machine ne donne encore les limites de ses harnais : mettez à jour Ledge, ou connectez Claude Code. » Ce texte convient-il dans cette section ?
