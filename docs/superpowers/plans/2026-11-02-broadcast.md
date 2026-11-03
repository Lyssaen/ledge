# Broadcast — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** écrire en une fois à toutes les sessions d'un projet (`@projet:<nom>`) ou à une liste de sessions (`Pim,Nova`), depuis une session (`ledge send`, `SendMessage` de Claude) ou depuis l'interface (Desktop, TUI, téléphone).

**Architecture :**
- **Adresse.** Un analyseur pur, `parseBroadcastAddress`, placé dans le protocole, reconnaît les deux formes d'adresse.
- **Daemon.** Un module `broadcast.ts` résout les destinataires : sessions lancées par Ledge, vivantes, hors sièges OpenRig, sauf l'expéditeur. Il envoie ensuite un message par destinataire, avec un rid par destinataire et une mention de la cible.
  - **Depuis une session**, `session.message` garde son schéma. Il bascule sur le broadcast quand l'adresse en est une. L'accusé de réception (ack) dit à qui le message est parti et qui l'a refusé, et le fil de l'expéditeur n'a qu'une carte.
  - **Depuis l'utilisateur**, un nouveau message client, `session.broadcast`, livre une notice par destinataire et répond `session.broadcast.result`.
- **Hook.** Il fait passer un `SendMessage` de Claude vers une adresse de broadcast par `session.message`, sans `intercept`.

**Tech Stack :** TypeScript ESM, zod, vitest, React (Desktop), ink (TUI), PWA (téléphone), pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-02-broadcast-design.md`.

## Global Constraints

- Branche `feat/broadcast`, tirée de `origin/main` (7469b912). On ne pousse pas sur `main`. À la fin, on pousse la branche sans PR.
- **Compatibilité du fil.** Le protocole ne gagne que des champs optionnels ou de nouveaux types de message. Les opérations téléphone → serveur restent `.strict()`.
- **Pas de priorité.** Un broadcast se range dans la file de chaque destinataire. On ne pose jamais `first`.
- **Destinataires.** `source === 'launcher' && !s.rig && s.state !== 'exited' && !isArchived(s) && (s.tmuxSession || backendOf(s) === 'omp-rpc')`, et pas l'expéditeur.
- **Tests de messagerie** contre le vrai daemon (`startDaemon` ou `startServer`, faux tmux) et la vraie mailbox.
- **Textes** en français, avec l'anglais à côté dans les i18n de Desktop et du TUI.
- **Chaque tâche finit verte :**
  - `pnpm typecheck` à la racine ;
  - les paquets touchés, un par un (`TERM=xterm pnpm --filter <pkg> test`).
- **Échecs connus sur `main`**, à vérifier en début de tâche et à lister :
  - `chat-service` « keeps only the last 50 turns » (s'il échoue sur la base) ;
  - `session-conversation` reconnect côté Desktop (s'il échoue sur la base).
- **Commits** : un par tâche, en Conventional Commits, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` avec des chemins explicites.

## Review Focus

1. **Un projet dont une session est un siège OpenRig ou une session en lecture seule** (`hook_only`). On attend que cette session soit exclue des destinataires, qu'elle n'apparaisse pas dans les refus, et qu'elle ne reçoive jamais le texte. Test à la tâche 2.
2. **Une liste qui nomme l'expéditeur, une session inconnue ou un doublon.** On attend que l'expéditeur soit retiré, que l'inconnue apparaisse dans les refus avec sa raison, et que le doublon ne soit compté qu'une fois. Test à la tâche 2.
3. **Un projet vide ou inconnu.** On attend un refus clair (`aucun projet <nom>`, `personne d'autre dans le projet <nom>`) et pas « remis à 0 sessions ». Test à la tâche 2.
4. **Un `SendMessage` de Claude vers `@projet:x`.** On attend qu'il ne parte jamais par le chemin natif de Claude, qu'il finisse en `deny` avec le compte rendu, et qu'une seule carte apparaisse dans le fil. Test à la tâche 3, contre le vrai daemon.
5. **Un destinataire occupé.** On attend qu'il soit mis en file (`queued`) et qu'il reçoive le message à la fin de son tour, sans que rien ne passe devant ses autres messages. Test à la tâche 2.

---

### Task 1 : protocole

**Files :**
- Create : `packages/protocol/src/broadcast.ts`, exporté par `index.ts`.
- Modify : `packages/protocol/src/messages.ts` (unions client et serveur, `message.ack`), `packages/protocol/src/phone.ts` (opération et résultat du téléphone).
- Test : `packages/protocol/test/broadcast.test.ts`.

**Interfaces :**
- Produces :
  - `BROADCAST_LIST_MAX = 8` et `BROADCAST_SESSIONS_MAX = 32`.
  - `type BroadcastAddress = { project: string } | { names: string[] }`.
  - `parseBroadcastAddress(to: string): BroadcastAddress | null`, qui fonctionne ainsi :
    - `@projet:<nom>` donne `{ project: nom.trim() }`, nom non vide ;
    - `a,b[,…]` donne `{ names }` : noms coupés de leurs blancs, vides retirés, doublons retirés sans tenir compte de la casse, au moins 2 et au plus 8 ;
    - tout le reste donne `null`, y compris un seul nom.
  - `broadcastLabel(a: BroadcastAddress): string` donne `tout le projet <nom>` ou `Pim, Nova`.
  - Client : `session.broadcast { rid: string (1..100), to: { project: string (1..80) } | { sessions: string[] (1..BROADCAST_SESSIONS_MAX) }, text: string (trim, 1..MESSAGE_MAX), summary?: string (..SUMMARY_MAX) }`. Il est envoyé par l'utilisateur. `sessions` contient des ids ou des noms de sessions.
  - Serveur : `session.broadcast.result { rid, sent: { id, name }[], refused: { name, reason }[], reason?: string }`.
  - `message.ack` gagne `recipients?: { sent: string[], refused: { name: string, reason: string }[] }`, une liste de noms.
  - Téléphone :
    - l'opération `session.broadcast { op, sessions: string[] (1..BROADCAST_SESSIONS_MAX), text (1..MESSAGE_MAX) }`, en `.strict()`, avec les mêmes bornes que les autres opérations ;
    - la réponse passe par `operation.result` comme les autres opérations. Lire `phone.ts` pour voir comment une opération rend son résultat, et l'appliquer ici, avec au besoin un champ optionnel qui porte les noms remis et refusés.

- [ ] **Step 1 : tests.**
  - `parseBroadcastAddress('@projet:Billing')` donne `{ project: 'Billing' }`.
  - `parseBroadcastAddress('@projet: ')` donne `null`.
  - `parseBroadcastAddress('Pim,Nova')` donne `{ names: ['Pim','Nova'] }`.
  - `parseBroadcastAddress('Pim, nova ,Pim')` donne `{ names: ['Pim','nova'] }`.
  - `parseBroadcastAddress('Pim')` donne `null`.
  - Une liste de 9 noms donne `null`.
  - Les trois messages et l'opération du téléphone passent.
  - Un `message.ack` sans `recipients` est inchangé.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN** sur `@ledge/protocol`, puis `pnpm typecheck`. Si un `switch` du daemon exige un cas pour le nouveau message, en ajouter un provisoire qui répond `reason: 'pas encore'`.
- [ ] **Step 5 : commit** — `feat(protocol): broadcast addresses, session.broadcast and its result`

### Task 2 : daemon

**Files :**
- Create : `packages/ledge/src/daemon/broadcast.ts`.
- Modify :
  - `packages/ledge/src/daemon/server.ts` : `session.message` et `session.broadcast` ;
  - `packages/ledge/src/daemon/mailbox.ts` : option qui n'enregistre pas la carte « envoyé » pour un envoi qui fait partie d'un broadcast ;
  - `packages/ledge/src/daemon/history.ts`, si une carte unique le demande.
- Test : `packages/ledge/test/broadcast.test.ts`, contre le vrai daemon.

**Interfaces :**
- Consumes : la tâche 1 ; `projectOf` (protocole) et `projects` (server.ts) ; `mailbox.submit` et `mailbox.notify` ; `store`.
- Produces, dans `broadcast.ts` :
  - **`recipientsOf(a: BroadcastAddress | { sessions: string[] }, d: { store; projects: Projects }, except?: string): { targets: Session[]; refused: { name: string; reason: string }[]; reason?: string }`**
    - Pour un projet :
      - le projet se cherche par nom (sans tenir compte de la casse), puis par id ;
      - s'il est introuvable, `reason: 'aucun projet <nom>'` ;
      - les cibles sont les sessions où `projectOf(s, projects) === id` et qui passent le filtre des Global Constraints, sauf `except` ;
      - s'il n'y en a aucune, `reason: 'personne d'autre dans le projet <nom>'`.
    - Pour des noms ou des ids :
      - chaque nom est résolu comme dans `mailbox.target` ;
      - un nom introuvable donne un refus `aucune session Ledge nommée <nom>` ;
      - une session hors filtre donne le refus de la mailbox (`<nom> n'a pas été lancée par Ledge : impossible de lui écrire`), ou `<nom> est un siège OpenRig : écris-lui avec rig send` pour un siège ;
      - l'expéditeur est retiré sans refus ;
      - si aucune cible ne reste, `reason: 'personne à qui écrire'`.
  - **`broadcastFromSession(d, msg: session.message, a: BroadcastAddress): MessageAck`**
    - Un `mailbox.submit` par cible, avec `rid: \`${msg.rid}:${t.id}\``, `to: t.name`, sans `intercept`, avec le texte préfixé de `(à <broadcastLabel>) `, et sans carte par destinataire.
    - Une seule carte dans le fil de l'expéditeur : `sent.record` avec `rid: msg.rid` et `to: '@projet:x'` ou `'Pim, Nova'`.
    - Réponse : `{ type: 'message.ack', rid: msg.rid, outcome, recipients: { sent: [...noms], refused } }`.
      - `outcome` vaut `accepted` si au moins un envoi est accepté, sinon `queued`.
      - Il vaut `refused` (avec `reason`) si aucun envoi ne part.
      - Un `native` ne doit jamais arriver ici : sans `intercept`, la mailbox ne le renvoie pas.
  - **`broadcastFromUser(d, msg: session.broadcast): session.broadcast.result`**
    - Un `mailbox.notify` par cible, avec le texte `Message de l'utilisateur (à <label>) : <texte>`, et le rid `${msg.rid}:${t.id}`.
    - `notify` filtre déjà sur `reachable`. Un `false` devient un refus.
    - Pour `to.sessions`, le libellé est la liste des noms.
- `server.ts` :
  - `session.message` appelle `broadcastFromSession` quand `parseBroadcastAddress(msg.to)` n'est pas `null` ;
  - `session.broadcast` appelle `broadcastFromUser`.

- [ ] **Step 1 : tests** contre le vrai daemon, avec un projet `billing` qui couvre deux dossiers et quatre sessions : Pim et Nova, lancées par Ledge ; Zed, en `hook_only` ; un siège OpenRig `rig`. Une session `Otto` hors du projet.
  - Pim envoie `session.message { to: '@projet:billing' }`. On attend un ack `recipients.sent = ['Nova']` : pas Pim, pas Zed, pas le siège, et aucun refus pour eux (Review Focus 1). La mailbox ne contient que l'envoi pour Nova, dont le texte commence par `(à tout le projet billing) `. Le fil de Pim n'a qu'une seule carte.
  - Pim envoie `to: 'Nova,Otto,Pim,nova,Ghost'`. On attend `sent: ['Nova','Otto']` et `refused: [{ name: 'Ghost', reason: 'aucune session Ledge nommée Ghost' }]` (Review Focus 2).
  - `to: '@projet:nope'` donne un refus `aucun projet nope`. Un projet dont seul l'expéditeur fait partie donne un refus `personne d'autre dans le projet …` (Review Focus 3).
  - Review Focus 5 : Nova est `working`. On attend `queued`. Quand elle passe `idle`, elle reçoit le message après ceux déjà en file.
  - `session.broadcast` de l'utilisateur vers `{ project: 'billing' }` donne `sent` Pim et Nova, avec une notice qui contient `Message de l'utilisateur (à tout le projet billing) : `.
  - Un `session.message` vers un seul nom ne change pas : même ack, même carte.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN** sur `@paradow/ledge`.
- [ ] **Step 5 : commit** — `feat(ledge): broadcast to a project or a list of sessions, from a session or from the user`

### Task 3 : `ledge send` et le hook

**Files :**
- Modify : `packages/ledge/src/cli/send.ts` (sortie d'un broadcast), `packages/ledge/src/cli/hook.ts` (`relayMessage`, `identityContext`).
- Test : `packages/ledge/test/hook.test.ts`, `packages/ledge/test/send*.test.ts` (ou le fichier qui teste `sendOnClient`), plus un test du hook contre le vrai daemon.

**Interfaces :**
- Consumes : `parseBroadcastAddress` et `message.ack.recipients`.
- Produces :
  - **`sendOnClient`.** Pour un broadcast, la sortie est `remis à N sessions (A, B)`, suivie, s'il y en a, de ` ; refusé : X (raison), Y (raison)`. Elle vaut `refusé : <raison>` (code 1) si rien ne part.
  - **`relayMessage`.** Avant `resolveTarget`, si `parseBroadcastAddress(input.to)` n'est pas `null` :
    - envoi `session.message { rid: toolUseId, from, to: input.to, text: input.message, summary? }` sans `intercept` ;
    - la réponse est toujours `deny` avec `Message transmis par Ledge à N sessions (A, B) …` (plus les refus), ou la raison du refus ;
    - jamais `allow` ni `undefined`.
  - **`identityContext`.**
    - Claude : la phrase sur `SendMessage` gagne `Pour écrire à plusieurs sessions d'un coup : @projet:<nom> (tout un projet) ou une liste Pim,Nova comme adresse.`
    - Codex : la phrase sur `ledge send` gagne `ledge send @projet:<nom> "…"` et `ledge send Pim,Nova "…"`.

- [ ] **Step 1 : tests.**
  - `sendOnClient` sur un ack avec `recipients` donne la ligne exacte.
  - **Review Focus 4**, contre le vrai daemon : un siège Claude fait `SendMessage { to: '@projet:billing' }`. On attend `deny` avec `Message transmis par Ledge à 1 session (Nova)`, aucun `updatedInput`, et une seule carte dans le fil de l'expéditeur après le `PostToolUseFailure` de l'outil refusé.
  - `identityContext` donne les nouvelles phrases.
  - Un `SendMessage` vers un seul nom de Claude reste natif, comme avant.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN** sur `@paradow/ledge`.
- [ ] **Step 5 : commit** — `feat(ledge): ledge send and Claude's SendMessage reach a project or a list through Ledge`

### Task 4 : Desktop

**Files :**
- Modify :
  - `packages/fleet/src/fleet.ts` : `session.broadcast` toujours vers `local`, plus une aide `broadcast(to, text): Promise<session.broadcast.result>` qui attend la réponse de même `rid` (motif de `setIsland` / `useTasksApi`, 8 s) ;
  - `apps/desktop/src/atelier/ProjectRoom.tsx` : entrée de menu ;
  - `apps/desktop/src/shell/sidebar/Tree.tsx` : action de la ligne de projet et sélection multiple ;
  - `apps/desktop/src/i18n/{fr,en}.ts`.
- Create : `apps/desktop/src/broadcast/BroadcastDialog.tsx`, une modale, sur le motif des autres modales (`nav/state.ts`, `App.tsx`).
- Test : `apps/desktop/test/broadcast.test.tsx`, `packages/fleet/test/broadcast.test.ts`.

**Interfaces :**
- **Ouvrir la modale « Écrire à tout le projet ».** Deux entrées l'ouvrent :
  - le menu de la plaque d'un projet dans l'Atelier ;
  - une action ✉ sur la ligne de projet de la barre latérale, à côté de « + ».

  La modale contient un champ de texte et un bouton « Envoyer ». Elle envoie `session.broadcast { to: { project: id } }`, affiche le compte rendu (`remis à N sessions…` ; refusés), puis se ferme.
- **Sélection multiple dans la barre latérale.**
  - Ctrl ou Cmd + clic sur une ligne de session l'ajoute à la sélection ou l'en retire.
  - Dès que deux sessions sont sélectionnées, une barre en bas de la barre latérale affiche « N sessions · Écrire… · Annuler ».
  - « Écrire… » ouvre la même modale, avec `to: { sessions: ids }`.
  - Échap vide la sélection.
  - Un clic simple garde son comportement actuel.
- **Textes i18n** (fr / en) :

| clé | fr | en |
|---|---|---|
| `broadcast.project` | Écrire à tout le projet… | Write to the whole project… |
| `broadcast.selection` | Écrire aux {n} sessions… | Write to the {n} sessions… |
| `broadcast.title` | Écrire à {label} | Write to {label} |
| `broadcast.send` | Envoyer | Send |
| `broadcast.sent` | Remis à {n} sessions : {names} | Delivered to {n} sessions: {names} |
| `broadcast.refused` | Refusé : {list} | Refused: {list} |
| `broadcast.cancel` | Annuler | Cancel |

- [ ] **Step 1 : tests.**
  - **Fleet.** `session.broadcast` part vers `local` même quand une autre machine est sélectionnée. `broadcast()` se résout sur le résultat de même `rid`.
  - **Desktop.**
    - Le menu de la plaque et l'action de la ligne de projet ouvrent la modale.
    - Envoyer envoie `session.broadcast { to: { project } }` et affiche le compte rendu.
    - Ctrl + clic sur deux sessions affiche la barre. « Écrire… » envoie `{ sessions: [id1, id2] }`.
    - Échap vide la sélection.
    - Un clic simple ouvre la session comme avant.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN.** `pnpm typecheck`, puis `@ledge/fleet` et `desktop`. Lancer les e2e de Desktop qui touchent la barre latérale et l'Atelier.
- [ ] **Step 5 : commit** — `feat(desktop,fleet): write to a whole project or to selected sessions`

### Task 5 : TUI et téléphone

**Files :**
- Modify : `packages/ledge/src/tui/screens/Overview.tsx`, `packages/ledge/src/tui/i18n/{fr,en}.ts`, `packages/ledge/src/tui/screens/Help.tsx`, `apps/mobile/src/screens/Agents.tsx`, `apps/mobile/src/state/store.ts`, `packages/ledge/src/mobile/gateway.ts`.
- Test : `packages/ledge/test/tui-*.test.tsx`, `apps/mobile/test/screens/agents*.test.tsx`, `packages/ledge/test/mobile-gateway*.test.ts`.

**Interfaces :**
- **TUI**
  - La touche `m` sur une session sélectionnée de la vue d'ensemble ouvre un champ (`Field`) titré `Écrire à tout le projet <nom>`. Le projet est celui de la session, par `projectOf`.
  - ↵ envoie `session.broadcast { to: { project } }`, puis un toast affiche le compte rendu. Échap annule.
  - Une session hors projet donne un toast `cette session n'est dans aucun projet`.
  - La touche est ajoutée à l'aide et à la barre de touches. Textes fr/en.
- **Téléphone**
  - Chaque tête de groupe de l'écran Agents gagne « Écrire au groupe ». Cela ouvre un champ, puis envoie l'opération `session.broadcast { sessions: ids du groupe }`.
  - Le compte rendu s'affiche comme les autres résultats d'opération.
  - La passerelle transmet l'opération au daemon (`session.broadcast` avec `to: { sessions }`) et renvoie le résultat.

- [ ] **Step 1 : tests.**
  - **TUI** : `m`, saisie, puis ↵ envoie `session.broadcast`, et le toast affiche le compte rendu.
  - **Téléphone** : le champ du groupe envoie l'opération avec les ids du groupe.
  - **Passerelle** : l'opération arrive au daemon, et le résultat revient.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN** sur `@paradow/ledge`, `@ledge/mobile` et `@ledge/protocol`.
- [ ] **Step 5 : commit** — `feat(ledge,mobile): write to a whole project from the TUI and to a group from the phone`
