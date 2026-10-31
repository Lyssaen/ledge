# Ledge mobile — lot 5 : réponses étendues — plan d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUIS : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour réaliser ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** permettre la réponse libre à une question depuis le téléphone, outil par outil, seulement quand l'adaptateur sait la donner, prouvé par un dialogue capturé. La masquer partout ailleurs.

**Architecture :** chaque adaptateur déclare ses `capabilities`. L'instantané distant les transmet par outil. `session.reply { other: true }` n'est accepté que si l'outil en est capable, sur une question identifiée et versionnée. Le plan de touches part de la capture réelle du dialogue (`test/fixtures/panes`). L'overlay garde sa règle actuelle (README, « Free-text replies to a question are refused »).

**Pile technique :** voir le [plan directeur](2026-10-14-ledge-mobile.md). Aucune nouvelle dépendance.

**Spec :** §2 (Une question : « option de réponse libre pour illustrer un adaptateur capable »), §8, §9.5, §11 (Adaptateurs).

**Prérequis :** lot 2 terminé (formulaire de question, opérations, `session.reply` identifié).

## Global Constraints

Celles du [plan directeur](2026-10-14-ledge-mobile.md#global-constraints), plus :
- « Chaque capacité réelle demande son plan de touches et un dialogue capturé dans `test/fixtures/panes`. »
- « Tant qu'un adaptateur ne sait pas donner une réponse, le téléphone la masque pour cet outil. »
- « Ne plus demander » et « Refuser avec une consigne » ne sont pas réalisés : l'utilisateur les a jugés non nécessaires le 2026-10-14 (Q3).

## Review Focus

En plus du [plan directeur](2026-10-14-ledge-mobile.md#review-focus) :
- **Texte libre qui contient un retour à la ligne ou commence par un chiffre** (« 2 versions, la seconde »), que le dialogue pourrait lire comme un choix d'option : le texte n'est tapé qu'une fois le champ libre visible. → Tâche 2, test `a free answer starting with a digit is typed only once the free field is on screen`.

---

### Task 1: Capacités des adaptateurs

**Fichiers :**
- Créer : `packages/protocol/src/capabilities.ts`
- Modifier : `packages/protocol/src/messages.ts` (`snapshot` + `capabilities?: Record<Tool, Capabilities>` ; `session.reply` + `other?: boolean`), `packages/ledge/src/adapters/types.ts` (`capabilities: Capabilities` obligatoire), `packages/ledge/src/adapters/{claude,codex,cursor}.ts` (`{ freeTextAnswer: false }`), `packages/ledge/src/daemon/remote/project.ts` (ajoute `capabilities` à l'instantané distant)
- Test : `packages/ledge/test/capabilities.test.ts`

**Interfaces :**
- Produit : `CapabilitiesSchema = z.object({ freeTextAnswer: z.boolean() })` ; `NO_CAPABILITIES: Capabilities = { freeTextAnswer: false }` ; `capabilitiesByTool(): Record<Tool, Capabilities>` (daemon, lu depuis `adapterFor`).
- L'instantané local ne change pas.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('the remote snapshot tells what each tool can answer', () => { /* toRemote(snapshot).capabilities.claude.freeTextAnswer === false */ });
it('the local snapshot has no capabilities field', () => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/capabilities.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm -r typecheck && pnpm --filter @paradow/ledge test`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/protocol packages/ledge
git commit -m "feat(adapters): declare what each tool can answer"
```

### Task 2: Réponse libre « Other » pour Claude Code

**Fichiers :**
- Créer : `packages/ledge/test/fixtures/panes/claude2-question-other-field.txt` (capture réelle)
- Modifier : `packages/ledge/src/adapters/claude.ts` (`otherPlan` ; `capabilities.freeTextAnswer: true` seulement à la fin de la tâche), `packages/ledge/src/adapters/types.ts` (`otherPlan?(text: string, pending: Pending, pane: string): KeyPlan`), `packages/ledge/src/daemon/decisions.ts` (`runAnswer` accepte `other: true`)
- Test : `packages/ledge/test/adapters-claude.test.ts`, `packages/ledge/test/decisions.test.ts`

**Interfaces :**
- Produit : `otherPlan(text, pending, pane): KeyPlan`. Il sélectionne l'entrée « Other » (touche relevée sur la capture), attend par une étape `until` que le champ libre soit visible, tape le texte, puis Entrée. Retours à la ligne refusés en amont.
- Règle du daemon : `other: true` exige `kind === 'question'`, `pendingId`/`pendingVersion` à jour, `adapterFor(tool).capabilities.freeTextAnswer`, un `text` nettoyé non vide d'au plus 2 000 caractères, sans saut de ligne. Sinon `rejected/unsupported` (capacité absente) ou `rejected/invalid` (texte). La vérification de disparition reste celle de `promptGone` : une question suivante n'est pas un échec.

- [ ] **Étape 1 : capturer le dialogue réel**

Dans WSL, `ledge claude` dans un dépôt de test, puis demander une question `AskUserQuestion` à options. Sélectionner « Other » au clavier, puis exécuter `tmux -L ledge capture-pane -p -t ledge-<id> -S -60`. Enregistrer la sortie dans la fixture et noter la version de Claude Code dans le message de commit.
Attendu : la capture montre le champ de saisie libre.

- [ ] **Étape 2 : écrire les tests qui échouent**

```ts
it('Other: picks the entry, waits for the free field, types the text, then Enter', () => { /* steps against claude2-question.txt then claude2-question-other-field.txt */ });
it('a free answer starting with a digit is typed only once the free field is on screen', () => { /* until step precedes the text step */ });
it('a remote free answer is applied for Claude Code and unsupported for Codex and Cursor Agent', async () => { /* … */ });
it('an empty or multi-line free answer is invalid', async () => { /* … */ });
it('the overlay rule is unchanged: a local free-text reply to a question is still refused', async () => { /* FREE_TEXT error */ });
```

- [ ] **Étape 3 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/adapters-claude.test.ts test/decisions.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 4 : implémenter, puis passer `freeTextAnswer` à `true` pour Claude Code**

- [ ] **Étape 5 : vérifier, y compris sur un vrai Claude Code**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS. Ensuite, sur une vraie session, une réponse libre envoyée par un client distant de test (le CLI avec un jeton appairé, ou le téléphone) est reçue mot pour mot par l'agent.

- [ ] **Étape 6 : commit**

```bash
git add packages/ledge
git commit -m "feat(adapters): free-text answer to a Claude Code question (Other)"
```

### Task 3: Vérification pour Codex et Cursor Agent

**Fichiers :**
- Créer, selon le résultat : `packages/ledge/test/fixtures/panes/codex-question-free.txt`, `packages/ledge/test/fixtures/panes/cursor-question-free.txt`
- Modifier, selon le résultat : `packages/ledge/src/adapters/codex.ts`, `packages/ledge/src/adapters/cursor.ts`, `README.md` (« Status and known limits »)
- Test : `packages/ledge/test/adapters-codex.test.ts`, `packages/ledge/test/adapters-cursor.test.ts`

Pour chaque outil, une décision vérifiable (H11) :

- [ ] **Étape 1 : capturer** une question (`request_user_input` pour Codex, AskQuestion pour Cursor Agent) et chercher au clavier une saisie libre. Enregistrer la capture.
- [ ] **Étape 2 : décider**
  - Si la capture montre un champ libre atteignable au clavier : écrire `otherPlan` avec les tests de la tâche 2 adaptés à l'outil, puis passer `freeTextAnswer: true`.
  - Sinon : laisser `freeTextAnswer: false` et ajouter au README la ligne « <outil> : réponse libre non disponible depuis Ledge (vérifié sur <version>) ».
- [ ] **Étape 3 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS.

- [ ] **Étape 4 : commit**

```bash
git add packages/ledge README.md
git commit -m "feat(adapters): free-text answer support checked for Codex and Cursor Agent"
```

### Task 4: « Autre réponse » sur le téléphone

Référence visuelle : la question de `Request.html?id=theme-nova-01` (option « Autre réponse » et champ « Votre réponse à <Bot> »).

**Fichiers :**
- Modifier : `apps/mobile/src/screens/QuestionForm.tsx`, `apps/mobile/src/state/store.ts` (garde `capabilities` de l'instantané)
- Test : `apps/mobile/e2e/question.spec.ts`

**Interfaces :**
- Consomme : `snapshot.capabilities`.
- « Autre réponse » n'apparaît que si `capabilities[tool].freeTextAnswer`. La choisir montre un champ « Votre réponse à <Bot> » (placeholder « Précisez votre choix… »). « Envoyer ma réponse » reste désactivé tant que le texte nettoyé est vide. L'envoi part en `session.reply { other: true, text, pendingId, pendingVersion, operationId }`.

- [ ] **Étape 1 : écrire les tests e2e qui échouent**

```ts
test('Autre réponse is hidden for a tool that cannot answer freely', async ({ page }) => { /* codex question */ });
test('Autre réponse needs a non-empty text and sends other: true', async ({ page }) => { /* claude question */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec playwright test e2e/question.spec.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): free answer to a question when the tool supports it"
```

### Task 5: Documentation et validation du lot 5

**Fichiers :**
- Modifier : `README.md` (Protocol : `other` ; Status : réponses libres par outil), `docs/mobile.md`, `docs/spikes/2026-10-14-ledge-mobile-feasibility.md` (R10)

- [ ] **Étape 1 : rédiger la documentation**

- [ ] **Étape 2 : passer toute la suite**

Exécuter : `pnpm -r typecheck && pnpm -r test && pnpm --filter overlay test:e2e && pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 3 : valider sur l'iPhone (R10 du plan directeur)**

- [ ] **Étape 4 : commit**

```bash
git add README.md docs/mobile.md docs/spikes/2026-10-14-ledge-mobile-feasibility.md
git commit -m "docs(mobile): free answers by tool"
```
