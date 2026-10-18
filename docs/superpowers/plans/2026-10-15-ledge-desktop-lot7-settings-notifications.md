# Ledge Desktop, lot 7 : paramètres et notifications — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un écran « Paramètres » (bouton ⚙ visible dans la tête, et « Paramètres des machines » depuis la notice hors ligne) avec ses cinq sections de la maquette — Affichage (démarrage Windows, harnais par défaut écrit dans `desktop.tool`, langue appliquée à chaud, échelle, thème, accent, mouvements réduits), Machines (liste du daemon, ajout avec test, modification, reconnexion, retrait confirmé, aide SSH), Notifications (Ne pas déranger, mode d'alerte de fin de tâche), Sons (désactivés par défaut sur Desktop), À propos (versions, mises à jour **avec consentement**, mise à jour du daemon local et son journal) — plus les toasts Windows et les sons tirés des changements de sessions, Ne pas déranger depuis le tray sans afficher la fenêtre, et un tray traduit dans la langue de l'app.

**Architecture:** Les préférences sont des petits stores externes (`useSyncExternalStore`) lus partout : sons et mode de fin de tâche par `createSoundPrefs` de `@ledge/ui` (étendu par options, l'île inchangée), Ne pas déranger (`desktop.dnd`), thème et accent (`shell/theme.ts`), échelle (zoom WebView). Les règles sans DOM sont pures et testées seules : changements de sessions → toasts (`notify/alerts.ts`), décision de son (`decideSound`, déplacé de l'île vers `@ledge/ui`), validation des machines (`settings/machines.ts`), offre de mise à jour du daemon. Les machines passent par le fleet (`configure` → `machines.set`, appliqué seulement au retour de la diffusion `machines`, spec §5.3), les mises à jour par un store `update/store.ts` qui **vérifie** seul et n'installe qu'au clic. L'écran Paramètres remplace la tête et les sessions comme l'écran de lancement du lot 5 : la vue, le filtre, le regroupement et la sélection restent dans le `Shell` et sont retrouvés au retour.

**Tech Stack:** TypeScript, React 19, Vite 6, Tauri 2.6 (Rust, `tauri-plugin-notification`, autostart, updater, process), vitest 3 + Testing Library + jsdom, Playwright 1.49, pnpm workspaces, `cargo-xwin` pour la cible Windows depuis WSL.

**Spec:** `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` (**§9.4 en entier**, **§10 en entier**, §4.4 dossiers `settings/` et `notify/` et menu du tray, §5.3 liste des machines tenue par le daemon, §6 compteurs des machines, `local` non supprimable, Reconnecter = `retry`, lecture seule quand le daemon local est injoignable, §7 clés `desktop.theme`, `desktop.lang`, `desktop.accent`, `desktop.panelScale`, `desktop.reducedMotion`, `desktop.tool`, `desktop.sounds`, `desktop.notify`, `desktop.dnd`, `desktop.update.*`, §11 updater `latest-desktop.json` et `update.daemon` au daemon local seulement, §12 vitest « conservation au retour des paramètres » et Playwright « l'ajout d'une machine et sa réapparition dans la liste », §13 lot 7). Plans précédents (contrat d'interfaces) : lot 5 `docs/superpowers/plans/2026-10-15-ledge-desktop-lot5-new-session.md`, lot 6 `2026-10-15-ledge-desktop-lot6-talk-to-ledge.md`. Maquette (lecture seule, hors dépôt) : `../ledge-desktop/mockup/assets/settings.js`, `settings.css`, `app.js` (bouton `[data-open-settings]`), `../ledge-desktop/HANDOFF.md`. Références de comportement (inchangées) : l'île, `apps/overlay/src/sounds/useSounds.ts`, `apps/overlay/src/update/machine.ts`, `apps/overlay/src/i18n/*.ts` (textes `problem.*` et échecs de mise à jour du daemon).

## Global Constraints

- Prérequis : lots 1 à 6 terminés. Branche `desktop/lot7-settings-notifications`, empilée sur le lot 6 : `git checkout desktop/lot6-talk-to-ledge && git checkout -b desktop/lot7-settings-notifications`.
- **Fichiers des lots 5 et 6.** Ce plan décrit `App.tsx`, `Heading.tsx`, `OfflineNotice.tsx`, `messages.ts`, `app.css`, `e2e/daemon.ts` et `test/app-tray.test.tsx` dans l'état prévu par les plans des lots 5 et 6 (`useLaunch`, `LaunchScreen`, `launching`, `canLaunch` = `!localDown && chat.card === null`, `openLaunch`, `opener`, `replyFor`, `pick`, `trayNew`, `wasLaunching`, `notices` ou `offline` pour les notices, `useChat`, `chatOpen`, `chatEntry`, `ChatPane`, `Heading` avec `onNewSession` et `chat`, `fakeDaemon(page, initial, { machines, launcher, recents })`, `fakeRemote(page, alias, initial)` avec `received`, `push`, `close`, `reopen`). **Lire le fichier réel avant de le modifier et appliquer le changement à son état réel ; si un nom diffère, garder celui du dépôt.**
- Portes de chaque tâche : `pnpm -r typecheck` et `pnpm --filter desktop test` ; en plus, à partir de la tâche 9, `pnpm --filter desktop exec playwright test` (port **5299** ; toute erreur console ou `pageerror` fait échouer la spec via `e2e/fixtures.ts`). La tâche 1 touche `@ledge/ui` et l'île : portes `pnpm --filter @ledge/ui test` et `pnpm --filter overlay test` en plus.
- **Portes Rust** (tâche 3, seule tâche qui touche `src-tauri`) : WSL n'a pas `webkit2gtk`, donc `cargo test -p ledge-desktop` natif ne compile pas ; on vise Windows avec `cargo-xwin`, depuis la racine du dépôt :
  `https_proxy=http://192.168.40.2:3128 ~/.cargo/bin/cargo xwin check -p ledge-desktop --target x86_64-pc-windows-msvc`
  puis `https_proxy=http://192.168.40.2:3128 ~/.cargo/bin/cargo xwin test -p ledge-desktop --target x86_64-pc-windows-msvc` (WSL lance le `.exe` de test par l'interop Windows ; si l'exécution échoue pour une raison d'environnement et non de test, utiliser `--no-run` et laisser `cargo test --workspace` de la CI Windows du lot 3 exécuter les tests). Si `tauri::generate_context!` réclame `apps/desktop/dist`, lancer d'abord `pnpm --filter desktop build`. Le proxy sert au téléchargement de `tauri-plugin-notification` (absent du cache).
- **L'île (`apps/overlay`) ne change pas de comportement.** Seuls changements : `apps/overlay/src/sounds/decide.ts` et `apps/overlay/src/update/semver.ts` deviennent des réexports d'une ligne (`export * from '@ledge/ui/…'`) ; ses tests ne changent pas et doivent passer. `createSoundPrefs('ledge')` sans options garde exactement les clés et défauts de l'île.
- Clés (spec §7) : `desktop.tool` (JSON, `"claude"`), `desktop.sounds` (JSON `SoundPrefs`), `desktop.notify` (`both` | `bubble` | `sound` | `none`), `desktop.dnd` (`'1'` / `'0'`, comme `ledge.dnd`), `desktop.theme`, `desktop.accent`, `desktop.lang`, `desktop.panelScale`, `desktop.reducedMotion`, `desktop.update.auto` (`'0'` = coupé), `desktop.update.checkedAt` (ms), `desktop.update.from`. Le démarrage Windows n'est pas stocké (plugin autostart). `desktop.handleScale` et `desktop.update.dismissed` ne sont pas utilisés (pas de poignée, pas de carte de mise à jour sur Desktop) ; `desktop.update.attempted` (lot 3) est supprimé au démarrage.
- **Défauts Desktop (spec §10) : toasts activés, sons désactivés.** Le mode de fin de tâche par défaut est `both` (toast et son) ; comme les sons sont coupés, seul le toast part tant que l'utilisateur n'active pas les sons.
- **Machines (spec §5.3)** : Desktop n'écrit jamais la liste localement quand elle vient du daemon : `fleet.configure(next)` envoie `machines.set`, et le formulaire reste ouvert (« Enregistrement… ») jusqu'à ce que la diffusion `machines` ait atteint la liste du fleet ; daemon local fermé (`DaemonOffline`), `error` sans id du daemon local, ou 10 s sans réponse → message, rien d'appliqué. `local` est toujours premier et sans action. Au plus 20 machines (`MachinesSchema`).
- **Mises à jour (spec §9.4, §11)** : au démarrage puis toutes les 6 heures, Desktop **vérifie seulement** ; il n'installe qu'au clic sur « Mettre à jour l'application ». « Mettre à jour le daemon » envoie `update.daemon { version }` au daemon **local** seulement (`fleet.sendTo('local', …)`).
- Hors Tauri (navigateur, vitest, Playwright), chaque appel natif est un no-op qui ne lève pas et n'écrit rien en console : toasts, zoom WebView, libellés du tray, autostart (`null`), terminal au premier plan (`false`), version (`null`).
- L'app remplit la fenêtre : l'écran Paramètres défile **dans** `.settings-panel` ; `document.documentElement.scrollHeight` reste égal à la hauteur de la fenêtre (vérifié par la tâche 10).
- Textes en français et en anglais dans `src/i18n/messages.ts` (`fr` source de vérité, `en: typeof fr`) ; Desktop vouvoie. Les tests vitest tournent en anglais (`test/setup.ts`), Playwright aussi (`e2e/fixtures.ts`).
- Commits : `feat(desktop): …`, `test(desktop): …`, `refactor(ui): …`, `feat(ui): …`, `fix(desktop): …`, en anglais.

## Décisions sur les points ouverts de la spec

1. **Mises à jour avec consentement** (L3-R8) : la vérification automatique (au démarrage puis toutes les 6 h, coupable dans À propos) ne télécharge rien ; l'installation se fait seulement au clic « Mettre à jour l'application » (téléchargement avec pourcentage, `desktop.update.from`, relance). Le bouton ⚙ porte une pastille quand une version est disponible. `startup.ts` (installation silencieuse du lot 3) est remplacé par `update/store.ts`.
2. **Mise à jour du daemon** : offerte seulement pour le daemon local installé par npm et en retard sur la cible (la dernière version Desktop disponible, sinon la version de Desktop) ; un daemon git ou inconnu affiche sa commande manuelle (`DaemonInfo.manual`). Le journal suit `update.progress` / `update.failed` du daemon local et passe à « Daemon à jour » quand le daemon local revient avec la version visée. Pas de contrôle « sessions perdues » de l'île (le daemon refuse déjà avec `sessions-at-risk`).
3. **Sons désactivés sur Desktop sans toucher l'île** : `createSoundPrefs(prefix, { finishedKey?, enabled? })` (additif) ; Desktop = `createSoundPrefs('desktop', { finishedKey: 'desktop.notify', enabled: false })`. Le mode de fin de tâche reprend les valeurs de l'île (`both`, `bubble` = « Alerte visuelle », `sound`, `none`).
4. **Règle de son partagée** : `decideSound` passe de l'île à `@ledge/ui/sounds/decide` (réexport côté île) ; Desktop applique les mêmes coupures (sons coupés, Ne pas déranger, mode de fin, catégorie, terminal au premier plan, arrivée au snapshot, une fois par 1,5 s).
5. **Toasts (spec §10)** : seulement quand Desktop n'a pas le focus (fenêtre derrière ou cachée dans le tray), jamais en Ne pas déranger ; une demande (`waiting_permission` / `waiting_input`) en fait toujours un ; une fin ou un échec seulement si le mode vaut `both` ou `bubble`. Les sessions déjà là à l'ouverture, celles d'une machine qui se connecte pour la première fois et celles d'une machine hors ligne (figées) n'en font aucun ; plusieurs dans la même mise à jour = **un seul** toast groupé. Le clic sur le toast n'est pas géré (spec : non fiable).
6. **Ne pas déranger** : `desktop.dnd`, store partagé ; interrupteur dans Notifications, entrée du tray qui bascule **sans afficher la fenêtre** (`tray_shows_window` en Rust) et dont le libellé devient « Réactiver les alertes » quand il est actif (pas de case à cocher native). Il coupe toasts et sons, jamais l'affichage des demandes.
7. **Tray traduit** : la commande Rust `set_tray_labels` (déjà présente, jamais appelée) est appelée par le front à chaque changement de langue ou de Ne pas déranger ; le menu reste construit en français jusqu'au premier appel.
8. **Langue, thème, accent à chaud** : la langue est un état de `App` (`saveLang`, `document.documentElement.lang`), le thème et l'accent un store (`setTheme`, `setAccent`) que lisent toutes les mascottes ; « Corail » remet `desktop.accent` à zéro.
9. **Échelle** : un seul réglage « Échelle de l'interface » dans `desktop.panelScale` (Auto, 100 % à 200 %), appliqué par `getCurrentWebview().setZoom` (spec « zoom WebView ») ; Auto suit la hauteur logique de l'écran comme les fenêtres de l'île (base 2160 px).
10. **Démarrage Windows** : interrupteur branché sur `get_autostart` / `set_autostart` ; quand ils répondent `null` (build de dev, navigateur), l'interrupteur est désactivé avec « Disponible dans l'application installée. ».
11. **Machines** : ajout et modification par le formulaire de la maquette (nom ≤ 80, alias `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`, alias unique), id `remote-<aléatoire>` sans `crypto.randomUUID` ; le test (`fleet.probe`) est facultatif, un à la fois, et explique l'échec par `sshProblem` (textes de l'île, vouvoyés) ; « Réessayer » (machine déconnectée) = `fleet.retry(id)` ; retrait confirmé dans un `role="alert"` ; tout est désactivé quand le daemon local est injoignable (spec §6).
12. **Écran Paramètres** : remplace la tête et les sessions comme l'écran de lancement ; la vue, le filtre, le regroupement, la sélection et le panneau sont gardés dans le `Shell` ; « ← Retour aux sessions » rend le focus au bouton qui l'a ouvert ; « Nouvelle session » depuis le tray ferme les Paramètres. La section est un état de session (pas de clé stockée).
13. **Mascotte de la tête** : le bouton `#theme` de la maquette n'est pas repris (le thème vit dans Affichage).
14. **Catégorie « Vous acceptez ou refusez »** : le `Shell` enveloppe `decide` de `useConversations` pour jouer `accept` / `deny` (règle de l'île : ces sons ne vérifient pas le terminal).
15. **Test du son** : joue le signal de question au volume choisi ; en Ne pas déranger il ne joue pas et affiche « Ne pas déranger est activé. » ; désactivé avec tout le bloc quand les sons sont coupés.
16. **Lecture seule** : l'écran Paramètres reste ouvrable quand le daemon local est injoignable (préférences locales utilisables), la section Machines y est figée et la notice du daemon local s'affiche en `role="status"` au-dessus des sections.

## Review Focus

1. **Rafale ou ouverture** : à l'ouverture (snapshot initial avec des sessions déjà en attente), à la première connexion d'une machine distante, au retour d'une machine hors ligne, ou quand cinq sessions demandent en même temps, l'utilisateur ne reçoit ni pluie de toasts ni sons empilés : rien pour l'existant, un seul toast groupé pour une rafale. Tests ajoutés à la tâche 4.
2. **Enregistrement d'une machine sans issue** : daemon local fermé au clic, `error` du daemon local, ou daemon muet : le formulaire reste ouvert avec ses valeurs et un message, rien n'est appliqué localement, le bouton ne reste jamais « Enregistrement… » ; une `error` **avec** id (réponse à un agent) ne compte pas ; un double clic n'envoie qu'un `machines.set`. Tests ajoutés à la tâche 6.
3. **Saisie fautive** : alias avec espace, commençant par `-`, de plus de 64 caractères, nom vide ou fait d'espaces, alias déjà utilisé par une autre machine (mais pas par celle qu'on modifie) : message clair, aucun `machines.set`. Tests ajoutés à la tâche 6.
4. **Ne pas déranger depuis le tray, fenêtre cachée** : la fenêtre ne s'affiche pas, toasts et sons sont coupés, le libellé du tray change, et l'interrupteur de Notifications montre l'état réel à l'ouverture suivante. Tests ajoutés aux tâches 3 (Rust) et 9.
5. **Mise à jour** : double clic sur « Mettre à jour l'application », vérification demandée pendant une installation, réseau absent : un seul téléchargement, l'erreur affichée, et **rien n'est installé sans clic** (ni au démarrage ni à la vérification des 6 heures). Tests ajoutés à la tâche 5.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/ui/src/sounds/preferences.ts` (modifier) | Options `finishedKey`, `enabled` de `createSoundPrefs` |
| `packages/ui/src/sounds/decide.ts` (déplacé de l'île) | `decideSound`, partagé |
| `packages/ui/src/semver.ts` (déplacé de l'île) | `compareVersions`, partagé |
| `apps/overlay/src/sounds/decide.ts`, `apps/overlay/src/update/semver.ts` (remplacer) | Réexports d'une ligne |
| `packages/ui/test/sound-prefs-options.test.ts`, `shared-rules.test.ts` | vitest `@ledge/ui` |
| `apps/desktop/src/notify/prefs.ts` | Sons et mode de fin (`desktop.sounds`, `desktop.notify`), Ne pas déranger (`desktop.dnd`) |
| `apps/desktop/src/shell/theme.ts` (modifier) | Store du thème et de l'accent, `useAppearance` |
| `apps/desktop/src/launch/form.ts` (modifier) | `saveTool` |
| `apps/desktop/src/settings/scale.ts` | Échelle (`desktop.panelScale`) par zoom WebView |
| `apps/desktop/src-tauri/Cargo.toml`, `src/main.rs`, `capabilities/default.json` (modifier) | Plugin de notification, DND du tray sans fenêtre, permissions |
| `apps/desktop/package.json` (modifier) | `@tauri-apps/plugin-notification` |
| `apps/desktop/src/tauri/bridge.ts` (modifier) | `foregroundIsTerminal`, `setTrayLabels`, `showToast` |
| `apps/desktop/src/notify/alerts.ts` | Pur : changements de sessions, signal, toast |
| `apps/desktop/src/notify/player.ts` | Le lecteur Web Audio de l'app |
| `apps/desktop/src/notify/useAlerts.ts` | Hook : toasts et sons, test du son, sons de décision |
| `apps/desktop/src/update/store.ts` | Vérification, installation au clic, `desktop.update.*` |
| `apps/desktop/src/update/daemon.ts` | Offre et suivi de la mise à jour du daemon local |
| `apps/desktop/src/update/startup.ts`, `test/update-startup.test.ts` (supprimer) | Installation silencieuse du lot 3 |
| `apps/desktop/src/settings/machines.ts` | Pur : validation, id, liste suivante |
| `apps/desktop/src/settings/useMachineEditor.ts` | Hook : enregistrement attendu, test de connexion |
| `apps/desktop/src/settings/MachinesPanel.tsx` | Section Machines |
| `apps/desktop/src/settings/controls.tsx` | `Toggle`, `SelectRow` |
| `apps/desktop/src/settings/AboutPanel.tsx` | Section À propos |
| `apps/desktop/src/settings/DisplayPanel.tsx`, `NotificationsPanel.tsx`, `SoundsPanel.tsx` | Sections Affichage, Notifications, Sons |
| `apps/desktop/src/settings/SettingsScreen.tsx` | L'écran : tête, navigation, section |
| `apps/desktop/src/shell/Heading.tsx`, `OfflineNotice.tsx` (modifier) | Bouton ⚙ et pastille, « Paramètres des machines » |
| `apps/desktop/src/App.tsx` (modifier) | Langue à chaud, Paramètres, alertes, tray, mises à jour |
| `apps/desktop/src/main.tsx` (modifier) | `updater.start()`, échelle au démarrage |
| `apps/desktop/src/i18n/messages.ts` (modifier) | Blocs `notify`, `settings`, `tray`, `offline.settings` |
| `apps/desktop/src/styles/app.css` (modifier) | Port de `settings.css`, bouton ⚙ |
| `apps/desktop/test/desktop-prefs.test.tsx`, `bridge.test.ts`, `alerts.test.ts`, `use-alerts.test.tsx`, `update-store.test.ts`, `daemon-update.test.tsx`, `settings-helpers.ts`, `machines-panel.test.tsx`, `about-panel.test.tsx`, `settings-screen.test.tsx`, `app-settings.test.tsx` | vitest |
| `apps/desktop/test/tauri-config.test.ts`, `app-tray.test.tsx` (modifier) | Config native, tray |
| `apps/desktop/e2e/daemon.ts` (modifier) | `fakeDaemon` répond à `machines.set` comme le daemon |
| `apps/desktop/e2e/settings.spec.ts` | Playwright : ajout d'une machine et réapparition, notice hors ligne, mise en page |

---

### Task 1: `@ledge/ui` — préférences de sons par options, règle de son et versions partagées

**Files:**
- Modify: `packages/ui/src/sounds/preferences.ts` (`createSoundPrefs`)
- Move: `apps/overlay/src/sounds/decide.ts` → `packages/ui/src/sounds/decide.ts` ; `apps/overlay/src/update/semver.ts` → `packages/ui/src/semver.ts`
- Create (réexports) : `apps/overlay/src/sounds/decide.ts`, `apps/overlay/src/update/semver.ts`
- Test: `packages/ui/test/sound-prefs-options.test.ts`, `packages/ui/test/shared-rules.test.ts`

**Interfaces:**
- Consumes: `createSoundPrefs`, `DEFAULT_SOUNDS`, `VOLUME_GAIN`, `FinishedNotify`, `SoundPrefs` (`@ledge/ui/sounds/preferences`) ; `CATEGORY_OF`, `USER_CUES`, `Cue` (`@ledge/ui/sounds/cues`).
- Produces:
  - `interface SoundPrefsOptions { finishedKey?: string; enabled?: boolean }` ; `createSoundPrefs(prefix: string, opts?: SoundPrefsOptions)` — même retour qu'avant (`loadFinished`, `loadSounds`, `setFinished`, `setSounds`, `resetSoundPrefsForTests`, `useSoundPrefs`) ;
  - `@ledge/ui/sounds/decide` : `decideSound(i: SoundInput): SoundDecision`, `SOUND_RATE_MS`, `SNAPSHOT_QUIET_MS`, `SoundInput`, `SoundDecision` (code de l'île inchangé) ;
  - `@ledge/ui/semver` : `compareVersions(a: string, b: string): -1 | 0 | 1` (code de l'île inchangé).

- [ ] **Step 1: Write the failing test**

`packages/ui/test/sound-prefs-options.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createSoundPrefs, DEFAULT_SOUNDS } from '../src/sounds/preferences';

beforeEach(() => localStorage.clear());

describe('createSoundPrefs options', () => {
  it('keeps the island keys and defaults without options', () => {
    const p = createSoundPrefs('ledge');
    expect(p.loadSounds()).toEqual(DEFAULT_SOUNDS);
    expect(p.loadFinished()).toBe('both');
    p.setFinished('sound');
    expect(localStorage.getItem('ledge.finished')).toBe('sound');
  });

  it('keeps the finish mode under its own key and starts with sounds off', () => {
    const p = createSoundPrefs('desktop', { finishedKey: 'desktop.notify', enabled: false });
    expect(p.loadSounds()).toEqual({ ...DEFAULT_SOUNDS, enabled: false });
    p.setFinished('bubble');
    expect(localStorage.getItem('desktop.notify')).toBe('bubble');
    expect(localStorage.getItem('desktop.finished')).toBeNull();
    p.setSounds({ enabled: true });
    expect(JSON.parse(localStorage.getItem('desktop.sounds')!).enabled).toBe(true);
    expect(createSoundPrefs('desktop', { finishedKey: 'desktop.notify', enabled: false }).loadSounds().enabled).toBe(true);
  });

  it('defaults a partial or broken record with the instance defaults', () => {
    localStorage.setItem('desktop.sounds', JSON.stringify({ volume: 'loud' }));
    expect(createSoundPrefs('desktop', { enabled: false }).loadSounds()).toMatchObject({ enabled: false, volume: 'loud' });
    localStorage.setItem('desktop.sounds', '{oops');
    expect(createSoundPrefs('desktop', { enabled: false }).loadSounds().enabled).toBe(false);
  });
});
```

`packages/ui/test/shared-rules.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { decideSound, SOUND_RATE_MS, type SoundInput } from '../src/sounds/decide';
import { DEFAULT_SOUNDS } from '../src/sounds/preferences';
import { compareVersions } from '../src/semver';

const base: SoundInput = { cue: 'question', sounds: DEFAULT_SOUNDS, finished: 'both', dnd: false, terminalInFront: false, lastPlayedAt: null, connectedAt: null, now: 10_000 };

describe('decideSound, shared by both fronts', () => {
  it('plays at the chosen volume', () => {
    expect(decideSound(base)).toEqual({ play: true, gain: 1 });
    expect(decideSound({ ...base, sounds: { ...DEFAULT_SOUNDS, volume: 'quiet' } })).toEqual({ play: true, gain: 0.5 });
  });
  it('sounds off and Do not disturb cut everything, the user ticks too', () => {
    expect(decideSound({ ...base, sounds: { ...DEFAULT_SOUNDS, enabled: false } })).toEqual({ play: false, why: 'off' });
    expect(decideSound({ ...base, cue: 'accept', dnd: true })).toEqual({ play: false, why: 'dnd' });
  });
  it('one cue per window, the user ticks excepted', () => {
    expect(decideSound({ ...base, lastPlayedAt: base.now - SOUND_RATE_MS + 1 })).toEqual({ play: false, why: 'rate' });
    expect(decideSound({ ...base, cue: 'deny', lastPlayedAt: base.now - 1 })).toMatchObject({ play: true });
  });
  it('a finish follows the finish mode', () => {
    expect(decideSound({ ...base, cue: 'finished', finished: 'bubble' })).toEqual({ play: false, why: 'finished-setting' });
    expect(decideSound({ ...base, cue: 'finished', finished: 'sound' })).toMatchObject({ play: true });
  });
});

describe('compareVersions', () => {
  it('orders releases and puts a pre-release first', () => {
    expect(compareVersions('0.5.0', '0.4.9')).toBe(1);
    expect(compareVersions('0.4.9', '0.5.0')).toBe(-1);
    expect(compareVersions('0.5.0', '0.5.0')).toBe(0);
    expect(compareVersions('0.5.0-dev', '0.5.0')).toBe(-1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @ledge/ui test -- sound-prefs-options shared-rules`
Expected: FAIL — `Failed to resolve import "../src/sounds/decide"` et, dans `sound-prefs-options`, `enabled` vaut `true` (l'option est ignorée) et `desktop.notify` reste `null`.

- [ ] **Step 3: Implement**

**3a.** `packages/ui/src/sounds/preferences.ts` — ajouter l'interface au-dessus de la fonction, changer la signature et les deux premières constantes, puis faire lire `DEFAULTS` à `loadSounds` (toutes les occurrences de `DEFAULT_SOUNDS` **dans `loadSounds`**, aucune ailleurs) :

```ts
/** Desktop keeps its finish mode under `desktop.notify` and starts with sounds off (spec 2026-10-14 §7, §10). */
export interface SoundPrefsOptions { finishedKey?: string; enabled?: boolean }

/** One preference store per key prefix; state and subscribers are per instance. Without options: the island's keys and defaults. */
export function createSoundPrefs(prefix: string, opts: SoundPrefsOptions = {}) {
  const FINISHED_KEY = opts.finishedKey ?? `${prefix}.finished`;
  const SOUNDS_KEY = `${prefix}.sounds`;
  const DEFAULTS: SoundPrefs = { ...DEFAULT_SOUNDS, enabled: opts.enabled ?? DEFAULT_SOUNDS.enabled };

  function loadFinished(): FinishedNotify {
    try { const v = localStorage.getItem(FINISHED_KEY); return (FINISHED_VALUES as readonly string[]).includes(v ?? '') ? (v as FinishedNotify) : 'both'; } catch { return 'both'; }
  }
  /** Each field is validated on its own, so a partial or outdated record keeps what it can and defaults the rest. */
  function loadSounds(): SoundPrefs {
    try {
      const raw = localStorage.getItem(SOUNDS_KEY); if (!raw) return DEFAULTS;
      const v = JSON.parse(raw) as Partial<SoundPrefs> | null; if (!v || typeof v !== 'object') return DEFAULTS;
      const categories = { ...DEFAULTS.categories };
      for (const c of CATEGORIES) if (typeof v.categories?.[c] === 'boolean') categories[c] = v.categories[c]!;
      return {
        enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULTS.enabled,
        volume: (VOLUMES as readonly string[]).includes(v.volume ?? '') ? (v.volume as SoundVolume) : DEFAULTS.volume,
        categories,
        onlyWhenTerminalBehind: typeof v.onlyWhenTerminalBehind === 'boolean' ? v.onlyWhenTerminalBehind : DEFAULTS.onlyWhenTerminalBehind
      };
    } catch { return DEFAULTS; }
  }
```

Le reste de la fonction (`finished`, `sounds`, `setFinished`, `setSounds`, `resetSoundPrefsForTests`, `useSoundPrefs`, le `return`) ne change pas.

**3b.** Déplacer les deux fichiers (leurs imports `./cues` et `./preferences` existent dans `packages/ui/src/sounds/`) :

```bash
git mv apps/overlay/src/sounds/decide.ts packages/ui/src/sounds/decide.ts
git mv apps/overlay/src/update/semver.ts packages/ui/src/semver.ts
```

En tête de `packages/ui/src/semver.ts`, ajouter : `/** Release versions compared as the island and Desktop read them (x.y.z, a pre-release before its release). */`

**3c.** Recréer les deux anciens chemins de l'île en réexports (l'île, ses imports et ses tests ne changent pas) :

`apps/overlay/src/sounds/decide.ts` :

```ts
export * from '@ledge/ui/sounds/decide';
```

`apps/overlay/src/update/semver.ts` :

```ts
export * from '@ledge/ui/semver';
```

(`@ledge/ui` exporte déjà `./sounds/*` et `./*` : aucun changement de `package.json`.)

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @ledge/ui test && pnpm --filter overlay test && pnpm -r typecheck`
Expected: PASS (les suites `sounds.test.ts` et `update-semver.test.ts` de l'île passent par les réexports).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/sounds/preferences.ts packages/ui/src/sounds/decide.ts packages/ui/src/semver.ts apps/overlay/src/sounds/decide.ts apps/overlay/src/update/semver.ts packages/ui/test/sound-prefs-options.test.ts packages/ui/test/shared-rules.test.ts
git commit -m "refactor(ui): share the sound rule and version compare, sound prefs take a finish key and a default"
```

---

### Task 2: Les préférences de Desktop — sons, Ne pas déranger, thème et accent, harnais, échelle

**Files:**
- Create: `apps/desktop/src/notify/prefs.ts`, `apps/desktop/src/settings/scale.ts`
- Modify: `apps/desktop/src/shell/theme.ts`, `apps/desktop/src/launch/form.ts`
- Test: `apps/desktop/test/desktop-prefs.test.tsx`

**Interfaces:**
- Consumes: `createSoundPrefs` + options (tâche 1) ; `applyAccent`, `loadAccent`, `saveAccent`, `parseAccent` (`@ledge/ui/accent`) ; `loadScale`, `saveScale`, `resolveScale`, `UiScale` (`@ledge/ui/scale`) ; `writeJson` (`src/state/storage.ts`) ; `isTauri` (`src/tauri/bridge.ts`).
- Produces:
  - `src/notify/prefs.ts` : `loadSounds(): SoundPrefs`, `setSounds(p: SoundPatch): void`, `useSoundPrefs(): { finished: FinishedNotify; sounds: SoundPrefs; setFinished; setSounds }`, `loadNotifyMode(): FinishedNotify`, `setNotifyMode(v: FinishedNotify): void`, `resetSoundPrefsForTests(): void` ; `loadDnd(): boolean`, `getDnd(): boolean`, `setDnd(on: boolean): void`, `useDnd(): [boolean, (on: boolean) => void]`, `resetDndForTests(): void` ; réexporte les types `FinishedNotify`, `SoundPrefs`, `SoundPatch`.
  - `src/shell/theme.ts` : `Theme`, `THEMES`, `loadTheme()`, `setTheme(t: Theme): void`, `useTheme(): Theme` (lecture seule, partout), `setAccent(hex: string | null): void`, `useAccent(): string | null`, `useAppearance(): void` (monté une fois par `App`), `resetAppearanceForTests(): void`.
  - `src/launch/form.ts` : `saveTool(tool: Tool): void`.
  - `src/settings/scale.ts` : `interface ZoomDeps { setZoom(factor: number): Promise<void>; screenHeight(): Promise<number | null> }`, `loadUiScale(): UiScale`, `applyUiScale(setting: UiScale, deps?: ZoomDeps | null): Promise<number | null>`, `saveUiScale(setting: UiScale, deps?: ZoomDeps | null): Promise<number | null>`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/desktop-prefs.test.tsx` :

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { getDnd, loadNotifyMode, loadSounds, resetDndForTests, resetSoundPrefsForTests, setDnd, setNotifyMode, useDnd } from '../src/notify/prefs';
import { resetAppearanceForTests, setAccent, setTheme, useAppearance, useTheme } from '../src/shell/theme';
import { loadTool, saveTool } from '../src/launch/form';
import { applyUiScale, loadUiScale, saveUiScale, type ZoomDeps } from '../src/settings/scale';

beforeEach(() => {
  localStorage.clear();
  resetSoundPrefsForTests(); resetDndForTests(); resetAppearanceForTests();
  document.documentElement.removeAttribute('style');
});

describe('sounds and the finish alert (spec §10)', () => {
  it('starts with sounds off and the finish alert on both, without touching the island keys', () => {
    expect(loadSounds().enabled).toBe(false);
    expect(loadNotifyMode()).toBe('both');
    setNotifyMode('none');
    expect(localStorage.getItem('desktop.notify')).toBe('none');
    expect(localStorage.getItem('ledge.finished')).toBeNull();
  });
});

describe('Do not disturb (desktop.dnd)', () => {
  function Probe() { const [dnd] = useDnd(); return <p>{dnd ? 'dnd on' : 'dnd off'}</p>; }
  it('is shared and stored as the island stores it', () => {
    render(<Probe />);
    expect(screen.getByText('dnd off')).toBeInTheDocument();
    act(() => setDnd(true));
    expect(screen.getByText('dnd on')).toBeInTheDocument();
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    expect(getDnd()).toBe(true);
    localStorage.setItem('desktop.dnd', '0'); resetDndForTests();
    expect(getDnd()).toBe(false);
  });
});

describe('theme and accent, live', () => {
  function Mascot() { return <p>{useTheme()}</p>; }
  function Root() { useAppearance(); return null; }
  it('every reader follows the switch; the root carries the theme and the accent', () => {
    render(<><Root /><Mascot /></>);
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => setTheme('light'));
    expect(screen.getByText('light')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('desktop.theme')).toBe('light');
    act(() => setAccent('#3366FF'));
    expect(localStorage.getItem('desktop.accent')).toBe('#3366ff');
    expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('');
    act(() => setAccent(null));
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });
});

describe('default harness', () => {
  it('is what the next launch form starts with', () => {
    saveTool('codex');
    expect(localStorage.getItem('desktop.tool')).toBe('"codex"');
    expect(loadTool()).toBe('codex');
  });
});

describe('interface scale (WebView zoom)', () => {
  const deps = (h: number | null): ZoomDeps & { setZoom: ReturnType<typeof vi.fn> } => ({ setZoom: vi.fn(async () => {}), screenHeight: vi.fn(async () => h) });
  it('Auto follows the screen height, a fixed scale does not ask for it', async () => {
    const d = deps(4320);
    expect(await applyUiScale('auto', d)).toBe(2);
    expect(d.setZoom).toHaveBeenCalledWith(2);
    const f = deps(4320);
    expect(await applyUiScale(1.5, f)).toBe(1.5);
    expect(f.screenHeight).not.toHaveBeenCalled();
    expect(await applyUiScale('auto', deps(null))).toBe(1);
  });
  it('stores desktop.panelScale; outside the app or on failure nothing breaks', async () => {
    await saveUiScale(1.25, deps(1080));
    expect(localStorage.getItem('desktop.panelScale')).toBe('1.25');
    expect(loadUiScale()).toBe(1.25);
    expect(await applyUiScale(2, null)).toBeNull();
    expect(await applyUiScale(2, { setZoom: async () => { throw new Error('denied'); }, screenHeight: async () => 1080 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- desktop-prefs`
Expected: FAIL — `Failed to resolve import "../src/notify/prefs"`.

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/notify/prefs.ts` :

```ts
import { useSyncExternalStore } from 'react';
import { createSoundPrefs } from '@ledge/ui/sounds/preferences';
export type { FinishedNotify, SoundPatch, SoundPrefs } from '@ledge/ui/sounds/preferences';

/** Desktop's sounds (`desktop.sounds`) start off and its finish alert lives in `desktop.notify` (spec §7, §10): both
 *  fronts may run on the same daemon, and these defaults keep them from playing every cue twice. */
const prefs = createSoundPrefs('desktop', { finishedKey: 'desktop.notify', enabled: false });
export const { loadSounds, setSounds, useSoundPrefs, resetSoundPrefsForTests } = prefs;
export const loadNotifyMode = prefs.loadFinished;
export const setNotifyMode = prefs.setFinished;

/** Do not disturb (`desktop.dnd`, '1' / '0' like the island's `ledge.dnd`): cuts toasts and sounds, never what the screen shows. */
const DND_KEY = 'desktop.dnd';
export function loadDnd(): boolean {
  try { return localStorage.getItem(DND_KEY) === '1'; } catch { return false; }
}
let dnd = loadDnd();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getDnd = (): boolean => dnd;
export function setDnd(on: boolean): void {
  dnd = on;
  try { localStorage.setItem(DND_KEY, on ? '1' : '0'); } catch { /* storage unavailable: the in-memory value still applies */ }
  emit();
}
export function useDnd(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, getDnd, getDnd), setDnd];
}
/** Test hook: the next read reloads from storage. */
export function resetDndForTests(): void { dnd = loadDnd(); emit(); }
```

**3b.** `apps/desktop/src/shell/theme.ts` (remplace tout le fichier ; `useTheme` garde son nom et son retour, donc `Person.tsx`, `EmptyWorkspace.tsx`, `LaunchFormView.tsx`, `LaunchProgress.tsx` et `ChatTrigger.tsx` du lot 6 ne changent pas) :

```ts
import { useEffect, useSyncExternalStore } from 'react';
import { applyAccent, loadAccent, parseAccent, saveAccent } from '@ledge/ui/accent';

const KEY = 'desktop.theme';
export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];

export function loadTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

// One store for the theme and the accent: the settings change them, every mascot and the root follow at once (lot 7).
let theme = loadTheme();
let accent = loadAccent('desktop');
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function setTheme(next: Theme): void {
  theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable: the in-memory value still applies */ }
  emit();
}
/** `null` goes back to the factory coral and removes `desktop.accent`; anything but #rrggbb is ignored. */
export function setAccent(hex: string | null): void {
  const parsed = hex === null ? null : parseAccent(hex);
  if (hex !== null && parsed === null) return;
  saveAccent(parsed, 'desktop');
  accent = parsed;
  emit();
}

/** The Desktop theme (`desktop.theme`, dark by default). */
export function useTheme(): Theme { return useSyncExternalStore(subscribe, () => theme, () => theme); }
/** The chosen accent (`desktop.accent`), null for the factory coral. */
export function useAccent(): string | null { return useSyncExternalStore(subscribe, () => accent, () => accent); }
/** Mounted once by the App: mirrors the theme on the root element for the shared tokens and paints the accent for it. */
export function useAppearance(): void {
  const t = useTheme(); const a = useAccent();
  useEffect(() => { document.documentElement.dataset.theme = t; applyAccent(a, t); }, [t, a]);
}
/** Test hook: the next read reloads from storage. */
export function resetAppearanceForTests(): void { theme = loadTheme(); accent = loadAccent('desktop'); emit(); }
```

**3c.** `apps/desktop/src/launch/form.ts`, juste après `loadTool()` :

```ts
/** The default harness chosen in the settings (spec §9.4): the next launch form starts with it. */
export function saveTool(tool: Tool): void { writeJson(TOOL_KEY, tool); }
```

**3d.** `apps/desktop/src/settings/scale.ts` :

```ts
import { loadScale, resolveScale, saveScale, type UiScale } from '@ledge/ui/scale';
import { isTauri } from '../tauri/bridge';

/** The two native calls a scale needs; injected by the tests. */
export interface ZoomDeps { setZoom(factor: number): Promise<void>; screenHeight(): Promise<number | null> }

const tauriZoom: ZoomDeps = {
  async setZoom(factor) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(factor);
  },
  async screenHeight() {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const m = await currentMonitor();
    return m ? m.size.height / m.scaleFactor : null;
  }
};
const nativeZoom = (): ZoomDeps | null => (isTauri() ? tauriZoom : null);

/** One scale for the whole window (`desktop.panelScale`, spec §7): Desktop has no handle, `desktop.handleScale` stays unused. */
export const loadUiScale = (): UiScale => loadScale('panel', 'desktop');

/** Zooms the WebView (spec §9.4). Auto follows the screen's logical height as the island's windows do (2160 px base).
 *  Returns the factor applied, or null outside the app or when the WebView refuses; never throws. */
export async function applyUiScale(setting: UiScale, deps: ZoomDeps | null = nativeZoom()): Promise<number | null> {
  if (!deps) return null;
  try {
    const h = setting === 'auto' ? await deps.screenHeight() : null;
    const factor = resolveScale(setting, h ?? 0, 'panel');
    await deps.setZoom(factor);
    return factor;
  } catch { return null; }
}

export function saveUiScale(setting: UiScale, deps: ZoomDeps | null = nativeZoom()): Promise<number | null> {
  saveScale('panel', setting, 'desktop');
  return applyUiScale(setting, deps);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS (les suites existantes qui affichent des mascottes passent : `useTheme` rend toujours `'dark'` par défaut).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/notify/prefs.ts apps/desktop/src/shell/theme.ts apps/desktop/src/launch/form.ts apps/desktop/src/settings/scale.ts apps/desktop/test/desktop-prefs.test.tsx
git commit -m "feat(desktop): live preferences for sounds, do not disturb, theme, accent, harness and scale"
```

---

### Task 3: Le natif — plugin de notification, zoom WebView, Ne pas déranger du tray sans fenêtre, pont JS

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/capabilities/default.json`, `apps/desktop/package.json` (+ `pnpm-lock.yaml`), `apps/desktop/src/tauri/bridge.ts`
- Test: `apps/desktop/test/bridge.test.ts` (créer), `apps/desktop/test/tauri-config.test.ts` (ajouter un cas), test Rust dans `main.rs`

**Interfaces:**
- Consumes: commandes Rust existantes `foreground_is_terminal`, `set_tray_labels(open, new_session, dnd, quit)` (arguments JS en camelCase : `newSession`) ; `invoke` paresseux et `isTauri` de `bridge.ts`.
- Produces:
  - Rust : `fn tray_shows_window(id: &str) -> bool` (faux pour `dnd`) ; plugin `tauri_plugin_notification` ; permissions `notification:default`, `core:webview:allow-set-webview-zoom`.
  - `src/tauri/bridge.ts` : `foregroundIsTerminal(): Promise<boolean>` ; `interface TrayLabels { open: string; newSession: string; dnd: string; quit: string }` ; `setTrayLabels(labels: TrayLabels): void` ; `showToast(title: string, body: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/bridge.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke }));
const notification = vi.hoisted(() => ({ isPermissionGranted: vi.fn(), requestPermission: vi.fn(), sendNotification: vi.fn() }));
vi.mock('@tauri-apps/plugin-notification', () => notification);
import { foregroundIsTerminal, setTrayLabels, showToast } from '../src/tauri/bridge';

const inTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.clearAllMocks(); });

describe('outside the app', () => {
  it('every call is a quiet no-op', async () => {
    expect(await foregroundIsTerminal()).toBe(false);
    expect(await showToast('Otto', 'harness-assistant')).toBe(false);
    expect(() => setTrayLabels({ open: 'Open', newSession: 'New', dnd: 'DND', quit: 'Quit' })).not.toThrow();
    expect(core.invoke).not.toHaveBeenCalled();
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });
});

describe('in the app', () => {
  it('asks the shell whether a terminal is in front, false on failure', async () => {
    inTauri();
    core.invoke.mockResolvedValueOnce(true);
    expect(await foregroundIsTerminal()).toBe(true);
    expect(core.invoke).toHaveBeenCalledWith('foreground_is_terminal', undefined);
    core.invoke.mockRejectedValueOnce(new Error('no'));
    expect(await foregroundIsTerminal()).toBe(false);
  });

  it('renames the tray entries with the Rust argument names', async () => {
    inTauri();
    core.invoke.mockResolvedValue(undefined);
    setTrayLabels({ open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge Desktop' });
    await vi.waitFor(() => expect(core.invoke).toHaveBeenCalledWith('set_tray_labels', { open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge Desktop' }));
  });

  it('sends a toast once permitted, and nothing when refused', async () => {
    inTauri();
    notification.isPermissionGranted.mockResolvedValueOnce(true);
    expect(await showToast('Otto needs your approval', 'Run the tests?')).toBe(true);
    expect(notification.sendNotification).toHaveBeenCalledWith({ title: 'Otto needs your approval', body: 'Run the tests?' });
    notification.isPermissionGranted.mockResolvedValueOnce(false);
    notification.requestPermission.mockResolvedValueOnce('denied');
    expect(await showToast('Nova has finished', 'ledge')).toBe(false);
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);
  });
});
```

Dans `apps/desktop/test/tauri-config.test.ts`, ajouter dans le `describe` :

```ts
  it('shows toasts, zooms the WebView, and keeps the window hidden for Do not disturb (spec §9.4, §10)', () => {
    expect(caps.permissions).toContain('notification:default');
    expect(caps.permissions).toContain('core:webview:allow-set-webview-zoom');
    expect(main).toContain('.plugin(tauri_plugin_notification::init())');
    expect(main).toContain('if tray_shows_window(id) { show_main(app); }');
  });
```

Dans `apps/desktop/src-tauri/src/main.rs`, module `tests` : remplacer `use super::{launched_minimized, tray_title};` par `use super::{launched_minimized, tray_shows_window, tray_title};` et ajouter :

```rust
    #[test]
    fn do_not_disturb_from_the_tray_keeps_the_window_hidden() {
        assert!(!tray_shows_window("dnd"));
        assert!(tray_shows_window("new"));
    }
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- bridge tauri-config`
Expected: FAIL — `foregroundIsTerminal` / `showToast` / `setTrayLabels` ne sont pas exportés (`is not a function`), et le cas de config échoue sur `notification:default`.

- [ ] **Step 3: Implement**

**3a.** Dépendance JS (le proxy est nécessaire depuis WSL) :

```bash
cd /home/gch/development/github.com/Paradow-dev/ledge && https_proxy=http://192.168.40.2:3128 pnpm --filter desktop add @tauri-apps/plugin-notification@^2.3.0
```

**3b.** `apps/desktop/src-tauri/Cargo.toml`, section `[dependencies]`, après `tauri-plugin-process = "2"` : `tauri-plugin-notification = "2"`.

**3c.** `apps/desktop/src-tauri/capabilities/default.json` : la liste devient

```json
  "permissions": ["core:default", "core:window:allow-show", "core:window:allow-hide", "core:window:allow-set-focus", "core:event:allow-listen", "core:event:allow-unlisten", "core:webview:allow-set-webview-zoom", "window-state:default", "updater:default", "process:allow-restart", "notification:default"]
```

**3d.** `apps/desktop/src-tauri/src/main.rs` :
- au-dessus de `fn show_main` :

```rust
/// Every tray entry brings the window forward except Do not disturb, a switch the user flips without looking (spec §10).
fn tray_shows_window(id: &str) -> bool {
    id != TRAY_DND
}
```

- dans `on_menu_event`, la branche générique devient :

```rust
            id => { if tray_shows_window(id) { show_main(app); } let _ = app.emit("ledge://tray", TrayPayload { action: id.to_string() }); }
```

- après `.plugin(tauri_plugin_process::init())` : `.plugin(tauri_plugin_notification::init())`.

**3e.** `apps/desktop/src/tauri/bridge.ts` — compléter le commentaire d'en-tête avec trois lignes :

```ts
 *   foreground_is_terminal             whether a terminal window is in front (sounds: « only when the terminal is behind »)
 *   set_tray_labels { open, newSession, dnd, quit }   tray entries in the app's language
 *   plugin notification                Windows toasts (spec §10)
```

et ajouter à la fin du fichier :

```ts
/** Whether a terminal window is in front; false outside Tauri or when the shell cannot tell. */
export async function foregroundIsTerminal(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('foreground_is_terminal').catch(() => false);
}

/** The tray entries, in the app's language (main.rs builds them in French until the first call). */
export interface TrayLabels { open: string; newSession: string; dnd: string; quit: string }
export function setTrayLabels(labels: TrayLabels): void {
  if (!isTauri()) return;
  void invoke('set_tray_labels', { open: labels.open, newSession: labels.newSession, dnd: labels.dnd, quit: labels.quit }).catch(() => {});
}

/** A Windows toast (spec §10); permission is asked once. False when refused, failed or outside Tauri. The click is not handled. */
export async function showToast(title: string, body: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const n = await import('@tauri-apps/plugin-notification');
    const granted = (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
    if (!granted) return false;
    n.sendNotification({ title, body });
    return true;
  } catch { return false; }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS.

Run (depuis la racine du dépôt ; `pnpm --filter desktop build` d'abord si `generate_context!` réclame `apps/desktop/dist`) :
`https_proxy=http://192.168.40.2:3128 ~/.cargo/bin/cargo xwin check -p ledge-desktop --target x86_64-pc-windows-msvc`
puis `https_proxy=http://192.168.40.2:3128 ~/.cargo/bin/cargo xwin test -p ledge-desktop --target x86_64-pc-windows-msvc`
Expected: compilation sans erreur ; `test result: ok. 3 passed` (les deux tests existants et le nouveau). Si le `.exe` de test ne peut pas s'exécuter depuis WSL pour une raison d'environnement, relancer avec `--no-run` (doit compiler) et noter que `cargo test --workspace` de la CI Windows exécute les tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml Cargo.lock apps/desktop/src-tauri/src/main.rs apps/desktop/src-tauri/capabilities/default.json apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/tauri/bridge.ts apps/desktop/test/bridge.test.ts apps/desktop/test/tauri-config.test.ts
git commit -m "feat(desktop): windows toasts, webview zoom, tray labels and do not disturb without showing the window"
```

---

### Task 4: Les alertes — toasts et sons tirés des changements de sessions

**Files:**
- Create: `apps/desktop/src/notify/alerts.ts`, `apps/desktop/src/notify/player.ts`, `apps/desktop/src/notify/useAlerts.ts`
- Modify: `apps/desktop/src/i18n/messages.ts` (bloc `notify`)
- Test: `apps/desktop/test/alerts.test.ts`, `apps/desktop/test/use-alerts.test.tsx`

**Interfaces:**
- Consumes: `changeOf`, `splitId`, `SessionChange`, `MachineState`, `DaemonStatus` (`@ledge/fleet`) ; `decideSound` (tâche 1) ; `Cue` (`@ledge/ui/sounds/cues`) ; `VOLUME_GAIN` (`@ledge/ui/sounds/preferences`) ; `createWebAudioPlayer`, `SoundPlayer` (`@ledge/ui/sounds/player`) ; `useSoundPrefs`, `useDnd`, `FinishedNotify` (tâche 2) ; `showToast`, `foregroundIsTerminal` (tâche 3) ; `useI18n`.
- Produces:
  - `src/notify/alerts.ts` : `cueOf(c: SessionChange): Cue` ; `strongestCue(changes: readonly SessionChange[]): Cue | null` ; `interface AlertBase { sessions: ReadonlyMap<string, Session>; machines: ReadonlySet<string> }` ; `baselineOf(sessions: readonly Session[], machines: readonly string[]): AlertBase` ; `settledMachines(machines: readonly MachineState[]): string[]` ; `diffSessions(base: AlertBase, now: readonly Session[]): SessionChange[]` ; `type ToastKind = 'approval' | 'question' | 'finished' | 'failed'` ; `toastKind(c: SessionChange, mode: FinishedNotify): ToastKind | null` ; `interface Toast { title: string; body: string }` ; `toastFor(changes, sessions, mode, copy: Messages['notify']): Toast | null`.
  - `src/notify/player.ts` : `appPlayer(): SoundPlayer`.
  - `src/notify/useAlerts.ts` : `interface AlertDeps { player?: SoundPlayer; toast?: (title: string, body: string) => void; terminalInFront?: () => Promise<boolean>; focused?: () => boolean; now?: () => number }` ; `interface Alerts { user(cue: 'accept' | 'deny'): void; test(): 'played' | 'dnd' }` ; `useAlerts(input: { sessions: readonly Session[]; machines: readonly MachineState[]; status: DaemonStatus }, deps?: AlertDeps): Alerts`.
  - `t.notify` : `approval(name)`, `question(name)`, `finished(name)`, `failed(name)`, `manyTitle`, `many(n)`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/alerts.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { SessionChange } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { baselineOf, cueOf, diffSessions, settledMachines, strongestCue, toastFor, toastKind } from '../src/notify/alerts';
import { MESSAGES } from '../src/i18n/messages';
import { machine } from './launch-helpers';

const copy = MESSAGES.en.notify;
const working = fakeSession('local:a', { name: 'Otto', state: 'working' });
const asking = fakeSession('local:a', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run the tests?' } });

describe('which machines count', () => {
  it('only an open machine that has delivered its sessions', () => {
    expect(settledMachines([machine('local'), machine('devbox', { status: 'unreachable', ready: false }), machine('nas', { status: 'connecting', ready: false })])).toEqual(['local']);
  });
});

describe('diffSessions', () => {
  it('reads an ask on a settled machine', () => {
    expect(diffSessions(baselineOf([working], ['local']), [asking])).toEqual([{ kind: 'asked', id: 'local:a', ask: 'approval' }]);
  });
  it('a machine seen for the first time, or back from offline, is a baseline: nothing to report', () => {
    expect(diffSessions(baselineOf([], []), [asking])).toEqual([]);
    expect(diffSessions(baselineOf([{ ...working, offline: true }], []), [asking])).toEqual([]);
  });
  it('a frozen session changes nothing', () => {
    expect(diffSessions(baselineOf([working], ['local']), [{ ...asking, offline: true }])).toEqual([]);
  });
});

describe('cues', () => {
  it('maps changes to the island cues and keeps the strongest of a burst', () => {
    expect(cueOf({ kind: 'asked', id: 'x', ask: 'question' })).toBe('question');
    expect(cueOf({ kind: 'failed', id: 'x' })).toBe('error');
    const burst: SessionChange[] = [{ kind: 'joined', id: 'b' }, { kind: 'finished', id: 'c' }, { kind: 'asked', id: 'd', ask: 'question' }];
    expect(strongestCue(burst)).toBe('question');
    expect(strongestCue([])).toBeNull();
  });
});

describe('toasts', () => {
  it('an ask always, a finish or a failure only with a visual alert', () => {
    expect(toastKind({ kind: 'asked', id: 'x', ask: 'approval' }, 'none')).toBe('approval');
    expect(toastKind({ kind: 'finished', id: 'x' }, 'sound')).toBeNull();
    expect(toastKind({ kind: 'finished', id: 'x' }, 'bubble')).toBe('finished');
    expect(toastKind({ kind: 'failed', id: 'x' }, 'both')).toBe('failed');
    expect(toastKind({ kind: 'joined', id: 'x' }, 'both')).toBeNull();
  });
  it('one session: its name and its request', () => {
    expect(toastFor([{ kind: 'asked', id: 'local:a', ask: 'approval' }], [asking], 'both', copy)).toEqual({ title: 'Otto needs your approval', body: 'Run the tests?' });
    expect(toastFor([{ kind: 'finished', id: 'local:a' }], [working], 'both', copy)).toEqual({ title: 'Otto has finished', body: 'harness-assistant' });
  });
  it('a burst is one grouped toast; nothing worth a toast is null', () => {
    const changes: SessionChange[] = [{ kind: 'asked', id: 'local:a', ask: 'approval' }, { kind: 'asked', id: 'local:b', ask: 'question' }, { kind: 'finished', id: 'local:c' }];
    expect(toastFor(changes, [asking], 'both', copy)).toEqual({ title: 'Your team', body: '3 sessions need you or have finished' });
    expect(toastFor(changes, [asking], 'none', copy)).toEqual({ title: 'Your team', body: '2 sessions need you or have finished' });
    expect(toastFor([{ kind: 'joined', id: 'local:a' }], [asking], 'both', copy)).toBeNull();
  });
});
```

`apps/desktop/test/use-alerts.test.tsx` :

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DaemonStatus, MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { useAlerts, type AlertDeps } from '../src/notify/useAlerts';
import { resetDndForTests, resetSoundPrefsForTests, setDnd, setNotifyMode, setSounds } from '../src/notify/prefs';
import { machine } from './launch-helpers';

type Props = { sessions: Session[]; machines: MachineState[]; status: DaemonStatus };
const ask = (id: string, name: string, state: Session['state'] = 'waiting_permission') => fakeSession(id, { name, state, ...(state.startsWith('waiting') ? { pending: { kind: state === 'waiting_input' ? 'question' : 'permission', text: `${name} asks` } } : {}) });
let now = 100_000;
function setup(focused = false) {
  const deps = { player: { play: vi.fn() }, toast: vi.fn(), terminalInFront: vi.fn(async () => false), focused: vi.fn(() => focused), now: () => now } satisfies AlertDeps;
  const local = machine('local');
  const h = renderHook((p: Props) => useAlerts(p, deps), { initialProps: { sessions: [], machines: [machine('local', { status: 'connecting', ready: false })], status: 'connecting' } });
  return { deps, local, h };
}

beforeEach(() => {
  localStorage.clear(); resetSoundPrefsForTests(); resetDndForTests();
  setSounds({ enabled: true });
  now += 60_000;
});

describe('the first look is quiet (Review Focus 1)', () => {
  it('sessions already waiting at start-up make no toast and no sound', async () => {
    const { deps, local, h } = setup();
    h.rerender({ sessions: [ask('local:a', 'Otto'), ask('local:b', 'Nova')], machines: [local], status: 'open' });
    h.rerender({ sessions: [ask('local:a', 'Otto'), ask('local:b', 'Nova')], machines: [local], status: 'open' });
    await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.player.play).not.toHaveBeenCalled();
  });

  it('a remote machine connecting, or back from offline, brings its asks silently', async () => {
    const { deps, local, h } = setup();
    h.rerender({ sessions: [], machines: [local, machine('devbox', { status: 'connecting', ready: false })], status: 'open' });
    h.rerender({ sessions: [ask('devbox:x', 'Rio')], machines: [local, machine('devbox')], status: 'open' });
    h.rerender({ sessions: [{ ...fakeSession('devbox:x', { name: 'Rio' }), offline: true }], machines: [local, machine('devbox', { status: 'unreachable', ready: false })], status: 'open' });
    h.rerender({ sessions: [ask('devbox:x', 'Rio', 'waiting_input')], machines: [local, machine('devbox')], status: 'open' });
    await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.player.play).not.toHaveBeenCalled();
  });

  it('five asks at once: one grouped toast and one sound', async () => {
    const { deps, local, h } = setup();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    h.rerender({ sessions: ids.map(i => fakeSession(`local:${i}`)), machines: [local], status: 'open' });
    h.rerender({ sessions: ids.map(i => ask(`local:${i}`, i)), machines: [local], status: 'open' });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledTimes(1));
    expect(deps.player.play).toHaveBeenCalledWith('approval', 1);
    expect(deps.toast).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith('Your team', '5 sessions need you or have finished');
  });
});

describe('a new ask', () => {
  function asked(focused = false) {
    const s = setup(focused);
    s.h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [s.local], status: 'open' });
    s.h.rerender({ sessions: [ask('local:a', 'Otto')], machines: [s.local], status: 'open' });
    return s;
  }
  it('makes a toast while the window is behind or hidden', async () => {
    const { deps } = asked();
    expect(deps.toast).toHaveBeenCalledWith('Otto needs your approval', 'Otto asks');
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('approval', 1));
  });
  it('makes no toast while Desktop has the focus', () => {
    expect(asked(true).deps.toast).not.toHaveBeenCalled();
  });
  it('Do not disturb cuts toasts and sounds', async () => {
    setDnd(true);
    const { deps } = asked();
    await Promise.resolve(); await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.player.play).not.toHaveBeenCalled();
  });
  it('no sound while the terminal is in front, the toast stays', async () => {
    const s = setup();
    s.deps.terminalInFront.mockResolvedValue(true);
    s.h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [s.local], status: 'open' });
    s.h.rerender({ sessions: [ask('local:a', 'Otto')], machines: [s.local], status: 'open' });
    await vi.waitFor(() => expect(s.deps.terminalInFront).toHaveBeenCalled());
    await Promise.resolve();
    expect(s.deps.player.play).not.toHaveBeenCalled();
    expect(s.deps.toast).toHaveBeenCalledTimes(1);
  });
});

describe('a finish follows the finish mode', () => {
  it('sound only: no toast', async () => {
    setNotifyMode('sound');
    const { deps, local, h } = setup();
    h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [local], status: 'open' });
    h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto', state: 'idle' })], machines: [local], status: 'open' });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('finished', 1));
    expect(deps.toast).not.toHaveBeenCalled();
  });
});

describe('the daemon and the user', () => {
  it('losing the local daemon plays the error cue once', async () => {
    const { deps, local, h } = setup();
    h.rerender({ sessions: [], machines: [local], status: 'open' });
    h.rerender({ sessions: [], machines: [machine('local', { status: 'unreachable', ready: false })], status: 'unreachable' });
    h.rerender({ sessions: [], machines: [machine('local', { status: 'connecting', ready: false })], status: 'connecting' });
    h.rerender({ sessions: [], machines: [machine('local', { status: 'unreachable', ready: false })], status: 'unreachable' });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledTimes(1));
    expect(deps.player.play).toHaveBeenCalledWith('error', 1);
  });
  it('a decision ticks without asking for the terminal; Test plays the question cue unless Do not disturb', async () => {
    const { deps, h } = setup();
    act(() => h.result.current.user('accept'));
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('accept', 1));
    expect(deps.terminalInFront).not.toHaveBeenCalled();
    act(() => setSounds({ volume: 'loud' }));
    expect(h.result.current.test()).toBe('played');
    expect(deps.player.play).toHaveBeenLastCalledWith('question', 1.8);
    act(() => setDnd(true));
    expect(h.result.current.test()).toBe('dnd');
    expect(deps.player.play).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- alerts use-alerts`
Expected: FAIL — `Failed to resolve import "../src/notify/alerts"`.

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/i18n/messages.ts` — dans `fr`, après `localDown` :

```ts
  notify: {
    approval: (name: string) => `${name} attend votre accord`,
    question: (name: string) => `${name} a une question`,
    finished: (name: string) => `${name} a terminé`,
    failed: (name: string) => `${name} a rencontré une erreur`,
    manyTitle: 'Votre équipe',
    many: (n: number) => `${n} sessions vous attendent ou ont terminé`
  },
```

dans `en`, au même endroit :

```ts
  notify: {
    approval: (name) => `${name} needs your approval`,
    question: (name) => `${name} has a question`,
    finished: (name) => `${name} has finished`,
    failed: (name) => `${name} ran into an error`,
    manyTitle: 'Your team',
    many: (n) => `${n} sessions need you or have finished`
  },
```

**3b.** `apps/desktop/src/notify/alerts.ts` :

```ts
import { changeOf, splitId, type MachineState, type SessionChange } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import type { Cue } from '@ledge/ui/sounds/cues';
import type { Messages } from '../i18n/messages';
import type { FinishedNotify } from './prefs';

/** The island's cue for each change (apps/overlay/src/sounds/useSounds.ts). */
export function cueOf(c: SessionChange): Cue {
  switch (c.kind) {
    case 'asked': return c.ask === 'approval' ? 'approval' : 'question';
    case 'finished': return 'finished';
    case 'failed': return 'error';
    case 'joined': return 'join';
    case 'left': return 'leave';
  }
}

const STRENGTH: readonly Cue[] = ['approval', 'question', 'error', 'finished', 'join', 'leave'];
/** One cue per update: the one that matters most (a burst plays once, spec §7 ter of the island). */
export function strongestCue(changes: readonly SessionChange[]): Cue | null {
  const cues = changes.map(cueOf);
  return STRENGTH.find(c => cues.includes(c)) ?? null;
}

/** What the alerts knew at the previous update: each session as it was, and the machines that had delivered theirs. */
export interface AlertBase { sessions: ReadonlyMap<string, Session>; machines: ReadonlySet<string> }
export const baselineOf = (sessions: readonly Session[], machines: readonly string[]): AlertBase => ({ sessions: new Map(sessions.map(s => [s.id, s])), machines: new Set(machines) });
/** Open and with its sessions delivered: only then is a change on that machine news. */
export const settledMachines = (machines: readonly MachineState[]): string[] => machines.filter(m => m.status === 'open' && m.ready).map(m => m.id);

/** The changes since the previous update that may alert (spec §10). A machine that was not settled then (start-up,
 *  first connection, return from offline) brings a baseline, not news; a frozen (offline) session changes nothing. */
export function diffSessions(base: AlertBase, now: readonly Session[]): SessionChange[] {
  const out: SessionChange[] = [];
  for (const s of now) {
    if (s.offline) continue;
    const m = splitId(s.id)?.machine;
    if (!m || !base.machines.has(m)) continue;
    const c = changeOf(base.sessions.get(s.id), s);
    if (c) out.push(c);
  }
  return out;
}

export type ToastKind = 'approval' | 'question' | 'finished' | 'failed';
/** An ask always toasts (it blocks the agent); a finish or a failure only when the finish alert is visual. */
export function toastKind(c: SessionChange, mode: FinishedNotify): ToastKind | null {
  if (c.kind === 'asked') return c.ask;
  if (c.kind === 'finished' || c.kind === 'failed') return mode === 'both' || mode === 'bubble' ? c.kind : null;
  return null;
}

export interface Toast { title: string; body: string }
const clip = (text: string) => (text.length > 120 ? `${text.slice(0, 119)}…` : text);
/** One toast per update: the session's own when alone, a grouped one for a burst. */
export function toastFor(changes: readonly SessionChange[], sessions: readonly Session[], mode: FinishedNotify, copy: Messages['notify']): Toast | null {
  const items = changes.flatMap(c => { const kind = toastKind(c, mode); return kind ? [{ id: c.id, kind }] : []; });
  if (items.length === 0) return null;
  if (items.length > 1) return { title: copy.manyTitle, body: copy.many(items.length) };
  const { id, kind } = items[0]!;
  const s = sessions.find(x => x.id === id);
  const name = s?.name ?? id;
  const body = (kind === 'approval' || kind === 'question') && s?.pending?.text ? clip(s.pending.text) : (s?.project ?? '');
  return { title: copy[kind](name), body };
}
```

**3c.** `apps/desktop/src/notify/player.ts` :

```ts
import { createWebAudioPlayer, type SoundPlayer } from '@ledge/ui/sounds/player';

let player: SoundPlayer | null = null;
/** One Web Audio player for the whole app, created on the first cue (silent where Web Audio is missing). */
export const appPlayer = (): SoundPlayer => (player ??= createWebAudioPlayer());
```

**3d.** `apps/desktop/src/notify/useAlerts.ts` :

```ts
import { useEffect, useMemo, useRef } from 'react';
import type { DaemonStatus, MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import type { Cue } from '@ledge/ui/sounds/cues';
import { decideSound } from '@ledge/ui/sounds/decide';
import type { SoundPlayer } from '@ledge/ui/sounds/player';
import { VOLUME_GAIN } from '@ledge/ui/sounds/preferences';
import { useI18n } from '../i18n/lang';
import { foregroundIsTerminal, showToast } from '../tauri/bridge';
import { baselineOf, diffSessions, settledMachines, strongestCue, toastFor, type AlertBase } from './alerts';
import { appPlayer } from './player';
import { useDnd, useSoundPrefs } from './prefs';

export interface AlertDeps { player?: SoundPlayer; toast?: (title: string, body: string) => void; terminalInFront?: () => Promise<boolean>; focused?: () => boolean; now?: () => number }
export interface Alerts { user(cue: 'accept' | 'deny'): void; test(): 'played' | 'dnd' }

const nativeToast = (title: string, body: string) => { void showToast(title, body); };
const windowFocused = () => document.hasFocus();

/**
 * Toasts and sounds from session changes (spec §10). A toast only while Desktop is behind or in the tray, never in Do
 * not disturb; a sound through the island's `decideSound` (sounds off by default on Desktop). The terminal check is async,
 * so a cue is decided once it answers; nothing on screen waits for it.
 */
export function useAlerts(input: { sessions: readonly Session[]; machines: readonly MachineState[]; status: DaemonStatus }, deps: AlertDeps = {}): Alerts {
  const { finished, sounds } = useSoundPrefs();
  const [dnd] = useDnd();
  const { t } = useI18n();
  const live = useRef({ finished, sounds, dnd, copy: t.notify, deps });
  live.current = { finished, sounds, dnd, copy: t.notify, deps };
  const base = useRef<AlertBase>(baselineOf([], []));
  const lastPlayedAt = useRef<number | null>(null);
  const connectedAt = useRef<number | null>(null);
  const prevStatus = useRef(input.status);

  const api = useMemo(() => {
    const play = (cue: Cue) => {
      const l = live.current;
      const user = cue === 'accept' || cue === 'deny';
      const check = l.deps.terminalInFront ?? foregroundIsTerminal;
      void (l.sounds.onlyWhenTerminalBehind && !user ? check() : Promise.resolve(false)).then(front => {
        const c = live.current;
        const now = (c.deps.now ?? Date.now)();
        const d = decideSound({ cue, sounds: c.sounds, finished: c.finished, dnd: c.dnd, terminalInFront: front, lastPlayedAt: lastPlayedAt.current, connectedAt: connectedAt.current, now });
        if (!d.play) return;
        if (!user) lastPlayedAt.current = now;   // a tick of yours never silences the next ask
        (c.deps.player ?? appPlayer()).play(cue, d.gain);
      });
    };
    return {
      play,
      user: (cue: 'accept' | 'deny') => play(cue),
      /** The settings' Test: the question cue at the chosen volume; nothing in Do not disturb. */
      test: (): 'played' | 'dnd' => {
        const l = live.current;
        if (l.dnd) return 'dnd';
        (l.deps.player ?? appPlayer()).play('question', VOLUME_GAIN[l.sounds.volume]);
        return 'played';
      }
    };
  }, []);

  const settled = settledMachines(input.machines).join('\n');
  useEffect(() => {
    const changes = diffSessions(base.current, input.sessions);
    base.current = baselineOf(input.sessions, settled ? settled.split('\n') : []);
    if (changes.length === 0) return;
    const l = live.current;
    const cue = strongestCue(changes);
    if (cue) api.play(cue);
    if (l.dnd || (l.deps.focused ?? windowFocused)()) return;
    const toast = toastFor(changes, input.sessions, l.finished, l.copy);
    if (toast) (l.deps.toast ?? nativeToast)(toast.title, toast.body);
  }, [input.sessions, settled, api]);

  // The local daemon lost: once per outage, on open -> unreachable only; retries and the reconnection are silent (island rule).
  useEffect(() => {
    const was = prevStatus.current; prevStatus.current = input.status;
    if (input.status === 'open') connectedAt.current = (live.current.deps.now ?? Date.now)();
    if (was === 'open' && input.status === 'unreachable') api.play('error');
  }, [input.status, api]);

  return useMemo(() => ({ user: api.user, test: api.test }), [api]);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/notify/alerts.ts apps/desktop/src/notify/player.ts apps/desktop/src/notify/useAlerts.ts apps/desktop/src/i18n/messages.ts apps/desktop/test/alerts.test.ts apps/desktop/test/use-alerts.test.tsx
git commit -m "feat(desktop): toasts and sounds from session changes, quiet at first sight and grouped in bursts"
```

---

### Task 5: Les mises à jour — vérifier seul, installer au clic, daemon local

**Files:**
- Create: `apps/desktop/src/update/store.ts`, `apps/desktop/src/update/daemon.ts`
- Modify: `apps/desktop/src/main.tsx`
- Delete: `apps/desktop/src/update/startup.ts`, `apps/desktop/test/update-startup.test.ts`
- Test: `apps/desktop/test/update-store.test.ts`, `apps/desktop/test/daemon-update.test.tsx`

**Interfaces:**
- Consumes: `checkForUpdate`, `relaunchApp`, `appVersion`, `AvailableUpdate` (`src/update/bridge.ts`, lot 3) ; `compareVersions` (`@ledge/ui/semver`, tâche 1) ; `Fleet`, `MachineState` (`@ledge/fleet`) ; `SEMVER`, `UpdateFailure` (`@ledge/protocol`) ; `loadUiScale`, `applyUiScale` (tâche 2) ; `fakeFleet`, `machine` (`test/launch-helpers.ts`).
- Produces:
  - `src/update/store.ts` : `type UpdatePhase = { kind: 'idle' } | { kind: 'checking' } | { kind: 'current' } | { kind: 'available'; version: string; notes: string } | { kind: 'installing'; version: string; percent: number | null } | { kind: 'failed'; during: 'check' | 'install' }` ; `interface UpdateSnapshot { phase: UpdatePhase; auto: boolean; checkedAt: number | null; app: string | null; latest: string | null }` ; `interface UpdaterDeps { check?; relaunch?; version?; now?: () => number; every?: (fn: () => void, ms: number) => () => void }` ; `interface Updater { get(): UpdateSnapshot; subscribe(fn: () => void): () => void; start(): Promise<void>; check(): Promise<void>; install(): Promise<void>; setAuto(on: boolean): void; stop(): void }` ; `UPDATE_EVERY_MS` ; `createUpdater(deps?: UpdaterDeps): Updater` ; `updater` (l'instance de l'app) ; `useUpdate(u?: Updater): UpdateSnapshot` ; `updateReady(s: UpdateSnapshot): boolean`.
  - `src/update/daemon.ts` : `type DaemonOffer = 'none' | 'offer' | 'manual'` ; `daemonOffer(local: MachineState | undefined, target: string | null): DaemonOffer` ; `daemonTarget(s: UpdateSnapshot): string | null` ; `type DaemonStep = { kind: 'sent'; version: string } | { kind: 'installing' } | { kind: 'restarting' } | { kind: 'done'; version: string } | { kind: 'failed'; reason: UpdateFailure | 'offline' | 'timeout'; detail?: string; command?: string }` ; `DAEMON_STALL_MS` ; `interface DaemonUpdate { offer: DaemonOffer; journal: DaemonStep[]; running: boolean; start(): void }` ; `useDaemonUpdate(fleet: Pick<Fleet, 'sendTo' | 'onMachineMessage'>, machines: readonly MachineState[], target: string | null, stallMs?: number): DaemonUpdate`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/update-store.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailableUpdate } from '../src/update/bridge';
import { createUpdater, UPDATE_EVERY_MS, updateReady } from '../src/update/store';

function release(version = '0.6.0') {
  let finish!: () => void; let fail!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => { finish = res; fail = rej; });
  const u: AvailableUpdate = { version, notes: 'Fixes', downloadAndInstall: vi.fn(async (progress: (d: number, t: number | null) => void) => { progress(50, 100); await done; }) };
  return { u, finish, fail };
}
function deps(check: () => Promise<AvailableUpdate | null>) {
  const ticks: Array<() => void> = [];
  const d = { check: vi.fn(check), relaunch: vi.fn(async () => {}), version: vi.fn(async () => '0.5.0'), now: () => 42, every: vi.fn((fn: () => void, ms: number) => { expect(ms).toBe(UPDATE_EVERY_MS); ticks.push(fn); return () => {}; }) };
  return { d, ticks };
}

beforeEach(() => localStorage.clear());

describe('nothing is installed without a click (Review Focus 5)', () => {
  it('the start-up and the 6-hour checks only check', async () => {
    const r = release();
    const { d, ticks } = deps(async () => r.u);
    localStorage.setItem('desktop.update.attempted', '0.6.0');
    const up = createUpdater(d);
    await up.start();
    expect(localStorage.getItem('desktop.update.attempted')).toBeNull();
    expect(up.get().phase).toEqual({ kind: 'available', version: '0.6.0', notes: 'Fixes' });
    expect(updateReady(up.get())).toBe(true);
    expect(localStorage.getItem('desktop.update.checkedAt')).toBe('42');
    ticks[0]!(); await vi.waitFor(() => expect(d.check).toHaveBeenCalledTimes(2));
    expect(r.u.downloadAndInstall).not.toHaveBeenCalled();
    expect(d.relaunch).not.toHaveBeenCalled();
  });

  it('automatic checks off: no check at start nor every 6 hours, a manual check still works', async () => {
    localStorage.setItem('desktop.update.auto', '0');
    const { d, ticks } = deps(async () => null);
    const up = createUpdater(d);
    await up.start();
    ticks.forEach(t => t());
    expect(d.check).not.toHaveBeenCalled();
    expect(up.get().auto).toBe(false);
    await up.check();
    expect(up.get().phase).toEqual({ kind: 'current' });
  });

  it('a double click downloads once, notes the version it came from, then relaunches', async () => {
    const r = release();
    const { d } = deps(async () => r.u);
    const up = createUpdater(d);
    await up.start();
    const a = up.install(); const b = up.install();
    expect(up.get().phase).toEqual({ kind: 'installing', version: '0.6.0', percent: 50 });
    r.finish(); await Promise.all([a, b]);
    expect(r.u.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('desktop.update.from')).toBe('0.5.0');
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });

  it('a check asked during the install is ignored', async () => {
    const r = release();
    const { d, ticks } = deps(async () => r.u);
    const up = createUpdater(d);
    await up.start();
    const installing = up.install();
    await up.check(); ticks[0]!();
    expect(d.check).toHaveBeenCalledTimes(1);
    expect(up.get().phase.kind).toBe('installing');
    r.finish(); await installing;
  });
});

describe('failures are shown, and can be retried', () => {
  it('no network: the check fails, the next one succeeds', async () => {
    const { d } = deps(async () => { throw new Error('offline'); });
    const up = createUpdater(d);
    await up.start();
    expect(up.get().phase).toEqual({ kind: 'failed', during: 'check' });
    expect(up.get().checkedAt).toBeNull();
    d.check.mockResolvedValueOnce(null);
    await up.check();
    expect(up.get().phase).toEqual({ kind: 'current' });
  });

  it('a broken download: failed, then the same version installs on the next click', async () => {
    const r = release();
    const { d } = deps(async () => r.u);
    const up = createUpdater(d);
    await up.start();
    const first = up.install(); r.fail(new Error('broken')); await first;
    expect(up.get().phase).toEqual({ kind: 'failed', during: 'install' });
    expect(d.relaunch).not.toHaveBeenCalled();
    vi.mocked(r.u.downloadAndInstall).mockResolvedValueOnce(undefined);
    await up.install();
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });

  it('turning automatic checks back on checks at once and is remembered', async () => {
    localStorage.setItem('desktop.update.auto', '0');
    const { d } = deps(async () => null);
    const up = createUpdater(d);
    await up.start();
    up.setAuto(true);
    await vi.waitFor(() => expect(d.check).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('desktop.update.auto')).toBe('1');
    up.setAuto(false);
    expect(localStorage.getItem('desktop.update.auto')).toBe('0');
  });
});
```

`apps/desktop/test/daemon-update.test.tsx` :

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MachineState } from '@ledge/fleet';
import { daemonOffer, daemonTarget, useDaemonUpdate } from '../src/update/daemon';
import { fakeFleet, machine } from './launch-helpers';

const local = (version: string, install: 'npm' | 'git' | 'unknown' = 'npm', extra: Partial<MachineState> = {}) =>
  machine('local', { daemon: { version, install, systemd: true, ...(install === 'npm' ? {} : { manual: 'cd ~/ledge && git pull && pnpm build' }) }, ...extra });

describe('daemonOffer', () => {
  it('an npm daemon behind the target is offered, a git one gets its command, an up-to-date one nothing', () => {
    expect(daemonOffer(local('0.5.0'), '0.6.0')).toBe('offer');
    expect(daemonOffer(local('0.5.0', 'git'), '0.6.0')).toBe('manual');
    expect(daemonOffer(machine('local', { daemon: { version: '0.5.0', install: 'npm', systemd: false } }), '0.6.0')).toBe('manual');
    expect(daemonOffer(local('0.6.0'), '0.6.0')).toBe('none');
    expect(daemonOffer(machine('local'), '0.6.0')).toBe('none');
    expect(daemonOffer(local('0.5.0'), null)).toBe('none');
  });
  it('the target is the release on offer, else the running app', () => {
    expect(daemonTarget({ phase: { kind: 'available', version: '0.6.0', notes: '' }, auto: true, checkedAt: 1, app: '0.5.0', latest: '0.6.0' })).toBe('0.6.0');
    expect(daemonTarget({ phase: { kind: 'current' }, auto: true, checkedAt: 1, app: '0.5.0', latest: null })).toBe('0.5.0');
    expect(daemonTarget({ phase: { kind: 'idle' }, auto: true, checkedAt: null, app: null, latest: null })).toBeNull();
  });
});

describe('useDaemonUpdate', () => {
  it('sends update.daemon to the local daemon only, follows its journal, and is done once it returns updated', () => {
    const fleet = fakeFleet();
    const h = renderHook(({ ms }: { ms: MachineState[] }) => useDaemonUpdate(fleet, ms, '0.6.0'), { initialProps: { ms: [local('0.5.0'), machine('devbox')] } });
    expect(h.result.current.offer).toBe('offer');
    act(() => { h.result.current.start(); h.result.current.start(); });
    expect(fleet.sent).toEqual([{ machine: 'local', msg: { type: 'update.daemon', version: '0.6.0' } }]);
    act(() => fleet.emit('devbox', { type: 'update.failed', version: '0.6.0', reason: 'busy' }));
    act(() => fleet.emit('local', { type: 'update.progress', version: '0.6.0', step: 'installing' }));
    act(() => fleet.emit('local', { type: 'update.progress', version: '0.6.0', step: 'restarting' }));
    h.rerender({ ms: [local('0.5.0', 'npm', { status: 'unreachable', ready: false })] });
    expect(h.result.current.running).toBe(true);
    h.rerender({ ms: [local('0.6.0')] });
    expect(h.result.current.journal.map(s => s.kind)).toEqual(['sent', 'installing', 'restarting', 'done']);
    expect(h.result.current.running).toBe(false);
  });

  it('a refusal is shown with its command, and the button can be used again', () => {
    const fleet = fakeFleet();
    const h = renderHook(() => useDaemonUpdate(fleet, [local('0.5.0')], '0.6.0'));
    act(() => h.result.current.start());
    act(() => fleet.emit('local', { type: 'update.failed', version: '0.6.0', reason: 'sessions-at-risk', command: 'ledge update' }));
    expect(h.result.current.journal.at(-1)).toEqual({ kind: 'failed', reason: 'sessions-at-risk', command: 'ledge update' });
    expect(h.result.current.running).toBe(false);
  });

  it('the local daemon closed: nothing sent, « offline »; a silent daemon times out', () => {
    vi.useFakeTimers();
    try {
      const down = fakeFleet(['local']);
      const a = renderHook(() => useDaemonUpdate(down, [local('0.5.0')], '0.6.0'));
      act(() => a.result.current.start());
      expect(a.result.current.journal).toEqual([{ kind: 'failed', reason: 'offline' }]);
      const fleet = fakeFleet();
      const b = renderHook(() => useDaemonUpdate(fleet, [local('0.5.0')], '0.6.0', 1000));
      act(() => b.result.current.start());
      act(() => { vi.advanceTimersByTime(1000); });
      expect(b.result.current.journal.at(-1)).toEqual({ kind: 'failed', reason: 'timeout' });
    } finally { vi.useRealTimers(); }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- update-store daemon-update`
Expected: FAIL — `Failed to resolve import "../src/update/store"`.

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/update/store.ts` :

```ts
import { useSyncExternalStore } from 'react';
import { appVersion, checkForUpdate, relaunchApp, type AvailableUpdate } from './bridge';

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'installing'; version: string; percent: number | null }
  | { kind: 'failed'; during: 'check' | 'install' };
export interface UpdateSnapshot { phase: UpdatePhase; auto: boolean; checkedAt: number | null; app: string | null; latest: string | null }
export interface UpdaterDeps {
  check?: () => Promise<AvailableUpdate | null>; relaunch?: () => Promise<void>; version?: () => Promise<string | null>;
  now?: () => number; every?: (fn: () => void, ms: number) => () => void;
}
export interface Updater {
  get(): UpdateSnapshot; subscribe(fn: () => void): () => void;
  start(): Promise<void>; check(): Promise<void>; install(): Promise<void>; setAuto(on: boolean): void; stop(): void;
}
export const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* in-memory only */ } };
const loadCheckedAt = () => { const v = Number(get('desktop.update.checkedAt')); return Number.isFinite(v) && v > 0 ? v : null; };
const realEvery = (fn: () => void, ms: number) => { const t = setInterval(fn, ms); return () => clearInterval(t); };

/**
 * Desktop's updater (spec §9.4, §11, decision 1 of the lot 7 plan): checks `latest-desktop.json` at start-up and every
 * 6 hours while `desktop.update.auto` is not '0', and installs **only** on `install()`, i.e. the user's click. One check
 * and one download at a time; a check during the install is ignored. Never throws.
 */
export function createUpdater(deps: UpdaterDeps = {}): Updater {
  let snap: UpdateSnapshot = { phase: { kind: 'idle' }, auto: get('desktop.update.auto') !== '0', checkedAt: loadCheckedAt(), app: null, latest: null };
  let held: AvailableUpdate | null = null;
  let checking: Promise<void> | null = null;
  let started = false;
  let stopTimer = () => {};
  const listeners = new Set<() => void>();
  const put = (patch: Partial<UpdateSnapshot>) => { snap = { ...snap, ...patch }; for (const fn of [...listeners]) fn(); };

  const check = (): Promise<void> => {
    if (snap.phase.kind === 'installing') return Promise.resolve();
    if (checking) return checking;
    put({ phase: { kind: 'checking' } });
    checking = (async () => {
      try {
        const u = await (deps.check ?? checkForUpdate)();
        held = u;
        const at = (deps.now ?? Date.now)();
        set('desktop.update.checkedAt', String(at));
        put({ checkedAt: at, latest: u?.version ?? null, phase: u ? { kind: 'available', version: u.version, notes: u.notes } : { kind: 'current' } });
      } catch {
        put({ phase: { kind: 'failed', during: 'check' } });   // offline or unreachable: shown, retried by the next check
      } finally { checking = null; }
    })();
    return checking;
  };

  const install = async (): Promise<void> => {
    const p = snap.phase;
    const ready = p.kind === 'available' || (p.kind === 'failed' && p.during === 'install');
    if (!ready || !held) return;
    const u = held;
    put({ phase: { kind: 'installing', version: u.version, percent: null } });
    try {
      if (snap.app) set('desktop.update.from', snap.app);
      await u.downloadAndInstall((done, total) => put({ phase: { kind: 'installing', version: u.version, percent: total ? Math.min(100, Math.round((done / total) * 100)) : null } }));
      await (deps.relaunch ?? relaunchApp)();
    } catch {
      put({ phase: { kind: 'failed', during: 'install' } });
    }
  };

  return {
    get: () => snap,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async start() {
      if (started) return;
      started = true;
      set('desktop.update.attempted', null);   // lot 3's silent install marker: no longer used
      stopTimer = (deps.every ?? realEvery)(() => { if (snap.auto) void check(); }, UPDATE_EVERY_MS);
      const app = await (deps.version ?? appVersion)().catch(() => null);
      put({ app });
      if (snap.auto) await check();
    },
    check,
    install,
    setAuto(on) {
      set('desktop.update.auto', on ? '1' : '0');
      put({ auto: on });
      if (on) void check();
    },
    stop() { stopTimer(); stopTimer = () => {}; }
  };
}

/** The app's updater, started by `main.tsx`. */
export const updater = createUpdater();
export const useUpdate = (u: Updater = updater): UpdateSnapshot => useSyncExternalStore(u.subscribe, u.get, u.get);
/** The ⚙ button's pip: a newer Desktop waits for the user's click. */
export const updateReady = (s: UpdateSnapshot): boolean => s.phase.kind === 'available';
```

**3b.** `apps/desktop/src/update/daemon.ts` :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet, MachineState } from '@ledge/fleet';
import { SEMVER, type UpdateFailure } from '@ledge/protocol';
import { compareVersions } from '@ledge/ui/semver';
import type { UpdateSnapshot } from './store';

export type DaemonOffer = 'none' | 'offer' | 'manual';
/** What About offers for the local daemon (decision 2): nothing when it is up to date or unknown; the button for an npm
 *  service behind the target; its manual command otherwise (git checkout, no systemd: the daemon would refuse). */
export function daemonOffer(local: MachineState | undefined, target: string | null): DaemonOffer {
  const d = local?.daemon;
  if (!d || !target || !SEMVER.test(target) || compareVersions(d.version, target) >= 0) return 'none';
  return d.install === 'npm' && d.systemd ? 'offer' : 'manual';
}
/** The daemon follows Desktop: the release on offer, else the running app (the same lockstep version, spec §11). */
export const daemonTarget = (s: UpdateSnapshot): string | null => (s.phase.kind === 'available' ? s.phase.version : s.latest ?? s.app);

export type DaemonStep =
  | { kind: 'sent'; version: string } | { kind: 'installing' } | { kind: 'restarting' } | { kind: 'done'; version: string }
  | { kind: 'failed'; reason: UpdateFailure | 'offline' | 'timeout'; detail?: string; command?: string };
export interface DaemonUpdate { offer: DaemonOffer; journal: DaemonStep[]; running: boolean; start(): void }
/** Longer than the daemon's own 3-minute npm timeout (as the island's watchdog). */
export const DAEMON_STALL_MS = 4 * 60_000;

/** The local daemon's update and its journal (spec §9.4, §11: `update.daemon` to the local daemon only). Done when the
 *  local daemon is back, open, with at least the version sent. */
export function useDaemonUpdate(fleet: Pick<Fleet, 'sendTo' | 'onMachineMessage'>, machines: readonly MachineState[], target: string | null, stallMs = DAEMON_STALL_MS): DaemonUpdate {
  const [journal, setJournal] = useState<DaemonStep[]>([]);
  const sentVersion = useRef<string | null>(null);
  const add = useCallback((s: DaemonStep) => {
    if (s.kind === 'done' || s.kind === 'failed') sentVersion.current = null;
    setJournal(j => [...j, s]);
  }, []);
  const running = sentVersion.current !== null;
  const local = machines.find(m => m.id === 'local');

  useEffect(() => fleet.onMachineMessage((machine, m) => {
    if (machine !== 'local' || sentVersion.current === null) return;
    if (m.type === 'update.progress') add({ kind: m.step });
    if (m.type === 'update.failed') add({ kind: 'failed', reason: m.reason, ...(m.detail ? { detail: m.detail } : {}), ...(m.command ? { command: m.command } : {}) });
  }), [fleet, add]);

  const localVersion = local?.status === 'open' && local.ready ? local.daemon?.version ?? null : null;
  useEffect(() => {
    const v = sentVersion.current;
    if (v && localVersion && compareVersions(localVersion, v) >= 0) add({ kind: 'done', version: localVersion });
  }, [localVersion, add]);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => { if (sentVersion.current !== null) add({ kind: 'failed', reason: 'timeout' }); }, stallMs);
    return () => clearTimeout(t);
  }, [running, stallMs, add]);

  const start = useCallback(() => {
    if (sentVersion.current !== null || !target) return;
    if (!fleet.sendTo('local', { type: 'update.daemon', version: target })) { setJournal(j => [...j, { kind: 'failed', reason: 'offline' }]); return; }
    sentVersion.current = target;
    setJournal(j => [...j, { kind: 'sent', version: target }]);
  }, [fleet, target]);

  return { offer: daemonOffer(local, target), journal, running, start };
}
```

**3c.** Supprimer l'installation silencieuse du lot 3 :

```bash
git rm apps/desktop/src/update/startup.ts apps/desktop/test/update-startup.test.ts
```

**3d.** `apps/desktop/src/main.tsx` — remplacer l'import `updateAtStartup` et son appel :

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './motionPreferences';
import './styles/app.css';
import { applyUiScale, loadUiScale } from './settings/scale';
import { updater } from './update/store';

createRoot(document.getElementById('root')!).render(<App />);
void updater.start();
void applyUiScale(loadUiScale());
```

(Garder les autres imports réels de `main.tsx` s'il en a gagné aux lots 5 et 6.)

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS ; `update-startup.test.ts` n'existe plus.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/update/store.ts apps/desktop/src/update/daemon.ts apps/desktop/src/main.tsx apps/desktop/test/update-store.test.ts apps/desktop/test/daemon-update.test.tsx
git commit -m "feat(desktop): check for updates on its own, install only on click, update the local daemon"
```

---

### Task 6: La section Machines — ajout, test, modification, reconnexion, retrait

**Files:**
- Create: `apps/desktop/src/settings/machines.ts`, `apps/desktop/src/settings/useMachineEditor.ts`, `apps/desktop/src/settings/MachinesPanel.tsx`, `apps/desktop/test/settings-helpers.ts`
- Modify: `apps/desktop/src/i18n/messages.ts` (bloc `settings.machines`)
- Test: `apps/desktop/test/machines-panel.test.tsx`

**Interfaces:**
- Consumes: `Fleet`, `MachineConfig`, `MachineState`, `ProbeResult`, `sshProblem` (`@ledge/fleet`) ; `ServerMessage` (`@ledge/protocol`) ; `t.status.sessions(n)` (existant) ; `machine` (`test/launch-helpers.ts`).
- Produces:
  - `src/settings/machines.ts` : `ALIAS`, `MAX_MACHINES = 20`, `interface MachineDraft { label: string; ssh: string }`, `type DraftProblem = 'invalid' | 'duplicate' | 'full'`, `checkDraft(list: readonly MachineConfig[], draft: MachineDraft, editingId: string | null): DraftProblem | null`, `newMachineId(list: readonly MachineConfig[], random?: () => number): string`, `configsOf(machines: readonly MachineState[]): MachineConfig[]`, `withDraft(list, draft, editingId, random?): MachineConfig[]`, `without(list, id): MachineConfig[]`, `sameMachines(a, b): boolean`.
  - `src/settings/useMachineEditor.ts` : `type MachineFleet = Pick<Fleet, 'configure' | 'probe' | 'retry' | 'onMachineMessage'>`, `type SaveOutcome = 'saved' | 'offline' | 'timeout' | 'refused'`, `SAVE_TIMEOUT_MS = 10_000`, `interface ProbeState { key: string; alias: string; result: ProbeResult | null }`, `interface MachineEditor { saving: boolean; save(next: MachineConfig[]): Promise<SaveOutcome>; probing: ProbeState | null; probe(key: string, alias: string): void }`, `useMachineEditor(fleet, machines, timeoutMs?): MachineEditor`.
  - `src/settings/MachinesPanel.tsx` : `MachinesPanel({ machines, fleet, localDown, saveTimeoutMs? })`.
  - `test/settings-helpers.ts` : `fakeMachineFleet()` (`state.down`, `configured`, `retried`, `probes[{ ssh, answer }]`, `emit`), `type FakeMachineFleet`, `statesOf(list: MachineConfig[]): MachineState[]`.
  - `t.settings.machines` (voir 3a).

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/settings-helpers.ts` :

```ts
import type { MachineConfig, MachineState, ProbeResult } from '@ledge/fleet';
import type { ServerMessage } from '@ledge/protocol';
import { machine } from './launch-helpers';

/** The four fleet calls the Machines section uses. `state.down`: the local daemon is closed (`configure` throws
 *  `DaemonOffline` like the real fleet); `probes` wait for `answer`; `emit` plays a daemon message from one machine. */
export function fakeMachineFleet() {
  const state = { down: false };
  const configured: MachineConfig[][] = [];
  const retried: string[] = [];
  const probes: { ssh: string; answer(r: ProbeResult): void }[] = [];
  const listeners = new Set<(machine: string, m: ServerMessage) => void>();
  return {
    state, configured, retried, probes,
    configure(c: MachineConfig[]): void {
      if (state.down) throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
      configured.push(c);
    },
    probe(ssh: string): Promise<ProbeResult> { return new Promise(resolve => probes.push({ ssh, answer: resolve })); },
    retry(id: string): void { retried.push(id); },
    onMachineMessage(fn: (machine: string, m: ServerMessage) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    emit(from: string, m: ServerMessage): void { for (const fn of [...listeners]) fn(from, m); }
  };
}
export type FakeMachineFleet = ReturnType<typeof fakeMachineFleet>;
/** The list as the daemon's `machines` broadcast brings it back into the fleet. */
export const statesOf = (list: MachineConfig[]): MachineState[] => list.map(c => machine(c.id, { label: c.label, ...(c.ssh ? { ssh: c.ssh } : {}) }));
```

`apps/desktop/test/machines-panel.test.tsx` :

```tsx
import { describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MachineConfig, MachineState } from '@ledge/fleet';
import { MachinesPanel } from '../src/settings/MachinesPanel';
import { checkDraft, configsOf, newMachineId, withDraft, without } from '../src/settings/machines';
import { machine } from './launch-helpers';
import { fakeMachineFleet, statesOf, type FakeMachineFleet } from './settings-helpers';

const info = { version: '0.5.2', install: 'npm' as const, systemd: true };
const local = machine('local', { daemon: info });
const devbox = machine('devbox', { daemon: info });
const list: MachineConfig[] = [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }];

function show(ms: MachineState[] = [local, devbox], f: FakeMachineFleet = fakeMachineFleet(), o: { localDown?: boolean; saveTimeoutMs?: number } = {}) {
  const ui = (next: MachineState[]) => <MachinesPanel machines={next} fleet={f} localDown={o.localDown ?? false} saveTimeoutMs={o.saveTimeoutMs} />;
  const view = render(ui(ms));
  return { f, rerender: (next: MachineState[]) => act(() => view.rerender(ui(next))) };
}
const nameBox = () => screen.getByRole('textbox', { name: 'Machine name' });
const aliasBox = () => screen.getByRole('textbox', { name: 'SSH alias' });
async function fill(label: string, alias: string) {
  await userEvent.click(screen.getByRole('button', { name: '＋ Add a machine' }));
  if (label) await userEvent.type(nameBox(), label);
  if (alias) await userEvent.type(aliasBox(), alias);
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('the list rules', () => {
  it('a name of 1 to 80 characters, an SSH alias without spaces, at most once (Review Focus 3)', () => {
    expect(checkDraft(list, { label: 'Nas', ssh: 'nas' }, null)).toBeNull();
    expect(checkDraft(list, { label: '   ', ssh: 'nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'x'.repeat(81), ssh: 'nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'my box' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: '-nas' }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'a'.repeat(65) }, null)).toBe('invalid');
    expect(checkDraft(list, { label: 'Nas', ssh: 'a'.repeat(64) }, null)).toBeNull();
    expect(checkDraft(list, { label: 'Other', ssh: 'devbox' }, null)).toBe('duplicate');
    expect(checkDraft(list, { label: 'Devbox 2', ssh: 'devbox' }, 'devbox')).toBeNull();
    const full = [list[0]!, ...Array.from({ length: 19 }, (_, i) => ({ id: `m${i}`, label: `M${i}`, ssh: `m${i}` }))];
    expect(checkDraft(full, { label: 'Nas', ssh: 'nas' }, null)).toBe('full');
    expect(checkDraft(full, { label: 'M0 bis', ssh: 'm0' }, 'm0')).toBeNull();
  });

  it('builds the next list without touching the local machine', () => {
    expect(newMachineId(list, () => 0)).toBe('remote-0');
    expect(newMachineId([...list, { id: 'remote-0', label: 'X', ssh: 'x' }], () => 0)).toBe('remote-0-2');
    expect(withDraft(list, { label: ' Nas ', ssh: ' nas ' }, null, () => 0)).toEqual([...list, { id: 'remote-0', label: 'Nas', ssh: 'nas' }]);
    expect(withDraft(list, { label: 'Dev', ssh: 'dev2' }, 'devbox')).toEqual([list[0], { id: 'devbox', label: 'Dev', ssh: 'dev2' }]);
    expect(without(list, 'devbox')).toEqual([list[0]]);
    expect(without(list, 'local')).toEqual(list);
    expect(configsOf([local, devbox])).toEqual(list);
  });
});

describe('the Machines section', () => {
  it('lists the daemon’s machines, the local one first and without actions', () => {
    show([local, machine('devbox', { daemon: info, status: 'unreachable', ready: false })]);
    const [first, second] = screen.getAllByRole('article');
    expect(first).toHaveAccessibleName('Local');
    expect(first).toHaveTextContent('Local · WSL');
    expect(within(first!).queryAllByRole('button')).toHaveLength(0);
    expect(second).toHaveTextContent('SSH · devbox');
    expect(second).toHaveTextContent('Ledge 0.5.2');
    expect(second).toHaveTextContent('Disconnected');
    expect(within(second!).getAllByRole('button').map(b => b.textContent)).toEqual(['Test', 'Retry', 'Edit', 'Remove']);
  });

  it('adds a machine: machines.set, then the form closes once the daemon’s list comes back', async () => {
    const { f, rerender } = show();
    await fill('Nas', 'nas');
    await save();
    expect(f.configured).toEqual([[...list, { id: expect.stringMatching(/^remote-[a-z0-9]+$/), label: 'Nas', ssh: 'nas' }]]);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(nameBox()).toHaveValue('Nas');
    rerender(statesOf(f.configured[0]!));
    expect(await screen.findByRole('status')).toHaveTextContent('Nas is saved.');
    expect(screen.queryByRole('textbox', { name: 'Machine name' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Nas' })).toBeInTheDocument();
  });

  it.each([['Nas', 'my box', 'Check the name'], ['Nas', '-nas', 'Check the name'], ['   ', 'nas', 'Check the name'], ['Other', 'devbox', 'This alias is already added.']])(
    'refuses « %s » / « %s » before sending anything (Review Focus 3)', async (label, alias, message) => {
      const { f } = show();
      await fill(label, alias);
      await save();
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(f.configured).toEqual([]);
    });

  it('edits a machine and keeps its own alias', async () => {
    const { f } = show();
    await userEvent.click(within(screen.getByRole('article', { name: 'Devbox' })).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Devbox' })).toBeInTheDocument();
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), 'Dev server');
    await save();
    expect(f.configured).toEqual([[list[0], { id: 'devbox', label: 'Dev server', ssh: 'devbox' }]]);
  });

  describe('a save that cannot finish (Review Focus 2)', () => {
    it('a double click sends one machines.set', async () => {
      const { f } = show();
      await fill('Nas', 'nas');
      await userEvent.dblClick(screen.getByRole('button', { name: 'Save' }));
      expect(f.configured).toHaveLength(1);
    });

    it('the local daemon closed: a message, the values kept, nothing sent', async () => {
      const f = fakeMachineFleet(); f.state.down = true;
      show(undefined, f);
      await fill('Nas', 'nas');
      await save();
      expect(screen.getByRole('alert')).toHaveTextContent('The local daemon is not connected: try again in a moment.');
      expect(nameBox()).toHaveValue('Nas');
      expect(aliasBox()).toHaveValue('nas');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('an error of the local daemon refuses the list; an error answering something else does not', async () => {
      const { f } = show();
      await fill('Nas', 'nas');
      await save();
      act(() => f.emit('local', { type: 'error', message: 'Unknown session', id: 'q1' }));
      act(() => f.emit('devbox', { type: 'error', message: 'Busy' }));
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      act(() => f.emit('local', { type: 'error', message: 'Invalid machines' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The local daemon refused this list. Nothing changed.');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('a silent daemon: the save gives up and says so', async () => {
      show(undefined, undefined, { saveTimeoutMs: 30 });
      await fill('Nas', 'nas');
      await save();
      expect(await screen.findByRole('alert')).toHaveTextContent('The local daemon did not answer. Nothing changed.');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  it('removes a machine after a confirmation', async () => {
    const { f, rerender } = show();
    const card = screen.getByRole('article', { name: 'Devbox' });
    await userEvent.click(within(card).getByRole('button', { name: 'Remove' }));
    const confirm = within(card).getByRole('alert');
    expect(confirm).toHaveTextContent('Remove Devbox? Its sessions will leave the view; the work on the server goes on.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(f.configured).toEqual([[list[0]]]);
    rerender([local]);
    expect(await screen.findByRole('status')).toHaveTextContent('Devbox was removed from the list.');
  });

  it('tests a machine and the draft, one at a time, and explains a failure', async () => {
    const { f } = show();
    await userEvent.click(within(screen.getByRole('article', { name: 'Devbox' })).getByRole('button', { name: 'Test' }));
    expect(f.probes.map(p => p.ssh)).toEqual(['devbox']);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to devbox…');
    expect(within(screen.getByRole('article', { name: 'Devbox' })).getByRole('button', { name: 'Test' })).toBeDisabled();
    await act(async () => f.probes[0]!.answer({ ok: false, error: 'ssh: Could not resolve hostname devbox' }));
    expect(screen.getByRole('status')).toHaveTextContent('Alias not found. Add a Host block for this alias to ~/.ssh/config in WSL.');
    await fill('Nas', 'nas');
    await userEvent.click(screen.getByRole('button', { name: 'Test the connection' }));
    await act(async () => f.probes[1]!.answer({ ok: true, version: '0.5.2', sessions: 2 }));
    expect(screen.getByRole('status')).toHaveTextContent('Ledge 0.5.2 answers · 2 sessions');
    expect(f.configured).toEqual([]);
  });

  it('reconnects a disconnected machine now', async () => {
    const { f } = show([local, machine('devbox', { status: 'unreachable', ready: false })]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(f.retried).toEqual(['devbox']);
  });

  it('is read-only while the local daemon is unreachable', () => {
    show(undefined, undefined, { localDown: true });
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- machines-panel`
Expected: FAIL — `Failed to resolve import "../src/settings/MachinesPanel"`.

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/i18n/messages.ts` — import en tête : `import type { DaemonStatus, SshProblem } from '@ledge/fleet';`. Dans `fr`, après `notify` (tâche 4), ouvrir le bloc `settings` (les tâches 7 et 8 y ajoutent leurs clés) :

```ts
  settings: {
    machines: {
      title: 'Vos machines',
      note: 'Connexion SSH depuis WSL, comme dans Ledge classique.',
      status: { open: 'Connectée', connecting: 'Connexion…', unreachable: 'Déconnectée' } as Record<DaemonStatus, string>,
      localKind: 'Local · WSL',
      ssh: (alias: string) => `SSH · ${alias}`,
      version: (v: string | undefined) => (v ? `Ledge ${v}` : 'Version inconnue'),
      test: 'Tester', retry: 'Réessayer', edit: 'Modifier', remove: 'Retirer', cancel: 'Annuler',
      add: '＋ Ajouter une machine',
      addTitle: 'Ajouter une machine',
      editTitle: (label: string) => `Modifier ${label}`,
      label: 'Nom', labelAria: 'Nom de la machine', labelPlaceholder: 'Serveur de dev',
      alias: 'Alias SSH', aliasHint: 'Nom d’un bloc Host de ~/.ssh/config dans WSL.',
      before: 'Avant d’ajouter un serveur',
      checklist: ['L’alias fonctionne depuis WSL, sans mot de passe.', 'La clé du serveur est déjà approuvée.', 'Node 22+ et tmux sont installés.', 'Ledge est installé et démarré sur le serveur.'],
      probe: 'Tester la connexion', save: 'Enregistrer', saving: 'Enregistrement…',
      optional: 'Test facultatif : une machine injoignable peut être enregistrée.',
      probing: (alias: string) => `Connexion à ${alias}…`,
      probeOk: (v: string | undefined, n: number) => `${v ? `Ledge ${v}` : 'Ledge'} répond · ${n} ${plural(n, 'session', 'sessions')}`,
      problem: {
        alias: 'Alias introuvable. Ajoutez un bloc Host pour cet alias dans ~/.ssh/config de WSL.',
        key: 'La clé SSH est refusée. Vérifiez IdentityFile pour cet alias dans ~/.ssh/config de WSL.',
        hostKey: 'La clé du serveur n’est pas encore approuvée. Connectez-vous une fois depuis WSL avec ssh et cet alias.',
        unreachable: 'Le serveur ne répond pas. Il est peut-être éteint, ou hors du réseau.',
        ledge: 'Ledge est absent ou trop ancien sur ce serveur. Installez-le, puis lancez « ledge setup ».',
        stopped: 'Le service Ledge ne tourne pas sur le serveur. Lancez « ledge setup » sur le serveur.',
        local: 'Mettez à jour Ledge sur cette machine pour rejoindre un serveur.',
        other: 'La connexion a échoué.'
      } as Record<SshProblem, string>,
      errors: {
        invalid: 'Vérifiez le nom et l’alias SSH : lettres, chiffres, point, tiret ou souligné, sans espace.',
        duplicate: 'Cet alias est déjà ajouté.',
        full: 'Vous avez atteint 20 machines.',
        offline: 'Le daemon local n’est pas connecté : réessayez dans un instant.',
        timeout: 'Le daemon local n’a pas répondu. Rien n’a changé.',
        refused: 'Le daemon local a refusé cette liste. Rien n’a changé.'
      },
      saved: (label: string) => `${label} est enregistrée.`,
      removed: (label: string) => `${label} est retirée de la liste.`,
      confirm: (label: string) => `Retirer ${label} ? Ses sessions quitteront la vue ; le travail continue sur le serveur.`
    }
  },
```

dans `en` :

```ts
  settings: {
    machines: {
      title: 'Your machines',
      note: 'SSH connection from WSL, as in classic Ledge.',
      status: { open: 'Connected', connecting: 'Connecting…', unreachable: 'Disconnected' },
      localKind: 'Local · WSL',
      ssh: (alias) => `SSH · ${alias}`,
      version: (v) => (v ? `Ledge ${v}` : 'Unknown version'),
      test: 'Test', retry: 'Retry', edit: 'Edit', remove: 'Remove', cancel: 'Cancel',
      add: '＋ Add a machine',
      addTitle: 'Add a machine',
      editTitle: (label) => `Edit ${label}`,
      label: 'Name', labelAria: 'Machine name', labelPlaceholder: 'Dev server',
      alias: 'SSH alias', aliasHint: 'Name of a Host block in ~/.ssh/config in WSL.',
      before: 'Before adding a server',
      checklist: ['The alias works from WSL, without a password.', 'The server’s host key is already approved.', 'Node 22+ and tmux are installed.', 'Ledge is installed and running on the server.'],
      probe: 'Test the connection', save: 'Save', saving: 'Saving…',
      optional: 'The test is optional: an unreachable machine can be saved.',
      probing: (alias) => `Connecting to ${alias}…`,
      probeOk: (v, n) => `${v ? `Ledge ${v}` : 'Ledge'} answers · ${n} ${plural(n, 'session', 'sessions')}`,
      problem: {
        alias: 'Alias not found. Add a Host block for this alias to ~/.ssh/config in WSL.',
        key: 'The SSH key is refused. Check IdentityFile for this alias in ~/.ssh/config in WSL.',
        hostKey: 'The server’s host key is not approved yet. Connect once from WSL with ssh and this alias.',
        unreachable: 'The server does not answer. It may be off, or out of the network.',
        ledge: 'Ledge is missing or too old on this server. Install it, then run “ledge setup”.',
        stopped: 'The Ledge service is not running on the server. Run “ledge setup” on the server.',
        local: 'Update Ledge on this machine to reach a server.',
        other: 'The connection failed.'
      },
      errors: {
        invalid: 'Check the name and SSH alias: letters, digits, dot, dash or underscore, no spaces.',
        duplicate: 'This alias is already added.',
        full: 'You have reached 20 machines.',
        offline: 'The local daemon is not connected: try again in a moment.',
        timeout: 'The local daemon did not answer. Nothing changed.',
        refused: 'The local daemon refused this list. Nothing changed.'
      },
      saved: (label) => `${label} is saved.`,
      removed: (label) => `${label} was removed from the list.`,
      confirm: (label) => `Remove ${label}? Its sessions will leave the view; the work on the server goes on.`
    }
  },
```

**3b.** `apps/desktop/src/settings/machines.ts` :

```ts
import type { MachineConfig, MachineState } from '@ledge/fleet';

/** An SSH alias as the form accepts it (decision 11; the protocol allows 128, the form 64 as the mockup). */
export const ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
/** `MachinesSchema` allows 20 machines, the local one included. */
export const MAX_MACHINES = 20;
export interface MachineDraft { label: string; ssh: string }
export type DraftProblem = 'invalid' | 'duplicate' | 'full';

/** Why a draft cannot be saved, or null. `editingId`: the machine being edited, whose own alias is not a duplicate. */
export function checkDraft(list: readonly MachineConfig[], draft: MachineDraft, editingId: string | null): DraftProblem | null {
  const label = draft.label.trim(); const ssh = draft.ssh.trim();
  if (label.length < 1 || label.length > 80 || !ALIAS.test(ssh)) return 'invalid';
  if (list.some(m => m.id !== editingId && m.ssh === ssh)) return 'duplicate';
  if (editingId === null && list.length >= MAX_MACHINES) return 'full';
  return null;
}

/** A fresh id the protocol accepts (`^[a-zA-Z0-9_-]{1,64}$`), without `crypto.randomUUID` (absent from older WebView2). */
export function newMachineId(list: readonly MachineConfig[], random: () => number = Math.random): string {
  const base = `remote-${Math.floor(random() * 2 ** 32).toString(36)}`;
  let id = base; let n = 2;
  while (list.some(m => m.id === id)) id = `${base}-${n++}`;
  return id;
}

/** The configured list behind the fleet's machine states (what `machines.set` carries). */
export const configsOf = (machines: readonly MachineState[]): MachineConfig[] =>
  machines.map(m => ({ id: m.id, label: m.label, ...(m.ssh ? { ssh: m.ssh } : {}) }));

/** The list with the draft added, or replacing the machine being edited (in place). */
export function withDraft(list: readonly MachineConfig[], draft: MachineDraft, editingId: string | null, random?: () => number): MachineConfig[] {
  const label = draft.label.trim(); const ssh = draft.ssh.trim();
  if (editingId) return list.map(m => (m.id === editingId ? { id: m.id, label, ssh } : m));
  return [...list, { id: newMachineId(list, random), label, ssh }];
}

/** The list without one machine; the local one is never removed (spec §6). */
export const without = (list: readonly MachineConfig[], id: string): MachineConfig[] => (id === 'local' ? [...list] : list.filter(m => m.id !== id));

/** Same machines, same order, same names and aliases: the daemon's broadcast has reached the fleet. */
export const sameMachines = (a: readonly MachineConfig[], b: readonly MachineConfig[]): boolean =>
  a.length === b.length && a.every((m, i) => m.id === b[i]!.id && m.label === b[i]!.label && (m.ssh ?? null) === (b[i]!.ssh ?? null));
```

**3c.** `apps/desktop/src/settings/useMachineEditor.ts` :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet, MachineConfig, MachineState, ProbeResult } from '@ledge/fleet';
import { sameMachines } from './machines';

export type MachineFleet = Pick<Fleet, 'configure' | 'probe' | 'retry' | 'onMachineMessage'>;
export type SaveOutcome = 'saved' | 'offline' | 'timeout' | 'refused';
export const SAVE_TIMEOUT_MS = 10_000;
export interface ProbeState { key: string; alias: string; result: ProbeResult | null }
export interface MachineEditor { saving: boolean; save(next: MachineConfig[]): Promise<SaveOutcome>; probing: ProbeState | null; probe(key: string, alias: string): void }

/**
 * Saving waits for the daemon (spec §5.3): `configure` sends `machines.set`, and the save is done only when the fleet's
 * list equals the one sent (the daemon's `machines` broadcast). A closed local daemon, an `error` without id from it,
 * or `timeoutMs` without an answer end it with nothing applied. One save at a time: a second call gets the first's promise.
 */
export function useMachineEditor(fleet: MachineFleet, machines: readonly MachineState[], timeoutMs = SAVE_TIMEOUT_MS): MachineEditor {
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState<ProbeState | null>(null);
  const busy = useRef<Promise<SaveOutcome> | null>(null);
  const waiter = useRef<{ next: MachineConfig[]; finish(o: SaveOutcome): void } | null>(null);
  const current = useRef(machines); current.current = machines;
  const probeToken = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; waiter.current?.finish('timeout'); }; }, []);

  const save = useCallback((next: MachineConfig[]): Promise<SaveOutcome> => {
    if (busy.current) return busy.current;
    let resolve!: (o: SaveOutcome) => void;
    const p = new Promise<SaveOutcome>(r => { resolve = r; });
    busy.current = p; setSaving(true);
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let off = () => {};
    const finish = (o: SaveOutcome) => {
      if (done) return; done = true;
      clearTimeout(timer); off(); waiter.current = null; busy.current = null;
      if (mounted.current) setSaving(false);
      resolve(o);
    };
    off = fleet.onMachineMessage((machine, m) => { if (machine === 'local' && m.type === 'error' && m.id === undefined) finish('refused'); });
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    waiter.current = { next, finish };
    try { fleet.configure(next); }
    catch (e) { finish(e instanceof Error && e.name === 'DaemonOffline' ? 'offline' : 'refused'); return p; }
    if (sameMachines(current.current, next)) finish('saved');   // nothing to wait for (an unchanged list)
    return p;
  }, [fleet, timeoutMs]);

  useEffect(() => { const w = waiter.current; if (w && sameMachines(machines, w.next)) w.finish('saved'); }, [machines]);

  const probe = useCallback((key: string, alias: string) => {
    const mine = ++probeToken.current;
    setProbing({ key, alias, result: null });
    void fleet.probe(alias)
      .then((r): ProbeResult => r, (e: unknown): ProbeResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .then(result => { if (mounted.current && probeToken.current === mine) setProbing({ key, alias, result }); });
  }, [fleet]);

  return { saving, save, probing, probe };
}
```

**3d.** `apps/desktop/src/settings/MachinesPanel.tsx` :

```tsx
import { useState, type FormEvent } from 'react';
import { sshProblem, type MachineState, type ProbeResult } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { ALIAS, checkDraft, configsOf, without, withDraft, type MachineDraft } from './machines';
import { useMachineEditor, type MachineFleet, type SaveOutcome } from './useMachineEditor';

interface FormState { editing: string | null; draft: MachineDraft }
export interface MachinesPanelProps { machines: readonly MachineState[]; fleet: MachineFleet; localDown: boolean; saveTimeoutMs?: number }

/** Settings › Machines (spec §6, §9.4; mockup settings.js `machineSettings`). The list is the daemon's; every change
 *  goes through `machines.set` and shows once it comes back. The local machine is first and has no actions. */
export function MachinesPanel({ machines, fleet, localDown, saveTimeoutMs }: MachinesPanelProps) {
  const { t } = useI18n();
  const c = t.settings.machines;
  const editor = useMachineEditor(fleet, machines, saveTimeoutMs);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const list = configsOf(machines);
  const frozen = localDown || editor.saving;
  const probeBusy = editor.probing?.result === null;
  const failure = (o: Exclude<SaveOutcome, 'saved'>) => c.errors[o];
  const probeText = (r: ProbeResult) => (r.ok ? c.probeOk(r.version, r.sessions) : c.problem[sshProblem(r.error)]);
  const probeLine = (key: string) => (editor.probing?.key === key
    ? <p className="settings-note" role="status">{editor.probing.result ? probeText(editor.probing.result) : c.probing(editor.probing.alias)}</p>
    : null);
  const setDraft = (patch: Partial<MachineDraft>) => setForm(f => (f ? { ...f, draft: { ...f.draft, ...patch } } : f));
  const openForm = (editing: string | null, draft: MachineDraft) => { setForm({ editing, draft }); setFormError(null); setFeedback(null); setRemoval(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || editor.saving) return;
    const problem = checkDraft(list, form.draft, form.editing);
    if (problem) { setFormError(c.errors[problem]); return; }
    setFormError(null);
    const outcome = await editor.save(withDraft(list, form.draft, form.editing));
    if (outcome === 'saved') { setForm(null); setFeedback({ text: c.saved(form.draft.label.trim()), error: false }); }
    else setFormError(failure(outcome));
  };
  const remove = async (m: MachineState) => {
    setRemoval(null);
    const outcome = await editor.save(without(list, m.id));
    setFeedback(outcome === 'saved' ? { text: c.removed(m.label), error: false } : { text: failure(outcome), error: true });
  };
  const testDraft = () => {
    if (!form) return;
    const ssh = form.draft.ssh.trim();
    if (!ALIAS.test(ssh)) { setFormError(c.errors.invalid); return; }
    setFormError(null);
    editor.probe('draft', ssh);
  };
  const editingLabel = form?.editing ? machines.find(m => m.id === form.editing)?.label ?? '' : '';

  return (
    <>
      <h3>{c.title}</h3>
      <p className="settings-note">{c.note}</p>
      {machines.map(m => (
        <article key={m.id} className="settings-machine" aria-label={m.label}>
          <div><strong>{m.label}</strong><span className="machine-status"><i className={m.status === 'open' ? 'dot green' : 'dot'} aria-hidden="true" />{c.status[m.status]}</span></div>
          <p>{m.ssh ? c.ssh(m.ssh) : c.localKind} · {c.version(m.daemon?.version ?? m.version)} · {t.status.sessions(m.sessions.length)}</p>
          {m.ssh && (
            <div className="settings-actions">
              <button type="button" className="settings-button" disabled={frozen || probeBusy} onClick={() => editor.probe(m.id, m.ssh!)}>{c.test}</button>
              {m.status !== 'open' && <button type="button" className="settings-button" disabled={localDown} onClick={() => fleet.retry(m.id)}>{c.retry}</button>}
              <button type="button" className="settings-button" disabled={frozen} onClick={() => openForm(m.id, { label: m.label, ssh: m.ssh! })}>{c.edit}</button>
              <button type="button" className="settings-button" disabled={frozen} onClick={() => setRemoval(m.id)}>{c.remove}</button>
            </div>
          )}
          {probeLine(m.id)}
          {removal === m.id && (
            <div className="machine-confirm" role="alert">
              {c.confirm(m.label)}
              <div className="settings-actions">
                <button type="button" className="settings-button" disabled={frozen} onClick={() => void remove(m)}>{c.remove}</button>
                <button type="button" className="settings-button" onClick={() => setRemoval(null)}>{c.cancel}</button>
              </div>
            </div>
          )}
        </article>
      ))}
      {form ? (
        <form className="machine-form" onSubmit={e => void submit(e)}>
          <h4>{form.editing ? c.editTitle(editingLabel) : c.addTitle}</h4>
          <label>{c.label}<input name="label" aria-label={c.labelAria} required maxLength={80} value={form.draft.label} placeholder={c.labelPlaceholder} onChange={e => setDraft({ label: e.target.value })} /></label>
          <label>{c.alias}<input name="ssh" aria-label={c.alias} required maxLength={64} spellCheck={false} value={form.draft.ssh} placeholder="my-server" onChange={e => setDraft({ ssh: e.target.value })} /><small>{c.aliasHint}</small></label>
          <details><summary>{c.before}</summary><ol>{c.checklist.map(item => <li key={item}>{item}</li>)}</ol></details>
          {formError && <p className="setting-error" role="alert">{formError}</p>}
          {probeLine('draft')}
          <div className="settings-actions">
            <button type="button" className="settings-button" disabled={frozen || probeBusy} onClick={testDraft}>{c.probe}</button>
            <button type="button" className="settings-button" disabled={editor.saving} onClick={() => { setForm(null); setFormError(null); }}>{c.cancel}</button>
            <button type="submit" className="primary" disabled={frozen}>{editor.saving ? c.saving : c.save}</button>
          </div>
          <p className="settings-note">{c.optional}</p>
        </form>
      ) : (
        <div className="settings-actions">
          <button type="button" className="settings-button" disabled={localDown} onClick={() => openForm(null, { label: '', ssh: '' })}>{c.add}</button>
        </div>
      )}
      {feedback && <p className={feedback.error ? 'setting-error' : 'settings-note'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </>
  );
}
```

Note : les champs portent `required`, mais le formulaire de la maquette valide lui-même ; ajouter `noValidate` à `<form>` pour que le message de `checkDraft` s'affiche au lieu de la bulle native du navigateur (un nom vide doit donner le message « Check the name… ») : `<form className="machine-form" noValidate onSubmit={…}>`.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/machines.ts apps/desktop/src/settings/useMachineEditor.ts apps/desktop/src/settings/MachinesPanel.tsx apps/desktop/src/i18n/messages.ts apps/desktop/test/settings-helpers.ts apps/desktop/test/machines-panel.test.tsx
git commit -m "feat(desktop): machines settings that add, test, edit, reconnect and remove through the daemon"
```

---

### Task 7: Contrôles partagés et section À propos — versions, vérification, mise à jour au clic, daemon local

**Files:**
- Create: `apps/desktop/src/settings/controls.tsx`, `apps/desktop/src/settings/AboutPanel.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts` (bloc `settings.about`)
- Test: `apps/desktop/test/about-panel.test.tsx`

**Interfaces:**
- Consumes: `createUpdater`, `useUpdate`, `Updater`, `UpdateSnapshot` (tâche 5, `src/update/store.ts`) ; `DaemonUpdate`, `DaemonStep` (tâche 5, `src/update/daemon.ts`) ; `AvailableUpdate` (`src/update/bridge.ts`) ; `MachineState`, `DaemonInfo` (`@ledge/fleet`, `@ledge/protocol`) ; `machine` (`test/launch-helpers.ts`).
- Produces:
  - `src/settings/controls.tsx` : `Toggle({ label, hint, checked, onChange, disabled? }: { label: string; hint: string; checked: boolean; onChange(on: boolean): void; disabled?: boolean })` ; `SelectRow<V extends string>({ label, hint, value, options, onChange, disabled? }: { label: string; hint: string; value: V; options: readonly (readonly [V, string])[]; onChange(v: V): void; disabled?: boolean })`.
  - `src/settings/AboutPanel.tsx` : `AboutPanel({ machines, updater, daemon }: { machines: readonly MachineState[]; updater: Updater; daemon: DaemonUpdate })`.
  - `t.settings.about` (voir 3a).

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/about-panel.test.tsx` :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutPanel } from '../src/settings/AboutPanel';
import { createUpdater, type Updater } from '../src/update/store';
import type { AvailableUpdate } from '../src/update/bridge';
import type { DaemonUpdate } from '../src/update/daemon';
import { machine } from './launch-helpers';

const npm = { version: '0.5.1', install: 'npm' as const, systemd: true };
const machines = [machine('local', { daemon: npm }), machine('devbox', { daemon: { version: '0.5.2', install: 'git', systemd: true } })];
const idle: DaemonUpdate = { offer: 'none', journal: [], running: false, start: vi.fn() };
const release = (install = vi.fn(async () => {})): AvailableUpdate => ({ version: '0.6.0', notes: '', downloadAndInstall: install });
let u: Updater;
beforeEach(() => localStorage.clear());
afterEach(() => u?.stop());
async function started(check: () => Promise<AvailableUpdate | null>) {
  u = createUpdater({ check, version: async () => '0.5.1', relaunch: vi.fn(async () => {}), now: () => Date.UTC(2026, 9, 15, 9, 0), every: () => () => {} });
  await u.start();
  return u;
}

describe('About', () => {
  it('shows the app, each daemon and the latest version', async () => {
    render(<AboutPanel machines={machines} updater={await started(async () => null)} daemon={idle} />);
    expect(screen.getByRole('definition', { name: 'Desktop app' })).toHaveTextContent('0.5.1');
    expect(screen.getByRole('definition', { name: 'Daemon · Local' })).toHaveTextContent('0.5.1 · npm');
    expect(screen.getByRole('definition', { name: 'Daemon · Devbox' })).toHaveTextContent('0.5.2 · git clone');
    expect(screen.getByRole('definition', { name: 'Latest version' })).toHaveTextContent('Desktop is up to date');
    expect(screen.getByRole('button', { name: 'Update the app' })).toBeDisabled();
  });

  it('installs nothing until the click, then one download for a double click (Review Focus 5)', async () => {
    const install = vi.fn(async () => {});
    render(<AboutPanel machines={machines} updater={await started(async () => release(install))} daemon={idle} />);
    expect(screen.getByRole('definition', { name: 'Latest version' })).toHaveTextContent('0.6.0');
    expect(install).not.toHaveBeenCalled();
    await userEvent.dblClick(screen.getByRole('button', { name: 'Update the app' }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('says when the check failed and lets the user check again', async () => {
    let fail = true;
    render(<AboutPanel machines={machines} updater={await started(async () => { if (fail) throw new Error('offline'); return null; })} daemon={idle} />);
    expect(screen.getByText('The check failed. Check your connection.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Desktop is up to date.')).toBeInTheDocument();
  });

  it('turns the automatic check off', async () => {
    render(<AboutPanel machines={machines} updater={await started(async () => null)} daemon={idle} />);
    const toggle = screen.getByRole('switch', { name: 'Check for updates' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem('desktop.update.auto')).toBe('0');
  });

  it('offers the local daemon update and follows its journal', async () => {
    const start = vi.fn();
    const updater = await started(async () => release());
    const { rerender } = render(<AboutPanel machines={machines} updater={updater} daemon={{ offer: 'offer', journal: [], running: false, start }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Update the daemon' }));
    expect(start).toHaveBeenCalledTimes(1);
    rerender(<AboutPanel machines={machines} updater={updater} daemon={{ offer: 'offer', running: false, start, journal: [{ kind: 'sent', version: '0.6.0' }, { kind: 'installing' }, { kind: 'failed', reason: 'sessions-at-risk' }] }} />);
    const log = screen.getByRole('list', { name: 'Daemon log' });
    expect(log).toHaveTextContent('Request sent to the local daemon: 0.6.0');
    expect(log).toHaveTextContent('Installing the new version…');
    expect(log).toHaveTextContent('Your sessions run inside the daemon service');
    rerender(<AboutPanel machines={machines} updater={updater} daemon={{ offer: 'offer', running: true, start, journal: [{ kind: 'sent', version: '0.6.0' }] }} />);
    expect(screen.getByRole('button', { name: 'Update the daemon' })).toBeDisabled();
  });

  it('gives the manual command for a daemon it cannot update', async () => {
    const git = [machine('local', { daemon: { version: '0.5.1', install: 'git', systemd: true, manual: 'cd ~/ledge && git pull && pnpm install && pnpm build' } })];
    render(<AboutPanel machines={git} updater={await started(async () => release())} daemon={{ ...idle, offer: 'manual' }} />);
    expect(screen.queryByRole('button', { name: 'Update the daemon' })).toBeNull();
    expect(screen.getByText('Your daemon runs from a git clone: update it yourself.')).toBeInTheDocument();
    expect(screen.getByText('cd ~/ledge && git pull && pnpm install && pnpm build')).toBeInTheDocument();
  });

  it('shows the download progress', async () => {
    let progress: (done: number, total: number | null) => void = () => {};
    const install = vi.fn((on: (done: number, total: number | null) => void) => { progress = on; return new Promise<void>(() => {}); });
    render(<AboutPanel machines={machines} updater={await started(async () => release(install))} daemon={idle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Update the app' }));
    act(() => progress(40, 100));
    expect(screen.getByRole('button', { name: 'Installing… 40%' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- about-panel`
Expected: FAIL — `Failed to resolve import "../src/settings/AboutPanel"`.

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/i18n/messages.ts` — dans `fr.settings`, après `machines` :

```ts
    about: {
      title: 'Application et daemon',
      app: 'Application Desktop',
      daemon: (label: string) => `Daemon · ${label}`,
      install: { npm: 'npm', git: 'clone git', unknown: 'installation inconnue' } as Record<DaemonInfo['install'], string>,
      unknown: 'Version inconnue',
      latest: 'Dernière version',
      latestUnknown: 'Pas encore vérifiée',
      latestCurrent: 'Desktop est à jour',
      auto: 'Rechercher les mises à jour',
      autoHint: 'Au démarrage, puis toutes les 6 heures. Installation seulement après votre clic.',
      never: 'Jamais vérifié',
      checkedAt: (when: string) => `Vérifié le ${when}`,
      phase: {
        idle: 'Aucune vérification pour l’instant.',
        checking: 'Recherche d’une nouvelle version…',
        current: 'Desktop est à jour.',
        available: (v: string) => `Ledge ${v} est disponible. Rien n’est installé sans votre clic.`,
        installing: (v: string) => `Installation de Ledge ${v}. Desktop redémarrera seul.`,
        failedCheck: 'La vérification a échoué. Vérifiez votre connexion.',
        failedInstall: 'L’installation a échoué. L’application n’a pas changé.'
      },
      check: 'Vérifier',
      updateApp: 'Mettre à jour l’application',
      installing: (percent: number | null) => (percent === null ? 'Installation…' : `Installation… ${percent} %`),
      updateDaemon: 'Mettre à jour le daemon',
      log: 'Journal du daemon',
      step: {
        sent: (v: string) => `Demande envoyée au daemon local : ${v}`,
        installing: 'Installation de la nouvelle version…',
        restarting: 'Redémarrage du daemon…',
        done: (v: string) => `Daemon à jour : ${v}`
      },
      failed: {
        'git-install': 'Votre daemon tourne depuis un clone git : mettez-le à jour vous-même.',
        'no-systemd': 'Le daemon ne tourne pas comme service : il ne peut pas se relancer seul.',
        'sessions-at-risk': 'Vos sessions tournent dans le service du daemon : un redémarrage les fermerait. Fermez-les, ou redémarrez WSL, puis réessayez.',
        'npm-failed': 'Le daemon n’a pas pu se mettre à jour. Rien n’a changé.',
        busy: 'Une mise à jour est déjà en cours.',
        offline: 'Le daemon local n’est pas connecté : rien n’a été envoyé.',
        timeout: 'Le daemon ne répond plus.'
      } as Record<UpdateFailure | 'offline' | 'timeout', string>,
      timeoutCommand: 'systemctl --user status ledge-daemon'
    }
```

Imports en tête de `messages.ts` : `import type { DaemonInfo, UpdateFailure } from '@ledge/protocol';` (ajouter aux imports `@ledge/protocol` existants s'il y en a). Dans `en.settings`, après `machines` :

```ts
    about: {
      title: 'App and daemon',
      app: 'Desktop app',
      daemon: (label) => `Daemon · ${label}`,
      install: { npm: 'npm', git: 'git clone', unknown: 'unknown install' },
      unknown: 'Unknown version',
      latest: 'Latest version',
      latestUnknown: 'Not checked yet',
      latestCurrent: 'Desktop is up to date',
      auto: 'Check for updates',
      autoHint: 'At start-up, then every 6 hours. Installs only after your click.',
      never: 'Never checked',
      checkedAt: (when) => `Checked on ${when}`,
      phase: {
        idle: 'No check yet.',
        checking: 'Looking for a new version…',
        current: 'Desktop is up to date.',
        available: (v) => `Ledge ${v} is available. Nothing is installed without your click.`,
        installing: (v) => `Installing Ledge ${v}. Desktop will restart on its own.`,
        failedCheck: 'The check failed. Check your connection.',
        failedInstall: 'The install failed. The app did not change.'
      },
      check: 'Check',
      updateApp: 'Update the app',
      installing: (percent) => (percent === null ? 'Installing…' : `Installing… ${percent}%`),
      updateDaemon: 'Update the daemon',
      log: 'Daemon log',
      step: {
        sent: (v) => `Request sent to the local daemon: ${v}`,
        installing: 'Installing the new version…',
        restarting: 'Restarting the daemon…',
        done: (v) => `Daemon up to date: ${v}`
      },
      failed: {
        'git-install': 'Your daemon runs from a git clone: update it yourself.',
        'no-systemd': 'The daemon does not run as a service: it cannot restart itself.',
        'sessions-at-risk': 'Your sessions run inside the daemon service: a restart would close them. Close them, or restart WSL, then retry.',
        'npm-failed': 'The daemon could not update. Nothing changed.',
        busy: 'An update is already running.',
        offline: 'The local daemon is not connected: nothing was sent.',
        timeout: 'The daemon is not answering.'
      },
      timeoutCommand: 'systemctl --user status ledge-daemon'
    }
```

**3b.** `apps/desktop/src/settings/controls.tsx` (balisage de la maquette `settings.js` `toggle()` / `select()`) :

```tsx
/** A settings switch: the whole row is the label, the checkbox carries `role="switch"` (mockup settings.js `toggle`). */
export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange(on: boolean): void; disabled?: boolean }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong><small>{hint}</small></span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="setting-switch" aria-hidden="true" />
    </label>
  );
}

/** A settings choice (mockup settings.js `select`); option values are strings, the caller maps them back. */
export function SelectRow<V extends string>({ label, hint, value, options, onChange, disabled }: { label: string; hint: string; value: V; options: readonly (readonly [V, string])[]; onChange(v: V): void; disabled?: boolean }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong><small>{hint}</small></span>
      <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value as V)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}
```

**3c.** `apps/desktop/src/settings/AboutPanel.tsx` :

```tsx
import type { MachineState } from '@ledge/fleet';
import { useI18n, type Messages } from '../i18n/lang';
import { useUpdate, type Updater, type UpdateSnapshot } from '../update/store';
import type { DaemonStep, DaemonUpdate } from '../update/daemon';
import { Toggle } from './controls';

/** Settings › About (spec §9.4, §11; decisions 1 and 2): versions, the 6-hour check, the app update on click only, and
 *  the local daemon's update with its journal. The machines' versions come from each daemon's `DaemonInfo`. */
export function AboutPanel({ machines, updater, daemon }: { machines: readonly MachineState[]; updater: Updater; daemon: DaemonUpdate }) {
  const { t, lang } = useI18n();
  const c = t.settings.about;
  const s = useUpdate(updater);
  const local = machines.find(m => m.id === 'local');
  const phase = s.phase;
  const busy = phase.kind === 'checking' || phase.kind === 'installing';
  const canInstall = phase.kind === 'available' || (phase.kind === 'failed' && phase.during === 'install');
  const when = s.checkedAt === null ? null : new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(s.checkedAt);
  const stepText = (step: DaemonStep): string => {
    switch (step.kind) {
      case 'sent': return c.step.sent(step.version);
      case 'installing': return c.step.installing;
      case 'restarting': return c.step.restarting;
      case 'done': return c.step.done(step.version);
      case 'failed': return c.failed[step.reason];
    }
  };
  const latest = (snap: UpdateSnapshot) => snap.latest ?? (snap.phase.kind === 'current' ? c.latestCurrent : c.latestUnknown);
  const row = (id: string, term: string, value: string) => (
    <div key={id}><dt id={`about-${id}`}>{term}</dt><dd aria-labelledby={`about-${id}`}>{value}</dd></div>
  );

  return (
    <>
      <h3>{c.title}</h3>
      <dl className="version-list">
        {row('app', c.app, s.app ?? c.unknown)}
        {machines.map(m => row(`daemon-${m.id}`, c.daemon(m.label), m.daemon ? `${m.daemon.version} · ${c.install[m.daemon.install]}` : m.version ?? c.unknown))}
        {row('latest', c.latest, latest(s))}
      </dl>
      <Toggle label={c.auto} hint={c.autoHint} checked={s.auto} onChange={on => updater.setAuto(on)} />
      <div className="setting-row">
        <span><strong>{when ? c.checkedAt(when) : c.never}</strong><small>{phaseText(phase, c.phase)}</small></span>
        <button type="button" className="settings-button" disabled={busy} onClick={() => void updater.check()}>{c.check}</button>
      </div>
      <div className="settings-actions">
        <button type="button" className="settings-button" disabled={!canInstall} onClick={() => void updater.install()}>
          {phase.kind === 'installing' ? c.installing(phase.percent) : c.updateApp}
        </button>
        {daemon.offer === 'offer' && <button type="button" className="settings-button" disabled={daemon.running} onClick={daemon.start}>{c.updateDaemon}</button>}
      </div>
      {daemon.offer === 'manual' && local?.daemon && (
        <div className="settings-note">
          <p>{c.failed[local.daemon.install === 'git' ? 'git-install' : 'no-systemd']}</p>
          {local.daemon.manual && <code>{local.daemon.manual}</code>}
        </div>
      )}
      {daemon.journal.length > 0 && (
        <ol className="update-journal" aria-label={c.log}>
          {daemon.journal.map((step, i) => (
            <li key={i} className={step.kind === 'failed' ? 'setting-error' : undefined}>
              {stepText(step)}
              {step.kind === 'failed' && (step.command ?? (step.reason === 'timeout' ? c.timeoutCommand : null)) && <code>{step.command ?? c.timeoutCommand}</code>}
              {step.kind === 'failed' && step.detail && <small>{step.detail}</small>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

type PhaseCopy = Messages['settings']['about']['phase'];
function phaseText(p: UpdateSnapshot['phase'], c: PhaseCopy): string {
  switch (p.kind) {
    case 'idle': return c.idle;
    case 'checking': return c.checking;
    case 'current': return c.current;
    case 'available': return c.available(p.version);
    case 'installing': return c.installing(p.version);
    case 'failed': return p.during === 'check' ? c.failedCheck : c.failedInstall;
  }
}
```

Note : `getByRole('definition', { name })` s'appuie sur `aria-labelledby` du `<dd>` vers son `<dt>` ; garder ces ids (une seule section À propos à la fois).

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/controls.tsx apps/desktop/src/settings/AboutPanel.tsx apps/desktop/src/i18n/messages.ts apps/desktop/test/about-panel.test.tsx
git commit -m "feat(desktop): about settings with versions, update checks, install on click and the local daemon log"
```

---

### Task 8: L'écran Paramètres — Affichage, Notifications, Sons, navigation et styles

**Files:**
- Create: `apps/desktop/src/settings/DisplayPanel.tsx`, `apps/desktop/src/settings/NotificationsPanel.tsx`, `apps/desktop/src/settings/SoundsPanel.tsx`, `apps/desktop/src/settings/SettingsScreen.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts` (reste du bloc `settings`), `apps/desktop/src/styles/app.css` (port de `settings.css`)
- Test: `apps/desktop/test/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `Toggle`, `SelectRow` (tâche 7) ; `MachinesPanel`, `MachineFleet` (tâche 6) ; `AboutPanel` (tâche 7) ; `Updater` (tâche 5) ; `DaemonUpdate` (tâche 5) ; `useSoundPrefs`, `useDnd`, `resetSoundPrefsForTests`, `resetDndForTests` (tâche 2, `src/notify/prefs.ts`) ; `useTheme`, `setTheme`, `useAccent`, `setAccent`, `THEMES`, `resetAppearanceForTests` (tâche 2) ; `loadTool`, `saveTool`, `TOOLS` (`src/launch/form.ts`) ; `TOOL_NAMES` (`src/shell/Person.tsx`) ; `loadUiScale`, `saveUiScale` (tâche 2) ; `UI_SCALES`, `UiScale` (`@ledge/ui/scale`) ; `DEFAULT_ACCENT`, `parseAccent` (`@ledge/ui/accent`) ; `FINISHED_VALUES`, `VOLUMES`, `CATEGORIES` (`@ledge/ui/sounds/preferences`) ; `useMotionPreferences` (`src/motionPreferences.ts`) ; `getAutostart`, `setAutostart` (`src/tauri/bridge.ts`) ; `LocalDownNotice` (`src/shell/OfflineNotice.tsx`) ; `Lang`, `LANGS` (`src/i18n/messages.ts`).
- Produces:
  - `src/settings/SettingsScreen.tsx` : `type SettingsTab = 'display' | 'machines' | 'notifications' | 'sounds' | 'about'` ; `SETTINGS_TABS: readonly SettingsTab[]` ; `interface SettingsScreenProps { tab: SettingsTab; onTab(tab: SettingsTab): void; onBack(): void; lang: Lang; onLang(lang: Lang): void; machines: readonly MachineState[]; fleet: MachineFleet; localDown: boolean; testSound(): 'played' | 'dnd'; updater: Updater; daemon: DaemonUpdate }` ; `SettingsScreen(props: SettingsScreenProps)` ; bouton de retour `[data-settings-back]`.
  - `DisplayPanel({ lang, onLang })`, `NotificationsPanel()`, `SoundsPanel({ testSound })`.
  - `t.settings.{title, subtitle, back, nav, tabs, display, notifications, sounds}`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/settings-screen.test.tsx` :

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SettingsScreen, type SettingsTab } from '../src/settings/SettingsScreen';
import { createUpdater } from '../src/update/store';
import { resetDndForTests, resetSoundPrefsForTests } from '../src/notify/prefs';
import { resetAppearanceForTests } from '../src/shell/theme';
import type { DaemonUpdate } from '../src/update/daemon';
import { machine } from './launch-helpers';
import { fakeMachineFleet } from './settings-helpers';

const daemon: DaemonUpdate = { offer: 'none', journal: [], running: false, start: vi.fn() };
beforeEach(() => { localStorage.clear(); resetSoundPrefsForTests(); resetDndForTests(); resetAppearanceForTests(); });

function Harness({ first = 'display', localDown = false, testSound = () => 'played' as const, onBack = () => {}, onLang = () => {} }: { first?: SettingsTab; localDown?: boolean; testSound?: () => 'played' | 'dnd'; onBack?: () => void; onLang?: (l: 'fr' | 'en') => void }) {
  const [tab, setTab] = useState<SettingsTab>(first);
  return <SettingsScreen tab={tab} onTab={setTab} onBack={onBack} lang="en" onLang={onLang} machines={[machine('local')]} fleet={fakeMachineFleet()}
    localDown={localDown} testSound={testSound} updater={createUpdater({ check: async () => null, every: () => () => {} })} daemon={daemon} />;
}
const panel = () => screen.getByRole('region', { name: /^(Display|Machines|Notifications|Sounds|About)$/ });

describe('the settings screen', () => {
  it('has its heading, five sections and a way back', async () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['Display', 'Machines', 'Notifications', 'Sounds', 'About']);
    expect(within(nav).getByRole('button', { name: 'Display' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav).getByRole('button', { name: 'Sounds' }));
    expect(panel()).toHaveAccessibleName('Sounds');
    expect(within(nav).getByRole('button', { name: 'Sounds' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Display: language, harness, theme, scale and reduced motion apply and are kept', async () => {
    const onLang = vi.fn();
    render(<Harness onLang={onLang} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'fr');
    expect(onLang).toHaveBeenCalledWith('fr');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default harness' }), 'codex');
    expect(localStorage.getItem('desktop.tool')).toBe('"codex"');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light');
    expect(localStorage.getItem('desktop.theme')).toBe('light');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Interface scale' }), '1.5');
    expect(localStorage.getItem('desktop.panelScale')).toBe('1.5');
    await userEvent.click(screen.getByRole('switch', { name: 'Reduced motion' }));
    expect(localStorage.getItem('desktop.reducedMotion')).toBe('true');
  });

  it('Display: launch at start-up is off outside the installed app', async () => {
    render(<Harness />);
    expect(await screen.findByText('Available in the installed app.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Launch at start-up' })).toBeDisabled();
  });

  it('Display: a wrong colour is refused, a right one applied, Coral resets', async () => {
    render(<Harness />);
    const hex = screen.getByRole('textbox', { name: 'Hex code' });
    await userEvent.clear(hex);
    await userEvent.type(hex, '#zz');
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid colour: use # and six hexadecimal characters.');
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    await userEvent.clear(hex);
    await userEvent.type(hex, '#3366FF');
    expect(localStorage.getItem('desktop.accent')).toBe('#3366ff');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Coral' }));
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    expect(hex).toHaveValue('#e85d4a');
  });

  it('Notifications: do not disturb and the finish alert', async () => {
    render(<Harness first="notifications" />);
    await userEvent.click(screen.getByRole('switch', { name: 'Do not disturb' }));
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    const finished = screen.getByRole('combobox', { name: 'When a bot or Ledge is done' });
    expect(finished).toHaveValue('both');
    await userEvent.selectOptions(finished, 'bubble');
    expect(localStorage.getItem('desktop.notify')).toBe('bubble');
  });

  it('Sounds: off by default on Desktop, the options follow the switch, Test says when do not disturb is on', async () => {
    const testSound = vi.fn<() => 'played' | 'dnd'>(() => 'dnd');
    render(<Harness first="sounds" testSound={testSound} />);
    const on = screen.getByRole('switch', { name: 'Sounds' });
    expect(on).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Volume' })).toBeDisabled();
    await userEvent.click(on);
    expect(screen.getByRole('combobox', { name: 'Volume' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(testSound).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Do not disturb is on.');
    const team = screen.getByRole('checkbox', { name: 'A bot arrives or leaves' });
    expect(team).not.toBeChecked();
    await userEvent.click(team);
    expect(JSON.parse(localStorage.getItem('desktop.sounds')!)).toMatchObject({ enabled: true, categories: { team: true } });
  });

  it('opens while the local daemon is down, with its notice as a status and Machines frozen', async () => {
    render(<Harness first="machines" localDown />);
    expect(screen.getByRole('status')).toHaveTextContent('Local daemon unreachable');
    expect(screen.getByRole('button', { name: '＋ Add a machine' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- settings-screen`
Expected: FAIL — `Failed to resolve import "../src/settings/SettingsScreen"`.

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/i18n/messages.ts` — import en tête : `import type { FinishedNotify, SoundCategory, SoundVolume } from '@ledge/ui/sounds/preferences';`. Dans `fr.settings`, **avant** `machines` :

```ts
    title: 'Paramètres',
    subtitle: 'Personnalisez votre application Desktop et ses connexions.',
    back: 'Retour aux sessions',
    nav: 'Sections des paramètres',
    tabs: { display: 'Affichage', machines: 'Machines', notifications: 'Notifications', sounds: 'Sons', about: 'À propos' },
    display: {
      title: 'Votre application',
      autostart: 'Lancer au démarrage', autostartHint: 'Avec votre session Windows.', autostartMissing: 'Disponible dans l’application installée.',
      tool: 'Harnais par défaut', toolHint: 'Pour les nouvelles sessions et le chat Ledge.',
      lang: 'Langue', langHint: 'S’applique tout de suite, menu de la zone de notification compris.', langs: { fr: 'Français', en: 'English' } as Record<Lang, string>,
      scale: 'Échelle de l’interface', scaleHint: 'Taille du texte et des contrôles de Desktop.', auto: 'Auto',
      theme: 'Thème', themeHint: 'Change aussi la matière des mascottes.', themes: { dark: 'Sombre · Signal', light: 'Clair · Galet' },
      accent: 'Couleur de Ledge', accentHint: 'Accent personnalisable. Les couleurs des états restent inchangées.', hex: 'Code hexadécimal', coral: 'Corail',
      accentInvalid: 'Couleur invalide : utilisez # et six caractères hexadécimaux.',
      reduced: 'Mouvements réduits', reducedHint: 'Les états restent lisibles sans animation. La préférence système reste prioritaire.'
    },
    notifications: {
      title: 'Quand l’équipe a besoin de vous',
      dnd: 'Ne pas déranger', dndHint: 'Suspend les alertes et les sons ; les demandes restent visibles dans les sessions.',
      finished: 'Quand un bot ou Ledge a terminé', finishedHint: 'Choisissez comment Desktop vous avertit.',
      modes: { both: 'Alerte et son', bubble: 'Alerte visuelle', sound: 'Son', none: 'État de session uniquement' } as Record<FinishedNotify, string>,
      note: 'L’état de la session reste toujours visible, même sans alerte ni son.'
    },
    sounds: {
      title: 'Les signaux de votre équipe',
      enabled: 'Sons', enabledHint: 'Des tons courts et doux. Jamais en Ne pas déranger.',
      custom: 'Personnaliser les sons',
      volume: 'Volume', volumeHint: 'Le bouton Test représente le signal de question.',
      volumes: { quiet: 'Bas', normal: 'Normal', loud: 'Fort' } as Record<SoundVolume, string>,
      test: 'Test', dndOn: 'Ne pas déranger est activé.',
      when: 'Jouer un son quand',
      categories: { requests: 'Un bot a besoin de vous · accord, question', finished: 'Un bot ou Ledge a terminé sa tâche', errors: 'Quelque chose échoue', decisions: 'Vous acceptez ou refusez', team: 'Un bot arrive ou part' } as Record<SoundCategory, string>,
      behind: 'Seulement quand le terminal est derrière', behindHint: 'Pas de son si Windows Terminal est au premier plan. L’alerte visuelle reste disponible.',
      note: 'Un seul son à la fois ; les rafales sont regroupées. Ouvrir, fermer et survoler restent silencieux.'
    },
```

dans `en.settings`, avant `machines` :

```ts
    title: 'Settings',
    subtitle: 'Make Desktop yours and manage its connections.',
    back: 'Back to sessions',
    nav: 'Settings sections',
    tabs: { display: 'Display', machines: 'Machines', notifications: 'Notifications', sounds: 'Sounds', about: 'About' },
    display: {
      title: 'Your app',
      autostart: 'Launch at start-up', autostartHint: 'With your Windows session.', autostartMissing: 'Available in the installed app.',
      tool: 'Default harness', toolHint: 'For new sessions and the Ledge chat.',
      lang: 'Language', langHint: 'Applies at once, the notification area menu included.', langs: { fr: 'Français', en: 'English' },
      scale: 'Interface scale', scaleHint: 'Size of Desktop’s text and controls.', auto: 'Auto',
      theme: 'Theme', themeHint: 'Also changes the mascots’ material.', themes: { dark: 'Dark · Signal', light: 'Light · Pebble' },
      accent: 'Ledge colour', accentHint: 'Your own accent. State colours stay the same.', hex: 'Hex code', coral: 'Coral',
      accentInvalid: 'Invalid colour: use # and six hexadecimal characters.',
      reduced: 'Reduced motion', reducedHint: 'States stay readable without animation. The system setting wins.'
    },
    notifications: {
      title: 'When the team needs you',
      dnd: 'Do not disturb', dndHint: 'Holds alerts and sounds; requests stay visible in the sessions.',
      finished: 'When a bot or Ledge is done', finishedHint: 'Choose how Desktop tells you.',
      modes: { both: 'Alert and sound', bubble: 'Visual alert', sound: 'Sound', none: 'Session state only' },
      note: 'The session state always stays visible, even without an alert or a sound.'
    },
    sounds: {
      title: 'Your team’s signals',
      enabled: 'Sounds', enabledHint: 'Short, soft tones. Never in Do not disturb.',
      custom: 'Customise sounds',
      volume: 'Volume', volumeHint: 'The Test button plays the question signal.',
      volumes: { quiet: 'Low', normal: 'Normal', loud: 'Loud' },
      test: 'Test', dndOn: 'Do not disturb is on.',
      when: 'Play a sound when',
      categories: { requests: 'A bot needs you · approval, question', finished: 'A bot or Ledge has finished its task', errors: 'Something fails', decisions: 'You allow or deny', team: 'A bot arrives or leaves' },
      behind: 'Only when the terminal is behind', behindHint: 'No sound when Windows Terminal is in front. The visual alert stays available.',
      note: 'One sound at a time; bursts are grouped. Opening, closing and hovering stay silent.'
    },
```

**3b.** `apps/desktop/src/settings/DisplayPanel.tsx` :

```tsx
import { useEffect, useState } from 'react';
import { DEFAULT_ACCENT, parseAccent } from '@ledge/ui/accent';
import { UI_SCALES, type UiScale } from '@ledge/ui/scale';
import type { Tool } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { LANGS, type Lang } from '../i18n/messages';
import { loadTool, saveTool, TOOLS } from '../launch/form';
import { TOOL_NAMES } from '../shell/Person';
import { setAccent, setTheme, THEMES, useAccent, useTheme, type Theme } from '../shell/theme';
import { useMotionPreferences } from '../motionPreferences';
import { getAutostart, setAutostart } from '../tauri/bridge';
import { loadUiScale, saveUiScale } from './scale';
import { SelectRow, Toggle } from './controls';

const scaleLabel = (s: UiScale, auto: string) => (s === 'auto' ? auto : `${Math.round(s * 100)} %`);

/** Settings › Display (spec §9.4; decisions 8, 9, 10): every choice applies at once and is kept. */
export function DisplayPanel({ lang, onLang }: { lang: Lang; onLang(lang: Lang): void }) {
  const { t } = useI18n();
  const c = t.settings.display;
  const theme = useTheme();
  const motion = useMotionPreferences();
  const [tool, setTool] = useState<Tool>(loadTool);
  const [scale, setScale] = useState<UiScale>(loadUiScale);
  // undefined while asking Windows; null when launch at login is not offered (browser, dev build).
  const [autostart, setAuto] = useState<boolean | null | undefined>(undefined);
  useEffect(() => { let live = true; void getAutostart().then(v => { if (live) setAuto(v); }); return () => { live = false; }; }, []);

  return (
    <>
      <h3>{c.title}</h3>
      <Toggle label={c.autostart} hint={autostart === null ? c.autostartMissing : c.autostartHint} checked={autostart === true} disabled={autostart == null}
        onChange={on => { setAuto(on); void setAutostart(on).then(v => setAuto(v)); }} />
      <SelectRow label={c.tool} hint={c.toolHint} value={tool} options={TOOLS.map(v => [v, TOOL_NAMES[v]] as const)}
        onChange={v => { setTool(v); saveTool(v); }} />
      <SelectRow label={c.lang} hint={c.langHint} value={lang} options={LANGS.map(l => [l, c.langs[l]] as const)} onChange={onLang} />
      <SelectRow label={c.scale} hint={c.scaleHint} value={String(scale)} options={UI_SCALES.map(s => [String(s), scaleLabel(s, c.auto)] as const)}
        onChange={v => { const s = (v === 'auto' ? 'auto' : Number(v)) as UiScale; setScale(s); void saveUiScale(s); }} />
      <SelectRow label={c.theme} hint={c.themeHint} value={theme} options={THEMES.map(v => [v, c.themes[v]] as const)} onChange={(v: Theme) => setTheme(v)} />
      <AccentRow />
      <Toggle label={c.reduced} hint={c.reducedHint} checked={motion.app} onChange={on => motion.setReduced(on)} />
    </>
  );
}

/** The accent: the colour picker and the hex field both apply a valid #rrggbb at once; Coral removes `desktop.accent`. */
function AccentRow() {
  const { t } = useI18n();
  const c = t.settings.display;
  const accent = useAccent();
  const [draft, setDraft] = useState(accent ?? DEFAULT_ACCENT);
  const [invalid, setInvalid] = useState(false);
  const apply = (v: string) => {
    setDraft(v);
    const ok = parseAccent(v);
    if (ok) { setInvalid(false); setAccent(ok); }
  };
  return (
    <div className="setting-row">
      <span><strong>{c.accent}</strong><small>{c.accentHint}</small>{invalid && <small className="setting-error" role="alert">{c.accentInvalid}</small>}</span>
      <div className="accent-fields">
        <input type="color" aria-label={c.accent} value={parseAccent(draft) ?? accent ?? DEFAULT_ACCENT} onChange={e => apply(e.target.value)} />
        <input type="text" aria-label={c.hex} value={draft} maxLength={7} spellCheck={false} aria-invalid={invalid || undefined}
          onChange={e => apply(e.target.value)} onBlur={() => setInvalid(parseAccent(draft) === null)} />
        <button type="button" className="settings-button" onClick={() => { setAccent(null); setDraft(DEFAULT_ACCENT); setInvalid(false); }}>{c.coral}</button>
      </div>
    </div>
  );
}
```

**3c.** `apps/desktop/src/settings/NotificationsPanel.tsx` :

```tsx
import { FINISHED_VALUES } from '@ledge/ui/sounds/preferences';
import { useI18n } from '../i18n/lang';
import { useDnd, useSoundPrefs } from '../notify/prefs';
import { SelectRow, Toggle } from './controls';

/** Settings › Notifications (spec §10; decisions 5, 6): do not disturb and how a finished task is announced. */
export function NotificationsPanel() {
  const { t } = useI18n();
  const c = t.settings.notifications;
  const [dnd, setDnd] = useDnd();
  const { finished, setFinished } = useSoundPrefs();
  return (
    <>
      <h3>{c.title}</h3>
      <Toggle label={c.dnd} hint={c.dndHint} checked={dnd} onChange={setDnd} />
      <SelectRow label={c.finished} hint={c.finishedHint} value={finished} options={FINISHED_VALUES.map(v => [v, c.modes[v]] as const)} onChange={setFinished} />
      <p className="settings-note">{c.note}</p>
    </>
  );
}
```

**3d.** `apps/desktop/src/settings/SoundsPanel.tsx` :

```tsx
import { useState } from 'react';
import { CATEGORIES, VOLUMES } from '@ledge/ui/sounds/preferences';
import { useI18n } from '../i18n/lang';
import { useSoundPrefs } from '../notify/prefs';
import { SelectRow, Toggle } from './controls';

/** Settings › Sounds (spec §10; decision 15): off by default on Desktop; the options are frozen while sounds are off. */
export function SoundsPanel({ testSound }: { testSound(): 'played' | 'dnd' }) {
  const { t } = useI18n();
  const c = t.settings.sounds;
  const { sounds, setSounds } = useSoundPrefs();
  const [dndNote, setDndNote] = useState(false);
  return (
    <>
      <h3>{c.title}</h3>
      <Toggle label={c.enabled} hint={c.enabledHint} checked={sounds.enabled} onChange={on => setSounds({ enabled: on })} />
      <fieldset className="sound-options" disabled={!sounds.enabled}>
        <legend>{c.custom}</legend>
        <SelectRow label={c.volume} hint={c.volumeHint} value={sounds.volume} options={VOLUMES.map(v => [v, c.volumes[v]] as const)} onChange={volume => setSounds({ volume })} />
        <div className="settings-actions">
          <button type="button" className="settings-button" onClick={() => setDndNote(testSound() === 'dnd')}>{c.test}</button>
          {dndNote && <span className="settings-note" role="status">{c.dndOn}</span>}
        </div>
        <h4>{c.when}</h4>
        {CATEGORIES.map(k => (
          <label key={k} className="sound-category">
            <input type="checkbox" checked={sounds.categories[k]} onChange={e => setSounds({ categories: { [k]: e.target.checked } })} />{c.categories[k]}
          </label>
        ))}
        <Toggle label={c.behind} hint={c.behindHint} checked={sounds.onlyWhenTerminalBehind} onChange={on => setSounds({ onlyWhenTerminalBehind: on })} />
      </fieldset>
      <p className="settings-note">{c.note}</p>
    </>
  );
}
```

**3e.** `apps/desktop/src/settings/SettingsScreen.tsx` :

```tsx
import type { MachineState } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import type { Lang } from '../i18n/messages';
import { LocalDownNotice } from '../shell/OfflineNotice';
import type { Updater } from '../update/store';
import type { DaemonUpdate } from '../update/daemon';
import type { MachineFleet } from './useMachineEditor';
import { AboutPanel } from './AboutPanel';
import { DisplayPanel } from './DisplayPanel';
import { MachinesPanel } from './MachinesPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { SoundsPanel } from './SoundsPanel';

export type SettingsTab = 'display' | 'machines' | 'notifications' | 'sounds' | 'about';
export const SETTINGS_TABS: readonly SettingsTab[] = ['display', 'machines', 'notifications', 'sounds', 'about'];
export interface SettingsScreenProps {
  tab: SettingsTab; onTab(tab: SettingsTab): void; onBack(): void;
  lang: Lang; onLang(lang: Lang): void;
  machines: readonly MachineState[]; fleet: MachineFleet; localDown: boolean;
  testSound(): 'played' | 'dnd'; updater: Updater; daemon: DaemonUpdate;
}

/** The settings screen (spec §9.4; mockup settings.js `render`): it takes the heading's and the sessions' place, as the
 *  launch screen does; the panel scrolls inside the window. Openable while the local daemon is down (decision 16). */
export function SettingsScreen(p: SettingsScreenProps) {
  const { t } = useI18n();
  const s = t.settings;
  return (
    <section className="settings-screen" aria-label={s.title}>
      <header className="view-heading settings-heading">
        <div><h2>{s.title}</h2><p>{s.subtitle}</p></div>
        <button type="button" className="settings-button" data-settings-back onClick={p.onBack}><span aria-hidden="true">← </span>{s.back}</button>
      </header>
      {p.localDown && <LocalDownNotice role="status" />}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={s.nav}>
          {SETTINGS_TABS.map(id => (
            <button key={id} type="button" data-settings-tab={id} aria-current={id === p.tab ? 'page' : undefined} onClick={() => p.onTab(id)}>{s.tabs[id]}</button>
          ))}
        </nav>
        <section className="settings-panel" aria-label={s.tabs[p.tab]}>
          {p.tab === 'display' && <DisplayPanel lang={p.lang} onLang={p.onLang} />}
          {p.tab === 'machines' && <MachinesPanel machines={p.machines} fleet={p.fleet} localDown={p.localDown} />}
          {p.tab === 'notifications' && <NotificationsPanel />}
          {p.tab === 'sounds' && <SoundsPanel testSound={p.testSound} />}
          {p.tab === 'about' && <AboutPanel machines={p.machines} updater={p.updater} daemon={p.daemon} />}
        </section>
      </div>
    </section>
  );
}
```

Le nom accessible du bouton de retour est « Retour aux sessions » / « Back to sessions » (la flèche est `aria-hidden`), comme celui de l'écran de lancement ; les deux écrans ne sont jamais affichés ensemble.

**3f.** `apps/desktop/src/styles/app.css` — ajouter à la fin (port de `mockup/assets/settings.css`, adapté pour remplir la fenêtre : pas de `max-height` sur le panneau, qui défile dans la hauteur restante ; les règles `.settings-button` et `.settings-heading` existantes ne sont pas répétées) :

```css
/* From the mockup's settings.css: the settings screen fills the content column and scrolls inside its panel. */
.settings-screen { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.settings-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 165px minmax(0,1fr); }
.settings-nav { display: flex; flex-direction: column; gap: 5px; padding: 22px 12px; border-right: 1px solid var(--sidebar-border); }
.settings-nav button { background: transparent; padding: 11px 12px; border-radius: 6px; text-align: left; font-size: 12px; color: var(--muted-foreground); }
.settings-nav button[aria-current] { background: var(--sidebar-accent); color: var(--sidebar-foreground); box-shadow: inset 2px 0 var(--sidebar-primary); }
.settings-panel { padding: 20px 30px 28px; min-height: 0; overflow: auto; min-width: 0; scrollbar-width: thin; scrollbar-color: var(--input) transparent; }
.settings-panel h3 { font-size: 16px; font-weight: 550; margin: 21px 0 6px; }
.settings-panel h4 { font-size: 12px; font-weight: 550; margin: 15px 0; }
.setting-row { position: relative; display: flex; gap: 20px; align-items: center; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--sidebar-border); }
.setting-row > span:first-child { flex: 1; min-width: 0; }
.setting-row strong { display: block; font-size: 12px; font-weight: 550; }
.setting-row small, .machine-form small { display: block; color: var(--muted-foreground); font-size: 10px; line-height: 1.65; margin-top: 5px; }
.setting-row select, .accent-fields input, .machine-form input { font: inherit; font-size: 11px; color: var(--sidebar-foreground); background: var(--well); border: 1px solid var(--input); border-radius: 6px; padding: 8px 10px; }
.setting-row select { max-width: 46%; min-width: 120px; }
.setting-row input:focus-visible, .setting-row select:focus-visible, .machine-form input:focus-visible { outline: 2px solid var(--sidebar-primary); outline-offset: 2px; }
.setting-row input[role=switch] { position: absolute; right: 0; width: 35px; height: 20px; opacity: 0; cursor: pointer; z-index: 1; }
.setting-switch { width: 35px; height: 20px; border-radius: 20px; flex: 0 0 35px; background: var(--muted); border: 1px solid var(--input); position: relative; }
.setting-switch::after { content: ''; width: 12px; height: 12px; background: var(--muted-foreground); border-radius: 50%; position: absolute; left: 3px; top: 3px; }
.setting-row input:checked + .setting-switch { background: var(--sidebar-primary); }
.setting-row input:checked + .setting-switch::after { left: 18px; background: var(--primary-foreground); }
.setting-row input:focus-visible + .setting-switch { outline: 2px solid var(--sidebar-primary); outline-offset: 3px; }
.setting-row input:disabled + .setting-switch { opacity: .45; }
.accent-fields { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.accent-fields input[type=color] { padding: 2px; width: 32px; height: 30px; }
.accent-fields input[type=text] { width: 80px; font-family: monospace; }
.settings-note { color: var(--muted-foreground); font-size: 11px; line-height: 1.8; }
.settings-note code, .update-journal code { display: block; margin-top: 6px; font-size: 10px; overflow-wrap: anywhere; }
.sound-options { margin: 15px 0 0; padding: 0; border: 0; min-width: 0; }
.sound-options legend { font-size: 12px; font-weight: 550; }
.sound-options:disabled { opacity: .45; }
.sound-category { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 11px; }
.sound-category input { accent-color: var(--sidebar-primary); width: 15px; height: 15px; }
.settings-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 13px 0; }
.settings-button:disabled { opacity: .5; cursor: default; }
.settings-machine { padding: 17px 0; border-bottom: 1px solid var(--sidebar-border); }
.settings-machine > div:first-child { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.settings-machine strong { font-size: 13px; font-weight: 550; overflow-wrap: anywhere; }
.settings-machine p { font-size: 10px; color: var(--muted-foreground); line-height: 1.6; }
.machine-status { display: flex; gap: 6px; align-items: center; color: var(--muted-foreground); font-size: 10px; white-space: nowrap; }
.machine-form { background: var(--well); border: 1px solid var(--input); border-radius: 8px; padding: 0 17px 12px; margin-top: 18px; }
.machine-form label { display: flex; flex-direction: column; gap: 6px; font-size: 11px; margin-bottom: 15px; }
.machine-form details { font-size: 10px; color: var(--muted-foreground); line-height: 1.8; }
.machine-form summary { cursor: pointer; }
.machine-confirm { font-size: 11px; line-height: 1.8; padding: 10px 12px; background: var(--well); border: 1px solid var(--input); border-radius: 6px; }
.setting-error { color: var(--danger-text); font-size: 11px; }
.version-list { padding: 12px 0; margin: 0; border-bottom: 1px solid var(--sidebar-border); }
.version-list > div { display: flex; justify-content: space-between; gap: 15px; font-size: 11px; padding: 8px 0; }
.version-list dt { color: var(--muted-foreground); }
.version-list dd { margin: 0; text-align: right; }
.update-journal { font-size: 11px; line-height: 1.8; padding-left: 18px; }
.update-journal small { display: block; color: var(--muted-foreground); }
.settings-shortcut { position: relative; padding: 8px 10px; background: transparent; border: 1px solid var(--input); border-radius: 6px; font-size: 13px; }
.update-pip { position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--sidebar-primary); box-shadow: 0 0 0 2px var(--sidebar); }
@media (max-width: 950px) { .settings-layout { grid-template-columns: 135px minmax(0,1fr); } .settings-panel { padding: 18px; } .setting-row { gap: 12px; } }
@media (max-width: 570px) {
  .settings-layout { display: flex; flex-direction: column; }
  .settings-nav { flex-direction: row; flex-wrap: wrap; border-right: 0; border-bottom: 1px solid var(--sidebar-border); padding: 10px; gap: 3px; }
  .settings-nav button { padding: 8px 9px; font-size: 10px; }
  .settings-panel { flex: 1; padding: 15px; }
  .setting-row { flex-wrap: wrap; } .setting-row select { min-width: 110px; }
  .setting-row:has(.accent-fields) > span { flex-basis: 100%; }
}
```

`--well` et `--danger-text` sont des jetons de `packages/ui/src/styles/tokens.css` (thèmes sombre et clair) ; aucun jeton nouveau.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/DisplayPanel.tsx apps/desktop/src/settings/NotificationsPanel.tsx apps/desktop/src/settings/SoundsPanel.tsx apps/desktop/src/settings/SettingsScreen.tsx apps/desktop/src/i18n/messages.ts apps/desktop/src/styles/app.css apps/desktop/test/settings-screen.test.tsx
git commit -m "feat(desktop): settings screen with display, notifications and sounds sections"
```

---

### Task 9: Shell — ⚙ et « Paramètres des machines », langue à chaud, alertes, tray, mises à jour

L'écran Paramètres prend la place de la tête et des sessions comme l'écran de lancement (décision 12) : la vue, le filtre, le regroupement, la sélection et le panneau restent dans le `Shell` et retrouvent leur état au retour (spec §12, « conservation au retour des paramètres »). La langue devient un état de `App` (décision 8), les alertes sont branchées sur le fleet réel (tâche 4), le tray bascule Ne pas déranger sans ouvrir la fenêtre et reçoit ses libellés traduits (décisions 6 et 7).

**Files:**
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/shell/Heading.tsx`, `apps/desktop/src/shell/OfflineNotice.tsx`, `apps/desktop/src/i18n/messages.ts` (`tray`, `settingsShortcut`, `offline.settings`)
- Modify: `apps/desktop/test/app-tray.test.tsx` (le premier test), `apps/desktop/test/team-view.test.tsx` (un test dans `describe('Heading')`)
- Test: `apps/desktop/test/app-settings.test.tsx`

**Interfaces:**
- Consumes: `SettingsScreen`, `SettingsTab` (tâche 8) ; `useAlerts`, `Alerts` (tâche 4) ; `updater`, `useUpdate`, `updateReady` (tâche 5, `src/update/store.ts`) ; `useDaemonUpdate`, `daemonTarget` (tâche 5, `src/update/daemon.ts`) ; `useDnd`, `getDnd`, `setDnd`, `resetDndForTests`, `resetSoundPrefsForTests` (tâche 2) ; `useAppearance`, `resetAppearanceForTests` (tâche 2) ; `setTrayLabels`, `TrayLabels` (tâche 3) ; `onTrayAction`, `TrayAction` (`src/tauri/bridge.ts`, lot 3) ; `loadLang`, `saveLang`, `LangProvider`, `useI18n` (`src/i18n/lang.tsx`) ; `blocked` (`src/conversation/sends.ts`) ; `Conversations` (`src/conversation/useConversations.ts`) ; lots 5 et 6 dans `Shell` : `launching`, `canLaunch`, `openLaunch`, `opener`, `trayNew`, `offline` / `notices`, `chat`, `chatEntry`.
- Produces:
  - `Heading` prend `onSettings?: () => void` et `updateReady?: boolean` → `button.settings-shortcut[data-open-settings]` après « Nouvelle session » (nom accessible `t.settingsShortcut.label`, ou `t.settingsShortcut.update` avec `span.update-pip` quand `updateReady`).
  - `OfflineNotice` prend `onSettings?: () => void` → `button.settings-button[data-open-machines]` (`t.offline.settings`).
  - `Shell({ client, lang, onLang })` ; `App` tient `lang` et l'applique à `document.documentElement.lang`.
  - `t.tray: { open, newSession, dnd, dndOff, quit }` ; `t.settingsShortcut: { label, update }` ; `t.offline.settings`.

- [ ] **Step 1: Write the failing tests**

Dans `apps/desktop/test/team-view.test.tsx`, dans `describe('Heading')`, ajouter (avec `OfflineNotice` importé de `'../src/shell/OfflineNotice'` et `machine` de `'./launch-helpers'` s'ils ne le sont pas déjà) :

```tsx
  it('⚙ sits after New session, with a pip when an update is ready', async () => {
    const onSettings = vi.fn();
    const { rerender } = render(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} onSettings={onSettings} />);
    const gear = screen.getByRole('button', { name: 'Settings' });
    expect(gear).toHaveAttribute('data-open-settings');
    expect(gear.previousElementSibling).toHaveTextContent('New session');
    expect(gear.querySelector('.update-pip')).toBeNull();
    await userEvent.click(gear);
    expect(onSettings).toHaveBeenCalledOnce();
    rerender(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} onSettings={onSettings} updateReady />);
    expect(screen.getByRole('button', { name: 'Settings · update available' }).querySelector('.update-pip')).not.toBeNull();
  });

  it('a disconnected machine offers its settings next to Retry', async () => {
    const onSettings = vi.fn();
    render(<OfflineNotice machines={[machine('local'), machine('devbox', { status: 'unreachable', ready: false })]} onRetry={vi.fn()} onSettings={onSettings} />);
    const button = screen.getByRole('button', { name: 'Machine settings' });
    expect(button).toHaveAttribute('data-open-machines');
    await userEvent.click(button);
    expect(onSettings).toHaveBeenCalledOnce();
  });
```

Dans `apps/desktop/test/app-tray.test.tsx` : ajouter `import { resetDndForTests } from '../src/notify/prefs';`, appeler `resetDndForTests()` juste après `localStorage.clear()` dans `boot()`, et remplacer le premier test par :

```tsx
  it('opens the launch screen; « open » changes nothing, « dnd » only switches do not disturb', async () => {
    await boot();
    act(() => tray.fire!('open'));
    act(() => tray.fire!('dnd'));
    expect(form()).toBeNull();
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    act(() => tray.fire!('new'));
    expect(form()).not.toBeNull();
    expect(screen.getByLabelText('Machine')).toHaveFocus();
  });
```

`apps/desktop/test/app-settings.test.tsx` :

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { TrayAction, TrayLabels } from '../src/tauri/bridge';

// The tray exists only in Tauri: the test takes the Shell's listener and records the labels it sends.
const tray = vi.hoisted(() => ({ fire: null as null | ((a: TrayAction) => void), labels: [] as TrayLabels[] }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  onTrayAction: (fn: (a: TrayAction) => void) => { tray.fire = fn; return () => { tray.fire = null; }; },
  setTrayLabels: (l: TrayLabels) => { tray.labels.push(l); }
}));
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { resetDndForTests, resetSoundPrefsForTests } from '../src/notify/prefs';
import { resetAppearanceForTests } from '../src/shell/theme';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); document.documentElement.lang = ''; for (const d of daemons.splice(0)) await d.close(); });

/** Two sessions waiting on local; the team view with the attention filter on and Luna selected. */
async function boot() {
  localStorage.clear(); resetDndForTests(); resetSoundPrefsForTests(); resetAppearanceForTests(); tray.labels.length = 0;
  localStorage.setItem('desktop.view', JSON.stringify({ view: 'team', attentionOnly: true }));
  localStorage.setItem('desktop.selected', 'local:luna');
  const d = await createMockDaemon(); daemons.push(d);
  d.upsert(fakeSession('otto', { name: 'Otto', state: 'waiting_permission' }));
  d.upsert(fakeSession('luna', { name: 'Luna', state: 'waiting_input' }));
  d.machines([{ id: 'local', label: 'Local' }]);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:luna'));
  return d;
}
const settingsTitle = () => screen.queryByRole('heading', { level: 2, name: 'Settings' });
const lastLabels = () => tray.labels[tray.labels.length - 1];

describe('the settings screen in the Shell', () => {
  it('replaces the heading and the sessions, then gives back the view, the filter, the selection and the focus', async () => {
    const user = userEvent.setup();
    await boot();
    const stored = localStorage.getItem('desktop.view');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(settingsTitle()).toBeInTheDocument();
    expect(document.querySelector('[data-view]')).toBeNull();
    expect(document.querySelector('#conversation-pane')).toBeNull();
    expect(screen.getByRole('button', { name: 'Display' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Machines' }));
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(settingsTitle()).toBeNull();
    expect(document.querySelector('[data-view="team"]')).toHaveAttribute('aria-pressed', 'true');
    expect(document.getElementById('attention')).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:luna');
    expect(localStorage.getItem('desktop.view')).toBe(stored);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
    // The section is remembered for the session: ⚙ opens Machines again.
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Machines' })).toHaveAttribute('aria-current', 'page');
  });

  it('applies the language at once: the screen, the document and the tray', async () => {
    const user = userEvent.setup();
    await boot();
    expect(lastLabels()).toEqual({ open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge Desktop' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'fr');
    expect(screen.getByRole('heading', { level: 2, name: 'Paramètres' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem('desktop.lang')).toBe('fr');
    expect(lastLabels()).toEqual({ open: 'Ouvrir Ledge Desktop', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', quit: 'Quitter Ledge Desktop' });
    await user.click(screen.getByRole('button', { name: 'Retour aux sessions' }));
    expect(screen.getByRole('button', { name: 'Paramètres' })).toHaveFocus();
  });

  it('tray « Do not disturb » with the window hidden: nothing opens, the label and the switch follow', async () => {
    const user = userEvent.setup();
    await boot();
    act(() => tray.fire!('dnd'));
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    expect(settingsTitle()).toBeNull();
    expect(screen.queryByRole('form', { name: 'New session settings' })).toBeNull();
    expect(lastLabels()).toMatchObject({ dnd: 'Resume alerts' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    const sw = screen.getByRole('switch', { name: 'Do not disturb' });
    expect(sw).toBeChecked();
    act(() => tray.fire!('dnd'));
    expect(sw).not.toBeChecked();
    expect(localStorage.getItem('desktop.dnd')).toBe('0');
    expect(lastLabels()).toMatchObject({ dnd: 'Do not disturb' });
  });

  it('tray « New session » closes the settings and opens the launch screen', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    act(() => tray.fire!('new'));
    expect(settingsTitle()).toBeNull();
    expect(await screen.findByRole('form', { name: 'New session settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'New session' })).toHaveFocus();
  });

  it('Sounds › Test goes through the app’s alerts: do not disturb is said, nothing plays', async () => {
    const user = userEvent.setup();
    await boot();
    act(() => tray.fire!('dnd'));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Sounds' }));
    await user.click(screen.getByRole('switch', { name: 'Sounds' }));
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByRole('status')).toHaveTextContent('Do not disturb is on.');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test -- app-settings app-tray team-view`
Expected: FAIL — pas de bouton « Settings » (`Unable to find role="button" and name "Settings"`), `desktop.dnd` vaut `null` après le « dnd » du tray, `Unable to find role="button" and name "Machine settings"`.

- [ ] **Step 3: Implement**

**3a.** `apps/desktop/src/i18n/messages.ts` — dans `fr`, au niveau racine (après `localDown`) :

```ts
  tray: { open: 'Ouvrir Ledge Desktop', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', dndOff: 'Réactiver les alertes', quit: 'Quitter Ledge Desktop' },
  settingsShortcut: { label: 'Paramètres', update: 'Paramètres · mise à jour disponible' },
```

et dans `fr.offline`, après `retry` : `settings: 'Paramètres des machines'`. Dans `en`, aux mêmes places :

```ts
  tray: { open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', dndOff: 'Resume alerts', quit: 'Quit Ledge Desktop' },
  settingsShortcut: { label: 'Settings', update: 'Settings · update available' },
```

et `settings: 'Machine settings'` dans `en.offline`. Les libellés français du tray sont exactement ceux que `main.rs` construit au démarrage.

**3b.** `apps/desktop/src/shell/Heading.tsx` — la signature (état du lot 6, `chat` compris) devient :

```tsx
export function Heading({ state, dispatch, attentionCount, onNewSession, chat, onSettings, updateReady = false }: {
  state: ViewState; dispatch: (a: ViewAction) => void; attentionCount: number; onNewSession?: () => void;
  chat?: { open: boolean; onOpen: () => void }; onSettings?: () => void; updateReady?: boolean;
}) {
```

et, juste après le bouton `data-open-launch="heading"` :

```tsx
      {onSettings && (
        <button type="button" className="settings-shortcut" data-open-settings aria-label={updateReady ? t.settingsShortcut.update : t.settingsShortcut.label} onClick={onSettings}>
          <span aria-hidden="true">⚙</span>{updateReady && <span className="update-pip" aria-hidden="true" />}
        </button>
      )}
```

Le commentaire de la fonction se termine par « …, Talk to Ledge, New session and ⚙ (with a pip when an app update is ready). ».

**3c.** `apps/desktop/src/shell/OfflineNotice.tsx` :

```tsx
/** One notice per remote machine that has settled as unreachable; `connecting` (boot) never shows one, and local has its own state.
 *  `onSettings` (not inside the launch screen) opens Settings › Machines. */
export function OfflineNotice({ machines, onRetry, onSettings }: { machines: MachineState[]; onRetry: (id: string) => void; onSettings?: () => void }) {
  const { t } = useI18n();
  return <>{machines.filter(m => m.id !== 'local' && m.status === 'unreachable').map(m => (
    <div key={m.id} role="status" className="connection-notice">
      <div><strong>{t.offline.title(m.label)}</strong><p>{t.offline.text}</p></div>
      <button type="button" className="settings-button" data-reconnect onClick={() => onRetry(m.id)}>{t.offline.retry}</button>
      {onSettings && <button type="button" className="settings-button" data-open-machines onClick={onSettings}>{t.offline.settings}</button>}
    </div>
  ))}</>;
}
```

**3d.** `apps/desktop/src/App.tsx` — lire le fichier réel (état du lot 6) avant de le modifier. Imports à ajouter :

```ts
import { LangProvider, loadLang, saveLang, type Lang } from './i18n/lang';
import { SettingsScreen, type SettingsTab } from './settings/SettingsScreen';
import { useAlerts } from './notify/useAlerts';
import { getDnd, setDnd, useDnd } from './notify/prefs';
import { useAppearance } from './shell/theme';
import { updater, updateReady, useUpdate } from './update/store';
import { daemonTarget, useDaemonUpdate } from './update/daemon';
import { blocked } from './conversation/sends';
import type { Conversations } from './conversation/useConversations';
import { onTrayAction, setTrayLabels } from './tauri/bridge';
```

(l'import existant `LangProvider, loadLang` et celui de `onTrayAction` sont remplacés par ces deux lignes.)

`App` :

```tsx
export function App({ client }: { client?: DaemonClient } = {}) {
  const [lang, setLang] = useState(loadLang);
  // Applies at once (decision 8): every text, the mascots' labels, the tray and the document's language.
  const onLang = useCallback((l: Lang) => { saveLang(l); setLang(l); }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useAppearance();
  return <LangProvider lang={lang}><Shell client={client} lang={lang} onLang={onLang} /></LangProvider>;
}
```

`Shell` : la signature devient `function Shell({ client, lang, onLang }: { client?: DaemonClient; lang: Lang; onLang(l: Lang): void })` ; la ligne `useFleet` lit aussi `status` : `const { sessions, machines, fleet, localDown, status, client: fleetClient } = useFleet(client);`.

Juste après `const conversations = useConversations(…)` (et avant `useChat` du lot 6, qui reçoit désormais `api` là où il recevait `conversations`, s'il le reçoit) :

```tsx
  // Toasts and sounds (spec §10), and the « You allow or deny » sounds (decision 14): played only when the click sends.
  const alerts = useAlerts({ sessions, machines, status });
  const api: Conversations = {
    ...conversations,
    decide(s, decision) {
      if (!blocked(s) && s.pending && conversations.sends.sent[s.id]?.kind !== 'decision') alerts.user(decision);
      conversations.decide(s, decision);
    }
  };
  // Updates (spec §9.4, §11): checked by `main.tsx`, installed on a click only; the local daemon's offer follows the target.
  const update = useUpdate(updater);
  const daemonUpdate = useDaemonUpdate(fleet, machines, daemonTarget(update));
  // Settings take the heading's and the sessions' place (decision 12); the view state stays in this Shell meanwhile.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('display');
  const settingsFrom = useRef<'heading' | 'machines'>('heading');
  const openSettings = useCallback((from: 'heading' | 'machines') => {
    settingsFrom.current = from;
    if (from === 'machines') setSettingsTab('machines');
    setSettingsOpen(true);
  }, []);
```

Remplacer **chaque** `api={conversations}` du rendu (`ConversationPane`, et `ChatPane` du lot 6) par `api={api}`.

Remplacer le bloc tray du lot 5 (`trayNew` et l'effet `onTrayAction`) par :

```tsx
  // Tray « Nouvelle session » (main.rs shows the window first): closes Settings, then the launch screen. Ignored while
  // read-only; an open screen is left as it is. « Ne pas déranger » switches without showing the window (decision 6).
  const trayNew = useRef<() => void>(() => {});
  useEffect(() => { trayNew.current = () => { if (!canLaunch) return; setSettingsOpen(false); openLaunch('heading'); }; });
  useEffect(() => onTrayAction(action => {
    if (action === 'new') trayNew.current();
    else if (action === 'dnd') setDnd(!getDnd());
  }), []);
  // The tray speaks the app's language and names the way back from do not disturb (decision 7).
  const [dnd] = useDnd();
  useEffect(() => {
    setTrayLabels({ open: t.tray.open, newSession: t.tray.newSession, dnd: dnd ? t.tray.dndOff : t.tray.dnd, quit: t.tray.quit });
  }, [t, dnd]);
```

Après le bloc `wasLaunching` du lot 5 :

```tsx
  // Opening Settings puts the focus on the current section; leaving gives it back to the button that opened them
  // (⚙ when the machine's notice has gone meanwhile). A tray « new » that closed them leaves the launch screen's focus alone.
  const wasSettings = useRef(false);
  useEffect(() => {
    if (settingsOpen && !wasSettings.current) document.querySelector<HTMLElement>('[data-settings-tab][aria-current="page"]')?.focus({ preventScroll: true });
    if (!settingsOpen && wasSettings.current && !launching) {
      (document.querySelector<HTMLElement>(settingsFrom.current === 'machines' ? '[data-open-machines]' : '[data-open-settings]') ?? document.querySelector<HTMLElement>('[data-open-settings]'))?.focus({ preventScroll: true });
    }
    wasSettings.current = settingsOpen;
  }, [settingsOpen, launching]);
```

L'élément `offline` du lot 5 devient une fonction, pour que la notice de l'écran de lancement n'offre pas les Paramètres :

```tsx
  const offline = (inLaunch: boolean) => <OfflineNotice machines={machines} onRetry={id => fleet.retry(id)} onSettings={inLaunch ? undefined : () => openSettings('machines')} />;
```

avec `offline(true)` dans les `notices` passées à `LaunchScreen` et `offline(false)` dans la branche de la tête (directement, ou dans la constante `notices` du lot 6 si elle existe : celle de la branche de la tête prend `offline(false)`).

Le rendu de `.content` devient : `launching ? <LaunchScreen … /> : settingsOpen ? <SettingsScreen … /> : <> … tête du lot 6 … </>`, avec :

```tsx
        {launching ? <LaunchScreen launch={launch} machines={machines} fleet={fleet} notices={<>{localDown && <LocalDownNotice role="status" />}{offline(true)}</>} />
          : settingsOpen ? <SettingsScreen tab={settingsTab} onTab={setSettingsTab} onBack={() => setSettingsOpen(false)} lang={lang} onLang={onLang}
              machines={machines} fleet={fleet} localDown={localDown} testSound={alerts.test} updater={updater} daemon={daemonUpdate} />
          : <>
```

et l'appel de `Heading` (lot 6) prend en plus `onSettings={() => openSettings('heading')} updateReady={updateReady(update)}`. Le reste de la branche (notices, espace vide, `SplitView`, chat) ne change pas, sauf `api={api}`. `StatusBar` reste sous les trois écrans.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm -r typecheck && pnpm --filter desktop exec playwright test`
Expected: PASS (dont `app.test.tsx`, `app-launch.test.tsx`, `app-chat.test.tsx` du lot 6 et les specs Playwright existantes : le ⚙ s'ajoute à la tête sans déplacer les autres boutons).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/shell/Heading.tsx apps/desktop/src/shell/OfflineNotice.tsx apps/desktop/src/i18n/messages.ts apps/desktop/test/app-settings.test.tsx apps/desktop/test/app-tray.test.tsx apps/desktop/test/team-view.test.tsx
git commit -m "feat(desktop): settings from the heading and the offline notice, live language, alerts, tray do-not-disturb and update checks in the shell"
```

---

### Task 10: Parcours Playwright — l'ajout d'une machine et sa réapparition, la notice hors ligne, la mise en page

Le scénario de la spec §12 (« l'ajout d'une machine et sa réapparition dans la liste ») contre un daemon simulé qui tient la liste comme le vrai (spec §5.3) : `machines.set` → diffusion `machines`, la liste survit à un rechargement de la page. Toute erreur console fait échouer le test (`e2e/fixtures.ts`).

**Files:**
- Modify: `apps/desktop/e2e/daemon.ts` (`fakeDaemon` répond à `machines.set`)
- Test: `apps/desktop/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `fakeDaemon`, `fakeRemote`, `session`, `eight` (`e2e/daemon.ts`) ; `test`, `expect` (`e2e/fixtures.ts`) ; le DOM des tâches 6, 8 et 9 : `button[data-open-settings]` (« Settings »), `button[data-open-machines]` (« Machine settings »), `nav` « Settings sections », `article` par machine (nom accessible = son nom), textes « Machine name », « SSH alias », « Save », « Connected », « Disconnected », « Back to sessions », `.settings-panel`.
- Produces: `fakeDaemon(...)` garde la liste des machines : un `machines.set` reçu la remplace et la renvoie en `machines` ; chaque nouvelle connexion (rechargement, reconnexion) reçoit la liste courante.

- [ ] **Step 1: Write the failing test**

`apps/desktop/e2e/settings.spec.ts` (les noms sont `exact` : « Settings » est aussi une sous-chaîne de « Machine settings ») :

```ts
import { test, expect } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session } from './daemon';

const LOCAL = { id: 'local', label: 'Local' };
const DEVBOX = { id: 'devbox', label: 'Devbox', ssh: 'devbox' };

test('adding a machine: the daemon brings it back into the list, its sessions show, and it survives a reload', async ({ page }) => {
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })]);
  await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'working' })]);
  await page.goto('/');
  await expect(page.locator('.seat')).toHaveCount(1);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Machines', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: '＋ Add a machine', exact: true }).click();
  await page.getByRole('textbox', { name: 'Machine name', exact: true }).fill('Devbox');
  await page.getByRole('textbox', { name: 'SSH alias', exact: true }).fill('devbox');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const card = page.getByRole('article', { name: 'Devbox', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Connected');
  await expect(page.getByRole('textbox', { name: 'Machine name', exact: true })).toHaveCount(0);
  const sets = local.received.filter(m => m.type === 'machines.set');
  expect(sets).toHaveLength(1);
  expect(sets[0]).toMatchObject({ machines: [LOCAL, { label: 'Devbox', ssh: 'devbox' }] });

  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();

  // The list lives in the daemon, not in the page.
  await page.reload();
  await expect(page.locator('.seat')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Machines', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Devbox', exact: true })).toContainText('Connected');
});

test('a disconnected machine’s notice opens Settings › Machines, and Back returns to the notice', async ({ page }) => {
  await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })], { machines: [LOCAL, DEVBOX] });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'working' })]);
  await page.goto('/');
  await expect(page.locator('.seat')).toHaveCount(2);
  remote.close();
  await page.getByRole('button', { name: 'Machine settings', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Machines', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('article', { name: 'Devbox', exact: true })).toContainText('Disconnected');
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Machine settings', exact: true })).toBeFocused();
});

for (const size of [{ width: 1280, height: 520 }, { width: 520, height: 700 }]) {
  test(`the settings screen fills a ${size.width}×${size.height} window and scrolls inside its panel`, async ({ page }) => {
    await page.setViewportSize(size);
    await fakeDaemon(page, eight);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    const bar = (await page.locator('.statusbar').boundingBox())!;
    expect(bar.y + bar.height).toBe(size.height);
    const panel = page.locator('.settings-panel');
    const { scroll, client } = await panel.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(scroll).toBeGreaterThan(client);
    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole('switch', { name: 'Reduced motion', exact: true })).toBeInViewport();
  });
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop exec playwright test settings`
Expected: FAIL — le premier test attend l'article « Devbox » : `fakeDaemon` ne répond pas au `machines.set`, le formulaire reste sur « Saving… » puis affiche le message d'expiration après 10 s. Les deux autres passent déjà (tâches 8 et 9).

- [ ] **Step 3: Implement**

`apps/desktop/e2e/daemon.ts`, dans `fakeDaemon` — la liste devient un état du faux daemon, renvoyée à chaque connexion et remplacée par `machines.set` (lire le fichier réel : garder les autres champs et méthodes ajoutés par les lots 5 et 6) :

```ts
/** Simulates the local ledge daemon inside the page: a snapshot, then the machines list, and a `push` for later updates.
 *  Like the daemon (spec §5.3) it keeps the machines list: a `machines.set` replaces it and is broadcast back as `machines`,
 *  and every new connection (reload, reconnect) gets the current list. The route is anchored so it never catches
 *  `/ssh/<alias>` (see `fakeRemote`). Register before `page.goto`. */
export async function fakeDaemon(page: Page, initial: Session[], extras: { machines?: Machines; launcher?: string[]; recents?: Recent[] } = {}) {
  const sessions = new Map(initial.map(s => [s.id, s]));
  const received: ClientMessage[] = [];
  let machines: Machines = extras.machines ?? [{ id: 'local', label: 'Local' }];
  let socket: WebSocketRoute | null = null;
  let up = true;
  await page.routeWebSocket(/127\.0\.0\.1:47831\/?$/, ws => {
    if (!up) { ws.close(); return; }
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...(extras.launcher ? { launcher: extras.launcher } : {}), ...(extras.recents ? { recents: extras.recents } : {}) }));
    ws.send(JSON.stringify({ type: 'machines', machines }));
    ws.onMessage(m => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(m)); } catch { return; }
      received.push(msg);
      if (msg.type === 'machines.set') { machines = msg.machines; ws.send(JSON.stringify({ type: 'machines', machines })); }
    });
  });
```

(le reste de `fakeDaemon` — `push`, `upsert`, `remove`, `launched`, `refuse`, `listing`, `close` et ce que le lot 6 a ajouté — ne change pas.)

Si le gestionnaire `onMessage` du dépôt a déjà été étendu par le lot 6 (réponses au chat), ajouter la seule ligne `if (msg.type === 'machines.set') { … }` après `received.push(…)` dans le gestionnaire existant, et déclarer `let machines` comme ci-dessus.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop exec playwright test && pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS — les trois nouvelles specs et toutes les specs existantes (`offline.spec.ts`, `launch.spec.ts`, `layout.spec.ts`, la spec du chat du lot 6), sans erreur console.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e/daemon.ts apps/desktop/e2e/settings.spec.ts
git commit -m "test(desktop): e2e for adding a machine through the daemon, the offline notice's settings link and the settings layout"
```
