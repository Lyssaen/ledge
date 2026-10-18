# Gestion des sessions — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminer, archiver, reprendre, remettre à la table et supprimer une session depuis Ledge Desktop, sans jamais perdre un fil archivé.

**Architecture:**
- Une archive reste dans le store de son daemon, avec un champ `archivedAt`. Quatre messages client la pilotent : `session.archive`, `session.restore`, `session.resume` et `session.delete`.
- Les hooks remontent l'identifiant de conversation de l'agent pour qu'on puisse le reprendre.
- `@ledge/fleet` sépare `sessions` (vivantes) et `archived`.
- Desktop ajoute un menu de session, une confirmation, un toast annulable et un bandeau « archivée ». La sidebar de Nova les réutilisera dans un plan séparé.

**Tech Stack:**
- TypeScript, avec zod pour `@ledge/protocol` ;
- Node, ws et tmux pour le daemon `packages/ledge` ;
- React 19 et Tauri pour `apps/desktop` ;
- Vitest et Testing Library pour les tests unitaires, Playwright pour l'e2e ;
- pnpm.

**Spec:** `docs/superpowers/specs/2026-10-18-session-management-design.md`. La maquette de référence est `docs/mockups/session-management/manage.tsx`, avec son usage dans `observatory.tsx`.

## Global Constraints

- **Plafond des archives :** `ARCHIVE_MAX = 200` par daemon. Au-delà, la plus anciennement archivée est retirée, avec son fil.
- **Délai d'archivage automatique :** `retireMs`, inchangé à 10 min.
- **Reprise :** Claude `['--resume', id]`, Codex `['resume', id]`, Cursor `['--resume', id]`.
- **Refus du daemon :** `error{ id, message, request }`, avec ces messages exacts :
  - `unknown session` ;
  - `the session is still running` (reprise d'une session vivante) ;
  - `no conversation to resume`.
- **Capacité :** le snapshot annonce `daemon.archive: true`. Desktop n'envoie jamais `session.archive|restore|resume|delete` à une machine dont `daemon.archive` n'est pas vrai.
- **Délais côté Desktop :** l'action « Annuler » d'un toast d'archivage vit 8 s ; un toast ordinaire reste à 6 s.
- **Langues :** le français (`fr.ts`) est la source des textes, `en.ts` reçoit la traduction, et les tests e2e tournent en anglais.
- **Raccourcis :** E (archiver), Suppr (supprimer), F2 (renommer), T (terminal), Ctrl Z (annuler l'archivage).
- **Sous-agents :** ils n'ont pas de menu et suivent leur session principale.

## Review Focus

1. **Session vivante lancée par Ledge archivée sur une machine dont le tmux est déjà mort :** l'archivage réussit quand même (tuer un tmux absent n'est pas une erreur). Test dans la tâche 3.
2. **Deux « Archiver » rapides sur la même session (double clic, E répété) :** une seule archive, et le second appel est sans effet. Test dans la tâche 3.
3. **Reprendre une session dont un autre client vient de demander la reprise :** la seconde demande est refusée par `the session is still running`, sans lancer de second tmux. Test dans la tâche 4.
4. **Page d'une session ouverte au moment où un autre client l'archive :** la page reste ouverte et montre le bandeau ; elle n'est pas fermée par `reconcile`. Test dans la tâche 10.
5. **Machine distante dont le daemon est ancien :** Archiver, Reprendre, Remettre et Supprimer y sont désactivés, et aucun message n'est envoyé. Test dans la tâche 8.

---

## Partie A — protocole, daemon, flotte

### Task 1: Le protocole connaît l'archive et les quatre messages

**Files:**
- Modify: `packages/protocol/src/session.ts` (`SessionSchema`)
- Modify: `packages/protocol/src/messages.ts` (`SessionEventSchema` `:17`, `DaemonInfoSchema` `:59`, `ClientMessageSchema` `:139-145`)
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces:
  - `Session.archivedAt?: string` (`z.string().datetime().optional()`) ;
  - `SessionEvent.agentSessionId?: string` ;
  - `DaemonInfo.archive?: boolean` ;
  - les messages client `{type:'session.archive'|'session.restore'|'session.resume'|'session.delete', id: string}` ;
  - `isArchived(s: Pick<Session,'archivedAt'>): boolean`, exporté par `@ledge/protocol`.

- [ ] **Step 1: Write the failing tests** in `messages.test.ts`, inside `describe('session management messages')`:
  - `it('parses archive, restore, resume and delete with an id')` : `parseClientMessage({type:'session.archive', id:'ab12'})` rend l'objet, et de même pour les trois autres types ;
  - `it('refuses them without an id')` : `parseClientMessage({type:'session.delete'})` lève une exception ;
  - `it('keeps archivedAt on a session and agentSessionId on an event')` : `SessionSchema.parse({...base, archivedAt:'2026-10-18T10:00:00.000Z'}).archivedAt` vaut la même chaîne ; un événement `{name:'Stop', at, source:'hook', agentSessionId:'u-1'}` garde `agentSessionId` ;
  - `it('isArchived')` : `isArchived({archivedAt:undefined})` vaut `false` ; avec une date, `true`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/protocol test`. Expected: FAIL (types inconnus).
- [ ] **Step 3: Implement** les schémas ci-dessus et `isArchived`, dans `session.ts`, à côté des helpers existants. Commentez chaque message d'une ligne, comme ses voisins.
- [ ] **Step 4: Run** `pnpm --filter @ledge/protocol test` puis `pnpm -r typecheck`. Expected: PASS. Le daemon ne traite pas encore les nouveaux messages ; il reçoit ses `case` aux tâches 3 et 4. Si `switch (msg.type)` exige l'exhaustivité au typecheck, ajoutez dès maintenant un `case` qui refuse avec `not implemented`.
- [ ] **Step 5: Commit** `feat(protocol): sessions can be archived, restored, resumed and deleted`

### Task 2: L'identifiant de conversation de l'agent suit les hooks

**Files:**
- Modify: `packages/ledge/src/cli/hook.ts` (`mapHook` `:107`, `mapCursorHook` `:272`)
- Modify: `packages/ledge/src/daemon/state.ts` (`reduce`)
- Test: `packages/ledge/test/hook.test.ts`, `packages/ledge/test/state.test.ts`

**Interfaces:**
- Consumes: `SessionEvent.agentSessionId` (tâche 1).
- Produces: `Session.agentSessionId`, tenu à jour par `reduce`. On l'utilise pour reprendre une session.

- [ ] **Step 1: Write the failing tests**
  - `hook.test.ts`, `it('a Claude or Codex hook carries the agent session id')` : `mapHook('claude','Stop',{session_id:'c-1', cwd:'/w'}, at)!.event.agentSessionId` vaut `'c-1'`, et de même avec `'codex'` ;
  - `hook.test.ts`, `it('a Cursor hook carries its conversation id, a helper hook none')` : `mapCursorHook('stop',{conversation_id:'k-1'}, at, {LEDGE_SESSION:'ab12'})!.event.agentSessionId` vaut `'k-1'`. Un hook de sous-agent (`CURSOR_TRANSCRIPT_PATH` d'un autre id) n'a pas `agentSessionId` ;
  - `state.test.ts`, `it('the latest agent session id wins, a helper event changes nothing')` : on applique `Stop{agentSessionId:'a'}`, puis `Stop{agentSessionId:'b'}`, ce qui donne `'b'`. Un événement avec `helperId` et `agentSessionId:'x'` laisse `'b'`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/hook.test.ts test/state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Dans `mapHook`, ajoutez `agentSessionId: str(p.session_id)` à l'événement quand il est présent et que l'événement n'a pas de `helperId`.
  - Dans `mapCursorEvent`, passez `sessionId` à l'événement. `mapCursorHelperEvent` ne le passe pas.
  - Dans `reduce`, appliquez `agentSessionId` quand l'événement en porte un, n'a pas de `helperId`, et que la valeur diffère. Placez ce traitement avant le retour anticipé des sessions `exited`, pour qu'un hook tardif soit tout de même noté.
- [ ] **Step 4: Run** les mêmes tests, puis `pnpm --filter @paradow/ledge test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): remember each agent's own conversation id from its hooks`

### Task 3: Archiver, remettre et supprimer dans le daemon

**Files:**
- Modify: `packages/ledge/src/daemon/store.ts` (ajouter `archive`, `unarchive`)
- Modify: `packages/ledge/src/daemon/server.ts` (`handle` : nouveaux `case`, à côté de `session.dismiss` `:438`)
- Test: `packages/ledge/test/server.test.ts` (nouveau `describe('archive, restore and delete')`, avec les helpers `mk` et `fakeTmux`), `packages/ledge/test/store.test.ts`

**Interfaces:**
- Consumes: les messages de la tâche 1.
- Produces:
  - `Store.archive(id: string, at: string): Session | undefined`. Elle pose `archivedAt` s'il est absent (idempotente), émet `updated`, puis applique le plafond `ARCHIVE_MAX` (export de `store.ts`) en appelant `remove()` sur les plus anciennes archives ;
  - `Store.unarchive(id: string): Session | undefined`. Elle retire `archivedAt` et émet `updated` ;
  - la fonction de `server.ts` `endSession(s: Session): Promise<void>`. Pour une session vivante lancée par Ledge, elle tue le tmux (une erreur `kill` est seulement journalisée) puis applique `PaneGone`.

- [ ] **Step 1: Write the failing tests**
  - `store.test.ts`, `it('archive is idempotent and survives a reload')` : on archive deux fois, `archivedAt` reste le premier. Après `save()`, puis `new Store()` et `load()`, la session est toujours archivée ;
  - `store.test.ts`, `it('keeps at most ARCHIVE_MAX archives, dropping the oldest')` : avec `ARCHIVE_MAX + 1` archives, la plus ancienne disparaît et un `removed` est émis pour elle ;
  - `server.test.ts`, `it('archives a live launcher session: tmux killed, exited, archivedAt set, thread kept')` : `fakeTmux.kill` contient `ledge-ab12`, le `session.updated` reçu a `state:'exited'` et `archivedAt`, et `history.items('ab12')` n'est pas vide ;
  - `it('archives a live session whose tmux is already gone')` : le `kill` du `fakeTmux` lève une erreur, et l'archive est posée quand même ;
  - `it('archives a running hook_only session without stopping it')` : aucun `kill`, et `archivedAt` est posé ;
  - `it('restore clears archivedAt and keeps the session exited')` ;
  - `it('delete kills a live launcher session, then removes it and its thread')` : `session.removed` est diffusé, et `history.items` est vide ;
  - `it('refuses an unknown id for each of archive, restore and delete')` : `error{id, request, message:'unknown session'}`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/store.test.ts test/server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `Store.archive`, `Store.unarchive` et `endSession`, puis les trois `case` dans `handle`.
- [ ] **Step 4: Run** les mêmes tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): archive, restore and delete a session`

### Task 4: Reprendre une session terminée ou archivée

**Files:**
- Modify: `packages/ledge/src/spawn.ts` (`SpawnOptions.id?`, `spawnSession` `:65`)
- Modify: `packages/ledge/src/daemon/server.ts` (près de `CONTINUE_ARGS` `:33`, et un `case 'session.resume'`)
- Test: `packages/ledge/test/server.test.ts` (`describe('resume')`), `packages/ledge/test/launch.test.ts`

**Interfaces:**
- Produces:
  - `SpawnOptions.id?: string` : quand il est donné, `spawnSession` l'utilise au lieu d'en tirer un ;
  - `export const RESUME_ARGS: Record<Tool, (id: string) => string[]>` dans `server.ts` ;
  - `export function resumeKey(s: Session): string | undefined` : `agentSessionId`, sinon, pour Claude, `basename(transcriptPath, '.jsonl')`.

- [ ] **Step 1: Write the failing tests**
  - `launch.test.ts`, `it('spawnSession keeps a given id')` : `spawnSession({..., id:'ab12'})` crée `ledge-ab12` et rend `id:'ab12'` ;
  - `server.test.ts`, `it('resumes an archived Claude session under the same id and name')` :
    - `fakeTmux.created[0].command` se termine par `['--resume', 'u-1']` et ne contient pas `--session-id` ;
    - la session diffusée a le même `id` et le même `name`, `state:'starting'`, `source:'launcher'`, ni `archivedAt` ni `exitedAt`, et garde `topic` ;
  - `it('resumes Codex with resume <id> and Cursor with --resume <id>')` ;
  - `it('falls back to the transcript name for Claude')` : sans `agentSessionId`, avec `transcriptPath:'/h/.claude/projects/x/u-9.jsonl'`, la commande se termine par `['--resume','u-9']` ;
  - `it('refuses a live session and one without a conversation id')` : les messages sont `the session is still running` et `no conversation to resume` ;
  - `it('a second resume right after the first is refused')` : on envoie deux `session.resume` à la suite. Un seul `created`, et la seconde demande reçoit `the session is still running`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/launch.test.ts test/server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `case 'session.resume'`.
  - Le dossier vient de `resolveFolder(s.cwd)`, l'environnement de `agentEnv()`.
  - Appelez `spawnSession({ tool, id: s.id, name: s.name, args: RESUME_ARGS[tool](key), taken: { names: les autres non-exited, ids: [] }, ... })`.
  - Faites ensuite `store.upsert({ ...nouvelle, topic, topicSource, repo, repoPath, branch, worktree, repoId, project: s.project })`.
  - Le `upsert` doit passer de façon synchrone avant tout `await`, pour que la seconde demande voie une session vivante. Marquez donc la session `starting` dans le store avant d'attendre `spawnSession`. Si le lancement échoue, rétablissez l'ancienne session et refusez la demande avec le message de l'erreur.
- [ ] **Step 4: Run** les mêmes tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): resume a finished or archived session in its own conversation`

### Task 5: Le daemon n'oublie plus rien tout seul

**Files:**
- Modify: `packages/ledge/src/daemon/poller.ts:57-59` (archiver au lieu de retirer)
- Modify: `packages/ledge/src/daemon/index.ts:20-22` (`PaneGone` au lieu de `remove`)
- Modify: `packages/ledge/src/daemon/server.ts` :
  - le `case 'session.event'` : un événement d'une session archivée la désarchive ;
  - `sendSnapshot` `:148` : ajouter `archive: true` à côté de `routing: true`.
- Modify: `packages/ledge/src/chat/service.ts:157` (le contexte filtre `isArchived`)
- Test: `packages/ledge/test/poller.test.ts`, `packages/ledge/test/daemon.test.ts`, `packages/ledge/test/server.test.ts`, `packages/ledge/test/chat-service.test.ts`

**Interfaces:**
- Consumes: `Store.archive` et `Store.unarchive` (tâche 3), `isArchived` (tâche 1).

- [ ] **Step 1: Write the failing tests**
  - `poller.test.ts`, `it('archives an exited session after retireMs instead of removing it')` : la session reste dans le store avec `archivedAt`, et aucun `removed` n'est émis ;
  - `poller.test.ts`, `it('leaves an archived session alone')` ;
  - `daemon.test.ts`, `it('a session whose tmux died while the daemon was down becomes exited and keeps its thread')`. Ce test remplace l'attente « drops dead ones » de `daemon.test.ts:20` ;
  - `server.test.ts`, `it('a hook from an archived hook_only session brings it back')` ;
  - `server.test.ts`, `it('the snapshot announces archive: true')` ;
  - `chat-service.test.ts`, `it('the chat context leaves archived sessions out')`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test`. Expected: les nouveaux tests échouent.
- [ ] **Step 3: Implement** les quatre changements.
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test`. Expected: tout passe, y compris `daemon.test.ts:43` (élagage des fils), qui garde les fils des sessions archivées puisqu'elles sont toujours dans le store.
- [ ] **Step 5: Commit** `feat(daemon): finished sessions are archived, never forgotten`

### Task 6: La flotte sépare les sessions vivantes et les archives

**Files:**
- Modify: `packages/fleet/src/store.ts` (`DaemonState`, `empty`, `apply`)
- Modify: `packages/fleet/src/machines.ts` ou l'endroit où `MachineState.daemon` est exposé : ajouter le helper ci-dessous.
- Modify: `apps/desktop/src/fleet/useFleet.ts:41` (`FleetView.archived`)
- Test: `packages/fleet/test/daemon.test.ts`, `packages/fleet/test/fleet.test.ts`

**Interfaces:**
- Produces:
  - `DaemonState.sessions` exclut les archives ;
  - `DaemonState.archived: Session[]`, trié par `archivedAt` décroissant ;
  - `byId` garde tout ;
  - `canManage(machine: { daemon?: DaemonInfo }): boolean`, qui renvoie `machine.daemon?.archive === true`, exporté par `@ledge/fleet` ;
  - `FleetView.archived: Session[]`.

- [ ] **Step 1: Write the failing tests**
  - `daemon.test.ts`, `it('an archived session leaves sessions for archived, and comes back on restore')` : on enchaîne snapshot, puis `session.updated{archivedAt}`, puis `session.updated` sans `archivedAt` ;
  - `fleet.test.ts`, `it('a remote archived session is qualified like any other')` : son id est `machine:id`, et elle arrive dans `archived` ;
  - `fleet.test.ts`, `it('canManage follows daemon.archive')`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/fleet test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Gardez le tri existant (`sorted`) pour `sessions`.
- [ ] **Step 4: Run** `pnpm --filter @ledge/fleet test`, `pnpm --filter overlay test` et `pnpm --filter desktop test`. Expected: PASS ; l'île et Desktop ne voient plus les archives.
- [ ] **Step 5: Commit** `feat(fleet): archived sessions are listed apart`

## Partie B — Ledge Desktop

### Task 7: Menu positionnable et toast avec action

**Files:**
- Modify: `apps/desktop/src/shell/Menu.tsx` (`MenuProps.at?`)
- Modify: `apps/desktop/src/shell/Toast.tsx`
- Modify: `apps/desktop/src/nav/useKeys.ts` (Ctrl Z)
- Test: `apps/desktop/test/menu.test.tsx`, `apps/desktop/test/toast.test.tsx` (nouveau), `apps/desktop/test/keys.test.tsx`

**Interfaces:**
- Produces:
  - `MenuProps.at?: { x: number; y: number }` : le menu s'affiche en `position: fixed` à ce point, ramené dans la fenêtre, et le focus va au premier élément ;
  - `useToast(ms?)` rend `{ notice, notify(text: string, action?: ToastAction), undo(): boolean }`, avec `ToastAction = { label: string; run(): void; ms?: number }`. `undo()` exécute l'action du toast visible et rend `true`, sinon rend `false` ;
  - `<Toast notice action onAction>` ;
  - `recordToastsForTests` garde l'enregistrement du texte.

- [ ] **Step 1: Write the failing tests**
  - `menu.test.tsx`, `it('opens at a point, kept inside the window')` : avec `at={x: innerWidth-5, y: 10}`, `style.left` vaut au plus `innerWidth - largeur` ;
  - `toast.test.tsx`, `it('an action toast shows its button for its own duration and runs once')` : on fait `notify('Wren est archivé.', {label:'Annuler', run, ms: 8000})`. Le bouton « Annuler » est là à 7 s et a disparu à 8,1 s. Un clic appelle `run` une fois et ferme le toast ;
  - `keys.test.tsx`, `it('Ctrl Z runs the visible toast action, and does nothing in a text field')`.
- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/menu.test.tsx test/toast.test.tsx test/keys.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Le style du bouton et du filet de temps vient de `docs/mockups/session-management/manage.css` (`.undo-toast`). Ajoutez-le à la feuille où `.toast` est déjà définie.
- [ ] **Step 4: Run** les mêmes tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): a menu can open at the pointer, a toast can carry an undo`

### Task 8: Les actions de session et leurs confirmations

**Files:**
- Create: `apps/desktop/src/manage/useSessionActions.ts`
- Create: `apps/desktop/src/manage/ConfirmDialog.tsx`
- Modify: `apps/desktop/src/i18n/fr.ts`, `en.ts` (nouvelle clé `manage`)
- Modify: `apps/desktop/src/App.tsx` (créer le hook une fois, monter `ConfirmDialog`)
- Test: `apps/desktop/test/manage-actions.test.tsx` (avec `boot` de `test/helpers.ts` et `createMockDaemon`)

**Interfaces:**
- Consumes: `FleetView.archived` et `canManage` (tâche 6), `notify(text, action)` (tâche 7), `DaemonClient.send`.
- Produces:
  - `useSessionActions({ client, sessions, archived, machines, notify }): SessionActions` ;
  - `type ManageKind = 'end' | 'archive' | 'delete'` ;
  - `interface SessionActions`, avec :
    - `request(kind: ManageKind, ids: string[]): void` : demande confirmation si nécessaire, sinon envoie ;
    - `resume(id: string): void` ;
    - `restore(id: string): void` ;
    - `pending: Confirm | null`, `confirm(): void`, `cancel(): void` ;
    - `allowed(id: string): boolean` : faux si la machine ne passe pas `canManage` ;
  - `Confirm = { kind: ManageKind; names: string[]; live: number; offline: string[]; archived: boolean; kids: number; ids: string[] }`. C'est la forme de la maquette, plus `ids` ;
  - `<ConfirmDialog c onConfirm onCancel />` : un `role="alertdialog"` bâti sur `Modal` ;
  - textes : ceux de `ConfirmDialog` dans `manage.tsx` de la maquette, en `t.manage.*`.

Règles, tirées de la spec :
- **Archiver** : une session vivante (ni `exited` ni `offline`) passe par une confirmation « Terminer et archiver ». Une session terminée ou hors ligne est archivée tout de suite, avec le toast `t.manage.archived(name)` et l'action « Annuler » (8 s), qui envoie `session.restore`.
- **Terminer** et **Supprimer** passent toujours par une confirmation.
- Les ids de sous-agents sont ignorés.

- [ ] **Step 1: Write the failing tests**
  - `it('archiving a finished session sends session.archive at once and offers Annuler, which restores')` ;
  - `it('archiving a working session asks first, then sends session.archive')` ;
  - `it('end and delete always ask; cancel sends nothing')` ;
  - `it('nothing is sent to a machine whose daemon cannot archive')` : machine distante sans `daemon.archive`, `allowed` vaut faux, et `received` ne contient pas `session.archive` ;
  - `it('a refusal from the daemon is shown as a toast')` : `refuse('no conversation to resume', id, 'session.resume')` donne un toast `t.manage.refused(...)`.
- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/manage-actions.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pour lire les refus, reprenez le motif de `fleet/decisions.ts:139-157` (lecture de `errors` filtrés par `request`).
- [ ] **Step 4: Run** le même test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): end, archive, resume, restore and delete, with confirmation and undo`

### Task 9: Le menu de session dans l'atelier

**Files:**
- Create: `apps/desktop/src/manage/SessionMenu.tsx`
- Modify: `apps/desktop/src/atelier/ProjectTable.tsx` :
  - sièges `:140-152` : `onContextMenu` et un bouton frère `.seat-more` ;
  - menu de table `:95-110` : « Archiver les terminées ».
- Modify: `apps/desktop/src/atelier/Unassigned.tsx:150-173` (`onContextMenu`)
- Modify: `apps/desktop/src/atelier/Atelier.tsx:63-84` (E, Suppr, F2 et T sur `focusedId`)
- Modify: les styles de l'atelier, en reprenant `.seat-more` et `.leaving` de `manage.css`
- Test: `apps/desktop/test/atelier-manage.test.tsx`

**Interfaces:**
- Consumes: `SessionActions` (tâche 8), `Menu.at` (tâche 7), `openSessionTerminal(client, s)` (`session/terminal.ts:8`), `Filing.file(s, projectId)` (`atelier/filing.ts`).
- Produces: `<SessionMenu session at? trigger? actions filing projects onOpen onClose />`. Ses entrées, dans l'ordre de la spec :
  - Ouvrir ;
  - Terminal (désactivé hors ligne) ;
  - Renommer… ;
  - Ranger dans… (sous-liste des projets) ;
  - Terminer, ou Reprendre si la session est terminée ;
  - Archiver, ou « Terminer et archiver… » si elle est vivante ;
  - Supprimer….

  Renommer… ouvre une petite boîte de saisie, déposée dans `Modal`, qui envoie `session.rename{id, topic}`. L'entrée est désactivée pour une session terminée.

- [ ] **Step 1: Write the failing tests**
  - `it('right click on a seat opens the session menu at the pointer; Archiver on a finished agent archives it')` ;
  - `it('the seat « … » opens the same menu; Escape closes it and gives the focus back')` ;
  - `it('E archives, Suppr asks to delete, F2 renames and T opens the terminal of the focused agent; a sub-agent seat has no menu')` ;
  - `it('the table menu archives every finished principal of that table')` ;
  - `it('Ranger dans… files the session into the chosen project')` : `filing.file` est appelé.
- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/atelier-manage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter desktop test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): every seat has its session menu`

### Task 10: La page de session : menu d'en-tête et bandeau d'archive

**Files:**
- Modify: `apps/desktop/src/App.tsx:86,113,133,149` : `reconcile` et la recherche de session portent sur `[...sessions, ...archived]`.
- Modify: `apps/desktop/src/shell/TopBar.tsx:98-106` (« … », ou la pastille « Archivée » à la place de `StateBadge`)
- Create: `apps/desktop/src/manage/ArchivedBanner.tsx`
- Modify: `apps/desktop/src/session/SessionPage.tsx:368-380` : bandeau sous le motif de `.frozen-banner`, et la zone de réponse remplacée pour une archive.
- Test: `apps/desktop/test/session-archived.test.tsx`
- E2E: `apps/desktop/e2e/manage.spec.ts`

**Interfaces:**
- Consumes: `SessionActions`, `SessionMenu`, `isArchived`, `ago` (format relatif : celui que la page utilise déjà pour `turn-end`, sinon la fonction `ago` de la maquette).
- Produces: `<ArchivedBanner session actions />`. Ses textes sont « Session archivée », « {ago} · l'agent est arrêté, la conversation est en lecture seule », Remettre à la table, Supprimer… et Reprendre.

- [ ] **Step 1: Write the failing tests**
  - `it('an archived session opens read-only with the banner; Reprendre sends session.resume')` ;
  - `it('a page stays open when another client archives its session, and shows the banner')` : `mock.upsert({...s, archivedAt})` pendant que la page est ouverte. La page reste, et le bandeau apparaît ;
  - `it('the header « … » opens the session menu; Supprimer then confirm sends session.delete and goes back to the atelier')`.
  - Dans `e2e/manage.spec.ts`, `test('archive a finished agent from its seat, undo with Ctrl Z, then archive and reopen it read-only')`. Utilisez `fakeDaemon` et faites vous-même `upsert` avec `archivedAt`, puisque le faux daemon ne fait qu'enregistrer.
- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/session-archived.test.tsx` puis `pnpm --filter desktop e2e -- manage.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter desktop test`, `pnpm --filter desktop e2e` et `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): an archived session reads with its banner, the header has the session menu`

## Après ce plan

- **Plan de Nova (sidebar).** Il consomme `FleetView.archived`, `SessionActions`, `SessionMenu` et `canManage`. Il porte la section Archives, « +N terminées » avec « Archiver », la recherche dans les archives, et la suppression de la vue Liste. Le pied de sa section Archives montre un sélecteur de délai qui n'a pas de daemon derrière dans cette version : il faut le retirer, ou attendre un plan dédié.
- **Mise en service.** Publier le daemon (npm), puis le redémarrer ; ce redémarrage tue les sessions tmux de Ledge. Enfin, construire Desktop sous Windows.
