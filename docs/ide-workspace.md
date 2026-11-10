# Ledge Desktop en espace de travail IDE

Design validé par l'utilisateur le 2026-11-05, puis dans sa version 26 le 2026-11-06. La version 27 (2026-11-09, à valider) ne change que les fenêtres détachées : une fenêtre détachée porte un seul groupe (décision de l'utilisateur, option A du lot 9). La fenêtre principale de Ledge Desktop est un espace de travail à la manière de VS Code ou de Cursor. Depuis le lot 12, c'est sa seule interface : l'Accueil, l'ancienne barre latérale, la barre du haut, l'ancienne page OpenRig, le plein écran et l'interrupteur « Interface IDE (aperçu) » ont disparu. Ce document décrit ce que le code fait ; le guide de l'utilisateur est [`docs/ledge-guide.md`](ledge-guide.md). Il est centré sur les agents, avec des panneaux divisés, plusieurs fenêtres et plusieurs terminaux. OpenRig, l'atelier, et les MR et PR y sont intégrés.

- **Référence pour coder :** [`docs/mockups/ledge-ide-interactive.html`](mockups/ledge-ide-interactive.html), version 26, publiée sur https://claude.ai/artifact/GFWW4nhGxs2DLSxFW5R62B. C'est un prototype interactif en 1920×1080, où chaque bouton et chaque option agissent. En cas de doute, c'est lui qui fait foi.
- **Rigs et OpenRig :** [`docs/mockups/ledge-ide-rigs.html`](mockups/ledge-ide-rigs.html), validée par l'utilisateur le 2026-11-07. Elle part de la version 26 et la remplace pour tout ce qui touche aux rigs : la vue Rigs, la vue Rig d'un rig, la fenêtre « Lancer un rig » et la page OpenRig.
- **Vues statiques d'origine :** [`docs/mockups/ledge-ide-workspace.html`](mockups/ledge-ide-workspace.html). Elles sont dépassées par le prototype.
- **Plan d'implémentation :** [`docs/ide-workspace-plan.md`](ide-workspace-plan.md).
- **Périmètre :** Ledge Desktop seulement. Le TUI suivra plus tard. Le téléphone et l'encoche ne changent pas.

## Pour qui, pour quoi

Deux utilisateurs, profil agent engineer et développeur senior. Deux usages en même temps :

- un rig OpenRig qui travaille seul, qu'on surveille de loin et qui sait demander quand il a besoin de quelqu'un ;
- 2 ou 3 sessions suivies de près, côte à côte, avec leurs modifications, leurs terminaux et leurs MR ou PR.

Ledge n'édite pas de code. « Ouvrir dans… » envoie le worktree d'une session à l'éditeur choisi (Cursor par défaut).

## Hors périmètre

- **Le mur d'agents.** Il sera retravaillé plus tard et n'est pas au premier plan.
- **Pas d'onglet Brain** dans l'IDE. Les tâches sont un onglet du panneau de droite, pas un onglet de la zone d'édition (lot 12).
- **L'Accueil** de Ledge a disparu. La page « À toi » et le panneau de droite le remplacent (lot 12).
- **Le TUI**, qui reprendra le modèle après le Desktop.

## La fenêtre

| Zone | Contenu |
|---|---|
| Barre de titre | Le champ de recherche qui ouvre la palette (`Ctrl+K`), et les boutons pour afficher ou masquer la barre latérale, le panneau du bas et le panneau de droite. |
| Barre d'activité (à gauche) | **Projets**, **Rigs**, **À toi** (badge rouge ou ambre), **MR et PR** (badge : pipelines échoués), **Atelier** (onglet), **Réglages** (onglet). Un second clic sur la vue active replie la barre latérale. |
| Barre latérale | Selon la vue : **Projets** (sessions par projet, puis **Archives**), **Rigs** (le kernel, les rigs et leurs sièges, OpenRig en bas ; voir « OpenRig »), **À toi** (demandes, tranchables sur place, et le bouton « Page »), **MR et PR**. Elle se redimensionne en glissant son bord : sous 150 px elle se replie, un double-clic lui rend sa largeur par défaut. `Ctrl+B` ou le bouton de la barre de titre la replie (plus de « Réduire » en bas, décision de l'utilisateur du 2026-11-09). |
| Zone d'édition | Des groupes d'onglets côte à côte. Voir « Onglets et groupes ». |
| Panneau du bas (`Ctrl+J`) | Deux onglets en icônes : les terminaux (avec leur nombre) et la sortie (les commandes `rig` lancées par Ledge, avec leur nombre). |
| Panneau de droite (`Ctrl+/`, ou `/`) | **Le chat de Ledge**, avec trois onglets : « Conversation », « Tâches » (le nombre des ouvertes) et « Historique » (lot 12, maquette `docs/mockups/ledge-ide-tasks-history.html`). |
| Barre d'état | Le daemon, OpenRig (rigs en marche), les demandes en attente (un clic mène à la suivante), les MR et PR (nombre, pipelines échoués, en cours), les **limites d'usage** et la **disposition** en cours (menu : appliquer, enregistrer, gérer). |

Les rigs ne figurent pas dans la vue Projets. Ils sont réservés à la vue Rigs.

## Onglets et groupes

Types d'onglets : **session**, **siège OpenRig**, **modifications** d'une session, **terminal**, **MR ou PR**, **vue Rig** (la topologie et les réglages d'un rig ou du kernel), **page OpenRig**, **page À toi**, **atelier**, **réglages**.

- **Ouvrir.** Un clic dans l'explorateur ouvre selon le réglage « Ouvrir une session » : dans le groupe actif, ou à droite. `Ctrl`+clic ouvre à droite. Le clic droit propose : ouvrir, ouvrir à droite, son terminal (ou sa capture pour un siège), envoyer un message et redémarrer le siège (pour un siège), ouvrir dans l'éditeur. Un onglet déjà ouvert est mis au premier plan, jamais dupliqué.
- **Le bouton + d'un groupe** ouvre directement « Nouvelle session » (voir plus bas), et rien d'autre.
- **Diviser** (`Ctrl+\`) crée un groupe vide à droite, dans la fenêtre principale seulement. Il propose le terminal de la session qu'on quittait, ainsi que Nouvelle session, OpenRig, Réglages, Atelier et Terminal.
- **Glisser** un onglet vers un autre groupe l'y déplace. Pendant le glisser, une zone « nouveau groupe » apparaît à droite de la fenêtre principale. Un groupe vidé disparaît, sauf le dernier de la fenêtre.
- **Nouvelle fenêtre.** On glisse un onglet **hors de la fenêtre** : il s'ouvre dans une nouvelle fenêtre (sur un autre écran). On le glisse dans un groupe pour le ramener. Une fenêtre détachée porte **un seul groupe** : voir « Fenêtres détachées ».
- **Clic droit sur un onglet :** basculer fil ⇄ terminal (`Ctrl+``), lire role.md (siège), ouvrir dans l'éditeur, diviser à droite, fermer l'onglet, fermer les autres.
- **Groupes liés.** Le carré à gauche des onglets lie un groupe en violet, en vert d'eau ou à rien. Quand on change de session dans un groupe lié, les onglets Modifications et Terminal des groupes de la même couleur passent sur cette session. Le lien vaut aussi d'une fenêtre à l'autre. Ouvrir les modifications ou le terminal « à côté » cherche un groupe de la même couleur dans toutes les fenêtres ; s'il n'y en a pas et que l'on est dans une fenêtre détachée, le groupe lié se crée dans la fenêtre principale.
- **Dispositions.** On enregistre sous un nom l'ensemble des groupes, des fenêtres et des panneaux, puis on l'applique depuis le menu de la barre d'état, la palette ou les réglages.
- **Beaucoup de groupes.** Chacun garde une largeur minimale, la zone défile à l'horizontale, et les onglets défilent dans leur barre.

## Fenêtres détachées

Version 27, lot 9. Une fenêtre détachée est une popout dockview du même document : une seule application, une seule connexion au daemon, les mêmes terminaux. **Elle porte un seul groupe**, avec ses onglets (option A, retenue par l'utilisateur le 2026-11-09).

| Geste ou situation | Comportement |
|---|---|
| Glisser un onglet hors de la fenêtre (principale ou détachée) | Une **nouvelle** fenêtre, avec ce seul onglet. Pas de toast : la fenêtre qui apparaît suffit. |
| Glisser hors de la fenêtre le **seul** onglet d'une fenêtre détachée | La fenêtre se déplace là où on le lâche ; aucune fenêtre n'est créée. |
| Un onglet déjà ouvert, demandé à nouveau | Il est seulement mis au premier plan, où qu'il soit. Aucune entrée de menu « Ouvrir dans une nouvelle fenêtre » : seul le glisser hors de la fenêtre en crée une. |
| Diviser (`Ctrl+\`, bouton du groupe, menu de l'onglet) | **Absent** dans une fenêtre détachée : le bouton et l'entrée du menu ne s'affichent pas, et `Ctrl+\` n'y fait rien. |
| « Ouvrir à droite », `Ctrl`+clic, quand le groupe actif est dans une fenêtre détachée | L'onglet s'ouvre dans la fenêtre principale, dans un groupe à droite. |
| Zone « nouveau groupe » pendant un glisser | Seulement dans la fenêtre principale. Déposer sur le groupe d'une fenêtre détachée y ajoute l'onglet. |
| Groupe vidé | La fenêtre détachée se ferme. |
| **Fermer** une fenêtre détachée (son ✕, `Alt+F4`) | Ses onglets **reviennent dans la fenêtre principale**, en un groupe à droite qui garde sa couleur de lien. Rien n'est fermé : les shells ne sont pas tués, un terminal attaché reste attaché. Toast : « Fenêtre fermée : ses 2 onglets reviennent dans la fenêtre principale. » |
| Fermer la fenêtre principale (✕) | Elle se cache déjà dans la zone de notification ; les fenêtres détachées se cachent avec elle et réapparaissent avec elle, à leur place. Aucun avertissement. « Quitter » (zone de notification) ferme tout, sans avertissement. |
| Redémarrage de Ledge | Avec « Au démarrage : la dernière disposition », les fenêtres détachées rouvrent sur leur écran, à leur taille et à leur place, avec leurs onglets. Une disposition fixe ou « L'atelier seul » s'applique telle quelle. |
| Écran débranché | La fenêtre rouvre sur l'écran principal, à sa taille (réduite à l'écran si besoin), centrée. |
| Panneau du bas | Seulement dans la fenêtre principale. Un terminal glissé dans une fenêtre détachée y devient un onglet ; pour le ranger dans le panneau du bas, on le glisse sur celui de la fenêtre principale. Fermer la fenêtre le ramène comme onglet, pas dans le panneau. |
| Atelier | « Détacher » envoie l'onglet atelier, seul, dans une nouvelle fenêtre. Hors de la fenêtre principale, le bouton devient « Ramener » et rend l'onglet au groupe actif de la fenêtre principale. L'onglet atelier se glisse aussi comme les autres. |
| Dispositions | Elles enregistrent les fenêtres détachées (une par groupe), leur écran et leur taille. |

**Barre de titre d'une fenêtre détachée.** Comme la principale (`decorations: false`), sans la recherche ni les bascules de panneaux : la marque Ledge, au centre le nom de l'onglet actif, à droite les boutons Réduire, Agrandir et Fermer (`WindowCaps`). Le nom suit l'onglet actif : « dev-front · ledge-dev » pour un siège, « Pim · ledge » pour une session, sinon le titre de l'onglet sans compteur (« À toi », « Atelier »). Titre dans la barre des tâches Windows : « {onglet actif} — Ledge ». La fenêtre principale garde « Ledge Desktop ».

**Pendant un glisser.** Un bandeau en bas de la fenêtre d'où part l'onglet :

| État | FR | EN |
|---|---|---|
| Glisser un onglet | Lâchez l'onglet hors de la fenêtre pour l'ouvrir dans une nouvelle fenêtre | Drop the tab outside the window to open it in a new window |
| Glisser un terminal (panneau du bas ou onglet terminal) | Lâchez le terminal hors de la fenêtre pour l'ouvrir dans une nouvelle fenêtre | Drop the terminal outside the window to open it in a new window |
| Le pointeur a quitté la fenêtre (le bandeau reste visible dans la fenêtre) | Lâchez : nouvelle fenêtre | Drop: new window |

Autres textes : toast de fermeture « Fenêtre fermée : son onglet revient dans la fenêtre principale. » / « Fenêtre fermée : ses {n} onglets reviennent dans la fenêtre principale. » (EN : “Window closed: its tab is back in the main window.” / “Window closed: its {n} tabs are back in the main window.”). Infobulle du ✕ : « Fermer : les onglets reviennent dans la fenêtre principale » (EN : “Close: the tabs go back to the main window”).

## Une session ou un siège dans un onglet

- **Onglet :** logo du provider (Anthropic, OpenAI, omp), nom, pastille d'état aux couleurs de l'encoche. L'onglet est souligné en rouge pour une autorisation, en ambre pour une question. Un siège affiche aussi le nom de son rig. La vue terminal ajoute `>_`.
- **Vues :** le fil par défaut ; le terminal par `Ctrl+`` ou le clic droit sur l'onglet ; role.md pour un siège, par le clic droit. Il n'y a pas de sélecteur de vue.
- **Demandes :** une autorisation se tranche par `Y` / `N` sur la session active, où qu'elle soit. Une question se répond par ses options. On peut aussi trancher depuis « À toi ».
- **Réponse :** un champ sur plusieurs lignes sous le fil (Entrée envoie, Maj+Entrée passe à la ligne ; pour un siège, c'est un `rig send`). Il n'existe pas dans la vue terminal.
- **Barre du bas de l'onglet**, de gauche à droite :
  - le **modèle** (un clic propose les modèles du même harnais) ;
  - le **contexte** de la session (barre et pourcentage ; le survol donne les jetons utilisés sur la fenêtre) ;
  - la branche ;
  - le projet (ou le rig et le rôle) ;
  - la puce de sa MR ou PR (pipeline et numéro), s'il y en a une ;
  - « Interrompre » pendant le travail ;
  - **tout à droite, les modifications** : une icône, `+N` en vert et `−N` en rouge. Un clic les ouvre à côté, dans un groupe lié. **Rien ne s'affiche quand la session n'a rien modifié.**

  La barre se resserre dans un groupe étroit : le projet disparaît d'abord, puis le pourcentage, puis la branche. La limite d'usage n'y apparaît **jamais**.
- **Session archivée :** elle s'ouvre en lecture seule, avec un bandeau « Session archivée » et « Désarchiver », sans zone de réponse.

## Nouvelle session

Elle s'ouvre dans une **fenêtre modale**, jamais en page ni en onglet. On l'ouvre par le + d'un groupe, par `N` (quand aucune autorisation n'attend dans le groupe actif, sinon `N` refuse), par « + N » dans la vue Projets ou par la palette.

Les champs : projet, où travailler (nouvelle branche dans un worktree, ou `main` dans le dossier du projet), agent (Claude Code, Codex, Cursor Agent, omp, chacun avec la limite 5 h de son compte), modèle, permissions, premier message, où ouvrir la session (groupe actif, à droite). Le texte d'aide en haut reprend l'endroit choisi. `Ctrl+Entrée` lance, Échap ferme. Une fois lancée, la session s'ouvre à l'endroit choisi et se met au travail.

## À toi

- **Vue À toi** (barre latérale) : les demandes, tranchables sur place.
- **Page À toi**, qui remplace l'Accueil : elle s'ouvre en onglet, par le bouton « Page » de la vue À toi, ou par « Voir » sur la demande d'un rig (sa carte s'y déplie). Lot 12 : elle reprend aussi ce que montrait « Le point » de l'Accueil. Ses blocs, dans l'ordre :
  - les **demandes** (autoriser, refuser, répondre, ouvrir) ;
  - les **décisions** que les sessions posent par Ledge (`ledge decide`, propositions de notes), avec « Répondre » ;
  - les **demandes des rigs** OpenRig ;
  - les **MR et PR** qui attendent l'utilisateur : pipeline échoué (« Demander à X de corriger ») ou prête à fusionner (« Fusionner ») ;
  - les sessions dont le **contexte est presque plein** (passer le relais, ou plus tard) ;
  - **terminé depuis ton passage** : les sessions qui ont fini, avec leur dernier message, et les tâches de Ledge closes (« Voir » les ouvre dans « Tâches », « Ranger »).

  « Résumer la journée », en haut, pose la question dans la Conversation du panneau de droite.

## Historique

Les conversations du jour avec Ledge sont l'onglet « Historique » du panneau de droite. Les **Archives** sont en bas de la vue Projets, repliables, comme aujourd'hui. Elles listent les sessions archivées, avec leur projet et leur ancienneté. La palette les trouve aussi (`@`, marquées « archivée »).

## MR et PR

Ledge suit les MR GitLab et les PR GitHub des branches des sessions et des sièges, via `gh` et `glab`.

- **Vue MR et PR** : les ouvertes, puis les fusionnées. Chacune affiche son hôte, son dépôt, son état, son agent, l'état de son pipeline et le nombre de commentaires ouverts.
- **Onglet MR ou PR**, avec quatre vues :
  - **Vue d'ensemble** : description, détails (auteur, relecteurs, étiquettes, ticket, approbations), le **graphe du pipeline** par étapes, « Relancer », le journal du job échoué, « Demander à X de corriger », et une revue avec « Fusionner ». On ne fusionne qu'avec un pipeline réussi et l'approbation requise.
  - **Discussion** : les fils de commentaires. On peut répondre, résoudre, envoyer un fil à l'agent ou « Tout envoyer à X ».
  - **Modifications** : les fichiers, avec leurs commentaires en ligne.
  - **Commits.**

  On y trouve aussi « Ouvrir sur GitHub / GitLab ».

## OpenRig

Tout OpenRig passe par **un seul bouton** de la barre d'activité, **Rigs**. Il n'y a plus de bouton OpenRig à part. Maquette : [`docs/mockups/ledge-ide-rigs.html`](mockups/ledge-ide-rigs.html).

- **Vue Rigs**, de haut en bas :
  - **En-tête :** le titre, la **machine affichée** et « + Lancer ». La machine est un petit bouton (`● WSL ▾`) qui ouvre un menu. Il liste chaque machine avec son type (locale, SSH), le nombre de rigs en marche, et une coche sur celle affichée. Il propose aussi « Gérer les machines… », qui ouvre la page OpenRig sur Machines, et « Ajouter une machine ». Tout ce qui suit concerne la machine affichée.
  - **Kernel**, en premier, avec ses trois sièges :
    - l'**operator**, qui aide à composer et lancer une équipe ;
    - l'**advisor**, qui relit les plans ;
    - le **queue worker**, qui route les lignes de queue. Il reste visible.
  - **Rigs :** chaque rig se replie, avec sa pastille d'état, son nom, son nombre de sièges, puis ses sièges. Un clic sur un siège ouvre son fil.
  - **OpenRig**, collé **en bas** de la barre latérale, au-dessus de « Réduire ». Il ne contient que la ligne du daemon (pastille, version). Un clic sur « Daemon » ouvre la page OpenRig. La ligne est surlignée tant que la page est l'onglet actif.

  Kernel et Rigs défilent, et OpenRig reste en place. Chaque section se replie. Quand le daemon est arrêté, la section Rigs propose seulement « Démarrer OpenRig », et le bouton Rigs de la barre d'activité porte un « ! » ambre.
- **Démarrer, redémarrer, arrêter.** Le kernel, chaque rig et le daemon ont leurs boutons sur leur ligne, dans **la même colonne à droite** : redémarrer puis arrêter quand ils tournent, démarrer sinon. Arrêter devient rouge au survol. On retrouve les mêmes boutons, avec leur texte, dans l'en-tête de la vue Rig et dans la page OpenRig.
- **Vue Rig** (un onglet « Rig · nom »). Elle remplace la topologie. Un clic sur un rig, ou sur le kernel, l'ouvre. On y **gère le rig** :
  - **En-tête :** l'état, le nombre de sièges, la machine, et Redémarrer et Arrêter (ou Démarrer) à droite. La confirmation s'affiche juste en dessous.
  - **Topologie :** les sièges et leurs liens. Un clic sur un siège ouvre son fil. Un rig arrêté montre ses sièges grisés, d'après sa spec.
  - **Réglages :** le fichier de spec, les **permissions du rig** (les six niveaux), les **sièges par rôle** avec un ± (seulement quand le rig tourne), et le **dernier snapshot** avec « Snapshot maintenant ».
  - **File OpenRig :** les lignes de queue du rig.

  Le kernel garde une vue Rig sans réglages : sa topologie, le rôle de chaque siège et « Parler à l'operator ». Dans un groupe étroit, la topologie et les réglages passent l'un sous l'autre.
- **Lancer un rig** (fenêtre modale, comme Nouvelle session). On l'ouvre par « + Lancer » de la vue Rigs, depuis la page OpenRig ou depuis la palette. `Ctrl+Entrée` lance, Échap ferme.
  - **Partir de :** une spec enregistrée, un rig vide, ou « Composer avec l'operator ». Un rig qui tourne déjà est grisé. L'operator est grisé quand le kernel est arrêté.
  - **Avec une spec ou un rig vide :**
    - le nom (modifiable pour un rig vide) ;
    - la machine ;
    - les sièges par rôle, avec un ± ;
    - les permissions ;
    - « Reprendre le dernier snapshot » ;
    - la **commande `rig` exacte**, mise à jour en direct. Elle commence par le démarrage du daemon s'il est arrêté.

    « Lancer » ouvre ensuite la vue Rig du rig.
  - **Avec l'operator :** un champ « Ce que tu veux ». L'operator propose une équipe dans son fil, et rien ne démarre avant que l'utilisateur valide.
- **Page OpenRig** (en onglet « OpenRig · machine »). À gauche, une colonne donne l'état du daemon avec Redémarrer et Arrêter, et ses sections. « Lancer un rig… » est en bas de cette colonne. Les sections :
  - **Vue d'ensemble :** quatre tuiles (daemon, kernel, rigs en marche, sièges actifs dont ceux qui attendent), qui mènent à leur section. Suivent les sièges qui attendent l'utilisateur, puis les dernières commandes.
  - **Rigs :** une carte par rig, kernel compris (marqué « système »). Chaque carte montre l'équipe en puces de rôles avec leur nombre, les boutons de démarrage et d'arrêt, les permissions, le snapshot et « Ouvrir la vue Rig → ». Une dernière carte en pointillés lance un rig.
  - **Rôles :** la liste à gauche, en deux groupes (Kernel ; Équipes), avec le nombre de sièges qui tiennent chaque rôle. À droite, la fiche du rôle choisi :
    - sa description ;
    - son modèle par défaut ;
    - les rigs qui l'utilisent, cliquables ;
    - un aperçu de son fichier de consignes, avec « Modifier » ;
    - « Dupliquer ».
  - **Machines :** chaque machine avec son hôte, sa version d'OpenRig, ses rigs et sa latence, avec « Afficher » et « Ajouter une machine ».
  - **Daemon :** relancer les rigs qui tournaient ; démarrer sans le kernel ; les permissions proposées au lancement (Spec, Auto, Standard, Ouvert, YOLO, Verrouillé), chaque rig gardant les siennes ; avant un arrêt, prendre un snapshot et demander confirmation si un siège travaille.
  - **Sortie :** les commandes `rig` lancées depuis Ledge, la même liste que la Sortie du panneau du bas.

  Dans un groupe étroit, la colonne de gauche devient une rangée d'onglets au-dessus du contenu.
- **Confirmations.** Tout arrêt ou redémarrage (daemon, kernel, rig) demande confirmation. Elle nomme les sièges qui travaillent et montre la commande `rig` exacte. Elle s'ouvre **là où on a cliqué** : sous la ligne dans la vue Rigs, sous l'en-tête dans la vue Rig ou dans la page OpenRig. Le résultat arrive dans la Sortie. L'état des sièges change partout : explorateur, atelier, vue Rig, onglets.

## Terminaux

Quatre sortes, toujours écrites sur l'onglet :
- **attaché** : le tmux d'un agent, on peut y taper ;
- **shell** : un shell local ou distant ;
- **lecture seule** : la capture d'un siège ;
- **commande** : une commande relancée, par exemple `rig ps`.

Ils vivent dans le panneau du bas, côte à côte, ou comme onglets.
- **Ouvrir un shell :** le menu « + ▾ » du panneau propose WSL, PowerShell, l'invite de commandes, Git Bash, Ledge (les CLI `ledge` et `rig`) et SSH vers une machine. Le dernier choisi devient celui par défaut.
- **Déplacer :** un terminal du bas se glisse vers un groupe ou hors de la fenêtre. On le dépose sur le panneau du bas pour l'y ramener.
- **Fermer :** fermer le dernier terminal masque le panneau. `Ctrl+J` le rouvre avec un shell.

Le rendu WebGL est limité à un nombre de terminaux visibles (12 par défaut, réglable). Au-delà, et pour les terminaux masqués, le rendu passe en DOM. Les navigateurs limitent le nombre de contextes WebGL.

## Limites d'usage

Elles s'affichent en bas de l'IDE, et seulement là. Pour chaque compte (Claude Code, Codex), la barre d'état montre la fenêtre 5 h (barre, pourcentage, heure de réinitialisation) et la semaine. Un clic ouvre le détail : 5 h, semaine, semaine par modèle. omp affiche « limite non lue ».

Au-delà du seuil d'alerte (80 % par défaut, réglable), la valeur passe en ambre. Les données sont celles que le daemon lit déjà (`packages/protocol/src/usage.ts`).

## Atelier

L'atelier validé (l'open-space en quinconce) est gardé **tel quel**, dans un onglet. Seuls changent les gestes : un clic sur un agent ouvre sa session selon le réglage, `Ctrl`+clic l'ouvre à droite. « Projets | Rigs », « Masquer les sous-agents » et « Détacher » restent. Détaché, l'atelier est un onglet dans une fenêtre détachée, et le bouton devient « Ramener » (voir « Fenêtres détachées »). Le bureau de Ledge ouvre le chat dans le panneau de droite.

## Réglages

Les réglages s'ouvrent en onglet (`Ctrl+,`). Les sections d'avant ne changent pas ; Général gagne « Au démarrage, reprendre les sessions ouvertes ». Une seule section est nouvelle, **Espace de travail** :

- **Ouvrir une session :** dans le groupe actif, ou à droite.
- **Au démarrage :** la dernière disposition, une disposition fixe, ou l'atelier seul.
- **Dispositions :** appliquer ou supprimer.
- **Barre d'état :** les limites d'usage ; le seuil d'alerte.
- **Ouvrir dans… :** Cursor, VS Code ou Zed.
- **Terminaux :** le nombre de terminaux en rendu WebGL.

## Raccourcis

| Raccourci | Effet |
|---|---|
| `Ctrl+K` | Palette : `@` pour les sessions et les sièges, `>` pour les commandes. |
| `N` | Nouvelle session (fenêtre modale). |
| `Y` / `N` | Autoriser ou refuser la demande de la session active. |
| `Ctrl+`` | Basculer fil ⇄ terminal sur l'onglet actif. |
| `Ctrl+Shift+`` | Sortir du terminal sans changer de vue : le clavier va sur l'onglet du groupe (`←` / `→` parcourent les onglets, `Entrée` en affiche un). Tous les raccourcis de Ledge refonctionnent. Depuis l'onglet, la même touche remet le clavier dans le terminal affiché. |
| `Ctrl+1…9` | Aller au groupe N, le clavier sur son onglet ; marche aussi depuis un terminal. |
| `Ctrl+\` | Diviser le groupe à droite. |
| `Ctrl+B` | Replier ou déplier la barre latérale. |
| `Ctrl+J` | Afficher ou masquer le panneau du bas. |
| `Ctrl+/` | Afficher ou masquer le panneau de droite. `/` (hors d'un champ) l'ouvre sur la Conversation. |
| `Ctrl+W` / `Ctrl+Maj+T` | Fermer l'onglet ; rouvrir le dernier fermé. |
| `Ctrl+Tab`, `Ctrl+PgSuiv` / `PgPréc` | Onglet suivant ou précédent du groupe. |
| `Ctrl+Alt+←` / `→` | Envoyer l'onglet dans le groupe voisin. |
| `?` | La liste des raccourcis. |
| `Ctrl+,` | Réglages. |
| `Ctrl+Entrée` | Lancer la nouvelle session, ou le rig dans « Lancer un rig ». |
| Échap | Fermer une fenêtre modale, un menu, une confirmation. |

## Points ouverts

- **Multi-fenêtres et librairie de panneaux.** On vise des fenêtres popout d'un même document avec dockview, à prouver au lot 0 du plan, fluidité comprise.
- **Composition du kernel.** Il faut vérifier sur une installation réelle quels sièges `rig ps --nodes --rig kernel` liste.
- **Ce qu'OpenRig fournit pour la vue Rig, le lancement et les rôles** (lot 7a) :
  - les specs enregistrées et leurs rôles, y compris pour un rig arrêté ;
  - les permissions propres à chaque rig ;
  - un snapshot à la demande ;
  - les fichiers de consignes des rôles ;
  - « Composer avec l'operator ».

  Ce qui manque est grisé ou retiré, après accord de l'utilisateur.
- **Atelier dans un onglet étroit.** Il est gardé tel quel. Il faut vérifier sa lisibilité quand le groupe est étroit, sans le modifier.
- **États à dessiner :** `gh` ou `glab` absent ou non authentifié, daemon coupé dans l'IDE, fenêtre de moins de 1280 px.
