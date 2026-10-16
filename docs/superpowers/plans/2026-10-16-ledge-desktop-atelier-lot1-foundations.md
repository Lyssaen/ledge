# Ledge Desktop Atelier, lot 1 : fondations — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur la branche `feat/desktop-atelier`, retirer tous les écrans de l'ancien Desktop (Équipe, Réunion, conversation, lancement, chat, réglages) et ne garder qu'une app React vide qui démarre sur le fleet réel, avec la tuyauterie intacte : Tauri, tray, updater, toasts et sons, apparence, langue.

**Architecture:** La branche part de `origin/feat/desktop` (lots 1 à 7 de l'ancien Desktop, `main` déjà fusionné). `apps/desktop/src-tauri`, la release et les packages partagés ne changent pas. Dans `apps/desktop/src`, on garde les modules sans écran (`tauri/`, `fleet/useFleet.ts`, `i18n/`, `notify/`, `update/`, `shell/theme.ts`, `settings/scale.ts`, `state/storage.ts`, `state/useStored.ts`, `motionPreferences.ts`) et on supprime tout le reste. `App.tsx` devient une coquille minimale qui monte le fleet, les alertes, le tray et l'apparence, et affiche un écran d'attente avec l'état des machines. Le lot 3 remplacera cet écran par le vrai squelette.

**Tech Stack:** TypeScript, React 19, Vite 6, Tailwind 4, Tauri 2, vitest 3 + Testing Library + jsdom, Playwright 1.49, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` (§ 3, § 7 lot 1). Pour ce qui reste valable de l'ancien Desktop : `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` §§ 7, 10, 11, 12.

## Global Constraints

- Travail dans le worktree `.worktrees/desktop-atelier`, branche `feat/desktop-atelier` (sans upstream ; ne jamais pousser sur `feat/desktop`).
- **Rien ne change** dans `apps/desktop/src-tauri/`, `.github/workflows/release.yml`, `scripts/`, `packages/*`, `apps/overlay/`.
- Le code retiré reste accessible par l'historique (`git show origin/feat/desktop:apps/desktop/src/<chemin>`). Les lots suivants décident eux-mêmes s'ils en reprennent la logique. Ce lot n'en garde rien « pour plus tard » hors de la liste ci-dessous.
- **Modules gardés tels quels** (sauf retouches d'import imposées par la compilation) : `src/tauri/bridge.ts`, `src/fleet/useFleet.ts`, `src/i18n/lang.tsx`, `src/notify/{alerts,player,prefs,useAlerts}.ts`, `src/update/{bridge,daemon,store}.ts`, `src/shell/theme.ts`, `src/settings/scale.ts`, `src/state/storage.ts`, `src/state/useStored.ts`, `src/motionPreferences.ts`, `src/main.tsx`.
- Clés locales préfixées `desktop.` ; chaque lecture survit à une valeur absente, corrompue ou à un stockage bloqué (spec 2026-10-14 § 7).
- Défauts de Desktop inchangés : toasts activés, sons désactivés (spec 2026-10-14 § 10).
- Textes en français et en anglais dans `src/i18n/messages.ts`, `fr` source de vérité, `Messages = typeof fr`.
- **Pas de `cargo` dans ce WSL** ; le Rust ne change pas dans ce lot, donc rien à construire côté Tauri.
- Aucune erreur console dans les tests Playwright (`e2e/fixtures.ts` le vérifie déjà).
- Commits `refactor(desktop): …`, `feat(desktop): …`, `test(desktop): …`, `docs(desktop): …`, terminés par la ligne `Co-Authored-By` de la session.

## Review Focus

1. **Clés laissées par l'ancien Desktop** : un poste qui a fait tourner `feat/desktop` garde `desktop.view`, `desktop.selected`, `desktop.panel`, `desktop.drafts`, `desktop.thread` et `desktop.launch` avec les formes d'Équipe et Réunion. Les lots suivants pourraient réutiliser ces noms. L'app les supprime au démarrage, garde les autres clés `desktop.*` (langue, thème, accent, échelle, sons, notify, dnd, tool, update, machines), et démarre normalement. Test ajouté à la tâche 1.
2. **Daemon local absent au démarrage** : l'écran d'attente dit « Local déconnecté » une fois la première tentative échouée, sans exception ni son d'erreur. Le son d'erreur ne joue que sur une perte après connexion, règle déjà testée dans `use-alerts.test.tsx`. Test ajouté à la tâche 1 (vitest) et à la tâche 2 (Playwright).
3. **Tray « Nouvelle session » sans écran de lancement** : l'action est ignorée sans erreur ; « Ne pas déranger » bascule toujours `desktop.dnd` et le libellé du tray suit. Test ajouté à la tâche 1.
4. **Machine distante injoignable** : elle apparaît « déconnectée » sur l'écran d'attente pendant que le local reste connecté. Le mock daemon de vitest accepte tous les chemins et ne sait pas refuser `/ssh/<alias>`, donc le test est en Playwright avec `fakeRemote`. Test ajouté à la tâche 2.
5. **Langue enregistrée** : avec `desktop.lang = 'en'`, l'écran d'attente et les libellés du tray sont en anglais dès le premier rendu. Test ajouté à la tâche 1.

---

## Fichiers

| Fichier | Sort |
| --- | --- |
| `src/App.tsx` | Réécrit : coquille minimale |
| `src/shell/Waiting.tsx` | Nouveau : écran d'attente |
| `src/state/obsolete.ts` | Nouveau : purge des clés de l'ancien Desktop |
| `src/i18n/messages.ts` | Réduit aux textes encore lus |
| `src/styles/app.css` | Réduit à la base |
| `src/main.tsx` | Inchangé, sauf l'appel de purge |
| `src/{chat,conversation,grouping,launch,room,team}/` | Supprimés |
| `src/settings/*` sauf `scale.ts` | Supprimés |
| `src/shell/*` sauf `theme.ts` | Supprimés |
| `src/state/*` sauf `storage.ts`, `useStored.ts` | Supprimés |
| `src/fleet/attention.ts` | Supprimé |
| `test/` | Gardés : `setup.ts`, `bridge`, `use-fleet`, `alerts`, `use-alerts`, `update-store`, `daemon-update`, `desktop-prefs` (retouché), `tauri-config`, `app-theme`. Réécrits : `app.test.tsx`, `app-tray.test.tsx`. Nouveau : `obsolete.test.ts`. Tout le reste est supprimé. |
| `e2e/` | Gardés : `daemon.ts`, `fixtures.ts`. Nouveau : `boot.spec.ts`. Toutes les autres specs sont supprimées. |

---

### Task 1: Coquille minimale à la place des écrans

**Files:**
- Delete: `apps/desktop/src/{chat,conversation,grouping,launch,room,team}/`, `src/fleet/attention.ts`, `src/settings/` sauf `scale.ts`, `src/shell/` sauf `theme.ts`, `src/state/` sauf `storage.ts` et `useStored.ts`
- Delete: tous les fichiers de `apps/desktop/test/` absents de la liste « gardés » ci-dessus (dont `chat-helpers.ts`, `launch-helpers.ts`, `settings-helpers.ts`)
- Create: `apps/desktop/src/shell/Waiting.tsx`, `apps/desktop/src/state/obsolete.ts`, `apps/desktop/test/obsolete.test.ts`
- Modify: `apps/desktop/src/App.tsx` (réécrit), `src/main.tsx`, `src/i18n/messages.ts`, `src/styles/app.css`, `test/desktop-prefs.test.tsx`
- Test: `apps/desktop/test/app.test.tsx` (réécrit), `apps/desktop/test/app-tray.test.tsx` (réécrit)

**Interfaces:**
- Consumes : `useFleet(client?)` → `{ sessions, machines, status, fleet, client, localDown }` (`src/fleet/useFleet.ts`) ; `useAlerts({ sessions, machines, status })` (`src/notify/useAlerts.ts`) ; `onTrayAction`, `setTrayLabels` (`src/tauri/bridge.ts`) ; `getDnd`, `setDnd`, `useDnd` (`src/notify/prefs.ts`) ; `useAppearance` (`src/shell/theme.ts`) ; `LangProvider`, `loadLang`, `useI18n` (`src/i18n/lang.tsx`).
- Produces :
  - `export function App({ client }: { client?: DaemonClient } = {}): JSX.Element` dans `src/App.tsx`, signature inchangée (les tests et `main.tsx` l'appellent ainsi).
  - `export function Waiting({ sessions, machines }: { sessions: Session[]; machines: MachineState[] }): JSX.Element` dans `src/shell/Waiting.tsx`.
  - `export const OBSOLETE_KEYS: readonly string[]` et `export function purgeObsolete(): void` dans `src/state/obsolete.ts`.
  - `Messages` réduit à : `tray`, `notify`, `status`, `waiting`, `botLabel`, `botReadOnly`, `botNotLive`, `resident`.

- [ ] **Step 1: Partir d'une base verte**

Run: `cd .worktrees/desktop-atelier && pnpm install --frozen-lockfile && pnpm --filter desktop test`
Expected: `47 passed` (fichiers), `451 passed` (tests).

- [ ] **Step 2: Écrire `test/obsolete.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OBSOLETE_KEYS, purgeObsolete } from '../src/state/obsolete';

describe('purgeObsolete', () => {
  beforeEach(() => localStorage.clear());
  it('removes the old Team / Meeting keys and keeps every other desktop key', () => {
    expect(OBSOLETE_KEYS).toEqual(['desktop.view', 'desktop.selected', 'desktop.panel', 'desktop.drafts', 'desktop.thread', 'desktop.launch']);
    for (const k of OBSOLETE_KEYS) localStorage.setItem(k, '{"view":"room"}');
    const kept = ['desktop.lang', 'desktop.theme', 'desktop.accent', 'desktop.panelScale', 'desktop.sounds', 'desktop.notify', 'desktop.dnd', 'desktop.tool', 'desktop.update.auto', 'desktop.machines', 'ledge.lang'];
    for (const k of kept) localStorage.setItem(k, 'x');
    purgeObsolete();
    for (const k of OBSOLETE_KEYS) expect(localStorage.getItem(k)).toBeNull();
    for (const k of kept) expect(localStorage.getItem(k)).toBe('x');
  });
  it('never throws when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => purgeObsolete()).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/obsolete.test.ts`
Expected: FAIL, module `../src/state/obsolete` introuvable.

- [ ] **Step 4: Implémenter `src/state/obsolete.ts`**

`OBSOLETE_KEYS` dans l'ordre du test ; `purgeObsolete()` appelle `localStorage.removeItem` sur chaque clé, chaque appel dans son propre `try/catch`. Avant d'écrire la liste en dur, vérifier dans `git show origin/feat/desktop:apps/desktop/src/state/` que les six clés sont bien celles de `view.ts`, `persist.ts`, `panel.ts`, `drafts.ts`, `threadPrefs.ts` et `launch/form.ts`. Si un nom diffère, le test et la liste suivent le vrai nom.

- [ ] **Step 5: Vérifier qu'il passe**

Run: `pnpm --filter desktop exec vitest run test/obsolete.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Réécrire `test/app.test.tsx`**

Il démarre `App` sur `createMockDaemon` (`@ledge/fleet/test/mockDaemon`) avec `createDesktopFleet({ url, WebSocketImpl: WebSocket })`, comme l'ancien fichier. La suite tourne en anglais (`test/setup.ts`). Cas, avec ces assertions :

```tsx
it('waits on the real fleet: product name, session count and the local machine connected', async () => {
  // d.upsert(fakeSession('otto')); d.upsert(fakeSession('nova')); d.machines([{ id: 'local', label: 'Local' }])
  expect(await screen.findByRole('heading', { name: 'Ledge Desktop' })).toBeVisible();
  expect(await screen.findByText('2 sessions')).toBeVisible();
  expect(await screen.findByText('Local connected')).toBeVisible();
});
it('says the local daemon is disconnected once the first attempt fails, without throwing', async () => {
  // daemon closed before render (pattern of use-fleet.test.tsx « flags localDown only once… »)
  expect(await screen.findByText('Local disconnected', {}, { timeout: 6000 })).toBeVisible();
  expect(screen.getByText('0 sessions')).toBeVisible();
});
it('speaks the stored language from the first render', async () => {
  // localStorage.setItem('desktop.lang', 'fr') before render
  expect(await screen.findByText('Local connecté')).toBeVisible();
});
```

La purge elle-même est couverte par `obsolete.test.ts`. Son appel dans `main.tsx` est vérifié à l'étape 15.

- [ ] **Step 7: Réécrire `test/app-tray.test.tsx`**

Garder le mock `vi.mock('../src/tauri/bridge', …)` de l'ancien fichier, qui capture `onTrayAction`, et y ajouter une capture de `setTrayLabels`. Cas :

```tsx
it('ignores « new » and « open » (no launch screen yet) and switches do not disturb on « dnd »', async () => {
  act(() => tray.fire!('new')); act(() => tray.fire!('open'));
  expect(screen.getByRole('heading', { name: 'Ledge Desktop' })).toBeVisible();
  act(() => tray.fire!('dnd'));
  expect(localStorage.getItem('desktop.dnd')).toBe('1');
  expect(tray.labels.at(-1)).toEqual({ open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Resume alerts', quit: 'Quit Ledge Desktop' });
  act(() => tray.fire!('dnd'));
  expect(localStorage.getItem('desktop.dnd')).toBe('0');
  expect(tray.labels.at(-1)?.dnd).toBe('Do not disturb');
});
```

- [ ] **Step 8: Vérifier que les deux fichiers échouent**

Run: `pnpm --filter desktop exec vitest run test/app.test.tsx test/app-tray.test.tsx`
Expected: FAIL. L'ancien `App` n'a pas de titre « Ledge Desktop » et ouvre l'écran de lancement sur « new ».

- [ ] **Step 9: Supprimer les écrans et leurs tests**

Supprimer les dossiers et fichiers listés sous **Files › Delete** avec `git rm -r`. Dans `test/desktop-prefs.test.tsx`, retirer l'import de `../src/launch/form` et le cas `loadTool` / `saveTool`. La clé `desktop.tool` reste dans la liste des clés gardées et son code reviendra avec le formulaire de session au lot 7.

- [ ] **Step 10: Réduire `src/i18n/messages.ts`**

Dans `fr` et `en`, garder `tray`, `notify`, `status`, `botLabel`, `botReadOnly`, `botNotLive`, `resident`, et retirer toutes les autres clés ainsi que les imports de types devenus inutiles (`../launch/form`, `SshProblem`, `DaemonInfo`, `UpdateFailure`, `SoundCategory`, etc.). Ajouter :

```ts
// fr
waiting: { title: 'Ledge Desktop', text: 'L’Atelier se construit. Ledge suit vos agents en attendant.' },
// en
waiting: { title: 'Ledge Desktop', text: 'The Atelier is being built. Ledge keeps watch over your agents meanwhile.' },
```

Si `tsc` signale qu'un module gardé lit une autre clé (par exemple `notify/alerts.ts` qui lit `states`), on garde cette clé.

- [ ] **Step 11: Écrire `src/shell/Waiting.tsx`**

Un `<section className="waiting">` contenant :
- `ResidentMascot` de `@ledge/ui` ; s'il demande des props difficiles à fournir, le retirer : c'est décoratif ;
- un `<h1>` avec `t.waiting.title` et un `<p>` avec `t.waiting.text` ;
- un `<footer className="statusbar">` qui reprend l'affichage de l'ancien `StatusBar` : `t.status.sessions(sessions.length)`, puis par machine un point (`dot green` ou `dot offline-dot`) suivi de `t.status.connected(label, id === 'local')` ou `t.status.disconnected(…)` quand `status === 'unreachable'`.

- [ ] **Step 12: Réécrire `src/App.tsx`**

`App` garde son corps actuel : `useState(loadLang)`, `document.documentElement.lang`, `useAppearance()`, `LangProvider`. `Shell({ client })` fait seulement ceci :
- `useFleet(client)` ;
- `useAlerts({ sessions, machines, status })` ;
- `onTrayAction(action => { if (action === 'dnd') setDnd(!getDnd()); })` dans un `useEffect` monté une fois ;
- `setTrayLabels({ open, newSession, dnd: dnd ? t.tray.dndOff : t.tray.dnd, quit })` à chaque changement de `t` ou de `dnd` ;
- il rend `<main className="app" data-readonly={localDown ? 'true' : undefined}><Waiting sessions={sessions} machines={machines} /></main>`.

`useDaemonUpdate` n'est pas monté : rien ne peut lancer de mise à jour du daemon avant les Réglages (lot 10).

- [ ] **Step 13: Purger au démarrage et réduire le style**

Dans `src/main.tsx`, appeler `purgeObsolete()` avant `createRoot(…).render(<App />)`. Dans `src/styles/app.css`, garder les imports (`tailwindcss`, `@ledge/ui/styles/base.css`) et les règles de base `:root`, `*`, `body`, `button`, `a`, focus. Garder `.app` (plein écran, sans défilement), `.statusbar`, `.connection` et `.dot`, `.green`, `.offline-dot` si `base.css` ne les fournit pas. Ajouter `.waiting`, centré verticalement et horizontalement, avec le pied de page en bas. Supprimer tout le reste.

- [ ] **Step 14: Tests, typage, build**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`
Expected : tous les tests passent, dont `obsolete`, `app`, `app-tray`, `app-theme` et les fichiers gardés, sans aucun échec. `tsc` ne signale rien et `vite build` produit `dist/`.

- [ ] **Step 15: Vérifier qu'aucun reste ne traîne**

Run: `grep -rnE "team|room|grouping|jira|launch/|conversation/|chat/|attention" apps/desktop/src apps/desktop/test || echo clean; grep -n "purgeObsolete()" apps/desktop/src/main.tsx`
Expected : `clean`, puis une ligne de `main.tsx` qui appelle `purgeObsolete()` avant le rendu. Exception tolérée : `notify/` peut citer « conversation » dans un commentaire.

- [ ] **Step 16: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "refactor(desktop): drop the Team and Meeting screens, keep an empty shell on the real fleet"
```

### Task 2: Démarrage vérifié dans le navigateur et documentation

**Files:**
- Delete: `apps/desktop/e2e/*.spec.ts`
- Create: `apps/desktop/e2e/boot.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` (§ 10)

**Interfaces:**
- Consumes : `fakeDaemon(page, sessions, { machines? })`, `fakeRemote(page, alias, sessions)`, `session(id, extra)`, `eight` (`e2e/daemon.ts`) ; `test`, `expect` (`e2e/fixtures.ts`, anglais, aucune erreur console) ; textes `waiting.title` et `status.*` de la tâche 1.
- Produces : la spec `e2e/boot.spec.ts`, que les lots suivants complètent ou remplacent.

- [ ] **Step 1: Supprimer les anciennes specs et écrire `e2e/boot.spec.ts`**

```ts
test('boots on the local daemon: name, sessions and machine', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ledge Desktop' })).toBeVisible();
  await expect(page.getByText('8 sessions')).toBeVisible();
  await expect(page.getByText('Local connected')).toBeVisible();
});

test('the local daemon goes away: disconnected, then back', async ({ page }) => {
  const d = await fakeDaemon(page, [session('otto')]);
  await page.goto('/');
  await expect(page.getByText('Local connected')).toBeVisible();
  d.close();
  await expect(page.getByText('Local disconnected')).toBeVisible();
});

test('an unreachable remote is disconnected while local stays connected', async ({ page }) => {
  await fakeDaemon(page, [session('otto')], { machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', []);
  remote.close();   // refuses every connection from the start
  await page.goto('/');
  await expect(page.getByText('Local connected')).toBeVisible();
  await expect(page.getByText('Devbox disconnected')).toBeVisible();
});

test('no daemon at all: the shell still opens', async ({ page }) => {
  // no fakeDaemon: route the local socket and close it at once
  await page.routeWebSocket(/127\.0\.0\.1:47831\/?$/, ws => ws.close());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ledge Desktop' })).toBeVisible();
  await expect(page.getByText('Local disconnected')).toBeVisible();
});
```

Si la fermeture du socket déclenche une erreur console de WebSocket dans Chromium, la fixture fera échouer le test. Dans ce cas, reprendre la manière dont l'ancienne `e2e/offline.spec.ts` (`git show origin/feat/desktop:apps/desktop/e2e/offline.spec.ts`) gérait un daemon absent, sans assouplir la fixture.

- [ ] **Step 2: Lancer Playwright**

Run: `pnpm --filter desktop e2e`
Expected : `4 passed`.

- [ ] **Step 3: Noter la décision dans la spec Atelier**

Dans `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` :
- remplacer la phrase d'introduction « Il ne tranche pas encore son articulation avec l'app `apps/desktop` […] : c'est la prochaine décision. » par « Son articulation avec l'app `apps/desktop` de `feat/desktop` est tranchée dans `2026-10-16-ledge-desktop-atelier-build-design.md`. » ;
- au § 10, marquer le point 1 « tranché : l'Atelier remplace Équipe et Réunion, voir le document de construction » et le point 3 « en cours, un plan par lot ».

- [ ] **Step 4: Vérification complète du dépôt**

Run: `cd .worktrees/desktop-atelier && pnpm -r typecheck && pnpm test && pnpm -r build`
Expected : tout passe. L'overlay et les packages ne sont pas touchés par ce lot ; un échec chez eux existait déjà et se signale, sans le corriger ici.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/e2e docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md
git commit -m "test(desktop): the empty shell boots on the real fleet in the browser; docs: the Atelier replaces Team and Meeting"
```
