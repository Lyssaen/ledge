# OpenRig 0.7 : relevé pour le lot 7

Relevé du lot 7a ([`ide-workspace-plan.md`](ide-workspace-plan.md), §5) sur une vraie installation : le laptop (WSL), OpenRig **0.7.10** (`a226b1b6`, construit le 2026-11-08), monté depuis 0.6.14 le 2026-11-08. Le kernel est double (advisor Claude Code, operator et queue worker Codex, `operator.human` en terminal). Un rig de test, `ledge-survey`, a été lancé depuis la spec `starter` (2 sièges), arrêté avec un snapshot, repris, puis arrêté.

Chaque machine a son daemon Ledge, qui appelle `rig` en local (`packages/ledge/src/daemon/openrig.ts`). Tout ce qui suit se lit donc **par machine**. Les routes HTTP sont celles du daemon OpenRig sur `127.0.0.1:<port>`, dont le port vient de `rig status --json`. OpenRig ne garantit que ce que décrit sa doc `daemon/docs/reference/daemon-http-clients.md`, livrée dans le paquet `@openrig/cli` (« route shapes not listed here can change ») : une route hors de cette page est marquée **non contractuelle**.

## 1. Les sièges d'un rig : `rig ps --nodes --rig kernel`

`rig ps --nodes --rig <rig> --json` (ou `-A` pour tous les rigs) donne un tableau de sièges. Ledge lit déjà la plupart de ces champs.

| Champ | Exemple | Lu par Ledge aujourd'hui |
|---|---|---|
| `rigId`, `rigName`, `logicalId`, `canonicalSessionName` | `kernel`, `advisor.lead`, `advisor-lead@kernel` | oui |
| `runtime`, `model` | `claude-code`, `null` | oui |
| `sessionStatus`, `lifecycleState`, `storedSessionStatus` | `running`, `running` | les deux premiers |
| `agentActivity.state` | `idle`, `running`, `unknown` | oui |
| `assignedWorkCount`, `pendingWorkCount`, `hasAssignedWork` | `0` | `assignedWorkCount` |
| `intentionallyStopped` | `false` | oui |
| `needsAttention` | `false` | non |
| `startupStatus`, `resumeType`, `resumeTokenPresent`, `lastActivity`, `identityVerdict`, `modelObservation`, `hostSelfId` | | non |

- **Rig arrêté :** ses sièges restent listés, avec `lifecycleState: "recoverable"` et `sessionStatus: "exited"` (vérifié sur `starter` et `ledge-survey`). Un siège détaché donne `det`, un siège en reprise `rec`.
- **Piège 0.7 :** `rig status --json` répond `kernel.state: "skipped"` alors que le kernel tourne. Ce champ décrit le démarrage automatique du kernel, pas son état. Ledge tire déjà l'état du kernel du rig nommé `kernel` dans `rig ps` : c'est la bonne source.
- **Piège 0.7 :** un kernel arrêté avant l'arrêt du daemon ne revient ni par `rig start` ni par `rig start --last`. Il faut `rig up kernel --existing`, que l'action `kernel.start` de Ledge lance déjà. `rig start` échoue alors avec « Kernel did not report ready before the deadline ».

## 2. Les liens entre sièges (topologie)

Trois sources, toutes valables **rig arrêté compris** :

| Source | Forme | Contrat |
|---|---|---|
| `GET /api/rigs/<rigId>/graph` | `{ nodes, edges }`. `nodes` mêle des groupes `type: "podGroup"` (`podLabel`, `podNamespace`) et des sièges `type: "rigNode"` dont `parentId` est le pod. `edges[]` : `{ id, source, target, label }`, où `source`/`target` sont des ids de nœud et `label` le type de lien. | non contractuelle |
| `rig spec show <rigId> --json` | La spec qui recrée le rig : `pods[].members[]`, `pods[].edges[]` (`from`, `to`, `kind`, ids de membre du pod) et `edges[]` (entre pods, `pod.member`). | CLI |
| `rig specs preview <spec> --json` | Pour une spec de la bibliothèque : la même chose, plus `graph: { nodes[{id, label, pod, runtime, kind}], edges[{source, target, kind}] }` déjà à plat. | CLI |

Les types de lien vus : `delegates_to`, `escalates_to`, `collaborates_with` (la liste complète est dans la doc OpenRig `edge-types.md`).

Le nœud de siège de `/graph` porte en plus ce que la vue Rig voudra : `resolvedSpecName` (le rôle, `implementer`), `profile`, `effort`, `startupStatus`, `contextUsedPercentage`, `contextTotalInputTokens`, `currentQitems`, `pendingWorkCount`, `inProgressWorkCount`, `blockedWorkCount`, `needsAttention`, `heldReason`, `binding.tmuxSession`.

**Aujourd'hui :** le daemon Ledge lit `rig spec show` pour le reseat, mais n'envoie aucun lien au front. `RigSpec.edges` n'est qu'un nombre.

## 3. Les specs et leurs rôles, rig arrêté

- `rig specs ls --json` : 29 entrées, de `kind` `rig` (7), `agent` (16) et `workflow` (6). Chaque entrée a `id`, `name`, `version`, `sourceType` (`builtin` ou `user`), `sourcePath`, `summary`. Ledge les lit déjà (`openrig.specs`, `openrig.roles`).
- `rig specs preview <nom> --json` : pods, membres (`agentRef`, `runtime`, `profile`), liens, `graph`, `raw` (le YAML).
- Le lien entre un rig et sa spec : `rig spec show <rigId>` rend la spec effective du rig, même arrêté. Le chemin du fichier n'y est pas. Ledge le connaît pour les rigs qu'il a lancés (`~/.ledge/rigs/<nom>/`, `rootOf`).

## 4. Les permissions

OpenRig ne fait pas respecter les permissions lui-même : il les **enregistre**, et c'est le harness (Claude Code, Codex) qui les applique au lancement suivant.

| Niveau | Lire | Changer |
|---|---|---|
| Spec (rig, et surcharge par membre) | `rig policy current --spec <fichier> --json` : `sites[]` avec `site`, `ref`, `effective`, `applies`. **Prend un fichier de spec, pas un rig.** | `rig policy apply <nom> --spec <fichier>`, écrit dans la spec |
| Siège | `rig seat status <siège> --json` → `permissions.effective.effectiveMode` (`acceptEdits`), `.source` (`kernel_default`, `team_default`, `seat`…), `.launchPosture` (`floor`…), `selectionState` (`inherit`), `account.summary` (une phrase) | `rig seat set-permissions <siège> --mode floor\|full_bypass\|inherit\|<mode Claude>` (Ledge le fait déjà), ou `rig policy apply <nom> --seat <siège> --reason …` |

Politiques intégrées (`rig policy list --json`) : `locked`, `standard`, `open`, `yolo`, `auto`, `none`. Sans politique, la spec `starter` lance ses sièges au « floor » : `permission_policy absent; launch_posture=floor`.

**Relevé de la source de la CLI (lot 7c).** `rig policy apply <nom> --seat <siège> --reason <texte> [--json]` accepte `--json` et enregistre `builtin:<nom>` (ou `none`, plancher explicite) sur le siège ; `--reason` est obligatoire. Rien n'efface une politique de siège : `policy apply` n'accepte que `locked|standard|open|yolo|auto|none`, donc « revenir à la spec » = appliquer la politique de la spec elle-même (`none` si elle n'en a pas). Un mode explicite (`seat set-permissions --mode`) l'emporte sur la politique : Ledge le remet d'abord à `inherit`.
`rig seat status --json` n'a aucun champ structuré pour la politique enregistrée : `permissions.effective` ne porte que `effectiveMode`, `source` (`explicit|member_spec|rig_spec|kernel_default|system_default`) et `launchPosture` ; `permissions.account.source` dit d'où vient la politique (`member_policy|rig_policy|team_default|floor|explicit|kernel_default`) et `account.summary` la nomme en toutes lettres (« …, from the member's policy builtin:standard… »). Ledge ne lit `policy` que si `account.source === 'member_policy'` et que la phrase correspond à `/from the member's policy (builtin:[a-z]+|none)\b/` (la phrase d'OpenRig, pas un contrat), et expose `policySource` (= `account.source`).
`spec` : OpenRig ne sait pas redonner « aucune politique » à un siège ; Ledge applique, par siège, la politique du membre dans la spec du rig, sinon celle du rig (refus `spec_unknown`, `spec_no_policy`, `spec_policy_unsupported`, jamais `none`, qui serait un plancher explicite). `--mode inherit` n'efface que le mode natif : les règles JSON de Claude et le profil ou l'enveloppe Codex restent et peuvent encore l'emporter. Si `policy apply` échoue après un `--mode inherit` réussi, ce siège a déjà perdu sa sélection explicite.
OpenRig 0.7 refuse `set-permissions` et `policy apply --seat` hors d'un siège géré sans identité (« Sender identity is required ») : Ledge passe `--operator ledge@external`.

**Ce qui n'existe pas :** une permission « du rig » qu'on lirait ou changerait sur un rig qui tourne. Ce qu'on peut faire : montrer la politique de la spec, plus le mode effectif de chaque siège, et changer les sièges un par un.

## 5. Le snapshot à la demande, et sa reprise

- **Prendre :** `rig snapshot <rig>` → `Snapshot created: <id>` (texte seul, pas de `--json`). `rig down --snapshot` en prend un de sorte `auto-pre-down`. Le kernel en prend un toutes les 5 min (`periodicSnapshotActive`, `periodicSnapshotIntervalSeconds: 300` dans `rig ps --json --full`).
- **Lister :** `rig snapshot list <rig>` (texte, pas de `--json`), ou `GET /api/rigs/<rigId>/snapshots` → `[{ id, rigId, kind, status, createdAt, data }]` (non contractuelle). `data` est lourd (nœuds, sessions, liens) : à ne pas renvoyer au front. Sortes vues : `manual`, `auto-pre-down`, `auto-periodic`, `pre_restore`.
- **Reprendre au lancement :** `rig up <rig> --existing --json` reprend depuis le dernier snapshot utilisable → `{ status: "restored", snapshotId, snapshotKind, rigResult: "fully_restored", nodes[{ logicalId, status: "resumed" | "fresh-primed" }], warnings }`. Un snapshot précis : `rig restore <snapshotId> --rig <rigId>`. `rig up --fresh <sièges…>` repart à neuf pour les sièges nommés.
- **`--fresh` (lu dans la source du CLI 0.7, `commands/up.js`, pas lancé) :** option variadique `--fresh <seats...>`, donc plusieurs sièges à la suite après `--existing`, que le prochain drapeau (`--yes`) arrête ; chaque valeur est un **id logique** (`dev.impl`), pas `dev.impl@rig` (le CLI passe la liste telle quelle au daemon, `freshLogicalIds`). Ledge lance `rig up <rig> --existing --fresh a.b c.d --yes --json`. Le CLI refuse `--existing --fresh` tant que des sièges frères tournent : c'est pour un rig arrêté.
- **`rig restore` direct (lu dans la source du CLI 0.7, pas lancé) :** `rig restore <snapshotId> --rig <rig>` (nom ou id) n'a **pas** de `--json` ; il appelle `POST /api/rigs/<id>/restore/<snapshotId>`. Succès (202) : code 0, `Restore attempt id: …` / `Status: started`, la reprise continue côté daemon (suivi : `rig restore status <attemptId> --rig <rig> --json`). Échecs : code 1, une ligne sur stderr (`Snapshot "…" or rig "…" not found`, `Restore refused: …`, `Restore conflict: rig may still be running. Stop the rig first…`, `Restore blocked: …` + blockers).
- **Ce qui n'existe pas :** lancer un *nouveau* rig depuis un snapshot. On ne reprend que le rig qui l'a pris. Le `--from-snapshot` de la maquette n'existe pas.

## 6. Les fichiers de consignes des rôles

- Un rôle est un dossier `agents/<famille>/<rôle>/` : `agent.yaml` (profils, skills, imports) et `guidance/role.md`, livré à son lancement (`startup.files`). Un rig a aussi son `CULTURE.md` et ses `guidance/*.md`.
- **Lire et ouvrir :** Ledge le fait déjà (`openrig.role`, `openrig.roleFile`).
- **Dupliquer :** copier le dossier du rôle dans la bibliothèque de la personne, `workspace.specs_root` (`rig config get workspace.specs_root` → `~/.openrig/workspace/specs`), puis `rig specs add <dossier> --json`. Rien de plus dans OpenRig.
- **Modifier :** les rôles `builtin` vivent dans le paquet npm d'OpenRig et sont écrasés à chaque mise à jour. Seule une copie (`sourceType: "user"`) se modifie durablement.

## 7. Confier une demande à l'operator

- **La file** (ce que Ledge fait déjà pour les objectifs, `openrigGoals.ts`) : `rig queue create --source ledge@external --destination operator-agent@kernel --summary … --body … --json`. La personne est inscrite côté OpenRig sous l'adresse `ledge@external` (`rig gateway participants --json`, `default: ledge`).
- **Un message dans son terminal :** `rig send operator-agent@kernel "<texte>"`, avec l'enveloppe From/To.
- **Constaté :** une demande n'est pas livrée à un siège arrêté sur une invite (« is at an interactive prompt (selection_prompt) … No text was sent »). La ligne reste `pending`, avec `waiting.liveness.needsInput: { count: 1, reason: "permission_prompt" }`. C'est l'état « ! » à montrer.
- **La file d'un rig :** `GET /api/queue/list?state=pending,in-progress,blocked&limit=100` (contractuelle). Le paramètre `rig=` existe mais **ne filtre pas** (`rig=kernel` a rendu une ligne de `ledge-survey`) : il faut filtrer sur le suffixe `@<rig>` de `destinationSession` et de `sourceSession`. Le flux `GET /api/queue/sse` signale les changements.

## 8. Le daemon et la machine

- `rig status --json` → `daemon: { state, reachable, pid, port, healthy }`, `workspaceRoot`.
- `GET /healthz` → `semver`, `commit`, `builtAt`, `selfHostId`, `pid` (contractuelle).
- Heure de départ : `~/.openrig/daemon.json` → `startedAt`. C'est l'état propre de la CLI, pas un contrat.
- Latence : OpenRig ne la donne pas. Ledge la mesure déjà par machine.
- `rig host list` : le registre multi-machines d'OpenRig est vide ici. Ledge garde son propre modèle de machines.
