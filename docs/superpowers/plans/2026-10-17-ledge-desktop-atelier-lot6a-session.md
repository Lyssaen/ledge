# Ledge Desktop Atelier, lot 6a : la Session (page, fil, réponse) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La page de session de la maquette à la place du `Pending` de l'emplacement « session » : le fil plat (consignes, réponses en Markdown, actions repliées en une ligne de résumé, décisions passées en pastilles, sous-agents en cartes, « Nouveau », « Aller au dernier message »), la demande épinglée au-dessus du champ de réponse (Autoriser / Refuser / « Toujours autoriser pour cette session », les trois réponses à un plan, les choix 1…9, refuser avec une note), la colonne « Agents du projet » avec les sous-agents sous leur parent, la page d'un sous-agent, le terminal (O), le tout sur le vrai daemon, qui apprend « toujours » et la note.

**Architecture:** Le fil affiché est calculé par une fonction pure (`src/session/thread.ts` : échanges, segments, résumé des actions, durées, marqueur « Nouveau ») sur les `ThreadItem` du daemon, que `useThread` demande à l'ouverture. Les envois (décisions et réponses) passent tous par `useDecisions` (lot 5), qui apprend la réponse libre, « toujours », la note, et reconnaît un refus par le type du message refusé (`request`, ajouté à `error` par le daemon) au lieu de l'id seul. La position de lecture, les brouillons et le dernier élément vu vivent en mémoire dans la coquille (`src/session/memory.ts`) ; seul le terminal affiché est mémorisé (`desktop.session`). Le lecteur Markdown de l'overlay passe dans `@ledge/ui` pour être partagé.

**Tech Stack:** TypeScript, React 19, Vite 6, CSS à la main dans `src/styles/` (requêtes de conteneur comme la maquette), react-markdown 10.1.0 + remark-gfm 4.0.1 (déjà dans l'overlay, déplacés dans `@ledge/ui`), zod (protocole), vitest 3 + Testing Library + jsdom, Playwright 1.49, daemon Node (`packages/ledge`, vitest).

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` §§ 6 (« Toujours autoriser pour cette session », les trois réponses à un plan, « Nouveau » et position de lecture locaux, une fonction absente d'un harnais est masquée) et 7 lot 6. Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` §§ 2.7 en entier, 2.8 (« Fil plat », « Lecture », « Répondre » ; le reste au lot 6b), 9 (R, Y / N, 1…9, O, Échap, Alt ← / →). Maquette : `docs/mockups/desktop-observatory/session.tsx` (`Summary`, `ActionRow`, `Chip`, `SessionPage` : `renderItem`, `renderTurn`, `pendingCard`, `replyArea`, `handleKey`, le défilement lignes 234-247), `session.css`, `observatory.tsx` lignes 297-298 (fil d'Ariane avec parent, statut et bascule du terminal) et 354-356 (colonne, pastille « N sous-agents », terminal), `office.css` lignes 253-309. Page construite : `docs/mockups/ledge-desktop-observatory.html`.

**Découpage du lot 6 en deux plans exécutés à la suite.** Le lot complet fait quinze tâches : trop pour une revue tâche par tâche lisible. Ce plan (6a, neuf tâches) livre une page qui sert déjà les trois raisons d'ouvrir une session sauf la relecture des diffs : lire ce que l'agent a fait, lui répondre, décider. `2026-10-17-ledge-desktop-atelier-lot6b-session.md` (six tâches) ajoute Fil / Modifications et le diff, la lecture côte à côte, les plans en cartes et la liste de tâches ; il s'appuie sur les interfaces produites ici (`exchanges`, `SessionPage`, `useDecisions`, `desktop.session`). Chaque plan laisse la branche testée et construite.

**Reporté hors du lot 6 (à noter au registre du coordinateur) :**
- **« Ouvrir dans l'éditeur »** : il faut une commande Tauri (Rust) qui lance `code` (`--remote ssh-remote+<alias>` ou `wsl+<distro>`) et dit si VS Code est présent ; `open_url` n'accepte que http(s) (`crates/ledge-native/src/browser.rs`) et il n'y a pas de cargo dans ce WSL. Le bouton n'est pas rendu (masqué, comme l'exige § 6 quand VS Code est introuvable) jusqu'à un lot construit sous Windows.
- **Le zoom et la position de l'atelier gardés pendant un aller-retour par une session** (reste du lot 4) : reporté ; l'atelier se réajuste au retour, comme aujourd'hui.
- **Un bouton « Interrompre »** : ni la spec ni la maquette n'en ont sur la page ; il n'est pas construit.

## Global Constraints

- Worktree `.worktrees/desktop-atelier`, branche `feat/desktop-atelier`. Un autre agent peut committer de petits correctifs dans `apps/desktop` : relire chaque fichier cité avant de le modifier.
- **La maquette fait foi** pour la disposition, les classes et les CSS. `session.css` est porté **en entier** dans `src/styles/session.css` à la tâche 6 (ses parties Modifications, volet, plans et liste de tâches servent au lot 6b), puis les règles de la colonne, de la pastille, du fil d'Ariane avec parent et du terminal (`office.css` lignes 253-277 et 289-309, `observatory.css` : `.conversation-workspace`, `.conversation`, `.terminal-pane`, `.pane-heading`, `.terminal-*`) à la tâche 8. Écarts voulus :
  - **fil plat seulement** : les règles du fil replié par tour (`.turn-head`, `.turn-toggle`, `.turn.folded`, `.folded-note`) ne sont pas portées, la maquette elle-même les annule ;
  - **le terminal est un aperçu en lecture seule** (`session.preview`), sans champ de commande ; « Ouvrir dans un terminal » passe par le pont Tauri existant ;
  - **les durées « depuis »** (fil figé, session terminée, demande épinglée) utilisent `whenOf` / `list.when` du lot 5 (« il y a 2 h »), pas le « il y a 1 h 35 » de la maquette ;
  - **le nom d'un sous-agent est son `kind`** (lot 5), son bot celui de `HelperBot`.
- **Textes** dans `src/i18n/messages.ts`, `fr` source de vérité. Les textes français des tableaux sont exacts ; l'implémenteur écrit l'anglais, sauf les traductions fixées par les tests, que chaque tâche liste.
- **Le harnais n'est jamais écrit** sur la page (la forme du bot le dit), sauf là où la maquette l'écrit (lot 6b, Modifications vides de Cursor).
- **Agent principal** = une `Session`. **Sous-agent** = une entrée de `session.helpers` (ou, terminé, l'élément `helper` du fil) ; sa page est l'emplacement `{ kind: 'session', id: <parent>, helper: <helper.id> }`, son fil les éléments qui portent `helperId`. On ne lui répond pas : ses demandes se décident sur la page du parent (le daemon les route par lui).
- **Rien d'optimiste** : une décision ou une réponse part une fois, les boutons attendent, rien ne bouge avant la diffusion de la session ou du fil ; un refus est dit en clair dans le toast et rend la main (et le texte de la réponse).
- **Une réponse qu'un harnais ne permet pas est masquée** : « Toujours autoriser » et la note suivent `offers(tool, kind, …)` (tâche 2), partagé par le daemon et Desktop.
- **Clavier** : Échap est offert à l'écran après la fenêtre modale et le chat, avant la navigation (tâche 1). R, Y, N, 1…9, O ne sont jamais pris pendant une saisie (les gardes de `useKeys`) ni sur une session hors ligne, en lecture seule ou un sous-agent pour Y / N / 1…9.
- **Stockage** : une seule nouvelle clé, `desktop.session` = `{ terminal: boolean, split: number }` (défauts `false` et `0.5`, `split` borné à `[0.3, 0.72]`, servi au lot 6b), validée champ par champ. Brouillons, position de lecture et dernier élément vu : en mémoire dans la coquille, par session (et par sous-agent) ; ils survivent à la navigation, pas à un redémarrage. Les noms de `OBSOLETE_KEYS` (`desktop.drafts`, `desktop.thread`, `desktop.panel`…) ne sont jamais réutilisés.
- Aucune nouvelle dépendance dans `apps/desktop` ; `@ledge/ui` reprend `react-markdown` 10.1.0 et `remark-gfm` 4.0.1 de l'overlay. Aucun changement Tauri ni Rust. Aucune erreur console dans Playwright.
- Les changements de protocole sont faits ensemble dans `packages/protocol`, `packages/ledge` et `packages/fleet` (versions alignées) ; l'overlay doit continuer à compiler et passer ses tests.
- Suites unitaires en anglais. Commits `feat(desktop): …`, `feat(daemon): …`, `refactor(desktop): …`, `test(desktop): …`, terminés par la ligne `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Une décision ou une réponse alors que le fil charge encore ou que la machine tombe** : la demande épinglée vient de `session.pending`, pas du fil, et se décide fil non chargé ; un refus (y compris « hors ligne » au moment de l'envoi) est dit dans le toast et rend les boutons et le texte ; une machine hors ligne remplace le champ par l'avis et retire la demande. Tests à la tâche 7.
2. **Un long fil où des éléments arrivent pendant qu'on relit plus haut** : la vue ne saute pas, « Aller au dernier message » apparaît et y mène ; au bout du fil, un nouvel élément reste en vue. Test Playwright à la tâche 9 (le défilement n'existe pas dans jsdom), règle pure `atEnd` à la tâche 4.
3. **Taper dans la réponse** : R, Y, N, 1…9, O, J, K y sont du texte ; Échap quitte le champ sans quitter la page ; Entrée envoie, Maj + Entrée va à la ligne. Tests à la tâche 7.
4. **Passer d'un agent à l'autre avec le terminal ouvert et un brouillon** : le brouillon reste à sa session, le terminal reste ouvert et montre l'agent suivant, le focus n'est pas volé. Tests aux tâches 7 (brouillon) et 8 (terminal).
5. **Deux refus dans le même lot de messages, ou un refus de réponse pendant qu'une décision est en vol** : chacun est rattaché à son envoi (session et type de message) ; aucun ne finit en « non confirmé » au bout de 8 s. Tests à la tâche 3.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/desktop/src/nav/{state,useKeys}.ts` | Emplacement d'un sous-agent, intention « réponse », Échap offert à l'écran |
| `apps/desktop/src/shell/cls.ts`, `apps/desktop/src/fleet/waits.ts` | Nouveaux : `cls` partagé, `useWaits` dans la coquille |
| `packages/protocol/src/{decisions,messages,thread,index}.ts` | `Decision`, `offers`, `note`, `error.request`, `always` dans le fil |
| `packages/ledge/src/adapters/{types,claude,codex,cursor}.ts`, `src/daemon/{server,history}.ts` | Les touches de « toujours » et de la note, refus nommés |
| `packages/fleet/src/{store,fleet}.ts`, `packages/fleet/test/mockDaemon.ts` | `errors`, `request`, fils servis par le faux daemon |
| `apps/desktop/src/fleet/{decisions,useFleet}.ts` | Envois par requête, réponses |
| `packages/ui/src/documents/{markdown.tsx,references.ts,markdown.css}` | Le lecteur Markdown partagé (venu de l'overlay) |
| `apps/desktop/src/session/{thread,useThread,memory,prefs,terminal}.ts` | Nouveaux : modèle pur du fil, demande du fil, mémoire, `desktop.session`, terminal |
| `apps/desktop/src/session/{Workspace,SessionPage,Thread,ActionGroup,PendingCard,Reply,AgentsRail,TerminalPane}.tsx` | Nouveaux : rendu |
| `apps/desktop/src/{App.tsx,shell/TopBar.tsx,list/*,atelier/ProjectTable.tsx}` | Branchement, fil d'Ariane, ouverture d'un sous-agent |
| `apps/desktop/src/styles/session.css` | Nouveau : `session.css` et les règles de la colonne et du terminal |
| `apps/desktop/test/*`, `apps/desktop/e2e/{daemon.ts,session.spec.ts}` | Tests |

---

### Task 1: Restes du lot 5 : Échap à l'écran, ouvrir un sous-agent ou la réponse, attentes dans la coquille

Quatre reports de la revue du lot 5, sans écran neuf. Échap part aujourd'hui vers la navigation avant que l'écran le voie (`useKeys.ts`, ligne `if (e.key === 'Escape')`) : la page de session doit pouvoir fermer ses volets d'abord. « Répondre » de la Liste n'envoie qu'`open`, sans dire que la réponse doit prendre le focus. Le début des attentes (`trackWaits`) vit dans la Liste et se perd quand elle se démonte, alors que la demande épinglée affichera « depuis 12 min ». `cls` est copié trois fois et la page en ajouterait une quatrième.

**Files:**
- Create: `apps/desktop/src/shell/cls.ts`, `apps/desktop/src/fleet/waits.ts`
- Modify: `apps/desktop/src/nav/state.ts`, `apps/desktop/src/nav/useKeys.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/list/{List,ListRow,ListGroup}.tsx`, `apps/desktop/src/atelier/ProjectTable.tsx`
- Test: `apps/desktop/test/{screen-keys,nav-state,list-keys,list-actions,atelier-table}.test.tsx` (ou `.ts`)

**Interfaces:**
- Consumes : `trackWaits`, `Wait` (`list/time.ts`), `useScreenKeys`.
- Produces :

```ts
// nav/state.ts
export type Place =
  | { kind: 'overview'; view: View; project: ProjectFilter }
  /** helper : la page d'un sous-agent de `id` ; focus : la réponse prend le focus à l'arrivée (« Répondre » de la Liste). */
  | { kind: 'session'; id: string; helper?: string; focus?: 'reply'; view: View; project: ProjectFilter }
  | { kind: 'settings'; section: SectionId; back: Exclude<Place, { kind: 'settings' }> };
export type NavAction = /* … */ | { type: 'open'; id: string; helper?: string; focus?: 'reply' } /* … */;

// shell/cls.ts
export const cls: (...names: (string | false | null | undefined)[]) => string;

// fleet/waits.ts
/** Le début de chaque attente (trackWaits), tenu par la coquille : il survit à la Liste et à la page de session. */
export function useWaits(sessions: readonly Session[]): ReadonlyMap<string, Wait>;

// list/List.tsx — ListProps gagne :
waits: ReadonlyMap<string, Wait>;
```

Règles :
- `navReducer` `open` pose `helper` et `focus` seulement s'ils sont donnés (une clé absente, pas `undefined`). `reconcile` garde un emplacement de sous-agent tant que son parent existe (un sous-agent terminé garde son fil).
- `useKeys` : Échap ferme d'abord la fenêtre modale (`dispatch escape`), puis le chat (idem) ; sinon il est offert à `screen.current`, **même pendant une saisie** (l'écran décide ; le filtre de la Liste et le menu gardent leurs propres gestionnaires, qui arrêtent l'événement avant `window`) ; pris, `preventDefault` et rien d'autre ; refusé, `dispatch({ type: 'escape' })`.
- Alt ← / → depuis la page d'un sous-agent part de son parent dans `order`.
- Un sous-agent s'ouvre désormais sur sa page : `ListRow` (clic, Entrée de la Liste) et le siège de sous-agent de `ProjectTable` envoient `{ type: 'open', id: parent.id, helper: helper.id }`. « Répondre » envoie `{ type: 'open', id, focus: 'reply' }`.
- Tant que la page n'existe pas (tâche 6), `App` donne au `Pending` de session le titre `helper.task` sur la page d'un sous-agent.
- `App` appelle `useWaits(sessions)` et passe `waits` à la Liste, qui ne tient plus de ref `tracked`.
- `cls` remplace les trois copies.

- [ ] **Step 1: Écrire les tests**

Dans `screen-keys.test.tsx`, le test « never while typing… Escape and Alt stay global » ne vérifie plus qu'Échap échappe à l'écran ; il garde le reste. Ajouter :

```tsx
it('Escape goes to the screen after a dialog and the chat, before navigation; a screen that takes it keeps the place', () => {
  const handler = vi.fn((e: KeyboardEvent) => e.key === 'Escape');
  const dispatch = vi.fn();
  const { rerender } = render(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
  expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
  screen.getByRole('textbox', { name: 'field' }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(handler).toHaveBeenCalledTimes(2);                                   // the screen decides, even while typing
  (document.activeElement as HTMLElement).blur();
  rerender(<Harness state={{ ...base, modal: { kind: 'shortcuts' } }} keys={{ current: handler }} dispatch={dispatch} />);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  rerender(<Harness state={{ ...base, chat: true }} keys={{ current: handler }} dispatch={dispatch} />);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(handler).toHaveBeenCalledTimes(2);
  expect(dispatch.mock.calls).toEqual([[{ type: 'escape' }], [{ type: 'escape' }]]);
});
it('a screen that declines Escape lets navigation have it', () => {
  const dispatch = vi.fn();
  render(<Harness state={base} keys={{ current: () => false }} dispatch={dispatch} />);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(dispatch).toHaveBeenCalledWith({ type: 'escape' });
});
```

Dans `nav-state.test.ts` :

```ts
it('open may name a subagent and ask for the reply; the next open forgets both', () => {
  const s = navReducer(base, { type: 'open', id: 'local:otto', helper: 'h1' });
  expect(s.place).toEqual({ kind: 'session', id: 'local:otto', helper: 'h1', view: 'atelier', project: 'all' });
  const r = navReducer(s, { type: 'open', id: 'local:kit', focus: 'reply' });
  expect(r.place).toEqual({ kind: 'session', id: 'local:kit', focus: 'reply', view: 'atelier', project: 'all' });
  expect(navReducer(r, { type: 'open', id: 'local:kit' }).place).toEqual({ kind: 'session', id: 'local:kit', view: 'atelier', project: 'all' });
  expect(navReducer(s, { type: 'escape' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
});
it('a subagent page stays while its parent exists', () => {
  const s = navReducer(base, { type: 'open', id: 'local:otto', helper: 'gone' });
  expect(reconcile(s, [fakeSession('local:otto')], null)).toBe(s);
  expect(reconcile(s, [], null).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
});
```

Dans `list-keys.test.tsx` (avec `row`, `banner` du fichier) :

```tsx
it('↓ / ↑ walk like J / K; K with nothing chosen takes the last row', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  await user.keyboard('k'); expect(row('Kit')).toHaveFocus();
  await user.keyboard('{ArrowUp}'); expect(row('Nova')).toHaveFocus();
  await user.keyboard('{ArrowDown}'); expect(row('Kit')).toHaveFocus();
});
it('an empty List takes neither J nor K', async () => {
  const { user } = await boot({ sessions: [], list: true });
  await user.keyboard('jk');
  expect(document.querySelector('.lrow')).toBeNull();
  expect(document.activeElement).toBe(document.body);
});
it('Enter on a subagent row opens the subagent', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
  screen.getByRole('listitem', { name: /subagent of Otto/ }).focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('heading', { name: 'Lire le code' })).toBeVisible();
});
it('a wait keeps its start across a session round trip, though the pane refreshed the activity', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  expect(row('Otto').querySelector('.r-when')).toHaveTextContent('for 12 min');
  await user.click(row('Otto'));
  d.upsert({ ...listSessions()[0]!, lastActivityAt: new Date().toISOString() });
  await waitFor(() => expect(banner().getByText('Otto')).toBeVisible());
  await user.keyboard('{Escape}');
  expect(row('Otto').querySelector('.r-when')).toHaveTextContent('for 12 min');
});
```

Le test « J / K walk the rows shown… Enter opens » garde sa dernière ligne (`banner().getByText('Otto')`) : la page d'un sous-agent montre son parent dans le fil d'Ariane.

Dans `atelier-table.test.tsx`, le test des sièges de sous-agent ajoute : un clic sur « Explore, subagent of Otto: Lire le code » appelle `dispatch` avec `{ type: 'open', id: otto.id, helper: 'h1' }`. Dans `list-actions.test.tsx`, le clic sur « Reply » de Kit est suivi de `expect(…)` sur le fil d'Ariane comme aujourd'hui (le focus est vérifié à la tâche 7).

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/screen-keys.test.tsx test/nav-state.test.ts test/list-keys.test.tsx test/atelier-table.test.tsx`
Expected : FAIL, Échap ne passe pas par l'écran, `open` ignore `helper`, la Liste perd l'attente.

- [ ] **Step 3: Implémenter l'emplacement, Échap, `useWaits`, `cls` et les ouvertures**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe, `keys`, `list-keys` (le filtre et Échap) et `menu` compris ; `grep -rn "const cls" apps/desktop/src` ne trouve que `shell/cls.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "refactor(desktop): Escape reaches the screen before navigation; open a subagent or the reply; waits kept by the shell; one cls

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Le daemon apprend « toujours », la note, et nomme ce qu'il refuse

`session.decide` ne connaît que `accept` / `deny` (build § 6). Les adaptateurs tapent les réponses dans le terminal (`keysFor`) en lisant le dialogue à l'écran : « toujours » et la note sont deux nouvelles façons de le faire, masquées pour un harnais qui ne les offre pas. Un `error` ne dit pas quel message il refuse : Desktop ne peut pas distinguer un refus de réponse d'un refus de décision pour la même session.

**Files:**
- Create: `packages/protocol/src/decisions.ts`
- Modify: `packages/protocol/src/{messages,thread,index}.ts`, `packages/protocol/test/messages.test.ts`, `packages/ledge/src/adapters/{types,claude,codex,cursor}.ts`, `packages/ledge/src/daemon/{server,history}.ts`, `packages/ledge/test/{adapters-claude,adapters-codex,adapters-cursor,server}.test.ts`, `apps/overlay/src/i18n/messages.ts` (`thread.decided.always`)

**Interfaces:**
- Consumes : `Tool`, `Pending` (`@ledge/protocol`) ; `KeyPlan`, `parseDialog`, `atRest`, `digit`, `inSkipField`, `REVISE`, `typed`, `REPLY_ENTER_DELAY_MS` (adaptateurs existants).
- Produces :

```ts
// packages/protocol/src/decisions.ts
export const DecisionSchema: z.ZodEnum<['accept', 'deny', 'always']>;
export type Decision = z.infer<typeof DecisionSchema>;
export const NOTE_MAX = 4000;
/** Ce qu'un harnais laisse répondre au-delà d'accept / deny, par sorte de demande : `always` (permission : ne plus demander ;
 *  plan : approuver et accepter les modifications automatiquement) et une note (refuser avec un texte que l'agent lit). */
export const DECISION_OFFERS: Record<Tool, { always: readonly Pending['kind'][]; note: readonly Pending['kind'][] }> = {
  claude: { always: ['permission', 'diff', 'plan'], note: ['permission', 'diff', 'plan'] },
  codex: { always: ['permission', 'diff'], note: ['permission', 'diff', 'plan'] },
  cursor: { always: [], note: ['permission', 'plan'] }
};
export function offers(tool: Tool, kind: Pending['kind'], what: 'always' | 'note'): boolean;

// messages.ts
z.object({ type: z.literal('session.decide'), id: z.string(), decision: DecisionSchema, note: z.string().trim().min(1).max(NOTE_MAX).optional() })
z.object({ type: z.literal('error'), message: z.string(), id: z.string().optional(), /** Le type du message client refusé. */ request: z.string().optional() })
// SessionEventSchema.decision : DecisionSchema.optional()
// thread.ts — l'élément permission : decision: z.enum(['accept', 'deny', 'always', 'unknown']).optional()

// adapters/types.ts
keysFor(decision: Decision, pending: Pending, pane?: string, note?: string): KeyPlan;

// daemon/history.ts
decide(id: string, decision: Decision): ThreadItem | undefined;
```

Pourquoi cette table : Cursor n'a pas d'option « pour cette session » (son « Add … to allowlist » est permanent, « Run Everything » ouvre tout) ni d'acceptation automatique au plan ; Codex n'en a pas au plan (« Yes, clear context and implement » n'est pas cela). Une demande `question` ne prend jamais `decide`.

Touches, toutes lues sur le dialogue à l'écran (`pane`), comme `keysFor` aujourd'hui :

| Harnais | `always`, permission / diff | `always`, plan | `deny` + note, permission / diff | `deny` + note, plan |
| --- | --- | --- | --- | --- |
| Claude Code | chiffre de la première option qui correspond à `/don't ask again\|always allow\|accept edits\|for this session/i` sans `/auto mode/i` | chiffre de `/accept edits\|auto mode/i` (« Yes, and use auto mode » a remplacé « auto-accept edits » en 2.1) | `Escape`, `until atRest`, le texte, `Enter` | la ligne libre `/Tell Claude what to change/i` comme `freeTextPlan` (chiffre, `until` ligne choisie, texte, `Enter`) ; sans elle, comme une permission |
| Codex | la lettre entre parenthèses en fin de la ligne brute de l'option `/don't ask again/` (`p` pour une commande, `a` pour des fichiers) | — | `Escape`, `until atRest`, le texte, `waitMs REPLY_ENTER_DELAY_MS`, `Enter` | chiffre de `/^No\b/`, puis comme une permission après `Escape` |
| Cursor | — | — | `n`, `until inSkipField`, le texte, `until typed`, `Enter` | `p`, `until REVISE`, le texte, `until typed`, `Enter` |

Le texte de la note est aplati sur une ligne comme dans `replyPlan`. Une option attendue absente du dialogue : `throw new Error(NO_ALWAYS)` avec `NO_ALWAYS = 'no "always" option in this dialog, answer in the terminal'` (le client reçoit l'`error` comme pour un dialogue illisible).

Dans `server.ts` :
- `session.decide` refuse, avant toute frappe : `always` quand `!offers(s.tool, pending.kind, 'always')`, une note avec autre chose que `deny` ou quand `!offers(…, 'note')`, par `NOT_OFFERED = 'this answer is not offered for this request, answer in the terminal'` ;
- il passe `msg.note` à `keysFor` et, une fois le dialogue parti, `history.decide(id, msg.decision)` (`always` arrive dans le fil) ;
- **chaque** `error` qui répond à un message `session.*` porte `request: msg.type`, la capture générique (`handle(ws, msg).catch`) aussi.

Overlay : `thread.decided` gagne `always: 'Toujours autorisée'` / `'Always allowed'`, rien d'autre (il n'envoie toujours que `accept` / `deny`).

- [ ] **Step 1: Écrire les tests**

Protocole (`messages.test.ts`) :

```ts
it('session.decide takes always and a trimmed note; an empty or oversized note is refused', () => {
  expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'always' })).toEqual({ type: 'session.decide', id: 'a', decision: 'always' });
  expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', note: '  Use pnpm ' })).toMatchObject({ note: 'Use pnpm' });
  expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', note: '   ' })).toThrow();
  expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', note: 'x'.repeat(4001) })).toThrow();
  expect(parseServerMessage({ type: 'error', id: 'a', message: 'no', request: 'session.reply' })).toEqual({ type: 'error', id: 'a', message: 'no', request: 'session.reply' });
});
it('what each harness offers', () => {
  expect([offers('claude', 'plan', 'always'), offers('codex', 'plan', 'always'), offers('codex', 'diff', 'always'), offers('cursor', 'permission', 'always'),
    offers('cursor', 'plan', 'note'), offers('claude', 'question', 'note'), offers('claude', 'question', 'always')]).toEqual([true, false, true, false, true, false, false]);
});
```

Adaptateurs (avec `fx` des fichiers de test) :

```ts
// adapters-claude.test.ts
it('always picks the option that stops asking, never auto mode, read from the dialog', () => {
  expect(claudeAdapter.keysFor('always', perm, fx('claude2-permission-bash'))).toEqual([{ text: '2' }]);   // Yes, and always allow access to
  expect(claudeAdapter.keysFor('always', diff, fx('claude2-permission-write'))).toEqual([{ text: '2' }]);  // accept edits … for this session
  expect(claudeAdapter.keysFor('always', plan, fx('claude2-plan'))).toEqual([{ text: '1' }]);             // Yes, and use auto mode
  expect(() => claudeAdapter.keysFor('always', perm, fx('claude2-question'))).toThrow('no "always" option in this dialog, answer in the terminal');
});
it('deny with a note: Escape, then the note once the input is back; a plan takes it in its own row', () => {
  expect(claudeAdapter.keysFor('deny', perm, fx('claude2-permission-bash'), 'Use\npnpm')).toEqual([{ keys: ['Escape'] }, { until: expect.any(Function) }, { text: 'Use pnpm' }, { keys: ['Enter'] }]);
  expect(claudeAdapter.keysFor('deny', plan, fx('claude2-plan'), 'Garde la v1')).toEqual([{ text: '3' }, { until: expect.any(Function) }, { text: 'Garde la v1' }, { keys: ['Enter'] }]);
});
// adapters-codex.test.ts
it('always takes the option letter that stops asking', () => {
  expect(codexAdapter.keysFor('always', perm, fx('codex-permission-exec'))).toEqual([{ text: 'p' }]);
  expect(codexAdapter.keysFor('always', diff, fx('codex-permission-patch'))).toEqual([{ text: 'a' }]);
});
it('deny with a note on a plan: stay in Plan mode, then the note', () => {
  expect(codexAdapter.keysFor('deny', plan, fx('codex-plan'), 'Garde la v1')).toEqual([{ text: '3' }, { until: expect.any(Function) }, { text: 'Garde la v1' }, { waitMs: REPLY_ENTER_DELAY_MS }, { keys: ['Enter'] }]);
});
// adapters-cursor.test.ts
it('deny with a note types it in the skip field, or in the plan revision field', () => {
  expect(cursorAdapter.keysFor('deny', perm, fx('cursor-permission'), 'Use pnpm')).toEqual([{ text: 'n' }, { until: expect.any(Function) }, { text: 'Use pnpm' }, { until: expect.any(Function) }, { keys: ['Enter'] }]);
  expect(cursorAdapter.keysFor('deny', plan, fx('cursor-plan'), 'Garde la v1')).toEqual([{ text: 'p' }, { until: expect.any(Function) }, { text: 'Garde la v1' }, { until: expect.any(Function) }, { keys: ['Enter'] }]);
});
```

`perm`, `diff`, `plan` : les `Pending` de chaque fichier (`kind` `permission`, `diff`, `plan`). Les `until` sont vérifiés en plus sur les fichiers qui montrent l'écran attendu (`claude2-rest-after-deny` pour `atRest`, `cursor-skip-field`, `cursor-plan-revise`), à la manière des tests existants.

Serveur (`server.test.ts`, describe `server`, avec `mk`, `fakeTmux`, `connect`) :

```ts
it('decide always on a Bash permission types the "always allow" option and lands as always in the thread', async () => {
  const pane = fx('claude2-permission-bash');
  tmux = fakeTmux({ 'ledge-a': [pane, pane, 'Running…'] }); await srv.close();
  const history = new History({ dir: tmpDir() }); srv = await startServer({ store, tmux, port: 0, history });
  store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' } }));
  store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'mkdir zz-ledge-probe' });
  const c = await connect({ port: srv.port }); await c.next('snapshot');
  c.send({ type: 'session.decide', id: 'a', decision: 'always' });
  expect((await c.next('session.thread.item', 3000)).item).toMatchObject({ kind: 'permission', decision: 'always' });
  expect(tmux.sent).toEqual([['text', 'ledge-a', '2']]);
  c.close();
});
it('an answer the harness does not offer is refused before any key, and the refusal names its request', async () => {
  store.upsert(mk('a', { tool: 'cursor', state: 'waiting_permission', pending: { kind: 'permission', text: 'echo hi', source: 'pane' } }));
  const c = await connect({ port: srv.port }); await c.next('snapshot');
  c.send({ type: 'session.decide', id: 'a', decision: 'always' });
  expect(await c.next('error', 3000)).toEqual({ type: 'error', id: 'a', message: 'this answer is not offered for this request, answer in the terminal', request: 'session.decide' });
  c.send({ type: 'session.decide', id: 'a', decision: 'accept', note: 'why' });
  expect((await c.next('error', 3000)).message).toBe('this answer is not offered for this request, answer in the terminal');
  expect(tmux.sent).toEqual([]);
  c.close();
});
```

Les tests existants qui attendent un `error` (dont `expectRefused`, `READ_ONLY`, `unknown session`) y ajoutent `request` (`'session.decide'`, `'session.reply'`…). `fx`, `tmpDir` et l'appel `store.apply` suivent les aides déjà présentes dans le fichier (ou dans `test/helpers.ts`).

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter @ledge/protocol test && pnpm --filter @paradow/ledge exec vitest run test/adapters-claude.test.ts test/adapters-codex.test.ts test/adapters-cursor.test.ts test/server.test.ts`
Expected : FAIL, `always` et `note` sont refusés par le schéma, `offers` n'existe pas.

- [ ] **Step 3: Implémenter le protocole, les trois adaptateurs, le serveur, l'historique et la copie de l'overlay**

- [ ] **Step 4: Vérifier que tout passe**

Run: `pnpm --filter @ledge/protocol test && pnpm --filter @paradow/ledge test && pnpm --filter overlay test && pnpm -r typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A packages/protocol packages/ledge apps/overlay/src/i18n
git commit -m "feat(daemon): always allow for the session, approve with auto edits, deny with a note; every refusal names its request

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Les envois de Desktop : un refus par requête, plusieurs par lot, les réponses

`useDecisions` (lot 5) rattache un `error` à la session par son seul id et ne voit que le dernier (`lastError`) : un refus de réponse serait pris pour celui de la décision en vol, et le second de deux refus arrivés ensemble finit en « non confirmé ». La page enverra aussi des réponses libres, « toujours » et des notes.

**Files:**
- Modify: `packages/fleet/src/store.ts`, `packages/fleet/src/fleet.ts`, `packages/fleet/test/{daemon,fleet}.test.ts`, `apps/desktop/src/fleet/{decisions,useFleet}.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/i18n/messages.ts`, `apps/desktop/test/{decisions,list-actions}.test.tsx`

**Interfaces:**
- Consumes : `Decision`, `offers` (tâche 2) ; `requestKey` (lot 5).
- Produces :

```ts
// packages/fleet/src/store.ts
export interface DaemonError { id?: string; message: string; seq: number; /** Le type du message refusé, quand le daemon le dit. */ request?: string }
export const ERRORS_KEPT = 20;
// DaemonState gagne : errors: readonly DaemonError[];   // les ERRORS_KEPT derniers, du plus ancien au plus récent ; lastError reste errors.at(-1) ?? null

// apps/desktop/src/fleet/useFleet.ts — FleetView gagne :
errors: readonly DaemonError[];

// apps/desktop/src/fleet/decisions.ts
/** Ce que le daemon change après avoir pris un message (sends.ts de feat/desktop) : état, activité, dernière réponse, demande. */
export function markOf(s: Session): string;
export interface Decisions {
  /** Un envoi (décision ou réponse) est en vol pour cette session. */
  busy(id: string): boolean;
  landed: string | null;
  /** false sans envoi : hors ligne, lecture seule, sans demande, question, déjà en vol, `always` ou note que offers() refuse, note sans deny. */
  decide(s: Session, decision: Decision, note?: string): boolean;
  /** false sans envoi : hors ligne, lecture seule, texte vide, déjà en vol, demande autre qu'une question. `onRefused` rend le texte. */
  reply(s: Session, text: string, onRefused?: (text: string) => void): boolean;
}
export function useDecisions(o: { client: Pick<DaemonClient, 'send'>; sessions: readonly Session[]; errors: readonly DaemonError[]; notify(text: string): void }): Decisions;
```

Règles :
- **store** : chaque `error` reçu est ajouté à `errors` avec `seq` croissant et `request`, la liste coupée aux 20 derniers.
- **fleet** : les `error` qu'il fabrique pour un message routé (`${label} is offline`, `Unknown machine`) portent `request: msg.type` ; ceux qu'il relaie gardent le leur.
- **envoi** : on retient `{ message: 'session.decide' | 'session.reply', pending: requestKey(s), mark: markOf(s), errorSeq: dernier seq vu, name, text?, onRefused? }` et la minuterie de 8 s.
- **abouti** : décision, quand `requestKey` change ; réponse, quand `markOf` change (session en ligne). `landed` comme aujourd'hui.
- **refusé** : à chaque changement de `errors`, chaque erreur de `seq` jamais traité, dans l'ordre, qui a le même `id`, le même `request` que l'envoi et un `seq` plus grand que `errorSeq`. Décision : `decisions.failed(name, message)` ; réponse : `decisions.replyFailed(name, message)` puis `onRefused(text)`. Une erreur sans `request` (daemon d'avant ce lot) ne refuse rien : la minuterie le dira.
- **jamais confirmé** : décision `decisions.unconfirmed(name)`, réponse `decisions.replyUnconfirmed(name)`.
- Le message envoyé : `{ type: 'session.decide', id, decision, ...(note ? { note } : {}) }`, `{ type: 'session.reply', id, text }` (texte tel quel, le schéma demande au moins un caractère ; `reply` refuse un texte vide une fois rogné).

Textes ajoutés :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `decisions.replyFailed(name, message)` | `Réponse non transmise à ${name} : ${message}` | `Could not send the reply to ${name}: ${message}` |
| `decisions.replyUnconfirmed(name)` | `Ledge n’a pas vu la réponse à ${name} aboutir. Vérifiez le fil.` | `Ledge did not see the reply to ${name} land. Check the thread.` |

- [ ] **Step 1: Écrire les tests**

`packages/fleet/test/daemon.test.ts` :

```ts
it('keeps the last 20 errors with their request, in order', () => {
  daemonStore.reset();
  for (let i = 1; i <= 25; i++) daemonStore.apply({ type: 'error', id: 'a', message: `e${i}`, ...(i % 2 ? { request: 'session.reply' } : {}) });
  const { errors, lastError } = daemonStore.getState();
  expect(errors.map(e => e.message)).toEqual(Array.from({ length: 20 }, (_, i) => `e${i + 6}`));
  expect(errors[0]).toEqual({ id: 'a', message: 'e6', seq: 6 });
  expect(lastError).toEqual({ id: 'a', message: 'e25', seq: 25, request: 'session.reply' });
});
```

`packages/fleet/test/fleet.test.ts` : un `session.reply` vers une machine hors ligne émet `{ type: 'error', id: <qualifié>, message: 'Dev SSH is offline', request: 'session.reply' }`.

`apps/desktop/test/decisions.test.tsx` : le `setup` passe `errors: []` au lieu de `lastError` ; les tests existants posent `errors: [{ …, request: 'session.decide' }]`. Ajouter :

```tsx
it('a refusal answers its own request: a refused reply is not blamed on the decision in flight', () => {
  const { result, rerender, props } = setup();
  act(() => { result.current.decide(otto, 'accept'); });
  const replyRefused = { id: 'local:otto', message: 'empty reply', seq: 1, request: 'session.reply' };
  rerender({ ...props, errors: [replyRefused] });
  expect(result.current.busy('local:otto')).toBe(true);
  expect(props.notify).not.toHaveBeenCalled();
  rerender({ ...props, errors: [replyRefused, { id: 'local:otto', message: 'nothing to decide', seq: 2, request: 'session.decide' }] });
  expect(result.current.busy('local:otto')).toBe(false);
  expect(props.notify).toHaveBeenCalledWith('Could not send the decision to Otto: nothing to decide');
});
it('two refusals in one batch are both said', () => {
  const nova = fakeSession('local:nova', { name: 'Nova', state: 'waiting_permission', pending: { kind: 'permission', text: 'rm -rf dist', source: 'hook' } });
  const { result, rerender, props } = setup({ sessions: [otto, nova] });
  act(() => { result.current.decide(otto, 'accept'); result.current.decide(nova, 'deny'); });
  rerender({ ...props, errors: [{ id: 'local:otto', message: 'a', seq: 1, request: 'session.decide' }, { id: 'local:nova', message: 'b', seq: 2, request: 'session.decide' }] });
  expect(props.notify.mock.calls).toEqual([['Could not send the decision to Otto: a'], ['Could not send the decision to Nova: b']]);
  expect([result.current.busy('local:otto'), result.current.busy('local:nova')]).toEqual([false, false]);
});
it('always and a note travel with the decision; what the harness does not offer is never sent', () => {
  const { result, props } = setup({ sessions: [otto] });
  act(() => { expect(result.current.decide(otto, 'accept', 'why')).toBe(false); });
  act(() => { expect(result.current.decide({ ...otto, tool: 'cursor' }, 'always')).toBe(false); });
  act(() => { expect(result.current.decide(otto, 'deny', 'Use pnpm')).toBe(true); });
  expect(props.client.send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'deny', note: 'Use pnpm' });
  expect(props.client.send).toHaveBeenCalledTimes(1);
});
it('a reply lands when the session moves; refused, its text comes back', () => {
  const bix = fakeSession('local:bix', { name: 'Bix', state: 'idle' });
  const onRefused = vi.fn();
  const { result, rerender, props } = setup({ sessions: [bix] });
  act(() => { expect(result.current.reply(otto, 'x')).toBe(false); });           // a permission waits for its buttons
  act(() => { expect(result.current.reply(bix, '   ')).toBe(false); });
  act(() => { expect(result.current.reply(bix, 'Go on', onRefused)).toBe(true); });
  act(() => { expect(result.current.reply(bix, 'again')).toBe(false); });
  expect(props.client.send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:bix', text: 'Go on' });
  rerender({ ...props, sessions: [bix], errors: [{ id: 'local:bix', message: 'the terminal did not take it', seq: 1, request: 'session.reply' }] });
  expect(props.notify).toHaveBeenCalledWith('Could not send the reply to Bix: the terminal did not take it');
  expect(onRefused).toHaveBeenCalledWith('Go on');
  act(() => { result.current.reply(bix, 'Go on'); });
  rerender({ ...props, sessions: [{ ...bix, state: 'working', lastActivityAt: '2026-10-09T18:01:00.000Z' }], errors: [] });
  expect(result.current.busy('local:bix')).toBe(false);
  expect(props.notify).toHaveBeenCalledTimes(1);
});
```

Dans `list-actions.test.tsx`, le refus devient `d.push({ type: 'error', id: 'otto', message: 'no pending request', request: 'session.decide' })`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter @ledge/fleet test && pnpm --filter desktop exec vitest run test/decisions.test.tsx`
Expected : FAIL, `errors` n'existe pas, `reply` non plus.

- [ ] **Step 3: Implémenter `errors`, `request` dans le fleet, `markOf`, `useDecisions` et le branchement (`App` passe `errors`)**

- [ ] **Step 4: Vérifier que tout passe**

Run: `pnpm --filter @ledge/fleet test && pnpm --filter desktop test && pnpm --filter overlay test && pnpm -r typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A packages/fleet apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): sends settle per request: a refusal is matched by its message type, several per batch; replies, always and a note

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Le modèle du fil

**Files:**
- Create: `apps/desktop/src/session/thread.ts`, `apps/desktop/src/session/useThread.ts`, `apps/desktop/test/session-thread.test.ts`, `apps/desktop/test/use-thread.test.tsx`
- Modify: `packages/fleet/test/mockDaemon.ts`, `apps/desktop/test/helpers.ts`

**Interfaces:**
- Consumes : `turns`, `helperThread` (`@ledge/ui/thread/turns`), `liveTool`, `elapsedMs`, `toolItems` (`@ledge/ui/thread/tools`) ; `useDaemon` ; `Lang`.
- Produces :

```ts
// session/thread.ts
export type ToolKind = 'read' | 'search' | 'command' | 'edit';
/** edit : Edit, Write, MultiEdit, NotebookEdit, apply_patch ; search : Grep, Glob, LS, WebFetch, WebSearch ; read : Read ; le reste : command. */
export function kindOf(tool: string): ToolKind;
export type Verb = 'create' | 'delete' | ToolKind;
/** Le premier fichier ajouté → create, supprimé → delete ; sinon kindOf. */
export function verbOf(t: ToolItem): Verb;
type Say = Extract<ThreadItem, { kind: 'message' | 'reply' }>;
type Permission = Extract<ThreadItem, { kind: 'permission' }>;
export type Segment =
  | { kind: 'tools'; key: string; tools: ToolItem[] }      // key = `tools-${tools[0].id}`
  | { kind: 'say'; item: Say }
  | { kind: 'decision'; item: Permission }                   // décidée seulement (decision définie)
  | { kind: 'helper'; item: HelperItem };
export interface Exchange {
  key: string;                                               // id de la consigne, sinon `turn-${n}`
  at: string;                                                // la consigne, sinon le premier élément
  prompt: { id: string; text: string; from: 'you' | 'parent' } | null;
  segments: Segment[];
}
/** Le fil principal par tour (turns : sous-agents écartés, écho de la réponse retiré), ou celui d'un sous-agent (helperThread) :
 *  un échange, sa consigne = la tâche de l'élément helper (from 'parent'), puis ses éléments et son rapport.
 *  Les actions consécutives se replient en un segment ; une permission non décidée est la demande épinglée, pas un segment. */
export function exchanges(items: readonly ThreadItem[], helperId?: string): Exchange[];
/** Les ids dans l'ordre affiché : consigne, puis chaque segment (chaque action d'un repli). */
export function displayIds(xs: readonly Exchange[]): string[];
export interface Summary {
  count: number; kinds: Record<ToolKind, number>;
  files: number;                                             // chemins distincts des actions réussies
  failed: number; cut: number;                               // status failed / unknown
  ms: number;                                                // somme des elapsedMs
  running: ToolItem | null;                                  // liveTool quand `live`
}
export function summarize(tools: readonly ToolItem[], now: number, live: boolean): Summary;
/** « 0,4 s », « 48 s », « 2 min 14 s », « 2 min », « 1 h 35 » (fmtDur de la maquette) ; en anglais le séparateur décimal est le point. */
export function fmtDur(ms: number, lang: Lang): string;
/** La marque d'heure d'un échange : « 14:32 » le jour même (heure locale), sinon « 16 oct. · 09:05 » (fr-BE) / « Oct 16 · 09:05 » (en-US). */
export function timeMark(at: string, now: number, lang: Lang): string;
/** Le premier id affiché après `seen` ; null à la première visite (seen null), quand seen est le dernier ou n'existe plus. */
export function unreadFrom(ids: readonly string[], seen: string | null): string | null;
export const FOLLOW_SLACK = 60;
/** Le lecteur est au bout du fil (à 60 px près) : un nouvel élément y reste en vue. */
export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean;
/** Le sous-agent d'une page : session.helpers d'abord, sinon l'élément helper du fil (kind = agentType ?? 'subagent', state 'exited'), sinon null. */
export function helperOf(session: Session, items: readonly ThreadItem[] | undefined, id: string): Helper | null;

// session/useThread.ts
/** Le fil d'une session (useThreadRequest de feat/desktop) : demandé une fois par snapshot tant qu'il manque, jamais pour une session
 *  hors ligne (elle garde ce qu'elle avait) ; pendant la nouvelle demande après un snapshot, les derniers éléments de la même session. */
export function useThread(client: Pick<DaemonClient, 'send'>, session: Session): ThreadItem[] | undefined;

// packages/fleet/test/mockDaemon.ts — le faux daemon gagne :
threads: Map<string, ThreadItem[]>;
/** Le fil que `session.thread` renvoie pour `id` (brut) ; un id sans fil n'a pas de réponse (la page reste en chargement). */
thread(id: string, items: ThreadItem[]): void;
/** Un élément en direct : rangé et diffusé en `session.thread.item`. */
threadItem(id: string, item: ThreadItem): void;

// apps/desktop/test/helpers.ts
/** Le fil d'Otto (listSessions) : tour 1 (consigne, Read, Grep, Edit, message, permission accordée, Bash en échec, sous-agent h1 et son fil, réponse),
 *  tour 2 (consigne, la permission « npm test » non décidée, Bash en cours). Heures relatives à l'appel, le tour 2 il y a 1 min. */
export function ottoThread(): ThreadItem[];
```

- [ ] **Step 1: Écrire `test/session-thread.test.ts`**

```ts
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const tool = (id: string, s: number, name: string, label: string, extra: Partial<ToolItem> = {}): ToolItem =>
  ({ kind: 'tool', id, at: at(s), turn: 1, tool: name, label, status: 'success', files: [], ...extra });
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Câble la liste' },
  tool('t1', 1, 'Read', '/w/ledge/src/App.tsx', { durationMs: 400 }),
  tool('t2', 2, 'Grep', 'useKeys', { durationMs: 300 }),
  tool('t3', 3, 'Edit', '/w/ledge/src/App.tsx', { durationMs: 200, files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }] }),
  { kind: 'message', id: 'msg-1', at: at(4), turn: 1, text: 'Je lance les tests.' },
  { kind: 'permission', id: 'perm-1', at: at(5), turn: 1, tool: 'Bash', text: 'npm test', decision: 'accept' },
  tool('t4', 6, 'Bash', 'npm test', { status: 'failed', error: 'exit 1', durationMs: 6800 }),
  { kind: 'helper', id: 'h1', at: at(7), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'exited' },
  { kind: 'message', id: 'msg-h', at: at(7.5), turn: 1, helperId: 'h1', text: 'Je lis.' },
  { kind: 'reply', id: 'report-h1', at: at(7.8), turn: 1, helperId: 'h1', text: 'Rien à signaler.' },
  { kind: 'reply', id: 'reply-1', at: at(8), turn: 1, text: 'Deux tests échouent.' },
  { kind: 'prompt', id: 'prompt-2', at: at(60), turn: 2, text: 'Corrige-les' },
  { kind: 'permission', id: 'perm-2', at: at(61), turn: 2, tool: 'Bash', text: 'npm test' },
  tool('t5', 62, 'Bash', 'npm test', { turn: 2, status: 'running' })
];
const shape = (xs: Exchange[]) => xs.map(x => [x.prompt && `${x.prompt.from}:${x.prompt.text}`, ...x.segments.map(s =>
  s.kind === 'tools' ? `tools:${s.tools.map(t => t.id).join(',')}` : s.kind === 'say' ? `say:${s.item.id}` : `${s.kind}:${s.item.id}`)]);

it('a flat thread by exchange: runs of actions fold, decided permissions and subagents stand between, the pending one is left out', () => {
  expect(shape(exchanges(items))).toEqual([
    ['you:Câble la liste', 'tools:t1,t2,t3', 'say:msg-1', 'decision:perm-1', 'tools:t4', 'helper:h1', 'say:reply-1'],
    ['you:Corrige-les', 'tools:t5']
  ]);
  expect(displayIds(exchanges(items))).toEqual(['prompt-1', 't1', 't2', 't3', 'msg-1', 'perm-1', 't4', 'h1', 'reply-1', 'prompt-2', 't5']);
});
it("a subagent's own thread: its task as the parent's instruction, what it said, its report", () => {
  expect(shape(exchanges(items, 'h1'))).toEqual([['parent:Lire le code', 'say:msg-h', 'say:report-h1']]);
  expect(exchanges(items, 'h1')[0]!.prompt!.id).toBe('h1');
});
it('a thread joined mid-session starts without a prompt', () => {
  expect(shape(exchanges([{ ...tool('t0', 0, 'Read', 'a'), turn: 0 }]))).toEqual([[null, 'tools:t0']]);
  expect(exchanges([{ ...tool('t0', 0, 'Read', 'a'), turn: 0 }])[0]!.key).toBe('turn-0');
});
it('a summary counts kinds, changed files, failures and time; a live run shows its running action', () => {
  const run = items.slice(1, 4) as ToolItem[];
  expect(summarize(run, Date.parse(at(10)), true)).toEqual({ count: 3, kinds: { read: 1, search: 1, command: 0, edit: 1 }, files: 1, failed: 0, cut: 0, ms: 900, running: null });
  const t5 = items.at(-1) as ToolItem;
  expect(summarize([t5], Date.parse(at(70)), true)).toMatchObject({ ms: 8000, running: t5 });
  expect(summarize([t5], Date.parse(at(70)), false).running).toBeNull();
  expect(summarize([{ ...t5, status: 'unknown' }, items[6] as ToolItem], 0, true)).toMatchObject({ failed: 1, cut: 1 });
});
it('kinds and verbs', () => {
  expect(['Edit', 'Write', 'apply_patch', 'Grep', 'WebFetch', 'Read', 'Bash', 'Task'].map(kindOf)).toEqual(['edit', 'edit', 'edit', 'search', 'search', 'read', 'command', 'command']);
  expect(verbOf(tool('x', 0, 'apply_patch', 'a', { files: [{ path: 'a', change: 'add' }] }))).toBe('create');
  expect(verbOf(tool('x', 0, 'apply_patch', 'a', { files: [{ path: 'a', change: 'delete' }] }))).toBe('delete');
  expect(verbOf(tool('x', 0, 'Write', 'a', { files: [{ path: 'a', change: 'write' }] }))).toBe('edit');
});
it('durations as the mockup writes them, in both languages', () => {
  const ms = [400, 6800, 48_000, 134_000, 120_000, 5_700_000];
  expect(ms.map(m => fmtDur(m, 'fr'))).toEqual(['0,4 s', '6,8 s', '48 s', '2 min 14 s', '2 min', '1 h 35']);
  expect(ms.map(m => fmtDur(m, 'en'))).toEqual(['0.4 s', '6.8 s', '48 s', '2 min 14 s', '2 min', '1 h 35']);
});
it('a time mark: the hour today, the date before', () => {
  const now = new Date(2026, 9, 17, 18, 0).getTime();
  expect(timeMark(new Date(2026, 9, 17, 14, 32).toISOString(), now, 'fr')).toBe('14:32');
  expect(timeMark(new Date(2026, 9, 16, 9, 5).toISOString(), now, 'fr')).toBe('16 oct. · 09:05');
  expect(timeMark(new Date(2026, 9, 16, 9, 5).toISOString(), now, 'en')).toBe('Oct 16 · 09:05');
});
it('« Nouveau » starts after the last item seen; never on a first visit', () => {
  const ids = ['prompt-1', 't1', 't2'];
  expect([unreadFrom(ids, 't1'), unreadFrom(ids, null), unreadFrom(ids, 't2'), unreadFrom(ids, 'gone')]).toEqual(['t2', null, null, null]);
});
it('the end of the thread is within 60 px', () => {
  expect([atEnd({ scrollHeight: 1000, scrollTop: 441, clientHeight: 500 }), atEnd({ scrollHeight: 1000, scrollTop: 440, clientHeight: 500 })]).toEqual([true, false]);
});
it("a subagent from the session, else from the thread's row", () => {
  const otto = fakeSession('local:otto', { helpers: [{ id: 'h2', kind: 'Review', task: 'Relire', state: 'working' }] });
  expect(helperOf(otto, items, 'h2')).toEqual({ id: 'h2', kind: 'Review', task: 'Relire', state: 'working' });
  expect(helperOf(otto, items, 'h1')).toEqual({ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'exited' });
  expect(helperOf(otto, undefined, 'h9')).toBeNull();
});
```

`test/use-thread.test.tsx` :

```tsx
function Count({ client, session }: { client: DaemonClient; session: Session }) {
  const items = useThread(client, session);
  return <output data-testid="count">{items?.length ?? 'loading'}</output>;
}
function Probe({ client, id }: { client: DaemonClient; id: string }) {
  const s = useFleet(client).sessions.find(x => x.id === id);
  return s ? <Count client={client} session={s} /> : null;
}
it('asks once for the thread, then follows live items; an offline session asks nothing', async () => {
  const d = await createMockDaemon();
  d.upsert(fakeSession('otto')); d.thread('otto', ottoThread());
  render(<Probe client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} id="local:otto" />);
  expect(await screen.findByTestId('count')).toHaveTextContent(String(ottoThread().length));
  d.threadItem('otto', { kind: 'message', id: 'msg-x', at: new Date().toISOString(), turn: 2, text: 'Et voilà.' });
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent(String(ottoThread().length + 1)));
  expect(d.received.filter(m => m.type === 'session.thread')).toEqual([{ type: 'session.thread', id: 'otto' }]);
});
```

et un second cas : une session `offline: true` sans fil reste « loading » et n'envoie aucun `session.thread`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/session-thread.test.ts test/use-thread.test.tsx`
Expected : FAIL, `src/session/thread.ts` introuvable.

- [ ] **Step 3: Implémenter `thread.ts`, `useThread`, les fils du faux daemon et `ottoThread`**

Fonctions pures dans `thread.ts`, sans React ni DOM.

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter @ledge/fleet test`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src/session apps/desktop/test packages/fleet/test/mockDaemon.ts
git commit -m "feat(desktop): the session thread's model: flat exchanges, folded runs of actions, summaries, durations, the New marker; the thread asked once

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Le lecteur Markdown partagé

Les messages de l'agent sont en Markdown et les documents s'ouvrent dans un lecteur (§ 2.8) : c'est le lecteur de l'overlay (`apps/overlay/src/documents`), que la build § 4 place dans `@ledge/ui`. Il dépend du pont Tauri de l'overlay pour ouvrir un lien web : ce lien passe par un contexte.

**Files:**
- Create: `packages/ui/src/documents/markdown.tsx`, `packages/ui/src/documents/references.ts`, `packages/ui/src/documents/markdown.css` (déplacés de l'overlay, `git mv` puis adaptés)
- Modify: `packages/ui/package.json` (dépendances `react-markdown` 10.1.0, `remark-gfm` 4.0.1 ; exports `./documents/markdown`, `./documents/references`, `./documents/markdown.css`), `apps/overlay/package.json` (les deux dépendances retirées), `apps/overlay/src/documents/MarkdownDocument.tsx` et `references.ts` (réexports), `apps/desktop/src/App.tsx`
- Test: `apps/overlay/test/{markdown-document,document-references}.test.ts(x)` inchangés ; `apps/desktop/test/markdown-links.test.tsx`

**Interfaces:**
- Consumes : rien de neuf.
- Produces :

```ts
// @ledge/ui/documents/markdown
export { splitMarkdownFrontmatter, documentHeadings, remarkHighlight, markdownComponents, MarkdownDocument, ThreadMarkdown, type DocumentHeading };
/** Ouvre une adresse web (l'overlay et Desktop y mettent leur openUrl) ; par défaut, rien. */
export const MarkdownLinks: React.Context<(url: string) => void>;
// @ledge/ui/documents/references
export { parseDocumentReference, findDocumentReferences, type DocumentReference };
```

- `markdownComponents` lit `MarkdownLinks` (par `MarkdownDocument` / `ThreadMarkdown`, qui le passent) au lieu d'importer `openUrl`.
- L'overlay garde ses chemins : `apps/overlay/src/documents/MarkdownDocument.tsx` réexporte tout et enveloppe `MarkdownDocument` et `ThreadMarkdown` dans `<MarkdownLinks.Provider value={openUrl}>` ; ses imports ne changent pas.
- Desktop met `<MarkdownLinks.Provider value={openUrl}>` (`tauri/bridge.ts`) autour de `Shell`.

- [ ] **Step 1: Écrire `test/markdown-links.test.tsx`**

```tsx
it('a web link in a thread message opens through the app, a document link through the reader, never by navigating', async () => {
  const open = vi.fn(); const onDocument = vi.fn(); const user = userEvent.setup();
  render(<MarkdownLinks.Provider value={open}><ThreadMarkdown text={'[site](https://example.com) et [doc](docs/plan.md)'} onDocument={onDocument} /></MarkdownLinks.Provider>);
  await user.click(screen.getByRole('link', { name: 'site' }));
  expect(open).toHaveBeenCalledWith('https://example.com');
  await user.click(screen.getByRole('link', { name: 'doc' }));
  expect(onDocument).toHaveBeenCalledWith({ path: 'docs/plan.md' });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/markdown-links.test.tsx`
Expected : FAIL, `@ledge/ui/documents/markdown` introuvable.

- [ ] **Step 3: Déplacer le lecteur, ajouter le contexte, réexporter dans l'overlay, envelopper Desktop**

- [ ] **Step 4: Vérifier que tout passe**

Run: `pnpm install && pnpm --filter overlay test && pnpm --filter desktop test && pnpm -r typecheck && pnpm --filter overlay build && pnpm --filter desktop build`
Expected : tout passe ; `grep -rn "react-markdown" apps/overlay/package.json` ne trouve rien.

- [ ] **Step 5: Commit**

```bash
git add -A packages/ui apps/overlay apps/desktop/src apps/desktop/test pnpm-lock.yaml
git commit -m "refactor(ui): the Markdown reader moves to @ledge/ui; web links open through a context the overlay and Desktop fill

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: La page de session et le fil plat

**Files:**
- Create: `apps/desktop/src/session/{Workspace,SessionPage,Thread,ActionGroup}.tsx`, `apps/desktop/src/session/memory.ts`, `apps/desktop/src/styles/session.css`, `apps/desktop/test/session.test.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/app.css` (`@import "./session.css";` après `list.css`), `apps/desktop/src/i18n/messages.ts`, `apps/desktop/test/{shell,keys}.test.tsx` (le `Pending` de session disparaît)

**Interfaces:**
- Consumes : tâche 4 (`exchanges`, `displayIds`, `summarize`, `fmtDur`, `timeMark`, `unreadFrom`, `atEnd`, `helperOf`, `kindOf`, `verbOf`, `useThread`) ; tâche 5 (`ThreadMarkdown`) ; `SessionBot`, `HelperBot`, `StateBadge` ; `whenOf` ; `target`, `SPINNER`, `elapsedMs` (`@ledge/ui/thread/tools`) ; `cls`.
- Produces :

```ts
// session/memory.ts
export interface Memo { draft: string; scroll: number | null; seen: string | null }   // scroll null = au bout
export interface SessionMemory { get(key: string): Memo; set(key: string, patch: Partial<Memo>): void }
export const memoKey: (id: string, helper?: string) => string;                      // `${id}#${helper}` pour un sous-agent
export function createSessionMemory(): SessionMemory;                               // mémo vide : { draft: '', scroll: null, seen: null }

// session/SessionPage.tsx
export interface SessionPageProps {
  session: Session;                    // le parent sur la page d'un sous-agent
  helper: Helper | null;
  items: ThreadItem[] | undefined;     // useThread, appelé par Workspace
  nav: NavState; dispatch(a: NavAction): void;
  decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  memory: SessionMemory; notify(text: string): void;
}
export function SessionPage(p: SessionPageProps): JSX.Element;

// session/Workspace.tsx — la disposition de la maquette (conversation-workspace) : la colonne (tâche 8), la page, le terminal (tâche 8)
export function Workspace(p: Omit<SessionPageProps, 'items' | 'helper'> & { client: DaemonClient }): JSX.Element;
```

Les tâches 7 et 8 ajoutent des props à `SessionPage` et `Workspace` (le terminal, les machines) ; `App` les passe.

`App` rend `<Workspace … key={place.id + (place.helper ?? '')}>` à la place du `Pending` de session ; il crée `memory` une fois (`useRef(createSessionMemory())`). `SessionPage` est remontée par agent (la `key`), ce qui remet à zéro ce qui est propre à une page (actions dépliées, onglets du lot 6b).

Rendu (`renderTurn`, `renderItem`, `Summary`, `ActionRow`, `Chip` de la maquette, avec ses classes) :
- **Racine** : `section.conversation.session-page` `data-session={session.id}`, puis `div.pane-heading` (`span.pane-meta.mono` `title` = `t.session.meta`, texte `${machineOf(session)} · ${repoOf(session)}` ; la pastille des sous-agents vient à la tâche 8), puis `div.session-split > div.session-main > div.session-body[role=region][aria-label=t.session.thread.label]` et `div.messages.session-thread` (défilement), puis la zone de réponse (tâche 7).
- **Échanges** : `section.turn.open` (`aria-label` = `t.session.thread.exchange(timeMark)`, `current` pour le dernier) ; `div.turn-time` (`aria-hidden`) avec `timeMark` et, si une action tourne et que la session est en ligne, `span.turn-live` `t.session.thread.live` ; la consigne `div.prompt-block` (`from-agent` pour un parent, auteur `t.session.thread.you` ou le bot du parent et `t.session.thread.fromParent(name)`) ; `div.turn-author` (bot 20 px et nom de l'agent — le sous-agent sur sa page) une seule fois, s'il y a au moins un segment.
- **Segments** : `say` → `div.agent-message.message|reply > div.msg-body > ThreadMarkdown` (lien de document : rien au lot 6a, le volet arrive au lot 6b) ; `decision` → `div.decision-chip.${decision}` (`chip-mark` ✓ / ✕ / ·, `t.session.thread.decided[decision]`, `code` = texte) ; `helper` → `button.helper-card` (`aria-label` = `t.session.thread.openHelper(kind, task)`, `HelperBot`, `StateBadge` de `helperState`), qui envoie `{ type: 'open', id: session.id, helper: item.id }` ; `tools` → `ActionGroup`.
- **`ActionGroup`** : `div.action-group` ; le résumé `button.action-summary` (`aria-expanded`, chevron, `summary-count` `t.session.thread.actions(n)`, `kind-chips` avec `title` `t.session.thread.kinds[k](n)`, `· fichiers`, `· échecs`, `· interrompues`, durée `mono` précédée de `t.session.thread.running` si une action tourne), omis quand toutes les actions tournent ; déplié, `div.action-list` de `ActionRow` (`action-mark` avec `aria-label` `t.session.thread.marks[status]` et le spinner `SPINNER[frame]`, `action-kind`, `action-verb` `t.session.thread.verbs[verb]`, `button.action-target` avec `title` = libellé, qui déplie la sortie `pre.action-output` (`is-error` pour une erreur) quand il y en a une, `+/−` du premier fichier quand le diff est connu (compté au lot 6b, absent ici), durée ou `t.session.thread.interrupted`) ; replié, les actions en échec ou interrompues restent visibles (`action-list compact`) et l'action en cours est `div.live-line[role=status][aria-label=t.session.thread.liveAction]`. Une session hors ligne n'a ni spinner ni ligne en direct. Le spinner et la durée en direct avancent par un `now` rafraîchi chaque seconde et une image toutes les 80 ms tant qu'une action tourne (figés avec `useMotionPreferences().reduced` : `SPINNER_STILL`).
- **Fin** : session hors ligne → `div.frozen-banner[role=status]` en tête (`t.session.thread.lost(machine)`, `lostBody`) et `div.frozen-end` après le dernier échange (`t.session.thread.frozenEnd(since)`) ; session `exited` → `div.turn-end` `t.session.thread.ended(since)`. `since` = `whenOf(session, undefined, now, t.list.when).text`.
- **États** : `items === undefined` → `p.muted` `t.session.thread.loading`, ou `notLoaded` hors ligne ; aucun échange → `empty`.
- **« Nouveau »** : à l'ouverture, `unreadFrom(displayIds, memo.seen)` ; un `div.unread-marker[role=separator]` (`t.session.thread.unread`) avant cet élément (avant son repli d'actions s'il en fait partie, comme la maquette), figé pour la vie de la page. En quittant la page (démontage), `memory.set(key, { seen: dernier id affiché })`.
- **Défilement** : à l'ouverture (`useLayoutEffect` quand le fil est là), sur le marqueur moins 120 px s'il existe, sinon sur `memo.scroll`, sinon au bout ; à chaque nouvel élément, au bout seulement si `atEnd` avant le rendu ; `button.to-latest` (`t.session.thread.latest`) quand le lecteur n'est pas au bout, qui y défile en douceur ; la position est notée dans la mémoire 250 ms après la fin du défilement et au démontage (`null` au bout).
- **CSS** : `session.css` de la maquette en entier, avec les écarts des Global Constraints.

Textes français (`session.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `meta` / `thread.label` | `Machine et dépôts` / `Fil de la session` | — / `Session thread` |
| `thread.you` / `fromParent(n)` | `Vous` / `Consigne de ${n}` | `You` / `Instruction from ${n}` |
| `thread.exchange(at)` / `live` | `Échange de ${at}` / `en cours` | — / `running` |
| `thread.actions(n)` | `${n} action` / `${n} actions` | `1 action` / `${n} actions` |
| `thread.kinds` | `read: ${n} lecture(s)`, `search: ${n} recherche(s)`, `command: ${n} commande(s)`, `edit: ${n} modification(s)` (par `plural`) | `${n} read(s)`, `${n} search(es)`, `${n} command(s)`, `${n} edit(s)` |
| `thread.files(n)` / `failed(n)` / `cut(n)` | `· ${n} fichier modifié` / `· ${n} fichiers modifiés`, `· ${n} échec(s)`, `· ${n} interrompue(s)` | `· 1 file changed` / `· ${n} files changed`, `· ${n} failed`, `· ${n} interrupted` |
| `thread.running` / `interrupted` / `liveAction` | `en cours · ` / `interrompu` / `Action en cours` | `running · ` / `interrupted` / `Action running` |
| `thread.marks` | `{ running: 'En cours', success: 'Réussi', failed: 'Échec', unknown: 'Interrompu' }` | `Running`, `Succeeded`, `Failed`, `Interrupted` |
| `thread.verbs` | `{ create: 'Création', delete: 'Suppression', read: 'Lecture', search: 'Recherche', command: 'Commande', edit: 'Modification' }` | `Create`, `Delete`, `Read`, `Search`, `Command`, `Edit` |
| `thread.decided` | `{ accept: 'Accordé', always: 'Toujours autorisé', deny: 'Refusé', unknown: 'Répondu dans le terminal' }` | `Allowed`, `Always allowed`, `Denied`, `Answered in the terminal` |
| `thread.helperLaunched` / `openHelper(n, task)` | `Sous-agent lancé` / `Ouvrir ${n} : ${task}` | `Subagent started` / `Open ${n}: ${task}` |
| `thread.unread` / `latest` | `Nouveau depuis votre dernière visite` / `Aller au dernier message` | `New since your last visit` / `Go to the latest message` |
| `thread.lost(m)` / `lostBody` | `Connexion perdue avec ${m}` / `Le fil est figé : ce qui suit est le dernier état connu, l’activité actuelle n’est pas connue.` | `Connection lost with ${m}` / — |
| `thread.frozenEnd(s)` / `ended(s)` | `Plus aucune nouvelle depuis la perte de connexion · ${s}` / `Session terminée · ${s}` | `No news since the connection was lost · ${s}` / `Session ended · ${s}` |
| `thread.loading` / `empty` / `notLoaded` | `Chargement du fil…` / `Rien dans le fil pour l’instant.` / `Le fil n’a pas été chargé avant la perte de connexion.` | `Loading the thread…` / `Nothing in the thread yet.` / `The thread was not loaded before the connection was lost.` |

- [ ] **Step 1: Écrire `test/session.test.tsx`**

```tsx
const banner = () => within(screen.getByRole('banner'));
const thread = () => within(screen.getByRole('region', { name: 'Session thread' }));
async function openOtto(o: { offline?: boolean; withThread?: boolean } = {}) {
  const sessions = listSessions().map(s => (s.name === 'Otto' && o.offline ? { ...s, offline: true } : s));
  const env = await boot({ sessions, list: true });
  if (o.withThread !== false) env.d.thread('otto', ottoThread());
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  return env;
}

it('the page replaces the pending place: one exchange per prompt, your prompt as a bubble, the agent named once', async () => {
  await openOtto();
  expect(screen.queryByText('This screen is coming soon.')).toBeNull();
  expect(await thread().findByText('Câble la liste')).toBeVisible();
  expect(thread().getByText('Câble la liste').closest('.prompt-block')).toHaveTextContent('You');
  expect(document.querySelectorAll('.session-thread .turn')).toHaveLength(2);
  expect(document.querySelectorAll('.session-thread .turn-author')).toHaveLength(2);
  expect(thread().getByText('Deux tests échouent.').closest('.ledge-thread-md')).not.toBeNull();
  expect(document.querySelector('.pane-meta')).toHaveTextContent('Local · ledge');
});
it('actions fold into a summary that unfolds; a failure stays visible; the running one shows live', async () => {
  const { user } = await openOtto();
  const summary = await thread().findByRole('button', { name: /^3 actions/ });
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(summary).toHaveTextContent('· 1 file changed');
  expect(summary).toHaveTextContent('0.9 s');
  await user.click(summary);
  expect([...document.querySelectorAll('.action-list:not(.compact) .action-verb')].map(e => e.textContent)).toEqual(['Read', 'Search', 'Edit']);
  const failed = document.querySelector<HTMLElement>('.action-row.status-failed')!;
  await user.click(within(failed).getByRole('button', { name: 'npm test' }));
  expect(within(failed).getByText('exit 1')).toHaveClass('action-output', 'is-error');
  expect(thread().getByRole('status', { name: 'Action running' })).toHaveTextContent('npm test');
});
it('past decisions are chips; a subagent is a card that opens its own thread', async () => {
  const { user } = await openOtto();
  await thread().findByText('Allowed');
  expect(document.querySelector('.decision-chip.accept')).toHaveTextContent('✓Allowednpm test');
  await user.click(thread().getByRole('button', { name: 'Open Explore: Lire le code' }));
  expect(await thread().findByText('Je lis.')).toBeVisible();
  expect(thread().getByText('Lire le code').closest('.prompt-block')).toHaveClass('from-agent');
  expect(thread().getByText('Lire le code').closest('.prompt-block')).toHaveTextContent('Instruction from Otto');
});
it('while the thread loads, it says so', async () => {
  await openOtto({ withThread: false });
  expect(await thread().findByText('Loading the thread…')).toBeVisible();
});
it('offline before the thread came: it says so', async () => {
  await openOtto({ offline: true, withThread: false });
  expect(await screen.findByText('The thread was not loaded before the connection was lost.')).toBeVisible();
});
it('a machine that falls freezes the thread it sent: a notice on top and at the end, nothing runs live', async () => {
  const { d } = await openOtto();
  await thread().findByText('Corrige-les');
  await d.close();
  expect(await screen.findByText('Connection lost with Local')).toBeVisible();
  expect(document.querySelector('.frozen-end')).toHaveTextContent('No news since the connection was lost');
  expect(screen.queryByRole('status', { name: 'Action running' })).toBeNull();
  expect(thread().getByText('Câble la liste')).toBeVisible();
});
it('« New since your last visit » marks what arrived while away', async () => {
  const { d, user } = await openOtto();
  await thread().findByText('Corrige-les');
  await user.keyboard('{Escape}');
  d.threadItem('otto', { kind: 'message', id: 'msg-new', at: new Date().toISOString(), turn: 2, text: 'J’ai corrigé le premier test.' });
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  const marker = await thread().findByRole('separator', { name: 'New since your last visit' });
  expect(marker.nextElementSibling).toHaveTextContent('J’ai corrigé le premier test.');
});
it('the styles port the mockup: a reading column of 760 px, 14 / 23 px text, the side pane never leaves the thread under 440 px', () => {
  expect(declarations('session.css', '.session-thread')).toContain('--col:760px');
  expect(declarations('session.css', '.msg-body')).toContain('font-size:14px;line-height:23px');
  expect(declarations('session.css', '.side-pane')).toContain('flex:0 0 min(var(--split),calc(100% - 440px))');
  expect(readFileSync(resolve(__dirname, '../src/styles/session.css'), 'utf8')).toMatch(/@container session \(max-width:860px\)\{/);
});
```

Le marqueur précède immédiatement le message (balisage de la maquette : `marker` puis le nœud, frères dans le `section.turn`).

Dans `shell.test.tsx` et `keys.test.tsx`, ce qui cherchait le `Pending` de session (`region` au nom de la tâche) cherche désormais `document.querySelector('.session-page')`. Dans `list-keys.test.tsx`, le test « Enter on a subagent row opens the subagent » (tâche 1) vérifie `expect(document.querySelector('.session-page')).toHaveAttribute('data-helper', 'h1')` : la racine de la page porte `data-helper` sur la page d'un sous-agent.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/session.test.tsx`
Expected : FAIL, la session est encore `Pending`.

- [ ] **Step 3: Implémenter `memory.ts`, `Workspace`, `SessionPage`, `Thread`, `ActionGroup`, `session.css`, les textes et le branchement**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): the session page: a flat thread by exchange, folded actions with live progress, decision chips, subagent cards, New marker, frozen when offline

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: La demande épinglée et la réponse

**Files:**
- Create: `apps/desktop/src/session/{PendingCard,Reply}.tsx`, `apps/desktop/test/session-reply.test.tsx`
- Modify: `apps/desktop/src/session/SessionPage.tsx`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 3 (`Decisions.decide`, `.reply`, `.busy`) ; tâche 2 (`offers`) ; tâche 6 (`SessionMemory`, `memoKey`) ; tâche 1 (`place.focus`) ; `whenOf` ; `useScreenKeys`.
- Produces : rien de neuf hors de la page. `SessionPage` gagne `machines: readonly MachineState[]` (le libellé de la machine hors ligne) si `machineOf` ne suffit pas.

La zone de réponse (`div.reply-area.session-reply`, `replyArea` de la maquette), sous le fil, contient la demande épinglée puis le champ :
- **Demande** (`session.pending`, en ligne seulement ; jamais lue dans le fil) : `div.pending-card.${approval|question|plan}[role=region]` (`aria-label` = `t.session.pending.regions[…]`), en-tête `Badge` (`label` `planBadge` pour un plan), le titre, `pending-since` = `whenOf(session, waits.get(id)?.since, now, t.list.when).text`. Sorte `permission` ou `diff` = « approval » de la maquette ; titre `command(n)` pour un outil `Bash`, `shell` ou `exec_command`, `edit(n)` pour `diff`, sinon `approval(n)` ; `div.pending-command` (`tool-tag` = `pending.tool` s'il existe, `code` = `pending.text`). `n` = le nom de l'agent, ou le `kind` du sous-agent quand `pending.helperId` le désigne.
- **Actions** (`pending-actions`) : Autoriser (`Kbd accent` Y), Refuser (`Kbd` N), et « Toujours autoriser pour cette session » seulement si `offers(tool, kind, 'always')`. Plan : « Approuver le plan » (Y), « Continuer à planifier » (N), « Approuver et accepter les modifications automatiquement » seulement si `offers(…, 'always')` ; le résumé des étapes et « Lire le plan » arrivent au lot 6b. Question : le texte (`pending-question`), puis `ol.pending-choices` (un bouton par `options[i]`, `Kbd i+1`, `small` = `optionDetails[i]` s'il n'est pas vide) qui envoie `reply(session, String(i + 1))`. Tous les boutons `disabled` tant que `decisions.busy(id)`.
- **Sur la page d'un sous-agent** : la demande dont `helperId` est ce sous-agent est montrée sans actions, avec `pending-relay` (`relay(parent)` ou `relayAnswer(parent)` pour une question). Une demande du parent lui-même n'y est pas montrée.
- **Champ** : `form` (`with-pending` avec une demande) ; `textarea` (`aria-label` `t.session.reply.label`, `rows=1`, `placeholder` selon la demande) ; le brouillon vit dans `memory` (`memoKey(id, helper)`), écrit à chaque frappe ; `reply-hint` (`denyHint` / `planHint` avec du texte, sinon `Kbd R` + `write`) ; le bouton `Button primary size=icon` (`aria-label` `denyWith` pour une permission, `send` sinon), `disabled` sans texte.
- **Envoyer** (Entrée sans Maj, ou le bouton) : texte rogné vide → rien ; permission / diff → `decide(s, 'deny', texte)` si `offers(…, 'note')` ; plan → `decide(s, 'deny', texte)` ; question → `reply(s, texte)` ; rien en attente → `reply(s, texte)`. Envoyé, le champ se vide (et le brouillon) ; refusé, `onRefused` remet le texte si le champ est vide.
- **Pas de champ** à la place du formulaire (`div.reply-note`) : session hors ligne → icône, `offline(machine)` en gras puis `offlineBody`, bouton « Voir la machine » (`{ type: 'settings', section: 'machines' }`), et pas de demande ; `hook_only` → `readOnly` ; page d'un sous-agent → bot du parent, `viaParent(kind, parent)`, bouton `openParent(parent)` (`{ type: 'open', id: session.id }`) ; question à options sur un harnais sans réponse libre (`tool !== 'claude'`, comme `replyBlock` de `feat/desktop`) → le champ est `disabled` et `reply-hint` dit `optionsOnly`.
- **Touches** (`useScreenKeys` de la page ; jamais pendant une saisie, garanti par `useKeys`) : `r` → focus du champ (s'il existe) ; `y` / `n` sur une permission → `decide(accept | deny)` ; `y` sur un plan → `decide(accept)` ; `n` sur un plan → focus du champ et `notify(t.session.pending.reviseKey)` (même chose au clic sur « Continuer à planifier » sans texte, avec `revise`) ; `1`…`9` sur une question → l'option si elle existe ; rien de cela hors ligne, en lecture seule ou sur la page d'un sous-agent. Dans le champ : Échap → `blur` et `stopPropagation` (la page reste).
- **À l'arrivée** avec `place.focus === 'reply'` : le champ prend le focus une fois (effet au montage).

Textes français (`session.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `pending.regions` | `{ approval: 'Autorisation demandée', plan: 'Plan à approuver', question: 'Question de l’agent' }` | `Approval requested`, `Plan to approve`, `Question from the agent` |
| `pending.command(n)` / `edit(n)` / `approval(n)` | `${n} veut exécuter une commande` / `${n} veut modifier un fichier` / `${n} veut votre accord` | `${n} wants to run a command` / `${n} wants to change a file` / `${n} wants your approval` |
| `pending.question(n)` / `plan(n, title)` / `planBadge` | `${n} vous pose une question` / `${n} propose un plan · ${title}` / `Plan à approuver` | `${n} asks you a question` / `${n} proposes a plan · ${title}` / `Plan to approve` |
| `pending.allow` / `deny` / `always` | `Autoriser` / `Refuser` / `Toujours autoriser pour cette session` | `Allow` / `Deny` / `Always allow for this session` |
| `pending.approvePlan` / `keepPlanning` / `approveAuto` | `Approuver le plan` / `Continuer à planifier` / `Approuver et accepter les modifications automatiquement` | `Approve the plan` / `Keep planning` / `Approve and accept edits automatically` |
| `pending.relay(p)` / `relayAnswer(p)` | `C’est ${p} qui transmet cette décision.` / `${p} relaiera votre réponse.` | `${p} passes this decision on.` / `${p} will relay your answer.` |
| `pending.revise` / `reviseKey` | `Écrivez ce qu’il faut revoir, puis Entrée.` / `Écrivez ce qu’il faut revoir, puis Entrée : le plan repart en préparation.` | `Write what to revise, then Enter.` / `Write what to revise, then Enter: the plan goes back to planning.` |
| `reply.label` / `send` / `denyWith` | `Répondre à l’agent` / `Envoyer` / `Refuser avec ce message` | `Reply to the agent` / `Send` / `Deny with this message` |
| `reply.placeholder` | `plan: 'Ce qu’il faut revoir dans le plan… (Entrée : continuer à planifier)'`, `approval: 'Ou refusez en expliquant quoi faire autrement…'`, `question(n): 'Ou répondez librement à ${n}…'`, `done(n): 'Relancer ${n} avec une nouvelle consigne…'`, `idle(n): 'Répondre à ${n}…'` | `Reply to ${n}…` pour `idle` |
| `reply.denyHint` / `planHint` / `write` | `Entrée refuse avec ce message` / `Entrée renvoie le plan en préparation` / `écrire` | `Enter denies with this message` / — / `write` |
| `reply.offline(m)` / `offlineBody` / `seeMachine` | `${m} est hors ligne.` / ` Le fil est figé à la dernière activité connue ; vous pourrez répondre à la reconnexion.` / `Voir la machine` | `${m} is offline.` / — / `See the machine` |
| `reply.viaParent(n, p)` / `openParent(p)` | `Les réponses à ${n} passent par ${p}, qui l’a lancé.` / `Ouvrir ${p}` | `Replies to ${n} go through ${p}, who started it.` / `Open ${p}` |
| `reply.readOnly` / `optionsOnly` | `Session démarrée sans Ledge : lecture seule.` / `Choisissez une des réponses proposées (1–9).` | `Session started without Ledge: read only.` / `Choose one of the proposed answers (1–9).` |

`done(n)` sert à une session `exited` ou `idle`.

- [ ] **Step 1: Écrire `test/session-reply.test.tsx`**

```tsx
const field = () => screen.getByRole('textbox', { name: 'Reply to the agent' });
const card = (name: string) => within(screen.getByRole('region', { name }));
const sent = (d: MockDaemon, type: string) => d.received.filter(m => m.type === type);
async function open(name: string, sessions = listSessions(), list = true) {
  const env = await boot({ sessions, list });
  await env.user.click(screen.getByRole('listitem', { name: new RegExp(`^${name},`) }));
  await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
  return env;
}

it('the pinned permission, before the thread even loads: Y allows once, the buttons wait', async () => {
  const otto = { ...listSessions()[0]!, pending: { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const } };
  const { d, user } = await open('Otto', [otto, ...listSessions().slice(1)]);
  const req = card('Approval requested');
  expect(req.getByText('Otto wants to run a command')).toBeVisible();
  expect(req.getByText('Bash')).toHaveClass('tool-tag');
  expect(req.getByText('for 12 min')).toHaveClass('pending-since');
  expect(req.getByRole('button', { name: /^Always allow for this session/ })).toBeVisible();
  await user.keyboard('y'); await user.keyboard('y');
  await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]));
  expect(req.getByRole('button', { name: /^Allow/ })).toBeDisabled();
});
it('typing in the reply: y, n, 1, r, o, j and k are text; Escape leaves the field, not the page; Enter denies with the note', async () => {
  const { d, user } = await open('Otto');
  await user.click(field());
  await user.keyboard('yn1rojk');
  expect(field()).toHaveValue('yn1rojk');
  expect(sent(d, 'session.decide')).toEqual([]);
  expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
  await user.keyboard('{Escape}');
  expect(field()).not.toHaveFocus();
  expect(document.querySelector('.session-page')).not.toBeNull();
  await user.clear(field()); await user.type(field(), 'Use pnpm');
  expect(screen.getByText('Enter denies with this message')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Deny with this message' })).toBeEnabled();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'deny', note: 'Use pnpm' }]));
  expect(field()).toHaveValue('');
});
it('a refusal while the machine drops is said, the buttons come back', async () => {
  const { d, user } = await open('Otto');
  await user.keyboard('n');
  await waitFor(() => expect(sent(d, 'session.decide')).toHaveLength(1));
  d.push({ type: 'error', id: 'otto', message: 'the terminal did not take it', request: 'session.decide' });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not send the decision to Otto: Local: the terminal did not take it'));
  expect(card('Approval requested').getByRole('button', { name: /^Allow/ })).toBeEnabled();
});
it('a question: numbered choices answer with their digit, R writes freely', async () => {
  const kit = { ...listSessions()[4]!, pending: { kind: 'question' as const, text: 'Quel port ?', options: ['8080', '3000'], optionDetails: ['Par défaut', ''], source: 'hook' as const } };
  const { d, user } = await open('Kit', [...listSessions().slice(0, 4), kit]);
  const q = card('Question from the agent');
  expect(q.getByText('Kit asks you a question')).toBeVisible();
  expect(q.getByRole('button', { name: /^1\s*8080\s*Par défaut/ })).toBeVisible();
  await user.keyboard('2');
  await waitFor(() => expect(sent(d, 'session.reply')).toEqual([{ type: 'session.reply', id: 'kit', text: '2' }]));
  d.upsert({ ...kit, state: 'working', pending: undefined, lastActivityAt: new Date().toISOString() });
  await user.keyboard('r'); expect(field()).toHaveFocus();
  await user.keyboard('Port 9000{Enter}');
  await waitFor(() => expect(sent(d, 'session.reply')).toHaveLength(2));
  expect(sent(d, 'session.reply')[1]).toEqual({ type: 'session.reply', id: 'kit', text: 'Port 9000' });
});
it('a refused reply gives its text back', async () => {
  const { d, user } = await open('Nova');
  await user.type(field(), 'Continue{Enter}');
  await waitFor(() => expect(sent(d, 'session.reply')).toHaveLength(1));
  d.push({ type: 'error', id: 'nova', message: 'the terminal did not take it', request: 'session.reply' });
  await waitFor(() => expect(field()).toHaveValue('Continue'));
  expect(screen.getByRole('status')).toHaveTextContent('Could not send the reply to Nova: Local: the terminal did not take it');
});
it('a plan: N asks for what to revise, a note sends it back; « always » only where the harness offers it', async () => {
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan: add README.md', body: '# Plan: add README.md\n\n1. Écrire', source: 'hook' } });
  const { d, user } = await open('Pia', [...listSessions(), pia]);
  const plan = card('Plan to approve');
  expect(plan.getByText('Pia proposes a plan · Plan: add README.md')).toBeVisible();
  expect(plan.getByRole('button', { name: 'Approve and accept edits automatically' })).toBeVisible();
  await user.keyboard('n');
  expect(field()).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Write what to revise, then Enter: the plan goes back to planning.');
  await user.keyboard('Garde la v1{Enter}');
  await waitFor(() => expect(sent(d, 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'deny', note: 'Garde la v1' }]));
  cleanup(); await closeDaemons();
  await open('Pia', [...listSessions(), { ...pia, tool: 'codex' }]);
  expect(card('Plan to approve').queryByRole('button', { name: 'Approve and accept edits automatically' })).toBeNull();
});
it('offline: no request, no field, the machine is named; read-only says so', async () => {
  await open('Rio');
  expect(screen.queryByRole('textbox', { name: 'Reply to the agent' })).toBeNull();
  expect(screen.getByText('Local is offline.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'See the machine' })).toBeVisible();
  cleanup(); await closeDaemons();
  await open('Nova', listSessions().map(s => (s.name === 'Nova' ? { ...s, source: 'hook_only' as const } : s)));
  expect(screen.getByText('Session started without Ledge: read only.')).toBeVisible();
});
it("a subagent's page: its request shows who passes it on; replies go through the parent", async () => {
  const otto = { ...listSessions()[0]!, pending: { kind: 'permission' as const, text: 'cat a', source: 'hook' as const, helperId: 'h1' } };
  const { user } = await open('Otto', [otto, ...listSessions().slice(1)]);
  expect(card('Approval requested').getByText('Explore wants your approval')).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(within(screen.getByRole('listitem', { name: /^Otto,/ })).getByRole('button', { name: 'Show 1 subagent' }));
  await user.click(screen.getByRole('listitem', { name: /subagent of Otto/ }));
  expect(card('Approval requested').getByText('Otto passes this decision on.')).toBeVisible();
  expect(card('Approval requested').queryByRole('button', { name: /^Allow/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Open Otto' }));
  expect(screen.getByRole('textbox', { name: 'Reply to the agent' })).toBeVisible();
});
it('a draft stays with its session from agent to agent', async () => {
  const { user } = await open('Otto');
  await user.type(field(), 'à moitié');
  (document.activeElement as HTMLElement).blur();
  await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');                                  // Bix
  expect(field()).toHaveValue('');
  await user.keyboard('{Alt>}{ArrowRight}{/Alt}');                                 // back to Otto
  expect(field()).toHaveValue('à moitié');
});
it('Reply from the List lands in the reply field', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  await user.click(within(screen.getByRole('listitem', { name: /^Kit,/ })).getByRole('button', { name: 'Reply' }));
  expect(await screen.findByRole('textbox', { name: 'Reply to the agent' })).toHaveFocus();
});
```

L'ordre Alt ← / → suit `mainOrder` : dans le projet Ledge, Bix, Otto, Rio (même `startedAt`, puis l'id).

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/session-reply.test.tsx`
Expected : FAIL, ni demande épinglée ni champ.

- [ ] **Step 3: Implémenter `PendingCard`, `Reply`, les touches de la page et le focus à l'arrivée**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/session-reply.test.tsx
git commit -m "feat(desktop): the pinned request and the reply: Allow / Deny / always, the three plan answers, choices 1-9, deny with a note, drafts per session

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: La colonne des agents, la page d'un sous-agent, le terminal

**Files:**
- Create: `apps/desktop/src/session/{AgentsRail,TerminalPane}.tsx`, `apps/desktop/src/session/{prefs,terminal}.ts`, `apps/desktop/test/session-rail.test.tsx`
- Modify: `apps/desktop/src/session/{Workspace,SessionPage}.tsx`, `apps/desktop/src/shell/{TopBar,icons}.ts(x)`, `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/session.css`, `apps/desktop/src/i18n/messages.ts`, `apps/desktop/test/search.test.tsx`

**Interfaces:**
- Consumes : `mainOrder`, `taskOf`, `dotOf` (`nav/agents.ts`) ; `helperState` ; `SessionBot`, `HelperBot`, `StateBadge` ; `focusTerminal`, `openTerminal`, `isTauri` (`tauri/bridge.ts`) ; `useDaemon().previews` ; `useStored`, `readJson`, `writeJson`, `isRecord`.
- Produces :

```ts
// session/prefs.ts
export const SESSION_KEY = 'desktop.session';
export const SPLIT_MIN = 0.3, SPLIT_MAX = 0.72;
export interface SessionPrefs { terminal: boolean; split: number }
export function loadSessionPrefs(): SessionPrefs;           // champ par champ ; défauts { terminal: false, split: 0.5 } ; split hors bornes → 0.5
export function saveSessionPrefs(p: SessionPrefs): void;

// session/terminal.ts — openSessionTerminal de feat/desktop (conversation/terminal.ts), tel quel
export function openSessionTerminal(client: DaemonClient, s: Session): Promise<boolean>;

// shell/TopBar.tsx — props gagnées :
helper: Helper | null; terminal: boolean; onTerminal(): void;

// session/Workspace.tsx — props gagnées :
prefs: SessionPrefs; setPrefs(fn: (p: SessionPrefs) => SessionPrefs): void;
order: readonly Session[]; projects: Projects | null; projectIdOf(s: Session): string | null;
```

`App` tient `const [sessionPrefs, setSessionPrefs] = useStored(loadSessionPrefs, saveSessionPrefs)` et passe la bascule à `TopBar` et `Workspace`.

Rendu (lignes 297-298 et 354-356 de `observatory.tsx`) :
- **`div.conversation-workspace`** (`with-terminal` quand le terminal est affiché) : `AgentsRail`, `SessionPage`, `TerminalPane`.
- **`AgentsRail`** : `nav.project-rail` (`aria-label` = `t.session.rail.label(projet)`), `div.rail-head` (pastille du projet, ou `filter-none` pour « Sans projet » ; nom ; `small` = le nombre d'agents principaux), `div.rail-list` : les agents principaux du même projet (ou de « Sans projet ») dans l'ordre de `mainOrder` ; chacun `button.rail-agent` (`current` et `aria-current="page"` pour l'agent ouvert, `data-agent`), `SessionBot` 26 px, nom et tâche, `i.rail-dot.${off | approval | question | done | working}` (`aria-label` = `t.atelier.offline` ou `t.stateLabel[botState]`) ; si `nav.helpers` et qu'il a des sous-agents, `div.rail-kids[role=group]` (`aria-label` = `kidsOf(nom)`, `data-parent`) avec `div.rail-kids-label` (`kids(n)`) et un `button.rail-agent.child` par sous-agent (`HelperBot` 20 px, `kind`, tâche, point de `helperState`) ; le sous-agent ouvert est `current`. Un clic ouvre l'agent (`open`, avec `helper` pour un sous-agent). `button.rail-new` (`newHere`) ouvre « Nouvelle session » avec le projet (`modal: { kind: 'launch', project }`, sans projet pour « Sans projet »). Masquée sous 1000 px (CSS de la maquette).
- **Pastille** `button.kids-pill` dans `.pane-heading` d'un agent principal qui a des sous-agents : `kidsPill(n)`, `title` `kidsPillTitle` ; un clic rend les sous-agents visibles s'ils sont masqués (`helpers`), puis fait défiler le groupe de la colonne et lui donne `rail-flash` (retiré et remis pour rejouer l'animation).
- **Fil d'Ariane** : sur la page d'un sous-agent, `button.crumb-link.crumb-parent` (bot 18 px et nom du parent, `title` = `t.crumb.openParent(nom)`) puis `/`, puis `crumb-session` avec le `HelperBot`, le `kind` et la tâche du sous-agent ; un clic sur le parent ouvre sa page. À droite de la barre, après le badge (celui du sous-agent : `helperState`, hors ligne si le parent l'est), `span.view-actions-sep` et la bascule du terminal (`Button ghost size=icon`, `aria-pressed`, `aria-label` `t.top.terminalShow` / `terminalHide`, `title` avec « (O) », icône `SHELL_ICONS.terminal` = `['m4 6 5 6-5 6', 'M12 18h8']`).
- **`TerminalPane`** : `section.terminal-pane[role=region][aria-label=t.session.terminal.title]`, `div.pane-heading` (icône, `t.session.terminal.title`, `span.mono.muted` = machine) ; `div.terminal-content.mono` : les lignes de `previews.get(session.id)` (`div.terminal-output`), ou `empty` ; `div.terminal-footer` (point, `readOnly` ou `offline`) et, dans Tauri seulement (`isTauri()`) et en ligne, `Button ghost sm` `open` qui appelle `openSessionTerminal` (échec : `notify(openFailed(nom))`). Sur la page d'un sous-agent, l'aperçu est celui du parent.
- **O** (`useScreenKeys` de la page, comme les autres touches) et la bascule écrivent `terminal` dans `desktop.session` ; le choix suit d'un agent à l'autre et survit au redémarrage.

Textes français :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `session.rail.label(p)` / `kids(n)` / `kidsOf(n)` / `newHere` | `Agents du projet ${p}` / `Sous-agents · ${n}` / `Sous-agents de ${n}` / `Nouvelle session ici` | `Agents of the project ${p}` / `Subagents · ${n}` / `Subagents of ${n}` / `New session here` |
| `session.kidsPill(n)` / `kidsPillTitle` | `${n} sous-agent` / `${n} sous-agents` / `Voir les sous-agents dans la colonne` | `1 subagent` / `${n} subagents` / — |
| `crumb.openParent(n)` | `Ouvrir la conversation de ${n}` | `Open ${n}’s conversation` |
| `top.terminalShow` / `terminalHide` / `terminalShowTitle` / `terminalHideTitle` | `Afficher le terminal` / `Masquer le terminal` / `Afficher le terminal (O)` / `Masquer le terminal (O)` | `Show the terminal` / `Hide the terminal` / — |
| `session.terminal.title` / `empty` / `readOnly` / `offline` / `open` / `openFailed(n)` | `Terminal` / `Aucune sortie reçue pour l’instant.` / `Aperçu en lecture seule` / `Hors ligne` / `Ouvrir dans un terminal` / `Le terminal de ${n} n’a pas pu s’ouvrir.` | `Terminal` / `No output received yet.` / `Read-only preview` / — / — / — |

- [ ] **Step 1: Écrire `test/session-rail.test.tsx`**

```tsx
const rail = () => within(screen.getByRole('navigation', { name: 'Agents of the project Ledge' }));
const banner = () => within(screen.getByRole('banner'));
async function openOtto() {
  const env = await boot({ sessions: listSessions(), list: true });
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByRole('navigation', { name: 'Agents of the project Ledge' });
  return env;
}

it("the project's agents, the open one marked; its subagents grouped under it; a click switches agent", async () => {
  const { user } = await openOtto();
  expect(rail().getAllByRole('button').filter(b => b.classList.contains('rail-agent') && !b.classList.contains('child')).map(b => b.querySelector('strong')!.textContent)).toEqual(['Bix', 'Otto', 'Rio']);   // mainOrder
  expect(rail().getByRole('button', { name: /^Otto/ })).toHaveAttribute('aria-current', 'page');
  const kids = within(rail().getByRole('group', { name: 'Subagents of Otto' }));
  expect(kids.getByText('Subagents · 1')).toBeVisible();
  expect(rail().getByRole('button', { name: /^Rio/ }).querySelector('.rail-dot')).toHaveClass('off');
  await user.click(rail().getByRole('button', { name: /^Bix/ }));
  expect(banner().getByText('Bix')).toBeVisible();
});
it("a subagent's page: the parent in the breadcrumb, which opens it back", async () => {
  const { user } = await openOtto();
  await user.click(within(rail().getByRole('group', { name: 'Subagents of Otto' })).getByRole('button', { name: /^Explore/ }));
  expect(banner().getByText('Explore')).toBeVisible();
  expect(banner().getByText('Lire le code')).toHaveClass('crumb-task');
  await user.click(banner().getByRole('button', { name: /Otto/ }));
  expect(banner().queryByText('Explore')).toBeNull();
  expect(rail().getByRole('button', { name: /^Otto/ })).toHaveAttribute('aria-current', 'page');
});
it('« 1 subagent » shows the hidden subagents and lights their group', async () => {
  const { user } = await openOtto();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  expect(screen.queryByRole('group', { name: 'Subagents of Otto' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '1 subagent' }));
  expect(await screen.findByRole('group', { name: 'Subagents of Otto' })).toHaveClass('rail-flash');
});
it('New session here starts one in this project; a session without project has its own rail', async () => {
  const { user } = await openOtto();
  await user.click(rail().getByRole('button', { name: 'New session here' }));
  expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
  await user.keyboard('{Escape}{Escape}');
  await user.click(screen.getByRole('listitem', { name: /^Kit,/ }));
  expect(screen.getByRole('navigation', { name: 'Agents of the project No project' })).toBeVisible();
});
it('O shows the terminal with the preview; it follows to the next agent and is remembered; typing o in the reply does not toggle it', async () => {
  const { d, view, client, user } = await openOtto();
  d.preview('otto', ['$ npm test', 'PASS']); d.preview('bix', ['$ git log']);
  expect(banner().getByRole('button', { name: 'Show the terminal' })).toHaveAttribute('aria-pressed', 'false');
  await user.keyboard('o');
  const term = within(await screen.findByRole('region', { name: 'Terminal' }));
  expect(term.getByText('PASS')).toBeVisible();
  expect(term.getByText('Read-only preview')).toBeVisible();
  expect(JSON.parse(localStorage.getItem('desktop.session')!)).toEqual({ terminal: true, split: 0.5 });
  await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');                                  // Bix
  expect(within(screen.getByRole('region', { name: 'Terminal' })).getByText('$ git log')).toBeVisible();
  await user.click(screen.getByRole('textbox', { name: 'Reply to the agent' }));
  await user.keyboard('o');
  expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible();
  view.unmount();
  render(<App client={client} />);
  await user.click(await screen.findByRole('listitem', { name: /^Otto,/ }));     // only the prefs survive, never the place
  expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
});
it('session prefs are read field by field, and the key is new', () => {
  expect(loadSessionPrefs()).toEqual({ terminal: false, split: 0.5 });
  localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: 'yes', split: 0.9 }));
  expect(loadSessionPrefs()).toEqual({ terminal: false, split: 0.5 });
  localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: true, split: 0.65 }));
  expect(loadSessionPrefs()).toEqual({ terminal: true, split: 0.65 });
  expect(OBSOLETE_KEYS).not.toContain(SESSION_KEY);
});
it('the rail hides under 1000 px', () => {
  expect(readFileSync(resolve(__dirname, '../src/styles/session.css'), 'utf8')).toMatch(/@media\(max-width:1000px\)\{[^}]*\.project-rail\{display:none\}/);
});
```

Dans `search.test.tsx` (report de la revue du lot 5) :

```tsx
it('an offline session: its bot frozen in the search, « Offline » in the top bar once opened', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  await user.keyboard('{Control>}k{/Control}');
  const rio = screen.getByRole('option', { name: /Rio/ });
  expect(rio.querySelector('[data-frozen]')).toHaveAttribute('data-frozen', 'true');
  await user.click(rio);
  expect(within(screen.getByRole('banner')).getByText('Offline')).toHaveAttribute('data-badge', 'readonly');
});
```

(le rôle des résultats suit `SearchPalette` ; l'implémenteur garde celui qu'il utilise).

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/session-rail.test.tsx test/search.test.tsx`
Expected : FAIL, ni colonne ni terminal.

- [ ] **Step 3: Implémenter `prefs`, `terminal`, `AgentsRail`, `TerminalPane`, la pastille, le fil d'Ariane, la bascule, O et leurs CSS**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): the project's agents beside the session with subagents under their parent, a subagent's page, the terminal on O, remembered

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: La session dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/session.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts`, `apps/desktop/e2e/list.spec.ts` (Répondre)

**Interfaces:**
- Consumes : tout ce qui précède ; `fakeDaemon`, `session`, `eight`, `twoProjects`, `T0`.
- Produces : `fakeDaemon` sert les fils et l'aperçu, ce que le lot 6b reprend :

```ts
// e2e/daemon.ts — extras et méthodes ajoutés
fakeDaemon(page, initial, extras: { …; threads?: Record<string, ThreadItem[]> })
// répond à `session.thread` avec extras.threads[id] (un id absent n'a pas de réponse)
item(id: string, item: ThreadItem): void;          // range et pousse `session.thread.item`
preview(id: string, lines: string[]): void;        // pousse `session.preview`
```

Données du fichier :
- `fleet` = `eight` où Otto porte `pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' }` et un sous-agent `{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }`, et Luna `pending: { kind: 'question', text: 'Quel port ?', source: 'hook' }` (sans demande, la ligne ne propose pas « Répondre ») ;
- `ottoThread` = le fil de `test/helpers.ts` réécrit avec des heures relatives à `T0` ;
- `longThread` = 120 échanges (consigne, une action, une réponse de 6 lignes) pour Nova.

- [ ] **Step 1: Écrire `session.spec.ts`**

```ts
const open = async (page: Page, name: string) => { await page.getByRole('tab', { name: 'List' }).click(); await page.getByRole('listitem', { name: new RegExp(`^${name},`) }).click(); };
const thread = (page: Page) => page.locator('.session-thread');

test('the session reads as a flat thread; actions unfold; Y allows the pinned request once', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: ottoThread } });
  await page.goto('/');
  await open(page, 'Otto');
  await expect(thread(page).getByText('Câble la liste')).toBeVisible();
  await thread(page).getByRole('button', { name: /^3 actions/ }).click();
  await expect(thread(page).locator('.action-list:not(.compact) .action-row')).toHaveCount(3);
  await page.keyboard.press('y');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]);
  await expect(page.getByRole('region', { name: 'Approval requested' })).toHaveCount(0);
});
test('reading older messages while new ones arrive: no jump, then « Go to the latest message »', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: longThread } });
  await page.goto('/');
  await open(page, 'Nova');
  const scroller = thread(page);
  await expect(scroller.locator('.turn')).toHaveCount(120);
  expect(await scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);
  await scroller.evaluate(el => { el.scrollTop = 400; });
  daemon.item('nova', { kind: 'message', id: 'msg-live', at: new Date().toISOString(), turn: 120, text: 'Encore une chose.' });
  await expect(scroller.getByText('Encore une chose.')).toBeAttached();
  expect(Math.abs(await scroller.evaluate(el => el.scrollTop) - 400)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Go to the latest message' }).click();
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);
  await expect(page.getByRole('button', { name: 'Go to the latest message' })).toHaveCount(0);
});
test('at the end of the thread, a new item stays in view', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: longThread } });
  await page.goto('/');
  await open(page, 'Nova');
  daemon.item('nova', { kind: 'reply', id: 'reply-live', at: new Date().toISOString(), turn: 120, text: 'Terminé.' });
  await expect(thread(page).getByText('Terminé.')).toBeInViewport();
});
test('Reply from the List lands in the field; Enter sends the reply', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.getByRole('listitem', { name: /^Luna,/ }).hover();
  await page.getByRole('listitem', { name: /^Luna,/ }).getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByRole('textbox', { name: 'Reply to the agent' })).toBeFocused();
  await page.keyboard.type('Port 3000');
  await page.keyboard.press('Enter');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'luna', text: 'Port 3000' }]);
});
test('the terminal on O follows from agent to agent and survives a reload', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await open(page, 'Otto');
  daemon.preview('otto', ['$ npm test']); daemon.preview('nova', ['$ git status']);
  await page.keyboard.press('o');
  await expect(page.getByRole('region', { name: 'Terminal' }).getByText('$ npm test')).toBeVisible();
  await page.getByRole('navigation', { name: /^Agents of the project/ }).getByRole('button', { name: /^Nova/ }).click();
  await expect(page.getByRole('region', { name: 'Terminal' }).getByText('$ git status')).toBeVisible();
  await page.reload();
  await open(page, 'Otto');
  await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible();
});
test('under 1000 px the rail steps aside; the reading column stays centred at 760 px at most', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: ottoThread } });
  await page.setViewportSize({ width: 960, height: 800 });
  await page.goto('/');
  await open(page, 'Otto');
  await expect(page.locator('.project-rail')).toBeHidden();
  const turn = (await thread(page).locator('.turn').first().boundingBox())!;
  expect(turn.width).toBeLessThanOrEqual(760);
  expect(await page.locator('.session-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
```

`daemon.ts` : le gestionnaire de `session.thread` répond `{ type: 'session.thread', id, items: threads[id] }` quand l'id a un fil ; celui de `session.reply` ne fait rien (le test lit `received`).

- [ ] **Step 2: Lancer Playwright**

Run: `pnpm --filter desktop e2e`
Expected : tous les scénarios passent : 4 de `boot`, 4 de `shell`, 6 de `atelier`, 6 de `list` et 6 de `session`.

- [ ] **Step 3: Vérification du dépôt**

Run: `pnpm -r typecheck && pnpm test && pnpm -r build`
Expected : tout passe. Seule l'instabilité connue de l'overlay (`prototype-parity`) peut apparaître ; la signaler sans la corriger.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/e2e
git commit -m "test(desktop): the session in the browser: flat thread, Y on the pinned request, no jump while reading, Reply from the List, terminal on O, narrow window

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
