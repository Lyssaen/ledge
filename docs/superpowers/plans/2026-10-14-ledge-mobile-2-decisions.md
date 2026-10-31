# Ledge mobile — lot 2 : décisions — plan d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUIS : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour réaliser ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** décider depuis le téléphone, avec une seule injection par demande, le refus des décisions obsolètes, un accusé de réception, une réception incertaine explicite après coupure, et une assertion WebAuthn liée à l'action pour tout impact élevé.

**Architecture :** classeur pur appelé par `identify()` ; registre d'opérations idempotent ; défis WebAuthn à usage unique, liés à (appareil, session, `pendingId`, `pendingVersion`, décision) ; chaîne de décision `daemon/decisions.ts`, partagée par les pairs locaux et distants. L'identité de la demande y est revérifiée sous le verrou d'injection existant. L'activation distante est une porte séparée (tâche 7).

**Pile technique :** voir le [plan directeur](2026-10-14-ledge-mobile.md). Ce lot n'ajoute aucune dépendance.

**Spec :** §1 (succès 1 et 3), §1.1, §2 (Détail, Impact élevé, Question, Transmise, Incertaine, Déjà traitée), §2.1, §4, §5, §9.2, §10.

**Prérequis :** lot 1 terminé. Q1 (politique de risque) et Q2 (questions sans vérification) validées par l'utilisateur le 2026-10-14.

## Global Constraints

Celles du [plan directeur](2026-10-14-ledge-mobile.md#global-constraints), plus :
- « Aucune décision distante avant validation de ces garanties » (spec §9.2) : `session.decide` n'entre dans `MOBILE_COMMANDS` qu'à la tâche 7.
- « Le libellé « Confirmer avec mon appareil » ne promet pas exclusivement Face ID. »
- « Autorisation prise en compte ne signifie pas commande terminée. »

## Review Focus

Ce lot porte les lignes 1, 2, 3 (rejet), 4 et 5 du [Review Focus du plan directeur](2026-10-14-ledge-mobile.md#review-focus). Les tests sont dans les tâches 4, 5 et 8.

---

### Task 1: Protocole des décisions et des opérations

**Fichiers :**
- Créer : `packages/protocol/src/operations.ts`
- Modifier : `packages/protocol/src/session.ts`, `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`
- Test : `packages/protocol/test/operations.test.ts`

**Interfaces :**
- Produit : `RiskSchema = z.enum(['low', 'high'])` ; `RiskReasonSchema = z.enum(['question', 'read_only_command', 'edit_inside_folder', 'pushes', 'destroys', 'deploys', 'publishes', 'pipes_to_shell', 'network', 'writes_outside_folder', 'sensitive_path', 'unsafe_flag', 'shell_syntax', 'script', 'plan', 'unknown'])` ; `PendingSchema` + `risk: RiskSchema.optional()`, `riskReason: RiskReasonSchema.optional()`.
- Produit : `OperationIdSchema = z.string().uuid()` ; `OperationStatusSchema = z.enum(['received', 'applied', 'rejected', 'failed', 'unknown'])` ; `OperationReasonSchema = z.enum(['stale', 'changed', 'assertion_required', 'assertion_invalid', 'assertion_expired', 'not_taken', 'no_prompt', 'read_only', 'busy', 'forbidden', 'conflict', 'agent_busy', 'unsupported', 'invalid'])` ; `AuthenticationJsonSchema` (sur le modèle de `RegistrationJsonSchema` : `response.{ clientDataJSON, authenticatorData, signature }`).
- Modifie : `session.decide` + `pendingId?: string`, `pendingVersion?: int > 0`, `operationId?: OperationId`, `assertion?: AuthenticationJson` ; `session.reply` + `operationId?`, `pendingId?`, `pendingVersion?`.
- Produit (`ClientMessage`) : `decide.prepare { id, pendingId, pendingVersion, decision: z.literal('accept') }`, `operation.status { operationId }`.
- Produit (`ServerMessage`) : `decide.challenge { id, pendingId, pendingVersion, decision: 'accept', options: z.record(z.unknown()), expiresAt }`, `operation.received { operationId }`, `operation.result { operationId, status: OperationStatus, reason?: OperationReason }`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('the legacy decide still parses', () => expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept' }).type).toBe('session.decide'));
it('a full remote decide parses', () => { /* pendingId, pendingVersion 2, operationId uuid, assertion */ });
it('decide.prepare is for accept only', () => expect(() => parseClientMessage({ type: 'decide.prepare', id: 'a', pendingId: 'p1-x', pendingVersion: 1, decision: 'deny' })).toThrow());
it('operation.result reasons are a closed list', () => expect(() => parseServerMessage({ type: 'operation.result', operationId: U, status: 'rejected', reason: 'oops' })).toThrow());
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @ledge/protocol exec vitest run test/operations.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @ledge/protocol test && pnpm -r typecheck`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): risk, operations, decision challenges and acknowledgements"
```

### Task 2: Classeur de risque

La politique ci-dessous a été **validée par l'utilisateur le 2026-10-14 (Q1, Q2)** : l'appliquer telle quelle ; tout écart repasse par l'utilisateur. La maquette illustre l'interface ; elle ne constitue pas cette politique.

**Fichiers :**
- Créer : `packages/ledge/src/daemon/risk.ts`
- Modifier : `packages/ledge/src/daemon/identify.ts` (`risk` et `riskReason` calculés quand une identité est attribuée ou que la version change), `packages/ledge/src/daemon/store.ts` (`load()` classe les demandes sans `risk`)
- Test : `packages/ledge/test/risk.test.ts`, `packages/ledge/test/identify.test.ts`

**Interfaces :**
- Produit : `interface RiskInput { kind: Pending['kind']; tool?: string; text: string; cwd: string; source: 'hook' | 'pane' }` ; `interface RiskVerdict { risk: Risk; reason: RiskReason }` ; `classify(input: RiskInput): RiskVerdict` (pure, sans accès disque) ; `SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash'])`. L'outil shell de Codex n'y est ajouté qu'à partir d'une capture réelle versée dans `test/fixtures`.
- Politique, évaluée dans l'ordre, première règle applicable :

| # | Condition | Verdict |
| --- | --- | --- |
| 1 | `kind === 'question'` | `low` / `question` (Q2) |
| 2 | `kind === 'plan'` | `high` / `plan` |
| 3 | `kind === 'diff'` : chemins lus dans `text` (Claude : un chemin ; Codex : liste séparée par `, `) ; texte vide ou `patch` | `high` / `unknown` |
| 4 | `diff` ou `Read` : un chemin dans `.git/`, `.env*`, `~/.ssh`, `~/.ledge` | `high` / `sensitive_path` |
| 5 | `diff` : un chemin hors de `cwd` après normalisation (`path.resolve(cwd, p)`, préfixe `cwd + sep`) | `high` / `writes_outside_folder` |
| 6 | `diff` : tous les chemins dans `cwd` | `low` / `edit_inside_folder` |
| 7 | `permission`, outil `Read`, chemin dans `cwd` | `low` / `read_only_command` |
| 8 | `permission`, outil `WebFetch` ou `WebSearch` | `high` / `network` |
| 9 | `permission` sans outil, ou outil hors de `SHELL_TOOLS` (dont `mcp__*`) | `high` / `unknown` |
| 10 | Commande shell qui correspond à `/\bgit\s+push\b/` | `high` / `pushes` |
| 11 | `/\brm\s+-\w*[rRf]/`, `/\bgit\s+reset\s+--hard\b/`, `/\bgit\s+clean\b/`, `/\bgit\s+branch\s+-D\b/`, `/\bgit\s+checkout\s+--\s/` | `high` / `destroys` |
| 12 | `/\bdeploy\b/`, `/\bterraform\s+apply\b/`, `/\bkubectl\s+(apply\|delete)\b/` | `high` / `deploys` |
| 13 | `/\b(npm\|pnpm\|yarn)\s+publish\b/` | `high` / `publishes` |
| 14 | `/\b(curl\|wget)\b[^\n]*\|\s*(sudo\s+)?(ba\|z\|da)?sh\b/` | `high` / `pipes_to_shell` |
| 15 | Saut de ligne, `;`, `&`, `\|`, `<`, `>`, `` ` ``, `$(`, `${`, ou guillemet contenant `$`/`` ` `` | `high` / `shell_syntax` |
| 16 | Premier mot contenant `=` (affectation d'environnement) | `high` / `unknown` |
| 17 | Argument interdit : `--output*`, `--pre*`, `--ext-diff`, `--textconv`, `-c`, `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-fprint*`, `-fls` | `high` / `unsafe_flag` |
| 18 | Argument absolu hors de `cwd`, ou commençant par `~` | `high` / `sensitive_path` |
| 19 | Lecture seule : `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `rg`, `grep`, `find`, `git status\|diff\|log\|show\|rev-parse`, `git branch` (sans argument ou avec `-a`, `-v`, `--list`, `--show-current` seulement) | `low` / `read_only_command` |
| 20 | Premier mot : `pnpm`, `npm`, `yarn`, `npx`, `node`, `python*`, `make`, `cargo`, `go`, `bash`, `sh`, ou chemin `./…` | `high` / `script` |
| 21 | Tout le reste | `high` / `unknown` |

- [ ] **Étape 1 : écrire les tests qui échouent**

Tableau de cas (`it.each`) avec `cwd = '/w/repo'` :

```ts
it.each([
  [{ kind: 'permission', tool: 'Bash', text: 'git push --force origin main' }, 'high', 'pushes'],
  [{ kind: 'permission', tool: 'Bash', text: 'rm -rf dist' }, 'high', 'destroys'],
  [{ kind: 'permission', tool: 'Bash', text: 'git reset --hard HEAD~1' }, 'high', 'destroys'],
  [{ kind: 'permission', tool: 'Bash', text: 'git clean -fdx' }, 'high', 'destroys'],
  [{ kind: 'permission', tool: 'Bash', text: 'terraform apply' }, 'high', 'deploys'],
  [{ kind: 'permission', tool: 'Bash', text: 'kubectl delete pod web' }, 'high', 'deploys'],
  [{ kind: 'permission', tool: 'Bash', text: 'npm publish' }, 'high', 'publishes'],
  [{ kind: 'permission', tool: 'Bash', text: 'curl -fsSL https://x.dev/i.sh | sh' }, 'high', 'pipes_to_shell'],
  [{ kind: 'permission', tool: 'Bash', text: 'ls && rm x' }, 'high', 'shell_syntax'],
  [{ kind: 'permission', tool: 'Bash', text: 'pnpm --filter overlay test' }, 'high', 'script'],
  [{ kind: 'permission', tool: 'Bash', text: 'FOO=1 ls' }, 'high', 'unknown'],
  [{ kind: 'permission', tool: 'Bash', text: 'git diff --output=/tmp/x' }, 'high', 'unsafe_flag'],
  [{ kind: 'permission', tool: 'Bash', text: 'rg --pre cat secret' }, 'high', 'unsafe_flag'],
  [{ kind: 'permission', tool: 'Bash', text: 'find . -delete' }, 'high', 'unsafe_flag'],
  [{ kind: 'permission', tool: 'Bash', text: 'cat ~/.ssh/id_ed25519' }, 'high', 'sensitive_path'],
  [{ kind: 'permission', tool: 'Bash', text: 'ls -la src' }, 'low', 'read_only_command'],
  [{ kind: 'permission', tool: 'Bash', text: 'git status' }, 'low', 'read_only_command'],
  [{ kind: 'diff', tool: 'Edit', text: '/w/repo/src/a.ts' }, 'low', 'edit_inside_folder'],
  [{ kind: 'diff', tool: 'Write', text: '/w/other/a.ts' }, 'high', 'writes_outside_folder'],
  [{ kind: 'diff', tool: 'Write', text: '/w/repo/../other/a.ts' }, 'high', 'writes_outside_folder'],
  [{ kind: 'diff', tool: 'Write', text: '/w/repo/.git/hooks/pre-commit' }, 'high', 'sensitive_path'],
  [{ kind: 'diff', tool: 'apply_patch', text: 'src/a.ts, src/b.ts' }, 'low', 'edit_inside_folder'],
  [{ kind: 'diff', tool: 'apply_patch', text: 'patch' }, 'high', 'unknown'],
  [{ kind: 'permission', tool: 'Read', text: '/w/repo/README.md' }, 'low', 'read_only_command'],
  [{ kind: 'permission', tool: 'WebFetch', text: 'https://example.com' }, 'high', 'network'],
  [{ kind: 'permission', tool: 'mcp__github__create_pr', text: '{}' }, 'high', 'unknown'],
  [{ kind: 'question', text: 'Quel thème ?' }, 'low', 'question'],
  [{ kind: 'plan', text: 'Plan' }, 'high', 'plan'],
])('%o → %s/%s', (input, risk, reason) => expect(classify({ cwd: '/w/repo', source: 'hook', ...input } as RiskInput)).toEqual({ risk, reason }));
it('every pane permission from the captured dialogs is high', () => {
  for (const f of ['codex-permission-exec', 'codex-permission-patch', 'cursor-permission', 'cursor-permission-wrapped', 'claude2-trust'])
    expect(classify(fromPane(f)).risk).toBe('high'); // fromPane: adapter.detectPrompt on test/fixtures/panes/<f>.txt
});
it('identify classifies a new pending and reclassifies on a version bump', () => { /* PanePrompt (high/unknown) then PermissionRequest Bash ls → low */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/risk.test.ts test/identify.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter `classify` selon le tableau et l'appeler dans `identify`**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon packages/ledge/test
git commit -m "feat(daemon): conservative risk classifier for pending requests"
```

### Task 3: Registre d'opérations idempotent

**Fichiers :**
- Créer : `packages/ledge/src/daemon/operations.ts`
- Test : `packages/ledge/test/operations.test.ts`

**Interfaces :**
- Produit : `interface OperationRecord { id: string; owner: string; fingerprint: string; status: OperationStatus; reason?: OperationReason; at: string }` ; `class OperationRegistry { constructor(o?: { now?: () => number; ttlMs?: number; max?: number }); begin(id: string, owner: string, fingerprint: string): { kind: 'fresh' | 'replay'; record: OperationRecord } | { kind: 'conflict' }; finish(id: string, status: 'applied' | 'rejected' | 'failed', reason?: OperationReason): OperationRecord; get(id: string, owner: string): OperationRecord | undefined }`.
- Valeurs : `ttlMs = 86_400_000`, `max = 500`. `owner` vaut `deviceId`, ou `'local'` pour un pair local. Un appareil ne lit jamais l'opération d'un autre (`get` renvoie `undefined`). L'éviction retire d'abord les plus anciennes terminées, jamais une opération `received`.
- Produit : `fingerprint(msg: ClientMessage): string`, le JSON stable de `type`, `id`, `decision`, `text`, `pendingId` et `pendingVersion`, sans `assertion`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a fresh operation is never fresh twice; replay returns the stored record', () => { /* … */ });
it('the same id with another payload is a conflict', () => { /* … */ });
it('a device cannot read another device\'s operation', () => { /* … */ });
it('an operation older than 24 h is forgotten', () => { /* now + 86_400_001 → get undefined */ });
it('eviction keeps operations still received', () => { /* max 2 */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/operations.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : la commande de l'étape 2.
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon/operations.ts packages/ledge/test/operations.test.ts
git commit -m "feat(daemon): idempotent operation registry"
```

### Task 4: Défis liés à l'action et vérification d'assertion

**Fichiers :**
- Créer : `packages/ledge/src/daemon/challenges.ts`
- Modifier : `packages/ledge/src/daemon/webauthn.ts`
- Test : `packages/ledge/test/challenges.test.ts` (authentificateur logiciel du lot 1)

**Interfaces :**
- Produit : `interface Binding { deviceId: string; sessionId: string; pendingId: string; pendingVersion: number; decision: 'accept' }` ; `class ChallengeStore { constructor(o?: { now?: () => number; ttlMs?: number }); issue(b: Binding): { challenge: string; expiresAt: string }; consume(challenge: string, b: Binding): 'ok' | 'expired' | 'mismatch' | 'unknown' }`. Valeurs : `ttlMs = 60_000` ; défi de 32 octets aléatoires en base64url. `issue` remplace le défi précédent du même `(deviceId, pendingId)`. `consume` retire le défi quel que soit le résultat, sauf `unknown`.
- Produit (`webauthn.ts`) : `assertionOptions(cfg: MobileConfig, credential: StoredCredential, challenge: string): Promise<PublicKeyCredentialRequestOptionsJSON>` (`allowCredentials: [credential.id]`, `userVerification: 'required'`, `timeout: 60_000`, `rpID: cfg.rpID`) ; `verifyAssertion(cfg: MobileConfig, credential: StoredCredential, response: unknown, expectedChallenge: string): Promise<{ newCounter: number }>` (`requireUserVerification: true` ; lève si l'identifiant ne correspond pas à `credential.id`) ; `challengeOf(response: unknown): string | null` (lit `clientDataJSON.challenge`).

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a challenge verifies once for its exact binding', async () => { /* issue → soft.assert → consume ok → verifyAssertion ok */ });
it('the same assertion replayed is refused', async () => { /* second consume → unknown */ });
it('a challenge for version 1 does not verify version 2', () => expect(store.consume(c, { ...b, pendingVersion: 2 })).toBe('mismatch'));
it('a challenge for accept on request A does not verify request B', () => { /* mismatch */ });
it('an expired challenge is refused and not consumed twice', () => { /* now + 60_001 → expired; then unknown */ });
it('an assertion signed by another device key is refused', async () => { /* second soft authenticator → verifyAssertion throws */ });
it('an assertion without user verification is refused', async () => { /* uv false → throws */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/challenges.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : la commande de l'étape 2.
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon packages/ledge/test/challenges.test.ts
git commit -m "feat(daemon): single-use WebAuthn challenges bound to request, version and decision"
```

### Task 5: Chaîne de décision du daemon

**Fichiers :**
- Créer : `packages/ledge/src/daemon/decisions.ts`
- Modifier : `packages/ledge/src/daemon/server.ts` (`session.decide`, `session.reply` avec demande, `decide.prepare` et `operation.status` délégués à `decisions.ts` ; `injectAndVerify(id, planFor, requirePrompt, expected?)` revérifie `expected` sous le verrou, avant le premier caractère ; option `remoteCommands?: ReadonlySet<ClientMessage['type']>`, `MOBILE_COMMANDS` par défaut)
- Test : `packages/ledge/test/decisions.test.ts` (pairs simulés via `attach`, `remoteCommands` incluant les décisions), `packages/ledge/test/server.test.ts`

**Interfaces :**
- Consomme : `OperationRegistry`, `ChallengeStore`, `verifyAssertion`, `DeviceStore`, `Peer`, `MobileConfig`.
- Produit : `class Refusal extends Error { constructor(readonly reason: OperationReason) }` ; `interface DecisionDeps { store: Store; ops: OperationRegistry; challenges: ChallengeStore; devices?: DeviceStore; config(): MobileConfig | null; inject(id: string, planFor: (pane: string) => KeyPlan, requirePrompt: boolean, expected?: { id: string; version: number }): Promise<void> }` ; `runDecide(peer: Peer, msg: SessionDecide, deps): Promise<void>` ; `runAnswer(peer: Peer, msg: SessionReply, deps): Promise<void>` ; `prepareDecide(peer: Peer, msg: DecidePrepare, deps): Promise<void>` ; `operationStatus(peer: Peer, msg: OperationStatusMsg, deps): void`.
- Ordre pour un pair distant :
  1. champs obligatoires présents, sinon `error { id, message: 'invalid' }` ;
  2. `ops.begin` : `replay` renvoie le résultat connu ; `conflict` → `rejected/conflict` ;
  3. `operation.received` ;
  4. session et demande : absente ou autre `pendingId` → `stale` ; autre `pendingVersion` → `changed` ; `hook_only` → `read_only` ;
  5. `accept` avec `risk !== 'low'` (absent compris) : sans `assertion` → `assertion_required`. Sinon `challenges.consume(challengeOf(assertion), binding)` : `expired` → `assertion_expired`, `mismatch` ou `unknown` → `assertion_invalid`. Puis `verifyAssertion` avec la clé de l'appareil, et `devices.setCounter` ;
  6. `inject` sous le verrou : appareil toujours présent, sinon `forbidden` ; `expected` identique, sinon `stale` ou `changed` ; verrou pris → `busy` ;
  7. succès → `applied`. `NOT_TAKEN` → `failed/not_taken` et `NO_PROMPT` → `failed/no_prompt` : la demande reste en `error`, comme aujourd'hui.
- Réponse à une question (`runAnswer`, distant) : `pendingId` et `pendingVersion` requis, `kind === 'question'`, `text` dans `/^[1-9]$/` et ≤ `options.length`. Sinon `unsupported` ; la réponse libre arrive au lot 5. `session.reply` sans demande, depuis un pair distant → `forbidden` (consigne au lot 3).
- `prepareDecide` : même contrôle de demande qu'aux points 4 et 5, puis `decide.challenge` avec `assertionOptions(cfg, device.credential, challenges.issue(binding).challenge)`.
- Pair local : sans `pendingId`, comportement actuel inchangé (D10). Avec `pendingId`/`pendingVersion`, contrôle d'identité sans assertion. `error { id }` toujours émis en cas d'échec. `operation.*` est émis seulement si `operationId` est fourni.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a decision taken on the phone then on the PC is injected once', async () => { /* remote accept low → applied; local decide with same pendingId → error; tmux.sent has one plan */ });
it('a late accept of A never answers B', async () => { /* A decided locally, B appears; remote accept pendingId A → rejected/stale; tmux.sent unchanged */ });
it('changed version is rejected', async () => { /* hook enriches pane pending → version 2; remote decide version 1 → rejected/changed */ });
it('git push --force: refused without assertion, refused with a wrong one, applied with a valid one', async () => { /* … */ });
it('the same operationId twice injects once and replays the result', async () => { /* … */ });
it('the same operationId with another decision is a conflict', async () => { /* … */ });
it('two simultaneous decisions: one applied, the other busy', async () => { /* … */ });
it('revocation before injection rejects the operation', async () => { /* hold the lock with a slow tmux, revoke, release → rejected/forbidden, nothing typed for it */ });
it('local accept of a high-risk request needs no assertion', async () => { /* local client, legacy message */ });
it('a remote question answered by option number is applied; free text is unsupported', async () => { /* … */ });
it('operation.status replays a result and answers unknown for an unknown id', async () => { /* … */ });
it('a failed injection reports failed/not_taken and keeps the request for an explicit retry', async () => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/decisions.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier sans régression**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS, tous les tests existants de décision et de réponse de `server.test.ts` compris.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon packages/ledge/test
git commit -m "feat(daemon): identified, idempotent and verified decisions"
```

### Task 6: Overlay : décisions identifiées

**Fichiers :**
- Modifier : `apps/overlay/src/surface/Surface.tsx` (lignes 508, 517 et 609 : `pendingId: s.pending?.id` et `pendingVersion: s.pending?.version` ajoutés quand ils existent), `apps/overlay/src/daemon/changes.ts` (`sameRequest` compare `id` quand les deux demandes en ont un, sinon la règle actuelle)
- Test : `apps/overlay/test/changes.test.ts`, `apps/overlay/e2e/reply.spec.ts`, `apps/overlay/test/use-daemon-asks.test.tsx` (existant)

**Interfaces :**
- Consomme : `Pending.id`, `Pending.version`.
- Rien d'autre ne change dans l'overlay : aucun affichage du risque, aucune assertion (spec §4).

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('two pendings with the same text but different ids are different requests', () => expect(sameRequest({ ...p, id: 'p1-a' }, { ...p, id: 'p2-b' })).toBe(false));
it('without ids, the old rule applies', () => expect(sameRequest(p, { ...p })).toBe(true));
// reply.spec.ts
test('accept sends the pending id and version', async ({ page }) => { /* simulated daemon records session.decide with pendingId */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter overlay exec vitest run test/changes.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier que le verrou de décision se comporte comme avant**

Exécuter : `pnpm --filter overlay test && pnpm --filter overlay test:e2e`
Attendu : PASS, y compris les tests existants de `useDaemonAsks` (le verrou échoue sur `error { id }` et se libère à la coupure).

- [ ] **Étape 5 : commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): send the identity of the request it decides"
```

### Task 7: Porte : activation des décisions distantes

**Conditions d'entrée, à cocher dans le rapport de tâche avant toute modification :**
- [ ] Tâches 1 à 6 vertes (`pnpm -r test`).
- [x] Q1 (politique de risque) et Q2 (questions sans vérification) validées par l'utilisateur le 2026-10-14, sans modification de la politique.
- [ ] R4 préparé : dépôt factice local avec un remote `file://`.

**Fichiers :**
- Modifier : `packages/ledge/src/daemon/remote/rights.ts` (`MOBILE_COMMANDS` + `session.decide`, `decide.prepare`, `operation.status`, `session.reply`)
- Modifier : `docs/mobile.md` (politique de risque validée le 2026-10-14 ; questions répondues sans vérification d'appareil)
- Test : `packages/ledge/test/remote-project.test.ts`, `packages/ledge/test/remote.test.ts`

- [ ] **Étape 1 : mettre à jour les tests**

```ts
it('a remote peer may run decisions from lot 2 on, never local-only commands', () => {
  for (const t of ['session.decide', 'decide.prepare', 'operation.status', 'session.reply'] as const) expect(remoteMayRun({ type: t } as never)).toBe(true);
  for (const t of ['session.interrupt', 'document.read', 'session.launch', 'update.daemon', 'device.revoke', 'pair.begin', 'session.kill', 'session.dismiss', 'session.rename'] as const) expect(remoteMayRun({ type: t } as never)).toBe(false);
});
it('end to end: paired phone accepts a low-risk request once', async () => { /* real remote listener + soft authenticator */ });
it('end to end: paired phone cannot accept git push --force without a valid assertion', async () => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/remote-project.test.ts test/remote.test.ts`
Attendu : ÉCHEC (commandes encore interdites).

- [ ] **Étape 3 : ajouter les quatre commandes à `MOBILE_COMMANDS`**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon/remote/rights.ts packages/ledge/test docs/mobile.md
git commit -m "feat(daemon): enable remote decisions behind the validated risk policy"
```

### Task 8: Modèle d'opérations côté mobile

**Fichiers :**
- Créer : `apps/mobile/src/model/operations.ts`, `apps/mobile/src/model/requestOutcome.ts`
- Modifier : `apps/mobile/src/state/store.ts` (applique `operation.*`, envoie `operation.status` pour chaque opération à vérifier à chaque `auth.ok`), `apps/mobile/src/connection/remoteClient.ts` (émet `resumed` au retour au premier plan)
- Test : `apps/mobile/test/operations.test.ts`

**Interfaces :**
- Produit : `type Phase = 'sending' | 'received' | 'applied' | 'rejected' | 'failed' | 'uncertain' | 'unknown'` ; `interface OpState { operationId: string; sessionId: string; pendingId?: string; pendingVersion?: number; kind: 'decide' | 'answer' | 'message' | 'interrupt'; decision?: 'accept' | 'deny'; text?: string; phase: Phase; reason?: OperationReason; startedAt: string }` ; `type OpEvent = { type: 'sent'; op: OpState } | { type: 'received'; operationId: string } | { type: 'result'; operationId: string; status: OperationStatus; reason?: OperationReason } | { type: 'link'; link: Link } | { type: 'resumed' }` ; `opsReducer(s: Record<string, OpState>, e: OpEvent): Record<string, OpState>` ; `toCheck(s): string[]` ; `newOperationId(): string` (`crypto.randomUUID()`) ; `OPS_KEY = 'ledge.mobile.operations'` (opérations non terminées et 50 dernières terminées).
- Règles : `link` ≠ `online` ou `resumed` pendant `sending`/`received` → `uncertain`. `result` `unknown` → `unknown`. Aucun événement ne produit un envoi de décision : le module n'expose aucune fonction d'envoi, et `toCheck` ne donne que des `operation.status`.
- Produit : `type Outcome = { kind: 'idle' } | { kind: 'sending' } | { kind: 'applied'; decision?: 'accept' | 'deny'; answer?: string } | { kind: 'rejected'; reason: OperationReason } | { kind: 'failed'; reason: OperationReason } | { kind: 'uncertain' } | { kind: 'unknown'; stillPending: boolean } | { kind: 'handledElsewhere' } | { kind: 'changed' }` ; `outcomeFor(target: { sessionId: string; pendingId: string; pendingVersion?: number }, sessions: Session[], ops: Record<string, OpState>): Outcome`. `handledElsewhere` : la demande n'est plus en attente et aucune opération appliquée de cet appareil ne la concerne.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a close while sending marks the operation uncertain', () => { /* … */ });
it('resume with an open operation marks it uncertain and asks its status', () => { /* resumed → uncertain; toCheck → [id] */ });
it('unknown operation shows current request state', () => {
  expect(outcomeFor(t, [sessionWith(t.pendingId, t.pendingVersion)], { [id]: { ...op, phase: 'unknown' } })).toEqual({ kind: 'unknown', stillPending: true });
  expect(outcomeFor(t, [sessionWithout()], { [id]: { ...op, phase: 'unknown' } })).toEqual({ kind: 'unknown', stillPending: false });
});
it('a request gone without an operation of ours is handled elsewhere', () => { /* … */ });
it('operations survive a reload', () => { /* … */ });
it('no event ever produces a new decision', () => { /* run every event type; assert no op with phase sending is created except by sent */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/operations.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : la commande de l'étape 2.
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): operation tracking with uncertain delivery and status checks"
```

### Task 9: Décider depuis le détail

Référence visuelle : `Request.html` et les scénarios `resolved` et `disconnect` (`renderRequest`, `showResult`, `transmit`).

**Fichiers :**
- Créer : `apps/mobile/src/screens/DecisionFooter.tsx`, `apps/mobile/src/screens/Result.tsx`
- Modifier : `apps/mobile/src/screens/RequestDetail.tsx` (remplace le pied désactivé du lot 1), `apps/mobile/src/screens/Gone.tsx` (devient « Déjà traitée sur le PC »), `apps/mobile/src/copy.ts`
- Test : `apps/mobile/e2e/decide.spec.ts`

**Interfaces :**
- Consomme : `outcomeFor`, `opsReducer`, `newOperationId`.
- Pied : « Refuser » et « Autoriser une fois » (`low`), ou « Refuser » et « Vérifier et autoriser » (`high`, bouton `#8f3037`). Indication : « La décision sera transmise immédiatement au PC. » Hors connexion : boutons désactivés et « Aucune décision ne sera envoyée hors connexion. » Demande `readOnly` : pas de bouton, « Session démarrée hors de Ledge : répondez dans le terminal. »
- Transmission : « Transmission au PC… » et « En attente de confirmation du terminal. » ; second envoi bloqué.
- `applied` : « Autorisation prise en compte », « Refus pris en compte » ou « Réponse prise en compte » ; « Le terminal a reçu votre décision. » ; « Une décision transmise ne peut pas être annulée. » ; « Retour aux demandes ».
- `handledElsewhere` : « Déjà traitée sur le PC » ; « Cette demande a été résolue ailleurs. Aucune nouvelle décision n'a été envoyée. » ; aucun bouton d'autorisation.
- `uncertain` : « Réception non confirmée » ; « La connexion a été perdue pendant l'envoi. La décision a peut-être été reçue. Vérifiez son état avant de recommencer. » ; « Reconnecter et vérifier », qui reconnecte puis envoie `operation.status`.
- `unknown` : « État de la décision inconnu », puis l'état actuel de la demande. Une nouvelle décision n'est proposée que si `stillPending`.
- `changed` : « La demande a été mise à jour. Relisez-la avant de décider. » ; le détail affiche la nouvelle version.
- `rejected/busy` : « Une autre décision est en cours sur le PC. »
- `failed/not_taken` : « Le terminal n'a pas confirmé. La demande est toujours en attente. » ; une nouvelle tentative explicite (nouvel `operationId`) n'est permise que si la même `pendingId`/`pendingVersion` attend toujours.
- `failed/no_prompt` : « Le terminal n'affiche plus la demande. Ouvrez-le sur le PC. »
- `rejected/forbidden` : « Ce téléphone n'est plus autorisé. »

- [ ] **Étape 1 : écrire les tests e2e qui échouent** (daemon simulé scénarisé, à 320, 390 et 430 px)

```ts
test('accept a low-risk request: one decide message, transmission, then result and a lower count', async ({ page }) => { /* … */ });
test('a double tap sends one message', async ({ page }) => { /* … */ });
test('deny sends deny and shows the refusal result', async ({ page }) => { /* … */ });
test('already handled on the PC: no authorize button', async ({ page }) => { /* pending disappears before decision */ });
test('cut after authorize: uncertain, then reconnect and verify shows the real result, nothing resent', async ({ page }) => { /* close socket after operation.received; reconnect; daemon answers operation.result applied; count decide messages === 1 */ });
test('changed version: the detail refreshes and nothing was injected', async ({ page }) => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec playwright test e2e/decide.spec.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier, puis comparer à la maquette**

Exécuter : `pnpm --filter mobile test && pnpm --filter mobile test:e2e`
Attendu : PASS. Les captures à 390 px de la transmission, du résultat, de « Déjà traitée » et de « Réception non confirmée » sont comparées aux scénarios de la galerie dans le rapport de la tâche.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): decide from the request detail with explicit delivery states"
```

### Task 10: Confirmation à impact élevé et réponse aux questions

Référence visuelle : `Risk.html` (`confirmRisk`) et la question de `Request.html?id=theme-nova-01`.

**Fichiers :**
- Créer : `apps/mobile/src/model/consequence.ts`, `apps/mobile/src/screens/RiskConfirm.tsx`, `apps/mobile/src/screens/QuestionForm.tsx`, `apps/mobile/src/connection/verify.ts`
- Modifier : `apps/mobile/src/screens/RequestDetail.tsx`, `apps/mobile/src/copy.ts`
- Test : `apps/mobile/test/consequence.test.ts`, `apps/mobile/e2e/risk.spec.ts`, `apps/mobile/e2e/question.spec.ts`

**Interfaces :**
- Produit : `parsePushTarget(cmd: string): { remote: string; branch?: string; force: boolean } | null` ; `consequenceFor(item: InboxItem): { title: string; body: string; destination?: string } | null` (`null` pour `low`). Titres :
  - `pushes` : « Peut remplacer l'historique distant » si force, sinon « Publie sur un dépôt distant » ; la destination est `remote/branch`, ou « le dépôt distant configuré » ;
  - `destroys` : « Supprime des fichiers ou des modifications » ; `deploys` : « Modifie un déploiement ou une infrastructure » ; `publishes` : « Publie un paquet » ; `pipes_to_shell` : « Exécute un script téléchargé » ; `network` : « Accède au réseau » ; `writes_outside_folder` : « Écrit hors du dossier de la session » ; `sensitive_path` : « Touche un fichier sensible » ;
  - `script` : « Exécute un script du dépôt », avec le corps « Il s'exécute avec les permissions de cette session et peut modifier des fichiers ou accéder au réseau. » ;
  - `plan` : « Valide un plan : l'agent passera à l'exécution » ;
  - `unsafe_flag`, `shell_syntax` et `unknown` : « Commande que Ledge ne sait pas analyser ».
- Produit : `verifyAndDecide(item: InboxItem, deps: { send(m: ClientMessage): void; next(type: 'decide.challenge'): Promise<DecideChallenge>; startAuthentication: typeof import('@simplewebauthn/browser').startAuthentication }): Promise<{ operationId: string } | { cancelled: true }>`. Il envoie `decide.prepare`, attend `decide.challenge`, appelle `startAuthentication({ optionsJSON })`, puis envoie `session.decide` avec `assertion` et un nouvel `operationId`. Une `NotAllowedError` donne `{ cancelled: true }` sans `session.decide`.
- `RiskConfirm` : `<dialog>` modal nommé « Confirmer : <titre> ». Titre « Autoriser ce push forcé ? » si `pushes` et force, sinon « Autoriser cette commande ? ». Ligne de contexte « Bot · tâche · dépôt ». Conséquence répétée, commande, « Une vérification sur votre appareil sera demandée. Elle confirme votre identité, pas la sûreté de la commande. ». Boutons « Confirmer avec mon appareil » et « Revenir à la demande ». Fermer n'envoie rien. Annulation : « Vérification annulée. Rien n'a été envoyé. ». `assertion_expired` : « La vérification a expiré. Recommencez. ». `assertion_invalid` : « La vérification n'a pas été acceptée par le PC. »
- `QuestionForm` : options en radios sans présélection ; « Envoyer ma réponse » désactivé sans sélection ; envoi `session.reply { text: String(index + 1), pendingId, pendingVersion, operationId }`. « Autre réponse » absente ; elle arrive au lot 5 selon la capacité de l'outil.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('reads a forced push target', () => expect(parsePushTarget('git push --force origin main')).toEqual({ remote: 'origin', branch: 'main', force: true }));
it('a script request says it can change files or reach the network', () => { /* … */ });
// e2e (Chromium virtual authenticator)
test('closing the confirmation sends nothing and leaves the request pending', async ({ page }) => { /* … */ });
test('cancelled device verification sends no decision', async ({ page }) => { /* authenticator with isUserVerified false → NotAllowedError */ });
test('confirm sends decide.prepare then one decide with an assertion', async ({ page }) => { /* … */ });
test('the consequence is visible in the detail and repeated in the dialog at 320 x 568', async ({ page }) => { /* … */ });
test('a choice alone sends nothing; Send sends the option number', async ({ page }) => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/consequence.test.ts && pnpm --filter mobile exec playwright test e2e/risk.spec.ts e2e/question.spec.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier, puis comparer à la maquette**

Exécuter : `pnpm --filter mobile test && pnpm --filter mobile test:e2e`
Attendu : PASS. Les captures du détail à impact élevé et du dialogue sont comparées à `Risk.html` dans le rapport de la tâche.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): device-verified confirmation for high-impact requests and question answers"
```

### Task 11: Documentation et validation du lot 2

**Fichiers :**
- Modifier : `README.md` (Protocol : messages d'opération et de défi ; Security : politique de risque, WebAuthn, idempotence), `docs/mobile.md` (ce qui demande une vérification et pourquoi), `docs/spikes/2026-10-14-ledge-mobile-feasibility.md` (R4, R5, R8)

- [ ] **Étape 1 : rédiger la documentation**

- [ ] **Étape 2 : passer toute la suite**

Exécuter : `pnpm -r typecheck && pnpm -r test && pnpm --filter overlay test:e2e && pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 3 : valider sur l'iPhone (R4, R5, R8 du plan directeur)**

Attendu : conditions cochées dans le rapport, ou échec accepté explicitement par l'utilisateur.

- [ ] **Étape 4 : commit**

```bash
git add README.md docs/mobile.md docs/spikes/2026-10-14-ledge-mobile-feasibility.md
git commit -m "docs(mobile): remote decisions, risk policy and delivery states"
```
