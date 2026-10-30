# Teams and roles from the phone: implementation plan

> Remplacé par 2026-10-30-ledge-openrig-orchestrator-design (lot 1 : équipes, rôles et tâches retirés).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the phone, see, write and delete roles and team definitions, launch a team on a project, follow a live team
in Agents through its sheet, change its composition, and have a role's new prompt reach the sessions holding it now.

**Architecture:** New client-neutral daemon messages (`definitions.list`, `role.write`, `template.write`, `team.compose`,
`team.seat`…) do the file writes and the live-team changes in `packages/ledge/src/daemon`. The phone gateway relays a
new set of phone operations to them, each write checked by the device passkey over a digest of its exact content
(`packages/ledge/src/mobile/teamsOps.ts`). The mobile app gets a fourth tab, two editors and a live team sheet.

**Tech Stack:** TypeScript, zod, vitest, React (apps/mobile, testing-library), Node 24 (`globalThis.crypto.subtle`).

**Spec:** `docs/superpowers/specs/2026-10-28-mobile-teams-design.md`

## Global Constraints

- The phone never receives or sends a path. It names a role id, a team id, a scope (`home` | `repo`) and a project **name**.
- One machine: « Dépôt », « Lever » and the catalog use only repos whose `machine` is `'local'`; a project's folder is its first such repo.
- Every write, delete, launch, composition change, seat start/restart and dissolve from the phone carries a passkey assertion. Its
  challenge's subject is the operation's digest (`teamsDigest`, Task 2). The spec's « a new purpose per operation » is settled as two
  purposes, `define` (role/template files) and `team` (live teams): the digest includes the operation type, so one cannot stand for another.
- Validation is the protocol's: `RoleIdSchema`, `ROLE_LABEL_MAX` (40), `ROLE_PROMPT_MAX` (8000), `SeatsSchema` (1–8, one seat per role), `TeamNameSchema` (1–60).
- Files are written atomically (tmp + rename), in the format `parseRole` / `parseTemplate` read, and every write or delete checks the
  base hash of the version the phone showed: a mismatch is refused with code `changed` (« le fichier a changé sur le PC »).
- Role ids and team ids are fixed once saved; renaming a team changes only `name`.
- The word « modèle » never appears in phone copy. Spec strings used verbatim: « Lever », « Nouvelle équipe », « + Nouveau rôle »,
  « Ajouter un rôle », « Nouveau rôle… », « Lancer l'équipe · N sièges », « Enregistrer », « Supprimer », « Enregistrer le rôle »,
  « Lire et modifier la consigne », « Démarrer ce siège », « Redémarrer ce siège », « Modifier la composition »,
  « Enregistrer comme équipe », « Dissoudre l'équipe », « au prochain démarrage du siège », « termine puis part »,
  « le fichier a changé sur le PC », « Maison », « Dépôt <project> ».
- Prompt-change message, verbatim: `Ta consigne de rôle a changé (@<id>, <label>). La voici en entier ; elle remplace la précédente :\n\n<prompt>`.
- Prompt-change recipients follow spec §3.6 (every running session holding the role and resolving to the file, in a team or not). It rules over §4's « a dissolved team's seats do not »: a session no longer running never gets one, a running one does.
- Builder calls from spec §5, settled here: a role still seated in a team definition can be deleted, the editor first lists those teams;
  « finishes, then closed » is the session's next `free()` state (`daemon/relay.ts`); the catalog is not cached across app reloads.

## Review Focus

1. A label or team name holding `#`, `:`, `"` or `'` (« C# · "lead": a ») must come back unchanged after a write and a re-read. Today
   `frontMatter` and the template `scalar` strip ` #…` before unquoting, so it would be cut. Test in Task 3.
2. Many long roles: the catalog must fit the phone frame. Past `CATALOG_BUDGET`, prompts are sent cut and the role editor fetches the
   full one before editing. Tests in Task 6 and Task 9.
3. A removed seat whose session is on a permission prompt must not be closed while the prompt waits, only at its next free moment. If the
   user closes it on the PC meanwhile, the seat still goes. Test in Task 5.
4. The user edits after preparing a confirmation: the digest must be computed from the content at the moment of confirming, and an old
   challenge must not validate new content. Tests in Task 6 (gateway) and Task 7 (store).
5. A Dépôt scope or a « Lever » on a project with no local repo must be refused with `unknown_project`, not throw. Tests in Task 4 and Task 6.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/protocol/src/teams.ts` (modify) | Live seat overrides, `hash` on roles/templates, the new daemon messages |
| `packages/protocol/src/messages.ts` (modify) | Register the new client and server messages |
| `packages/protocol/src/phoneTeams.ts` (create) | Phone catalog shapes, phone team operations, `teamsDigest` |
| `packages/protocol/src/phone.ts` (modify) | Union entries, `confirm.prepare` digest, purposes, reasons, `PhoneTeam` fields |
| `packages/ledge/src/daemon/roles.ts` (modify) | Quote-aware front matter, `quoteScalar` |
| `packages/ledge/src/daemon/teams.ts` (modify) | Quote-aware scalar, `templateText`; `saveTemplate` reuses it |
| `packages/ledge/src/daemon/definitions.ts` (create) | Hash, `roleText`, guarded write/delete, scope folders, catalog scopes, prompt recipients |
| `packages/ledge/src/daemon/teamsLive.ts` (modify) | `compose`, leaving seats, seat overrides |
| `packages/ledge/src/daemon/server.ts` (modify) | Handlers, project → folder, prompt-change notices, leaver closing, seat start/restart, resume overrides |
| `packages/ledge/src/daemon/crossSession.ts` (modify) | `formatRoleNotice` |
| `packages/ledge/src/mobile/teamsOps.ts` (create) | Gateway side of the catalog and the team operations |
| `packages/ledge/src/mobile/gateway.ts` (modify) | Wire `teamsOps`, confirm purposes, deps |
| `packages/ledge/src/mobile/project.ts` (modify) | `toPhoneTeam` carries overrides, leaving, template, createdAt; `toPhoneCatalog` |
| `apps/mobile/src/state/store.ts` (modify) | `catalog`, `requestCatalog`, `readRole`, `define`, `teamOp` |
| `apps/mobile/src/model/catalog.ts` (create) | Pure helpers over the catalog |
| `apps/mobile/src/router.ts`, `ui/TabBar.tsx`, `ui/icons.tsx`, `copy.ts`, `App.tsx` (modify) | Routes, fourth tab, strings |
| `apps/mobile/src/screens/Teams.tsx`, `RoleEditor.tsx`, `TeamEditor.tsx`, `LiveTeam.tsx` (create) | The screens |
| `apps/mobile/src/screens/Agents.tsx` (modify) | Team header opens the sheet |

Test commands: `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/mobile test`, each
with a file filter after `--`. Typecheck: `pnpm typecheck`.

---

### Task 1: Protocol, daemon side

**Files:**
- Modify: `packages/protocol/src/teams.ts`, `packages/protocol/src/messages.ts`
- Test: `packages/protocol/test/teams.test.ts`

**Interfaces:**
- Produces (all exported from `@ledge/protocol`):
  - `TeamSchema.seats[]` gains `tool?: Tool`, `model?: ModelId`, `effort?: Effort`, `leaving?: true`.
  - `RoleSchema` and `TeamTemplateSchema` gain `hash?: string` (16 hex chars, of the file's text).
  - `DefinitionScopeSchema = z.enum(['home', 'repo'])`, `type DefinitionScope`.
  - `RoleDraftSchema = RoleSchema.pick({ id, label, prompt, tool, model, effort, autonomy })`, with `label` ≤ `ROLE_LABEL_MAX` and `prompt` ≤ `ROLE_PROMPT_MAX`.
  - `DefinitionCodeSchema = z.enum(['changed', 'exists', 'missing', 'unknown_project', 'invalid'])`.
  - Client messages, each with `rid: string(1..100)`. The `scope`/`project` pair is `{ scope: 'home' } | { scope: 'repo'; project: ProjectId }`,
    refined so that `repo` requires `project` and `home` forbids it:
    - `definitions.list { requestId? }`
    - `role.write { rid, scope, project?, role: RoleDraft, base: string | null }`. `base` null means create.
    - `role.delete { rid, scope, project?, id: RoleId, base: string }`
    - `template.write { rid, scope, project?, id?: string(1..64), name: TeamName, seats: Seats, base: string | null }`. No `id` means create; the id comes from the name.
    - `template.delete { rid, scope, project?, id, base: string }`
    - `team.compose { rid, team: TeamId, seats: Seats }`
    - `team.seat { rid, team: TeamId, role: RoleId, action: 'start' | 'restart' }`
    - `team.launch` gains `project?: ProjectId`.
  - Server messages:
    - `definitions.listing { requestId?, scopes: Array<{ scope, project: string | null, roles: Role[], templates: TeamTemplate[], problems: DefinitionProblem[] }> }`
    - `definition.result { rid, id?, hash?, code?: DefinitionCode, reason?: string }`. No `code` means done.
    - `team.changed { rid, team?: Team, reason?: string }`

- [ ] **Step 1: Write the failing tests** in `packages/protocol/test/teams.test.ts`, `describe('team definitions from any client')`:
  - `role.write` parses with `{ scope: 'home', base: null }`, and is refused with `scope: 'repo'` and no `project`, or with `scope: 'home', project: 'ledge'`.
  - `role.write` is refused when `role.prompt` has 8001 characters or `role.id` is `'Dev'`.
  - `template.write` is refused with 9 seats, and with two seats `{ role: 'dev' }`.
  - `team.seat` is refused with `action: 'stop'`.
  - A `TeamSchema` seat `{ role: 'dev', sessionId: 's1', model: 'opus', leaving: true }` parses, and an older seat without the new fields still parses.
  - `parseClientMessage` (messages.ts) accepts each new message.
- [ ] **Step 2: Run** `pnpm --filter @ledge/protocol test -- teams`. Expected: FAIL (unknown types).
- [ ] **Step 3: Implement** the schemas in `teams.ts` and add them to the client and server unions in `messages.ts` (next to `TeamSaveSchema` / `TeamSavedSchema`).
- [ ] **Step 4: Run** `pnpm --filter @ledge/protocol test` and `pnpm typecheck`. Expected: PASS. `server.ts` must still compile: add a `case` that answers `refuse('not yet')` for each new type, so the `switch` stays exhaustive until Task 4.
- [ ] **Step 5: Commit** `feat(protocol): team definition and live seat messages`

### Task 2: Protocol, phone side

**Files:**
- Create: `packages/protocol/src/phoneTeams.ts` (exported from `index.ts`)
- Modify: `packages/protocol/src/phone.ts`
- Test: `packages/protocol/test/phoneTeams.test.ts`

**Interfaces:**
- Consumes: Task 1's `RoleDraftSchema`, `DefinitionScopeSchema`, `SeatsSchema`.
- Produces:
  - Catalog shapes:
    - `PhoneRoleSchema` (strict): `{ id, label, prompt: max ROLE_PROMPT_MAX, cut?: true, tool?, model?, effort?, autonomy?, scope, project: string(≤80) | null, hash, shadows?: true, shadowed?: true }`. `project` is the project's name.
    - `PhoneTemplateSchema` (strict): `{ id, name, seats: Seats, scope, project, hash }`.
    - `PhoneProblemSchema` (strict): `{ file: string(≤80), scope, project, reason: string(≤200) }`. `file` is a file name, never a path.
    - `PhoneCatalogSchema = { projects: string[] (≤50, names with a local repo), roles: PhoneRole[] (≤200), templates: PhoneTemplate[] (≤100), problems: PhoneProblem[] (≤50) }`.
  - Phone reads, added to `PhoneClientMessageSchema`:
    - `{ type: 'teams.catalog' }`
    - `{ type: 'teams.role', scope, project?, id }`
  - Phone server messages:
    - `{ type: 'teams.catalog', catalog: PhoneCatalog }`
    - `{ type: 'teams.role', role: PhoneRole }`
  - Phone operations: each takes `op: OperationId` and `assertion?: Assertion`. Scope and project are the same refined pair as Task 1, with `project` a name (`string(1..80)`).
    - `role.write { op, scope, project?, role: RoleDraft, base: string | null, assertion? }`
    - `role.delete { op, scope, project?, id, base, assertion? }`
    - `template.write { op, scope, project?, id?, name, seats, base: string | null, assertion? }`
    - `template.delete { op, scope, project?, id, base, assertion? }`
    - `team.launch { op, project: string(1..80), name: TeamName, seats: Seats, template?: string(1..64), assertion? }`
    - `team.compose { op, team, seats, assertion? }`
    - `team.seat { op, team, role, action, assertion? }`
    - `team.dissolve { op, team, assertion? }`
  - Changes to `phone.ts`:
    - `ConfirmPurposeSchema` gains `'define'` and `'team'`.
    - `confirm.prepare` gains `digest?: /^[0-9a-f]{64}$/`.
    - `OperationReasonSchema` gains `'changed'`, `'exists'`, `'unknown_project'`.
    - `PhoneTeamSchema` gains `template?: string(≤64)`, `createdAt: string`, and on each seat `tool?`, `model?`, `effort?`, `leaving?: true`.
  - `teamsDigest(m: TeamsOperation): Promise<string>`. Its input is the operation without `op` and `assertion`. It returns the lowercase sha256 hex of `canonicalJson(rest)`, computed with `globalThis.crypto.subtle`.
  - `canonicalJson(v: unknown): string`: JSON with object keys sorted at every depth, `undefined` fields dropped.
  - `type TeamsOperation`: the union of the eight operations above. `teamsPurpose(type): 'define' | 'team'` maps role.* and template.* to `define`, team.* to `team`.

- [ ] **Step 1: Write the failing tests** in `phoneTeams.test.ts`:
  - `teamsDigest` of the same `role.write` with keys in another order, and with different `op` and `assertion`, is equal.
  - It differs when one character of `role.prompt` changes, when `base` changes, and between a `role.delete` and a `template.delete` carrying the same `id`/`base`.
  - `PhoneClientMessageSchema` refuses any phone operation that carries a `cwd` or `path` field: they are strict.
  - It refuses `team.launch` with 0 seats, and `role.write` with `scope: 'repo'` and no project.
  - `confirm.prepare` with `purpose: 'define'` and a 63-character digest is refused.
  - `PhoneCatalogSchema` refuses a `PhoneProblem` with a `path` key.
- [ ] **Step 2: Run** `pnpm --filter @ledge/protocol test -- phoneTeams`. Expected: FAIL.
- [ ] **Step 3: Implement** in `phoneTeams.ts`; add the operations to the `PhoneClientMessageSchema` union and the two server messages to `PhoneServerMessageSchema`.
- [ ] **Step 4: Run** `pnpm --filter @ledge/protocol test` and `pnpm typecheck`. Expected: PASS. In `gateway.ts`, add the new op types to the `SessionOperation` `Exclude` list (line 194), and make `run()` return `{ status: 'rejected', reason: 'unavailable' }` for them until Task 6. Add a `confirm.prepare` branch per new purpose that answers `invalid()`, to keep the `never` check compiling.
- [ ] **Step 5: Commit** `feat(protocol): phone catalog and team operations`

### Task 3: Definition files

**Files:**
- Create: `packages/ledge/src/daemon/definitions.ts`
- Modify: `packages/ledge/src/daemon/roles.ts` (`frontMatter`, `listRoles`), `packages/ledge/src/daemon/teams.ts` (`scalar`, `listTemplates`, `saveTemplate`)
- Test: `packages/ledge/test/definitions.test.ts`; `roles.test.ts` and the template tests must stay green.

**Interfaces:**
- Consumes: Task 1's `RoleDraft`, `DefinitionCode`, `DefinitionScope`.
- Produces:
  - `quoteScalar(v: string): string | null` (roles.ts). It returns `v` bare when it matches `/^[\w./@:+-]+$/` and is not a YAML keyword; otherwise `"v"` when `v` has no `"`, else `'v'` when it has no `'`, else `null` (refused). Newlines are always refused.
  - `frontMatter` and `scalar` strip a trailing ` # comment` only from an unquoted value.
  - `definitionHash(text: string): string`: sha256 hex, first 16 characters.
  - `listRoles` and `listTemplates` set `hash` on each item.
  - `roleText(r: RoleDraft): string | null`: `---`, then `label`, `tool`, `model`, `effort`, `autonomy` in that order (set ones only, through `quoteScalar`), then `---`, a blank line, the prompt, and a final newline. `null` when a value cannot be quoted.
  - `templateText(name: string, seats: readonly Seat[]): string | null`. `saveTemplate` keeps its signature and uses it.
  - `writeDefinition(path: string, text: string, base: string | null): { hash: string } | { code: 'changed' | 'exists' }`. Base null with an existing file gives `exists`. A non-null base gives `changed` when the file is missing or its hash differs. The write makes the folder, then tmp + rename.
  - `deleteDefinition(path: string, base: string): { ok: true } | { code: 'changed' | 'missing' }`
  - `scopeDir(kind: 'roles' | 'teams', scope: DefinitionScope, repoFolder?: string): string`: `<repoRoot(repoFolder)>/.ledge/<kind>` or `~/.ledge/<kind>`.
  - `scopeDefinitions(dir: { roles: string; teams: string }, scope): { roles: Role[]; templates: TeamTemplate[]; problems: DefinitionProblem[] }`: one folder pair only, no shadow merge.
  - `promptRecipients(roleId: string, path: string, sessions: readonly Session[], resolve: (id: string, cwd: string) => Role | undefined): Session[]`: sessions with `role === roleId`, `source === 'launcher'`, not exited, not archived, and `resolve(roleId, s.cwd)?.path === path`.

- [ ] **Step 1: Write the failing tests** in `definitions.test.ts`, each in a temp dir:
  - `roleText` → `parseRole` round-trips `{ id: 'lead', label: 'C# · "lead": a', prompt: 'Line 1\n\n# Heading\nLine 3', tool: 'codex', autonomy: 'auto' }` field for field (Review Focus 1).
  - `roleText` returns null for a label holding both `"` and `'`.
  - `templateText` → `parseTemplate` round-trips the name `Revue #2: "MR"` and seats `[{ role: 'lead', tool: 'claude', model: 'opus' }, { role: 'dev' }]`.
  - `writeDefinition` with base null on a new path writes it and returns the hash of what was written; a second call with base null returns `{ code: 'exists' }`.
  - `writeDefinition` with the returned hash succeeds; after the file is edited by hand, the same base returns `{ code: 'changed' }` and the file keeps the hand edit.
  - No `*.tmp` is left in the folder after a write.
  - `deleteDefinition` with a stale base returns `changed`; on a missing file it returns `missing`.
  - `promptRecipients`: three sessions hold `dev`. `a` resolves to the repo file, `b` to the home file, `c` is exited. Only `a` is returned for the repo path.
  - `listRoles` gives each role a `hash` equal to `definitionHash` of its file.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- definitions roles`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test -- definitions roles teams`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): write and delete role and team files`

### Task 4: Daemon handlers for definitions, and the prompt change

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts` (handlers next to `roles.list` at ~1257), `packages/ledge/src/daemon/crossSession.ts`
- Test: `packages/ledge/test/definitions-server.test.ts` (build it like `teams-server.test.ts`)

**Interfaces:**
- Consumes: Task 3's functions, Task 1's messages.
- Produces:
  - `projectFolder(projectId: string): Promise<string | undefined>` in `server.ts`: the first repo of that project with `machine === 'local'`, through `resolveFolder`. `undefined` when there is none or it does not resolve.
  - Handlers:
    - `definitions.list` answers `definitions.listing`: the home scope first, then one scope per project with a local folder, in the order of `projects.projects`.
    - `role.write`, `role.delete`, `template.write` and `template.delete` answer `definition.result`. An unresolved `repo` project gives `unknown_project`, a `roleText`/`templateText` null gives `invalid`, otherwise the code `writeDefinition`/`deleteDefinition` returns. A new template's id is `templateId(name)`.
  - After a `role.write` that changes `prompt` or `label`: for each of `promptRecipients(id, path, store.all(), findRole)`, call `mailbox.notify(s.id, formatRoleNotice({ role: id, text }), \`role:${id}:${hash}:${s.id}\`)` with the Global Constraints text.
  - `formatRoleNotice(n: { role: string; text: string }): string`, built like `formatTeamNotice` with a `role` attribute.

- [ ] **Step 1: Write the failing tests:**
  - A `role.write` to home with base null creates `~/.ledge/roles/<id>.md` and answers `definition.result` with a hash. It then shows in the next `definitions.listing`, under the home scope.
  - A `role.write` with `scope: 'repo', project: 'p1'` writes under p1's local repo `.ledge/roles`. For a project whose only repo is on machine `'srv'`, it answers `code: 'unknown_project'` (Review Focus 5).
  - A live launcher session holding `dev` in that repo gets one `mailbox.notify` whose text contains `@dev` and the full new prompt. A session in another repo, holding the home `dev`, gets none. A `role.write` changing only `model` sends none.
  - `template.write` with no id and the name `Revue MR` writes `revue-mr.yaml`. A second create with the same name answers `exists`.
  - `template.delete` with a stale base answers `changed` and leaves the file.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- definitions-server`. Expected: FAIL.
- [ ] **Step 3: Implement** the handlers, replacing Task 1's `not yet` stubs for these four types and `definitions.list`.
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test -- definitions teams`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): definitions from any client, prompt change reaches live seats`

### Task 5: Live team composition

**Files:**
- Modify: `packages/ledge/src/daemon/teamsLive.ts`, `packages/ledge/src/daemon/server.ts` (`launchTeam`, `resumeTeam`, `team.launch` handler, new handlers)
- Test: `packages/ledge/test/teamsLive.test.ts`, `packages/ledge/test/teams-server.test.ts`

**Interfaces:**
- Consumes: Task 1's seat fields and messages.
- Produces:
  - `TeamsLive.compose(team: string, seats: readonly Seat[]): { team: Team; added: string[]; removed: string[] } | string`.
    - Seats keep the given order. The `tool`/`model`/`effort` of a kept role are stored as given, and `name` is ignored.
    - An added role is a new free seat. A removed role with a live session becomes `leaving: true`; a removed free or ended seat is dropped.
    - A dissolved team is refused.
  - `TeamsLive` drops a `leaving` seat when its session exits or is removed, and patches that session `team: undefined`.
  - `server.ts`:
    - `closeLeavers()` runs on every store change and right after `compose`. For each `leaving` seat whose session is `free()` and not in `closing`, it calls `closeSession`. A refusal is logged, and the next change tries again.
    - The `team.compose` handler: `teams.compose`, then a session is launched for each added role (as `launchTeam` launches a seat, with the seat's overrides), then `closeLeavers()`. It answers `team.changed`, and on a launch failure the `reason` names the role.
    - The `team.seat` handler: `start` launches into a free seat. `restart` calls `closeSession` on the seat's session, then launches with the seat's tool. Both answer `team.changed`.
    - `resumeTeam` resumes with `seat.model ?? s.model` and `seat.effort ?? s.effort`. A seat whose `tool` differs from its session's tool is not resumed: `@<role> : outil changé, redémarre le siège`.
    - `team.launch` with `project` and no `cwd` uses `projectFolder(project)`, or answers `team.failed` « aucun dossier local pour ce projet ». With `seats` given, `template` is only recorded on the team: it is not looked up.

- [ ] **Step 1: Write the failing tests.** In `teamsLive.test.ts`:
  - `compose` on seats `[lead(s1), dev(s2), qa(null)]` with `[lead {model:'sonnet'}, dev, rev]` gives:
    - seats `[lead{sessionId:'s1', model:'sonnet'}, dev{s2}, rev{null}]` and `qa` gone;
    - `added: ['rev']`, `removed: ['qa']`.
  - Removing `dev` (s2 live) gives `dev{s2, leaving:true}`. After the store marks s2 exited, the seat is gone and s2's record has no `team`.
  - `compose` on a dissolved team returns a string.

  In `teams-server.test.ts`, with a fake tmux:
  - A removed seat whose session has a `pending` permission is not closed. Once the session becomes `idle` with no pending, it is closed exactly once (Review Focus 3).
  - Adding a role launches one session in it, seated in the team.
  - `team.seat` `restart` on a seat with `tool: 'codex'` closes the old session and launches a codex one.
  - `team.launch` with `project` set to a project without a local repo answers `team.failed`.
  - `resumeTeam` passes the seat's `model` override to `respawn`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- teamsLive teams-server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): change a live team's composition`

### Task 6: Gateway

**Files:**
- Create: `packages/ledge/src/mobile/teamsOps.ts`
- Modify: `packages/ledge/src/mobile/gateway.ts` (deps, `read` switch, `run`, `confirm.prepare`, `checkAssertion` purpose type, invalid-op list at ~671), `packages/ledge/src/mobile/project.ts`, `packages/ledge/src/daemon/server.ts` (gateway deps)
- Test: `packages/ledge/test/mobile-teams-ops.test.ts` (with the `setup()` and `auth` helpers of `mobile-gateway.test.ts`; move them to `test/helpers/gateway.ts` if they are not exported)

**Interfaces:**
- Consumes: Task 2's phone shapes and `teamsDigest`/`teamsPurpose`; Task 1's daemon messages.
- Produces:
  - New gateway deps:
    - `projectByName?: (name: string) => string | null`, the project id.
    - `teamCatalog?: true`. When it is absent, `teams.catalog` answers `error` `invalid`.
  - `toPhoneCatalog(l: DefinitionsListing, projectName: (id: string | null) => string | null): PhoneCatalog`:
    - repo items take their project's name;
    - `shadows`/`shadowed` are set where a repo role and a home role share an id;
    - each problem keeps only `basename(path)`;
    - prompts are sent whole while `JSON.stringify(catalog).length` stays under `CATALOG_BUDGET = 262_144`. After that, each prompt is cut to its first 200 characters with `cut: true`.
  - `toPhoneTeam` also carries `template`, `createdAt`, and each seat's `tool`/`model`/`effort`/`leaving`.
  - `createTeamsOps(deps): { catalog(deviceId: string): void; role(deviceId: string, msg): void; run(deviceId: string, msg: TeamsOperation): Promise<Outcome> }`.
    - `run` checks the passkey first: `checkAssertion(deviceId, msg.assertion, teamsPurpose(msg.type), await teamsDigest(msg))`.
    - Then it maps the project name to its id (`unknown_project` when unknown), sends the daemon message through `ask` with `rid = msg.op`, and maps the reply:
      - `definition.result` without `code` is `applied`;
      - `changed`, `exists` and `unknown_project` are `rejected` with that reason;
      - `invalid` is `rejected` `invalid`;
      - `missing` is `failed`;
      - `team.changed`/`team.launched` is `applied`, and with `reason`, or `team.failed`, it is `failed`;
      - `team.dissolve` is relayed as is, and a daemon `error` makes it `failed`.
  - The gateway's `confirm.prepare` with `define`/`team` needs `digest` and a credential for this rp. It issues a challenge bound to `{ deviceId, purpose, subject: digest }`.

- [ ] **Step 1: Write the failing tests:**
  - `teams.catalog` pushes `teams.catalog`, and its JSON contains none of the listing's paths: no `/` from a fixture path, no `.ledge`.
  - A catalog of 60 roles with 8000-character prompts parses with `PhoneServerMessageSchema`, has at least one `cut: true`, and its JSON is at most `CATALOG_BUDGET` characters (Review Focus 2).
  - `role.write` without an assertion is `rejected` `confirm_required`.
  - The phone prepares `define` over the digest of content A, then sends content B signed with that challenge: `rejected` `assertion_invalid`, and nothing reaches `dispatch` (Review Focus 4).
  - An expired challenge (`now` advanced 61 s) gives `assertion_expired`.
  - A valid `role.write` reaches `dispatch` as `role.write` with `project` set to the id and `rid` equal to the op, and `definition.result {}` makes it `applied`. `definition.result { code: 'changed' }` makes it `rejected` `changed`.
  - `team.launch` with an unknown project name gives `rejected` `unknown_project` without dispatching (Review Focus 5).
  - The same op id sent twice runs once, by the existing registry.
  - `teams` pushes carry `createdAt` and a seat's `leaving: true`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- mobile-teams-ops`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace Task 2's stubs. Wire `projectByName` and `teamCatalog: true` in `server.ts`, where the gateway is created.
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test -- mobile` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile-gateway): team catalog and operations behind the passkey`

### Task 7: Mobile state, routes, fourth tab

**Files:**
- Modify: `apps/mobile/src/state/store.ts`, `apps/mobile/src/router.ts`, `apps/mobile/src/ui/TabBar.tsx`, `apps/mobile/src/ui/icons.tsx` (a `flag` icon, the mockup's path `M5 21V4h11l-2 4 2 4H5`), `apps/mobile/src/copy.ts`, `apps/mobile/src/App.tsx`
- Create: `apps/mobile/src/model/catalog.ts`
- Test: `apps/mobile/test/state/teams-store.test.ts`, `apps/mobile/test/router.test.ts`, `apps/mobile/test/model/catalog.test.ts`

**Interfaces:**
- Consumes: Task 2's phone shapes, `teamsDigest`.
- Produces:
  - Store:
    - `MobileState.catalog: PhoneCatalog | null`, set on `teams.catalog` and reset with the snapshot reset.
    - `requestCatalog(): void`.
    - `readRole(r: { scope; project?; id }): Promise<PhoneRole>`, which resolves on the next `teams.role` of that id.
    - `define(req: DefineRequest): Promise<ChatAction>` and `teamOp(req: TeamRequest): Promise<ChatAction>`. The request is a `TeamsOperation` without `op` or `assertion`, `define` taking role.* and template.*, `teamOp` taking team.*.
    - Both follow `launchTeam(qid)`: no `device.confirm` gives `confirm_required`; otherwise `teamsDigest(req)` is computed **at that call**, then `prepareConfirm({ purpose, digest })`, `getAssertion`, and `write`. `define` asks for the catalog again once it is `applied`.
  - Routes:
    - `{ name: 'teams' }` is `#/teams`.
    - `{ name: 'team'; key: string }` is `#/team/<key>`, where `key` is `'new'` or a catalog key.
    - `{ name: 'team-copy'; teamId }` is `#/team-copy/<id>`.
    - `{ name: 'role'; key }` is `#/role/<key>`.
    - `{ name: 'live'; teamId }` is `#/live/<id>`.
    - `{ name: 'compose'; teamId }` is `#/compose/<id>`.
  - `TabBar`: `active` gains `'teams'`. The tab bar has Ledge (when chat), À traiter, Agents, Équipes: 4 columns with chat, 3 without.
  - `model/catalog.ts`:
    - `catalogKey(x: { scope; project: string | null; id }): string`, which is `scope~project~id`, and `parseCatalogKey`.
    - `scopeLabel(scope, project): string`, giving « maison » or « dépôt <project> ».
    - `autoSeats(seats, roles): string[]`, the role ids whose effective autonomy is `auto`.
    - `rolesNotSeated(seats, roles): PhoneRole[]`.
    - `teamsSeating(roleId, scope, project, templates): PhoneTemplate[]`.
    - `roleFor(catalog, project: string | null, roleId): PhoneRole | undefined`, the repo scope of that project first, then home.

- [ ] **Step 1: Write the failing tests:**
  - Router round-trips each new route through `href` and `parseRoute`, including a key with `~` and a space.
  - `TabBar` with `chat` renders 4 links in the order Ledge, À traiter, Agents, Équipes, and `active="teams"` marks Équipes `aria-current="page"`.
  - Store `define`: the phone sends `confirm.prepare` with `purpose: 'define'` and the digest of the request, and the `role.write` it writes carries the assertion and no `cwd`.
  - Calling `define` twice with different prompts prepares two different digests (Review Focus 4).
  - Without `device.confirm`, `define` resolves `confirm_required` and sends nothing.
  - `roleFor` prefers the project's repo role over the home role of the same id. `autoSeats` counts a seat whose role has `autonomy: 'auto'`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile test -- teams-store router catalog`. Expected: FAIL.
- [ ] **Step 3: Implement.** Make `App.tsx` route the new names to placeholder components, which Tasks 8–11 replace.
- [ ] **Step 4: Run** `pnpm --filter @ledge/mobile test`. Expected: PASS. Fix the existing `TabBar` assertions in `agents.test.tsx`/`teams.test.tsx` that count tabs.
- [ ] **Step 5: Commit** `feat(mobile): teams catalog state, routes and the Équipes tab`

### Task 8: Équipes tab, and the Agents team header

**Files:**
- Create: `apps/mobile/src/screens/Teams.tsx`
- Modify: `apps/mobile/src/screens/Agents.tsx` (`TableHead`), `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/screens/teams-tab.test.tsx`, `apps/mobile/test/screens/agents.test.tsx`

**Interfaces:**
- Consumes: Task 7's store, routes and helpers.
- Produces: `Teams({ store, onReconnect })`. Its layout follows the mockup board « Onglet Équipes »:
  - It calls `requestCatalog()` on mount and when `fresh` turns true.
  - Header « Équipes », subtitle `N équipes · M rôles`.
  - A primary « Nouvelle équipe » to `team/new`.
  - The ÉQUIPES section: each team with its `scopeLabel` and its `@roles`, a row that opens `team/<key>`, and a « Lever » button.
  - « Lever » opens a dialog: the project picker over `catalog.projects`, preselected to the team's project for a Dépôt team, then `teamOp({ type: 'team.launch', project, name, seats, template: id })`.
  - Under the teams, one link per live team whose `template` is in the list: « <name> est levée · la suivre dans Agents ›».
  - RÔLES: `@id`, label, `tool · model · autonomy` (autonomy `auto` in warning color), each row opens `role/<key>`, and « + Nouveau rôle » goes to `role/new`.
  - A read-only problems list at the bottom: `file · scope · reason`.
  - Agents: an active team's `TableHead` becomes a link to `live/<id>`, with a chevron; a resting team keeps « Reprendre ».

- [ ] **Step 1: Write the failing tests:**
  - With a catalog of 2 templates and 3 roles, the tab shows « 2 équipes · 3 rôles », the scope tags « maison » and « dépôt paper-service », and « Lever ».
  - « Lever » on the Dépôt team preselects paper-service, and confirming calls `teamOp` with `{ type: 'team.launch', project: 'paper-service', template: 'feature-tdd' }` and the template's seats.
  - A problem shows its file name and never a `/`.
  - In Agents, the active team's header is a link with `href="#/live/team-a1b2"`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile test -- teams-tab agents`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @ledge/mobile test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): Équipes tab`

### Task 9: Role editor

**Files:**
- Create: `apps/mobile/src/screens/RoleEditor.tsx`
- Test: `apps/mobile/test/screens/role-editor.test.tsx`

**Interfaces:**
- Consumes: Task 7's `define`, `readRole`, `catalogKey`, `teamsSeating`.
- Produces: `RoleEditor({ store, roleKey: string })`, following the mockup « Nouveau rôle ».
  - For a new role (`'new'`):
    - an editable id field, prefixed « @ », in mono, checked live against `RoleIdSchema` and against the ids already in the chosen scope;
    - scope buttons « Maison » and « Dépôt <project> » for each catalog project.
  - For an existing role:
    - the id and the scope are fixed;
    - a role with `cut` is loaded with `readRole` before the prompt field is editable;
    - `shadows`/`shadowed` show one line saying which role hides which.
  - Fields:
    - label (≤ 40);
    - prompt textarea with the counter `n/8000`, typing blocked past 8000;
    - defaults: tool (`ToolSchema` options), model (free text checked by `ModelIdSchema`), effort (`EffortSchema`), autonomy (`AutonomySchema`).
  - « Enregistrer le rôle » runs `define({ type: 'role.write', scope, project, role, base: role?.hash ?? null })`.
  - « Supprimer » (existing roles only) first lists `teamsSeating` (« encore dans : Revue MR, Feature TDD »), then runs `define({ type: 'role.delete', … })`.
  - Below the save button, a caption says the save asks for the passkey.
  - Outcome `changed` shows « le fichier a changé sur le PC » and asks for the catalog again; `exists` shows that this id is already taken.

- [ ] **Step 1: Write the failing tests:**
  - Typing the id `Dev` shows the id rule and disables save.
  - The counter reads `212/8000` for a 212-character prompt.
  - Save sends `role.write` with `base: null` for a new role and `base: <hash>` for an existing one.
  - A `cut` role calls `readRole`, and the textarea is disabled until the `teams.role` reply.
  - A `changed` outcome shows the exact spec string.
  - Delete of a role seated by one template names that template before confirming.
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile test -- role-editor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @ledge/mobile test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): role editor`

### Task 10: Team editor (definition and live composition)

**Files:**
- Create: `apps/mobile/src/screens/TeamEditor.tsx`
- Test: `apps/mobile/test/screens/team-editor.test.tsx`

**Interfaces:**
- Consumes: Task 7's `define`, `teamOp`, `autoSeats`, `rolesNotSeated`, `roleFor`.
- Produces: `TeamEditor({ store, mode })`, following the mockup « Nouvelle équipe depuis les rôles ». `mode` is one of:
  - `{ kind: 'template'; key: string }` (`'new'` or a catalog key);
  - `{ kind: 'copy'; teamId }`, prefilled from a live team, saved as a new template;
  - `{ kind: 'live'; teamId }`.
- Fields: name, then the project (picker over `catalog.projects`; for a Dépôt team it is also where the team is stored).
- Scope buttons « Maison » / « Dépôt <project> » show in template modes only.
- SIÈGES · n SUR 8. Each seat shows its role pill, its label, `tool · model · autonomy`, « Changer » (a sheet with tool, model and effort for that seat) and a remove control.
- « Ajouter un rôle » lists `rolesNotSeated` and « Nouveau rôle… », which goes to `role/new`. It is hidden at 8 seats.
- One warning line per `autoSeats` entry.
- Actions in template modes:
  - « Lancer l'équipe · N sièges » runs `teamOp team.launch`;
  - « Enregistrer » runs `define template.write` (`base` null for new and copy);
  - « Supprimer » on an existing template runs `define template.delete`.
- Actions in live mode:
  - one « Enregistrer » runs `teamOp({ type: 'team.compose', team, seats })`;
  - a seat whose tool changed shows « Redémarrer ce siège » after the save;
  - a model or effort change shows « au prochain démarrage du siège ».

- [ ] **Step 1: Write the failing tests:**
  - Adding the 8th seat hides « Ajouter un rôle », and the launch button reads « Lancer l'équipe · 8 sièges ».
  - Removing every seat disables launch and save.
  - A seat whose role is `auto` shows one warning line naming `@dev`.
  - Save of a new template sends `template.write` with no `id` and `base: null`. Save of an existing one sends its `id` and `hash`.
  - In live mode, removing `@qa` and adding `@rev` sends one `team.compose` with the new seat list in its displayed order.
  - In live mode, changing a seat's model shows « au prochain démarrage du siège ».
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile test -- team-editor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @ledge/mobile test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): team editor`

### Task 11: Live team sheet

**Files:**
- Create: `apps/mobile/src/screens/LiveTeam.tsx`
- Test: `apps/mobile/test/screens/live-team.test.tsx`

**Interfaces:**
- Consumes: `state.teams` (Task 6 fields), `state.sessions`, `catalog`, Task 7's `teamOp` and `roleFor`.
- Produces: `LiveTeam({ store, teamId })`, following the mockup « Fiche d'une équipe levée ».
  - « Retour » goes back to `agents`.
  - Header: flag and name, then `project · au travail depuis HH:MM · d'après « <template name> »` (the template part only when known), then the progress `done/given`.
  - One card per seat:
    - role pill and label;
    - the holding session's name and state, or « libre », or « termine puis part » when the seat is `leaving`;
    - `tool · model · effort · autonomy` (the seat override, else the role default);
    - the first two lines of the role's prompt;
    - « Lire et modifier la consigne », which goes to `role/<key of roleFor>`;
    - on a free seat, « Démarrer ce siège », which runs `teamOp team.seat start`.
  - Actions:
    - « Modifier la composition » goes to `compose/<id>`;
    - « Enregistrer comme équipe » goes to `team-copy/<id>`;
    - « Dissoudre l'équipe » asks to confirm, then runs `teamOp team.dissolve` and goes back to Agents.
  - A team id no longer in `state.teams` shows the Gone screen.

- [ ] **Step 1: Write the failing tests:**
  - A seat with `leaving: true` reads « termine puis part ».
  - A free seat shows « Démarrer ce siège », and clicking it calls `teamOp` with `{ type: 'team.seat', action: 'start', role: 'review' }`.
  - The seat line shows the seat's `model` override over the role's.
  - « Lire et modifier la consigne » links to the repo role's key when the project has one.
  - Dissolve calls `teamOp({ type: 'team.dissolve', team: 'team-a1b2' })`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile test -- live-team`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` (whole workspace) and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): live team sheet`

---

## Self-review

**Spec coverage:**

| Spec section | Where it is implemented |
| --- | --- |
| §2 goals | Tab: T8. Agents and the live sheet: T8, T11. Prompt now: T4. Passkey: T6, T7. |
| §2 non-goals | No running tool/model switch: T5 stores overrides and restarts only. No paths: T2 strict schemas, T6 test. One machine: T4 `projectFolder`. |
| §3.1 vocabulary | Global Constraints, copy in T7–T11. |
| §3.2 screens | T7–T11. |
| §3.3 operations, project not path, digest, validation, shadowing, problems | T1–T6, plus the T9 shadow line and the T8 problems list. |
| §3.4 | T3 `promptRecipients`, T4 notice. |
| §3.5 table | T4 (prompt), T5 (overrides at resume, restart, add starts, remove after turn), T10 copy. A team definition does not touch a live team: no code needed. |
| §3.6 calls | Merged tab: T4 scopes, T6 catalog. Project at launch: T8. Seat overrides: T5. One compose with one passkey: T5, T6. Remove after turn: T5. Recipients: T3, T4. Hand edits: T3. Fixed ids: T1, T9. Problems by file name: T6. |
| §4 tests | Spread over the tasks as listed. |
| §5 | Global Constraints. |

`team.join` and `team.leave` from the phone (spec §3.3 table) are left out: no screen uses them, and the other clients keep them unchanged.

**Type consistency:** names checked across tasks:
- `teamsDigest`, `teamsPurpose`, `TeamsOperation`;
- `definition.result`, `team.changed`;
- `DefineRequest`, `TeamRequest`;
- `catalogKey`, `roleFor`, `autoSeats`, `rolesNotSeated`, `teamsSeating`;
- `projectFolder`, `projectByName`;
- `CATALOG_BUDGET`.
