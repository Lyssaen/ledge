# Équipes à deux moteurs : plan maître

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each lot plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remettre les équipes Ledge sur la base de `ledge-open-rig`, les rendre efficaces (lead, résultats, broadcast), et offrir le choix du moteur d'équipes (Ledge ou OpenRig) derrière l'interface de Joffrey rebaptisée « Équipes ».

**Architecture :**
- Les équipes reviennent par un merge de `origin/main` (lot A) : `main` porte encore tout le système d'équipes, avec ses correctifs #140 à #151.
- Le moteur Ledge s'améliore ensuite seul (lots B et C). Une couche « équipes » commune vient après : le pont OpenRig existant et le moteur Ledge l'alimentent tous les deux (lot D).
- Viennent enfin le cerveau (lot E), les interfaces (lot F) et la vérification de bout en bout (lot G).

**Tech Stack :** TypeScript ESM, zod, vitest, ink (TUI), React/Tauri (Desktop), PWA (mobile), playwright (`apps/desktop/e2e`), pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md`.

## Global Constraints

- **Branche** : `feat/teams-two-engines`, tirée de `origin/ledge-open-rig`. On ne pousse jamais sur `ledge-open-rig`, on n'y commite pas, et on ne réécrit pas son historique.
- **Reprise régulière** de `origin/ledge-open-rig` par merge, au moins au début de chaque lot (`git fetch && git merge origin/ledge-open-rig`). Les conflits se résolvent en gardant le travail de Joffrey et le nôtre.
- **Pas de renommage du code « rig »** : types du protocole, `apps/desktop/src/rigs/*`, `useRigs`, écrans rigs du TUI et du téléphone. Seuls les textes visibles deviennent « Équipes » (lot F).
- **`ledge ask` reste** tel que le lot 1 de Joffrey l'a livré (`770d2b1c`).
- **Écrans repris de `main`** : chacun reste isolé (son dossier ou composant, branché à un seul endroit), pour être remplacé par ceux de Joffrey plus tard.
- **Un lead par modèle d'équipe, exactement** : c'est le siège de rôle `leader` (`LEADER_ROLE`, `packages/ledge/src/daemon/actions.ts`).
- **Pas de priorité de messages, de rôles enrichis ni de file avancée** dans ce projet (deuxième étape).
- **Textes** en français dans `i18n/fr.ts`, avec l'anglais à côté dans `en.ts`.
- **Chaque tâche finit verte** : `pnpm typecheck` à la racine et les tests des paquets touchés (`pnpm --filter <pkg> test`). Un commit par tâche, en Conventional Commits avec un scope de paquet, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Les lots

Chaque lot a son propre plan détaillé, écrit au début du lot : le code dont il part n'existe qu'une fois le lot précédent fusionné. Le plan du lot A est prêt : `2026-11-01-equipes-deux-moteurs-lot-a-remise-des-equipes.md`.

### Lot A : remise des équipes

- **Contenu** : merge de `origin/main` (0.30 à 0.32 et correctifs teams), restauration des 46 fichiers du lot 1 que le merge ne ramène pas. L'interface de `main` revient telle quelle, à côté de celle de Joffrey.
- **Livrable** : `ledge team`, `ledge task`, `--role` et `ledge ask` marchent sur la même base que l'intégration OpenRig, et tous les tests passent. Le snapshot ne rejette plus le message `teams` d'un Ledge 0.31 distant.
- **Dépend de** : rien.

### Lot B : le lead reçoit l'objectif, les résultats lui remontent

- **Contenu** :
  - `team.launch` (et `ledge team up`) accepte un objectif structuré : quoi, dépôt, branche, critère de fin.
  - Il le donne comme tâche au siège `leader` dès que celui-ci est prêt, avec un premier prompt. Les autres sièges reçoivent une consigne d'attente courte.
  - Un modèle sans exactement un `leader` est refusé au chargement. Le message dit lequel.
  - `tasks.done` réveille le donneur avec le résultat. Pour une tâche donnée par Ledge à un lead, le résultat va à l'utilisateur dans « À toi » et dans le fil.
- **Livrable** : une équipe lancée avec un objectif démarre sans intervention, et l'utilisateur ne voit que le résultat final.
- **Fichiers attendus** : `packages/ledge/src/daemon/{teams,tasks,server}.ts`, `packages/protocol/src/{teams,tasks}.ts`, `packages/ledge/src/cli/team.ts`.
- **Dépend de** : A.

### Lot C : broadcast et messages Claude ↔ Claude dans une équipe

- **Contenu** :
  - `ledge send @team "<texte>"` envoie à tous les sièges vivants de l'équipe de l'expéditeur, sauf lui. Il est réservé au lead et à l'utilisateur.
  - Un message `team.broadcast { teamId, text }` côté protocole, pour l'interface.
  - Chaque siège le reçoit comme un message normal, dans l'ordre d'arrivée (`mailbox.ts`).
  - Dans une équipe Ledge, le hook refuse le `SendMessage` natif entre deux sièges Claude et le fait passer par la mailbox (`cli/hook.ts`, `daemon/mailbox.ts`). Hors équipe, rien ne change.
- **Livrable** : tous les échanges d'une équipe Ledge passent par Ledge, et le lead peut parler à toute l'équipe.
- **Dépend de** : A. Indépendant de B.

### Lot D : couche « équipes » commune et réglage du moteur

- **Contenu** :
  - **Contrat de moteur** côté daemon, implémenté par le pont OpenRig (`daemon/openrig/bridge.ts`) et par un nouveau moteur Ledge qui projette les équipes vivantes dans la forme commune. Forme proposée, à affiner dans le plan du lot :
    ```ts
    interface TeamEngine {
      readonly kind: 'ledge' | 'openrig';
      start(): Promise<void>; stop(): Promise<void>;
      statuses(): EngineStatus[];   // une entrée par machine : état du moteur
      teams(): Rig[];               // forme commune : RigSchema généralisé
      exchanges(teamId: string): Exchange[];
      escalations(): Escalation[];
      running(): boolean;           // au moins une équipe tourne
    }
    ```
  - **Réglage** `teams.engine: 'ledge' | 'openrig'`, Ledge par défaut, porté par le daemon local et appliqué à toutes les machines qu'il fédère.
  - **Changement refusé** tant que `running()` est vrai, avec un message clair. OpenRig n'est proposé que si un état autre que `absent` existe.
  - **Coupure réelle de l'autre moteur** :
    - en mode Ledge, le pont OpenRig ne fait que sonder ;
    - en mode OpenRig, `ledge team …` et `ledge task …` sont refusés ;
    - `who`, `send`, `read` et `ask` restent dans les deux modes.
- **Livrable** : les clients reçoivent les mêmes messages quel que soit le moteur, et le réglage existe dans Desktop (Réglages › Équipes).
- **Dépend de** : A. Mieux après B et C : la projection reprend alors les tâches et les échanges du lead.

### Lot E : les questions du lead passent par le cerveau

- **Contenu** :
  - Une question du lead (`ledge task give ledge`, ou `ledge ask` depuis un siège `leader`) devient une `Escalation` du moteur Ledge. Le cerveau la tranche selon le mandat, comme une escalade OpenRig, et la réponse revient au lead par la mailbox.
  - Un siège qui n'est pas le lead et tente d'escalader reçoit un refus qui lui demande de passer par le lead.
  - Le chemin 0.30 (`task.answer`, cartes de décision) n'est plus un canal à part : il passe par l'escalade.
- **Livrable** : avec un mandat qui couvre la question, aucune remontée à l'utilisateur. Sinon, une seule carte dans « À toi ».
- **Dépend de** : D.

### Lot F : interface « Équipes »

- **Contenu** :
  - Textes visibles « Rigs » → « Équipes » sur Desktop, le TUI et le téléphone.
  - Les équipes Ledge s'affichent dans les écrans de Joffrey : carte, section de barre latérale, fil, Bureaux.
  - La salle technique devient la salle du moteur actif : plaque « Équipes · Ledge » ou « Équipes · OpenRig », une baie par machine.
  - Les écrans de `main` que l'interface de Joffrey couvre (affichage et lancement d'équipe, onglets Équipes et Tâches) sont retirés. Ceux qu'elle ne couvre pas restent, isolés et branchés sur la couche commune : éditeurs de modèles et de rôles, propositions d'équipe du chat, ajout ou retrait de sièges, rejoindre, quitter, reprendre. L'éditeur de modèle affiche la règle « exactement un lead ».
- **Livrable** : une seule interface d'équipes, identique selon le moteur.
- **Dépend de** : D, et E pour les escalades.

### Lot G : vérification de bout en bout

- **Scénario** (spec §6.7) : une équipe à deux sièges, lead Claude et relecteur Codex, avec un petit objectif sur un vrai dépôt. On le joue avec le moteur Ledge, puis avec OpenRig.
- **Ce qu'on mesure** :
  - le délai entre le lancement et la première action du lead ;
  - le nombre d'interventions de l'utilisateur, avec zéro comme objectif hors vraies questions ;
  - la présence de tous les échanges dans le fil.
- **Livrable** : un rapport dans `docs/`, et un test e2e Desktop (`apps/desktop/e2e`) qui joue le scénario contre le faux daemon.
- **Dépend de** : tout le reste.
