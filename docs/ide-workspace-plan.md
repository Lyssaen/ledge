# Refonte IDE de Ledge Desktop — plan d'implémentation

Plan rédigé le 2026-11-06 (v2, sur la maquette qui a évolué), à valider par l'utilisateur avant toute tâche d'implémentation.

- **Référence :** [`docs/mockups/ledge-ide-interactive.html`](mockups/ledge-ide-interactive.html), version 26 du prototype en ligne (https://claude.ai/artifact/GFWW4nhGxs2DLSxFW5R62B), **validée par l'utilisateur le 2026-11-06**. Le design est décrit dans [`docs/ide-workspace.md`](ide-workspace.md), mis à jour sur cette version.
- **Périmètre :** Ledge Desktop. Hors périmètre : le mur d'agents, les écrans Tâches et Brain, le TUI, le téléphone, l'encoche.

## 1. Ce que la maquette a changé depuis la doc validée

| Sujet | Doc du 2026-11-05 | Prototype en ligne |
|---|---|---|
| **MR et PR** | — | Nouvelle vue de la barre d'activité (badge : pipelines échoués) : MR GitLab et PR GitHub des branches des sessions et des sièges, via `gh` et `glab`. Un onglet MR/PR contient la vue d'ensemble (description, détails, **graphe du pipeline**, journal du job échoué, Relancer, « Demander à X de corriger », Fusionner seulement si pipeline vert et approuvée), la discussion (fils, répondre, résoudre, envoyer un fil ou tout envoyer à l'agent), les modifications (avec commentaires en ligne) et les commits. « Ouvrir sur GitHub/GitLab ». Compteur dans la barre d'état, puce MR/PR sous la réponse de la session. |
| Panneau de droite | À toi + résumé de session + chat | **Le chat de Ledge seul.** « À toi » ne vit plus que dans la barre latérale. |
| Onglet de session | Vues Fil / Modifications / Terminal / role.md | Plus de sélecteur de vue. `Ctrl+`` bascule fil ⇄ terminal. role.md, « Ouvrir dans Cursor », diviser, fermer et fermer les autres passent par le **clic droit sur l'onglet**. Réponse sur plusieurs lignes (Entrée envoie, Maj+Entrée passe à la ligne). **Barre du bas de l'onglet** : modèle, contexte, branche, projet (ou rig · rôle), puce MR/PR, Interrompre. |
| Nouvelle fenêtre | Bouton « Détacher » d'un groupe | **On arrache un onglet hors de la fenêtre** et il s'ouvre dans une nouvelle fenêtre. Le glisser dans un groupe le ramène. « Détacher » ne reste que dans l'atelier. |
| Panneau du bas | Terminaux + sortie | Les terminaux sont côte à côte. « + ▾ » choisit le shell : WSL, PowerShell, invite de commandes, Git Bash, Ledge (CLI `ledge`/`rig`), SSH vers une machine. Le dernier choisi devient celui par défaut. Un terminal se glisse vers un groupe ou hors de la fenêtre, et revient en le déposant sur le panneau. Fermer le dernier terminal masque le panneau. |
| Barre latérale | — | Redimensionnable (sous 150 px elle se replie, un double-clic rend la largeur par défaut), « Réduire », `Ctrl+B`. |
| Dispositions | Vue Projets, palette, réglages | **Menu de la barre d'état** (appliquer, enregistrer, gérer), palette, réglages. |
| Réglages › Espace de travail | Avec « Panneau de droite » | Sans les options du panneau de droite. |
| Page OpenRig | — | Choix de la machine (WSL, srv-build). Permissions au lancement : Spec, Auto, Standard, Ouvert, YOLO, Verrouillé. |
| **Rigs et OpenRig** (2026-11-07, [`ledge-ide-rigs.html`](mockups/ledge-ide-rigs.html)) | Deux boutons : la vue Rigs, et la page OpenRig en onglet | **Un seul bouton Rigs.** Dans la vue : la machine dans un menu de l'en-tête, Kernel en haut, les Rigs, et OpenRig (le daemon) collé en bas. Démarrer, redémarrer et arrêter sur chaque ligne, dans la même colonne. La **topologie devient la vue Rig**, où l'on gère le rig (permissions, ± par rôle, snapshot, file). « + Lancer » ouvre une **fenêtre modale « Lancer un rig »**. La **page OpenRig** passe en sections (Vue d'ensemble, Rigs, Rôles, Machines, Daemon, Sortie) et s'ouvre par un clic sur le daemon. |

Les **Modifications** d'une session avaient été retirées volontairement. Elles reviennent sous une forme compacte dans la barre du bas de l'onglet (voir 4.1).

## 2. Point de départ dans le code (`origin/main`, 0.49.0)

La copie locale `main` a 369 commits de retard. Tout part de `origin/main`.

| Brique | Existe | Où |
|---|---|---|
| Fil, Modifications, écran d'agent | en page | `session/SessionPage.tsx` (555 l.), `Changes.tsx`, `TermPane.tsx` |
| Modèle et contexte | dans l'en-tête | `usage/SessionMeta.tsx` |
| Limites d'usage en barre d'état | oui | `usage/UsageFooter.tsx`, `shell/Footer.tsx` |
| Formulaire de lancement | en « place » | `launch/LaunchComposer.tsx` |
| Page OpenRig, sortie, ± sièges | oui | `openrig/*` |
| Fenêtre détachée | l'atelier seulement, une app complète par fenêtre et des événements Tauri | `atelier/detach.ts`, `open_atelier` |
| Terminaux | un magasin par fenêtre, sortie PTY par `Channel` lié à la fenêtre qui l'ouvre | `term/store.ts`, `src-tauri/src/pty.rs` |
| Groupes, onglets, liens, dispositions, MR/PR, topologie, « Ouvrir dans… » | **non** | — |

Le cœur du changement, c'est que `nav/state.ts` ne décrit qu'**une place** à l'écran. Il doit devenir un **espace de travail** fait de fenêtres, de groupes et d'onglets.

## 3. Choix techniques, remis en question

### 3.1 Plusieurs fenêtres : un seul document JavaScript, pas une application par fenêtre

Aujourd'hui, l'atelier détaché charge **une seconde application complète**, avec sa propre connexion au daemon et son propre magasin de terminaux, et les deux fenêtres se synchronisent par événements. Étendre ce modèle à des groupes arrachés coûte cher. Il faudrait synchroniser l'état de l'espace de travail, les liens de couleur entre fenêtres et les brouillons. Il faudrait surtout **déplacer des PTY**, dont la sortie part dans un `Channel` lié à la fenêtre d'origine.

**Recommandation : des fenêtres « popout » du même document.** Tauri 2 sait répondre à `window.open` par une vraie fenêtre (`on_new_window` → `NewWindowResponse::Create`). Sous Windows, il suffit que la nouvelle webview partage l'environnement WebView2 de l'appelante. La fenêtre ouverte reste alors scriptable par la fenêtre principale : React y rend par portail. On garde **un seul arbre React, une seule connexion au daemon, un seul magasin de terminaux, et les mêmes `Channel` PTY**. Le problème du déplacement d'un shell disparaît, comme toute la synchronisation entre fenêtres. C'est aussi le modèle de la v1 de l'atelier détaché qu'on pourra simplifier.

À prouver au lot 0. Si WebView2 renvoie une fenêtre inaccessible depuis la principale, on se replie sur le modèle actuel : une application par fenêtre, plus une commande `pty_rebind`.

### 3.2 La librairie de panneaux : dockview, à condition que le lot 0 tienne

Avant, je penchais pour un modèle maison. Je change d'avis : **dockview** fait exactement ce mécanisme de popout. `addPopoutGroup` passe par un `window.open` de même origine et signale l'échec quand la fenêtre est inaccessible (`unscriptable`). Elle fournit aussi le glisser-déposer entre groupes, les divisions et la sérialisation, soit des semaines de travail fiable qu'on n'écrit pas.

Ce qu'on garde chez nous, au-dessus de son API :
- `workspace/model.ts` : les règles propres à Ledge. Un onglet n'est jamais dupliqué, les groupes sont liés par couleur et suivent la session (y compris d'une fenêtre à l'autre), « Ouvrir une session » respecte le réglage, et `reconcile` agit quand une session disparaît. Le tout est testé sans DOM.
- Le rendu des onglets (logo, pastille, soulignement) et de l'en-tête de groupe (carré de lien, +, diviser), d'après la maquette.
- L'arrachage hors de la fenêtre. dockview gère le glisser à l'intérieur ; on détecte la sortie de la fenêtre (`dragend` hors des limites) et on appelle `addPopoutGroup`.

Repli si le lot 0 échoue : le modèle maison, avec des séparateurs CSS.

### 3.3 Tauri, et pas Electron

J'ai envisagé Electron, la base de VS Code. Je ne le retiens pas. Sous Windows, WebView2 est déjà Chromium, et le multi-fenêtres se règle par 3.1. Une migration (empaquetage, mise à jour, encoche, `pty.rs`, `notch.rs`) coûterait plus que toute la refonte.

### 3.4 MR et PR : côté daemon, avec `gh` et `glab`

On ne met **aucun jeton dans Desktop**. Le daemon de la machine où vit le dépôt lance `gh` et `glab`. L'authentification et le proxy d'entreprise y sont déjà réglés, et ça fonctionne pour une machine distante comme srv-build. Il relève les MR et PR des branches des sessions et des sièges, avec un rafraîchissement par intervalle (plus rapide quand un pipeline tourne). Le protocole reçoit un type `PullRequest` et des actions (relancer, fusionner, commenter, résoudre). Les webhooks sont exclus, car rien n'entre derrière le proxy. On vérifie au lot 8a que `glab` vise bien l'instance GitLab de l'entreprise.

### 3.5 Terminaux et WebGL

Chromium plafonne le nombre de contextes WebGL par processus de rendu (autour de 16). Avec un seul document (3.1), le budget est **global** et se gère en un seul endroit, `term/surface.ts`. Au-delà de 12 terminaux visibles (réglable), et pour tout terminal masqué, le rendu passe en DOM. Les xterms vivent déjà dans le magasin, hors de React, donc un onglet masqué ne perd rien.

### 3.6 État

Le modèle d'espace de travail est un magasin hors de React (`useSyncExternalStore`), sur le modèle de `daemonStore` dans `@ledge/fleet`. Les fenêtres popout et les portails le lisent sans propagation de props. La disposition est enregistrée en JSON versionné.

## 4. Décisions (prises le 2026-11-06)

| # | Décision |
|---|---|
| D0 | Le prototype en ligne est **la version validée**. `design-ux` le recopie dans `docs/mockups/ledge-ide-interactive.html` et met `docs/ide-workspace.md` à jour, avec le complément de la section 4.1. |
| D1 | **Interrupteur** « Interface IDE (aperçu) ». Chaque lot arrive sur `main` ; l'ancienne interface est retirée au lot 12. |
| D2 | Fenêtres popout d'un même document et dockview, **sous réserve du lot 0**, qui doit aussi prouver la fluidité (4.2). Si une autre technique s'avère meilleure pour le multi-fenêtres, on revient vers l'utilisateur. |
| D3 | **L'Accueil disparaît et devient la page « À toi ».** L'**Historique** revient sous forme d'archives, comme aujourd'hui (`shell/sidebar/Archives.tsx`). Les deux passent par un complément de maquette (4.1). |
| D4 | Une PR par lot vers `main`, relue par `review-qa`, fusionnée sur accord de l'utilisateur. |
| D5 | Le queue worker du kernel reste visible. |
| D6 | (2026-11-07) Les rigs et OpenRig suivent [`docs/mockups/ledge-ide-rigs.html`](mockups/ledge-ide-rigs.html), validée par l'utilisateur, qui remplace la version 26 sur ce sujet. Le bouton OpenRig de la barre d'activité disparaît. Le lot 7 est réécrit en conséquence. |

### 4.1 Complément de maquette, à faire par `design-ux` et à faire valider par l'utilisateur

1. **Modifications d'une session.** L'utilisateur les avait retirées volontairement. On les garde (2026-11-06) sous une seule forme, définie par lui : à **l'extrémité droite de la barre du bas de l'onglet**, une icône suivie de `+N` en vert et de `−N` en rouge (la somme des lignes ajoutées et retirées par la session, telles que `changedFiles` les compte déjà dans le fil). Le clic ouvre les Modifications à côté, dans un groupe lié (le comportement `beside` déjà codé dans le prototype). Pas d'autre point d'entrée. Quand la session n'a rien modifié, rien ne s'affiche (confirmé par l'utilisateur).
2. **Historique en archives.** Une section « Archives » repliable en bas de la vue Projets : les sessions archivées avec leur projet et leur ancienneté. Une archive s'ouvre en lecture seule, avec un bandeau « Session archivée » et « Désarchiver », sans zone de réponse.
3. **La page « À toi ».** Elle remplace l'Accueil et s'ouvre **dans une nouvelle fenêtre**, depuis le bouton « Page » de la vue À toi ou depuis la palette. Elle contient trois blocs : les demandes (tranchables sur place), les MR et PR qui attendent l'utilisateur (pipeline échoué, prête à fusionner) et les sessions qui ont fini depuis son dernier passage. **Le panneau de droite est réservé au chat de Ledge.**
4. Les points 1 à 3 sont dans la version 26 du prototype, **validée par l'utilisateur le 2026-11-06** (parcours Playwright visible).
5. **États absents** à dessiner : `gh` / `glab` absents ou non authentifiés, daemon coupé dans l'IDE, fenêtre de moins de 1280 px.

### 4.2 Fluidité : le critère du lot 0

Avec des popouts du même document, toutes les fenêtres partagent un seul fil JavaScript. VS Code fait le même choix pour ses fenêtres flottantes (« auxiliary windows » ouvertes par `window.open`). Le risque est réel quand beaucoup de terminaux affichent en même temps. Le lot 0 mesure donc une charge réaliste :

- **La charge :** 3 fenêtres, 16 terminaux dont 6 qui affichent en continu (`yes`, une compilation), 4 fils de session ouverts, un glisser d'onglet.
- **Ce qui doit tenir :**
  - moins de 50 ms entre une frappe et son écho dans un terminal attaché ;
  - aucune image de plus de 100 ms pendant le défilement d'un fil ;
  - pas de saccade pendant un glisser d'onglet.

Si ça ne tient pas, on mesure le même scénario avec une application par fenêtre (le modèle actuel, plus `pty_rebind`) et on présente les deux résultats à l'utilisateur.

## 5. Les lots

Le front suit la maquette. Tout état absent (vide, erreur, daemon coupé, fenêtre de moins de 1280 px) se demande à `design-ux`.

**Lot 0 — Preuves techniques et modèle · dev-back + dev-front.** Trois preuves, dans une maquette Tauri jetable :
1. `window.open` → une fenêtre Tauri dans le même environnement WebView2, scriptable, avec un portail React dedans.
2. Un PTY ouvert dans la fenêtre principale qui s'affiche dans la popout.
3. dockview avec `addPopoutGroup`, l'arrachage d'un onglet hors de la fenêtre, et 16 xterms WebGL.

En parallèle, `workspace/model.ts` en logique pure, couvert par des tests vitest. On mesure la fluidité selon 4.2 et on conclut D2 par écrit, chiffres à l'appui. Aucun effet visible.

**Lot 1 — Coque · dev-front.** Derrière l'interrupteur : la barre de titre, la barre d'activité (Projets, Rigs, À toi, MR et PR, OpenRig, Atelier, Réglages), la barre latérale redimensionnable (« Réduire », `Ctrl+B`), un groupe dockview, le panneau du bas (`Ctrl+J`), le panneau de droite avec le chat seul (`Ctrl+/`) et la barre d'état (on reprend `Footer` et `UsageFooter`). On reprend les vues Projets et À toi depuis `shell/sidebar/Tree.tsx` et `Attention.tsx`.

**Lot 2 — Session et siège en onglet · dev-front.** `SessionPage` devient le contenu d'un onglet, avec son état propre (vue, défilement, brouillon). L'onglet porte le logo, la pastille et le soulignement. On ajoute la barre du bas de l'onglet (on reprend `SessionMeta`, plus le modèle via `ModelMenu`, la branche et le projet ; à l'extrémité droite, l'icône `+N`/`−N` qui ouvre les Modifications à côté, avec les compteurs de `session/changedFiles.ts` ; la puce MR/PR vient au lot 8), la réponse sur plusieurs lignes, `Ctrl+`` (fil ⇄ terminal), le menu de l'onglet (role.md, diviser, fermer, fermer les autres) et `Y` / `N` sur la session active du groupe actif.

**Lot 3 — Groupes · dev-front.** Diviser (`Ctrl+\`) avec le groupe vide et ses propositions, glisser vers un groupe ou une nouvelle colonne, largeur minimale et défilement, liens de couleur, menu clic droit de l'explorateur, réglage « Ouvrir une session » et `Ctrl`+clic.

**Lot 4 — Nouvelle session en modale · dev-front.** `LaunchComposer` dans `shell/Modal.tsx`, avec le champ « Ouvrir » et la limite 5 h de chaque agent. On l'ouvre par le +, par `N` (refusé si une autorisation attend), par « + N » et par la palette. `Ctrl+Entrée` lance, Échap ferme.

**Lot 5 — Panneau du bas et terminaux · dev-front + dev-back.** Les terminaux côte à côte, avec leur nombre en icône, et la sortie des commandes `rig`. Le menu « + ▾ » des shells. Côté back, on découvre ce qui est installé (WSL, PowerShell, cmd, Git Bash, CLI Ledge, machines SSH). Un terminal glisse vers un groupe ou en sort, et revient sur le panneau. Fermer le dernier masque le panneau. Les quatre sortes de terminal sont écrites sur l'onglet. On pose le budget WebGL (3.5).

**Lot 6 — Réglages et atelier en onglets · dev-front.** Les Réglages s'ouvrent en onglet (`Ctrl+,`) avec la section Espace de travail. L'atelier passe en onglet **sans modification** : seuls ses gestes changent. On signale à `design-ux` sa lisibilité dans un groupe étroit.

**Lot 7 — Rigs et OpenRig · 7a dev-back, 7b à 7d dev-front.** On suit [`docs/mockups/ledge-ide-rigs.html`](mockups/ledge-ide-rigs.html) (D6) et la section « OpenRig » de [`docs/ide-workspace.md`](ide-workspace.md).
- **7a, relevé et protocole.** On relève sur une vraie installation :
  - ce que liste `rig ps --nodes --rig kernel` ;
  - les liens entre sièges, pour la topologie ;
  - les specs enregistrées et leurs rôles, lisibles même quand le rig est arrêté ;
  - les permissions propres à chaque rig ;
  - la commande de snapshot à la demande ;
  - les fichiers de consignes des rôles (lire, ouvrir, dupliquer) ;
  - la reprise d'un snapshot au lancement ;
  - la façon de confier une demande à l'operator.

  On les expose dans le protocole, machine par machine (les machines viennent déjà du daemon). Tout ce qu'OpenRig ne fournit pas est listé à l'utilisateur avant 7b : l'écran le grise ou le retire.
- **7b, vue Rigs.**
  - Le bouton OpenRig de la barre d'activité disparaît (vue `rigs` seule, plus d'`openrigTab` dans `ActivityBar`).
  - La vue, de haut en bas : l'en-tête avec le menu des machines et « + Lancer », Kernel, Rigs, puis OpenRig collé en bas (la ligne du daemon, dont le clic ouvre la page).
  - Démarrer, redémarrer et arrêter dans une colonne fixe à droite de chaque ligne. La confirmation s'ouvre sous la ligne cliquée, avec la commande `rig` exacte.
  - L'état « daemon arrêté » et le « ! » sur le bouton Rigs.
  - On reprend `openrig/model.ts`, `grouping.ts` et `sidebarState.ts`.
- **7c, vue Rig.** L'onglet « Rig · nom » remplace la topologie et est le seul écran entièrement nouveau.
  - L'en-tête avec ses boutons.
  - La topologie, aux sièges grisés quand le rig est arrêté.
  - Les réglages : spec, permissions du rig, ± par rôle (on reprend `SeatsDialog` et `SeatSettings`), snapshot.
  - La file OpenRig.
  - La vue du kernel avec « Parler à l'operator ».
  - La disposition étroite.
- **7d, lancement et page OpenRig.**
  - « Lancer un rig » en fenêtre modale (`shell/Modal.tsx`, comme Nouvelle session au lot 4), à partir de `RigLaunchForm`. Elle propose : spec, rig vide ou operator ; la machine ; le ± par rôle ; les permissions ; la reprise du snapshot ; la commande en direct ; `Ctrl+Entrée` et Échap.
  - La page OpenRig en sections : Vue d'ensemble, Rigs en cartes, Rôles (on reprend `openrig/roles/*`), Machines, Daemon, Sortie. La Sortie reprend le journal `openrig/rigOutput.ts` du lot 5.
  - La colonne de gauche devient une rangée d'onglets dans un groupe étroit.
  - Elle remplace `OpenRigPage.tsx` dans l'IDE.

**Lot 8 — MR et PR · 8a dev-back, 8b dev-front.** C'est le plus gros ajout de la maquette.
- 8a : le relevé `gh` / `glab` côté daemon (3.4), le protocole, et les actions relancer, fusionner, commenter, répondre, résoudre, ouvrir dans le navigateur.
- 8b : la vue MR et PR, l'onglet avec ses quatre vues et le graphe du pipeline, « Demander à X de corriger » et « Tout envoyer à X » (un message à la session, ou un `rig send` pour un siège), la puce sous la réponse, le compteur dans la barre d'état.
- Fusionner reste derrière une confirmation, et seulement avec un pipeline vert et une approbation.

**Lot 9 — Plusieurs fenêtres · dev-front (+ dev-back pour Tauri).** On arrache un onglet ou un terminal pour ouvrir une nouvelle fenêtre, et on le glisse dans un groupe pour le ramener. Les liens de couleur fonctionnent d'une fenêtre à l'autre. On mémorise l'écran et la taille. L'atelier détaché passe sur le même mécanisme, ce qui supprime `atelier/detach.ts` et ses événements.

**Lot 10 — Dispositions et palette · dev-front.** Le menu des dispositions dans la barre d'état (appliquer, enregistrer, gérer), le choix « Au démarrage », et la palette (`@` pour les sessions et les sièges, `>` pour les commandes, y compris MR et PR et les dispositions). Côté rigs, la palette propose « Lancer un rig… », « Ouvrir la vue Rig de… » (rigs et kernel), les sections de la page OpenRig et le changement de machine.

**Lot 11 — « Ouvrir dans… » · dev-back.** Cursor, VS Code ou Zed. Desktop tourne sous Windows et les worktrees dans WSL : on passe `--folder-uri vscode-remote://wsl+<distro>/<chemin>`, ou `ssh-remote+<hôte>` pour une machine distante. Zed n'a pas d'équivalent WSL fiable : on le signale.

**Lot 12 — Bascule finale · dev-front.** L'IDE devient la seule interface. On retire l'interrupteur, `nav/state.ts`, `shell/sidebar/*`, `TopBar`, la vue Accueil (selon D3), l'ancienne `OpenRigPage` et la place OpenRig de l'ancienne navigation, le CSS mort et `atelier/detach.ts`. On met à jour `docs/ledge-guide.md` (`PLACE_KIND` / `MODAL_KIND`), les textes en et fr et `ledge brain @ledge`, et on réécrit les e2e qui visent l'ancienne navigation.

## 6. Ordre et parallélisme

```
L0 ──► L1 ──► L2 ──┬──► L3 ──┬──► L9 ──► L10 ──┐
                   ├──► L4   │                  │
                   ├──► L5 ──┘                  ├──► L12
                   ├──► L6                      │
                   ├──► L7a ► L7b ► L7c ► L7d ──┤
                   ├──► L8a ► L8b ──────────────┤
                   └──► L11 ────────────────────┘
```

`dev-front` enchaîne L0, L1, L2, L3, puis L5 et L9. `dev-back` fait les preuves Tauri de L0, puis L7a, L8a (qui peut commencer dès L0, car il ne touche pas l'écran), L11 et la partie shells de L5. Le reste se répartit une fois L2 fusionné.

## 7. Vérification à chaque lot

- vitest pour la logique (modèle, liens, budget WebGL, relevé MR/PR) ; `pnpm --filter desktop test` sous Node 22.
- Playwright en 1920×1080, avec captures zoomées comparées au prototype et contrôle des alignements.
- Revue `review-qa`. Le compte rendu dit quoi essayer (branche, commit, geste).

## 8. Risques

| Risque | Parade |
|---|---|
| WebView2 rend une popout inaccessible depuis la fenêtre principale | Lot 0, avant tout le reste. Repli : une application par fenêtre et `pty_rebind`. |
| L'arrachage hors de la fenêtre se détecte mal avec le glisser HTML5 dans WebView2 | Lot 0. Repli : l'entrée « Nouvelle fenêtre » du menu de l'onglet. |
| `SessionPage` suppose une seule session à l'écran (focus, `ScreenKeys`) | Lot 2 dédié : les raccourcis visent la session active du groupe actif. |
| `gh` / `glab` absents ou non authentifiés sur une machine | La vue MR et PR le dit pour cette machine (texte à demander à `design-ux`). |
| Fusionner depuis Ledge est une action irréversible | Confirmation, conditions vertes, la commande exacte affichée. |
| Les e2e existants cassent à la bascule | Ils restent verts tant que l'interrupteur est coupé, et sont réécrits au lot 12. |
