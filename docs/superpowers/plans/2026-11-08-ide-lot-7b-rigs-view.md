# Refonte IDE, lot 7b : la vue Rigs, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** derrière l'interrupteur « Interface IDE (aperçu) », la vue Rigs de la barre latérale suit la maquette des rigs. On y trouve :
- l'en-tête, avec la machine affichée et « + Lancer » ;
- les sections Kernel et Rigs, avec leurs sièges ;
- la ligne du daemon OpenRig, collée en bas ;
- Démarrer, Redémarrer et Arrêter dans une colonne fixe à droite, avec une confirmation sous la ligne.

Le bouton OpenRig de la barre d'activité disparaît. Le bouton Rigs porte un « ! » ambre quand le daemon est arrêté.

**Ce qui existe déjà et ne se refait pas** (`origin/main` c2563322, lot 7a fusionné) :
- l'état OpenRig d'une machine et ses actions, par `useOpenRig(client, machine, pollMs)` (`packages/fleet/src/openrig.ts`) : `state`, `pending`, `last`, `act(action)` ;
- plusieurs machines à la fois, par `useOpenRigStates(client, machines, pollMs)` ;
- dans `openrig/model.ts` : `workingSeats`, `asksFirst`, `commandsOf` (la commande `rig` exacte) et `targetOf` ;
- la cadence de la barre latérale, `SIDEBAR_POLL_MS` (15 s, `openrig/sidebarState.ts`) ;
- la Sortie du panneau du bas, qui journalise déjà chaque `openrig.done` (`openrig/rigOutput.ts`) ;
- les textes de confirmation de la page OpenRig (`t.openrig.confirm`).

**Ce qui manque :** dans l'IDE, la vue `rigs` affiche encore l'ancienne barre latérale (`Sidebar section="rigs"` → `RigGroups`, construite à partir des sessions). Il n'y a ni machine affichée, ni colonne d'actions, ni ligne du daemon. Le bouton OpenRig (`openrigTab`) est toujours dans la barre d'activité.

**Architecture :**
- `ide/rigs/model.ts` (pur) transforme l'état OpenRig de la machine affichée, les sessions Ledge et les demandes en lignes (kernel, rigs, sièges, daemon). Il donne aussi le menu des machines et le contenu d'une confirmation.
- `ide/rigs/RigsView.tsx` les dessine, avec `ide/rigs/MachineMenu.tsx` pour le menu.
- `App.tsx` rend `RigsView` à la place de `Sidebar` quand la vue est `rigs`.
- `ActivityBar.tsx` perd le bouton OpenRig et gagne le « ! ».

**Tech Stack :** React 19, TypeScript, vitest + Testing Library, Playwright.

**Spec :**
- [`docs/ide-workspace.md`](../../ide-workspace.md), section « OpenRig » : la vue Rigs ; Démarrer, redémarrer, arrêter ; Confirmations.
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md), lot 7b (§5) et D6.
- Maquette [`docs/mockups/ledge-ide-rigs.html`](../../mockups/ledge-ide-rigs.html) :
  - `activity()` (l. 1035) ;
  - `rigsExplorer()` (l. 1123), `rxRig()` (l. 1109), `rxPower()` (l. 1091), `rxPane()` et `orConfirm()` (l. 1289) ;
  - les styles `.rx-*`.
- Décisions de l'utilisateur sur ce qu'OpenRig ne fournit pas (PR #232, 2026-11-08) : les commandes affichées sont celles que Ledge lance.

## Global Constraints

- Branche `feat/ide-lot-7b` (worktree `../ledge-ide-lot-7b`), partie de `origin/main` c2563322. Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur.
- Interrupteur coupé, l'interface actuelle est **inchangée**. `Sidebar`, `RigGroups`, `TopBar` et leurs tests restent verts sans retouche.
- Le daemon (`packages/ledge`), le protocole (`packages/protocol`) et `packages/fleet` ne changent pas.
- Une commande montrée est toujours celle que Ledge lance : `commandsOf(action)`, jamais le texte de la maquette.
- Textes en français et en anglais (`src/i18n/fr.ts`, `en.ts`). On reprend les textes existants (`t.openrig.confirm.*`, `t.side.empty.*`, `t.ide.rigs`). Les textes nouveaux de la maquette sont cités mot pour mot.
- Couleurs par les jetons du thème (clair et sombre), jamais les hex de la maquette. Sélecteurs préfixés pour les boutons (`.ide-rigs button`), à cause du reset `button:not(.ledge-btn)` d'`app.css`.
- Tout état absent de la maquette se demande à `design-ux` et ne s'invente pas. On le note dans `docs/ide-lot-7b-questions.md`, on le reporte dans la PR, puis on supprime le fichier avant la PR.
- Node 24 dans le shell des outils : `export PATH=$HOME/.local/share/nvm/v24.10.0/bin:$PATH`, `corepack pnpm`.
- Tests : `corepack pnpm --filter desktop test`, `--filter desktop typecheck`, `--filter desktop exec playwright test <spec>`.
- Échecs connus sur main : vitest `omp-seats.test.tsx` (2), « reconnect asks Nova's thread again », `session-tab` « a tab hidden… » (instable) ; e2e `island:166`, `proposals:36`, `daemon-update:8`, `atelier:208/234`, `ide-terminals:61`.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais `apps/desktop/test-results/*.png`. Jamais `git stash` nu.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **Un clic sur un rig ou sur le kernel** ouvre, en 7b, l'onglet OpenRig de la machine (`openrigTab(machine)`), qui liste ses rigs. La vue Rig (« Rig · nom ») arrive au 7c et remplacera ce clic. | Rien au clic jusqu'au 7c. |
| R2 | **« + Lancer »** ouvre, en 7b, le lancement actuel sur la machine affichée (`{ type: 'openrig', machine, section: 'rigs', open: { launch: true } }`). La fenêtre modale arrive au 7d. | Masquer le bouton jusqu'au 7d. |
| R3 | **« Gérer les machines… » et « Ajouter une machine »** ouvrent Réglages › Machines (`{ type: 'settings', section: 'machines' }`). La section Machines de la page OpenRig arrive au 7d. | — |
| R4 | **Les actions visent la machine affichée**, y compris « Démarrer OpenRig » sur une machine SSH. La spec dit : « Tout ce qui suit concerne la machine affichée ». Cela remplace, dans l'IDE seulement, la règle « toujours ce PC » de l'ancienne barre latérale. | Griser Démarrer hors de la machine locale. |
| R5 | **La confirmation s'ouvre sous la ligne cliquée**, sans fenêtre modale. Elle reprend `t.openrig.confirm` : le titre, les sièges qui travaillent (nommés), `restartNote` pour un redémarrage, et la commande de `commandsOf`. Démarrer ne demande pas. Une seule confirmation est ouverte à la fois, et Échap l'annule. | — |
| R6 | **Les sièges d'un rig** viennent de `rig.nodes` (l'état OpenRig), joints aux sessions Ledge par `session.rig.seat === node.session` sur la même machine. Un siège sans session suivie est montré grisé, sans clic. Un rig arrêté ne montre pas ses sièges (la spec les grise dans la vue Rig, au 7c). La méta d'un siège est son % de contexte quand Ledge le connaît. | — |
| R7 | **Le « ! » ambre** sur Rigs : OpenRig est installé sur la machine affichée et son daemon ne tourne pas. Pas de « ! » quand OpenRig n'est pas installé. | Le calculer sur toutes les machines. |
| R8 | **États absents de la maquette** : OpenRig absent de la machine, machine hors ligne, premier chargement. On reprend les textes existants de `RigGroups` et de la page OpenRig, et la question part à `design-ux`. | Un texte de plus par état. |
| R9 | **Préférences locales** (propres à ce poste) : la machine affichée `ledge.ide.rigsMachine`, et les replis `ledge.ide.rigsFold` (sections et rigs). Une machine disparue ou désactivée retombe sur `local`. | — |

## Review Focus

1. **La machine affichée disparaît, est désactivée ou passe hors ligne.** La vue retombe sur `local`, ou dit « hors ligne » sans offrir d'action. Elle ne garde jamais les rigs d'avant. *(Task 1 : `displayedMachine` ; Task 2 : test « machine hors ligne ».)*
2. **Une action est en cours ou refusée (`busy`).** Les boutons de cette ligne sont grisés pendant `pending`. Un échec reste visible sous la ligne jusqu'à la prochaine action, en plus de la Sortie. *(Task 2.)*
3. **Barre latérale étroite (150 px) et nom de rig long.** Le nom se coupe avec une ellipse, et la colonne d'actions garde sa largeur fixe. *(Task 2 : la classe et le style ; vérifié en e2e à 160 px, Task 3.)*
4. **Deux machines ont un siège de même nom de session.** Un siège ne se relie jamais à la session d'une autre machine. *(Task 1.)*
5. **Le daemon s'arrête pendant qu'une confirmation est ouverte.** La confirmation se ferme quand sa cible n'a plus d'action possible (rig absent, daemon arrêté). *(Task 2.)*

---

### Task 1 : le modèle de la vue

**Files :**
- Create : `apps/desktop/src/ide/rigs/model.ts`
- Test : `apps/desktop/test/ide/rigs-model.test.ts`

**Interfaces :**
- Consomme : `OpenRigState`, `Rig`, `RigSeat`, `Session`, `HumanAsk`, `OpenRigAction` (`@ledge/protocol`) ; `MachineState` (`@ledge/fleet`) ; `isRunning`, `kernelRig`, `listedRigs`, `workingSeats`, `commandsOf` (`openrig/model.ts`) ; `isAskSeat` (`asks/model.ts`).
- Produit :
  - `type RigDot = 'perm' | 'ask' | 'work' | 'idle' | 'off'`
  - `interface SeatLine { logicalId: string; name: string; dot: RigDot; session?: Session; ctx?: number }`
  - `interface RigLine { name: string; running: boolean; dot: RigDot; count: number; seats: SeatLine[] }`
  - `interface RigsView { status: 'loading' | 'offline' | 'absent' | 'stopped' | 'running'; version?: string; kernel: RigLine | null; rigs: RigLine[] }`
  - `rigsViewOf(input: { state: OpenRigState | undefined; error?: string; machine: string; sessions: readonly Session[]; asks: readonly HumanAsk[] }): RigsView`
  - `interface MachineEntry { id: string; label: string; kind: 'local' | 'ssh'; status: 'running' | 'stopped' | 'absent' | 'offline' | 'loading'; running: number }`
  - `machineEntries(machines: readonly MachineState[], states: ReadonlyMap<string, OpenRigState>, errors: ReadonlySet<string>): MachineEntry[]`
  - `displayedMachine(saved: string | null, machines: readonly MachineState[]): string`
  - `powerOf(running: boolean): readonly ('start' | 'restart' | 'stop')[]`
  - `actionOf(target: 'daemon' | 'kernel' | string, verb: 'start' | 'restart' | 'stop'): OpenRigAction`
  - `confirmOf(state: OpenRigState, action: OpenRigAction, sessions: readonly Session[], machine: string): { working: string[]; commands: string[]; restart: boolean }`
  - `rigsAlert(state: OpenRigState | undefined): boolean`

- [ ] **Step 1 : écrire les tests qui échouent**, sur un `OpenRigState` écrit dans le test : un kernel de 3 sièges qui tourne, `ledge-dev` qui tourne avec 2 sièges, `synapse-review` arrêté avec 4 sièges, daemon `running`, version `0.7.10`.
  - `rigsViewOf` :
    - `status: 'running'`, `version: '0.7.10'`.
    - `kernel.count === 3`.
    - `rigs` contient `ledge-dev` puis `synapse-review` (sans le kernel). `synapse-review` a `running: false`, `dot: 'off'`, `seats: []` et `count: 0`.
    - Un siège joint : la session `{ machineId: 'local', rig: { seat: 'dev-build@ledge-dev', name: 'ledge-dev' }, state: 'waiting_permission', context: { used: 50, window: 200, at } }` donne la `SeatLine` `{ logicalId: 'dev.build', name: <nom de la session>, dot: 'perm', ctx: 25 }` et le rig passe en `dot: 'perm'`.
    - Un siège sans session donne `name === 'dev.review'`, `dot: 'off'` et aucune `session`.
    - **La même session sur `machineId: 'srv'`** n'est pas jointe quand `machine === 'local'` (Review Focus 4).
    - `state: undefined` sans `error` → `loading` ; `error: 'offline'` → `offline` ; `installed: false` → `absent` ; daemon `stopped` → `stopped`, avec `kernel === null` et `rigs` vide.
    - Pour le `dot` d'un rig qui tourne : `perm` passe avant `ask`, `ask` avant `work`, `work` avant `idle`. Une demande (`HumanAsk`) d'un siège compte comme `ask`.
  - `machineEntries` : `local` (sans `ssh`) donne `kind: 'local'`, une machine avec `ssh` donne `'ssh'`. `running` compte les rigs qui tournent, kernel exclu. Une machine dans `errors` ou `ready: false` donne `offline`, et une machine sans état encore donne `loading`.
  - `displayedMachine` : `'srv'` sauvée et présente → `'srv'` ; sauvée mais absente de `machines` → `'local'` ; `null` → `'local'`.
  - `powerOf(true)` → `['restart', 'stop']` ; `powerOf(false)` → `['start']`.
  - `actionOf` :
    - `('daemon','start')` → `{ kind: 'daemon.start' }`, et `('daemon','restart')` → `{ kind: 'daemon.restart' }` ;
    - `('kernel','stop')` → `{ kind: 'kernel.stop' }` ;
    - `('ledge-dev','restart')` → `{ kind: 'rig.restart', rig: 'ledge-dev' }`.
  - `confirmOf` sur `rig.stop` de `ledge-dev`, avec `dev.build` en `activity: 'running'` : `working` contient le nom de sa session Ledge (ou le `logicalId` sans session), `commands` égale `commandsOf(action)`, `restart: false`.
  - `rigsAlert` : `installed && daemon !== 'running'` → `true` ; `installed: false` → `false` ; `undefined` → `false`.
- [ ] **Step 2 : lancer `corepack pnpm --filter desktop exec vitest run test/ide/rigs-model.test.ts`.** Attendu : FAIL, le module n'existe pas.
- [ ] **Step 3 : implémenter `model.ts`.**
  - `ctx` = `Math.round(used / window * 100)`, comme `shell/sidebar/Attention.tsx:187`.
  - Le `dot` d'un siège avec session : `waiting_permission` ou `error` → `perm` ; `waiting_input`, ou une demande `isAskSeat` → `ask` ; `working` ou `starting` → `work` ; sinon `idle`.
  - Le `dot` d'un siège sans session : `node.activity === 'running'` → `work`, `stopped` → `off`, sinon `idle`.
  - Le `dot` d'un rig qui tourne : le pire de ses sièges, `idle` sans siège.
- [ ] **Step 4 : relancer le test.** Attendu : PASS.
- [ ] **Step 5 : commit** `feat(desktop): the IDE Rigs view's model (rows, machines, confirmation)`.

### Task 2 : la vue Rigs

**Files :**
- Create : `apps/desktop/src/ide/rigs/RigsView.tsx`, `apps/desktop/src/ide/rigs/MachineMenu.tsx`, `apps/desktop/src/styles/ide-rigs.css`
- Modify : `apps/desktop/src/workspace/prefs.ts` (R9), `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts` (sous `t.ide.rigsView`)
- Test : `apps/desktop/test/ide/rigs-view.test.tsx`

**Interfaces :**
- Consomme : Task 1 ; `useOpenRig`, `useOpenRigStates` (`@ledge/fleet/openrig`) avec `SIDEBAR_POLL_MS` ; `openClick` et `NavAction` (`nav/state`) ; `ProviderLogo`, `providerOf` ; `openrigTab` (`workspace/store`).
- Produit :
  - `RigsView(props: { client: DaemonClient; machines: readonly MachineState[]; sessions: readonly Session[]; asks: readonly HumanAsk[]; activeTab: Tab | null; dispatch(a: NavAction): void; onTab(t: Tab): void; onMenu?(id: string, at: { x: number; y: number }, opener: HTMLElement | null): void }): JSX.Element`
  - `useRigsMachine(machines): [string, (id: string) => void]` (dans `prefs.ts`)
  - `useRigsFold(): { pane(k: 'kernel' | 'rigs' | 'openrig'): boolean; rig(name: string): boolean; toggle(key: string): void }`

Le dessin suit `rigsExplorer()` :
- **L'en-tête `.ide-rigs-h`** : « Rigs », le bouton machine `● <label> ▾` (`aria-haspopup="menu"`), puis « + Lancer » (R2).
- **Le menu** (`role="menu"`, éléments `menuitemradio`) :
  - par machine : la pastille, le nom, et en petit « locale » ou « SSH » · « N rig(s) en marche » ou « OpenRig arrêté », avec ✓ sur la machine affichée ;
  - puis « Gérer les machines… » et « Ajouter une machine » (R3) ;
  - Échap et un clic dehors le ferment.
- **Les sections** Kernel, puis Rigs (avec leur nombre), qui défilent. OpenRig est en pied fixe, au-dessus de « Réduire ». Chaque section se replie par un bouton `aria-expanded`.
- **Une ligne de rig** : le chevron (désactivé si le rig est arrêté ou sans siège), la pastille, le nom (bouton, R1), la méta (le nombre de sièges quand il tourne), puis la colonne `.ide-rigs-pw` de largeur fixe.
- **Une ligne de siège** : la pastille, `ProviderLogo` 12 px, le nom et la méta `N %`.
  - Clic : `dispatch(openClick(session.id, e))` ; clic droit : `onMenu`.
  - Un siège sans session est grisé, sans bouton.
- **Le kernel arrêté** montre la note de la maquette, mot pour mot : « L’operator ne peut pas t’aider à composer un rig. »
- **Le daemon arrêté** :
  - la section Rigs montre « OpenRig est arrêté. » / « Les rigs et le kernel repartent avec le daemon. » et le bouton « Démarrer OpenRig » (action `daemon.start`, R4) ;
  - la section Kernel montre « Arrêté avec le daemon. »
- **La ligne du daemon** : la pastille, « Daemon » (bouton qui ouvre `openrigTab(machine)`), la version et la colonne d'actions. Elle est surlignée (`sel`) tant que l'onglet actif est `openrig:<machine>`.
- **Les boutons d'action** : des icônes de 22 px avec `aria-label`, par exemple « Arrêter ledge-dev » ou « Redémarrer le kernel ». Arrêter passe en `--destructive` au survol. Démarrer lance tout de suite ; Redémarrer et Arrêter ouvrent la confirmation sous la ligne (R5).
- **La confirmation** : le titre `t.openrig.confirm.title` / `restartTitle`, la ligne `working(n)` suivie des noms, `restartNote` si c'est un redémarrage, les commandes en `<code>`, « Confirmer l'arrêt » / « Confirmer le redémarrage » et « Annuler ».

- [ ] **Step 1 : écrire les tests qui échouent** (Testing Library, avec le faux client de `test/openrig-page.test.tsx:14` : `send` capturé, `emit` d'un `openrig.state`).
  - Monté sur `local` avec l'état de la Task 1 : les sections « Kernel », « Rigs 2 » et « OpenRig » ; la ligne `ledge-dev` et ses 2 sièges ; `synapse-review` sans sièges ; la ligne « Daemon » avec `0.7.10`.
  - Un clic sur « Arrêter ledge-dev » n'envoie rien et montre la confirmation sous cette ligne, avec la commande `rig down ledge-dev`. « Confirmer l'arrêt » envoie `openrig.act` `{ kind: 'rig.stop', rig: 'ledge-dev' }` avec `machineId: 'local'`. « Annuler » et Échap ferment sans rien envoyer.
  - « Démarrer synapse-review » envoie `{ kind: 'rig.start', rig: 'synapse-review' }` tout de suite.
  - Pendant `pending`, les boutons de la ligne sont `disabled`. Un `openrig.done { ok: false, error: 'busy' }` laisse un message d'erreur sous la ligne (Review Focus 2).
  - Daemon `stopped` : « OpenRig est arrêté. » et « Démarrer OpenRig » envoie `{ kind: 'daemon.start' }`. Une confirmation ouverte sur `ledge-dev` se ferme quand l'état passe à `stopped` (Review Focus 5).
  - Le menu machine : deux machines, `local` et `srv` (`ssh: 'srv'`). Choisir `srv` enregistre `ledge.ide.rigsMachine = "srv"` et la vue demande `openrig.status` avec `machineId: 'srv'`. Un `openrig.state { error: 'offline' }` pour `srv` montre l'état hors ligne, sans bouton d'action (Review Focus 1).
  - « Gérer les machines… » donne `dispatch({ type: 'settings', section: 'machines' })`. « + Lancer » donne `dispatch({ type: 'openrig', machine: 'local', section: 'rigs', open: { launch: true } })`. Un clic sur `ledge-dev` donne `onTab(openrigTab('local'))`.
  - Un clic sur un siège joint donne `dispatch(openClick(id, e))`, et un `Ctrl`+clic donne `where: 'right'`.
  - Replier « Rigs » cache ses lignes, et le repli survit à un remontage (localStorage).
- [ ] **Step 2 : lancer `corepack pnpm --filter desktop exec vitest run test/ide/rigs-view.test.tsx`.** Attendu : FAIL.
- [ ] **Step 3 : implémenter `prefs.ts`, `MachineMenu.tsx`, `RigsView.tsx`, `ide-rigs.css` et les textes fr/en.**
  - Les états absents (R8) reprennent `t.side.empty.*` et les textes de la page OpenRig. Les noter dans `docs/ide-lot-7b-questions.md`.
  - `.ide-rigs-pw { flex: none; width: 46px }` ; le nom en `min-width: 0; overflow: hidden; text-overflow: ellipsis`.
- [ ] **Step 4 : relancer le test, puis `corepack pnpm --filter desktop typecheck`.** Attendu : PASS et aucune erreur.
- [ ] **Step 5 : commit** `feat(desktop): the IDE Rigs view (machine menu, kernel, rigs, daemon, actions and their confirmation)`.

### Task 3 : le branchement dans l'IDE

**Files :**
- Modify : `apps/desktop/src/ide/ActivityBar.tsx`, `apps/desktop/src/App.tsx` (le rendu de `explorer`, l. ~791), `apps/desktop/src/styles/ide.css` si le badge doit bouger
- Test : `apps/desktop/test/ide/activity-bar.test.tsx` (à créer s'il n'existe pas), `apps/desktop/e2e/ide-rigs.spec.ts`

**Interfaces :**
- Consomme : `RigsView`, `rigsAlert`, `useRigsMachine` (Tasks 1 et 2).
- Produit : `ActivityBar` gagne la prop `rigsAlert: boolean` et perd le bouton `openrigTab`.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `activity-bar.test.tsx` : aucun bouton « OpenRig » ; `rigsAlert` vrai → le bouton Rigs contient `.ide-badge.amber` avec le texte `!`.
  - `ide-rigs.spec.ts` (`fakeDaemon` avec `openrig`, IDE allumé comme dans `ide-shell.spec.ts`) :
    - le bouton Rigs ouvre la vue, qui montre Kernel, les rigs et la ligne Daemon ;
    - Arrêter un rig ouvre la confirmation sous la ligne, avec la commande ; Confirmer envoie l'action ; la Sortie (`Ctrl+J`, onglet Sortie) montre la commande ;
    - daemon arrêté → « ! » sur Rigs et « Démarrer OpenRig » ;
    - à 160 px de large, le nom d'un rig long garde la colonne d'actions visible (Review Focus 3) ;
    - l'interrupteur coupé montre toujours l'ancienne barre latérale avec ses rigs.
- [ ] **Step 2 : lancer les deux.** Attendu : FAIL.
- [ ] **Step 3 : implémenter.**
  - `App.tsx` : `explorer = layout.sideView === 'rigs' ? <RigsView …/> : <Sidebar …/>`.
  - La machine de `rigsAlert` est la machine affichée, lue avec `useRigsMachine`. Son état vient de `useOpenRig(…, SIDEBAR_POLL_MS)`, la même lecture partagée que la vue.
  - `ActivityBar` : retirer `tab(openrigTab(), …)` et son import ; badge `<span className="ide-badge amber">!</span>` sur Rigs.
  - L'onglet OpenRig reste ouvrable par le groupe vide, la palette et la ligne Daemon.
- [ ] **Step 4 : relancer ces tests, puis la suite desktop (vitest + typecheck), puis les e2e `ide-*.spec.ts` avec `--workers=2`.** Attendu : verts, hors échecs connus. Les specs IDE qui cliquaient sur le bouton OpenRig de la barre d'activité passent par la ligne Daemon.
- [ ] **Step 5 : commit** `feat(desktop): the IDE's Rigs button opens the new view and carries « ! »; the OpenRig button leaves the activity bar`.

### Task 4 : relecture, questions, PR

- [ ] Relecture indépendante de la branche (superpowers:requesting-code-review).
- [ ] Reporter `docs/ide-lot-7b-questions.md` dans la description de la PR (section repliable), puis supprimer le fichier.
- [ ] PR vers `main` avec l'accord de l'utilisateur. Elle liste les rulings R1 à R9, les tests et ce qui n'est pas testé (Tauri).
