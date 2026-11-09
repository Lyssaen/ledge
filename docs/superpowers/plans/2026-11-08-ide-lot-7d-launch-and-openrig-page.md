# Refonte IDE, lot 7d : lancer un rig et la page OpenRig, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** derrière l'interrupteur « Interface IDE (aperçu) » :
- « Lancer un rig » devient une fenêtre modale. On l'ouvre par « + Lancer » de la vue Rigs et depuis la page OpenRig. `Ctrl+Entrée` lance, Échap ferme.
- L'onglet « OpenRig · machine » montre la nouvelle page en sections : Vue d'ensemble, Rigs, Rôles, Machines, Daemon, Sortie. Dans un groupe étroit, sa colonne de gauche devient une rangée d'onglets.
- Les préférences du daemon (section Daemon) sont enregistrées par Ledge, machine par machine, et changent ce que font les boutons de l'IDE.

Le lot 7 se termine avec lui.

**Décisions de l'utilisateur (2026-11-08, cette session) :**
1. La page en sections remplace l'ancienne **dans l'IDE seulement**. Hors IDE, `OpenRigPage` et `RigLaunchForm` restent tels quels jusqu'au lot 12.
2. La modale reprend **les champs de la maquette, plus le dossier**. Le reste du formulaire actuel (harnais, modèle et permission par rôle, délégation, non interruptif, garder la spec, Vérifier avec l'aperçu YAML) passe sous **« Plus d'options »**, fermé par défaut.
3. Les préférences du daemon valent **par machine**.
4. « Demander confirmation si un siège travaille » : cochée (par défaut), tout arrêt ou redémarrage demande, comme aujourd'hui. **Décochée : on ne demande que si un siège travaille**, sinon l'action part tout de suite.

**Ce qui existe déjà et ne se refait pas** (`origin/main` e59d29bb, lots 7a à 7c fusionnés) :
- le lancement : `useRigSpecs`, `launchRig` (`packages/fleet/src/openrig.ts`) ; `launchOf`, `emptyForm`, `rolesOf`, `seatTotal`, `multiplies`, `bypasses`, `builtinOf`, `launchable`, `folderChoices`, `operatorOf` (`apps/desktop/src/openrig/model.ts`) ;
- l'operator : `useOpenRigGoals(client, machine).send(text, folder?)` (`packages/fleet/src/openrigGoals.ts`), c'est `openrig.goal.send` ;
- les rôles : `RolesView` et `useOpenRigRoles` (`openrig/roles/*`), avec la duplication du 7a ;
- l'état par machine : `useOpenRig`, `useOpenRigStates` ; `OpenRigState.version` et `daemon.startedAt` ;
- la vue Rigs (7b, `ide/rigs/`) : `machineEntries`, `seatDot`, `actionOf`, `confirmOf`, `MachineMenu`, `useRigsMachine` (`workspace/prefs.ts`) ;
- l'onglet Rig (7c, `ide/rig/`) : `RigConfirm` + `useRigConfirm`, `PERM_LEVELS`, `policyOf`, `permLevelOf`, `rigTabRef`, `rigErrorText` ; l'action `rig.policy` ;
- la Sortie : `createRigOutput` / `useRigOutput` (`openrig/rigOutput.ts`) et `OutputView` (`ide/OutputView.tsx`) ;
- la fenêtre `shell/Modal.tsx`, et la Nouvelle session de l'IDE (`launch/LaunchModal.tsx`, `nav.modal.kind === 'launch'` dans `App.tsx:896`) comme modèle ;
- le chunk paresseux `ide/lazy.tsx`.

**Ce qui manque :**
- aucune modale de lancement de rig : « + Lancer » de la vue Rigs ouvre l'ancienne page avec son formulaire en ligne (`RigsView.tsx:159`) ;
- l'onglet « OpenRig · machine » dessine l'ancienne `OpenRigPage` (`App.tsx:762`) ;
- aucune préférence de daemon ; l'arrêt d'un rig depuis l'IDE ne prend pas de snapshot (`actionOf`) ;
- reprendre un rig arrêté **sans** son snapshot : `rig.start` n'a pas d'option `--fresh` ;
- la latence d'une machine : rien ne la mesure.

**Architecture :**
- `packages/protocol`, `packages/ledge`, `packages/fleet` : la Task 0 ajoute `rig.start { fresh }`, un `ping`, et sort la commande d'un lancement dans une fonction pure partagée (`launchCommands`).
- `ide/openrig/prefs.ts` : les préférences du daemon par machine, et les actions qu'elles donnent.
- `ide/launch-rig/model.ts` (pur) et `ide/launch-rig/RigLaunchModal.tsx` : la modale.
- `ide/openrig/model.ts` (pur) et `ide/openrig/OpenRigView.tsx` + `ide/openrig/sections/*.tsx` : la page.
- `App.tsx`, `nav/state.ts`, `ide/lazy.tsx` : la modale `rigLaunch`, les sections de la page, le rendu de l'onglet dans l'IDE.

**Tech Stack :** React 19, TypeScript, zod, vitest + Testing Library, Playwright.

**Spec :**
- [`docs/ide-workspace.md`](../../ide-workspace.md), section « OpenRig » : « Lancer un rig » (l. 127-140), « Page OpenRig » (l. 141-150), « Confirmations » (l. 152).
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md), lot 7d et D6.
- Maquette [`docs/mockups/ledge-ide-rigs.html`](../../mockups/ledge-ide-rigs.html) : `rigLaunchModal()` (l. 1375), `rlPick()` / `rlGo()` (l. 1406-1422), `orPageB()` (l. 1311), `orConfirm()` (l. 1289) ; styles `.orb-*`, `.rl-*`, `.segc`, `.agents`, `.agent`, `.modal`, `.fld`, `.chk`, `.blk*`, `.term`.
- Décisions de l'utilisateur (PR #232) : préférences du daemon côté Ledge ; commande affichée = commande lancée ; un nouveau rig ne part jamais d'un snapshot ; un rôle intégré ne se modifie pas ; « rig vide » = une spec composée par le lancement existant.
- Relevé OpenRig : [`docs/openrig-releve-0.7.md`](../../openrig-releve-0.7.md) §« Reprendre au lancement » (`rig up <rig> --existing`, `--fresh <sièges…>`).

## Global Constraints

- Branche `feat/ide-lot-7d` (worktree `../ledge-ide-lot-7d`), partie de `origin/main` e59d29bb. Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur.
- Interrupteur coupé, l'interface actuelle est **inchangée** : `OpenRigPage`, `RigLaunchForm`, `SeatsDialog`, `SeatSettings`, la Sidebar et leurs tests et e2e (`openrig.spec.ts`, `openrig-visual.spec.ts`) restent verts sans retouche.
- Le daemon, le protocole et la flotte ne changent que dans la Task 0. Le protocole ne fait qu'ajouter. Toute commande `rig` passe par `execFile`. Un nouveau drapeau de capacité par nouvel ensemble d'actions ; la flotte répond `outdated` sans rien envoyer à un daemon qui ne l'a pas.
- Une commande montrée est toujours celle que Ledge lance : `commandsOf(action)` pour une action, `launchCommands(...)` (Task 0) pour un lancement. Jamais le texte de la maquette (`--host`, `--perm`, `--from-snapshot` n'existent pas).
- Toute nouvelle vue IDE passe par le chunk paresseux (`ide/lazy.tsx`). Ses styles (`styles/ide-openrig.css`, `styles/ide-launch-rig.css`) ne se chargent jamais interrupteur coupé.
- Textes en français et en anglais, sous `t.ide.openrigPage` et `t.ide.launchRig`. On reprend les textes existants (`t.openrig.launch.*`, `t.openrig.policy.*`, `t.openrig.confirm.*`, `t.ide.rigsView.*`, `t.ide.rigTab.*`). Les textes nouveaux de la maquette sont cités mot pour mot.
- Couleurs par les jetons du thème (clair et sombre). Sélecteurs préfixés : `.ide-orp …`, `.ide-rl …`.
- Tout état absent de la maquette se demande à `design-ux`. On le note dans `docs/ide-lot-7d-questions.md`, on le reporte dans la PR, puis on supprime le fichier.
- Node 24 dans le shell des outils : `export PATH=$HOME/.local/share/nvm/v24.10.0/bin:$PATH`, `corepack pnpm`.
- Échecs connus sur main : vitest desktop `omp-seats.test.tsx` (2), `session-conversation` « reconnect », `ide/session-tab` « a tab hidden… » (instable) ; ledge `capture-reducer` « real worker », `server-attachments` (3), `tui-screens` et `mobile-phone-e2e` « À toi » (instables) ; e2e `ide-terminals:61`, `island:166`, `proposals:36`, `daemon-update:8`, `atelier:208/234`.
- Un test e2e du lot met `openrigRig: true`, `openrigPolicy: true` et, selon le besoin, `openrigFresh: true` et `ping: true` dans `extras.daemon` du faux daemon.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais `apps/desktop/test-results/*.png`, ni une capture vers `/tmp` dans une spec. Jamais `git stash` nu. Aucun processus laissé en arrière-plan à la fin d'une tâche.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **« Partir de »**, une carte par choix, dans cet ordre : <br>- chaque **rig existant** de la machine (kernel exclu). En marche : grisé, « Déjà en marche · gère-le dans sa vue Rig » (texte de la maquette). Arrêté : mode **relance** ; <br>- chaque **spec** de la bibliothèque dont aucun rig ne porte le nom : mode **nouveau rig** (« Spec enregistrée · N sièges », intégrée ou à moi) ; <br>- **Rig vide** ; <br>- **Composer avec l'operator**, grisé « Le kernel doit tourner » quand le kernel n'est pas prêt. <br>La première carte active est choisie à l'ouverture. La grille défile dans la modale quand il y a beaucoup de specs. | Specs et rigs dans deux groupes séparés. |
| R2 | **Mode relance** (un rig arrêté) : <br>- nom et machine fixes ; <br>- les sièges en puces de rôles, sans ± (le ± d'un rig vit dans sa vue Rig, quand il tourne) ; <br>- les permissions : le niveau actuel (`permLevelOf`) est présélectionné. Un autre niveau envoie d'abord `rig.policy` sur les sièges du graphe (`useRigGraph`), puis la relance ; <br>- « Reprendre le dernier snapshot (date) », cochée. Décochée : `rig.start { fresh }` sur tous les sièges (Task 0). Sans snapshot : décochée, grisée, « Aucun snapshot » ; <br>- la commande : `commandsOf` de chaque action, jointes par ` && `. | Relancer toujours depuis le snapshot (case grisée cochée) et retirer `fresh` de la Task 0. |
| R3 | **Mode nouveau rig** (spec ou rig vide) : <br>- le nom (modifiable ; par défaut celui de la spec, `nouveau-rig` pour un rig vide) ; <br>- la machine (segment des machines prêtes où OpenRig est installé) ; <br>- le dossier (champ avec la liste `folderChoices`, obligatoire) ; <br>- les sièges par rôle, avec un ± de 0 à 9 (`launchOf` tel quel) ; <br>- les permissions (six niveaux, défaut = préférence de la machine, « Spec » = rien à passer) ; <br>- la commande en direct (`launchCommands`) ; <br>- « Plus d'options » (décision 2), qui reprend les colonnes du formulaire actuel, la délégation quand un rôle a plus d'un siège, le non interruptif quand un siège est en YOLO, « garder la spec », et « Vérifier » avec le résultat et le YAML. <br>« Lancer » ferme la modale et ouvre l'onglet Rig du nouveau rig (`rigTabRef`). Un échec garde la modale ouverte avec l'erreur (`l.errors`, sinon `rigErrorText`). | — |
| R4 | **Rig vide** = la spec intégrée `factory`, avec `orch.lead` = 1, `dev.build` = 1 et tous les autres rôles à 0 (`seats`), donc une spec composée par le lancement existant. Les rôles à 0 restent affichés avec leur ±, « à compléter ». Sans `factory` sur la machine, la carte est grisée. | Partir de `starter` (un builder et un reviewer). |
| R5 | **Daemon arrêté** quand la modale s'ouvre : les specs ne se lisent pas (`daemon_stopped`). La modale montre « Le daemon OpenRig est arrêté sur <machine>. », la commande `rig daemon start…` (`commandsOf` de l'action de démarrage donnée par les préférences, R9) et « Démarrer OpenRig ». Les cartes arrivent une fois le daemon en marche. | Démarrer le daemon dans la foulée de « Lancer ». |
| R6 | **Composer avec l'operator** : un champ « Ce que tu veux » (placeholder de la maquette mot pour mot), puis « Demander à l'operator ». On envoie `goals.send(text)`. Quand c'est parti, la modale se ferme et la session de l'operator s'ouvre (`operatorOf`), sinon un toast « L'operator compose une équipe dans son fil. ». Un refus (`no_operator`…) reste dans la modale. | — |
| R7 | **La commande d'un lancement** se calcule par `launchCommands(launch, spec, { rigsDir: '~/.ledge/rigs', name: true })` (Task 0), la fonction que le daemon appelle lui-même. Le front montre `~/.ledge/rigs/<nom>/rig.yaml` là où le daemon passe le chemin absolu : c'est le même fichier. | Demander un `plan` au daemon à chaque changement. |
| R8 | **La modale** est une entrée de `nav.modal` : `{ kind: 'rigLaunch'; machine?: string }`, dessinée dans `App.tsx` seulement quand l'interrupteur est ouvert, dans `Modal` sans `wide` (largeur propre, 720 px). On l'ouvre par « + Lancer » de la vue Rigs, par « Lancer un rig… » de la colonne de la page et par la carte en pointillés de la section Rigs. `Ctrl+Entrée` déclenche le bouton principal du mode choisi quand il est actif ; Échap ferme (comportement de `Modal`). | — |
| R9 | **Préférences du daemon**, par machine, dans `localStorage` (clé `ledge.ide.daemonPrefs`, un objet par id de machine ; une valeur illisible redonne les défauts) : <br>- `relaunch` (vrai) → `daemon.start` / `daemon.restart` avec `restore: 'last'`, sinon `'none'` ; <br>- `noKernel` (faux) → `daemon.start { noKernel: true }`, seulement quand `relaunch` est faux (comme l'ancienne page) ; <br>- `perm` (`'spec'`) → le niveau présélectionné dans la modale ; <br>- `snapshotBeforeStop` (vrai) → `rig.stop { snapshot: true }` ; <br>- `askAlways` (vrai) → décision 4. <br>Elles valent pour toutes les actions de l'IDE : vue Rigs, onglet Rig, page OpenRig, modale. | — |
| R10 | **La page**, à gauche une colonne (maquette `orb-rail`) : pastille, « OpenRig », la machine, les boutons du daemon avec la confirmation dessous (`RigConfirm`), la navigation avec ses nombres (Rigs = rigs + kernel, Rôles, Machines, Sortie = nombre d'entrées), puis « Lancer un rig… ». À droite, le titre de la section et son contenu. La section ouverte par défaut est la Vue d'ensemble. | — |
| R11 | **La section** voyage dans la navigation : `Place.openrig.section` et l'action `openrig` acceptent `OpenRigSection = 'overview' \| 'rigs' \| 'roles' \| 'machines' \| 'daemon' \| 'output'`. L'ancienne page traite tout ce qui n'est pas `roles` comme `rigs` (son comportement actuel). `lastOpenRig` retient la section par machine, comme aujourd'hui. | Un état local à la page, perdu à la fermeture de l'onglet. |
| R12 | **Vue d'ensemble** : quatre tuiles (maquette mot pour mot) : <br>- Daemon : état, `version · depuis HH:MM` (`startedAt`, heure locale) ; <br>- Kernel : `N sièges` ou « arrêté », et ses rôles ; il ouvre l'onglet Rig du kernel ; <br>- Rigs : `X sur Y`, « en marche sur <machine> » ; <br>- Sièges : actifs, et « N t'attend(ent) » ou « personne n'attend », en ambre s'il y en a. <br>Puis « T'attendent » : les sièges dont la pastille (`seatDot`) est `perm` ou `ask`, qui ouvrent leur session ; puis « Dernières commandes » : les cinq dernières entrées de la Sortie de cette machine, avec « Tout voir ». | — |
| R13 | **Rigs** : une carte par rig, kernel d'abord (« système »), puis la carte en pointillés. Une carte : pastille, nom (ouvre l'onglet Rig), état, boutons (`powerOf` dans une colonne fixe, confirmation sous l'en-tête de la carte), les puces de rôles avec leur nombre (`seatsByRole(rig.nodes)`), puis `N sièges · permission · snapshot <rig.snapshot>` et « Ouvrir la vue Rig → ». La permission vient de `useRigPermissions` + `permLevelOf`, lue une fois à l'affichage de la section (pas en boucle) ; « Mixte » quand les sièges diffèrent ; rien tant qu'elle n'est pas lue. | Pas de permission sur les cartes. |
| R14 | **Rôles** : on reprend `RolesView` tel quel (liste, fiche, onglets, « Dupliquer » du 7a). Les groupes restent « À moi / Intégrés » et non « Kernel / Équipes » ; la question part à `design-ux`. « Modifier » reste en lecture jusqu'au lot 11. | Regrouper en Kernel / Équipes. |
| R15 | **Machines** : une ligne par machine : pastille, nom, `local` ou `ssh · <alias>`, `OpenRig <version>` (sinon « non installé »), `N rigs` ou « arrêté », la latence, puis « affichée » ou « Afficher ». « Afficher » change la machine affichée (`useRigsMachine`) et ouvre l'onglet « OpenRig · <machine> ». « Ajouter une machine » ouvre Réglages › Machines, avec la phrase de la maquette. La latence : `local` pour la machine locale ; sinon l'aller-retour d'un `ping` (Task 0), relu toutes les 15 s tant que la section est affichée, « — » pour un daemon sans `ping`. | Retirer la colonne latence. |
| R16 | **Daemon** : `127.0.0.1:<port> · pid <pid>` en tête (la maquette montre un socket qui n'existe pas), puis les trois rangées de la maquette : « Au démarrage », « Permissions au lancement » (segment des six niveaux), « Avant un arrêt ». Chaque case et le segment écrivent la préférence de la machine affichée (R9) tout de suite. | — |
| R17 | **Sortie** : `OutputView` avec les entrées de toutes les machines, comme le panneau du bas (spec : « la même liste »). | Filtrer sur la machine affichée. |
| R18 | **Groupe étroit** (`@container` sous 640 px) : la colonne devient une rangée d'onglets au-dessus du contenu (pastille et boutons du daemon à gauche, sections ensuite, « Lancer un rig… » en bouton icône à droite). Les tuiles passent à deux colonnes, les cartes à une. | — |
| R19 | **Les restes du 7b** : « Gérer les machines… » du menu des machines et la ligne du daemon ouvrent la page (sections Machines et Vue d'ensemble). « + Lancer » ouvre la modale. | — |

## Review Focus

1. **On change de machine dans la modale pendant que les specs de l'autre se lisent.** Les cartes et la spec choisie repartent de la nouvelle machine. Le lancement ne part jamais avec la spec ou le dossier d'une autre machine. *(Task 2 : `pickFrom`, `fromChoices` ; Task 3.)*
2. **Le nom d'un nouveau rig est celui d'un rig qui existe** (arrêté ou en marche) sur la machine. « Lancer » est désactivé et la modale dit « Un rig de ce nom existe déjà sur <machine>. ». *(Task 2 : `launchProblem`.)*
3. **Le daemon ou le kernel s'arrête pendant que la modale est ouverte.** La carte de l'operator se grise ; le mode choisi bascule sur l'avis « daemon arrêté » ; aucun bouton n'envoie une action devenue impossible. *(Task 3.)*
4. **Une préférence illisible** (JSON cassé, clé inconnue, une machine retirée) redonne les défauts, sans casser la page ni les boutons. *(Task 1.)*
5. **La confirmation décochée, et un siège se met à travailler** entre l'affichage et le clic. On décide au clic, d'après l'état le plus récent : un siège qui travaille redemande la confirmation. *(Task 1 : `needsConfirm` ; Task 4 : bouton de la colonne.)*

---

### Task 0 : `rig.start { fresh }`, `ping` et `launchCommands` (daemon, protocole, flotte)

**Files :**
- Modify : `packages/protocol/src/openrig.ts` (`OpenRigActionSchema`, `rigCommands`, `launchCommands`, `changesSpec`), `packages/protocol/src/` (le fichier des messages client/serveur : `ping` / `pong`), `packages/protocol/src/` (le type des capacités du daemon : `openrigFresh`, `ping`) ; `packages/ledge/src/daemon/openrig.ts` (`launch` appelle `launchCommands`) ; le routeur des messages du daemon (`ping`) ; `packages/fleet/src/fleet.ts` (portes `openrigFresh` et `ping`) ; `packages/fleet/src/machines.ts` ou un nouveau `packages/fleet/src/latency.ts` (`useLatency`) ; `apps/desktop/e2e/daemon.ts` (le faux daemon répond `pong`, accepte `fresh`)
- Test : les tests de `rigCommands` dans `packages/protocol/test/`, `packages/ledge/test/` (le test du lancement, et celui du routeur pour `ping`), `packages/fleet/test/fleet.test.ts`

**Interfaces :**
- Produit :
  - `rig.start` accepte `fresh?: RigLogicalId[]` (1 à 200, `pod.member`), exclusif de `snapshot` (refine) → `['up', rig, '--existing', '--fresh', ...fresh, '--yes', '--json']` ;
  - `launchCommands(l: RigLaunch, spec: RigSpec, o: { rigsDir: string; name: boolean }): string[][]` et `changesSpec(l: RigLaunch): boolean`, déplacés du daemon dans `packages/protocol/src/openrig.ts`. Le daemon les appelle avec son `rigsDir` absolu et `can.name` ;
  - les messages `{ type: 'ping'; requestId; machineId? }` → `{ type: 'pong'; requestId; machineId? }` ;
  - les capacités `openrigFresh` et `ping` dans les infos du daemon ;
  - `useLatency(client: DaemonClient, machines: readonly string[], everyMs = 15_000): ReadonlyMap<string, number | null>` (ms ; `null` : pas de réponse ou daemon sans `ping`).

- [ ] **Step 1 : lire la source de la CLI** en lecture seule (`~/.local/share/nvm/v24.10.0/lib/node_modules/@openrig/cli/dist/commands/up.js`, option `--fresh`) : confirmer que `--fresh` accepte plusieurs sièges après `--existing` et sous quelle forme (`dev.impl` ou `dev.impl@rig`). L'écrire en deux lignes dans le relevé, § « Reprendre au lancement ». **Ne lancer aucune commande qui modifie un rig.**
- [ ] **Step 2 : écrire les tests qui échouent.**
  - `rigCommands({ kind: 'rig.start', rig: 'dev', fresh: ['orch.lead', 'dev.build'] })` → `[['up','dev','--existing','--fresh','orch.lead','dev.build','--yes','--json']]` ; le schéma refuse `fresh` avec `snapshot`, une liste vide et un siège mal formé.
  - `launchCommands` : la spec telle quelle → `[['up','starter','--cwd','/w','--yes','--json']]` ; un autre nom sans changement → `['up','starter','--name','x', …]` ; un siège changé → `['up','<rigsDir>/x/rig.yaml','--cwd', …]` ; `save` ajoute `['specs','add','<rigsDir>/x','--json']` ; `plan` met `--plan` au lieu de `--yes` ; `nonInterruptive` ajoute `--non-interruptive`. Les tests existants du lancement du daemon restent verts sans retouche.
  - Le daemon répond `pong` au `ping` avec le même `requestId` et `machineId`.
  - La flotte répond `outdated` sans rien envoyer pour `rig.start { fresh }` à un daemon sans `openrigFresh`, et `useLatency` donne `null` sans rien envoyer à un daemon sans `ping`.
- [ ] **Step 3 : implémenter.** `launch` du daemon (`openrig.ts:413`) remplace sa ligne `commands` par `launchCommands(l, spec, { rigsDir, name: can.name })`, sans changer son comportement. `useLatency` mesure `performance.now()` entre l'envoi et le `pong`, un `ping` à la fois par machine.
- [ ] **Step 4 : lancer les suites de `@ledge/protocol`, `@ledge/fleet` et `@paradow/ledge`, et le typecheck.** Attendu : vertes, hors échecs connus.
- [ ] **Step 5 : commit** `feat(openrig): rig.start can start seats fresh, launchCommands is shared, a ping measures a machine's latency`.

### Task 1 : les préférences du daemon

**Files :**
- Create : `apps/desktop/src/ide/openrig/prefs.ts`
- Modify : `apps/desktop/src/ide/rigs/RigConfirm.tsx` (`useRigConfirm` reçoit les préférences), `apps/desktop/src/ide/rigs/RigsView.tsx`, `apps/desktop/src/ide/rig/RigView.tsx` (leurs actions passent par les préférences)
- Test : `apps/desktop/test/ide/openrig-prefs.test.ts` ; `rigs-view.test.tsx`, `rig-view.test.tsx` et `rig-confirm.test.tsx` restent verts (un test ajouté à chacun pour le snapshot et la confirmation sautée)

**Interfaces :**
- Consomme : `actionOf`, `workingSeats`, `OpenRigAction`, `OpenRigState`.
- Produit :
  - `interface DaemonPrefs { relaunch: boolean; noKernel: boolean; perm: PermLevel; snapshotBeforeStop: boolean; askAlways: boolean }` et `DAEMON_PREFS_DEFAULT` (vrai, faux, `'spec'`, vrai, vrai)
  - `loadDaemonPrefs(machine: string): DaemonPrefs`, `saveDaemonPrefs(machine: string, patch: Partial<DaemonPrefs>): void`, `useDaemonPrefs(machine: string): [DaemonPrefs, (patch: Partial<DaemonPrefs>) => void]` (synchronisé entre écrans, comme `useRigsMachine`)
  - `prefAction(target: 'daemon' | 'kernel' | string, verb: 'start' | 'restart' | 'stop', p: DaemonPrefs): OpenRigAction` (R9 : `restore`, `noKernel`, `snapshot`)
  - `needsConfirm(action: OpenRigAction, state: OpenRigState, p: DaemonPrefs): boolean` (faux pour un démarrage ; vrai si `askAlways` ; sinon vrai seulement si `workingSeats(state, action).length > 0`)

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `loadDaemonPrefs('srv')` sans rien d'enregistré → les défauts ; avec `'{cassé'` dans la clé → les défauts ; avec `{ srv: { perm: 'yolo', bogus: 1 } }` → `perm: 'yolo'`, le reste par défaut, `bogus` ignoré ; `perm: 'nope'` → `'spec'` (Review Focus 4).
  - `saveDaemonPrefs('srv', { relaunch: false })` ne touche pas les préférences de `local`.
  - `prefAction('daemon','start', { …défauts })` → `{ kind: 'daemon.start', restore: 'last' }` ; `relaunch: false, noKernel: true` → `{ kind: 'daemon.start', restore: 'none', noKernel: true }` ; `prefAction('dev','stop', défauts)` → `{ kind: 'rig.stop', rig: 'dev', snapshot: true }` ; `snapshotBeforeStop: false` → sans `snapshot`.
  - `needsConfirm` : `askAlways: false` et aucun siège qui travaille → faux ; un siège `activity: 'running'` → vrai (Review Focus 5) ; un démarrage → faux.
  - Dans `rigs-view.test.tsx` : avec `askAlways: false` et un rig où personne ne travaille, « Arrêter » envoie `rig.stop { snapshot: true }` sans confirmation.
- [ ] **Step 2 : lancer-les.** Attendu : FAIL.
- [ ] **Step 3 : implémenter.** `useRigConfirm(view, offered, opts?: { prefs: DaemonPrefs; state: OpenRigState | null })` : `ask` lance tout de suite quand `needsConfirm` est faux. `RigsView` et `RigView` construisent leurs actions avec `prefAction` et la préférence de leur machine. Au passage (restes du 7c, fichiers touchés) : retirer la branche morte « le daemon est arrêté » de l'en-tête de `RigView.tsx` ; effacer `snapshotError` quand le rig s'arrête ; faire passer l'erreur de `RigsView.tsx:~85` par `rigErrorText`.
- [ ] **Step 4 : relancer les quatre fichiers de test.** Attendu : PASS.
- [ ] **Step 5 : commit** `feat(desktop): Ledge's daemon preferences, per machine, drive the IDE's start, stop and confirmation`.

### Task 2 : le modèle de la modale

**Files :**
- Create : `apps/desktop/src/ide/launch-rig/model.ts`
- Test : `apps/desktop/test/ide/launch-rig-model.test.ts`

**Interfaces :**
- Consomme : `RigSpec`, `OpenRigState`, `RigLaunch`, `launchCommands` (Task 0) ; `emptyForm`, `launchOf`, `launchable`, `rolesOf` ; `PermLevel`, `policyOf`, `permLevelOf` ; `DaemonPrefs` (Task 1).
- Produit :
  - `type LaunchFrom = { kind: 'rig'; rig: string } | { kind: 'spec'; spec: string } | { kind: 'empty' } | { kind: 'operator' }`
  - `interface FromChoice { from: LaunchFrom; title: string; seats: number; running: boolean; source?: 'builtin' | 'user'; disabled: false | 'running' | 'kernel' | 'noFactory' }`
  - `fromChoices(specs: readonly RigSpec[], state: OpenRigState, kernelReady: boolean): FromChoice[]` (R1)
  - `EMPTY_SPEC = 'factory'`, `EMPTY_SEATS: Record<string, number>` (R4 : tout à 0 sauf `orch.lead` et `dev.build` à 1, calculé sur la spec), `emptySeats(spec: RigSpec): Record<string, number>`
  - `pickFrom(choices: readonly FromChoice[], current: LaunchFrom | null): LaunchFrom | null` (garde le choix s'il existe et n'est pas grisé, sinon la première carte active)
  - `newLaunch(spec: RigSpec, form: LaunchForm, level: PermLevel, plan: boolean): RigLaunch` (`launchOf` avec `policy = policyOf(level)` sauf `'spec'`)
  - `launchProblem(form: LaunchForm, state: OpenRigState): 'cwd' | 'name' | 'exists' | 'noSeat' | null`
  - `relaunchActions(rig: string, level: PermLevel | null, current: PermLevel | 'mixed' | null, seats: readonly string[], resume: boolean): OpenRigAction[]` (R2 : `rig.policy` seulement si `level` diffère de `current`, puis `rig.start` ou `rig.start { fresh: seats }`)
  - `liveCommand(input: { daemonUp: boolean; startAction: OpenRigAction } & ({ launch: RigLaunch; spec: RigSpec } | { actions: readonly OpenRigAction[] })): string` (les commandes jointes par ` && `, préfixées du démarrage du daemon quand `daemonUp` est faux)

- [ ] **Step 1 : écrire les tests qui échouent**, sur les specs `starter` et `factory` écrites dans le test (rôles de `factory` : `orch.lead`, `orch.advisor`, `dev.build`, `dev.qa`, `dev.design`, `review.r1`, `review.r2`) et un état avec `ledge-dev` en marche et `ledge-survey` arrêté.
  - `fromChoices` : `ledge-dev` grisé `'running'`, `ledge-survey` en mode `rig`, `starter` en mode `spec`, une spec nommée `ledge-survey` n'a pas de carte en double, `empty` grisé `'noFactory'` sans `factory`, `operator` grisé `'kernel'` quand `kernelReady` est faux ; l'ordre est rigs, specs, vide, operator.
  - `emptySeats(factory)` → `{ 'orch.lead': 1, 'dev.build': 1, 'orch.advisor': 0, 'dev.qa': 0, 'dev.design': 0, 'review.r1': 0, 'review.r2': 0 }`.
  - `pickFrom` : un choix disparu (autre machine) → la première carte active (Review Focus 1).
  - `launchProblem` : nom `ledge-survey` → `'exists'` (Review Focus 2) ; dossier vide → `'cwd'` ; tous les sièges à 0 → `'noSeat'`.
  - `newLaunch(…, 'spec', false)` n'a pas de `policy` ; `'open'` → `policy: 'open'`.
  - `relaunchActions('ledge-survey', 'standard', 'spec', ['dev.builder','dev.reviewer'], true)` → `[rig.policy standard sur les deux sièges @ledge-survey, rig.start]` ; même niveau → `[rig.start]` seul ; `resume: false` → `rig.start { fresh: […] }`.
  - `liveCommand` avec `daemonUp: false` commence par `rig daemon start` (la forme exacte de `commandsOf`).
- [ ] **Step 2 : lancer-les.** Attendu : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer.** Attendu : PASS.
- [ ] **Step 5 : commit** `feat(desktop): the rig launch modal's model (choices, empty rig, relaunch, live command)`.

### Task 3 : la modale « Lancer un rig »

**Files :**
- Create : `apps/desktop/src/ide/launch-rig/RigLaunchModal.tsx`, `apps/desktop/src/ide/PermSegment.tsx`, `apps/desktop/src/styles/ide-launch-rig.css`
- Modify : `apps/desktop/src/nav/state.ts` (modale `rigLaunch`), `apps/desktop/src/App.tsx` (rendu sous `ide`), `apps/desktop/src/ide/lazy.tsx` (`IdeRigLaunch`), `apps/desktop/src/ide/IdeFrame.tsx` (exporte le composant pour le chunk), `apps/desktop/src/ide/rigs/RigsView.tsx` (« + Lancer »), `apps/desktop/src/ide/rig/RigSettings.tsx` (utilise `PermSegment`), `apps/desktop/src/i18n/fr.ts`, `en.ts`, `messages.ts`
- Test : `apps/desktop/test/ide/rig-launch-modal.test.tsx`, `apps/desktop/test/ide/perm-segment.test.tsx`

**Interfaces :**
- Consomme : Task 1 et Task 2 ; `useRigSpecs`, `launchRig`, `useOpenRig`, `useRigGraph`, `useRigSnapshots`, `useRigPermissions`, `useOpenRigGoals`, `operatorOf`, `folderChoices`.
- Produit :
  - `interface RigLaunchModalProps { client: DaemonClient; machines: readonly MachineState[]; machine: string; projects: Projects | null; sessions: readonly Session[]; onLaunched(machine: string, rig: string): void; onOperator(sessionId: string | null): void; onClose(): void }`
  - `RigLaunchModal(props): JSX.Element` (le contenu, `App.tsx` le met dans `Modal` avec `t.ide.launchRig.title`)
  - `PermSegment(props: { value: PermLevel | null; onChange(l: PermLevel): void; label: string; disabled?: boolean }): JSX.Element` : `role="radiogroup"`, flèches gauche/droite et Début/Fin qui déplacent le choix (reste du 7c), `YOLO` marqué risqué.
  - l'action de navigation `{ type: 'modal', modal: { kind: 'rigLaunch', machine?: string } }`.

- [ ] **Step 1 : écrire les tests qui échouent** (`rig-launch-modal.test.tsx`, faux client comme `rig-view.test.tsx`).
  - Les cartes de R1 s'affichent ; un clic sur `starter` montre nom, machine, dossier, sièges, permissions, commande ; la commande vaut `rig up starter --cwd /w` puis change en direct quand on passe un siège à 2 (`rig up ~/.ledge/rigs/starter/rig.yaml --cwd /w`).
  - « Plus d'options » est fermé, et l'ouvrir montre harnais, modèle et permission par rôle, « garder la spec » et « Vérifier ».
  - `Ctrl+Entrée` dans le champ dossier envoie `openrig.launch` avec la machine choisie ; au succès `onLaunched('local', 'starter')`.
  - Un nom déjà pris désactive « Lancer » avec « Un rig de ce nom existe déjà sur WSL. ».
  - La carte `ledge-survey` (arrêté) montre « Reprendre le dernier snapshot (…) » cochée ; la décocher change la commande en `rig up ledge-survey --existing --fresh …`.
  - Changer de machine relit les specs de l'autre machine et remet le choix (Review Focus 1).
  - Daemon arrêté : l'avis et « Démarrer OpenRig » ; le clic envoie `daemon.start { restore: 'last' }`.
  - Kernel arrêté : la carte de l'operator est grisée ; kernel prêt : « Demander à l'operator » envoie `openrig.goal.send` avec le texte.
  - `perm-segment.test.tsx` : flèche droite depuis `Spec` choisit `Auto` ; Fin choisit `Verrouillé`.
- [ ] **Step 2 : lancer-les.** Attendu : FAIL.
- [ ] **Step 3 : implémenter.** La mise en page suit `rigLaunchModal()` : en-tête « Lancer un rig » et « Sur <machine>. Ctrl+Entrée lance, Échap ferme. », grille `.fld` libellé / valeur, cartes `.agent`. « Plus d'options » est un `<details>`. « Vérifier » appelle `launchRig` avec `plan: true` et montre le résultat comme `Outcome` de `RigLaunchForm` (reprendre `Outcome` en l'exportant, sans changer son rendu). `App.tsx` : `onLaunched` ferme la modale et ouvre `{ kind: 'rig', ref: rigTabRef(machine, rig) }` ; `onOperator` ouvre la session ou montre le toast de R6. `RigsView` « + Lancer » dispatche la modale avec sa machine.
- [ ] **Step 4 : relancer les deux fichiers, plus `rigs-view.test.tsx`, `rig-view.test.tsx`, et le typecheck.** Attendu : PASS.
- [ ] **Step 5 : regarder une capture** de la modale (spec, rig arrêté, operator ; clair et sombre) à côté de la maquette, hors dépôt. Les écarts vont dans `docs/ide-lot-7d-questions.md`.
- [ ] **Step 6 : commit** `feat(desktop): « Lancer un rig » is a modal in the IDE (spec, empty rig, relaunch, operator)`.

### Task 4 : le modèle et la coque de la page OpenRig

**Files :**
- Create : `apps/desktop/src/ide/openrig/model.ts`, `apps/desktop/src/ide/openrig/OpenRigView.tsx`, `apps/desktop/src/styles/ide-openrig.css`
- Modify : `apps/desktop/src/nav/state.ts` (`OpenRigSection`, R11), `apps/desktop/src/openrig/OpenRigPage.tsx` (lit `section === 'roles'` comme avant, rien d'autre), `apps/desktop/src/ide/lazy.tsx` (`IdeOpenRig`), `apps/desktop/src/ide/IdeFrame.tsx`, `apps/desktop/src/App.tsx` (l'onglet `openrig` dessine `IdeOpenRig`), i18n
- Test : `apps/desktop/test/ide/openrig-model.test.ts`, `apps/desktop/test/ide/openrig-view.test.tsx`, `apps/desktop/test/nav-state.test.ts` (le fichier existant des sections)

**Interfaces :**
- Consomme : Task 1 ; `RigConfirm`, `useRigConfirm`, `seatDot`, `seatsByRole`, `RigOutputEntry`.
- Produit :
  - `type OpenRigSection = 'overview' | 'rigs' | 'roles' | 'machines' | 'daemon' | 'output'` (dans `nav/state.ts`) et `OPENRIG_SECTIONS`
  - `navCounts(state: OpenRigState | null, roles: number | null, machines: number, output: number): Partial<Record<OpenRigSection, number>>`
  - `interface Tiles { daemon: { up: boolean; version?: string; since?: string }; kernel: { up: boolean; seats: number; roles: string[] }; rigs: { running: number; total: number }; seats: { active: number; waiting: number } }`
  - `tilesOf(state: OpenRigState, sessions: readonly Session[], asks: readonly HumanAsk[], machine: string, lang: 'fr' | 'en'): Tiles`
  - `waitingSeats(state: OpenRigState, sessions: readonly Session[], asks: readonly HumanAsk[], machine: string): Array<{ rig: string; seat: SeatLine; kind: 'perm' | 'ask' }>`
  - `recentCommands(entries: readonly RigOutputEntry[], machine: string, n = 5): RigOutputEntry[]`
  - `roleChips(rig: Rig): Array<{ role: string; runtime: string; count: number }>`
  - `interface OpenRigViewProps { client; machines; machine: string; section: OpenRigSection; role?: string; seat?: string; projects; sessions; asks: readonly HumanAsk[]; output: readonly RigOutputEntry[]; dispatch(a: NavAction): void; onTab(tab: Tab): void; onLaunch(machine: string): void }`
  - `OpenRigView(props): JSX.Element` : la colonne (R10), la section courante, l'état « non installé » (texte et lien de l'ancienne page) et « hors ligne ».

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `tilesOf` sur `RIG_7A` : `rigs: { running: 1, total: 2 }` (kernel exclu), `daemon.since` = l'heure locale de `startedAt` ; `seats.waiting` compte un siège dont la session attend une permission.
  - `recentCommands` garde les 5 dernières de la machine, la plus récente en dernier.
  - `roleChips` sur des nœuds `dev.build`, `dev.build-2`, `dev.review` → `build ×2`, `review`.
  - Réducteur : `{ type: 'openrig', section: 'daemon' }` garde `section: 'daemon'` ; l'ancienne page dessine sa vue Rigs pour `daemon` (`openrig-page.test.tsx` existant reste vert).
  - `openrig-view.test.tsx` : la colonne montre les six sections avec leurs nombres ; un clic sur « Daemon » dispatche `{ type: 'openrig', machine: 'local', section: 'daemon' }` ; « Arrêter » du daemon ouvre la confirmation sous la colonne ; avec `askAlways: false` et personne au travail, il envoie `daemon.stop` tout de suite ; « Lancer un rig… » appelle `onLaunch('local')`.
- [ ] **Step 2 : lancer-les.** Attendu : FAIL.
- [ ] **Step 3 : implémenter.** Dans `App.tsx`, la section ouverte par défaut dans l'IDE est `overview` (l'ancienne page garde `rigs`). Le bouton du daemon dans la colonne décide au clic avec l'état le plus récent de `useOpenRig` (Review Focus 5).
- [ ] **Step 4 : relancer, plus le typecheck.** Attendu : PASS.
- [ ] **Step 5 : commit** `feat(desktop): the IDE's OpenRig page shell (rail, sections in the navigation, daemon buttons)`.

### Task 5 : les sections

**Files :**
- Create : `apps/desktop/src/ide/openrig/sections/Overview.tsx`, `Rigs.tsx`, `Machines.tsx`, `Daemon.tsx` (Rôles et Sortie se dessinent directement dans `OpenRigView` avec `RolesView` et `OutputView`)
- Modify : `apps/desktop/src/ide/openrig/OpenRigView.tsx`, `apps/desktop/src/styles/ide-openrig.css`, i18n
- Test : `apps/desktop/test/ide/openrig-sections.test.tsx`

**Interfaces :**
- Consomme : Task 0 (`useLatency`), Task 1 (`useDaemonPrefs`, `prefAction`), Task 4 (`tilesOf`, `waitingSeats`, `recentCommands`, `roleChips`) ; `PermSegment` (Task 3) ; `useRigPermissions`, `permLevelOf` ; `RolesView` ; `OutputView` ; `machineEntries`, `useRigsMachine`.
- Produit : un composant par section, chacun prenant ce dont il a besoin dans `OpenRigViewProps`.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - Vue d'ensemble : les quatre tuiles avec les textes de R12 ; la tuile Kernel ouvre l'onglet Rig du kernel ; un siège qui attend ouvre sa session ; « Tout voir » ouvre la section Sortie.
  - Rigs : la carte du kernel porte « système » ; une carte montre `build ×2` ; « Ouvrir la vue Rig → » appelle `onTab({ kind: 'rig', ref: 'local:ledge-dev' })` ; la carte en pointillés appelle `onLaunch` ; la permission apparaît une fois `openrig.permissions` répondu (« Mixte » pour des sièges différents).
  - Machines : `local` affiche « local » en latence ; une machine SSH avec `ping` affiche `NN ms` ; sans `ping`, « — » ; « Afficher » change la machine affichée et ouvre l'onglet de cette machine ; « Ajouter une machine » dispatche `{ type: 'settings', section: 'machines' }`.
  - Daemon : décocher « Prendre un snapshot du rig » écrit `snapshotBeforeStop: false` pour la machine affichée seulement ; le segment des permissions écrit `perm`.
  - Rôles : `RolesView` est là (son titre ou sa liste) ; Sortie : `OutputView` avec toutes les entrées.
- [ ] **Step 2 : lancer-les.** Attendu : FAIL.
- [ ] **Step 3 : implémenter**, d'après `orPageB()` (classes `.orb-*` reprises en `.ide-orp-*`). Groupe étroit : R18, par `@container`.
- [ ] **Step 4 : relancer, plus le typecheck.** Attendu : PASS.
- [ ] **Step 5 : regarder une capture** de chaque section (large et étroit, clair et sombre) à côté de la maquette, hors dépôt. Les écarts vont dans `docs/ide-lot-7d-questions.md`.
- [ ] **Step 6 : commit** `feat(desktop): the OpenRig page's sections (overview, rigs, roles, machines, daemon, output)`.

### Task 6 : branchements de l'IDE et e2e

**Files :**
- Modify : `apps/desktop/src/ide/rigs/RigsView.tsx` et `MachineMenu.tsx` (R19), `apps/desktop/src/App.tsx`
- Create : `apps/desktop/e2e/ide-openrig.spec.ts`
- Test : cette spec, plus `ide-rigs.spec.ts`, `ide-rig.spec.ts`, `openrig.spec.ts` (inchangés)

- [ ] **Step 1 : écrire `ide-openrig.spec.ts`** (faux daemon avec `RIG_7A`, `openrigRig`, `openrigPolicy`, `openrigFresh`, `ping`) :
  - « + Lancer » de la vue Rigs ouvre la modale ; choisir `starter`, un dossier, `Ctrl+Entrée` → l'onglet « Rig · starter » s'ouvre ;
  - Échap ferme la modale sans rien lancer ;
  - la ligne du daemon ouvre « OpenRig · WSL » sur la Vue d'ensemble ; « Gérer les machines… » ouvre la section Machines ;
  - la page passe en rangée d'onglets dans un groupe étroit (deux groupes côte à côte), sans défilement horizontal ;
  - un onglet OpenRig restauré au démarrage montre le chargement, puis sa section.
- [ ] **Step 2 : lancer-la** (`corepack pnpm --filter desktop exec playwright test e2e/ide-openrig.spec.ts --workers=2`). Attendu : FAIL tant que les branchements manquent.
- [ ] **Step 3 : brancher** « Gérer les machines… » (`dispatch({ type: 'openrig', machine, section: 'machines' })`) et la ligne du daemon (`section: 'overview'`).
- [ ] **Step 4 : lancer les suites complètes** : `corepack pnpm --filter desktop test`, `typecheck`, et les e2e `ide-*.spec.ts` et `openrig*.spec.ts`. Attendu : vertes, hors échecs connus.
- [ ] **Step 5 : reporter `docs/ide-lot-7d-questions.md`** dans la description de la PR, puis supprimer le fichier.
- [ ] **Step 6 : commit** `feat(desktop): the IDE opens the launch modal and the OpenRig page's sections from the Rigs view; e2e`.
