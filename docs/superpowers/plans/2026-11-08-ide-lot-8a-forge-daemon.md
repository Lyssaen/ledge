# Refonte IDE, lot 8a : MR et PR côté daemon, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque daemon relève les PR GitHub et les MR GitLab des branches de ses sessions et de ses sièges OpenRig, avec `gh` et `glab`, et les publie dans le protocole : la liste (état, pipeline, approbations, commentaires ouverts), le détail sur demande (description, relecteurs, étiquettes, ticket, graphe du pipeline, journal du job échoué, fils de discussion, fichiers, commits) et les actions relancer, fusionner, commenter, répondre et résoudre. « Ouvrir sur GitHub / GitLab » est l'`url` de la PR. Le lot 8b (dev-front) affichera tout cela sans rien demander de plus au daemon. **Aucun écran ne change.**

**Architecture :**
- **Daemon** (`packages/ledge`). Un service `daemon/forge/` remplace la lecture ad hoc du chat par un exécuteur commun (`run.ts`, sorti de `chat/forge.ts`), un lecteur GitHub (`github.ts`, `gh pr list/view --json` et `gh api graphql`), un lecteur GitLab (`gitlab.ts`, `glab api`, REST v4) et un service (`service.ts`). Le service suit les couples (dépôt, branche) des sessions du `Store`, sièges compris, et relève toutes les **60 s**, ou toutes les **15 s** tant qu'un pipeline suivi tourne. Aucun jeton ne passe par Ledge : `gh` et `glab` utilisent la connexion et le proxy de la machine (`loginShellEnv`).
- **Protocole** (`packages/protocol/src/forge.ts`). Un message poussé `forge.state` (la liste et l'état de chaque forge), une requête `forge.detail` et une requête `forge.act`, avec `requestId` comme `openrig.*`. Le drapeau `forge: true` est ajouté dans `DaemonInfo`.
- **Fleet** (`packages/fleet`). L'état est tenu machine par machine, et les ids de session sont qualifiés `machine:id`. Les requêtes passent par la machine de la PR, et une machine qui tombe répond « hors ligne ».

**Tech Stack :** TypeScript, zod, Node 22 (`node:child_process`), vitest. `gh` ≥ 2.45, `glab` ≥ 1.36 (versions de la machine de l'utilisateur).

**Spec :**
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md) §3.4 et lot 8.
- [`docs/ide-workspace.md`](../../ide-workspace.md), section « MR et PR ».
- La maquette [`docs/mockups/ledge-ide-interactive.html`](../../mockups/ledge-ide-interactive.html) (v26, validée le 2026-11-06) fixe les données à fournir :
  - `PRS` : `host`, `num`, `title`, `repo`, `branch`, `agent`, `state`, `pipe`, `appr`, `ok`, `stages`, `log` ;
  - `PR_META` : `desc`, `labels`, `reviewers`, `issue`, `commits`, `threads` avec `file`, `line`, `code`, `replies` et `resolved` ;
  - `PR_FILES` et `HUNKS` ;
  - `PCOLS` (colonnes du graphe) ;
  - les actions `prrerun`, `prmerge`, `prweb`, `prresolve` et les champs `data-prc` et `data-prr`.

## Global Constraints

- Branche `feat/ide-lot-8a`, partie de `origin/main` 46987890 (0.53.0), dans un worktree de `dev-back`. La PR part du fork `charles331/ledge` (remote `fork`) vers `Lyssaen/ledge:main`. **Rien n'est poussé, ouvert ni fusionné sans l'accord de l'utilisateur.**
- **Aucun écran.** On ne touche ni `apps/desktop`, ni `apps/mobile`, ni `packages/ui`, ni le TUI. La zone du lot 6 (en cours chez l'auteur) est donc hors d'atteinte : `apps/desktop/src/settings/*`, `apps/desktop/src/atelier/*`, `apps/desktop/src/ide/*` et `apps/desktop/src/i18n/*`.
- **Aucune écriture sur une forge pendant le développement.** Les tests passent par un `ForgeRun` factice et des fixtures. Les lectures réelles (Task 0) sont permises. Une écriture réelle (commentaire, résolution, relance) ne se fait qu'avec l'accord de l'utilisateur, sur une PR jetable du fork `charles331/ledge` (R9). La fusion réelle n'est jamais testée.
- **Les écritures forment une liste close** : relancer, fusionner, commenter, répondre, résoudre. Toutes les commandes passent par `execFile` sans shell. Les identifiants sont validés par expression régulière avant usage, et un corps de texte passe par l'entrée standard, jamais par `argv`.
- Aucun jeton ne passe dans le protocole ni dans les journaux. Toute sortie de `gh` ou de `glab` qui va vers un front ou un journal passe par `redact()`.
- `ledge-daemon` n'est jamais redémarré sans l'accord de l'utilisateur.
- Le téléphone (`mobile/gateway.ts`) n'est pas concerné : il ne reçoit pas `forge.state` (R8).
- Node 22 (`~/.local/share/pi-node`). Tests : `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/fleet test`, plus `typecheck` dans chacun. `pnpm --filter desktop typecheck` doit rester vert, car Desktop consomme le protocole et la fleet.
- Échecs déjà présents sur `main`, à ne pas compter comme régressions : `hook.test` sous charge, et toute suite lancée sous Node 18.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Réponses de l'utilisateur (2026-11-08, plan validé)

1. **GitLab :** `glab` est connecté sur WSL à `gitlab.com` (compte `charles.meunier.dev`). C'est l'hôte de la Task 0. Le relevé réel se fait en lecture seule, sur un projet que ce compte voit. Le compte rendu dit quel hôte `glab` vise réellement.
2. **R5 :** la méthode par défaut du dépôt, comme proposé.
3. **R9 :** l'essai réel sur une PR jetable du fork `charles331/ledge` est autorisé. La PR est fermée ensuite, et la fusion réelle n'est jamais testée.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **Les PR suivies** : celles dont la branche source est la branche d'une session ou d'un siège non archivé de la machine, sur le dépôt `origin` de cette session. Les branches par défaut (`main`, `master`, `develop`, ou la branche par défaut lue au premier relevé) et les têtes détachées sont exclues. Les PR fusionnées restent listées tant qu'une session suit leur branche ; les PR fermées sans fusion aussi, avec l'état `closed`. | Suivre aussi les PR où l'utilisateur est relecteur : un appel `--search review-requested:@me` par dépôt. |
| R2 | **Le rythme** : 60 s, ou 15 s tant qu'un pipeline suivi est `run` ou `wait`. Un relevé immédiat a lieu après chaque action et quand une session change de branche. En cas d'erreur, l'attente double jusqu'à 10 min, forge par forge. Un appel par dépôt (et pas par branche) pour la liste ; le détail n'est lu qu'à la demande, puis gardé 30 s. | Un relevé seulement quand un front est abonné : un message `forge.watch` de plus. |
| R3 | **GitLab par `glab api`** (REST v4 : `merge_requests`, `pipelines/:id/jobs`, `discussions`, `jobs/:id/trace`), pas par `glab mr list` : en 1.36, la sortie JSON de `glab mr list` n'existe pas (`--help` ne la mentionne pas). **GitHub** passe par `gh pr list/view --json`, et par `gh api graphql` pour les fils de revue, que `pr view` ne donne pas avec leur état « résolu ». | `glab mr view -F json`, si la Task 0 montre qu'il est complet ; cela fait moins d'appels `api`. |
| R4 | **Les états** : `draft`, `open`, `review`, `merged`, `closed`. `review` = des relecteurs sont attendus ou ont demandé des changements. GitHub : `reviewRequests` non vide ou `reviewDecision = CHANGES_REQUESTED`. GitLab : `reviewers` non vide et non approuvée. Sinon, `open`. | L'état brut de la forge, et la traduction côté front. |
| R5 | **Fusionner** : le daemon le refuse lui-même (`code: 'not_offered'`, avec la raison) si la PR n'est pas `open` ou `review`, si elle est en brouillon, si son pipeline n'est pas `ok`, s'il manque une approbation (au moins une, et le nombre requis quand la forge le donne), ou s'il reste un « changements demandés ». Le client envoie `headSha` : si la tête a bougé, le daemon renvoie `stale`. **La méthode est celle par défaut du dépôt** : GitHub `--merge` si `mergeCommitAllowed`, sinon `--squash`, sinon `--rebase` ; GitLab, la méthode du projet. On ne supprime pas la branche. La confirmation, avec la commande exacte, est l'affaire du front (8b). La commande à afficher est fournie dans le détail (`mergeCommand`). | `--squash` partout, comme dans la maquette. Mais ce dépôt-ci fusionne par commit de fusion (« Merge pull request #227 »). |
| R6 | **Relancer** : GitHub `gh run rerun <runId> --failed` pour chaque exécution échouée de la tête ; GitLab `POST /projects/:id/pipelines/:id/retry`. Refusé (`busy`) tant que le pipeline tourne. | Relancer un seul job : un `jobId` de plus dans l'action. |
| R7 | **Le graphe du pipeline** : une liste de jobs `{ id, name, column, status, durationS }`. GitLab : `column` est l'index de l'étape (`stage`), dans l'ordre du `.gitlab-ci.yml` tel que l'API le renvoie. GitHub : `gh` ne donne pas les `needs`, donc une colonne par workflow de la tête, et ses jobs dedans. Le journal du job échoué est lu à la demande (`forge.detail` avec `log: jobId`) : ses 60 dernières lignes, sans codes ANSI, passées par `redact()`. | Lire les `needs` de GitHub dans le YAML du workflow : un vrai graphe, environ 100 lignes de plus. |
| R8 | Le téléphone ne reçoit rien en 8a. La passerelle mobile n'est pas touchée. | Un `forge.state` réduit pour le téléphone : un lot à part. |
| R9 | Une écriture réelle (commentaire, réponse, résolution, relance), une fois, sur une PR jetable `charles331/ledge` ouverte vers le fork lui-même, **avec ton accord**. La PR est fermée ensuite. | Seulement des fixtures. Les commandes d'écriture ne sont alors prouvées que par leurs arguments. |
| R10 | **La branche d'une session** est lue dans `workdir ?? cwd`, et plus dans `cwd` seul (`poller.ts`). Aujourd'hui, une session qui est passée dans un autre worktree garde la branche de son dossier de départ, et l'association avec sa PR serait fausse. La puce de branche des fronts devient donc juste : c'est un correctif, sans nouvel élément d'écran. | On le laisse, et une PR peut s'afficher sous la mauvaise session. |
| R11 | **« Ouvrir sur GitHub / GitLab »** = le champ `url`, que le front ouvre lui-même (Tauri, côté Windows). `gh pr view --web`, lancé dans WSL, ouvrirait un navigateur côté WSL. | Une action `open` du daemon, avec `wslview`. |
| R12 | **Le lien PR → agent** : `sessions: string[]` (ids du daemon, que la fleet qualifie), triés du plus récemment actif au moins actif. Le front montre le premier, comme « X » de « Demander à X de corriger ». | Un seul `sessionId`. |

## Review Focus

1. **Injection.** Une branche, un titre ou un commentaire malveillants (`--exec`, `$(…)`, retour à la ligne, 1 Mo de texte) ne deviennent jamais un drapeau ni une commande. Les numéros sont des entiers, les ids de fil suivent une expression régulière, et les corps passent par l'entrée standard, bornés à 64 Kio.
2. **Fusion.** Elle est refusée quand le pipeline n'est pas vert, en brouillon, sans approbation, avec des changements demandés, ou si la tête a bougé (`headSha`). Le refus porte la raison exacte. Aucun appel `merge` n'est lancé dans ces cas : le test vérifie les commandes passées au `ForgeRun` factice.
3. **`gh` ou `glab` absent, non connecté, ou visant le mauvais hôte.** La forge apparaît dans `forges[]` avec `missing`, `unauthenticated` ou `error`, et son message. Les PR des autres forges continuent d'arriver. Rien ne boucle à 15 s sur une forge en erreur.
4. **Une session qui change de branche, est archivée, ou deux sessions sur la même branche.** La PR suit, disparaît ou porte deux sessions. Un relevé coûte un appel par dépôt, pas un par session.
5. **Le contrat pour le 8b.** Tout champ de `PRS` et `PR_META` de la maquette a son champ dans le protocole, ou une raison écrite dans le compte rendu.
6. **Les secrets.** Un `stderr` qui contient `glpat-…` ou une URL avec identifiants n'atteint ni le protocole ni le journal en clair.

---

### Task 0 : Relevé réel, en lecture seule

**Files:** Create `packages/ledge/test/fixtures/forge/*.json` (sorties réelles, expurgées). Create `docs/forge-survey.md` (travail, supprimé avant la PR ; ce qui compte passe dans le compte rendu).

- [ ] Sur `Lyssaen/ledge` (lecture seule, ton compte `gh`) : `gh pr list --state all --limit 5 --json number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,author,updatedAt,reviewDecision,reviewRequests,latestReviews,statusCheckRollup,labels,comments`. Ensuite `gh pr view <n> --json body,commits,files,closingIssuesReferences`, la requête GraphQL `reviewThreads(first:100){nodes{id isResolved path line comments(first:50){nodes{id author{login} body createdAt diffHunk}}}}`, puis `gh run list --branch <b> --json databaseId,workflowName,status,conclusion,headSha` et `gh run view <id> --json jobs`. Garder une PR fusionnée, une ouverte et, s'il y en a, un run échoué. Lire `gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,defaultBranchRef`.
- [ ] GitLab, si la question 1 est réglée : `glab api --hostname <hôte> projects/<enc>/merge_requests?state=all&per_page=5`, puis `…/merge_requests/:iid` (`head_pipeline`, `detailed_merge_status`), `…/approvals`, `…/discussions`, `…/changes` (ou `diffs`), `…/commits`, `projects/:id/pipelines/:id/jobs` et `jobs/:id/trace`. Noter : la version de l'API, l'hôte réellement visé et le proxy. Si la question 1 n'est pas réglée, écrire les fixtures d'après la doc de l'API v4 et le marquer dans le relevé.
- [ ] Noter les messages exacts de `gh` et `glab` pour « non connecté », « dépôt introuvable » et « limite de requêtes ».
- [ ] Expurger : pas de jeton, et pas d'adresse e-mail d'auteur (un `login` suffit). Commit `test(forge): real gh and glab answers, redacted, as fixtures`.

### Task 1 : Le protocole des MR et PR

**Files:** Create `packages/protocol/src/forge.ts`, `packages/protocol/test/forge.test.ts`. Modify `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`.

**Interfaces — Produces :**
```ts
export const ForgeKindSchema = z.enum(['github', 'gitlab']);
export const PipeStatusSchema = z.enum(['ok', 'run', 'fail', 'wait', 'skip', 'none']); // none : pas de pipeline
export const PrStateSchema = z.enum(['draft', 'open', 'review', 'merged', 'closed']);
export const PullRequestSchema = z.object({
  id: z.string(),                 // `${host}/${path}#${number}`, stable
  forge: ForgeKindSchema, host: z.string(), repo: z.string(), // repo = path (owner/name, groupe/sous/projet)
  number: z.number().int().positive(),
  ref: z.string(),                // '#226' (GitHub) ou '!41' (GitLab), tel qu'affiché
  url: z.string().url(), title: z.string(),
  state: PrStateSchema, branch: z.string(), target: z.string(), headSha: z.string(),
  pipeline: PipeStatusSchema,
  approvals: z.object({ given: z.number().int(), required: z.number().int().optional() }),
  mergeable: z.boolean(),         // le `ok` de la maquette : tout ce que R5 exige, sauf le pipeline
  openThreads: z.number().int(), updatedAt: z.string().datetime(),
  sessions: z.array(z.string())   // R12
});
export const ForgeStatusSchema = z.object({ forge: ForgeKindSchema, host: z.string(), status: z.enum(['ok', 'missing', 'unauthenticated', 'error']), message: z.string().optional(), at: z.string().datetime() });
export const ForgeStateMessageSchema = z.object({ type: z.literal('forge.state'), prs: z.array(PullRequestSchema), forges: z.array(ForgeStatusSchema), machineId: z.string().optional() });

export const PrJobSchema = z.object({ id: z.string(), name: z.string(), column: z.number().int(), columnName: z.string(), status: PipeStatusSchema, durationS: z.number().optional() });
export const PrCommentSchema = z.object({ id: z.string(), author: z.string(), at: z.string().datetime(), body: z.string() });
export const PrThreadSchema = z.object({ id: z.string(), resolvable: z.boolean(), resolved: z.boolean(), file: z.string().optional(), line: z.number().int().optional(), code: z.string().optional(), comments: z.array(PrCommentSchema).min(1) });
export const PrFileSchema = z.object({ path: z.string(), added: z.number().int(), removed: z.number().int(), patch: z.string().optional() }); // patch borné à 200 Kio au total
export const PrDetailSchema = z.object({
  pr: PullRequestSchema, description: z.string(), author: z.string(),
  reviewers: z.array(z.object({ name: z.string(), state: z.enum(['approved', 'changes', 'pending']) })),
  labels: z.array(z.string()), issues: z.array(z.string()),
  jobs: z.array(PrJobSchema), log: z.object({ jobId: z.string(), text: z.string() }).optional(),
  threads: z.array(PrThreadSchema), files: z.array(PrFileSchema),
  commits: z.array(z.object({ sha: z.string(), title: z.string(), author: z.string(), at: z.string().datetime() })),
  mergeCommand: z.string(), mergeBlockers: z.array(z.string()) // vide = fusionnable (R5)
});
// client → serveur, avec requestId ; machineId comme les autres
export const ForgeDetailSchema = z.object({ type: z.literal('forge.detail'), requestId: z.string(), prId: z.string(), log: z.string().optional(), machineId: z.string().optional() });
export const ForgeActSchema = z.object({ type: z.literal('forge.act'), requestId: z.string(), prId: z.string(), machineId: z.string().optional(), action: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rerun') }),
  z.object({ kind: z.literal('merge'), headSha: z.string() }),
  z.object({ kind: z.literal('comment'), body: z.string().min(1).max(65536) }),
  z.object({ kind: z.literal('reply'), threadId: z.string(), body: z.string().min(1).max(65536) }),
  z.object({ kind: z.literal('resolve'), threadId: z.string() })
]) });
// serveur → client
export const ForgeDetailReplySchema = z.object({ type: z.literal('forge.detail.reply'), requestId: z.string(), ok: z.boolean(), detail: PrDetailSchema.optional(), message: z.string().optional() });
export const ForgeActReplySchema = z.object({ type: z.literal('forge.act.reply'), requestId: z.string(), ok: z.boolean(), command: z.string().optional(), message: z.string().optional(), code: RefusalCodeSchema.optional() });
// DaemonInfoSchema : forge: z.boolean().optional()
```
- Tolérance, comme R4 des limites d'usage : un `forge.state` dont une PR porte une valeur d'énumération inconnue (`state`, `pipeline`, `forge`) passe sans cette PR. Un job au statut inconnu devient `none`.
- [ ] **Tests qui échouent** (`forge.test.ts`) : les objets `gh-226` et `gl-41` de la maquette, traduits, passent le schéma. Une PR `state: 'archived'` est écartée d'un `forge.state` qui garde les autres. `forge.act` avec `kind: 'delete'` est refusé. Un `body` de 65 537 caractères est refusé.
- [ ] Implémenter, `pnpm --filter @ledge/protocol test` et `typecheck` PASS. Commit `feat(protocol): pull and merge requests — state, detail and actions`.
- [ ] Prévenir le lead (qui le notera pour le 8b), avec le sha : le protocole est figé.

### Task 2 : Un exécuteur commun pour `gh` et `glab`

**Files:** Create `packages/ledge/src/daemon/forge/run.ts`. Modify `packages/ledge/src/chat/forge.ts` (il importe `forgeOf`, `redact` et l'exécuteur au lieu de les définir). Test `packages/ledge/test/forge-run.test.ts`. `chat-forge.test.ts` reste vert sans modification.

**Interfaces — Produces :**
```ts
export type ForgeRun = (file: 'gh' | 'glab' | 'git', args: string[], opts?: { cwd?: string; input?: string; timeoutMs?: number }) => Promise<{ code: number | null; stdout: string; stderr: string }>;
export function execForge(env: () => Promise<NodeJS.ProcessEnv>): ForgeRun; // spawn sans shell, stdin = input, 4 Mo max
export function forgeOf(remote: string): ForgeRepo | null; export function redact(text: string): string;
export function classify(r: { code: number | null; stderr: string }): 'ok' | 'missing' | 'unauthenticated' | 'error';
```
- [ ] **Tests qui échouent :** `input` arrive sur l'entrée standard (un `node -e` en guise de binaire). `code: null` quand le binaire manque. `classify` reconnaît les messages relevés en Task 0. `redact` enlève `glpat-…`, `ghp_…` et `https://user:pass@`.
- [ ] Implémenter, `pnpm --filter @paradow/ledge test` PASS. Commit `refactor(daemon): one runner for gh and glab, shared with the chat`.

### Task 3 : Le lecteur GitHub

**Files:** Create `packages/ledge/src/daemon/forge/github.ts`. Test `packages/ledge/test/forge-github.test.ts` (sur les fixtures de la Task 0).

**Interfaces — Produces :**
```ts
export interface ForgeReader {
  list(repo: ForgeRepo, branches: string[]): Promise<Omit<PullRequest, 'sessions'>[]>; // un `pr list` par dépôt, filtré sur branches
  detail(repo: ForgeRepo, number: number, opts: { log?: string }): Promise<Omit<PrDetail, 'pr'> & { pr: Omit<PullRequest, 'sessions'> }>;
  act(repo: ForgeRepo, pr: PullRequest, action: ForgeAct['action']): Promise<{ command: string }>; // lève ForgeRefusal
}
export function githubReader(run: ForgeRun): ForgeReader;
```
- La liste : `gh pr list -R <repo> --state all --limit 100 --json …` (les champs de la Task 0), filtrée sur les branches suivies. On garde, par branche, la PR ouverte, sinon la plus récente. Le `pipeline` est le résumé de `statusCheckRollup` : un échec donne `fail`, un job en cours donne `run`, un job en file donne `wait`, tous réussis ou ignorés donnent `ok`, aucun donne `none`. Les `approvals` et l'état `review` suivent R4 et R5. `openThreads` vient d'une seule requête GraphQL par dépôt pour les PR ouvertes de la liste (`reviewThreads { isResolved }`).
- Le détail : `pr view --json`, la requête GraphQL des fils (avec un commentaire de premier niveau = un fil non résoluble), `run list --branch --commit <headSha>`, puis `run view --json jobs` (R7). Le journal se lit par `run view --log-failed --job <id>` (60 lignes, sans ANSI, `redact`). Les fichiers et leurs patchs viennent de `gh api repos/{o}/{r}/pulls/{n}/files --paginate`, bornés.
- Les actions (R5, R6) :
  - `pr comment <n> --body-file -` ;
  - réponse : GraphQL `addPullRequestReviewThreadReply`, corps en variable, la requête par stdin (`gh api graphql --input -`) ;
  - résolution : `resolveReviewThread` ;
  - relance : `run rerun <id> --failed` ;
  - fusion : `pr merge <n> --<méthode> --match-head-commit <headSha>`.
- [ ] **Tests qui échouent :**
  - Les fixtures donnent les champs attendus.
  - Une PR sans checks donne `pipeline: 'none'`.
  - `--match-head-commit` est bien passé.
  - Une branche `--exec` n'apparaît jamais en tête d'argument : elle n'est utilisée qu'en filtre, côté Node.
  - Un corps contenant `$(rm -rf ~)` passe par `input`, jamais par `args`.
- [ ] Implémenter, PASS. Commit `feat(daemon): read and act on GitHub pull requests through gh`.

### Task 4 : Le lecteur GitLab

**Files:** Create `packages/ledge/src/daemon/forge/gitlab.ts`. Test `packages/ledge/test/forge-gitlab.test.ts`.

- `glab api --hostname <host> …` (R3), avec le projet encodé (`encodeURIComponent(path)`).
- La liste : `projects/:p/merge_requests?state=all&per_page=100&order_by=updated_at`, filtrée sur les branches. Ensuite, pour les MR ouvertes : `merge_requests/:iid` (`head_pipeline.status`, `detailed_merge_status`, `draft`), puis `merge_requests/:iid/approvals` (`approved_by`, `approvals_required`). `openThreads` : les `discussions` dont une note est résoluble et non résolue.
- Le détail : `discussions` (la `position` donne `file`, `line` et `code` depuis la ligne du diff), `diffs` (ou `changes` selon la version relevée), `commits`, `pipelines/:id/jobs`. Une `stage` donne une colonne, dans l'ordre de première apparition. Le journal vient de `jobs/:id/trace` (60 lignes). `issues` vient de `closes_issues`.
- Les actions :
  - `POST …/notes` ;
  - `POST …/discussions/:id/notes` ;
  - `PUT …/discussions/:id?resolved=true` ;
  - `POST projects/:p/pipelines/:id/retry` ;
  - `PUT …/merge` avec `sha=<headSha>` et la méthode du projet (R5). Les corps passent en JSON par `--input -` et `-H 'Content-Type: application/json'`.
- Les statuts GitLab se traduisent ainsi : `success` → `ok`, `running` → `run`, `pending`/`created`/`waiting_for_resource`/`preparing`/`scheduled`/`manual` → `wait`, `failed` → `fail`, `canceled`/`skipped` → `skip`.
- [ ] **Tests qui échouent** : les mêmes cas que la Task 3, plus le cas `gl-41` de la maquette (`build` ok, `test` fail, `deploy:staging` skip ; trois colonnes). Un sous-groupe `a/b/c` est encodé en `a%2Fb%2Fc`.
- [ ] Implémenter, PASS. Commit `feat(daemon): read and act on GitLab merge requests through glab api`.

### Task 5 : Le service, et ce qu'il suit

**Files:** Create `packages/ledge/src/daemon/forge/service.ts`. Test `packages/ledge/test/forge-service.test.ts`.

**Interfaces — Produces :**
```ts
export function createForgeService(deps: { store: Store; run?: ForgeRun; env?: () => Promise<NodeJS.ProcessEnv>; now?: () => number; readers?: Partial<Record<'gh' | 'glab', ForgeReader>> }): {
  state(): ForgeStateMessage; onChange(cb: () => void): () => void;
  refresh(): Promise<void>; start(): void; stop(): void;
  detail(prId: string, opts: { log?: string }): Promise<PrDetail>;  // gardé 30 s
  act(prId: string, action: ForgeAct['action']): Promise<{ command: string }>; // lève ForgeRefusal { code, message }
};
```
- Ce qui est suivi (R1) :
  - les sessions non archivées du `Store` qui ont `repoId` et `branch` ;
  - regroupées par dépôt, chaque dépôt avec son `forgeOf(remote)` (lu une fois, par `git config` dans le `repoPath`) ;
  - sans les branches par défaut.
- Le rythme suit R2, avec l'attente qui double par forge (`host`), et un `onChange` seulement si quelque chose a changé (comparaison profonde). Le timer est `unref()`.
- `act` relit la PR juste avant d'agir, applique les refus de R5 et R6, puis relève la liste.
- [ ] **Tests qui échouent** (horloge et lecteurs factices) :
  - deux sessions sur la même branche donnent une PR avec deux `sessions` et un seul appel `list` ;
  - une session archivée retire sa PR ;
  - un pipeline `run` fait passer à 15 s, et `ok` ramène à 60 s ;
  - `glab` absent donne `forges[{ status: 'missing' }]`, et les PR GitHub arrivent quand même ;
  - trois erreurs de suite font attendre 2, 4 puis 8 min, jamais plus de 10 ;
  - `merge` est refusé avec `mergeBlockers` quand le pipeline n'est pas `ok`, et `stale` quand `headSha` diffère ;
  - après un refus, aucun appel `merge` n'est fait.
- [ ] Implémenter, PASS. Commit `feat(daemon): follow the pull and merge requests of sessions' branches`.

### Task 6 : Le daemon branche le service, et la branche d'une session suit son dossier

**Files:** Modify `packages/ledge/src/daemon/server.ts` (création à côté de `createForge`, `forge.state` poussé à chaque changement et renvoyé après `sendSnapshot`, les cases `forge.detail` et `forge.act` du `handle`, `forge: true` dans `DaemonInfo`), `packages/ledge/src/daemon/index.ts` (`start`/`stop`), `packages/ledge/src/daemon/poller.ts` (R10). Tests `packages/ledge/test/forge-server.test.ts` (vrai `startServer` sur le port 0, `fakeTmux()`, `connect()`, `until()`, comme `usage-server.test.ts`) et le test existant du poller.

- [ ] **Tests qui échouent :**
  - Un client connecté reçoit `forge.state` après le snapshot, puis à chaque changement.
  - `forge.detail` renvoie `forge.detail.reply` avec le même `requestId`.
  - `forge.act` refusé renvoie `ok: false` et le `code`.
  - Un `prId` inconnu renvoie `unavailable`.
  - Le poller lit la branche dans `workdir` quand elle existe.
- [ ] Implémenter, `pnpm --filter @paradow/ledge test` et `typecheck` PASS. Commit `feat(daemon): serve pull and merge requests; a session's branch follows its working folder`.

### Task 7 : La fleet

**Files:** Modify `packages/fleet/src/fleet.ts`. Create `packages/fleet/src/forge.ts` (le modèle de vue partagé : `openPrs`, `mergedPrs`, `prsFailing` pour le badge, `prsWaitingForYou` pour « À toi », `prOfSession`). Tests `packages/fleet/test/fleet.test.ts` (avec `mockDaemon.ts`) et `packages/fleet/test/forge.test.ts`.

**Interfaces — Produces :**
```ts
fleet.prs(): PullRequest[];            // toutes machines, ids de session qualifiés, `machineId` renseigné
fleet.forges(): (ForgeStatus & { machineId: string })[];
fleet.onForge(cb: () => void): () => void;
fleet.prDetail(prId: string, machineId: string, opts?: { log?: string }): Promise<PrDetail>;
fleet.prAct(prId: string, machineId: string, action: ForgeAct['action']): Promise<{ command: string }>; // rejette avec { code, message }
```
- Les requêtes sont tenues par `requestId` → machine, comme `rigAsks`. Une machine qui tombe rejette ses requêtes en cours (« hors ligne ») et sort de la carte. Un daemon sans `forge: true` ne compte pas.
- [ ] **Tests qui échouent :**
  - Deux machines donnent la somme des PR, avec les sessions qualifiées.
  - Une machine qui tombe retire ses PR et rejette sa requête en cours.
  - `prsFailing` compte les PR ouvertes en `fail` (badge de la maquette) ; `prsWaitingForYou` = pipeline `fail`, ou `ok` et `mergeable` (page « À toi »).
- [ ] Implémenter, `pnpm --filter @ledge/fleet test` et `typecheck` PASS, `pnpm --filter desktop typecheck` PASS. Commit `feat(fleet): pull and merge requests across machines`.

### Task 8 : Vérification, nettoyage, revue

- [ ] Les suites complètes sous Node 22 : protocole, `@paradow/ledge`, fleet, et `typecheck` de Desktop.
- [ ] Un daemon de test, **pas** celui de l'utilisateur : `node packages/ledge/dist/… daemon` sur un port libre, avec un `LEDGE_HOME` temporaire. Ouvrir une session factice dans un worktree de ce dépôt, sur une branche qui a une PR réelle (lecture seule). Relever `forge.state` par `ledge` client ou un petit script, et coller l'extrait dans le compte rendu.
- [ ] R9, seulement avec l'accord écrit de l'utilisateur : une PR jetable sur le fork, puis commenter, répondre, résoudre et relancer. Fermer la PR ensuite.
- [ ] Tableau de correspondance maquette → protocole (Review Focus 5) dans la ligne de livraison.
- [ ] Supprimer `docs/forge-survey.md`. Livrer à `review-qa@ledge-dev` par `rig queue handoff`, avec la branche, les commits, les commandes de test, les rulings appliqués et ce qui n'est pas vérifié.
