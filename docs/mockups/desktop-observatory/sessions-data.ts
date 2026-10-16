/** Simulated session threads for the mockup's session page. The shapes mirror packages/protocol/src/thread.ts (ThreadItem
 *  kinds prompt, message, tool, permission, reply, helper), grouped by turn as apps/overlay/src/thread/turns.ts does. */
export type Change = 'add' | 'edit' | 'delete' | 'write';
export type FileTouch = { path: string; change: Change; plus?: number; minus?: number };
export type ToolItem = { kind: 'tool'; id: string; tool: string; label: string; status: 'running' | 'success' | 'failed' | 'unknown'; durationMs?: number; startedAt?: number; output?: string; error?: string; files?: FileTouch[] };
export type DocLink = { title: string; path: string };
export type Item =
  | { kind: 'prompt'; id: string; text: string; from?: string }
  | { kind: 'message'; id: string; text: string; doc?: DocLink }
  | ToolItem
  /** `always`: allowed for the rest of the session. */
  | { kind: 'permission'; id: string; tool: string; text: string; decision: 'accept' | 'deny' | 'unknown' | 'always' }
  | { kind: 'answer'; id: string; text: string }
  | { kind: 'helper'; id: string; agent: string; task: string; state: 'working' | 'exited' }
  | { kind: 'reply'; id: string; text: string; doc?: DocLink }
  /** A plan the agent proposes before acting (Claude Code's ExitPlanMode): markdown, numbered steps. */
  | { kind: 'plan'; id: string; title: string; text: string; status: 'proposed' | 'approved' | 'revised' }
  /** The agent's task list (TodoWrite): each update replaces the previous one. */
  | { kind: 'todos'; id: string; items: Todo[] };
export type Todo = { text: string; status: 'pending' | 'in_progress' | 'completed' };
export type Turn = { id: string; at: string; items: Item[] };
export type Pending =
  | { kind: 'approval'; tool: string; command: string; summary: string; cwd?: string; since: string }
  | { kind: 'question'; text: string; choices: { label: string; detail?: string }[]; since: string }
  | { kind: 'plan'; plan: string; since: string };
export type FileDiff = { change: Change; diff: string };
export type Thread = {
  turns: Turn[]; pending?: Pending; files: Record<string, FileDiff>;
  /** The first item the viewer has not seen yet (simulated "since your last visit"). */
  unreadFrom?: string;
  /** Tools that will run next, one after the other, while the page is open (a live turn). */
  script?: ToolItem[];
  note?: string;
};

const addDiff = (text: string) => '@@ -0,0 +1 @@\n' + text.split('\n').map(l => '+' + l).join('\n');
const ago = (s: number) => Date.now() - s * 1000;

export const DOCS: Record<string, string> = {
  'docs/desktop-navigation.md': `---
title: Navigation de Ledge desktop
---
# Navigation de Ledge desktop

Ledge desktop suit des agents sur plusieurs machines. La navigation part des **projets**, pas des machines.

## Trois niveaux

1. **Atelier** : une table par projet, les agents assis autour. On voit d’un coup d’œil qui attend quoi.
2. **Liste** : les mêmes sessions, triées par urgence, pour agir vite (autoriser, répondre).
3. **Session** : le fil de l’agent, ses modifications et le terminal à côté.

## La page de session

- À gauche, la colonne des agents du projet ; les sous-agents sont rangés sous leur parent.
- Au centre, le fil, tour par tour. Les actions sont repliées en une ligne de résumé.
- La demande en attente reste épinglée au-dessus du champ de réponse.
- Le terminal s’ouvre à droite avec la touche \`O\`.

## Raccourcis

| Touche | Action |
| --- | --- |
| \`Alt 1…9\` | Aller à une session principale |
| \`R\` | Répondre à l’agent |
| \`O\` | Afficher ou masquer le terminal |
| \`Échap\` | Revenir à la liste |

## Hors périmètre

- La modification de fichiers depuis Ledge : on lit, on ne réécrit pas.
- Le partage d’une session avec une autre personne.`
};

const PROJECT_RAIL = `import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { railRows } from './groups';

/** The agents of one project, the open one marked; a sub-agent sits under its parent. */
export function ProjectRail({ sessions, current, onOpen, theme }: {
  sessions: Session[]; current: string; onOpen: (id: string) => void; theme: 'dark' | 'light';
}) {
  const rows = railRows(sessions);
  const row = (s: Session, child = false) => (
    <button key={s.id} className={child ? 'rail-agent child' : 'rail-agent'}
      aria-current={s.id === current ? 'page' : undefined} onClick={() => onOpen(s.id)}>
      <Bot tool={s.tool} state={s.state} pose={1} size={child ? 20 : 26} theme={theme} seed={s.id} />
      <span><strong>{s.name}</strong><small>{s.title}</small></span>
    </button>
  );
  return (
    <nav className="project-rail" aria-label="Agents du projet">
      {rows.map(r => (
        <div key={r.session.id}>
          {row(r.session)}
          {r.children.length > 0 && (
            <div role="group" aria-label={\`Sous-agents de \${r.session.name}\`}>
              {r.children.map(c => row(c, true))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}`;

const otto: Thread = {
  files: {
    'docs/desktop-navigation.md': { change: 'add', diff: addDiff(DOCS['docs/desktop-navigation.md']!) },
    'apps/overlay/src/surface/groups.ts': { change: 'edit', diff: `@@ -1,8 +1,11 @@
 import type { Session } from '@ledge/protocol';
 import { repoKey, branchOf } from './machine';
+import { byLaunch } from '../thread/turns';

 /** Sessions grouped by repository and branch, the most recent activity first. */
 export type Group = { key: string; repo: string; branch: string | null; sessions: Session[] };
+/** One row of the project rail: a main session and the sub-agents it launched. */
+export type RailRow = { session: Session; children: Session[] };

 const byActivity = (a: Session, b: Session) => b.lastActivityAt.localeCompare(a.lastActivityAt);
-const isHelper = (s: Session) => Boolean(s.parentId);
+const isHelper = (s: Session) => Boolean(s.parentId) && s.state !== 'error';

@@ -36,12 +39,25 @@ export function groups(sessions: Session[]): Group[] {
 export function groups(sessions: Session[]): Group[] {
   const map = new Map<string, Group>();
   for (const s of sessions) {
     if (isHelper(s)) continue;
     const key = \`\${repoKey(s)}#\${branchOf(s) ?? ''}\`;
     const g = map.get(key) ?? { key, repo: repoKey(s), branch: branchOf(s), sessions: [] };
     g.sessions.push(s);
     map.set(key, g);
   }
   for (const g of map.values()) g.sessions.sort(byActivity);
   return [...map.values()].sort((a, b) => byActivity(a.sessions[0]!, b.sessions[0]!));
 }
+
+/** The rail of a project: main sessions by activity, each followed by its sub-agents in launch order. A sub-agent
+ *  whose parent left the project stays visible as a main row rather than disappearing. */
+export function railRows(sessions: Session[]): RailRow[] {
+  const ids = new Set(sessions.map(s => s.id));
+  const heads = sessions.filter(s => !s.parentId || !ids.has(s.parentId)).sort(byActivity);
+  return heads.map(session => ({
+    session,
+    children: sessions.filter(s => s.parentId === session.id).sort(byLaunch)
+  }));
+}
+
+export const railCount = (rows: RailRow[]) => rows.reduce((n, r) => n + 1 + r.children.length, 0);` },
    'apps/overlay/src/surface/ProjectRail.tsx': { change: 'add', diff: addDiff(PROJECT_RAIL) },
    'apps/overlay/src/surface/SessionView.tsx': { change: 'edit', diff: `@@ -12,6 +12,7 @@ import { Bot } from '../bots/Bot';
 import { DetailHeader } from './DetailHeader';
 import { Thread } from './Thread';
 import { TerminalBand } from './TerminalBand';
+import { ProjectRail } from './ProjectRail';
 import { useFocusRestore } from './useFocusRestore';

@@ -141,13 +142,17 @@ export function SessionView(p: SessionViewProps) {
   useEffect(() => {
     const onKey = (e: KeyboardEvent) => {
       if (typing(e)) return;
-      if (e.key === 'r') { e.preventDefault(); replyRef.current?.focus(); }
+      if (e.key === 'r') { e.preventDefault(); replyRef.current?.focus(); return; }
+      if (e.key === 'o' && !e.altKey) {
+        e.preventDefault();
+        p.onTerminal(!p.terminalOpen);
+      }
     };
     window.addEventListener('keydown', onKey);
     return () => window.removeEventListener('keydown', onKey);
-  }, []);
+  }, [p.terminalOpen, p.onTerminal]);

   return (
     <section data-layer="session" className="session-view">
-      <DetailHeader session={p.session} onBack={p.onBack} />
+      <DetailHeader session={p.session} onBack={p.onBack} terminalOpen={p.terminalOpen} />
+      <ProjectRail sessions={p.projectSessions} current={p.session.id} onOpen={p.onOpen} theme={p.theme} />
       <Thread session={p.session} items={p.items} t={p.t} theme={p.theme} paused={p.paused} />` },
    'apps/overlay/src/surface/HelpView.tsx': { change: 'edit', diff: `@@ -16,10 +16,11 @@ import type { Messages } from '../i18n/messages';
 const ROWS: Array<[keys: string, action: keyof Messages['help']]> = [
   ['Ctrl K', 'search'],
   ['Alt 1…9', 'jump'],
   ['Alt ← / →', 'cycle'],
   ['R', 'reply'],
+  ['O', 'terminal'],
   ['Échap', 'back'],
   ['?', 'help']
 ];` },
    'apps/overlay/src/i18n/messages.ts': { change: 'edit', diff: `@@ -212,6 +212,7 @@ export const fr = {
     search: 'Rechercher et ouvrir une session',
     jump: 'Accès direct aux sessions principales',
     cycle: 'Session précédente / suivante',
     reply: 'Écrire une réponse à l’agent',
+    terminal: 'Afficher ou masquer le terminal',
     back: 'Fermer le panneau ou revenir',
     help: 'Afficher ces raccourcis'
@@ -449,6 +450,7 @@ export const en: Messages = {
     search: 'Search and open a session',
     jump: 'Go straight to a main session',
     cycle: 'Previous / next session',
     reply: 'Reply to the agent',
+    terminal: 'Show or hide the terminal',
     back: 'Close the panel or go back',
     help: 'Show these shortcuts'` }
  },
  turns: [
    { id: 'o1', at: '09:12', items: [
      { kind: 'prompt', id: 'o1p', text: 'Conçois la navigation de Ledge desktop. Commence par lire ce qui existe : le routeur de l’île, la liste des sessions et la spec du 13 octobre. Propose-moi un plan avant de toucher au code.' },
      { kind: 'tool', id: 'o1t1', tool: 'Read', label: 'apps/overlay/src/surface/Surface.tsx', status: 'success', durationMs: 180, output: '412 lignes' },
      { kind: 'tool', id: 'o1t2', tool: 'Read', label: 'apps/overlay/src/surface/SessionList.tsx', status: 'success', durationMs: 140, output: '238 lignes' },
      { kind: 'tool', id: 'o1t3', tool: 'Grep', label: 'openTabPreference', status: 'success', durationMs: 620, output: '12 résultats dans 5 fichiers' },
      { kind: 'tool', id: 'o1t4', tool: 'Glob', label: 'docs/superpowers/specs/*.md', status: 'success', durationMs: 90, output: '9 fichiers' },
      { kind: 'tool', id: 'o1t5', tool: 'Read', label: 'docs/superpowers/specs/2026-10-13-native-session-tracking.md', status: 'success', durationMs: 210, output: '604 lignes' },
      { kind: 'tool', id: 'o1t6', tool: 'Bash', label: 'git log --oneline -15 -- apps/overlay/src/surface', status: 'success', durationMs: 1400, output: '2de2ba7 feat(overlay): the subagents sit over the reply field\n2a52b62 feat(overlay): the terminal as a live strip\n…' },
      { kind: 'helper', id: 'o1h', agent: 'gus', task: 'Mesurer le temps de chargement', state: 'exited' },
      { kind: 'tool', id: 'o1t7', tool: 'Write', label: 'docs/desktop-navigation.md', status: 'success', durationMs: 320, files: [{ path: 'docs/desktop-navigation.md', change: 'add' }] },
      { kind: 'reply', id: 'o1r', text: 'Le plan est prêt. Les **projets** regroupent les conversations ; chaque conversation garde son terminal à côté.\n\n- L’atelier et la liste montrent les mêmes sessions, sous deux angles.\n- La page de session réunit le fil, les modifications et la réponse.\n- Gus a mesuré l’atelier : **180 ms** pour 30 agents, la vue tient.\n\nJe te propose de valider ce découpage avant de poursuivre.', doc: { title: 'Navigation de Ledge desktop', path: 'docs/desktop-navigation.md' } }
    ] },
    { id: 'o2', at: '09:31', items: [
      { kind: 'prompt', id: 'o2p', text: 'Le découpage me va. Implémente la colonne des agents du projet, avec les sous-agents rangés sous leur parent, et le raccourci O pour le terminal.' },
      { kind: 'todos', id: 'o2d', items: [{ text: 'Lire la navigation existante et la spec', status: 'completed' }, { text: 'Écrire le plan de navigation', status: 'completed' }, { text: 'Colonne des agents et raccourci O', status: 'in_progress' }, { text: 'Relancer toute la suite de tests overlay', status: 'pending' }, { text: 'Faire relire les parcours par Pip', status: 'pending' }, { text: 'Corriger les remarques clavier de Lya', status: 'pending' }, { text: 'Préparer la PR et son résumé', status: 'pending' }] },
      { kind: 'tool', id: 'o2t1', tool: 'Read', label: 'apps/overlay/src/surface/groups.ts', status: 'success', durationMs: 120, output: '58 lignes' },
      { kind: 'tool', id: 'o2t2', tool: 'Read', label: 'apps/overlay/src/thread/turns.ts', status: 'success', durationMs: 110, output: '59 lignes' },
      { kind: 'tool', id: 'o2t3', tool: 'Edit', label: 'apps/overlay/src/surface/groups.ts', status: 'success', durationMs: 260, files: [{ path: 'apps/overlay/src/surface/groups.ts', change: 'edit', plus: 15, minus: 1 }] },
      { kind: 'tool', id: 'o2t4', tool: 'Write', label: 'apps/overlay/src/surface/ProjectRail.tsx', status: 'success', durationMs: 340, files: [{ path: 'apps/overlay/src/surface/ProjectRail.tsx', change: 'add' }] },
      { kind: 'tool', id: 'o2t5', tool: 'Edit', label: 'apps/overlay/src/surface/SessionView.tsx', status: 'success', durationMs: 290, files: [{ path: 'apps/overlay/src/surface/SessionView.tsx', change: 'edit' }] },
      { kind: 'permission', id: 'o2k', tool: 'Bash', text: 'pnpm vitest run src/surface/groups.test.ts', decision: 'accept' },
      { kind: 'tool', id: 'o2t6', tool: 'Bash', label: 'pnpm vitest run src/surface/groups.test.ts', status: 'failed', durationMs: 6800, error: ' FAIL  src/surface/groups.test.ts > railRows > orders sub-agents by launch\nAssertionError: expected [ \'pip\', \'lya\' ] to deeply equal [ \'lya\', \'pip\' ]\n\n- Expected\n+ Received\n\n  [\n-   "lya",\n    "pip",\n+   "lya",\n  ]\n\n Tests  1 failed | 13 passed (14)' },
      { kind: 'message', id: 'o2m', text: 'Un test échoue : les sous-agents sortaient dans l’ordre d’activité et non par date de lancement. Je trie les enfants avec `byLaunch`.' },
      { kind: 'tool', id: 'o2t7', tool: 'Edit', label: 'apps/overlay/src/surface/groups.ts', status: 'success', durationMs: 210, files: [{ path: 'apps/overlay/src/surface/groups.ts', change: 'edit', plus: 2, minus: 0 }] },
      { kind: 'tool', id: 'o2t8', tool: 'Bash', label: 'pnpm vitest run src/surface/groups.test.ts', status: 'success', durationMs: 4100, output: ' ✓ src/surface/groups.test.ts (14 tests) 38ms\n\n Test Files  1 passed (1)\n      Tests  14 passed (14)' },
      { kind: 'helper', id: 'o2h', agent: 'lya', task: 'Vérifier l’accessibilité clavier', state: 'working' },
      { kind: 'reply', id: 'o2r', text: 'La colonne des agents est en place :\n\n- `railRows()` range chaque sous-agent sous son parent, dans l’ordre de lancement ;\n- un sous-agent dont le parent a quitté le projet reste visible en tête de liste ;\n- `O` affiche ou masque le terminal.\n\nLes **14 tests** de `groups.test.ts` passent. Lya vérifie maintenant le parcours au clavier.' }
    ] },
    { id: 'o3', at: '10:02', items: [
      { kind: 'prompt', id: 'o3p', text: 'Ajoute le raccourci O dans l’aide, puis relance toute la suite overlay avant que je relise.' },
      { kind: 'todos', id: 'o3d', items: [{ text: 'Lire la navigation existante et la spec', status: 'completed' }, { text: 'Écrire le plan de navigation', status: 'completed' }, { text: 'Colonne des agents et raccourci O', status: 'completed' }, { text: 'Relancer toute la suite de tests overlay', status: 'in_progress' }, { text: 'Faire relire les parcours par Pip', status: 'pending' }, { text: 'Corriger les remarques clavier de Lya', status: 'pending' }, { text: 'Préparer la PR et son résumé', status: 'pending' }] },
      { kind: 'tool', id: 'o3t1', tool: 'Grep', label: 'ROWS|keyof Messages\\[\'help\'\\]', status: 'success', durationMs: 540, output: '3 résultats dans 2 fichiers' },
      { kind: 'tool', id: 'o3t2', tool: 'Read', label: 'apps/overlay/src/surface/HelpView.tsx', status: 'success', durationMs: 130, output: '64 lignes' },
      { kind: 'tool', id: 'o3t3', tool: 'Edit', label: 'apps/overlay/src/surface/HelpView.tsx', status: 'success', durationMs: 240, files: [{ path: 'apps/overlay/src/surface/HelpView.tsx', change: 'edit' }] },
      { kind: 'tool', id: 'o3t4', tool: 'Edit', label: 'apps/overlay/src/i18n/messages.ts', status: 'success', durationMs: 310, files: [{ path: 'apps/overlay/src/i18n/messages.ts', change: 'edit' }] },
      { kind: 'helper', id: 'o3h', agent: 'pip', task: 'Relire les parcours', state: 'working' },
      { kind: 'message', id: 'o3m', text: 'Le raccourci est documenté en français et en anglais. Pip relit en parallèle les parcours **création de tâche** et **reprise d’une conversation**.\n\nJe lance maintenant toute la suite du paquet overlay (environ 40 s).' }
    ] }
  ],
  pending: { kind: 'approval', tool: 'Bash', command: 'pnpm test --filter overlay', summary: 'Lance les 48 fichiers de tests du paquet overlay après les 6 modifications de la session. Aucune écriture hors du dossier de travail.', cwd: '~/ledge/application', since: 'il y a 4 min' },
  unreadFrom: 'o3h'
};

const nova: Thread = {
  files: {
    'db/migrations/0043_orders_cents.sql': { change: 'add', diff: addDiff(`-- Montants en centimes et devise séparée (ticket PAY-218).
-- À appliquer après 0042_orders_index.sql.
BEGIN;

ALTER TABLE orders ADD COLUMN amount_cents bigint;
ALTER TABLE orders ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR';

UPDATE orders
   SET amount_cents = round(amount * 100)::bigint,
       currency = coalesce(nullif(split_part(amount_label, ' ', 2), ''), 'EUR');

ALTER TABLE orders ALTER COLUMN amount_cents SET NOT NULL;
CREATE INDEX CONCURRENTLY orders_currency_idx ON orders (currency);

COMMIT;`) },
    'src/orders/repository.ts': { change: 'edit', diff: `@@ -1,6 +1,7 @@
 import { db } from '../db';
 import type { Order } from './types';
+import { toCents, fromCents } from '../money';

 export async function findOrder(id: string): Promise<Order | undefined> {
   const row = await db('orders').where({ id }).first();
@@ -8,9 +9,10 @@ export async function findOrder(id: string): Promise<Order | undefined> {
   return {
     id: row.id,
     customerId: row.customer_id,
-    amount: Number(row.amount),
+    amount: fromCents(row.amount_cents),
+    currency: row.currency,
     createdAt: row.created_at
   };
 }

@@ -24,7 +26,7 @@ export async function saveOrder(order: Order): Promise<void> {
   await db('orders')
     .insert({
       id: order.id,
       customer_id: order.customerId,
-      amount: order.amount,
+      amount_cents: toCents(order.amount), currency: order.currency,
       created_at: order.createdAt
     })` }
  },
  turns: [
    { id: 'n0a', at: '12:15', items: [
      { kind: 'prompt', id: 'n0ap', text: 'Combien de commandes ont un montant en euros avec plus de deux décimales ?' },
      { kind: 'tool', id: 'n0at1', tool: 'Bash', label: 'psql "$DEV_DATABASE_URL" -c "select count(*) from orders where amount <> round(amount, 2)"', status: 'success', durationMs: 3400, output: ' count\n-------\n  1206\n(1 row)' },
      { kind: 'reply', id: 'n0ar', text: '**1 206 commandes** ont plus de deux décimales, toutes créées avant mars 2024 par l’ancien module de remises. Elles s’arrondiront au centime pendant la migration.' }
    ] },
    { id: 'n0b', at: '12:48', items: [
      { kind: 'prompt', id: 'n0bp', text: 'Est-ce que le storefront lit directement la colonne amount ?' },
      { kind: 'tool', id: 'n0bt1', tool: 'Bash', label: 'rg -n "\\.amount\\b" storefront/src', status: 'success', durationMs: 290, output: '4 résultats dans 2 fichiers' },
      { kind: 'tool', id: 'n0bt2', tool: 'Bash', label: 'rg -n "amount" storefront/src/api/orders.ts', status: 'failed', durationMs: 120, error: 'rg: storefront/src/api/orders.ts: No such file or directory' },
      { kind: 'tool', id: 'n0bt3', tool: 'Bash', label: 'rg -n "amount" storefront/src/lib/api/orders.ts', status: 'success', durationMs: 110, output: '2 résultats' },
      { kind: 'reply', id: 'n0br', text: 'Oui, à deux endroits : le récapitulatif de commande et l’export CSV. Je les adapterai en même temps que l’API pour qu’ils lisent les centimes.' }
    ] },
    { id: 'n1', at: '13:40', items: [
      { kind: 'prompt', id: 'n1p', text: 'Prépare la migration de la table orders vers le nouveau schéma : montants en centimes, devise dans sa propre colonne. Ne touche pas à la prod.' },
      { kind: 'tool', id: 'n1t1', tool: 'Bash', label: 'rg -n "amount" src/orders db/migrations', status: 'success', durationMs: 380, output: '27 résultats dans 9 fichiers' },
      { kind: 'tool', id: 'n1t2', tool: 'Bash', label: 'sed -n 1,80p db/migrations/0042_orders_index.sql', status: 'success', durationMs: 60 },
      { kind: 'tool', id: 'n1t3', tool: 'Bash', label: 'psql "$DEV_DATABASE_URL" -c "select count(*) from orders"', status: 'success', durationMs: 2300, output: '  count\n---------\n 2418337\n(1 row)' },
      { kind: 'helper', id: 'n1h1', agent: 'echo', task: 'Relire le schéma', state: 'working' },
      { kind: 'tool', id: 'n1t4', tool: 'Write', label: 'db/migrations/0043_orders_cents.sql', status: 'success', durationMs: 180, files: [{ path: 'db/migrations/0043_orders_cents.sql', change: 'add' }] },
      { kind: 'tool', id: 'n1t5', tool: 'Edit', label: 'src/orders/repository.ts', status: 'success', durationMs: 220, files: [{ path: 'src/orders/repository.ts', change: 'edit' }] },
      { kind: 'tool', id: 'n1t6', tool: 'Bash', label: 'pnpm tsc --noEmit -p api', status: 'success', durationMs: 11200 },
      { kind: 'helper', id: 'n1h2', agent: 'kim', task: 'Préparer le retour arrière', state: 'working' },
      { kind: 'message', id: 'n1m', text: 'La migration est écrite et le code compile. Il reste une décision : la table compte **2,4 millions** de lignes.\n\n| | Progressive | Fenêtre de maintenance |\n| --- | --- | --- |\n| Interruption | aucune | ~15 min |\n| Durée totale | 2 jours (double écriture) | 1 matinée |\n| Retour arrière | colonne ancienne gardée | snapshot de la nuit |\n\nPréférerais-tu une migration progressive ou une courte fenêtre de maintenance ?' }
    ] }
  ],
  pending: { kind: 'question', text: 'Migration progressive ou courte fenêtre de maintenance ?', choices: [
    { label: 'Migration progressive', detail: 'Double écriture pendant 48 h, aucune interruption' },
    { label: 'Fenêtre de maintenance', detail: 'Dimanche 6 h, environ 15 min, retour arrière par snapshot' },
    { label: 'Propose-moi d’abord un calendrier', detail: 'Nova détaille les étapes sans rien lancer' }
  ], since: 'il y a 7 min' },
  unreadFrom: 'n1m'
};

const milo: Thread = {
  files: {
    'crates/daemon/src/ssh/reconnect.rs': { change: 'edit', diff: `@@ -41,15 +41,24 @@ impl Reconnector {
     pub async fn resume(&mut self, link: &SshLink) -> Result<Resumed> {
         let last = self.cursor.load(Ordering::Acquire);
-        let events = link.replay_since(last).await?;
+        // A reconnect can land before the remote daemon flushed: ask again once, then accept the gap.
+        let events = match link.replay_since(last).await {
+            Ok(events) => events,
+            Err(ReplayError::NotReady) => {
+                tokio::time::sleep(Duration::from_millis(250)).await;
+                link.replay_since(last).await?
+            }
+            Err(e) => return Err(e.into()),
+        };
         for event in &events {
             let session = self.sessions.get(&event.session_id);
             match session {
                 Some(s) => s.apply(event),
                 None => self.orphans.push(event.clone()),
             }
         }
-        self.cursor.store(events.last().map_or(last, |e| e.seq), Ordering::Release);
+        let next = events.iter().map(|e| e.seq).max().unwrap_or(last);
+        self.cursor.store(next, Ordering::Release);
         Ok(Resumed { replayed: events.len(), orphans: self.orphans.len() })
     }` },
    'crates/daemon/tests/reconnect.rs': { change: 'add', diff: addDiff(`use ledge_daemon::ssh::{Reconnector, testing::FlakyLink};

#[tokio::test]
async fn resumes_after_a_late_flush() {
    let link = FlakyLink::not_ready_once(vec![event(7), event(8), event(9)]);
    let mut r = Reconnector::at(6);
    let resumed = r.resume(&link).await.unwrap();
    assert_eq!(resumed.replayed, 3);
    assert_eq!(r.cursor(), 9);
}

#[tokio::test]
async fn keeps_the_highest_sequence_when_events_arrive_out_of_order() {
    let link = FlakyLink::ready(vec![event(12), event(10), event(11)]);
    let mut r = Reconnector::at(9);
    r.resume(&link).await.unwrap();
    assert_eq!(r.cursor(), 12);
}`) }
  },
  turns: [
    { id: 'm1', at: '11:05', items: [
      { kind: 'prompt', id: 'm1p', text: 'Après une reconnexion SSH, certains événements arrivent sur la mauvaise session. Trouve pourquoi.' },
      { kind: 'tool', id: 'm1t1', tool: 'Bash', label: 'rg -n "replay_since" crates/', status: 'success', durationMs: 410, output: '6 résultats dans 3 fichiers' },
      { kind: 'tool', id: 'm1t2', tool: 'Bash', label: 'sed -n 1,120p crates/daemon/src/ssh/reconnect.rs', status: 'success', durationMs: 50 },
      { kind: 'tool', id: 'm1t3', tool: 'Bash', label: 'journalctl --user -u ledge-daemon --since "2 hours ago" | rg reconnect', status: 'success', durationMs: 1900, output: '14 reconnexions, 3 avec « replay: not ready »' },
      { kind: 'helper', id: 'm1h', agent: 'bit', task: 'Vérifier la reconnexion', state: 'exited' },
      { kind: 'reply', id: 'm1r', text: 'Deux causes :\n\n1. le démon distant n’a parfois pas encore écrit ses événements quand on les redemande (`replay: not ready`) ;\n2. le curseur prend le **dernier** événement reçu, pas le plus grand numéro : des événements arrivés dans le désordre sont rejoués deux fois.\n\nBit a reproduit les deux cas sur Dev SSH.' }
    ] },
    { id: 'm2', at: '11:26', items: [
      { kind: 'prompt', id: 'm2p', text: 'Corrige les deux, avec des tests. Lance toute la suite du démon à la fin.' },
      { kind: 'tool', id: 'm2t1', tool: 'Bash', label: 'sed -n 30,80p crates/daemon/src/ssh/reconnect.rs', status: 'success', durationMs: 40 },
      { kind: 'tool', id: 'm2t2', tool: 'Bash', label: 'rg -n "enum ReplayError" -A8 crates/daemon/src', status: 'success', durationMs: 320 },
      { kind: 'tool', id: 'm2t3', tool: 'Edit', label: 'crates/daemon/src/ssh/reconnect.rs', status: 'success', durationMs: 260, files: [{ path: 'crates/daemon/src/ssh/reconnect.rs', change: 'edit' }] },
      { kind: 'tool', id: 'm2t4', tool: 'Write', label: 'crates/daemon/tests/reconnect.rs', status: 'success', durationMs: 190, files: [{ path: 'crates/daemon/tests/reconnect.rs', change: 'add' }] },
      { kind: 'tool', id: 'm2t5', tool: 'Bash', label: 'cargo test -p ledge-daemon --test reconnect', status: 'success', durationMs: 48200, output: 'running 2 tests\ntest resumes_after_a_late_flush ... ok\ntest keeps_the_highest_sequence_when_events_arrive_out_of_order ... ok\n\ntest result: ok. 2 passed; 0 failed' },
      { kind: 'tool', id: 'm2t6', tool: 'Bash', label: 'cargo clippy -p ledge-daemon -- -D warnings', status: 'success', durationMs: 31500 },
      { kind: 'message', id: 'm2m', text: 'Les deux nouveaux tests passent et clippy ne signale rien. Je lance toute la suite du démon (~3 min sur Dev SSH).' },
      { kind: 'tool', id: 'm2t7', tool: 'Bash', label: 'cargo test -p ledge-daemon', status: 'running', startedAt: ago(72), output: 'test result: ok. 214 passed; 0 failed; 3 ignored; finished in 78.4s' }
    ] }
  ],
  script: [
    { kind: 'tool', id: 'm2s1', tool: 'Bash', label: 'cargo test -p ledge-daemon --doc', status: 'running', output: 'test result: ok. 31 passed; 0 failed' },
    { kind: 'tool', id: 'm2s2', tool: 'Bash', label: 'ssh dev-ssh "systemctl --user restart ledge-daemon"', status: 'running', output: 'ledge-daemon redémarré (pid 48211)' },
    { kind: 'tool', id: 'm2s3', tool: 'Bash', label: 'ssh dev-ssh "ledge probe --reconnect 20"', status: 'running' }
  ],
  unreadFrom: 'm2m'
};

const sage: Thread = {
  files: {
    'api/src/billing/vat.ts': { change: 'edit', diff: `@@ -1,18 +1,22 @@
 import type { InvoiceLine } from './types';

 /** Belgian VAT rates, in percent. */
 export const RATES = { standard: 21, reduced: 6, intermediate: 12 } as const;

-/** VAT of an invoice: the total, then the rate. */
-export function invoiceVat(lines: InvoiceLine[]): number {
-  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
-  return Math.round(total * RATES.standard) / 100;
-}
+/** VAT of one line, rounded to the cent as the invoice prints it (half away from zero). */
+export function lineVat(line: InvoiceLine): number {
+  const cents = line.unitPriceCents * line.quantity * RATES[line.rate];
+  return Math.sign(cents) * Math.round(Math.abs(cents) / 100);
+}
+
+/** VAT of an invoice: the sum of its rounded lines, so the total matches the printed lines. */
+export function invoiceVat(lines: InvoiceLine[]): number {
+  return lines.reduce((sum, l) => sum + lineVat(l), 0);
+}

 export function formatVat(cents: number): string {
   return (cents / 100).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });
 }` },
    'api/src/billing/vat.test.ts': { change: 'edit', diff: `@@ -20,4 +20,22 @@ describe('invoiceVat', () => {
   it('is zero for an empty invoice', () => {
     expect(invoiceVat([])).toBe(0);
   });
+
+  it('rounds each line before adding them', () => {
+    const lines = [line(12, 1, 'standard'), line(12, 1, 'standard'), line(12, 1, 'standard')];
+    // Each line prints 0,03 €: 3 × 3 cents, not round(7,56) = 8 cents on the total.
+    expect(invoiceVat(lines)).toBe(9);
+  });
+
+  it('applies each line its own rate', () => {
+    expect(invoiceVat([line(1000, 1, 'reduced'), line(1000, 1, 'standard')])).toBe(270);
+  });
+
+  it('rounds a credit note symmetrically', () => {
+    expect(lineVat(line(-12, 1, 'standard'))).toBe(-3);
+  });
 });` }
  },
  turns: [
    { id: 's0a', at: 'hier 14:05', items: [
      { kind: 'prompt', id: 's0ap', text: 'Commence par m’expliquer comment la TVA est calculée aujourd’hui, sans rien modifier.' },
      { kind: 'tool', id: 's0at1', tool: 'Grep', label: 'Vat|vat', status: 'success', durationMs: 520, output: '41 résultats dans 12 fichiers' },
      { kind: 'tool', id: 's0at2', tool: 'Read', label: 'api/src/billing/vat.ts', status: 'success', durationMs: 100 },
      { kind: 'tool', id: 's0at3', tool: 'Read', label: 'api/src/billing/invoice.ts', status: 'success', durationMs: 120 },
      { kind: 'reply', id: 's0ar', text: 'La TVA est calculée **une seule fois sur le total** de la facture, au taux standard de 21 %. Les lignes à 6 % et 12 % sont donc taxées comme les autres, et l’arrondi se fait à la fin : c’est ce qui crée l’écart d’un centime avec la facture imprimée, qui arrondit chaque ligne.' }
    ] },
    { id: 's0b', at: 'hier 14:32', items: [
      { kind: 'prompt', id: 's0bp', text: 'Retrouve trois factures réelles avec l’écart pour qu’on ait des cas de test.' },
      { kind: 'permission', id: 's0bk', tool: 'Bash', text: 'psql "$STAGING_DATABASE_URL" (lecture seule)', decision: 'accept' },
      { kind: 'tool', id: 's0bt1', tool: 'Bash', label: 'psql "$STAGING_DATABASE_URL" -f scripts/vat_gap.sql', status: 'success', durationMs: 4100, output: ' invoice  | printed | computed | gap\n----------+---------+----------+-----\n F-20391  |   18,27 |    18,26 | 0,01\n F-20877  |    3,09 |     3,10 | -0,01\n F-21102  |  142,55 |   142,54 | 0,01\n(3 rows)' },
      { kind: 'reply', id: 's0br', text: 'Trois factures de staging montrent l’écart : **F-20391**, **F-20877** et **F-21102**. Je les reprends comme cas de test, anonymisées.' }
    ] },
    { id: 's0c', at: 'hier 15:10', items: [
      { kind: 'prompt', id: 's0cp', text: 'Avant de corriger : est-ce que les notes de crédit suivent la même règle ?' },
      { kind: 'tool', id: 's0ct1', tool: 'Grep', label: 'creditNote', status: 'success', durationMs: 380, output: '9 résultats dans 3 fichiers' },
      { kind: 'tool', id: 's0ct2', tool: 'Read', label: 'api/src/billing/credit-note.ts', status: 'success', durationMs: 90 },
      { kind: 'reply', id: 's0cr', text: 'Oui : une note de crédit réutilise `invoiceVat()` avec des montants négatifs. Il faudra arrondir **symétriquement** (−0,005 donne −0,01), sinon une facture suivie de sa note ne s’annule pas exactement.' }
    ] },
    { id: 's1', at: 'hier 16:20', items: [
      { kind: 'prompt', id: 's1p', text: 'La facturation signale des écarts d’un centime sur la TVA. Corrige le calcul pour qu’il arrondisse par ligne, comme sur la facture imprimée.' },
      { kind: 'tool', id: 's1t1', tool: 'Read', label: 'api/src/billing/vat.ts', status: 'success', durationMs: 110 },
      { kind: 'tool', id: 's1t2', tool: 'Read', label: 'api/src/billing/vat.test.ts', status: 'success', durationMs: 90 },
      { kind: 'tool', id: 's1t3', tool: 'Grep', label: 'invoiceVat\\(', status: 'success', durationMs: 480, output: '7 résultats dans 4 fichiers' },
      { kind: 'tool', id: 's1t4', tool: 'Edit', label: 'api/src/billing/vat.ts', status: 'success', durationMs: 240, files: [{ path: 'api/src/billing/vat.ts', change: 'edit' }] },
      { kind: 'tool', id: 's1t5', tool: 'Edit', label: 'api/src/billing/vat.test.ts', status: 'success', durationMs: 200, files: [{ path: 'api/src/billing/vat.test.ts', change: 'edit' }] },
      { kind: 'permission', id: 's1k', tool: 'Bash', text: 'pnpm --filter api test billing', decision: 'always' },
      { kind: 'tool', id: 's1t6', tool: 'Bash', label: 'pnpm --filter api test billing', status: 'success', durationMs: 8700, output: ' ✓ src/billing/vat.test.ts (9 tests)\n ✓ src/billing/invoice.test.ts (21 tests)\n\n Tests  30 passed (30)' },
      { kind: 'reply', id: 's1r', text: '## Rapport\n\nLe calcul arrondit désormais **par ligne**, comme l’exige la facturation.\n\n- `lineVat()` calcule la TVA d’une ligne en centimes, à son propre taux ;\n- `invoiceVat()` additionne les lignes arrondies : le total correspond à la facture imprimée ;\n- une note de crédit s’arrondit symétriquement.\n\n```ts\ninvoiceVat([line(12, 1), line(12, 1), line(12, 1)]) // 9 centimes, et non plus 8\n```\n\nLes **30 tests** de la facturation passent. Aucune migration nécessaire : les montants stockés ne changent pas.' }
    ] }
  ]
};

const ash: Thread = {
  files: {},
  note: 'Cursor Agent ne transmet ni résultats ni messages intermédiaires.',
  turns: [
    { id: 'a1', at: '08:51', items: [
      { kind: 'prompt', id: 'a1p', text: 'Vérifie que la version en ligne du portfolio correspond au dernier commit de main.' },
      { kind: 'tool', id: 'a1t1', tool: 'Bash', label: 'git log -1 --format=%H origin/main', status: 'success', durationMs: 900 },
      { kind: 'tool', id: 'a1t2', tool: 'Bash', label: 'curl -s https://paper-channel.be/version.json', status: 'success', durationMs: 640 },
      { kind: 'tool', id: 'a1t3', tool: 'Bash', label: 'pnpm build --filter portfolio', status: 'unknown', durationMs: 52000 }
    ] }
  ]
};

const pip: Thread = {
  files: {},
  turns: [
    { id: 'p1', at: '10:05', items: [
      { kind: 'prompt', id: 'p1p', from: 'otto', text: 'Relis les parcours « créer une tâche » et « reprendre une conversation » dans docs/desktop-navigation.md. Note tout ce qui demande plus de deux clics ou un retour en arrière.' },
      { kind: 'tool', id: 'p1t1', tool: 'Read', label: 'docs/desktop-navigation.md', status: 'success', durationMs: 120 },
      { kind: 'tool', id: 'p1t2', tool: 'Read', label: 'docs/mockups/desktop-observatory/launch.tsx', status: 'success', durationMs: 160 },
      { kind: 'message', id: 'p1m', text: 'Premier constat : depuis la liste, reprendre une conversation se fait en un clic. Créer une tâche depuis un projet vide demande d’ouvrir le menu de la table ; je vérifie s’il existe un chemin plus court.' },
      { kind: 'tool', id: 'p1t3', tool: 'Grep', label: 'Nouvelle session', status: 'running', startedAt: ago(9) }
    ] }
  ]
};


export const RIO_PLAN = `# Version 0.6.0

38 commits depuis la v0.5.4 : la page de session, la colonne des agents, l’aperçu des modifications et deux corrections de reconnexion SSH. Rien n’est publié : la release reste en **brouillon** jusqu’à ta relecture.

## Étapes

1. **Changelog** — regrouper les 38 commits dans \`CHANGELOG.md\` en *Ajouts*, *Corrections* et *Interne*, avec le lien de chaque PR.
2. **Numéro de version** — passer à \`0.6.0\` dans \`package.json\`, \`apps/overlay/package.json\`, \`apps/overlay/src-tauri/Cargo.toml\` et \`tauri.conf.json\`, puis \`cargo update -p ledge-overlay\`.
3. **Vérifications** — \`pnpm test\`, \`pnpm lint\` et \`cargo test --workspace\` ; je m’arrête au premier échec.
4. **Installeurs** — reconstruire l’installeur NSIS Windows (\`pnpm tauri build\`) et vérifier sa taille (~9 Mo) et sa signature.
5. **Notes de version FR / EN** — \`docs/releases/0.6.0.fr.md\` et \`0.6.0.en.md\`, trois captures de la page de session.
6. **Tag** — \`git tag -a v0.6.0\` sur \`main\`, sans pousser avant ton accord.
7. **Release en brouillon** — créer la release GitHub en brouillon avec l’installeur et les notes.

## Hors périmètre

- La publication de la release et l’annonce.
- La mise à jour automatique depuis la 0.5.x (prévue en 0.6.1).

## Risques

| Risque | Parade |
| --- | --- |
| \`Cargo.lock\` en conflit avec la branche *mobile-ui* | rebaser avant l’étape 2 |
| Icônes en cache dans l’installeur | \`cargo clean -p ledge-overlay\` avant l’étape 4 |`;

const rio: Thread = {
  files: {},
  turns: [
    { id: 'r1', at: '10:48', items: [
      { kind: 'prompt', id: 'r1p', text: 'Prépare la version 0.6 : changelog, numéros de version, installeur, notes de version en français et en anglais. Montre-moi le plan avant de toucher à quoi que ce soit.' },
      { kind: 'tool', id: 'r1t1', tool: 'Bash', label: 'git log v0.5.4..HEAD --oneline', status: 'success', durationMs: 700, output: '38 commits' },
      { kind: 'tool', id: 'r1t2', tool: 'Read', label: 'CHANGELOG.md', status: 'success', durationMs: 110 },
      { kind: 'tool', id: 'r1t3', tool: 'Grep', label: '"version": "0.5.4"|version = "0.5.4"', status: 'success', durationMs: 380, output: '4 fichiers' },
      { kind: 'tool', id: 'r1t4', tool: 'Glob', label: '.github/workflows/*.yml', status: 'success', durationMs: 60, output: '3 fichiers' },
      { kind: 'tool', id: 'r1t5', tool: 'Read', label: 'docs/releases/0.5.4.fr.md', status: 'success', durationMs: 90 },
      { kind: 'message', id: 'r1m', text: 'J’ai fait le tour : quatre fichiers portent le numéro de version et le workflow de release attend un tag annoté. Voici le plan, je n’ai encore rien modifié.' },
      { kind: 'plan', id: 'r1plan', title: 'Version 0.6.0', text: RIO_PLAN, status: 'proposed' }
    ] }
  ],
  pending: { kind: 'plan', plan: 'r1plan', since: 'il y a 6 min' },
  unreadFrom: 'r1m'
};

const iris: Thread = {
  files: {
    'storefront/src/checkout/PaymentForm.tsx': { change: 'edit', diff: `@@ -12,9 +12,14 @@ export function PaymentForm({ order }: Props) {
   const [error, setError] = useState<string | null>(null);
   async function submit() {
     const res = await pay(order.id, card);
-    if (!res.ok) setError('Le paiement a échoué.');
+    if (!res.ok) setError(messageFor(res.error));
   }
+
+/** The API's error codes, as the shopper reads them. */
+const messageFor = (code: PaymentError) => MESSAGES[code] ?? MESSAGES.unknown;` },
    'storefront/src/checkout/messages.ts': { change: 'add', diff: addDiff(`export const MESSAGES = {
  card_declined: 'Votre banque a refusé la carte. Essayez une autre carte.',
  expired_card: 'Cette carte a expiré.',
  insufficient_funds: 'Le solde de la carte est insuffisant.',
  unknown: 'Le paiement n’a pas abouti. Aucun montant n’a été prélevé.'
} as const;`) }
  },
  turns: [
    { id: 'i1', at: '09:02', items: [
      { kind: 'prompt', id: 'i1p', text: 'Les messages d’erreur du paiement sont trop vagues. Liste les codes que renvoie l’API.' },
      { kind: 'tool', id: 'i1t1', tool: 'Grep', label: 'PaymentError', status: 'success', durationMs: 420, output: '12 résultats dans 5 fichiers' },
      { kind: 'tool', id: 'i1t2', tool: 'Read', label: 'api/src/payments/errors.ts', status: 'success', durationMs: 80 },
      { kind: 'reply', id: 'i1r', text: 'L’API renvoie quatre codes : `card_declined`, `expired_card`, `insufficient_funds` et `unknown`. Le formulaire les affiche tous comme « Le paiement a échoué. ».' }
    ] },
    { id: 'i2', at: '09:20', items: [
      { kind: 'prompt', id: 'i2p', text: 'Écris un message clair pour chacun et branche-les dans le formulaire.' },
      { kind: 'tool', id: 'i2t1', tool: 'Write', label: 'storefront/src/checkout/messages.ts', status: 'success', durationMs: 170, files: [{ path: 'storefront/src/checkout/messages.ts', change: 'add' }] },
      { kind: 'tool', id: 'i2t2', tool: 'Edit', label: 'storefront/src/checkout/PaymentForm.tsx', status: 'success', durationMs: 230, files: [{ path: 'storefront/src/checkout/PaymentForm.tsx', change: 'edit' }] },
      { kind: 'permission', id: 'i2k', tool: 'Bash', text: 'pnpm --filter storefront e2e checkout', decision: 'deny' },
      { kind: 'reply', id: 'i2r', text: 'Les messages sont branchés. Tu as refusé les tests de bout en bout : je n’ai lancé que la vérification de types, qui passe.' }
    ] },
    { id: 'i3', at: '09:41', items: [
      { kind: 'prompt', id: 'i3p', text: 'Les e2e prennent 10 minutes, lance seulement les tests unitaires du checkout.' },
      { kind: 'tool', id: 'i3t1', tool: 'Bash', label: 'pnpm --filter storefront test checkout', status: 'failed', durationMs: 6400, error: ' FAIL src/checkout/PaymentForm.test.tsx > shows the bank message\n Expected: "Votre banque a refusé la carte."\n Received: "Votre banque a refusé la carte. Essayez une autre carte."' },
      { kind: 'tool', id: 'i3t2', tool: 'Edit', label: 'storefront/src/checkout/PaymentForm.test.tsx', status: 'success', durationMs: 150 },
      { kind: 'tool', id: 'i3t3', tool: 'Bash', label: 'pnpm --filter storefront test checkout', status: 'success', durationMs: 5900, output: ' Tests  14 passed (14)' },
      { kind: 'reply', id: 'i3r', text: 'Un test attendait l’ancien texte ; je l’ai mis à jour. Les **14 tests** du checkout passent.' }
    ] },
    { id: 'i4', at: '10:02', items: [
      { kind: 'prompt', id: 'i4p', text: 'Aligne aussi les erreurs du formulaire sur les réponses de l’API pour les cartes 3-D Secure.' },
      { kind: 'tool', id: 'i4t1', tool: 'Grep', label: 'requires_action|3ds', status: 'success', durationMs: 360, output: '5 résultats dans 2 fichiers' },
      { kind: 'message', id: 'i4m', text: 'L’API renvoie `requires_action` quand la banque demande une validation. Je prépare l’écran d’attente pendant la validation.' },
      { kind: 'tool', id: 'i4t2', tool: 'Read', label: 'storefront/src/checkout/ThreeDSecure.tsx', status: 'running', startedAt: ago(20) }
    ] }
  ],
  unreadFrom: 'i3r'
};

export const THREADS: Record<string, Thread> = { otto, nova, milo, sage, ash, pip, iris, rio };

/** Agents without a written thread get a plausible one from their task and last reply. */
const made = new Map<string, Thread>();
export function fallbackThread(a: { id: string; task: string; reply: string; state: string; offline?: boolean; parent?: string; repos: string }): Thread {
  const known = made.get(a.id); if (known) return known;
  const repo = a.repos.split(' · ')[0] || '.';
  const items: Item[] = [
    { kind: 'prompt', id: a.id + 'p', text: `${a.task}. Travaille dans ${a.repos} et tiens-moi au courant des décisions à prendre.`, ...(a.parent ? { from: a.parent } : {}) },
    { kind: 'tool', id: a.id + 't1', tool: 'Glob', label: `${repo}/**/*`, status: 'success', durationMs: 120, output: '146 fichiers' },
    { kind: 'tool', id: a.id + 't2', tool: 'Read', label: `${repo}/README.md`, status: 'success', durationMs: 90 },
    { kind: 'tool', id: a.id + 't3', tool: 'Grep', label: a.task.split(' ').slice(-1)[0]!.replace(/[’']/g, ''), status: 'success', durationMs: 410, output: '8 résultats' }
  ];
  const working = a.state === 'working' && !a.offline;
  if (working) items.push({ kind: 'message', id: a.id + 'm', text: a.reply }, { kind: 'tool', id: a.id + 't4', tool: 'Read', label: `${repo}/src/index.ts`, status: 'running', startedAt: ago(14) });
  else if (a.state === 'done') items.push({ kind: 'reply', id: a.id + 'r', text: a.reply });
  else items.push({ kind: 'message', id: a.id + 'm', text: a.reply });
  const pending: Pending | undefined = a.offline ? undefined : a.state === 'approval'
    ? { kind: 'approval', tool: 'Action', command: a.task, summary: a.reply, since: 'il y a quelques minutes' }
    : a.state === 'question' ? { kind: 'question', text: a.reply, choices: [], since: 'il y a quelques minutes' } : undefined;
  const t: Thread = { files: {}, turns: [{ id: a.id + '1', at: '10:40', items }], ...(pending ? { pending } : {}) };
  made.set(a.id, t); return t;
}
