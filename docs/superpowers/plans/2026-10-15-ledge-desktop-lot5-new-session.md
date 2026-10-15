# Ledge Desktop, lot 5 : nouvelle session — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Nouvelle session » (bouton de la tête, bouton de l'espace vide, entrée du tray) ouvre un écran de lancement qui suit la maquette : formulaire (machine du fleet avec les injoignables désactivées, projet parmi les `recents` de la machine ou dossier personnalisé, navigateur de dossiers sur la machine choisie, harnais par défaut `desktop.tool`, consigne multiligne), écran Démarrage jusqu'au `session.launched` de cette machine puis sélection de la nouvelle session dans son panneau de conversation, écran Échec (erreur du daemon, machine non connectée, connexion perdue, 15 s sans réponse) avec Modifier / Réessayer, Annuler qui ignore un `launched` tardif, et le dernier formulaire non abouti gardé dans `desktop.launch`.

**Architecture:** Tout ce qui se décide sans DOM est pur et testé seul : `launch/form.ts` (clés `desktop.tool` / `desktop.launch`, règle des chemins, formulaire affiché à partir du brouillon et du fleet, validation), `launch/flow.ts` (étapes fermé / formulaire / démarrage / échec, tentative, timeout, annulation, retry) et `launch/folders.ts` (état du navigateur, une requête à la fois). Le hook `useLaunch` relie le déroulé au fleet par `fleet.sendTo(machine, …)` et `fleet.onMachineMessage` (filtré par machine) ; il vit dans le Shell pour qu'une réponse tardive reste ignorée une fois l'écran fermé. Les composants (`LaunchScreen`, `LaunchFormView`, `FolderBrowser`, `LaunchProgress`) suivent le DOM et les classes de la maquette `launch.js` / `journeys.css` ; le navigateur de dossiers, absent de la maquette, réutilise ses champs et bordures.

**Tech Stack:** TypeScript, React 19, Vite 6, Tauri 2.6, vitest 3 + Testing Library + jsdom, Playwright 1.49, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` (§4.4 tray « Nouvelle session » et dossier `launch/`, §6 daemon local injoignable = lecture seule, §7 clés `desktop.tool` et `desktop.launch`, **§9.2 en entier**, §12 vitest « lancement (timeout, annulation, retry) » et Playwright « aucune session », « nouvelle session », « démarrage », « échec du lancement », §13 lot 5). Plan du lot 4 (contrat d'interfaces) : `docs/superpowers/plans/2026-10-15-ledge-desktop-lot4-conversations.md`. Maquette (lecture seule, hors dépôt) : `../ledge-desktop/mockup/assets/launch.js`, `journeys.css` (règles `.launch-*`, `.workspace-empty .primary`), `settings.css` (`.settings-heading`), `../ledge-desktop/HANDOFF.md`. Point reporté : m4 (le tray émet `ledge://tray { action: 'new' }`, l'app l'ignore).

## Global Constraints

- Prérequis : lots 1 à 4 terminés. Branche `desktop/lot5-new-session`, empilée sur le lot 4 : `git checkout desktop/lot4-conversations && git checkout -b desktop/lot5-new-session`.
- **Fichiers du lot 4.** Ce plan décrit `App.tsx`, `messages.ts` et `app.css` dans l'état prévu par le plan du lot 4 (`SplitView`, `ConversationPane`, `useConversations`, `useStored`, `state/storage.ts`, bloc `conversation`). Lire le fichier réel avant de le modifier et appliquer le changement à son état réel ; si un nom diffère, garder celui du dépôt.
- `cargo` est disponible dans ce WSL (`~/.cargo/bin`, `https_proxy=http://192.168.40.2:3128`). **Ce lot ne touche pas au Rust** : `main.rs` affiche déjà la fenêtre (`show_main`) puis émet `ledge://tray { action: 'new' }` pour l'entrée « Nouvelle session » ; `tauri/bridge.ts` expose `onTrayAction`. Les libellés du tray restent en français jusqu'au lot 7 (qui branche aussi « Ne pas déranger »). Pas de porte cargo.
- Portes de chaque tâche : `pnpm -r typecheck`, `pnpm --filter desktop test`, `pnpm --filter desktop exec playwright test` (Playwright sur le port **5299**, toute erreur console ou `pageerror` fait échouer la spec via `e2e/fixtures.ts`).
- L'app remplit la fenêtre (commits 627cdcc, 3ae864a) : on ne porte pas les règles de « page d'étude » de la maquette. L'écran de lancement défile **dans** `.launch-scroll` ; `document.documentElement.scrollHeight` reste égal à la hauteur de la fenêtre (`e2e/layout.spec.ts`, et la spec de la tâche 8).
- Routage (spec §5/§9.2) : `session.launch { tool, cwd, prompt }`, `folder.list { path? }` et `folder.create { parent, name }` partent **uniquement** par `fleet.sendTo(machine, msg)` vers la machine choisie — jamais par `client.send` (qui suit la machine sélectionnée du fleet) ni après `fleet.select()`. Les réponses se lisent par `fleet.onMachineMessage((machine, m) => …)` en filtrant sur la machine ; l'id de `session.launched` est brut et se qualifie par `qualify(machine, id)`.
- Réponse d'un lancement (daemon `server.ts`, `case 'session.launch'`) : `session.launched { id }` ou une `error` **sans `id`**, envoyées au seul demandeur. Une `error` qui porte un `id` concerne une session (réponse, décision du lot 4) et n'est jamais une réponse de lancement.
- Délai : `LAUNCH_TIMEOUT_MS = 15_000` (spec §9.2), relancé à chaque tentative.
- Chemins : accepté s'il est absolu (`/…`) ou commence par `~` (spec §9.2 ; la maquette n'acceptait que l'absolu, la spec l'emporte) ; le daemon fait la validation finale (`resolveFolder`). Longueurs de la maquette : dossier ≤ **500**, consigne ≤ **10 000**.
- Clés `localStorage` de ce lot, relues champ par champ avec repli sur le défaut (spec §7) : `desktop.tool` = chaîne JSON `'claude' | 'codex' | 'cursor'` (défaut `'claude'` ; ce lot la lit, Paramètres l'écrira au lot 7) ; `desktop.launch` = `{ machine: string | null, cwd: string | null, tool, prompt: string }` (`cwd` appartient à `machine` ; `null` = pas encore choisi, le formulaire prend le projet le plus récent), écrit à chaque saisie, effacé **seulement** quand un lancement aboutit (Annuler et Échec le gardent).
- Lecture seule (spec §6) : daemon local injoignable → « Nouvelle session » désactivé et l'entrée du tray ignorée (les machines distantes passent par le daemon local ; le test du lot 3 `keeps New session disabled` reste vert).
- Les écrans de lancement n'utilisent **jamais** `data-session` (les tests du lot 3 comptent `[data-session]`). `role="alert"` : seulement le message de validation et le message d'échec, tous deux dans l'écran de lancement (jamais affiché par `e2e/offline.spec.ts`) ; les erreurs du navigateur de dossiers sont `role="status"`.
- L'île (`apps/overlay`) ne change pas : on n'extrait ni `FolderBrowser.tsx` ni `LaunchView.tsx` (liés à son UI) ; Desktop porte leur logique pure (`childOf`, `crumbs`, requête en attente, repli sur le dossier personnel) dans `launch/folders.ts`, testée.
- Textes en français et en anglais dans `src/i18n/messages.ts` (`fr` source de vérité, `en: typeof fr`) : bloc `launch` et clé `empty.start`.
- Commits : `feat(desktop): …`, `test(desktop): …`.

## Décisions sur les points ouverts de la spec

1. **Consigne obligatoire** (la spec dit seulement « multiligne », le protocole la rend optionnelle) : la maquette la valide (« une consigne non vide ») et l'écran Démarrage la récapitule. Envoyée `trim()`ée.
2. **Le choix du harnais dans le formulaire n'écrit pas `desktop.tool`** : `desktop.tool` est le défaut réglé dans Paramètres (lot 7) ; le choix du formulaire vit dans `desktop.launch` jusqu'au lancement.
3. **Machine mémorisée injoignable ou retirée** : le formulaire prend la première machine prête et son projet le plus récent ; le dossier tapé pour l'autre machine n'est ni affiché ni envoyé ailleurs (le brouillon est gardé tel quel jusqu'à la première modification, qui le rattache à la machine affichée). Une machine `connecting` est désactivée comme une injoignable (`sendTo` la refuserait).
4. **Connexion perdue pendant le Démarrage** (machine plus `ready`) : échec immédiat « connexion perdue, la session a peut-être démarré », plutôt que d'attendre 15 s une réponse qui ne viendra pas sur ce socket.
5. **Réponse tardive** : un Annuler pendant le Démarrage ou un timeout laisse une réponse **due** par cette machine ; le déroulé compte ces réponses dues par machine et saute les premières qui arrivent (le daemon répond dans l'ordre, sur la même connexion), de sorte qu'un `launched` / une `error` tardif n'est jamais pris pour celui d'un Réessayer ou d'un nouveau lancement. Une connexion perdue efface la dette (le daemon répond sur le socket qui a demandé). La session obtenue par une tentative abandonnée reste dans la liste, non sélectionnée.
6. **Sélection de la nouvelle session** une fois qu'elle figure dans la liste (le daemon la diffuse avant de répondre, le fleet peut la publier un instant après) : filtre « À votre attention » coupé, panneau replié, curseur dans `#conversation-reply` (maquette `launch.js`).
7. **Annuler ferme l'écran** (retour aux sessions, spec « ferme l'écran ») ; le déroulé reste dans le Shell. « Retour aux sessions » depuis le formulaire ou l'échec ferme aussi ; le brouillon reste dans `desktop.launch`.
8. **Navigateur de dossiers** (absent de la maquette) : panneau sous le champ « Dossier de travail », ouvert par « Parcourir… », une requête à la fois (un clic pendant une attente est ignoré), ouvert sur le dossier du champ s'il est accepté, sinon sur le dossier personnel ; un premier dossier illisible retombe sur le dossier personnel (comme l'île).
9. **Tray** : aucun changement Rust ; l'app écoute `onTrayAction('new')`. Libellés FR jusqu'au lot 7.

## Review Focus

1. **Double clic** sur « Démarrer la session » ou « Réessayer » : un seul `session.launch` part (un départ pendant un démarrage est ignoré). Test ajouté aux tâches 2 et 3.
2. Une **réponse qui n'est pas celle du lancement** — `error` portant l'`id` d'une session (échec d'une réponse du lot 4), `error` / `session.launched` / `folder.listing` d'**une autre machine**, `folder.listing` que personne n'attend — ne fait ni échouer, ni aboutir, ni naviguer. Tests ajoutés aux tâches 3 et 4.
3. **Machine perdue** pendant le Démarrage ou pendant une requête du navigateur : échec ou message immédiat, rien ne reste « en attente » pour toujours. Tests ajoutés aux tâches 2, 3 et 4.
4. `desktop.launch` ou `desktop.tool` **corrompus** (`"vim"`, `[1,2]`, `{ "machine": 3 }`, consigne de 10 001 caractères, JSON invalide) : l'écran s'ouvre sur les défauts sans exception, garde ce qui est valide champ par champ et ne touche pas aux autres clés. Test ajouté à la tâche 1.
5. **Machine mémorisée ou choisie qui tombe** avant l'envoi : le formulaire bascule sur une machine prête et son projet ; le dossier tapé pour la machine tombée n'est jamais envoyé à une autre. Tests ajoutés aux tâches 1 et 5.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/desktop/src/launch/form.ts` | `desktop.tool`, `desktop.launch`, règle des chemins, formulaire affiché, validation (pur) |
| `apps/desktop/src/launch/flow.ts` | Déroulé du lancement : étapes, tentative, timeout, annulation, retry (pur) |
| `apps/desktop/src/launch/useLaunch.ts` | Hook : `sendTo` / `onMachineMessage`, minuterie 15 s, machine perdue |
| `apps/desktop/src/launch/folders.ts` | État du navigateur de dossiers, chemins, fil d'Ariane (pur) |
| `apps/desktop/src/launch/FolderBrowser.tsx` | Navigateur de dossiers sur la machine choisie |
| `apps/desktop/src/launch/LaunchFormView.tsx` | Formulaire (maquette `launch.js`) |
| `apps/desktop/src/launch/LaunchProgress.tsx` | Écrans Démarrage et Échec |
| `apps/desktop/src/launch/LaunchScreen.tsx` | Tête de l'écran, notices, défilement, brouillon `desktop.launch` |
| `apps/desktop/src/shell/Heading.tsx` (modifier) | Bouton « Nouvelle session » actif |
| `apps/desktop/src/shell/EmptyWorkspace.tsx` (modifier) | Bouton « Démarrer une session » |
| `apps/desktop/src/App.tsx` (modifier) | Shell : `useLaunch`, écran de lancement, tray, sélection de la nouvelle session |
| `apps/desktop/src/i18n/messages.ts` (modifier) | Bloc `launch` et `empty.start`, fr/en |
| `apps/desktop/src/styles/app.css` (modifier) | Port des règles `.launch-*` de `journeys.css`, `.settings-heading`, navigateur |
| `apps/desktop/test/launch-helpers.ts` | Faux fleet et machines pour les tests |
| `apps/desktop/test/launch-form.test.ts`, `launch-flow.test.ts`, `use-launch.test.tsx`, `folder-browser.test.tsx`, `launch-screen.test.tsx`, `app-launch.test.tsx`, `app-tray.test.tsx` | vitest |
| `apps/desktop/test/team-view.test.tsx` (modifier) | Bouton de la tête branché |
| `apps/desktop/e2e/daemon.ts` (modifier) | `recents` dans les snapshots, `received` / `push` pour la machine distante |
| `apps/desktop/e2e/launch.spec.ts` | Playwright : aucune session, nouvelle session, démarrage, échec, annulation, mise en page |

---
### Task 1: Formulaire de lancement : clés, chemins, formulaire affiché, validation

Tout ce que le formulaire décide sans DOM : les clés `desktop.tool` et `desktop.launch` relues champ par champ (spec §7), la règle des chemins (spec §9.2), le formulaire affiché à partir du brouillon et du fleet (machine prête, projets récents de cette machine) et la validation avant envoi.

**Files:**
- Create: `apps/desktop/src/launch/form.ts`, `apps/desktop/test/launch-helpers.ts`
- Test: `apps/desktop/test/launch-form.test.ts`

**Interfaces:**
- Consumes: `isRecord`, `readJson`, `writeJson` (`src/state/storage.ts`, lot 4 tâche 3) ; `MachineState` de `@ledge/fleet` ; `Recent`, `Tool`, `ClientMessage`, `ServerMessage` de `@ledge/protocol`.
- Produces :
  - `TOOLS: readonly Tool[]`, `isTool(v: unknown): v is Tool`, `TOOL_KEY = 'desktop.tool'`, `LAUNCH_KEY = 'desktop.launch'`, `CWD_MAX = 500`, `PROMPT_MAX = 10_000`, `CUSTOM = 'custom'` ;
  - `loadTool(): Tool` ;
  - `interface LaunchDraft { machine: string | null; cwd: string | null; tool: Tool; prompt: string }`, `emptyDraft(): LaunchDraft`, `loadLaunch(): LaunchDraft`, `saveLaunch(d: LaunchDraft): void`, `clearLaunch(): void` ;
  - `isPathAccepted(cwd: string): boolean` ;
  - `recentsOf(m: MachineState | undefined): Recent[]` (plus récent d'abord, un par dossier) ;
  - `interface LaunchForm { machine: string | null; cwd: string; tool: Tool; prompt: string }`, `resolveForm(d: LaunchDraft, machines: MachineState[]): LaunchForm`, `editDraft(form: LaunchForm, patch: Partial<LaunchDraft>): LaunchDraft` ;
  - `interface LaunchRequest { machine: string; tool: Tool; cwd: string; prompt: string }`, `type LaunchProblem = 'machine' | 'cwd' | 'prompt'`, `checkForm(form: LaunchForm, machines: MachineState[]): { ok: true; request: LaunchRequest } | { ok: false; problem: LaunchProblem }` ;
  - `type Availability = 'ready' | 'connecting' | 'unreachable'`, `availability(m: MachineState): Availability` ;
  - test : `machine(id, extra?)`, `recent(cwd, lastAt, project?)`, `fakeFleet(down?)` → `{ sent, offline, sendTo, onMachineMessage, emit, listeners }`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/launch-helpers.ts` (partagé par les tâches 1 à 6) :

```ts
import type { MachineState } from '@ledge/fleet';
import type { ClientMessage, Recent, ServerMessage } from '@ledge/protocol';

/** A machine as the fleet publishes it: ready unless told otherwise; remotes get an SSH alias. */
export function machine(id: string, extra: Partial<MachineState> = {}): MachineState {
  const label = id === 'local' ? 'Local' : id[0]!.toUpperCase() + id.slice(1);
  return { id, label, ...(id === 'local' ? {} : { ssh: id }), status: 'open', ready: true, recents: [], sessions: [], launcher: null, ...extra };
}
export const recent = (cwd: string, lastAt: string, project = cwd.split('/').pop() ?? cwd): Recent => ({ cwd, project, lastAt });

/** The two fleet calls the launch uses. `offline` lists the machines `sendTo` refuses; `emit` plays a daemon message from one machine. */
export function fakeFleet(down: string[] = []) {
  const sent: { machine: string; msg: ClientMessage }[] = [];
  const listeners = new Set<(machine: string, m: ServerMessage) => void>();
  const offline = new Set(down);
  return {
    sent, offline, listeners,
    sendTo(machine: string, msg: ClientMessage): boolean { if (offline.has(machine)) return false; sent.push({ machine, msg }); return true; },
    onMachineMessage(fn: (machine: string, m: ServerMessage) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    emit(machine: string, m: ServerMessage): void { for (const fn of [...listeners]) fn(machine, m); }
  };
}
export type FakeFleet = ReturnType<typeof fakeFleet>;
```

`apps/desktop/test/launch-form.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  availability, checkForm, clearLaunch, editDraft, emptyDraft, isPathAccepted, LAUNCH_KEY, loadLaunch, loadTool, recentsOf, resolveForm, saveLaunch, TOOL_KEY
} from '../src/launch/form';
import { machine, recent } from './launch-helpers';

const local = machine('local', { recents: [recent('/w/website', '2026-10-14T10:00:00.000Z'), recent('/w/ledge', '2026-10-15T09:00:00.000Z')] });
const devbox = machine('devbox', { recents: [recent('/home/dev/api', '2026-10-15T08:00:00.000Z')] });
beforeEach(() => localStorage.clear());

describe('desktop.tool', () => {
  it('defaults to Claude Code and keeps a known harness', () => {
    expect(loadTool()).toBe('claude');
    localStorage.setItem(TOOL_KEY, JSON.stringify('codex'));
    expect(loadTool()).toBe('codex');
  });
  it('falls back on anything else', () => {
    for (const raw of ['"vim"', '[1,2]', '{', '3']) { localStorage.setItem(TOOL_KEY, raw); expect(loadTool()).toBe('claude'); }
  });
});

describe('desktop.launch', () => {
  it('starts empty with the default harness', () => {
    localStorage.setItem(TOOL_KEY, JSON.stringify('cursor'));
    expect(loadLaunch()).toEqual({ machine: null, cwd: null, tool: 'cursor', prompt: '' });
    expect(emptyDraft().tool).toBe('cursor');
  });
  it('round-trips a draft and clears it', () => {
    saveLaunch({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Run the tests\nthen report' });
    expect(loadLaunch()).toEqual({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Run the tests\nthen report' });
    clearLaunch();
    expect(localStorage.getItem(LAUNCH_KEY)).toBeNull();
  });
  it('reads a corrupted value field by field and never touches other keys', () => {
    localStorage.setItem('desktop.view', '{"view":"team"}');
    for (const raw of ['{', '[1,2]', '"x"', 'null']) { localStorage.setItem(LAUNCH_KEY, raw); expect(loadLaunch()).toEqual(emptyDraft()); }
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 3, cwd: '/w/x', tool: 'vim', prompt: 'a'.repeat(10_001) }));
    expect(loadLaunch()).toEqual({ machine: null, cwd: null, tool: 'claude', prompt: '' });
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'local', cwd: 'x'.repeat(501), tool: 'cursor', prompt: 'Hi' }));
    expect(loadLaunch()).toEqual({ machine: 'local', cwd: null, tool: 'cursor', prompt: 'Hi' });
    expect(localStorage.getItem('desktop.view')).toBe('{"view":"team"}');
  });
});

describe('path rule (spec §9.2)', () => {
  it('accepts an absolute path or one starting with ~', () => {
    for (const p of ['/', '/w/ledge', '~', '~/w', '~dev/w', '  /w/ledge  ']) expect(isPathAccepted(p)).toBe(true);
  });
  it('refuses the rest, and anything over 500 characters', () => {
    for (const p of ['', '   ', 'w/ledge', './ledge', '../x', 'C:\\w']) expect(isPathAccepted(p)).toBe(false);
    expect(isPathAccepted('/' + 'a'.repeat(500))).toBe(false);
  });
});

describe('the form shown', () => {
  it('lists a machine\'s recents newest first, one per folder', () => {
    const twice = machine('local', { recents: [recent('/w/a', '2026-10-01T00:00:00.000Z'), recent('/w/b', '2026-10-03T00:00:00.000Z'), recent('/w/a', '2026-10-02T00:00:00.000Z')] });
    expect(recentsOf(twice).map(r => r.cwd)).toEqual(['/w/b', '/w/a']);
    expect(recentsOf(undefined)).toEqual([]);
  });
  it('opens on the first ready machine and its latest project', () => {
    expect(resolveForm(emptyDraft(), [local, devbox])).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'claude', prompt: '' });
    expect(resolveForm(emptyDraft(), [machine('local', { ready: false, status: 'unreachable' }), devbox]).machine).toBe('devbox');
  });
  it('keeps the remembered machine and folder while that machine is ready', () => {
    const d = { machine: 'devbox', cwd: '~/w/api', tool: 'codex' as const, prompt: 'Go' };
    expect(resolveForm(d, [local, devbox])).toEqual({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Go' });
    expect(resolveForm({ ...d, cwd: '' }, [local, devbox]).cwd).toBe('');
    expect(resolveForm({ ...d, cwd: null }, [local, devbox]).cwd).toBe('/home/dev/api');
  });
  it('never carries a folder typed for a fallen machine to another one', () => {
    const d = { machine: 'devbox', cwd: '~/w/api', tool: 'codex' as const, prompt: 'Go' };
    const down = machine('devbox', { ready: false, status: 'unreachable', recents: devbox.recents });
    expect(resolveForm(d, [local, down])).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'codex', prompt: 'Go' });
    expect(resolveForm(d, [local])).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'codex', prompt: 'Go' });
    expect(resolveForm(d, [machine('local', { ready: false, status: 'connecting' })])).toEqual({ machine: null, cwd: '', tool: 'codex', prompt: 'Go' });
  });
  it('an edit freezes what is shown, then applies the change', () => {
    const shown = resolveForm(emptyDraft(), [local, devbox]);
    expect(editDraft(shown, { prompt: 'Hi' })).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'claude', prompt: 'Hi' });
    expect(editDraft(shown, { machine: 'devbox', cwd: null })).toEqual({ machine: 'devbox', cwd: null, tool: 'claude', prompt: '' });
  });
  it('tells a ready machine from one that is connecting or down', () => {
    expect(availability(local)).toBe('ready');
    expect(availability(machine('devbox', { ready: false, status: 'open' }))).toBe('connecting');
    expect(availability(machine('devbox', { ready: false, status: 'connecting' }))).toBe('connecting');
    expect(availability(machine('devbox', { ready: false, status: 'unreachable' }))).toBe('unreachable');
  });
});

describe('checkForm', () => {
  const ok = { machine: 'local', cwd: '  ~/w/ledge ', tool: 'cursor' as const, prompt: '\n Fix the build \n' };
  it('sends the trimmed folder and instruction to the chosen machine', () => {
    expect(checkForm(ok, [local, devbox])).toEqual({ ok: true, request: { machine: 'local', tool: 'cursor', cwd: '~/w/ledge', prompt: 'Fix the build' } });
  });
  it('names the first problem', () => {
    expect(checkForm({ ...ok, machine: null }, [local])).toEqual({ ok: false, problem: 'machine' });
    expect(checkForm({ ...ok, machine: 'devbox' }, [local, machine('devbox', { ready: false, status: 'unreachable' })])).toEqual({ ok: false, problem: 'machine' });
    expect(checkForm({ ...ok, machine: 'gone' }, [local])).toEqual({ ok: false, problem: 'machine' });
    expect(checkForm({ ...ok, cwd: 'w/ledge' }, [local])).toEqual({ ok: false, problem: 'cwd' });
    expect(checkForm({ ...ok, prompt: '  \n ' }, [local])).toEqual({ ok: false, problem: 'prompt' });
    expect(checkForm({ ...ok, prompt: 'a'.repeat(10_001) }, [local])).toEqual({ ok: false, problem: 'prompt' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test launch-form`
Expected: FAIL « Failed to resolve import "../src/launch/form" ».

- [ ] **Step 3: Implement**

`apps/desktop/src/launch/form.ts` :

```ts
import type { MachineState } from '@ledge/fleet';
import type { Recent, Tool } from '@ledge/protocol';
import { isRecord, readJson, writeJson } from '../state/storage';

export const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor'];
export const isTool = (v: unknown): v is Tool => typeof v === 'string' && (TOOLS as readonly string[]).includes(v);
/** The default harness (spec §7). Settings writes it (lot 7); the form only reads it. */
export const TOOL_KEY = 'desktop.tool';
/** The last form that did not launch (spec §7). */
export const LAUNCH_KEY = 'desktop.launch';
/** The mockup's limits (launch.js: maxlength). */
export const CWD_MAX = 500;
export const PROMPT_MAX = 10_000;
/** The project select's « Autre dossier… » option. */
export const CUSTOM = 'custom';

export function loadTool(): Tool {
  const v = readJson(TOOL_KEY);
  return isTool(v) ? v : 'claude';
}

/** What was typed and not launched. `cwd` belongs to `machine`; null until typed or picked there (the form then shows the latest project). */
export interface LaunchDraft { machine: string | null; cwd: string | null; tool: Tool; prompt: string }
export const emptyDraft = (): LaunchDraft => ({ machine: null, cwd: null, tool: loadTool(), prompt: '' });

/** Field by field, each with its fallback (spec §7): a bad field never costs the others. */
export function loadLaunch(): LaunchDraft {
  const d = emptyDraft();
  const raw = readJson(LAUNCH_KEY);
  if (!isRecord(raw)) return d;
  const machine = typeof raw.machine === 'string' && raw.machine ? raw.machine : null;
  return {
    machine,
    cwd: machine && typeof raw.cwd === 'string' && raw.cwd.length <= CWD_MAX ? raw.cwd : null,
    tool: isTool(raw.tool) ? raw.tool : d.tool,
    prompt: typeof raw.prompt === 'string' && raw.prompt.length <= PROMPT_MAX ? raw.prompt : ''
  };
}
export function saveLaunch(d: LaunchDraft): void { writeJson(LAUNCH_KEY, d); }
/** Only a launch that succeeded forgets the form. */
export function clearLaunch(): void {
  try { localStorage.removeItem(LAUNCH_KEY); } catch { /* storage unavailable: nothing to forget */ }
}

/** Spec §9.2: absolute, or starting with `~`; the daemon does the final check (`resolveFolder`). */
export function isPathAccepted(cwd: string): boolean {
  const p = cwd.trim();
  return p.length > 0 && p.length <= CWD_MAX && (p.startsWith('/') || p.startsWith('~'));
}

/** The machine's past folders, newest first, one per folder (the project select). */
export function recentsOf(m: MachineState | undefined): Recent[] {
  const seen = new Set<string>();
  return [...(m?.recents ?? [])].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).filter(r => !seen.has(r.cwd) && !!seen.add(r.cwd));
}

/** What the form shows: the remembered machine while it is ready, else the first ready one; its folder only on its own machine. */
export interface LaunchForm { machine: string | null; cwd: string; tool: Tool; prompt: string }
export function resolveForm(d: LaunchDraft, machines: MachineState[]): LaunchForm {
  const own = machines.find(m => m.id === d.machine && m.ready);
  const target = own ?? machines.find(m => m.ready);
  const cwd = own && d.cwd !== null ? d.cwd : (recentsOf(target)[0]?.cwd ?? '');
  return { machine: target?.id ?? null, cwd, tool: d.tool, prompt: d.prompt };
}
/** An edit keeps what the person sees (a fallback machine, a suggested project), then applies the change. */
export function editDraft(form: LaunchForm, patch: Partial<LaunchDraft>): LaunchDraft {
  return { machine: form.machine, cwd: form.cwd, tool: form.tool, prompt: form.prompt, ...patch };
}

export interface LaunchRequest { machine: string; tool: Tool; cwd: string; prompt: string }
export type LaunchProblem = 'machine' | 'cwd' | 'prompt';
/** The mockup's checks, in its order: a connected machine, an accepted folder, a non-empty instruction. */
export function checkForm(form: LaunchForm, machines: MachineState[]): { ok: true; request: LaunchRequest } | { ok: false; problem: LaunchProblem } {
  if (!form.machine || !machines.some(m => m.id === form.machine && m.ready)) return { ok: false, problem: 'machine' };
  if (!isPathAccepted(form.cwd)) return { ok: false, problem: 'cwd' };
  const prompt = form.prompt.trim();
  if (!prompt || form.prompt.length > PROMPT_MAX) return { ok: false, problem: 'prompt' };
  return { ok: true, request: { machine: form.machine, tool: form.tool, cwd: form.cwd.trim(), prompt } };
}

/** `sendTo` only reaches a ready machine; one that is open but has not sent its snapshot is still connecting. */
export type Availability = 'ready' | 'connecting' | 'unreachable';
export function availability(m: MachineState): Availability {
  return m.ready ? 'ready' : m.status === 'unreachable' ? 'unreachable' : 'connecting';
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test launch-form && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/launch/form.ts apps/desktop/test/launch-helpers.ts apps/desktop/test/launch-form.test.ts
git commit -m "feat(desktop): launch form state, desktop.tool and desktop.launch"
```

---

### Task 2: Déroulé du lancement (pur)

Les étapes de l'écran (fermé, formulaire, démarrage, échec) et les règles de la spec §9.2 : une tentative à la fois, 15 s par tentative, Réessayer renvoie la même requête, Annuler ferme l'écran et la réponse due par la tentative abandonnée est sautée, connexion perdue = échec immédiat.

**Files:**
- Create: `apps/desktop/src/launch/flow.ts`
- Test: `apps/desktop/test/launch-flow.test.ts`

**Interfaces:**
- Consumes: `LaunchRequest` (tâche 1).
- Produces :
  - `LAUNCH_TIMEOUT_MS = 15_000` ;
  - `type LaunchError = { kind: 'daemon'; message: string } | { kind: 'offline' } | { kind: 'lost' } | { kind: 'timeout' }` ;
  - `type LaunchStage = 'closed' | 'form' | 'starting' | 'failed'` ;
  - `interface Flow { stage: LaunchStage; request: LaunchRequest | null; error: LaunchError | null; attempt: number; late: Record<string, number> }`, `START: Flow` ;
  - `type FlowEvent = { type: 'open' } | { type: 'close' } | { type: 'edit' } | { type: 'start'; request: LaunchRequest } | { type: 'retry' } | { type: 'unsent' } | { type: 'launched'; machine: string; id: string } | { type: 'refused'; machine: string; message: string } | { type: 'timeout'; attempt: number } | { type: 'dropped'; machine: string }` ;
  - `step(f: Flow, e: FlowEvent): { flow: Flow; send?: LaunchRequest; launched?: string }` — `flow` est le même objet quand rien ne change ; `send` = la requête à envoyer ; `launched` = l'id (déjà qualifié par l'appelant) de la session créée.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/launch-flow.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { START, step, type Flow, type FlowEvent } from '../src/launch/flow';
import type { LaunchRequest } from '../src/launch/form';

const req: LaunchRequest = { machine: 'devbox', tool: 'codex', cwd: '~/w/api', prompt: 'Run the tests' };
const run = (events: FlowEvent[], from: Flow = START) => events.reduce((f, e) => step(f, e).flow, from);
const starting = run([{ type: 'open' }, { type: 'start', request: req }]);

describe('launch flow', () => {
  it('opens on the form and sends the request once', () => {
    const form = step(START, { type: 'open' }).flow;
    expect(form).toMatchObject({ stage: 'form', request: null, error: null });
    const s = step(form, { type: 'start', request: req });
    expect(s.send).toEqual(req);
    expect(s.flow).toMatchObject({ stage: 'starting', request: req, attempt: 1 });
    const again = step(s.flow, { type: 'start', request: req });   // a double click
    expect(again.flow).toBe(s.flow);
    expect(again.send).toBeUndefined();
  });
  it('open while the screen is up changes nothing', () => {
    expect(step(starting, { type: 'open' }).flow).toBe(starting);
  });
  it('the chosen machine\'s launched closes the screen and names the session', () => {
    const s = step(starting, { type: 'launched', machine: 'devbox', id: 'devbox:ari' });
    expect(s.launched).toBe('devbox:ari');
    expect(s.flow).toMatchObject({ stage: 'closed', request: null });
  });
  it('another machine\'s answers change nothing', () => {
    expect(step(starting, { type: 'launched', machine: 'local', id: 'local:x' }).flow).toBe(starting);
    expect(step(starting, { type: 'refused', machine: 'local', message: 'no' }).flow).toBe(starting);
    expect(step(starting, { type: 'dropped', machine: 'local' }).flow).toBe(starting);
  });
  it('a daemon error, an unsent request and a lost connection fail with their reason', () => {
    expect(step(starting, { type: 'refused', machine: 'devbox', message: 'no such folder: ~/w/api' }).flow)
      .toMatchObject({ stage: 'failed', error: { kind: 'daemon', message: 'no such folder: ~/w/api' }, request: req });
    expect(step(starting, { type: 'unsent' }).flow).toMatchObject({ stage: 'failed', error: { kind: 'offline' }, late: {} });
    expect(step(starting, { type: 'dropped', machine: 'devbox' }).flow).toMatchObject({ stage: 'failed', error: { kind: 'lost' }, late: {} });
  });
  it('times out only the attempt it was armed for, and the answer it owes is skipped', () => {
    expect(step(starting, { type: 'timeout', attempt: 0 }).flow).toBe(starting);
    const failed = step(starting, { type: 'timeout', attempt: 1 }).flow;
    expect(failed).toMatchObject({ stage: 'failed', error: { kind: 'timeout' }, late: { devbox: 1 } });
    const retried = step(failed, { type: 'retry' });
    expect(retried.send).toEqual(req);
    expect(retried.flow).toMatchObject({ stage: 'starting', attempt: 2, error: null });
    const skipped = step(retried.flow, { type: 'launched', machine: 'devbox', id: 'devbox:first' });
    expect(skipped.launched).toBeUndefined();
    expect(skipped.flow).toMatchObject({ stage: 'starting', late: {} });
    expect(step(skipped.flow, { type: 'launched', machine: 'devbox', id: 'devbox:second' }).launched).toBe('devbox:second');
  });
  it('Edit returns to the form; Retry only from a failure', () => {
    const failed = step(starting, { type: 'refused', machine: 'devbox', message: 'x' }).flow;
    expect(step(failed, { type: 'edit' }).flow).toMatchObject({ stage: 'form', error: null });
    expect(step(starting, { type: 'retry' }).flow).toBe(starting);
    expect(step(starting, { type: 'edit' }).flow).toBe(starting);
  });
  it('Cancel closes the screen and skips the cancelled attempt\'s answer, not the next one\'s', () => {
    const closed = step(starting, { type: 'close' }).flow;
    expect(closed).toMatchObject({ stage: 'closed', request: null, late: { devbox: 1 } });
    const late = step(closed, { type: 'launched', machine: 'devbox', id: 'devbox:late' });
    expect(late.launched).toBeUndefined();
    expect(late.flow.late).toEqual({});
    const next = run([{ type: 'open' }, { type: 'start', request: req }], closed);
    expect(step(next, { type: 'refused', machine: 'devbox', message: 'late refusal' }).flow).toMatchObject({ stage: 'starting', late: {} });
  });
  it('a lost connection clears what that machine owed', () => {
    const closed = step(starting, { type: 'close' }).flow;
    expect(step(closed, { type: 'dropped', machine: 'devbox' }).flow.late).toEqual({});
    expect(step(closed, { type: 'dropped', machine: 'local' }).flow).toBe(closed);
  });
  it('closing from the form or a failure owes nothing', () => {
    expect(step(run([{ type: 'open' }]), { type: 'close' }).flow).toMatchObject({ stage: 'closed', late: {} });
    const failed = step(starting, { type: 'unsent' }).flow;
    expect(step(failed, { type: 'close' }).flow).toMatchObject({ stage: 'closed', late: {} });
    expect(step(START, { type: 'close' }).flow).toBe(START);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test launch-flow`
Expected: FAIL « Failed to resolve import "../src/launch/flow" ».

- [ ] **Step 3: Implement**

`apps/desktop/src/launch/flow.ts` :

```ts
import type { LaunchRequest } from './form';

/** Spec §9.2: no `session.launched` within 15 s is a failure. */
export const LAUNCH_TIMEOUT_MS = 15_000;

export type LaunchError = { kind: 'daemon'; message: string } | { kind: 'offline' } | { kind: 'lost' } | { kind: 'timeout' };
export type LaunchStage = 'closed' | 'form' | 'starting' | 'failed';
export interface Flow {
  stage: LaunchStage;
  /** The request being started or that failed (Retry sends it again); null on the form. */
  request: LaunchRequest | null;
  error: LaunchError | null;
  /** Bumped on every send: a timeout only fails the attempt it was armed for. */
  attempt: number;
  /** Answers still owed by cancelled or timed-out attempts, per machine. The daemon answers in order on one connection,
   *  so the next ones from that machine are theirs: skipped, never taken for a newer attempt's. */
  late: Record<string, number>;
}
export const START: Flow = { stage: 'closed', request: null, error: null, attempt: 0, late: {} };

export type FlowEvent =
  | { type: 'open' } | { type: 'close' } | { type: 'edit' }
  | { type: 'start'; request: LaunchRequest } | { type: 'retry' } | { type: 'unsent' }
  | { type: 'launched'; machine: string; id: string } | { type: 'refused'; machine: string; message: string }
  | { type: 'timeout'; attempt: number } | { type: 'dropped'; machine: string };
export interface Step { flow: Flow; send?: LaunchRequest; launched?: string }

const owe = (late: Record<string, number>, machine: string) => ({ ...late, [machine]: (late[machine] ?? 0) + 1 });
function settle(late: Record<string, number>, machine: string, all = false): Record<string, number> {
  const next = { ...late };
  const left = all ? 0 : (late[machine] ?? 0) - 1;
  if (left > 0) next[machine] = left; else delete next[machine];
  return next;
}
const send = (f: Flow, request: LaunchRequest): Step =>
  ({ flow: { ...f, stage: 'starting', request, error: null, attempt: f.attempt + 1 }, send: request });

/** One event at a time; `flow` is the same object when nothing changes. */
export function step(f: Flow, e: FlowEvent): Step {
  switch (e.type) {
    case 'open': return { flow: f.stage === 'closed' ? { ...f, stage: 'form', request: null, error: null } : f };
    case 'close': {
      if (f.stage === 'closed') return { flow: f };
      // Cancelling a start closes the screen; the daemon may still answer, and that answer is skipped (spec §9.2).
      const late = f.stage === 'starting' && f.request ? owe(f.late, f.request.machine) : f.late;
      return { flow: { ...f, stage: 'closed', request: null, error: null, late } };
    }
    case 'edit': return { flow: f.stage === 'failed' ? { ...f, stage: 'form', error: null } : f };
    case 'start': return f.stage === 'form' ? send(f, e.request) : { flow: f };
    case 'retry': return f.stage === 'failed' && f.request ? send(f, f.request) : { flow: f };
    case 'unsent': return { flow: f.stage === 'starting' ? { ...f, stage: 'failed', error: { kind: 'offline' } } : f };
    case 'launched':
    case 'refused': {
      if (f.late[e.machine]) return { flow: { ...f, late: settle(f.late, e.machine) } };
      if (f.stage !== 'starting' || f.request?.machine !== e.machine) return { flow: f };
      if (e.type === 'launched') return { flow: { ...f, stage: 'closed', request: null, error: null }, launched: e.id };
      return { flow: { ...f, stage: 'failed', error: { kind: 'daemon', message: e.message } } };
    }
    case 'timeout':
      if (f.stage !== 'starting' || e.attempt !== f.attempt || !f.request) return { flow: f };
      return { flow: { ...f, stage: 'failed', error: { kind: 'timeout' }, late: owe(f.late, f.request.machine) } };
    case 'dropped': {
      // The daemon answers on the socket that asked: once it is gone, nothing more will come from that attempt.
      const owed = e.machine in f.late;
      const lost = f.stage === 'starting' && f.request?.machine === e.machine;
      if (!owed && !lost) return { flow: f };
      const late = owed ? settle(f.late, e.machine, true) : f.late;
      return { flow: lost ? { ...f, late, stage: 'failed', error: { kind: 'lost' } } : { ...f, late } };
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test launch-flow && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/launch/flow.ts apps/desktop/test/launch-flow.test.ts
git commit -m "feat(desktop): launch flow with timeout, cancel and retry"
```

---

### Task 3: Hook `useLaunch` : envoi à la machine choisie, minuterie, machine perdue

Relie le déroulé au fleet. `session.launch` part par `fleet.sendTo(machine, …)` (jamais `client.send`) ; les réponses se lisent par `fleet.onMachineMessage`. Le hook vit dans le Shell (tâche 6) : fermer l'écran ne l'arrête pas, la dette d'une tentative annulée reste comptée.

**Files:**
- Create: `apps/desktop/src/launch/useLaunch.ts`
- Test: `apps/desktop/test/use-launch.test.tsx`

**Interfaces:**
- Consumes: `step`, `START`, `LAUNCH_TIMEOUT_MS`, `Flow`, `FlowEvent` (tâche 2) ; `LaunchRequest` (tâche 1) ; `qualify(machine, id)`, `Fleet`, `MachineState` de `@ledge/fleet` ; `fakeFleet`, `machine` (tâche 1, tests).
- Produces :
  - `type LaunchFleet = Pick<Fleet, 'sendTo' | 'onMachineMessage'>` ;
  - `interface LaunchApi { flow: Flow; open(): void; close(): void; launch(request: LaunchRequest): void; retry(): void; edit(): void }` (fonctions stables d'un rendu à l'autre) ;
  - `useLaunch(fleet: LaunchFleet, machines: MachineState[], onLaunched: (id: string) => void): LaunchApi` — `onLaunched` reçoit l'id **qualifié** (`devbox:ari`).

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/use-launch.test.tsx` :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MachineState } from '@ledge/fleet';
import { useLaunch } from '../src/launch/useLaunch';
import type { LaunchRequest } from '../src/launch/form';
import { fakeFleet, machine } from './launch-helpers';

const req: LaunchRequest = { machine: 'devbox', tool: 'codex', cwd: '~/w/api', prompt: 'Run the tests' };
const wire = { type: 'session.launch', tool: 'codex', cwd: '~/w/api', prompt: 'Run the tests' };
const both = [machine('local'), machine('devbox')];

function setup(f = fakeFleet(), machines: MachineState[] = both) {
  const launched = vi.fn();
  const hook = renderHook(({ ms }) => useLaunch(f, ms, launched), { initialProps: { ms: machines } });
  const api = () => hook.result.current;
  const start = () => act(() => { api().open(); api().launch(req); });
  return { f, launched, hook, api, start };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useLaunch', () => {
  it('sends session.launch to the chosen machine only, once however often it is asked', () => {
    const { f, api, start } = setup();
    start();
    act(() => api().launch(req));
    expect(f.sent).toEqual([{ machine: 'devbox', msg: wire }]);
    expect(api().flow.stage).toBe('starting');
  });
  it('the chosen machine\'s launched closes the screen with the qualified id', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => f.emit('devbox', { type: 'session.launched', id: 'a/b' }));
    expect(launched).toHaveBeenCalledWith('devbox:a%2Fb');
    expect(api().flow.stage).toBe('closed');
  });
  it('ignores answers that are not this launch\'s', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => {
      f.emit('local', { type: 'session.launched', id: 'x' });
      f.emit('local', { type: 'error', message: 'local refused' });
      f.emit('devbox', { type: 'error', id: 'nova', message: 'reply failed' });   // a session command's error (lot 4)
      f.emit('devbox', { type: 'folder.listing', path: '/', parent: null, entries: [] });
    });
    expect(launched).not.toHaveBeenCalled();
    expect(api().flow.stage).toBe('starting');
  });
  it('a daemon error fails with its message; Retry sends the identical request', () => {
    const { f, api, start } = setup();
    start();
    act(() => f.emit('devbox', { type: 'error', message: 'no such folder: ~/w/api' }));
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'daemon', message: 'no such folder: ~/w/api' } });
    act(() => api().retry());
    expect(f.sent).toEqual([{ machine: 'devbox', msg: wire }, { machine: 'devbox', msg: wire }]);
    expect(api().flow.stage).toBe('starting');
  });
  it('fails after exactly 15 s without an answer, and a late launched never passes for the retry\'s', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => vi.advanceTimersByTime(14_999));
    expect(api().flow.stage).toBe('starting');
    act(() => vi.advanceTimersByTime(1));
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'timeout' } });
    act(() => api().retry());
    act(() => f.emit('devbox', { type: 'session.launched', id: 'first' }));
    expect(launched).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(api().flow.stage).toBe('starting');   // the retry has its own 15 s
    act(() => f.emit('devbox', { type: 'session.launched', id: 'second' }));
    expect(launched).toHaveBeenCalledWith('devbox:second');
  });
  it('Cancel closes the screen and ignores the late launched; the next launch gets its own', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => api().close());
    expect(api().flow.stage).toBe('closed');
    act(() => f.emit('devbox', { type: 'session.launched', id: 'late' }));
    expect(launched).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20_000));
    expect(api().flow.stage).toBe('closed');   // no timeout fires on a closed screen
    start();
    act(() => f.emit('devbox', { type: 'session.launched', id: 'next' }));
    expect(launched).toHaveBeenCalledWith('devbox:next');
  });
  it('a machine that refuses the send fails at once as offline, with no timer left', () => {
    const { f, api, start } = setup(fakeFleet(['devbox']));
    start();
    expect(f.sent).toEqual([]);
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'offline' } });
    act(() => vi.advanceTimersByTime(20_000));
    expect(api().flow.error).toEqual({ kind: 'offline' });
  });
  it('a machine lost during the start fails at once, and what it owed is forgotten', () => {
    const { f, api, launched, hook, start } = setup();
    start();
    hook.rerender({ ms: [machine('local'), machine('devbox', { ready: false, status: 'connecting' })] });
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'lost' } });
    hook.rerender({ ms: both });
    act(() => api().retry());
    act(() => f.emit('devbox', { type: 'session.launched', id: 'ari' }));
    expect(launched).toHaveBeenCalledWith('devbox:ari');
  });
  it('stops listening and clears its timer when unmounted', () => {
    const { f, hook, start } = setup();
    start();
    hook.unmount();
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test use-launch`
Expected: FAIL « Failed to resolve import "../src/launch/useLaunch" ».

- [ ] **Step 3: Implement**

`apps/desktop/src/launch/useLaunch.ts` :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { qualify, type Fleet, type MachineState } from '@ledge/fleet';
import { LAUNCH_TIMEOUT_MS, START, step, type Flow, type FlowEvent } from './flow';
import type { LaunchRequest } from './form';

/** The two fleet calls a launch needs: it talks to the chosen machine only (spec §9.2), never through the selected one. */
export type LaunchFleet = Pick<Fleet, 'sendTo' | 'onMachineMessage'>;
export interface LaunchApi { flow: Flow; open(): void; close(): void; launch(request: LaunchRequest): void; retry(): void; edit(): void }

/** Lives in the Shell, not in the screen: a cancelled attempt's late answer is still skipped after the screen is gone. */
export function useLaunch(fleet: LaunchFleet, machines: MachineState[], onLaunched: (id: string) => void): LaunchApi {
  const [flow, setFlow] = useState<Flow>(START);
  const current = useRef<Flow>(START);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deps = useRef({ fleet, onLaunched });
  useEffect(() => { deps.current = { fleet, onLaunched }; });

  const fire = useCallback(function fire(e: FlowEvent): void {
    const { flow: next, send, launched } = step(current.current, e);
    if (next === current.current) return;
    current.current = next;
    setFlow(next);
    if (next.stage !== 'starting' && timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (send) {
      if (timer.current) clearTimeout(timer.current);
      const attempt = next.attempt;
      timer.current = setTimeout(() => { timer.current = null; fire({ type: 'timeout', attempt }); }, LAUNCH_TIMEOUT_MS);
      const { machine, tool, cwd, prompt } = send;
      if (!deps.current.fleet.sendTo(machine, { type: 'session.launch', tool, cwd, prompt })) fire({ type: 'unsent' });
    }
    if (launched) deps.current.onLaunched(launched);
  }, []);

  useEffect(() => fleet.onMachineMessage((machine, m) => {
    if (m.type === 'session.launched') fire({ type: 'launched', machine, id: qualify(machine, m.id) });
    // An error that names a session answers a session command (lot 4), never a launch.
    else if (m.type === 'error' && m.id === undefined) fire({ type: 'refused', machine, message: m.message });
  }), [fleet, fire]);

  // A machine that is no longer ready has lost the connection the answer would come back on.
  const down = machines.filter(m => !m.ready).map(m => m.id).join('\n');
  useEffect(() => { if (down) for (const id of down.split('\n')) fire({ type: 'dropped', machine: id }); }, [down, fire]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const open = useCallback(() => fire({ type: 'open' }), [fire]);
  const close = useCallback(() => fire({ type: 'close' }), [fire]);
  const launch = useCallback((request: LaunchRequest) => fire({ type: 'start', request }), [fire]);
  const retry = useCallback(() => fire({ type: 'retry' }), [fire]);
  const edit = useCallback(() => fire({ type: 'edit' }), [fire]);
  return { flow, open, close, launch, retry, edit };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test use-launch && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/launch/useLaunch.ts apps/desktop/test/use-launch.test.tsx
git commit -m "feat(desktop): send session.launch to the chosen machine with a 15 s timeout"
```

---
### Task 4: Textes du lancement et navigateur de dossiers

Le bloc `launch` complet (fr/en, utilisé aussi par les tâches 5 à 7) et le navigateur de dossiers sur la machine choisie : `folder.list` / `folder.create` par `fleet.sendTo`, réponses `folder.listing` de cette machine seulement, une requête à la fois, repli sur le dossier personnel, création sur place (logique portée de `apps/overlay/src/surface/FolderBrowser.tsx`, qui ne change pas).

**Files:**
- Modify: `apps/desktop/src/i18n/messages.ts` (`empty.start` et bloc `launch`, fr et en), `apps/desktop/src/styles/app.css` (règles `.folder-*` à la fin)
- Create: `apps/desktop/src/launch/folders.ts`, `apps/desktop/src/launch/FolderBrowser.tsx`
- Test: `apps/desktop/test/folder-browser.test.tsx`

**Interfaces:**
- Consumes: `LaunchFleet` (tâche 3) ; `isPathAccepted` (tâche 1) ; `fakeFleet` (tâche 1, tests) ; `useI18n`, `LangProvider` de `src/i18n/lang` ; `ServerMessage` de `@ledge/protocol`.
- Produces :
  - `t.empty.start: string` ; `t.launch` (forme exacte dans le code ci-dessous : `title`, `subtitle`, `back`, `cancel`, `form`, `machine`, `machineName(label, remote)`, `availability: Record<Availability, string>`, `project`, `custom`, `folder`, `folderPlaceholder`, `folderHint`, `agent`, `prompt`, `promptPlaceholder`, `footnote`, `submit`, `someDown(names, target)`, `noneReady`, `invalid: Record<LaunchProblem, string>`, `summary`, `starting`, `failed`, `browse`) ;
  - `type Listing = Extract<ServerMessage, { type: 'folder.listing' }>`, `type FolderRequest`, `interface Browser { shown: { path: string; parent: string | null; entries: string[] } | null; pending: 'list' | 'create' | 'fallback' | null; error: string | null; offline: boolean }`, `BROWSER_START`, `childOf(path, name)`, `crumbs(path)`, `ask(b, asked: 'list' | 'create'): Browser | null`, `answer(b, l: Listing): { browser: Browser; next?: FolderRequest }`, `unsent(b): Browser` ;
  - `FolderBrowser(props: { fleet: LaunchFleet; machine: string; label: string; ready: boolean; start: string; onChoose(path: string): void; onClose(): void })` → `section.folder-browser`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/folder-browser.test.tsx` :

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../src/i18n/lang';
import { FolderBrowser } from '../src/launch/FolderBrowser';
import { answer, ask, BROWSER_START, childOf, crumbs, type Listing } from '../src/launch/folders';
import { fakeFleet } from './launch-helpers';

const listing = (path: string, entries: string[], extra: Partial<Listing> = {}): Listing =>
  ({ type: 'folder.listing', path, parent: path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/', entries, ...extra });

function setup(start = '/w', ready = true, f = fakeFleet()) {
  const onChoose = vi.fn(); const onClose = vi.fn();
  const view = render(<FolderBrowser fleet={f} machine="devbox" label="Devbox · SSH" ready={ready} start={start} onChoose={onChoose} onClose={onClose} />);
  const reply = (l: Listing, machine = 'devbox') => act(() => f.emit(machine, l));
  return { f, onChoose, onClose, view, reply };
}

describe('folders (pure)', () => {
  it('builds paths and the breadcrumb', () => {
    expect(childOf('/', 'w')).toBe('/w');
    expect(childOf('/w', 'ledge')).toBe('/w/ledge');
    expect(crumbs('/w/ledge')).toEqual([{ name: '/', path: '/' }, { name: 'w', path: '/w' }, { name: 'ledge', path: '/w/ledge' }]);
  });
  it('takes one request at a time and ignores a listing nobody asked for', () => {
    const asked = ask(BROWSER_START, 'list')!;
    expect(ask(asked, 'list')).toBeNull();
    expect(answer(BROWSER_START, listing('/w', [])).browser).toBe(BROWSER_START);
  });
  it('falls back to home when the first folder cannot be listed, keeping the reason', () => {
    const first = answer(ask(BROWSER_START, 'list')!, listing('/nope', [], { error: 'not found' }));
    expect(first.next).toEqual({ type: 'folder.list' });
    expect(first.browser).toMatchObject({ pending: 'fallback', error: 'not found', shown: null });
    expect(answer(first.browser, listing('/home/dev', ['w'])).browser).toMatchObject({ pending: null, error: 'not found', shown: { path: '/home/dev' } });
  });
});

describe('FolderBrowser', () => {
  it('lists the field\'s folder on the chosen machine, then walks down, up and along the breadcrumb', async () => {
    const { f, reply } = setup('  /w ');
    expect(f.sent).toEqual([{ machine: 'devbox', msg: { type: 'folder.list', path: '/w' } }]);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    reply(listing('/w', ['api', 'ledge']));
    expect(screen.getByRole('region', { name: 'Folders on Devbox · SSH' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open ledge' }));
    expect(f.sent.at(-1)).toEqual({ machine: 'devbox', msg: { type: 'folder.list', path: '/w/ledge' } });
    reply(listing('/w/ledge', []));
    expect(screen.getByText('No subfolders.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Folder path' })).toHaveTextContent('/w/ledge');
    await userEvent.click(screen.getByRole('button', { name: 'Parent folder' }));
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.list', path: '/w' });
    reply(listing('/w', ['api', 'ledge']));
    await userEvent.click(screen.getByRole('button', { name: '/' }));
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.list', path: '/' });
  });
  it('opens on home when the field holds no accepted path', () => {
    const { f } = setup('w/relative');
    expect(f.sent).toEqual([{ machine: 'devbox', msg: { type: 'folder.list' } }]);
  });
  it('sends one request at a time: a click while waiting is ignored', async () => {
    const { f, reply } = setup();
    reply(listing('/w', ['api', 'ledge']));
    await userEvent.click(screen.getByRole('button', { name: 'Open api' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open ledge' }));
    expect(f.sent.map(s => s.msg)).toEqual([{ type: 'folder.list', path: '/w' }, { type: 'folder.list', path: '/w/api' }]);
    expect(screen.getByRole('button', { name: 'Choose this folder' })).toBeDisabled();
  });
  it('ignores another machine\'s listing and a listing nobody asked for', () => {
    const { reply } = setup();
    reply(listing('/elsewhere', ['x']), 'local');
    expect(screen.queryByRole('button', { name: 'Open x' })).toBeNull();
    reply(listing('/w', ['api']));
    reply(listing('/w', ['surprise']));
    expect(screen.queryByRole('button', { name: 'Open surprise' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open api' })).toBeInTheDocument();
  });
  it('falls back to home when the first folder cannot be listed', () => {
    const { f, reply } = setup('/nope');
    reply(listing('/nope', [], { error: 'no such folder' }));
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.list' });
    reply(listing('/home/dev', ['w']));
    expect(screen.getByRole('status')).toHaveTextContent('Could not: no such folder');
    expect(screen.getByRole('button', { name: 'Open w' })).toBeInTheDocument();
  });
  it('creates a folder in place, with Enter, and stays on the parent when it is refused', async () => {
    const { f, reply } = setup();
    reply(listing('/w', []));
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const name = screen.getByRole('textbox', { name: 'New folder name' });
    expect(name).toHaveFocus();
    await userEvent.type(name, 'bad/name{Enter}');
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.create', parent: '/w', name: 'bad/name' });
    reply(listing('/w', [], { error: 'invalid name' }));
    expect(screen.getByRole('status')).toHaveTextContent('Could not: invalid name');
    expect(screen.getByRole('textbox', { name: 'New folder name' })).toHaveValue('bad/name');
    await userEvent.clear(name);
    await userEvent.type(name, 'api');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    reply(listing('/w/api', []));
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('chooses the folder shown', async () => {
    const { onChoose, reply } = setup();
    reply(listing('/w', []));
    await userEvent.click(screen.getByRole('button', { name: 'Choose this folder' }));
    expect(onChoose).toHaveBeenCalledWith('/w');
  });
  it('Escape leaves the new folder name first, then the browser', async () => {
    const { onClose, reply } = setup();
    reply(listing('/w', []));
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Close' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('says so when the machine is not connected, and never waits forever', () => {
    setup('/w', true, fakeFleet(['devbox']));
    expect(screen.getByRole('status')).toHaveTextContent('Devbox · SSH is not connected: the folders cannot be listed.');
    expect(screen.queryByText('Loading…')).toBeNull();
  });
  it('a machine lost while a listing is pending stops the wait', () => {
    const f = fakeFleet();
    const { view } = setup('/w', true, f);
    view.rerender(<FolderBrowser fleet={f} machine="devbox" label="Devbox · SSH" ready={false} start="/w" onChoose={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('is not connected');
  });
  it('speaks French', () => {
    render(<LangProvider lang="fr"><FolderBrowser fleet={fakeFleet()} machine="devbox" label="Devbox · SSH" ready start="/w" onChoose={() => {}} onClose={() => {}} /></LangProvider>);
    expect(screen.getByRole('region', { name: 'Dossiers sur Devbox · SSH' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choisir ce dossier' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test folder-browser`
Expected: FAIL « Failed to resolve import "../src/launch/FolderBrowser" ».

- [ ] **Step 3: Implement**

**3a. Textes.** Dans `apps/desktop/src/i18n/messages.ts`, importer le type `Availability` et `LaunchProblem` (`import type { Availability, LaunchProblem } from '../launch/form';`), ajouter `start` au bloc `empty` des deux langues (`start: 'Démarrer une session'` / `start: 'Start a session'`) et, juste après le bloc `empty`, le bloc `launch`.

Français (`fr`) :

```ts
  launch: {
    title: 'Nouvelle session',
    subtitle: 'Un projet, un agent et une première consigne.',
    back: 'Retour aux sessions',
    cancel: 'Annuler le démarrage',
    form: 'Paramètres de la nouvelle session',
    machine: 'Machine',
    machineName: (label: string, remote: boolean) => `${label} · ${remote ? 'SSH' : 'WSL'}`,
    availability: { ready: '', connecting: ' · connexion…', unreachable: ' · déconnectée' } as Record<Availability, string>,
    project: 'Projet',
    custom: 'Autre dossier…',
    folder: 'Dossier de travail',
    folderPlaceholder: '/chemin/du/projet',
    folderHint: 'Dossier sur la machine choisie : chemin absolu (/…) ou commençant par ~.',
    agent: 'Agent',
    prompt: 'Première consigne',
    promptPlaceholder: 'Que souhaitez-vous confier à cet agent ?',
    footnote: 'L’agent démarre dans tmux sur la machine choisie.',
    submit: 'Démarrer la session',
    someDown: (names: string[], target: string) => `${names.join(', ')} ${names.length > 1 ? 'sont déconnectées' : 'est déconnectée'}. Vous pouvez démarrer une session sur ${target}.`,
    noneReady: 'Aucune machine n’est connectée. Rétablissez une connexion pour démarrer une session.',
    invalid: {
      machine: 'Choisissez une machine connectée.',
      cwd: 'Indiquez un dossier absolu (/…) ou commençant par ~.',
      prompt: 'Écrivez une première consigne.'
    } as Record<LaunchProblem, string>,
    summary: { machine: 'Machine', agent: 'Agent', folder: 'Dossier' },
    starting: {
      label: 'Démarrage de la session',
      title: 'Démarrage de votre agent',
      text: (machine: string) => `Préparation de la session sur ${machine}…`,
      connected: 'Connexion à la machine',
      folder: 'Dossier de travail sélectionné',
      tool: (name: string) => `Démarrage de ${name}`
    },
    failed: {
      label: 'Échec du lancement',
      title: 'L’agent n’a pas pu démarrer',
      daemon: (why: string) => `Le daemon a refusé : ${why}`,
      offline: (machine: string) => `La machine ${machine} n’est pas connectée : rien n’a été envoyé.`,
      lost: (machine: string) => `La connexion à ${machine} a été perdue pendant le démarrage. La session a peut-être démarré : vérifiez la liste avant de réessayer.`,
      timeout: 'Le daemon n’a pas répondu à temps. Aucune nouvelle session n’a été confirmée.',
      edit: 'Modifier les paramètres',
      retry: 'Réessayer',
      kept: 'Votre consigne est conservée.'
    },
    browse: {
      button: 'Parcourir…',
      title: (machine: string) => `Dossiers sur ${machine}`,
      close: 'Fermer',
      path: 'Chemin du dossier',
      up: 'Dossier parent',
      open: (name: string) => `Ouvrir ${name}`,
      empty: 'Aucun sous-dossier.',
      loading: 'Chargement…',
      newFolder: 'Nouveau dossier',
      newFolderName: 'Nom du nouveau dossier',
      create: 'Créer',
      choose: 'Choisir ce dossier',
      failed: (why: string) => `Impossible : ${why}`,
      offline: (machine: string) => `La machine ${machine} n’est pas connectée : les dossiers ne peuvent pas être listés.`
    }
  },
```

Anglais (`en`) :

```ts
  launch: {
    title: 'New session',
    subtitle: 'A project, an agent and a first instruction.',
    back: 'Back to sessions',
    cancel: 'Cancel launch',
    form: 'New session settings',
    machine: 'Machine',
    machineName: (label: string, remote: boolean) => `${label} · ${remote ? 'SSH' : 'WSL'}`,
    availability: { ready: '', connecting: ' · connecting…', unreachable: ' · disconnected' },
    project: 'Project',
    custom: 'Other folder…',
    folder: 'Working folder',
    folderPlaceholder: '/path/to/project',
    folderHint: 'A folder on the chosen machine: an absolute path (/…) or one starting with ~.',
    agent: 'Agent',
    prompt: 'First instruction',
    promptPlaceholder: 'What would you like this agent to do?',
    footnote: 'The agent starts in tmux on the chosen machine.',
    submit: 'Start the session',
    someDown: (names: string[], target: string) => `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} disconnected. You can start a session on ${target}.`,
    noneReady: 'No machine is connected. Restore a connection to start a session.',
    invalid: {
      machine: 'Choose a connected machine.',
      cwd: 'Enter an absolute folder (/…) or one starting with ~.',
      prompt: 'Write a first instruction.'
    },
    summary: { machine: 'Machine', agent: 'Agent', folder: 'Folder' },
    starting: {
      label: 'Starting the session',
      title: 'Starting your agent',
      text: (machine: string) => `Preparing the session on ${machine}…`,
      connected: 'Connected to the machine',
      folder: 'Working folder selected',
      tool: (name: string) => `Starting ${name}`
    },
    failed: {
      label: 'Launch failed',
      title: 'The agent could not start',
      daemon: (why: string) => `The daemon refused: ${why}`,
      offline: (machine: string) => `${machine} is not connected: nothing was sent.`,
      lost: (machine: string) => `The connection to ${machine} was lost during the start. The session may have started: check the list before retrying.`,
      timeout: 'The daemon did not answer in time. No new session was confirmed.',
      edit: 'Edit settings',
      retry: 'Retry',
      kept: 'Your instruction is kept.'
    },
    browse: {
      button: 'Browse…',
      title: (machine: string) => `Folders on ${machine}`,
      close: 'Close',
      path: 'Folder path',
      up: 'Parent folder',
      open: (name: string) => `Open ${name}`,
      empty: 'No subfolders.',
      loading: 'Loading…',
      newFolder: 'New folder',
      newFolderName: 'New folder name',
      create: 'Create',
      choose: 'Choose this folder',
      failed: (why: string) => `Could not: ${why}`,
      offline: (machine: string) => `${machine} is not connected: the folders cannot be listed.`
    }
  },
```

**3b. État pur.** `apps/desktop/src/launch/folders.ts` :

```ts
import type { ServerMessage } from '@ledge/protocol';

export type Listing = Extract<ServerMessage, { type: 'folder.listing' }>;
/** What the browser asks the chosen machine; each is answered with a `folder.listing` to the asker only. */
export type FolderRequest = { type: 'folder.list'; path?: string } | { type: 'folder.create'; parent: string; name: string };
export interface Browser {
  shown: { path: string; parent: string | null; entries: string[] } | null;
  /** The request waiting for its listing, which decides how the answer (or its refusal) lands; one at a time. */
  pending: 'list' | 'create' | 'fallback' | null;
  error: string | null;
  /** The machine refused the send or dropped while a request was pending. */
  offline: boolean;
}
export const BROWSER_START: Browser = { shown: null, pending: null, error: null, offline: false };

export const childOf = (path: string, name: string) => (path === '/' ? `/${name}` : `${path}/${name}`);
/** The breadcrumb: the root, then each folder down to `path`, with the path that lists it (from the overlay). */
export function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  return [{ name: '/', path: '/' }, ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` }))];
}

/** Starts a request; null while another one waits (a click during a wait is ignored). */
export function ask(b: Browser, asked: 'list' | 'create'): Browser | null {
  return b.pending ? null : { ...b, pending: asked, error: null, offline: false };
}

/** Lands a listing. One nobody waits for changes nothing. `next` is a request to send at once (the fallback to home). */
export function answer(b: Browser, l: Listing): { browser: Browser; next?: { type: 'folder.list' } } {
  if (!b.pending) return { browser: b };
  const at = { path: l.path, parent: l.parent, entries: l.entries };
  if (l.error) {
    // A refused creation lists its parent: stay there with the name to fix.
    if (b.pending === 'create') return { browser: { ...b, pending: null, error: l.error, shown: at } };
    // The first folder cannot be listed: fall back to home, keeping the reason.
    if (b.pending === 'list' && !b.shown) return { browser: { ...b, pending: 'fallback', error: l.error }, next: { type: 'folder.list' } };
    return { browser: { ...b, pending: null, error: l.error } };
  }
  return { browser: { ...b, pending: null, shown: at, error: b.pending === 'fallback' ? b.error : null } };
}

/** Nothing will answer: the machine refused the send or its connection dropped. */
export const unsent = (b: Browser): Browser => ({ ...b, pending: null, offline: true });
```

**3c. Composant.** `apps/desktop/src/launch/FolderBrowser.tsx` :

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/lang';
import { answer, ask, BROWSER_START, childOf, crumbs, unsent, type Browser, type FolderRequest } from './folders';
import { isPathAccepted } from './form';
import type { LaunchFleet } from './useLaunch';

export interface FolderBrowserProps {
  fleet: LaunchFleet;
  machine: string;
  /** The machine's display name (« Devbox · SSH »). */
  label: string;
  ready: boolean;
  /** The form's folder field: listed first when accepted, else home. */
  start: string;
  onChoose(path: string): void;
  onClose(): void;
}

/** The folders of the chosen machine, one at a time, under the folder field (not in the mockup; spec §9.2). */
export function FolderBrowser(p: FolderBrowserProps) {
  const { t } = useI18n(); const b = t.launch.browse;
  const [state, setState] = useState<Browser>(BROWSER_START);
  const [newName, setNewName] = useState<string | null>(null);
  const current = useRef<Browser>(BROWSER_START);
  const props = useRef(p);
  useEffect(() => { props.current = p; });
  const rootRef = useRef<HTMLElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((next: Browser) => { current.current = next; setState(next); }, []);
  const send = useCallback((msg: FolderRequest, next: Browser) => {
    apply(props.current.fleet.sendTo(props.current.machine, msg) ? next : unsent(next));
  }, [apply]);
  const list = useCallback((path?: string) => {
    const next = ask(current.current, 'list');
    if (!next) return;
    setNewName(null);
    send(path?.trim() ? { type: 'folder.list', path: path.trim() } : { type: 'folder.list' }, next);
  }, [send]);
  const create = () => {
    const shown = current.current.shown; const name = newName?.trim();
    if (!shown || !name) return;
    const next = ask(current.current, 'create');
    if (next) send({ type: 'folder.create', parent: shown.path, name }, next);
  };

  // One request on open (a second mount in StrictMode is refused by `ask`), focus inside so Escape stays here.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    list(isPathAccepted(props.current.start) ? props.current.start : undefined);
  }, [list]);
  useEffect(() => p.fleet.onMachineMessage((machine, m) => {
    if (machine !== props.current.machine || m.type !== 'folder.listing') return;
    const created = current.current.pending === 'create' && !m.error;
    const { browser, next } = answer(current.current, m);
    if (browser === current.current) return;
    if (next) send(next, browser); else apply(browser);
    if (created) setNewName(null);
  }), [p.fleet, apply, send]);
  // The answer comes back on the connection that asked: once it is gone, stop waiting.
  useEffect(() => { if (!p.ready && current.current.pending) apply(unsent(current.current)); }, [p.ready, apply]);
  useEffect(() => { if (newName !== null) newRef.current?.focus(); }, [newName !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const { shown, pending } = state;
  const loading = pending !== null && pending !== 'create';
  const offline = state.offline || !p.ready;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    if (newName !== null) setNewName(null); else p.onClose();
  };

  return (
    <section ref={rootRef} className="folder-browser" aria-label={b.title(p.label)} onKeyDown={onKeyDown}>
      <div className="folder-browser-top">
        <strong>{b.title(p.label)}</strong>
        <button type="button" className="settings-button" data-initial-focus onClick={p.onClose}>{b.close}</button>
      </div>
      <nav aria-label={b.path} className="folder-crumbs">
        {shown && crumbs(shown.path).map((c, i, all) => (
          <span key={c.path}>
            {i > 1 && <span aria-hidden="true">/</span>}
            {i === all.length - 1
              ? <span aria-current="location">{c.name}</span>
              : <button type="button" onClick={() => list(c.path)}>{c.name}</button>}
          </span>
        ))}
      </nav>
      <div className="folder-list" aria-busy={loading}>
        {newName !== null && (
          <div className="folder-new">
            <input ref={newRef} aria-label={b.newFolderName} value={newName} maxLength={255} autoComplete="off" spellCheck={false}
              onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
            <button type="button" className="settings-button" disabled={!newName.trim() || pending !== null} onClick={create}>{b.create}</button>
          </div>
        )}
        {!shown && loading && <span className="folder-hint">{b.loading}</span>}
        {shown?.parent && <button type="button" className="folder-row" aria-label={b.up} onClick={() => list(shown.parent!)}><span aria-hidden="true">..</span></button>}
        {shown?.entries.map(name => (
          <button key={name} type="button" className="folder-row" aria-label={b.open(name)} onClick={() => list(childOf(shown.path, name))}>
            <span>{name}</span><span aria-hidden="true">›</span>
          </button>
        ))}
        {shown && shown.entries.length === 0 && <span className="folder-hint">{b.empty}</span>}
      </div>
      <div className="folder-actions">
        <button type="button" className="settings-button" disabled={!shown || newName !== null} onClick={() => setNewName('')}>{b.newFolder}</button>
        <button type="button" className="primary" disabled={!shown || loading} onClick={() => shown && p.onChoose(shown.path)}>{b.choose}</button>
      </div>
      {offline
        ? <p role="status" className="folder-error">{b.offline(p.label)}</p>
        : state.error && <p role="status" className="folder-error">{b.failed(state.error)}</p>}
    </section>
  );
}
```

**3d. CSS.** À la fin de `apps/desktop/src/styles/app.css` (hors maquette : reprend les bordures, le fond `--well` et les tailles des champs de `.launch-form`) :

```css
/* Folder browser under the launch form's folder field (spec §9.2; not in the mockup). */
.folder-browser { margin: -12px 0 22px; border: 1px solid var(--input); border-radius: 6px; background: var(--well); font-size: 12px; }
.folder-browser-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--sidebar-border); }
.folder-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 6px 12px; border-bottom: 1px solid var(--sidebar-border); font-family: ui-monospace, monospace; font-size: 11px; overflow-wrap: anywhere; }
.folder-crumbs button { background: transparent; padding: 2px 4px; color: var(--muted-foreground); font: inherit; }
.folder-crumbs [aria-current] { padding: 2px 4px; font-weight: 600; }
.folder-list { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto; padding: 6px; scrollbar-width: thin; }
.folder-list[aria-busy=true] { opacity: .6; }
.folder-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; border-radius: 5px; background: transparent; text-align: left; font-size: 12px; }
.folder-row:hover, .folder-row:focus-visible { background: var(--sidebar-accent); }
.folder-hint { padding: 8px; color: var(--muted-foreground); }
.folder-new { display: flex; gap: 8px; padding: 2px 8px; }
.folder-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--sidebar-border); }
.folder-error { margin: 0; padding: 0 12px 10px; color: var(--danger-text); }
```

(`.folder-new input` hérite de la règle `.launch-form input:not([type=radio])` portée à la tâche 5.)

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test folder-browser && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/i18n/messages.ts apps/desktop/src/launch/folders.ts apps/desktop/src/launch/FolderBrowser.tsx apps/desktop/src/styles/app.css apps/desktop/test/folder-browser.test.tsx
git commit -m "feat(desktop): folder browser on the chosen machine"
```

---
### Task 5: Écran de lancement : formulaire, Démarrage, Échec

Les trois écrans de la maquette `launch.js` : tête (`.view-heading.settings-heading`, « Retour aux sessions » ou « Annuler le démarrage »), formulaire, Démarrage, Échec. Le brouillon `desktop.launch` est écrit à chaque saisie. Port des règles `.launch-*` de `journeys.css` et `.settings-heading` de `settings.css`.

**Files:**
- Create: `apps/desktop/src/launch/LaunchFormView.tsx`, `apps/desktop/src/launch/LaunchProgress.tsx`, `apps/desktop/src/launch/LaunchScreen.tsx`
- Modify: `apps/desktop/src/styles/app.css` (règles de lancement, à la fin, avant les règles `.folder-*` de la tâche 4 ou après : l'ordre n'importe pas)
- Test: `apps/desktop/test/launch-screen.test.tsx`

**Interfaces:**
- Consumes: tâche 1 (`resolveForm`, `editDraft`, `checkForm`, `recentsOf`, `availability`, `loadLaunch`, `saveLaunch`, `TOOLS`, `CUSTOM`, `CWD_MAX`, `PROMPT_MAX`, `LaunchDraft`, `LaunchProblem`, `LaunchRequest`, `TOOL_KEY`, `LAUNCH_KEY`, `machine`, `recent`, `fakeFleet`) ; tâche 2 (`Flow`) ; tâche 3 (`useLaunch`, `LaunchApi`, `LaunchFleet`) ; tâche 4 (`FolderBrowser`, `t.launch`) ; `useStored` (lot 4, `src/state/useStored.ts`) ; `Bot`, `poseFor` de `@ledge/ui` ; `useTheme` (`src/shell/theme.ts`) ; `TOOL_NAMES` (`src/shell/Person.tsx`).
- Produces :
  - `LaunchScreen(props: { launch: LaunchApi; machines: MachineState[]; fleet: LaunchFleet; notices?: React.ReactNode })` — rend la tête (`button[data-launch-back]`), puis `notices`, puis `div.launch-scroll` (formulaire ou progression) ; rien quand `launch.flow.stage === 'closed'` ;
  - `LaunchFormView(props: { draft: LaunchDraft; onDraft(fn: (d: LaunchDraft) => LaunchDraft): void; machines: MachineState[]; fleet: LaunchFleet; onLaunch(r: LaunchRequest): void })` — `form#launch-form.launch-form`, champs `#launch-machine`, `#launch-project`, `#launch-folder`, `#launch-prompt` ;
  - `LaunchProgress(props: { flow: Flow; machines: MachineState[]; onEdit(): void; onRetry(): void })` — `section.launch-progress` (`.launch-failed` en échec).

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/launch-screen.test.tsx` :

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MachineState } from '@ledge/fleet';
import { LangProvider } from '../src/i18n/lang';
import { LaunchScreen } from '../src/launch/LaunchScreen';
import { LaunchProgress } from '../src/launch/LaunchProgress';
import { useLaunch } from '../src/launch/useLaunch';
import { START, type Flow } from '../src/launch/flow';
import { LAUNCH_KEY, TOOL_KEY } from '../src/launch/form';
import { fakeFleet, machine, recent, type FakeFleet } from './launch-helpers';

const local = machine('local', { recents: [recent('/w/website', '2026-10-14T10:00:00.000Z'), recent('/w/ledge', '2026-10-15T09:00:00.000Z')] });
const devbox = machine('devbox', { recents: [recent('/home/dev/api', '2026-10-15T08:00:00.000Z')] });
const devboxDown = machine('devbox', { ready: false, status: 'unreachable', recents: devbox.recents });

function Harness({ machines, f, onLaunched = () => {} }: { machines: MachineState[]; f: FakeFleet; onLaunched?: (id: string) => void }) {
  const launch = useLaunch(f, machines, onLaunched);
  if (launch.flow.stage === 'closed') return <button type="button" onClick={launch.open}>open</button>;
  return <LaunchScreen launch={launch} machines={machines} fleet={f} notices={<p>notice</p>} />;
}
async function open(machines: MachineState[] = [local, devbox], f = fakeFleet()) {
  const view = render(<Harness machines={machines} f={f} />);
  await userEvent.click(screen.getByRole('button', { name: 'open' }));
  const rerender = (ms: MachineState[]) => view.rerender(<Harness machines={ms} f={f} />);
  return { f, view, rerender };
}
const stored = () => JSON.parse(localStorage.getItem(LAUNCH_KEY) ?? 'null');
const prompt = () => screen.getByRole('textbox', { name: 'First instruction' });
const folder = () => screen.getByRole('textbox', { name: 'Working folder' });

beforeEach(() => localStorage.clear());

describe('launch form', () => {
  it('follows the mockup: heading, machines, latest project, default agent, focus on the machine', async () => {
    await open([local, devboxDown]);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New session');
    expect(document.querySelector('header.view-heading.settings-heading [data-launch-back]')).toHaveTextContent('Back to sessions');
    expect(screen.getByText('notice')).toBeInTheDocument();
    const machineSelect = screen.getByRole('combobox', { name: 'Machine' });
    expect(machineSelect).toHaveFocus();
    expect(within(machineSelect).getAllByRole('option').map(o => [o.textContent, (o as HTMLOptionElement).disabled]))
      .toEqual([['Local · WSL', false], ['Devbox · SSH · disconnected', true]]);
    expect(screen.getByText('Devbox · SSH is disconnected. You can start a session on Local · WSL.')).toBeInTheDocument();
    const project = screen.getByRole('combobox', { name: 'Project' });
    expect(within(project).getAllByRole('option').map(o => o.textContent)).toEqual(['ledge', 'website', 'Other folder…']);
    expect(project).toHaveValue('/w/ledge');
    expect(folder()).toHaveValue('/w/ledge');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(document.querySelector('.launch-scroll > form#launch-form.launch-form')).not.toBeNull();
    expect(document.querySelector('[data-session]')).toBeNull();
    expect(stored()).toBeNull();   // nothing written before the first edit
  });
  it('opens on the default harness from desktop.tool, and a choice in the form never writes it', async () => {
    localStorage.setItem(TOOL_KEY, JSON.stringify('codex'));
    await open();
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Cursor Agent' }));
    expect(localStorage.getItem(TOOL_KEY)).toBe('"codex"');
    expect(stored()).toMatchObject({ tool: 'cursor' });
  });
  it('validates in the mockup\'s order and names the problem', async () => {
    const { f } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a first instruction.');
    expect(prompt()).toHaveFocus();
    await userEvent.type(prompt(), 'Fix it');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.clear(folder());
    await userEvent.type(folder(), 'w/relative');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute folder (/…) or one starting with ~.');
    expect(folder()).toHaveFocus();
    expect(f.sent).toEqual([]);
  });
  it('a machine change takes that machine\'s latest project; the request goes to it, trimmed; the draft follows each edit', async () => {
    const { f } = await open();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Machine' }), 'devbox');
    expect(folder()).toHaveValue('/home/dev/api');
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    await userEvent.type(prompt(), '  Run the tests  ');
    expect(stored()).toEqual({ machine: 'devbox', cwd: '/home/dev/api', tool: 'codex', prompt: '  Run the tests  ' });
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(f.sent).toEqual([{ machine: 'devbox', msg: { type: 'session.launch', tool: 'codex', cwd: '/home/dev/api', prompt: 'Run the tests' } }]);
  });
  it('« Other folder… » empties the field and focuses it; a ~ path is accepted', async () => {
    const { f } = await open();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'custom');
    expect(folder()).toHaveValue('');
    expect(folder()).toHaveFocus();
    await userEvent.type(folder(), '~/w/new');
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('custom');
    await userEvent.type(prompt(), 'Go');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(f.sent[0]!.msg).toMatchObject({ cwd: '~/w/new' });
  });
  it('restores the last unlaunched form, and survives a corrupted one', async () => {
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'devbox', cwd: '~/w/api', tool: 'cursor', prompt: 'Keep me' }));
    await open();
    expect(screen.getByRole('combobox', { name: 'Machine' })).toHaveValue('devbox');
    expect(folder()).toHaveValue('~/w/api');
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('custom');
    expect(prompt()).toHaveValue('Keep me');
    expect(screen.getByRole('radio', { name: 'Cursor Agent' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();
    expect(stored()).toMatchObject({ prompt: 'Keep me' });
  });
  it('opens on the defaults when desktop.launch is corrupted', async () => {
    localStorage.setItem(LAUNCH_KEY, '{');
    await open();
    expect(folder()).toHaveValue('/w/ledge');
    expect(prompt()).toHaveValue('');
  });
  it('never sends a folder typed for a machine that fell to another one', async () => {
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Go' }));
    const { f, rerender } = await open();
    rerender([local, devboxDown]);
    expect(screen.getByRole('combobox', { name: 'Machine' })).toHaveValue('local');
    expect(folder()).toHaveValue('/w/ledge');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(f.sent).toEqual([{ machine: 'local', msg: { type: 'session.launch', tool: 'codex', cwd: '/w/ledge', prompt: 'Go' } }]);
  });
  it('says when no machine is connected, and refuses to start', async () => {
    const { f } = await open([machine('local', { ready: false, status: 'connecting' })]);
    expect(screen.getByText('No machine is connected. Restore a connection to start a session.')).toBeInTheDocument();
    await userEvent.type(prompt(), 'Go');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a connected machine.');
    expect(f.sent).toEqual([]);
  });
  it('browses the chosen machine\'s folders and takes the one chosen', async () => {
    const { f } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    expect(f.sent.at(-1)).toEqual({ machine: 'local', msg: { type: 'folder.list', path: '/w/ledge' } });
    act(() => f.emit('local', { type: 'folder.listing', path: '/w/ledge', parent: '/w', entries: [] }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose this folder' }));
    expect(screen.queryByRole('region', { name: /Folders on/ })).toBeNull();
    expect(folder()).toHaveValue('/w/ledge');
    expect(folder()).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Machine' }), 'devbox');
    expect(screen.queryByRole('region', { name: /Folders on/ })).toBeNull();
  });
  it('speaks French', async () => {
    render(<LangProvider lang="fr"><Harness machines={[local, devboxDown]} f={fakeFleet()} /></LangProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Nouvelle session');
    expect(screen.getByRole('option', { name: 'Devbox · SSH · déconnectée' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Démarrer la session' })).toBeInTheDocument();
  });
});

describe('starting and failure', () => {
  async function started(f = fakeFleet()) {
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'devbox', cwd: '/home/dev/api', tool: 'codex', prompt: 'Run the tests\nthen report' }));
    const r = await open([local, devbox], f);
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    return r;
  }
  it('shows the start with its summary, focus on the title, Cancel in the heading', async () => {
    await started();
    const section = screen.getByRole('region', { name: 'Starting the session' });
    expect(within(section).getByRole('heading', { level: 3 })).toHaveTextContent('Starting your agent');
    expect(within(section).getByRole('heading', { level: 3 })).toHaveFocus();
    expect(within(section).getByRole('status')).toHaveTextContent('Preparing the session on Devbox · SSH…');
    expect([...section.querySelectorAll('.launch-summary dd')].map(d => d.textContent)).toEqual(['Devbox · SSH', 'Codex', '/home/dev/api']);
    expect(section.querySelector('blockquote.launch-prompt')).toHaveTextContent('Run the tests then report');
    expect(section.querySelector('[aria-current="step"]')).toHaveTextContent('Starting Codex');
    expect(screen.getByRole('button', { name: 'Cancel launch' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('a daemon error fails with its message; Edit returns to the form with everything kept; Retry sends again', async () => {
    const { f } = await started();
    act(() => f.emit('devbox', { type: 'error', message: 'no such folder: /home/dev/api' }));
    const section = screen.getByRole('region', { name: 'Launch failed' });
    expect(section).toHaveClass('launch-progress', 'launch-failed');
    expect(within(section).getByRole('heading', { level: 3 })).toHaveTextContent('The agent could not start');
    expect(within(section).getByRole('heading', { level: 3 })).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('The daemon refused: no such folder: /home/dev/api');
    expect(screen.getByText('Your instruction is kept.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to sessions' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1]).toEqual(f.sent[0]);
    act(() => f.emit('devbox', { type: 'error', message: 'still no' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
    expect(screen.getByRole('combobox', { name: 'Machine' })).toHaveValue('devbox');
    expect(folder()).toHaveValue('/home/dev/api');
    expect(prompt()).toHaveValue('Run the tests\nthen report');
  });
  it('Cancel closes the screen and keeps the draft', async () => {
    await started();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel launch' }));
    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();
    expect(stored()).toMatchObject({ prompt: 'Run the tests\nthen report' });
  });
});

describe('LaunchProgress messages', () => {
  const request = { machine: 'devbox', tool: 'claude' as const, cwd: '~/w', prompt: 'Go' };
  const failed = (error: Flow['error']): Flow => ({ ...START, stage: 'failed', request, error, attempt: 1 });
  it.each([
    [{ kind: 'offline' } as const, 'Devbox · SSH is not connected: nothing was sent.'],
    [{ kind: 'lost' } as const, 'The connection to Devbox · SSH was lost during the start. The session may have started: check the list before retrying.'],
    [{ kind: 'timeout' } as const, 'The daemon did not answer in time. No new session was confirmed.']
  ])('explains %j', (error, text) => {
    render(<LaunchProgress flow={failed(error)} machines={[local, devbox]} onEdit={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
  it('names a machine that left the fleet by its id', () => {
    render(<LaunchProgress flow={failed({ kind: 'offline' })} machines={[local]} onEdit={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('devbox is not connected');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test launch-screen`
Expected: FAIL « Failed to resolve import "../src/launch/LaunchScreen" ».

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/launch/LaunchFormView.tsx` :

```tsx
import { useEffect, useRef, useState } from 'react';
import type { MachineState } from '@ledge/fleet';
import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';
import { TOOL_NAMES } from '../shell/Person';
import { FolderBrowser } from './FolderBrowser';
import {
  availability, checkForm, CUSTOM, CWD_MAX, editDraft, PROMPT_MAX, recentsOf, resolveForm, TOOLS,
  type LaunchDraft, type LaunchProblem, type LaunchRequest
} from './form';
import type { LaunchFleet } from './useLaunch';

export interface LaunchFormViewProps {
  draft: LaunchDraft;
  onDraft(fn: (d: LaunchDraft) => LaunchDraft): void;
  machines: MachineState[];
  fleet: LaunchFleet;
  onLaunch(request: LaunchRequest): void;
}

const FIELD: Record<LaunchProblem, string> = { machine: 'launch-machine', cwd: 'launch-folder', prompt: 'launch-prompt' };

/** The mockup's form (launch.js): machine, project, folder (with the browser), agent, first instruction. */
export function LaunchFormView({ draft, onDraft, machines, fleet, onLaunch }: LaunchFormViewProps) {
  const { t } = useI18n(); const l = t.launch; const theme = useTheme();
  const form = resolveForm(draft, machines);
  const [problem, setProblem] = useState<LaunchProblem | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [custom, setCustom] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const target = machines.find(m => m.id === form.machine);
  const recents = recentsOf(target);
  const project = !custom && recents.some(r => r.cwd === form.cwd) ? form.cwd : CUSTOM;
  const name = (m: MachineState) => l.machineName(m.label, !!m.ssh);
  const down = machines.filter(m => !m.ready);

  const edit = (patch: Partial<LaunchDraft>) => { setProblem(null); onDraft(() => editDraft(form, patch)); };
  // The mockup focuses the first select when the form opens.
  useEffect(() => { formRef.current?.querySelector<HTMLElement>('select')?.focus({ preventScroll: true }); }, []);
  // The browser lists one machine: another machine (chosen, or a fallback after a drop) closes it.
  useEffect(() => { setBrowsing(false); }, [form.machine]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkForm(form, machines);
    if (!checked.ok) {
      setProblem(checked.problem);
      document.getElementById(FIELD[checked.problem])?.focus({ preventScroll: true });
      return;
    }
    onLaunch(checked.request);
  };

  return (
    <form id="launch-form" ref={formRef} className="launch-form" aria-label={l.form} noValidate onSubmit={submit}>
      <div className="launch-fields">
        <div className="launch-field">
          <label htmlFor="launch-machine">{l.machine}</label>
          <select id="launch-machine" name="machine" value={form.machine ?? ''} aria-invalid={problem === 'machine' || undefined}
            onChange={e => { setCustom(false); edit({ machine: e.target.value, cwd: null }); }}>
            {!form.machine && <option value="" disabled>—</option>}
            {machines.map(m => <option key={m.id} value={m.id} disabled={!m.ready}>{name(m) + l.availability[availability(m)]}</option>)}
          </select>
        </div>
        <div className="launch-field">
          <label htmlFor="launch-project">{l.project}</label>
          <select id="launch-project" name="project" value={project}
            onChange={e => {
              if (e.target.value === CUSTOM) { setCustom(true); edit({ cwd: '' }); folderRef.current?.focus({ preventScroll: true }); }
              else { setCustom(false); edit({ cwd: e.target.value }); }
            }}>
            {recents.map(r => <option key={r.cwd} value={r.cwd} title={r.cwd}>{r.project}</option>)}
            <option value={CUSTOM}>{l.custom}</option>
          </select>
        </div>
      </div>
      {target && down.length > 0 && <p className="launch-note">{l.someDown(down.map(name), name(target))}</p>}
      {!target && <p className="launch-note">{l.noneReady}</p>}
      <div className="launch-field">
        <label htmlFor="launch-folder">{l.folder}</label>
        <div className="launch-folder-row">
          <input id="launch-folder" ref={folderRef} name="folder" value={form.cwd} maxLength={CWD_MAX} placeholder={l.folderPlaceholder}
            spellCheck={false} autoComplete="off" aria-describedby="launch-folder-hint" aria-invalid={problem === 'cwd' || undefined}
            onChange={e => { setCustom(true); edit({ cwd: e.target.value }); }} />
          <button type="button" ref={browseRef} className="settings-button" aria-expanded={browsing} disabled={!target}
            onClick={() => setBrowsing(b => !b)}>{l.browse.button}</button>
        </div>
        <small id="launch-folder-hint">{l.folderHint}</small>
      </div>
      {browsing && target && (
        <FolderBrowser fleet={fleet} machine={target.id} label={name(target)} ready={target.ready} start={form.cwd}
          onChoose={path => { setBrowsing(false); setCustom(false); edit({ cwd: path }); folderRef.current?.focus({ preventScroll: true }); }}
          onClose={() => { setBrowsing(false); browseRef.current?.focus({ preventScroll: true }); }} />
      )}
      <fieldset className="launch-agents">
        <legend>{l.agent}</legend>
        {TOOLS.map(tool => (
          <label key={tool}>
            <input type="radio" name="tool" value={tool} checked={form.tool === tool} onChange={() => edit({ tool })} />
            <span>
              <span aria-hidden="true"><Bot tool={tool} state="idle" pose={poseFor(`launch-${tool}`, 'idle')} size={28} theme={theme} seed={`launch-${tool}`} /></span>
              {TOOL_NAMES[tool]}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="launch-field">
        <label htmlFor="launch-prompt">{l.prompt}</label>
        <textarea id="launch-prompt" name="prompt" rows={5} maxLength={PROMPT_MAX} placeholder={l.promptPlaceholder} value={form.prompt}
          aria-invalid={problem === 'prompt' || undefined} onChange={e => edit({ prompt: e.target.value })} />
      </div>
      {problem && <p className="launch-error" role="alert">{l.invalid[problem]}</p>}
      <div className="launch-actions">
        <small>{l.footnote}</small>
        <button type="submit" className="primary">{l.submit}</button>
      </div>
    </form>
  );
}
```

Note : la saisie dans « Dossier de travail » passe le projet sur « Autre dossier… » (`setCustom(true)`), comme la maquette qui recalcule le dossier seulement sur un changement de machine ou de projet. Le test « restores the last unlaunched form » vérifie qu'un dossier mémorisé hors des récents affiche « Autre dossier… ».

**3b.** `apps/desktop/src/launch/LaunchProgress.tsx` :

```tsx
import { useEffect, useRef } from 'react';
import type { MachineState } from '@ledge/fleet';
import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';
import { TOOL_NAMES } from '../shell/Person';
import type { Flow } from './flow';

/** The mockup's « Démarrage » and « Échec » screens: the request as sent, then either the steps or the reason and the way back. */
export function LaunchProgress({ flow, machines, onEdit, onRetry }: { flow: Flow; machines: MachineState[]; onEdit(): void; onRetry(): void }) {
  const { t } = useI18n(); const l = t.launch; const theme = useTheme();
  const title = useRef<HTMLHeadingElement>(null);
  // The mockup moves focus to the title on each screen; a retry is a new start.
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [flow.stage, flow.attempt]);
  const r = flow.request;
  if (!r) return null;
  const m = machines.find(x => x.id === r.machine);
  const where = m ? l.machineName(m.label, !!m.ssh) : r.machine;
  const failed = flow.stage === 'failed';
  const e = flow.error;
  const reason = !e ? '' : e.kind === 'daemon' ? l.failed.daemon(e.message) : e.kind === 'offline' ? l.failed.offline(where)
    : e.kind === 'lost' ? l.failed.lost(where) : l.failed.timeout;
  const state = failed ? 'error' : 'starting';
  return (
    <section className={failed ? 'launch-progress launch-failed' : 'launch-progress'} aria-label={failed ? l.failed.label : l.starting.label}>
      <div className="launch-mascot" aria-hidden="true"><Bot tool={r.tool} state={state} pose={poseFor('launch', state)} size={56} theme={theme} seed="launch" /></div>
      <h3 ref={title} tabIndex={-1}>{failed ? l.failed.title : l.starting.title}</h3>
      {failed ? <p role="alert">{reason}</p> : <p role="status">{l.starting.text(where)}</p>}
      <dl className="launch-summary">
        <div><dt>{l.summary.machine}</dt><dd>{where}</dd></div>
        <div><dt>{l.summary.agent}</dt><dd>{TOOL_NAMES[r.tool]}</dd></div>
        <div><dt>{l.summary.folder}</dt><dd>{r.cwd}</dd></div>
      </dl>
      <blockquote className="launch-prompt">{r.prompt}</blockquote>
      {failed ? (
        <>
          <div className="launch-actions">
            <button type="button" className="settings-button" onClick={onEdit}>{l.failed.edit}</button>
            <button type="button" className="primary" onClick={onRetry}>{l.failed.retry}</button>
          </div>
          <p className="launch-note">{l.failed.kept}</p>
        </>
      ) : (
        <ol className="launch-steps">
          <li>✓ {l.starting.connected}</li>
          <li>✓ {l.starting.folder}</li>
          <li aria-current="step"><span className="launch-spinner" aria-hidden="true" />{l.starting.tool(TOOL_NAMES[r.tool])}</li>
        </ol>
      )}
    </section>
  );
}
```

**3c.** `apps/desktop/src/launch/LaunchScreen.tsx` :

```tsx
import type { ReactNode } from 'react';
import type { MachineState } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { useStored } from '../state/useStored';
import { loadLaunch, saveLaunch } from './form';
import { LaunchFormView } from './LaunchFormView';
import { LaunchProgress } from './LaunchProgress';
import type { LaunchApi, LaunchFleet } from './useLaunch';

/** The launch screen in place of the sessions (mockup launch.js): its heading, the Shell's notices, then a scrolled body. */
export function LaunchScreen({ launch, machines, fleet, notices }: { launch: LaunchApi; machines: MachineState[]; fleet: LaunchFleet; notices?: ReactNode }) {
  const { t } = useI18n(); const l = t.launch;
  // Loaded when the screen opens; written on each edit; cleared by the Shell when a launch succeeds.
  const [draft, setDraft] = useStored(loadLaunch, saveLaunch);
  const { flow } = launch;
  if (flow.stage === 'closed') return null;
  return (
    <>
      <header className="view-heading settings-heading">
        <div><h2>{l.title}</h2><p>{l.subtitle}</p></div>
        <button type="button" className="settings-button" data-launch-back onClick={launch.close}>{flow.stage === 'starting' ? l.cancel : l.back}</button>
      </header>
      {notices}
      <div className="launch-scroll">
        {flow.stage === 'form'
          ? <LaunchFormView draft={draft} onDraft={setDraft} machines={machines} fleet={fleet} onLaunch={launch.launch} />
          : <LaunchProgress flow={flow} machines={machines} onEdit={launch.edit} onRetry={launch.retry} />}
      </div>
    </>
  );
}
```

**3d. CSS.** À la fin de `apps/desktop/src/styles/app.css`, port de `journeys.css` (règles `.launch-*`, l. 4-33 et les deux `@media`) et de `settings.css` (l. 1-3), avec deux adaptations : les libellés sont des `div.launch-field` (le `label` est relié par `htmlFor`, plus fiable pour les noms accessibles qu'un `label` qui enveloppe un `select`) et l'écran défile dans `.launch-scroll` (l'app remplit la fenêtre) :

```css
/* From the mockup's settings.css: the launch screen reuses the settings heading. */
.settings-heading { border-bottom: 1px solid var(--sidebar-border); }
.settings-heading > div:first-child { min-width: 0; }
.settings-heading p { max-width: none; }
/* From the mockup's journeys.css: the launch screens. The app fills the window: the body scrolls inside. */
.launch-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--input) transparent; }
.launch-form, .launch-progress { width: min(100%,650px); margin: 0 auto; padding: 28px 30px 35px; }
.launch-form > .launch-field, .launch-fields .launch-field { display: flex; flex-direction: column; gap: 8px; font-size: 12px; margin-bottom: 22px; }
.launch-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.launch-form input:not([type=radio]), .launch-form select, .launch-form textarea { width: 100%; padding: 11px 12px; border: 1px solid var(--input); border-radius: 6px; background: var(--well); color: var(--sidebar-foreground); font: inherit; font-size: 12px; }
.launch-form textarea { resize: vertical; min-height: 110px; line-height: 1.7; }
.launch-form small, .launch-note { font-size: 10px; line-height: 1.7; color: var(--muted-foreground); }
.launch-form :is(input,select,textarea):focus-visible { outline: 2px solid var(--sidebar-primary); outline-offset: 2px; }
.launch-form [aria-invalid=true] { border-color: var(--danger-text); }
.launch-folder-row { display: flex; gap: 8px; }
.launch-folder-row input { flex: 1; min-width: 0; }
.launch-agents { padding: 0; border: 0; margin: 0 0 23px; display: flex; flex-wrap: wrap; gap: 10px; }
.launch-agents legend { font-size: 12px; margin-bottom: 10px; }
.launch-agents label { flex: 1; min-width: 140px; position: relative; }
.launch-agents input { position: absolute; opacity: 0; }
.launch-agents label > span { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border: 1px solid var(--input); border-radius: 7px; font-size: 11px; cursor: pointer; }
.launch-agents input:checked + span { border-color: var(--sidebar-primary); background: var(--sidebar-accent); }
.launch-agents input:focus-visible + span { outline: 2px solid var(--sidebar-primary); outline-offset: 2px; }
.launch-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 22px; }
.launch-actions > small { margin-right: auto; }
.launch-actions .primary { padding: 11px 16px; font-size: 12px; }
.launch-progress h3 { font-size: 22px; font-weight: 550; margin: 14px 0 8px; }
.launch-progress h3:focus { outline: none; }
.launch-progress > p { font-size: 12px; line-height: 1.7; color: var(--muted-foreground); }
.launch-summary { border-top: 1px solid var(--sidebar-border); border-bottom: 1px solid var(--sidebar-border); margin: 24px 0 14px; padding: 12px 0; }
.launch-summary > div { display: grid; grid-template-columns: 80px minmax(0,1fr); gap: 12px; font-size: 11px; padding: 6px 0; }
.launch-summary dt { color: var(--muted-foreground); }
.launch-summary dd { margin: 0; overflow-wrap: anywhere; }
.launch-prompt { margin: 0; border-left: 2px solid var(--input); padding-left: 14px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
.launch-steps { list-style: none; padding: 0; margin: 26px 0; font-size: 12px; line-height: 2.8; color: var(--muted-foreground); }
.launch-steps [aria-current] { color: var(--sidebar-foreground); }
.launch-spinner { display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 50%; border: 1px solid var(--input); border-top-color: var(--sidebar-primary); animation: launch-spin 1s linear infinite; }
@keyframes launch-spin { to { transform: rotate(360deg); } }
.launch-error, .launch-failed h3 { color: var(--danger-text); }
.launch-error { font-size: 12px; }
@media (max-width: 570px) { .launch-form, .launch-progress { padding: 22px 18px; } .launch-fields { grid-template-columns: 1fr; gap: 0; } }
@media (prefers-reduced-motion: reduce) { .launch-spinner { animation: none; } }
```

(`.workspace-empty .primary` est déjà dans `app.css` depuis le lot 3.)

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test launch && pnpm -r typecheck`
Expected: PASS (les fichiers `launch-*`, `use-launch` compris).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/launch apps/desktop/src/styles/app.css apps/desktop/test/launch-screen.test.tsx
git commit -m "feat(desktop): launch screen with form, starting and failure"
```

---

### Task 6: Shell : « Nouvelle session » branché, écran de lancement, sélection de la nouvelle session

Le bouton de la tête et un bouton « Démarrer une session » dans l'espace vide ouvrent l'écran de lancement, qui remplace la tête et les sessions (les notices de connexion et la barre d'état restent). Le déroulé vit dans le Shell. Quand un lancement aboutit : `desktop.launch` est effacé, puis, dès que le fleet liste la session, elle est sélectionnée (filtre « À votre attention » coupé, panneau replié, curseur dans la réponse). Fermer sans nouvelle session rend le focus au bouton qui a ouvert l'écran. Daemon local injoignable : les deux boutons sont désactivés (spec §6).

**Files:**
- Modify: `apps/desktop/src/shell/Heading.tsx`, `apps/desktop/src/shell/EmptyWorkspace.tsx`, `apps/desktop/src/App.tsx` (Shell)
- Modify: `apps/desktop/test/team-view.test.tsx` (un test ajouté)
- Test: `apps/desktop/test/app-launch.test.tsx`

**Interfaces:**
- Consumes: `useLaunch`, `LaunchApi` (tâche 3) ; `LaunchScreen` (tâche 5) ; `clearLaunch` (tâche 1) ; `recent` (tâche 1, tests) ; `t.empty.start` (tâche 4) ; lot 4 : `useStored`, `setPanel`, `SplitView`, `ConversationPane` (`aside#conversation-pane[data-conversation]`), compositeur `textarea#conversation-reply` (lot 4, tâche 9) ; `createMockDaemon` (`launched`, `refuse`, `recents`, `received`, `close`) et `fakeSession` de `@ledge/fleet/test/mockDaemon`.
- Produces :
  - `Heading` prend `onNewSession?: () => void` ; son bouton porte `data-open-launch="heading"`, désactivé sans `onNewSession` ;
  - `EmptyWorkspace({ onNewSession }: { onNewSession?: () => void })` ; bouton `.primary[data-open-launch="empty"]` « Démarrer une session », désactivé sans `onNewSession` ;
  - dans `Shell` : `openLaunch(from: 'heading' | 'empty'): void` et `canLaunch: boolean` (utilisés par la tâche 7).

- [ ] **Step 1: Write the failing tests**

Dans `apps/desktop/test/team-view.test.tsx`, ajouter dans le `describe` de la tête (après le test qui vérifie le bouton désactivé, qui reste tel quel : rendu sans `onNewSession`) :

```tsx
  it('New session opens the launch screen when the Shell allows it', async () => {
    const onNewSession = vi.fn();
    render(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} onNewSession={onNewSession} />);
    const button = screen.getByRole('button', { name: 'New session' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-open-launch', 'heading');
    await userEvent.click(button);
    expect(onNewSession).toHaveBeenCalledOnce();
  });
```

`apps/desktop/test/app-launch.test.tsx` :

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { recent } from './launch-helpers';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });

/** The real Desktop fleet against the mock daemon: one machine (local) with one recent project, /w/ledge. */
async function boot(seed: { sessions?: Session[]; view?: Record<string, unknown>; selected?: string; panel?: unknown } = {}) {
  localStorage.clear();
  localStorage.setItem('desktop.view', JSON.stringify({ view: 'team', ...seed.view }));
  if (seed.selected) localStorage.setItem('desktop.selected', seed.selected);
  if (seed.panel) localStorage.setItem('desktop.panel', JSON.stringify(seed.panel));
  const d = await createMockDaemon(); daemons.push(d);
  for (const s of seed.sessions ?? []) d.upsert(s);
  d.recents([recent('/w/ledge', '2026-10-15T09:00:00.000Z')]);
  d.machines([{ id: 'local', label: 'Local' }]);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  return d;
}
const launches = (d: Daemon) => d.received.filter(m => m.type === 'session.launch');
const listed = (id: string) => waitFor(() => expect(document.querySelector(`[data-session="${id}"]`)).not.toBeNull());
async function fillAndStart(user: ReturnType<typeof userEvent.setup>, prompt = 'Fix the flaky test') {
  await screen.findByRole('form', { name: 'New session settings' });
  await user.type(screen.getByLabelText('First instruction'), prompt);
  await user.click(screen.getByRole('button', { name: 'Start the session' }));
}

describe('launching from the Shell', () => {
  it('starts a session from the empty workspace and opens its conversation', async () => {
    const user = userEvent.setup();
    const d = await boot({ panel: { width: 38, expanded: true } });
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    // The launch screen takes the place of the heading and the sessions; the status bar stays.
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'New session' })).toBeInTheDocument();
    expect(document.querySelector('.statusbar')).not.toBeNull();
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the flaky test' }]));
    expect(within(screen.getByRole('region', { name: 'Starting the session' })).getByRole('status')).toHaveTextContent('Preparing the session on Local · WSL…');
    expect(localStorage.getItem('desktop.launch')).not.toBeNull();
    d.launched(fakeSession('ari', { name: 'Ari', cwd: '/w/ledge', project: 'ledge', state: 'working' }));
    await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari'));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('conversation-reply')));
    expect(localStorage.getItem('desktop.selected')).toBe('local:ari');
    expect(localStorage.getItem('desktop.launch')).toBeNull();
    expect(JSON.parse(localStorage.getItem('desktop.panel')!)).toMatchObject({ expanded: false });
    expect(screen.queryByRole('form', { name: 'New session settings' })).toBeNull();
  });

  it('turns the attention filter off so the new session shows', async () => {
    const user = userEvent.setup();
    const d = await boot({ sessions: [fakeSession('otto', { name: 'Otto', state: 'waiting_input' })], view: { attentionOnly: true }, selected: 'local:otto' });
    await listed('local:otto');
    await user.click(screen.getByRole('button', { name: 'New session' }));
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    d.launched(fakeSession('ari', { name: 'Ari', state: 'working' }));
    await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari'));
    expect(screen.getByRole('button', { name: /Needs you/ })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-session="local:ari"]')).not.toBeNull();
  });

  it('Cancel closes the screen; the late session is listed, not selected, and the form is kept', async () => {
    const user = userEvent.setup();
    const d = await boot({ sessions: [fakeSession('otto', { name: 'Otto' })], selected: 'local:otto' });
    await listed('local:otto');
    await user.click(screen.getByRole('button', { name: 'New session' }));
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Cancel launch' }));
    expect(screen.getByRole('button', { name: 'New session' })).toHaveFocus();
    d.launched(fakeSession('late', { name: 'Late' }));
    await listed('local:late');
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
    expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto');
    expect(JSON.parse(localStorage.getItem('desktop.launch')!)).toMatchObject({ prompt: 'Fix the flaky test' });
    await user.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.getByLabelText('First instruction')).toHaveValue('Fix the flaky test');
  });

  it('Back to sessions returns the focus to the button that opened the screen', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'Start a session' })).toHaveFocus();
    expect(localStorage.getItem('desktop.launch')).toBeNull();   // nothing typed, nothing written
  });

  it('a refused launch says why; Retry sends the same request and its session is selected', async () => {
    const user = userEvent.setup();
    const d = await boot();
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    await fillAndStart(user);
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    d.refuse('folder not found: /w/ledge');
    expect(await screen.findByRole('alert')).toHaveTextContent('The daemon refused: folder not found: /w/ledge');
    expect(screen.getByRole('heading', { level: 3, name: 'The agent could not start' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(launches(d)).toHaveLength(2));
    expect(launches(d)[1]).toEqual(launches(d)[0]);
    d.launched(fakeSession('ari', { name: 'Ari' }));
    await waitFor(() => expect(localStorage.getItem('desktop.selected')).toBe('local:ari'));
  });
});

// The local daemon never answers: everything is read-only (spec §6).
class DeadSocket { onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3; constructor(public url: string) { setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }
describe('launching while the local daemon is down', () => {
  it('disables New session and Start a session', async () => {
    localStorage.clear();
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    await screen.findByText('Local daemon unreachable');
    expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start a session' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test app-launch team-view`
Expected: FAIL — `onNewSession` inconnu de `Heading`, pas de bouton « Start a session ».

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/shell/Heading.tsx` : la signature prend `onNewSession?: () => void` et le bouton devient :

```tsx
export function Heading({ state, dispatch, attentionCount, onNewSession }: { state: ViewState; dispatch: (a: ViewAction) => void; attentionCount: number; onNewSession?: () => void }) {
```

```tsx
      <button type="button" className="primary" data-open-launch="heading" disabled={!onNewSession} onClick={onNewSession}><span className="plus" aria-hidden="true">+</span>{t.newSession}</button>
```

(Mettre à jour le commentaire de la fonction : « … the toggle, the filter and New session (disabled while read-only). »)

**3b.** `apps/desktop/src/shell/EmptyWorkspace.tsx` :

```tsx
import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from './theme';

/** No session on any machine, whatever the view (spec §9.1): the way to a first launch (spec §9.2). Talking to Ledge comes with a later lot. */
export function EmptyWorkspace({ onNewSession }: { onNewSession?: () => void }) {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <section className="workspace-empty">
      <Bot tool="claude" state="idle" pose={poseFor('empty', 'idle')} size={64} theme={theme} seed="empty" />
      <h3>{t.empty.title}</h3>
      <p>{t.empty.text}</p>
      <button type="button" className="primary" data-open-launch="empty" disabled={!onNewSession} onClick={onNewSession}><span className="plus" aria-hidden="true">+</span>{t.empty.start}</button>
    </section>
  );
}
```

**3c.** `apps/desktop/src/App.tsx` — lire le fichier réel (le lot 4 y a ajouté `SplitView`, `useConversations`, le panneau ; les noms ci-dessous sont ceux du dépôt au commit `b7eb641`). Imports :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLaunch } from './launch/useLaunch';
import { LaunchScreen } from './launch/LaunchScreen';
import { clearLaunch } from './launch/form';
```

Dans `Shell`, après le `useEffect` du `scope` (fin des hooks du lot 4), ajouter :

```tsx
  // The launch lives in the Shell, not in its screen: a start cancelled by closing the screen still owes an answer, skipped (spec §9.2).
  const [created, setCreated] = useState<string | null>(null);
  const onLaunched = useCallback((id: string) => { clearLaunch(); setCreated(id); }, []);
  const launch = useLaunch(fleet, machines, onLaunched);
  const launching = launch.flow.stage !== 'closed';
  // Read-only while the local daemon is down (spec §6): every machine, remote ones too, is reached through it.
  const canLaunch = !localDown;
  const opener = useRef<'heading' | 'empty'>('heading');
  const { open: openFlow } = launch;
  const openLaunch = useCallback((from: 'heading' | 'empty') => { opener.current = from; openFlow(); }, [openFlow]);

  // The new session is selected once the fleet lists it (the daemon broadcasts it just before answering): the attention filter goes
  // off so it shows, the panel folds back, and the cursor goes to the reply once its conversation is on screen (mockup launch.js).
  const replyFor = useRef<string | null>(null);
  useEffect(() => {
    if (!created || !sessions.some(s => s.id === created)) return;
    setCreated(null);
    dispatch({ type: 'attention', on: false });
    dispatch({ type: 'select', id: created });
    setPanel(p => (p.expanded ? { ...p, expanded: false } : p));
    replyFor.current = created;
  }, [created, sessions, dispatch, setPanel]);
  useEffect(() => {
    const id = replyFor.current;
    if (!id || document.getElementById('conversation-pane')?.getAttribute('data-conversation') !== id) return;
    const reply = document.getElementById('conversation-reply');
    if (!reply) return;
    replyFor.current = null;
    reply.focus({ preventScroll: true });
  });
  // Choosing another session before the new one's conversation shows drops the pending focus.
  const pick = (id: string) => { replyFor.current = null; dispatch({ type: 'select', id }); };

  // Closing without a new session (Back to sessions, Cancel) gives the focus back to the button that opened the screen.
  const wasLaunching = useRef(false);
  useEffect(() => {
    if (wasLaunching.current && !launching && !created) {
      (document.querySelector<HTMLElement>(`[data-open-launch="${opener.current}"]`) ?? document.querySelector<HTMLElement>('[data-open-launch]'))?.focus({ preventScroll: true });
    }
    wasLaunching.current = launching;
  }, [launching, created]);
```

Le rendu devient (les `onSelect` de `RoomView` / `TeamView` passent par `pick`, le reste du `SplitView` est inchangé) :

```tsx
  const notices = <>
    {localDown && <LocalDownNotice />}
    <OfflineNotice machines={machines} onRetry={id => fleet.retry(id)} />
  </>;
  return (
    <main className="app" data-readonly={localDown ? 'true' : undefined}>
      <div className="content">
        {launching ? <LaunchScreen launch={launch} machines={machines} fleet={fleet} notices={notices} /> : <>
          <Heading state={state} dispatch={dispatch} attentionCount={sessions.filter(needsAttention).length} onNewSession={canLaunch ? () => openLaunch('heading') : undefined} />
          {notices}
          {(ready || localDown) && sessions.length === 0 && <EmptyWorkspace onNewSession={canLaunch ? () => openLaunch('empty') : undefined} />}
          {sessions.length > 0 && <SplitView panel={panel} onPanel={setPanel}
            list={<>
              {state.view === 'room' && <RoomView sessions={visible} grouping={state.grouping} selected={state.selected} onSelect={pick} onGrouping={grouping => dispatch({ type: 'grouping', grouping })} />}
              {state.view === 'team' && <TeamView sessions={visible} selected={state.selected} onSelect={pick} attentionOnly={state.attentionOnly} />}
            </>}
            pane={selected ? <ConversationPane session={selected} client={fleetClient} api={conversations} expanded={panel.expanded} onExpand={on => setPanel(p => ({ ...p, expanded: on }))} /> : null} />}
        </>}
        <StatusBar sessions={sessions} machines={machines} />
      </div>
    </main>
  );
```

Pourquoi ça tient : dans le commit où la session apparaît, l'effet `visible` (déclaré avant) peut envoyer une liste sans elle (filtre actif) ; les `dispatch` suivants coupent le filtre puis sélectionnent ; au rendu d'après, la liste affichée la contient et l'effet `visible` la garde (le réducteur ne remplace qu'une sélection absente). `LaunchScreen` est monté à l'ouverture : il relit `desktop.launch` à ce moment-là (`useStored`) ; `clearLaunch()` passe avant le démontage et `useStored` n'écrit qu'au changement, donc rien ne réécrit le brouillon après un succès.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS (dont `app.test.tsx` « keeps New session disabled » et le test de `team-view` sans `onNewSession`).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/shell/Heading.tsx apps/desktop/src/shell/EmptyWorkspace.tsx apps/desktop/test/team-view.test.tsx apps/desktop/test/app-launch.test.tsx
git commit -m "feat(desktop): open the launch screen and select the new session"
```

---

### Task 7: Entrée « Nouvelle session » du tray

`main.rs` affiche déjà la fenêtre puis émet `ledge://tray { action: 'new' }` ; l'app l'écoute par `onTrayAction`. `new` ouvre l'écran de lancement (comme le bouton de la tête), sauf en lecture seule ; un écran déjà ouvert (formulaire, démarrage, échec) n'est pas réinitialisé. `open` (fenêtre déjà affichée par Rust) et `dnd` (lot 7) sont ignorés.

**Files:**
- Modify: `apps/desktop/src/App.tsx` (Shell)
- Test: `apps/desktop/test/app-tray.test.tsx`

**Interfaces:**
- Consumes: `onTrayAction(fn: (action: TrayAction) => void): () => void`, `TrayAction` de `src/tauri/bridge.ts` ; `openLaunch`, `canLaunch` (tâche 6) ; `createMockDaemon` ; `recent` (tâche 1).
- Produces : rien de nouveau.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/app-tray.test.tsx` :

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import type { TrayAction } from '../src/tauri/bridge';

// The tray exists only in Tauri: the test takes the listener the Shell registers and plays the menu with it.
const tray = vi.hoisted(() => ({ fire: null as null | ((a: TrayAction) => void) }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  onTrayAction: (fn: (a: TrayAction) => void) => { tray.fire = fn; return () => { tray.fire = null; }; }
}));
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { recent } from './launch-helpers';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });
async function boot() {
  localStorage.clear();
  const d = await createMockDaemon(); daemons.push(d);
  d.recents([recent('/w/ledge', '2026-10-15T09:00:00.000Z')]);
  d.machines([{ id: 'local', label: 'Local' }]);
  const view = render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await screen.findByRole('button', { name: 'Start a session' });
  return { d, view };
}
const form = () => screen.queryByRole('form', { name: 'New session settings' });

describe('tray « Nouvelle session »', () => {
  it('opens the launch screen; « open » and « dnd » change nothing', async () => {
    await boot();
    act(() => tray.fire!('open'));
    act(() => tray.fire!('dnd'));
    expect(form()).toBeNull();
    act(() => tray.fire!('new'));
    expect(form()).not.toBeNull();
    expect(screen.getByLabelText('Machine')).toHaveFocus();
  });

  it('leaves an open form or a start as it is', async () => {
    const user = userEvent.setup();
    const { d } = await boot();
    act(() => tray.fire!('new'));
    await user.type(screen.getByLabelText('First instruction'), 'Keep me');
    act(() => tray.fire!('new'));
    expect(screen.getByLabelText('First instruction')).toHaveValue('Keep me');
    await user.click(screen.getByRole('button', { name: 'Start the session' }));
    await vi.waitFor(() => expect(d.received.filter(m => m.type === 'session.launch')).toHaveLength(1));
    act(() => tray.fire!('new'));
    expect(screen.getByRole('region', { name: 'Starting the session' })).toBeInTheDocument();
  });

  it('stops listening when the app goes away', async () => {
    const { view } = await boot();
    expect(tray.fire).not.toBeNull();
    view.unmount();
    expect(tray.fire).toBeNull();
  });
});

class DeadSocket { onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3; constructor(public url: string) { setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }
describe('tray while the local daemon is down', () => {
  it('is ignored: everything is read-only (spec §6)', async () => {
    localStorage.clear();
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    await screen.findByText('Local daemon unreachable');
    act(() => tray.fire!('new'));
    expect(form()).toBeNull();
  });
});
```

(`getByLabelText('Machine')` : Testing Library compare le libellé exact par défaut ; seul `select#launch-machine` le porte.)

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test app-tray`
Expected: FAIL — `tray.fire` reste `null` (le Shell n'écoute pas le tray).

- [ ] **Step 3: Implement**

Dans `apps/desktop/src/App.tsx`, importer `import { onTrayAction } from './tauri/bridge';` et ajouter dans `Shell`, après `openLaunch` :

```tsx
  // Tray « Nouvelle session » (main.rs shows the window first). Ignored while read-only; an open screen is left as it is
  // (`open` is a no-op unless closed). « Ne pas déranger » and the tray labels' language come with lot 7.
  const trayNew = useRef<() => void>(() => {});
  useEffect(() => { trayNew.current = () => { if (canLaunch) openLaunch('heading'); }; });
  useEffect(() => onTrayAction(action => { if (action === 'new') trayNew.current(); }), []);
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/test/app-tray.test.tsx
git commit -m "feat(desktop): tray New session opens the launch screen"
```

---

### Task 8: Parcours Playwright : aucune session, nouvelle session, démarrage, échec

Les parcours de la spec §12 dans le vrai Chromium, daemon simulé dans la page. `fakeDaemon` / `fakeRemote` apprennent les récents, la réponse d'un lancement et les listings de dossiers.

**Files:**
- Modify: `apps/desktop/e2e/daemon.ts`
- Test: `apps/desktop/e2e/launch.spec.ts`

**Interfaces:**
- Consumes: tout ce qui précède ; `test`, `expect` de `e2e/fixtures.ts` (toute erreur console fait échouer).
- Produces (e2e) :
  - `fakeDaemon(page, initial, extras: { machines?; launcher?; recents?: Recent[] })` ; en plus de `received`, `push`, `upsert`, `remove`, `close` : `launched(s: Session)`, `refuse(message: string)`, `listing(path: string, parent: string | null, entries: string[], error?: string)` ;
  - `fakeRemote(page, alias, initial, extras: { recents?: Recent[] } = {})` ; en plus de `close`, `reopen` : `received: ClientMessage[]`, `push(m)`, `launched(s: Session)`.

- [ ] **Step 1: Extend the simulated daemon**

Dans `apps/desktop/e2e/daemon.ts` (lire le fichier réel : le lot 4 y a ajouté `up` à `fakeDaemon`), importer `Recent` :

```ts
import type { ClientMessage, Machines, Recent, Session } from '@ledge/protocol';
```

`fakeDaemon` : `extras: { machines?: Machines; launcher?: string[]; recents?: Recent[] } = {}`, le snapshot porte les récents :

```ts
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...(extras.launcher ? { launcher: extras.launcher } : {}), ...(extras.recents ? { recents: extras.recents } : {}) }));
```

et l'objet rendu gagne :

```ts
    /** Answers a `session.launch` as the daemon does: the session is broadcast first, then `session.launched` with its raw id. */
    launched(s: Session) { sessions.set(s.id, s); push({ type: 'session.updated', session: s }); push({ type: 'session.launched', id: s.id }); },
    /** Refuses a launch: an `error` with no id (spec §9.2). */
    refuse(message: string) { push({ type: 'error', message }); },
    /** Answers a `folder.list` / `folder.create`. */
    listing(path: string, parent: string | null, entries: string[], error?: string) { push({ type: 'folder.listing', path, parent, entries, ...(error ? { error } : {}) }); },
```

`fakeRemote` devient :

```ts
export async function fakeRemote(page: Page, alias: string, initial: Session[], extras: { recents?: Recent[] } = {}) {
  let sessions = initial;
  let up = true;
  let socket: WebSocketRoute | null = null;
  const received: ClientMessage[] = [];
  await page.routeWebSocket(new RegExp(`127\\.0\\.0\\.1:47831/ssh/${alias}$`), ws => {
    if (!up) { ws.close(); return; }
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sshAlias: alias, sessions, ...(extras.recents ? { recents: extras.recents } : {}) }));
    ws.onMessage(m => { try { received.push(JSON.parse(String(m))); } catch { /* ignore */ } });
  });
  const push = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    push,
    /** Answers a `session.launch` sent to this machine (raw id; the fleet qualifies it with the machine). */
    launched(s: Session) { sessions = [...sessions.filter(x => x.id !== s.id), s]; push({ type: 'session.updated', session: s }); push({ type: 'session.launched', id: s.id }); },
    close() { up = false; socket?.close(); socket = null; },
    reopen(next: Session[] = sessions) { sessions = next; up = true; }
  };
}
```

- [ ] **Step 2: Write the journeys**

`apps/desktop/e2e/launch.spec.ts` :

```ts
import { test, expect } from './fixtures';
import { fakeDaemon, fakeRemote, session } from './daemon';

const recents = [
  { cwd: '/w/website', project: 'website', lastAt: '2026-10-14T10:00:00.000Z' },
  { cwd: '/w/ledge', project: 'ledge', lastAt: '2026-10-15T09:00:00.000Z' }
];
const launches = (received: { type: string }[]) => received.filter(m => m.type === 'session.launch');
const machineField = (page: import('@playwright/test').Page) => page.getByLabel('Machine', { exact: true });

test('no session: a first one starts from the empty workspace', async ({ page }) => {
  const local = await fakeDaemon(page, [], { recents });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a session' }).click();
  await expect(page.getByRole('form', { name: 'New session settings' })).toBeVisible();
  await expect(machineField(page)).toBeFocused();
  await expect(page.getByLabel('Project', { exact: true })).toHaveValue('/w/ledge');   // the most recent one
  await expect(page.getByLabel('Working folder')).toHaveValue('/w/ledge');
  await expect(page.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
  await page.getByLabel('First instruction').fill('Fix the flaky test');
  await page.getByRole('button', { name: 'Start the session' }).click();
  // Démarrage: the request as sent, the focus on its title.
  const starting = page.getByRole('region', { name: 'Starting the session' });
  await expect(starting.getByRole('status')).toHaveText('Preparing the session on Local · WSL…');
  await expect(page.getByRole('heading', { level: 3, name: 'Starting your agent' })).toBeFocused();
  await expect(starting.locator('.launch-prompt')).toHaveText('Fix the flaky test');
  await expect.poll(() => launches(local.received)).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the flaky test' }]);
  local.launched(session('ari', { name: 'Ari', cwd: '/w/ledge', project: 'ledge', state: 'working' }));
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari');
  await expect(page.locator('#conversation-reply')).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('desktop.launch'))).toBeNull();
});

test('New session: the default agent, a checked folder, a draft across a reload, a refusal', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.tool', JSON.stringify('codex')); } catch { /* ignore */ } });
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await expect(page.locator('[data-session="local:otto"]')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByRole('radio', { name: 'Codex' })).toBeChecked();
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'Other folder…' });
  await expect(page.getByLabel('Working folder')).toBeFocused();
  await expect(page.getByLabel('Working folder')).toHaveValue('');
  await page.getByLabel('Working folder').fill('w/relative');
  await page.getByLabel('First instruction').fill('Write the docs');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter an absolute folder (/…) or one starting with ~.');
  await expect(page.getByLabel('Working folder')).toBeFocused();
  expect(launches(local.received)).toEqual([]);
  await page.getByLabel('Working folder').fill('~/notes');
  // The form is kept in desktop.launch: a reload brings it back (the screen itself starts closed).
  await page.reload();
  await expect(page.locator('[data-session="local:otto"]')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByLabel('Working folder')).toHaveValue('~/notes');
  await expect(page.getByLabel('First instruction')).toHaveValue('Write the docs');
  await expect(page.getByRole('radio', { name: 'Codex' })).toBeChecked();
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => launches(local.received)).toEqual([{ type: 'session.launch', tool: 'codex', cwd: '~/notes', prompt: 'Write the docs' }]);
  // Échec: why, then Edit settings keeps everything.
  local.refuse('folder not found: ~/notes');
  await expect(page.getByRole('alert')).toHaveText('The daemon refused: folder not found: ~/notes');
  await expect(page.getByRole('heading', { level: 3, name: 'The agent could not start' })).toBeFocused();
  await page.getByRole('button', { name: 'Edit settings' }).click();
  await expect(page.getByLabel('Working folder')).toHaveValue('~/notes');
  await expect(page.getByLabel('First instruction')).toHaveValue('Write the docs');
  expect(await page.evaluate(() => localStorage.getItem('desktop.tool'))).toBe('"codex"');   // the form never writes the default
});

test('a start that times out is retried; the first answer, late, is skipped', async ({ page }) => {
  await page.clock.install();
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await expect(page.locator('[data-session="local:otto"]')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByLabel('First instruction').fill('Fix the flaky test');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => launches(local.received).length).toBe(1);
  await page.clock.fastForward(14_000);
  await expect(page.getByRole('region', { name: 'Starting the session' })).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(page.getByRole('alert')).toHaveText('The daemon did not answer in time. No new session was confirmed.');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => launches(local.received).length).toBe(2);
  expect(launches(local.received)[1]).toEqual(launches(local.received)[0]);
  // The daemon answers in order: the first `launched` is the timed-out attempt's, the second this one's.
  local.launched(session('late', { name: 'Late' }));
  local.launched(session('ari', { name: 'Ari' }));
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:ari');
  await expect(page.locator('[data-session="local:late"]')).toBeVisible();
});

test('Cancel closes the screen; the late session is listed but not selected', async ({ page }) => {
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await page.locator('[data-session="local:otto"]').click();
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto');
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByLabel('First instruction').fill('Fix the flaky test');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => launches(local.received).length).toBe(1);
  await page.getByRole('button', { name: 'Cancel launch' }).click();
  await expect(page.getByRole('button', { name: 'New session' })).toBeFocused();
  local.launched(session('late', { name: 'Late' }));
  await expect(page.locator('[data-session="local:late"]')).toBeVisible();
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByLabel('First instruction')).toHaveValue('Fix the flaky test');
});

test('a remote machine gets its own launch; a disconnected one cannot be chosen', async ({ page }) => {
  const machines = [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }];
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { machines, recents });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova' })], { recents: [{ cwd: '/home/dev/api', project: 'api', lastAt: '2026-10-15T08:00:00.000Z' }] });
  await page.goto('/');
  await expect(page.locator('[data-session]')).toHaveCount(2);
  await page.getByRole('button', { name: 'New session' }).click();
  await machineField(page).selectOption('devbox');
  await expect(page.getByLabel('Working folder')).toHaveValue('/home/dev/api');
  await page.getByLabel('First instruction').fill('Run the tests');
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect(page.getByRole('region', { name: 'Starting the session' }).getByRole('status')).toHaveText('Preparing the session on Devbox · SSH…');
  await expect.poll(() => launches(remote.received)).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/home/dev/api', prompt: 'Run the tests' }]);
  expect(launches(local.received)).toEqual([]);
  remote.launched(session('ari', { name: 'Ari', cwd: '/home/dev/api', project: 'api' }));
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'devbox:ari');
  // Devbox falls: the launch screen keeps the connection notice and offers only Local.
  remote.close();
  await expect(page.getByText('Devbox is disconnected')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page.getByText('Devbox is disconnected')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Devbox · SSH · disconnected' })).toBeDisabled();
  await expect(machineField(page)).toHaveValue('local');
  await expect(page.getByText('Devbox · SSH is disconnected. You can start a session on Local · WSL.')).toBeVisible();
});

test('the folder browser lists the chosen machine and fills the folder', async ({ page }) => {
  const local = await fakeDaemon(page, [], { recents });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a session' }).click();
  await page.getByRole('button', { name: 'Browse…' }).click();
  const browser = page.getByRole('region', { name: 'Folders on Local · WSL' });
  await expect(browser).toBeVisible();
  const lists = () => local.received.filter(m => m.type === 'folder.list');
  await expect.poll(lists).toEqual([{ type: 'folder.list', path: '/w/ledge' }]);
  local.listing('/w/ledge', '/w', ['apps', 'docs']);
  await browser.getByRole('button', { name: 'Open apps' }).click();
  await expect.poll(() => lists().length).toBe(2);
  local.listing('/w/ledge/apps', '/w/ledge', ['desktop']);
  await expect(browser.getByRole('button', { name: 'Open desktop' })).toBeVisible();
  await browser.getByRole('button', { name: 'Choose this folder' }).click();
  await expect(browser).toBeHidden();
  await expect(page.getByLabel('Working folder')).toHaveValue('/w/ledge/apps');
  await expect(page.getByLabel('Working folder')).toBeFocused();
});

test('read-only: New session is disabled while the local daemon is down', async ({ page }) => {
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto' })], { recents });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New session' })).toBeEnabled();
  local.close();
  await expect(page.getByRole('alert')).toContainText('Local daemon unreachable');
  await expect(page.getByRole('button', { name: 'New session' })).toBeDisabled();
});

for (const size of [{ width: 1920, height: 1080 }, { width: 1024, height: 700 }]) {
  test(`the launch screen fills a ${size.width}×${size.height} window and scrolls inside`, async ({ page }) => {
    await page.setViewportSize(size);
    await fakeDaemon(page, [], { recents });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start a session' }).click();
    await expect(page.getByRole('form', { name: 'New session settings' })).toBeVisible();
    expect(await page.locator('main.app').boundingBox()).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
    const bar = (await page.locator('.statusbar').boundingBox())!;
    expect(bar.y + bar.height).toBe(size.height);
    expect(await page.locator('.launch-scroll').evaluate(e => getComputedStyle(e).overflowY)).toBe('auto');
    await page.getByRole('button', { name: 'Start the session' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Start the session' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
  });
}
```

Notes pour l'implémenteur :
- `page.clock.install()` avant `page.goto` : la minuterie de 15 s ne part qu'au clic ; `fastForward(14_000)` puis `(1_000)` vérifie qu'elle ne tombe pas avant 15 s. Si l'install du clock fige autre chose au démarrage (attente d'une première connexion), avancer de `100` ms après `goto` plutôt que de toucher au code.
- Le second test vérifie l'échec « refus du daemon » ; le troisième l'échec « délai dépassé » ; « Réessayer » renvoie la même requête (spec §9.2).
- Les options du `select` de machine portent `machineName` + disponibilité (`Devbox · SSH · disconnected`) : le nom accessible d'une `option` est son texte.

- [ ] **Step 3: Run**

Run: `pnpm --filter desktop exec playwright test launch layout offline`
Expected: PASS (et aucune erreur console : `e2e/fixtures.ts`).

- [ ] **Step 4: Run all the gates**

Run: `pnpm -r typecheck && pnpm --filter desktop test && pnpm --filter desktop exec playwright test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e/daemon.ts apps/desktop/e2e/launch.spec.ts
git commit -m "test(desktop): launch journeys: empty workspace, new session, start, failure"
```
