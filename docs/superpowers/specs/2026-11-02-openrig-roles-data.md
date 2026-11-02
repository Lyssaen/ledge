# Rôles OpenRig dans Ledge : sources, limites, contrat proposé (lecture seule)

Ligne : qitem-20261102150637-700da132fff1d32e (parente qitem-20261102150513-24ab613f277eee13).
Écran visé : `docs/mockups/ledge-openrig-roles.html` (en maquette chez design-ux, **pas encore validée**). Le contrat
ci-dessous est une proposition à recaler sur la maquette validée ; rien n'est implémenté.

Relevé fait le 2026-11-02 sur cette machine : OpenRig **0.7.7 (f3d8bac4)**, daemon sur `127.0.0.1:7433`, rig
`ledge-dev` en marche (5 sièges). Base de la branche : `origin/main` (5d6ff1e2) — le `main` local a 432 commits de
retard et ne contient pas l'intégration OpenRig (#160).

## 1. Ce qui existe, source par source

### 1.1 Ledge aujourd'hui

`packages/ledge/src/daemon/openrig.ts` ne parle à OpenRig **que par la CLI** (`execFile rig … --json`, `findRig`, délais
`STATUS_MS`) : `rig status`, `rig ps [--nodes -A]`, `rig specs ls`, `rig up [--plan]`, `rig spec show`, `rig add/remove/
edge/snapshot`, `rig seat set-*`. Les specs de rig sont relues depuis leur fichier (`readSpec`). Le protocole
(`packages/protocol/src/openrig.ts`) suit le motif `openrig.<demande>` → `openrig.<réponse>` avec `requestId`, routé
par `packages/fleet/src/fleet.ts` (`rigAsks`, `rigFailure` → `offline` / `outdated`). Rien ne lit encore les **agent specs**.

### 1.2 OpenRig — ce qui est exposé

| Source | Ce qu'elle donne | Résolu par OpenRig ? |
|---|---|---|
| `rig specs ls --kind agent --json` (= `GET /api/specs/library?kind=agent`) | 21 entrées : `id` (hash), `name`, `sourceType` (`builtin` / `user_file`), `sourcePath`, `resolvedSourcePath`. **Les noms ne sont pas uniques** (`shared` builtin et `shared` user_file) : la clé est l'`id`. | Liste seulement |
| `rig specs preview <id> --json` (= `GET /api/specs/library/:id/review`) | `name`, `version`, `description`, `profiles[{name,description}]`, `resources{skills,guidance,plugins,subagents}` (chemins / ids **déclarés dans ce fichier**), `startup{files,actions}` de l'agent, `raw` (YAML). | **Non.** `SpecReviewService.reviewAgentSpec` parse le seul fichier : pas d'imports, pas de `profiles.*.uses`, pas de `runtime_resources`, pas de `defaults`. D'où `plugins: []` pour ledge-lead. |
| `rig spec show <rigId> --json` | La spec qui recrée un rig **en marche** : `cultureFile`, `permissionPolicy` (`builtin:yolo`), `nonInterruptive`, pods, membres (`agentRef` en `path:` absolu, `profile`, `runtime`, `model`, `cwd`, `restorePolicy`), edges. | Partiellement — **perd les `startup.files` des membres** (`guidance/scope-back.md` absent). Défaut OpenRig à signaler. |
| **`GET /api/rigs/:rigId/nodes/:logicalId`** (HTTP seulement, pas de commande CLI) | Pour un siège qui existe : `agentRef`, `profile`, `resolvedSpecName/Version/Hash`, `runtime`, `model`, `effort` + `effortSource`, `cwd`, `restorePolicy`, **`startupFiles[]` résolus et ordonnés** (`path`, `absolutePath`, `ownerRoot`, `deliveryHint`, `orientation`, `required`, `appliesOn`), **`startupActions[]`** (dont le bloc d'identité `builtin: session_identity`), **`installedResources[]`** (`shared:openrig-core`, `shared:claude-default-settings`…), `edges`, `peers`. | **Oui** — c'est le résultat de `resolveNodeConfig` + `resolveStartup` tel qu'enregistré au lancement. |
| `rig skill loadout --seat <session> --json` | Les skills projetées pour **ce siège** (`id`, `trigger`, `path` sous `~/.openrig/state/seats/<rig>/<seat>/<runtime>/`). | Oui (projection réelle) |
| `rig plugin show <id> --json` | Manifeste d'un plugin : version, `skills[]` (19 pour openrig-core), `hooks[]`, `mcpServers[]`. | Oui |
| `rig up <spec> --plan --json` / `POST /api/rigs/import/preflight` | `resolveNodeConfig` tourne pour chaque membre, mais **seuls `errors` / `warnings` sortent**. Vérifié : le plan ne crée pas de rig. | Résout, n'expose pas |
| `rig spec audit <path> --json` | Audit culture/startup **au niveau rig seulement** (signale `missing_startup_context` pour ledge-dev alors que les membres en déclarent). | Peu utile ici |

Le résolveur complet existe dans le paquet (`daemon/dist/domain/profile-resolver.js` → `resolveNodeConfig`,
`QualifiedResource{effectiveId, sourceSpec, sourcePath}`, `startup-resolver.js` → `resolveStartup`) mais **aucune route ne
le publie pour un rôle de bibliothèque hors d'un rig lancé**.

### 1.3 Les trois copies de la spec ledge-dev

| Copie | Rôle |
|---|---|
| `<dépôt>/openrig/` | Source versionnée. Identique octet pour octet à la suivante (`diff -rq` vide). |
| `~/.openrig/specs/openrig/` | Bibliothèque OpenRig (`user_file`) : c'est elle que `rig specs ls` liste. |
| `~/.ledge/rigs/ledge-dev/` | Copie **composée par Ledge** au lancement (`composeSpec`) : `agent_ref` réécrits en `path:~/.openrig/specs/openrig/agents/…`, politique `yolo` ajoutée. **Le rig en marche a été lancé depuis celle-ci** : `CULTURE.md` et `guidance/scope-*.md` des sièges ont `ownerRoot = ~/.ledge/rigs/ledge-dev`. |

L'écran doit donc dire de quelle copie vient chaque fichier (`path` absolu), sans supposer que c'est celle du dépôt.

## 2. Ce que Ledge doit recalculer, ce qu'il prend tel quel

**Recommandation : deux vues, chacune à sa meilleure source.**

1. **Siège d'un rig existant → OpenRig fait foi.** Détail de nœud HTTP (`startupFiles`, `startupActions`,
   `installedResources`, modèle/effort et leur source) + `rig skill loadout --seat` + `rig plugin show`. Ledge ne
   recalcule rien ; il ne fait que **ranger** chaque fichier dans une couche (voir 2.1).
2. **Rôle de bibliothèque (aucun siège lancé, ou vue « déclaré ») → Ledge résout le YAML.** Aucune source OpenRig ne le
   donne. Ledge applique les règles documentées (`daemon/docs/reference/agent-spec.md` §Imports/Profiles, `rig-spec.md`
   §startup) et marque le résultat `declared` (« selon la spec »), jamais comme ce qu'un siège a reçu :
   - `imports[].ref` `local:` relatif au dossier de la spec, `path:` absolu ; espace de noms = `name` de la spec importée ;
     un import n'a pas d'imports ; `version` exacte si épinglée.
   - `profiles.<p>.uses.<catégorie>` : `ns:id` → la ressource de l'import `ns` ; `id` nu → la spec elle-même, puis
     l'unique import qui la déclare (ambigu = erreur affichée, pas tranchée).
   - `defaults` < `profiles.<p>.preferences` < membre du rig pour runtime / modèle / effort / advisor.
   - Startup, dans l'ordre fixe d'OpenRig : agent → profil → `culture_file` du rig → startup rig → pod → membre.
     Les fichiers ajoutés par OpenRig lui-même (voir 2.1) sont **connus seulement d'un siège lancé** : la vue déclarée
     les montre comme « ajoutés par OpenRig au lancement (version x) », sans contenu garanti.
   - Skills : un id qui ne correspond à aucune ressource déclarée est cherché **au lancement** dans `<cwd>/.claude/skills`,
     le dossier `skills/` du rig, le dossier home, le catalogue géré : la vue déclarée le marque `unknown` (« résolu au
     lancement »), elle ne le cherche pas.

Écarté : importer `profile-resolver.js` depuis le paquet installé. Le module est interne (non documenté, chemins
`dist/domain/…`), il change à chaque version, et il veut un contexte complet (rig, membre, home, catalogue). À proposer
plutôt à OpenRig : un `rig specs resolve <agent> --profile <p> --json` (ou une route `GET /api/specs/library/:id/resolved`)
qui publie `resolveNodeConfig` sans lancer.

### 2.1 Ranger un fichier de démarrage dans sa couche

Le détail de nœud ne nomme pas la couche ; Ledge la déduit de `ownerRoot` et de la spec du rig, et le dit :

| `ownerRoot` | Couche affichée |
|---|---|
| dossier de l'agent spec (`agentRef`) | agent (ou profil si le chemin est dans `profiles.<p>.startup`) |
| dossier du rig, `path` = `culture_file` | culture du rig |
| dossier du rig, autre | rig / pod / membre selon où le chemin est déclaré dans `rig.yaml` |
| `<openrig>/daemon/assets` | OpenRig (`CULTURE-default.md`, `openrig-start.md`, `openrig-onboarding-01/02.md`, `openrig-seat-skills.md`) |
| `~/.openrig/state/seats/<rig>/<seat>/…` | généré par OpenRig pour ce siège |

L'ordre est **celui que rend OpenRig** (relevé : rôle → `CULTURE-default` → `CULTURE.md` → scope du membre →
`openrig-start` → onboarding 01, 02 → seat-skills) ; Ledge ne retrie pas.

Mode de livraison, à montrer par fichier (`deliveryHint`) :
- `guidance_merge` → bloc géré `<!-- BEGIN OpenRig MANAGED BLOCK: <fichier> -->` dans `<cwd>/CLAUDE.md` (Claude, ou
  `CLAUDE.local.md` si `managed_blocks`) ou `<cwd>/AGENTS.md` (Codex). **Partagé par tous les sièges du même `cwd`** :
  les 5 sièges de ledge-dev écrivent dans le même `~/Workspace/ledge/CLAUDE.md` / `AGENTS.md`.
- `send_text` → tapé dans le terminal après démarrage (rôle, scope, identité).
- `skill_install` → copié dans le dossier de skills du runtime.
- `appliesOn` : `fresh_start` seul pour l'onboarding (pas renvoyé à une reprise).

## 3. Ce qui n'est pas disponible (à remonter à l'utilisateur)

1. **Le prompt système de base du harnais** (Claude Code, Codex) : ni OpenRig ni Ledge ne le voient. Le « contexte de
   démarrage assemblé » se limite à ce qu'OpenRig ajoute, plus les fichiers que le harnais charge seul.
2. **Ce que le harnais charge de lui-même** : `~/.claude/CLAUDE.md` global, `CLAUDE.md` du projet hors blocs gérés,
   mémoire auto, skills/plugins de l'utilisateur, hooks de SessionStart (oh-my-claudecode…). Ledge peut en lister les
   fichiers connus, pas garantir qu'ils sont exhaustifs.
3. **Les settings effectifs après fusion.** OpenRig fusionne `claude_settings_fragment` dans
   `<cwd>/.claude/settings.local.json`, `claude_mcp_fragment` dans `<cwd>/.mcp.json`, `codex_config_fragment` dans un bloc
   de `$CODEX_HOME/config.toml` ; Claude fusionne ensuite user / projet / local / `--settings` en ligne de commande. Aucune
   source ne donne le résultat. On peut montrer **les fragments** (fichiers de la spec) et **les fichiers cibles**, pas
   le merge. La politique de permissions passée au lancement n'apparaît que dans la ligne de commande du processus
   (`identityVerdict.evidence.observedCommand`) : pas une source à exposer.
4. **Le contenu réellement livré.** `startupFiles` est le plan enregistré au lancement, pas une preuve de livraison :
   `openrig-seat-skills.md` (guidance_merge, `required: false`) est listé pour les sièges Claude mais **absent** de
   `~/Workspace/ledge/CLAUDE.md` au moment du relevé. Les `send_text` ne sont visibles que dans le transcript.
5. **La résolution d'un rôle non lancé** par OpenRig lui-même (voir §2) ; les skills « découvertes » au lancement.
6. **Les startup files de membre d'un rig en marche** via `rig spec show` (perdus) : utiliser le détail de nœud.
7. **Le détail de nœud n'existe qu'en HTTP**, route interne non documentée comme contrat : elle peut changer entre
   versions d'OpenRig. Ledge doit lire défensivement (champs absents → `unknown`) et la remplacer dès qu'une commande
   CLI la publie.

## 4. Contrat proposé

### 4.1 Où ça passe

- **`packages/ledge/src/daemon/openrig.ts`** : deux méthodes sur `OpenRig`, `roles()` et `role(id)`.
  - CLI pour la bibliothèque (`specs ls --kind agent`, `specs ls --kind rig`, lecture des YAML via `fs`, comme
    `specs()` le fait déjà).
  - HTTP en lecture seule pour le détail de nœud : `http://127.0.0.1:<daemon.port>/api/rigs/:rigId/nodes/:logicalId`,
    port pris dans `rig status --json` (déjà lu dans `OpenRigState.daemon.port`). Pas de jeton requis (vérifié).
    **Liste blanche de champs** : jamais `resumeToken`, `resumeCommand`, `recoveryGuidance`, `identityVerdict`, `binding`,
    `recentEvents` vers le front.
  - Un module pur `daemon/openrigRoles.ts` pour la résolution déclarée et le rangement en couches (testable sans `rig`).
- **`packages/protocol/src/openrig.ts`** : les schémas ci-dessous ; `messages.ts` : les ajouter aux unions client/serveur.
- **`DaemonInfo`** : un drapeau `openrigRoles: boolean` pour que le front sache si la machine répond.
- **`packages/fleet/src/fleet.ts`** : deux genres de plus dans `rigAsks` / `rigFailure` (`roles`, `role`) → `offline` /
  `outdated` comme les autres.
- `server.ts` : `case 'openrig.roles'` / `case 'openrig.role'`, réponse à l'appelant seulement (pas de broadcast).

### 4.2 Messages

```ts
/** Un front demande les rôles (agent specs) de la machine. */
openrig.roles   { type, requestId, machineId? }
/** La liste. error : daemon_stopped | not_installed | offline | outdated | texte de rig. */
openrig.roleList { type, requestId, machineId?, roles: RoleSummary[], error? }

/** Un front demande un rôle. `id` : l'id de bibliothèque (les noms ne sont pas uniques). */
openrig.role       { type, requestId, machineId?, id: string }
/** Le rôle. error : role_not_found en plus des précédentes. */
openrig.roleDetail { type, requestId, machineId?, role?: RoleDetail, error? }
```

### 4.3 Types

```ts
/** D'où vient une valeur. `here` : écrite dans ce fichier ; `inherited` : venue d'ailleurs (`from` dit d'où) ;
 *  `absent` : nulle part ; `unknown` : non connaissable ici (`why` dit pourquoi). */
type Origin =
  | { kind: 'here'; path: string }
  | { kind: 'inherited'; from: 'import' | 'profile' | 'defaults' | 'rig' | 'pod' | 'member' | 'openrig' | 'seat' | 'launch'; ref?: string; path?: string }
  | { kind: 'absent' }
  | { kind: 'unknown'; why: 'resolved_at_launch' | 'not_exposed' | 'unreadable' | 'ambiguous' };
type Sourced<T> = { value: T | null; origin: Origin };

interface RoleSummary {
  id: string; name: string; version: string; description?: string;
  source: 'builtin' | 'user'; path: string;          // agent.yaml réel (resolvedSourcePath)
  importOnly: boolean;                                // spec sans profil, seulement importée (`shared`)
  seats: number;                                      // membres de rig (bibliothèque + rigs en marche) qui l'utilisent
  running: number;                                    // dont sièges vivants
}

interface RoleResource {
  category: 'skill' | 'guidance' | 'plugin' | 'subagent' | 'runtime_resource';
  id: string;                                         // effectif : `shared:openrig-core`
  path?: string; runtime?: string; type?: string;     // runtime_resource : claude-code / claude_settings_fragment…
  target?: string;                                    // où OpenRig le projette (`<cwd>/.claude/settings.local.json`)
  origin: Origin;
}

interface StartupEntry {
  kind: 'file' | 'action';
  path?: string; absolutePath?: string; value?: string;  // value : texte d'une action (identité…)
  layer: 'agent' | 'profile' | 'culture' | 'rig' | 'pod' | 'member' | 'openrig' | 'seat';
  layerInferred: boolean;                             // true : déduite par Ledge (§2.1), pas dite par OpenRig
  delivery: 'guidance_merge' | 'send_text' | 'skill_install' | 'auto';
  into?: string;                                      // guidance_merge : CLAUDE.md / CLAUDE.local.md / AGENTS.md du cwd
  required?: boolean;                                 // fichiers seulement (une action n'en a pas)
  appliesOn: Array<'fresh_start' | 'restore'>; orientation?: string;
}

interface RoleSeat {
  rig: string; rigSpecPath?: string; running: boolean;
  logicalId: string; session?: string; label?: string; profile: string;
  runtime: Sourced<string>; model: Sourced<string>; effort: Sourced<string>; cwd: Sourced<string>;
  cultureFile: Sourced<string>;
  /** Siège vivant : ce qu'OpenRig a résolu (détail de nœud). Absent sinon. */
  live?: {
    resolvedSpec: { name: string; version: string; hash: string };
    resources: RoleResource[];                        // installedResources
    startup: StartupEntry[];                          // dans l'ordre d'OpenRig
    skills?: Array<{ id: string; trigger?: string }>; // rig skill loadout --seat
  };
}

interface RoleDetail {
  summary: RoleSummary;
  defaults: { runtime: Sourced<string>; model: Sourced<string>; effort: Sourced<string> };
  imports: Array<{ ref: string; name?: string; path?: string; version?: string; error?: string }>;
  profiles: Array<{
    name: string; description?: string;
    runtime: Sourced<string>; model: Sourced<string>;
    /** Vue déclarée, résolue par Ledge (§2) : jamais présentée comme ce qu'un siège a reçu. */
    resources: RoleResource[];
    startup: StartupEntry[];                          // couches agent + profil seulement
  }>;
  seats: RoleSeat[];
  /** Ce qu'aucune source ne donne, pour que l'écran le dise (§3). */
  unavailable: Array<'harness_prompt' | 'effective_settings' | 'delivered_content' | 'harness_own_files'>;
  warnings: string[];                                 // import introuvable, uses ambigu, version épinglée différente…
  openrigVersion?: string;
}
```

### 4.4 Exemples réels (relevés le 2026-11-02, abrégés)

`openrig.roleDetail` pour **ledge-lead** :

```json
{
  "type": "openrig.roleDetail", "requestId": "r1",
  "role": {
    "summary": { "id": "f95e2928bc86da26", "name": "ledge-lead", "version": "1.0",
      "description": "Lead de ledge-dev — reçoit les objectifs, applique « maquette d'abord », route et rend compte",
      "source": "user", "path": "/home/jde/.openrig/specs/openrig/agents/lead/agent.yaml",
      "importOnly": false, "seats": 1, "running": 1 },
    "defaults": {
      "runtime": { "value": "claude-code", "origin": { "kind": "here", "path": "/home/jde/.openrig/specs/openrig/agents/lead/agent.yaml" } },
      "model": { "value": null, "origin": { "kind": "absent" } },
      "effort": { "value": null, "origin": { "kind": "absent" } }
    },
    "imports": [{ "ref": "local:../shared", "name": "shared", "path": "/home/jde/.openrig/specs/openrig/agents/shared/agent.yaml" }],
    "profiles": [{
      "name": "default",
      "runtime": { "value": "claude-code", "origin": { "kind": "inherited", "from": "defaults" } },
      "model": { "value": null, "origin": { "kind": "absent" } },
      "resources": [
        { "category": "guidance", "id": "role", "path": "guidance/role.md", "origin": { "kind": "here", "path": "/home/jde/.openrig/specs/openrig/agents/lead/agent.yaml" } },
        { "category": "plugin", "id": "shared:openrig-core", "path": "openrig-home:plugins/openrig-core",
          "origin": { "kind": "inherited", "from": "import", "ref": "shared", "path": "/home/jde/.openrig/specs/openrig/agents/shared/agent.yaml" } },
        { "category": "runtime_resource", "id": "shared:claude-default-settings", "path": "runtime/claude-settings.fragment.json",
          "runtime": "claude-code", "type": "claude_settings_fragment", "target": "<cwd>/.claude/settings.local.json",
          "origin": { "kind": "inherited", "from": "import", "ref": "shared" } },
        { "category": "runtime_resource", "id": "shared:claude-default-mcp", "path": "runtime/claude-mcp.fragment.json",
          "runtime": "claude-code", "type": "claude_mcp_fragment", "target": "<cwd>/.mcp.json",
          "origin": { "kind": "inherited", "from": "import", "ref": "shared" } },
        { "category": "runtime_resource", "id": "shared:codex-default-config", "path": "runtime/codex-config.fragment.toml",
          "runtime": "codex", "type": "codex_config_fragment", "target": "$CODEX_HOME/config.toml",
          "origin": { "kind": "inherited", "from": "import", "ref": "shared" } },
        { "category": "runtime_resource", "id": "shared:claude-activity-hooks", "path": "runtime/claude-activity-hooks.json",
          "runtime": "claude-code", "type": "claude_activity_hooks", "target": "<cwd>/.claude/settings.local.json",
          "origin": { "kind": "inherited", "from": "import", "ref": "shared" } }
      ],
      "startup": [
        { "kind": "file", "path": "guidance/role.md", "layer": "agent", "layerInferred": false, "delivery": "send_text",
          "required": true, "appliesOn": ["fresh_start", "restore"], "orientation": "role" }
      ]
    }],
    "seats": [{
      "rig": "ledge-dev", "rigSpecPath": "/home/jde/.ledge/rigs/ledge-dev/rig.yaml", "running": true,
      "logicalId": "pilot.lead", "session": "pilot-lead@ledge-dev", "label": "Lead", "profile": "default",
      "runtime": { "value": "claude-code", "origin": { "kind": "inherited", "from": "member", "ref": "pilot.lead" } },
      "model": { "value": "claude-opus-5-5", "origin": { "kind": "inherited", "from": "member", "ref": "pilot.lead" } },
      "effort": { "value": null, "origin": { "kind": "inherited", "from": "launch", "ref": "runtime_default" } },
      "cwd": { "value": "/home/jde/Workspace/ledge", "origin": { "kind": "inherited", "from": "member", "ref": "pilot.lead" } },
      "cultureFile": { "value": "CULTURE.md", "origin": { "kind": "inherited", "from": "rig", "ref": "ledge-dev" } },
      "live": {
        "resolvedSpec": { "name": "ledge-lead", "version": "1.0", "hash": "…" },
        "resources": [
          { "category": "plugin", "id": "shared:openrig-core", "origin": { "kind": "inherited", "from": "import", "ref": "shared" } },
          { "category": "runtime_resource", "id": "shared:claude-activity-hooks", "origin": { "kind": "inherited", "from": "import", "ref": "shared" } },
          { "category": "runtime_resource", "id": "shared:claude-default-mcp", "origin": { "kind": "inherited", "from": "import", "ref": "shared" } },
          { "category": "runtime_resource", "id": "shared:claude-default-settings", "origin": { "kind": "inherited", "from": "import", "ref": "shared" } }
        ],
        "startup": [
          { "kind": "file", "path": "guidance/role.md", "absolutePath": "/home/jde/.openrig/specs/openrig/agents/lead/guidance/role.md",
            "layer": "agent", "layerInferred": true, "delivery": "send_text", "required": true, "appliesOn": ["fresh_start", "restore"], "orientation": "role" },
          { "kind": "file", "path": "CULTURE-default.md", "absolutePath": "<openrig>/daemon/assets/guidance/CULTURE-default.md",
            "layer": "openrig", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": true, "appliesOn": ["fresh_start", "restore"] },
          { "kind": "file", "path": "CULTURE.md", "absolutePath": "/home/jde/.ledge/rigs/ledge-dev/CULTURE.md",
            "layer": "culture", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": true, "appliesOn": ["fresh_start", "restore"] },
          { "kind": "file", "path": "openrig-start.md", "layer": "openrig", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": false, "appliesOn": ["fresh_start", "restore"] },
          { "kind": "file", "path": "openrig-onboarding-01.md", "layer": "openrig", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": true, "appliesOn": ["fresh_start"] },
          { "kind": "file", "path": "openrig-onboarding-02.md", "layer": "openrig", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": true, "appliesOn": ["fresh_start"] },
          { "kind": "file", "path": "openrig-seat-skills.md", "layer": "openrig", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": false, "appliesOn": ["fresh_start", "restore"] },
          { "kind": "action", "value": "pilot-lead@ledge-dev\nOpenRig session identity:\n- rig: ledge-dev\n…", "layer": "openrig", "layerInferred": false,
            "delivery": "send_text", "appliesOn": ["fresh_start", "restore"] }
        ],
        "skills": "…relevé sur dev.back : 19 skills d'openrig-core (agent-operated-software, queue-handoff…)"
      }
    }],
    "unavailable": ["harness_prompt", "effective_settings", "delivered_content", "harness_own_files"],
    "warnings": [],
    "openrigVersion": "0.7.7"
  }
}
```

**dev.front** — siège de `ledge-developer` (`id 2158c9a084a611a4`, qui porte aussi `dev.back`) ; seule l'entrée `seats[]`
diffère du lead, avec un startup de membre :

```json
{
  "rig": "ledge-dev", "rigSpecPath": "/home/jde/.ledge/rigs/ledge-dev/rig.yaml", "running": true,
  "logicalId": "dev.front", "session": "dev-front@ledge-dev", "label": "Dev front", "profile": "default",
  "runtime": { "value": "claude-code", "origin": { "kind": "inherited", "from": "member", "ref": "dev.front" } },
  "model": { "value": "claude-opus-5-5", "origin": { "kind": "inherited", "from": "member", "ref": "dev.front" } },
  "effort": { "value": null, "origin": { "kind": "inherited", "from": "launch", "ref": "runtime_default" } },
  "cwd": { "value": "/home/jde/Workspace/ledge", "origin": { "kind": "inherited", "from": "member", "ref": "dev.front" } },
  "cultureFile": { "value": "CULTURE.md", "origin": { "kind": "inherited", "from": "rig", "ref": "ledge-dev" } },
  "live": {
    "resolvedSpec": { "name": "ledge-developer", "version": "1.0", "hash": "…" },
    "resources": [ "…mêmes 4 que pilot.lead…" ],
    "startup": [
      { "kind": "file", "path": "guidance/role.md", "absolutePath": "/home/jde/.openrig/specs/openrig/agents/developer/guidance/role.md",
        "layer": "agent", "layerInferred": true, "delivery": "send_text", "required": true, "appliesOn": ["fresh_start", "restore"], "orientation": "role" },
      { "kind": "file", "path": "CULTURE-default.md", "layer": "openrig", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": true, "appliesOn": ["fresh_start", "restore"] },
      { "kind": "file", "path": "CULTURE.md", "absolutePath": "/home/jde/.ledge/rigs/ledge-dev/CULTURE.md", "layer": "culture", "layerInferred": true, "delivery": "guidance_merge", "into": "/home/jde/Workspace/ledge/CLAUDE.md", "required": true, "appliesOn": ["fresh_start", "restore"] },
      { "kind": "file", "path": "guidance/scope-front.md", "absolutePath": "/home/jde/.ledge/rigs/ledge-dev/guidance/scope-front.md",
        "layer": "member", "layerInferred": true, "delivery": "send_text", "required": true, "appliesOn": ["fresh_start", "restore"] },
      "…openrig-start, onboarding 01/02, seat-skills, action d'identité, comme pour le lead…"
    ]
  }
}
```

Pour comparaison, `review.qa` (Codex) : `into` = `/home/jde/Workspace/ledge/AGENTS.md`, ressources
`shared:openrig-core` + `shared:codex-default-config`, et un second `openrig-seat-skills.md` en `send_text` généré sous
`~/.openrig/state/seats/…/review.qa/codex` (couche `seat`).

### 4.5 Coût et fraîcheur

`openrig.roles` : 2 appels CLI (`specs ls` agent + rig) + lecture des YAML, plus `rig ps --nodes -A` déjà en cache
(`STATE_TTL_MS`). `openrig.role` : ces données + 1 GET HTTP par siège vivant du rôle + 1 `rig skill loadout --seat` par
siège (le plus lent, à ne demander qu'à l'ouverture du détail). Pas d'abonnement : le front redemande.

## 5. Questions ouvertes pour la maquette

1. L'écran montre-t-il la vue déclarée et la vue siège côte à côte, ou la vue siège seulement quand elle existe ?
2. Faut-il le **contenu** des fichiers (rôle, culture, scope) ou seulement leur liste et leur chemin ? Le contenu
   demande un message de plus (`openrig.roleFile`), borné aux chemins déjà listés.
3. Les specs `builtin` (16, jamais utilisées par ledge-dev) : listées par défaut ou repliées ?
4. Les skills d'un plugin (19 pour openrig-core) : dépliées sous le plugin ou en liste à part ?

## 6. À signaler à OpenRig (hors Ledge)

- `rig specs preview` n'applique ni imports ni profils : `plugins: []` pour une spec qui sélectionne `shared:openrig-core`.
- `rig spec show <rigId>` perd les `startup.files` des membres.
- `rig spec audit` ne regarde que le startup du rig (faux positif `missing_startup_context`).
- Pas de commande CLI pour le détail de nœud ni pour une résolution de rôle sans lancement.
