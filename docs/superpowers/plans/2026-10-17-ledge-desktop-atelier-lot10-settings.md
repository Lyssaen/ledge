# Ledge Desktop Atelier, lot 10 : Réglages et notifications — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La page Réglages de la maquette, sur ce qui existe déjà : Général, Apparence, Notifications, Sons, Machines, Projets, Raccourcis et À propos. Chaque changement confirme « Réglage enregistré ». Les sons, les toasts, Ne pas déranger et les mises à jour (application et daemon) sont branchés pour de bon.

**Architecture:**
- La page est un morceau paresseux (`settings/lazy.tsx`, motif de `session/lazy.tsx`), rendu à la place `settings` de la navigation existante.
- La logique est déjà là, dans les stores et ponts de Desktop (`notify/prefs`, `shell/theme`, `settings/scale`, `motionPreferences`, `update/store`, `update/daemon`, `tauri/bridge`), dans `@ledge/fleet` (machines) et dans le daemon (projets). Ce lot ajoute les écrans.
- Il porte depuis `origin/feat/desktop` la logique pure des machines (`settings/machines.ts`, `settings/useMachineEditor.ts`) et le choix d'agent par défaut (`desktop.tool`). Les écrans de cette branche ne sont pas repris (build design § 3).

**Tech Stack:** TypeScript, React 19, Vite 6, vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:**
- Build design : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md`, § 2 (non-objectifs : Réglages › Île et l'état de l'île au pied de page, et les ajouts « à valider plus tard ») et § 7, lot 10 (« sections de la maquette sur le contenu existant, section Projets, toasts, sons, Ne pas déranger, mises à jour »).
- Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` § 7 et § 9 (Ctrl , et Échap).
- Maquette : `docs/mockups/desktop-observatory/settings.tsx` (`SECTIONS`, `SettingsPage`, `Card`, `Row`, `SwitchRow`, `Segmented`, les sections) et `settings.css`.
- Ancienne branche : `git show origin/feat/desktop:apps/desktop/src/settings/<fichier>` et `…:apps/desktop/src/i18n/fr.ts` (bloc `settings.*`).

**Hors de ce lot (ne pas construire) :**
- La section Île, l'état de l'île au pied de page et le raccourci de l'île.
- La plage horaire de Ne pas déranger, la grille événements × canaux, la durée des messages et les six couleurs d'accent proposées.
- L'interrupteur `rememberFolders` : un rangement écrit toujours une règle.
- Les raccourcis « Partout dans Windows », qui appartiennent à l'île et au shell natif.
- « Laisser Ledge organiser » et les propositions : lot 11.
- « Ouvrir le journal » : aucune commande Tauri ne lit le journal du daemon, et il n'y a pas de Rust ici.
- « Réinitialiser les réglages ».

**Décisions de ce plan :**
- **L'agent par défaut** (Général) ne sert qu'au chat de Ledge et à ses cartes. Le formulaire de nouvelle session reste sans choix par défaut (spec § 5, « sans défaut »).
- **Le mode « fin de tâche »** de `origin/feat/desktop` (`desktop.notify`, `both` / `bubble` / `sound` / `none`) va dans Notifications, à côté de Ne pas déranger. C'est le contenu existant de cette section.
- **Les sons** restent coupés par défaut (`enabled: false`, spec du 2026-10-14 § 10), même si la maquette les montre allumés.

## Global Constraints

- Celles des lots 6a à 9, toutes :
  - la maquette fait foi ;
  - les textes vont dans `i18n/fr.ts` et `i18n/en.ts` (lot 9 : une langue par fichier, chargée à la demande), `fr` étant la source de vérité, et l'anglais fixé par les tests est listé par tâche ;
  - rien d'optimiste ;
  - aucune nouvelle dépendance ;
  - pas de Tauri ni de Rust ;
  - la suite unitaire est en anglais ;
  - les commits se terminent par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Clés locales** : préfixe `desktop.`, chaque lecture validée champ par champ (`state/storage.ts` : `readJson`, `isRecord`). Seule clé nouvelle : `desktop.tool` (elle existait sur `origin/feat/desktop` et n'est pas dans `OBSOLETE_KEYS`). Aucune clé de la maquette hors de ce lot n'est créée.
- **« Réglage enregistré · {quoi} »** s'affiche une fois par changement accepté, par le `notify` de l'app. Jamais au montage, jamais pour un changement refusé ou pas encore confirmé (machines, projets : après la diffusion qui le confirme).
- **« En ligne » = `MachineState.ready`.**
- **Le morceau principal reste sous 500 kB** : la page, ses textes (déjà dans les fichiers de langue) et la logique des machines sont dans le morceau paresseux des réglages.
- **Acquis du lot 9** :
  - les quatre morceaux paresseux passent par `shell/ChunkBoundary`, et les réglages aussi ;
  - les messages de Desktop ont déjà des clés `machines` et `time` en haut (copiées de l'île pour le chat) : la section Machines les étend sans les casser ;
  - la config vitest de Desktop fixe `testTimeout` et `maxWorkers` ;
  - changer de langue passe par `loadMessages` (lot 9, tâche 1).

## Review Focus

1. **Changer de langue quand l'autre langue ne se charge pas** : la langue courante reste et le message le dit. Un changement réussi met à jour toute l'app, les libellés du plateau et `<html lang>`. Test à la tâche 2.
2. **Enregistrer une machine quand le daemon local est hors ligne ou ne confirme pas** : le message s'affiche et la liste ne change pas. Le résultat d'un test de connexion ne s'affiche que pour la machine testée. Test à la tâche 4.
3. **Réorienter ou oublier une règle, refusé ou non confirmé** : le message s'affiche, et la liste ne change qu'à la diffusion. Test à la tâche 5.
4. **Démarrage avec Windows non proposé (navigateur) ou en échec** : l'interrupteur est désactivé avec une explication, ou revient en arrière avec un message. Test à la tâche 2.
5. **« Réglage enregistré »** s'affiche une seule fois par changement accepté, jamais au montage ni sur un refus. Tests aux tâches 2 à 5.

---

### Task 1: La page et son branchement

**Files:**
- Create: `apps/desktop/src/settings/{SettingsPage,controls,lazy}.tsx`, `apps/desktop/src/styles/settings.css`, `apps/desktop/test/settings-page.test.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/nav/useKeys.ts`, `apps/desktop/src/i18n/{fr,en}.ts`, `apps/desktop/src/styles/app.css`

**Interfaces:**
- Produces :

```ts
// settings/controls.tsx — les briques de la maquette (settings.tsx l. 97-126)
export function Card(p: { title?: string; hint?: string; children: ReactNode }): JSX.Element;
export function Row(p: { label: string; hint?: ReactNode; stack?: boolean; children: ReactNode }): JSX.Element;
export function SwitchRow(p: { label: string; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange(on: boolean): void }): JSX.Element;
export function Segmented<T extends string>(p: { label: string; value: T; options: readonly { value: T; label: ReactNode }[]; onChange(v: T): void }): JSX.Element;
// settings/SettingsPage.tsx
export interface SettingsContext { notify(text: string): void; saved(what: string): void; /* + ce que les sections reçoivent de Shell : fleet, machines, projects, projectIdOf, sessions, dispatch, alerts, daemonUpdate, lang, setLang */ }
export function SettingsPage(p: { section: SectionId; ctx: SettingsContext }): JSX.Element;
// settings/lazy.tsx
export function loadSettings(): Promise<unknown>;
export function SettingsPlace(p: { section: SectionId; ctx: SettingsContext }): JSX.Element;
```

**La page** (maquette) :
- **La barre de gauche** `.settings-nav` contient :
  - le bouton « Retour à l'atelier » avec `Kbd Échap` ;
  - un `.settings-tab` par section de `SECTIONS` (nav/state.ts), qui a `aria-current="page"` sur la section active ;
  - un point `side-alert` sur Machines quand une machine est hors ligne, et sur À propos quand une mise à jour de l'app ou d'un daemon attend.
- **Le contenu** : `.settings-scroll > .settings-content > header.settings-head`, avec le h1 et l'indication de la section, puis les cartes. Le défilement revient en haut à chaque changement de section.
- **Ce que fait cette tâche** : chaque section rend un `p.muted` provisoire, que les tâches 2 à 5 remplacent.
- **Navigation** : `dispatch({ type: 'settings', section })` change de section, et la place `back` est gardée. Échap ramène à `back` (déjà en place). Ctrl , dans les réglages garde la section courante au lieu de revenir à Général.

**Branchement dans `Shell`** :
- `<SettingsPlace>` remplace le `Pending` de la place `settings`. `loadSettings()` rejoint le préchargement du montage, avec la session, le formulaire et l'éditeur.
- La valeur rendue par `useAlerts` est gardée : `test()` sert au bouton « Tester » des Sons.
- `useDaemonUpdate(fleet, machines, daemonTarget(useUpdate()))` est monté dans `Shell`. Son `running` passe à `useAlerts({ …, daemonUpdating: running })`, pour que le redémarrage du daemon local après une mise à jour ne sonne pas comme une perte.
- `saved(what) = notify(t.settings.saved(what))`.

**Textes** (`settings.*`, fr de la maquette et en) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `back` / `saved(w)` | `Retour à l’atelier` / `Réglage enregistré · ${w}` | `Back to the atelier` / `Setting saved · ${w}` |
| `hints` | une indication par section (texte de `SECTIONS` dans la maquette) | traduction |

- [ ] **Step 1: Écrire `settings-page.test.tsx`** :
  - Ctrl , ouvre « General ».
  - Cliquer « Machines » change le h1 et met `aria-current` sur cet onglet.
  - Ctrl , dans les réglages garde « Machines ».
  - Échap ramène à la vue d'où l'on venait (la Liste).
  - Le point d'alerte apparaît sur Machines quand une machine est hors ligne.
  - Le bouton « Back to the atelier » fait comme Échap.
- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter desktop exec vitest run test/settings-page.test.tsx`. Expected : FAIL.
- [ ] **Step 3: Implémenter** la page, les briques, le CSS (`settings.css` de la maquette, sans les règles de l'île), le chargement paresseux et le branchement.
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`. Expected : tout passe, sans avertissement de taille de morceau.
- [ ] **Step 5: Commit** — `feat(desktop): the Settings page: its sections, back with Escape, alert dots, saved toasts; alerts and the daemon update wired for good`

### Task 2: Général et Apparence

**Files:**
- Create: `apps/desktop/src/settings/{General,Appearance}.tsx`, `apps/desktop/src/settings/tool.ts`, `apps/desktop/test/settings-general.test.tsx`
- Modify: `apps/desktop/src/App.tsx` (changer de langue), `apps/desktop/src/chat/ChatPanel.tsx` (l'agent par défaut), `apps/desktop/src/i18n/{fr,en}.ts`

**Interfaces:**
- Produces :

```ts
// settings/tool.ts — porté de origin/feat/desktop (launch/form.ts loadTool/saveTool)
export const TOOL_KEY = 'desktop.tool';
export function loadTool(): Tool;          // 'claude' par défaut ; une valeur inconnue est ignorée
export function saveTool(t: Tool): void;
export function useDefaultTool(): [Tool, (t: Tool) => void];   // store externe : le chat suit le changement sans recharger
// App : setLang(l: Lang): Promise<'ok' | 'failed'> — await loadMessages(l) ; en échec, la langue reste ; sinon saveLang(l) puis l'état
```

**Général** :
- **Langue** : `Segmented`, fr / en. Changer de langue charge d'abord ses textes. En échec, la langue reste et « Le français reste affiché : l’anglais n’a pas pu être chargé. » s'affiche (le texte suit la langue visée).
- **Lancer au démarrage de Windows** (autostart) :
  - pendant la lecture, l'interrupteur est désactivé ;
  - `null` veut dire « non proposé ici » : l'interrupteur reste désactivé avec cette explication ;
  - un échec remet l'ancienne valeur et dit « Windows n’a pas pris ce réglage. ».

  Ce comportement reprend le motif de `DisplayPanel` sur `origin/feat/desktop`.
- **Agent par défaut** : `Segmented` avec les bots, en claude / codex / cursor. L'indication dit « Pour le chat de Ledge et ses cartes. ». `ChatPanel` envoie `tool: defaultTool` au lieu de `'claude'`.
- **Mises à jour** :
  - la ligne de version montre l'état de `useUpdate().phase` (à jour, disponible, installation en cours, échec) ;
  - « Rechercher les mises à jour » (`updater.setAuto`) est un interrupteur ;
  - « Vérifier » lance `updater.check`, avec « Vérifié il y a … » ;
  - « Installer » (`updater.install`) n'apparaît que quand une version est disponible, et seulement sur clic.

**Apparence** :
- **Thème** : deux cartes radio, Clair « Galet » et Sombre « Signal ».
- **Couleur de Ledge** : sélecteur de couleur et champ hexadécimal validé à la sortie du champ (invalide → message, rien n'est enregistré), plus « Corail » qui remet la couleur par défaut (`setAccent(null)`). Les six couleurs proposées ne sont pas construites.
- **Échelle** : auto / 100 / 125 / 150 / 200 %. « Auto » affiche la valeur résolue (« Auto (125 %) »), d'après ce que rend `saveUiScale`.
- **Mouvements réduits** : interrupteur relié à `useMotionPreferences().setReduced`. L'interrupteur montre le réglage de l'app (`app`).

Chaque changement accepté appelle `saved(…)` avec le nom du réglage.

- [ ] **Step 1: Écrire `settings-general.test.tsx`** :
  - **Langue** :
    - passer en English met l'app en anglais, avec `<html lang="en">` et les libellés du plateau ;
    - `loadMessages` qui échoue laisse l'app en français, avec le message ;
    - un seul « Réglage enregistré » s'affiche, et aucun au montage.
  - **Autostart** :
    - `null` donne l'interrupteur désactivé avec l'explication ;
    - un échec du pont remet l'ancienne valeur et affiche le message.
  - **Agent par défaut** : choisir Codex fait envoyer `tool: 'codex'` à la question suivante du chat.
  - **Accent** :
    - `#12` invalide ne change rien et affiche un message ;
    - « Corail » remet la couleur par défaut.
  - **Échelle** : `saveUiScale` est appelé, et « Auto (…) » affiche la valeur résolue.
- [ ] **Step 2: Vérifier qu'il échoue**
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck`. Expected : tout passe.
- [ ] **Step 5: Commit** — `feat(desktop): Settings › General and Appearance: language (loaded before it switches), start with Windows, the chat's default agent, updates, theme, accent, scale, reduced motion`

### Task 3: Notifications et Sons

**Files:**
- Create: `apps/desktop/src/settings/{Notifications,Sounds}.tsx`, `apps/desktop/test/settings-sounds.test.tsx`
- Modify: `apps/desktop/src/i18n/{fr,en}.ts`

**Notifications** :
- **Ne pas déranger** : interrupteur relié à `useDnd`. Le plateau change avec lui, et l'inverse aussi.
- **Quand un agent a fini** : `Segmented` relié à `setNotifyMode`, avec quatre valeurs : bulle et son, bulle, son, rien.

**Sons** :
- **Sons** : interrupteur `enabled`, éteint par défaut.
- **Volume** : doux / normal / fort, plus un bouton « Tester ». Le bouton passe par `alerts.test()`, qui rend `'dnd'` sous Ne pas déranger ; la page affiche alors « Ne pas déranger est actif : aucun son. ».
- **Jouer un son quand** : cinq cases (`categories` : demandes, fins, erreurs, décisions, équipe).
- **Seulement quand le terminal est derrière** (`onlyWhenTerminalBehind`).
- **Note de bas** : le texte de la maquette.

Les libellés en français viennent de la maquette et de `origin/feat/desktop` (`settings.notifications`, `settings.sounds`).

- [ ] **Step 1: Écrire `settings-sounds.test.tsx`** :
  - DND allumé dans les réglages donne `getDnd()` vrai, et un DND changé ailleurs se reflète dans la page.
  - « Tester » sous DND affiche le message et ne joue rien.
  - Décocher « erreurs » enregistre `categories.errors = false` dans `desktop.sounds`, et un seul « Setting saved » s'affiche.
  - Les sons sont éteints par défaut.
- [ ] **Step 2: Vérifier qu'il échoue**
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck`. Expected : tout passe.
- [ ] **Step 5: Commit** — `feat(desktop): Settings › Notifications and Sounds: do not disturb, what a finished agent does, sounds with a test, categories, only behind the terminal`

### Task 4: Machines

**Files:**
- Create: `apps/desktop/src/settings/{machines.ts,useMachineEditor.ts,Machines.tsx}`, `apps/desktop/test/{settings-machines-model,settings-machines}.test.ts(x)`
- Modify: `apps/desktop/src/i18n/{fr,en}.ts`

**Interfaces:**
- Produces, **porté de `origin/feat/desktop`** (`settings/machines.ts`, `settings/useMachineEditor.ts`, avec leurs tests), sans changer les signatures :
  - `ALIAS`, `MAX_MACHINES = 20` ;
  - `MachineDraft`, `DraftProblem` ;
  - `checkDraft`, `newMachineId`, `configsOf`, `withDraft`, `without`, `sameMachines` ;
  - `useMachineEditor(fleet, machines, timeoutMs?) → { saving, save, probing, probe, clearProbe }`.

**L'écran** (maquette, avec la logique de `MachinesPanel` de l'ancienne branche) :
- **La liste** :
  - la machine locale en tête, « Cette machine », sans action ;
  - chaque machine SSH a son point d'état et la ligne « SSH · alias · Ledge vX · N sessions » ;
  - les actions sont « Reconnecter » (seulement hors ligne), « Tester », « Modifier » et « Retirer », avec une confirmation sur place ;
  - le résultat d'un test s'affiche dans un encadré, seulement sous la machine testée. Il vaut `probeOk(version, sessions)` ou la cause de `sshProblem(error)`.
- **Le formulaire d'ajout et de modification** :
  - les champs sont Nom (80 au plus) et Alias SSH (`ALIAS`, en double refusé) ;
  - la section dépliable « Avant d’ajouter un serveur » contient la liste de l'ancienne branche ;
  - « Tester la connexion » est facultatif ;
  - le bouton est « Enregistrer », avec le compteur « N machines · 20 au plus ».
- **Enregistrer** : `save` rend `'saved'`, `'offline'`, `'timeout'` ou `'refused'`, avec un message pour chaque cas. « Réglage enregistré » ne s'affiche que pour `'saved'`, quand la liste diffusée est égale à celle envoyée. La page s'ouvre même quand le daemon local est hors ligne, avec le message hors ligne habituel.

Textes : ceux de `origin/feat/desktop` (`settings.machines.*` : `errors`, `problem` (les huit causes), `status`, `probing`, `probeOk`, `checklist`, `confirm`, `saved`, `removed`), plus les libellés de la maquette.

- [ ] **Step 1: Porter les tests du modèle et de l'éditeur** depuis `origin/feat/desktop`, puis écrire `settings-machines.test.tsx` :
  - ajouter « nas », puis voir le `machines.set` envoyé et « Setting saved » après la diffusion ;
  - un alias en double donne « duplicate » et rien n'est envoyé ;
  - avec le daemon local hors ligne, le message hors ligne s'affiche et la liste ne change pas ;
  - le résultat d'un test lancé sur « nas » ne s'affiche que sous « nas » ;
  - « Retirer » puis confirmer donne la liste sans « nas » après la diffusion ;
  - la machine locale n'a pas d'action.
- [ ] **Step 2: Vérifier qu'ils échouent**
- [ ] **Step 3: Porter et implémenter**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck`. Expected : tout passe.
- [ ] **Step 5: Commit** — `feat(desktop): Settings › Machines: the shared list, test, reconnect, add by SSH alias, edit, remove, saved only when the daemon confirms`

### Task 5: Projets, Raccourcis et À propos

**Files:**
- Create: `apps/desktop/src/settings/{Projects,Shortcuts,About}.tsx`, `apps/desktop/test/settings-projects.test.tsx`, `apps/desktop/test/settings-about.test.tsx`
- Modify: `apps/desktop/src/i18n/{fr,en}.ts`

**Projets** (maquette, sans « Laisser Ledge organiser ») :
- **La liste** : chaque projet a sa pastille (`ProjectSwatch`), son nom, ses dépôts en puces (nom, machine, icône branche ou dossier), « N agent(s) », « Modifier » et « Supprimer ». Ces deux boutons ouvrent l'éditeur du lot 8 : `{ kind: 'project', edit: id }`, et pour Supprimer, la vue de suppression ouverte d'emblée. Il faut pour cela une option `deleting` sur la fenêtre `project` : `{ kind: 'project', edit, delete: true }`. « Nouveau projet » ouvre `{ kind: 'project' }`.
- **Dossiers mémorisés** : la liste des règles (`projects.rules`). Chacune montre son chemin en `code`, sa machine, un `select` « → projet » qui la réoriente, et « Oublier » qui la retire. Les deux passent par `useProjectSave` du lot 8 et attendent la diffusion. Pendant l'attente, la règle reste affichée telle quelle, et un refus s'affiche sous elle.
- **Sans règle** : « Aucun dossier mémorisé. Ranger un agent en ajoute un. »

**Raccourcis** : le tableau de `t.shortcuts.rows` (« Dans Ledge Desktop »), avec Ctrl , en plus. La partie « Partout dans Windows » n'est pas construite.

**À propos** :
- **En haut** : la mascotte et le texte de la maquette.
- **Les versions** : Desktop (`useUpdate().app`), puis chaque daemon par machine, avec sa version, son installation `npm` / `git` et « À mettre à jour » quand il est en retard. Vient ensuite « Dernière version » (`latest`).
- **Mettre à jour un daemon** : bouton relié à `useDaemonUpdate().start()`, montré quand l'offre est `'offer'` (`'manual'` donne la note de l'ancienne branche, par exemple pour un clone git). Le journal des étapes s'affiche avec les textes `step` et `failed` de l'ancienne branche.
- **Mettre à jour l'application** : même bloc que dans Général (`useUpdate`).

- [ ] **Step 1: Écrire les tests** :
  - **Projets** :
    - la liste affiche les dépôts et le nombre d'agents ;
    - « Modifier » ouvre « Edit Ledge » ;
    - « Supprimer » ouvre la vue de suppression ;
    - réorienter une règle vers Payment envoie le `projects.set` avec la règle changée, la liste ne change qu'à la diffusion, puis « Setting saved » s'affiche ;
    - « Oublier » retire la règle ;
    - avec le daemon hors ligne, le message s'affiche sous la règle et rien ne change.
  - **À propos** :
    - les versions de Desktop et des daemons s'affichent, avec « À mettre à jour » pour un daemon en retard ;
    - « Mettre à jour » envoie `update.daemon` à cette machine ;
    - les étapes du journal s'affichent ;
    - l'offre `manual` donne la note.
- [ ] **Step 2: Vérifier qu'ils échouent**
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`. Expected : tout passe, sans avertissement de taille de morceau.
- [ ] **Step 5: Commit** — `feat(desktop): Settings › Projects (projects and remembered folders, re-pointed or forgotten once the daemon confirms), Shortcuts and About (versions, app and daemon updates)`

### Task 6: Les réglages dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/settings.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts` si besoin (`machines.set` diffusé, `update.daemon` et ses étapes)

Scénarios :
1. **Ctrl , puis Apparence** : passer en thème clair change le thème de la page et affiche « Setting saved · … ». Échap ramène à l'atelier.
2. **Machines** : ajouter une machine SSH. Elle apparaît après la diffusion et l'alerte de la barre de gauche s'allume, puisque la machine est hors ligne. « Retirer » la fait disparaître.
3. **Projets** : réorienter une règle déplace l'agent rangé vers l'autre table.
4. **Fenêtre de 900 px** : la page tient sans défilement horizontal, et la barre de gauche se replie comme dans le CSS de la maquette.

- [ ] **Step 1: Écrire les scénarios**
- [ ] **Step 2: Lancer Playwright** — `pnpm --filter desktop e2e`. Expected : les scénarios d'avant et les 4 de `settings` passent.
- [ ] **Step 3: Vérification du dépôt** — paquet par paquet :
  - `pnpm --filter @ledge/protocol test` ;
  - `pnpm --filter @paradow/ledge test` ;
  - `pnpm --filter @ledge/fleet test` ;
  - `pnpm --filter @ledge/ui test` ;
  - `pnpm --filter desktop test` ;
  - `pnpm --filter overlay test` ;
  - `pnpm -r typecheck` ;
  - `pnpm -r build`.

  Expected : tout passe. Seule l'instabilité connue de l'overlay peut apparaître : la signaler.
- [ ] **Step 4: Commit** — `test(desktop): Settings in the browser: theme, machines, a remembered folder re-pointed, a narrow window`
