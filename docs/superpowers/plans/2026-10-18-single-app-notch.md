# Une seule application : Ledge Desktop porte l'encoche — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Ledge Desktop devient la seule app Windows. Son processus ouvre la fenêtre `main` et la fenêtre `notch` (l'ancienne overlay), avec une seule icône de notification, un seul installeur et un seul updater. L'« île » s'appelle désormais « Encoche » / « Notch ».

**Architecture :** le frontend du notch reste le paquet `apps/overlay`. Il est construit avec la base `/notch/` et copié dans `apps/desktop/dist/notch/`. En dev, le serveur Vite de Desktop relaie `/notch/` vers celui de l'overlay. Le shell Rust de l'overlay devient le module `notch.rs` du shell Desktop, et `apps/overlay/src-tauri` disparaît. L'installeur de Desktop désinstalle l'ancien « Ledge ».

**Tech Stack :** Tauri 2.6+ (Rust, plugins autostart, updater, process, single-instance, window-state, global-shortcut, notification), React 19, Vite 6, Vitest 4, Playwright, NSIS.

**Spec :** `docs/superpowers/specs/2026-10-18-single-app-notch-design.md`

## Global Constraints

- Cible : Windows. Le code `#[cfg(not(windows))]` existant reste compilable.
- Les noms internes ne changent pas : `island`, `island.set`, `~/.ledge/island.json`, `apps/overlay`, les clés i18n, les types. Seul le texte affiché change.
- Textes : FR « encoche » (féminin : « l'encoche », « Encoche active », « Encoche masquée »), EN « notch » (« Notch active », « Notch hidden »).
- Jamais `SetWindowRgn` sur la fenêtre du notch. Les clics traversent par `set_ignore_cursor_events`, comme aujourd'hui.
- Fenêtre `notch` : `transparent`, `decorations: false`, `alwaysOnTop`, `skipTaskbar`, `resizable: false`, `focus: false`, `shadow: false`, mêmes `additionalBrowserArgs` que l'overlay actuelle.
- Rust ne tourne pas dans WSL. `cargo test` et `pnpm tauri build` se lancent sur Windows, selon la recette du mémo (clone `C:\Users\Desan\Workspace\ledge`, `powershell.exe -NoProfile -Command`, build sans clé : `--config` avec `{"bundle":{"createUpdaterArtifacts":false}}`).
- Commits : messages en anglais, style du dépôt (`feat(desktop): …`), sans ajouter de ligne d'attribution.

## Review Focus

1. **Le démarrage avec `--minimized`.** Le notch doit apparaître alors que `main` reste cachée. Le test de la tâche 2 vérifie `hides_on_close("notch") == false`, mais la création de la fenêtre au démarrage se vérifie sur Windows (tâche 6, point 1).
2. **Ne pas déranger, basculé d'un côté.** Basculer depuis la zone de notification, le menu du notch ou Réglages se voit tout de suite dans l'autre fenêtre. Ce sont les tests `storage` des tâches 3 et 4.
3. **« Ouvrir dans Ledge » quand `main` est cachée ou réduite.** La fenêtre revient au premier plan et la cible s'affiche, sans nouveau processus. Le test Rust de la tâche 2 vérifie `open_in_ledge` sur une cible invalide, et la tâche 6, point 4, vérifie le chemin réel.
4. **L'ancienne installation présente** (`%LOCALAPPDATA%\Ledge\uninstall.exe`, overlay en marche, clé `Run` `Ledge`). Après l'installation, il ne reste qu'un notch et une seule entrée `Run`. Vérifié en tâche 6, point 6.
5. **Le focus.** Ouvrir le notch au clavier (Ctrl+Alt+L) ne doit pas laisser `main` au premier plan, et refermer rend le focus à la fenêtre d'avant. Taper dans `main` ne doit jamais ouvrir le notch. Vérifié en tâche 6, point 3.

---

### Task 1: La page du notch dans le build de Desktop

**Files:**
- Modify: `apps/overlay/vite.config.ts` (`base`)
- Modify: `apps/desktop/vite.config.ts` (proxy dev `/notch/`)
- Modify: `apps/desktop/package.json` (scripts `build`, `dev:all`)
- Create: `apps/desktop/scripts/copy-notch.mjs`
- Test: `apps/desktop/test/copyNotch.test.ts`

**Interfaces :**
- Produit : `apps/desktop/dist/notch/index.html`, dont les assets sont référencés sous `/notch/`. En dev, `http://localhost:1421/notch/` sert le notch. La tâche 2 charge l'URL `notch/index.html`.
- Produit : `export function copyNotch(from: string, to: string): void` (copie récursive : `to` est vidé puis rempli) dans `apps/desktop/scripts/copy-notch.mjs`, et une exécution en CLI quand le fichier est lancé directement (`node scripts/copy-notch.mjs`, chemins par défaut `../overlay/dist` → `dist/notch`).

- [ ] **Step 1 : écrire le test qui échoue**

`copyNotch` copie l'arborescence, et remplace une copie précédente au lieu de la fusionner. Avec `node:fs` et un dossier temporaire :

```ts
it('copies the notch build into dist/notch, replacing the previous one', () => {
  // from/index.html, from/assets/a.js ; to/stale.js already there
  copyNotch(from, to);
  expect(readFileSync(join(to, 'index.html'), 'utf8')).toBe('<html>notch</html>');
  expect(existsSync(join(to, 'assets', 'a.js'))).toBe(true);
  expect(existsSync(join(to, 'stale.js'))).toBe(false);
});
it('throws when the notch was not built', () => {
  expect(() => copyNotch(join(tmp, 'missing'), to)).toThrow(/overlay/);
});
```

- [ ] **Step 2 : lancer `pnpm --filter desktop test copyNotch`** : échec attendu, le module n'existe pas.

- [ ] **Step 3 : implémenter.**
  - `copy-notch.mjs` utilise `rmSync` et `cpSync({ recursive: true })`. Le message d'erreur nomme `apps/overlay/dist`.
  - Overlay : `base: process.env.LEDGE_NOTCH_BASE ?? '/'`, pour que ses tests unitaires et e2e (port 5199) ne changent pas.
  - Desktop : `server.proxy: { '/notch/': { target: 'http://localhost:1420', ws: true } }`.
  - Scripts de `apps/desktop/package.json` :
    - `"build": "tsc --noEmit && vite build && LEDGE_NOTCH_BASE=/notch/ pnpm --filter overlay build && node scripts/copy-notch.mjs"`. Pour Windows (pwsh en CI, PowerShell en local), l'env passe par `cross-env` ou par un petit `scripts/build-notch.mjs` qui lance `vite build` de l'overlay avec `{ env: { ...process.env, LEDGE_NOTCH_BASE: '/notch/' } }`. Préférer ce script node : aucune nouvelle dépendance.
    - `"dev:all": "pnpm --parallel --filter desktop --filter overlay run dev"`, l'overlay étant lancée avec `LEDGE_NOTCH_BASE=/notch/` par le même script node, mode `dev`.

- [ ] **Step 4 : vérifier.**
  - `pnpm --filter desktop test copyNotch` : PASS.
  - `pnpm --filter desktop build`, puis `ls apps/desktop/dist/notch/index.html`, puis `grep -o 'src="/notch/assets/[^"]*"' apps/desktop/dist/notch/index.html` : un résultat attendu.
  - `pnpm --filter overlay test` et `pnpm --filter overlay test:e2e` : toujours verts.

- [ ] **Step 5 : commit** — `feat(desktop): the build carries the notch's page under /notch/`

---

### Task 2: Le shell Desktop ouvre la fenêtre `notch`

**Files:**
- Create: `apps/desktop/src-tauri/src/notch.rs` (tout le natif propre au notch, repris de `apps/overlay/src-tauri/src/main.rs`)
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml` (`tauri-plugin-global-shortcut = "2"` ; `[target.'cfg(windows)'.dependencies] windows = { version = "0.58", features = [...] }` repris tel quel)
- Modify: `apps/desktop/src-tauri/tauri.conf.json` : deuxième fenêtre `{ "label": "notch", "url": "notch/index.html", "title": "Ledge", "width": 1, "height": 1, "x": 0, "y": 0, … }` (options : Global Constraints) ; `beforeDevCommand: "pnpm dev:all"`
- Create: `apps/desktop/src-tauri/capabilities/notch.json` (fenêtre `notch` ; permissions de l'actuel `apps/overlay/src-tauri/capabilities/default.json`, sans `updater:default` ni `process:allow-restart`, plus `process:allow-exit`)
- Test : `#[cfg(test)]` dans `notch.rs` (tests de l'overlay déplacés) et dans `main.rs`

**Interfaces :**
- Consomme : la page `notch/index.html` (tâche 1).
- Produit (commandes invoquées par la page du notch, même nom et mêmes arguments qu'aujourd'hui) : `set_frame`, `set_hot_zone`, `set_outside_watch`, `focus_overlay`, `release_focus`, `list_monitors`, `set_monitor`, `open_in_ledge { target: String }`. Restent partagées avec `main` : `focus_terminal`, `open_terminal`, `open_url`, `foreground_is_terminal`, `get_autostart`, `set_autostart`, `set_tray_labels`.
- Produit : `pub const NOTCH: &str = "notch";` ; `pub fn setup(app: &tauri::App) -> tauri::Result<()>` (always-on-top, ignore-cursor au départ, thread du poller) ; `fn hides_on_close(label: &str) -> bool` dans `main.rs`.
- Événements : `ledge://outside-click`, `ledge://cursor-near` et `ledge://foreground` sont émis avec `emit_to(NOTCH, …)`. `ledge://tray` et `ledge://open` sont émis avec `emit_to("main", …)`.

- [ ] **Step 1 : déplacer les tests.** Les tests Rust de l'overlay vont dans `notch.rs` (`choose`, `covers`, `cursor_near`, `desktop_class`, `frame_rect`, `inside_rect`, `poll_interval`, `press_outside`, `window_rect_of`). On supprime celui de `tray_title` de l'overlay. On ajoute dans `main.rs` :

```rust
#[test] fn only_the_main_window_hides_on_close() {
    assert!(hides_on_close("main"));
    assert!(!hides_on_close("notch"));
}
#[test] fn open_in_ledge_refuses_an_invalid_target() {
    assert!(!ledge_native::desktop::valid_target("not json"));
}
```

- [ ] **Step 2 : sur Windows, `cargo test -p ledge-desktop`.** Échec attendu : `notch` et `hides_on_close` n'existent pas.

- [ ] **Step 3 : implémenter.**
  - Dans `notch.rs`, le code de l'overlay change en trois points : `get_webview_window(NOTCH)` partout où il y avait `"main"` (`own_hwnd`, le poller) ; `emit_to(NOTCH, …)` ; plus de `build_tray`, d'autostart ni de `tray_title`.
  - Dans `main.rs` :
    - ajouter le plugin global-shortcut, `.manage()` de `OutsideWatch`, `PrevForeground` et `Screen`, et les commandes du notch dans `generate_handler!` ;
    - `notch::setup(app)` dans `setup`, avant le test `launched_minimized`, pour que le notch existe même en démarrage `--minimized` ;
    - window-state : `.with_denylist(&[notch::NOTCH])` ;
    - `on_window_event` : `prevent_close` et `hide` seulement si `hides_on_close(w.label())` ;
    - le menu `on_menu_event` émet `ledge://tray` vers `main` ;
    - `open_in_ledge` : `valid_target`, puis `show_main(&app)`, puis `deliver_open(&app, target)`. Une cible invalide renvoie `Err("invalid target")`.
  - `ledge_native::desktop::open` et `exe_path` ne sont plus appelés : les supprimer avec leurs tests si plus rien ne s'en sert.
  - Dans le `Cargo.toml` racine, retirer `apps/overlay/src-tauri` des `members` seulement à la tâche 5.

- [ ] **Step 4 : vérifier sur Windows.**
  - `cargo test -p ledge-desktop -p ledge-native` : PASS.
  - `pnpm tauri dev` dans `apps/desktop` : les deux fenêtres apparaissent, le notch réagit au survol et les clics à côté traversent.

- [ ] **Step 5 : commit** — `feat(desktop): the notch is a window of Ledge Desktop`

---

### Task 3: La page du notch dans l'app unique

**Files:**
- Modify: `apps/overlay/src/App.tsx`
- Modify: `apps/overlay/src/surface/Surface.tsx` (suppression de l'effet `onTrayAction`)
- Modify: `apps/overlay/src/tauri/bridge.ts` (listeners limités à la fenêtre ; `onTrayAction`, `setTrayLabels`, `getAutostart`, `setAutostart` supprimés s'ils ne servent plus)
- Modify: `apps/overlay/src/desktop/openInLedge.ts` (le résultat `'missing'` disparaît)
- Modify: `apps/overlay/src/i18n/lang.tsx` (`prefix: 'desktop'`)
- Modify: `apps/overlay/src/surface/SettingsView.tsx` (plus de choix de langue)
- Create: `apps/overlay/src/shared.ts`
- Test: `apps/overlay/test/shared.test.ts`, et les tests existants de `App` et `Surface` ajustés

**Interfaces :**
- Produit, dans `apps/overlay/src/shared.ts` (ce que le notch lit de Desktop) :
  - `export const DND_KEY = 'desktop.dnd'` et `export const UPDATE_KEY = 'desktop.update.available'` ;
  - `export function loadDnd(): boolean` et `export function loadDesktopUpdate(): string | null` ;
  - `export function onStorageKey(key: string, fn: (value: string | null) => void): () => void`, qui écoute l'événement `storage` de `window` sur cette clé seulement.
- Consomme : `open_in_ledge` (tâche 2), qui ne renvoie plus « not installed » ; `desktop.update.available` (tâche 4) ; `desktop.lang`, écrit par Desktop.
- Produit : la prop `desktopUpdate?: string | null` de `Surface` remplace `update?: UpdateController`. Non nulle, elle donne au Handle la pastille « nouvelle version » (le ton `PipTone` que `pipTone` rend aujourd'hui pour une mise à jour disponible) avec cette version. Le clic garde `openInLedge({ kind: 'update' })`. Les autres usages de `update` dans `Surface` (carte, `gearLabel`, `updateExtraH`) disparaissent ou valent leur état « rien à signaler ».

- [ ] **Step 1 : écrire les tests qui échouent.**

```ts
it('reads and follows Desktop’s do-not-disturb', () => {
  localStorage.setItem('desktop.dnd', '1');
  expect(loadDnd()).toBe(true);
  const seen: (string | null)[] = [];
  const off = onStorageKey(DND_KEY, v => seen.push(v));
  window.dispatchEvent(new StorageEvent('storage', { key: 'desktop.dnd', newValue: '0' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'ledge.theme', newValue: 'light' }));
  off();
  expect(seen).toEqual(['0']);
});
it('reads the update Desktop found', () => {
  expect(loadDesktopUpdate()).toBeNull();
  localStorage.setItem('desktop.update.available', '0.7.1');
  expect(loadDesktopUpdate()).toBe('0.7.1');
});
```

Dans le test de `App` :
- un `StorageEvent` sur `desktop.dnd` avec la valeur `'1'` met le notch en Ne pas déranger (même vérification que les tests DND existants) ;
- avec `desktop.lang` = `'en'` avant le rendu, le notch parle anglais. Un `StorageEvent` `desktop.lang` → `'fr'` le repasse en français ;
- avec `desktop.update.available` = `'0.7.1'`, le Handle montre la pastille ; un `StorageEvent` qui retire la clé (`newValue: null`) l'enlève ;
- aucun appel à `checkForUpdate`.

- [ ] **Step 2 : `pnpm --filter overlay test dnd App`.** Échec attendu.

- [ ] **Step 3 : implémenter.**
  - `App.tsx` :
    - `dnd` part de `loadDnd()`, écrit `DND_KEY` et suit `onStorageKey(DND_KEY, …)` ;
    - `lang` suit `onStorageKey('desktop.lang', …)` (la valeur passe par `LANGS`, toute autre est ignorée) ;
    - plus de `useUpdate` : `Surface` reçoit `desktopUpdate`, qui part de `loadDesktopUpdate()` et suit `onStorageKey(UPDATE_KEY, …)` ;
    - `SettingsView` : retirer le choix de langue ; `onLang` disparaît ;
    - plus de `setTrayLabels` ;
    - `autostart={null}`, ce qui masque l'interrupteur.
  - `Surface.tsx` : retirer l'effet `onTrayAction`. La zone de notification ne parle plus qu'à `main`.
  - `bridge.ts` : `onOutsideClick`, `onCursorProximity` et `onForegroundCovered` écoutent avec `getCurrentWebviewWindow().listen(...)` (`@tauri-apps/api/webviewWindow`), et non plus avec le `listen` global.
  - `quitApp` garde `exit(0)`, qui ferme désormais toute l'app.

- [ ] **Step 4 : vérifier.** `pnpm --filter overlay test`, `pnpm --filter overlay typecheck` et `pnpm --filter overlay test:e2e` : tous PASS.

- [ ] **Step 5 : commit** — `feat(overlay): the notch shares Desktop's do-not-disturb and leaves tray and updates to it`

---

### Task 4: Desktop suit Ne pas déranger et publie la mise à jour disponible

**Files:**
- Modify: `apps/desktop/src/notify/prefs.ts`
- Modify: `apps/desktop/src/update/store.ts`
- Test: `apps/desktop/test/` (les fichiers qui testent déjà `useDnd` et `createUpdater`)

**Interfaces :**
- Produit : le store `desktop.dnd` se met à jour sur un événement `storage` de `window` pour `DND_KEY`, et prévient ses abonnés.
- Produit : `export const UPDATE_AVAILABLE_KEY = 'desktop.update.available'`. Valeur : la version tant que la phase est `available` ou `installing`, clé absente sinon. La tâche 3 la lit.

- [ ] **Step 1 : tests qui échouent.**

```ts
it('follows a do-not-disturb switched in the notch', () => {
  resetDndForTests();
  window.dispatchEvent(new StorageEvent('storage', { key: 'desktop.dnd', newValue: '1' }));
  expect(getDnd()).toBe(true);
});
it('tells the notch which version is waiting', async () => {
  const u = createUpdater({ check: async () => ({ version: '0.7.1', notes: '' } as AvailableUpdate), version: async () => '0.7.0' });
  await u.check();
  expect(localStorage.getItem('desktop.update.available')).toBe('0.7.1');
  const v = createUpdater({ check: async () => null });
  await v.check();
  expect(localStorage.getItem('desktop.update.available')).toBeNull();
});
```

Ajuster le stub `AvailableUpdate` à ce que les tests existants de `createUpdater` utilisent déjà.

- [ ] **Step 2 : `pnpm --filter desktop test prefs update`.** Échec attendu.

- [ ] **Step 3 : implémenter.**
  - `prefs.ts` : un `addEventListener('storage', …)` au niveau du module, gardé par `typeof window !== 'undefined'`. Il remet `dnd = newValue === '1'` et appelle `emit()`.
  - `store.ts` : dans `put`, écrire ou retirer `UPDATE_AVAILABLE_KEY` selon la phase, avec le `set` local existant.

- [ ] **Step 4 : `pnpm --filter desktop test`.** PASS.

- [ ] **Step 5 : commit** — `feat(desktop): do not disturb follows the notch, and the notch learns of a waiting update`

---

### Task 5: « Encoche » / « Notch » à l'écran

**Files:**
- Modify: `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts`
- Modify: `apps/overlay/src/i18n/messages.ts`
- Test: `apps/desktop/test/i18nNotch.test.ts`, `apps/overlay/test/i18nNotch.test.ts` ; les tests qui citent l'ancien texte suivent

**Interfaces :** aucune nouvelle clé. Seules les valeurs changent.

- [ ] **Step 1 : tests qui échouent.** On parcourt récursivement toutes les valeurs des messages, en appelant les fonctions avec des arguments factices (`'x'`, `1`) :

```ts
const words = (lang: 'fr' | 'en') => allStrings(messages[lang]).join('\n');
it('never says island any more', () => {
  expect(words('fr')).not.toMatch(/\bîles?\b|l’île|l'île/i);
  expect(words('en')).not.toMatch(/\bislands?\b/i);
});
it('names the notch in each language', () => {
  expect(words('fr')).toMatch(/encoche/i);
  expect(words('en')).toMatch(/notch/i);
});
```

Les menus Quitter et Ouvrir de la zone de notification gardent « Ledge Desktop ». Le libellé Quitter du menu du notch devient « Quitter Ledge » / « Quit Ledge » : il l'est déjà, on n'y touche pas.

- [ ] **Step 2 : `pnpm --filter desktop test i18nNotch` et `pnpm --filter overlay test i18nNotch`.** Échec attendu.

- [ ] **Step 3 : remplacer chaque mention dans les valeurs.** Exemples :
  - `foot.islandOn` : FR « Encoche active », EN « Notch active » ;
  - `sections.island` : FR « Encoche », EN « Notch » ;
  - « Taille de l'île » devient « Taille de l'encoche » ;
  - « Les demandes attendent dans l'île » devient « … dans l'encoche » ;
  - `finishedNone` : FR « Encoche seule », EN « Notch only ».

  Accords au féminin, comme pour « île ». Les libellés ARIA aussi.

- [ ] **Step 4 : `pnpm test` à la racine.** PASS. Les tests qui citent les anciens textes sont mis à jour, jamais supprimés.

- [ ] **Step 5 : commit** — `feat: the island is called the notch, « encoche » in French`

---

### Task 6: Un seul installeur, l'ancien Ledge retiré

**Files:**
- Modify: `apps/desktop/src-tauri/windows/hooks.nsh` (ajouter `NSIS_HOOK_PREINSTALL`)
- Delete: `apps/overlay/src-tauri/` (tout)
- Modify: `Cargo.toml` racine (retirer `apps/overlay/src-tauri` des `members`) et `Cargo.lock`
- Modify: `apps/overlay/package.json` (retirer le script `tauri`, `@tauri-apps/cli` et `@tauri-apps/plugin-updater`, sauf si d'autres sources de l'overlay importent encore ce dernier ; dans ce cas, supprimer `src/update` et ses tests)
- Modify: `scripts/set-version.mjs` (retirer les trois entrées `apps/overlay/src-tauri` et `ledge-overlay`) et son test s'il existe
- Modify: `.github/workflows/release.yml` (plus de build, de `latest.json` ni d'asset pour l'overlay ; le bloc Install ne parle que de Ledge Desktop)
- Modify: `README.md` (installation : un seul installeur)

**Interfaces :** aucune.

- [ ] **Step 1 : écrire le hook.**

```nsis
; Ledge Desktop now carries the notch: the old « Ledge » app is stopped and uninstalled first, so a single notch
; and a single launch-at-login entry remain. Its own uninstaller removes its Run entry.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$LOCALAPPDATA\Ledge\uninstall.exe" 0 +3
    nsExec::Exec 'taskkill /F /IM ledge-overlay.exe'
    ExecWait '"$LOCALAPPDATA\Ledge\uninstall.exe" /S _?=$LOCALAPPDATA\Ledge'
!macroend
```

Après `ExecWait`, supprimer aussi `$LOCALAPPDATA\Ledge\uninstall.exe` et le dossier : avec `_?=`, l'uninstaller ne s'efface pas lui-même.

- [ ] **Step 2 : supprimer et mettre à jour les fichiers listés.** `rg -n "apps/overlay/src-tauri|ledge-overlay|latest\.json\b" --glob '!docs/**'` ne doit plus rien trouver, à part `taskkill` dans le hook.

- [ ] **Step 3 : vérifier dans WSL.** `pnpm test`, `pnpm typecheck` et `pnpm --filter desktop build` : tous PASS.

- [ ] **Step 4 : vérifier sur Windows**, après synchronisation du clone :
  - `cargo test --workspace` : PASS ;
  - `pnpm tauri build --config nosign.json` dans `apps/desktop` produit `target\release\bundle\nsis\Ledge Desktop_<ver>_x64-setup.exe` ;
  - l'installer en silencieux (`/S`) par-dessus l'installation actuelle, ancien Ledge compris, puis vérifier dans l'ordre :
    1. après une fermeture de session ou avec `ledge-desktop.exe --minimized` : le notch apparaît, et pas la fenêtre ;
    2. `Get-Process ledge-overlay` ne renvoie rien. La zone de notification n'a qu'une icône Ledge. La clé `Run` n'a plus `Ledge`, seulement `Ledge Desktop`. `%LOCALAPPDATA%\Ledge` n'existe plus ;
    3. survol, clics qui traversent, Ctrl+Alt+L puis Échap (le focus revient), une fenêtre maximisée donne la bande discrète, pas de fond blanc, absent de la barre des tâches et d'Alt+Tab ;
    4. « Ouvrir dans Ledge » (session, Réglages), avec `main` cachée puis réduite : la fenêtre revient, sur la bonne vue ;
    5. Ne pas déranger, basculé depuis la zone de notification, puis depuis le menu du notch : les deux fenêtres le reflètent ;
    6. fermer `main` laisse le notch. Quitter, depuis la zone de notification puis depuis le menu du notch, ne laisse aucun `ledge-desktop` dans `Get-Process` ;
    7. changer la langue dans Réglages fait passer le notch d'« Encoche » à « Notch » sans redémarrage.

- [ ] **Step 5 : commit** — `feat: one installer, Ledge Desktop, which retires the old Ledge`

La release (tag `v0.7.0`) est une étape séparée : elle se fait seulement sur demande de l'utilisateur.
