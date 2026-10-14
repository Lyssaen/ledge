# Ledge Desktop, lot 3 : squelette `apps/desktop` — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une application Tauri `Ledge Desktop` installable et mise à jour en lockstep avec l'île, qui montre les vues Équipe et Réunion de la maquette validée branchées sur le fleet réel (plusieurs machines, pairs figés), avec sélection, filtre « À votre attention », regroupement Jira et persistance de la vue — sans panneau de conversation.

**Architecture:** `apps/desktop` est une seconde app Vite + React 19 + Tauri 2 du monorepo, qui consomme `@ledge/ui` (styles, mascottes, préférences avec préfixe `desktop`), `@ledge/fleet` (`createFleetClient` avec `keepStale: true` et `machinesFromDaemon: true`) et `ledge-native` (terminal, URL, autostart). Le code propre à Desktop est découpé par responsabilité : `grouping/` (pur, porté de la maquette), `state/` (reducer de vue + persistance validée champ par champ), `team/` et `room/` (vues), `tauri/bridge.ts`. Le build et la release suivent ceux de l'île : un script de version racine, `latest-desktop.json`, un second job NSIS dans `release.yml`.

**Tech Stack:** TypeScript, React 19, Vite 6, Tailwind 4, Tauri 2.6 (`tauri-plugin-window-state`, `updater`, `process`, `autostart`), vitest 3 + Testing Library + jsdom, Playwright 1.49, Rust 2021, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` (§4.4, §4.5, §6, §7, §8, §9.1 pour la sélection seulement, §10 tray, §11, §12 « Desktop », §13 lot 3, §14). Maquette : `../ledge-desktop/mockup/` (`app.js`, `app.css`, `grouping.js`) et `HANDOFF.md`.

## Global Constraints

- Prérequis : lots 1 et 2 fusionnés.
- Port Vite **1421** `strictPort` ; le daemon l'autorise depuis le lot 2. Playwright sur **5299** (`webServer: vite --port 5299 --strictPort --host 127.0.0.1`), comme l'île sur 5199.
- Clés `localStorage` toutes préfixées `desktop.` ; dans ce lot : `desktop.view` (`{ view: 'team' | 'room', grouping: 'all' | 'machine' | 'jira', attentionOnly: boolean }`), `desktop.selected` (id qualifié ou `'ledge'`), `desktop.lang`, `desktop.theme`. Chaque lecture valide champ par champ et retombe sur la valeur par défaut (spec §7).
- Identifiant Tauri `be.paradow.ledge.desktop`, `productName` « Ledge Desktop », fenêtre `main` décorée, redimensionnable, 1280×800, min 640×480, position et taille par `tauri-plugin-window-state` ; fermer = cacher dans le tray ; « Quitter » arrête (spec §4.4). CSP identique à l'île : `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src ipc: http://ipc.localhost ws://127.0.0.1:47831`.
- Tray : Ouvrir / Nouvelle session / Ne pas déranger / Quitter (spec §4.4) ; dans ce lot « Nouvelle session » et « Ne pas déranger » émettent l'événement `ledge://tray` et l'app l'ignore (lots 5 et 7).
- Regroupement Jira : regex **`/\b[A-Z][A-Z0-9]+-\d+\b/g`** (spec §8, pas celle de la maquette), dans `branch` puis `topic` ; une clé → table ; aucune → « Sans story identifiée » ; plusieurs → « À clarifier » ; jamais d'appel Jira. Ordre des groupes = première apparition.
- « À votre attention » = sessions non `offline` dont l'état est `waiting_permission` ou `waiting_input` (valeurs de `SessionStateSchema`).
- Release en lockstep : une version, deux installeurs, `latest.json` + `latest-desktop.json`, même clé minisign (`TAURI_SIGNING_PRIVATE_KEY`), NSIS `currentUser`, `installMode: passive`, `createUpdaterArtifacts: true` (spec §11). La mise à jour du daemon reste celle de l'île.
- **Pas de `cargo` dans ce WSL** : les étapes Rust se vérifient via `gh workflow run release.yml` (dry run) ou sur Windows. Les tests Rust de ce lot sont des tests unitaires de fonctions pures dans `main.rs` ; le build Tauri n'est vérifié qu'en CI.
- Aucune erreur console dans les tests Playwright : chaque spec échoue sur `page.on('console', …)` de type `error` (spec §12).
- Textes en français et en anglais dans `src/i18n/messages.ts` comme l'île (`fr` source de vérité, `Messages = typeof fr`).
- Commits : `feat(desktop): …`, `chore(release): …`. Branche `desktop/lot3-skeleton`.

## Review Focus

1. Sélection d'une session qui devient **invisible** (filtre « À votre attention » activé, regroupement changé, ou machine retirée) : la sélection passe à la première session visible, jamais à une session absente de l'écran, et `desktop.selected` suit. Test ajouté à la tâche 3.
2. `desktop.view` ou `desktop.selected` **corrompus** dans `localStorage` (`"room"` sans objet, `grouping: 'foo'`, `attentionOnly: 'yes'`) : l'app démarre sur les défauts sans lever d'exception ni effacer les autres clés. Test ajouté à la tâche 3.
3. Une branche qui contient **deux fois la même clé** (`feat/LEDGE-42-and-LEDGE-42`) va dans la table `LEDGE-42`, pas dans « À clarifier » ; une clé minuscule (`ledge-42`) ou un mot comme `UTF-8` (chiffres avant le tiret) n'est pas une clé. Test ajouté à la tâche 2.
4. Machine distante **figée** (`keepStale`) : ses sièges restent à la table, grisés, la bannière « Devbox est déconnectée · Reconnexion… » apparaît, un clic sur un siège figé sélectionne sans erreur, et le retour de la machine remplace les sièges sans doublon. Test ajouté à la tâche 6 (vitest) et à la tâche 8 (Playwright).
5. Le script de version doit **refuser** de laisser l'une des deux apps en arrière : si `apps/desktop/src-tauri/tauri.conf.json` n'a pas exactement une occurrence de version, il sort en erreur avant d'avoir écrit quoi que ce soit ailleurs. Test ajouté à la tâche 9.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `apps/desktop/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `playwright.config.ts` | App Vite/vitest/Playwright, port 1421 |
| `apps/desktop/src/main.tsx`, `src/App.tsx` | Racine React ; `App` compose providers, fleet et vues |
| `apps/desktop/src/styles/app.css` | `@import "tailwindcss"; @import "@ledge/ui/styles/base.css";` + règles de la maquette (`app.css`) |
| `apps/desktop/src/i18n/messages.ts`, `src/i18n/lang.tsx` | Textes fr/en ; `createI18n({ prefix: 'desktop' })` |
| `apps/desktop/src/grouping/story.ts`, `grouping/groups.ts` | Clé Jira et tables (spec §8) |
| `apps/desktop/src/state/view.ts`, `state/persist.ts`, `state/useViewState.ts` | Reducer de vue, lecture/écriture validées, hook |
| `apps/desktop/src/fleet/useFleet.ts` | Un `createFleetClient` par app, `keepStale: true`, `machinesFromDaemon: true`, `prefix: 'desktop'` |
| `apps/desktop/src/team/TeamView.tsx`, `team/SessionCard.tsx` | Vue Équipe (grille de cartes par projet) |
| `apps/desktop/src/room/RoomView.tsx`, `room/Table.tsx`, `room/geometry.ts` | Vue Réunion (tables, sièges, tailles de la maquette) |
| `apps/desktop/src/shell/Heading.tsx`, `shell/StatusBar.tsx`, `shell/OfflineNotice.tsx` | En-tête (bascule de vue, filtre), barre d'état, bannière machine déconnectée |
| `apps/desktop/src/tauri/bridge.ts` | `isTauri`, `focusTerminal`, `openTerminal`, `openUrl`, `onTrayAction`, `getAutostart`, `setAutostart` |
| `apps/desktop/test/setup.ts`, `test/*.test.ts(x)` | vitest |
| `apps/desktop/e2e/daemon.ts`, `e2e/fixtures.ts`, `e2e/*.spec.ts` | Playwright avec faux daemon en page |
| `apps/desktop/src-tauri/Cargo.toml`, `build.rs`, `src/main.rs`, `tauri.conf.json`, `capabilities/default.json`, `windows/hooks.nsh`, `icons/*` | App Tauri |
| `Cargo.toml` (racine, modifier) | `members += "apps/desktop/src-tauri"` |
| `scripts/set-version.mjs`, `scripts/latest-json.mjs`, `test/version.test.ts`, `test/latest-json.test.ts` (déplacer depuis `apps/overlay/scripts` et `apps/overlay/test`, racine) | Version lockstep, manifestes |
| `.github/workflows/release.yml` (modifier) | Second build NSIS, `latest-desktop.json`, `Ledge Desktop_x.y.z_x64-setup.exe` |
| `package.json` (racine, modifier) | `version:set: node scripts/set-version.mjs`, `test` couvre `test/` racine |
| `README.md` (modifier) | Section « Ledge Desktop » : lancer en dev, installer |

---

### Task 1: Scaffold `apps/desktop` (Vite, vitest, i18n, styles, App vide)

**Files:**
- Create: `apps/desktop/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/app.css`, `src/i18n/messages.ts`, `src/i18n/lang.tsx`, `test/setup.ts`, `test/app.test.tsx`

**Interfaces:**
- Produces: `App(): JSX.Element` ; `i18n` de Desktop : `const { loadLang, saveLang, setFallbackLang, LangProvider, useI18n, messagesFor } = createI18n({ langs: LANGS, messages: MESSAGES, fallback: 'fr', prefix: 'desktop', uiCopy })` ; `Messages` avec au moins : `app.title`, `views.team`, `views.room`, `attention.filter`, `newSession`, `team.all(n)`, `team.attention`, `room.grouping`, `room.groupings.{all,machine,jira}`, `room.tables.{all,unassigned,ambiguous,mine}`, `room.pending(n)`, `room.allGood`, `room.captions.{machine,detected,unassigned,mine}`, `empty.{title,text}`, `offline.{title(name),reconnecting(name),retry}`, `status.{sessions(n),connected(name),unreachable(name)}`, `botLabel`, `botReadOnly`, `botNotLive`, `resident.{name,offline}`, `states.{starting,working,waiting_permission,waiting_input,idle,exited,error}`.

- [ ] **Step 1: Test**

`apps/desktop/test/app.test.tsx` :

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('Desktop shell', () => {
  it('renders the team and room toggles in English', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meeting' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test` (le paquet n'existe pas)

- [ ] **Step 3: Créer l'app**

`apps/desktop/package.json` :

```json
{
  "name": "desktop",
  "private": true,
  "version": "0.5.2",
  "type": "module",
  "scripts": {
    "dev": "vite", "build": "tsc --noEmit && vite build", "test": "vitest run", "typecheck": "tsc --noEmit",
    "tauri": "tauri", "test:e2e": "playwright test"
  },
  "dependencies": {
    "@ledge/fleet": "workspace:*", "@ledge/protocol": "workspace:*", "@ledge/ui": "workspace:*",
    "@tauri-apps/api": "^2.6.0", "@tauri-apps/plugin-process": "^2.4.0", "@tauri-apps/plugin-updater": "^2.13.3",
    "react": "^19.0.0", "react-dom": "^19.0.0", "zod": "^3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "1.49.1", "@tailwindcss/vite": "^4.0.0", "@tauri-apps/cli": "^2.1.0",
    "@testing-library/jest-dom": "^6.6.0", "@testing-library/react": "^16.1.0", "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.7.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@types/ws": "^8.5.0",
    "@vitejs/plugin-react": "^4.3.0", "jsdom": "^25.0.0", "tailwindcss": "^4.0.0", "typescript": "^5.6.0",
    "vite": "^6.0.0", "vitest": "^3.0.0", "ws": "^8.18.0"
  }
}
```

(Reprendre les versions exactes de `apps/overlay/package.json` si elles diffèrent : une seule version de chaque devDep dans le lockfile.)

`vite.config.ts` :

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1421, strictPort: true },   // the daemon allows this origin (spec §5.4)
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], include: ['test/**/*.test.{ts,tsx}'], env: { VITE_LEDGE_MOTION: '0' } }
});
```

`tsconfig.json` : copie de `apps/overlay/tsconfig.json`. `index.html` : copie de celui de l'île avec `<title>Ledge Desktop</title>` et `lang="fr" data-theme="dark"`. `test/setup.ts` : copie de `apps/overlay/test/setup.ts` avec `setFallbackLang('en')` importé de `../src/i18n/lang`.

`src/i18n/messages.ts` : objet `fr` avec les clés listées dans **Interfaces** et leurs textes de la maquette (« Toute l’équipe », « Par machine », « Par story Jira », « Sans story identifiée », « À clarifier », « Mon espace », « n demande(s) en attente », « Tout le monde avance », « Votre équipe commence ici », « Devbox est déconnectée » → `offline.title: (name) => \`${name} est déconnectée\``, « Reconnexion à Devbox… », « Réessayer », « n sessions », « Local connecté ») ; `botLabel`/`botReadOnly`/`botNotLive`/`resident` copiés de l'île ; `en` traduit (`views.team: 'Team'`, `views.room: 'Meeting'`, `room.tables.unassigned: 'No story identified'`, `room.tables.ambiguous: 'To clarify'`, …) ; `export type Messages = typeof fr; export type Lang = 'fr' | 'en'; export const LANGS: readonly Lang[] = ['fr', 'en']; export const MESSAGES: Record<Lang, Messages> = { fr, en };`.

`src/i18n/lang.tsx` : identique à la façade de l'île (lot 1, tâche 3) avec `prefix: 'desktop'`.

`src/styles/app.css` : `@import "tailwindcss"; @import "@ledge/ui/styles/base.css";` puis les règles de `mockup/assets/app.css` copiées (en-tête, bascule, filtre, cartes, tables, sièges, points de rupture 1500/1200/950/760/570, `prefers-reduced-motion`) ; les sélecteurs de la maquette sont conservés (`.view-heading`, `.view-toggle`, `.session-card`, `.table-group`, `.meeting-table`, `.seat`, …) pour que le rendu suive la maquette sans réécriture.

`src/main.tsx` : `createRoot(document.getElementById('root')!).render(<App />)` avec `import './styles/app.css'`.

`src/App.tsx` (première version, complétée aux tâches 4–7) :

```tsx
import { useState } from 'react';
import { LangProvider, loadLang, useI18n } from './i18n/lang';

function Shell() {
  const { t } = useI18n();
  return (
    <main className="app">
      <header className="view-heading">
        <div className="view-toggle" role="group">
          <button type="button" aria-pressed="false">{t.views.team}</button>
          <button type="button" aria-pressed="true">{t.views.room}</button>
        </div>
      </header>
    </main>
  );
}
export function App() { const [lang] = useState(loadLang); return <LangProvider lang={lang}><Shell /></LangProvider>; }
```

- [ ] **Step 4: Run, expect PASS** : `pnpm install && pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`

- [ ] **Step 5: Commit** : `git checkout -b desktop/lot3-skeleton && git add apps/desktop pnpm-lock.yaml && git commit -m "feat(desktop): Vite app scaffold with i18n and shared styles"`

---

### Task 2: Regroupement Jira (`grouping/`)

**Files:**
- Create: `apps/desktop/src/grouping/story.ts`, `src/grouping/groups.ts`, `test/grouping.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Story { key: string | null; keys: string[]; ambiguous: boolean; source: 'branch' | 'topic' | null }
  export function story(s: Pick<Session, 'branch' | 'topic'>): Story;
  export type Grouping = 'all' | 'machine' | 'jira';
  export interface Table { id: string; kind: 'all' | 'machine' | 'story' | 'ambiguous' | 'unassigned'; label: string; sessions: Session[] }
  export function tables(sessions: Session[], mode: Grouping, t: Messages): Table[];
  ```

- [ ] **Step 1: Test**

`apps/desktop/test/grouping.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { story, tables } from '../src/grouping/groups';
import { MESSAGES } from '../src/i18n/messages';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';

const t = MESSAGES.en;
const s = (id: string, extra: Partial<Session> = {}) => fakeSession(id, extra);   // Session de @ledge/protocol

describe('story key', () => {
  it('reads the branch first, then the topic', () => {
    expect(story({ branch: 'release/LEDGE-42-v0.5.0' })).toEqual({ key: 'LEDGE-42', keys: ['LEDGE-42'], ambiguous: false, source: 'branch' });
    expect(story({ branch: 'docs/protocol', topic: 'LEDGE-42 · Documenter le protocole' })).toEqual({ key: 'LEDGE-42', keys: ['LEDGE-42'], ambiguous: false, source: 'topic' });
    expect(story({ branch: 'feat/bot-motion' })).toEqual({ key: null, keys: [], ambiguous: false, source: null });
  });
  it('the same key twice is one key; two keys are ambiguous', () => {
    expect(story({ branch: 'feat/LEDGE-42-and-LEDGE-42' }).key).toBe('LEDGE-42');
    expect(story({ branch: 'feat/LEDGE-42-WEB-18' })).toEqual({ key: null, keys: ['LEDGE-42', 'WEB-18'], ambiguous: true, source: 'branch' });
  });
  it('lowercase and digit-first tokens are not keys', () => {
    expect(story({ branch: 'fix/ledge-42' }).key).toBeNull();
    expect(story({ topic: 'encode UTF-8 output' }).key).toBeNull();
    expect(story({ topic: 'A1-2 edge' }).key).toBe('A1-2');
  });
});

describe('tables', () => {
  const eight = [
    s('otto', { branch: 'release/LEDGE-42-v0.5.0', machineId: 'local', machineName: 'Local' }),
    s('nova', { branch: 'fix/LEDGE-42-ssh-reconnect', machineId: 'devbox', machineName: 'Devbox' }),
    s('pim', { branch: 'feat/bot-motion', machineId: 'local', machineName: 'Local' }),
    s('bix', { branch: 'docs/protocol', topic: 'LEDGE-42 · Documenter le protocole', machineId: 'local', machineName: 'Local' }),
    s('luna', { branch: 'feat/WEB-18-homepage', machineId: 'local', machineName: 'Local' }),
    s('milo', { branch: 'fix/WEB-18-mobile-layout', machineId: 'devbox', machineName: 'Devbox' }),
    s('echo', { branch: 'test/LEDGE-42-notifications', machineId: 'local', machineName: 'Local' }),
    s('rio', { branch: 'feat/WEB-18-accessibility', machineId: 'devbox', machineName: 'Devbox' })
  ];
  it('all together: one table of eight', () => {
    const out = tables(eight, 'all', t);
    expect(out.map(x => [x.id, x.kind, x.sessions.length])).toEqual([['all', 'all', 8]]);
  });
  it('by machine: 5 and 3, first-seen order', () => {
    expect(tables(eight, 'machine', t).map(x => [x.id, x.label, x.sessions.length])).toEqual([['local', 'Local', 5], ['devbox', 'Devbox', 3]]);
  });
  it('by Jira key: 4 / 3 / 1 unassigned, with a stable order', () => {
    expect(tables(eight, 'jira', t).map(x => [x.id, x.kind, x.sessions.length])).toEqual([['LEDGE-42', 'story', 4], ['unassigned', 'unassigned', 1], ['WEB-18', 'story', 3]]);
    expect(tables(eight, 'jira', t)[1]!.label).toBe(t.room.tables.unassigned);
  });
  it('a session with two keys sits at the "to clarify" table', () => {
    const out = tables([...eight, s('zed', { branch: 'feat/LEDGE-42-WEB-18' })], 'jira', t);
    expect(out.find(x => x.kind === 'ambiguous')).toMatchObject({ id: 'ambiguous', label: t.room.tables.ambiguous });
    expect(out.find(x => x.kind === 'ambiguous')!.sessions.map(x => x.id)).toEqual(['zed']);
  });
  it('a machine without id goes to an unknown machine table', () => {
    expect(tables([s('x')], 'machine', t).map(x => x.id)).toEqual(['unknown']);
  });
  it('an empty list makes no table', () => { expect(tables([], 'jira', t)).toEqual([]); });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test grouping`

- [ ] **Step 3: Implémenter**

`src/grouping/story.ts` :

```ts
import type { Session } from '@ledge/protocol';

/** A Jira key as text (spec §8): never looked up, never linked. */
const KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;
export interface Story { key: string | null; keys: string[]; ambiguous: boolean; source: 'branch' | 'topic' | null }

const found = (text: string | undefined): string[] => [...new Set(text?.match(KEY) ?? [])];

/** The branch speaks first; the topic only when the branch names no key. */
export function story(s: Pick<Session, 'branch' | 'topic'>): Story {
  for (const source of ['branch', 'topic'] as const) {
    const keys = found(s[source]);
    if (keys.length === 1) return { key: keys[0]!, keys, ambiguous: false, source };
    if (keys.length > 1) return { key: null, keys, ambiguous: true, source };
  }
  return { key: null, keys: [], ambiguous: false, source: null };
}
```

`src/grouping/groups.ts` :

```ts
import type { Session } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { story } from './story';
export { story } from './story';

export type Grouping = 'all' | 'machine' | 'jira';
export interface Table { id: string; kind: 'all' | 'machine' | 'story' | 'ambiguous' | 'unassigned'; label: string; sessions: Session[] }

/** Tables in first-appearance order, as the mockup lays them out (spec §8). */
export function tables(sessions: Session[], mode: Grouping, t: Messages): Table[] {
  const out: Table[] = []; const by = new Map<string, Table>();
  const at = (id: string, kind: Table['kind'], label: string, s: Session) => { let g = by.get(id); if (!g) { g = { id, kind, label, sessions: [] }; by.set(id, g); out.push(g); } g.sessions.push(s); };
  for (const s of sessions) {
    if (mode === 'all') at('all', 'all', t.room.tables.all, s);
    else if (mode === 'machine') at(s.machineId ?? 'unknown', 'machine', s.machineName ?? t.room.tables.unknownMachine, s);
    else { const st = story(s); if (st.key) at(st.key, 'story', st.key, s); else if (st.ambiguous) at('ambiguous', 'ambiguous', t.room.tables.ambiguous, s); else at('unassigned', 'unassigned', t.room.tables.unassigned, s); }
  }
  return out;
}
```

Ajouter `room.tables.unknownMachine: 'Machine inconnue'` / `'Unknown machine'` aux messages.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test grouping`

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): Jira story detection and meeting tables"`

---

### Task 3: État de vue et persistance (`state/`)

**Files:**
- Create: `src/state/view.ts`, `src/state/persist.ts`, `src/state/useViewState.ts`, `test/view-state.test.ts`, `test/persist.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ViewState { view: 'team' | 'room'; grouping: Grouping; attentionOnly: boolean; selected: string | null }   // selected: qualified id or 'ledge'
  export type ViewAction = { type: 'view'; view: 'team' | 'room' } | { type: 'grouping'; grouping: Grouping } | { type: 'attention'; on: boolean } | { type: 'select'; id: string | null } | { type: 'visible'; ids: string[] };
  export const DEFAULT_VIEW: ViewState;   // { view: 'room', grouping: 'all', attentionOnly: false, selected: null }
  export function reduce(state: ViewState, action: ViewAction): ViewState;
  export function loadViewState(): ViewState;   // desktop.view + desktop.selected, validated field by field
  export function saveViewState(s: ViewState): void;
  export function useViewState(): [ViewState, (a: ViewAction) => void];   // useReducer + save on change
  ```

- [ ] **Step 1: Tests**

`test/view-state.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW, reduce } from '../src/state/view';

describe('view reducer', () => {
  it('switches view, grouping and filter', () => {
    let s = reduce(DEFAULT_VIEW, { type: 'view', view: 'team' }); expect(s.view).toBe('team');
    s = reduce(s, { type: 'grouping', grouping: 'jira' }); expect(s.grouping).toBe('jira');
    s = reduce(s, { type: 'attention', on: true }); expect(s.attentionOnly).toBe(true);
  });
  it('keeps the selection when it is still visible, replaces it by the first visible otherwise', () => {
    let s = reduce(DEFAULT_VIEW, { type: 'select', id: 'local:otto' });
    s = reduce(s, { type: 'visible', ids: ['local:pim', 'local:otto'] }); expect(s.selected).toBe('local:otto');
    s = reduce(s, { type: 'visible', ids: ['local:pim', 'devbox:nova'] }); expect(s.selected).toBe('local:pim');
    s = reduce(s, { type: 'visible', ids: [] }); expect(s.selected).toBeNull();
  });
  it('the Ledge chat selection survives a visibility change', () => {
    const s = reduce(reduce(DEFAULT_VIEW, { type: 'select', id: 'ledge' }), { type: 'visible', ids: ['local:pim'] });
    expect(s.selected).toBe('ledge');
  });
  it('returns the same object when nothing changes', () => {
    const s = reduce(DEFAULT_VIEW, { type: 'select', id: null });
    expect(reduce(s, { type: 'visible', ids: ['a'] })).toBe(s);
  });
});
```

`test/persist.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadViewState, saveViewState } from '../src/state/persist';
import { DEFAULT_VIEW } from '../src/state/view';

beforeEach(() => localStorage.clear());

describe('view persistence', () => {
  it('round-trips under desktop.view and desktop.selected', () => {
    saveViewState({ view: 'team', grouping: 'jira', attentionOnly: true, selected: 'local:otto' });
    expect(JSON.parse(localStorage.getItem('desktop.view')!)).toEqual({ view: 'team', grouping: 'jira', attentionOnly: true });
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
    expect(loadViewState()).toEqual({ view: 'team', grouping: 'jira', attentionOnly: true, selected: 'local:otto' });
  });
  it('validates field by field and keeps what is sound', () => {
    localStorage.setItem('desktop.view', JSON.stringify({ view: 'team', grouping: 'foo', attentionOnly: 'yes' }));
    expect(loadViewState()).toEqual({ ...DEFAULT_VIEW, view: 'team' });
    localStorage.setItem('desktop.view', '"room"'); expect(loadViewState()).toEqual(DEFAULT_VIEW);
    localStorage.setItem('desktop.view', '{not json'); expect(loadViewState()).toEqual(DEFAULT_VIEW);
    localStorage.setItem('desktop.selected', ''); expect(loadViewState().selected).toBeNull();
    localStorage.setItem('desktop.lang', 'en'); loadViewState(); expect(localStorage.getItem('desktop.lang')).toBe('en');
  });
  it('a null selection removes the key', () => {
    saveViewState({ ...DEFAULT_VIEW, selected: 'ledge' }); saveViewState(DEFAULT_VIEW);
    expect(localStorage.getItem('desktop.selected')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test view-state persist`

- [ ] **Step 3: Implémenter**

`src/state/view.ts` :

```ts
import type { Grouping } from '../grouping/groups';

export interface ViewState { view: 'team' | 'room'; grouping: Grouping; attentionOnly: boolean; selected: string | null }
export type ViewAction =
  | { type: 'view'; view: 'team' | 'room' } | { type: 'grouping'; grouping: Grouping } | { type: 'attention'; on: boolean }
  | { type: 'select'; id: string | null } | { type: 'visible'; ids: string[] };
export const DEFAULT_VIEW: ViewState = { view: 'room', grouping: 'all', attentionOnly: false, selected: null };

/** The view's own state; the fleet tells it what is visible and it keeps the selection on screen (spec §9.1). */
export function reduce(state: ViewState, a: ViewAction): ViewState {
  switch (a.type) {
    case 'view': return state.view === a.view ? state : { ...state, view: a.view };
    case 'grouping': return state.grouping === a.grouping ? state : { ...state, grouping: a.grouping };
    case 'attention': return state.attentionOnly === a.on ? state : { ...state, attentionOnly: a.on };
    case 'select': return state.selected === a.id ? state : { ...state, selected: a.id };
    case 'visible': {
      if (state.selected === 'ledge' || (state.selected === null && a.ids.length === 0) || (state.selected !== null && a.ids.includes(state.selected))) return state;
      const next = a.ids[0] ?? null;
      return state.selected === next ? state : { ...state, selected: next };
    }
  }
}
```

(Note : avec `selected === null` et des ids visibles, `visible` sélectionne la première : c'est la maquette, qui ouvre toujours une session.)

`src/state/persist.ts` :

```ts
import { DEFAULT_VIEW, type ViewState } from './view';

const VIEW_KEY = 'desktop.view', SELECTED_KEY = 'desktop.selected';
const VIEWS = ['team', 'room'] as const, GROUPINGS = ['all', 'machine', 'jira'] as const;
const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list as readonly unknown[]).includes(v) ? (v as T) : d;

/** Each field checked on its own, like `loadSounds` in the island (spec §7). */
export function loadViewState(): ViewState {
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'); } catch { raw = null; }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let selected: string | null = null;
  try { selected = localStorage.getItem(SELECTED_KEY) || null; } catch { selected = null; }
  return { view: oneOf(VIEWS, o.view, DEFAULT_VIEW.view), grouping: oneOf(GROUPINGS, o.grouping, DEFAULT_VIEW.grouping), attentionOnly: typeof o.attentionOnly === 'boolean' ? o.attentionOnly : DEFAULT_VIEW.attentionOnly, selected };
}
export function saveViewState(s: ViewState): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ view: s.view, grouping: s.grouping, attentionOnly: s.attentionOnly }));
    if (s.selected) localStorage.setItem(SELECTED_KEY, s.selected); else localStorage.removeItem(SELECTED_KEY);
  } catch { /* storage unavailable: the view still works for this run */ }
}
```

`src/state/useViewState.ts` :

```ts
import { useEffect, useReducer } from 'react';
import { reduce, type ViewAction, type ViewState } from './view';
import { loadViewState, saveViewState } from './persist';
export function useViewState(): [ViewState, (a: ViewAction) => void] {
  const [state, dispatch] = useReducer(reduce, undefined, loadViewState);
  useEffect(() => saveViewState(state), [state]);
  return [state, dispatch];
}
```

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test`

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): view state reducer and validated persistence"`

---

### Task 4: Fleet réel (`fleet/useFleet.ts`) et bridge Tauri

**Files:**
- Create: `src/fleet/useFleet.ts`, `src/fleet/attention.ts`, `src/tauri/bridge.ts`, `test/attention.test.ts`, `test/use-fleet.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function createDesktopFleet(opts?: { url?: string; WebSocketImpl?: unknown }): DaemonClient;   // createFleetClient(loadMachines('desktop'), c => createDaemonClient({ url: c.url }), { prefix: 'desktop', keepStale: true, machinesFromDaemon: true }) — un DaemonClient qui porte `fleet` (lot 1)
  export function useFleet(client?: DaemonClient): { sessions: Session[]; machines: MachineState[]; status: DaemonStatus; fleet: Fleet; client: DaemonClient };   // sans argument : un singleton module-level, connecté au premier usage
  export const needsAttention = (s: Session): boolean => !s.offline && (s.state === 'waiting_permission' || s.state === 'waiting_input');
  export const visibleSessions = (sessions: Session[], attentionOnly: boolean): Session[];
  // bridge.ts : isTauri(), focusTerminal(title), openTerminal(title, command), openUrl(url), getAutostart(), setAutostart(on), onTrayAction(fn: (a: 'open'|'new'|'dnd') => void): () => void
  ```
  `MachineState`, `Fleet`, `DaemonClient`, `DaemonStatus` de `@ledge/fleet`.
- Consumes: `@ledge/fleet` (`createFleetClient`, `createDaemonClient`, `loadMachines`, `useDaemon`, `useMachines`, `attachClient`).

- [ ] **Step 1: Tests**

`test/attention.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { needsAttention, visibleSessions } from '../src/fleet/attention';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
describe('attention', () => {
  it('waiting states need it, offline ones never', () => {
    expect(needsAttention(fakeSession('a', { state: 'waiting_permission' }))).toBe(true);
    expect(needsAttention(fakeSession('b', { state: 'waiting_input' }))).toBe(true);
    expect(needsAttention(fakeSession('c', { state: 'working' }))).toBe(false);
    expect(needsAttention(fakeSession('d', { state: 'waiting_input', offline: true }))).toBe(false);
  });
  it('the filter keeps order', () => {
    const list = [fakeSession('a', { state: 'working' }), fakeSession('b', { state: 'waiting_input' }), fakeSession('c', { state: 'waiting_permission' })];
    expect(visibleSessions(list, true).map(s => s.id)).toEqual(['b', 'c']);
    expect(visibleSessions(list, false)).toBe(list);
  });
});
```

`test/use-fleet.test.tsx` (`// @vitest-environment jsdom`, avec le mock daemon de `@ledge/fleet/test/mockDaemon` et `WebSocketImpl: ws`, comme `apps/overlay/test/fleet-app.test.tsx` du lot 2) :

```tsx
it('publishes the daemon sessions under desktop keys, local first', async () => {
  const d = await createMockDaemon(); d.upsert(fakeSession('otto'));
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket as never });
  client.connect();
  const { result } = renderHook(() => useFleet(client));
  await waitFor(() => expect(result.current.sessions.map(s => s.id)).toEqual(['local:otto']));
  expect(result.current.machines[0]).toMatchObject({ id: 'local', status: 'open' });
  expect(localStorage.getItem('ledge.machines')).toBeNull();
  client.close(); await d.close();
});
```

(L'URL et l'implémentation WebSocket sont surchargeables pour les tests ; `useFleet(client = defaultClient())` prend l'instance en paramètre pour les tests et crée le singleton sinon.)

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test attention use-fleet`

- [ ] **Step 3: Implémenter**

`src/fleet/attention.ts` :

```ts
import type { Session } from '@ledge/protocol';
/** What the "needs you" filter keeps: a live session waiting on a person (spec §9.1). */
export const needsAttention = (s: Session): boolean => !s.offline && (s.state === 'waiting_permission' || s.state === 'waiting_input');
export const visibleSessions = (sessions: Session[], attentionOnly: boolean): Session[] => attentionOnly ? sessions.filter(needsAttention) : sessions;
```

`src/fleet/useFleet.ts` :

```ts
import { createDaemonClient, createFleetClient, loadMachines, LOCAL_MACHINE, useDaemon, useMachines, attachClient, type DaemonClient, type DaemonStatus, type Fleet, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';

/** Desktop keeps a fallen machine's last sessions on screen (keepStale) and trusts the daemon's machine list (spec §6, §5.3). */
export function createDesktopFleet(opts: { url?: string; WebSocketImpl?: unknown } = {}): DaemonClient {
  const machines = loadMachines('desktop').map((m, i) => i === 0 && opts.url ? { ...m, url: opts.url } : m);
  const client = createFleetClient(machines, c => createDaemonClient({ url: c.url, ...(opts.WebSocketImpl ? { WebSocketImpl: opts.WebSocketImpl as never } : {}) }), { prefix: 'desktop', keepStale: true, machinesFromDaemon: true });
  attachClient(client);   // `useDaemon` reads the module-level daemonStore, fed by the attached client (as the island's App does)
  return client;
}
let singleton: DaemonClient | null = null;
const defaultClient = (): DaemonClient => { if (!singleton) { singleton = createDesktopFleet(); singleton.connect(); } return singleton; };

export function useFleet(client: DaemonClient = defaultClient()): { sessions: Session[]; machines: MachineState[]; status: DaemonStatus; fleet: Fleet; client: DaemonClient } {
  const daemon = useDaemon();            // sessions, status, as the island does
  const machines = useMachines(client);
  return { sessions: daemon.sessions, machines, status: daemon.status, fleet: client.fleet!, client };
}
```

(`attachClient(client)` branche `daemonStore` sur le client, `useDaemon()` lit ce store, `useMachines(client)` lit `client.fleet` : signatures de `apps/overlay/src/daemon/store.ts:82-87` et `machines.ts:99`, reprises dans `@ledge/fleet` au lot 1.)

`src/tauri/bridge.ts` : copie de `apps/overlay/src/tauri/bridge.ts` réduite à `isTauri`, `focusTerminal`, `openTerminal`, `openUrl`, `getAutostart`, `setAutostart`, `onTrayAction` (événement `ledge://tray`, `TrayAction = 'open' | 'new' | 'dnd'`) ; sans `set_frame`, `set_hot_zone`, `list_monitors`, `focus_overlay`, `release_focus`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm --filter desktop typecheck`

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): real fleet with keepStale and the Tauri bridge"`

---

### Task 5: Vue Équipe (`team/`) et en-tête

**Files:**
- Create: `src/shell/Heading.tsx`, `src/team/TeamView.tsx`, `src/team/SessionCard.tsx`, `test/team-view.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `Heading({ state, dispatch, attentionCount })` (h2/p, bascule `data-view` avec `aria-pressed`, bouton filtre `#attention` `aria-pressed`, bouton « Nouvelle session » `.primary` inerte dans ce lot) ; `TeamView({ sessions, selected, onSelect })` : `.toolbar` « Tous les participants · n » ou « À votre attention », `.section-label` par `groupSessions` (**copiée** depuis `apps/overlay/src/surface/groups.ts` dans `src/team/groups.ts` de Desktop avec son test : la spec §4.1/4.2 ne l'extrait pas et l'île ne l'exporte pas) ; `SessionCard({ session, selected, onSelect })` = `button.session-card[data-session][aria-pressed][aria-label]` avec `Bot` de `@ledge/ui` (`state={botState(session)}`, `pose={poseFor(session.id, botState(session))}`, `size={48}`, `theme`, `seed={session.id}`, `frozen={!!session.offline}`), nom, projet, état (`t.states[session.state]`), machine.
- Consumes: tâches 3 et 4 ; `Bot`, `botState`, `poseFor` de `@ledge/ui`.

- [ ] **Step 1: Test**

`test/team-view.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamView } from '../src/team/TeamView';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

const list = [
  fakeSession('local:otto', { name: 'Otto', project: 'ledge', state: 'waiting_permission', machineId: 'local', machineName: 'Local' }),
  fakeSession('devbox:nova', { name: 'Nova', project: 'ledge', state: 'working', machineId: 'devbox', machineName: 'Devbox', offline: true }),
  fakeSession('local:luna', { name: 'Luna', project: 'website', state: 'waiting_input', machineId: 'local', machineName: 'Local' })
];

describe('TeamView', () => {
  it('lists cards by project, marks the selection and the frozen one', async () => {
    const onSelect = vi.fn();
    render(<TeamView sessions={list} selected="local:otto" onSelect={onSelect} attentionOnly={false} />);
    expect(screen.getByText('All participants · 3')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['ledge', 'website']);
    expect(screen.getByRole('button', { name: /Otto/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Nova/ })).toHaveAttribute('data-offline', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Luna/ }));
    expect(onSelect).toHaveBeenCalledWith('local:luna');
  });
  it('with the filter on, the toolbar says so and only waiting sessions show', () => {
    render(<TeamView sessions={list.filter(s => s.state.startsWith('waiting'))} selected={null} onSelect={() => {}} attentionOnly />);
    expect(screen.getByText('Needs your attention')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /·/ })).toHaveLength(2);
  });
  it('an empty list shows the empty workspace', () => {
    render(<TeamView sessions={[]} selected={null} onSelect={() => {}} attentionOnly={false} />);
    expect(screen.getByText('Your team starts here')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test team-view`

- [ ] **Step 3: Implémenter**

`src/team/SessionCard.tsx` :

```tsx
import type { Session } from '@ledge/protocol';
import { Bot, botState, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';

export function SessionCard({ session, selected, onSelect, theme }: { session: Session; selected: boolean; onSelect: (id: string) => void; theme: 'dark' | 'light' }) {
  const { t } = useI18n(); const state = botState(session);
  return (
    <button type="button" className="session-card" data-session={session.id} data-offline={session.offline ? 'true' : undefined} aria-pressed={selected} aria-label={`${session.name} · ${t.states[session.state]}`} onClick={() => onSelect(session.id)}>
      <Bot tool={session.tool} state={state} pose={poseFor(session.id, state)} size={48} theme={theme} seed={session.id} frozen={!!session.offline} />
      <span className="session-name">{session.name}</span>
      <span className="session-meta">{session.project}{session.machineName ? ` · ${session.machineName}` : ''}</span>
      <span className="session-state" data-state={session.state}>{t.states[session.state]}</span>
    </button>
  );
}
```

(`poseFor(seed, state)` : vérifier sa signature dans `@ledge/ui/bots/poseFor` et utiliser celle-là.)

`src/team/groups.ts` : copie de `groupSessions` et `SessionGroup` de `apps/overlay/src/surface/groups.ts` (sans `displayOrder`, `headersBefore`, `tildePath`), test `test/team-groups.test.ts` copié de l'overlay (`groups.test.ts`, les `it` portant sur `groupSessions`).

`src/team/TeamView.tsx` :

```tsx
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { groupSessions } from './groups';
import { SessionCard } from './SessionCard';
import { useTheme } from '../shell/theme';

export function TeamView({ sessions, selected, onSelect, attentionOnly }: { sessions: Session[]; selected: string | null; onSelect: (id: string) => void; attentionOnly: boolean }) {
  const { t } = useI18n(); const theme = useTheme();
  if (sessions.length === 0 && !attentionOnly) return <section className="empty"><h2>{t.empty.title}</h2><p>{t.empty.text}</p></section>;
  return (
    <section className="central">
      <div className="toolbar">{attentionOnly ? t.team.attention : t.team.all(sessions.length)}</div>
      {groupSessions(sessions).map(g => (
        <div key={g.key}>
          <h3 className="section-label">{g.label}</h3>
          <div className="session-grid">{g.sessions.map(s => <SessionCard key={s.id} session={s} selected={s.id === selected} onSelect={onSelect} theme={theme} />)}</div>
        </div>
      ))}
    </section>
  );
}
```

`src/shell/theme.ts` : `export function useTheme(): 'dark' | 'light'` lit `desktop.theme` (`'dark' | 'light'`, défaut `'dark'`) et pose `document.documentElement.dataset.theme` ; validé champ par champ comme `persist.ts`.

`src/shell/Heading.tsx` : h2 `t.app.title`, p, `.view-toggle` (deux boutons `data-view`, `aria-pressed`), `#attention` (`aria-pressed={state.attentionOnly}`, libellé `t.attention.filter` avec le compte), `.primary` `t.newSession` (`disabled` dans ce lot).

`App.tsx` : `useViewState()`, `useFleet()`, `visibleSessions`, `useEffect(() => dispatch({ type: 'visible', ids: visible.map(s => s.id) }), [visible])`, rend `Heading` + `TeamView` quand `state.view === 'team'` (la vue Réunion à la tâche 6).

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm --filter desktop typecheck`

- [ ] **Step 5: Commit** : `git add apps/desktop && git commit -m "feat(desktop): heading and team view on the real fleet"`

---

### Task 6: Vue Réunion (`room/`), bannière machine déconnectée, barre d'état

**Files:**
- Create: `src/room/geometry.ts`, `src/room/Table.tsx`, `src/room/RoomView.tsx`, `src/shell/OfflineNotice.tsx`, `src/shell/StatusBar.tsx`, `test/geometry.test.ts`, `test/room-view.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface TableSize { stageW: number; stageH: number; tableW: number; tableH: number }
  export function tableSize(count: number): TableSize;        // table de la maquette 1..6, au-delà 620+(n-6)*40 / 380+(n-6)*24 / 400+(n-6)*30 / 140+(n-6)*16 (app.js:62)
  export function seatPositions(count: number): { x: number; y: number }[];   // pourcentages de la maquette (positions[1..8], app.js:51-58) ; au-delà de 8, répartis sur une ellipse (app.js:67)
  ```
  `RoomView({ sessions, grouping, selected, onSelect, onGrouping })` : `.room-toolbar` avec `<select id="table-grouping">` et `.table-groups` de `Table` ; `Table({ table, selected, onSelect })` = `section.table-group[data-table][data-participants]` avec variables CSS `--stage-width/--stage-height/--table-width/--table-height`, caption (`MACHINE` / `CLÉ JIRA DÉTECTÉE` / `À RATTACHER` / `MON ESPACE`), `.meeting-table` (eyebrow, label, `t.room.pending(n)` ou `t.room.allGood`), `button.seat[data-session][aria-pressed][data-offline]` positionnés `left: clamp(44px, X%, calc(100% - 44px)); top: Y%` avec `Bot` ; `OfflineNotice({ machines, onRetry })` liste les machines `unreachable` hors `local` ; `StatusBar({ sessions, machines })`.
- Consumes: tâches 2–5.

- [ ] **Step 1: Tests**

`test/geometry.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { seatPositions, tableSize } from '../src/room/geometry';
describe('table geometry', () => {
  it('follows the mockup table for one to six seats', () => {
    expect(tableSize(1)).toEqual({ stageW: 260, stageH: 240, tableW: 160, tableH: 86 });
    expect(tableSize(6)).toEqual({ stageW: 620, stageH: 380, tableW: 400, tableH: 140 });
  });
  it('grows past six as the mockup does', () => { expect(tableSize(8)).toEqual({ stageW: 700, stageH: 428, tableW: 460, tableH: 172 }); });
  it('uses the mockup seats for eight', () => { expect(seatPositions(8)[3]).toEqual({ x: 91, y: 50 }); expect(seatPositions(1)).toEqual([{ x: 50, y: 22 }]); });
  it('gives one seat per participant, inside the stage', () => {
    for (const n of [1, 2, 5, 8, 12]) { const p = seatPositions(n); expect(p).toHaveLength(n); for (const { x, y } of p) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100); } }
  });
});
```

`test/room-view.test.tsx` (Review Focus 4) :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomView } from '../src/room/RoomView';
import { OfflineNotice } from '../src/shell/OfflineNotice';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

const eight = ['otto', 'nova', 'pim', 'bix', 'luna', 'milo', 'echo', 'rio'].map((n, i) => fakeSession(`${i % 3 === 1 ? 'devbox' : 'local'}:${n}`, { name: n, machineId: i % 3 === 1 ? 'devbox' : 'local', machineName: i % 3 === 1 ? 'Devbox' : 'Local', state: i === 0 ? 'waiting_permission' : 'working', offline: i % 3 === 1 }));

describe('RoomView', () => {
  it('one table for everyone, with the pending count and frozen seats', () => {
    render(<RoomView sessions={eight} grouping="all" selected="local:otto" onSelect={() => {}} onGrouping={() => {}} />);
    const table = screen.getByRole('region', { name: /Whole team/ });
    expect(table).toHaveAttribute('data-participants', '8');
    expect(screen.getByText('1 request pending')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /nova|luna|rio/ }).every(b => b.dataset.offline === 'true')).toBe(true);
    expect(screen.getByRole('button', { name: /otto/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('by machine makes two tables and a frozen seat still selects', async () => {
    const onSelect = vi.fn();
    render(<RoomView sessions={eight} grouping="machine" selected={null} onSelect={onSelect} onGrouping={() => {}} />);
    expect(screen.getAllByRole('region').map(r => r.getAttribute('data-table'))).toEqual(['local', 'devbox']);
    await userEvent.click(screen.getByRole('button', { name: /nova/ }));
    expect(onSelect).toHaveBeenCalledWith('devbox:nova');
  });
  it('changing the select reports the grouping', async () => {
    const onGrouping = vi.fn();
    render(<RoomView sessions={eight} grouping="all" selected={null} onSelect={() => {}} onGrouping={onGrouping} />);
    await userEvent.selectOptions(screen.getByLabelText('Group tables'), 'jira');
    expect(onGrouping).toHaveBeenCalledWith('jira');
  });
  it('the offline notice names the unreachable machine and offers a retry', async () => {
    const onRetry = vi.fn();
    render(<OfflineNotice machines={[{ id: 'local', label: 'Local', status: 'open' }, { id: 'devbox', label: 'Devbox', status: 'unreachable' }] as never} onRetry={onRetry} />);
    expect(screen.getByText('Devbox is disconnected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('devbox');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test geometry room-view`

- [ ] **Step 3: Implémenter**

`src/room/geometry.ts` :

```ts
export interface TableSize { stageW: number; stageH: number; tableW: number; tableH: number }
/** The mockup's sizes per seat count (app.js:61-62); past six the furniture keeps growing per seat. */
const SIZES: Record<number, [number, number, number, number]> = { 1: [260, 240, 160, 86], 2: [380, 300, 230, 90], 3: [440, 320, 280, 100], 4: [500, 340, 330, 116], 5: [560, 360, 360, 126], 6: [620, 380, 400, 140] };
export function tableSize(count: number): TableSize {
  const fixed = SIZES[Math.max(1, count)];
  if (fixed) { const [stageW, stageH, tableW, tableH] = fixed; return { stageW, stageH, tableW, tableH }; }
  const n = count - 6;
  return { stageW: 620 + n * 40, stageH: 380 + n * 24, tableW: 400 + n * 30, tableH: 140 + n * 16 };
}
/** Seat positions in percent of the stage, the mockup's for 1..8 (app.js:51-58); beyond, evenly around an ellipse (app.js:67). */
const POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 22]], 2: [[30, 16], [70, 84]], 3: [[27, 16], [73, 16], [50, 84]],
  4: [[27, 16], [73, 16], [73, 84], [27, 84]],
  5: [[27, 16], [73, 16], [91, 50], [73, 84], [27, 84]],
  6: [[27, 16], [73, 16], [91, 50], [73, 84], [27, 84], [9, 50]],
  7: [[20, 16], [50, 16], [80, 16], [91, 50], [73, 84], [27, 84], [9, 50]],
  8: [[20, 16], [50, 16], [80, 16], [91, 50], [80, 84], [50, 84], [20, 84], [9, 50]]
};
export function seatPositions(count: number): { x: number; y: number }[] {
  const fixed = POSITIONS[count];
  if (fixed) return fixed.map(([x, y]) => ({ x, y }));
  return Array.from({ length: count }, (_, i) => ({ x: 50 + 42 * Math.cos((2 * Math.PI * i) / count), y: 50 + 36 * Math.sin((2 * Math.PI * i) / count) }));
}
```

`src/room/Table.tsx` : `section.table-group` avec `role="region"`, `aria-label={table.label}`, `data-table={table.id}`, `data-participants={table.sessions.length}`, `style={{ '--stage-width': \`${size.stageW}px\`, … } as CSSProperties}` ; caption selon `table.kind` (`machine` → `t.room.captions.machine`, `story` → `t.room.captions.detected`, `unassigned`/`ambiguous` → `t.room.captions.unassigned`, `all` → `t.room.captions.mine`) ; `.meeting-table` avec `pending = table.sessions.filter(needsAttention).length` ; sièges `button.seat` à `seatPositions(n)[i]` avec `Bot size={40}` et `aria-label={session.name}` (+ état).

`src/room/RoomView.tsx` : `tables(sessions, grouping, t)` → un `Table` par table ; `<label htmlFor="table-grouping">{t.room.grouping}</label><select id="table-grouping" value={grouping} onChange={e => onGrouping(e.target.value as Grouping)}>` avec trois `<option>`.

`src/shell/OfflineNotice.tsx` : pour chaque `machines.filter(m => m.id !== 'local' && m.status !== 'open')` : `<div role="status" className="offline-notice"><strong>{t.offline.title(m.label)}</strong><span>{t.offline.reconnecting(m.label)}</span><button type="button" data-reconnect onClick={() => onRetry(m.id)}>{t.offline.retry}</button></div>`.

`src/shell/StatusBar.tsx` : `t.status.sessions(sessions.length)` · pour chaque machine `t.status.connected(label)` ou `t.status.unreachable(label)`.

`App.tsx` : `state.view === 'room' ? <RoomView … onGrouping={g => dispatch({ type: 'grouping', grouping: g })} /> : <TeamView … />`, `OfflineNotice` au-dessus du contenu avec `onRetry={id => fleet.retry(id)}`, `StatusBar` en pied.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`

- [ ] **Step 5: Vérification visuelle** : `pnpm --filter desktop dev` avec `node apps/overlay/test/devMock.ts` (réutilisé : spec §4.4) ou le vrai daemon ; comparer à `mockup/index.html` (scénarios normal / empty / offline) dans la même fenêtre 1280×800.

- [ ] **Step 6: Commit** : `git add apps/desktop && git commit -m "feat(desktop): meeting view, offline notice and status bar"`

---

### Task 7: App Tauri (`src-tauri`), tray, updater

**Files:**
- Create: `apps/desktop/src-tauri/Cargo.toml`, `build.rs`, `src/main.rs`, `tauri.conf.json`, `capabilities/default.json`, `windows/hooks.nsh`, `icons/` (copie des icônes de l'île ; `ledge-tray.png` identique ; `icon.ico`/`icon.png` régénérés via `pnpm tauri icon icons/ledge-desktop.svg` à partir de `ledge-app.svg` teinté différemment, spec §11 « icône distincte »)
- Modify: `Cargo.toml` (racine), `apps/desktop/test/tauri-config.test.ts` (créer)

**Interfaces:**
- Produces: commandes `focus_terminal`, `foreground_is_terminal`, `open_terminal`, `open_url`, `get_autostart`, `set_autostart`, `set_tray_labels` ; événement `ledge://tray` ; fenêtre `main` ; fermeture = cacher ; `pub fn tray_title(version: &str, debug: bool) -> String` (« Ledge Desktop 0.5.2 » / « … (dev) »).
- Consumes: `ledge_native` (lot 1).

- [ ] **Step 1: Test de configuration** (`apps/desktop/test/tauri-config.test.ts`, calqué sur celui de l'île)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(__dirname, '..');
const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const caps = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8'));
const island = JSON.parse(readFileSync(resolve(root, '../overlay/src-tauri/tauri.conf.json'), 'utf8'));
const main = readFileSync(resolve(root, 'src-tauri/src/main.rs'), 'utf8');

describe('Desktop Tauri config', () => {
  it('is its own app, versioned with the island', () => {
    expect(conf.identifier).toBe('be.paradow.ledge.desktop'); expect(conf.productName).toBe('Ledge Desktop');
    expect(conf.version).toBe(island.version);
    expect(conf.build.devUrl).toBe('http://localhost:1421');
  });
  it('has one decorated, resizable main window remembering its state', () => {
    const w = conf.app.windows[0];
    expect(w).toMatchObject({ label: 'main', decorations: true, resizable: true, width: 1280, height: 800, minWidth: 640, minHeight: 480 });
    expect(w.transparent).not.toBe(true); expect(w.alwaysOnTop).not.toBe(true);
    expect(caps.permissions).toContain('window-state:default');
    expect(main).toContain('tauri_plugin_window_state::Builder');
  });
  it('shares the island CSP and the updater key, with its own manifest', () => {
    expect(conf.app.security.csp).toBe(island.app.security.csp);
    expect(conf.plugins.updater.pubkey).toBe(island.plugins.updater.pubkey);
    expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/Lyssaen/ledge/releases/latest/download/latest-desktop.json']);
    expect(conf.plugins.updater.windows.installMode).toBe('passive');
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(caps.permissions).toContain('updater:default'); expect(caps.permissions).toContain('process:allow-restart');
    expect(main).toContain('tauri_plugin_updater::Builder::new().build()'); expect(main).toContain('tauri_plugin_process::init()');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter desktop test tauri-config`

- [ ] **Step 3: Créer l'app Tauri**

`src-tauri/Cargo.toml` :

```toml
[package]
name = "ledge-desktop"
version = "0.5.2"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2.6", features = ["tray-icon"] }
tauri-plugin-autostart = "2"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
tauri-plugin-window-state = "2"
ledge-native = { path = "../../../crates/ledge-native" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

`build.rs` : `fn main() { tauri_build::build() }`. Racine `Cargo.toml` : `members = ["apps/overlay/src-tauri", "apps/desktop/src-tauri", "crates/ledge-native"]`.

`src/main.rs` :

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const TRAY_OPEN: &str = "open"; const TRAY_NEW: &str = "new"; const TRAY_DND: &str = "dnd"; const TRAY_QUIT: &str = "quit";
#[derive(Clone, Serialize)] struct TrayPayload { action: String }

/// What the tray tooltip says; a dev build says so.
pub fn tray_title(version: &str, debug: bool) -> String { if debug { format!("Ledge Desktop {version} (dev)") } else { format!("Ledge Desktop {version}") } }

#[tauri::command] fn focus_terminal(title: String) -> Result<bool, String> { Ok(ledge_native::terminal::focus(&title)) }
#[tauri::command] fn foreground_is_terminal() -> bool { ledge_native::terminal::foreground_is_terminal() }
#[tauri::command] fn open_terminal(title: String, command: Vec<String>) -> Result<bool, String> { ledge_native::terminal::open(&title, &command) }
#[tauri::command] fn open_url(url: String) -> Result<(), String> { ledge_native::browser::open_url(&url) }
#[tauri::command] fn get_autostart(app: AppHandle) -> Option<bool> { if cfg!(debug_assertions) { return None; } app.autolaunch().is_enabled().ok() }
#[tauri::command] fn set_autostart(app: AppHandle, on: bool) -> Result<Option<bool>, String> {
    let l = app.autolaunch(); (if on { l.enable() } else { l.disable() }).map_err(|e| e.to_string())?; Ok(l.is_enabled().ok())
}

struct Tray { open: MenuItem<Wry>, new_session: MenuItem<Wry>, dnd: MenuItem<Wry>, quit: MenuItem<Wry> }
#[tauri::command] fn set_tray_labels(app: AppHandle, open: String, new_session: String, dnd: String, quit: String) -> Result<(), String> {
    let t = app.state::<Tray>();
    for (item, text) in [(&t.open, open), (&t.new_session, new_session), (&t.dnd, dnd), (&t.quit, quit)] { item.set_text(text).map_err(|e| e.to_string())?; }
    Ok(())
}

fn show_main(app: &AppHandle) { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); } }

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, TRAY_OPEN, "Ouvrir Ledge Desktop", true, None::<&str>)?;
    let new_session = MenuItem::with_id(app, TRAY_NEW, "Nouvelle session", true, None::<&str>)?;
    let dnd = MenuItem::with_id(app, TRAY_DND, "Ne pas déranger", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "Quitter Ledge Desktop", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &new_session, &dnd, &PredefinedMenuItem::separator(app)?, &quit])?;
    TrayIconBuilder::with_id("ledge-desktop")
        .icon(tauri::include_image!("icons/ledge-tray.png"))
        .tooltip(tray_title(app.package_info().version.to_string().as_str(), cfg!(debug_assertions)))
        .menu(&menu).show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            TRAY_QUIT => app.exit(0),
            TRAY_OPEN => show_main(app),
            id => { let _ = app.emit("ledge://tray", TrayPayload { action: id.to_string() }); }
        })
        .on_tray_icon_event(|tray, e| { if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = e { show_main(tray.app_handle()); } })
        .build(app)?;
    app.manage(Tray { open, new_session, dnd, quit });
    Ok(())
}

/// Switched on once by an installed build, as the island does; the marker remembers the user's later choice.
fn default_autostart(app: &tauri::App) {
    let Ok(dir) = app.path().app_config_dir() else { return; };
    let marker = dir.join(ledge_native::autostart::MARKER);
    if !ledge_native::autostart::by_default(cfg!(debug_assertions), marker.exists()) { return; }
    let _ = std::fs::create_dir_all(&dir); let _ = std::fs::write(&marker, b""); let _ = app.autolaunch().enable();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![focus_terminal, foreground_is_terminal, open_terminal, open_url, get_autostart, set_autostart, set_tray_labels])
        .setup(|app| { build_tray(app)?; default_autostart(app); Ok(()) })
        .on_window_event(|w, e| { if let tauri::WindowEvent::CloseRequested { api, .. } = e { api.prevent_close(); let _ = w.hide(); } })  // close hides to the tray (spec §4.4)
        .run(tauri::generate_context!())
        .expect("error while running Ledge Desktop");
}

#[cfg(test)]
mod tests {
    use super::tray_title;
    #[test] fn the_tray_tells_a_dev_build_from_an_installed_one() { assert_eq!(tray_title("0.5.2", false), "Ledge Desktop 0.5.2"); assert_eq!(tray_title("0.5.2", true), "Ledge Desktop 0.5.2 (dev)"); }
}
```

`tauri.conf.json` :

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Ledge Desktop",
  "version": "0.5.2",
  "identifier": "be.paradow.ledge.desktop",
  "build": { "beforeDevCommand": "pnpm dev", "devUrl": "http://localhost:1421", "beforeBuildCommand": "pnpm build", "frontendDist": "../dist" },
  "app": {
    "windows": [{ "label": "main", "title": "Ledge Desktop", "width": 1280, "height": 800, "minWidth": 640, "minHeight": 480, "decorations": true, "resizable": true, "visible": true }],
    "security": { "csp": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src ipc: http://ipc.localhost ws://127.0.0.1:47831", "devCsp": null }
  },
  "bundle": {
    "active": true, "createUpdaterArtifacts": true, "targets": ["nsis"],
    "windows": { "nsis": { "installMode": "currentUser", "installerHooks": "windows/hooks.nsh" } },
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  },
  "plugins": {
    "updater": { "pubkey": "<copier la valeur exacte de apps/overlay/src-tauri/tauri.conf.json>", "endpoints": ["https://github.com/Lyssaen/ledge/releases/latest/download/latest-desktop.json"], "windows": { "installMode": "passive" } }
  }
}
```

`capabilities/default.json` : `{ "identifier": "default", "windows": ["main"], "permissions": ["core:default", "core:window:allow-show", "core:window:allow-hide", "core:window:allow-set-focus", "core:event:allow-listen", "core:event:allow-unlisten", "window-state:default", "updater:default", "process:allow-restart"] }`.

`windows/hooks.nsh` : copie de celui de l'île (il utilise `${PRODUCTNAME}` et `${BUNDLEID}`, donc nettoie les bonnes clés).

- [ ] **Step 4: Run** : `pnpm --filter desktop test tauri-config` → PASS. Puis **en CI** après la tâche 9 (le workflow build Desktop seulement après la tâche 9), ou sur Windows : `cd apps/desktop && pnpm tauri build` → `src-tauri/target/release/bundle/nsis/Ledge Desktop_0.5.2_x64-setup.exe` ; `cargo test --workspace` à la racine.

- [ ] **Step 5: Commit** : `git add Cargo.toml apps/desktop && git commit -m "feat(desktop): Tauri app with tray, window state and updater"`

---

### Task 8: Playwright : faux daemon en page et scénarios

**Files:**
- Create: `apps/desktop/playwright.config.ts`, `e2e/daemon.ts`, `e2e/fixtures.ts`, `e2e/team.spec.ts`, `e2e/room.spec.ts`, `e2e/offline.spec.ts`

**Interfaces:**
- Produces: `fakeDaemon(page, initial: Session[], extras?: { machines?: Machines })` (`page.routeWebSocket(/127\.0\.0\.1:47831/)`) qui répond `snapshot` puis `machines` à la connexion et expose `push(msg)`, `close()` ; pour une seconde machine, `fakeRemote(page, alias, sessions)` route `/ssh/<alias>` ; `test` étendu par `fixtures.ts` qui échoue sur toute erreur console.
- Consumes: `apps/overlay/e2e/daemon.ts` comme modèle (`T0`, `session(id, extra)`).

- [ ] **Step 1: Configuration et fixtures**

`playwright.config.ts` : copie de celui de l'île avec `port 5299`, `baseURL: 'http://127.0.0.1:5299'`, `webServer.command: 'pnpm exec vite --port 5299 --strictPort --host 127.0.0.1'`, `outputDir: './e2e/.results'`, viewport 1280×800.

`e2e/fixtures.ts` :

```ts
import { test as base, expect } from '@playwright/test';
/** Any console error fails the test (spec §12). */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await use(page);
    expect(errors, 'console errors').toEqual([]);
  }
});
export { expect };
```

`e2e/daemon.ts` : copie de `apps/overlay/e2e/daemon.ts` (`T0`, `session`) avec, dans `fakeDaemon`, après l'envoi du `snapshot` : `ws.send(JSON.stringify({ type: 'machines', machines: extras?.machines ?? [{ id: 'local', label: 'Local' }] }))` ; et `fakeRemote(page, alias, sessions)` qui route la même URL avec le chemin `/ssh/${alias}` et sert un `snapshot` de `sessions` ; retourne `{ close(): void }` qui ferme le socket côté serveur pour simuler la panne, et `reopen()`.

- [ ] **Step 2: Scénarios**

`e2e/team.spec.ts` :

```ts
import { test, expect } from './fixtures';
import { fakeDaemon, session } from './daemon';

const eight = [
  session('otto', { name: 'Otto', project: 'ledge', state: 'waiting_permission', branch: 'release/LEDGE-42-v0.5.0' }),
  session('nova', { name: 'Nova', project: 'ledge', state: 'working', branch: 'fix/LEDGE-42-ssh-reconnect' }),
  session('pim', { name: 'Pim', project: 'ledge', state: 'working', branch: 'feat/bot-motion' }),
  session('bix', { name: 'Bix', project: 'ledge', state: 'idle', topic: 'LEDGE-42 · Documenter le protocole', branch: 'docs/protocol' }),
  session('luna', { name: 'Luna', project: 'website', state: 'waiting_input', branch: 'feat/WEB-18-homepage' }),
  session('milo', { name: 'Milo', project: 'website', state: 'working', branch: 'fix/WEB-18-mobile-layout' }),
  session('echo', { name: 'Echo', project: 'ledge', state: 'working', branch: 'test/LEDGE-42-notifications' }),
  session('rio', { name: 'Rio', project: 'website', state: 'working', branch: 'feat/WEB-18-accessibility' })
];

test('eight agents: team grid, filter and selection survive a reload', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  await page.getByRole('button', { name: 'Équipe' }).click();
  await expect(page.locator('.session-card')).toHaveCount(8);
  await expect(page.locator('.section-label')).toHaveText(['ledge', 'website']);
  await page.locator('#attention').click();
  await expect(page.locator('.session-card')).toHaveCount(2);
  await page.locator('.session-card', { hasText: 'Luna' }).click();
  await page.reload();
  await expect(page.locator('#attention')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.session-card[aria-pressed="true"]')).toHaveText(/Luna/);
});

test('no session: the empty workspace', async ({ page }) => {
  await fakeDaemon(page, []);
  await page.goto('/');
  await expect(page.getByText('Votre équipe commence ici')).toBeVisible();
});
```

`e2e/room.spec.ts` : avec les mêmes huit, `goto('/')` (vue Réunion par défaut), `expect(page.locator('.table-group')).toHaveCount(1)` et `data-participants="8"` ; `selectOption('#table-grouping', 'jira')` → trois tables `['LEDGE-42', 'unassigned', 'WEB-18']` (par `data-table`) ; `machine` → une table `local` (tous locaux dans ce fake) ; cliquer un siège → `aria-pressed="true"` ; `reload` → regroupement `jira` conservé.

`e2e/offline.spec.ts` (Review Focus 4) :

```ts
test('a remote machine falls then comes back', async ({ page }) => {
  await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })], { machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'waiting_input' })]);
  await page.goto('/');
  await expect(page.locator('.seat')).toHaveCount(2);
  remote.close();
  await expect(page.getByText('Devbox est déconnectée')).toBeVisible();
  await expect(page.locator('.seat[data-offline="true"]')).toHaveCount(1);
  await page.locator('.seat[data-offline="true"]').click();           // selecting a frozen seat is fine
  await expect(page.locator('.seat[aria-pressed="true"]')).toHaveCount(1);
  remote.reopen([session('nova', { name: 'Nova', state: 'working' }), session('milo', { name: 'Milo', state: 'working' })]);
  await expect(page.getByText('Devbox est déconnectée')).toBeHidden();
  await expect(page.locator('.seat')).toHaveCount(3);
  await expect(page.locator('.seat[data-offline="true"]')).toHaveCount(0);
});
```

- [ ] **Step 3: Run** : `pnpm --filter desktop exec playwright install chromium` (une fois) puis `pnpm --filter desktop test:e2e`
Expected: 5 tests verts, aucune erreur console. Si `fakeRemote` ne peut pas rouvrir la route WebSocket, utiliser une seconde `routeWebSocket` posée avant `goto` dont le handler lit un drapeau `up` (fermer = `ws.close()` serveur ; `reopen` = `up = true` ; le fleet retente avec son backoff — `maxBackoffMs` court via `VITE_LEDGE_E2E=1` lu dans `createDesktopFleet`).

- [ ] **Step 4: Commit** : `git add apps/desktop && git commit -m "feat(desktop): Playwright scenarios on an in-page fake daemon"`

---

### Task 9: Version lockstep, manifestes, release CI

**Files:**
- Move: `apps/overlay/scripts/set-version.mjs` → `scripts/set-version.mjs` ; `apps/overlay/scripts/latest-json.mjs` → `scripts/latest-json.mjs` ; `apps/overlay/test/version.test.ts` → `test/version.test.ts` ; `apps/overlay/test/latest-json.test.ts` → `test/latest-json.test.ts`
- Create: `vitest.config.ts` (racine, `include: ['test/**/*.test.ts']`, environment node)
- Modify: `package.json` (racine : `"version:set": "node scripts/set-version.mjs"`, `"test": "pnpm -r test && vitest run"`), `apps/overlay/package.json` (retirer `version:set`), `.github/workflows/release.yml`, `README.md`

**Interfaces:**
- Produces: `node scripts/set-version.mjs <x.y.z>` met à jour `apps/overlay/{package.json,src-tauri/tauri.conf.json,src-tauri/Cargo.toml}`, `apps/desktop/{package.json,src-tauri/tauri.conf.json,src-tauri/Cargo.toml}`, `crates/ledge-native/Cargo.toml`, `Cargo.lock` (trois entrées), `packages/ledge/package.json` ; sort en erreur avant toute écriture si un fichier n'a pas exactement une occurrence. `node scripts/latest-json.mjs <tag> <exe> <notesFile> [manifestName]` ; `latestJson({ tag, notes, signature, exeName, pubDate })` inchangé.

- [ ] **Step 1: Tests**

`test/version.test.ts` (déplacé, étendu) : lire les neuf fichiers et vérifier que chacun porte la version de `apps/overlay/package.json` ; plus (Review Focus 5) :

```ts
it('refuses to touch anything when one file lacks a single version line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-version-'));
  // copier l'arbre minimal des neuf fichiers dans dir, puis casser apps/desktop/src-tauri/tauri.conf.json (deux champs "version")
  const before = readFileSync(join(dir, 'apps/overlay/package.json'), 'utf8');
  const r = spawnSync('node', [resolve(__dirname, '../scripts/set-version.mjs'), '9.9.9'], { cwd: dir, env: { ...process.env, LEDGE_VERSION_ROOT: dir } });
  expect(r.status).toBe(1);
  expect(readFileSync(join(dir, 'apps/overlay/package.json'), 'utf8')).toBe(before);
});
```

(`set-version.mjs` lit `process.env.LEDGE_VERSION_ROOT ?? resolve(scriptsDir, '..')` pour que le test cible un arbre temporaire.) Le script fait deux passes : d'abord `countOnce(file, re)` sur tous les fichiers, puis les écritures.

`test/latest-json.test.ts` (déplacé) + un `it` : la CLI avec un 4e argument écrit le fichier sous ce nom (`latest-desktop.json`), et `latestJson({ exeName: 'Ledge.Desktop_0.5.2_x64-setup.exe', … })` produit une `url` qui se termine par ce nom. **Décision** : GitHub remplace les espaces des noms d'assets par des points ; pour que le manifeste et l'asset portent le même nom, le workflow renomme l'exe (et son `.sig`) en `Ledge.Desktop_x.y.z_x64-setup.exe` avant l'upload, et c'est ce nom que reçoit `latestJson`.

- [ ] **Step 2: Run, expect FAIL** : `pnpm vitest run test/`

- [ ] **Step 3: Implémenter**

`scripts/set-version.mjs` : liste `TARGETS = [{ file, re }]` couvrant les neuf fichiers (regex de l'ancien script pour l'overlay, et pour Desktop `^(\[package\]\r?\nname = "ledge-desktop"\r?\nversion = )"[^"]*"`, `^(name = "ledge-desktop"\r?\nversion = )"[^"]*"` dans le lock) ; première passe : chaque regex doit matcher exactement une fois (sinon `console.error` + `process.exit(1)`), seconde passe : écritures.

`scripts/latest-json.mjs` : 4e argument `manifest = 'latest.json'` ; écrit `manifest`.

`release.yml`, job `windows-installer` : après le build de l'île, ajouter :

```yaml
      - name: Build Ledge Desktop
        working-directory: apps/desktop
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          pnpm --filter desktop typecheck
          pnpm tauri build
```

et dans l'étape Publish : localiser `apps/desktop/src-tauri/target/release/bundle/nsis/Ledge Desktop_$($version)_x64-setup.exe`, le copier en `Ledge.Desktop_$($version)_x64-setup.exe` (et son `.sig`), `node scripts/latest-json.mjs $env:VERSION_TAG "Ledge.Desktop_${version}_x64-setup.exe" notes.md latest-desktop.json`, uploader les deux exe, les deux `.sig` et les deux manifestes avec `--clobber`. Le bloc d'installation de la release note gagne une seconde ligne pour Desktop (`__DESKTOP_EXE__/__DESKTOP_SHA__`). `cargo test --workspace` déjà en place (lot 1). Chemins `set-version.mjs` : `node scripts/set-version.mjs` depuis la racine dans les deux jobs. Dry run : « Show the updater manifest » affiche aussi `latest-desktop.json`.

`README.md` : section « Ledge Desktop » (3 lignes : `pnpm --filter desktop dev` + daemon, installeur `Ledge.Desktop_x.y.z_x64-setup.exe` sur la même release, mêmes versions).

- [ ] **Step 4: Run, expect PASS** : `pnpm vitest run test/ && pnpm -r typecheck && pnpm -r test && node scripts/set-version.mjs 0.5.2 && git status --short` (aucun diff après le set à la même version)

- [ ] **Step 5: CI** : `git push -u origin desktop/lot3-skeleton && gh workflow run release.yml --ref desktop/lot3-skeleton -f version=0.5.2 && gh run watch`
Expected: `windows-installer` vert avec les deux installeurs et les deux manifestes affichés ; `cargo test --workspace` vert (test `tray_title` de Desktop inclus). Installer `Ledge.Desktop_0.5.2_x64-setup.exe` sur le poste Windows : fenêtre 1280×800, tray avec quatre entrées, fermeture → tray, « Quitter » → arrêt, vues Équipe/Réunion sur le vrai daemon et une machine SSH ; l'île continue de fonctionner à côté.

- [ ] **Step 6: Commit et MR**

```bash
git add scripts test vitest.config.ts package.json apps/overlay/package.json .github/workflows/release.yml README.md
git commit -m "chore(release): lockstep versions and a second installer for Ledge Desktop"
git push
```

MR `desktop/lot3-skeleton → main` : « Lot 3: Ledge Desktop skeleton (team and meeting views, tray, updater) ». Le lot 4 (conversations) part d'ici.
