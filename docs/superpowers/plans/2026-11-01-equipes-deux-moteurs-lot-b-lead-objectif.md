# Lot B : le lead reçoit l'objectif, les résultats lui remontent — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une équipe Ledge lancée avec un objectif démarre sans intervention. Son lead reçoit l'objectif comme une tâche, il la découpe pour les autres sièges, les résultats lui remontent, et l'utilisateur ne voit que le résultat final.

**Architecture :**
- L'objectif est un champ optionnel de `team.launch`, et aussi du bloc d'équipe du chat.
- Au lancement, le daemon le donne comme tâche Ledge (`giver: 'ledge'`, `objective: true`) au siège `leader`. Il lui envoie aussi une consigne de départ complète par la mailbox, qui la tape dès que le lead est libre.
- Les autres sièges reçoivent une consigne d'attente.
- La règle « exactement un lead » vit dans le daemon, au chargement et à l'écriture des modèles et au lancement, jamais dans un schéma du fil.
- Le chemin des résultats existe déjà sur `main` :
  - `tellGiver` réveille le donneur ;
  - une tâche donnée par Ledge et close apparaît dans « À toi ».

  Le lot le prouve par des tests et l'étend à l'objectif.

**Tech Stack :** TypeScript ESM, zod, vitest, React (Desktop), pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md` (§6.2 « Lead », « Lancement avec objectif », « Résultats »). Plan maître : `docs/superpowers/plans/2026-11-01-equipes-deux-moteurs.md`, lot B.

## Global Constraints

- **Branche** : `feat/teams-two-engines`, base 6d6ae318. On ne pousse pas. On ne touche ni `ledge-open-rig` ni `main`.
- **Compatibilité du fil** :
  - les schémas d'équipe et de tâche du protocole ne gagnent que des champs optionnels ;
  - la règle « un lead exactement » vit dans le chargeur de modèles, pas dans un schéma du fil ;
  - les trames figées de `packages/protocol/test/fixtures/ledge-0.32/` doivent toujours passer.
- **Pas de renommage du code « rig »**. `ledge ask` reste tel quel.
- **Le lead est le siège de rôle `leader`** (`LEADER_ROLE`), exactement un par équipe. `SeatsSchema` interdit déjà un rôle deux fois : « exactement un » revient donc à « un siège `leader` présent ».
- **Textes** en français, avec l'anglais à côté dans les `i18n` de Desktop (`apps/desktop/src/i18n/{fr,en}.ts`).
- **Chaque tâche finit verte** :
  - `pnpm typecheck` à la racine ;
  - les paquets touchés, lancés un par un (`TERM=xterm pnpm --filter <pkg> test`).
- **Échecs connus et antérieurs**, à ne pas compter :
  - `brain-remote-integration` ×2 ;
  - `chat-service` « keeps only the last 50 turns » (il expire aussi sur `main`).
- Un commit par tâche, en Conventional Commits avec un scope de paquet, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` avec des chemins explicites.

## Review Focus

1. **Le siège `leader` ne démarre pas alors qu'un objectif est donné.** On attend un lancement qui dit pourquoi, pas de tâche orpheline, et aucun objectif perdu en silence. Le test est à la tâche 3.
2. **Le lead se termine avant d'avoir fini l'objectif.** On attend une tâche `dropped`, visible comme tâche Ledge close, donc dans « À toi ». Le test est à la tâche 3.
3. **Un objectif très long ou sur plusieurs lignes.** On attend comme titre la première ligne, coupée à `TASK_TITLE_MAX` (200), et le texte entier dans `text` et dans la consigne. Le test est à la tâche 3.
4. **Un modèle existant sans siège `leader`** (les modèles écrits avant ce lot). On attend qu'il figure dans `problems` avec la raison exacte, et qu'il ne disparaisse pas sans un mot. Le test est à la tâche 2.
5. **Une carte d'équipe du chat dont les sièges n'ont pas de lead.** On attend un `team.failed` avec la raison de la règle, affiché sur la carte. Le test est à la tâche 3.

---

### Task 1 : protocole, l'objectif et le lead sur le fil (champs optionnels)

**Files :**
- Modify : `packages/protocol/src/teams.ts`, `packages/protocol/src/tasks.ts`, `packages/protocol/src/proposal.ts`, `packages/protocol/src/chat.ts`, `packages/protocol/src/actions.ts`
- Modify : `packages/ledge/src/daemon/actions.ts:186` (le `LEADER_ROLE` local devient un ré-export du protocole)
- Test : `packages/protocol/test/teams.test.ts`, `packages/protocol/test/ledge-0.32-frames.test.ts`

**Interfaces :**
- Produces, dans `@ledge/protocol` :
  - `LEADER_ROLE = 'leader'` (déplacé de `daemon/actions.ts`, qui le ré-exporte pour ne casser aucun import) ;
  - `TeamObjectiveSchema = z.object({ goal: z.string().trim().min(1).max(TASK_TEXT_MAX), branch: z.string().trim().min(1).max(200).optional(), done: z.string().trim().min(1).max(2000).optional() })` et `type TeamObjective` ;
  - `TeamLaunchSchema` gagne `objective: TeamObjectiveSchema.optional()` ;
  - `TeamBlockSchema` (proposal.ts) gagne `objective: TeamObjectiveSchema.optional()` ;
  - `ChatTeamProposalSchema` gagne `objective: TeamObjectiveSchema.optional()` ;
  - `TaskSchema` gagne `objective: z.literal(true).optional()` ;
  - `TeamSchema` gagne `objectiveTask: z.string().optional()`, l'id de la tâche « objectif » donnée au lead.

- [ ] **Step 1 : écrire les tests**

```ts
// packages/protocol/test/teams.test.ts
it('team.launch carries an optional objective, and still parses without one', () => {
  expect(parseClientMessage({ type: 'team.launch', rid: 'r', template: 'api', objective: { goal: 'Pagination de /invoices', branch: 'feat/pages', done: 'tests verts' } }))
    .toMatchObject({ objective: { goal: 'Pagination de /invoices', branch: 'feat/pages', done: 'tests verts' } });
  expect(parseClientMessage({ type: 'team.launch', rid: 'r', template: 'api' })).not.toHaveProperty('objective');
  expect(() => parseClientMessage({ type: 'team.launch', rid: 'r', template: 'api', objective: { goal: '  ' } })).toThrow();
});
it('a task may be the objective, a team names its objective task', () => {
  expect(TaskSchema.parse({ ...task, objective: true }).objective).toBe(true);
  expect(TeamSchema.parse({ ...team, objectiveTask: 't1a2b3c' }).objectiveTask).toBe('t1a2b3c');
});
it('a team template without a leader seat still parses on the wire (the rule is the loader\'s)', () => {
  expect(TeamTemplateSchema.safeParse({ id: 'x', name: 'x', seats: [{ role: 'dev' }], source: 'home', path: '/p' }).success).toBe(true);
});
```

Dans `ledge-0.32-frames.test.ts`, ajouter un cas qui fait passer chaque trame figée par le `parseServerMessage` de HEAD et vérifie que le résultat est égal (`toEqual`) à la trame d'entrée. Aucun champ ne doit être perdu ni exigé.

- [ ] **Step 2 : lancer et vérifier l'échec** — `TERM=xterm pnpm --filter @ledge/protocol test -- teams ledge-0.32` : les deux premiers cas échouent, faute du champ.

- [ ] **Step 3 : ajouter les champs et déplacer `LEADER_ROLE`**, comme dans l'Interfaces. Dans `actions.ts` (protocole), mettre à jour la définition `team.launch` :
  - `example` : `{ cwd: '/home/alice/projets/api', name: 'api', seats: [{ role: 'leader', tool: 'claude' }, { role: 'rev-back', tool: 'codex' }], objective: { goal: 'Ajouter la pagination par curseur à /invoices', branch: 'feat/invoices-pages', done: 'tests verts et revue faite' } }` ;
  - à la fin de `when`, ajouter : `; une équipe a exactement un siège leader (son lead) ; quand l'utilisateur a dit ce que l'équipe doit faire, mets-le dans objective (goal, et branch et done s'il les a dits) : le lead le reçoit au lancement` ;
  - dans `task.give`, remplacer dans `when` le passage `ou juste après team.launch quand il a dit ce que l'équipe doit faire` par `(l'objectif d'une équipe qu'on lance va dans objective de team.launch, pas dans une tâche)`.

- [ ] **Step 4 : relancer** : le protocole passe en entier, et `pnpm typecheck` aussi.

- [ ] **Step 5 : commit** — `feat(protocol): a team's objective and its lead on the wire, optional fields only`

### Task 2 : la règle « exactement un lead », et un rôle `leader` par défaut

**Files :**
- Modify : `packages/ledge/src/daemon/teams.ts` (`parseTemplate`, `saveTemplate`), `packages/ledge/src/daemon/server.ts` (`launchTeam`, `template.write`, `team.save`, `team.compose`), `packages/ledge/src/daemon/index.ts` (amorçage du rôle)
- Create : `packages/ledge/src/daemon/leader.ts`
- Test : `packages/ledge/test/team-leader-rule.test.ts`, plus les fixtures de tests existants qui lancent ou écrivent des équipes sans `leader`

**Interfaces :**
- Consumes : `LEADER_ROLE` (tâche 1).
- Produces, dans `daemon/leader.ts` :
  - `leaderIssue(seats: readonly { role: string }[]): string | null` renvoie `null` quand un siège a le rôle `leader`. Sinon, il renvoie exactement : `il manque le siège @leader : une équipe a exactement un lead (ajoute un siège de rôle leader)`.
  - `ensureLeaderRole(dir: string): boolean` écrit `<dir>/leader.md` avec le contenu par défaut ci-dessous, si ce fichier et le marqueur `<dir>/.leader-seeded` sont tous les deux absents. Il écrit alors le marqueur et renvoie `true`. Dans tous les autres cas, il ne fait rien et renvoie `false`. Effet : un utilisateur qui supprime le fichier ne le voit pas revenir.

Contenu par défaut de `leader.md` :
```
---
label: Lead
tool: claude
---
Tu mènes l'équipe. Tu reçois l'objectif comme une tâche : prends-la, découpe le travail, et confie chaque morceau au siège qui convient (ledge task give @<rôle> "<titre>" "<détail>"). Les résultats te reviennent : relis-les, redonne ce qui ne va pas. Quand l'objectif est atteint, rends le résultat final (ledge task done <id> "<ce qui est fait, où, tests>"). Ne code toi-même que ce qui ne se délègue pas.
```

- [ ] **Step 1 : écrire les tests** dans `team-leader-rule.test.ts` :
  - `parseTemplate('api', 'name: api\nseats:\n  - role: dev\n', 'home', '/p')` renvoie la chaîne exacte de `leaderIssue`. `listTemplates` met ce modèle dans `problems` avec cette raison, et ne le met pas dans `templates`.
  - Un modèle `seats: [leader, dev]` se charge.
  - `team.launch` avec `seats: [{ role: 'dev' }]`, contre un vrai daemon (`startDaemon` avec un faux tmux, comme dans `team-data-reload.test.ts`), donne `team.failed` avec cette raison, et aucune équipe n'est créée.
  - `template.write` d'un modèle sans `leader` : `definition.result` porte `code: 'invalid'` et cette raison.
  - `team.save` d'une équipe vivante sans `leader` : `team.saved` porte cette raison.
  - `team.compose` qui retirerait le siège `leader` : `team.changed` porte cette raison, et l'équipe reste inchangée.
  - `ensureLeaderRole` dans un dossier vide écrit le fichier (et `listRoles` y lit `leader`, label `Lead`, tool `claude`). Un deuxième appel renvoie `false`. Après suppression de `leader.md`, il renvoie toujours `false`.

- [ ] **Step 2 : lancer et vérifier l'échec.**

- [ ] **Step 3 : implémenter.**
  - `parseTemplate` refuse avec `leaderIssue`, après la validation de `SeatsSchema`.
  - `launchTeam` vérifie la règle juste après le calcul de `seats`, avant `resolveSeats`, pour un modèle comme pour des sièges ad hoc.
  - Il en va de même pour `template.write`, `team.save` (sur les sièges de l'équipe) et `team.compose` (sur la composition demandée).
  - `startDaemon` appelle `ensureLeaderRole(join(ledgeDir(), 'roles'))` au démarrage, et logue une ligne quand il a écrit le fichier.

- [ ] **Step 4 : remettre les tests existants dans la règle.** Chaque fixture qui lance, écrit, sauve ou compose une équipe sans `leader` gagne un siège `leader`, ou renomme son premier rôle en `leader`. Dans le cas d'un rôle de fichier, ajouter un `leader.md` à la fixture. Ne jamais affaiblir une assertion. Repérer les fichiers avec `grep -rln "seats" packages/ledge/test apps/mobile/test apps/desktop/test packages/fleet/test`, puis lancer chaque paquet.

- [ ] **Step 5 : vérifier** : `pnpm typecheck`, puis `@paradow/ledge`, `desktop`, `mobile` et `@ledge/fleet`, lancés un par un, au vert hors échecs connus.

- [ ] **Step 6 : commit** — `feat(ledge): a team has exactly one lead, checked when templates load, are written and teams launch; a default leader role`

### Task 3 : l'objectif donné au lead au lancement, et les résultats qui remontent

**Files :**
- Modify : `packages/ledge/src/daemon/tasks.ts` (`giveObjective`), `packages/ledge/src/daemon/teamsLive.ts` (`setObjective`), `packages/ledge/src/daemon/server.ts` (`launchTeam`, `launchTeamFromCard`, cas `team.launch`), `packages/ledge/src/chat/service.ts` (`teamFrom` recopie l'objectif du bloc dans la proposition)
- Create : `packages/ledge/src/daemon/objective.ts` (les textes)
- Test : `packages/ledge/test/team-objective.test.ts`

**Interfaces :**
- Consumes : `TeamObjective`, `Task.objective`, `Team.objectiveTask` (tâche 1) ; `leaderIssue` (tâche 2).
- Produces :
  - **`tasks.giveObjective(o: { team: Team; owner: Pick<Session, 'id' | 'name'>; objective: TeamObjective; notice: string }): Task`.** Il crée une tâche :
    - `giver: 'ledge'`, `giverName: 'Ledge'` ;
    - `owner`, `ownerName` ;
    - `state: 'open'`, `objective: true`, `team: team.id` ;
    - `title: objectiveTitle(objective.goal)` et `text: objectiveText(team, objective)` ;
    - un log `give` comme `run({ op: 'give' })`.

    Il envoie `notice` au propriétaire par `mailbox.notify(owner.id, formatLedgeTask({ id, from: 'Ledge', text: notice }), \`${id}:0\`, { first: true })`, et non le texte générique de `tellOwner`.
  - **`teams.setObjective(team: string, task: string): Team`** pose `objectiveTask` et émet `onChange`.
  - **Dans `daemon/objective.ts` :**
    - `objectiveTitle(goal: string): string` : première ligne non vide, coupée à `TASK_TITLE_MAX` avec `…` quand elle dépasse.
    - `objectiveText(team: Pick<Team, 'cwd'>, o: TeamObjective): string` : les lignes `Objectif : <goal>`, `Dépôt : <cwd>`, puis `Branche : <branch>` et `Fini quand : <done>` quand ils sont donnés.
    - `leadNotice(team: Pick<Team, 'name'>, taskId: string, text: string, crew: string): string`, en texte exact :
      `Tu es le lead de l'équipe ${team.name}. Ta tâche ${taskId} est l'objectif :\n${text}\nPrends-la (ledge task take ${taskId}), découpe le travail et confie chaque morceau à un siège (ledge task give @<rôle> "<titre>" "<détail>") ; leurs résultats te reviennent. Quand l'objectif est atteint : ledge task done ${taskId} "<résultat>". Ton équipe : ${crew}.`
      Ici, `crew` liste les autres sièges sous la forme `@<rôle> (<nom>, <outil>)`, séparés par `, `, ou vaut `personne d'autre` pour une équipe d'un seul siège.
    - `waitNotice(team: Pick<Team, 'name'>, role: string, leadName: string): string`, en texte exact :
      `Tu es @${role} dans l'équipe ${team.name}. Le lead (@leader, ${leadName}) a l'objectif et va te confier une tâche : attends-la, ne commence rien d'autre.`

- [ ] **Step 1 : écrire les tests** dans `team-objective.test.ts`, contre un vrai daemon (`startDaemon` avec un faux tmux et un faux launch qui enregistre les sessions, ou le motif de test que `server.test.ts` utilise pour `team.launch`) :
  - **Lancement avec objectif** `{ goal: 'Pagination de /invoices', branch: 'feat/pages', done: 'tests verts' }` sur `seats: [leader, review:codex]`. On attend :
    - `team.launched` dont `team.objectiveTask` est l'id de la tâche ;
    - une tâche `objective: true`, `giver: 'ledge'`, de propriétaire la session du siège `leader`, `state: 'open'`, `title: 'Pagination de /invoices'` ;
    - dans son texte, les lignes `Dépôt : <cwd>`, `Branche : feat/pages` et `Fini quand : tests verts`.
  - **La mailbox** a reçu pour le lead une notice qui contient `Tu es le lead de l'équipe`, l'id de la tâche, et `@review (` suivi du nom et de `codex`. Pour le siège `review`, elle a reçu la notice exacte de `waitNotice`.
  - **Lancement sans objectif** : pas de tâche, pas de notice, et pas de `objectiveTask` (comportement de `main` inchangé).
  - **Review Focus 1** : le lancement du siège `leader` échoue (le faux launch lève une erreur pour le rôle `leader`). On attend un `team.failed` dont la raison contient `@leader` et `objectif non donné : le lead n'a pas démarré`, et aucune tâche créée.
  - **Review Focus 2** : la session du lead passe à `exited`. On attend une tâche objectif `dropped`. `closedLedgeTasks` (de `packages/ledge/src/tui/model/overview.ts`), ou le filtre équivalent de « À toi », la compte.
  - **Review Focus 3** : un `goal` de 3 lignes dont la première fait 250 caractères. On attend un titre de 200 caractères terminé par `…`, et le `goal` entier dans `text` et dans la notice.
  - **Les résultats remontent** :
    - Le lead donne une tâche au siège `review` (`task.cmd give` by lead, `to: '@review'`), puis `review` la termine avec le résultat `fait`. On attend pour le lead une notice qui contient `terminée par` et `fait`.
    - Le lead termine l'objectif avec le résultat `fini`. On attend une tâche objectif `done` avec `result: 'fini'`, un `task.updated` diffusé avec `objective: true`, et aucune notice tapée à qui que ce soit, puisque le donneur est Ledge.
  - **Review Focus 5** : `team.launch` avec `qid` d'une carte du chat dont la proposition a des sièges sans `leader`. On attend un `team.failed` avec la raison de `leaderIssue`.
  - **Carte du chat avec objectif** : le bloc `team.launch` du chat porte `objective`. On attend que `teamFrom` le recopie dans la proposition, et que `launchTeamFromCard` donne l'objectif au lead, comme au premier cas.

- [ ] **Step 2 : lancer et vérifier l'échec.**

- [ ] **Step 3 : implémenter.**
  - `launchTeam` reçoit `objective?: TeamObjective`.
  - Après `spawnSeats`, s'il y a un objectif :
    - **le siège `leader` n'a pas de session** : ajouter `objectif non donné : le lead n'a pas démarré` à la raison, sans tâche ;
    - **sinon** :
      - `giveObjective` avec `leadNotice` ;
      - `teams.setObjective` ;
      - un `waitNotice` par autre siège démarré, par `mailbox.notify(id, formatTeamNotice({ team: team.id, text }), \`${team.id}:wait:${id}\`)`.
  - Le cas `team.launch` passe `msg.objective`.
  - `launchTeamFromCard` passe `p.objective`.

- [ ] **Step 4 : relancer** `team-objective`, puis `@paradow/ledge` en entier.

- [ ] **Step 5 : commit** — `feat(ledge): the lead gets the team's objective at launch, the other seats wait for it, results go back up`

### Task 4 : `ledge team up --goal`, le formulaire de Desktop et la carte du chat

**Files :**
- Modify : `packages/ledge/src/cli/team.ts` (`TEAM_USAGE`, `teamArgs`, `TeamCmd`, sortie de `up`)
- Modify : `apps/desktop/src/launch/TeamLaunch.tsx`, la carte d'équipe du chat de Desktop (le composant qui rend `ChatTeamProposal`, à trouver par `grep -rn "ChatTeamProposal" apps/desktop/src`), `apps/desktop/src/i18n/{fr,en}.ts`
- Test : `packages/ledge/test/team-cli.test.ts`, `apps/desktop/test/team-launch*.test.tsx` (ou le fichier de test existant de `TeamLaunch`), le test de la carte d'équipe du chat

**Interfaces :**
- Consumes : `TeamObjective` (tâche 1) ; `team.launched` avec `team.objectiveTask` (tâche 3).
- Produces :
  - `TeamCmd` `up` gagne `objective?: TeamObjective`.
  - Nouvelle première ligne de l'usage :
    `ledge team up <modèle> [--goal "<quoi>" [--branch <branche>] [--done "<fini quand>"]] [--cwd <dossier>] [--name <nom>]   lancer une équipe ; son lead reçoit l'objectif`
  - La deuxième ligne garde `--seat` et gagne les mêmes options.

- [ ] **Step 1 : écrire les tests.**
  - **`teamArgs`** :
    - `['up', 'api', '--goal', 'Pagination', '--branch', 'feat/p', '--done', 'tests verts']` donne `{ op: 'up', template: 'api', objective: { goal: 'Pagination', branch: 'feat/p', done: 'tests verts' } }` ;
    - `['up', 'api', '--branch', 'x']` sans `--goal` donne `undefined` ;
    - `['up', 'api']` n'a pas d'`objective`.
  - **`runTeam` up** avec objectif : il envoie `team.launch` avec `objective`. Sur `team.launched` avec `objectiveTask: 't1'`, il imprime `équipe <nom> lancée` puis `objectif donné au lead (tâche t1)`.
  - **Desktop `TeamLaunch`** :
    - les champs `goal`, `branch` et `done` vides envoient `team.launch` sans `objective` ;
    - `goal` rempli l'envoie avec `objective.goal` coupé de ses blancs ;
    - `branch` ou `done` rempli sans `goal` désactive le bouton de lancement et affiche le texte `t.teamLaunch.goalNeeded`.
  - **Carte d'équipe du chat** : une proposition avec `objective` affiche le `goal` sous le nom de l'équipe. Sans objectif, rien ne s'affiche.

- [ ] **Step 2 : lancer et vérifier l'échec.**

- [ ] **Step 3 : implémenter.** Textes i18n, avec leurs valeurs exactes :

| clé | fr | en |
|---|---|---|
| `teamLaunch.goal` | Objectif | Objective |
| `teamLaunch.goalHint` | Ce que l'équipe doit faire : son lead le reçoit au lancement | What the team must do: its lead gets it at launch |
| `teamLaunch.branch` | Branche | Branch |
| `teamLaunch.done` | Fini quand | Done when |
| `teamLaunch.goalNeeded` | Écris l'objectif, ou vide la branche et « fini quand » | Write the objective, or clear the branch and "done when" |
| `chat.teamObjective` | Objectif : {goal} | Objective: {goal} |

Le formulaire reste dans `TeamLaunch.tsx`, l'écran isolé repris de `main`, sans nouveau branchement ailleurs.

- [ ] **Step 4 : vérifier** : `pnpm typecheck`, puis `@paradow/ledge` et `desktop`, lancés un par un.

- [ ] **Step 5 : commit** — `feat(ledge,desktop): launch a team with its objective from the CLI, the Desktop form and the chat card`

### Task 5 : vérification sur la vraie machine

Pas de code. L'installation et le redémarrage du daemon demandent l'accord de Guillaume.

- [ ] **Step 1** : construire, `pnpm pack`, `npm i -g` du paquet, puis `systemctl --user restart ledge-daemon`. On attend `ledge team up --help` (ou `ledge team`), qui montre `--goal`. On attend aussi le log `leader role written` au premier démarrage, s'il n'y avait pas de `~/.ledge/roles/leader.md`.
- [ ] **Step 2** : dans un dépôt de test, avec un rôle `review` codex :
  ```
  ledge team up --seat leader --seat review:codex --goal "Ajoute un README qui décrit le dépôt" --done "README commité" --cwd <dépôt>
  ```
  Mesurer :
  - le délai entre le lancement et la première action du lead (`ledge task take`, visible dans `ledge task list --all`) ;
  - le nombre d'interventions de l'utilisateur hors permissions de démarrage.

  On attend l'objectif `taken`, puis une tâche donnée à `@review`, puis l'objectif `done` avec un résultat.
- [ ] **Step 3** : dissoudre l'équipe de test (`ledge team dissolve <id> --close-sessions --yes`), puis noter les mesures dans le ledger.
