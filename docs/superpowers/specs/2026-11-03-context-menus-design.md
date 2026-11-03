# Menus contextuels de la barre latérale (Desktop)

## Intention

Guillaume veut un clic droit utile partout dans la barre latérale de Desktop, pas seulement sur une session. Par exemple, un clic droit sur « Archives » propose de vider toutes les archives. Un clic droit sur un projet propose de lancer une session ou d'ajouter un dossier au projet. Aujourd'hui, seule une session a son menu (`SessionMenu`). Partout ailleurs, c'est le menu natif du webview qui s'ouvre (Recharger, Inspecter…), et il ne sert à rien.

Les actions existent déjà presque toutes, mais derrière des boutons qui n'apparaissent qu'au survol, ou au fond d'un dialogue. Le clic droit les met à portée de main, à l'endroit où l'on pense à elles.

## Ce qui est décidé (validé par Guillaume le 3 novembre 2026)

Le travail se fait en deux lots. Ce document décrit le lot 1 en détail et le lot 2 en résumé.

### Lot 1

- **Un seul gestionnaire de menu contextuel.** Il remplace `useSessionMenu` et `SessionMenuHost` et ouvre un menu sur une **cible** :
  - une session ;
  - un projet ;
  - le groupe « Sans projet » ;
  - l'en-tête Archives ;
  - une ligne d'archive.

  Le menu d'une session (`SessionMenu`) devient le contenu de la cible « session » et ne change pas. Un seul menu est ouvert à la fois, et le focus revient à ce qui l'a ouvert. Le « … » de la page d'une session et les sièges de l'Atelier passent par ce même gestionnaire. La fenêtre Atelier détachée (`AtelierWindow.tsx`) y passe aussi, avec la seule cible « session ». **[R]** Les sessions de la vue « Rigs » (`RigGroups.tsx`), qui n'ont pas de menu aujourd'hui, gagnent le menu d'une session, comme dans l'arbre. **[R]**
- **Menu d'un projet**, sur sa ligne dans l'arbre :
  1. Nouvelle session ici : ouvre le lanceur sur ce projet, comme le ＋.
  2. Écrire à tout le projet… : seulement si le daemon prend le broadcast, comme le ✉.
  3. Ajouter un dossier… : ouvre l'éditeur du projet avec le sélecteur de dossiers déjà ouvert.
  4. Modifier le projet… : ouvre l'éditeur du projet.
  5. Replier ou Déplier : seulement si le projet a des sessions.
  6. Supprimer le projet… (en rouge) : ouvre l'éditeur du projet sur sa confirmation de suppression (`startDeleting`), qui existe déjà.
- **Menu du groupe « Sans projet »** :
  - Nouvelle session… : ouvre le lanceur exactement comme le bouton « Nouvelle session » de la barre vide, c'est-à-dire sur le projet filtré ou sur le premier projet. Le lanceur ne sait pas encore ouvrir « sans projet » (`launchDefaults`, `packages/fleet`), et ce lot n'y touche pas. **[R]**
  - Nouveau projet… : l'éditeur, en création.
  - Replier ou Déplier.
- **Menu de l'en-tête Archives** :
  - Tout supprimer (N)… (en rouge) : passe par `actions.request('delete', ids)` et donc par la boîte de confirmation existante. Il ne prend que les archives que leur machine sait supprimer (`actions.allowed`). Quand certaines sont écartées, l'entrée le dit, avec leur nombre.
  - Tout restaurer : `actions.restore` sur chaque archive permise.
  - Replier ou Déplier.

  Les deux premières entrées sont grisées quand il n'y a aucune archive. Elles agissent sur toutes les archives, pas seulement sur celles que le filtre affiche.
- **Menu d'une ligne d'archive** : Lire, Restaurer, Reprendre, Supprimer (en rouge). Ce sont les mêmes actions, avec les mêmes conditions (`allowed`), que les boutons au survol.
- **Plus de menu natif dans la barre latérale.** Un clic droit n'importe où dans la barre latérale ne montre jamais le menu du webview. Sur une ligne qui a un menu, il ouvre ce menu. Ailleurs, il ne fait rien (le lot 2 y mettra un menu). Seuls les champs de saisie gardent le menu natif, pour copier-coller. Le terminal, le chat et le reste de l'application ne changent pas.
- **Clavier.** La touche Menu et Shift+F10, sur une ligne qui a le focus, ouvrent son menu sous la ligne, comme le font déjà les sièges de l'Atelier. Les flèches, Entrée et Échap marchent comme dans le menu d'une session (composant `Menu`).
- **Textes.** En français, avec l'anglais à côté (`i18n/fr.ts` et `i18n/en.ts`).

### Lot 2 (spec à part, plus tard)

- Une ligne de branche : nouvelle session sur cette branche, terminal ici. Aujourd'hui, le ＋ d'une branche ne passe que le projet au lanceur (`onLaunch(g.id)`). Il faudra lui passer aussi la branche ou le dossier.
- L'en-tête « Projets » et la zone vide de la barre latérale : nouveau projet, nouvelle session, masquer les sessions terminées, mode dense, tout replier.
- Le clic droit sur une salle de projet dans l'Atelier.

## Contraintes

- **Branche.** On part de `main`, sur `feat/context-menus`, dans le worktree `.claude/worktrees/context-menus`. On ne pousse pas sur `main`.
- **Côté client seulement.** Ni le protocole ni le daemon ne changent. Toutes les entrées du lot 1 réutilisent des actions qui existent déjà.
- **Pas de régression du menu d'une session.** Ses entrées, ses raccourcis et ses états grisés restent les mêmes partout où il s'ouvre : l'arbre, la section Attention, l'Atelier et le « … » de la page d'une session.
- **Composant `Menu`.** On réutilise `shell/Menu.tsx` (prop `at`), sans créer un second composant de menu.
- **Tests.**
  - Des tests unitaires (vitest, `apps/desktop/test`) pour chaque menu : les entrées présentes, les entrées grisées et l'action déclenchée.
  - Des tests de bout en bout (Playwright, depuis `apps/desktop` : `pnpm exec playwright test`) pour deux parcours :
    - clic droit sur un projet, puis « Ajouter un dossier… » : l'éditeur s'ouvre avec le sélecteur ;
    - clic droit sur Archives, puis « Tout supprimer » : la confirmation s'affiche, et une fois validée, la section est vide.

## Laissé au constructeur

- La forme exacte du gestionnaire (un hook, un type union pour la cible, l'endroit où il vit) et le nom des fichiers.
- Comment « Ajouter un dossier… » ouvre l'éditeur avec le sélecteur. Par exemple, un champ `addFolder?: true` sur la modale `project`, passé jusqu'à l'état initial `adding` de `ProjectEditor`. **[R]**
- L'en-tête de chaque menu : nom et couleur du projet, nombre d'archives. Il suit le style de `session-menu-head`. **[R]**
- Le texte de la confirmation « Tout supprimer » quand il y a beaucoup d'archives : la boîte existante liste les noms, et il faudra peut-être la tronquer au-delà d'un certain nombre. **[R]**
- « Tout restaurer » : une seule notification pour l'ensemble, plutôt qu'une par archive. **[R]**

**[R]** marque un choix fait par Otto, et non par Guillaume.
