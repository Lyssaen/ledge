# Lot 8 : le TUI de Ledge orchestrateur, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** réécrire `ledge tui` pour Ledge orchestrateur : Ledge en tête (conversation, décisions dans ses messages, rail), À toi, Projets (sessions seules), Rigs et noyau OpenRig (sièges, échanges, état, actions), lancement d'un rig, aperçu terminal en couleurs, et fil OMP dessiné en terminal.

**Architecture :**
- Le TUI consomme le contrat des lots 2, 4 et 5 par `@ledge/fleet`, sans rien lire d'OpenRig lui-même.
- Les modèles purs des rigs et du lancement, écrits pour Desktop aux lots 3 et 5, montent dans `@ledge/ui` pour servir aux deux surfaces.
- Un seul ajout au daemon : l'aperçu en couleurs (`capture-pane -e`), seulement pour un client qui le demande.
- L'accueil devient un écran en trois colonnes : colonne gauche (Ledge, À toi, Projets, Rigs), contenu de la sélection, rail.

**Tech Stack :** TypeScript (ESM), ink 7, React 19, zod, vitest avec ink-testing-library (`packages/ledge/test/tui-fixture.tsx`).

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` (§6, §8.2, §10 TUI), le plan maître `2026-10-30-ledge-openrig-orchestrator.md` (contrat de protocole, « Lot 8 »), et la maquette https://claude.ai/artifact/39cmxt4BPuZRSArkHPcowt, dont les sources sont dans `.worktrees/tuin-tui-mockup/docs/mockups/ledge-tui-openrig/` (`screens.py` donne chaque écran ligne par ligne).

**Démarrage :** ce lot s'exécute quand les lots 1, 2, 4 et 5 sont fusionnés dans `origin/main`. Branche `feat/tui-orchestrator` depuis `origin/main`, dans `.worktrees/tui-orchestrator`. Avant la tâche 1, relire les noms réellement fusionnés (`packages/protocol/src/openrig.ts`, `packages/fleet/src/index.ts`, `packages/ui/src/chat/ledge/threadModel.ts`) : s'ils diffèrent des noms ci-dessous, ce sont eux qui font foi, et le plan s'adapte sans changer de comportement.

## Global Constraints

- Les textes d'interface sont en français d'abord (`packages/ledge/src/tui/i18n/fr.ts`), avec l'anglais à côté (`en.ts`). Les libellés sont repris mot pour mot de la maquette et du plan maître : « À toi », « Projets · sessions seules », « Rigs », « Noyau OpenRig », « Tranché aujourd'hui », « Revenir dessus », « Résumer la journée », « Écrire à Ledge… (@build pour un agent d'un rig) », « Ranger dans un projet… », « Attend Ledge », « tranche dans son mandat · design, architecture et critique te reviennent ».
- Les couleurs viennent de `theme.ts` (`C`, `STATE_COLOR`, `projectColor`) et les glyphes de `glyphs.ts`, avec leur repli ASCII. Glyphes nouveaux : `rig: '▣'` (déjà `team`, renommé), `kernel: '◈'`, `omp: 'π'` ; replis ASCII `[R]`, `<>`, `pi`.
- Écrans : `1` Ledge, `2` Rig, `3` Session. L'écran Équipes est déjà retiré au lot 1. Le noyau a sa pièce, comme un rig. À toi n'apparaît qu'une fois, sous la ligne Ledge, jamais dans le rail.
- Onglets de l'écran Ledge : `Conversation · Rigs · Mandat`, changés avec `←` `→`.
- Écrire à un siège passe par la saisie de Ledge (`@siège …`, `ledge.say`) : le daemon l'envoie en `rig send` signé Ledge (lot 4, `createSeatSend`). Le TUI n'envoie jamais `rig send` lui-même.
- Cycle de vie d'un siège uniquement par `rig.act` (lot 5). Aucun `session.kill`, `session.close` ou `session.delete` sur une session dont `session.rig` est défini : la touche n'est pas proposée, et un refus `rig_managed` du serveur s'affiche en toast.
- Plan avant lancement : facultatif derrière « Voir le plan » (`v`), imposé une fois quand `planRequired(form)` est vrai (vrai dépôt, ni copie `.worktrees/` ni espace hors projet).
- Le volet Terminal d'un harnais tmux est un aperçu en direct, en lecture seule, en couleurs. On tape en attachant avec `a`. Pas de terminal interactif dans le volet.
- Une session OMP montre son fil (`session.thread`) dessiné comme un terminal, dans le TUI seulement.
- Tailles : trois colonnes à partir de 140 colonnes ; de 100 à 139, le rail se plie en une ligne en tête de la conversation (`]` l'ouvre) ; sous 100, une colonne, comme la vue d'ensemble actuelle (`WIDE`). `MIN` reste 60 × 16.
- Commits : Conventional Commits avec le scope du paquet (`feat(tui): …`, `feat(ledge): …`, `feat(fleet): …`, `feat(protocol): …`, `refactor(ui): …`), un par tâche, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests : `pnpm --filter @paradow/ledge test -- <fichier>`, `pnpm --filter @ledge/fleet test -- <fichier>`, `pnpm --filter @ledge/ui test -- <fichier>`. `pnpm typecheck` et `pnpm test` verts à la fin du lot. Aucun test ne démarre un vrai OpenRig ni un vrai tmux.

## Review Focus

1. **Une ligne colorée qui porte autre chose que de la couleur** (séquence OSC, déplacement de curseur, séquence coupée par la troncature). Attendu : le TUI ne garde que les séquences SGR, ne coupe jamais au milieu d'une séquence, et remet la couleur à zéro en fin de ligne, pour que rien ne déborde sur la ligne suivante. Test : tâche 4 (`sgrOnly`, `cutAnsi`).
2. **Un client qui se ferme ou change de session pendant qu'il suit un aperçu en couleurs.** Attendu : le daemon cesse de capturer en couleurs une session que plus personne ne suit, et n'envoie pas l'aperçu coloré aux autres clients. Test : tâche 2.
3. **Une escalade répondue ailleurs pendant qu'elle est affichée** (téléphone, Desktop, cerveau). Attendu : la carte passe à « Déjà répondu », ses touches `1`-`9` ne font plus rien, et aucun second `escalation.answer` ne part. Test : tâche 6.
4. **Une adresse `@` ambiguë ou un siège arrêté.** Attendu : la complétion propose les formes longues (`@build@factory`, `@build@starter`), et un envoi refusé montre la raison donnée par Ledge dans le fil, sans rien perdre du texte tapé. Test : tâche 7.
5. **Un terminal étroit avec une décision en attente.** Attendu : de 100 à 139 colonnes comme sous 100, la décision reste visible et se tranche au clavier. Test : tâche 8.

---

### Task 1 : les modèles purs des rigs et du lancement montent dans `@ledge/ui`

Le TUI ne peut pas importer `apps/desktop`. Plume a demandé aux exécutants des lots 3 et 5 d'écrire ces fonctions pures directement dans `packages/ui/src/rigs/model.ts` et `packages/ui/src/launch/rigModel.ts`. **Si c'est déjà le cas, cette tâche se réduit à vérifier que `isStandalone` y est aussi**, puis à passer à la tâche 2. Sinon, les modules sont déplacés tels quels, sans changement de comportement.

**Files :**
- Move : `apps/desktop/src/rigs/model.ts` → `packages/ui/src/rigs/model.ts`
- Move : `apps/desktop/src/launch/rigModel.ts` → `packages/ui/src/launch/rigModel.ts`
- Move : `apps/desktop/test/rigs-model.test.ts` → `packages/ui/test/rigs-model.test.ts`, et `apps/desktop/test/rig-launch-model.test.ts` → `packages/ui/test/rig-launch.test.ts`
- Move : `isStandalone` (lot 3, `apps/desktop/src/shell/sidebar/model.ts`) dans `packages/ui/src/rigs/model.ts` ; le modèle de la barre latérale l'importe de là
- Modify : chaque import de Desktop (`grep -rln "rigs/model\|launch/rigModel\|isStandalone" apps/desktop/src`) vers `@ledge/ui/rigs/model` et `@ledge/ui/launch/rigModel`

**Interfaces :**
- Produces, inchangés : `rigKey`, `kernelSplit`, `workingCount`, `readyCount`, `rigPlace`, `seatSession`, `isSeatPlaceholder`, `SEAT_ORDER`, `allSeats`, `seatAt`, `rigColor`, `isStandalone` (`@ledge/ui/rigs/model`) ; `RigForm`, `rigFormDefaults`, `recommendSpec`, `slugOfGoal`, `whereOf`, `missingOf`, `planRequired`, `primaryAction`, `providers`, `launchability` (`@ledge/ui/launch/rigModel`).

- [ ] **Step 1 : déplacer les deux modules et leurs tests** avec `git mv`, puis corriger les imports relatifs des tests.
- [ ] **Step 2 : lancer les tests déplacés** — Run : `pnpm --filter @ledge/ui test -- rigs-model rig-launch` ; Expected : PASS, même nombre de tests qu'avant le déplacement.
- [ ] **Step 3 : corriger les imports de Desktop** et vérifier — Run : `pnpm --filter desktop test && pnpm typecheck` ; Expected : PASS.
- [ ] **Step 4 : commit** `refactor(ui): share the rig and launch models with the TUI`

---

### Task 2 : l'aperçu en couleurs dans le protocole et le daemon

**Files :**
- Modify : `packages/protocol/src/messages.ts`
- Modify : `packages/ledge/src/tmux.ts` (`capture`, l. 86)
- Modify : `packages/ledge/src/daemon/poller.ts` (après `buildPreview`)
- Modify : `packages/ledge/src/daemon/server.ts` (suivis par client, envoi ciblé)
- Test : `packages/protocol/test/messages.test.ts` (ajout), `packages/ledge/test/preview-color.test.ts` (nouveau)

**Interfaces :**
- Produces :
  ```ts
  // messages.ts — client : la session suivie en couleurs par ce client ; id null = plus aucune.
  z.object({ type: z.literal('session.preview.subscribe'), id: z.string().nullable(), color: z.literal(true) })
  // messages.ts — serveur : envoyé au seul client abonné.
  z.object({ type: z.literal('session.preview.color'), id: z.string(), lines: z.array(z.string()) })
  // tmux.ts
  capture(name: string, lines: number, o?: { color?: boolean }): Promise<string | null>   // color → ajoute '-e'
  // poller.ts, options
  colorWanted?(id: string): boolean;
  sendColorPreview?(id: string, lines: string[]): void;
  ```
- `DaemonInfoSchema` gagne `colorPreview: z.boolean().optional()`, mis à `true` dans `sendSnapshot`.

Règles :
- Chaque client suit au plus une session en couleurs. Le serveur tient `Map<client, id>`, la vide à la fermeture du socket, et ne capture en couleurs que les sessions qui ont au moins un client.
- La détection des invites continue de lire la capture sans couleur. La capture en couleurs est une seconde capture, faite seulement quand le hash de la capture simple a changé, ou à l'abonnement (première image immédiate).
- Les lignes en couleurs sont les `PREVIEW_CAPTURE_LINES` dernières, sans le découpage de l'adaptateur, puisque `buildPreview` ne sait pas lire les codes couleur.
- `session.preview` (sans couleur) est inchangé et continue d'aller à tous les clients.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('session.preview.subscribe parses with color true and id null', () => { /* ClientMessageSchema.parse(...) ok ; color: false refusé */ });
test('a subscribed client gets session.preview.color, another client does not', async () => {
  /* deux clients ; A s'abonne à s1 ; le faux tmux renvoie '\x1b[32m● ok\x1b[0m' pour -e ;
     A reçoit { type: 'session.preview.color', id: 's1', lines: ['\x1b[32m● ok\x1b[0m'] } ; B ne reçoit rien de tel */ });
test('the daemon stops color captures once the subscriber closes', async () => {
  /* A s'abonne puis ferme ; le pane change ; aucun appel capture avec -e après la fermeture */ });
test('subscribing to another session moves the color capture', async () => { /* s1 puis s2 : seules les captures -e de s2 continuent */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/protocol test -- messages && pnpm --filter @paradow/ledge test -- preview-color` ; Expected : FAIL.
- [ ] **Step 3 : implémenter** les schémas, l'option `color` de `capture` (`['capture-pane', '-p', '-J', ...(o?.color ? ['-e'] : []), '-t', …]`), les deux options du poller et les suivis du serveur.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): color previews for the clients that ask for them`

---

### Task 3 : `@ledge/fleet` suit l'aperçu en couleurs

**Files :**
- Modify : `packages/fleet/src/store.ts` (`colorPreviews: Map<string, string[]>`, cas `session.preview.color`, purge à `session.removed` et au `snapshot`)
- Modify : `packages/fleet/src/fleet.ts` (le message passe par le routage par `id` existant, l. 379 ; la réponse est qualifiée comme `session.preview`)
- Create : `packages/fleet/src/colorPreview.ts`
- Modify : `packages/fleet/src/index.ts`
- Test : `packages/fleet/test/color-preview.test.ts`

**Interfaces :**
- Consumes : tâche 2.
- Produces :
  ```ts
  /** Abonne ce client à la session en couleurs tant que le composant est monté ; se réabonne à chaque snapshot ;
   *  undefined tant que rien n'est arrivé, ou si le daemon de la machine n'annonce pas `colorPreview`. */
  export function useColorPreview(client: DaemonClient, id: string | null): string[] | undefined;
  ```

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('useColorPreview subscribes with color and unsubscribes on unmount', () => { /* sent : subscribe {id:'s1',color:true} puis {id:null,color:true} */ });
test('a remote session is subscribed on its machine with its bare id', () => { /* id 'ec2:ab12' → message vers le pair ec2 avec id 'ab12' ; la réponse revient en 'ec2:ab12' */ });
test('it subscribes again after a new snapshot', () => { /* snapshotSeq +1 → un second subscribe */ });
test('a daemon without colorPreview gets no subscribe', () => { /* daemon.colorPreview absent → rien n'est envoyé, retour undefined */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/fleet test -- color-preview` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(fleet): follow one session's color preview`

---

### Task 4 : le volet Terminal en couleurs dans le TUI

**Files :**
- Create : `packages/ledge/src/tui/model/ansi.ts`
- Modify : `packages/ledge/src/tui/ui/Tail.tsx` (prop `ansi?: boolean`)
- Test : `packages/ledge/test/tui-ansi.test.ts`, `packages/ledge/test/tui-overview.test.tsx` (ajout)

**Interfaces :**
- Consumes : `useColorPreview` (tâche 3).
- Produces :
  ```ts
  export function sgrOnly(line: string): string;                 // garde \x1b[…m, retire tout autre ESC (CSI non SGR, OSC, ESC seul)
  export function cutAnsi(line: string, width: number): string;  // coupe à `width` cellules visibles (cells()), jamais dans une séquence, finit par \x1b[0m
  ```
- Le volet Terminal de la session choisie appelle `useColorPreview(client, s.id)` et rend ses lignes avec `Tail ansi`. Sans lignes en couleurs, il retombe sur `d.previews` comme aujourd'hui. Le titre porte la marque `· en couleurs` quand les lignes viennent de l'aperçu coloré.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('sgrOnly keeps colors and drops other escapes', () => {
  expect(sgrOnly('\x1b[32m● ok\x1b[0m\x1b]0;title\x07\x1b[2K')).toBe('\x1b[32m● ok\x1b[0m'); });
test('cutAnsi counts visible cells and never cuts inside a sequence', () => {
  expect(cutAnsi('\x1b[38;5;77m● Bash\x1b[39m(pnpm dev)', 6)).toBe('\x1b[38;5;77m● Bash\x1b[39m\x1b[0m'); });
test('cutAnsi resets at the end of every line', () => { expect(cutAnsi('\x1b[31mrouge', 20).endsWith('\x1b[0m')).toBe(true); });
test('the terminal pane asks for colors and draws them', async () => {
  /* startTui ; session luna choisie ; le mock reçoit subscribe {id:'luna',color:true} ; il renvoie une ligne verte ;
     lastFrame() contient '● Bash' et le titre « TERMINAL · … · EN COULEURS » */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-ansi tui-overview` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** Le mock de `@ledge/fleet/test/mockDaemon` répond à `session.preview.subscribe` si on lui donne `colorLines`, à ajouter s'il ne le fait pas.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): the terminal pane in its real colors`

---

### Task 5 : l'accueil en trois colonnes et la colonne de gauche

L'écran d'accueil remplace la vue d'ensemble. Sa colonne de gauche est la même partout ; à droite, le contenu suit la sélection : Ledge, une session seule, un rig ou le noyau.

**Files :**
- Modify : `packages/ledge/src/tui/context.tsx` (`Screen = 'home' | 'session' | 'launch' | 'settings' | 'help'`, `SCREENS`, `Focus`)
- Modify : `packages/ledge/src/tui/App.tsx` (écran de départ `home`, touches `1` `2` `3`, plus d'écran `ask` : `/` va à `home` avec la saisie de Ledge active)
- Create : `packages/ledge/src/tui/model/left.ts`, `packages/ledge/src/tui/ui/LeftColumn.tsx`, `packages/ledge/src/tui/screens/Home.tsx`
- Modify : `packages/ledge/src/tui/model/overview.ts` (`overview()` filtre les sessions appariées avec `isStandalone`, et `yours` gagne les escalades)
- Modify : `packages/ledge/src/tui/ui/Frame.tsx` (barre d'état : « n rigs · n agents · n sessions seules · n machines », puis « n t'attend »)
- Delete : `packages/ledge/src/tui/screens/Overview.tsx` (son volet droit devient `ui/SessionDetail.tsx`, sans changement), `packages/ledge/src/tui/screens/Ask.tsx` après la tâche 6
- Modify : `glyphs.ts` (`rig`, `kernel`, `omp`), i18n fr/en
- Test : `packages/ledge/test/tui-left.test.ts`, `packages/ledge/test/tui-home.test.tsx`

**Interfaces :**
- Consumes : `useRigs`, `useEscalations`, `useOpenRig` (lot 2) ; `isStandalone`, `rigKey`, `kernelSplit`, `workingCount`, `rigPlace` (tâche 1).
- Produces :
  ```ts
  export type Focus = { kind: 'ledge' } | { kind: 'yours'; id: string } | { kind: 'session'; id: string }
    | { kind: 'rig'; machine: string; rigId: string } | { kind: 'seat'; machine: string; rigId: string; ref: string } | { kind: 'kernel'; machine: string };
  export type LeftRow =
    | { kind: 'ledge'; preview: string; at?: string; unread: number }
    | { kind: 'yours'; item: { id: string; glyph: 'approval' | 'question'; who: string; where: string; text: string; at: string; escalation?: Escalation; session?: Session } }
    | { kind: 'project'; label: string; color: string; count: number } | { kind: 'branch'; branch: string }
    | { kind: 'session'; s: Session }
    | { kind: 'rig'; rig: Rig; place: RigPlace; working: number; total: number }
    | { kind: 'seat'; rig: Rig; seat: RigSeat; session?: Session } | { kind: 'idle'; rig: Rig; names: string[] }   // « ○ review-b, design · disponibles »
    | { kind: 'kernel'; machine: string; state: OpenRigStatus['state']; seats: string[] };
  export function leftRows(i: { sessions: Session[]; projects: Projects | null; rigs: Rig[]; escalations: Escalation[]; openrig: OpenRigStatus[]; ledge: { preview: string; at?: string; unread: number } }): LeftRow[];
  export function focusOrder(rows: readonly LeftRow[]): Focus[];   // ordre de j k
  export function seatStateLabel(seat: RigSeat, escalations: readonly Escalation[]): { glyph: keyof Glyphs; color: string; label: string }; // « Attend Ledge » si une escalade pending/grace vient de ce siège
  ```
- Règles de la colonne :
  - **Ledge** : deux lignes, « ◖ Ledge. » et l'heure, puis l'aperçu (« Une décision t'attend · factory ») et le compteur de non-lus sur fond `C.danger`.
  - **À toi** : escalades (`pending` ou `grace`, sources `rig`, `operator` et `ask`), puis sessions seules en attente, triées par ancienneté. Une escalade en `grace` porte « Ledge s'en occupe… ». Bordure rouge s'il y en a.
  - **Projets · sessions seules** : comme l'arbre actuel, sans table d'équipe ni table commune.
  - **Rigs** : chaque rig (« ▣ factory 4/6 au travail · dans Ledge » ou « · hors projet », « · sur ec2-build » pour une autre machine), ses sièges actifs, puis une ligne repliée des sièges disponibles. Le noyau en dernier : « ◈ Noyau OpenRig au repos · operator, queue ».
  - Sans OpenRig sur aucune machine, la section Rigs affiche une ligne : « OpenRig n'est pas installé · + pour lancer un rig ».
- Touches de l'accueil : `j` `k` parcourent `focusOrder`, `tab` va au prochain élément d'À toi, `↵` ouvre (Ledge : saisie active ; session : écran 3 ; siège apparié : écran 3), `1` sélectionne Ledge, `2` le rig de la sélection ou le premier rig, `3` ouvre la session ou le siège choisi.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('a paired seat leaves Projets and sits under its rig', () => { /* session build avec rig factory → absente des lignes project/session, présente en seat sous factory */ });
test('À toi lists escalations before waiting sessions, with Ledge s\'en occupe… in grace', () => { /* … */ });
test('a seat whose escalation is open reads Attend Ledge', () => { /* seatStateLabel → label 'Attend Ledge', couleur C.yellow */ });
test('available seats fold into one line', () => { /* review-b et design idle → { kind: 'idle', names: ['review-b','design'] } */ });
test('the kernel row comes last, with its state', () => { /* dernière ligne kind 'kernel' */ });
test('home opens on Ledge and 1 2 3 move between Ledge, the rig and the session', async () => {
  /* startTui avec rigs et escalades ; lastFrame() contient « LEDGE », « À TOI · 3 », « PROJETS · SESSIONS SEULES », « RIGS » ;
     '2' → le contenu droit montre « ▣ FACTORY » ; '1' → « LEDGE · CONVERSATION » */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-left tui-home` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** Étendre `createMockDaemon` (`@ledge/fleet/test/mockDaemon`) avec `rigs`, `escalations`, `openrig` et `thread` s'il ne les sert pas déjà depuis les lots 2 et 4, et `mockupRigs()` / `mockupEscalations()` dans `tui-fixture.tsx`, d'après la maquette (factory 6 sièges dans Ledge, starter 2 sièges, l'escalade « Sessions : passer du fichier JSON à SQLite ? » de `orch-lead@factory`).
- [ ] **Step 4 : relancer** — Expected : PASS ; les tests TUI existants qui ouvraient la vue d'ensemble passent par l'accueil (sélection d'une session seule).
- [ ] **Step 5 : commit** `feat(tui): home in three columns with Ledge, À toi, Projets and Rigs`

---

### Task 6 : la conversation de Ledge et ses décisions

**Files :**
- Create : `packages/ledge/src/tui/model/ledgeConv.ts`, `packages/ledge/src/tui/ui/LedgeConversation.tsx`
- Create : `packages/ledge/src/tui/model/cards.ts` (extrait d'`Ask.tsx` : focus et touches des cartes d'action, sans changement)
- Modify : `packages/ledge/src/tui/screens/Home.tsx`, i18n fr/en
- Delete : `packages/ledge/src/tui/screens/Ask.tsx`
- Test : `packages/ledge/test/tui-ledge-conv.test.ts`, `packages/ledge/test/tui-home.test.tsx` (ajout)

**Interfaces :**
- Consumes : `useLedgeThread`, `answerEscalation`, `useAnswerState`, `sayToLedge` (lot 4, `@ledge/fleet`) ; `threadRows`, `pinnedEscalation`, `relativeAge` (lot 4, `@ledge/ui/chat/ledge/threadModel`) ; `chatView` (`model/chat.ts`) pour le tour de chat d'une bulle qui porte des cartes.
- Produces :
  ```ts
  export interface ConvOpts { t: Messages; g: Glyphs; width: number; open: ReadonlySet<string>; focused?: string; answer(id: string): { state: 'idle' | 'sending' | 'done' | 'refused'; code?: string } }
  /** Les lignes de la conversation, chacune avec l'id de l'élément du fil qu'elle dessine (défilement, focus). */
  export function convLines(rows: readonly ThreadRow[], o: ConvOpts): { lines: Line[]; keys: string[] };
  export function decisionKeys(e: Escalation): { key: string; questionId: string; optionId: string; label: string; recommended: boolean }[]; // '1'…'9' dans l'ordre des questions puis des options
  ```
- Dessin, d'après la maquette (écran « Ledge en tête ») :
  - `day` : « ─── AUJOURD'HUI ─── » centré, en `C.faint`.
  - `user` : « toi · 16:45 » aligné à droite, puis le texte aligné à droite sur fond `C.sel`. Avec `to`, le texte commence par l'adresse en `C.violet` gras.
  - `ledge` : « ◖ Ledge · 16:44 », puis une boîte arrondie (`C.line`) de largeur `min(width - 6, 70)`. Le texte est en Markdown (`markdownLines`). Une bulle `pending` finit par le curseur `g.caret`.
  - `escalation` : dans la bulle de Ledge, une boîte double `C.yellow`, avec le titre « <CATÉGORIE> · <from> · il y a 4 min » (`MANDATE_CATEGORY_LABEL`, `relativeAge`), la question en gras, « Mon avis : … » (`advice`) en `C.dim`, puis les boutons `Button` des options (le recommandé en `primary`), avec leurs touches de `decisionKeys`, et « En parler e ». Répondue : « → <libellé> · par toi » ou « · par Ledge », boutons éteints. Refusée `already_answered` : « Déjà répondu », boutons éteints.
  - `decided` : « J'ai tranché pour <siège> : <résumé>. » puis « Règle du 26/10 · … » en `C.dim`, et le bouton « Revenir dessus u ».
  - `exchanges` : « ▸ ▣ factory · 3 échanges entre agents · 16:36 → 16:42 », et « ↵ déplier » à droite. Déplié (`open`) : « ▾ … z replier », puis une ligne par échange : « │ 16:36  orch-lead → qa  ▤ <texte> » (`▤` et flèche `C.green` pour `task`/`handoff`, `✉` et `C.violet` pour `message`, `◆` et `C.yellow` pour un échange vers `ledge`). Le groupe le plus récent est déplié par défaut.
- Touches quand Ledge est sélectionné : `1`-`9` répondent à l'escalade en focus, par défaut `pinnedEscalation` ; `e` ouvre la saisie avec `about` = cette escalade ; `u` envoie `decision.revisit` pour le `decided` en focus ; `z` replie ou déplie le groupe en focus ; `PgUp` `PgDn` défilent ; `j` `k` dans la conversation déplacent le focus entre éléments actionnables quand la saisie est vide et que la colonne de gauche n'a pas le focus (`tab` bascule entre colonne et conversation).

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('an escalation draws inside a double box with its options and keys', () => {
  /* convLines([...]) → une ligne contient '╔═ ARCHITECTURE · ORCH-LEAD@FACTORY · IL Y A 4 MIN' ; une autre ' 1 · SQLite 1 ' et ' 2 · Garder le JSON 2 ' */ });
test('decisionKeys numbers options across questions', () => { /* 2 questions de 2 options → '1','2','3','4' */ });
test('a user message to a seat starts with the address in violet', () => { /* to '@build' → segment '@build' C.violet */ });
test('the latest exchange group is open and the others folded', () => { /* … '▾' puis '▸' */ });
test('pressing 1 answers the pinned escalation once', async () => {
  /* startTui ; '1' → mock reçoit escalation.answer { id: 'q-117', answers: { q1: 'sqlite' }, by: 'user' } ; second '1' → rien de plus */ });
test('an escalation answered elsewhere shows Déjà répondu and ignores its keys', async () => {
  /* le mock répond rig.result { ok: false, code: 'already_answered' } ; lastFrame() contient « Déjà répondu » ; '2' n'envoie rien */ });
test('u revisits a decided item', async () => { /* decision.revisit { id: 'd-1' } */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-ledge-conv tui-home` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** Les cartes d'action d'une bulle (lancer, relayer, fermer, ranger) gardent leur rendu et leurs touches d'`Ask.tsx`, déplacés dans `model/cards.ts` ; les tests existants d'`Ask` passent sur l'accueil.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): Ledge's conversation with decisions inside its messages`

---

### Task 7 : la saisie de Ledge, ses suggestions et `@siège`

**Files :**
- Create : `packages/ledge/src/tui/model/mention.ts`, `packages/ledge/src/tui/ui/LedgeComposer.tsx`
- Modify : `packages/ledge/src/tui/screens/Home.tsx`, i18n fr/en
- Test : `packages/ledge/test/tui-mention.test.ts`, `packages/ledge/test/tui-home.test.tsx` (ajout)

**Interfaces :**
- Consumes : `Field` et `model/field.ts` (saisie existante, brouillon gardé dans `kept.drafts` sous la clé `'ledge'`) ; `sayToLedge` (lot 4) ; `allSeats` (tâche 1).
- Produces :
  ```ts
  export interface Mention { address: string; rig: string; seat: RigSeat; detail: string }  // address : '@build' ou '@build@factory' si ambigu
  export function mentionAt(text: string, cursor: number): { start: number; query: string } | null;   // le mot '@…' sous le curseur
  export function mentionCandidates(query: string, rigs: readonly Rig[]): Mention[];                  // rigs running|partial, sièges ni stopped ni crashed ; forme longue pour tous les homonymes
  ```
- Règles :
  - Champ « Écrire à Ledge » : titre `C.coral` quand il a le focus, pied « tranche dans son mandat · design, architecture et critique te reviennent » (« design, architecture, critique te reviennent » sous 80 colonnes).
  - Au-dessus : les suggestions « Lance un rig… », « Où en est factory ? », « Qu'as-tu tranché ? », « Qui a besoin de moi ? », choisies avec `alt+1`…`alt+4`. « Où en est <rig> ? » prend le rig le plus actif. « Lance un rig… » ouvre la fenêtre de lancement (tâche 10) au lieu d'envoyer.
  - `@` ouvre une liste de complétion (boîte `C.violet`, au plus 5 lignes, au-dessus du champ) : « @build  factory · Reprise après reboot · Au travail ». `↑` `↓` choisissent, `tab` complète, `esc` ferme la liste sans perdre le texte.
  - `↵` envoie `sayToLedge(client, text)`. Le daemon décide si le texte vise un siège (lot 4) ; le TUI n'interprète pas `@`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('mentionAt finds the word under the cursor', () => { expect(mentionAt('relance @bu', 11)).toEqual({ start: 8, query: 'bu' }); });
test('homonyms get their long address', () => {
  /* build dans factory et dev-build/@build dans starter → ['@build@factory', '@build@starter'] */ });
test('stopped seats and stopped rigs are not offered', () => { /* … */ });
test('tab completes and ↵ sends a ledge.say', async () => {
  /* '/' ; taper '@bu' ; tab → champ '@build ' ; taper 'relance les tests' ; ↵ → ledge.say { text: '@build relance les tests' } */ });
test('a refused send keeps the reason in the thread and nothing is lost', async () => {
  /* le mock pousse user {to:'@build'} puis ledge « @build est arrêté (factory) » ; lastFrame() les contient */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-mention tui-home` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): write to Ledge, with suggestions and @seat completion`

---

### Task 8 : le rail, les onglets Rigs et Mandat, et les terminaux étroits

**Files :**
- Create : `packages/ledge/src/tui/ui/LedgeRail.tsx`, `packages/ledge/src/tui/ui/LedgeTabs.tsx`
- Modify : `packages/ledge/src/tui/screens/Home.tsx`, i18n fr/en
- Test : `packages/ledge/test/tui-rail.test.tsx`

**Interfaces :**
- Consumes : `useRigs` (lot 2) ; `decisions`, `rules`, `mandate` du store s'ils existent (lot 7) ; `workingCount` (tâche 1) ; `sayToLedge`.
- Produces : `LedgeRail(p: { width: number })`, `LedgeTabs(p: { tab: 'conversation' | 'rigs' | 'mandat'; width: number; height: number })`.
- Rail (34 colonnes, d'après la maquette) :
  - « RIGS · n » : « ▣ factory  4/6 ████████░░░░ » (barre `C.red` sur `C.line`, 12 cellules), une ligne pour le noyau, puis « 2 · la pièce du rig ».
  - « TRANCHÉ AUJOURD'HUI · n » : décisions `by: 'ledge'` du jour, « ✓ build merge, pas de rebase », puis « u revenir dessus ». Masqué sans décision du jour, ou sans `decisions` dans le store.
  - « MANDAT » : « Ledge tranche seul : » puis les catégories `git`, `tests`, `context`, `code` ; « Te reviennent toujours : » puis `design`, `architecture`, `critical` en `C.yellow` ; « m le mandat et ses souvenirs ». Les libellés viennent de `MANDATE_CATEGORY_LABEL`.
  - Le bouton « Résumer la journée R », qui envoie `sayToLedge(client, 'Résume ma journée : ce que les rigs ont fait, ce que j\'ai tranché, ce qui m\'attend.')`.
  - Pas de section À toi : elle est dans la colonne de gauche.
- Onglets (titre de la boîte centrale « LEDGE · CONVERSATION · RIGS · MANDAT », onglet courant en `C.fg` gras) :
  - **Rigs** : une ligne par rig de toutes les machines (nom, place, machine, « n/m au travail », spec, branche) ; `↵` sélectionne le rig (sa pièce, tâche 9).
  - **Mandat** : le texte de `mandate` en Markdown, puis les règles (`active`, puis `proposed` en `C.blue` « à valider »). Sans données du lot 7 : « Le mandat arrive avec le cerveau de Ledge. »
- Tailles : à partir de 140 colonnes, le rail à droite. De 100 à 139, une ligne en tête de la conversation, « ▣ factory 4/6  ▣ starter 1/2  ◈ noyau au repos  ✓ 3 tranchées  ] détail » ; `]` ouvre le rail en surimpression, `esc` le ferme. Sous 100, la colonne de gauche seule, puis `↵` sur Ledge ouvre la conversation plein écran.

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('the rail shows Rigs, Tranché aujourd\'hui and Mandat, never À toi', () => { /* à 160 colonnes : « RIGS · 2 », « TRANCHÉ AUJOURD'HUI · 3 », « MANDAT » ; « À TOI » une seule fois dans le cadre */ });
test('Tranché aujourd\'hui is hidden without decisions', () => { /* … */ });
test('R sends the day summary', async () => { /* ledge.say avec 'Résume ma journée' */ });
test('← → switch Conversation, Rigs and Mandat', async () => { /* → : « factory » en liste ; → : « Le mandat arrive avec le cerveau de Ledge. » */ });
test('at 112 columns the rail folds into one line and the decision can still be answered', async () => {
  /* COLUMNS=112 ; lastFrame() contient '] détail' et ' 1 · SQLite 1 ' ; '1' → escalation.answer */ });
test('at 90 columns ↵ on Ledge opens the conversation and the decision is answerable', async () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-rail` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): Ledge's rail, Rigs and Mandat tabs, narrow terminals`

---

### Task 9 : la pièce d'un rig et celle du noyau

**Files :**
- Create : `packages/ledge/src/tui/model/rigRoom.ts`, `packages/ledge/src/tui/ui/RigRoom.tsx`
- Modify : `packages/ledge/src/tui/screens/Home.tsx`, i18n fr/en
- Test : `packages/ledge/test/tui-rig-room.test.ts`, `packages/ledge/test/tui-home.test.tsx` (ajout)

**Interfaces :**
- Consumes : `useRigs`, `useEscalations`, `client.fleet.exchanges` et `requestExchanges` (lot 2) ; `kernelSplit`, `rigPlace`, `seatSession`, `workingCount` (tâche 1) ; `useColorPreview` (tâche 3) ; `fleet.seatTerminal(machine, ref)` (lot 3) pour `a`.
- Produces :
  ```ts
  export interface SeatRow { seat: RigSeat; session?: Session; state: { glyph: keyof Glyphs; color: string; label: string }; agent: string; ctx?: number; topic: string }
  export function seatRows(rig: Rig, byId: ReadonlyMap<string, Session>, escalations: readonly Escalation[]): SeatRow[];  // ordre du graphe ; topic = session.topic ?? '—'
  export function queueOf(rig: Rig, exchanges: readonly Exchange[], escalations: readonly Escalation[]): { id: string; glyph: 'task' | 'approval' | 'ok'; to: string; title: string; state: 'en cours' | 'à toi' | 'fait' }[];  // tâches et passations du rig, et ses escalades ouvertes
  ```
- Pièce d'un rig (d'après l'écran « La pièce d'un rig ») :
  - Plaque : « ▣ FACTORY · RIG · DANS LEDGE » (ou « HORS PROJET », « · SUR EC2-BUILD »), bordure de la couleur du rig (`rigColor`), puis « ● 4/6 au travail ████░░ ⎇ feat/rigs · spec factory · 6 sièges · depuis 14:02 · Local ».
  - Tableau des sièges : « SIÈGE  NOM  ÉTAT  AGENT  CONTEXTE  SUR », adresse en `C.violet`, contexte en `C.yellow` à partir de `useContextNear`.
  - En dessous, côte à côte : « ÉCHANGES · FACTORY · RIG SEND » (les 200 derniers, du plus ancien au plus récent, Ledge et « toi » en `C.coral`), et « FILE OPENRIG · FACTORY · n » (`queueOf`). Sous 140 colonnes, la file passe sous les échanges.
  - En bas : « TERMINAL · <siège> · FACTORY », l'aperçu en couleurs du siège choisi (tâche 4). Un siège sans session appariée : « Pas encore de terminal suivi. »
  - Un rig `unreachable` : « injoignable » à la place de l'état, actions éteintes.
- Pièce du noyau : plaque « ◈ NOYAU OPENRIG · LA MÉCANIQUE », état du daemon OpenRig (« ● daemon en marche · 127.0.0.1:7433 · OpenRig 0.6.14 · humain : ledge@external » depuis `OpenRigStatus`), sièges `kernelSplit(rig).shown`, puis « +2 rangés » avec les noms de `hidden`. En dessous, les échanges du noyau et la file de toutes les machines. Pas de « Redémarrer le daemon » ni de mise à jour : hors du contrat des lots 2 à 5.
- Touches : `j` `k` sièges, `↵` ouvre l'écran 3 du siège apparié, `a` attache (`fleet.seatTerminal`, puis `runInTerminal`), `w` sélectionne Ledge et ouvre la saisie pré-remplie avec l'adresse du siège (« @build » ou la forme longue), `1` revient à Ledge.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('seatRows marks the seat whose escalation is open as Attend Ledge', () => { /* orch-lead */ });
test('queueOf lists tasks, handoffs and the rig\'s open escalations', () => { /* q-117 ◆ ledge à toi */ });
test('the rig room draws its plate, seats, exchanges, queue and terminal', async () => {
  /* '2' ; lastFrame() contient « ▣ FACTORY · RIG · DANS LEDGE », « @lead », « Attend Ledge », « ÉCHANGES · FACTORY », « FILE OPENRIG », « TERMINAL · ORCH-LEAD » ;
     le mock a reçu rig.exchanges.request { rigId: 'factory' } */ });
test('w opens Ledge\'s field with the seat address', async () => { /* champ = '@review-a ' */ });
test('an unreachable rig turns its actions off', async () => { /* lifecycle unreachable → « injoignable » */ });
test('the kernel room shows operator and queue, and the hidden seats as +2', async () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-rig-room tui-home` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): a rig's room and the OpenRig core's room`

---

### Task 10 : les actions d'un rig, « Arrêter… » et « Ranger dans un projet… »

**Files :**
- Create : `packages/ledge/src/tui/model/rigActions.ts`, `packages/ledge/src/tui/ui/RigConfirm.tsx`
- Modify : `packages/ledge/src/tui/ui/RigRoom.tsx`, `packages/ledge/src/tui/ui/SessionCard.tsx` (pas de touche de fin de vie pour une session appariée), i18n fr/en
- Test : `packages/ledge/test/tui-rig-actions.test.tsx`

**Interfaces :**
- Consumes : `rig.act`, `rig.adopt`, `rig.result` (lot 5) ; `RigRepo` des rigs hors projet (lot 5) ; `client.onMessage`, sur le modèle de la relève dans `Overview.tsx`.
- Produces :
  ```ts
  /** Envoie le message et rend une promesse du rig.result de ce rid (5 s au plus, puis { ok: false, code: 'failed', reason: 'timeout' }). */
  export function rigCall(client: DaemonClient, msg: Extract<ClientMessage, { type: 'rig.act' | 'rig.adopt' }>): Promise<{ ok: boolean; code?: string; reason?: string }>;
  export function adoptChoices(rig: Rig, projects: Projects | null): { projectId: string | null; label: string; note?: string }[]; // projet qui contient déjà un dépôt du rig en premier (« contient déjà web »), puis les autres, puis « Laisser hors projet »
  ```
- Touches de la pièce : `r` relancer le siège choisi (`verb: 'restart'`, confirmation d'une ligne) ; `S` « Arrêter… » ouvre une boîte double `C.red` : « Arrêter le rig » (`verb: 'down'`) ou « Seulement ce siège » (`verb: 'stop'`), `esc` annule ; `p` « Ranger dans un projet… », pour un rig hors projet, ouvre une boîte double `C.coral` avec `adoptChoices` et la note « atlas garde sa pièce ; sa plaque dira « dans Website ». Il ne devient pas une seconde table de Website. » ; « Reprendre » (`verb: 'restore'`) sur un rig `stopped`.
- Rig hors projet : sa pièce montre en plus « DÉPÔTS TROUVÉS EN ROUTE · n » (`rig.repos`) : « ⎇ api  github.com/… cloné par dev · 15:02 · ⎇ feat/client ».
- Chaque résultat finit en toast : `ok` → « factory s'arrête » (vert), `rig_managed`, `openrig_down`, `unreachable`, `failed` → leur raison (rouge).

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('S then « Arrêter le rig » sends rig.act down after confirmation', async () => { /* rig.act { verb: 'down', rigId: 'factory' } ; rien avant la confirmation */ });
test('S then « Seulement ce siège » stops the selected seat', async () => { /* verb 'stop', seatRef 'orch-lead@factory' */ });
test('adoptChoices puts the project that already holds a repo first', () => { /* Website (contient déjà web) avant Ledge, puis « Laisser hors projet » */ });
test('p then ↵ adopts the off-project rig', async () => { /* rig.adopt { rigId: 'atlas', projectId: 'website' } */ });
test('a refused action shows its reason', async () => { /* rig.result { ok: false, code: 'openrig_down', reason: 'OpenRig est arrêté' } → toast */ });
test('a paired seat offers no kill or close key', async () => { /* SessionCard d'un siège : pas de libellé de fermeture */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-rig-actions` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): rig actions through OpenRig, stop and adopt`

---

### Task 11 : l'écran Session d'un siège et la session seule

**Files :**
- Modify : `packages/ledge/src/tui/screens/Session.tsx`, `packages/ledge/src/tui/ui/SessionDetail.tsx` (ex-volet droit de la vue d'ensemble), i18n fr/en
- Test : `packages/ledge/test/tui-screens.test.tsx` (ajout)

**Interfaces :**
- Consumes : `session.rig` (lot 2), `useColorPreview` (tâche 3), `sayToLedge` (lot 4).
- Règles :
  - Pour un siège apparié, le fil d'ariane est « Rigs › ▣ factory › @build › build · Local », le titre « BUILD · @BUILD · ▣ FACTORY · CLAUDE CODE · OPUS », et `←` revient à la pièce du rig.
  - Le champ d'écriture d'un siège s'intitule « Écrire à build · @build · factory », avec le pied « rig send signé Ledge · l'échange s'affiche aussi dans le fil de Ledge ». `↵` envoie `sayToLedge(client, '@build@factory <texte>')` (forme longue, toujours sans ambiguïté), et non une saisie dans le pane.
  - Les réponses aux invites d'un siège (permission, question) restent celles d'une session seule (`y`, `n`, `1`-`9`), puisqu'elles ne touchent pas son cycle de vie.
  - Une session seule garde l'écran actuel ; seul son volet Terminal passe en couleurs (tâche 4).

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('a seat\'s session screen shows its rig crumb and writes through Ledge', async () => {
  /* ouvrir build ; lastFrame() contient « Rigs › ▣ factory › @build » ; écrire 'go' ↵ → ledge.say { text: '@build@factory go' }, aucun session.send */ });
test('← goes back to the rig room', async () => { /* … */ });
test('a standalone session still types into its pane', async () => { /* luna : comportement actuel inchangé */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-screens` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): a rig seat's session screen writes through Ledge`

---

### Task 12 : le fil OMP dessiné en terminal

**Files :**
- Create : `packages/ledge/src/tui/model/ompPane.ts`
- Modify : `packages/ledge/src/tui/ui/SessionDetail.tsx` (pour `tool === 'omp'`, le volet Terminal devient « π FIL · OMP »)
- Test : `packages/ledge/test/tui-omp-pane.test.ts`

**Interfaces :**
- Consumes : `ThreadItem` (`@ledge/protocol`), le fil déjà demandé par `session.thread` ; `toolLines`, `markdownLines` (`model/thread.ts`, `model/markdown.ts`), à exporter s'ils ne le sont pas.
- Produces :
  ```ts
  export function ompPaneLines(items: readonly ThreadItem[], o: { t: Messages; g: Glyphs; width: number; now: number; name: string; working: boolean }): Line[];
  ```
- Dessin, d'après l'écran « Une session OMP : le fil, version Ledge » :
  - `prompt` : « ❯ » en `C.coral` puis le texte en gras ; dessous « toi · 16:30 » en `C.faint`.
  - Premier `message` ou `reply` d'un tour : « π Lyra · 16:30 » (`π` en couleur OMP `#00b4ff`, ajoutée à la palette comme `omp`), puis le texte en Markdown, indenté de 2.
  - `tool` : « ✓ read    src/client.ts » avec la durée alignée à droite ; en cours : `◐` en `C.blue` et le temps écoulé ; échec : `✗` en `C.red`. Les diffs et sorties de test réutilisent `toolLines`, sous une barre `│`.
  - `helper` : « ↳ explorer · trouver les appels à fetch · ✓ 12 s » en `C.violet`.
  - La dernière ligne, quand la session travaille : « ◐ écrit… · 41 s ».
  - Le volet est ancré en bas : il montre les dernières lignes, et `PgUp` remonte.
  - Pied de la boîte : « piloté par RPC · rien n'est tapé dans un terminal ». `a` ne s'applique pas : le toast actuel `noTerminalOmp` reste.
  - Le raisonnement d'OMP n'est pas dans `ThreadItem` (spec OMP du 20/10) : rien n'est dessiné pour lui.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('a prompt, a reply and tools draw like a terminal', () => {
  /* lignes contenant '❯ Ajoute la gestion du 429', 'π Lyra · 16:30', '✓ read', '0,0 s' à droite */ });
test('a running tool shows its spinner and elapsed time', () => { /* '◐ bash' et '3 s' */ });
test('the pane keeps the last lines when it overflows', () => { /* 200 éléments → la dernière ligne est celle du dernier élément */ });
test('an OMP session shows π FIL · OMP instead of a terminal', async () => { /* startTui avec une session omp ; « Π FIL · OMP » absent, « π » présent dans le titre ; pas de subscribe en couleurs */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-omp-pane` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** `TitledBox` met le titre en capitales : le `π` est écrit à part, en minuscule, comme la maquette.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): OMP's RPC thread drawn as a terminal`

---

### Task 13 : lancer un rig depuis le TUI

**Files :**
- Modify : `packages/ledge/src/tui/screens/Launch.tsx` (mode `rig` à côté de `session`, `ctrl+t` bascule, comme l'ancien mode équipe)
- Create : `packages/ledge/src/tui/model/rigLaunch.ts`
- Modify : i18n fr/en
- Test : `packages/ledge/test/tui-launch.test.tsx` (ajout), `packages/ledge/test/tui-rig-launch.test.ts`

**Interfaces :**
- Consumes : `RigForm`, `rigFormDefaults`, `recommendSpec`, `slugOfGoal`, `whereOf`, `missingOf`, `planRequired`, `primaryAction`, `launchability` (tâche 1) ; `useRigSpecs` (lot 3) ; `rig.prepare` → `rig.plan`, `rig.launch` → `rig.result` (lot 5) ; `useOpenRig`.
- Produces :
  ```ts
  export type RigLaunchStep = { kind: 'form' } | { kind: 'plan'; plan: RigPlan } | { kind: 'starting'; rigId?: string; planId: string };
  export function startingLines(rig: Rig | undefined, plan: RigPlan): { glyph: 'ok' | 'running' | 'held'; label: string; detail: string }[];  // OpenRig, copie, Ledge humain, rig up, sièges n/m, premières tâches
  ```
- Les trois temps, d'après les écrans « Lancer un rig » :
  1. **Formulaire** (« NOUVEAU RIG · LE BUT, LA SPEC, OÙ ») : Mode (◉ rig ○ session), But, Spec (◂ factory ▸, recommandée par `recommendSpec`, avec ses sièges en dessous), Où (◉ dans un projet ◂ ■ Ledge ▸ / ○ hors projet), Dépôt, Branche, « Travailler dans une copie » (coché par défaut), Machine, Nom (`slugOfGoal`, `ctrl+r` pour un autre). Aperçu : « ▣ reboot · rig factory · dans Ledge · 7 sièges · Local ». Boutons : « Lancer ctrl+s » et « Voir le plan v » ; quand `primaryAction(form) === 'plan'`, seul « Voir le plan ctrl+s » reste, avec « Le plan est demandé une fois : le rig écrirait dans ton dépôt. » Une machine non lançable (`launchability`) montre sa raison et la commande d'installation.
  2. **Le plan** (« NOUVEAU RIG · LE PLAN DE LEDGE ») : sièges et modèles, `writes` (« Ajoute dans le dossier : CLAUDE.md .mcp.json .openrig/ … »), et `command` en `C.code`. Boutons « Lancer le rig ctrl+s » et « Retour esc ».
  3. **Le démarrage** (« NOUVEAU RIG · LE DÉMARRAGE ») : `startingLines`, les sièges qui démarrent, une invite de confiance remontée (« design attend ta confiance dans le dossier · ↵ ouvrir l'invite », qui attache le siège), et « Annuler le lancement » (`rig.act { verb: 'down' }`). `↵` ouvre la pièce du rig quand il est `running`.
- « Lance un rig… » (tâche 7) et `+` depuis la section Rigs ouvrent ce mode directement.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('a copy in .worktrees launches straight away, a real repo asks for the plan first', () => {
  /* primaryAction(copy: true) === 'launch' ; copy: false → 'plan' */ });
test('startingLines follows the rig as its seats come up', () => { /* 4/6 prêts → '◐ Sièges 4/6 prêts' */ });
test('ctrl+s in a copy sends rig.prepare then rig.launch', async () => {
  /* ctrl+t ; remplir le but ; ctrl+s → rig.prepare puis, au rig.plan reçu, rig.launch { planId } ; l'écran passe à « LE DÉMARRAGE » */ });
test('without a copy, ctrl+s shows the plan and only then launches', async () => { /* « LE PLAN DE LEDGE » puis ctrl+s → rig.launch */ });
test('a machine without OpenRig shows the install command', async () => { /* OpenRigStatus absent avec install → la commande affichée, ctrl+s éteint */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-launch tui-rig-launch` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(tui): launch a rig in three steps`

---

### Task 14 : l'aide, les touches et la vérification finale

**Files :**
- Modify : `packages/ledge/src/tui/screens/Help.tsx`, `packages/ledge/README.md` (section `ledge tui`), i18n fr/en
- Test : `packages/ledge/test/tui-screens.test.tsx` (ajout), `packages/ledge/test/tui-theme-screens.test.tsx` (thème clair des nouveaux écrans)

**Interfaces :**
- L'aide liste les touches par écran (« PARTOUT », « ÉCRAN LEDGE », « PIÈCE D'UN RIG »), d'après la maquette, et ne cite plus `J`, `R` (reprendre l'équipe) ni `T`.

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('help lists the keys of Ledge and of a rig room', async () => { /* '?' → « ÉCRAN LEDGE », « 1-9 », « PIÈCE D'UN RIG », « S » ; pas de « rejoindre une équipe » */ });
test('the new screens render in the light theme', async () => { /* theme light : accueil, pièce de rig, fil OMP sans couleur codée en dur */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @paradow/ledge test -- tui-screens tui-theme-screens` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vérification complète** — Run : `pnpm typecheck && pnpm test` ; Expected : PASS. Puis `grep -rn "team\|Teams\|roleLabel" packages/ledge/src/tui` ; Expected : rien.
- [ ] **Step 5 : parcours réel, avec l'accord de l'utilisateur** : `ledge tui --here` dans tmux contre le vrai daemon, avec un rig `starter` hors projet lancé depuis le TUI. Capturer l'accueil, la pièce du rig et une décision tranchée au clavier (`tmux capture-pane -e`), et les comparer à la maquette.
- [ ] **Step 6 : commit** `docs(tui): keys and help for Ledge orchestrator`
