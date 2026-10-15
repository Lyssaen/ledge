# Ledge Desktop, lot 4 : conversations — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sélectionner une session (carte de l'Équipe ou siège de la Réunion) ouvre à côté de la liste un panneau de conversation complet : tête (sujet, agent, état, machine, métadonnées repliables), fil complet avec actions repliées, demandes d'accord et questions décidables depuis le fil avec affichage optimiste « Envoyé… », compositeur avec brouillon par session, panneau redimensionnable au pointeur et au clavier, actions de session (terminal, interrompre, arrêter, retirer, renommer), et lecture seule propre quand la machine est déconnectée jusqu'à la reconnexion.

**Architecture:** Les aides de fil de l'île (`thread/turns.ts`, `thread/tools.ts`) passent dans `@ledge/ui` sans changer l'île ; le store du fleet garde le fil d'une session figée (R10). Côté Desktop, tout ce qui se décide sans DOM est pur et testé seul : `state/` (bornes du panneau, brouillons, préférences de fil, purge des sessions disparues, persistance validée) et `conversation/sends.ts` + `conversation/actions.ts` (envois en vol, erreurs, disponibilité des actions). Un hook `useConversations` relie ces briques au client du fleet et au `localStorage` ; les composants (`SplitView`, `Resizer`, `ConversationPane`, `ConversationHeader`, `Thread`, `RequestBlock`, `Composer`) suivent le DOM et les classes de la maquette `conversation.js` / `split-view.js`.

**Tech Stack:** TypeScript, React 19, Vite 6, Tauri 2.6, vitest 3 + Testing Library + jsdom, Playwright 1.49, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` (§6 machine déconnectée et reconnexion, §7 clés `desktop.panel` / `desktop.drafts` / `desktop.thread`, §9.1 conversation, §12 tests Desktop, §13 lot 4, §14 risques `keepStale` et `offline`). Maquette (lecture seule, hors dépôt) : `../ledge-desktop/mockup/assets/conversation.css`, `conversation.js`, `split-view.js`, `journeys.css` (règles `.conversation-offline` et `:disabled`), et `../ledge-desktop/HANDOFF.md`. Points reportés : R10 (fil d'une session figée) et m5 (premier appelant de `open_terminal`).

## Global Constraints

- Prérequis : lots 1, 2 et 3 fusionnés ; branche `desktop/lot4-conversations` (déjà créée, empilée sur le lot 3).
- **Changé depuis le lot 3 :** `cargo` est disponible dans ce WSL (`~/.cargo/bin`, à lancer avec `https_proxy=http://192.168.40.2:3128` pour télécharger les crates). Un build Windows fonctionne via `cargo-xwin` ; les implémenteurs n'ont pas à le lancer. Ce lot ne touche pas au Rust : `open_terminal` et `focus_terminal` sont déjà enregistrés.
- Portes de chaque tâche : `pnpm -r typecheck`, `pnpm --filter desktop test`, `pnpm --filter desktop exec playwright test` (Playwright sur le port **5299**, toute erreur console ou `pageerror` fait échouer la spec via `e2e/fixtures.ts`). Les tâches 1 et 2 ajoutent `pnpm --filter @ledge/ui test`, `pnpm --filter overlay test` et `pnpm --filter @ledge/fleet test`.
- L'app remplit la fenêtre (commits 627cdcc, 3ae864a) : on **ne porte pas** les règles de « page d'étude » de la maquette, en particulier pas `.view-body { height: clamp(520px,72vh,760px); flex: none; }`. Seuls `.view-body > .central` et le fil défilent ; `document.documentElement.scrollHeight` reste égal à la hauteur de la fenêtre (`e2e/layout.spec.ts`).
- Panneau : **38 %** au départ ; bornes `{ min: 320 / largeur, max: min(70 %, (largeur − 288) / largeur) }` (280 px de sessions + 8 px de poignée, `split-view.js`), `{ 25, 70 }` tant que la largeur n'est pas mesurée ; **±2 points** aux flèches (← élargit la conversation, → la rétrécit), Début = min, Fin = max ; sous **760 px** empilement vertical sans poignée ; « Agrandir » masque la liste et la poignée, et se replie au changement de vue ou de filtre.
- Clés `localStorage` de ce lot, chacune relue champ par champ avec repli sur le défaut (spec §7) : `desktop.panel` = `{ width: number (0 < w ≤ 70), expanded: boolean }` ; `desktop.drafts` = `{ [idQualifié | 'ledge']: string (≤ 10 000) }` ; `desktop.thread` = `{ [idQualifié]: { open: string[], scroll: number | null } }`. Desktop ne stocke **aucun message d'agent** : `desktop.thread` ne garde que des identifiants de plis et une position.
- Purge (spec §7 « purgé quand la session est retirée ») : une entrée de brouillon ou de fil part quand sa machine a été retirée de la liste, ou quand sa machine est prête (`ready`) et ne la publie plus. Jamais pour une machine qui se connecte ou est injoignable, jamais pour `'ledge'`, jamais avant que le Shell soit « ouvert » (`opened` du lot 3).
- `offline` est vérifié par **chaque** action (spec §14) : décision, option, réponse, interrompre, arrêter, retirer, renommer, terminal. Une session `hook_only` est en lecture seule pour les décisions et les réponses, comme dans l'île.
- Un message libre ne porte jamais de commande (spec §9.1) : le texte part tel quel (`trim()`) dans `session.reply`, sans analyse.
- Une option de question part comme dans l'île : `session.reply { text: String(index + 1) }` (numéro à partir de 1).
- Le panneau n'utilise **jamais** `data-session` (les tests du lot 3 comptent `[data-session]`) : il porte `id="conversation-pane"` et `data-conversation`. Il n'ajoute **aucun** `role="alert"` (`e2e/offline.spec.ts` attend une seule alerte quand le daemon local tombe) : ses bandeaux sont `role="status"`.
- Textes en français et en anglais dans `src/i18n/messages.ts` (`fr` source de vérité, `en: typeof fr`), tous sous la clé `conversation`.
- Commits : `refactor(ui): …`, `fix(fleet): …`, `feat(desktop): …`.

## Review Focus

1. `desktop.panel`, `desktop.drafts` ou `desktop.thread` **corrompus** (`"wide"`, `[1,2]`, `{ "width": "38" }`, `{ "x": { "open": "metadata", "scroll": -4 } }`, JSON invalide) : l'app démarre sur les défauts sans exception, garde ce qui est valide entrée par entrée et ne touche pas aux autres clés. Test ajouté à la tâche 3.
2. Une `error` **qui ne concerne pas** l'envoi en vol (autre session, sans id, ou antérieure à l'envoi) ne rouvre pas la décision ; seule une erreur plus récente portant l'id de la session la rouvre, avec son message. Test ajouté à la tâche 4.
3. Le brouillon d'une session dont la machine est **injoignable au démarrage** (ou pas encore prête) n'est pas purgé ; celui d'une session disparue d'une machine prête l'est, et `'ledge'` n'est jamais touché. Test ajouté à la tâche 3.
4. **Double clic** sur « Autoriser » ou sur une option : une seule décision part ; après une erreur, la même demande peut être renvoyée. Test ajouté à la tâche 6.
5. Corps de vue **étroit ou pas encore mesuré** (largeur 0, 500 px, 200 px) : les bornes restent ordonnées (`min ≤ max`), jamais `NaN`, et la largeur affichée reste dans les bornes quelle que soit la valeur stockée. Test ajouté à la tâche 3.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `packages/ui/src/thread/turns.ts`, `packages/ui/src/thread/tools.ts` (déplacés depuis `apps/overlay/src/thread/`) | Tours du fil, outils ; partagés île/Desktop |
| `apps/overlay/src/thread/turns.ts`, `apps/overlay/src/thread/tools.ts` (shims) | `export * from '@ledge/ui/thread/…'` |
| `packages/ui/test/thread-turns.test.ts` (déplacé depuis `apps/overlay/test/turns.test.ts`) | Tests des tours |
| `packages/fleet/src/store.ts` (modifier), `packages/fleet/test/daemon.test.ts` (modifier) | R10 : le fil d'une session figée survit aux snapshots du fleet |
| `apps/desktop/src/state/storage.ts` | `readJson`, `writeJson`, `isRecord` |
| `apps/desktop/src/state/panel.ts` | `desktop.panel`, bornes, pas clavier |
| `apps/desktop/src/state/drafts.ts` | `desktop.drafts` |
| `apps/desktop/src/state/threadPrefs.ts` | `desktop.thread` (plis, position de lecture) |
| `apps/desktop/src/state/prune.ts` | Purge des entrées de sessions disparues |
| `apps/desktop/src/state/useStored.ts` | Hook valeur stockée |
| `apps/desktop/src/conversation/sends.ts` | Envois en vol, erreurs, blocages (pur) |
| `apps/desktop/src/conversation/actions.ts` | Disponibilité des actions de session (pur) |
| `apps/desktop/src/conversation/SplitView.tsx`, `conversation/Resizer.tsx`, `conversation/layout.ts` | Corps de vue, poignée, `useWidth` / `useNarrow` |
| `apps/desktop/src/conversation/ConversationPane.tsx` | Panneau (`aside#conversation-pane`) |
| `apps/desktop/src/conversation/useConversations.ts`, `conversation/useThreadRequest.ts` | Hooks d'envoi, brouillons, préférences ; demande de fil |
| `apps/desktop/src/conversation/Header.tsx`, `conversation/terminal.ts` | Tête, métadonnées, actions ; « Ouvrir le terminal » (m5) |
| `apps/desktop/src/conversation/blocks.ts`, `conversation/Thread.tsx`, `conversation/Request.tsx` | Fil en blocs, rendu, demande en attente |
| `apps/desktop/src/conversation/Composer.tsx` | Compositeur |
| `apps/desktop/src/App.tsx` (modifier) | Shell : `SplitView`, panneau, `useConversations` |
| `apps/desktop/src/i18n/messages.ts` (modifier) | Bloc `conversation` fr/en |
| `apps/desktop/src/styles/app.css` (modifier) | Port de `conversation.css` + règles `journeys.css` + tête |
| `apps/desktop/test/*.test.ts(x)` | vitest |
| `apps/desktop/e2e/conversation-panel.spec.ts`, `e2e/conversation.spec.ts` | Playwright |

---

### Task 1: Aides de fil dans `@ledge/ui`

**Files:**
- Move: `apps/overlay/src/thread/turns.ts` → `packages/ui/src/thread/turns.ts`
- Move: `apps/overlay/src/thread/tools.ts` → `packages/ui/src/thread/tools.ts`
- Move: `apps/overlay/test/turns.test.ts` → `packages/ui/test/thread-turns.test.ts`
- Create (shims): `apps/overlay/src/thread/turns.ts`, `apps/overlay/src/thread/tools.ts`

**Interfaces:**
- Consumes: `liveHelpers` de `packages/ui/src/bots/poseFor.ts` (le chemin relatif `'../bots/poseFor'` de `turns.ts` reste valable dans `packages/ui/src/thread/`).
- Produces: sous-chemins `@ledge/ui/thread/turns` (`Turn`, `HelperRow`, `turns(items: ThreadItem[]): Turn[]`, `helperThread`, `helperRows`) et `@ledge/ui/thread/tools` (`shortPath`, `rawTarget`, `target`, `toolItems`, `liveTool`, `SPINNER`, `SPINNER_STILL`, `elapsedMs`), résolus par `"./*": "./src/*.ts"` de `packages/ui/package.json`. Pas d'ajout à `packages/ui/src/index.ts` (même usage que `@ledge/ui/bots/poseFor` dans `messages.ts`). Comportement de l'île inchangé.

- [ ] **Step 1: Déplacer le test d'abord**

```bash
cd /home/gch/development/github.com/Paradow-dev/ledge
git mv apps/overlay/test/turns.test.ts packages/ui/test/thread-turns.test.ts
sed -i "s#from './mockDaemon'#from '@ledge/fleet/test/mockDaemon'#" packages/ui/test/thread-turns.test.ts
head -4 packages/ui/test/thread-turns.test.ts
```

Les deux imports du test deviennent `import { turns, helperThread, helperRows } from '../src/thread/turns';` (inchangé : même chemin relatif) et `import { fakeSession } from '@ledge/fleet/test/mockDaemon';`. Rien d'autre ne change dans le fichier.

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @ledge/ui test thread-turns` → « Failed to resolve import "../src/thread/turns" ».

- [ ] **Step 3: Déplacer les sources et poser les shims**

```bash
cd /home/gch/development/github.com/Paradow-dev/ledge
mkdir -p packages/ui/src/thread
git mv apps/overlay/src/thread/turns.ts packages/ui/src/thread/turns.ts
git mv apps/overlay/src/thread/tools.ts packages/ui/src/thread/tools.ts
printf "export * from '@ledge/ui/thread/turns';\n" > apps/overlay/src/thread/turns.ts
printf "export * from '@ledge/ui/thread/tools';\n" > apps/overlay/src/thread/tools.ts
grep -n "^import" packages/ui/src/thread/turns.ts packages/ui/src/thread/tools.ts
```

Attendu : `turns.ts` importe `@ledge/protocol` et `'../bots/poseFor'`, `tools.ts` importe seulement `@ledge/protocol`. Les importeurs de l'île (`SessionView.tsx`, `Thread.tsx`, `HelperView.tsx`, `LiveToolLine.tsx`, `test/live-tool-line.test.tsx`) passent par les shims sans modification.

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @ledge/ui test && pnpm --filter overlay test && pnpm -r typecheck
```

Attendu : les 6 tests de `thread-turns.test.ts` verts dans `@ledge/ui` ; la suite de l'île verte, avec le même nombre de tests moins les 6 déplacés.

- [ ] **Step 5: Commit**

```bash
git add packages/ui apps/overlay
git commit -m "refactor(ui): share the thread helpers with Desktop"
```

---

### Task 2: Le store garde le fil d'une session figée (R10)

**Files:**
- Modify: `packages/fleet/src/store.ts:61-65` (cas `snapshot`)
- Test: `packages/fleet/test/daemon.test.ts`

**Interfaces:**
- Consumes: `Session.offline` (posé par le fleet en `keepStale`, spec §6).
- Produces: `daemonStore.getState().threads` garde, à chaque `snapshot`, les fils des sessions que ce snapshot publie avec `offline: true` ; tous les autres fils sont effacés comme avant (le snapshot de reconnexion, où la session n'est plus `offline`, remplace donc le fil figé). L'île n'a jamais de session `offline` : son comportement ne change pas (`thread-request.test.tsx` et `session-stability.test.tsx` restent verts).

- [ ] **Step 1: Test** — ajouter dans le `describe` qui contient « keeps a session thread… » (`packages/fleet/test/daemon.test.ts`) :

```ts
  it('keeps the thread of a session frozen by keepStale across fleet snapshots, until it comes back live (R10)', () => {
    daemonStore.reset();
    const at = '2026-10-13T10:00:00.000Z';
    const item = { kind: 'prompt' as const, id: 'p1', at, turn: 1, text: 'Vérifie le tunnel' };
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova'), fakeSession('local:otto')] });
    daemonStore.apply({ type: 'session.thread', id: 'devbox:nova', items: [item] });
    daemonStore.apply({ type: 'session.thread', id: 'local:otto', items: [item] });
    // Devbox falls: the fleet republishes its sessions frozen; only live threads are dropped (they are asked again).
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova', { offline: true }), fakeSession('local:otto')] });
    expect([...daemonStore.getState().threads.keys()]).toEqual(['devbox:nova']);
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova', { offline: true }), fakeSession('local:otto')] });
    expect(daemonStore.getState().threads.get('devbox:nova')).toEqual([item]);
    // Devbox is back: its fresh snapshot replaces the frozen one, thread included.
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova'), fakeSession('local:otto')] });
    expect(daemonStore.getState().threads.size).toBe(0);
  });

  it('drops the frozen thread of a session the fleet no longer publishes', () => {
    daemonStore.reset();
    const at = '2026-10-13T10:00:00.000Z';
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('devbox:nova', { offline: true })] });
    daemonStore.apply({ type: 'session.thread', id: 'devbox:nova', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'x' }] });
    daemonStore.apply({ type: 'snapshot', sessions: [] });   // the machine was removed from the list
    expect(daemonStore.getState().threads.size).toBe(0);
  });
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @ledge/fleet test daemon` → le premier test échoue (`[]` au lieu de `['devbox:nova']`).

- [ ] **Step 3: Implémenter** — dans `packages/fleet/src/store.ts`, remplacer le cas `snapshot` :

```ts
      case 'snapshot':
        byId.clear(); for (const s of m.sessions) byId.set(s.id, s); for (const id of previews.keys()) if (!byId.has(id)) previews.delete(id);
        recents = m.recents ?? []; launcher = m.launcher ?? null;
        daemon = m.daemon ?? null; snapshotSeq += 1;
        // A session frozen by keepStale (spec 2026-10-14 §6) keeps the thread already received: its machine cannot be
        // asked again, and Desktop reads it while it is offline. Every other thread is asked again after a snapshot.
        for (const id of [...threads.keys()]) if (!byId.get(id)?.offline) threads.delete(id);
        break;
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @ledge/fleet test && pnpm --filter overlay test && pnpm -r typecheck
```

Attendu : vert, y compris « keeps a session thread… » (son dernier snapshot de `b` non figé vide toujours les fils).

- [ ] **Step 5: Commit**

```bash
git add packages/fleet
git commit -m "fix(fleet): keep a frozen session's thread across snapshots"
```

---

### Task 3: État local du panneau, des brouillons et du fil

**Files:**
- Create: `apps/desktop/src/state/storage.ts`, `apps/desktop/src/state/panel.ts`, `apps/desktop/src/state/drafts.ts`, `apps/desktop/src/state/threadPrefs.ts`, `apps/desktop/src/state/prune.ts`, `apps/desktop/src/state/useStored.ts`
- Test: `apps/desktop/test/panel.test.ts`, `apps/desktop/test/local-state.test.ts`

**Interfaces:**
- Consumes: `splitId(id: string): { machine: string; id: string } | null` et `MachineState` de `@ledge/fleet`.
- Produces :
  - `storage.ts` : `isRecord(v: unknown): v is Record<string, unknown>`, `readJson(key: string): unknown` (null si absent ou illisible), `writeJson(key: string, value: unknown): void` (silencieux si le stockage est indisponible).
  - `panel.ts` : `interface PanelState { width: number; expanded: boolean }`, `interface Bounds { min: number; max: number }`, `PANEL_KEY = 'desktop.panel'`, `DEFAULT_PANEL: PanelState = { width: 38, expanded: false }`, `PANEL_STEP = 2`, `panelBounds(width: number): Bounds`, `clampPanel(pct: number, b: Bounds): number`, `stepPanel(pct: number, key: string, b: Bounds): number | null`, `loadPanel(): PanelState`, `savePanel(p: PanelState): void`.
  - `drafts.ts` : `type Drafts = Readonly<Record<string, string>>`, `DRAFTS_KEY = 'desktop.drafts'`, `DRAFT_MAX = 10_000`, `loadDrafts(): Drafts`, `saveDrafts(d: Drafts): void`, `setDraft(d: Drafts, id: string, text: string): Drafts` (même objet si rien ne change ; texte vide = entrée retirée).
  - `threadPrefs.ts` : `interface ThreadPref { open: readonly string[]; scroll: number | null }`, `type ThreadPrefs = Readonly<Record<string, ThreadPref>>`, `THREAD_KEY = 'desktop.thread'`, `NO_PREF: ThreadPref`, `loadThreadPrefs(): ThreadPrefs`, `saveThreadPrefs(p: ThreadPrefs): void`, `setThreadPref(p: ThreadPrefs, id: string, patch: Partial<ThreadPref>): ThreadPrefs`, `toggled(open: readonly string[], fold: string, on: boolean): string[]`.
  - `prune.ts` : `pruneGone<T>(map: Readonly<Record<string, T>>, sessions: readonly Session[], machines: readonly MachineState[]): Readonly<Record<string, T>>` (même objet si rien n'est retiré).
  - `useStored.ts` : `useStored<T>(load: () => T, save: (v: T) => void): [T, (fn: (v: T) => T) => void]`.

- [ ] **Step 1: Test** — `apps/desktop/test/panel.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PANEL, PANEL_KEY, clampPanel, loadPanel, panelBounds, savePanel, stepPanel } from '../src/state/panel';

describe('panel bounds (split-view.js)', () => {
  it('320 px of conversation and 288 px of sessions at most 70 %', () => {
    expect(panelBounds(1280)).toEqual({ min: 25, max: 70 });
    expect(panelBounds(1000).min).toBeCloseTo(32, 5);
    expect(panelBounds(1000).max).toBe(70);
    expect(panelBounds(900).max).toBeCloseTo(68, 5);
  });
  it('a body not measured yet falls back to 25–70', () => {
    expect(panelBounds(0)).toEqual({ min: 25, max: 70 });
    expect(panelBounds(Number.NaN)).toEqual({ min: 25, max: 70 });
  });
  it('a narrow body keeps min ≤ max and never NaN (Review Focus 5)', () => {
    for (const w of [700, 500, 300, 200, 1]) {
      const b = panelBounds(w);
      expect(Number.isNaN(b.min) || Number.isNaN(b.max)).toBe(false);
      expect(b.min).toBeLessThanOrEqual(b.max);
      expect(clampPanel(DEFAULT_PANEL.width, b)).toBeGreaterThanOrEqual(b.min);
      expect(clampPanel(99, b)).toBeLessThanOrEqual(b.max);
    }
    expect(panelBounds(500).min).toBe(panelBounds(500).max);
    expect(panelBounds(200)).toEqual({ min: 25, max: 25 });
  });
  it('clamps a stored width to the bounds, NaN to the default', () => {
    const b = panelBounds(1000);
    expect(clampPanel(10, b)).toBeCloseTo(32, 5);
    expect(clampPanel(90, b)).toBe(70);
    expect(clampPanel(Number.NaN, b)).toBe(38);
  });
});

describe('keyboard steps', () => {
  const b = { min: 25, max: 70 };
  it('← widens the conversation by 2 points, → narrows it, Home and End jump to the bounds', () => {
    expect(stepPanel(38, 'ArrowLeft', b)).toBe(40);
    expect(stepPanel(38, 'ArrowRight', b)).toBe(36);
    expect(stepPanel(69, 'ArrowLeft', b)).toBe(70);
    expect(stepPanel(26, 'ArrowRight', b)).toBe(25);
    expect(stepPanel(38, 'Home', b)).toBe(25);
    expect(stepPanel(38, 'End', b)).toBe(70);
    expect(stepPanel(38, 'Enter', b)).toBeNull();
  });
});

describe('desktop.panel', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to 38 % not expanded and round-trips', () => {
    expect(loadPanel()).toEqual(DEFAULT_PANEL);
    savePanel({ width: 44, expanded: true });
    expect(loadPanel()).toEqual({ width: 44, expanded: true });
  });
  it('a corrupt value falls back field by field and leaves other keys alone (Review Focus 1)', () => {
    localStorage.setItem('desktop.view', '{"view":"team"}');
    for (const raw of ['"wide"', '[1,2]', '{"width":"38"}', '{"width":-5,"expanded":"yes"}', '{"width":95}', '{bad json']) {
      localStorage.setItem(PANEL_KEY, raw);
      expect(loadPanel()).toEqual(DEFAULT_PANEL);
    }
    localStorage.setItem(PANEL_KEY, '{"width":"wide","expanded":true}');
    expect(loadPanel()).toEqual({ width: 38, expanded: true });
    expect(localStorage.getItem('desktop.view')).toBe('{"view":"team"}');
  });
});
```

`apps/desktop/test/local-state.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { DRAFTS_KEY, DRAFT_MAX, loadDrafts, saveDrafts, setDraft } from '../src/state/drafts';
import { NO_PREF, THREAD_KEY, loadThreadPrefs, saveThreadPrefs, setThreadPref, toggled } from '../src/state/threadPrefs';
import { pruneGone } from '../src/state/prune';

const machine = (id: string, ready: boolean, status: MachineState['status'] = ready ? 'open' : 'connecting') =>
  ({ id, label: id, status, ready, recents: [], sessions: [], launcher: null }) as MachineState;

beforeEach(() => localStorage.clear());

describe('desktop.drafts', () => {
  it('one draft per qualified id; an empty text removes it; same object when unchanged', () => {
    const a = setDraft({}, 'local:otto', 'Bonjour');
    const b = setDraft(a, 'devbox:otto', 'Autre machine');
    expect(b).toEqual({ 'local:otto': 'Bonjour', 'devbox:otto': 'Autre machine' });
    expect(setDraft(b, 'local:otto', 'Bonjour')).toBe(b);
    expect(setDraft(b, 'local:otto', '')).toEqual({ 'devbox:otto': 'Autre machine' });
    expect(setDraft({}, 'x', 'é'.repeat(DRAFT_MAX + 5)).x).toHaveLength(DRAFT_MAX);
  });
  it('round-trips and keeps only valid entries (Review Focus 1)', () => {
    saveDrafts({ 'local:otto': '  garde les espaces ' });
    expect(loadDrafts()).toEqual({ 'local:otto': '  garde les espaces ' });
    localStorage.setItem(DRAFTS_KEY, '{"local:a":"ok","local:b":3,"local:c":"","local:d":null}');
    expect(loadDrafts()).toEqual({ 'local:a': 'ok' });
    for (const raw of ['"text"', '[1,2]', '{oops']) { localStorage.setItem(DRAFTS_KEY, raw); expect(loadDrafts()).toEqual({}); }
  });
});

describe('desktop.thread', () => {
  it('stores folds and reading position per qualified id, never message text', () => {
    let p = setThreadPref({}, 'local:otto', { open: toggled([], 'metadata', true) });
    p = setThreadPref(p, 'local:otto', { scroll: 420 });
    p = setThreadPref(p, 'devbox:nova', { open: ['actions-t1'] });
    saveThreadPrefs(p);
    expect(JSON.parse(localStorage.getItem(THREAD_KEY)!)).toEqual({ 'local:otto': { open: ['metadata'], scroll: 420 }, 'devbox:nova': { open: ['actions-t1'], scroll: null } });
    expect(loadThreadPrefs()).toEqual(p);
    expect(setThreadPref(p, 'local:otto', { scroll: 420 })).toBe(p);
    expect(setThreadPref(p, 'devbox:nova', { open: [] })['devbox:nova']).toBeUndefined();
  });
  it('toggled adds once and removes', () => {
    expect(toggled(['a'], 'a', true)).toEqual(['a']);
    expect(toggled(['a', 'b'], 'a', false)).toEqual(['b']);
  });
  it('a corrupt entry is dropped, the valid ones kept (Review Focus 1)', () => {
    localStorage.setItem(THREAD_KEY, '{"x":{"open":"metadata","scroll":-4},"y":{"open":["metadata","metadata",3],"scroll":"top"},"z":{"open":[],"scroll":12.5}}');
    expect(loadThreadPrefs()).toEqual({ y: { open: ['metadata'], scroll: null }, z: { open: [], scroll: 12.5 } });
    for (const raw of ['"wide"', '[1,2]', '{oops']) { localStorage.setItem(THREAD_KEY, raw); expect(loadThreadPrefs()).toEqual({}); }
    expect(NO_PREF).toEqual({ open: [], scroll: null });
  });
});

describe('pruneGone (Review Focus 3)', () => {
  const map = { 'local:otto': 'a', 'local:gone': 'b', 'devbox:nova': 'c', 'ghost:x': 'd', ledge: 'e' };
  it('drops ids a ready machine no longer lists and ids of a removed machine; keeps ledge', () => {
    const out = pruneGone(map, [fakeSession('local:otto')], [machine('local', true), machine('devbox', false, 'unreachable')]);
    expect(out).toEqual({ 'local:otto': 'a', 'devbox:nova': 'c', ledge: 'e' });
  });
  it('keeps the ids of a machine still connecting or unreachable at boot', () => {
    const out = pruneGone(map, [], [machine('local', false), machine('devbox', false, 'unreachable'), machine('ghost', false)]);
    expect(out).toBe(map);
  });
  it('a frozen session is still listed, so its entry stays', () => {
    const m = { 'devbox:nova': 'brouillon' };
    expect(pruneGone(m, [fakeSession('devbox:nova', { offline: true })], [machine('local', true), machine('devbox', true)])).toBe(m);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test panel local-state` → « Failed to resolve import "../src/state/panel" ».

- [ ] **Step 3: Implémenter**

`apps/desktop/src/state/storage.ts` :

```ts
/** Desktop's own keys (spec §7): every read survives a missing, corrupt or blocked store. */
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function readJson(key: string): unknown {
  try { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); } catch { return null; }
}
export function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the value still holds for this run */ }
}
```

`apps/desktop/src/state/panel.ts` :

```ts
import { isRecord, readJson, writeJson } from './storage';

export interface PanelState { width: number; expanded: boolean }
export interface Bounds { min: number; max: number }
export const PANEL_KEY = 'desktop.panel';
export const DEFAULT_PANEL: PanelState = { width: 38, expanded: false };
export const PANEL_STEP = 2;
const PANE_MIN_PX = 320, LIST_MIN_PX = 288, MAX_PCT = 70, UNMEASURED: Bounds = { min: 25, max: 70 };

/** The conversation's share of the body, in % (mockup split-view.js): at least 320 px of conversation, 280 px of
 *  sessions plus the 8 px handle, at most 70 %. A body not measured yet gets 25–70; a narrow one keeps min ≤ max. */
export function panelBounds(width: number): Bounds {
  if (!Number.isFinite(width) || width <= 0) return UNMEASURED;
  const max = Math.min(MAX_PCT, Math.max(UNMEASURED.min, ((width - LIST_MIN_PX) / width) * 100));
  return { min: Math.min((PANE_MIN_PX / width) * 100, max), max };
}
export function clampPanel(pct: number, b: Bounds): number {
  return Math.min(b.max, Math.max(b.min, Number.isFinite(pct) ? pct : DEFAULT_PANEL.width));
}
/** ← widens the conversation (the handle moves left), → narrows it; Home and End jump to the bounds. */
export function stepPanel(pct: number, key: string, b: Bounds): number | null {
  switch (key) {
    case 'ArrowLeft': return clampPanel(pct + PANEL_STEP, b);
    case 'ArrowRight': return clampPanel(pct - PANEL_STEP, b);
    case 'Home': return b.min;
    case 'End': return b.max;
    default: return null;
  }
}
export function loadPanel(): PanelState {
  const raw = readJson(PANEL_KEY);
  const o = isRecord(raw) ? raw : {};
  const width = typeof o.width === 'number' && Number.isFinite(o.width) && o.width > 0 && o.width <= MAX_PCT ? o.width : DEFAULT_PANEL.width;
  return { width, expanded: typeof o.expanded === 'boolean' ? o.expanded : DEFAULT_PANEL.expanded };
}
export function savePanel(p: PanelState): void { writeJson(PANEL_KEY, { width: p.width, expanded: p.expanded }); }
```

`apps/desktop/src/state/drafts.ts` :

```ts
import { isRecord, readJson, writeJson } from './storage';

/** One draft per qualified session id (spec §9.1), plus `ledge` for the resident's own composer in a later lot. */
export type Drafts = Readonly<Record<string, string>>;
export const DRAFTS_KEY = 'desktop.drafts';
export const DRAFT_MAX = 10_000;

export function loadDrafts(): Drafts {
  const raw = readJson(DRAFTS_KEY);
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(raw)) if (id && typeof text === 'string' && text) out[id] = text.slice(0, DRAFT_MAX);
  return out;
}
export function saveDrafts(d: Drafts): void { writeJson(DRAFTS_KEY, d); }
/** The text is kept as typed (no trim): only sending trims it. */
export function setDraft(d: Drafts, id: string, text: string): Drafts {
  const next = text.slice(0, DRAFT_MAX);
  if ((d[id] ?? '') === next) return d;
  const out = { ...d };
  if (next) out[id] = next; else delete out[id];
  return out;
}
```

`apps/desktop/src/state/threadPrefs.ts` :

```ts
import { isRecord, readJson, writeJson } from './storage';

/** What Desktop keeps of a thread (spec §7 `desktop.thread`): which folds are open and where the reader was. Never a message. */
export interface ThreadPref { open: readonly string[]; scroll: number | null }
export type ThreadPrefs = Readonly<Record<string, ThreadPref>>;
export const THREAD_KEY = 'desktop.thread';
export const NO_PREF: ThreadPref = { open: [], scroll: null };
const MAX_OPEN = 200;

function readPref(v: unknown): ThreadPref | null {
  if (!isRecord(v)) return null;
  const open = Array.isArray(v.open) ? [...new Set(v.open.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(-MAX_OPEN) : [];
  const scroll = typeof v.scroll === 'number' && Number.isFinite(v.scroll) && v.scroll >= 0 ? v.scroll : null;
  return Array.isArray(v.open) || scroll !== null ? { open, scroll } : null;
}
export function loadThreadPrefs(): ThreadPrefs {
  const raw = readJson(THREAD_KEY);
  if (!isRecord(raw)) return {};
  const out: Record<string, ThreadPref> = {};
  for (const [id, v] of Object.entries(raw)) { const p = readPref(v); if (id && p) out[id] = p; }
  return out;
}
export function saveThreadPrefs(p: ThreadPrefs): void { writeJson(THREAD_KEY, p); }

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export function setThreadPref(p: ThreadPrefs, id: string, patch: Partial<ThreadPref>): ThreadPrefs {
  const cur = p[id] ?? NO_PREF;
  const next: ThreadPref = { open: patch.open ?? cur.open, scroll: patch.scroll !== undefined ? patch.scroll : cur.scroll };
  if (p[id] && sameList(next.open, cur.open) && next.scroll === cur.scroll) return p;
  if (!p[id] && next.open.length === 0 && next.scroll === null) return p;
  const out = { ...p };
  if (next.open.length || next.scroll !== null) out[id] = next; else delete out[id];
  return out;
}
export function toggled(open: readonly string[], fold: string, on: boolean): string[] {
  const rest = open.filter(f => f !== fold);
  return on ? [...rest, fold].slice(-MAX_OPEN) : rest;
}
```

Note : dans le test « corrupt entry », `y` garde `open: ['metadata']` (doublon et nombre retirés) avec `scroll: null`, `z` garde `open: []` et `scroll: 12.5` ; `x` (`open` pas un tableau, `scroll` négatif) disparaît.

`apps/desktop/src/state/prune.ts` :

```ts
import type { Session } from '@ledge/protocol';
import { splitId, type MachineState } from '@ledge/fleet';

/** Entries of sessions that are gone (spec §7: purged when the session is removed). Only a ready machine says what it no
 *  longer has; a machine still connecting or unreachable keeps its entries, a machine removed from the list loses them.
 *  `ledge` (the resident) is never pruned. Same object when nothing goes. */
export function pruneGone<T>(map: Readonly<Record<string, T>>, sessions: readonly Session[], machines: readonly MachineState[]): Readonly<Record<string, T>> {
  const present = new Set(sessions.map(s => s.id));
  let out: Record<string, T> | null = null;
  for (const id of Object.keys(map)) {
    if (id === 'ledge' || present.has(id)) continue;
    const owner = machines.find(m => m.id === splitId(id)?.machine);
    if (owner && !owner.ready) continue;
    out ??= { ...map };
    delete out[id];
  }
  return out ?? map;
}
```

`apps/desktop/src/state/useStored.ts` :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** A value loaded once from storage and saved on each change (not on mount: a corrupt key is only rewritten once used). */
export function useStored<T>(load: () => T, save: (v: T) => void): [T, (fn: (v: T) => T) => void] {
  const [value, setValue] = useState(load);
  const mounted = useRef(false);
  useEffect(() => { if (!mounted.current) { mounted.current = true; return; } save(value); }, [value, save]);
  const update = useCallback((fn: (v: T) => T) => setValue(fn), []);
  return [value, update];
}
```

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test panel local-state && pnpm -r typecheck`

- [ ] **Step 5: Commit** : `git add apps/desktop/src/state apps/desktop/test/panel.test.ts apps/desktop/test/local-state.test.ts && git commit -m "feat(desktop): panel, drafts and thread preferences storage"`

---

### Task 4: Envois en vol et disponibilité des actions

**Files:**
- Create: `apps/desktop/src/conversation/sends.ts`, `apps/desktop/src/conversation/actions.ts`
- Test: `apps/desktop/test/sends.test.ts`, `apps/desktop/test/actions.test.ts`

**Interfaces:**
- Consumes: `Session` de `@ledge/protocol`, `DaemonError { id?: string; message: string; seq: number }` de `@ledge/fleet`.
- Produces :
  - `sends.ts` : `type SendKind = 'decision' | 'reply' | 'interrupt' | 'kill' | 'dismiss' | 'rename'` ; `interface Sent { kind: SendKind; text?: string; request: string | null; mark: string; errorSeq: number }` ; `interface Failure { kind: SendKind; message: string; text?: string; request: string | null }` ; `interface SendsState { sent: Readonly<Record<string, Sent>>; failed: Readonly<Record<string, Failure>> }` ; `NO_SENDS` ; `type SendsAction = { type: 'sent'; session: Session; kind: SendKind; text?: string; errorSeq: number } | { type: 'sessions'; sessions: readonly Session[] } | { type: 'error'; error: DaemonError } | { type: 'forget'; id: string }` ; `requestKey(s: Session): string | null` ; `markOf(s: Session): string` ; `reduceSends(state: SendsState, a: SendsAction): SendsState` ; `type Blocked = 'offline' | 'readonly'` ; `blocked(s: Session): Blocked | null` ; `type ReplyBlock = Blocked | 'request' | 'options'` ; `replyBlock(s: Session): ReplyBlock | null`.
  - `actions.ts` : `type SessionAction = 'terminal' | 'interrupt' | 'kill' | 'dismiss' | 'rename'` ; `type ActionReason = 'offline' | 'noTerminal' | 'idle'` ; `interface ActionState { shown: boolean; enabled: boolean; reason?: ActionReason }` ; `SESSION_ACTIONS: readonly SessionAction[]` ; `sessionActions(s: Session, terminal: string[] | null): Record<SessionAction, ActionState>`.

Règles (spec §9.1 « Envoyé… », une erreur rouvre l'action) :
- `sent` remplace l'envoi en vol de la session et efface son échec. Une décision (`kind: 'decision'`, accord ou option) retient la demande en attente (`requestKey`) ; tout autre envoi retient la marque de la session (`markOf`).
- `sessions` retire un envoi en vol quand la session a disparu, ou quand, la session n'étant pas figée, sa demande a changé (décision) ou sa marque a changé (autre envoi). Un échec part quand la session a disparu ou que la demande qu'il visait a changé.
- `error` n'agit que si elle porte l'id d'une session avec un envoi en vol **et** un `seq` plus grand que celui noté à l'envoi ; l'envoi devient un échec avec le message, le texte d'une réponse est gardé.
- `forget` retire l'échec seulement.

- [ ] **Step 1: Test** — `apps/desktop/test/sends.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import type { Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { NO_SENDS, blocked, markOf, reduceSends, replyBlock, requestKey } from '../src/conversation/sends';

const ask: Session['pending'] = { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' };
const otto = fakeSession('local:otto', { state: 'waiting_permission', pending: ask });

describe('reduceSends', () => {
  it('a decision stays sent while the same request waits, whatever else changes', () => {
    let s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'decision', errorSeq: 0 });
    expect(s.sent['local:otto']).toMatchObject({ kind: 'decision', request: requestKey(otto) });
    s = reduceSends(s, { type: 'sessions', sessions: [{ ...otto, lastActivityAt: '2026-10-09T18:05:00.000Z' }] });
    expect(s.sent['local:otto']).toBeDefined();
    s = reduceSends(s, { type: 'sessions', sessions: [{ ...otto, state: 'working', pending: undefined }] });
    expect(s.sent['local:otto']).toBeUndefined();
  });
  it('a reply or a command stays sent until the session changes', () => {
    let s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'reply', text: 'Oui', errorSeq: 0 });
    expect(reduceSends(s, { type: 'sessions', sessions: [otto] })).toBe(s);
    s = reduceSends(s, { type: 'sessions', sessions: [{ ...otto, lastActivityAt: '2026-10-09T18:05:00.000Z' }] });
    expect(s.sent['local:otto']).toBeUndefined();
  });
  it('a frozen session keeps its send in flight; a removed one drops it', () => {
    const s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'kill', errorSeq: 0 });
    expect(reduceSends(s, { type: 'sessions', sessions: [{ ...otto, offline: true, lastActivityAt: 'x' }] }).sent['local:otto']).toBeDefined();
    expect(reduceSends(s, { type: 'sessions', sessions: [] }).sent).toEqual({});
  });
  it('only a newer error carrying the session id reopens it (Review Focus 2)', () => {
    const s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'reply', text: 'Oui', errorSeq: 4 });
    expect(reduceSends(s, { type: 'error', error: { id: 'local:nova', message: 'x', seq: 5 } })).toBe(s);
    expect(reduceSends(s, { type: 'error', error: { message: 'no id', seq: 6 } })).toBe(s);
    expect(reduceSends(s, { type: 'error', error: { id: 'local:otto', message: 'old', seq: 4 } })).toBe(s);
    const f = reduceSends(s, { type: 'error', error: { id: 'local:otto', message: 'Request expired', seq: 5 } });
    expect(f.sent).toEqual({});
    expect(f.failed['local:otto']).toEqual({ kind: 'reply', message: 'Request expired', text: 'Oui', request: null });
    expect(reduceSends(f, { type: 'error', error: { id: 'local:otto', message: 'again', seq: 6 } })).toBe(f);
  });
  it('a new send clears the failure; a changed request drops a decision failure; forget drops it', () => {
    const sent = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'decision', errorSeq: 0 });
    const f = reduceSends(sent, { type: 'error', error: { id: 'local:otto', message: 'Request expired', seq: 1 } });
    expect(f.failed['local:otto']?.request).toBe(requestKey(otto));
    expect(reduceSends(f, { type: 'sent', session: otto, kind: 'decision', errorSeq: 1 }).failed).toEqual({});
    expect(reduceSends(f, { type: 'sessions', sessions: [otto] })).toBe(f);
    expect(reduceSends(f, { type: 'sessions', sessions: [{ ...otto, pending: undefined, state: 'working' }] }).failed).toEqual({});
    expect(reduceSends(f, { type: 'forget', id: 'local:otto' }).failed).toEqual({});
  });
});

describe('request key and mark', () => {
  it('the request key names the kind, text and helper of the pending request', () => {
    expect(requestKey(fakeSession('a'))).toBeNull();
    expect(requestKey(otto)).toBe('permission\nRun git push?\n');
    expect(requestKey({ ...otto, pending: { ...ask, helperId: 'h1' } })).toBe('permission\nRun git push?\nh1');
  });
  it('the mark moves with state, activity, last reply, request and topic', () => {
    const m = markOf(otto);
    expect(markOf({ ...otto, topic: 'x' })).not.toBe(m);
    expect(markOf({ ...otto, lastReply: { text: 'ok', at: '2026-10-09T18:02:00.000Z' } })).not.toBe(m);
    expect(markOf({ ...otto })).toBe(m);
  });
});

describe('blocked and replyBlock', () => {
  it('offline wins, hook-only sessions are read-only', () => {
    expect(blocked(otto)).toBeNull();
    expect(blocked({ ...otto, offline: true, source: 'hook_only' })).toBe('offline');
    expect(blocked({ ...otto, source: 'hook_only' })).toBe('readonly');
  });
  it('free text waits while a permission, plan or diff is asked; options take free text only with Claude', () => {
    expect(replyBlock(otto)).toBe('request');
    expect(replyBlock(fakeSession('a', { state: 'idle' }))).toBeNull();
    const q = { kind: 'question' as const, text: 'Which one?', options: ['A', 'B'], source: 'pane' as const };
    expect(replyBlock(fakeSession('a', { state: 'waiting_input', pending: q }))).toBeNull();
    expect(replyBlock(fakeSession('a', { state: 'waiting_input', tool: 'codex', pending: q }))).toBe('options');
    expect(replyBlock({ ...otto, offline: true })).toBe('offline');
  });
});
```

`apps/desktop/test/actions.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { sessionActions } from '../src/conversation/actions';

const cmd = ['ssh', '-t', 'devbox', 'tmux', 'attach', '-t', 'ledge-nova'];

describe('sessionActions', () => {
  it('a working launcher session: terminal, interrupt, stop and rename; no dismiss', () => {
    const a = sessionActions(fakeSession('local:otto'), cmd);
    expect(a.terminal).toEqual({ shown: true, enabled: true });
    expect(a.interrupt).toEqual({ shown: true, enabled: true });
    expect(a.kill).toEqual({ shown: true, enabled: true });
    expect(a.dismiss.shown).toBe(false);
    expect(a.rename).toEqual({ shown: true, enabled: true });
  });
  it('an idle session cannot be interrupted', () => {
    expect(sessionActions(fakeSession('local:otto', { state: 'idle' }), cmd).interrupt).toEqual({ shown: true, enabled: false, reason: 'idle' });
  });
  it('a finished session or a hook-only one can be dismissed, not stopped', () => {
    const done = sessionActions(fakeSession('local:otto', { state: 'exited' }), cmd);
    expect([done.dismiss.shown, done.kill.shown, done.interrupt.shown]).toEqual([true, false, false]);
    const hook = sessionActions(fakeSession('local:otto', { source: 'hook_only', tmuxSession: null }), null);
    expect([hook.dismiss.shown, hook.kill.shown, hook.interrupt.shown]).toEqual([true, false, false]);
    expect(hook.terminal.enabled).toBe(true); // a local session is focused by its title, as in the island
  });
  it('a remote session needs a terminal command and a tmux session', () => {
    expect(sessionActions(fakeSession('devbox:nova', { machineId: 'devbox' }), null).terminal).toEqual({ shown: true, enabled: false, reason: 'noTerminal' });
    expect(sessionActions(fakeSession('devbox:nova', { machineId: 'devbox', tmuxSession: null }), cmd).terminal.enabled).toBe(false);
    expect(sessionActions(fakeSession('devbox:nova', { machineId: 'devbox' }), cmd).terminal.enabled).toBe(true);
  });
  it('offline disables every action, with its reason (spec §14)', () => {
    const a = sessionActions(fakeSession('devbox:nova', { machineId: 'devbox', offline: true }), cmd);
    for (const k of ['terminal', 'interrupt', 'kill', 'rename'] as const) expect(a[k]).toEqual({ shown: true, enabled: false, reason: 'offline' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test sends actions` → « Failed to resolve import "../src/conversation/sends" ».

- [ ] **Step 3: Implémenter**

`apps/desktop/src/conversation/sends.ts` :

```ts
import type { Session } from '@ledge/protocol';
import type { DaemonError } from '@ledge/fleet';

/** What the conversation has sent and not seen land yet (spec §9.1: « Envoyé… », an error reopens the action). */
export type SendKind = 'decision' | 'reply' | 'interrupt' | 'kill' | 'dismiss' | 'rename';
export interface Sent { kind: SendKind; text?: string; request: string | null; mark: string; errorSeq: number }
export interface Failure { kind: SendKind; message: string; text?: string; request: string | null }
export interface SendsState { sent: Readonly<Record<string, Sent>>; failed: Readonly<Record<string, Failure>> }
export type SendsAction =
  | { type: 'sent'; session: Session; kind: SendKind; text?: string; errorSeq: number }
  | { type: 'sessions'; sessions: readonly Session[] }
  | { type: 'error'; error: DaemonError }
  | { type: 'forget'; id: string };
export const NO_SENDS: SendsState = { sent: {}, failed: {} };

/** The request a decision answers: it is settled once this changes. */
export function requestKey(s: Session): string | null {
  return s.pending ? `${s.pending.kind}\n${s.pending.text}\n${s.pending.helperId ?? ''}` : null;
}
/** Anything the daemon changes after it took a message or a command. */
export function markOf(s: Session): string {
  return [s.state, s.lastActivityAt, s.lastReply?.at ?? '', requestKey(s) ?? '', s.topic ?? ''].join('|');
}
const without = <T>(map: Readonly<Record<string, T>>, id: string): Record<string, T> => { const out = { ...map }; delete out[id]; return out; };

export function reduceSends(state: SendsState, a: SendsAction): SendsState {
  switch (a.type) {
    case 'sent': {
      const s = a.session;
      const sent: Sent = { kind: a.kind, ...(a.text !== undefined ? { text: a.text } : {}), request: a.kind === 'decision' ? requestKey(s) : null, mark: markOf(s), errorSeq: a.errorSeq };
      return { sent: { ...state.sent, [s.id]: sent }, failed: state.failed[s.id] ? without(state.failed, s.id) : state.failed };
    }
    case 'error': {
      const id = a.error.id;
      const cur = id ? state.sent[id] : undefined;
      if (!id || !cur || a.error.seq <= cur.errorSeq) return state;
      const failure: Failure = { kind: cur.kind, message: a.error.message, ...(cur.text !== undefined ? { text: cur.text } : {}), request: cur.request };
      return { sent: without(state.sent, id), failed: { ...state.failed, [id]: failure } };
    }
    case 'sessions': {
      const byId = new Map(a.sessions.map(s => [s.id, s]));
      let sent = state.sent, failed = state.failed;
      for (const [id, x] of Object.entries(state.sent)) {
        const s = byId.get(id);
        const landed = s && !s.offline && (x.request !== null ? requestKey(s) !== x.request : markOf(s) !== x.mark);
        if (!s || landed) sent = without(sent, id);
      }
      for (const [id, f] of Object.entries(state.failed)) {
        const s = byId.get(id);
        if (!s || (f.request !== null && !s.offline && requestKey(s) !== f.request)) failed = without(failed, id);
      }
      return sent === state.sent && failed === state.failed ? state : { sent, failed };
    }
    case 'forget': return state.failed[a.id] ? { ...state, failed: without(state.failed, a.id) } : state;
  }
}

/** Why nothing can be sent to this session at all: its machine is disconnected (spec §6), or it is a hook-only session. */
export type Blocked = 'offline' | 'readonly';
export function blocked(s: Session): Blocked | null {
  if (s.offline) return 'offline';
  if (s.source === 'hook_only') return 'readonly';
  return null;
}
/** Why the composer cannot send free text now: a permission, plan or diff waits for its buttons, or a question's
 *  options cannot take free text outside Claude (island parity). */
export type ReplyBlock = Blocked | 'request' | 'options';
export function replyBlock(s: Session): ReplyBlock | null {
  const b = blocked(s); if (b) return b;
  if (s.pending && s.pending.kind !== 'question') return 'request';
  if (s.pending?.kind === 'question' && (s.pending.options?.length ?? 0) > 0 && s.tool !== 'claude') return 'options';
  return null;
}
```

`apps/desktop/src/conversation/actions.ts` :

```ts
import type { Session } from '@ledge/protocol';

export type SessionAction = 'terminal' | 'interrupt' | 'kill' | 'dismiss' | 'rename';
export type ActionReason = 'offline' | 'noTerminal' | 'idle';
export interface ActionState { shown: boolean; enabled: boolean; reason?: ActionReason }
export const SESSION_ACTIONS: readonly SessionAction[] = ['terminal', 'interrupt', 'kill', 'dismiss', 'rename'];
const BUSY: readonly Session['state'][] = ['starting', 'working', 'waiting_permission', 'waiting_input'];

/** The session actions of spec §9.1. A local session opens its terminal by title even without tmux (island parity); a remote
 *  one needs the fleet's command and a tmux session. Stop is for launcher sessions still running; Dismiss for finished or
 *  hook-only ones. Offline disables everything (spec §14). */
export function sessionActions(s: Session, terminal: string[] | null): Record<SessionAction, ActionState> {
  const live = s.source !== 'hook_only' && s.state !== 'exited';
  const remote = !!s.machineId && s.machineId !== 'local';
  const on = (shown: boolean, ok: boolean, reason?: ActionReason): ActionState =>
    s.offline ? { shown, enabled: false, reason: 'offline' } : ok ? { shown, enabled: true } : { shown, enabled: false, ...(reason ? { reason } : {}) };
  return {
    terminal: on(true, !remote || (!!terminal && !!s.tmuxSession), 'noTerminal'),
    interrupt: on(live, BUSY.includes(s.state), 'idle'),
    kill: on(live, true),
    dismiss: on(s.state === 'exited' || s.source === 'hook_only', true),
    rename: on(true, true)
  };
}
```

`fakeSession('local:otto')` n'a pas de `machineId` : `remote` est faux, comme une session du daemon local. Les sessions distantes des tests posent `machineId: 'devbox'`, comme le fleet.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test sends actions && pnpm -r typecheck`

- [ ] **Step 5: Commit** : `git add apps/desktop/src/conversation apps/desktop/test/sends.test.ts apps/desktop/test/actions.test.ts && git commit -m "feat(desktop): sends in flight and session action rules"`

---

### Task 5: Vue partagée, poignée et ouverture du panneau

**Files:**
- Create: `apps/desktop/src/conversation/layout.ts`, `apps/desktop/src/conversation/Resizer.tsx`, `apps/desktop/src/conversation/SplitView.tsx`, `apps/desktop/src/conversation/ConversationPane.tsx`
- Modify: `apps/desktop/src/App.tsx` (Shell), `apps/desktop/src/i18n/messages.ts` (bloc `conversation` fr/en), `apps/desktop/src/styles/app.css` (`.view-body` l. 38, port de `conversation.css` et des règles de `journeys.css`)
- Test: `apps/desktop/test/split-view.test.tsx`, `apps/desktop/e2e/conversation-panel.spec.ts`

**Interfaces:**
- Consumes: `PanelState`, `Bounds`, `panelBounds`, `clampPanel`, `stepPanel`, `loadPanel`, `savePanel` (tâche 3) ; `useStored` (tâche 3) ; `useI18n` ; `RoomView`, `TeamView` (lot 3).
- Produces :
  - `layout.ts` : `NARROW_QUERY = '(max-width: 760px)'`, `useWidth(ref: RefObject<HTMLElement | null>): number` (0 tant que non mesuré), `useNarrow(): boolean` (faux sans `matchMedia`, comme dans jsdom).
  - `Resizer.tsx` : `Resizer({ value, bounds, bodyWidth, onChange }: { value: number; bounds: Bounds; bodyWidth: number; onChange: (pct: number) => void })`.
  - `SplitView.tsx` : `SplitView({ panel, onPanel, list, pane }: { panel: PanelState; onPanel: (fn: (p: PanelState) => PanelState) => void; list: ReactNode; pane: ReactNode | null })` ; rend `div.view-body` (classe `conversation-expanded` si agrandi), la liste, la poignée (ni en étroit, ni agrandi, ni sans panneau), le panneau ; pose `--conversation-width` sur `.view-body`.
  - `ConversationPane.tsx` (squelette, complété aux tâches 7 à 9) : `ConversationPane({ session, expanded, onExpand }: { session: Session; expanded: boolean; onExpand: (on: boolean) => void })` → `aside#conversation-pane.detail.conversation[data-conversation=<id>][aria-label]`.
  - `messages.ts` : bloc `t.conversation` complet (utilisé par les tâches 5 à 9), forme donnée au Step 3.

- [ ] **Step 1: Test** — `apps/desktop/test/split-view.test.tsx` :

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitView } from '../src/conversation/SplitView';
import { DEFAULT_PANEL, type PanelState } from '../src/state/panel';

function Harness({ initial = DEFAULT_PANEL, pane = true }: { initial?: PanelState; pane?: boolean }) {
  const [panel, setPanel] = useState(initial);
  return <SplitView panel={panel} onPanel={fn => setPanel(fn)} list={<section className="central" />} pane={pane ? <aside id="conversation-pane" className="detail conversation" /> : null} />;
}
const width = (c: HTMLElement) => (c.querySelector('.view-body') as HTMLElement).style.getPropertyValue('--conversation-width');

afterEach(() => { vi.unstubAllGlobals(); });

describe('SplitView', () => {
  it('the handle moves the conversation by 2 points, Home and End jump to the bounds (Review Focus 5: body not measured)', () => {
    const { container } = render(<Harness />);
    const handle = screen.getByRole('separator', { name: 'Conversation width' });
    expect(handle).toHaveAttribute('aria-valuenow', '38');
    expect(handle).toHaveAttribute('aria-controls', 'conversation-pane');
    expect(handle).toHaveAttribute('aria-valuemin', '25');
    expect(handle).toHaveAttribute('aria-valuemax', '70');
    expect(width(container)).toBe('38%');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '40');
    expect(handle).toHaveAttribute('aria-valuetext', 'Conversation: 40% of the width');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '70');
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '25');
    expect(width(container)).toBe('25%');
  });
  it('a stored width outside the bounds is shown clamped', () => {
    render(<Harness initial={{ width: 0.5, expanded: false }} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '25');
  });
  it('no handle without a conversation, when expanded, or under 760 px', () => {
    const { container, unmount } = render(<Harness pane={false} />);
    expect(screen.queryByRole('separator')).toBeNull();
    expect(width(container)).toBe('');
    unmount();
    const expanded = render(<Harness initial={{ width: 38, expanded: true }} />);
    expect(screen.queryByRole('separator')).toBeNull();
    expect(expanded.container.querySelector('.view-body')).toHaveClass('conversation-expanded');
    expanded.unmount();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 760px)', addEventListener() {}, removeEventListener() {} }));
    render(<Harness />);
    expect(screen.queryByRole('separator')).toBeNull();
  });
});
```

`apps/desktop/e2e/conversation-panel.spec.ts` :

```ts
import { test, expect } from './fixtures';
import { eight, fakeDaemon } from './daemon';

const ratio = (page: import('@playwright/test').Page) => page.evaluate(() =>
  document.querySelector('#conversation-pane')!.getBoundingClientRect().width / document.querySelector('.view-body')!.getBoundingClientRect().width);

test('selecting a seat or a card opens the conversation beside the sessions', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await page.locator('.seat[data-session="local:luna"]').click();
  await expect(pane).toHaveAttribute('data-conversation', 'local:luna');
  await expect(pane).toHaveAttribute('aria-label', 'Conversation with Luna');
  const list = (await page.locator('.view-body > .central').boundingBox())!;
  let box = (await pane.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(list.x + list.width);
  expect(Math.abs(box.y - list.y)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Team' }).click();
  await page.locator('.session-card[data-session="local:milo"]').click();
  await expect(pane).toHaveAttribute('data-conversation', 'local:milo');
  box = (await pane.boundingBox())!;
  expect(box.x).toBeGreaterThan(600);
});

test('the panel is resized from the keyboard and keeps its width across a reload', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  const handle = page.getByRole('separator', { name: 'Conversation width' });
  await handle.focus();
  await expect(handle).toHaveAttribute('aria-valuenow', '38');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '40');
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '70');
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '25');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '27');
  expect(await ratio(page)).toBeCloseTo(0.27, 2);
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '27');
  expect(await ratio(page)).toBeCloseTo(0.27, 2);
});

test('Expand hides the sessions until the view changes', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await pane.getByRole('button', { name: '↗ Expand' }).click();
  await expect(page.locator('.view-body > .central')).toBeHidden();
  await expect(page.getByRole('separator')).toHaveCount(0);
  await expect(pane.getByRole('button', { name: '↙ Collapse' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Team' }).click();
  await expect(page.locator('.view-body > .central')).toBeVisible();
  await expect(pane.getByRole('button', { name: '↗ Expand' })).toHaveAttribute('aria-expanded', 'false');
});

test('under 760 px the conversation stacks under the sessions, without a handle', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await fakeDaemon(page, eight);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByRole('separator')).toHaveCount(0);
  const list = (await page.locator('.view-body > .central').boundingBox())!;
  const box = (await pane.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
});
```

À l'ouverture, le réducteur du lot 3 (`visible`) sélectionne la première session visible : le panneau est donc ouvert dès le démarrage, sur Otto.

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test split-view` → « Failed to resolve import "../src/conversation/SplitView" » ; `pnpm --filter desktop exec playwright test conversation-panel` → `#conversation-pane` introuvable.

- [ ] **Step 3: Implémenter**

**3a. Textes** — dans `apps/desktop/src/i18n/messages.ts`, ajouter `conversation` à la fin de `fr` (après `states`, avec une virgule) :

```ts
  conversation: {
    eyebrow: 'CONVERSATION',
    label: (name: string) => `Conversation avec ${name}`,
    expand: '↗ Agrandir',
    collapse: '↙ Réduire',
    local: 'Cette machine',
    meta: {
      summary: 'Détails de la session',
      duration: (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`),
      jira: (key: string, from: 'branch' | 'topic') => `${key} · détectée dans ${from === 'branch' ? 'la branche' : 'le sujet'}`,
      ambiguous: (keys: readonly string[]) => `À clarifier : ${keys.join(', ')}`,
      noJira: 'Aucune clé Jira détectée'
    },
    offline: 'Machine déconnectée · historique figé. Votre brouillon sera conservé jusqu’à la reconnexion.',
    readonly: 'Session suivie par les hooks · lecture seule.',
    thread: {
      label: (name: string) => `Historique des échanges avec ${name}`,
      start: (time: string) => `Début de la session · ${time}`,
      partial: 'Historique partiel · seule la dernière réponse est connue.',
      you: 'Vous',
      actions: (n: number) => `${n} ${plural(n, 'action', 'actions')} · Voir le détail`,
      permission: (tool: string, accepted: boolean) => `${accepted ? 'Accord donné' : 'Accord refusé'} · ${tool}`,
      helper: (task: string, done: boolean) => `Sous-agent · ${task}${done ? ' · terminé' : ''}`
    },
    request: {
      kinds: { permission: 'Demande d’accord', question: 'Question', plan: 'Plan à valider', diff: 'Modifications à valider' },
      deny: 'Refuser',
      allow: 'Autoriser',
      orReply: 'Ou précisez votre réponse dans le champ ci-dessous.',
      sent: 'Envoyé…',
      failed: (msg: string) => `Échec de l’envoi : ${msg}`
    },
    composer: {
      label: (name: string) => `Répondre à ${name}`,
      placeholder: 'Écrivez votre message…',
      send: 'Envoyer ↑',
      hint: 'Ctrl / ⌘ + Entrée pour envoyer · Entrée pour une nouvelle ligne',
      sent: 'Envoyé…',
      failed: (msg: string) => `Message non envoyé : ${msg}`,
      blocked: {
        offline: 'Machine déconnectée : envoi impossible.',
        readonly: 'Session en lecture seule.',
        request: 'Répondez d’abord à la demande ci-dessus.',
        options: 'Choisissez une des options ci-dessus.'
      }
    },
    actions: {
      label: 'Actions de la session',
      terminal: 'Ouvrir le terminal',
      interrupt: 'Interrompre',
      kill: 'Arrêter',
      dismiss: 'Retirer',
      rename: 'Renommer',
      why: { offline: 'Machine déconnectée', noTerminal: 'Aucun terminal pour cette session', idle: 'Rien à interrompre', unavailable: 'Terminal introuvable sur cette machine' },
      confirmKill: (name: string) => `Arrêter ${name} ? Le travail en cours sera interrompu.`,
      confirm: 'Oui, arrêter',
      cancel: 'Annuler',
      renameLabel: 'Sujet de la session',
      renameHint: 'Entrée pour enregistrer · Échap pour annuler',
      save: 'Enregistrer',
      sent: 'Envoyé…',
      failed: (msg: string) => `Échec : ${msg}`
    },
    panel: {
      label: 'Largeur de la conversation',
      valueText: (n: number) => `Conversation : ${n} % de la largeur`,
      title: 'Glisser pour ajuster la largeur · flèches gauche et droite au clavier'
    }
  }
```

et à la fin de `en` :

```ts
  conversation: {
    eyebrow: 'CONVERSATION',
    label: (name: string) => `Conversation with ${name}`,
    expand: '↗ Expand',
    collapse: '↙ Collapse',
    local: 'This machine',
    meta: {
      summary: 'Session details',
      duration: (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`),
      jira: (key: string, from: 'branch' | 'topic') => `${key} · found in the ${from === 'branch' ? 'branch' : 'subject'}`,
      ambiguous: (keys: readonly string[]) => `To clarify: ${keys.join(', ')}`,
      noJira: 'No Jira key found'
    },
    offline: 'Machine disconnected · history frozen. Your draft is kept until it reconnects.',
    readonly: 'Session followed through hooks · read-only.',
    thread: {
      label: (name: string) => `Conversation history with ${name}`,
      start: (time: string) => `Session started · ${time}`,
      partial: 'Partial history · only the last reply is known.',
      you: 'You',
      actions: (n: number) => `${n} ${plural(n, 'action', 'actions')} · Show details`,
      permission: (tool: string, accepted: boolean) => `${accepted ? 'Allowed' : 'Denied'} · ${tool}`,
      helper: (task: string, done: boolean) => `Helper · ${task}${done ? ' · done' : ''}`
    },
    request: {
      kinds: { permission: 'Approval request', question: 'Question', plan: 'Plan to approve', diff: 'Changes to approve' },
      deny: 'Deny',
      allow: 'Allow',
      orReply: 'Or give your answer in the field below.',
      sent: 'Sent…',
      failed: (msg: string) => `Not sent: ${msg}`
    },
    composer: {
      label: (name: string) => `Reply to ${name}`,
      placeholder: 'Write your message…',
      send: 'Send ↑',
      hint: 'Ctrl / ⌘ + Enter to send · Enter for a new line',
      sent: 'Sent…',
      failed: (msg: string) => `Message not sent: ${msg}`,
      blocked: {
        offline: 'Machine disconnected: cannot send.',
        readonly: 'Read-only session.',
        request: 'Answer the request above first.',
        options: 'Pick one of the options above.'
      }
    },
    actions: {
      label: 'Session actions',
      terminal: 'Open terminal',
      interrupt: 'Interrupt',
      kill: 'Stop',
      dismiss: 'Dismiss',
      rename: 'Rename',
      why: { offline: 'Machine disconnected', noTerminal: 'No terminal for this session', idle: 'Nothing to interrupt', unavailable: 'No terminal found on this machine' },
      confirmKill: (name: string) => `Stop ${name}? Its current work will be interrupted.`,
      confirm: 'Yes, stop',
      cancel: 'Cancel',
      renameLabel: 'Session subject',
      renameHint: 'Enter to save · Escape to cancel',
      save: 'Save',
      sent: 'Sent…',
      failed: (msg: string) => `Failed: ${msg}`
    },
    panel: {
      label: 'Conversation width',
      valueText: (n: number) => `Conversation: ${n}% of the width`,
      title: 'Drag to adjust the width · left and right arrows on the keyboard'
    }
  }
```

**3b. Mise en page** — `apps/desktop/src/conversation/layout.ts` :

```ts
import { useEffect, useState, type RefObject } from 'react';

export const NARROW_QUERY = '(max-width: 760px)';

/** The element's width, followed (0 until measured, and always 0 in jsdom). */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Under 760 px the conversation stacks under the sessions, without a handle (mockup split-view.js). */
export function useNarrow(): boolean {
  const query = () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
  const [narrow, setNarrow] = useState(query);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}
```

`apps/desktop/src/conversation/Resizer.tsx` :

```tsx
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clampPanel, panelBounds, stepPanel, type Bounds } from '../state/panel';
import { useI18n } from '../i18n/lang';

interface Drag { id: number; startX: number; startPct: number; width: number; el: HTMLElement }

/** The handle between sessions and conversation (mockup split-view.js): pointer with capture, ← → ±2 points, Home / End. */
export function Resizer({ value, bounds, bodyWidth, onChange }: { value: number; bounds: Bounds; bodyWidth: number; onChange: (pct: number) => void }) {
  const { t } = useI18n();
  const drag = useRef<Drag | null>(null);
  const finish = useCallback(() => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    document.documentElement.classList.remove('resizing-conversation');
    if (d.el.hasPointerCapture?.(d.id)) d.el.releasePointerCapture(d.id);
  }, []);
  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => { window.removeEventListener('blur', finish); finish(); };
  }, [finish]);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current || bodyWidth <= 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { id: e.pointerId, startX: e.clientX, startPct: value, width: bodyWidth, el: e.currentTarget };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.documentElement.classList.add('resizing-conversation');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || e.pointerId !== d.id) return;
    onChange(clampPanel(d.startPct + ((d.startX - e.clientX) / d.width) * 100, panelBounds(d.width)));
  };
  const onEnd = (e: PointerEvent<HTMLDivElement>) => { if (drag.current && e.pointerId === drag.current.id) finish(); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepPanel(value, e.key, bounds); if (next === null) return;
    e.preventDefault(); onChange(next);
  };
  const now = Math.round(value);
  return (
    <div className="conversation-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t.conversation.panel.label}
      aria-controls="conversation-pane" aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={now}
      aria-valuetext={t.conversation.panel.valueText(now)} title={t.conversation.panel.title}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onEnd} onPointerCancel={onEnd} onLostPointerCapture={onEnd} onKeyDown={onKeyDown}>
      <span aria-hidden="true" />
    </div>
  );
}
```

`apps/desktop/src/conversation/SplitView.tsx` :

```tsx
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { clampPanel, panelBounds, type PanelState } from '../state/panel';
import { useNarrow, useWidth } from './layout';
import { Resizer } from './Resizer';

/** The view body: the sessions, the handle and the conversation side by side (spec §9.1), stacked under 760 px. */
export function SplitView({ panel, onPanel, list, pane }: { panel: PanelState; onPanel: (fn: (p: PanelState) => PanelState) => void; list: ReactNode; pane: ReactNode | null }) {
  const body = useRef<HTMLDivElement>(null);
  const width = useWidth(body);
  const narrow = useNarrow();
  const bounds = panelBounds(width);
  const pct = clampPanel(panel.width, bounds);
  const expanded = !!pane && panel.expanded;
  const style = pane ? ({ '--conversation-width': `${pct}%` } as CSSProperties) : undefined;
  return (
    <div ref={body} className={expanded ? 'view-body conversation-expanded' : 'view-body'} style={style}>
      {list}
      {pane && !narrow && !expanded && <Resizer value={pct} bounds={bounds} bodyWidth={width} onChange={w => onPanel(p => (p.width === w ? p : { ...p, width: w }))} />}
      {pane}
    </div>
  );
}
```

`apps/desktop/src/conversation/ConversationPane.tsx` (squelette) :

```tsx
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** The selected session's conversation (mockup conversation.js). Never `data-session`: views count those. */
export function ConversationPane({ session, expanded, onExpand }: { session: Session; expanded: boolean; onExpand: (on: boolean) => void }) {
  const { t } = useI18n();
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={session.id} aria-label={t.conversation.label(session.name)}>
      <header className="conversation-header">
        <div className="conversation-top">
          <span>{t.conversation.eyebrow}</span>
          <button type="button" data-expand-conversation aria-expanded={expanded} onClick={() => onExpand(!expanded)}>{expanded ? t.conversation.collapse : t.conversation.expand}</button>
        </div>
        <h3>{session.topic || session.title}</h3>
      </header>
    </aside>
  );
}
```

**3c. Shell** — dans `apps/desktop/src/App.tsx`, ajouter les imports :

```ts
import { SplitView } from './conversation/SplitView';
import { ConversationPane } from './conversation/ConversationPane';
import { useStored } from './state/useStored';
import { loadPanel, savePanel } from './state/panel';
```

dans `Shell`, après le `useEffect` qui envoie `visible` :

```ts
  const [panel, setPanel] = useStored(loadPanel, savePanel);
  // The resident (`ledge`) gets its own panel in a later lot; a lost selection is replaced by the first visible session (lot 3 reducer).
  const selected = state.selected && state.selected !== 'ledge' ? sessions.find(s => s.id === state.selected) ?? null : null;
  // « Agrandir » folds back when the view or the attention filter changes (mockup conversation.js).
  const scope = `${state.view}|${state.attentionOnly}`;
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setPanel(p => (p.expanded ? { ...p, expanded: false } : p));
  }, [scope, setPanel]);
```

et remplacer le bloc `{sessions.length > 0 && <div className="view-body">…</div>}` par :

```tsx
        {sessions.length > 0 && <SplitView panel={panel} onPanel={setPanel}
          list={<>
            {state.view === 'room' && <RoomView sessions={visible} grouping={state.grouping} selected={state.selected} onSelect={id => dispatch({ type: 'select', id })} onGrouping={grouping => dispatch({ type: 'grouping', grouping })} />}
            {state.view === 'team' && <TeamView sessions={visible} selected={state.selected} onSelect={id => dispatch({ type: 'select', id })} attentionOnly={state.attentionOnly} />}
          </>}
          pane={selected ? <ConversationPane session={selected} expanded={panel.expanded} onExpand={on => setPanel(p => ({ ...p, expanded: on }))} /> : null} />}
```

**3d. CSS** — dans `apps/desktop/src/styles/app.css`, ligne 38, `.view-body` ne défile plus (seuls la liste et le fil défilent) :

```css
.view-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }
```

puis ajouter à la fin du fichier (port de `conversation.css` sans `.view-body { height: clamp(…); flex: none; }`, sans `.empty-sessions` déjà présent et sans `.room-central .table-groups`, plus les trois règles de `journeys.css`) :

```css
/* From the mockup's conversation.css: the conversation beside the sessions. The app fills the window: no framed height. */
.view-body > .central { overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--input) transparent; }
.view-body > .conversation { flex: 0 0 var(--conversation-width,38%); width: var(--conversation-width,38%); min-width: 0; padding: 0; overflow: hidden; border-left: 0; }
.conversation-resizer { flex: 0 0 8px; position: relative; cursor: col-resize; touch-action: none; outline: none; }
.conversation-resizer::before { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: var(--sidebar-border); }
.conversation-resizer > span { position: absolute; top: 50%; left: 2px; width: 3px; height: 30px; transform: translateY(-50%); border-radius: 3px; background: var(--muted-foreground); }
.conversation-resizer:hover::before, .conversation-resizer:focus-visible::before, .resizing-conversation .conversation-resizer::before { width: 3px; left: 2px; background: var(--sidebar-primary); }
.conversation-resizer:focus-visible { box-shadow: inset 0 0 0 1px var(--sidebar-primary); }
.resizing-conversation, .resizing-conversation * { cursor: col-resize !important; user-select: none !important; }
.view-body.conversation-expanded > .conversation-resizer { display: none; }
.view-body.conversation-expanded > .central { display: none; }
.view-body.conversation-expanded > .conversation { flex-basis: 100%; width: 100%; border-left: 0; }
.conversation-header { flex-shrink: 0; padding: 0 22px 12px; border-bottom: 1px solid var(--sidebar-border); }
.conversation-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; font-size: 9px; letter-spacing: .6px; color: var(--muted-foreground); }
.conversation-top button { background: transparent; padding: 7px 0 7px 10px; font-size: 11px; color: var(--sidebar-foreground); }
.conversation-header h3 { margin: 8px 0 12px; font-size: 19px; overflow-wrap: anywhere; }
.conversation-person { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11px; }
.conversation-person .avatar { width: 34px; height: 34px; border-radius: 9px; }
.conversation-person > span:not(.avatar):not(.state) { color: var(--muted-foreground); font-size: 10px; }
.conversation-person .state { margin-left: auto; font-size: 9px; }
.conversation-meta { margin-top: 10px; font-size: 10px; color: var(--muted-foreground); }
.conversation-meta summary, .thread-actions summary { cursor: pointer; padding: 4px 0; }
.conversation-meta .detail-meta { margin-top: 6px; font-size: 10px; max-height: 90px; overflow-y: auto; overflow-wrap: anywhere; }
.conversation-meta .branch { white-space: normal; overflow-wrap: anywhere; font-size: 10px; }
.thread-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--input) transparent; }
.thread-content { max-width: 780px; margin: auto; padding: 18px 22px 24px; }
.thread-start { text-align: center; color: var(--muted-foreground); font-size: 9px; margin: 0 0 22px; }
.thread-message { margin: 0 0 22px; font-size: 13px; line-height: 1.75; overflow-wrap: anywhere; }
.thread-message p { white-space: pre-wrap; margin: 6px 0 0; }
.message-author { font-size: 10px; font-weight: 600; color: var(--muted-foreground); }
.thread-message.user { margin-left: 24px; padding: 11px 14px; background: var(--well); border: 1px solid var(--sidebar-border); border-radius: 9px; }
.thread-actions { padding: 8px 0; margin-bottom: 18px; color: var(--muted-foreground); font-size: 11px; border-top: 1px solid var(--sidebar-border); border-bottom: 1px solid var(--sidebar-border); }
.thread-actions ul { margin: 8px 0 4px; padding-left: 20px; line-height: 1.9; }
.thread-request { --request-tone: var(--warning); border-left: 2px solid var(--request-tone); padding: 12px 15px; margin: 0 0 20px; background: var(--well); border-radius: 0 7px 7px 0; font-size: 12px; line-height: 1.65; }
.thread-request.waiting_permission { --request-tone: var(--danger-text); }
.thread-request > strong { color: var(--request-tone); font-size: 11px; }
.thread-request code { display: block; padding: 10px; border-radius: 5px; background: var(--sidebar-accent); font: 11px/1.7 Consolas,monospace; overflow-wrap: anywhere; white-space: pre-wrap; }
.thread-request .request-actions button { font-size: 11px; padding: 9px; }
.thread-request small { display: block; margin-top: 10px; color: var(--muted-foreground); font-size: 10px; }
.request-resolution, .thread-notice { font-size: 10px; color: var(--muted-foreground); }
.thread-notice { margin: -9px 0 22px; line-height: 1.6; }
.conversation-composer { flex-shrink: 0; margin: 0; padding: 14px 22px 16px; border-top: 1px solid var(--sidebar-border); background: var(--notch); }
.conversation-composer label { display: block; font-size: 11px; margin-bottom: 8px; font-weight: 500; }
.conversation-composer textarea { display: block; box-sizing: border-box; width: 100%; min-height: 76px; max-height: 140px; resize: vertical; border: 1px solid var(--input); border-radius: 7px; padding: 11px 12px; font-family: inherit; font-size: 12px; line-height: 1.65; color: var(--sidebar-foreground); background: var(--well); }
.conversation-composer textarea::placeholder { color: var(--muted-foreground); }
.conversation-composer textarea:focus-visible, .thread-scroll:focus-visible, .conversation summary:focus-visible { outline: 2px solid var(--sidebar-primary); outline-offset: 2px; }
.composer-bottom { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
.composer-bottom small { font-size: 9px; color: var(--muted-foreground); }
.composer-bottom button { margin-left: auto; }
.composer-bottom button:disabled { opacity: .4; cursor: default; }
/* From the mockup's journeys.css: a conversation whose machine is disconnected. */
.conversation-offline { padding: 9px 22px; font-size: 10px; line-height: 1.6; color: var(--warning); background: var(--well); border-bottom: 1px solid var(--sidebar-border); }
.conversation-composer textarea:disabled { opacity: .65; cursor: not-allowed; }
.request-actions button:disabled { opacity: .45; cursor: not-allowed; }
@media(max-width:760px) {
  .conversation-resizer { display: none; }
  .view-body { flex-direction: column; overflow-y: auto; }
  .view-body > .central { max-height: 340px; flex: none; }
  .view-body > .conversation { flex: none; width: 100%; height: 640px; max-height: 90vh; min-height: 480px; border-left: 0; border-top: 1px solid var(--sidebar-border); }
  .view-body.conversation-expanded > .conversation { flex-basis: auto; }
  .conversation-header, .conversation-composer { padding-left: 16px; padding-right: 16px; }
  .thread-content { padding-left: 16px; padding-right: 16px; }
}
```

Sous 760 px seul `.view-body` défile (la page reste à la hauteur de la fenêtre, `e2e/layout.spec.ts` et la dernière spec ci-dessus le vérifient).

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm -r typecheck && pnpm --filter desktop exec playwright test` (toutes les specs, `layout.spec.ts` compris : la page ne défile toujours pas).

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): resizable conversation panel beside the sessions"`

---

### Task 6: Hooks d'envoi, brouillons et demande de fil

**Files:**
- Create: `apps/desktop/src/conversation/useConversations.ts`, `apps/desktop/src/conversation/useThreadRequest.ts`
- Modify: `apps/desktop/src/App.tsx` (Shell)
- Test: `apps/desktop/test/use-conversations.test.tsx`

**Interfaces:**
- Consumes: `reduceSends`, `NO_SENDS`, `SendsState`, `SendsAction`, `blocked`, `replyBlock` (tâche 4) ; `useStored`, `loadDrafts`, `saveDrafts`, `setDraft`, `loadThreadPrefs`, `saveThreadPrefs`, `setThreadPref`, `NO_PREF`, `ThreadPref`, `pruneGone` (tâche 3) ; `useDaemon(): DaemonState` (`lastError`, `threads`, `snapshotSeq`) et `daemonStore` de `@ledge/fleet` ; `DaemonClient.send(msg: ClientMessage): void`.
- Produces :
  - `useConversations(client: DaemonClient, sessions: readonly Session[], machines: readonly MachineState[], ready: boolean): Conversations` avec

    ```ts
    export type SessionCommand = 'interrupt' | 'kill' | 'dismiss';
    export interface Conversations {
      sends: SendsState;
      decide(s: Session, decision: 'accept' | 'deny'): void;
      answer(s: Session, option: number): void;          // 0-based index, sent as String(option + 1)
      reply(s: Session, text: string): boolean;           // true when sent (the draft is cleared)
      command(s: Session, kind: SessionCommand): void;
      rename(s: Session, topic: string): void;
      forget(id: string): void;
      draft(id: string): string;
      setDraft(id: string, text: string): void;
      pref(id: string): ThreadPref;
      setPref(id: string, patch: Partial<ThreadPref>): void;
    }
    ```
  - `useThreadRequest(client: DaemonClient, session: Session): ThreadItem[] | undefined` : les éléments du fil s'ils sont chargés ; sinon envoie `session.thread` une fois par `id#snapshotSeq`, jamais pour une session figée.
  - Dans `Shell` : `const conversations = useConversations(fleetClient, sessions, machines, ready);` où `fleetClient` est le `client` rendu par `useFleet` (renommé à la déstructuration : `const { sessions, machines, fleet, localDown, client: fleetClient } = useFleet(client);`).

- [ ] **Step 1: Test** — `apps/desktop/test/use-conversations.test.tsx` :

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { useConversations } from '../src/conversation/useConversations';
import { useThreadRequest } from '../src/conversation/useThreadRequest';

const machine = (id: string, ready: boolean, status: MachineState['status'] = ready ? 'open' : 'connecting') =>
  ({ id, label: id, status, ready, recents: [], sessions: [], launcher: null }) as MachineState;
const local = [machine('local', true)];
const otto = fakeSession('local:otto', { state: 'waiting_permission', pending: { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' } });
const bix = fakeSession('local:bix', { state: 'idle' });
let send: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => {
  localStorage.clear(); daemonStore.reset();
  send = vi.fn(); client = { send } as unknown as DaemonClient;
});
const mount = (sessions: Session[], machines = local, ready = true) =>
  renderHook(p => useConversations(client, p.sessions, p.machines, p.ready), { initialProps: { sessions, machines, ready } });

describe('useConversations: decisions', () => {
  it('a double click sends one decision; an error reopens it and a retry goes out (Review Focus 4)', () => {
    const { result } = mount([otto]);
    act(() => { result.current.decide(otto, 'accept'); result.current.decide(otto, 'accept'); result.current.answer(otto, 0); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'accept' });
    expect(result.current.sends.sent['local:otto']?.kind).toBe('decision');
    act(() => daemonStore.apply({ type: 'error', id: 'local:nova', message: 'Unknown session' }));
    expect(result.current.sends.failed['local:otto']).toBeUndefined();
    act(() => daemonStore.apply({ type: 'error', id: 'local:otto', message: 'Request expired' }));
    expect(result.current.sends.failed['local:otto']?.message).toBe('Request expired');
    act(() => result.current.decide(otto, 'accept'));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('stays « sent » while the same request waits, clears when it changes', () => {
    const r = mount([otto]);
    act(() => r.result.current.decide(otto, 'deny'));
    r.rerender({ sessions: [{ ...otto, lastActivityAt: '2026-10-09T18:03:00.000Z' }], machines: local, ready: true });
    expect(r.result.current.sends.sent['local:otto']).toBeDefined();
    r.rerender({ sessions: [{ ...otto, state: 'working', pending: undefined }], machines: local, ready: true });
    expect(r.result.current.sends.sent['local:otto']).toBeUndefined();
  });
  it('an option goes out as its 1-based number', () => {
    const q = fakeSession('local:luna', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', options: ['A', 'B'], source: 'pane' } });
    const { result } = mount([q]);
    act(() => result.current.answer(q, 1));
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:luna', text: '2' });
  });
});

describe('useConversations: replies and commands', () => {
  it('a reply is sent as text, never as a command; the draft is cleared, and restored after an error', () => {
    const { result } = mount([bix]);
    act(() => result.current.setDraft('local:bix', '  /kill everything  '));
    let ok = false;
    act(() => { ok = result.current.reply(bix, result.current.draft('local:bix')); });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:bix', text: '/kill everything' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.draft('local:bix')).toBe('');
    act(() => daemonStore.apply({ type: 'error', id: 'local:bix', message: 'tmux is gone' }));
    expect(result.current.draft('local:bix')).toBe('/kill everything');
    expect(result.current.sends.failed['local:bix']?.message).toBe('tmux is gone');
    act(() => result.current.setDraft('local:bix', '/kill everything!'));
    expect(result.current.sends.failed['local:bix']).toBeUndefined();
  });
  it('a reply is refused while a permission waits, or when empty', () => {
    const { result } = mount([otto, bix]);
    act(() => { result.current.reply(otto, 'oui'); result.current.reply(bix, '   '); });
    expect(send).not.toHaveBeenCalled();
  });
  it('commands and rename go out once; rename trims to 500 characters', () => {
    const { result } = mount([bix]);
    act(() => { result.current.command(bix, 'kill'); result.current.command(bix, 'kill'); });
    act(() => result.current.rename(bix, `  ${'x'.repeat(600)}  `));
    expect(send.mock.calls.map(c => c[0])).toEqual([
      { type: 'session.kill', id: 'local:bix' },
      { type: 'session.rename', id: 'local:bix', topic: 'x'.repeat(500) }
    ]);
  });
  it('a frozen session sends nothing at all (spec §14)', () => {
    const frozen = { ...otto, offline: true };
    const { result } = mount([frozen]);
    act(() => {
      result.current.decide(frozen, 'accept'); result.current.answer(frozen, 0); result.current.reply(frozen, 'hello');
      result.current.command(frozen, 'interrupt'); result.current.rename(frozen, 'New');
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('useConversations: drafts and thread preferences', () => {
  it('one draft per qualified id, persisted', () => {
    const { result } = mount([bix]);
    act(() => { result.current.setDraft('local:otto', 'Ici'); result.current.setDraft('devbox:otto', 'Là-bas'); });
    expect(result.current.draft('local:otto')).toBe('Ici');
    expect(result.current.draft('devbox:otto')).toBe('Là-bas');
    expect(JSON.parse(localStorage.getItem('desktop.drafts')!)).toEqual({ 'local:otto': 'Ici', 'devbox:otto': 'Là-bas' });
  });
  it('prunes drafts and preferences of removed sessions only once ready, and keeps unreachable machines and ledge (Review Focus 3)', () => {
    localStorage.setItem('desktop.drafts', JSON.stringify({ 'local:bix': 'a', 'local:gone': 'b', 'devbox:nova': 'c', ledge: 'd' }));
    localStorage.setItem('desktop.thread', JSON.stringify({ 'local:gone': { open: ['metadata'], scroll: 3 }, 'devbox:nova': { open: [], scroll: 9 } }));
    const machines = [machine('local', true), machine('devbox', false, 'unreachable')];
    const r = mount([bix], machines, false);
    expect(r.result.current.draft('local:gone')).toBe('b');
    r.rerender({ sessions: [bix], machines, ready: true });
    expect(JSON.parse(localStorage.getItem('desktop.drafts')!)).toEqual({ 'local:bix': 'a', 'devbox:nova': 'c', ledge: 'd' });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)).toEqual({ 'devbox:nova': { open: [], scroll: 9 } });
  });
  it('folds and reading position per qualified id', () => {
    const { result } = mount([bix]);
    act(() => { result.current.setPref('local:bix', { open: ['metadata'] }); result.current.setPref('local:bix', { scroll: 120 }); });
    expect(result.current.pref('local:bix')).toEqual({ open: ['metadata'], scroll: 120 });
    expect(result.current.pref('local:otto')).toEqual({ open: [], scroll: null });
  });
});

describe('useThreadRequest', () => {
  const at = '2026-10-13T10:00:00.000Z';
  it('asks once per snapshot until the thread is loaded', () => {
    act(() => daemonStore.apply({ type: 'snapshot', sessions: [bix] }));
    const r = renderHook(() => useThreadRequest(client, bix));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'session.thread', id: 'local:bix' });
    r.rerender();
    expect(send).toHaveBeenCalledTimes(1);
    act(() => daemonStore.apply({ type: 'snapshot', sessions: [bix] }));
    expect(send).toHaveBeenCalledTimes(2);
    act(() => daemonStore.apply({ type: 'session.thread', id: 'local:bix', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Go' }] }));
    expect(r.result.current?.map(i => i.id)).toEqual(['p1']);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('never asks for a frozen session, and returns its kept thread (R10)', () => {
    const frozen = { ...bix, offline: true };
    act(() => {
      daemonStore.apply({ type: 'snapshot', sessions: [bix] });
      daemonStore.apply({ type: 'session.thread', id: 'local:bix', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Go' }] });
      daemonStore.apply({ type: 'snapshot', sessions: [frozen] });
    });
    const r = renderHook(() => useThreadRequest(client, frozen));
    expect(r.result.current?.map(i => i.id)).toEqual(['p1']);
    act(() => daemonStore.apply({ type: 'snapshot', sessions: [{ ...frozen, id: 'local:x' }] }));
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test use-conversations` → « Failed to resolve import "../src/conversation/useConversations" ».

- [ ] **Step 3: Implémenter**

`apps/desktop/src/conversation/useConversations.ts` :

```ts
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ClientMessage, Session } from '@ledge/protocol';
import { daemonStore, useDaemon, type DaemonClient, type MachineState } from '@ledge/fleet';
import { NO_SENDS, blocked, reduceSends, replyBlock, type SendKind, type SendsAction, type SendsState } from './sends';
import { useStored } from '../state/useStored';
import { loadDrafts, saveDrafts, setDraft } from '../state/drafts';
import { NO_PREF, loadThreadPrefs, saveThreadPrefs, setThreadPref, type ThreadPref } from '../state/threadPrefs';
import { pruneGone } from '../state/prune';

export type SessionCommand = 'interrupt' | 'kill' | 'dismiss';
export interface Conversations {
  sends: SendsState;
  decide(s: Session, decision: 'accept' | 'deny'): void;
  answer(s: Session, option: number): void;
  reply(s: Session, text: string): boolean;
  command(s: Session, kind: SessionCommand): void;
  rename(s: Session, topic: string): void;
  forget(id: string): void;
  draft(id: string): string;
  setDraft(id: string, text: string): void;
  pref(id: string): ThreadPref;
  setPref(id: string, patch: Partial<ThreadPref>): void;
}
const TOPIC_MAX = 500;
const errorSeq = () => daemonStore.getState().lastError?.seq ?? 0;

/** Everything the conversation sends (spec §9.1), with the drafts and thread preferences it keeps (spec §7). Every path checks
 *  `offline` (spec §14); free text is never read as a command. */
export function useConversations(client: DaemonClient, sessions: readonly Session[], machines: readonly MachineState[], ready: boolean): Conversations {
  const { lastError } = useDaemon();
  const [sends, dispatch] = useReducer(reduceSends, NO_SENDS);
  // A synchronous mirror of `sends`: two clicks in the same frame see the first send before React renders again.
  const live = useRef<SendsState>(NO_SENDS);
  const apply = useCallback((a: SendsAction) => { live.current = reduceSends(live.current, a); dispatch(a); }, []);
  const [drafts, setDrafts] = useStored(loadDrafts, saveDrafts);
  const [prefs, setPrefs] = useStored(loadThreadPrefs, saveThreadPrefs);

  useEffect(() => { apply({ type: 'sessions', sessions }); }, [sessions, apply]);
  useEffect(() => { if (lastError) apply({ type: 'error', error: lastError }); }, [lastError, apply]);
  // A message that failed comes back into an empty composer, so nothing typed is lost.
  useEffect(() => {
    for (const [id, f] of Object.entries(sends.failed)) {
      const text = f.kind === 'reply' ? f.text : undefined;
      if (text) setDrafts(d => (d[id] ? d : setDraft(d, id, text)));
    }
  }, [sends.failed, setDrafts]);
  useEffect(() => {
    if (!ready) return;
    setDrafts(d => pruneGone(d, sessions, machines));
    setPrefs(p => pruneGone(p, sessions, machines));
  }, [ready, sessions, machines, setDrafts, setPrefs]);

  const inFlight = (s: Session) => live.current.sent[s.id];
  const canDecide = (s: Session) => !blocked(s) && !!s.pending && inFlight(s)?.kind !== 'decision';
  const out = (s: Session, msg: ClientMessage, kind: SendKind, text?: string) => {
    client.send(msg);
    apply({ type: 'sent', session: s, kind, ...(text !== undefined ? { text } : {}), errorSeq: errorSeq() });
  };
  return {
    sends,
    decide(s, decision) { if (canDecide(s)) out(s, { type: 'session.decide', id: s.id, decision }, 'decision'); },
    answer(s, option) {
      if (!canDecide(s) || s.pending?.kind !== 'question' || !Number.isInteger(option) || option < 0) return;
      out(s, { type: 'session.reply', id: s.id, text: String(option + 1) }, 'decision');
    },
    reply(s, text) {
      const body = text.trim();
      const cur = inFlight(s);
      if (!body || replyBlock(s) || (cur?.kind === 'reply' && cur.text === body)) return false;
      out(s, { type: 'session.reply', id: s.id, text: body }, 'reply', body);
      setDrafts(d => setDraft(d, s.id, ''));
      return true;
    },
    command(s, kind) {
      if (s.offline || inFlight(s)?.kind === kind) return;
      const msg: ClientMessage = kind === 'interrupt' ? { type: 'session.interrupt', id: s.id } : kind === 'kill' ? { type: 'session.kill', id: s.id } : { type: 'session.dismiss', id: s.id };
      out(s, msg, kind);
    },
    rename(s, topic) {
      const next = topic.trim().slice(0, TOPIC_MAX);
      if (s.offline || next === (s.topic ?? '')) return;
      out(s, { type: 'session.rename', id: s.id, topic: next }, 'rename');
    },
    forget(id) { apply({ type: 'forget', id }); },
    draft(id) { return drafts[id] ?? ''; },
    setDraft(id, text) {
      setDrafts(d => setDraft(d, id, text));
      if (live.current.failed[id]?.kind === 'reply') apply({ type: 'forget', id });
    },
    pref(id) { return prefs[id] ?? NO_PREF; },
    setPref(id, patch) { setPrefs(p => setThreadPref(p, id, patch)); }
  };
}
```

`apps/desktop/src/conversation/useThreadRequest.ts` :

```ts
import { useEffect, useRef } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { useDaemon, type DaemonClient } from '@ledge/fleet';

/** The session's thread (spec §9.1: the full thread from `session.thread`, then live `session.thread.item`). Asked once per
 *  snapshot while not loaded (a snapshot empties the live threads); a frozen session cannot be asked and keeps what it had (R10). */
export function useThreadRequest(client: DaemonClient, session: Session): ThreadItem[] | undefined {
  const { threads, snapshotSeq } = useDaemon();
  const items = threads.get(session.id);
  const loaded = items !== undefined;
  const asked = useRef(new Set<string>());
  const key = `${session.id}#${snapshotSeq}`;
  useEffect(() => {
    if (loaded || session.offline || asked.current.has(key)) return;
    asked.current.add(key);
    client.send({ type: 'session.thread', id: session.id });
  }, [client, key, loaded, session.id, session.offline]);
  return items;
}
```

Dans `apps/desktop/src/App.tsx` : importer `useConversations`, déstructurer `client: fleetClient` depuis `useFleet(client)`, et ajouter après `useStored(loadPanel, savePanel)` :

```ts
  const conversations = useConversations(fleetClient, sessions, machines, ready);
```

(`conversations` est passé au panneau à la tâche 7.)

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm -r typecheck`

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): conversation sends, drafts and thread requests"`

---

### Task 7: Tête de conversation et actions de session

**Files:**
- Create: `apps/desktop/src/conversation/Header.tsx`, `apps/desktop/src/conversation/terminal.ts`
- Modify: `apps/desktop/src/conversation/ConversationPane.tsx` (la tête remplace le squelette), `apps/desktop/src/App.tsx` (props `client` et `api` du panneau), `apps/desktop/src/styles/app.css` (actions, confirmation, renommage, note)
- Test: `apps/desktop/test/header.test.tsx`

**Interfaces:**
- Consumes: `Conversations`, `SessionCommand` (tâche 6) ; `SESSION_ACTIONS`, `sessionActions`, `SessionAction` (tâche 4) ; `toggled` (tâche 3) ; `story(s): Story` (`src/grouping/story.ts`, lot 3 : `{ key: string | null; keys: string[]; ambiguous: boolean; source: 'branch' | 'topic' | null }`) ; `Avatar({ session, size })`, `StateBadge({ session })`, `TOOL_NAMES` (`src/shell/Person.tsx`) ; `focusTerminal(title: string): Promise<boolean>`, `openTerminal(title: string, command: string[]): Promise<boolean>` (`src/tauri/bridge.ts`) ; `client.fleet?.terminal(id: string): string[] | null` ; bloc `t.conversation` (tâche 5).
- Produces :
  - `terminal.ts` : `openSessionTerminal(client: DaemonClient, s: Session): Promise<boolean>` — `false` pour une session figée ou quand aucun terminal n'a pu être trouvé ni ouvert.
  - `Header.tsx` : `interface ConversationProps { session: Session; client: DaemonClient; api: Conversations; expanded: boolean; onExpand: (on: boolean) => void }` ; `ConversationHeader(p: ConversationProps)`.
  - `ConversationPane.tsx` : `ConversationPane(p: ConversationProps)` (nouvelle signature, gardée par les tâches 8 et 9).

Comportement (spec §9.1, maquette `conversation.js` `render`, île `Surface.tsx` `openTab` / `focusTab`) :
- Tête : `div.conversation-top` (sur-titre + « Agrandir »), `h3` = `topic || title`, `div.conversation-person` (avatar 28, nom en `strong`, `« Claude Code · <machine> »` avec `machineName` ou « Cette machine », pastille d'état), `details.conversation-meta[data-fold="metadata"]` replié par défaut, son état dans `desktop.thread` (`open` contient `'metadata'`). Les métadonnées : `projet · durée` (de `startedAt` à `exitedAt` ou maintenant), `⑂ branche` si connue, puis la clé Jira détectée (texte seulement, spec §8).
- Actions : une rangée `div.conversation-actions[role=group]` de `button.settings-button[data-action]` dans l'ordre `SESSION_ACTIONS`, seulement celles `shown` ; une action non disponible est `disabled` avec sa raison en `title`. Une commande en vol (`sends.sent[id].kind` égal à l'action) désactive son bouton.
- « Ouvrir le terminal » (m5) : envoie `session.focus` puis, pour une session distante, ouvre un onglet titré `« <machine> · <titre> »` avec `fleet.terminal(id)` si la session a un tmux ; pour une session locale, cherche d'abord la fenêtre par titre, sinon ouvre un onglet. Échec → note « Terminal introuvable sur cette machine ».
- « Arrêter » demande une confirmation en ligne (`div.conversation-confirm`) ; « Renommer » remplace le titre par un champ (Entrée enregistre, Échap annule, 500 caractères au plus).
- Note `p.conversation-note[role=status]` : « Envoyé… » pendant une commande en vol, « Échec : … » après une erreur, ou le terminal introuvable. Jamais `role="alert"`.
- La tête est montée par session (`key={session.id}`) : confirmation, renommage et note ne passent pas d'une session à l'autre.

- [ ] **Step 1: Test** — `apps/desktop/test/header.test.tsx` :

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMemo } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { ConversationHeader } from '../src/conversation/Header';
import { useConversations } from '../src/conversation/useConversations';

const bridge = vi.hoisted(() => ({
  focusTerminal: vi.fn(async (_title: string) => false),
  openTerminal: vi.fn(async (_title: string, _command: string[]) => true)
}));
vi.mock('../src/tauri/bridge', () => bridge);

const local = [{ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const command = ['tmux', 'attach', '-t', 'ledge-nova'];
let send: ReturnType<typeof vi.fn>;
let terminal: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => {
  localStorage.clear(); daemonStore.reset();
  bridge.focusTerminal.mockReset().mockResolvedValue(false);
  bridge.openTerminal.mockReset().mockResolvedValue(true);
  send = vi.fn(); terminal = vi.fn(() => command);
  client = { send, fleet: { terminal } } as unknown as DaemonClient;
});

function Harness({ session }: { session: Session }) {
  const sessions = useMemo(() => [session], [session]);
  const api = useConversations(client, sessions, local, true);
  return <ConversationHeader session={session} client={client} api={api} expanded={false} onExpand={() => {}} />;
}
const button = (name: string) => screen.getByRole('button', { name });

describe('ConversationHeader', () => {
  it('shows the subject, the agent, its machine and state, and folded session details kept per session', () => {
    const done = fakeSession('local:bix', { name: 'Bix', state: 'exited', topic: 'LEDGE-42 · Documenter le protocole', project: 'ledge', branch: 'docs/protocol', startedAt: '2026-10-09T18:00:00.000Z', exitedAt: '2026-10-09T19:05:00.000Z' });
    const { container } = render(<Harness session={done} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('LEDGE-42 · Documenter le protocole');
    expect(screen.getByText('Claude Code · This machine')).toBeInTheDocument();
    expect(container.querySelector('.conversation-person .state')).toHaveTextContent('Finished');
    const details = container.querySelector('details.conversation-meta') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const meta = details.querySelector('.detail-meta')!;
    expect(meta).toHaveTextContent('ledge · 1 h 05');
    expect(meta).toHaveTextContent('⑂ docs/protocol');
    expect(meta).toHaveTextContent('LEDGE-42 · found in the subject');
    act(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)).toEqual({ 'local:bix': { open: ['metadata'], scroll: null } });
  });
  it('shows the remote machine and an ambiguous Jira story', () => {
    const nova = fakeSession('devbox:nova', { name: 'Nova', machineId: 'devbox', machineName: 'Devbox', branch: 'fix/LEDGE-42-and-LEDGE-43' });
    const { container } = render(<Harness session={nova} />);
    expect(screen.getByText('Claude Code · Devbox')).toBeInTheDocument();
    expect(container.querySelector('.detail-meta')).toHaveTextContent('To clarify: LEDGE-42, LEDGE-43');
  });
  it('opens a local terminal by title first, then in a new tab, and tells the session it is focused (m5)', async () => {
    render(<Harness session={fakeSession('local:nova', { name: 'Nova', title: 'Nova · ledge' })} />);
    fireEvent.click(button('Open terminal'));
    await waitFor(() => expect(bridge.openTerminal).toHaveBeenCalledWith('Nova · ledge', command));
    expect(bridge.focusTerminal).toHaveBeenCalledWith('Nova · ledge');
    expect(send).toHaveBeenCalledWith({ type: 'session.focus', id: 'local:nova' });
    expect(terminal).toHaveBeenCalledWith('local:nova');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('opens a remote terminal titled with its machine, without looking for a local window', async () => {
    render(<Harness session={fakeSession('devbox:nova', { name: 'Nova', title: 'Nova · ledge', machineId: 'devbox', machineName: 'Devbox' })} />);
    fireEvent.click(button('Open terminal'));
    await waitFor(() => expect(bridge.openTerminal).toHaveBeenCalledWith('Devbox · Nova · ledge', command));
    expect(bridge.focusTerminal).not.toHaveBeenCalled();
  });
  it('says when no terminal could be opened', async () => {
    bridge.openTerminal.mockResolvedValue(false);
    render(<Harness session={fakeSession('local:nova')} />);
    fireEvent.click(button('Open terminal'));
    expect(await screen.findByRole('status')).toHaveTextContent('No terminal found on this machine');
  });
  it('Stop asks first: Cancel sends nothing, « Yes, stop » sends once', () => {
    render(<Harness session={fakeSession('local:nova', { name: 'Nova', state: 'working' })} />);
    fireEvent.click(button('Stop'));
    expect(screen.getByText('Stop Nova? Its current work will be interrupted.')).toBeInTheDocument();
    fireEvent.click(button('Cancel'));
    expect(screen.queryByText(/current work/)).toBeNull();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(button('Stop'));
    fireEvent.click(button('Yes, stop'));
    expect(send).toHaveBeenCalledWith({ type: 'session.kill', id: 'local:nova' });
    expect(screen.getByRole('status')).toHaveTextContent('Sent…');
    expect(button('Stop')).toBeDisabled();
  });
  it('a command error shows its message', () => {
    render(<Harness session={fakeSession('local:nova', { state: 'working' })} />);
    fireEvent.click(button('Interrupt'));
    expect(send).toHaveBeenCalledWith({ type: 'session.interrupt', id: 'local:nova' });
    act(() => daemonStore.apply({ type: 'error', id: 'local:nova', message: 'No tmux session' }));
    expect(screen.getByRole('status')).toHaveTextContent('Failed: No tmux session');
    expect(button('Interrupt')).toBeEnabled();
  });
  it('Interrupt only when busy; Dismiss only for finished or hook-only sessions', () => {
    const { rerender } = render(<Harness session={fakeSession('local:bix', { state: 'idle' })} />);
    expect(button('Interrupt')).toBeDisabled();
    expect(button('Interrupt')).toHaveAttribute('title', 'Nothing to interrupt');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    rerender(<Harness session={fakeSession('local:bix', { state: 'exited' })} />);
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(button('Dismiss'));
    expect(send).toHaveBeenCalledWith({ type: 'session.dismiss', id: 'local:bix' });
    rerender(<Harness session={fakeSession('local:hook', { state: 'working', source: 'hook_only' })} />);
    expect(button('Dismiss')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
  it('Rename edits the subject inline: Enter saves, Escape cancels', () => {
    const bix = fakeSession('local:bix', { state: 'idle', topic: 'Old subject' });
    render(<Harness session={bix} />);
    fireEvent.click(button('Rename'));
    const input = screen.getByRole('textbox', { name: 'Session subject' });
    expect(input).toHaveValue('Old subject');
    expect(input).toHaveAttribute('maxlength', '500');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(button('Rename'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Session subject' }), { target: { value: '  New subject ' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Session subject' }).closest('form')!);
    expect(send).toHaveBeenCalledWith({ type: 'session.rename', id: 'local:bix', topic: 'New subject' });
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Old subject');
  });
  it('a frozen session keeps its header but every action is disabled (spec §14)', () => {
    render(<Harness session={fakeSession('devbox:nova', { state: 'working', machineId: 'devbox', machineName: 'Devbox', offline: true })} />);
    for (const name of ['Open terminal', 'Interrupt', 'Stop', 'Rename']) {
      expect(button(name)).toBeDisabled();
      expect(button(name)).toHaveAttribute('title', 'Machine disconnected');
    }
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    fireEvent.click(button('Stop'));
    expect(send).not.toHaveBeenCalled();
    expect(bridge.openTerminal).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test header` → « Failed to resolve import "../src/conversation/Header" ».

- [ ] **Step 3: Implémenter**

`apps/desktop/src/conversation/terminal.ts` :

```ts
import type { Session } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { focusTerminal, openTerminal } from '../tauri/bridge';

/** « Ouvrir le terminal » (spec §9.1, island Surface `focusTab` / `openTab`): the session hears it is focused; a remote session
 *  opens a tab titled with its machine running the fleet's command; a local one is first looked for by title, then opened.
 *  False when nothing could be shown (and always for a frozen session, spec §14). */
export async function openSessionTerminal(client: DaemonClient, s: Session): Promise<boolean> {
  if (s.offline) return false;
  client.send({ type: 'session.focus', id: s.id });
  const command = client.fleet?.terminal(s.id) ?? null;
  const canOpen = !!command && !!s.tmuxSession;
  if (s.machineId && s.machineId !== 'local') return canOpen ? openTerminal(`${s.machineName ?? s.machineId} · ${s.title}`, command!) : false;
  if (await focusTerminal(s.title)) return true;
  return canOpen ? openTerminal(s.title, command!) : false;
}
```

`apps/desktop/src/conversation/Header.tsx` :

```tsx
import { useState, type SyntheticEvent } from 'react';
import type { Session } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { Avatar, StateBadge, TOOL_NAMES } from '../shell/Person';
import { story } from '../grouping/story';
import { toggled } from '../state/threadPrefs';
import { SESSION_ACTIONS, sessionActions, type SessionAction } from './actions';
import { openSessionTerminal } from './terminal';
import type { Conversations } from './useConversations';

export interface ConversationProps { session: Session; client: DaemonClient; api: Conversations; expanded: boolean; onExpand: (on: boolean) => void }

const TOPIC_MAX = 500;
const COMMANDS: ReadonlySet<string> = new Set(['interrupt', 'kill', 'dismiss', 'rename']);
const minutes = (s: Session): number =>
  Math.max(0, Math.round(((s.exitedAt ? Date.parse(s.exitedAt) : Date.now()) - Date.parse(s.startedAt)) / 60_000));

/** The conversation's head (mockup conversation.js `render`): subject, agent, machine, state, folded session details, then
 *  the session actions of spec §9.1. Mounted per session (`key`), so a confirmation or a rename never follows another one. */
export function ConversationHeader({ session: s, client, api, expanded, onExpand }: ConversationProps) {
  const { t } = useI18n();
  const c = t.conversation;
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const actions = sessionActions(s, client.fleet?.terminal(s.id) ?? null);
  const open = api.pref(s.id).open;
  const jira = story(s);
  const jiraText = jira.key && jira.source ? c.meta.jira(jira.key, jira.source) : jira.ambiguous ? c.meta.ambiguous(jira.keys) : c.meta.noJira;
  const sent = api.sends.sent[s.id];
  const failed = api.sends.failed[s.id];
  const note = missing ? c.actions.why.unavailable
    : sent && COMMANDS.has(sent.kind) ? c.actions.sent
    : failed && COMMANDS.has(failed.kind) ? c.actions.failed(failed.message)
    : null;

  const run = (a: SessionAction) => {
    setMissing(false);
    if (a === 'terminal') { void openSessionTerminal(client, s).then(ok => setMissing(!ok)); return; }
    if (a === 'kill') { setConfirming(true); return; }
    if (a === 'rename') { setRenaming(s.topic ?? ''); return; }
    api.command(s, a);
  };
  const onMeta = (e: SyntheticEvent<HTMLDetailsElement>) => api.setPref(s.id, { open: toggled(open, 'metadata', e.currentTarget.open) });

  return (
    <header className="conversation-header">
      <div className="conversation-top">
        <span>{c.eyebrow}</span>
        <button type="button" data-expand-conversation aria-expanded={expanded} onClick={() => onExpand(!expanded)}>{expanded ? c.collapse : c.expand}</button>
      </div>
      {renaming === null
        ? <h3>{s.topic || s.title}</h3>
        : <form className="conversation-rename" onSubmit={e => { e.preventDefault(); api.rename(s, renaming); setRenaming(null); }}>
            <input aria-label={c.actions.renameLabel} aria-describedby="rename-hint" value={renaming} maxLength={TOPIC_MAX} autoFocus
              onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); } }} />
            <div className="conversation-rename-bottom">
              <small id="rename-hint">{c.actions.renameHint}</small>
              <button type="submit" className="settings-button">{c.actions.save}</button>
            </div>
          </form>}
      <div className="conversation-person">
        <Avatar session={s} size={28} />
        <strong>{s.name}</strong>
        <span>{TOOL_NAMES[s.tool]} · {s.machineName ?? c.local}</span>
        <StateBadge session={s} />
      </div>
      <details className="conversation-meta" data-fold="metadata" open={open.includes('metadata')} onToggle={onMeta}>
        <summary>{c.meta.summary}</summary>
        <div className="detail-meta">
          {s.project} · {c.meta.duration(minutes(s))}
          {s.branch && <><br /><span className="branch">⑂ {s.branch}</span></>}
          <br />{jiraText}
        </div>
      </details>
      <div className="conversation-actions" role="group" aria-label={c.actions.label}>
        {SESSION_ACTIONS.filter(a => actions[a].shown).map(a => {
          const state = actions[a];
          const busy = a !== 'terminal' && sent?.kind === a;
          return (
            <button key={a} type="button" className="settings-button" data-action={a} disabled={!state.enabled || busy}
              title={state.reason ? c.actions.why[state.reason] : undefined} onClick={() => run(a)}>{c.actions[a]}</button>
          );
        })}
      </div>
      {confirming && !s.offline && (
        <div className="conversation-confirm" role="group" aria-label={c.actions.kill}>
          <p>{c.actions.confirmKill(s.name)}</p>
          <button type="button" className="settings-button" onClick={() => setConfirming(false)}>{c.actions.cancel}</button>
          <button type="button" className="settings-button danger" data-confirm-kill onClick={() => { setConfirming(false); api.command(s, 'kill'); }}>{c.actions.confirm}</button>
        </div>
      )}
      {note && <p className="conversation-note" role="status">{note}</p>}
    </header>
  );
}
```

Le texte affiché du sujet se met à jour quand le daemon renvoie la session renommée (`session.updated`) : la tête ne l'affiche pas en avance (le test le vérifie).

`apps/desktop/src/conversation/ConversationPane.tsx` (remplace le squelette de la tâche 5) :

```tsx
import { useI18n } from '../i18n/lang';
import { ConversationHeader, type ConversationProps } from './Header';

/** The selected session's conversation (mockup conversation.js). Never `data-session`: views count those. */
export function ConversationPane(p: ConversationProps) {
  const { t } = useI18n();
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={p.session.id} aria-label={t.conversation.label(p.session.name)}>
      <ConversationHeader key={p.session.id} {...p} />
    </aside>
  );
}
```

Dans `apps/desktop/src/App.tsx`, le panneau reçoit le client et l'API :

```tsx
          pane={selected ? <ConversationPane session={selected} client={fleetClient} api={conversations} expanded={panel.expanded} onExpand={on => setPanel(p => ({ ...p, expanded: on }))} /> : null} />}
```

À la fin de `apps/desktop/src/styles/app.css` (hors maquette : la rangée d'actions reprend `.settings-button` du lot 3) :

```css
/* Session actions (spec §9.1), under the session details. */
.conversation-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.conversation-actions button:disabled, .conversation-confirm button:disabled { opacity: .45; cursor: not-allowed; }
.conversation-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; padding: 9px 11px; border: 1px solid var(--sidebar-border); border-radius: 7px; background: var(--well); font-size: 11px; }
.conversation-confirm p { flex: 1 1 100%; margin: 0; }
.conversation-confirm .danger { color: var(--danger-text); border-color: currentColor; }
.conversation-rename { margin: 8px 0 12px; }
.conversation-rename input { display: block; box-sizing: border-box; width: 100%; padding: 7px 9px; border: 1px solid var(--input); border-radius: 6px; background: var(--well); color: var(--sidebar-foreground); font: inherit; font-size: 15px; }
.conversation-rename input:focus-visible { outline: 2px solid var(--sidebar-primary); outline-offset: 2px; }
.conversation-rename-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.conversation-rename small { font-size: 9px; color: var(--muted-foreground); }
.conversation-note { margin: 8px 0 0; font-size: 10px; color: var(--muted-foreground); }
```

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm -r typecheck && pnpm --filter desktop exec playwright test` (les specs de la tâche 5 trouvent toujours « ↗ Expand » dans la tête).

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): conversation header and session actions"`

---

### Task 8: Fil complet et décisions depuis le fil

**Files:**
- Create: `apps/desktop/src/conversation/blocks.ts`, `apps/desktop/src/conversation/Thread.tsx`, `apps/desktop/src/conversation/Request.tsx`
- Modify: `apps/desktop/src/conversation/ConversationPane.tsx` (fil sous la tête)
- Test: `apps/desktop/test/thread.test.tsx`, `apps/desktop/e2e/conversation.spec.ts`

**Interfaces:**
- Consumes: `turns(items: ThreadItem[]): Turn[]` de `@ledge/ui/thread/turns` et `target(item): string` de `@ledge/ui/thread/tools` (tâche 1) ; `useThreadRequest` et `Conversations` (tâche 6) ; `blocked`, `replyBlock` (tâche 4) ; `toggled` (tâche 3) ; `ConversationProps` (tâche 7).
- Produces :
  - `blocks.ts` : `type Block = { kind: 'user'; id: string; text: string } | { kind: 'agent'; id: string; text: string } | { kind: 'actions'; id: string; lines: string[] } | { kind: 'permission'; id: string; tool: string; accepted: boolean } | { kind: 'helper'; id: string; task: string; done: boolean }` ; `actionLine(i: ToolItem): string` ; `threadBlocks(items: readonly ThreadItem[]): Block[]`.
  - `Thread.tsx` : `Thread({ session, items, api }: { session: Session; items: ThreadItem[] | undefined; api: Conversations })`, monté par session (`key`).
  - `Request.tsx` : `RequestBlock({ session, api }: { session: Session; api: Conversations })` (rien sans `session.pending`).

Comportement (spec §9.1 « fil complet », « décisions et réponses », `desktop.thread` ; maquette `conversation.js` `message`) :
- Le fil suit les tours de l'île (`turns`, sans les éléments des sous-agents, sans l'écho de la réponse). Chaque suite d'appels d'outils d'un tour est repliée dans `details.thread-actions[data-fold="actions-<id du premier appel>"]` (« N actions · Voir le détail »), une ligne par appel (`outil · cible`, `· ✕` en échec). Prompts → `article.thread-message.user` (« Vous ») ; messages et réponses de l'agent → `article.thread-message.agent` (son nom). Une permission **décidée** et un sous-agent deviennent une `p.thread-notice` ; une permission sans décision ne s'affiche pas (la demande en cours est rendue par `RequestBlock`).
- Ligne de début : « Début de la session · <date> » quand le fil est chargé ; sinon (daemon ancien, chargement, session figée avant tout chargement) « Historique partiel… » suivi de `session.lastReply` s'il existe.
- Plis ouverts et position de lecture par id qualifié dans `desktop.thread` : la position est rendue au premier affichage du fil chargé (sinon la fin), sauvée 250 ms après la fin du défilement et au départ de la session ; en bas du fil, les nouveaux éléments (`session.thread.item`) et la demande en attente restent visibles.
- `RequestBlock` : `section.thread-request.<state>[data-request=<kind>]`, titre selon le type, texte, `<code>` du corps (plan). Permission, plan, diff → « Refuser » `[data-decision="deny"]` / « Autoriser » `[data-decision="accept"]`. Question → un bouton par option `[data-option=<n à partir de 1>]`, `title` = description de l'option ; « Ou précisez… » seulement si le compositeur accepte du texte libre (`replyBlock` nul). Décision en vol → `p.request-resolution[role=status]` « Envoyé… » sans boutons ; échec → « Échec de l'envoi : … » et les boutons reviennent. Session figée ou `hook_only` → boutons `disabled`.

- [ ] **Step 1: Test** — `apps/desktop/test/thread.test.tsx` :

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMemo } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { threadBlocks } from '../src/conversation/blocks';
import { Thread } from '../src/conversation/Thread';
import { useConversations } from '../src/conversation/useConversations';

const local = [{ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const at = (min: number) => new Date(Date.UTC(2026, 9, 13, 10, min)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Ship the release' },
  { kind: 'tool', id: 't1', at: at(1), turn: 1, tool: 'Bash', label: 'git status', status: 'success', files: [] },
  { kind: 'tool', id: 't2', at: at(2), turn: 1, tool: 'Read', label: '/w/ledge/src/index.ts', status: 'failed', files: [] },
  { kind: 'message', id: 'm1', at: at(3), turn: 1, text: 'Ready to push.' },
  { kind: 'permission', id: 'x1', at: at(4), turn: 1, tool: 'Bash', text: 'git push', decision: 'accept' },
  { kind: 'permission', id: 'x2', at: at(5), turn: 1, tool: 'Bash', text: 'git push --tags' },
  { kind: 'helper', id: 'h1', at: at(6), turn: 1, task: 'Check the changelog', state: 'exited' },
  { kind: 'message', id: 'hm', at: at(7), turn: 1, text: 'Inside the helper', helperId: 'h1' },
  { kind: 'prompt', id: 'p2', at: at(8), turn: 2, text: 'Thanks' },
  { kind: 'message', id: 'm2', at: at(9), turn: 2, text: 'All good' },
  { kind: 'reply', id: 'r2', at: at(10), turn: 2, text: 'All good' }
];
const bix = fakeSession('local:bix', { name: 'Bix', state: 'idle' });
let send: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => { localStorage.clear(); daemonStore.reset(); send = vi.fn(); client = { send } as unknown as DaemonClient; });

// `also` keeps a second session listed, so leaving one for the other does not prune its preferences.
function Harness({ session, list, also }: { session: Session; list?: ThreadItem[]; also?: Session }) {
  const sessions = useMemo(() => (also ? [session, also] : [session]), [session, also]);
  const api = useConversations(client, sessions, local, true);
  return <Thread key={session.id} session={session} items={list} api={api} />;
}

describe('threadBlocks', () => {
  it('folds each run of tool calls, keeps words, notes decided permissions and helpers, drops helper items and the echo', () => {
    expect(threadBlocks(items)).toEqual([
      { kind: 'user', id: 'p1', text: 'Ship the release' },
      { kind: 'actions', id: 'actions-t1', lines: ['Bash · git status', 'Read · src/index.ts · ✕'] },
      { kind: 'agent', id: 'm1', text: 'Ready to push.' },
      { kind: 'permission', id: 'x1', tool: 'Bash', accepted: true },
      { kind: 'helper', id: 'h1', task: 'Check the changelog', done: true },
      { kind: 'user', id: 'p2', text: 'Thanks' },
      { kind: 'agent', id: 'r2', text: 'All good' }
    ]);
  });
});

describe('Thread', () => {
  it('renders the turns with folded actions whose state is kept per session', () => {
    const { container, unmount } = render(<Harness session={bix} list={items} />);
    expect(screen.getByRole('region', { name: 'Conversation history with Bix' })).toBeInTheDocument();
    expect(container.querySelector('.thread-start')).toHaveTextContent(/^Session started · /);
    expect([...container.querySelectorAll('.thread-message')].map(m => [m.className, m.querySelector('.message-author')!.textContent]))
      .toEqual([['thread-message user', 'You'], ['thread-message agent', 'Bix'], ['thread-message user', 'You'], ['thread-message agent', 'Bix']]);
    expect(screen.getByText('Allowed · Bash')).toHaveClass('thread-notice');
    expect(screen.getByText('Helper · Check the changelog · done')).toHaveClass('thread-notice');
    const fold = container.querySelector('details[data-fold="actions-t1"]') as HTMLDetailsElement;
    expect(fold.querySelector('summary')).toHaveTextContent('2 actions · Show details');
    expect(fold.open).toBe(false);
    act(() => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].open).toEqual(['actions-t1']);
    unmount();
    const again = render(<Harness session={bix} list={items} />);
    expect((again.container.querySelector('details[data-fold="actions-t1"]') as HTMLDetailsElement).open).toBe(true);
  });
  it('without a thread, says the history is partial and shows the last reply', () => {
    const s = { ...bix, lastReply: { text: 'Done, see the PR.', at: at(1) } };
    const { container } = render(<Harness session={s} />);
    expect(container.querySelector('.thread-start')).toHaveTextContent('Partial history · only the last reply is known.');
    expect(container.querySelector('.thread-message.agent')).toHaveTextContent('Done, see the PR.');
  });
});

describe('Thread reading position', () => {
  const desc = (k: 'scrollTop' | 'scrollHeight' | 'clientHeight') => Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
  const saved = { scrollTop: desc('scrollTop'), scrollHeight: desc('scrollHeight'), clientHeight: desc('clientHeight') };
  beforeEach(() => {
    const tops = new WeakMap<HTMLElement, number>();
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get(this: HTMLElement) { return tops.get(this) ?? 0; }, set(this: HTMLElement, v: number) { tops.set(this, v); } });
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(HTMLElement.prototype, k, d); else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k]; }
  });
  const scroller = (c: HTMLElement) => c.querySelector('.thread-scroll') as HTMLElement;

  it('opens at the end, or where the reader left this session', () => {
    const first = render(<Harness session={bix} list={items} />);
    expect(scroller(first.container).scrollTop).toBe(1000);
    first.unmount();
    localStorage.setItem('desktop.thread', JSON.stringify({ 'local:bix': { open: [], scroll: 300 } }));
    const { container } = render(<Harness session={bix} list={items} />);
    expect(scroller(container).scrollTop).toBe(300);
  });
  it('waits for the thread before restoring the position', () => {
    localStorage.setItem('desktop.thread', JSON.stringify({ 'local:bix': { open: [], scroll: 300 } }));
    const { container, rerender } = render(<Harness session={bix} />);
    fireEvent.scroll(scroller(container));
    rerender(<Harness session={bix} list={items} />);
    expect(scroller(container).scrollTop).toBe(300);
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].scroll).toBe(300);
  });
  it('saves the position 250 ms after scrolling, and on leaving the session', () => {
    vi.useFakeTimers();
    const nova = fakeSession('local:nova', { name: 'Nova' });
    const { container, rerender } = render(<Harness session={bix} list={items} also={nova} />);
    const el = scroller(container);
    el.scrollTop = 420; fireEvent.scroll(el);
    act(() => { vi.advanceTimersByTime(249); });
    expect(localStorage.getItem('desktop.thread')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].scroll).toBe(420);
    el.scrollTop = 120; fireEvent.scroll(el);
    rerender(<Harness session={nova} list={items} also={bix} />);
    expect(JSON.parse(localStorage.getItem('desktop.thread')!)['local:bix'].scroll).toBe(120);
  });
});

describe('RequestBlock', () => {
  const otto = fakeSession('local:otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' } });
  it('a decision from the thread shows « Sent… », and an error reopens it', () => {
    const { container } = render(<Harness session={otto} list={[]} />);
    const request = container.querySelector('.thread-request')!;
    expect(request).toHaveClass('waiting_permission');
    expect(request).toHaveTextContent('Approval request · Bash');
    expect(request).toHaveTextContent('Run git push?');
    expect(request.querySelector('small')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'accept' });
    expect(screen.getByRole('status')).toHaveTextContent('Sent…');
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    act(() => daemonStore.apply({ type: 'error', id: 'local:otto', message: 'Request expired' }));
    expect(screen.getByRole('status')).toHaveTextContent('Not sent: Request expired');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'deny' });
  });
  it('a question offers its options (1-based) and the free answer only where it can be sent', () => {
    const pending = { kind: 'question' as const, text: 'Which first?', options: ['The product', 'The uses'], optionDetails: ['Lead with the product', ''], source: 'pane' as const };
    const luna = fakeSession('local:luna', { name: 'Luna', state: 'waiting_input', pending });
    const { container, unmount } = render(<Harness session={luna} list={[]} />);
    const product = screen.getByRole('button', { name: 'The product' });
    expect(product).toHaveAttribute('data-option', '1');
    expect(product).toHaveAttribute('title', 'Lead with the product');
    expect(screen.getByRole('button', { name: 'The uses' })).not.toHaveAttribute('title');
    expect(container.querySelector('.thread-request small')).toHaveTextContent('Or give your answer in the field below.');
    fireEvent.click(screen.getByRole('button', { name: 'The uses' }));
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:luna', text: '2' });
    unmount();
    const codex = render(<Harness session={{ ...luna, id: 'local:cx', tool: 'codex' }} list={[]} />);
    expect(codex.container.querySelector('.thread-request small')).toBeNull();
  });
  it('a frozen or hook-only session shows the request without letting you decide', () => {
    const { rerender } = render(<Harness session={{ ...otto, offline: true }} list={[]} />);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    rerender(<Harness session={{ ...otto, id: 'local:hook', source: 'hook_only' }} list={[]} />);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(send).not.toHaveBeenCalled();
  });
});
```

`apps/desktop/e2e/conversation.spec.ts` :

```ts
import { test, expect } from './fixtures';
import { fakeDaemon, session } from './daemon';

const at = (min: number) => new Date(Date.now() - (30 - min) * 60_000).toISOString();
const push = (cmd: string) => ({ kind: 'permission' as const, text: cmd, tool: 'Bash', source: 'hook' as const });

test('a decision from the thread', async ({ page }) => {
  const otto = session('otto', { name: 'Otto', state: 'waiting_permission', pending: push('git push origin main') });
  const d = await fakeDaemon(page, [otto]);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await expect(pane).toHaveAttribute('data-conversation', 'local:otto');
  await expect.poll(() => d.received.some(m => m.type === 'session.thread' && m.id === 'otto')).toBe(true);
  d.push({ type: 'session.thread', id: 'otto', items: [
    { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Ship the release' },
    { kind: 'tool', id: 't1', at: at(1), turn: 1, tool: 'Bash', label: 'git status', status: 'success', files: [] },
    { kind: 'message', id: 'm1', at: at(2), turn: 1, text: 'Ready to push.' }
  ] });
  await expect(pane.locator('.thread-message.user')).toHaveText(/Ship the release/);
  await expect(pane.locator('.thread-actions summary')).toHaveText('1 action · Show details');
  d.push({ type: 'session.thread.item', id: 'otto', item: { kind: 'message', id: 'm2', at: at(3), turn: 1, text: 'Waiting for your approval.' } });
  await expect(pane.locator('.thread-message.agent')).toHaveCount(2);

  const request = pane.locator('.thread-request');
  await expect(request).toContainText('git push origin main');
  await request.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]);
  await expect(request.getByRole('status')).toHaveText('Sent…');
  await expect(request.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  d.upsert({ ...otto, state: 'working', pending: undefined });
  await expect(request).toHaveCount(0);

  d.upsert({ ...otto, pending: push('npm publish') });
  await request.getByRole('button', { name: 'Allow' }).click();
  await expect(request.getByRole('status')).toHaveText('Sent…');
  d.push({ type: 'error', id: 'otto', message: 'Request expired' });
  await expect(request.getByRole('status')).toHaveText('Not sent: Request expired');
  await expect(request.getByRole('button', { name: 'Allow' })).toBeEnabled();
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test thread` → « Failed to resolve import "../src/conversation/blocks" » ; `pnpm --filter desktop exec playwright test conversation` → `.thread-message.user` introuvable.

- [ ] **Step 3: Implémenter**

`apps/desktop/src/conversation/blocks.ts` :

```ts
import type { ThreadItem, ToolItem } from '@ledge/protocol';
import { turns } from '@ledge/ui/thread/turns';
import { target } from '@ledge/ui/thread/tools';

/** What the thread shows (mockup conversation.js `message`): the user's prompts, the agent's words, each run of tool calls
 *  folded into one « N actions » block, decided permissions and helpers as notices. */
export type Block =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'actions'; id: string; lines: string[] }
  | { kind: 'permission'; id: string; tool: string; accepted: boolean }
  | { kind: 'helper'; id: string; task: string; done: boolean };

/** One line per call: the tool and its short target, marked when it failed. */
export function actionLine(i: ToolItem): string {
  const what = target(i);
  return `${i.tool}${what ? ` · ${what}` : ''}${i.status === 'failed' ? ' · ✕' : ''}`;
}

/** The main thread by turn (island `turns`: helper items left out, the reply's echo dropped), in blocks. A permission still
 *  undecided is the pending request, rendered apart. */
export function threadBlocks(items: readonly ThreadItem[]): Block[] {
  const out: Block[] = [];
  for (const turn of turns([...items])) {
    let run: ToolItem[] = [];
    const flush = () => {
      if (run.length) out.push({ kind: 'actions', id: `actions-${run[0]!.id}`, lines: run.map(actionLine) });
      run = [];
    };
    for (const it of turn.items) {
      if (it.kind === 'tool') { run.push(it); continue; }
      if (it.kind === 'permission' && (it.decision === undefined || it.decision === 'unknown')) continue;
      flush();
      if (it.kind === 'prompt') out.push({ kind: 'user', id: it.id, text: it.text });
      else if (it.kind === 'message' || it.kind === 'reply') out.push({ kind: 'agent', id: it.id, text: it.text });
      else if (it.kind === 'permission') out.push({ kind: 'permission', id: it.id, tool: it.tool, accepted: it.decision === 'accept' });
      else out.push({ kind: 'helper', id: it.id, task: it.task, done: it.state === 'exited' });
    }
    flush();
  }
  return out;
}
```

`apps/desktop/src/conversation/Request.tsx` :

```tsx
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { blocked, replyBlock } from './sends';
import type { Conversations } from './useConversations';

/** The request waiting on the session, decided from the thread (spec §9.1): « Envoyé… » while in flight, the buttons back
 *  with the error after a failure. Disabled for a frozen or hook-only session. */
export function RequestBlock({ session: s, api }: { session: Session; api: Conversations }) {
  const { t } = useI18n();
  const c = t.conversation.request;
  const p = s.pending;
  if (!p) return null;
  const inFlight = api.sends.sent[s.id]?.kind === 'decision';
  const failed = api.sends.failed[s.id];
  const failure = failed?.kind === 'decision' ? failed : undefined;
  const off = !!blocked(s);
  const options = p.kind === 'question' ? p.options ?? [] : [];
  return (
    <section className={`thread-request ${s.state}`} data-request={p.kind} aria-label={c.kinds[p.kind]}>
      <strong>{c.kinds[p.kind]}{p.tool ? ` · ${p.tool}` : ''}</strong>
      <p>{p.text}</p>
      {p.body && <code>{p.body}</code>}
      {inFlight
        ? <p className="request-resolution" role="status">{c.sent}</p>
        : <>
            {failure && <p className="request-resolution" role="status">{c.failed(failure.message)}</p>}
            {p.kind !== 'question' && (
              <div className="request-actions">
                <button type="button" data-decision="deny" disabled={off} onClick={() => api.decide(s, 'deny')}>{c.deny}</button>
                <button type="button" data-decision="accept" disabled={off} onClick={() => api.decide(s, 'accept')}>{c.allow}</button>
              </div>
            )}
            {options.length > 0 && (
              <div className="request-actions">
                {options.map((o, i) => (
                  <button key={i} type="button" data-option={i + 1} title={p.optionDetails?.[i] || undefined} disabled={off} onClick={() => api.answer(s, i)}>{o}</button>
                ))}
              </div>
            )}
            {p.kind === 'question' && !replyBlock(s) && <small>{c.orReply}</small>}
          </>}
    </section>
  );
}
```

`apps/desktop/src/conversation/Thread.tsx` :

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef, type SyntheticEvent } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { toggled } from '../state/threadPrefs';
import { threadBlocks, type Block } from './blocks';
import { RequestBlock } from './Request';
import type { Conversations } from './useConversations';

const SAVE_MS = 250;
const END_SLACK = 24;

function BlockView({ block: b, name, open, onToggle }: { block: Block; name: string; open: boolean; onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => void }) {
  const { t } = useI18n();
  const c = t.conversation.thread;
  switch (b.kind) {
    case 'user': return <article className="thread-message user"><div className="message-author">{c.you}</div><p>{b.text}</p></article>;
    case 'agent': return <article className="thread-message agent"><div className="message-author">{name}</div><p>{b.text}</p></article>;
    case 'actions': return (
      <details className="thread-actions" data-fold={b.id} open={open} onToggle={onToggle}>
        <summary>{c.actions(b.lines.length)}</summary>
        <ul>{b.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
    );
    case 'permission': return <p className="thread-notice">{c.permission(b.tool, b.accepted)}</p>;
    case 'helper': return <p className="thread-notice">{c.helper(b.task, b.done)}</p>;
  }
}

/** The full thread (spec §9.1), mounted per session (`key`). Folds and reading position live in `desktop.thread` (spec §7):
 *  the position comes back once the thread is loaded, is saved 250 ms after scrolling stops and on leaving; at the end of the
 *  thread, new items and the pending request stay in view. */
export function Thread({ session, items, api }: { session: Session; items: ThreadItem[] | undefined; api: Conversations }) {
  const { t, lang } = useI18n();
  const c = t.conversation.thread;
  const blocks = useMemo(() => (items ? threadBlocks(items) : []), [items]);
  const open = api.pref(session.id).open;
  const scroller = useRef<HTMLElement>(null);
  const restored = useRef(false);
  const atEnd = useRef(true);
  const pending = useRef<number | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(api);
  latest.current = api;
  const loaded = items !== undefined;

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current === undefined) return;
    latest.current.setPref(session.id, { scroll: pending.current });
    pending.current = undefined;
  };
  // Leaving the session (the pane remounts the thread per session) saves where the reader was.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || restored.current) return;
    if (!loaded) { el.scrollTop = el.scrollHeight; return; }
    const at = latest.current.pref(session.id).scroll;
    el.scrollTop = at ?? el.scrollHeight;
    atEnd.current = at === null;
    restored.current = true;
  }, [loaded, session.id]);

  const tail = `${blocks.length}|${items?.at(-1)?.id ?? ''}|${session.pending?.text ?? ''}|${session.lastReply?.at ?? ''}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && restored.current && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [tail]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !restored.current) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < END_SLACK;
    pending.current = atEnd.current ? null : Math.round(el.scrollTop);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_MS);
  };
  const onToggle = (fold: string) => (e: SyntheticEvent<HTMLDetailsElement>) =>
    api.setPref(session.id, { open: toggled(open, fold, e.currentTarget.open) });
  const started = new Date(session.startedAt).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <section ref={scroller} className="thread-scroll" tabIndex={0} aria-label={c.label(session.name)} onScroll={onScroll}>
      <div className="thread-content">
        <p className="thread-start">{loaded ? c.start(started) : c.partial}</p>
        {blocks.map(b => <BlockView key={b.id} block={b} name={session.name} open={open.includes(b.id)} onToggle={onToggle(b.id)} />)}
        {!loaded && session.lastReply && (
          <article className="thread-message agent"><div className="message-author">{session.name}</div><p>{session.lastReply.text}</p></article>
        )}
        <RequestBlock session={session} api={api} />
      </div>
    </section>
  );
}
```

Remarques pour l'implémenteur :
- Dans le test « waits for the thread », le `fireEvent.scroll` d'avant chargement est ignoré (`restored` faux) : il ne doit pas écraser la position stockée par `null`.
- Un `<details open>` émet `toggle` au montage ; `toggled` est idempotent et `setThreadPref` rend le même objet quand rien ne change (tâche 3), donc rien n'est réécrit.
- La règle ESLint citée n'est pas une porte du dépôt ; le commentaire documente le choix (sauvegarde au démontage, une fois par session).

`apps/desktop/src/conversation/ConversationPane.tsx` (le fil sous la tête) :

```tsx
import { useI18n } from '../i18n/lang';
import { ConversationHeader, type ConversationProps } from './Header';
import { Thread } from './Thread';
import { useThreadRequest } from './useThreadRequest';

/** The selected session's conversation (mockup conversation.js). Never `data-session`: views count those. */
export function ConversationPane(p: ConversationProps) {
  const { t } = useI18n();
  const items = useThreadRequest(p.client, p.session);
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={p.session.id} aria-label={t.conversation.label(p.session.name)}>
      <ConversationHeader key={p.session.id} {...p} />
      <Thread key={`thread-${p.session.id}`} session={p.session} items={items} api={p.api} />
    </aside>
  );
}
```

Aucune règle CSS à ajouter : `.request-actions` existe déjà dans `app.css` (lot 3, l. 81-83) et la tâche 5 a porté `.thread-*`, `.request-resolution` et les règles `:disabled`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm -r typecheck && pnpm --filter desktop exec playwright test`

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): full thread and decisions from the thread"`

---

### Task 9: Compositeur, conversation figée et reconnexion

**Files:**
- Create: `apps/desktop/src/conversation/Composer.tsx`
- Modify: `apps/desktop/src/conversation/ConversationPane.tsx` (bandeau de lecture seule, compositeur)
- Test: `apps/desktop/test/composer.test.tsx`, `apps/desktop/e2e/conversation.spec.ts` (trois tests ajoutés)

**Interfaces:**
- Consumes: `Conversations` (`draft`, `setDraft`, `reply`, `sends`) de la tâche 6 ; `blocked`, `replyBlock` de la tâche 4 ; `DRAFT_MAX`, `DRAFTS_KEY` de la tâche 3 ; `ConversationProps` (tâche 7) ; `Thread` (tâche 8) ; clés `t.conversation.offline`, `t.conversation.readonly`, `t.conversation.composer.*` (tâche 5).
- Produces : `Composer({ session, api }: { session: Session; api: Conversations })`, monté par session (`key`) ; `ConversationPane(p: ConversationProps)` dans sa forme finale : tête, bandeau `div.conversation-offline[role=status]` quand `blocked(session)`, fil, compositeur.

Comportement (spec §9.1 compositeur, §6 machine déconnectée et reconnexion ; maquette `conversation.js` l. 56-58 et 94-95) :
- `form.conversation-composer#conversation-form` : `label` « Répondre à <nom> », `textarea#conversation-reply` (3 lignes, 10 000 caractères, `aria-describedby="reply-hint"`), `small#reply-hint` (`aria-live="polite"`), bouton « Envoyer ↑ ».
- Ctrl/⌘ + Entrée envoie (sauf pendant une composition IME), Entrée seule va à la ligne, le bouton envoie aussi. Le texte part tel quel après `trim` : jamais lu comme une commande. Un envoi vide le brouillon et affiche « Envoyé… » jusqu'au prochain changement de la session ; un échec remet le texte dans le compositeur avec « Message non envoyé : … », effacé dès qu'on retape.
- Un brouillon par id qualifié (`desktop.drafts`), gardé à travers le rechargement et la déconnexion, effacé quand la session disparaît d'une machine prête (jamais `ledge`).
- Demande en attente (permission, plan, diff) ou question à options hors Claude : texte libre refusé, la raison s'affiche dans l'indication, le champ reste éditable. Session figée ou `hook_only` : champ `disabled`, brouillon visible, bandeau « Machine déconnectée · historique figé… » ou « Session suivie par les hooks · lecture seule. ». À la reconnexion, le snapshot remplace la session figée : bandeau parti, champ rendu, brouillon intact.

- [ ] **Step 1: Test** — `apps/desktop/test/composer.test.tsx` :

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMemo } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { DRAFTS_KEY } from '../src/state/drafts';
import { Composer } from '../src/conversation/Composer';
import { useConversations } from '../src/conversation/useConversations';

const local = [{ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const bix = fakeSession('local:bix', { name: 'Bix', state: 'idle' });
const nova = fakeSession('local:nova', { name: 'Nova', state: 'idle' });
const both = [bix, nova];
let send: ReturnType<typeof vi.fn>;
let client: DaemonClient;

beforeEach(() => { localStorage.clear(); daemonStore.reset(); send = vi.fn(); client = { send } as unknown as DaemonClient; });

function Harness({ session, list }: { session: Session; list?: readonly Session[] }) {
  const sessions = useMemo(() => list ?? [session], [list, session]);
  const api = useConversations(client, sessions, local, true);
  return <Composer key={session.id} session={session} api={api} />;
}
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const hint = () => document.getElementById('reply-hint')!;
const sendButton = () => screen.getByRole('button', { name: 'Send ↑' });
const drafts = () => JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>;

describe('Composer', () => {
  it('Ctrl or ⌘ + Enter sends, Enter alone and an IME composition do not', () => {
    render(<Harness session={bix} />);
    expect(screen.getByRole('textbox', { name: 'Reply to Bix' })).toHaveAttribute('maxlength', '10000');
    expect(box()).toHaveAttribute('placeholder', 'Write your message…');
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send · Enter for a new line');
    expect(sendButton()).toBeDisabled();
    fireEvent.change(box(), { target: { value: 'First line\nSecond line' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:bix', text: 'First line\nSecond line' });
    expect(box()).toHaveValue('');
    expect(hint()).toHaveTextContent('Sent…');
    fireEvent.change(box(), { target: { value: '  /clear  ' } });
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(send).toHaveBeenLastCalledWith({ type: 'session.reply', id: 'local:bix', text: '/clear' });
    fireEvent.change(box(), { target: { value: 'By the button' } });
    fireEvent.click(sendButton());
    expect(send).toHaveBeenLastCalledWith({ type: 'session.reply', id: 'local:bix', text: 'By the button' });
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('a failed reply comes back into the composer with the reason', () => {
    render(<Harness session={bix} />);
    fireEvent.change(box(), { target: { value: 'Hello' } });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    act(() => daemonStore.apply({ type: 'error', id: 'local:bix', message: 'Session busy' }));
    expect(hint()).toHaveTextContent('Message not sent: Session busy');
    expect(box()).toHaveValue('Hello');
    fireEvent.change(box(), { target: { value: 'Hello again' } });
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
  });
  it('refuses free text while a request waits, and freezes on a disconnected or hook-only session with the draft kept', () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ 'local:bix': 'Half written' }));
    const permission: Session = { ...bix, state: 'waiting_permission', pending: { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' } };
    const { rerender } = render(<Harness session={permission} />);
    expect(box()).toBeEnabled();
    expect(box()).toHaveValue('Half written');
    expect(hint()).toHaveTextContent('Answer the request above first.');
    expect(sendButton()).toBeDisabled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(send).not.toHaveBeenCalled();
    const question: Session = { ...bix, tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Which first?', options: ['A', 'B'], source: 'pane' } };
    rerender(<Harness session={question} />);
    expect(hint()).toHaveTextContent('Pick one of the options above.');
    rerender(<Harness session={{ ...question, tool: 'claude' }} />);
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
    expect(sendButton()).toBeEnabled();
    rerender(<Harness session={{ ...bix, offline: true }} />);
    expect(box()).toBeDisabled();
    expect(box()).toHaveValue('Half written');
    expect(hint()).toHaveTextContent('Machine disconnected: cannot send.');
    expect(sendButton()).toBeDisabled();
    rerender(<Harness session={{ ...bix, source: 'hook_only' }} />);
    expect(box()).toBeDisabled();
    expect(hint()).toHaveTextContent('Read-only session.');
    expect(drafts()).toEqual({ 'local:bix': 'Half written' });
  });
  it('keeps one draft per session', () => {
    const { rerender } = render(<Harness session={bix} list={both} />);
    fireEvent.change(box(), { target: { value: 'For Bix' } });
    rerender(<Harness session={nova} list={both} />);
    expect(screen.getByRole('textbox', { name: 'Reply to Nova' })).toHaveValue('');
    fireEvent.change(box(), { target: { value: 'For Nova' } });
    rerender(<Harness session={bix} list={both} />);
    expect(box()).toHaveValue('For Bix');
    expect(drafts()).toEqual({ 'local:bix': 'For Bix', 'local:nova': 'For Nova' });
  });
  it('forgets the draft of a session that is gone, never the resident\'s', () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ 'local:bix': 'a', 'local:nova': 'b', ledge: 'c' }));
    const { rerender } = render(<Harness session={bix} list={both} />);
    expect(drafts()).toEqual({ 'local:bix': 'a', 'local:nova': 'b', ledge: 'c' });
    rerender(<Harness session={bix} list={[bix]} />);
    expect(drafts()).toEqual({ 'local:bix': 'a', ledge: 'c' });
  });
});
```

Dans `apps/desktop/e2e/conversation.spec.ts`, l'import devient `import { eight, fakeDaemon, fakeRemote, session } from './daemon';` et trois tests s'ajoutent à la fin :

```ts
test('a reply from the composer', async ({ page }) => {
  const bix = session('bix', { name: 'Bix', state: 'idle' });
  const d = await fakeDaemon(page, [bix]);
  await page.goto('/');
  const box = page.getByRole('textbox', { name: 'Reply to Bix' });
  const hint = page.locator('#reply-hint');
  await box.fill('First line');
  await box.press('Enter');
  await box.pressSequentially('Second line');
  await expect(box).toHaveValue('First line\nSecond line');
  expect(d.received.filter(m => m.type === 'session.reply')).toEqual([]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('desktop.drafts') ?? '')).toContain('Second line');
  await page.reload();
  await expect(box).toHaveValue('First line\nSecond line');
  await box.press('Control+Enter');
  await expect.poll(() => d.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'bix', text: 'First line\nSecond line' }]);
  await expect(box).toHaveValue('');
  await expect(hint).toHaveText('Sent…');
  d.upsert({ ...bix, state: 'working', lastActivityAt: new Date().toISOString() });
  await expect(hint).toHaveText('Ctrl / ⌘ + Enter to send · Enter for a new line');
});

test('a disconnected machine leaves its conversation read-only until it comes back', async ({ page }) => {
  await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })], { machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'waiting_permission', pending: push('rm -rf build') })]);
  await page.goto('/');
  await page.locator('[data-session="devbox:nova"]').click();
  const pane = page.locator('#conversation-pane');
  await expect(pane).toHaveAttribute('data-conversation', 'devbox:nova');
  const box = pane.getByRole('textbox', { name: 'Reply to Nova' });
  await box.fill('Half written');
  await expect(pane.getByRole('button', { name: 'Allow' })).toBeEnabled();

  remote.close();
  const banner = pane.locator('.conversation-offline');
  await expect(banner).toHaveText('Machine disconnected · history frozen. Your draft is kept until it reconnects.');
  await expect(banner).toHaveAttribute('role', 'status');
  await expect(box).toBeDisabled();
  await expect(box).toHaveValue('Half written');
  await expect(pane.locator('.thread-request')).toContainText('rm -rf build');
  await expect(pane.getByRole('button', { name: 'Allow' })).toBeDisabled();
  await expect(pane.getByRole('button', { name: 'Open terminal' })).toBeDisabled();

  remote.reopen([session('nova', { name: 'Nova', state: 'working' })]);
  await expect(banner).toHaveCount(0);
  await expect(box).toBeEnabled();
  await expect(box).toHaveValue('Half written');
  await expect(pane.locator('.thread-request')).toHaveCount(0);
});

test('a finished session dismissed: its draft goes and the first visible session takes the panel', async ({ page }) => {
  const d = await fakeDaemon(page, eight.map(s => (s.id === 'bix' ? { ...s, state: 'exited' as const } : s)));
  await page.goto('/');
  await page.locator('[data-session="local:bix"]').click();
  const pane = page.locator('#conversation-pane');
  await expect(pane).toHaveAttribute('data-conversation', 'local:bix');
  await pane.getByRole('textbox', { name: 'Reply to Bix' }).fill('Never sent');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('desktop.drafts') ?? '')).toContain('local:bix');
  await pane.getByRole('button', { name: 'Dismiss' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.dismiss')).toEqual([{ type: 'session.dismiss', id: 'bix' }]);
  d.remove('bix');
  await expect(page.locator('[data-session="local:bix"]')).toHaveCount(0);
  const first = await page.locator('.view-body > .central [data-session]').first().getAttribute('data-session');
  await expect(pane).toHaveAttribute('data-conversation', first!);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('desktop.drafts') ?? '')).not.toContain('local:bix');
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test composer` → « Failed to resolve import "../src/conversation/Composer" » ; `pnpm --filter desktop exec playwright test conversation` → « Reply to Bix » introuvable.

- [ ] **Step 3: Implémenter**

`apps/desktop/src/conversation/Composer.tsx` :

```tsx
import type { FormEvent, KeyboardEvent } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { DRAFT_MAX } from '../state/drafts';
import { replyBlock } from './sends';
import type { Conversations } from './useConversations';

/** The reply field (spec §9.1, mockup conversation.js l. 58 and 94-95): Ctrl/⌘ + Enter sends, Enter goes to a new line, one
 *  draft per qualified id. Free text is sent as it is, never read as a command. Frozen (disabled, draft shown) on a
 *  disconnected or hook-only session; while a request waits, the hint says why nothing can be sent. */
export function Composer({ session: s, api }: { session: Session; api: Conversations }) {
  const { t } = useI18n();
  const c = t.conversation.composer;
  const draft = api.draft(s.id);
  const block = replyBlock(s);
  const sent = api.sends.sent[s.id];
  const failed = api.sends.failed[s.id];
  const hint = failed?.kind === 'reply' ? c.failed(failed.message) : sent?.kind === 'reply' ? c.sent : block ? c.blocked[block] : c.hint;
  const frozen = block === 'offline' || block === 'readonly';
  const send = () => { if (!block && draft.trim()) api.reply(s, draft); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };
  return (
    <form className="conversation-composer" id="conversation-form" onSubmit={onSubmit}>
      <label htmlFor="conversation-reply">{c.label(s.name)}</label>
      <textarea id="conversation-reply" name="reply" rows={3} maxLength={DRAFT_MAX} placeholder={c.placeholder} aria-describedby="reply-hint"
        value={draft} disabled={frozen} onChange={e => api.setDraft(s.id, e.target.value)} onKeyDown={onKeyDown} />
      <div className="composer-bottom">
        <small id="reply-hint" aria-live="polite">{hint}</small>
        <button type="submit" className="primary" disabled={!!block || !draft.trim()}>{c.send}</button>
      </div>
    </form>
  );
}
```

`apps/desktop/src/conversation/ConversationPane.tsx` (forme finale) :

```tsx
import { useI18n } from '../i18n/lang';
import { Composer } from './Composer';
import { ConversationHeader, type ConversationProps } from './Header';
import { blocked } from './sends';
import { Thread } from './Thread';
import { useThreadRequest } from './useThreadRequest';

/** The selected session's conversation (mockup conversation.js l. 50-58). Never `data-session`: views count those. The
 *  read-only banner is a `status`, never an `alert` (the local daemon's alert stays the only one, e2e/offline.spec.ts). */
export function ConversationPane(p: ConversationProps) {
  const { t } = useI18n();
  const items = useThreadRequest(p.client, p.session);
  const frozen = blocked(p.session);
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={p.session.id} aria-label={t.conversation.label(p.session.name)}>
      <ConversationHeader key={p.session.id} {...p} />
      {frozen && <div className="conversation-offline" role="status">{t.conversation[frozen]}</div>}
      <Thread key={`thread-${p.session.id}`} session={p.session} items={items} api={p.api} />
      <Composer key={`composer-${p.session.id}`} session={p.session} api={p.api} />
    </aside>
  );
}
```

Aucune règle CSS à ajouter : `.conversation-composer`, `.composer-bottom`, `.conversation-offline` et `textarea:disabled` ont été portés à la tâche 5.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm -r typecheck && pnpm --filter desktop exec playwright test` (dont `offline.spec.ts`, inchangé : une seule `alert`, « Devbox is disconnected », `.seat .state` « Disconnected »).

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): composer and read-only offline conversations"`
