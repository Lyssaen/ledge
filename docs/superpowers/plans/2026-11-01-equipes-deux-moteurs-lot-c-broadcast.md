# Lot C : broadcast et messages Claude ↔ Claude dans une équipe — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** dans une équipe Ledge, tous les échanges passent par Ledge, et le lead comme l'utilisateur peuvent parler à toute l'équipe d'un coup.

**Architecture :**
- `@team` devient une adresse réservée. Dans `session.message`, le daemon la traite comme un envoi à chaque siège vivant de l'équipe de l'expéditeur, sauf lui, par la mailbox. Elle est réservée au lead.
- Un nouveau message client, `team.broadcast`, sert à l'utilisateur, depuis un front. Chaque siège le reçoit comme une notice d'équipe.
- Le hook de Claude fait passer par la mailbox un `SendMessage` entre deux sièges de la même équipe vivante, au lieu de le laisser partir par le chemin natif de Claude. Il fait de même pour un envoi à `@team`.
- Hors équipe, rien ne change.

**Tech Stack :** TypeScript ESM, zod, vitest, pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md` (§6.2, « Broadcast » et « Messages Claude ↔ Claude »). Plan maître, lot C.

## Global Constraints

- Branche `feat/teams-two-engines`. On ne pousse pas. On ne touche ni `ledge-open-rig` ni `main`.
- **Compatibilité du fil :**
  - les schémas du protocole ne gagnent que des champs optionnels, ou de nouveaux types de message ;
  - les trames figées de `packages/protocol/test/fixtures/ledge-0.32/` passent toujours.
- **Pas de priorité** : un broadcast se range dans la file de chaque siège, dans l'ordre d'arrivée (`mailbox.ts`). Il ne passe devant rien (`first` jamais posé).
- Pas de renommage du code « rig ». `ledge ask` reste tel quel.
- Textes en français.
- Chaque tâche finit verte :
  - `pnpm typecheck` ;
  - `TERM=xterm pnpm --filter <pkg> test`, paquets lancés un par un.
- Échecs connus et antérieurs, à ne pas compter :
  - `brain-remote-integration` (un ou deux tests) ;
  - `chat-service` « keeps only the last 50 turns ».
- Un commit par tâche, en Conventional Commits, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` avec des chemins explicites.

## Review Focus

1. **Un broadcast du lead quand un siège est occupé, au repos ou sorti.**
   - Un siège occupé le reçoit dès qu'il est libre.
   - Un siège sorti ou archivé est sauté.
   - Le compte rendu à l'expéditeur dit combien de sièges l'ont reçu.

   Le test est à la tâche 2.
2. **Un siège qui n'est pas le lead tente `@team`.** On attend un refus clair : seul le lead parle à toute l'équipe. Le test est à la tâche 2.
3. **Un rôle nommé `team` dans un fichier de rôle.** On attend un refus au chargement, avec la raison, sans qu'il intercepte en silence les broadcasts. Le test est à la tâche 2.
4. **Un `SendMessage` d'un siège Claude vers un siège Claude d'une autre équipe, ou vers une session hors équipe.** On attend le chemin natif, inchangé. Le test est à la tâche 3.
5. **Une équipe d'un seul siège : le lead fait `@team`.** On attend un refus (`personne d'autre dans l'équipe`), et pas un « remis à 0 siège » trompeur. Le test est à la tâche 2.

---

### Task 1 : protocole, `team.broadcast` et le compte des destinataires

**Files :**
- Modify : `packages/protocol/src/teams.ts`, `packages/protocol/src/messages.ts`
- Test : `packages/protocol/test/teams.test.ts`

**Interfaces :**
- Produces, dans `@ledge/protocol` :
  - `TEAM_ADDRESS = '@team'` ;
  - `TeamBroadcastSchema = z.object({ type: z.literal('team.broadcast'), rid: z.string().min(1).max(100), team: TeamIdSchema, text: z.string().trim().min(1).max(MESSAGE_MAX), machineId: z.string().optional() })` (client), à ajouter à l'union des messages client ;
  - `TeamBroadcastResultSchema = z.object({ type: z.literal('team.broadcast.result'), rid: z.string(), team: z.string(), sent: z.number().int().min(0).optional(), reason: z.string().optional() })` (serveur), à ajouter à l'union des messages serveur ;
  - `message.ack` gagne `recipients: z.number().int().min(0).optional()`, le nombre de sièges qu'un `@team` a atteints.

  Si `MESSAGE_MAX` vit dans `messages.ts` et que l'importer dans `teams.ts` crée un cycle, il faut le déplacer dans un module neutre et le ré-exporter.

- [ ] **Step 1 : tests.**
  - `parseClientMessage({ type: 'team.broadcast', rid: 'r', team: 'team-ab12', text: 'Pause' })` passe.
  - Un `text` fait de blancs est refusé.
  - `parseServerMessage({ type: 'message.ack', rid: 'r', outcome: 'accepted', recipients: 2 })` garde `recipients`.
  - Sans `recipients`, la trame est inchangée.
  - Le test des trames figées 0.32 reste vert.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN.** Lancer `@ledge/protocol`, puis `pnpm typecheck`. Le daemon doit compiler, même si `team.broadcast` n'y a pas encore de cas : les `switch` exhaustifs du serveur peuvent l'exiger. Dans ce cas, ajouter un cas qui répond `team.broadcast.result` avec `reason: 'pas encore'`, que la tâche 2 remplace.
- [ ] **Step 5 : commit** — `feat(protocol): team.broadcast and the recipients of a message to @team`

### Task 2 : le daemon, `@team` du lead et `team.broadcast` de l'utilisateur

**Files :**
- Modify : `packages/ledge/src/daemon/server.ts` (cas `session.message` et `team.broadcast`), `packages/ledge/src/daemon/roles.ts` (rôle `team` réservé)
- Create : `packages/ledge/src/daemon/broadcast.ts`
- Test : `packages/ledge/test/team-broadcast.test.ts`

**Interfaces :**
- Consumes : `TEAM_ADDRESS`, `TeamBroadcast`, `message.ack.recipients` (tâche 1) ; `LEADER_ROLE` ; `mailbox.submit` et `mailbox.notify` ; `formatTeamNotice`.
- Produces, dans `daemon/broadcast.ts` :
  - **`crewOf(team: Team, sessions: readonly Session[], except?: string): Session[]`** renvoie les sessions des sièges de l'équipe, sauf `except`, sauf les sièges `leaving`, et sauf les sessions sorties ou archivées.
  - **`broadcastFromLead(d, msg): MessageAck`**, où `d` regroupe `{ store, teams, mailbox }` et `msg` est un `session.message` avec `to === TEAM_ADDRESS`. Il refuse dans trois cas :
    - l'expéditeur n'est dans aucune équipe vivante : la raison de `noTeamReason` ;
    - l'expéditeur n'est pas le siège `leader` : `seul le lead (@leader) parle à toute l'équipe : écris à un rôle (ledge send @<rôle> "…")` ;
    - `crewOf` est vide : `personne d'autre dans l'équipe ${team.name}`.

    Sinon, il fait un `mailbox.submit({ ...msg, rid: \`${msg.rid}:${s.id}\`, to: s.name })` pour chaque siège. Il répond `{ type: 'message.ack', rid: msg.rid, outcome: 'accepted' | 'queued', recipients: n }` : `accepted` si au moins un envoi est `accepted`, sinon `queued`. Les envois refusés ne comptent pas dans `n`. Si tous sont refusés, la réponse est `refused` avec la première raison.
  - **`broadcastFromUser(d, msg: TeamBroadcast): TeamBroadcastResult`** :
    - équipe inconnue ou dissoute : `reason: 'aucune équipe ${msg.team}'` ;
    - `crewOf` vide : `reason: 'personne dans l'équipe ${team.name}'` ;
    - sinon, un `mailbox.notify(s.id, formatTeamNotice({ team: team.id, text: \`Message de l'utilisateur à toute l'équipe : ${msg.text}\` }), \`${msg.rid}:${s.id}\`)` par siège, puis `{ sent: n }`.
  - **Rôle réservé.** `parseRole` refuse l'id `team` avec la raison exacte `team est réservé (ledge send @team parle à toute l'équipe) : renomme ce rôle`.

- [ ] **Step 1 : tests** contre un vrai daemon (motif de `team-objective.test.ts`) :
  - **Envoi du lead.** Le lead envoie `session.message { to: '@team', text: 'On fusionne à 17h' }`. On attend un ack `recipients: 2` pour une équipe `leader`, `build`, `review` dont tous les sièges sont vivants. La mailbox contient un message pour chacun des deux autres, avec le texte et l'expéditeur, et rien pour le lead.
  - **Review Focus 1.**
    - Un siège occupé (`working`) reçoit le message en `queued`.
    - Un siège `exited` est sauté, et `recipients` vaut 1.
  - **Review Focus 2.** `build` envoie à `@team`. On attend un refus avec le texte exact.
  - **Review Focus 5.** Une équipe d'un seul siège, `leader`. On attend un refus `personne d'autre dans l'équipe <nom>`.
  - **Envoi de l'utilisateur.** `team.broadcast { team, text: 'Pause' }`. On attend `team.broadcast.result { sent: 3 }`, et une notice d'équipe pour chaque siège vivant, lead compris, qui contient `Message de l'utilisateur à toute l'équipe : Pause`.
  - **Équipe dissoute.** On attend `reason` : `aucune équipe …`.
  - **Review Focus 3.** `parseRole('team', …)` donne la raison exacte. `listRoles` met ce rôle dans `problems`.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
  - Le cas `session.message` appelle `broadcastFromLead` quand `msg.to === TEAM_ADDRESS`, avant `resolveRoleAddress`.
  - Le cas `team.broadcast` appelle `broadcastFromUser`.
  - Le texte du siège (`seatContext`, `packages/ledge/src/daemon/seat.ts:24`) gagne, pour le siège `leader` seulement, la phrase : `Tu es le lead : ledge send @team "…" écrit à toute l'équipe d'un coup.` Pour savoir si le siège est le lead, passer `roleId` ou `role.id`.
- [ ] **Step 4 : GREEN**, sur `@paradow/ledge` en entier.
- [ ] **Step 5 : commit** — `feat(ledge): the lead writes to the whole team with @team, the user with team.broadcast`

### Task 3 : le hook, les messages entre sièges Claude passent par Ledge

**Files :**
- Modify : `packages/ledge/src/cli/hook.ts` (`relayMessage`, `identityContext`), `packages/ledge/src/cli/send.ts` (sortie d'un `@team`)
- Test : `packages/ledge/test/hook.test.ts`, `packages/ledge/test/send*.test.ts` (ou le fichier qui teste `sendOnClient`)

**Interfaces :**
- Consumes : `TEAM_ADDRESS`, `message.ack.recipients` (tâche 1) ; le traitement de `@team` par le daemon (tâche 2).
- Produces :
  - Dans `relayMessage`, avant la résolution `@role` : si `input.to === TEAM_ADDRESS`, passer par `session.message` avec `intercept: true`, et refuser l'outil avec le compte rendu (`deny`).
  - Quand la résolution donne `outcome: 'native'` et que l'expéditeur et la cible sont tous deux des sièges de la même équipe vivante (`sender.team && sender.team === r.target.team`, et l'équipe n'est pas dissoute dans `teams`), envoyer par `session.message` (`intercept: true`) au lieu de réécrire l'adresse. Le compte rendu devient la raison du refus, avec les textes déjà utilisés pour un Codex : `Message transmis par Ledge à … : il le reçoit maintenant.` et `… il le recevra dès qu'il sera libre.`
  - Le compte rendu d'un `@team` :
    - `Message transmis par Ledge à toute l'équipe (${n} sièges).` dans le hook ;
    - `remis à toute l'équipe (${n} sièges)` dans la sortie de `ledge send`, pour Codex et la CLI.
  - Dans `identityContext`, pour un siège Claude (`s.seat` et `s.tool === 'claude'`), la phrase sur SendMessage devient : `Pour écrire à une autre session Ledge, utilise son nom Ledge ou son @rôle comme adresse SendMessage : dans ton équipe, Ledge transmet lui-même le message, dans l'ordre d'arrivée.` Pour une session Claude hors équipe, le texte reste celui d'aujourd'hui.

- [ ] **Step 1 : tests.**
  - Un siège Claude écrit `SendMessage { to: 'Pim' }`, où Pim est un siège Claude de la même équipe. On attend un `session.message` envoyé avec `intercept: true`, et une décision `deny` dont la raison commence par `Message transmis par Ledge à Pim`. Pas d'`updatedInput`.
  - **Review Focus 4.**
    - La même chose vers un Claude d'une autre équipe donne `allow` avec `updatedInput.to` réécrit, comme aujourd'hui.
    - Même résultat vers une session Claude hors équipe.
  - `SendMessage { to: '@team' }` d'un lead. On attend `deny` avec `Message transmis par Ledge à toute l'équipe (2 sièges).`
  - `sendOnClient(['@team', 'Pause'])` sur un ack `recipients: 2`. On attend `remis à toute l'équipe (2 sièges)`.
  - `identityContext` d'un siège Claude contient la nouvelle phrase. Celui d'une session Claude hors équipe garde l'ancienne.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN**, sur `@paradow/ledge` en entier.
- [ ] **Step 5 : commit** — `feat(ledge): inside a Ledge team, Claude seats message each other through Ledge`
