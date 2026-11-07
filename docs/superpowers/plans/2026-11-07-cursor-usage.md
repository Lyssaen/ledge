# Limites d'usage de Cursor Agent, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ledge lit les limites d'usage de Cursor Agent et les affiche comme celles de Claude Code et Codex (#222) : la puce du pied de Desktop et de la barre d'état de l'IDE, le détail au clic, « À toi », le TUI et le téléphone. Les puces de tous les harnais prennent les vrais logos des éditeurs.

**Architecture :**
- **Daemon.** Un lecteur `daemon/usage/cursor.ts` lit le jeton de Cursor Agent (`auth.json`), en lecture seule. Il appelle la RPC Connect `GetCurrentPeriodUsage` sur `api2.cursor.sh`, la même que le `/usage` de Cursor Agent, toutes les 5 min au plus. `service.ts` l'ajoute comme troisième harnais, avec les statuts existants.
- **Protocole.** Il gagne le harnais `cursor`, la fenêtre `month` (le total d'un cycle mensuel) et la fenêtre `pool` (une réserve : `cursor` ou `other`). La période vient de la longueur du cycle : moins de 10 jours, c'est `seven_day`.
- **Fronts.** `@ledge/fleet` dit quelles fenêtres montrer. Desktop, le TUI et le téléphone les nomment. Une réponse sans le détail attendu donne `ok` sans fenêtre, que les fronts affichent « limite non lue ».

**Tech Stack:** TypeScript, zod, Node 22 (`node:https`), React 19 (Desktop, téléphone), Ink (TUI), vitest + Testing Library, Playwright.

**Spec :**
- La maquette [`docs/mockups/ledge-harness-usage.html`](../../mockups/ledge-harness-usage.html), vue `?v=cursor` (v3, validée le 2026-11-07, artifact `MbvYcHCPgfwzitmWGR4ugG`). Elle fait foi pour l'aspect et les textes : `CT` (textes FR/EN), `cursorChip()`, `cursorPop()`, `cursorTuiSegs()`, `cursorPhoneLimits()`, `cursorYours()`, `MARK`/`logo()`, et les notes `NOTES.fr.cursor`.
- L'étude de faisabilité, reportée dans « Source Cursor » ci-dessous (le fichier de travail `docs/cursor-usage-study.md` est supprimé avant la PR).
- Le design des limites : [`docs/superpowers/specs/2026-11-05-harness-usage-design.md`](../specs/2026-11-05-harness-usage-design.md).

## Source Cursor (extrait de l'étude)

- **Jeton** : `$CURSOR_CONFIG_DIR/auth.json`, sinon `~/.config/cursor/auth.json` (0600). Le fichier contient `{ accessToken, refreshToken }`. `accessToken` est un JWT de session (`exp`, `sub = auth0|…`) qui dure environ 5 jours. Cursor Agent le renouvelle lui-même ; Ledge ne fait que le lire.
- **Appel** : `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`, avec les en-têtes `Authorization: Bearer <accessToken>`, `Content-Type: application/json` et `Connect-Protocol-Version: 1`, et le corps `{}`.
- **Réponse 200 (offre Pro legacy)** : `{ billingCycleStart: "<ms>", billingCycleEnd: "<ms>", planUsage: { totalPercentUsed, autoPercentUsed, apiPercentUsed, totalSpend, includedSpend, limit, … }, spendLimitUsage, … }`. Les dates sont des chaînes en millisecondes. `autoPercentUsed` est la réserve « Modèles Cursor », `apiPercentUsed` la réserve « Autres modèles ».
- **401** : `{ code: "unauthenticated" }` (jeton échu ou invalide).
- **Nouvelles offres (X Subscription)** : une seule réserve hebdomadaire. `planUsage` peut manquer, ou ne porter que `totalPercentUsed`.

## Global Constraints

- Branche `feat/cursor-usage`, partie de `origin/main` 71646d13 (0.50.0). Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur. Rien n'est poussé, ouvert ni fusionné sans lui.
- **Le jeton de Cursor se lit, il ne se rafraîchit ni ne se réécrit jamais.** Il ne s'affiche ni ne s'écrit nulle part, journaux compris : un journal ne dit que le statut HTTP ou la raison. Un jeton échu (`exp` passé) ou un 401 donne `expired`, et le premier cas ne fait aucun appel. Le seul appel est la lecture `GetCurrentPeriodUsage`, toutes les **5 min** au plus. Un 429 est respecté, avec Retry-After, comme pour Claude.
- On affiche les pourcentages que Cursor renvoie, arrondis. **On ne les recalcule jamais depuis les montants.** Si `planUsage.totalPercentUsed` manque, la limite est « non lue ».
- Ni dollars, ni nom d'offre, ni dépassement payant, dans le protocole comme à l'écran.
- `ledge-daemon` n'est jamais redémarré sans l'accord de l'utilisateur. Le daemon de l'utilisateur vient du paquet npm global : le nouveau n'arrive qu'avec une release.
- Ne pas toucher `apps/desktop/src/launch/*` (lot 4 de l'IDE, session Otto) ni `IdeStatusBar` (correctif `fix/ide-status-limits` en attente).
- Textes en français et en anglais, ceux de `CT` dans la maquette. Tout état absent de la maquette se demande à `design-ux`, et se note dans `docs/cursor-usage-questions.md`, à supprimer avant la PR.
- Node 22 (`eval "$(fnm env)"; fnm use 22`). Tests : `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/fleet test`, `pnpm --filter desktop test`, `pnpm --filter desktop typecheck`, `pnpm --filter desktop e2e`, `pnpm --filter @ledge/mobile test`, et `typecheck` dans chaque paquet touché.
- Échecs déjà présents sur main : e2e `island.spec.ts:166`, `proposals.spec.ts:36`, `daemon-update.spec.ts:8` ; vitest « reconnect asks Nova's thread again » ; mobile `link.test.ts` « relay out of reach ».
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Choix de l'utilisateur (2026-11-07, maquette v3)

1. La puce montre le **total** (Mois, ou Semaine) avec sa date de remise. Une réserve ne s'ajoute qu'**au-delà du seuil**.
2. Une **alerte** pour le total et pour chaque réserve, avec le même seuil.
3. Dans le TUI, la marque de Cursor est **◇**, sans couleur.
4. Les valeurs de Cursor sont **« Anciennes » après 15 min** (5 min pour Claude).
5. Les **vrais logos** des éditeurs remplacent les silhouettes de mascotte dans les puces et sur le téléphone : l'étincelle de Claude, le logo OpenAI pour Codex, le cube de Cursor (`apps/desktop/src/ide/ProviderLogo.tsx`).

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | La période (mois ou semaine) vient de la longueur du cycle, `billingCycleEnd − billingCycleStart` : moins de 10 jours, c'est `seven_day`. Ledge n'appelle pas `GetPlanInfo` : une seule RPC. | Un appel `GetPlanInfo` toutes les 10 min et la lecture de `includedUsagePeriod` : environ 40 lignes et deux tests. |
| R2 | `CURSOR_API_KEY` n'est pas lu, seul `auth.json` l'est : l'étude n'a pas vérifié qu'une clé d'API passe sur `api2.cursor.sh`. | Une ligne de plus dans `readCursorToken` et un test, après vérification. |
| R3 | « Limite non lue » = statut `ok` sans fenêtre. Pas de nouveau statut. | Un statut `unread` dans le protocole, et une branche dans chaque front. |
| R4 | Les nouveaux `harness`/`kind` sont refusés par un front plus ancien : un Desktop ou un téléphone pas à jour ignore tout le `usage.state` d'un daemon nouveau, Claude compris, jusqu'à sa mise à jour. Desktop et daemon sortent dans la même release. Ce lot rend les fronts tolérants : ils écartent un harnais ou une fenêtre qu'ils ne connaissent pas, ce qui évitera le problème au prochain ajout. | Le daemon n'envoie `cursor` qu'aux fronts qui l'annoncent (un drapeau dans `hello`) : un aller-retour de protocole en plus. |
| R5 | Cursor n'est lu que toutes les 5 min : pas de lecture supplémentaire à la fin d'un tour Cursor. | Une lecture débouncée, appelée depuis le traitement des tours dans `server.ts`. |
| R6 | Le compte est `sha256("ledge-usage:cursor:" + sub du JWT)`, 12 hex : le même sur deux machines connectées au même compte. On ne lit pas `cli-config.json`. | Lire `authInfo.userId` dans `~/.cursor/cli-config.json`. |
| R7 | Le détail de Cursor dans les Réglages du TUI liste toutes ses fenêtres. Sa ligne de pied ne montre que le total et les réserves au-delà du seuil, comme la puce de Desktop. | Une ligne de libellé. |
| R8 | Une réponse 200 qu'on ne peut pas lire comme du JSON donne `unreachable`, comme la réponse vide de Claude. Une réponse en JSON sans `planUsage.totalPercentUsed` donne « limite non lue ». | Inverser les deux branches. |

## Review Focus

1. **Un `auth.json` vide, illisible, sans `accessToken`, ou dont le jeton n'est pas un JWT.** Les trois premiers cas : Cursor n'est pas listé du tout. Un jeton qui n'est pas un JWT, donc sans `exp` lisible, est quand même envoyé : c'est l'API qui tranche.
2. **Des pourcentages hors bornes ou de mauvais type** (`-3`, `1234.6`, `"56"`, `NaN`). Ils sont bornés de 0 à 1000 et arrondis. Une réserve qui n'est pas un nombre est omise, sans rien casser d'autre.
3. **Le changement de cycle**, quand `billingCycleEnd` est déjà passé au moment de la lecture. La fenêtre garde ce `resetsAt`. Les alertes du cycle précédent tombent (`resetOfId`). Les fronts n'affichent pas de date passée comme si elle était à venir : `resetShort` d'une date passée donne l'heure du jour ou le jour, sans crash.
4. **Deux machines connectées au même compte Cursor.** Elles forment un seul groupe, et la lecture la plus récente parle pour lui (`usageGroups`).
5. **Les trois harnais à la fois dans une fenêtre étroite.** Les dates de remise tombent (`two`), rien ne déborde du pied, et chaque puce garde son bouton pour le détail.

---

### Task 1 : Le protocole apprend Cursor, le mois et les réserves

**Files:** Modify `packages/protocol/src/usage.ts`, `packages/protocol/src/phone.ts` (si le schéma téléphone doit suivre la tolérance). Create `packages/protocol/test/usage.test.ts`.

**Interfaces — Produces :**
```ts
export const UsageHarnessSchema = z.enum(['claude', 'codex', 'cursor']);
// UsageWindowSchema
kind: z.enum(['five_hour', 'seven_day', 'model', 'month', 'pool']),
/** A pool of the included usage (`kind: 'pool'`): Cursor's own models (`cursor`) or the others at API prices (`other`). */
pool: z.enum(['cursor', 'other']).optional(),
// usageAlertId : la 4e partie devient `w.pool ?? w.model ?? '-'` (les ids de Claude et de Codex ne changent pas)
export const usageAlertId: (harness, account, w: Pick<UsageWindow, 'kind' | 'model' | 'pool' | 'resetsAt'>, level) => string;
```
- La tolérance (R4) : `UsageStateMessageSchema.harnesses` et `UsageAlertSchema`, côté parse, écartent un élément dont le `harness` est inconnu. Un harnais garde ses fenêtres connues et écarte les autres. Utiliser `z.preprocess` sur le tableau brut, avec les listes des enums. Les types inférés ne changent pas. Même règle pour `harnesses` de `usage.state` dans `phone.ts`.
- Les docstrings (`UsageStatusSchema`, `HarnessUsageSchema`) disent Cursor : lu toutes les 5 min, `stale` après 15 min, listé seulement quand `auth.json` existe, et `ok` sans fenêtre = « limite non lue ».
- [ ] **Tests qui échouent** (`usage.test.ts`) :
  - Une fenêtre `{ kind: 'month', pct: 12, resetsAt }` et une `{ kind: 'pool', pool: 'other', pct: 56, resetsAt }` passent le schéma. `pool: 'x'` est refusé.
  - `usageAlertId('cursor', 'a1b2c3d4e5f6', { kind: 'pool', pool: 'other', resetsAt: R }, 'full')` vaut `'cursor|a1b2c3d4e5f6|pool|other|full|' + R`. L'id d'une fenêtre `model` de Claude ne change pas (`'claude|…|model|Opus|threshold|…'`).
  - `parseServerMessage` d'un `usage.state` qui porte un harnais `{ harness: 'gemini', … }` et une fenêtre `{ kind: 'day', … }` dans Claude : le message passe ; il n'y a plus que Claude, sans la fenêtre `day`. Même règle pour une alerte `harness: 'gemini'`.
- [ ] Implémenter, `pnpm --filter @ledge/protocol test` et `typecheck` PASS. Commit `feat(protocol): usage knows Cursor, the month and its pools; fronts drop a harness or window they do not know`.
- [ ] Prévenir Otto : `ledge send Otto "Protocole des limites figé sur feat/cursor-usage (<sha>) : harness 'cursor', fenêtres kind 'month' (total du cycle mensuel) et 'pool' (pool: 'cursor'|'other'), la semaine reste 'seven_day'. ok sans fenêtre = « limite non lue ». Pour ta modale : le total est la fenêtre month ou seven_day de Cursor."`

### Task 2 : Un POST HTTPS par le même chemin que le GET

**Files:** Modify `packages/ledge/src/daemon/usage/net.ts`. Test `packages/ledge/test/usage-net.test.ts`.

**Interfaces — Produces :**
```ts
export type HttpsPost = (url: string, headers: Record<string, string>, body: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<GetResult & { error?: string }>;
export const httpsPost: HttpsPost;
```
- `httpsGet` et `httpsPost` partagent un `send(method, …)` : même proxy (`proxyFor`, CONNECT), mêmes autorités, même borne de 1 Mo, même délai. Le POST envoie `Content-Length` et écrit le corps.
- [ ] **Test qui échoue :** sur le serveur HTTPS local du test existant, un `httpsPost` reçoit méthode `POST`, corps `{}`, `content-length: 2` et les en-têtes donnés. Par le proxy de test existant, il passe aussi par CONNECT. Les cas existants de `httpsGet` restent verts.
- [ ] Implémenter, PASS, commit `feat(daemon): usage can POST, through the same proxy and authorities as its GET`.

### Task 3 : Le lecteur Cursor

**Files:** Create `packages/ledge/src/daemon/usage/cursor.ts`. Test `packages/ledge/test/usage-cursor.test.ts`.

**Interfaces — Produces :**
```ts
export const CURSOR_USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
/** auth.json under $CURSOR_CONFIG_DIR, else ~/.config/cursor. null: absent or no accessToken; 'expired': the JWT's exp has passed. Read only. */
export function readCursorToken(home: string, env: NodeJS.ProcessEnv, now: number, read?: (p: string) => Promise<string>): Promise<{ token: string; account: string | null } | 'expired' | null>;
/** The answer as windows (R1, R8): [] when planUsage.totalPercentUsed is missing (« limite non lue »); null when the body is not an object. */
export function parseCursorUsage(body: unknown): UsageWindow[] | null;
```
- `account` : `sha256("ledge-usage:cursor:" + sub).hex.slice(0, 12)`, lu dans la charge du JWT (base64url), `null` si illisible (R6). Le jeton n'est jamais retourné ailleurs que dans `token`, et jamais journalisé.
- `parseCursorUsage` produit d'abord le total, puis `pool: 'cursor'` (`autoPercentUsed`) et `pool: 'other'` (`apiPercentUsed`) quand ce sont des nombres finis. Le total est de kind `month`, ou `seven_day` quand le cycle dure moins de 10 jours (R1). Les pourcentages sont arrondis et bornés de 0 à 1000. `resetsAt` = `billingCycleEnd` en ISO, ou `null` si ce n'est pas un nombre en ms.
- [ ] **Tests qui échouent :**
  - `readCursorToken` : un `auth.json` valide (JWT de test, `exp` dans 5 jours, `sub: 'auth0|u1'`) → `{ token, account: <12 hex> }`, le même account pour le même `sub`. `exp` passé → `'expired'`. Fichier absent, JSON invalide, `accessToken` vide → `null`. `CURSOR_CONFIG_DIR=/c` → lit `/c/auth.json`. Un jeton qui n'est pas un JWT → `{ token, account: null }` (Review Focus 1).
  - `parseCursorUsage` de la réponse de l'étude (cycle `2026-11-01T12:43Z` → `2026-12-01T12:43Z`, total 12.4, auto 8, api 56) → `[{ kind: 'month', pct: 12, resetsAt: '2026-12-01T12:43:00.000Z' }, { kind: 'pool', pool: 'cursor', pct: 8, … }, { kind: 'pool', pool: 'other', pct: 56, … }]`.
  - Un cycle de 7 jours, `totalPercentUsed` seul → `[{ kind: 'seven_day', pct, resetsAt }]`.
  - Pas de `planUsage`, ou `totalPercentUsed` absent alors que `includedSpend` et `limit` sont présents → `[]` (jamais recalculé). Un corps `"x"` → `null`.
  - Review Focus 2 : `totalPercentUsed: -3` → 0 ; `1234.6` → 1000 ; `apiPercentUsed: "56"` → la réserve `other` est omise, le reste est gardé.
- [ ] Implémenter, PASS, commit `feat(daemon): read Cursor Agent's token and its usage answer, read only`.

### Task 4 : Le service lit Cursor

**Files:** Modify `packages/ledge/src/daemon/usage/service.ts`. Test `packages/ledge/test/usage-service.test.ts` (nouveau `describe('the usage service: Cursor Agent')`).

**Interfaces — Consumes :** Tasks 2 et 3. **Produces :**
```ts
export const CURSOR_READ_EVERY_MS = 5 * 60_000;
export const CURSOR_STALE_MS = 15 * 60_000;
// UsageDeps
post?: HttpsPost;
```
- Une source Cursor à côté de Claude, avec son propre état : `listed` (un `auth.json` existe), `attempted`, `readAt`, `windows`, `failed`, `refused`, `localExpired`, `nextAt`, `backoff`, et un compte (un autre compte efface ses fenêtres, comme chez Claude). On peut en extraire le cœur commun dans une petite fonction si le fichier s'y prête, mais le comportement de Claude ne change pas.
- `tick()` lit Claude, puis Cursor. Une erreur de l'un n'empêche pas l'autre.
- Statuts : `expired` (`exp` passé, aucun appel, ou 401), `loading`, `unreachable` (réseau, 5xx, JSON illisible), `stale` après `CURSOR_STALE_MS`, `ok`. Si la lecture réussit mais que `parseCursorUsage` rend `[]` : `ok`, `readAt` mis à jour, `windows: []`.
- 429 : `backoff` qui double depuis `CURSOR_READ_EVERY_MS` jusqu'à `BACKOFF_MAX_MS`, ou le Retry-After s'il est plus long (jusqu'à `RETRY_AFTER_MAX_MS`), comme pour Claude.
- En-têtes : `Authorization: Bearer`, `Content-Type: application/json`, `Connect-Protocol-Version: 1`. Corps `'{}'`.
- Journaux : `usage: Cursor not read (HTTP 503)`, `usage: Cursor Agent session expired (401)`, `usage: Cursor rate-limited the read (429), next in N s`. Jamais le jeton ni le corps.
- L'ordre de `harnesses()` est claude, codex, cursor. Les alertes passent par la boucle existante : le total et chaque réserve (choix 2).
- [ ] **Tests qui échouent** (double `post`, `read` qui sert `/h/.config/cursor/auth.json`) :
  - Un POST vers `CURSOR_USAGE_URL` avec le jeton, `Connect-Protocol-Version: 1` et le corps `{}` → harnais `cursor` `ok`, son account, trois fenêtres.
  - Au plus un appel toutes les 5 min. `stale` à 15 min + 1 s sans lecture. Plus de fenêtre au-delà d'une heure.
  - `exp` passé → `expired`, sans fenêtre et sans aucun POST. 401 → `expired` ; la lecture suivante, réussie, revient à `ok`.
  - 429 avec `retry-after: 1800` → prochain appel 30 min plus tard.
  - Réponse sans `totalPercentUsed` → `ok`, `windows: []`. Corps `<html>` → `unreachable`.
  - `auth.json` absent → pas de harnais `cursor` (les tests Claude existants, sans `auth.json`, restent verts sans retouche).
  - Une réserve `other` à 100 % → une alerte `full` d'id `cursor|<acc>|pool|other|full|<reset>`. Un total à 81 % → une alerte `threshold`.
  - Jamais le jeton : on espionne `log` et le fichier `usage.json` ; aucun des deux ne contient la chaîne du jeton.
- [ ] Implémenter, `pnpm --filter @paradow/ledge test` et `typecheck` PASS. Commit `feat(daemon): the usage service reads Cursor Agent every 5 minutes, never refreshing its session`.

### Task 5 : Le modèle partagé des limites (`@ledge/fleet`)

**Files:** Modify `packages/fleet/src/usage.ts`, `packages/fleet/src/index.ts` (exports). Test `apps/desktop/test/usage-model.test.ts`.

**Interfaces — Produces :**
```ts
// HARNESS_ORDER : { claude: 0, codex: 1, cursor: 2 }
export function shownWindows(g: UsageGroup, threshold: number): {
  five?: UsageWindow; week?: UsageWindow; month?: UsageWindow;
  /** The pools (kind 'pool'), Cursor's first. */ pools: UsageWindow[];
  /** Models and pools past the threshold. */ hot: UsageWindow[];
  models: UsageWindow[];
};
/** ok, read, and nothing to show: « limite non lue ». */
export function isUnread(g: Pick<UsageGroup, 'status' | 'windows' | 'readAt'>): boolean;
/** A reset a week or more away is a date: `1 déc.` (short), `1 déc. 13:43` (long). Otherwise as today. */
export function resetShort(iso: string, now: number, lang: string): string;
export function resetLong(iso: string, now: number, lang: string): string;
export function resetIsDate(iso: string, now: number): boolean;
```
- La date est `toLocaleDateString(fr-FR | en-GB, { day: 'numeric', month: 'short' })`. L'anglais donne `1 Dec` : c'est l'ordre `en-GB` qu'utilise déjà Desktop, et la maquette, qui écrit `Dec 1`, s'aligne sur l'app.
- [ ] **Tests qui échouent :**
  - `usageGroups` : Claude, Codex et Cursor sont triés dans cet ordre. Deux machines connectées au même compte Cursor forment un seul groupe, dont les fenêtres sont celles de la lecture la plus récente (Review Focus 4).
  - `shownWindows` d'un Cursor mensuel (total 81, cursor 41, other 100, seuil 0.8) → `month` vaut 81, `pools` vaut [41, 100] et `hot` vaut [other 100]. Hebdomadaire → `week` seul.
  - `isUnread` : `ok`, `readAt` posé, `windows: []` → vrai ; `stale` avec `windows: []` → faux ; `loading` → faux.
  - Dates construites en heure locale, comme le test « times » existant : `now` = le 7 novembre à 10:00, la remise = le 1er décembre à 13:43 → `resetShort(…, 'fr')` vaut `'1 déc.'`, `resetLong` vaut `'1 déc. 13:43'`, `resetIsDate` vaut vrai ; en `'en'` → `'1 Dec'`. Un jour à moins de 7 jours → toujours le jour (`'lun.'`), et `resetIsDate` vaut faux.
  - Review Focus 3 : une date passée (hier) → `resetShort` rend le jour, sans exception.
- [ ] Implémenter, PASS (`@ledge/fleet` et `desktop test`), commit `feat(fleet): usage groups know Cursor, its month and pools, and dates past a week`.

### Task 6 : Desktop — vrais logos, puce, détail, « À toi »

**Files:** Create `packages/ui/src/logos/providers.ts` (export du chemin des marques). Modify `apps/desktop/src/ide/ProviderLogo.tsx` (lit ces chemins), `apps/desktop/src/usage/UsageFooter.tsx`, `apps/desktop/src/shell/sidebar/Attention.tsx`, `apps/desktop/src/App.tsx` (texte de la notification, l. ~210), `apps/desktop/src/i18n/fr.ts` et `en.ts` (`usage`), `apps/desktop/src/styles/shell.css`. Tests : create `apps/desktop/test/usage-footer.test.tsx` ; existants `test/ide/tab-label.test.tsx`, `test/ide/session-bar.test.tsx`.

**Interfaces — Consumes :** Task 5. **Produces :**
```ts
// packages/ui/src/logos/providers.ts — path data verbatim (@lobehub/icons-static-svg 1.102.0, MIT), viewBox 0 0 24 24
export const PROVIDER_MARKS: { anthropic: { d: string; fill: '#D97757' }; openai: { d: string; fill: 'currentColor' }; cursor: { d: string; fill: 'currentColor' } };
export const HARNESS_PROVIDER: Record<UsageHarness, 'anthropic' | 'openai' | 'cursor'>; // claude→anthropic, codex→openai, cursor→cursor
// UsageFooter.tsx : HarnessLogo({ harness, size }) dessine PROVIDER_MARKS[HARNESS_PROVIDER[harness]] (choix 5)
```
- **La puce** (`cursorChip()` de la maquette) : le logo ; « Mois » ou « Semaine » avec la jauge, le % et `↺ resetShort`, sans date quand il y a deux groupes ou plus (`two`) ; puis les réserves de `hot`, nommées « Cursor » ou « Autres » ; puis l'âge, s'il y en a un. `isUnread` → « limite non lue » souligné en pointillé : c'est un bouton qui ouvre le détail. Session expirée → `u.expired(name)` : le message nomme le harnais.
- **Le détail** (`cursorPop()`) :
  - **Mois** : « Total inclus · mois » avec `remise le 1 déc. 13:43 · dans 24 j` ; « Par réserve » ; une ligne par réserve, son libellé, son indice (« Composer, Grok, Auto » ou « Claude, GPT, Gemini… au prix de l'API ») et sa remise. Une réserve à 100 % → « atteinte · reprend le 1 déc. ».
  - **Semaine** : « Semaine · modèles Cursor ».
  - **Limite non lue** : le message `unreadMsg`, et un lien `cursor.com/dashboard ↗` qui appelle `openUrl('https://cursor.com/dashboard?tab=usage')`.
  - **Injoignable** : `u.unreachHost('api2.cursor.sh')`.
  - « remise le / reprend le » quand `resetIsDate`, « remise à / reprend à » sinon.
- **« À toi » et la notification** : la fenêtre de l'alerte se nomme « total du mois » ou « total de la semaine », ou « Modèles Cursor » ou « Autres modèles » pour une réserve (textes de `CT` : `alTotal`, `alOther`).
- **i18n `usage`** : `harness.cursor: 'Cursor Agent'`, `month: 'Mois'`, `poolShort: { cursor: 'Cursor', other: 'Autres' }`, `pool: { cursor: 'Modèles Cursor', other: 'Autres modèles' }`, `poolHint`, `perPool: 'Par réserve'`, `monthTotal: 'Total inclus · mois'`, `weekCursor: 'Semaine · modèles Cursor'`, `resetOn`, `resumesOn`, `unread: 'limite non lue'`, `unreadMsg`, `dashboard: 'cursor.com/dashboard ↗'`, `alertMonth: 'total du mois'`, `alertWeekTotal`. `expired` et `expiredShort` deviennent des fonctions du nom du harnais. L'anglais est celui de `CT.en`.
- La couleur `.harness-*` n'est plus utilisée pour ces logos. Retirer `--h-claude` et `--h-codex` si plus rien ne les lit.
- [ ] **Tests qui échouent** (`usage-footer.test.tsx`, Testing Library) :
  - Un Cursor mensuel seul (12/8/56) → le bouton « Limites de Cursor Agent : détail » contient « Mois », « 12 % », « ↺ 1 déc. ». Ni « Cursor » ni « Autres » sous le seuil.
  - Over (81/41/100) → « Autres » et « 100 % » dans la puce. Clic → le dialogue contient « Total inclus · mois », « Par réserve », « Modèles Cursor », « Autres modèles », « atteinte · reprend le 1 déc. ».
  - Claude et Cursor ensemble → la puce de Cursor n'a pas de `↺`.
  - Non lue → « limite non lue » ; clic → le message et le lien. Un clic sur le lien appelle `openUrl` avec `https://cursor.com/dashboard?tab=usage` (le bridge est mocké).
  - Expirée → « session expirée : reconnectez-vous dans Cursor Agent ».
  - Logos : `HarnessLogo harness="claude"` → `path[fill="#D97757"]` ; `harness="cursor"` → `svg[fill="currentColor"]`. `tab-label.test.tsx` reste vert.
  - Review Focus 5 : trois groupes (Claude, Codex, Cursor), aucune puce n'a de `↺` ; chacune est un bouton.
  - `Attention` : une alerte `pool other full` → la carte dit « Cursor Agent », « Autres modèles », « Atteinte · reprend le 1 déc. ».
- [ ] Implémenter, `desktop test` et `typecheck` PASS, commit `feat(desktop): Cursor Agent's limits in the footer, its detail and « À toi »; the providers' real logos`.

### Task 7 : Le TUI

**Files:** Modify `packages/ledge/src/tui/glyphs.ts` (`markCursor: '◇'` ; ASCII `'<>'`), `packages/ledge/src/tui/ui/UsageLine.tsx`, `packages/ledge/src/tui/screens/Overview.tsx` (lignes d'alerte), `packages/ledge/src/tui/screens/Settings.tsx` (détail), `packages/ledge/src/tui/i18n/fr.ts`, `en.ts`. Test `packages/ledge/test/tui-usage.test.tsx`.

**Interfaces — Consumes :** Task 5.
- La ligne de pied (`cursorTuiSegs()`) : `◇` en `C.fg` gras ; puis « Mois » (« mois » en dessous de 120 colonnes) ou « Semaine » (« sem »), la barre de 6 cellules à partir de 120 colonnes, le %, et `↺1 déc.` à partir de 120 colonnes ; puis les réserves de `hot` (« Cursor », « Autres ») ; puis l'âge en jaune. « limite non lue » en `C.faint`. Session expirée → `u.expired('Cursor Agent')`.
- Réglages (R7) : toutes les fenêtres de Cursor, nommées « Total · mois », « Cursor » et « Autres ».
- À TOI : `alertThreshold('Cursor Agent', 'total du mois', 81, '1 déc.')`, `alertFull('Cursor Agent', 'Autres modèles', '1 déc.')`.
- [ ] **Tests qui échouent :** `usageSegments` d'un Cursor over, à 120 colonnes → le texte joint contient `◇ Mois`, `81%`, `↺1 déc.`, `Autres`, `100%`. À 80 colonnes → `mois 81%`, sans `↺`. Non lue → `limite non lue`. En glyphes ASCII → `<>`. L'écran Overview, avec une alerte `pool other full`, montre la ligne d'À TOI.
- [ ] Implémenter, PASS, commit `feat(tui): Cursor Agent's limits on the foot line, in Settings and « À TOI »`.

### Task 8 : Le téléphone

**Files:** Modify `apps/mobile/src/ui/chat/Limits.tsx`, `apps/mobile/src/ui/chat/LePoint.tsx`, `apps/mobile/src/model/usage.ts` (`resetLabel` : une date au-delà d'une semaine), `apps/mobile/src/copy.ts`, `apps/mobile/src/styles.css`. Tests `apps/mobile/test/screens/usage.test.tsx`, `usage-edges.test.tsx`, `packages/ledge/test/mobile-usage.test.ts` (le gateway relaie Cursor sans `account`).

**Interfaces — Consumes :** Task 1, et `PROVIDER_MARKS` / `HARNESS_PROVIDER` de la Task 6.
- LIMITES (`cursorPhoneLimits()`) : le logo et « Cursor Agent », puis les lignes « Mois » (ou « Semaine »), « Cursor » et « Autres », chacune avec son % et sa remise. Non lue → `phUnread`. Session expirée → « Lecture impossible : reconnectez Cursor Agent sur le PC. ». Anciennes ou injoignable : comme pour Claude.
- À TOI : `Cursor · Mois 81 %`, `Cursor · Autres 100 %`.
- `HarnessLogo` du téléphone → les vrais logos (choix 5).
- [ ] **Tests qui échouent :** le Point avec Claude et Cursor over → les lignes « Mois 81 % ↺ 1 déc. », « Cursor 41 % », « Autres 100 % » avec « reprend » ; deux lignes d'À TOI. Non lue → le message. Expirée → le message Cursor. `resetLabel` à 24 jours → `1 déc.`. Le gateway : `usage.state` vers le téléphone porte `harness: 'cursor'`, sans `account`.
- [ ] Implémenter, `@ledge/mobile test` et `typecheck` PASS, commit `feat(mobile): Cursor Agent's limits in « Le point »; the providers' real logos`.

### Task 9 : Revue visuelle, nettoyage, installeur

**Files:** Modify `apps/desktop/e2e/usage-visual.spec.ts` (états Cursor), `apps/mobile/e2e/usage.spec.ts`. Delete `docs/cursor-usage-brief.md`, `docs/cursor-usage-study.md`, `docs/cursor-usage-questions.md` (s'il existe, après report dans ce plan).
- [ ] e2e visuel : ajouter `cursorMonth`, `cursorOver`, `cursorWeek`, `cursorUnread`, `cursorExpired` (et Claude + Cursor) à `STATES`. Pour chaque état, captures du pied et du détail ouvert, dans les deux thèmes. Lancer `LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/usage-visual.spec.ts`, comparer à la maquette `?v=cursor`, corriger les écarts.
- [ ] e2e mobile : un état Cursor dans `usage.spec.ts`. `pnpm --filter desktop e2e` et `pnpm --filter @ledge/mobile test:e2e` : seuls les échecs déjà connus restent.
- [ ] Suites complètes et `typecheck` de tous les paquets touchés ; `cargo clippy` n'est pas concerné (pas de Rust).
- [ ] Supprimer les fichiers de travail, commit `chore: Cursor usage — the working notes go, the plan keeps them`.
- [ ] Relecture finale de toute la branche (subagent), avec les points mineurs **corrigés**.
- [ ] Installeur Windows : suivre la procédure du brief (clone `C:\Users\Desan\Workspace\ledge`, `fetch` + `checkout -B feat/cursor-usage FETCH_HEAD`, `build-desktop.ps1` en arrière-plan), puis donner à l'utilisateur le chemin de l'installeur. Ne rien pousser, ne pas ouvrir de PR, ne pas fusionner sans son accord.
