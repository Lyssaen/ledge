# Ledge Desktop en espace de travail IDE

Design validé par l'utilisateur le 2026-11-05. La fenêtre principale de Ledge Desktop devient un espace de travail à la manière de VS Code ou de Cursor. Il est centré sur les agents, avec des panneaux divisés, plusieurs fenêtres et plusieurs terminaux. OpenRig et l'atelier y sont intégrés.

- **Référence pour coder :** [`docs/mockups/ledge-ide-interactive.html`](mockups/ledge-ide-interactive.html). C'est un prototype interactif en 1920×1080, où chaque bouton et chaque option agissent. En cas de doute, c'est lui qui fait foi.
- **Vues statiques d'origine :** [`docs/mockups/ledge-ide-workspace.html`](mockups/ledge-ide-workspace.html).
- **Périmètre :** Ledge Desktop seulement. Le TUI suivra plus tard. Le téléphone et l'encoche ne changent pas.

## Pour qui, pour quoi

Deux utilisateurs, profil agent engineer et développeur senior. Deux usages en même temps :

- un rig OpenRig qui travaille seul, qu'on surveille de loin et qui sait demander quand il a besoin de quelqu'un ;
- 2 ou 3 sessions suivies de près, côte à côte, avec leurs diffs et leurs terminaux.

Ledge n'édite pas de code. « Ouvrir dans… » envoie le worktree d'une session à l'éditeur choisi (Cursor par défaut).

## Hors périmètre

- **Le mur d'agents.** Il sera retravaillé plus tard et n'est pas au premier plan.
- **Pas d'onglet Tâches ni Brain** dans l'IDE.
- **Le TUI**, qui reprendra le modèle après le Desktop.

## La fenêtre

| Zone | Contenu |
|---|---|
| Barre de titre | Machine, champ de recherche qui ouvre la palette (`Ctrl+K`), boutons pour afficher ou masquer la barre latérale, le panneau du bas et le panneau de droite. |
| Barre d'activité (à gauche) | **Projets**, **Rigs**, **À toi** (badge rouge ou ambre), **OpenRig** (ouvre la page en onglet), **Atelier** (onglet), **Réglages** (onglet). Un second clic sur la vue active replie la barre latérale. |
| Barre latérale | Selon la vue : **Projets** (sessions par projet, dispositions), **Rigs** (rigs, leurs sièges, le kernel), **À toi** (demandes, tranchables sur place). |
| Zone d'édition | Des groupes d'onglets côte à côte. Voir « Onglets et groupes ». |
| Panneau du bas (`Ctrl+J`) | Deux onglets en icônes : les terminaux (avec leur nombre) et la sortie (les commandes `rig` lancées par Ledge, avec leur nombre). |
| Panneau de droite (`Ctrl+/`) | « À toi », le résumé de la session active (état, fichiers modifiés, branche) et le chat de Ledge. |
| Barre d'état | Daemon, OpenRig (rigs en marche), demandes en attente (clic : aller à la suivante), **limites d'usage**, disposition en cours. |

Les rigs ne figurent pas dans la vue Projets. Ils sont réservés à la vue Rigs.

## Onglets et groupes

Types d'onglets : **session**, **siège OpenRig**, **modifications** d'une session, **terminal**, **topologie** d'un rig, **page OpenRig**, **atelier**, **réglages**.

- **Ouvrir.** Un clic dans l'explorateur ouvre selon le réglage « Ouvrir une session » : dans le groupe actif, à droite, ou dans une nouvelle fenêtre. `Ctrl`+clic ouvre à droite. Le clic droit propose : ouvrir, ouvrir à droite, nouvelle fenêtre, ses modifications, son terminal (ou sa capture pour un siège), envoyer un message, redémarrer le siège, ouvrir dans l'éditeur. Un onglet déjà ouvert est mis au premier plan, jamais dupliqué.
- **Le bouton + d'un groupe** ouvre directement « Nouvelle session » (voir plus bas), et rien d'autre.
- **Diviser** (`Ctrl+\`) crée un groupe vide à droite. Il propose les modifications et le terminal de la session qu'on quittait, ainsi que Nouvelle session, OpenRig, Réglages, Atelier et Terminal.
- **Glisser** un onglet vers un autre groupe l'y déplace. Pendant le glisser, une zone « nouveau groupe » apparaît à droite. Un groupe vidé disparaît, sauf le dernier de la fenêtre.
- **Détacher** ouvre le groupe dans une nouvelle fenêtre (sur un autre écran). Le même bouton l'y ramène.
- **Groupes liés.** Le carré à gauche des onglets lie un groupe en violet, en vert d'eau ou à rien. Quand on change de session dans un groupe lié, les onglets Modifications et Terminal des groupes de la même couleur passent sur cette session. Le lien vaut aussi d'une fenêtre à l'autre.
- **Dispositions.** On enregistre sous un nom l'ensemble des groupes, des fenêtres et des panneaux, puis on l'applique depuis la vue Projets, la palette ou les réglages.
- **Beaucoup de groupes.** Chacun garde une largeur minimale, la zone défile à l'horizontale, et les onglets défilent dans leur barre.

## Une session ou un siège dans un onglet

- **Onglet :** logo du provider (Anthropic, OpenAI, omp), nom, pastille d'état aux couleurs de l'encoche. L'onglet est souligné en rouge pour une autorisation, en ambre pour une question. Un siège affiche aussi le nom de son rig.
- **En-tête :** nom, branche, projet (ou rig et rôle pour un siège), bouton « Ouvrir dans [éditeur] ».
- **Vues :** Fil, Modifications, Terminal. Un siège a aussi une vue role.md.
- **Demandes :** une autorisation se tranche par `Y` / `N` sur la session active, où qu'elle soit. Une question se répond par ses options. On peut aussi trancher depuis « À toi ».
- **Réponse :** un champ sous le fil (Entrée envoie ; pour un siège, c'est un `rig send`) et « Interrompre ».
- **Sous la réponse :** le **modèle** (un clic propose les modèles du même harnais) et le **contexte** de la session (barre, pourcentage, jetons utilisés sur la fenêtre). La limite d'usage n'apparaît **jamais** dans une session.

## Nouvelle session

Elle s'ouvre dans une **fenêtre modale**, jamais en page ni en onglet. On l'ouvre par le + d'un groupe, par `N` (quand aucune autorisation n'attend dans le groupe actif, sinon `N` refuse), par « + N » dans la vue Projets ou par la palette.

Les champs : projet, où travailler (nouvelle branche dans un worktree, ou `main` dans le dossier du projet), agent (Claude Code, Codex, omp, chacun avec la limite 5 h de son compte), modèle, permissions, premier message, où ouvrir la session (groupe actif, à droite, nouvelle fenêtre). Le texte d'aide en haut reprend l'endroit choisi. `Ctrl+Entrée` lance, Échap ferme. Une fois lancée, la session s'ouvre à l'endroit choisi et se met au travail.

## OpenRig

- **Vue Rigs.** Chaque rig affiche son état et ses sièges. Le **kernel** a sa propre section avec ses trois sièges : l'**operator** (aide à choisir et lancer une équipe), l'**advisor** (relit les plans) et le **queue worker** (route les lignes de queue). Un clic sur un siège ouvre son fil.
- **Un clic sur un rig** (ou sur le kernel) ouvre sa **topologie** dans un onglet. On y trouve les sièges et leurs liens. Un clic sur un siège ouvre son fil. La topologie d'un rig a aussi Démarrer, Arrêter, Redémarrer, sa file OpenRig et un lien vers la page OpenRig. Celle du kernel a « Parler à l'operator ». Un rig arrêté montre ses sièges grisés.
- **Page OpenRig** (en onglet) : le contenu de la page actuelle.
  - Le daemon, avec « relancer les rigs qui tournaient » et « sans le kernel ».
  - Le kernel et ses trois sièges.
  - Les rigs, leurs sièges et un ± par rôle.
  - Les permissions au lancement, « Lancer un rig… » et la sortie des commandes.
- **Confirmations.** Tout arrêt ou redémarrage (daemon, kernel, rig) demande confirmation, nomme les sièges qui travaillent et montre la commande `rig` exacte. Le résultat arrive dans la sortie (panneau du bas et page OpenRig). L'état des sièges change partout : explorateur, atelier, topologie, onglets.

## Terminaux

Quatre sortes, toujours écrites sur l'onglet :
- **attaché** : le tmux d'un agent, on peut y taper ;
- **shell** : dans un worktree ;
- **lecture seule** : la capture d'un siège ;
- **commande** : une commande relancée, par exemple `rig ps`.

Ils vivent dans le panneau du bas (« + Terminal » en ouvre un) ou comme onglets. Le bouton d'un terminal du bas le passe en onglet.

Le rendu WebGL est limité à un nombre de terminaux visibles (12 par défaut, réglable). Au-delà, et pour les terminaux masqués, le rendu passe en DOM. Les navigateurs limitent le nombre de contextes WebGL par page.

## Limites d'usage

Elles s'affichent en bas de l'IDE, et seulement là. Pour chaque compte (Claude Code, Codex), la barre d'état montre la fenêtre 5 h (barre, pourcentage, heure de réinitialisation) et la semaine. Un clic ouvre le détail : 5 h, semaine, semaine par modèle. omp affiche « limite non lue ».

Au-delà du seuil d'alerte (80 % par défaut, réglable), la valeur passe en ambre. Les données sont celles que le daemon lit déjà (`packages/protocol/src/usage.ts`).

## Atelier

L'atelier validé (l'open-space en quinconce) est gardé **tel quel**, dans un onglet. Seuls changent les gestes : un clic sur un agent ouvre sa session selon le réglage, `Ctrl`+clic l'ouvre à droite. « Projets | Rigs », « Masquer les sous-agents » et « Détacher » restent. Le bureau de Ledge ouvre le chat dans le panneau de droite.

## Réglages

Les réglages s'ouvrent en onglet (`Ctrl+,`). Les sections actuelles ne changent pas. Une seule section est nouvelle, **Espace de travail** :

- **Ouvrir une session :** dans le groupe actif, à droite, ou dans une nouvelle fenêtre.
- **Au démarrage :** la dernière disposition, une disposition fixe, ou l'atelier seul.
- **Dispositions enregistrées :** appliquer ou supprimer.
- **Panneau de droite :** « À toi » et le chat de Ledge ; le résumé de la session active.
- **Barre d'état :** les limites d'usage ; le seuil d'alerte.
- **Ouvrir dans… :** Cursor, VS Code ou Zed.
- **Terminaux :** le nombre de terminaux en rendu WebGL ; « Taper dans un terminal attaché sans confirmation ».

## Raccourcis

| Raccourci | Effet |
|---|---|
| `Ctrl+K` | Palette : `@` pour les sessions et les sièges, `>` pour les commandes. |
| `N` | Nouvelle session (fenêtre modale). |
| `Y` / `N` | Autoriser ou refuser la demande de la session active. |
| `Ctrl+\` | Diviser le groupe à droite. |
| `Ctrl+J` | Afficher ou masquer le panneau du bas. |
| `Ctrl+/` | Afficher ou masquer le panneau de droite. |
| `Ctrl+,` | Réglages. |
| `Ctrl+Entrée` | Lancer la nouvelle session. |
| Échap | Fermer une fenêtre modale, un menu, une confirmation. |

## Points ouverts

- **Librairie de panneaux.** dockview est pressentie (ouverture d'un groupe dans une vraie fenêtre, disposition sérialisée). Il faut vérifier qu'elle fonctionne avec les fenêtres multiples de Tauri avant de s'engager.
- **Accueil et Historique.** Que devient l'Historique des conversations avec Ledge ? Le chat vit désormais dans le panneau de droite.
- **Composition du kernel.** Le design suit la doc d'OpenRig (operator, advisor, queue worker). Il faut vérifier sur une installation réelle quels sièges `rig ps --nodes --rig kernel` liste, et si le queue worker doit rester visible.
- **Atelier dans un onglet étroit.** Il est gardé tel quel. Il faut vérifier sa lisibilité quand le groupe est étroit, sans le modifier.
- **Découpe de l'implémentation.** Elle se fera dans un second temps.
