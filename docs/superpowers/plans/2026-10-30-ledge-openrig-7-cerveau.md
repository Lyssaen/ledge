# Lot 7 : le cerveau de Ledge (plan d'implémentation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une session permanente, « Ledge », de l'outil choisi, qui reçoit les escalades et les messages du fil, et tranche seule ce que son mandat permet, après 60 s de grâce. Elle n'agit que par `ledge brain …`, sous un garde exécuté dans le daemon, et se souvient de ses règles et décisions.

**Architecture :**
- Daemon : un dossier `packages/ledge/src/daemon/brain/`, qui contient :
  - `mandate.ts` : `mandat.md`, et sa lecture ;
  - `guard.ts` : le garde, pur ;
  - `memory.ts` : les règles et les décisions ;
  - `settings.ts` : `brain.json` ;
  - `session.ts` : le cycle de vie de la session tmux `ledge-brain` ;
  - `inbox.ts` : ce qu'on injecte dans le cerveau, par la boîte aux lettres existante (`mailbox.notify`) ;
  - `decide.ts` : la grâce, et la décision qui passe par `answers.answer` du lot 4 ;
  - `commands.ts` : les opérations `ledge brain …`.
- CLI : `ledge brain …` (`cli/brain.ts`) envoie `brain.cmd`, avec la clé de session. Le daemon refuse toute autre session que le cerveau.
- Clients : l'onglet Mandat, Réglages › Ledge, la proposition d'activation. Les états `grace` et `decided` sont déjà rendus par les composants du lot 4.

**Tech Stack :** TypeScript ESM, zod, vitest, React, playwright.

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` (§5 en entier, §6, §8.2 Mandat). **Plan maître :** `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md`, dont le contrat et les Global Constraints font foi. **Lot 4 :** `docs/superpowers/plans/2026-10-30-ledge-openrig-4-fil-et-reponses.md`. Ce lot consomme `Answers`, `LedgeThread`, `LedgeSay.setResponder`, `createSeatSend` et les composants du fil.

**Maquette :** `docs/mockups/ledge-openrig/shots/p-ledge-mandat.png`. L'onglet « Décisions » de la maquette n'existe pas : ses « Dernières décisions » sont dans Mandat (spec §8.2, [U]).

**Dépendances :**
- Lot 4, fusionné.
- Lot 5, fusionné, pour `rig.act` et `rig.prepare`, appelés par `ledge brain rig …`.
- Lot 6 : il enveloppe `answers.answer` (idempotence par `rid`, `answer.delivery`) ; le cerveau ne passe que par lui. Les escalades distantes arrivent dans le même magasin d'escalades par son agrégation. Ce lot ne traite que le magasin : sans le lot 6, le cerveau ne voit que les escalades locales. Une décision sur une escalade distante passe par `answers.answer`, qui relaie (lot 6), ou renvoie `unreachable` tant que le lot 6 manque.

## Global Constraints

Celles du plan maître, plus :
- **Le garde est dans le daemon.** Un `decide` sur `design`, `architecture` ou `critical`, sur une catégorie inconnue, ou sur une catégorie que l'utilisateur s'est fait remonter, est **refusé et transformé en `ask`**. Le refus est donné au cerveau, sans erreur.
- **Mots-clés critiques**, qui reclassent `critical` d'office quand ils apparaissent dans le résumé, le détail, une question ou une option (insensible à la casse, sur des mots entiers) : `rm`, `rm -rf`, `drop`, `delete`, `truncate`, `force`, `force-push`, `--force`, `reset --hard`, `prod`, `production`, `secret`, `secrets`, `token`, `credentials`, `billing`, `supprimer`, `suppression`, `facturation`.
- **Grâce : 60 s** (`GRACE_MS = 60_000`), comptée depuis l'arrivée de l'escalade au daemon, avec `graceUntil` sur l'escalade. Si le cerveau ne fait rien, l'escalade repasse `pending` sans avis après **10 min** (`GRACE_CAP_MS = 600_000`), ou tout de suite si le cerveau tombe.
- **Relance :** 3 fois au plus en 10 min (`RESTARTS_MAX = 3`, `RESTART_WINDOW_MS = 600_000`) ; au-delà, l'état est `down`.
- **Relève :** à **70 %** de contexte (`BRAIN_CONTEXT_RELIEF = 0.7`), et chaque jour au premier moment libre après minuit (heure locale), toujours par `daemon/handover.ts`.
- **Mémoire injectée** au démarrage et à chaque relève : les règles actives, et les **20** dernières décisions.
- **Règle proposée** quand l'utilisateur tranche **deux fois pareil** dans une même catégorie. Elle ne s'applique qu'une fois validée.
- **Fichiers** : `~/.ledge/mandat.md`, `~/.ledge/memoire/rules.json`, `~/.ledge/memoire/decisions.jsonl`, `~/.ledge/brain.json`, `~/.ledge/brain/` (dossier de travail, instructions et cales).
- **Libellés** mot pour mot :
  - onglet et sous-onglets : « Mandat », « Ce que Ledge tranche », « Souvenirs · n », « Mandat lu dans ~/.ledge/mandat.md » ;
  - sections : « LEDGE TRANCHE SEUL », « TE REVIENT TOUJOURS », « Règles retenues », « Dernières décisions » ;
  - colonnes : « Règle », « Depuis », « D'où elle vient », « Appliquée » ;
  - boutons et mentions : « Me le remonter désormais », « à valider », « Revenir dessus », « Ouvrir », « Ledge pense en continu », « Ledge s'en occupe… », « Ledge est arrêté · Démarrer » ;
  - les phrases de pied « bleu : une règle que Ledge propose ; elle ne s'applique qu'une fois validée. » et « Ledge propose une règle quand tu tranches deux fois pareil. Le design, l'architecture et le critique ne passent jamais dans « Ledge tranche seul ». »
- **Étiquettes des catégories** (Mandat) :
  - `git` : merge, branches ;
  - `tests` : ciblés, relance ;
  - `context` : operator ;
  - `code` : nommage, style ;
  - `design` : UI, copie ;
  - `architecture` : stockage, API ;
  - `critical` : données, sécurité, suppression, coûts.

## Review Focus

1. **Une option au contenu critique classée `git` ou `code`** (« Pousser en force-push sur main »). Attendu : le garde la reclasse `critical`, la change en `ask`, l'escalade remonte à l'utilisateur, et le cerveau reçoit la raison. Test : tâche 2, `critical keywords in an option reclassify a git decide into an ask`.
2. **L'utilisateur répond à 59 s pendant que la décision du cerveau attend la fin de la grâce.** Attendu : une seule réponse part, celle de l'utilisateur ; la décision différée du cerveau est abandonnée, et le cerveau est prévenu (« l'utilisateur a répondu »). Test : tâche 7, `user answer during grace wins and drops the deferred decide`.
3. **Le cerveau meurt en boucle** (binaire absent, outil mal configuré). Attendu : 3 relances en 10 min, puis `down` et la bulle « Ledge est arrêté · Démarrer ». Toutes les escalades en `grace` repassent `pending`, et `ledge.say` retombe sur le coureur ponctuel. Test : tâche 4, `three deaths in 10 min mark the brain down and release grace`.
4. **`ledge brain decide` lancé depuis une autre session** (un siège de rig, une session seule, ou un `LEDGE_SESSION` recopié). Attendu : refus, sans aucune réponse envoyée. Test : tâche 8, `brain.cmd from a non-brain session is refused`.
5. **`mandat.md` édité à la main** : `design` déplacé dans « Ledge tranche seul », une catégorie inventée, ou un fichier vidé. Attendu : `ALWAYS_USER` s'applique quoi qu'il arrive ; une catégorie inconnue est ignorée ; un fichier illisible ou vide fait tout remonter à l'utilisateur. Test : tâche 2, `a hand-edited mandate never lets design through`.

---

### Task 1 : les compléments du contrat de protocole

**Files :**
- Modify : `packages/protocol/src/openrig.ts`, `packages/protocol/src/session.ts`, `packages/protocol/src/messages.ts`
- Test : `packages/protocol/test/openrig-brain.test.ts`

**Interfaces :**
- Produces :
  - `SessionSchema` gagne `brain: z.literal(true).optional()`.
  - `BrainStatusSchema` gagne :
    - `enabled: z.boolean().nullable()`, null tant que l'utilisateur n'a jamais été sollicité ;
    - `restarts: z.number().int().min(0).optional()` ;
    - `reason: z.string().optional()`, la raison de `down`.
  - `EscalationSchema` gagne `correcting: z.string().optional()`, l'id de la décision que l'on corrige (Revenir dessus).
  - `BRAIN_OPS = ['say','decide','ask','rig','send','propose','remember','who','rigs','escalations','rules'] as const`.
  - Client : `brain.cmd { rid, by, key, op: z.enum(BRAIN_OPS), args: z.array(z.string()).max(40) }`.
  - Serveur : `brain.result { rid, ok, line, code?: 'not_brain' | 'identity' | 'mandate' | 'grace' | 'invalid' | 'refused' }`.
  - `MANDATE_CATEGORY_TAGS: Record<MandateCategory, string[]>`, avec les étiquettes des Global Constraints.
  - `brain.set` gagne `first: z.literal(true).optional()` : marque l'acceptation de la proposition d'activation (`BrainOffer`, tâche 14), pour que le daemon l'annonce dans le fil.
  - Les types de mémoire sont ceux du lot 2 : `LedgeDecision` et `LedgeRule`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('a session may be the brain', () => { expect(SessionSchema.parse({ ...base, brain: true }).brain).toBe(true); });
test('brain status says whether it was ever enabled', () => { expect(BrainStatusSchema.parse({ state: 'off', tool: 'claude', enabled: null }).enabled).toBeNull(); });
test('brain.cmd carries op and args', () => { expect(ClientMessageSchema.parse({ type: 'brain.cmd', rid: 'r', by: 'brain', key: 'k', op: 'decide', args: ['qi-1', '--answer', 'q1=merge'] })).toBeTruthy(); });
test('an unknown op is rejected', () => { expect(() => ClientMessageSchema.parse({ type: 'brain.cmd', rid: 'r', by: 'b', key: 'k', op: 'rm', args: [] })).toThrow(); });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/protocol test -- openrig-brain` ; Expected : FAIL.
- [ ] **Step 3 : ajouter les champs et les messages.**
- [ ] **Step 4 : relancer**, avec `pnpm typecheck` — Expected : PASS.
- [ ] **Step 5 : commit** `feat(protocol): brain session, brain.cmd, escalation correction`

---

### Task 2 : le mandat et son garde

**Files :**
- Create : `packages/ledge/src/daemon/brain/mandate.ts`, `packages/ledge/src/daemon/brain/guard.ts`
- Modify : `packages/ledge/src/paths.ts` (`mandate`, `memoryDir`, `rules`, `decisions`, `brainSettings`, `brainDir`)
- Test : `packages/ledge/test/brain-mandate.test.ts`, `packages/ledge/test/brain-guard.test.ts`

**Interfaces :**
- Produces :
```ts
// mandate.ts
export const DEFAULT_MANDATE: string;   // texte ci-dessous, exact
export interface Mandate { self: MandateCategory[]; user: MandateCategory[]; readable: boolean }
export function parseMandate(text: string): Mandate;                         // self sans ALWAYS_USER ; readable=false → self vide
export function escalateCategory(text: string, c: MandateCategory): string;  // déplace la ligne de c dans « Te revient toujours »
export function ensureMandate(path: string): Promise<string>;                 // crée le fichier avec DEFAULT_MANDATE s'il manque, rend son texte
// guard.ts
export const GRACE_MS = 60_000;
export const CRITICAL_WORDS: readonly RegExp[];
export type GuardVerdict =
  | { ok: true; category: MandateCategory }
  | { ok: false; convert: 'ask'; category: MandateCategory | undefined; reason: string };
export function criticalIn(e: Escalation): string | null;                    // le premier mot critique trouvé, ou null
export function guardDecide(e: Escalation, claimed: string, answers: Record<string, string>, mandate: Mandate): GuardVerdict;
export function validAnswers(e: Escalation, answers: Record<string, string>): string | null;   // null si chaque question a un id d'option valide
```

`DEFAULT_MANDATE` (contenu de `~/.ledge/mandat.md`, spec §5.3) :

```markdown
# Le mandat de Ledge

Ledge tranche seul ce qui est dans la première liste. Tout le reste te revient.
Une ligne = une catégorie : `- <id> : <description>`. Les catégories design, architecture et critique te reviennent toujours, même déplacées.

## Ledge tranche seul
- git : git et branches
- tests : tests et relectures
- context : contexte et relèves
- code : petits choix de code

## Te revient toujours
- design : design (UI, copie)
- architecture : architecture (stockage, API)
- critical : critique (données, sécurité, suppression, coûts)
```

`guardDecide`, dans cet ordre :
1. `claimed` n'est pas une catégorie connue : `ask`, sans catégorie, avec la raison « catégorie inconnue ».
2. `criticalIn(e)` trouve un mot : `ask` en `critical`, avec la raison « contient « <mot> » ».
3. `claimed` est dans `ALWAYS_USER`, ou n'est pas dans `mandate.self` : `ask` dans cette catégorie, avec la raison « te revient ».
4. `validAnswers` refuse les réponses : le verdict n'est **pas** un `ask` ; c'est une erreur `invalid`, portée par la tâche 8.
5. Sinon, `ok`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('the default mandate parses into the four self categories', () => { expect(parseMandate(DEFAULT_MANDATE).self).toEqual(['git', 'tests', 'context', 'code']); });
test('a hand-edited mandate never lets design through', () => {
  const edited = DEFAULT_MANDATE.replace('- design : design (UI, copie)\n', '').replace('## Ledge tranche seul\n', '## Ledge tranche seul\n- design : design\n- banana : truc\n');
  expect(parseMandate(edited).self).not.toContain('design');
  expect(parseMandate('').readable).toBe(false);
  expect(guardDecide(gitEsc, 'git', { q1: 'merge' }, parseMandate(''))).toMatchObject({ ok: false, convert: 'ask' });
});
test('escalateCategory moves git to the user list', () => { expect(parseMandate(escalateCategory(DEFAULT_MANDATE, 'git')).self).toEqual(['tests', 'context', 'code']); });
test('critical keywords in an option reclassify a git decide into an ask', () => {
  const e = esc({ options: [{ id: 'a', label: 'Pousser en force-push sur main' }, { id: 'b', label: 'Merge' }] });
  expect(guardDecide(e, 'git', { q1: 'b' }, mandate)).toEqual({ ok: false, convert: 'ask', category: 'critical', reason: expect.stringContaining('force-push') });
});
test.each(['rm -rf build', 'DROP TABLE sessions', 'déployer en prod', 'rotate the secret', 'supprimer la branche'])('« %s » is critical', label => { expect(criticalIn(esc({ summary: label }))).not.toBeNull(); });
test('words inside other words are not critical', () => { expect(criticalIn(esc({ summary: 'format the product page' }))).toBeNull(); });
test('architecture is never decided', () => { expect(guardDecide(e, 'architecture', a, mandate)).toMatchObject({ ok: false, category: 'architecture' }); });
test('an unknown category becomes an ask without category', () => { expect(guardDecide(e, 'ops', a, mandate)).toMatchObject({ ok: false, category: undefined }); });
test('a valid git decide passes', () => { expect(guardDecide(gitEsc, 'git', { q1: 'merge' }, mandate)).toEqual({ ok: true, category: 'git' }); });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-mandate brain-guard` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** `CRITICAL_WORDS` est construit avec des bornes de mot Unicode (`(?<![\p{L}\p{N}_-])…(?![\p{L}\p{N}_])`, drapeau `iu`), pour que « product » ne déclenche pas « prod ».
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): mandate file and daemon-side mandate guard`

---

### Task 3 : la mémoire

**Files :**
- Create : `packages/ledge/src/daemon/brain/memory.ts`
- Test : `packages/ledge/test/brain-memory.test.ts`

**Interfaces :**
- Produces :
```ts
export interface Memory {
  rules(): LedgeRule[];
  decisions(o?: { limit?: number; since?: string }): LedgeDecision[];                // les plus récentes d'abord
  record(d: Omit<LedgeDecision, 'id'>): LedgeDecision;                                      // ajoute une ligne à decisions.jsonl ; incrémente appliedCount si d.rule
  propose(text: string, category: MandateCategory, from: string): LedgeRule;           // status 'proposed', since = aujourd'hui (AAAA-MM-JJ)
  setRule(id: string, status: 'active' | 'rejected'): LedgeRule | null;                // rejected = retirée du fichier
  markRevisited(decisionId: string, by: string): LedgeDecision | null;
  /** Deux réponses de l'utilisateur identiques, dans une même catégorie, sans règle active ni proposée qui la couvre déjà. */
  repeatedUserAnswer(d: LedgeDecision, escalations: (id: string) => Escalation | undefined): { category: MandateCategory; label: string; decisions: [string, string] } | null;
  onChange(fn: () => void): () => void;
}
export function createMemory(o: { dir: string; now?: () => string; uuid?: () => string }): Memory;
export function fallbackRuleText(question: string, label: string): string;       // « <question> → <libellé> »
```

« Identiques » se juge sur deux décisions `by: 'user'` de même catégorie. Leurs escalades ont une seule question chacune, et le libellé choisi est le même une fois normalisé (minuscules, espaces réduits, sans ponctuation finale). Une paire déjà proposée n'est pas reproposée : la règle garde les ids des deux décisions dans `from`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('decisions persist and come back newest first', async () => { /* … */ });
test('applying a rule counts it', () => { /* record({ rule: 'r1' }) deux fois → appliedCount 2 */ });
test('two identical user answers in one category are found once', () => { /* 2e décision → { category: 'git', label: 'merge' } ; 3e → null (déjà proposée) */ });
test('different labels or Ledge decisions do not count', () => { /* … */ });
test('a rejected proposal is removed', () => { /* … */ });
test('a torn decisions.jsonl line is skipped', async () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-memory` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** `rules.json` est réécrit en entier, de façon atomique (fichier temporaire puis `rename`) ; `decisions.jsonl` est en ajout seul.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): brain memory, rules and decisions`

---

### Task 4 : la session du cerveau

**Files :**
- Create : `packages/ledge/src/daemon/brain/settings.ts`, `packages/ledge/src/daemon/brain/session.ts`, `packages/ledge/src/daemon/brain/persona.ts`
- Modify : `packages/ledge/src/spawn.ts` (`SpawnOptions` gagne `brain?: true`, mis sur le record)
- Modify : `packages/ledge/src/daemon/server.ts` (création, `brain.status` à la connexion et à chaque changement, cas `brain.set`)
- Test : `packages/ledge/test/brain-session.test.ts`

**Interfaces :**
- Consumes : `spawnSession`, l'action `session.resume` existante (reprise d'une session sortie), `Store`, `Mandate`, `Memory`.
- Produces :
```ts
// settings.ts
export interface BrainSettings { enabled: boolean | null; tool: Tool; day?: string }
export function readBrainSettings(path: string): BrainSettings;       // défaut { enabled: null, tool: 'claude' }
export function writeBrainSettings(path: string, s: BrainSettings): Promise<void>;
// persona.ts
export function brainInstructions(o: { mandate: string; rules: LedgeRule[]; decisions: LedgeDecision[]; tool: Tool }): string;
// session.ts
export const RESTARTS_MAX = 3, RESTART_WINDOW_MS = 600_000;
export interface Brain {
  status(): BrainStatus;
  session(): Session | undefined;                    // la session brain:true vivante
  set(o: { enabled: boolean; tool?: Tool }): Promise<void>;
  start(): Promise<void>; stop(): Promise<void>;
  onStatus(fn: (s: BrainStatus) => void): () => void;
}
export function createBrain(d: { store: Store; settingsPath: string; dir: string; launch(o: { tool: Tool; cwd: string; env: Record<string, string>; prompt?: string; resume?: Session }): Promise<Session>; close(s: Session): Promise<unknown>; mandate(): Promise<string>; memory: Memory; now?: () => number }): Brain;
```

Comportement :
- **Dossier de travail** `~/.ledge/brain/` :
  - `CLAUDE.md` et `AGENTS.md`, réécrits à chaque démarrage à partir de `brainInstructions` ;
  - `bin/rig` et `bin/tmux`, deux scripts `#!/bin/sh`. Chacun écrit sur stderr « Le cerveau de Ledge passe par `ledge brain …` (rig, tmux et l'API d'OpenRig lui sont fermés). » et sort avec le code 1.
- **Environnement** : `PATH=<brain>/bin:<PATH de connexion>` et `LEDGE_BRAIN=1`, en plus de ce que `spawnSession` donne déjà (`LEDGE_SESSION`, `LEDGE_SESSION_KEY`).
- **Identité** : le premier lancement a l'id `brain`, donc la session tmux `ledge-brain`, et le nom « Ledge ». Une relève prend un id `brain-<hex>`. Le record porte `brain: true`.
- **Démarrage** :
  - au démarrage du daemon, si `enabled === true` : une session `brain: true` encore vivante dans le store est reprise telle quelle ; une session sortie est relancée par `session.resume`, ce qui reprend sa conversation ; à défaut, une session neuve est lancée ;
  - `set({ enabled: true })` démarre la session ; `set({ enabled: false })` la ferme proprement, avec le même chemin de fermeture que `session.close`.
- **Mort** : quand le store passe la session à `exited` alors que `enabled` est vrai, le daemon la relance, 3 fois au plus en 10 min. Au-delà : état `down`, `reason` = la fin de stderr ou le code de sortie, et `onStatus`.
- `brainInstructions` contient :
  - le rôle, en une ligne : « Tu es Ledge, l'humain des rigs OpenRig de l'utilisateur et son seul interlocuteur » ;
  - le mandat (texte de `mandat.md`) ;
  - les règles actives ;
  - les 20 dernières décisions, une ligne chacune ;
  - le format des messages injectés (tâche 6) ;
  - la table des commandes `ledge brain …` (spec §5.2), avec un exemple de chacune ;
  - les interdits : pas de `rig`, pas de `tmux`, pas de `curl` vers 7433 ; ne jamais répondre aux invites de confiance de dossier ; une catégorie hors mandat se remonte par `ask`, avec son avis.

- [ ] **Step 1 : écrire les tests qui échouent** (faux `launch` et faux store, horloge injectée)

```ts
test('enabling launches Ledge as brain in ledge-brain with the shims first in PATH', async () => {
  await brain.set({ enabled: true });
  expect(launched[0]).toMatchObject({ cwd: brainDir, env: { LEDGE_BRAIN: '1', PATH: expect.stringMatching(new RegExp(`^${brainDir}/bin:`)) } });
  expect(await readFile(join(brainDir, 'bin', 'rig'), 'utf8')).toContain('ledge brain');
});
test('the instructions carry mandate, active rules and the last 20 decisions', () => { /* 25 décisions → 20 lignes ; règle proposée absente */ });
test('a brain alive in the store is adopted, not relaunched', async () => { /* … */ });
test('a dead brain is relaunched', async () => { /* exited → launch rappelé, restarts 1 */ });
test('three deaths in 10 min mark the brain down and release grace', async () => { /* 4e mort dans la fenêtre → status down, reason ; launch appelé 3 fois de plus seulement */ });
test('deaths spread over more than 10 min keep relaunching', async () => { /* … */ });
test('disabling closes the session and writes enabled false', async () => { /* … */ });
```
(La libération de la grâce sur `down` est vérifiée à la tâche 7. Ici, on vérifie que `onStatus` émet `down`.)

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-session` ; Expected : FAIL.
- [ ] **Step 3 : implémenter**, puis brancher dans `server.ts` :
  - `launch` réutilise le chemin de `session.launch` (`spawnSession` et l'enregistrement) avec `brain: true` ;
  - le cas `brain.set` répond `rig.result` ;
  - une session `brain: true` est exclue de Projets et d'Atelier, côté client par le filtre `!s.brain` (tâche 13).
- [ ] **Step 4 : relancer** `pnpm --filter @ledge/ledge test` — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): the brain session, its shims and its restarts`

---

### Task 5 : le hook du cerveau

**Files :**
- Modify : `packages/ledge/src/cli/hook.ts`
- Modify : `packages/ledge/src/cli/send.ts` (`parseLedgeCommand` reconnaît `ledge brain <op> …`)
- Test : `packages/ledge/test/hook-brain.test.ts`

**Interfaces :**
- Produces :
```ts
export const BRAIN_FORBIDDEN: RegExp;   // (^|[\s;&|(])(rig|tmux)(\s|$) , ou curl|wget|http… vers (127.0.0.1|localhost):7433
export function brainRefusal(command: string): string | null;   // la raison du refus, ou null
```

Pour une session de cerveau (`LEDGE_BRAIN=1`, ou un record `brain: true`) :
- **PreToolUse, Claude (`Bash`) et Codex (`Bash`)** : une commande qui correspond à `BRAIN_FORBIDDEN` est refusée (`deny`), avec la raison « passe par `ledge brain …` ».
- **Codex** : `ledge brain …` est exécuté par le hook, comme `ledge send` aujourd'hui, puisque le bac à sable de Codex ne joint pas le daemon. Sa sortie devient la raison du `deny`.
- **SessionStart** : le contexte injecté est `brainInstructions(…)`, demandé au daemon, et non `identityContext`.
- Pour toutes les autres sessions, rien ne change.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test.each(['rig send dev-build@factory hi', 'cd x && tmux kill-session -t a', 'curl -s http://127.0.0.1:7433/api/ps'])('brain is refused « %s »', cmd => { expect(brainRefusal(cmd)).toMatch(/ledge brain/); });
test.each(['ledge brain rigs', 'git log --oneline', 'echo trigger'])('brain may run « %s »', cmd => { expect(brainRefusal(cmd)).toBeNull(); });
test('a non-brain session is never refused', async () => { /* runHook PreToolUse Bash 'rig ps' sans LEDGE_BRAIN → undefined */ });
test('codex brain runs ledge brain in the hook', async () => { /* faux daemon répond brain.result { line: '2 rigs' } → deny avec '2 rigs' */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- hook-brain` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** `pnpm --filter @ledge/ledge test -- hook` — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): brain hook refuses rig and tmux, runs ledge brain for Codex`

---

### Task 6 : ce que le cerveau reçoit

**Files :**
- Create : `packages/ledge/src/daemon/brain/inbox.ts`
- Test : `packages/ledge/test/brain-inbox.test.ts`

**Interfaces :**
- Consumes : `Mailbox.notify(target, text, rid, { first })` (`daemon/mailbox.ts`), qui tape le message au prochain moment libre de la session et en regroupe 6 au plus par tour.
- Produces :
```ts
export type BrainEvent =
  | { kind: 'escalation'; escalation: Escalation; rules: LedgeRule[] }          // rules : celles de sa catégorie probable, pour l'aider
  | { kind: 'user'; item: Extract<LedgeThreadItem, { kind: 'user' }>; about?: Escalation }
  | { kind: 'state'; text: string }                                          // « factory est prêt », « @qa a planté », « relève de @build »
  | { kind: 'answered'; escalation: Escalation }                             // l'utilisateur, ou un autre appareil, a répondu
  | { kind: 'refused'; escalationId: string; reason: string }               // le garde a transformé un decide en ask
  | { kind: 'revisit'; decision: LedgeDecision; claimed: boolean; text?: string };
export function formatBrainEvent(e: BrainEvent): string;                    // <ledge-event kind="…" id="…">…</ledge-event>, texte français, une instruction de commande à la fin
export function createBrainInbox(d: { mailbox: Pick<Mailbox, 'notify'>; brainId: () => string | undefined }): { push(e: BrainEvent): boolean };
```

Règles :
- Un message `user` passe avant les autres (`first: true`). Les autres suivent l'ordre d'arrivée.
- Sans cerveau vivant, `push` renvoie `false`, et l'appelant retombe sur le comportement sans cerveau.
- Une escalade est formatée avec : son id, sa source et `from`, son rig, son intention, son résumé, son détail, chaque question avec ses options (id, libellé, `recommandée`), `graceUntil`, puis une ligne « Tranche avec `ledge brain decide <id> --answer q1=<option> --category <cat> --why "…"`, ou remonte avec `ledge brain ask <id> --category <cat> --advice "…"`. ».
- Le texte injecté ne contient jamais de `!` en tête de ligne : les mêmes protections que le relais s'appliquent (mode bash de Claude).

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('an escalation is formatted with its options and the commands to answer', () => { /* contient 'id="qi-1"', 'sqlite (recommandée)', 'ledge brain decide qi-1' */ });
test('a user message goes first', () => { /* notify appelé avec { first: true } */ });
test('without a live brain push returns false', () => { /* … */ });
test('a leading ! in a summary is neutralised', () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-inbox` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): brain inbox through the mailbox`

---

### Task 7 : la grâce et la décision

**Files :**
- Create : `packages/ledge/src/daemon/brain/decide.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (branchements)
- Test : `packages/ledge/test/brain-decide.test.ts`

**Interfaces :**
- Consumes : `Answers.answer` et `Answers.onAnswered` (lot 4, tâche 3), `LedgeThread`, `guardDecide`, `Memory`, `BrainInbox`, `Brain.status`.
- Produces :
```ts
export const GRACE_CAP_MS = 600_000;
export interface Deciding {
  /** Appelé pour chaque escalade nouvelle : grace si le cerveau est on, sinon pending ; pousse l'événement au cerveau. */
  arrived(e: Escalation): void;
  /** `ledge brain decide` : garde, puis réponse différée jusqu'à graceUntil ; renvoie la ligne pour le cerveau. */
  decide(id: string, answers: Record<string, string>, claimed: string, o: { rule?: string; why?: string }): Promise<{ ok: boolean; line: string; code?: 'mandate' | 'invalid' | 'already_answered' | 'failed' }>;
  /** `ledge brain ask` : category, advice, état pending ; jamais refusé par le garde. */
  ask(id: string, category: string, advice: string): { ok: boolean; line: string };
  /** Le cerveau tombe ou est coupé : toutes les grâces repassent pending, les décisions différées sont abandonnées. */
  release(reason: string): void;
}
export function createDeciding(d: { escalations: OpenRigBridge['escalations']; answers: Answers; thread: LedgeThread; memory: Memory; inbox: BrainInbox; mandate: () => Mandate; brainOn: () => boolean; now?: () => number; setTimer?: typeof setTimeout }): Deciding;
```

Comportement :
- **`arrived`** :
  - cerveau `on`, et escalade `decision` : état `grace`, `graceUntil = arrivée + 60 s`, puis `inbox.push({ kind: 'escalation' })` ;
  - cerveau absent ou en panne : l'escalade reste `pending`, sans avis (spec §6) ;
  - une escalade `update` est seulement poussée au cerveau, pour information.
  - Un minuteur de 10 min (`GRACE_CAP_MS`) la repasse `pending` si le cerveau n'a ni décidé ni remonté.
- **`decide`** :
  - si `guardDecide` refuse : `ask(id, verdict.category ?? 'critical', '')` ; l'avis est vide, et le cerveau est invité à le compléter par `ledge brain ask`. Un `refused` est poussé au cerveau, et le code renvoyé est `mandate` ;
  - si `validAnswers` refuse : code `invalid` ;
  - si `now < graceUntil` : la décision est retenue, avec un minuteur jusqu'à `graceUntil`, et la ligne renvoyée est « Noté : je l'applique à hh:mm:ss si l'utilisateur n'a pas répondu. » ;
  - à l'échéance, ou tout de suite si la grâce est passée : `answers.answer(id, answers, 'ledge', { rule })`. En cas de succès, `memory.record({ by: 'ledge', category, … })` et `thread.append({ kind: 'decided', decisionId })`.
- **`onAnswered`**, branché ici :
  - une réponse `by: 'user'` abandonne la décision différée de la même escalade, et pousse `answered` au cerveau ;
  - elle enregistre la décision `by: 'user'` (catégorie : celle de l'escalade, sinon `code`) ;
  - elle appelle `repeatedUserAnswer`. S'il trouve une paire, le cerveau est prié de formuler la règle (`state` : « propose une règle avec `ledge brain remember … --from d1,d2` ») quand il est vivant ; sinon `memory.propose(fallbackRuleText(…))`.
- **`release`** est appelé par `brain.onStatus` sur `down` ou `off`.
- Le message du tranché, dans le fil, est fait par l'UI à partir de `LedgeDecision` : « J'ai tranché pour <siège> : <résumé>. Règle du jj/mm · <why> · Revenir dessus ».

- [ ] **Step 1 : écrire les tests qui échouent** (faux minuteurs `vi.useFakeTimers()`)

```ts
test('with the brain on, a new decision enters grace for 60 s', () => { /* state grace, graceUntil = t0+60000 */ });
test('with the brain off, it stays pending without advice', () => { /* … */ });
test('a decide before graceUntil is applied at graceUntil', async () => {
  const r = await deciding.decide('qi-1', { q1: 'merge' }, 'git', { why: 'règle du 26/10' });
  expect(r.line).toMatch(/^Noté/); expect(answerCalls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(answerCalls).toEqual([['qi-1', { q1: 'merge' }, 'ledge', {}]]);
  expect(kinds(thread)).toContain('decided');
});
test('user answer during grace wins and drops the deferred decide', async () => {
  await deciding.decide('qi-1', { q1: 'merge' }, 'git', {});
  await vi.advanceTimersByTimeAsync(59_000);
  await answers.answer('qi-1', { q1: 'rebase' }, 'user');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fakeOpenRigReplies()).toHaveLength(1);
  expect(inboxPushed.at(-1)).toMatchObject({ kind: 'answered' });
});
test('a guarded decide becomes an ask and tells the brain', async () => { /* architecture → code mandate ; escalation pending category architecture ; inbox refused */ });
test('grace past 10 min without action falls back to pending', () => { /* … */ });
test('release puts every grace back to pending', () => { /* … */ });
test('two identical user answers propose a fallback rule when the brain is off', async () => { /* rules() contient status proposed */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-decide` ; Expected : FAIL.
- [ ] **Step 3 : implémenter, puis brancher.** `escalations.onChange` appelle `arrived` pour un id nouveau, en remplacement du simple ajout au fil fait par le lot 4 : le fil reçoit toujours l'élément `escalation`. `brain.onStatus` appelle `release`.
- [ ] **Step 4 : relancer** `pnpm --filter @ledge/ledge test` — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): 60 s grace, deferred brain decisions, first answer wins`

---

### Task 8 : `ledge brain …`

**Files :**
- Create : `packages/ledge/src/cli/brain.ts`
- Create : `packages/ledge/src/daemon/brain/commands.ts`
- Modify : `packages/ledge/src/cli/index.ts` (`case 'brain'`, et la ligne d'usage `ledge brain <say|decide|ask|rig|send|propose|remember|who|rigs|escalations|rules> …   only from Ledge's brain session`)
- Modify : `packages/ledge/src/daemon/server.ts` (cas `brain.cmd` ; la vérification de clé de `runAction` est extraite en `verifySessionKey(by, key): { ok: true } | { ok: false; reason: string }`, et partagée)
- Test : `packages/ledge/test/brain-commands.test.ts`, `packages/ledge/test/cli-brain.test.ts`

**Interfaces :**
- Produces :
```ts
// cli/brain.ts
export async function runBrain(args: string[], o?: { port?: number; env?: NodeJS.ProcessEnv }): Promise<{ line: string; code: number }>;
export async function brainOnClient(client: Client, args: string[], by: string, key: string | undefined, ms: number): Promise<{ line: string; code: number }>;  // utilisé par le hook Codex
// daemon/brain/commands.ts
export function parseBrainArgs(op: BrainOp, args: string[]): { ok: true; value: BrainCall } | { ok: false; usage: string };
export function createBrainCommands(d: { deciding: Deciding; thread: LedgeThread; seatSend: ReturnType<typeof createSeatSend>; memory: Memory; rigs: () => Rig[]; escalations: OpenRigBridge['escalations']; store: Store; chat: Chat; rigAct: (msg: Extract<ClientMessage, { type: 'rig.act' }>) => Promise<RigResult>; rigPrepare: (msg: Extract<ClientMessage, { type: 'rig.prepare' }>) => Promise<RigPlan | { reason: string }> }): { run(call: BrainCall): Promise<{ ok: boolean; line: string; code?: string }> };
```

| Op | Arguments | Effet |
|---|---|---|
| `say` | `"<texte>"` | `thread.append({ kind: 'ledge', text })` |
| `decide` | `<id> --answer q=opt … --category <c> [--rule <id>] [--why "…"]` | `deciding.decide` |
| `ask` | `<id> --category <c> --advice "…"` | `deciding.ask` |
| `rig` | `up <spec> --goal "…" --because <userItemId> [--project <id> \| --off <nom>]` | `rigPrepare`, puis une carte de plan dans le fil ; l'utilisateur lance lui-même |
| `rig` | `down <rig> --because <userItemId>` | `rigAct` avec `verb: 'down'` |
| `rig` | `restart\|handover <siège>` | `rigAct` sur ce siège |
| `send` | `<@siège> "<texte>"` | `seatSend` |
| `propose` | `<action> --args '<json>'` | une carte d'action dans le fil, par le registre (`resolveRun`) et un tour de chat posé |
| `remember` | `"<règle>" --from <decisionIds> [--category <c>]` | `memory.propose` |
| `who`, `rigs`, `escalations`, `rules` | — | du texte, une ligne par élément |

Règles :
- **Identité** : `brain.cmd` sans `by`, avec une clé fausse, ou venant d'une session qui n'est pas `brain: true` est refusé avec `code: 'not_brain'` (ou `'identity'`) et la ligne « ledge brain ne marche que dans la session du cerveau de Ledge. ». Le CLI le dit aussi quand `LEDGE_BRAIN` est absent, sans joindre le daemon.
- **`--because`** doit nommer un élément `user` du fil vieux de moins de 24 h, et non encore utilisé par un autre `rig up` ou `rig down`. Sinon, code `refused`, avec « un up ou un down de rig n'est accepté que si l'utilisateur l'a demandé dans le fil ».
- **`propose rig-launch --goal … [--spec …] [--project …|--off-project <nom>] [--machine …]`** (spec §8.4) : le daemon appelle `rig.prepare` (lot 5) et pose une carte « Lancer ce rig » dont le clic ouvre la fenêtre de lancement du lot 5 pré-remplie, sur l'étape 1, ou sur le plan quand il est imposé. Ledge ne lance jamais seul : il n'y a pas de `rig.launch` depuis le cerveau.
- **`propose`** passe par une nouvelle méthode, `Chat.post(turn: { qid; answer; actions }): void` (`chat/service.ts`), qui ajoute un tour sans question, déjà répondu, et diffuse `chat.history`. Le fil reçoit `ledge { qid, text }`. Les cartes fonctionnent ensuite exactement comme celles du coureur ponctuel (`chat.act`).

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('brain.cmd from a non-brain session is refused', async () => { /* by: 'otto', clé valide d'Otto → { ok: false, code: 'not_brain' } ; aucune réponse OpenRig */ });
test('a wrong key is refused', async () => { /* code identity */ });
test('say adds a ledge bubble', async () => { /* … */ });
test('decide parses --answer pairs', () => { expect(parseBrainArgs('decide', ['qi-1', '--answer', 'q1=merge', '--answer', 'q2=b', '--category', 'git'])).toMatchObject({ ok: true, value: { answers: { q1: 'merge', q2: 'b' } } }); });
test('rig down without --because is refused', async () => { /* … */ });
test('rig down with a fresh user item runs rig.act down', async () => { /* … */ });
test('propose posts a chat turn with its cards and a ledge item with its qid', async () => { /* … */ });
test('propose rig-launch prepares a plan and posts a card that opens the launch modal prefilled', async () => { /* rig.prepare appelé avec goal/spec/where ; carte { action: "rig-launch", planId } ; aucun rig.launch */ });
test('the CLI refuses outside the brain without calling the daemon', async () => { /* runBrain(['rigs'], { env: {} }) → code 1 */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-commands cli-brain` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** `pnpm --filter @ledge/ledge test` — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): ledge brain commands, brain-only`

---

### Task 9 : le cerveau répond dans le fil

**Files :**
- Modify : `packages/ledge/src/daemon/server.ts` (`ledgeSay.setResponder` suit `brain.onStatus`)
- Create : `packages/ledge/src/daemon/brain/responder.ts`
- Test : `packages/ledge/test/brain-responder.test.ts`

**Interfaces :**
- Produces : `export function brainResponder(d: { inbox: BrainInbox; thread: LedgeThread; fallback: Responder; status: () => BrainStatus }): Responder;`

Règles :
- **`on`** : le message est poussé au cerveau (`kind: 'user'`, avec `about`), et la réponse viendra par `ledge brain say`.
- **`starting`** : le message est mis en attente et poussé dès que l'état passe `on` (`push` réessayé sur `onStatus`).
- **`down`, ou `enabled` vrai sans session vivante** :
  - le message est servi par le coureur ponctuel (spec §5.1 : pas de régression) ;
  - une bulle « Ledge est arrêté · Démarrer » est ajoutée une fois par panne. Le bouton « Démarrer » est rendu par l'UI quand le texte de la bulle est exactement celui-là, et envoie `brain.set { enabled: true }`.
- **`off`** : le coureur ponctuel.
- « Résumer la journée » (lot 4) suit le même chemin.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('brain on: a say goes to the brain, not to chat.ask', async () => { /* … */ });
test('brain starting: the say waits then goes to the brain', async () => { /* … */ });
test('brain down: the one-shot answers and « Ledge est arrêté · Démarrer » appears once', async () => { /* 2 says → 1 seule bulle d'arrêt */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-responder` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): the brain answers the ledge thread, one-shot as fallback`

---

### Task 10 : la relève, quotidienne et à 70 %

**Files :**
- Modify : `packages/ledge/src/daemon/brain/session.ts` (`checkRelief`)
- Modify : `packages/ledge/src/daemon/server.ts` (`measure` appelle `brain.checkRelief` pour une session `brain: true`, à côté de la relève des sièges ; une minuterie d'une minute vérifie le jour)
- Modify : `packages/ledge/src/daemon/handover.ts` (`HandoverDeps.launch` reçoit `brain?: true`, et la relève garde `brain: true` ; son prompt est suivi de `brainInstructions`)
- Test : `packages/ledge/test/brain-relief.test.ts`

**Interfaces :**
- Produces : `Brain.checkRelief(o: { context?: Session['context']; today: string; idle: boolean }): 'context' | 'day' | null` (déclenche `handovers.start(id, { auto: true })`), et `BRAIN_CONTEXT_RELIEF = 0.7`.

Règles :
- **Relève de contexte** : quand `context.used / context.window ≥ 0.7`.
- **Relève de jour** : quand `settings.day !== today` et que la session est libre (`idle`). `day` est réécrit au lancement de la relève.
- Pas de relève pendant une relève (`handover.state` vaut `briefing` ou `launching`).
- Le bilan de la relève sert de « résumé de la veille ». La relève reçoit ensuite les instructions à jour, mémoire comprise.
- Une décision retenue pour la fin d'une grâce (tâche 7) survit à la relève : elle est tenue par le daemon, pas par la session.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('70 % context starts a relief', () => { expect(brain.checkRelief({ context: { used: 140_000, window: 200_000 }, today, idle: true })).toBe('context'); });
test('a new day starts a relief once idle', () => { /* idle false → null ; idle true → 'day' ; puis plus rien le même jour */ });
test('no relief while one runs', () => { /* … */ });
test('the relief keeps brain: true and gets the instructions', async () => { /* launch reçu avec brain: true, prompt contenant 'Le mandat de Ledge' */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-relief handover` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): brain relief at 70 % and every day`

---

### Task 11 : Revenir dessus

**Files :**
- Create : `packages/ledge/src/daemon/brain/revisit.ts`
- Modify : `packages/ledge/src/daemon/openrig/answer.ts` (`Answers.correct(id, answers): Promise<AnswerResult>` : une ligne de réponse « Correction de Ledge : … », sans `approve`, puisque la ligne humaine est déjà fermée)
- Modify : `packages/ledge/src/daemon/server.ts` (cas `decision.revisit`)
- Test : `packages/ledge/test/brain-revisit.test.ts`

**Interfaces :**
- Consumes : lot 2, `bridge.replyClaimed(machine, replyRowId): Promise<boolean>` (état de la ligne de réponse par `GET /api/queue/list`), à ajouter au pont s'il manque ; et `replyRows` (lot 4).
- Produces : `export function createRevisit(d: { memory; escalations; answers; thread; inbox; brainOn; bridge }): { revisit(decisionId: string, text?: string): Promise<{ ok: boolean; reason?: string }> };`

Comportement :
- **Ligne de réponse non réclamée** :
  - l'escalade reçoit `correcting: decisionId` et revient `pending` ; sa carte réapparaît dans le fil, avec un nouvel élément `escalation` ;
  - la réponse suivante passe par `answers.correct`, qui garde la règle « la première gagne » sur la correction ;
  - puis `memory.markRevisited(decisionId, newDecisionId)` ;
  - avec `text`, celui-ci part tel quel comme corps de correction, sans repasser par la carte.
- **Ligne réclamée** (le siège a agi) :
  - cerveau vivant : `inbox.push({ kind: 'revisit', claimed: true, text })`. Le cerveau répond par `ledge brain say`, avec ce que défaire implique, puis `propose` ou `send` ; il n'envoie rien sans accord ;
  - sans cerveau : la bulle « <siège> a déjà agi sur cette décision. Écris-lui avec @<siège> pour la défaire. ».
- Une décision `by: 'user'` peut aussi être revue, par le même chemin.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('unclaimed: the card comes back and the correction is a new reply row', async () => { /* … correcting set ; answer → appel 'cli:queue create' summary commence par 'Correction de Ledge' ; pas d'approve */ });
test('claimed with the brain on: the brain is asked to explain', async () => { /* inbox revisit claimed true */ });
test('claimed without brain: Ledge says to write to the seat', async () => { /* … */ });
test('two corrections at once: one wins', async () => { /* already_answered */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-revisit` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): revisit a decision, correction or conversation`

---

### Task 12 : mandat, règles et décisions servis aux clients

**Files :**
- Modify : `packages/ledge/src/daemon/server.ts`
- Test : `packages/ledge/test/brain-server.test.ts`

**Interfaces :**
- Produces :
  - **À la connexion** : `mandate { text, path }`, `rules { items }`, `decisions { items }` (les 200 dernières), `brain.status`. Puis à chaque `memory.onChange` ou écriture du mandat.
  - **`mandate.update { rid, text }`** : écrit `mandat.md` et répond `rig.result`. Un texte illisible est accepté, avec un avertissement en `reason` (« le mandat illisible fait tout remonter à toi »).
  - **`rule.set { rid, id, status }`** : `memory.setRule`.
  - **`category.escalate { rid, category }`** : `escalateCategory` sur `mandat.md`, puis `brain.inbox.push({ kind: 'state', text: 'L\'utilisateur se fait remonter <catégorie> désormais.' })`. Une catégorie déjà côté utilisateur répond `ok`, sans rien changer.
  - **`brain.set`** : déjà fait à la tâche 4.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('a new client gets mandate, rules, decisions and brain status', async () => { /* … */ });
test('category.escalate moves the category and broadcasts the mandate', async () => { /* … */ });
test('rule.set active then the brain sees it at next relief', async () => { /* brainInstructions contient la règle */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- brain-server` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** `mandate.update`, `rule.set` et `category.escalate` sont des actions de l'utilisateur. Le relais mobile les laisse passer sans clé d'accès, sauf `mandate.update`, qui exige la clé.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): serve mandate, rules and decisions`

---

### Task 13 : l'onglet Mandat de Desktop

**Files :**
- Modify : `packages/fleet/src/store.ts` (`mandate`, `rules`, `decisions`, `brain`)
- Create : `apps/desktop/src/chat/mandate/MandateTab.tsx`, `CategoryList.tsx`, `CategoryDetail.tsx`, `Memories.tsx`, `model.ts`
- Modify : `apps/desktop/src/chat/LedgeHome.tsx` (Mandat remplace son `HomePlaceholder`)
- Modify : `apps/desktop/src/chat/LedgeRail.tsx` (« Tranché aujourd'hui » se remplit, avec « Revenir » ; « Voir » pour un tranché de l'operator, qui ouvre la décision dans Souvenirs)
- Modify : le rendu des sessions (Projets, Atelier) : une session `brain: true` n'y figure pas
- Modify : i18n fr/en
- Test : `apps/desktop/test/mandate-tab.test.tsx`, `apps/desktop/test/mandate-model.test.ts`

**Interfaces :**
- Produces :
```ts
// model.ts (pur)
export function categoryStats(decisions: readonly LedgeDecision[], now: string): Record<MandateCategory, { week: number; pending: number }>;
export function decisionsToday(decisions: readonly LedgeDecision[], today: string, by?: 'ledge' | 'user'): LedgeDecision[];
export function filterMemories(decisions: readonly LedgeDecision[], f: { by?: 'ledge' | 'user'; category?: MandateCategory; rig?: string }): LedgeDecision[];
export function ruleSource(rule: LedgeRule, decisions: readonly LedgeDecision[]): string;   // « force-push refusé », « ta réponse à orch-lead », « ta consigne », « tu as tranché deux fois pareil »
export function MandateTab(p: { client: DaemonClient; view: View }): JSX.Element;
```

D'après `p-ledge-mandat.png`, la sous-barre porte les sous-onglets « Ce que Ledge tranche » et « Souvenirs · n », puis « Mandat lu dans ~/.ledge/mandat.md ».

**Sous-onglet « Ce que Ledge tranche » :**
- **Colonne de gauche** :
  - « LEDGE TRANCHE SEUL », puis les catégories de `parseMandate(text).self`, chacune avec ses étiquettes (pastilles mono) et son compte de la semaine (« 6 cette semaine » pour la sélectionnée, le nombre seul pour les autres) ;
  - « TE REVIENT TOUJOURS », puis les autres catégories, avec « n en attente » ou « — » ;
  - la première catégorie est sélectionnée.
- **Colonne de droite** :
  - le titre de la catégorie, puis « Ledge tranche seul · n décisions cette semaine · mandat » ;
  - « Me le remonter désormais », seulement pour une catégorie de `self`, qui envoie `category.escalate` ;
  - **« Règles retenues »**, en tableau à quatre colonnes : « Règle », « Depuis » (jj/mm, ou « proposée »), « D'où elle vient », « Appliquée » (« n fois »). Une règle proposée est en bleu, avec « à valider », qui ouvre un menu « Valider » / « Rejeter » et envoie `rule.set`. Sous le tableau, la phrase « bleu : … » ;
  - **« Dernières décisions »** : les 5 dernières de la catégorie, avec l'heure (ou « hier »), `from@rig` et le résumé, « règle du jj/mm », et « Revenir dessus » (`decision.revisit`) ;
  - **l'encadré des chemins** : « Mandat », `~/.ledge/mandat.md` et « Ouvrir » (opener Tauri existant), puis « Souvenirs », `~/.ledge/memoire/` et « n règles, n décisions » ;
  - la note de pied (Global Constraints).

**Sous-onglet « Souvenirs » :**
- toutes les règles ;
- l'historique complet des décisions, avec les filtres « Ledge / toi », catégorie et rig, et « Revenir dessus » sur chaque ligne.

**L'onglet Mandat n'active jamais le cerveau.** L'activation passe uniquement par la proposition `BrainOffer` (tâche 14) ou par Réglages › Ledge (spec §5.1, corrigée le 2026-10-30).

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('categoryStats counts this week and pending', () => { /* … */ });
test('the left column follows the mandate file', () => { /* mandate où git est remonté → git sous TE REVIENT TOUJOURS */ });
test('« Me le remonter désormais » sends category.escalate and is absent for design', async () => { /* … */ });
test('a proposed rule is blue with « à valider », validating sends rule.set active', async () => { /* … */ });
test('« Revenir dessus » sends decision.revisit', async () => { /* … */ });
test('Souvenirs filters by who, category and rig', async () => { /* … */ });
test('the brain session is not listed in Projets', () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/desktop test -- mandate` ; Expected : FAIL.
- [ ] **Step 3 : implémenter**, dans le design system Lyssaën (jetons existants) ; les libellés de catégorie viennent de `MANDATE_CATEGORY_LABEL`, et les étiquettes de `MANDATE_CATEGORY_TAGS`.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(desktop): Mandat tab, what Ledge decides and memories`

---

### Task 14 : Réglages › Ledge, et la proposition d'activation

**Files :**
- Modify : `apps/desktop/src/nav/state.ts` (`SectionId` gagne `'ledge'`, placé après `'general'`)
- Create : `apps/desktop/src/settings/Ledge.tsx`
- Modify : `apps/desktop/src/settings/SettingsPage.tsx`
- Create : `apps/desktop/src/chat/BrainOffer.tsx`, rendu en tête de la Conversation
- Modify : i18n fr/en
- Test : `apps/desktop/test/settings-ledge.test.tsx`, `apps/desktop/test/brain-offer.test.tsx`

**Interfaces :**
- Produces : `Ledge(p: { ctx: SettingsContext })` et `BrainOffer(p: { client: DaemonClient; view: View })`.

**Réglages › Ledge :**
- « Outil », un sélecteur Claude Code / Codex / Cursor Agent / OMP qui envoie `brain.set { enabled, tool }`. Le changement prend effet à la prochaine relève ou au prochain démarrage, et le dit.
- « Ledge pense en continu », un interrupteur qui envoie `brain.set { enabled }`.
- Une ligne d'état d'après `brain.status` : « En marche · 34 % de contexte », « Démarre… », « Arrêté », ou « En panne : <reason> · Redémarrer ».

**`BrainOffer`** :
- Il s'affiche une seule fois, à la première ouverture de l'écran Ledge, si `daemon.openrig` est vrai et `brain.enabled === null`.
- Son texte : « Je peux penser en continu : je lis les escalades des rigs, je tranche ce que mon mandat permet après une minute, et je te passe le reste. »
- « Activer » envoie `brain.set { enabled: true, first: true }`. « Plus tard » envoie `brain.set { enabled: false }`, et le choix est mémorisé par le daemon.

**La bulle « Ledge est arrêté · Démarrer »** (tâche 9) reçoit son bouton dans `ThreadBubbles`, par une prop `onStartBrain`.

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('Réglages › Ledge toggles the brain and picks the tool', async () => { /* … brain.set { enabled: true, tool: 'codex' } */ });
test('a down brain shows its reason and « Redémarrer »', () => { /* … */ });
test('the offer shows once with OpenRig and an unasked brain', () => { /* enabled null + openrig → visible ; enabled false → absent ; sans openrig → absent */ });
test('« Plus tard » sends enabled false', async () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/desktop test -- settings-ledge brain-offer` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(desktop): Réglages › Ledge and the brain offer`

---

### Task 15 : e2e Desktop du cerveau et du mandat

**Files :**
- Modify : `apps/desktop/e2e/daemon.ts`. On ajoute `extras.brain?: { status: BrainStatus; mandate?: string; rules?: LedgeRule[]; decisions?: LedgeDecision[] }`. Le faux daemon répond à `brain.set` en diffusant `brain.status`, à `category.escalate` en déplaçant la ligne dans le texte du mandat, à `rule.set`, et à `decision.revisit` en ajoutant l'élément `escalation` avec `correcting`.
- Create : `apps/desktop/e2e/mandate.spec.ts`

- [ ] **Step 1 : écrire les tests e2e qui échouent**
  - `the Mandat tab matches the mockup` : « Git et branches » est sélectionné, « Merge, jamais de rebase sur une branche partagée » apparaît sous « Règles retenues », et la règle proposée porte « à valider ».
  - `escalating git moves it to TE REVIENT TOUJOURS`.
  - `a grace escalation shows « Ledge s'en occupe… » and the user can still answer`.
  - `Tranché aujourd'hui lists Ledge's decision and « Revenir » brings the card back`.
  - `the offer activates the brain`.
  - `screenshots` : ajouter l'onglet Mandat à `screenshots.spec.ts`, comparé à la main avec `p-ledge-mandat.png`.
- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/desktop e2e -- mandate` ; Expected : FAIL.
- [ ] **Step 3 : compléter le faux daemon** jusqu'au vert.
- [ ] **Step 4 : relancer toute la suite e2e** — Expected : PASS.
- [ ] **Step 5 : commit** `test(desktop): e2e of the brain, grace and Mandat`

---

## Fin du lot

- [ ] `pnpm test && pnpm typecheck && pnpm --filter @ledge/desktop e2e && pnpm --filter @ledge/overlay e2e`, tout vert.
- [ ] Revue de la branche entière contre les Review Focus 1 à 5 (et le n° 2 du plan maître) : chaque ligne a son test, et il passe.
- [ ] Parcours réel, **seulement avec l'accord de l'utilisateur**, qui démarre un vrai cerveau Claude sur sa machine :
  1. activer ;
  2. vérifier que `rig ps`, tapé dans `ledge-brain`, est refusé ;
  3. avec le faux OpenRig de test, ou le rig jetable du lot 0, pousser une escalade `git` et voir « Ledge s'en occupe… », puis le tranché au bout de 60 s ;
  4. « Revenir dessus » ;
  5. « Me le remonter désormais » sur Git.
