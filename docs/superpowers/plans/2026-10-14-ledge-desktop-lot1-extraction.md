# Ledge Desktop, lot 1 : extraction `@ledge/ui`, `@ledge/fleet`, `ledge-native` — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir de `apps/overlay` le code que Desktop réutilisera à l'identique (styles, mascottes, préférences, i18n, client de flotte, fonctions Win32) dans `packages/ui`, `packages/fleet` et `crates/ledge-native`, et y ajouter, derrière des options que l'île n'active pas, `keepStale` et la lecture des machines depuis le daemon — sans aucun changement visible dans l'île.

**Architecture:** Trois nouveaux paquets du monorepo. `@ledge/ui` (React, peer dep) porte le code d'apparence et de préférences ; chaque module qui lit `localStorage` reçoit le préfixe de clé en paramètre (`'ledge'` pour l'île). `@ledge/fleet` porte `client`, `machines`, `fleet`, `store`, `changes` et leurs tests ; `createFleetClient` gagne `{ keepStale, machinesFromDaemon }`. `crates/ledge-native` porte les fonctions Win32 pures et leurs stubs ; les `#[tauri::command]` restent dans `main.rs` et délèguent. L'overlay garde des modules « façade » d'une ligne (`src/i18n/lang.tsx`, `src/sounds/preferences.ts`, `src/daemon/*.ts`) qui réexportent depuis les paquets, de sorte que ses 37 fichiers importateurs et ses 68 fichiers de test ne changent pas d'imports ni d'assertions.

**Tech Stack:** TypeScript, zod (`@ledge/protocol`), React 19 (`@ledge/ui`, `@ledge/fleet` en peer), vitest 3 + Testing Library + jsdom, `ws` (tests de flotte), Rust 2021 / Tauri 2.6 / `windows` 0.58 (crate), pnpm workspaces 10.12.1, Cargo workspace.

**Spec:** `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` (§4.1, §4.2, §4.3, §5.3, §6, §7, §12 « Lot d'extraction », §13 lot 1, §14).

## Global Constraints

- **Aucun changement visible dans l'île** : les tests de l'overlay passent **sans modification de leurs assertions** (spec §12). Seuls les chemins d'import des tests déplacés changent ; les tests qui restent dans `apps/overlay/test` gardent leurs imports `../src/...` grâce aux façades.
- Les clés `localStorage` de l'île restent exactement `ledge.lang`, `ledge.accent`, `ledge.handleScale`, `ledge.panelScale`, `ledge.uiScale` (legacy), `ledge.reducedMotion`, `ledge.finished`, `ledge.sounds`, `ledge.machines`, `ledge.fleet.history` : le préfixe par défaut est `'ledge'` partout (spec §7).
- `keepStale` et `machinesFromDaemon` sont **désactivés par défaut** ; l'île ne les passe pas dans ce lot (spec §13 lot 1). Le fallback du fleet sans ces options est le comportement actuel, octet pour octet dans `publish()`.
- Ajout au protocole **optionnel et additif** : `offline: z.boolean().optional()` dans `SessionSchema` (spec §6), rien d'autre dans ce lot. Les messages `machines`/`machines.set` arrivent au lot 2.
- `@ledge/ui` et `@ledge/fleet` déclarent `react` (et `react-dom` pour ui) en `peerDependencies` `^19.0.0`, jamais en `dependencies` (spec §4.1, §4.2) : une seule copie de React dans le bundle de chaque app.
- Les paquets exposent leurs **sources TypeScript** (`"main": "./src/index.ts"`, `exports` par sous-chemin) comme `@ledge/protocol` ; pas d'étape de build pour eux, Vite les compile dans chaque app. `packages/ui` exporte aussi ses CSS (`@ledge/ui/styles/tokens.css`, …).
- **Pas de `cargo` dans ce WSL** (le commentaire de `release.yml` le dit : « no toolchain on the dev machine »). Les tâches Rust se vérifient par `workflow_dispatch` de `.github/workflows/release.yml` (sans `PUBLISH`, qui exécute `cargo test` dans `apps/overlay/src-tauri`) ou sur un poste Windows avec Rust stable. Chaque tâche Rust le précise dans son « Run ».
- `Cargo.lock` déménage à la racine avec le workspace Cargo ; `apps/overlay/scripts/set-version.mjs` et `apps/overlay/test/version.test.ts` suivent (tâche 11). `.gitignore` racine ignore déjà `target/`.
- Style des fichiers voisins : une ligne par idée, commentaires courts expliquant le pourquoi, tests `describe/it` avec fixtures locales (`fakeSession`, `peer()`, `mk`). Le dépôt est sur `main`, propre (`a925117 chore: 0.5.2`) : travailler sur une branche `desktop/lot1-extraction`.
- Commits en anglais, style du dépôt : `refactor(ui): …`, `refactor(fleet): …`, `feat(fleet): …`, `refactor(native): …`, `chore: …`.

## Review Focus

1. Un composant `Bot` ou `ResidentMascot` rendu **hors de tout `LangProvider`** (un test, le Handle avant le premier rendu de `App`) doit lire la langue stockée (`ledge.lang`) comme aujourd'hui, et non un français en dur : l'aria-label anglais attendu par `bot.test.tsx:149` dépend de ce fallback. Test ajouté à la tâche 5.
2. Deux fronts qui partagent un jour le même stockage : `createSoundPrefs('desktop')` et `createSoundPrefs('ledge')` ne doivent **jamais** lire ni écrire la clé de l'autre, et chaque instance garde ses propres abonnés (`useSoundPrefs`). Test ajouté à la tâche 4.
3. `keepStale` activé et le pair **`local`** qui tombe : ses sessions ne sont jamais figées (spec §6 : « rien n'est figé pour le pair local »), le statut global passe à `unreachable`, et les commandes `sendTo` renvoient `false`. Test ajouté à la tâche 8.
4. `keepStale` activé, un pair distant revient avec un snapshot **où une session a disparu** : elle doit être retirée, pas rester en `offline` à côté des nouvelles. Test ajouté à la tâche 8.
5. `machinesFromDaemon` activé, le daemon envoie `machines` alors qu'un `configure()` local est **en attente** de confirmation : la liste reçue remplace la demande, aucun doublon de pair, aucune connexion ouverte pour une machine que le daemon n'a pas confirmée. Test ajouté à la tâche 9.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `packages/ui/package.json` (créer) | `@ledge/ui`, React 19 en peer, exports par sous-chemin et CSS |
| `packages/ui/tsconfig.json`, `packages/ui/vite.config.ts`, `packages/ui/test/setup.ts` (créer) | Outillage identique à l'overlay (jsdom, jest-dom, `VITE_LEDGE_MOTION=0`, prêt de `localStorage`) |
| `packages/ui/src/index.ts` (créer) | Barrel des exports TS |
| `packages/ui/src/styles/tokens.css`, `base.css` (déplacer depuis `apps/overlay/src/styles/`) | Tokens et base ; `base.css` garde ses `@import` relatifs vers `../bots/*.css` |
| `packages/ui/src/accent.ts`, `motion.ts`, `motionPreferences.ts`, `scale.ts` (déplacer) | Préférences d'affichage, clés préfixées |
| `packages/ui/src/sounds/player.ts`, `cues.ts`, `preferences.ts` (déplacer) | Sons ; `preferences.ts` devient la fabrique `createSoundPrefs(prefix)` |
| `packages/ui/src/i18n/lang.tsx` (déplacer, réécrire) | `createI18n(opts)` générique + `UiCopy` (textes des mascottes) |
| `packages/ui/src/bots/Bot.tsx`, `ResidentMascot.tsx`, `material.ts`, `poseFor.ts`, `useBotMotion.ts`, `bots.css`, `resident.css` (déplacer) | Mascottes ; lisent `UiCopy` au lieu de `useI18n` |
| `packages/ui/test/*.test.ts(x)` (déplacer) | `accent`, `motion`, `scale` (parties pures), `sounds` (parties `preferences`/`cues`/`player`), `bot`, `bot-motion`, `bot-choreography`, `resident` (partie `ResidentMascot` seule), `i18n` (partie `createI18n`) |
| `apps/overlay/src/i18n/lang.tsx` (réécrire) | Façade : `createI18n({ langs: LANGS, messages: MESSAGES, prefix: 'ledge', uiCopy })` |
| `apps/overlay/src/sounds/preferences.ts` (réécrire) | Façade : `createSoundPrefs('ledge')` |
| `apps/overlay/src/accent.ts`, `motion.ts`, `motionPreferences.ts`, `scale.ts`, `bots/*.ts(x)` (réécrire en façades) | `export * from '@ledge/ui/...'` |
| `apps/overlay/src/styles/base.css` (réécrire) | `@import "tailwindcss"; @import "@ledge/ui/styles/base.css";` + règles propres à l'île |
| `packages/protocol/src/session.ts` (modifier) | `offline: z.boolean().optional()` |
| `packages/fleet/package.json`, `tsconfig.json`, `vite.config.ts`, `test/setup.ts` (créer) | `@ledge/fleet`, React en peer, `ws` en devDep, tests jsdom + node |
| `packages/fleet/src/index.ts` (créer) | Barrel |
| `packages/fleet/src/client.ts`, `store.ts`, `machines.ts`, `fleet.ts`, `changes.ts` (déplacer depuis `apps/overlay/src/daemon/`) | Client de flotte ; `liveHelpers` rapatrié dans `changes.ts` |
| `packages/fleet/test/mockDaemon.ts`, `daemon.test.ts`, `fleet.test.ts`, `changes.test.ts` (déplacer) | Tests de flotte ; `fleet.test.ts` perd le test `groupSessions` (reste dans l'overlay) |
| `packages/fleet/test/keep-stale.test.ts`, `machines-source.test.ts` (créer) | Nouveaux comportements derrière options |
| `apps/overlay/src/daemon/client.ts`, `store.ts`, `machines.ts`, `fleet.ts`, `changes.ts` (réécrire en façades) | `export * from '@ledge/fleet/...'` |
| `apps/overlay/src/bots/poseFor.ts` (façade) | `liveHelpers` réexporté depuis `@ledge/fleet/changes` via `@ledge/ui` |
| `apps/overlay/test/mockDaemon.ts` (réécrire) | `export * from '@ledge/fleet/test/mockDaemon'` |
| `apps/overlay/test/groups.test.ts` (modifier) | Reçoit le test `groupSessions` retiré de `fleet.test.ts` |
| `Cargo.toml` (créer, racine) | Workspace `members = ["apps/overlay/src-tauri", "crates/ledge-native"]` |
| `Cargo.lock` (déplacer depuis `apps/overlay/src-tauri/`) | Lock unique du workspace |
| `crates/ledge-native/Cargo.toml`, `src/lib.rs`, `src/terminal.rs`, `src/browser.rs`, `src/autostart.rs` (créer) | Fonctions natives partagées et stubs non-Windows |
| `apps/overlay/src-tauri/Cargo.toml` (modifier) | `ledge-native = { path = "../../crates/ledge-native" }` ; `windows` reste pour la géométrie de l'île |
| `apps/overlay/src-tauri/src/main.rs` (modifier) | Les commandes délèguent à la crate ; tests déplacés |
| `apps/overlay/scripts/set-version.mjs`, `apps/overlay/test/version.test.ts` (modifier) | Chemin du `Cargo.lock` racine |
| `.github/workflows/release.yml` (modifier) | `rust-cache` `workspaces: .` ; `cargo test --workspace` |
| `package.json` (racine, modifier) | Rien à ajouter aux scripts (`pnpm -r`) ; vérifier que `typecheck`/`test` incluent les nouveaux paquets |

---

### Task 1: Squelette `packages/ui` et modules sans état (`motion`, `accent`, `scale`)

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vite.config.ts`, `packages/ui/test/setup.ts`, `packages/ui/src/index.ts`
- Move: `apps/overlay/src/motion.ts` → `packages/ui/src/motion.ts` ; `apps/overlay/src/accent.ts` → `packages/ui/src/accent.ts` ; `apps/overlay/src/scale.ts` → `packages/ui/src/scale.ts`
- Move tests: `apps/overlay/test/motion.test.ts` → `packages/ui/test/motion.test.ts` ; `apps/overlay/test/accent.test.ts` → `packages/ui/test/accent.test.ts` ; les trois premiers `it` de `apps/overlay/test/scale.test.tsx` (lignes 11, 28, 42 : « handle Auto follows… », « each is persisted… », « a stored single Size migrates… ») → `packages/ui/test/scale.test.ts`
- Rewrite as façades: `apps/overlay/src/motion.ts`, `apps/overlay/src/accent.ts`, `apps/overlay/src/scale.ts`

**Interfaces:**
- Produces: paquet `@ledge/ui` importable par `@ledge/ui` (barrel) et `@ledge/ui/<module>` ; `loadAccent(prefix = 'ledge')`, `saveAccent(hex, prefix = 'ledge')`, `loadScale(target, prefix = 'ledge')`, `saveScale(target, s, prefix = 'ledge')`, `migrateLegacyScale(prefix = 'ledge')`. Les signatures existantes restent valides (paramètre ajouté en dernier avec défaut).

- [ ] **Step 1: Créer le paquet**

```json
{
  "name": "@ledge/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts",
    "./bots/*": "./src/bots/*",
    "./sounds/*": "./src/sounds/*.ts",
    "./i18n/lang": "./src/i18n/lang.tsx",
    "./styles/*": "./src/styles/*",
    "./test/*": "./test/*"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "dependencies": { "@ledge/protocol": "workspace:*" },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0", "@testing-library/react": "^16.1.0", "@types/node": "^22.7.0",
    "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0", "react": "^19.0.0", "react-dom": "^19.0.0", "typescript": "^5.6.0", "vite": "^6.0.0", "vitest": "^3.0.0"
  }
}
```

`packages/ui/tsconfig.json` (copie de celui de l'overlay, sans `e2e` ni `playwright.config.ts`) :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client", "node", "@testing-library/jest-dom"],
    "noEmit": true, "declaration": false, "sourceMap": false
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`packages/ui/vite.config.ts` :

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], include: ['test/**/*.test.{ts,tsx}'], env: { VITE_LEDGE_MOTION: '0' } }
});
```

`packages/ui/test/setup.ts` : reprendre **à l'identique** `apps/overlay/test/setup.ts` sauf la ligne `setFallbackLang('en')` (le paquet n'a pas de messages ; les tests de `createI18n` construisent les leurs) :

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
// Node 25+ ships its own `localStorage` which throws without --localstorage-file: lend jsdom's to the globals.
if (typeof window !== 'undefined' && typeof localStorage === 'undefined') Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
class RO { observe() {} unobserve() {} disconnect() {} }
if (typeof ResizeObserver === 'undefined') Object.defineProperty(globalThis, 'ResizeObserver', { value: RO, configurable: true });
```

(Si la version de l'overlay du prêt de `localStorage`/`ResizeObserver` diffère de cette forme, copier la sienne mot pour mot : c'est elle qui fait passer les 68 tests de l'île.)

- [ ] **Step 2: Déplacer les trois modules et paramétrer les clés**

`git mv apps/overlay/src/motion.ts packages/ui/src/motion.ts` (aucun changement de contenu : `motion.ts` ne touche pas au stockage).

`git mv apps/overlay/src/accent.ts packages/ui/src/accent.ts`, puis remplacer la constante de clé par une fonction et ajouter le paramètre :

```ts
/** Where the accent is kept: `ledge.accent` for the island, `desktop.accent` for Desktop (spec 2026-10-14 §7). */
const key = (prefix: string) => `${prefix}.accent`;
export function loadAccent(prefix = 'ledge'): string | null {
  try { return parseAccent(localStorage.getItem(key(prefix))); } catch { return null; }
}
export function saveAccent(hex: string | null, prefix = 'ledge'): void {
  try { if (hex) localStorage.setItem(key(prefix), hex); else localStorage.removeItem(key(prefix)); } catch { /* storage unavailable: the in-memory value still applies */ }
}
```

(Garder le corps actuel de `loadAccent`/`saveAccent` ; seules la clé et la signature changent. Si `saveAccent(null)` fait aujourd'hui autre chose que `removeItem`, conserver ce comportement.)

`git mv apps/overlay/src/scale.ts packages/ui/src/scale.ts`, puis :

```ts
const keys = (prefix: string): Record<ScaleTarget, string> => ({ handle: `${prefix}.handleScale`, panel: `${prefix}.panelScale` });
const legacyKey = (prefix: string) => `${prefix}.uiScale`;
export function migrateLegacyScale(prefix = 'ledge'): void { /* corps actuel, KEYS → keys(prefix), LEGACY_KEY → legacyKey(prefix) */ }
export function loadScale(target: ScaleTarget, prefix = 'ledge'): UiScale { /* idem */ }
export function saveScale(target: ScaleTarget, s: UiScale, prefix = 'ledge'): void { /* idem */ }
```

- [ ] **Step 3: Le barrel et les façades de l'overlay**

`packages/ui/src/index.ts` (complété aux tâches suivantes) :

```ts
export * from './motion';
export * from './accent';
export * from './scale';
```

Façades (le contenu complet de chaque fichier de l'overlay) :

```ts
// apps/overlay/src/motion.ts
export * from '@ledge/ui/motion';
```
```ts
// apps/overlay/src/accent.ts
export * from '@ledge/ui/accent';
```
```ts
// apps/overlay/src/scale.ts
export * from '@ledge/ui/scale';
```

Dans `apps/overlay/package.json`, ajouter `"@ledge/ui": "workspace:*"` aux `dependencies`, puis `pnpm install` à la racine.

- [ ] **Step 4: Déplacer les tests purs**

`git mv apps/overlay/test/motion.test.ts packages/ui/test/motion.test.ts` et `git mv apps/overlay/test/accent.test.ts packages/ui/test/accent.test.ts` ; corriger leurs imports (`'../src/motion'` et `'../src/accent'` : inchangés, les chemins relatifs restent valides).

Créer `packages/ui/test/scale.test.ts` avec l'en-tête ci-dessous et y coller **tels quels** les trois `it` purs de `apps/overlay/test/scale.test.tsx` (les retirer de l'overlay, où restent les `it` qui rendent `SettingsView` et `App`) :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { autoScale, loadScale, migrateLegacyScale, resolveScale, saveScale } from '../src/scale';

beforeEach(() => localStorage.clear());

describe('UI scales', () => {
  // … les trois `it` déplacés, sans modification …
  it('keeps each prefix apart', () => {
    saveScale('handle', 2, 'desktop');
    expect(loadScale('handle')).toBe('auto');
    expect(loadScale('handle', 'desktop')).toBe(2);
    expect(localStorage.getItem('desktop.handleScale')).toBe('2');
  });
});
```

Ajouter le même genre de test au fichier `accent.test.ts` déplacé :

```ts
it('keeps each prefix apart', () => {
  saveAccent('#336699', 'desktop');
  expect(loadAccent()).toBeNull();
  expect(loadAccent('desktop')).toBe('#336699');
});
```

- [ ] **Step 5: Vérifier**

Run: `pnpm install && pnpm --filter @ledge/ui test && pnpm --filter @ledge/ui typecheck && pnpm --filter overlay typecheck && pnpm --filter overlay test`
Expected: tout vert ; `scale.test.tsx` de l'overlay ne contient plus que les tests UI, qui passent.

- [ ] **Step 6: Commit**

```bash
git checkout -b desktop/lot1-extraction
git add packages/ui apps/overlay/src/motion.ts apps/overlay/src/accent.ts apps/overlay/src/scale.ts apps/overlay/test apps/overlay/package.json pnpm-lock.yaml
git commit -m "refactor(ui): extract motion, accent and scale into @ledge/ui"
```

---

### Task 2: `motionPreferences` et `sounds/{cues,player}`

**Files:**
- Move: `apps/overlay/src/motionPreferences.ts` → `packages/ui/src/motionPreferences.ts` ; `apps/overlay/src/sounds/cues.ts` → `packages/ui/src/sounds/cues.ts` ; `apps/overlay/src/sounds/player.ts` → `packages/ui/src/sounds/player.ts`
- Rewrite as façades: `apps/overlay/src/motionPreferences.ts`, `apps/overlay/src/sounds/cues.ts`, `apps/overlay/src/sounds/player.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `createMotionPreferences(prefix: string): { loadReduced(): boolean; saveReduced(v: boolean): void; useMotionPreferences(): { reduced: boolean; app: boolean; setReduced(value: boolean): void } }`, et les exports inchangés `useOsReducedMotion`, `envReduced` ; `@ledge/ui/motionPreferences` exporte aussi `useMotionPreferences` = celui de l'instance `'ledge'` (pour `Bot`, tâche 5, et l'île).
- Consumes: rien.

- [ ] **Step 1: Test de l'isolation par préfixe**

`packages/ui/test/motion-preferences.test.tsx` :

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createMotionPreferences, useMotionPreferences } from '../src/motionPreferences';

beforeEach(() => localStorage.clear());

describe('motion preferences per prefix', () => {
  it('the default instance keeps the island key', () => {
    const { result } = renderHook(() => useMotionPreferences());
    act(() => result.current.setReduced(true));
    expect(localStorage.getItem('ledge.reducedMotion')).toBe('true');
    expect(localStorage.getItem('desktop.reducedMotion')).toBeNull();
  });
  it('another prefix reads and writes its own key only', () => {
    localStorage.setItem('ledge.reducedMotion', 'true');
    const desktop = createMotionPreferences('desktop');
    const { result } = renderHook(() => desktop.useMotionPreferences());
    expect(result.current.app).toBe(false);
    act(() => result.current.setReduced(true));
    expect(localStorage.getItem('desktop.reducedMotion')).toBe('true');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`createMotionPreferences` n'existe pas) : `pnpm --filter @ledge/ui test motion-preferences`

- [ ] **Step 3: Déplacer et fabriquer**

`git mv apps/overlay/src/motionPreferences.ts packages/ui/src/motionPreferences.ts`, puis envelopper tout ce qui touche `KEY` (lecture, écriture, l'écouteur `storage`, le hook) dans une fabrique ; `useOsReducedMotion` et `envReduced` restent au niveau module :

```ts
/** One store per key prefix: the island keeps `ledge.reducedMotion`, Desktop gets `desktop.reducedMotion` (spec §7). */
export function createMotionPreferences(prefix: string) {
  const KEY = `${prefix}.reducedMotion`;
  // … le code actuel du module qui utilisait KEY, inchangé : loadReduced/saveReduced, listeners, onStorage, useMotionPreferences …
  return { loadReduced, saveReduced, useMotionPreferences };
}
const island = createMotionPreferences('ledge');
export const useMotionPreferences = island.useMotionPreferences;
```

Façade `apps/overlay/src/motionPreferences.ts` : `export * from '@ledge/ui/motionPreferences';`.

`git mv` de `cues.ts` et `player.ts` vers `packages/ui/src/sounds/` sans changement (ils n'importent que `./preferences` pour un type, que la tâche 4 déplace ; d'ici là, `cues.ts` importe `type SoundCategory` depuis `'./preferences'` qui n'existe pas encore dans le paquet → **déplacer à cette tâche uniquement le type** : créer `packages/ui/src/sounds/preferences.ts` minimal contenant les types et constantes sans état de l'actuel `preferences.ts` : `FinishedNotify`, `SoundVolume`, `SoundCategory`, `SoundPrefs`, `FINISHED_VALUES`, `VOLUMES`, `CATEGORIES`, `VOLUME_GAIN`, `DEFAULT_SOUNDS`. L'overlay garde le reste dans son propre `preferences.ts` jusqu'à la tâche 4, en important ces types depuis `@ledge/ui/sounds/preferences`.)

Façades : `apps/overlay/src/sounds/cues.ts` → `export * from '@ledge/ui/sounds/cues';` ; `apps/overlay/src/sounds/player.ts` → `export * from '@ledge/ui/sounds/player';`.

`packages/ui/src/index.ts` : ajouter `export * from './motionPreferences'; export * from './sounds/cues'; export * from './sounds/player';`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/ui test && pnpm -r typecheck && pnpm --filter overlay test`

- [ ] **Step 5: Commit** : `git add -A packages/ui apps/overlay/src && git commit -m "refactor(ui): extract motion preferences, sound cues and player"`

---

### Task 3: `createI18n` générique et `UiCopy`

**Files:**
- Create: `packages/ui/src/i18n/lang.tsx`, `packages/ui/src/i18n/copy.tsx`, `packages/ui/test/i18n.test.tsx`
- Rewrite: `apps/overlay/src/i18n/lang.tsx` (façade construisant l'instance de l'île)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UiCopy { botLabel: Record<BotState, string>; botReadOnly: string; botNotLive: string; residentName: string; residentOffline: string }
  export function createI18n<L extends string, M>(opts: { langs: readonly L[]; messages: Record<L, M>; fallback: L; prefix: string; uiCopy: (m: M) => UiCopy }): {
    loadLang(): L; saveLang(l: L): void; setFallbackLang(l: L): void;
    LangProvider(props: { lang: L; children: ReactNode }): JSX.Element;
    useI18n(): { lang: L; t: M }; messagesFor(l?: L): M;
  }
  export function useUiCopy(): UiCopy   // contexte, sinon le résolveur par défaut enregistré par la dernière createI18n
  export function UiCopyProvider(props: { copy: UiCopy; children: ReactNode }): JSX.Element
  ```
- Consumes: `BotState` de `./bots/poseFor`, déplacé **dès cette tâche** avec sa façade (il ne dépend que de `@ledge/protocol` ; voir Step 3).

- [ ] **Step 1: Test**

`packages/ui/test/i18n.test.tsx` :

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { createI18n, useUiCopy, type UiCopy } from '../src/i18n/lang';

const copy = (name: string): UiCopy => ({ botLabel: { starting: name, working: name, approval: name, question: name, idle: name, done: name, error: name, readonly: name }, botReadOnly: name, botNotLive: name, residentName: name, residentOffline: name });
const fr = { hello: 'Bonjour', ui: copy('fr') }; const en = { hello: 'Hello', ui: copy('en') };
const make = (prefix = 'ledge') => createI18n({ langs: ['fr', 'en'] as const, messages: { fr, en }, fallback: 'fr', prefix, uiCopy: m => m.ui });

beforeEach(() => localStorage.clear());

describe('createI18n', () => {
  it('reads the stored language under its prefix, falls back otherwise', () => {
    const i18n = make();
    expect(i18n.loadLang()).toBe('fr');
    localStorage.setItem('ledge.lang', 'en'); expect(i18n.loadLang()).toBe('en');
    localStorage.setItem('ledge.lang', 'de'); expect(i18n.loadLang()).toBe('fr');
    i18n.setFallbackLang('en'); expect(i18n.loadLang()).toBe('en');
    i18n.saveLang('fr'); expect(localStorage.getItem('ledge.lang')).toBe('fr');
    expect(make('desktop').loadLang()).toBe('fr'); // another prefix does not see ledge.lang
  });
  it('useI18n follows the provider, else the stored language', () => {
    const i18n = make();
    localStorage.setItem('ledge.lang', 'en');
    expect(renderHook(() => i18n.useI18n()).result.current.t.hello).toBe('Hello');
    const { result } = renderHook(() => i18n.useI18n(), { wrapper: ({ children }) => <i18n.LangProvider lang="fr">{children}</i18n.LangProvider> });
    expect(result.current.t.hello).toBe('Bonjour');
  });
  it('the UI copy follows the provider, and outside one the stored language of the last created i18n', () => {
    const i18n = make();
    localStorage.setItem('ledge.lang', 'en');
    expect(renderHook(() => useUiCopy()).result.current.botReadOnly).toBe('en');
    const { result } = renderHook(() => useUiCopy(), { wrapper: ({ children }) => <i18n.LangProvider lang="fr">{children}</i18n.LangProvider> });
    expect(result.current.botReadOnly).toBe('fr');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @ledge/ui test i18n`

- [ ] **Step 3: Implémenter**

`packages/ui/src/i18n/copy.tsx` :

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { BotState } from '../bots/poseFor';

/** The few strings the shared mascots speak (aria labels); each app maps its own messages to it. */
export interface UiCopy { botLabel: Record<BotState, string>; botReadOnly: string; botNotLive: string; residentName: string; residentOffline: string }
const UiCopyContext = createContext<UiCopy | null>(null);
/** French, so a mascot rendered before any i18n exists still has a label. */
let resolveDefault: () => UiCopy = () => ({
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' },
  botReadOnly: 'Lecture seule', botNotLive: 'Figé', residentName: 'Ledge', residentOffline: 'Ledge · connexion perdue'
});
/** `createI18n` registers its stored-language copy here: a mascot outside a provider reads the stored language, as before. */
export function setDefaultUiCopy(fn: () => UiCopy): void { resolveDefault = fn; }
export function UiCopyProvider({ copy, children }: { copy: UiCopy; children: ReactNode }) { return <UiCopyContext.Provider value={copy}>{children}</UiCopyContext.Provider>; }
export function useUiCopy(): UiCopy { return useContext(UiCopyContext) ?? resolveDefault(); }
```

`packages/ui/src/i18n/lang.tsx` :

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { UiCopyProvider, setDefaultUiCopy, type UiCopy } from './copy';
export { UiCopyProvider, useUiCopy, type UiCopy } from './copy';

/** The language mechanism, generic over an app's message table: the island and Desktop share it, not their copy (spec §4.1). */
export function createI18n<L extends string, M>(opts: { langs: readonly L[]; messages: Record<L, M>; fallback: L; prefix: string; uiCopy: (m: M) => UiCopy }) {
  const KEY = `${opts.prefix}.lang`;
  let fallback = opts.fallback;
  const loadLang = (): L => { try { const v = localStorage.getItem(KEY); return (opts.langs as readonly string[]).includes(v ?? '') ? (v as L) : fallback; } catch { return fallback; } };
  const saveLang = (l: L): void => { try { localStorage.setItem(KEY, l); } catch { /* storage unavailable: the in-memory value still applies */ } };
  const messagesFor = (l: L = loadLang()): M => opts.messages[l];
  const LangContext = createContext<L | null>(null);
  function LangProvider({ lang, children }: { lang: L; children: ReactNode }) {
    return <LangContext.Provider value={lang}><UiCopyProvider copy={opts.uiCopy(opts.messages[lang])}>{children}</UiCopyProvider></LangContext.Provider>;
  }
  const useI18n = (): { lang: L; t: M } => { const lang = useContext(LangContext) ?? loadLang(); return { lang, t: opts.messages[lang] }; };
  setDefaultUiCopy(() => opts.uiCopy(messagesFor()));
  return { loadLang, saveLang, setFallbackLang: (l: L) => { fallback = l; }, LangProvider, useI18n, messagesFor };
}
```

Déplacer `poseFor.ts` maintenant : `git mv apps/overlay/src/bots/poseFor.ts packages/ui/src/bots/poseFor.ts` ; il **définit** `liveHelpers` (ligne 17) et ne dépend que de `@ledge/protocol` : aucun changement de contenu ici (la tâche 6 déplace `liveHelpers` vers `@ledge/fleet`). Façade `apps/overlay/src/bots/poseFor.ts` : `export * from '@ledge/ui/bots/poseFor';`.

Façade `apps/overlay/src/i18n/lang.tsx` (contenu complet) :

```tsx
import { createI18n, type UiCopy } from '@ledge/ui/i18n/lang';
import { LANGS, MESSAGES, type Lang, type Messages } from './messages';

/** The island's mascots speak `botLabel`, `botReadOnly`, `botNotLive` and `resident.*` of its own messages. */
const uiCopy = (m: Messages): UiCopy => ({ botLabel: m.botLabel, botReadOnly: m.botReadOnly, botNotLive: m.botNotLive, residentName: m.resident.name, residentOffline: m.resident.offline });
const i18n = createI18n<Lang, Messages>({ langs: LANGS, messages: MESSAGES, fallback: 'fr', prefix: 'ledge', uiCopy });
export const { loadLang, saveLang, setFallbackLang, LangProvider, useI18n, messagesFor } = i18n;
export type { Lang, Messages };
```

`packages/ui/src/index.ts` : ajouter `export * from './i18n/lang'; export * from './bots/poseFor';`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/ui test && pnpm -r typecheck && pnpm --filter overlay test` (l'overlay utilise encore ses propres `Bot`/`ResidentMascot` avec `useI18n` de la façade : inchangé).

- [ ] **Step 5: Commit** : `git add -A packages/ui apps/overlay/src && git commit -m "refactor(ui): generic createI18n and UiCopy context"`

---

### Task 4: `createSoundPrefs(prefix)`

**Files:**
- Modify: `packages/ui/src/sounds/preferences.ts` (reçoit le reste de l'actuel `apps/overlay/src/sounds/preferences.ts` sous forme de fabrique)
- Rewrite: `apps/overlay/src/sounds/preferences.ts` (façade)
- Move tests: les `it` de `apps/overlay/test/sounds.test.ts` qui n'importent que `preferences`, `cues`, `player` → `packages/ui/test/sounds.test.ts` ; ceux qui utilisent `decideSound`/`SOUND_RATE_MS` restent (`decide.ts` reste dans l'overlay, il dépend de `daemon/changes`).
- Create: test d'isolation ci-dessous.

**Interfaces:**
- Produces: `createSoundPrefs(prefix: string): { loadFinished(): FinishedNotify; loadSounds(): SoundPrefs; setFinished(v: FinishedNotify): void; setSounds(patch: SoundPatch): void; resetSoundPrefsForTests(): void; useSoundPrefs(): { finished: FinishedNotify; sounds: SoundPrefs } }` (même forme de retour pour `useSoundPrefs` qu'aujourd'hui : copier la signature réelle). Les types et constantes de la tâche 2 restent exportés au niveau module.
- Consumes: rien.

- [ ] **Step 1: Test (Review Focus 2)**

Ajouter à `packages/ui/test/sounds.test.ts` :

```ts
import { createSoundPrefs, DEFAULT_SOUNDS } from '../src/sounds/preferences';

describe('sound preferences per prefix', () => {
  beforeEach(() => localStorage.clear());
  it('two instances never share a key nor a subscriber', () => {
    const island = createSoundPrefs('ledge'); const desktop = createSoundPrefs('desktop');
    island.setFinished('sound');
    expect(localStorage.getItem('ledge.finished')).toBe('sound');
    expect(desktop.loadFinished()).toBe('both');
    const { result: d } = renderHook(() => desktop.useSoundPrefs());
    act(() => island.setSounds({ volume: 'low' }));
    expect(d.current).toEqual({ finished: 'both', sounds: DEFAULT_SOUNDS });
    expect(localStorage.getItem('desktop.sounds')).toBeNull();
  });
});
```

(Adapter `{ volume: 'low' }` à la forme réelle de `SoundPatch` et `'sound'` à une valeur de `FINISHED_VALUES`, en lisant `preferences.ts` : ne pas inventer de valeurs.)

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @ledge/ui test sounds`

- [ ] **Step 3: Implémenter**

Dans `packages/ui/src/sounds/preferences.ts`, sous les types/constantes déjà présents, coller le reste de l'ancien module **dans** une fabrique, en remplaçant `FINISHED_KEY`/`SOUNDS_KEY` par des clés préfixées et en gardant l'état (`current`, `listeners`) par instance :

```ts
/** One preference store per key prefix (`ledge.*` for the island, `desktop.*` for Desktop, spec §7). */
export function createSoundPrefs(prefix: string) {
  const FINISHED_KEY = `${prefix}.finished`;
  const SOUNDS_KEY = `${prefix}.sounds`;
  // … loadFinished, loadSounds (validation champ par champ inchangée), état du module, listeners, setFinished, setSounds, resetSoundPrefsForTests, useSoundPrefs : copiés tels quels …
  return { loadFinished, loadSounds, setFinished, setSounds, resetSoundPrefsForTests, useSoundPrefs };
}
```

Façade `apps/overlay/src/sounds/preferences.ts` :

```ts
import { createSoundPrefs } from '@ledge/ui/sounds/preferences';
export * from '@ledge/ui/sounds/preferences';
export const { loadFinished, loadSounds, setFinished, setSounds, resetSoundPrefsForTests, useSoundPrefs } = createSoundPrefs('ledge');
```

`decide.ts` de l'overlay importe `VOLUME_GAIN, type FinishedNotify, type SoundPrefs` depuis `'./preferences'` : la façade les réexporte, rien à changer.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/ui test && pnpm -r typecheck && pnpm --filter overlay test`

- [ ] **Step 5: Commit** : `git add -A packages/ui apps/overlay && git commit -m "refactor(ui): sound preferences as a per-prefix factory"`

---

### Task 5: Mascottes (`Bot`, `ResidentMascot`, `material`, `useBotMotion`, CSS) et styles

**Files:**
- Move: `apps/overlay/src/bots/{Bot.tsx,ResidentMascot.tsx,material.ts,useBotMotion.ts,bots.css,resident.css}` → `packages/ui/src/bots/` ; `apps/overlay/src/styles/tokens.css` → `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/base.css` (partie partagée de l'actuel `base.css`)
- Rewrite: `apps/overlay/src/styles/base.css`, façades `apps/overlay/src/bots/{Bot.tsx,ResidentMascot.tsx,material.ts,useBotMotion.ts}`
- Move tests: `apps/overlay/test/{bot,bot-motion,bot-choreography}.test.tsx` → `packages/ui/test/` ; dans `apps/overlay/test/resident.test.tsx`, seuls les `it` qui rendent `ResidentMascot` **sans** `Handle` ni `layout` vont dans `packages/ui/test/resident.test.tsx` (ligne 69 par exemple) ; ceux avec `Handle` restent.
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `Bot`, `BotProps`, `ResidentMascot`, `ResidentMascotProps`, `materialFor`, `useBotMotion`, `useBotNod`, `useBotVisibility`, `BOT_MOTION` inchangés ; CSS `@ledge/ui/styles/tokens.css`, `@ledge/ui/styles/base.css`, `@ledge/ui/bots/bots.css`, `@ledge/ui/bots/resident.css`.
- Consumes: `useUiCopy` (tâche 3), `useMotionPreferences`/`useOsReducedMotion` (tâche 2), `MOTION`, `ms` (tâche 1).

- [ ] **Step 1: Test (Review Focus 1)**

`packages/ui/test/bot-copy.test.tsx` :

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Bot } from '../src/bots/Bot';
import { createI18n, type UiCopy } from '../src/i18n/lang';

const copy = (s: string): UiCopy => ({ botLabel: { starting: s, working: s, approval: s, question: s, idle: s, done: s, error: s, readonly: s }, botReadOnly: `${s}-ro`, botNotLive: `${s}-frozen`, residentName: s, residentOffline: s });
const i18n = createI18n({ langs: ['fr', 'en'] as const, messages: { fr: copy('fr'), en: copy('en') }, fallback: 'fr', prefix: 'ledge', uiCopy: m => m });
beforeEach(() => localStorage.clear());

describe('mascot labels', () => {
  it('outside a provider the bot reads the stored language, as the island always did', () => {
    localStorage.setItem('ledge.lang', 'en');
    const { container } = render(<Bot tool="claude" state="question" pose={1} size={32} theme="dark" seed="s1" readOnly />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Claude Code · en · en-ro');
  });
  it('inside a provider the provider wins', () => {
    localStorage.setItem('ledge.lang', 'en');
    const { container } = render(<i18n.LangProvider lang="fr"><Bot tool="codex" state="working" pose={2} size={32} theme="light" seed="s2" frozen /></i18n.LangProvider>);
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Codex · fr · fr-frozen');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (les fichiers n'existent pas encore dans le paquet) : `pnpm --filter @ledge/ui test bot-copy`

- [ ] **Step 3: Déplacer et remplacer `useI18n`**

`git mv` des six fichiers de `bots/` et de `tokens.css`. Dans `packages/ui/src/bots/Bot.tsx` :

```tsx
import { useUiCopy } from '../i18n/copy';
// …
const t = useUiCopy();          // remplace `const { t } = useI18n();`
// ligne 123, inchangée sauf les noms : `${TOOL_NAMES[tool]} · ${t.botLabel[state]}${readOnly && state !== 'readonly' ? ` · ${t.botReadOnly}` : ''}${frozen ? ` · ${t.botNotLive}` : ''}`
```

Dans `ResidentMascot.tsx` : `const t = useUiCopy();` et `<title>{frozen ? t.residentOffline : t.residentName}</title>`.

`packages/ui/src/styles/base.css` : copier l'actuel `base.css` de l'overlay **moins** sa première ligne `@import "tailwindcss";` (Tailwind est importé par l'app, pas par le paquet) ; garder les `@import "./tokens.css"; @import "../bots/bots.css"; @import "../bots/resident.css";` et toutes les règles (elles sont nommées `ledge-*` et conviennent aux deux apps : la spec §4.1 déplace `base.css` entier).

`apps/overlay/src/styles/base.css` devient :

```css
@import "tailwindcss";
@import "@ledge/ui/styles/base.css";
```

Vérifier que Vite résout `@import "@ledge/ui/styles/base.css"` (export `./styles/*` du `package.json` de `@ledge/ui`) et, dans ce fichier, les imports relatifs `../bots/bots.css` : ils sont résolus depuis `packages/ui/src/styles/`, donc valides.

Façades : `apps/overlay/src/bots/Bot.tsx` → `export * from '@ledge/ui/bots/Bot';` (idem `ResidentMascot`, `material`, `useBotMotion`). Supprimer `apps/overlay/src/bots/bots.css` et `resident.css` (plus importés). Supprimer `apps/overlay/src/styles/tokens.css`.

`packages/ui/src/index.ts` : ajouter `export * from './bots/Bot'; export * from './bots/ResidentMascot'; export * from './bots/material'; export * from './bots/useBotMotion';`.

`bot-motion.test.tsx` lit `bots.css` par `readFileSync(resolve(…))` : corriger ce chemin vers `../src/bots/bots.css` après déplacement.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/ui test && pnpm -r typecheck && pnpm --filter overlay test && pnpm --filter overlay build`
Expected: vert ; `prototype-parity.test.tsx` et `i18n.test.tsx` de l'overlay (qui lisent les aria-labels des bots via `SessionList`) passent sans modification.

- [ ] **Step 5: Commit** : `git add -A packages/ui apps/overlay && git commit -m "refactor(ui): move mascots, tokens and base styles into @ledge/ui"`

---

### Task 6: `packages/fleet` : déplacement de `client`, `store`, `machines`, `changes` et du mock daemon

**Files:**
- Create: `packages/fleet/package.json`, `tsconfig.json`, `vite.config.ts`, `test/setup.ts`, `src/index.ts`
- Move: `apps/overlay/src/daemon/{client,store,machines,changes}.ts` → `packages/fleet/src/` ; `apps/overlay/test/mockDaemon.ts` → `packages/fleet/test/mockDaemon.ts` ; `apps/overlay/test/{daemon,changes}.test.ts` → `packages/fleet/test/`
- Rewrite as façades: `apps/overlay/src/daemon/{client,store,machines,changes}.ts`, `apps/overlay/test/mockDaemon.ts`
- Modify: `packages/ui/src/bots/poseFor.ts` (`liveHelpers` vient de `@ledge/fleet/changes`), `apps/overlay/test/changes.test.ts`… (déplacé ; la ligne 43 `expect(asksIsPending).toBe(isPending)` compare à `surface/useDaemonAsks` de l'overlay → **ce `it` reste dans l'overlay** dans un nouveau `apps/overlay/test/asks-pending.test.ts`)

**Interfaces:**
- Produces: `@ledge/fleet` (barrel) et `@ledge/fleet/{client,store,machines,fleet,changes}`, `@ledge/fleet/test/mockDaemon` ; `liveHelpers(session)` exporté par `@ledge/fleet/changes` (et réexporté par `@ledge/ui/bots/poseFor` pour les importateurs actuels).
- Consumes: `@ledge/protocol`.

- [ ] **Step 1: Créer le paquet**

```json
{
  "name": "@ledge/fleet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./*": "./src/*.ts", "./test/*": "./test/*.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^19.0.0" },
  "dependencies": { "@ledge/protocol": "workspace:*", "zod": "^3.23.8" },
  "devDependencies": {
    "@testing-library/react": "^16.1.0", "@types/node": "^22.7.0", "@types/react": "^19.0.0", "@types/ws": "^8.5.0",
    "jsdom": "^25.0.0", "react": "^19.0.0", "react-dom": "^19.0.0", "typescript": "^5.6.0", "vite": "^6.0.0", "vitest": "^3.0.0", "ws": "^8.18.0"
  }
}
```

`tsconfig.json` : même contenu qu'à la tâche 1 (`types: ["vite/client", "node"]`, sans jest-dom). `vite.config.ts` :

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], include: ['test/**/*.test.{ts,tsx}'] } });
```

`test/setup.ts` : le prêt de `localStorage` de la tâche 1 seulement (pas de jest-dom, pas de `cleanup`). `daemon.test.ts` garde son `// @vitest-environment node`.

- [ ] **Step 2: Déplacer**

`git mv` des quatre sources et de `mockDaemon.ts`, `daemon.test.ts`, `changes.test.ts`. Dans `packages/fleet/src/changes.ts`, remplacer `import { liveHelpers } from '../bots/poseFor';` par la définition (le fleet ne dépend pas de l'ui) :

```ts
import type { Helper, Session } from '@ledge/protocol';
/** Helpers (subagents) still at work under a session; the bot reads as working while any remains. */
export const liveHelpers = (session: Session): Helper[] => session.helpers.filter(h => h.state !== 'exited' && h.state !== 'idle');
```

Dans `packages/ui/src/bots/poseFor.ts`, retirer la définition locale et mettre `import { liveHelpers } from '@ledge/fleet/changes'; export { liveHelpers };` ; ajouter `"@ledge/fleet": "workspace:*"` aux `dependencies` de `@ledge/ui`.

`packages/fleet/src/index.ts` : `export * from './client'; export * from './store'; export * from './machines'; export * from './changes';` (`fleet` à la tâche 7).

Façades overlay : `apps/overlay/src/daemon/client.ts` → `export * from '@ledge/fleet/client';` (idem `store`, `machines`, `changes`) ; `apps/overlay/test/mockDaemon.ts` → `export * from '@ledge/fleet/test/mockDaemon';`. Ajouter `"@ledge/fleet": "workspace:*"` aux `dependencies` de l'overlay.

`apps/overlay/test/asks-pending.test.ts` (le `it` retiré de `changes.test.ts`) :

```ts
import { describe, it, expect } from 'vitest';
import { isPending } from '../src/daemon/changes';
import { isPending as asksIsPending } from '../src/surface/useDaemonAsks';
describe('pending asks', () => { it('the asks hook and the change detector agree on what waits', () => { expect(asksIsPending).toBe(isPending); }); });
```

- [ ] **Step 3: Run, expect PASS** : `pnpm install && pnpm --filter @ledge/fleet test && pnpm -r typecheck && pnpm --filter overlay test`

- [ ] **Step 4: Commit** : `git add -A packages apps/overlay pnpm-lock.yaml && git commit -m "refactor(fleet): extract daemon client, store, machines and changes into @ledge/fleet"`

---

### Task 7: `fleet.ts` et ses tests, préfixe de stockage

**Files:**
- Move: `apps/overlay/src/daemon/fleet.ts` → `packages/fleet/src/fleet.ts` ; `apps/overlay/test/fleet.test.ts` → `packages/fleet/test/fleet.test.ts`
- Modify: `apps/overlay/test/groups.test.ts` (reçoit le `it` « groups matching Git origins across hosts… », lignes 86–92 de l'ancien `fleet.test.ts`, avec son import `groupSessions` et `fakeSession`)
- Rewrite: `apps/overlay/src/daemon/fleet.ts` (façade)

**Interfaces:**
- Produces: `createFleetClient(machines, makeClient, opts?: FleetOptions)` avec `FleetOptions = { prefix?: string; keepStale?: boolean; machinesFromDaemon?: boolean }` ; `prefix` par défaut `'ledge'` : clés `${prefix}.fleet.history` et `${prefix}.machines`. `loadMachines(prefix = 'ledge')` dans `machines.ts`. Les deux booléens sont lus aux tâches 8 et 9 ; ici ils existent et ne font rien.
- Consumes: tâche 6.

- [ ] **Step 1: Test du préfixe**

Ajouter dans `packages/fleet/test/fleet.test.ts` (après `setup()` existant, en réutilisant `peer()` et `remote`) :

```ts
it('keeps its history and machines under the given prefix', () => {
  const local = peer();
  createFleetClient([LOCAL_MACHINE], () => local.client, { prefix: 'desktop' }).fleet!.configure([LOCAL_MACHINE, remote]);
  expect(localStorage.getItem('desktop.machines')).toContain('dev-server');
  expect(localStorage.getItem('ledge.machines')).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL** (troisième argument inconnu) : `pnpm --filter @ledge/fleet test fleet`

- [ ] **Step 3: Déplacer et paramétrer**

`git mv` des deux fichiers. Dans `fleet.ts` :

```ts
export interface FleetOptions {
  /** Storage key prefix: `ledge` (island) or `desktop` (spec §7). */
  prefix?: string;
  /** Keep the last snapshot of a fallen remote peer published, sessions flagged `offline` (spec §6). Off: today's behaviour. */
  keepStale?: boolean;
  /** Trust the local daemon's `machines` list once it sends one (spec §5.3). Off: localStorage only. */
  machinesFromDaemon?: boolean;
}
export function createFleetClient(initial: MachineConfig[], makeClient: (c: { url: string }) => DaemonClient, opts: FleetOptions = {}) {
  const prefix = opts.prefix ?? 'ledge';
  const HISTORY_KEY = `${prefix}.fleet.history`, MACHINES_KEY = `${prefix}.machines`;
  // remplacer les littéraux 'ledge.fleet.history' (lignes 25, 40) et 'ledge.machines' (configure) par ces constantes
```

(Garder la signature réelle de `makeClient` telle qu'elle est dans le fichier ; la ligne ci-dessus reprend celle de `fleet.test.ts` : `o => o.url === …`.)

`machines.ts` : `export function loadMachines(prefix = 'ledge'): MachineConfig[] { try { return parseMachines(JSON.parse(localStorage.getItem(`${prefix}.machines`) ?? 'null')); } catch { return [LOCAL_MACHINE]; } }`.

Retirer de `packages/fleet/test/fleet.test.ts` le `it` `groupSessions` et son import `../src/surface/groups` ; le coller dans `apps/overlay/test/groups.test.ts` (qui importe déjà `groupSessions` ; ajouter `fakeSession` depuis `./mockDaemon` si absent).

`packages/fleet/src/index.ts` : ajouter `export * from './fleet';`. Façade `apps/overlay/src/daemon/fleet.ts` : `export * from '@ledge/fleet/fleet';`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/fleet test && pnpm -r typecheck && pnpm --filter overlay test`

- [ ] **Step 5: Commit** : `git add -A packages/fleet apps/overlay && git commit -m "refactor(fleet): move createFleetClient, storage prefix option"`

---

### Task 8: `keepStale`

**Files:**
- Modify: `packages/protocol/src/session.ts` (champ `offline`), `packages/protocol/test/session.test.ts` (ou `messages.test.ts` si c'est là que `SessionSchema` est testé), `packages/fleet/src/fleet.ts`, `packages/fleet/src/machines.ts`
- Create: `packages/fleet/test/keep-stale.test.ts`

**Interfaces:**
- Produces: avec `keepStale: true`, un pair distant dont `status !== 'open'` garde `p.snapshot` ; `publish()` émet ses sessions avec `offline: true` ; `MachineState.status` reste celui du client (`unreachable`/`connecting`) ; `sendTo` renvoie `false` (déjà le cas : `available(p)` exige `open`). `Session.offline?: boolean` dans le protocole.
- Consumes: tâche 7.

- [ ] **Step 1: Protocole**

Dans `packages/protocol/src/session.ts`, à côté de `machineId`/`machineName` :

```ts
  /** Annotated by the fleet when its machine is unreachable and the last snapshot is kept (keepStale, spec 2026-10-14 §6). */
  offline: z.boolean().optional(),
```

Test (fichier de test du schéma de session du protocole, à côté des tests existants de `machineId`) :

```ts
it('accepts and keeps the optional offline flag', () => {
  const s = SessionSchema.parse({ ...base, offline: true });
  expect(s.offline).toBe(true);
  expect(SessionSchema.parse(base).offline).toBeUndefined();
});
```

(`base` = la fixture de session déjà présente dans ce fichier de test.)

- [ ] **Step 2: Test fleet**

`packages/fleet/test/keep-stale.test.ts` — reprendre `peer()`, `remote`, `lastSnapshot` et la fixture de snapshot de `fleet.test.ts` (copie locale, le fichier doit se lire seul) :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import { LOCAL_MACHINE } from '../src/machines';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { fakeSession } from './mockDaemon';

const remote = { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' };
function peer() {
  const sent: unknown[] = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const snap = (ids: string[]): ServerMessage => ({ type: 'snapshot', sessions: ids.map(id => fakeSession(id)), recents: [], launcher: null, daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } });
const lastSnapshot = (got: ServerMessage[]) => [...got].reverse().find(m => m.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }> | undefined;

function setup(opts = { keepStale: true }) {
  const local = peer(), server = peer();
  const api = createFleetClient([LOCAL_MACHINE, remote], o => o.url === LOCAL_MACHINE.url ? local.client : server.client, opts);
  const got: ServerMessage[] = []; api.onMessage(m => got.push(m)); api.connect();
  local.set('open'); local.emit(snap(['a'])); server.set('open'); server.emit(snap(['r1', 'r2']));
  return { api, local, server, got };
}
beforeEach(() => localStorage.clear());

describe('keepStale', () => {
  it('a fallen remote peer keeps its sessions published, flagged offline, its machine unreachable', () => {
    const { api, server, got } = setup();
    server.set('unreachable');
    const s = lastSnapshot(got)!;
    expect(s.sessions.map(x => [x.id, x.offline])).toEqual([['local:a', undefined], ['server:r1', true], ['server:r2', true]]);
    expect(api.fleet!.machines().find(m => m.id === 'server')?.status).toBe('unreachable');
    expect(api.fleet!.sendTo('server', { type: 'snapshot.request' })).toBe(false);
  });
  it('without the option the sessions vanish, as the island expects', () => {
    const { server, got } = setup({ keepStale: false });
    server.set('unreachable');
    expect(lastSnapshot(got)!.sessions.map(x => x.id)).toEqual(['local:a']);
  });
  it('the local peer is never frozen: its fall empties everything and the fleet is unreachable', () => {
    const { api, local, got } = setup();
    local.set('unreachable');
    expect(lastSnapshot(got)!.sessions.map(x => x.id)).toEqual(['server:r1', 'server:r2']);
    expect(api.status()).toBe('open'); // the remote peer still answers
    expect(api.fleet!.sendTo('local', { type: 'snapshot.request' })).toBe(false);
  });
  it('the peer coming back replaces the stale snapshot and drops a session gone meanwhile', () => {
    const { server, got } = setup();
    server.set('unreachable'); server.set('open'); server.emit(snap(['r2', 'r3']));
    expect(lastSnapshot(got)!.sessions.map(x => [x.id, x.offline])).toEqual([['local:a', undefined], ['server:r2', undefined], ['server:r3', undefined]]);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** : `pnpm --filter @ledge/fleet test keep-stale`

- [ ] **Step 4: Implémenter dans `fleet.ts`**

Là où `add(c)` traite un statut `!== 'open'` (`p.fresh = false` + échec des opérations en attente) : ne rien changer. Dans `publish()` et `refresh()`, distinguer disponible et figé :

```ts
const stale = (p: Peer | undefined): boolean => !!opts.keepStale && !!p && p.config.id !== 'local' && p.status !== 'open' && !!p.snapshot;
const session = (p: Peer, s: Session): Session => ({ ...s, id: qualify(p.config.id, s.id), machineId: p.config.id, machineName: p.config.label, ...(stale(p) ? { offline: true } : {}) });
// publish(): les pairs retenus sont `available(p) || stale(p)`, dans l'ordre de `configs` (local d'abord) ; le reste du snapshot (recents, launcher, daemon) vient du pair local comme aujourd'hui.
```

`refresh()` (qui construit `state: MachineState[]`) : les sessions d'un pair `stale` restent dans `sessions`, avec `offline: true`, et `status` est celui du client. Au retour (`p.status = 'open'` puis nouveau `snapshot`), `receive` remplace `p.snapshot` : rien d'autre à faire, les sessions disparues le sont par construction.

`sendTo` reste sur `available(p)` : un pair figé refuse.

- [ ] **Step 5: Run, expect PASS** : `pnpm --filter @ledge/protocol test && pnpm --filter @ledge/fleet test && pnpm -r typecheck && pnpm --filter overlay test`

- [ ] **Step 6: Commit** : `git add -A packages && git commit -m "feat(fleet): keepStale option and Session.offline"`

---

### Task 9: `machinesFromDaemon` (source des machines, migration, premier connecté gagne)

**Files:**
- Modify: `packages/fleet/src/fleet.ts`, `packages/fleet/src/machines.ts` (type `Fleet` : `machinesSource(): 'daemon' | 'local'`), `packages/fleet/test/mockDaemon.ts` (rien : les messages arrivent par `peer().emit`)
- Create: `packages/fleet/test/machines-source.test.ts`

**Interfaces:**
- Produces: `Fleet.machinesSource(): 'daemon' | 'local'` ; messages consommés/émis (définis au lot 2 dans le protocole, **mais** ce lot doit compiler avant : utiliser ici des types locaux `{ type: 'machines'; machines: Machine[] }` et `{ type: 'machines.set'; machines: Machine[] }` avec `Machine = { id: string; label: string; ssh?: string }`, et un garde `isMachinesMessage(m: unknown)` ; le lot 2 remplacera ces types locaux par ceux du protocole). Le fleet n'envoie `machines.set` qu'au pair `local` via `p.client.send(msg as never)` tant que `ClientMessage` ne le connaît pas (commentaire `// lot 2 types it`).
- Consumes: tâche 7.

- [ ] **Step 1: Test**

`packages/fleet/test/machines-source.test.ts` (même `peer()`/`snap` qu'à la tâche 8, copiés) :

```ts
const machinesMsg = (list: { id: string; label: string; ssh?: string }[]) => ({ type: 'machines', machines: list }) as unknown as ServerMessage;
function setup() {
  const local = peer(), server = peer(), extra = peer();
  const api = createFleetClient([LOCAL_MACHINE], o => o.url === LOCAL_MACHINE.url ? local.client : o.url.endsWith('/ssh/dev-server') ? server.client : extra.client, { machinesFromDaemon: true });
  api.connect(); local.set('open'); local.emit(snap(['a']));
  return { api, local, server, extra };
}
beforeEach(() => localStorage.clear());

describe('machines from the daemon', () => {
  it('before any machines message the list is local and configure writes localStorage', () => {
    const { api } = setup();
    expect(api.fleet!.machinesSource()).toBe('local');
    api.fleet!.configure([LOCAL_MACHINE, remote]);
    expect(JSON.parse(localStorage.getItem('ledge.machines')!).map((m: { id: string }) => m.id)).toEqual(['local', 'server']);
  });
  it('once the daemon speaks, configure sends machines.set and waits for the broadcast', () => {
    const { api, local } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    expect(api.fleet!.machinesSource()).toBe('daemon');
    api.fleet!.configure([LOCAL_MACHINE, remote]);
    expect(local.sent.at(-1)).toEqual({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }] });
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local']); // not applied yet
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'server']);
    expect(localStorage.getItem('ledge.machines')).toBeNull();
  });
  it('migrates a richer local list once, then clears the local key', () => {
    localStorage.setItem('ledge.machines', JSON.stringify([LOCAL_MACHINE, remote]));
    const { local } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    expect(local.sent.filter((m: { type: string }) => m.type === 'machines.set')).toHaveLength(1);
    expect(localStorage.getItem('ledge.machines')).toBeNull();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }])); // a second plain list migrates nothing more
    expect(local.sent.filter((m: { type: string }) => m.type === 'machines.set')).toHaveLength(1);
  });
  it('the first front connected wins: a daemon list already filled leaves the local one aside', () => {
    localStorage.setItem('ledge.machines', JSON.stringify([LOCAL_MACHINE, { ...remote, id: 'mine', label: 'mine', ssh: 'mine' }]));
    const { api, local } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    expect(local.sent.some((m: { type: string }) => m.type === 'machines.set')).toBe(false);
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'server']);
    expect(localStorage.getItem('ledge.machines')).toBeNull();
  });
  it('a daemon list arriving while a configure waits replaces the request, no duplicate peer', () => {
    const { api, local } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    api.fleet!.configure([LOCAL_MACHINE, remote]);
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'other', label: 'other', ssh: 'other' }]));
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'other']);
  });
  it('a remote peer\'s machines message is ignored', () => {
    const { api, local, server } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    server.set('open'); server.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'server']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** : `pnpm --filter @ledge/fleet test machines-source`

- [ ] **Step 3: Implémenter**

Dans `fleet.ts` :

```ts
type Machine = { id: string; label: string; ssh?: string };          // lot 2 types it in @ledge/protocol
const isMachinesMessage = (m: unknown): m is { type: 'machines'; machines: Machine[] } => !!m && typeof m === 'object' && (m as { type?: string }).type === 'machines' && Array.isArray((m as { machines?: unknown }).machines);
let source: 'daemon' | 'local' = 'local';
/** Applies a confirmed list to the peers: the body of today's `configure`, minus the storage write. */
function apply(next: MachineConfig[]) { /* configuring = true; fermer les pairs absents; configs = next; ajouter/mettre à jour; selected; configuring = false; publish(); */ }
function receive(p: Peer, m: ServerMessage) {
  if (isMachinesMessage(m)) {
    if (p.config.id !== 'local' || !opts.machinesFromDaemon) return;
    const next = parseMachines(m.machines.map(x => x.id === 'local' ? { ...x, url: configs[0]!.url } : x));
    if (source === 'local') {
      source = 'daemon';
      const mine = loadMachines(prefix);
      if (next.length === 1 && mine.length > 1) { p.client.send({ type: 'machines.set', machines: mine.map(({ id, label, ssh }) => ({ id, label, ...(ssh ? { ssh } : {}) })) } as never); }
      try { localStorage.removeItem(MACHINES_KEY); } catch { /* ignore */ }
    }
    apply(next);
    return;
  }
  // … traitement actuel …
}
// configure(raw):
configure(raw) {
  const next = parseMachines(raw);
  if (next[0]!.url !== configs[0]!.url) throw new Error('The local daemon URL cannot change');
  if (source === 'daemon') { peers.get('local')!.client.send({ type: 'machines.set', machines: next.map(({ id, label, ssh }) => ({ id, label, ...(ssh ? { ssh } : {}) })) } as never); return; }
  localStorage.setItem(MACHINES_KEY, JSON.stringify(next));
  apply(next);
},
machinesSource: () => source,
```

Dans la migration, après l'envoi de `machines.set` avec la liste locale, le daemon diffusera la liste complète : c'est ce second `machines` qui appliquera les pairs ; en attendant, `apply(next)` applique la liste réduite reçue (local seul) — conforme au test « migrates… » et à « premier connecté gagne ».

Ajouter `machinesSource(): 'daemon' | 'local';` à l'interface `Fleet` dans `machines.ts`.

- [ ] **Step 4: Run, expect PASS** : `pnpm --filter @ledge/fleet test && pnpm -r typecheck && pnpm --filter overlay test`

- [ ] **Step 5: Commit** : `git add -A packages && git commit -m "feat(fleet): machines list from the local daemon behind machinesFromDaemon"`

---

### Task 10: Cargo workspace et `crates/ledge-native`

**Files:**
- Create: `Cargo.toml` (racine), `crates/ledge-native/Cargo.toml`, `crates/ledge-native/src/lib.rs`, `src/terminal.rs`, `src/browser.rs`, `src/autostart.rs`
- Move: `apps/overlay/src-tauri/Cargo.lock` → `Cargo.lock`
- Modify: `apps/overlay/src-tauri/Cargo.toml`, `apps/overlay/src-tauri/src/main.rs`

**Interfaces:**
- Produces (crate `ledge_native`) :
  ```rust
  pub mod terminal { pub fn title_matches(title: &str, wanted: &str) -> bool; pub fn terminal_args(title: &str, command: &[String]) -> Vec<String>; pub fn focus(title: &str) -> bool; pub fn foreground_is_terminal() -> bool; pub fn open(title: &str, command: &[String]) -> Result<bool, String>; }
  pub mod browser { pub fn open_url(url: &str) -> Result<(), String>; }
  pub mod autostart { pub const MARKER: &str = "autostart-default"; pub fn by_default(debug: bool, marker_exists: bool) -> bool; }
  ```
  Les `#[tauri::command]` de `main.rs` gardent leurs noms (`focus_terminal`, `foreground_is_terminal`, `open_terminal`, `open_url`, `get_autostart`, `set_autostart`) et délèguent ; `get_autostart`/`set_autostart` restent dans l'app (ils prennent `AppHandle` et le plugin autostart), seul `autostart_by_default`/`AUTOSTART_MARKER` descendent dans la crate.
- Consumes: rien.

- [ ] **Step 1: Workspace**

`Cargo.toml` racine :

```toml
[workspace]
resolver = "2"
members = ["apps/overlay/src-tauri", "crates/ledge-native"]
```

`git mv apps/overlay/src-tauri/Cargo.lock Cargo.lock`.

`crates/ledge-native/Cargo.toml` :

```toml
[package]
name = "ledge-native"
version = "0.5.2"
edition = "2021"
description = "Win32 helpers shared by the Ledge island and Ledge Desktop"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = ["Win32_Foundation", "Win32_UI_WindowsAndMessaging"] }
```

- [ ] **Step 2: Tests dans la crate (déplacés de `main.rs`)**

`crates/ledge-native/src/terminal.rs` se termine par :

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn a_terminal_tab_runs_the_launcher_command_in_wsl() {
        let cmd: Vec<String> = ["/usr/bin/node", "/opt/ledge/cli.js", "attach", "n1"].iter().map(|s| s.to_string()).collect();
        assert_eq!(terminal_args("Juno · api-gateway", &cmd), ["-w", "0", "new-tab", "--title", "Juno · api-gateway", "wsl.exe", "--", "/usr/bin/node", "/opt/ledge/cli.js", "attach", "n1"]);
    }
    #[test] fn matches_bot_title_or_terminal() {
        assert!(title_matches("Otto · harness-assistant - Windows Terminal", "Otto · harness-assistant"));
        assert!(title_matches("PowerShell - Windows Terminal", "Pim · speos-api"));
        assert!(!title_matches("Visual Studio Code", "Pim · speos-api"));
    }
    #[test] fn open_refuses_an_empty_command() { assert_eq!(open("x", &[]), Err("empty command".into())); }
}
```

`autostart.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn launch_at_login_is_switched_on_once_by_an_installed_build() {
        assert!(by_default(false, false));
        assert!(!by_default(false, true));
        assert!(!by_default(true, false));
    }
}
```

`browser.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn only_web_urls_are_opened() { assert_eq!(open_url("file:///etc/passwd"), Err("not a web url".into())); assert_eq!(open_url("ftp://x"), Err("not a web url".into())); }
}
```

- [ ] **Step 3: Implémenter la crate**

`src/lib.rs` : `pub mod terminal; pub mod browser; pub mod autostart;`

`src/terminal.rs` : `title_matches` et `terminal_args` copiés de `main.rs` (lignes 322–325 et 412–416) ; puis :

```rust
/// Brings the Windows Terminal window whose title contains `wanted` forward, else any Windows Terminal window.
#[cfg(windows)]
pub fn focus(title: &str) -> bool {
    // corps exact de `focus_terminal` (main.rs 329–351), `title` étant `&str` : `wanted: title.to_string()`
}
#[cfg(not(windows))]
pub fn focus(_title: &str) -> bool { false }

#[cfg(windows)]
pub fn foreground_is_terminal() -> bool { /* corps exact de main.rs 356–366 */ }
#[cfg(not(windows))]
pub fn foreground_is_terminal() -> bool { false }

/// Opens a Windows Terminal tab running `command` in WSL; true once `wt.exe` was spawned.
pub fn open(title: &str, command: &[String]) -> Result<bool, String> {
    if command.is_empty() { return Err("empty command".into()); }
    #[cfg(windows)]
    { return std::process::Command::new("wt.exe").args(terminal_args(title, command)).spawn().map(|_| true).map_err(|e| format!("wt.exe: {e}")); }
    #[cfg(not(windows))]
    { let _ = title; Ok(false) }
}
```

`src/browser.rs` : `pub fn open_url(url: &str) -> Result<(), String>` = corps de `open_url` de `main.rs` (http(s) seulement, `rundll32 url.dll,FileProtocolHandler` / `xdg-open`).

`src/autostart.rs` : `pub const MARKER: &str = "autostart-default";` et `pub fn by_default(debug: bool, marker_exists: bool) -> bool { !debug && !marker_exists }`.

- [ ] **Step 4: Brancher l'overlay**

`apps/overlay/src-tauri/Cargo.toml` : ajouter `ledge-native = { path = "../../crates/ledge-native" }` aux `[dependencies]` ; garder `windows` (géométrie, `foreground_covers`, `restore_foreground`).

`main.rs` : supprimer les définitions de `title_matches`, `terminal_args`, `autostart_by_default`, `AUTOSTART_MARKER` et les corps Win32 de `focus_terminal`, `foreground_is_terminal`, `open_terminal`, `open_url` ; les commandes deviennent :

```rust
#[tauri::command]
fn focus_terminal(title: String) -> Result<bool, String> { Ok(ledge_native::terminal::focus(&title)) }
#[tauri::command]
fn foreground_is_terminal() -> bool { ledge_native::terminal::foreground_is_terminal() }
#[tauri::command]
fn open_terminal(title: String, command: Vec<String>) -> Result<bool, String> { ledge_native::terminal::open(&title, &command) }
#[tauri::command]
fn open_url(url: String) -> Result<(), String> { ledge_native::browser::open_url(&url) }
```

`default_autostart` : `let marker = dir.join(ledge_native::autostart::MARKER); if !ledge_native::autostart::by_default(cfg!(debug_assertions), marker.exists()) { return; }`. Dans `mod tests`, retirer les trois tests déplacés et les noms correspondants du `use super::{…}` ; `title_matches` reste utilisé ailleurs dans `main.rs` ? (ligne 322 : vérifier avec `grep -n title_matches` ; s'il n'est utilisé que par les tests, le `use ledge_native::terminal::title_matches;` n'est pas nécessaire).

- [ ] **Step 5: Vérifier**

Run (pas de `cargo` ici) : `git push -u origin desktop/lot1-extraction` puis `gh workflow run release.yml --ref desktop/lot1-extraction -f version=0.5.2` ; suivre avec `gh run watch`. Le job `windows-installer` exécute `cargo test` — **mettre à jour `release.yml` d'abord** (tâche 11, Step 1) sinon le `cargo test` ne couvre que `apps/overlay/src-tauri` et le cache pointe sur l'ancien workspace. Alternative : sur Windows, `cargo test --workspace` à la racine.
Expected: `cargo test --workspace` vert (tests de la crate + ceux restés dans `main.rs`), `pnpm tauri build` de l'overlay vert.

- [ ] **Step 6: Commit** : `git add Cargo.toml Cargo.lock crates apps/overlay/src-tauri && git commit -m "refactor(native): shared ledge-native crate and root Cargo workspace"`

---

### Task 11: Scripts de version, CI, et vérification de bout en bout

**Files:**
- Modify: `.github/workflows/release.yml`, `apps/overlay/scripts/set-version.mjs`, `apps/overlay/test/version.test.ts`

**Interfaces:**
- Produces: `set-version.mjs` met aussi à jour `crates/ledge-native/Cargo.toml` et le `Cargo.lock` racine (entrées `ledge-overlay` **et** `ledge-native`) ; `version.test.ts` vérifie ces deux fichiers en plus.

- [ ] **Step 1: CI**

`release.yml`, job `windows-installer` : `Swatinem/rust-cache@v2` avec `workspaces: .` (au lieu de `apps/overlay/src-tauri`) ; l'étape `cargo test` devient `cargo test --workspace` exécutée à la racine (`working-directory` retiré). Le reste (`pnpm tauri build` dans `apps/overlay`) est inchangé : Tauri lit le `Cargo.toml` du membre et le lock du workspace.

- [ ] **Step 2: Test de version**

Dans `apps/overlay/test/version.test.ts`, étendre la liste des fichiers comparés :

```ts
const lock = readFileSync(resolve(root, '../../Cargo.lock'), 'utf8');
expect(lock.match(/^name = "ledge-overlay"\r?\nversion = "([^"]+)"/m)?.[1]).toBe(version);
expect(lock.match(/^name = "ledge-native"\r?\nversion = "([^"]+)"/m)?.[1]).toBe(version);
expect(readFileSync(resolve(root, '../../crates/ledge-native/Cargo.toml'), 'utf8')).toMatch(new RegExp(`^version = "${version}"`, 'm'));
```

Retirer l'ancienne assertion sur `src-tauri/Cargo.lock`, qui n'existe plus.

- [ ] **Step 3: Run, expect FAIL** : `pnpm --filter overlay test version`

- [ ] **Step 4: `set-version.mjs`**

Remplacer les deux `replaceOnce` sur `src-tauri/Cargo.lock` et `Cargo.toml` par :

```js
replaceOnce(resolve(root, 'src-tauri/Cargo.toml'), /^(\[package\]\r?\nname = "ledge-overlay"\r?\nversion = )"[^"]*"/m, `$1"${version}"`);
replaceOnce(resolve(root, '../../crates/ledge-native/Cargo.toml'), /^(\[package\]\r?\nname = "ledge-native"\r?\nversion = )"[^"]*"/m, `$1"${version}"`);
replaceOnce(resolve(root, '../../Cargo.lock'), /^(name = "ledge-overlay"\r?\nversion = )"[^"]*"/m, `$1"${version}"`);
replaceOnce(resolve(root, '../../Cargo.lock'), /^(name = "ledge-native"\r?\nversion = )"[^"]*"/m, `$1"${version}"`);
```

- [ ] **Step 5: Vérification complète**

Run: `pnpm -r typecheck && pnpm -r test && pnpm -r build && git status --short`
Expected: vert partout ; `apps/overlay/src/daemon/*.ts`, `src/bots/*.ts(x)`, `src/i18n/lang.tsx`, `src/sounds/{preferences,cues,player}.ts`, `src/{accent,motion,motionPreferences,scale}.ts` sont des façades d'une à trois lignes ; `git diff --stat main -- apps/overlay/test` ne montre que des suppressions (tests déplacés) et le nouveau `asks-pending.test.ts`, aucune assertion modifiée dans les fichiers restants (`git diff main -- apps/overlay/test | grep '^[-+] *expect' | wc -l` → `0`).

Run: `gh workflow run release.yml --ref desktop/lot1-extraction -f version=0.5.2 && gh run watch` (sans `PUBLISH`)
Expected: jobs `npm` et `windows-installer` verts ; `cargo test --workspace` passe ; l'installeur `Ledge_0.5.2_x64-setup.exe` est produit (artefact non publié).

Essai manuel (spec §14) : installer ce build sur le poste Windows, ouvrir l'île, vérifier mascottes, sons, langue, accent, échelle, liste des machines, terminal : identiques.

- [ ] **Step 6: Commit et MR**

```bash
git add .github/workflows/release.yml apps/overlay/scripts/set-version.mjs apps/overlay/test/version.test.ts
git commit -m "chore: version script and CI follow the Cargo workspace"
git push
```

Ouvrir la MR `desktop/lot1-extraction → main` titrée « Lot 1: extract @ledge/ui, @ledge/fleet and ledge-native » ; le lot 2 part de cette branche.
