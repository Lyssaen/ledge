# Refonte IDE, lot 7a : relevé OpenRig et protocole, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal :** chaque daemon Ledge donne au front, pour l'OpenRig de sa machine, ce que la vue Rig (7c) et la page OpenRig (7d) vont montrer et qu'il ne donne pas encore : la topologie d'un rig (même arrêté) et celle d'une spec, les snapshots et « Snapshot maintenant », la reprise d'un snapshot précis, les permissions effectives de chaque siège, la file d'un rig, la duplication d'un rôle, l'heure de départ du daemon. **Aucun écran ne change** : 7a s'arrête aux hooks de `packages/fleet`.

**Relevé :** [`docs/openrig-releve-0.7.md`](../../openrig-releve-0.7.md), fait le 2026-11-08 sur OpenRig 0.7.10 (laptop, kernel double, rig de test `ledge-survey`). Chaque tâche cite la section du relevé qui la fonde.

**Ce qui existe déjà et ne se refait pas** (`origin/main` 71b50f49) :
- `openrig.status` → `OpenRigState` (daemon, kernel, rigs, sièges), toutes les 5 s quand la page est ouverte (`packages/fleet/src/openrig.ts`) ;
- `openrig.act` : démarrer, arrêter et redémarrer le daemon, le kernel et un rig, et `seat.set` (runtime, modèle, effort, permissions d'un siège) ;
- `openrig.specs`, `openrig.launch` (spec composée, ± par rôle, politique), `openrig.seats` (reseat) ;
- `openrig.roles`, `openrig.role`, `openrig.roleFile` (lecture seule) ;
- `openrig.row` (une ligne de file), `openrig.asks` / `answer` (« À toi »), `openrig.goals` (demandes à l'operator, `rig queue create --source ledge@external`).

**Architecture :** on suit le chemin de `openrigRoles`. Pour chaque nouvelle lecture :
1. le schéma zod dans `packages/protocol/src/openrig.ts`, les messages dans `messages.ts` et l'export dans `index.ts` ;
2. le drapeau de capacité `openrigRig` dans le snapshot (`server.ts:589`, `messages.ts:103-107`) ;
3. la méthode dans `createOpenRig` (`packages/ledge/src/daemon/openrig.ts`) et le `case` dans `server.ts` ;
4. le routage par machine et la réponse `outdated` dans `packages/fleet/src/fleet.ts` ;
5. le hook dans `packages/fleet/src/openrig.ts` ;
6. le faux daemon des e2e (`apps/desktop/e2e/daemon.ts`).

Les lectures HTTP passent par `localGet` (déjà là : 127.0.0.1, port de `rig status`, 3 s, sans proxy). Une route **non contractuelle** pour OpenRig a toujours un repli CLI, et son échec ne casse jamais `openrig.status`.

**Tech Stack :** TypeScript, zod, vitest. Node 24 dans le shell des outils (`export PATH=$HOME/.local/share/nvm/v24.10.0/bin:$PATH`, `corepack pnpm`).

## Global Constraints

- Branche `feat/ide-lot-7a` (worktree `../ledge-ide-lot-7`), partie de `origin/main` 71b50f49. Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur.
- Le protocole ne fait qu'**ajouter** : aucun champ existant ne change de sens. Un front récent face à un vieux daemon reçoit `outdated`, comme pour `openrigRoles`.
- Toute commande `rig` passe par `execFile`, jamais par un shell. Un nom de rig passe `RigNameSchema`, un siège `RigSeatNameSchema`, un id de snapshot `^[0-9A-Z]{26}$`.
- Les écritures restent des actions `openrig.act` : une à la fois par machine (`busy`), puis l'état est diffusé à tous les fronts.
- Pas de `data` de snapshot vers le front (il pèse des centaines de Ko).
- Le TUI (`packages/ledge/src/tui`) et le mobile ne changent pas.
- Échecs connus sur main (0.53.0) : voir la mémoire de passation. **À revérifier sur 71b50f49 avant la Task 1.**
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais `git stash` nu.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **Topologie d'un rig** : `GET /api/rigs/<id>/graph`, ramené à `RigGraph { pods[{id,label}], seats[{logicalId, pod, role?, runtime, model?, status, session?, attention, context?}], links[{from,to,kind}] }` en `logicalId`. Repli : `rig spec show <id> --json` (sans état ni contexte). Marche rig arrêté (relevé §2). | Le repli seul : on perd le rôle et le % de contexte par siège. |
| R2 | **Topologie d'une spec** : `RigSpec.links[]` lu dans le YAML que `readSpec` lit déjà. `RigSpec.edges` (le nombre) reste. | — |
| R3 | **Permissions « du rig »** : OpenRig n'en a pas sur un rig qui tourne (relevé §4). Ledge montre la politique de la spec et le mode effectif de chaque siège (`rig seat status --json`). « Changer » applique `seat set-permissions` à tous les sièges, **au prochain lancement**, et le dit. | Retirer le réglage de la vue Rig et ne garder que le réglage par siège. |
| R4 | **Snapshots** : action `rig.snapshot` (`rig snapshot <rig>`). Liste par `GET /api/rigs/<id>/snapshots` (non contractuelle), repli sur le texte de `rig snapshot list`. Les 20 plus récents. | — |
| R5 | **Reprise d'un snapshot précis** : `rig.start` gagne `snapshot?` → `rig restore <id> --rig <rigId>`. Sans lui, rien ne change (`rig up --existing`, le dernier snapshot utilisable). Un nouveau rig ne part jamais d'un snapshot : OpenRig ne le permet pas. | — |
| R6 | **File d'un rig** : `GET /api/queue/list?state=pending,in-progress,blocked&limit=100`, filtrée chez Ledge sur `@<rig>` (le paramètre `rig=` d'OpenRig ne filtre pas, relevé §7). Rendue en `RigRow[]`, lue à la demande (le front relit toutes les 15 s tant que la vue est visible). On y ajoute `needsInput` (« ! » : la demande attend une invite). | Suivre `/api/queue/sse` : plus vif, mais un flux de plus par machine. |
| R7 | **Dupliquer un rôle** : `openrig.role.duplicate { roleId, name }` copie le dossier du rôle dans `workspace.specs_root`, renomme `name:` dans `agent.yaml`, puis lance `rig specs add`. **Modifier** reste en lecture seule dans 7a : on ouvre la copie dans un éditeur avec « Ouvrir dans… » (lot 11). Un rôle `builtin` n'est jamais écrit, car une mise à jour d'OpenRig l'écraserait. | Ajouter `openrig.roleFile.save` pour les rôles `user` : ½ jour. |
| R8 | **« Rig vide »** (maquette : « Un lead, un siège d'implémentation ») = une spec composée par le lancement existant, à partir de `orchestrator` et `implementer`. Rien à ajouter au protocole. 7d le branche. | — |
| R9 | **Le daemon** : `OpenRigState.daemon.startedAt?` lu dans `~/.openrig/daemon.json` (non contractuel, absent si illisible), et `version` vient déjà de `rig --version`. La latence, c'est celle que Ledge mesure déjà pour la machine. | — |
| R10 | **Préférences du daemon** de la maquette (permission par défaut, snapshot avant arrêt, confirmation si un siège travaille) : ce ne sont pas des réglages d'OpenRig. Ce sont des préférences Ledge, que 7d fera sans le daemon. | — |
| R11 | Les drapeaux fictifs de la maquette (`--host`, `--perm`, `--from-snapshot`) ne sont pas repris : la machine, c'est `machineId`, la permission, c'est `RigLaunch.policy`, la reprise, c'est `rig up --existing` ou `rig restore`. La commande affichée est toujours celle que Ledge lance. | — |

## Tasks

### Task 0 : base et compatibilité 0.7

- [x] Sur 71b50f49 : `corepack pnpm install --frozen-lockfile`, puis `corepack pnpm --filter @paradow/ledge test`, `--filter @ledge/fleet test`, `--filter @ledge/protocol test`. Noter les échecs déjà là.
- [x] Contre l'OpenRig 0.7.10 du laptop : script jetable (scratchpad) qui appelle `createOpenRig().state()`, `specs()` et `roles()`, et vérifie qu'ils ne renvoient pas d'erreur. Corriger ce que 0.7 aurait cassé, test d'abord.
- [x] `readState` : test qui fixe le piège du relevé §1. Avec `kernel.state: "skipped"` dans `rig status` et un rig `kernel` qui tourne, l'état du kernel doit être `ready`.

### Task 1 : topologie d'un rig (R1)

- [x] Protocole : `RigLinkSchema { from, to, kind }`, `RigGraphSchema`, `openrig.graph { requestId, machineId?, rig }` → `openrig.graphState { requestId, machineId?, rig, graph?, error? }`.
- [x] Daemon : `graph(rig)` résout l'id par `state()`, lit `/graph` et traduit les ids de nœud en `logicalId` (`data.logicalId` des `rigNode`, pods par `parentId`). Si ça échoue : `rig spec show <id> --json` (`pods[].edges` en `pod.member`, plus `edges`). Cache 5 s par rig.
- [x] Tests (vitest, `RigRun` et `localGet` simulés) sur les deux formes relevées : le graphe de `ledge-survey` et l'export du kernel (fixtures tirées du relevé, sans token ni chemin perso). Cas : rig arrêté, route en 404, rig inconnu.
- [x] Fleet : `useRigGraph(machineId, rig)`.

### Task 2 : topologie d'une spec (R2)

- [x] `RigSpec.links?: RigLink[]` dans `rigSpec.ts` (`readSpec`) : les liens de pod préfixés `pod.`, plus les liens entre pods. Test sur la spec `starter` et sur une spec composée par Ledge.

### Task 3 : snapshots (R4, R5)

- [x] Action `rig.snapshot { rig }` → `[['snapshot', rig]]` dans `rigCommands`. Timeout 120 s.
- [x] `rig.start` gagne `snapshot?` → `[['restore', snapshot, '--rig', <id>]]`. Le daemon résout l'id, car `rigCommands` n'a que le nom. Vérifier d'abord la sortie de `rig restore` (a-t-il un `--json` ?) sur `ledge-survey`, et l'écrire dans le relevé.
- [x] `openrig.snapshots { rig }` → `openrig.snapshotList { rig, snapshots[{id, kind, status, createdAt}], error? }`. HTTP, puis repli texte. Tests sur les deux.
- [x] Fleet : `useRigSnapshots`.

### Task 4 : permissions effectives (R3)

- [x] `openrig.permissions { rig }` → `openrig.permissionList { rig, policy?, seats[{logicalId, session, mode, source, posture, selection, summary}], error? }`. Un `rig seat status <session> --json` par siège, deux à la fois au plus. Cache 30 s, vidé après toute action sur le rig. `policy` vient de la spec du rig quand Ledge la connaît.
- [x] Action `rig.permissions { rig, mode: SeatPermissions }` → un `seat set-permissions` par siège, `--reason Ledge`. On s'arrête à la première erreur et on dit quels sièges ont changé.
- [x] Tests sur la sortie relevée (`advisor-lead@kernel` : `acceptEdits`, `kernel_default`, `floor`).

### Task 5 : file d'un rig (R6)

- [x] `openrig.queue { rig }` → `openrig.queueState { rig, rows: RigRow[], truncated, error? }`. `RigRow` gagne `needsInput?: { count, reason }`, tiré de `waiting.liveness.needsInput`.
- [x] Le filtre `@<rig>` porte sur la destination **ou** la source. Test avec la ligne relevée : une demande `pending` refusée sur `selection_prompt`.
- [x] Fleet : `useRigQueue`, relu toutes les 15 s tant qu'il est monté.

### Task 6 : rôles (R7)

- [x] `openrig.role.duplicate { roleId, name }` → `openrig.roleDuplicated { ok, roleId?, path?, error? }`. Lit `rig config get workspace.specs_root`, refuse un `name` qui existe déjà ou qui n'est pas un `RigNameSchema`, copie le dossier (sans suivre les liens symboliques), réécrit `name:`, lance `rig specs add <dossier> --json`, puis vide le cache des rôles.
- [x] Tests sur un dossier temporaire (pas sur le vrai `~/.openrig`).

### Task 7 : daemon et sièges (R9)

- [x] `daemon.startedAt?` dans `readState` (lecture de `daemon.json` injectée pour les tests).
- [x] `RigSeat.attention?: boolean` (`needsAttention`) et `Rig.specPath?` (le `rootOf` que Ledge connaît pour les rigs qu'il a lancés).

### Task 8 : câblage, e2e, doc

- [x] Drapeau `openrigRig: true` ; `fleet.ts` répond `outdated` sans lui. Tests fleet sur les nouveaux types.
- [x] `apps/desktop/e2e/daemon.ts` répond aux nouveaux messages avec les fixtures du relevé, pour que 7b à 7d aient de quoi tester.
- [x] Relevé : y ajouter la sortie de `rig restore` (Task 3). Plan : y reporter les écarts.
- [ ] Tests complets (ledge, fleet, protocol, desktop typecheck) ; relecture indépendante (superpowers:requesting-code-review) ; PR avec, dans la description, **la liste de ce qu'OpenRig ne fournit pas** (R3, R5, R7, R10, R11) pour l'utilisateur avant 7b.

## Review Focus

1. **Aucune régression sur `openrig.status`** : une route HTTP qui tombe ou un OpenRig 0.6 ne doit rien changer à l'état ni à sa cadence.
2. **Ce qui s'exécute** : toute nouvelle commande passe par `execFile` avec des arguments validés, et la duplication ne peut écrire que dans `workspace.specs_root`.
3. **Le coût** : `permissions` lance un `rig seat status` par siège (environ 1 s chacun sur le laptop) ; vérifier le cache et la concurrence sur un rig de 7 sièges.

## Écarts

| # | Écart | Pourquoi |
|---|---|---|
| E1 | Le drapeau `openrigRig` est posé dès la Task 1, et chaque message est câblé de bout en bout dans sa tâche. `outdated` vient du refus du message par un vieux daemon, comme pour les rôles. | Un câblage final aurait laissé les tâches 1 à 7 sans test de bout en bout. |
| E2 | Les hooks prennent `client` en premier : `useRigGraph(client, machine, rig)`. | Ils suivent leurs voisins. |
| E3 | `rig restore` reçoit le nom du rig, pas son id. Il n'a pas de `--json`. `ok` veut dire « reprise lancée » (HTTP 202). Un rig qui tourne est refusé (409) : le front l'arrête d'abord. | C'est ce que la CLI 0.7 fait pour une reprise directe (relevé §5). |
| E4 | `rig.permissions` porte la liste `seats`. `openrig.done.completed` dit combien de sièges ont changé avant l'échec. | Sans la liste, `rigCommands` ne peut pas écrire les commandes. Un échec à mi-chemin laisse un rig mixte. |
| E5 | La file d'un rig est triée par `updatedAt`, du plus récent au plus ancien. | OpenRig ne garantit aucun ordre. |
| E6 | Dupliquer un rôle : la copie se prépare dans un dossier temporaire, puis `rig specs add` la range dans `~/.openrig/specs/<nom>`, pas dans `workspace.specs_root`. Les `local:` relatifs deviennent `path:<absolu>`. La duplication prend le verrou des actions (`busy`). | OpenRig refuse un `local:` absolu et range lui-même la spec. Deux écritures en parallèle se marcheraient dessus. |
| E7 | `Rig.specPath` ne regarde que le dossier de Ledge (`~/.ledge/rigs/<rig>`), sans lancer `rig specs ls` à chaque lecture. | `readState` garde sa cadence et son coût. |
