# Ledge Desktop Atelier, lot 6b : la Session (modifications, lecture côte à côte, plans, liste de tâches) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ce qui manque à la page de session du lot 6a pour relire le travail de l'agent : le sélecteur Fil / Modifications (n), les fichiers touchés groupés par dossier avec leur diff (numéros de ligne quand ils sont connus, lignes inchangées repliées, J / K, « Copier le chemin », « Modifié par … tour 2 » qui ramène à l'action), la lecture côte à côte (documents, modifications et plans dans un volet à onglets, redimensionnable, par-dessus le fil quand la conversation est étroite), les plans en cartes et dans le volet, et la liste de tâches de l'agent fixée en haut du fil.

**Architecture:** Deux modèles purs s'ajoutent au fil : `src/session/diff.ts` lit les trois formes de diff que le daemon écrit (`packages/ledge/src/daemon/files.ts`) et prépare les lignes à afficher, `src/session/changes.ts` regroupe les fichiers touchés du fil ; `src/session/todos.ts` lit la liste de tâches dans l'entrée des actions `TodoWrite` (Claude Code) et `update_plan` (Codex), et `thread.ts` apprend les plans (`ExitPlanMode`). Aucune donnée nouvelle n'est demandée au daemon, sauf le renommage d'un fichier dans un patch Codex. Le volet de lecture est un état de la page (onglets) ; sa largeur est mémorisée dans `desktop.session.split` (lot 6a).

**Tech Stack:** TypeScript, React 19, Vite 6, CSS de `session.css` (déjà porté au lot 6a), `@ledge/ui/documents/markdown` (lot 6a), vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` §§ 6 (liste de tâches tirée des actions d'outil, masquée pour un harnais qui ne la donne pas ; « Ouvrir dans l'éditeur ») et 7 lot 6. Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` § 2.8 (« Modifications », « Lecture côte à côte », « Plans », « Liste de tâches », et « Voir la modification » du « Fil plat »), § 9 (J / K dans Modifications, Échap). Maquette : `docs/mockups/desktop-observatory/session.tsx` (`parseDiff`, `DiffView`, `Line`, `files`, `dirs`, `fileList`, `changes`, `showInThread`, `sidePane`, `paneDoc`, `dragSplit`, `todoBar`, la carte de plan dans `renderItem`, `handleKey`), `session.css` (Modifications, volet, plans, liste de tâches). Plan précédent : `docs/superpowers/plans/2026-10-17-ledge-desktop-atelier-lot6a-session.md`, dont ce plan reprend les Global Constraints.

**Ouvrir dans l'éditeur** reste masqué (décision du lot 6a : commande Tauri à construire sous Windows, pas de cargo dans ce WSL).

## Global Constraints

- Celles du lot 6a, toutes. En particulier : la maquette fait foi ; textes dans `messages.ts`, `fr` source de vérité, l'anglais fixé par les tests listé par tâche ; rien d'optimiste ; aucune nouvelle dépendance ; pas de Tauri ni de Rust ; suite unitaire en anglais ; commits terminés par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Les diffs sont ceux du daemon, pas ceux de git** : chaque action qui touche un fichier porte le diff de son entrée (Claude : `- ancien` / `+ nouveau` sans numéros ; Codex : hunks `@@` sans numéros ; tout diff coupé à 80 lignes, suivies de `…`). La vue d'un fichier montre les diffs de ses actions dans l'ordre, un en-tête par action quand il y en a plusieurs ; les numéros de ligne ne s'affichent que pour un hunk numéroté (`@@ -a,b +c,d @@`). Pas de diff cumulé, pas de lecture du disque.
- **Les chemins** s'affichent relatifs au `cwd` de la session quand ils sont dessous (Claude écrit des chemins absolus, Codex des relatifs) ; le chemin copié est le chemin complet tel que l'action l'a donné.
- **Le harnais** n'est écrit qu'à un endroit, comme dans la maquette : les Modifications vides d'une session Cursor.
- **Volet** : largeur `split` de `desktop.session` (bornée à `[0.3, 0.72]`, 0.5 par défaut), le fil ne descend jamais sous 440 px (CSS de la maquette) ; sous 860 px de conversation (requête de conteneur), le volet passe par-dessus le fil, au-dessus de la réponse, avec « Fermer ». Les onglets ouverts sont propres à la page d'un agent : changer d'agent les ferme.
- **Échap sur la page**, dans cet ordre : la liste des fichiers ouverte (étroit), la liste de tâches dépliée, l'onglet actif du volet ; sinon il revient en arrière (lot 6a, tâche 1). J / K : fichiers des Modifications, ou diffs de l'onglet actif du volet ; jamais pendant une saisie.

## Review Focus

1. **Des diffs inattendus** : un diff Claude sans en-tête, un hunk Codex sans numéros, un diff coupé à 80 lignes, un fichier sans diff (supprimé, binaire, notebook), un fichier renommé par un patch, un fichier touché par cinq actions, une ligne très longue : chacun s'affiche sans erreur, avec ce qui est connu, et la page ne défile jamais de côté (seule la zone du diff défile). Tests aux tâches 1 et 2, Playwright à la tâche 6.
2. **J / K et Échap entre trois endroits** : J / K changent de fichier dans Modifications, de diff dans le volet, rien dans le fil sans volet ni pendant une saisie ; Échap ferme la liste des fichiers, puis la liste de tâches, puis l'onglet, et seulement ensuite quitte la page. Tests aux tâches 2, 3 et 5.
3. **Une fenêtre étroite ou le terminal ouvert** : le volet passe par-dessus le fil sans cacher la réponse ; plus large, le séparateur glisse, la largeur est bornée et retrouvée au rechargement, le fil garde au moins 440 px. Tests Playwright à la tâche 6.
4. **Un plan renvoyé en préparation** : la note part, la carte précédente devient « Révisé ensuite », la nouvelle carte et la demande épinglée suivent le nouveau plan, « Lire le plan » ouvre le bon. Test à la tâche 4.
5. **Un document qui ne vient pas** : introuvable, trop gros, machine hors ligne ou réponse trop lente : l'onglet le dit, rien ne casse, Échap le ferme. Test à la tâche 3.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/protocol/src/thread.ts`, `packages/ledge/src/daemon/files.ts` | `FileChange.from` : le renommage d'un patch Codex |
| `apps/desktop/src/session/{diff,changes,todos}.ts` | Nouveaux : diffs, fichiers touchés, liste de tâches |
| `apps/desktop/src/session/thread.ts` | Plans, actions de liste de tâches repliées, références de documents |
| `apps/desktop/src/session/{Changes,DiffView,SidePane,PlanCard,TodoBar}.tsx`, `useDocument.ts` | Nouveaux : rendu, lecture d'un document |
| `apps/desktop/src/session/{SessionPage,Thread,ActionGroup,PendingCard}.tsx` | Sélecteur de vue, volet, liens, cartes |
| `packages/fleet/test/mockDaemon.ts`, `apps/desktop/e2e/daemon.ts` | Documents servis par les faux daemons |
| `apps/desktop/test/*`, `apps/desktop/e2e/session-review.spec.ts` | Tests |

---

### Task 1: Les diffs et les fichiers touchés

**Files:**
- Create: `apps/desktop/src/session/diff.ts`, `apps/desktop/src/session/changes.ts`, `apps/desktop/test/session-diff.test.ts`
- Modify: `packages/protocol/src/thread.ts`, `packages/ledge/src/daemon/files.ts`, `packages/ledge/test/files.test.ts`

**Interfaces:**
- Consumes : `ThreadItem`, `ToolItem`, `FileChange` ; `exchanges`… (lot 6a) seulement pour le tour (`ToolItem.turn`).
- Produces :

```ts
// packages/protocol/src/thread.ts — FileChangeSchema gagne :
from: z.string().min(1).optional()        // le chemin d'avant, pour un fichier renommé (Codex `*** Move to:`)

// session/diff.ts
export type DiffLine = { t: 'ctx' | 'add' | 'del'; o?: number; n?: number; text: string };
export interface Hunk { o?: number; n?: number; ctx: string; lines: DiffLine[] }   // o / n : seulement pour un hunk numéroté
export interface ParsedDiff { hunks: Hunk[]; plus: number; minus: number; cut: boolean }
/** Les trois formes de daemon/files.ts : hunks numérotés `@@ -a,b +c,d @@ ctx` ; hunks Codex sous `@@` ou `@@ ctx` sans numéros ;
 *  sans en-tête, chaque ligne `- ` ou `+ ` (Claude : le signe, une espace, le texte ; l'espace tombe). Une dernière ligne `…` est la coupe à 80 lignes. */
export function parseDiff(diff: string): ParsedDiff;
export type DiffRow =
  | { kind: 'hunk'; label: string; ctx: string }          // label `@@ -o,oc +n,nc @@`, seulement pour un hunk numéroté
  | { kind: 'line'; line: DiffLine }
  | { kind: 'gap'; from: number; to: number }             // lignes non modifiées entre deux hunks numérotés
  | { kind: 'fold'; key: string; hidden: number };         // key `${hunk}:${début}`
/** Le DiffView de la maquette : trois lignes inchangées gardées de chaque côté d'un changement, une suite qui en cache au moins trois se replie ;
 *  une clé de `shown` déplie son repli. */
export function diffRows(d: ParsedDiff, shown: ReadonlySet<string>): DiffRow[];

// session/changes.ts
export type Change = FileChange['change'] | 'rename';
export interface Touch { tool: ToolItem; turn: number; change: FileChange['change']; from?: string; diff: ParsedDiff | null }
export interface ChangedFile { path: string; shown: string; from?: string; change: Change; plus: number; minus: number; cut: boolean; touches: Touch[] }
/** `path` sans le préfixe `${cwd}/` quand il est dessous ; tel quel sinon. */
export function relativeTo(path: string, cwd: string): string;
/** Les fichiers des actions réussies du fil affiché (le principal, ou celui d'un sous-agent), dans l'ordre de leur première action.
 *  Un renommage déplace l'entrée de l'ancien chemin au nouveau (`from`). change : renommé → 'rename' ; première action add → 'add' ;
 *  dernière delete → 'delete' ; seulement des write → 'write' ; sinon 'edit'. plus / minus / cut : sommes et « au moins une coupe » des touches. */
export function changedFiles(items: readonly ThreadItem[], cwd: string, helperId?: string): ChangedFile[];
/** Groupés par dossier de `shown` (« . » à la racine), dans l'ordre où les dossiers apparaissent. */
export function byFolder(files: readonly ChangedFile[]): Array<{ dir: string; files: ChangedFile[] }>;
```

Daemon : dans `fromPatch`, une ligne `*** Move to: <chemin>` sous un `*** Update File:` remplace le chemin de l'entrée en cours et pose `from` = l'ancien (`change` reste `edit`).

- [ ] **Step 1: Écrire les tests**

`packages/ledge/test/files.test.ts` :

```ts
it('a Codex patch that moves a file names both paths', () => {
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: src/b.ts\n@@\n-x\n+y\n*** End Patch';
  expect(filesOf('apply_patch', { input: patch })).toEqual([{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-x\n+y' }]);
});
```

`apps/desktop/test/session-diff.test.ts` :

```ts
const lines = (d: ParsedDiff) => d.hunks.flatMap(h => h.lines.map(l => `${l.t}:${l.o ?? ''}:${l.n ?? ''}:${l.text}`));

it('a Claude edit: no header, the space after each sign dropped, no line numbers', () => {
  const d = parseDiff('- const a = 1;\n+ const a = 2;\n+ export { a };');
  expect(lines(d)).toEqual(['del:::const a = 1;', 'add:::const a = 2;', 'add:::export { a };']);
  expect([d.plus, d.minus, d.cut, d.hunks[0]!.o]).toEqual([2, 1, false, undefined]);
});
it('a Codex hunk: a bare @@, the sign glued to the text, context kept', () => {
  expect(lines(parseDiff('@@ fn main\n-a\n+b\n c'))).toEqual(['del:::a', 'add:::b', 'ctx:::c']);
  expect(parseDiff('@@ fn main\n-a').hunks[0]!.ctx).toBe('fn main');
});
it('a numbered hunk numbers its lines', () => {
  expect(lines(parseDiff('@@ -10,4 +10,5 @@ fn x()\n a\n-d\n+e\n+f\n g'))).toEqual(['ctx:10:10:a', 'del:11::d', 'add::11:e', 'add::12:f', 'ctx:12:13:g']);
});
it('the 80-line cut is a flag, not a line; nothing is nothing', () => {
  const cut = parseDiff([...Array.from({ length: 80 }, (_, i) => `+ l${i}`), '…'].join('\n'));
  expect([cut.plus, cut.cut, cut.hunks[0]!.lines.length]).toEqual([80, true, 80]);
  expect(parseDiff('')).toEqual({ hunks: [], plus: 0, minus: 0, cut: false });
});
it('unchanged runs keep three lines around a change and fold the rest; a gap separates numbered hunks', () => {
  const ctx = (n: number) => Array.from({ length: n }, (_, i) => ` c${i}`).join('\n');
  const d = parseDiff(`@@ -1,12 +1,12 @@\n-a\n+b\n${ctx(10)}\n-y\n+z\n@@ -40,1 +40,1 @@\n-p\n+q`);
  const kinds = (shown: Set<string>) => diffRows(d, shown).map(r => r.kind === 'line' ? r.line.t : r.kind === 'fold' ? `fold${r.hidden}` : r.kind === 'gap' ? `gap${r.from}-${r.to}` : 'hunk');
  expect(kinds(new Set())).toEqual(['hunk', 'del', 'add', 'ctx', 'ctx', 'ctx', 'fold4', 'ctx', 'ctx', 'ctx', 'del', 'add', 'gap13-39', 'hunk', 'del', 'add']);
  const fold = diffRows(d, new Set()).find(r => r.kind === 'fold')!;
  expect(kinds(new Set([(fold as { key: string }).key])).filter(k => k === 'ctx')).toHaveLength(10);
});
```

```ts
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const edit = (id: string, s: number, turn: number, files: FileChange[], status: ToolItem['status'] = 'success'): ToolItem =>
  ({ kind: 'tool', id, at: at(s), turn, tool: files[0]?.from ? 'apply_patch' : 'Edit', label: files[0]!.path, status, files });
const items: ThreadItem[] = [
  edit('e1', 1, 1, [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }]),
  edit('e2', 2, 1, [{ path: '/w/ledge/docs/guide.md', change: 'write', diff: '+ # Guide\n+ Bonjour' }]),
  edit('e3', 3, 1, [{ path: '/w/ledge/src/gone.ts', change: 'edit' }], 'failed'),
  edit('e4', 4, 2, [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- c\n+ d\n+ e' }]),
  edit('e5', 5, 2, [{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-x\n+y' }]),
  edit('e6', 6, 2, [{ path: '/w/ledge/notes.ipynb', change: 'edit' }]),
  { ...edit('h1e', 7, 2, [{ path: '/w/ledge/src/helper.ts', change: 'add', diff: '+x' }]), helperId: 'h1' }
];
it('files of successful actions, first touched first, relative to the session folder, summed over their touches', () => {
  const files = changedFiles(items, '/w/ledge');
  expect(files.map(f => [f.shown, f.change, f.plus, f.minus, f.touches.map(t => `${t.tool.id}@${t.turn}`).join(',')])).toEqual([
    ['src/App.tsx', 'edit', 3, 2, 'e1@1,e4@2'],
    ['docs/guide.md', 'write', 2, 0, 'e2@1'],
    ['src/b.ts', 'rename', 1, 1, 'e5@2'],
    ['notes.ipynb', 'edit', 0, 0, 'e6@2']
  ]);
  expect(files[2]!.from).toBe('src/a.ts');
  expect(files[3]!.touches[0]!.diff).toBeNull();
  expect(changedFiles(items, '/w/ledge', 'h1').map(f => [f.shown, f.change])).toEqual([['src/helper.ts', 'add']]);
  expect([relativeTo('/w/ledge/src/a.ts', '/w/ledge'), relativeTo('/w/ledger/a.ts', '/w/ledge'), relativeTo('src/a.ts', '/w/ledge')]).toEqual(['src/a.ts', '/w/ledger/a.ts', 'src/a.ts']);
});
it('grouped by folder in order of appearance, the root as « . »', () => {
  expect(byFolder(changedFiles(items, '/w/ledge')).map(g => [g.dir, g.files.map(f => f.shown)])).toEqual([
    ['src', ['src/App.tsx', 'src/b.ts']], ['docs', ['docs/guide.md']], ['.', ['notes.ipynb']]
  ]);
});
```

L'ordre des dossiers : `src` (première action), puis `docs`, puis `.` ; `src/b.ts` rejoint `src`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter @paradow/ledge exec vitest run test/files.test.ts && pnpm --filter desktop exec vitest run test/session-diff.test.ts`
Expected : FAIL, `from` absent, `src/session/diff.ts` introuvable.

- [ ] **Step 3: Implémenter `from` (protocole et daemon), `diff.ts` et `changes.ts`**

Fonctions pures, sans React ni DOM.

- [ ] **Step 4: Vérifier que tout passe**

Run: `pnpm --filter @ledge/protocol test && pnpm --filter @paradow/ledge test && pnpm --filter desktop test && pnpm -r typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A packages/protocol packages/ledge apps/desktop/src/session apps/desktop/test/session-diff.test.ts
git commit -m "feat(desktop): the session's diffs and changed files: three diff shapes, folded unchanged lines, files by folder; a moved file names its old path

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Fil / Modifications

**Files:**
- Create: `apps/desktop/src/session/{Changes,DiffView}.tsx`, `apps/desktop/test/session-changes.test.tsx`
- Modify: `apps/desktop/src/session/{SessionPage,ActionGroup}.tsx`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 1 (`parseDiff`, `diffRows`, `changedFiles`, `byFolder`) ; lot 6a (`SessionPage`, `ActionGroup`, `useScreenKeys`, `notify`).
- Produces (dans la page) :

```ts
// session/DiffView.tsx
export function DiffView({ diff }: { diff: ParsedDiff }): JSX.Element;
// session/Changes.tsx
export function Changes(p: { files: readonly ChangedFile[]; current: string | null; onFile(path: string): void; onTouch(toolId: string): void;
  listOpen: boolean; onListOpen(open: boolean): void; session: Session; notify(text: string): void }): JSX.Element;
// SessionPage : view 'thread' | 'changes', file courant, showInThread(toolId), showChanges(path)
```

Rendu (`changes`, `fileList`, `DiffView`, `Line` de la maquette) :
- **Sélecteur** dans `.pane-heading`, avant `pane-meta` : `div.view-switch[role=tablist]` (`aria-label` = `t.session.views.label`), deux `button[role=tab]` (`id` `session-tab-thread` / `session-tab-changes`, `aria-selected`, `tabIndex` 0 / -1) avec leur icône, `views.thread` et `views.changes` suivi de `span.tab-count.mono` = nombre de fichiers ; ← / → sur un onglet passent à l'autre et le focalisent. `div.session-body` devient `role=tabpanel` `aria-labelledby` l'onglet actif (il garde son `aria-label` du lot 6a sur le fil).
- **Défilement** : quitter le fil retient sa position, y revenir la rend (sauf en venant d'un lien « tour N », qui vise l'action).
- **Vide** : `div.changes-empty` (icône, `strong` `empty`, `p.muted` `emptyCursor` pour une session Cursor, sinon `emptyBody(nom)`).
- **Liste** : `nav.file-list` (`open` quand `listOpen`, `aria-label` `t.session.changes.files`), `file-list-head` (`count(n)` et le total `+/−`), un `div.file-dir` par dossier (`dir-name` avec l'icône dossier, `title` = dossier), un `button.file-row` par fichier (`current` + `aria-current="true"`, `title` = chemin, `span.change-letter.change-${change}` avec `title` = `labels[change]` et la lettre A / M / D / R, `file-name` = nom, `+/−`) ; un choix ferme la liste étroite.
- **Fichier** : `file-head` : `button.file-list-toggle` (`aria-expanded`, `toggle(n)`), `file-title` (`change-badge.change-${change}` = libellé, `code` = `shown`, ou `${from} → ${shown}` renommé, `title` = chemin complet ; `+/−`), `file-actions` (« Copier le chemin » : `navigator.clipboard?.writeText(path)` puis `notify(copied(path))` même si le presse-papiers manque ; « Ouvrir dans l'éditeur » n'est pas rendu ; `file-pos` `i / n` ; précédent / suivant `Button outline size=icon` avec `aria-label` `prev` / `next` et `title` « (K) » / « (J) »), `file-touches` (`createdBy` si le fichier est ajouté, sinon `changedBy`, puis un `button.touch-link` par action `${tool} · ${turn(n)}` avec son `+/−`, puis `muted` `seeInThread`).
- **Diff** : `div.diff-scroll` ; pour chaque touche, dans l'ordre : un `div.diff-hunk.mono` `${tool} · ${turn(n)}` quand le fichier a plusieurs touches, puis `DiffView`, puis `p.muted.diff-cut` `cut` si elle est coupée ; aucune touche avec diff : `p.muted` `noDiff`. `DiffView` = `div.diff-view.mono[role=table][aria-label=t.session.changes.diff]` sur `diffRows` : `div.diff-line.${t}[role=row]` (`span.ln` ancien, `span.ln` nouveau, `span.sign` `+` / `−` / vide, `span.code` = texte ou une espace), `div.diff-hunk.mono` (`label` et `span.hunk-ctx`), `div.diff-gap` `gap(n, from, to)`, `button.diff-fold` `unfold(n)`.
- **J / K** (vue Modifications) : fichier suivant / précédent, en boucle. **Échap** : ferme la liste étroite si elle est ouverte.
- **Retour au fil** (`touch-link`) : vue Fil, le repli qui contient l'action se déplie, l'action vient au centre et prend `flash` 1,8 s.
- **Dans le fil** (`ActionRow`) : le `+/−` du premier fichier quand son diff est connu (`parseDiff`) ; `button.action-link` `seeChange` sur une action réussie qui touche un fichier, qui ouvre Modifications sur ce fichier (la tâche 3 le redirige vers le volet).

Textes français (`session.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `views.label` / `thread` / `changes` | `Vue de la session` / `Fil` / `Modifications` | `Session view` / `Thread` / `Changes` |
| `changes.files` / `count(n)` / `toggle(n)` | `Fichiers modifiés` / `${n} fichier(s)` / `Fichiers · ${n}` | `Changed files` / `${n} file(s)` / `Files · ${n}` |
| `changes.labels` / `letters` | `{ add: 'Ajouté', edit: 'Modifié', write: 'Réécrit', delete: 'Supprimé', rename: 'Renommé' }` / `{ add: 'A', edit: 'M', write: 'M', delete: 'D', rename: 'R' }` | `Added`, `Modified`, `Rewritten`, `Deleted`, `Renamed` / idem |
| `changes.empty` / `emptyCursor` / `emptyBody(n)` | `Aucun fichier modifié` / `Cursor Agent ne transmet pas les fichiers qu’il touche.` / `${n} n’a encore rien modifié dans cette session.` | `No file changed` / `Cursor Agent does not report the files it touches.` / `${n} has not changed anything in this session yet.` |
| `changes.copy` / `copied(p)` | `Copier le chemin` / `Chemin copié : ${p}` | `Copy the path` / `Path copied: ${p}` |
| `changes.prev` / `next` | `Fichier précédent` / `Fichier suivant` | `Previous file` / `Next file` |
| `changes.createdBy` / `changedBy` / `turn(n)` / `seeInThread` | `Créé par` / `Modifié par` / `tour ${n}` / `· voir dans le fil` | `Created by` / `Changed by` / `turn ${n}` / — |
| `changes.diff` / `gap(n, a, b)` / `unfold(n)` | `Différences` / `⋯ ${n} ligne(s) non modifiée(s) (lignes ${a}–${b})` / `Afficher ${n} ligne(s) inchangée(s)` | `Differences` / — / `Show ${n} unchanged line(s)` |
| `changes.cut` / `noDiff` | `Diff limité aux 80 premières lignes.` / `Ce fichier n’a pas de différence enregistrée.` | `Diff limited to the first 80 lines.` / `This file has no recorded difference.` |
| `thread.seeChange` | `Voir la modification` | `View the change` |

- [ ] **Step 1: Écrire `test/session-changes.test.tsx`**

```tsx
const tab = (name: RegExp) => screen.getByRole('tab', { name });
const pane = () => document.querySelector<HTMLElement>('.file-pane')!;
const more: ThreadItem[] = [
  { kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/docs/guide.md', status: 'success', files: [{ path: '/w/ledge/docs/guide.md', change: 'write', diff: '+ # Guide\n+ Bonjour' }] },
  { kind: 'tool', id: 'e9', at: new Date().toISOString(), turn: 2, tool: 'Edit', label: '/w/ledge/src/App.tsx', status: 'success', files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- c\n+ d' }] }
];
async function openOtto(extra: ThreadItem[] = more, tool: Session['tool'] = 'claude') {
  const env = await boot({ sessions: listSessions().map(s => (s.name === 'Otto' ? { ...s, tool } : s)), list: true });
  env.d.thread('otto', [...ottoThread(), ...extra]);
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  return env;
}

it('Thread / Changes with the count; files grouped by folder; the diff with its signs', async () => {
  const { user } = await openOtto();
  expect(tab(/^Changes/)).toHaveTextContent('Changes2');
  await user.click(tab(/^Changes/));
  expect(tab(/^Changes/)).toHaveAttribute('aria-selected', 'true');
  const list = within(screen.getByRole('navigation', { name: 'Changed files' }));
  expect([...document.querySelectorAll('.dir-name')].map(e => e.textContent)).toEqual(['src', 'docs']);
  expect(list.getByRole('button', { name: /App\.tsx/ })).toHaveAttribute('aria-current', 'true');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  expect(within(pane()).getByText('Changed by')).toBeVisible();
  expect([...pane().querySelectorAll('.touch-link')].map(e => e.textContent)).toEqual(['Edit · turn 1+1−1', 'Edit · turn 2+1−1']);
  expect([...pane().querySelectorAll('.diff-line')].map(r => r.className.replace('diff-line ', '') + ':' + r.querySelector('.code')!.textContent)).toEqual(['del:a', 'add:b', 'del:c', 'add:d']);
});
it('J / K walk the files, never while typing; Copy the path says so', async () => {
  const { user } = await openOtto();
  await user.click(tab(/^Changes/));
  await user.keyboard('j');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('docs/guide.md');
  expect(within(pane()).getByText('2 / 2')).toHaveClass('file-pos');
  await user.click(screen.getByRole('textbox', { name: 'Reply to the agent' }));
  await user.keyboard('k');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('docs/guide.md');
  (document.activeElement as HTMLElement).blur();
  await user.keyboard('k');
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  await user.click(within(pane()).getByRole('button', { name: 'Copy the path' }));
  expect(screen.getByText('Path copied: /w/ledge/src/App.tsx')).toBeVisible();     // the live line is a status too
});
it('« turn 2 » goes back to the action in the thread and flashes it; « View the change » opens the file', async () => {
  const { user } = await openOtto();
  await user.click(tab(/^Changes/));
  await user.click(within(pane()).getByRole('button', { name: /^Edit · turn 2/ }));
  expect(tab(/^Thread/)).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('[data-tool="e9"]')).toHaveClass('flash');
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="e9"]')!).getByRole('button', { name: 'View the change' }));
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
});
it('a file without a diff, a cut diff, a renamed file', async () => {
  const { user } = await openOtto([
    { kind: 'tool', id: 'n1', at: new Date().toISOString(), turn: 2, tool: 'NotebookEdit', label: '/w/ledge/a.ipynb', status: 'success', files: [{ path: '/w/ledge/a.ipynb', change: 'edit' }] },
    { kind: 'tool', id: 'c1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/big.txt', status: 'success', files: [{ path: '/w/ledge/big.txt', change: 'write', diff: [...Array.from({ length: 80 }, (_, i) => `+ l${i}`), '…'].join('\n') }] },
    { kind: 'tool', id: 'r1', at: new Date().toISOString(), turn: 2, tool: 'apply_patch', label: 'src/b.ts', status: 'success', files: [{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-x\n+y' }] }
  ]);
  await user.click(tab(/^Changes/));
  const list = within(screen.getByRole('navigation', { name: 'Changed files' }));
  await user.click(list.getByRole('button', { name: /a\.ipynb/ }));
  expect(within(pane()).getByText('This file has no recorded difference.')).toBeVisible();
  await user.click(list.getByRole('button', { name: /big\.txt/ }));
  expect(within(pane()).getByText('Diff limited to the first 80 lines.')).toBeVisible();
  await user.click(list.getByRole('button', { name: /b\.ts/ }));
  expect(pane().querySelector('.file-title code')).toHaveTextContent('src/a.ts → src/b.ts');
  expect(list.getByRole('button', { name: /b\.ts/ }).querySelector('.change-letter')).toHaveTextContent('R');
});
it('nothing changed: said plainly, and Cursor named as the one that does not tell', async () => {
  const { user } = await openOtto([], 'cursor');
  await user.click(tab(/^Changes/));
  expect(screen.getByText('Cursor Agent does not report the files it touches.')).toBeVisible();
});
```

`ottoThread()` (lot 6a) a une seule action d'écriture réussie (`t3`, `src/App.tsx`, `- a\n+ b`) ; `more` en ajoute deux. Dans le cas Cursor, `ottoThread` touche encore `src/App.tsx` : l'implémenteur passe un fil sans `t3` (`ottoThread().filter(i => i.id !== 't3')`).

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/session-changes.test.tsx`
Expected : FAIL, pas d'onglet « Changes ».

- [ ] **Step 3: Implémenter le sélecteur, `Changes`, `DiffView`, J / K, le retour au fil et « Voir la modification »**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/session-changes.test.tsx
git commit -m "feat(desktop): Thread / Changes: files by folder, the diff with folded unchanged lines, J / K, copy the path, back to the action in the thread

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: La lecture côte à côte

**Files:**
- Create: `apps/desktop/src/session/SidePane.tsx`, `apps/desktop/src/session/useDocument.ts`, `apps/desktop/test/session-pane.test.tsx`
- Modify: `apps/desktop/src/session/{SessionPage,Thread,ActionGroup}.tsx`, `apps/desktop/src/session/thread.ts` (`docRefs`), `apps/desktop/src/App.tsx` (le `split` vers la page), `packages/fleet/test/mockDaemon.ts`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 2 (`DiffView`, `changedFiles`) ; lot 6a (`SessionPrefs.split`, `SPLIT_MIN`, `SPLIT_MAX`, `MarkdownDocument`, `splitMarkdownFrontmatter`, `findDocumentReferences`) ; `DaemonClient.onMessage`, `.status`.
- Produces :

```ts
// session/SidePane.tsx
export type PaneTab = { kind: 'doc'; path: string } | { kind: 'diff'; path: string } | { kind: 'plan'; key: string };   // plan : tâche 4
export const tabId: (t: PaneTab) => string;                                     // `${kind}:${path | key}`
export function SidePane(p: { tabs: readonly PaneTab[]; active: string; onActive(id: string): void; onClose(id: string): void;
  split: number; onSplit(v: number): void; onAllChanges(path: string): void; session: Session; files: readonly ChangedFile[]; client: DaemonClient }): JSX.Element;

// session/useDocument.ts
export type DocState = { status: 'loading' } | { status: 'ready'; text: string; title?: string } | { status: 'error'; code: DocumentErrorCode | 'offline' | 'timeout' };
export const DOCUMENT_TIMEOUT_MS = 10_000;
/** `document.read` corrélé par requestId (useDocumentReader de l'overlay, réduit à un document) ; hors ligne : erreur 'offline' sans envoi. */
export function useDocument(client: DaemonClient, sessionId: string, path: string, online: boolean): DocState;

// session/thread.ts
/** Les fichiers Markdown qu'un message nomme ou lie (findDocumentReferences), distincts, dans l'ordre, trois au plus. */
export function docRefs(text: string): string[];

// SessionPage gagne : split: number; onSplit(v: number): void;   // App les lit et les écrit dans desktop.session

// packages/fleet/test/mockDaemon.ts
documents: Map<string, string>;   // `document.read` : document.content si le chemin y est, document.error 'not_found' sinon
```

Comportement (`sidePane`, `paneDoc`, `dragSplit`, `openTab`, `closeTab` de la maquette) :
- **Ouvrir** : un lien de document dans un message (`ThreadMarkdown` `onDocument`), une carte de document, « Voir la modification » (désormais vers le volet) et « Lire le plan » (tâche 4) ouvrent un onglet, ou activent celui qui existe ; depuis Modifications, la vue repasse au Fil.
- **Cartes** : sous un message ou une réponse, un `button.document-card` par chemin de `docRefs` (icône fichier, `strong` = nom, `small.mono` = chemin, `span.doc-open` `read` + chevron).
- **Volet** : `aside.side-pane` (`aria-label` `t.session.pane.label`, `--split`) à droite du fil, `session-split.has-pane` ; `div.pane-tabs[role=tablist]` (`aria-label` `tabs`) quand il y a plus d'un onglet, chaque `div.pane-tab` avec `button[role=tab]` (icône, libellé, `title` = chemin) et `button.tab-close` (`aria-label` `closeTab(libellé)`) ; `div.side-head` : `span.side-title` (`strong` titre, `code` chemin), `Button ghost sm.side-grow` (`grow` / `shrink`, `title` `growTitle` / `shrinkTitle`, bascule 0.65 ↔ 0.5), `Button ghost sm.side-close` (`aria-label` `closeTitle`, `title` `closeShort`, `span` `close`) ; `div.side-body`.
- **Document** : `useDocument` ; `p.muted` `reading`, ou l'erreur (`errors[code]`, `errors.other` pour un code non listé), ou `MarkdownDocument`. Titre : le `title` du front matter, sinon le nom du fichier ; libellé : le nom ; chemin : le chemin.
- **Modification** : `div.side-diff` (`side-diff-head` : `change-badge`, `+/−`, `file-pos`, `Button ghost sm` `allChanges` qui ouvre Modifications sur ce fichier), puis `diff-scroll` et les diffs du fichier comme à la tâche 2 ; fichier inconnu : `noDiff`. Titre `diffTitle(nom)`, libellé `diffLabel(nom)`.
- **Séparateur** : `div.split-handle[role=separator][aria-orientation=vertical]` (`aria-label` `resize`, `tabIndex=0`) ; tirer (capture du pointeur) pose `split = (droite − x) / largeur` ; ← / → ±0.03 ; double-clic 0.5 ; toujours borné à `[SPLIT_MIN, SPLIT_MAX]` et écrit dans `desktop.session`.
- **Étroit** : la hauteur de la zone de réponse est suivie (`--reply-h`, `ResizeObserver`) pour que le volet par-dessus le fil s'arrête au-dessus d'elle (CSS de la maquette).
- **Échap** : l'onglet actif se ferme (après la liste des fichiers, tâche 2) ; le voisin devient actif. **J / K**, onglet de modification actif et vue Fil : l'onglet passe au fichier suivant / précédent (en place).

Textes français (`session.pane.*`, `session.thread.read`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `label` / `tabs` / `closeTab(l)` | `Volet de lecture` / `Documents ouverts` / `Fermer ${l}` | `Reading pane` / `Open documents` / `Close ${l}` |
| `grow` / `shrink` / `growTitle` / `shrinkTitle` | `Agrandir` / `Réduire` / `Agrandir le volet (65 %)` / `Réduire le volet (50 %)` | `Enlarge` / `Shrink` / — |
| `close` / `closeTitle` / `closeShort` | `Fermer` / `Fermer le volet (Échap)` / `Fermer (Échap)` | `Close` / `Close the pane (Esc)` / — |
| `resize` / `allChanges` | `Redimensionner le volet` / `Toutes les modifications` | `Resize the pane` / `All changes` |
| `diffTitle(f)` / `diffLabel(f)` | `Modification · ${f}` / `± ${f}` | `Change · ${f}` / `± ${f}` |
| `reading` | `Lecture du document…` | `Reading the document…` |
| `errors` | `{ not_found: 'Document introuvable.', too_large: 'Document trop volumineux (1 Mo au plus).', offline: 'La machine est hors ligne : le document ne peut pas être lu.', timeout: 'Le document n’est pas arrivé à temps.', other: 'Le document n’a pas pu être lu.' }` | `Document not found.`, `Document too large (1 MB at most).`, `The machine is offline: the document cannot be read.`, `The document did not arrive in time.`, `The document could not be read.` |
| `thread.read` | `Lire` | `Read` |

- [ ] **Step 1: Écrire les tests**

`session-pane.test.tsx` :

```tsx
const side = () => within(screen.getByRole('complementary', { name: 'Reading pane' }));
const withDoc: ThreadItem[] = [{ kind: 'reply', id: 'reply-2', at: new Date().toISOString(), turn: 2, text: 'Le guide est dans [docs/guide.md](docs/guide.md).' }];
async function openOtto(extra: ThreadItem[] = withDoc) {
  const env = await boot({ sessions: listSessions(), list: true });
  env.d.thread('otto', [...ottoThread(), ...extra]);
  env.d.documents.set('docs/guide.md', '---\ntitle: Guide de Ledge\n---\n# Guide\n\nBonjour.');
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  return env;
}

it('a document link opens beside the thread; the thread stays usable; Escape closes the tab, then leaves the page', async () => {
  const { user } = await openOtto();
  await user.click(screen.getByRole('link', { name: 'docs/guide.md' }));
  expect(await side().findByText('Bonjour.')).toBeVisible();
  expect(side().getByText('Guide de Ledge')).toBeVisible();
  expect(side().getByText('docs/guide.md', { selector: 'code' })).toBeVisible();
  await user.click(screen.getByRole('textbox', { name: 'Reply to the agent' }));
  await user.keyboard('ok');
  expect(screen.getByRole('textbox', { name: 'Reply to the agent' })).toHaveValue('ok');
  (document.activeElement as HTMLElement).blur();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('complementary', { name: 'Reading pane' })).toBeNull();
  expect(document.querySelector('.session-page')).not.toBeNull();
  await user.keyboard('{Escape}');
  expect(document.querySelector('.session-page')).toBeNull();
});
it('a document card under the message; several items become closable tabs; « View the change » opens a diff tab J / K walk', async () => {
  const { user } = await openOtto([...withDoc, { kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/docs/guide.md', status: 'success', files: [{ path: '/w/ledge/docs/guide.md', change: 'write', diff: '+ # Guide' }] }]);
  await user.click(screen.getByRole('button', { name: /guide\.md.*Read/ }));
  await user.click(screen.getByRole('button', { name: /^3 actions/ }));
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="t3"]')!).getByRole('button', { name: 'View the change' }));
  expect(side().getAllByRole('tab').map(t => t.textContent)).toEqual(['guide.md', '± App.tsx']);
  expect(side().getByRole('tab', { name: '± App.tsx' })).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('j');
  expect(side().getByRole('tab', { name: '± guide.md' })).toHaveAttribute('aria-selected', 'true');
  await user.click(side().getByRole('button', { name: 'Close ± guide.md' }));
  expect(side().queryAllByRole('tab')).toHaveLength(0);                              // one tab left: no tab bar
  expect(side().getByText('Guide de Ledge')).toBeVisible();
});
it('Enlarge and the keyboard on the handle move the split, bounded and remembered', async () => {
  const { user } = await openOtto();
  await user.click(screen.getByRole('link', { name: 'docs/guide.md' }));
  await user.click(side().getByRole('button', { name: /^Enlarge/ }));
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.65);
  screen.getByRole('separator', { name: 'Resize the pane' }).focus();
  await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.72);
  await user.dblClick(screen.getByRole('separator', { name: 'Resize the pane' }));
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.5);
});
it('a document that does not come says why, and Escape closes its tab', async () => {
  const { user } = await openOtto([{ kind: 'reply', id: 'reply-2', at: new Date().toISOString(), turn: 2, text: 'Voir [le plan](docs/absent.md).' }]);
  await user.click(screen.getByRole('link', { name: 'le plan' }));
  expect(await side().findByText('Document not found.')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('complementary', { name: 'Reading pane' })).toBeNull();
});
```

Le dernier pas du test « « turn 2 » goes back… » de la tâche 2 vérifie désormais l'onglet du volet : `expect(within(screen.getByRole('complementary', { name: 'Reading pane' })).getByText('Change · App.tsx')).toBeVisible()`.

Le pas de 0.03 : 0.65 → 0.68 → 0.71 → 0.72 (borne). `useDocument` est aussi testé seul (`renderHook` sur un `client` factice) : `'offline'` sans envoi quand `online` est faux, `'timeout'` après `DOCUMENT_TIMEOUT_MS`, une réponse d'un autre `requestId` ignorée, `'too_large'` rendu tel quel.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/session-pane.test.tsx`
Expected : FAIL, aucun volet.

- [ ] **Step 3: Implémenter `useDocument`, `SidePane`, les cartes, les onglets, le séparateur, Échap et J / K, et les documents du faux daemon**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter @ledge/fleet test`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test packages/fleet/test/mockDaemon.ts
git commit -m "feat(desktop): side-by-side reading: documents and changes in closable tabs beside the thread, a resizable remembered split, Escape and J / K

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Les plans

**Files:**
- Create: `apps/desktop/src/session/PlanCard.tsx`, `apps/desktop/test/session-plans.test.tsx`
- Modify: `apps/desktop/src/session/thread.ts`, `apps/desktop/test/session-thread.test.ts`, `apps/desktop/src/session/{Thread,SidePane,PendingCard,SessionPage}.tsx`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 3 (`PaneTab` `plan`, `openTab`) ; lot 6a (`PendingCard`, `decisions`).
- Produces :

```ts
// session/thread.ts
export interface PlanDoc { key: string; title: string; markdown: string; steps: string[]; status: 'proposed' | 'approved' | 'revised' }
/** Les étapes numérotées (stepsOf de la maquette : `1. **Titre** — suite` → « Titre », `2. Suite` → « Suite »). */
export function stepsOf(markdown: string): string[];
/** La première ligne non vide, sans ses `#` ni espaces de tête. */
export function planTitle(markdown: string): string;
/** Une action ExitPlanMode : le plan de son entrée (JSON `{ plan }`), key = id ; running → proposed, success → approved, failed / unknown → revised. null sinon. */
export function planOf(t: ToolItem): PlanDoc | null;
/** Le plan d'une demande `plan` (body, sinon text), key 'pending', proposed — Codex et Cursor n'ont pas d'action ExitPlanMode. */
export function pendingPlan(p: Pending): PlanDoc | null;
// Segment gagne : { kind: 'plan'; item: ToolItem; plan: PlanDoc }   — une action ExitPlanMode sort de son repli
```

Rendu (la carte de `renderItem`, le plan de `sidePane`, `pendingCard` de la maquette) :
- **Carte** (`PlanCard`) : `div.plan-card.status-${status}[data-plan-card]` : `plan-card-head` (icône plan, `plan-kicker` `kicker`, `strong` titre, `plan-status.${status}` `statuses[status]`), `plan-intro` (première ligne qui n'est pas un titre, en `ThreadMarkdown`), `ol.plan-steps` (trois étapes, puis `li.more` `more(n)`), `plan-card-foot` (`muted` `steps(n)`, `Button outline sm` `readPlan`, ou `secondary` `openBeside` quand son onglet est actif) qui ouvre l'onglet `{ kind: 'plan', key }`.
- **Pastille** : une permission `ExitPlanMode` décidée devient `div.decision-chip.plan.${decision}` : `✓` `approved` (accept), `✓` `approvedAuto` (always), `↺` `toRevise` (deny), `strong` = texte.
- **Onglet** : titre = titre du plan, chemin `by(nom)`, libellé `tab(titre)` ; `div.plan-doc.status-${status}` (`plan-doc-status` : le statut et, s'il est proposé et que c'est la demande en cours, `muted` `answerHint` avec `Kbd Y` et `Kbd N`), puis `MarkdownDocument`. La clé `pending` ouvre `pendingPlan(session.pending)`.
- **Demande épinglée** (plan) : titre `plan(nom, planTitle(body ?? text))` ; `p.pending-summary` `summary(n, étapes)` (quatre étapes jointes par ` · `, ` …` au-delà) et `button.action-link` `readPlan`, qui ouvre la carte du fil dont l'action ExitPlanMode tourne, sinon `pending`.

Textes français (`session.plan.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `kicker` / `statuses` | `Plan proposé` / `{ proposed: 'En attente de votre accord', approved: 'Approuvé', revised: 'Révisé ensuite' }` | `Proposed plan` / `Awaiting your approval`, `Approved`, `Revised afterwards` |
| `more(n)` / `steps(n)` | `… et ${n} autre étape` / `… et ${n} autres étapes` ; `${n} étape(s)` | `… and 1 more step` / `… and ${n} more steps` ; `${n} step(s)` |
| `readPlan` / `openBeside` | `Lire le plan` / `Ouvert à côté` | `Read the plan` / `Open beside` |
| `approved` / `approvedAuto` / `toRevise` | `Plan approuvé` / `Plan approuvé · modifications acceptées automatiquement` / `Plan à revoir` | `Plan approved` / `Plan approved · edits accepted automatically` / `Plan to revise` |
| `by(n)` / `tab(t)` / `answerHint` | `Plan proposé par ${n}` / `Plan · ${t}` / `Répondez sous le fil : Y approuver · N continuer à planifier` | `Plan proposed by ${n}` / `Plan · ${t}` / — |
| `summary(n, s)` | `${n} étape(s) : ${s}` | `${n} step(s): ${s}` |

- [ ] **Step 1: Écrire les tests**

Dans `session-thread.test.ts` :

```ts
const md = '# Plan : version 0.6.0\n\nPréparer la release.\n\n1. **Changelog** — résumer\n2. Monter les versions\n3. Construire\n4. Publier';
const exit = (id: string, status: ToolItem['status']): ToolItem => ({ kind: 'tool', id, at: T0, turn: 3, tool: 'ExitPlanMode', label: '# Plan : version 0.6.0', input: JSON.stringify({ plan: md }, null, 2), status, files: [] });
it('a plan from ExitPlanMode: title, steps, status from the action', () => {
  expect(planOf(exit('p1', 'running'))).toEqual({ key: 'p1', title: 'Plan : version 0.6.0', markdown: md, steps: ['Changelog', 'Monter les versions', 'Construire', 'Publier'], status: 'proposed' });
  expect([planOf(exit('p1', 'success'))!.status, planOf(exit('p1', 'failed'))!.status, planOf(exit('p1', 'unknown'))!.status]).toEqual(['approved', 'revised', 'revised']);
  expect(planOf({ ...exit('p1', 'running'), tool: 'Bash' })).toBeNull();
  expect(pendingPlan({ kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'pane' })).toMatchObject({ key: 'pending', status: 'proposed', steps: ['Changelog', 'Monter les versions', 'Construire', 'Publier'] });
});
it('ExitPlanMode leaves its run as a plan segment', () => {
  const xs = exchanges([{ kind: 'prompt', id: 'prompt-3', at: T0, turn: 3, text: 'Prépare la 0.6' }, { ...exit('r', 'success'), id: 'r', tool: 'Read', label: 'a' }, exit('p1', 'running')]);
  expect(xs[0]!.segments.map(s => s.kind)).toEqual(['tools', 'plan']);
});
```

`session-plans.test.tsx` :

```tsx
it('the plan card in the thread, read beside; the pinned plan sums it up and approves with Y', async () => {
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [{ kind: 'prompt', id: 'prompt-1', at: new Date().toISOString(), turn: 1, text: 'Prépare la 0.6' }, exit('p1', 'running')]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  const plan = within(await screen.findByText('Proposed plan').then(e => e.closest<HTMLElement>('.plan-card')!));
  expect(plan.getByText('Awaiting your approval')).toBeVisible();
  expect([...document.querySelectorAll('.plan-steps li')].map(e => e.textContent)).toEqual(['Changelog', 'Monter les versions', 'Construire', '… and 1 more step']);
  const pinned = within(screen.getByRole('region', { name: 'Plan to approve' }));
  expect(pinned.getByText('Pia proposes a plan · Plan : version 0.6.0')).toBeVisible();
  expect(pinned.getByText(/^4 steps: Changelog · Monter les versions · Construire · Publier/)).toBeVisible();
  await user.click(pinned.getByRole('button', { name: 'Read the plan' }));
  const side = within(screen.getByRole('complementary', { name: 'Reading pane' }));
  expect(side.getByText('Plan proposed by Pia')).toBeVisible();
  expect(plan.getByRole('button', { name: /Open beside/ })).toBeVisible();
  await user.keyboard('y');
  await waitFor(() => expect(d.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'accept' }]));
});
it('keep planning with a note: the old card is revised, the new one and the pinned request follow it', async () => {
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [exit('p1', 'running')]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await user.type(await screen.findByRole('textbox', { name: 'Reply to the agent' }), 'Sans la publication{Enter}');
  await waitFor(() => expect(d.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'deny', note: 'Sans la publication' }]));
  const v2 = md.replace('# Plan : version 0.6.0', '# Plan : version 0.6.0 (révisé)').replace('\n4. Publier', '');
  d.threadItem('pia', { ...exit('p1', 'failed') });
  d.threadItem('pia', { ...exit('p2', 'running'), input: JSON.stringify({ plan: v2 }) });
  d.upsert({ ...pia, pending: { kind: 'plan', text: '# Plan : version 0.6.0 (révisé)', body: v2, source: 'hook' }, lastActivityAt: new Date().toISOString() });
  await waitFor(() => expect([...document.querySelectorAll('.plan-card')].map(c => c.querySelector('.plan-status')!.textContent)).toEqual(['Revised afterwards', 'Awaiting your approval']));
  expect(screen.getByRole('region', { name: 'Plan to approve' })).toHaveTextContent('Pia proposes a plan · Plan : version 0.6.0 (révisé)');
  await user.click(within(screen.getByRole('region', { name: 'Plan to approve' })).getByRole('button', { name: 'Read the plan' }));
  expect(within(screen.getByRole('complementary', { name: 'Reading pane' })).getByText('Plan : version 0.6.0 (révisé)', { selector: 'strong' })).toBeVisible();
});
it('a decided plan is a chip', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  d.thread('otto', [...ottoThread(), { kind: 'permission', id: 'perm-plan', at: new Date().toISOString(), turn: 2, tool: 'ExitPlanMode', text: '# Plan : version 0.6.0', decision: 'always' }]);
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  expect(document.querySelector('.decision-chip.plan.always')).toHaveTextContent('✓Plan approved · edits accepted automatically# Plan : version 0.6.0');
});
```

`md` et `exit` sont recopiés en tête de `session-plans.test.tsx`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/session-thread.test.ts test/session-plans.test.tsx`
Expected : FAIL, `planOf` introuvable.

- [ ] **Step 3: Implémenter les plans du modèle, `PlanCard`, l'onglet de plan, la pastille et le résumé épinglé**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): plans: a card in the thread read beside, the pinned plan summed up, approved or sent back with a note, decided plans as chips

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: La liste de tâches

**Files:**
- Create: `apps/desktop/src/session/todos.ts`, `apps/desktop/src/session/TodoBar.tsx`, `apps/desktop/test/session-todos.test.ts(x)`
- Modify: `apps/desktop/src/session/thread.ts`, `apps/desktop/src/session/{Thread,ActionGroup,SessionPage}.tsx`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : lot 6a (`exchanges`, `summarize`, `ActionGroup`, `SPINNER`).
- Produces :

```ts
// session/todos.ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export interface Todo { text: string; status: TodoStatus }
export const TODO_TOOLS: ReadonlySet<string>;              // TodoWrite (Claude Code), update_plan (Codex)
/** L'entrée de l'action (JSON) : TodoWrite `{ todos: [{ content, status, activeForm }] }` (en cours : activeForm, sinon content) ;
 *  update_plan `{ plan: [{ step, status }] }`. Un statut inconnu compte comme pending ; JSON illisible, liste vide ou autre outil : null. */
export function todosOf(t: ToolItem): Todo[] | null;
/** La dernière liste du fil affiché (principal ou d'un sous-agent) ; null quand il n'y en a pas (Cursor, ou un agent qui n'en tient pas). */
export function latestTodos(items: readonly ThreadItem[], helperId?: string): Todo[] | null;

// session/thread.ts — le segment d'actions gagne :
{ kind: 'tools'; key: string; tools: ToolItem[]; todos: ToolItem[] }   // les mises à jour de liste ne sont pas des actions
// Summary gagne : todos: number
```

Règles (`segments`, `Summary`, `todoBar` de la maquette) :
- une action de `TODO_TOOLS` rejoint `todos` du repli où elle tombe (un repli peut n'en contenir que) ; elle ne compte ni dans `count` ni dans les durées ;
- le résumé d'un repli sans action dit `workPlanUpdated` ; avec des actions, `· ${updated}` suivi de ` ×n` quand n > 1 ; déplié, chaque mise à jour est une `div.action-row.todo-row` (`☰`, `verb` = `workPlan`, cible `doneOf(fait, total)` puis ` · ${inProgress(texte)}` s'il y en a une) ;
- **barre** (`TodoBar`) en tête du fil quand `latestTodos` n'est pas null : `div.todo-bar` (`open`), `button.todo-head` (`aria-expanded`, icône plan, `strong` `workPlan`, `span.mono.todo-count` `fait/total`, `span.todo-progress > i` à la largeur du ratio, `span.todo-current` : point et texte de la tâche en cours, sinon `allDone` ou `paused`, chevron) ; dépliée, `ol.todo-list` (`li.${status}` avec `span.todo-box` `aria-label` `boxes[status]` : ✓, le spinner, rien) ;
- **Échap** referme la barre dépliée (après la liste des fichiers, avant l'onglet du volet).

Textes français (`session.todos.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `workPlan` / `workPlanUpdated` / `updated` | `Plan de travail` / `Plan de travail mis à jour` / `plan de travail mis à jour` | `Work plan` / `Work plan updated` / `work plan updated` |
| `allDone` / `paused` | `Tout est fait` / `En pause` | `All done` / `Paused` |
| `doneOf(d, n)` / `inProgress(t)` | `${d}/${n} faites` / `en cours : ${t}` | `${d}/${n} done` / `in progress: ${t}` |
| `boxes` | `{ completed: 'Fait', in_progress: 'En cours', pending: 'À faire' }` | `Done`, `In progress`, `To do` |

- [ ] **Step 1: Écrire les tests**

```ts
const todo = (id: string, todos: unknown, tool = 'TodoWrite'): ToolItem => ({ kind: 'tool', id, at: T0, turn: 1, tool, label: tool, input: JSON.stringify(todos, null, 2), status: 'success', files: [] });
const v1 = todo('d1', { todos: [{ content: 'Lire', status: 'completed', activeForm: 'Lecture' }, { content: 'Écrire', status: 'in_progress', activeForm: 'Écriture des tests' }, { content: 'Publier', status: 'pending', activeForm: 'Publication' }] });
it('a Claude TodoWrite and a Codex update_plan read as the same list; anything else is no list', () => {
  expect(todosOf(v1)).toEqual([{ text: 'Lire', status: 'completed' }, { text: 'Écriture des tests', status: 'in_progress' }, { text: 'Publier', status: 'pending' }]);
  expect(todosOf(todo('u1', { plan: [{ step: 'Monter', status: 'completed' }, { step: 'Construire', status: 'weird' }] }, 'update_plan'))).toEqual([{ text: 'Monter', status: 'completed' }, { text: 'Construire', status: 'pending' }]);
  expect([todosOf({ ...v1, input: '{oops' }), todosOf(todo('e', { todos: [] })), todosOf({ ...v1, tool: 'Bash' })]).toEqual([null, null, null]);
});
it('the latest list wins; a subagent keeps its own; none without updates', () => {
  const v2 = todo('d2', { todos: [{ content: 'Lire', status: 'completed' }, { content: 'Écrire', status: 'completed' }] });
  expect(latestTodos([v1, v2])).toEqual([{ text: 'Lire', status: 'completed' }, { text: 'Écrire', status: 'completed' }]);
  expect(latestTodos([v1, { ...v2, helperId: 'h1' }])).toEqual(todosOf(v1));
  expect(latestTodos([v1, { ...v2, helperId: 'h1' }], 'h1')).toEqual(todosOf(v2));
  expect(latestTodos([])).toBeNull();
});
it('list updates are not actions: they fold into the summary', () => {
  const read: ToolItem = { kind: 'tool', id: 'r', at: T0, turn: 1, tool: 'Read', label: 'a', status: 'success', durationMs: 100, files: [] };
  const [x] = exchanges([v1, read, { ...v1, id: 'd2' }]);
  expect(x!.segments).toEqual([{ kind: 'tools', key: 'tools-d1', tools: [read], todos: [v1, { ...v1, id: 'd2' }] }]);
  expect(summarize([read], 0, true).count).toBe(1);
});
```

et, dans `session-todos.test.tsx`, sur la page d'Otto avec `v1` ajouté à son fil :

```tsx
it('the work plan sits on top of the thread and unfolds as a checklist; Escape folds it back first', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  d.thread('otto', [...ottoThread(), { ...v1, at: new Date().toISOString(), turn: 2 }]);
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  const head = await screen.findByRole('button', { name: /^Work plan/ });
  expect(head).toHaveTextContent('1/3');
  expect(head).toHaveTextContent('Écriture des tests');
  await user.click(head);
  expect([...document.querySelectorAll('.todo-list li')].map(li => [li.className, li.textContent])).toEqual([['completed', '✓Lire'], ['in_progress', expect.stringContaining('Écriture des tests')], ['pending', 'Publier']]);
  await user.keyboard('{Escape}');
  expect(head).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('.session-page')).not.toBeNull();
});
it('no list, no bar', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  d.thread('otto', ottoThread());
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  expect(document.querySelector('.todo-bar')).toBeNull();
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/session-todos.test.ts test/session-todos.test.tsx test/session-thread.test.ts`
Expected : FAIL, `todosOf` introuvable.

- [ ] **Step 3: Implémenter `todos.ts`, le repli des mises à jour, `TodoBar` et Échap**

Les tests de `session-thread.test.ts` du lot 6a qui comparent des segments d'actions reçoivent `todos: []`.

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): the agent's work plan from TodoWrite / update_plan: a bar on top of the thread, a checklist, earlier updates folded into the summary

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: La relecture dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/session-review.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts` (`document.read` servi depuis `extras.documents`)

**Interfaces:**
- Consumes : tout ce qui précède ; `fakeDaemon` (avec `threads`, `item`, `preview` du lot 6a), `fleet`, `ottoThread`.
- Produces : rien de neuf.

Données du fichier :
- `review` = `ottoThread` augmenté de deux écritures (`src/App.tsx` à nouveau et `docs/guide.md`), d'une action `Write` sur `wide.ts` dont une ligne fait 400 caractères, d'une réponse qui lie `docs/guide.md`, et d'une mise à jour `TodoWrite` ;
- `documents` = `{ 'docs/guide.md': '# Guide\n\nBonjour.' }`.

- [ ] **Step 1: Écrire `session-review.spec.ts`**

```ts
const open = async (page: Page) => { await page.getByRole('tab', { name: 'List' }).click(); await page.getByRole('listitem', { name: /^Otto,/ }).click(); };

test('Changes: J / K walk the files; a 400-character line scrolls in the diff only', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  await page.getByRole('tab', { name: /^Changes/ }).click();
  await page.keyboard.press('j'); await page.keyboard.press('j');
  await expect(page.locator('.file-title code')).toHaveText('wide.ts');
  expect(await page.locator('.diff-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.locator('.session-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
test('the pane beside the thread: dragging the handle resizes it, the thread keeps 440 px, the width survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  await page.getByRole('link', { name: 'docs/guide.md' }).click();
  await expect(page.getByRole('complementary', { name: 'Reading pane' }).getByText('Bonjour.')).toBeVisible();
  const handle = page.getByRole('separator', { name: 'Resize the pane' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x - 2000, box.y + 200); await page.mouse.up();
  expect((await page.locator('.session-main').boundingBox())!.width).toBeGreaterThanOrEqual(439);
  const split = await page.evaluate(() => JSON.parse(localStorage.getItem('desktop.session')!).split);
  expect(split).toBe(0.72);
  await page.reload();
  await open(page);
  await page.getByRole('link', { name: 'docs/guide.md' }).click();
  expect(await page.locator('.session-split').evaluate(el => getComputedStyle(el).getPropertyValue('--split').trim())).toBe('72%');
});
test('a narrow conversation (terminal open): the pane covers the thread above the reply, with Close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  await page.keyboard.press('o');
  await page.getByRole('link', { name: 'docs/guide.md' }).click();
  const pane = page.getByRole('complementary', { name: 'Reading pane' });
  expect(await pane.evaluate(el => getComputedStyle(el).position)).toBe('absolute');
  const reply = (await page.locator('.session-reply').boundingBox())!, side = (await pane.boundingBox())!;
  expect(side.y + side.height).toBeLessThanOrEqual(reply.y + 1);
  await pane.getByRole('button', { name: 'Close the pane (Esc)' }).click();
  await expect(pane).toHaveCount(0);
});
test('the work plan bar stays on top while the thread scrolls', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  const bar = page.locator('.todo-bar');
  await page.locator('.session-thread').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const top = (await page.locator('.session-thread').boundingBox())!.y;
  expect(Math.abs((await bar.boundingBox())!.y - top)).toBeLessThan(12);
});
```

`daemon.ts` : `document.read` est répondu par `document.content` (`requestId`, `path`, `text`, `bytes`, `modifiedAt`) quand `extras.documents[path]` existe, `document.error` `not_found` sinon. La conversation fait moins de 860 px à 1280 px de large avec la colonne et le terminal ouverts ; l'implémenteur ajuste la largeur si la mise en page réelle diffère, sans toucher au seuil.

- [ ] **Step 2: Lancer Playwright**

Run: `pnpm --filter desktop e2e`
Expected : tous les scénarios passent : 4 de `boot`, 4 de `shell`, 6 de `atelier`, 6 de `list`, 6 de `session` et 4 de `session-review`.

- [ ] **Step 3: Vérification du dépôt**

Run: `pnpm -r typecheck && pnpm test && pnpm -r build`
Expected : tout passe. Seule l'instabilité connue de l'overlay (`prototype-parity`) peut apparaître ; la signaler sans la corriger.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/e2e
git commit -m "test(desktop): reviewing a session in the browser: J / K in Changes, long lines, the resizable remembered pane, the narrow overlay, the sticky work plan

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Les reports du lot 6a

Ajoutée à l'exécution : les mineurs que la revue finale du lot 6a a renvoyés ici (registre du lot 6a, lignes « Final: deferred to 6b »), et le découpage du paquet.

**Files:**
- Modify : `packages/ledge/src/daemon/{server,history}.ts` et leurs tests, `packages/ledge/src/adapters/{claude,codex}.ts` si besoin, `apps/desktop/src/fleet/decisions.ts`, `apps/desktop/src/session/{Thread,AgentsRail,SessionPage,Reply}.tsx`, `apps/desktop/src/App.tsx` (ou le point de montage de la page), `apps/desktop/src/i18n/messages.ts`, `apps/desktop/test/*`

Chaque point a son test, écrit d'abord :

1. **Erreur « invalid message » sans `id`** : le daemon renvoie aussi `id` quand le message brut en porte un sous forme de chaîne de 200 caractères au plus ; une décision ou une réponse refusée par le schéma est alors refusée tout de suite côté Desktop, au lieu de finir « non confirmée » après 8 s.
2. **Refus avec note dont la note ne part pas** (Claude, Codex : Échap est envoyé avant d'attendre `atRest`) : si l'attente expire, le refus a déjà eu lieu ; le daemon le dit par un code distinct et Desktop affiche « Refusé, mais la note n’a pas pu être tapée. » / « Refused, but the note could not be typed. », la note revenant dans le champ (au lieu de « décision non envoyée »).
3. **`History.decide`** : supprimée (morte depuis le lot 6a), ses tests avec.
4. **Une réponse à une question** (`Decided` sans décision) ne marque plus `unknown` la dernière permission non décidée : elle ne touche que la question.
5. **Tests manquants** : une erreur sans `request` (daemon ancien) laisse la demande en vol jusqu'à son délai ; `replyUnconfirmed` ; sur la page d'un sous-agent : le terminal montre l'aperçu du parent, le badge de sous-agent, le titre du parent dans le fil d'Ariane.
6. **« Aller au plus récent »** paraît aussi quand le contenu grandit sous la vue sans défilement (nouvel élément, carte épinglée qui apparaît, volet qui rétrécit la colonne) : `ResizeObserver` sur la colonne du fil.
7. **Le repli 'subagent' non traduit** (`helperOf` et ses appelants) : une clé de `messages.ts` (`Sous-agent` / `Subagent`).
8. **Les notes de chargement et de fil vide** sont dans la colonne de 760 px.
9. **Le rail** : le `dotOf` local devient `railDotOf` ; un agent en erreur a le point rouge, comme dans la barre latérale ; l'`aria-label` posé sur un `<i>` nu passe sur un élément qui a un rôle (ou disparaît si le texte voisin suffit) ; une tâche vide dans le fil d'Ariane ne laisse pas de « · » seul.
10. **Le paquet** : la page de session (ou le lecteur Markdown) est chargée par `React.lazy` derrière un `Suspense` sobre ; `pnpm --filter desktop build` ne signale plus de morceau de plus de 500 kB.

- [ ] **Step 1 : Écrire les tests des points 1 à 9 ; vérifier qu'ils échouent** (`pnpm --filter @paradow/ledge exec vitest run <fichiers>`, `pnpm --filter desktop exec vitest run <fichiers>`)
- [ ] **Step 2 : Implémenter les points 1 à 10**
- [ ] **Step 3 : Vérifier** : `pnpm --filter @ledge/protocol test && pnpm --filter @paradow/ledge test && pnpm --filter @ledge/fleet test && pnpm --filter desktop test && pnpm -r typecheck && pnpm --filter desktop build && pnpm --filter desktop e2e` — tout passe, aucun avertissement de taille de morceau.
- [ ] **Step 4 : Commits** (un par point ou par groupe cohérent, `fix(...)` / `refactor(...)` / `perf(desktop): …`, terminés par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`)
