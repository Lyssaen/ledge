# Lot E : les questions du lead passent par le cerveau — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :**
- Une question du lead d'une équipe Ledge devient une escalade. Le cerveau la tranche selon le mandat, comme une escalade OpenRig. Elle ne monte à l'utilisateur que si elle sort du mandat, ou si le cerveau est éteint.
- Un siège qui n'est pas le lead pose ses questions à son lead.

**Architecture :**
- **L'outil du lead** pour poser une question reste `ledge task give ledge "<question>" "<options>"`. Ce choix revient au constructeur selon la spec. Il crée une tâche de décision (`owner: 'ledge'`).
- **Le miroir.** Le pont OpenRig a déjà un deuxième livre d'escalades, celui des asks (`askBook`, ids `ask-<id>`). On lui en ajoute un troisième, celui des décisions (`decisionBook`, ids `task-<taskId>`, `source: 'ask'`, `rigId` = l'équipe). Il est alimenté par les tâches de décision ouvertes. Grâce à lui, ces décisions reçoivent la grâce, le passage au cerveau (`deciding.arrived`), la mémoire, les règles, l'agrégat et les fronts, sans canal à part.
- **La réponse** arrive par `answers.answer`, qu'elle vienne du cerveau ou de l'utilisateur. Elle ferme la tâche de décision (`tasks.run done` par Ledge), et la fin de cette tâche réveille le lead avec la réponse. La file OpenRig n'est pas utilisée pour ces décisions.
- **Le cerveau** tranche ces décisions en texte libre : `ledge brain decide task-… --text "…"`.
- **Les refus.** Un siège non lead qui donne une tâche à `ledge` est refusé, et invité à passer par son lead. Un siège d'équipe qui fait `ledge ask` est refusé aussi, avec la bonne commande. `ledge ask` reste disponible hors équipe.

**Tech Stack :** TypeScript ESM, zod, vitest, React (Desktop), pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md` (§6.2 « Questions » et « Qui pose les questions »). Plan maître, lot E.

## Global Constraints

- Branche `feat/teams-two-engines`. On ne pousse pas. On ne touche ni `ledge-open-rig` ni `main`.
- **Compatibilité du fil** :
  - aucun nouveau littéral dans un enum du fil. On réutilise `source: 'ask'`, et seul le préfixe d'id `task-` distingue ces escalades ;
  - les champs nouveaux sont optionnels ;
  - les trames figées 0.32 passent toujours.
- **Le moteur OpenRig et ses escalades restent tels quels.** La garde du cerveau (`brain/guard.ts`) garde ses règles : mots critiques, catégories, mandat.
- `ledge ask` reste tel quel pour une session hors équipe.
- Textes en français.
- **Chaque tâche finit verte** : `pnpm typecheck`, puis les paquets touchés lancés un par un (`TERM=xterm pnpm --filter <pkg> test`).
- **Échecs connus et antérieurs**, à ne pas compter :
  - `brain-remote-integration` (un ou deux) ;
  - `chat-service` « keeps only the last 50 turns ».
- Un commit par tâche, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` avec des chemins explicites.

## Review Focus

1. **Le cerveau est éteint.** La décision du lead reste `pending` dans « À toi ». L'utilisateur y répond, et le lead est réveillé avec la réponse. Test à la tâche 2.
2. **L'utilisateur répond pendant la grâce du cerveau.** Sa réponse gagne, la décision différée du cerveau tombe, et la tâche n'est fermée qu'une fois. Test à la tâche 2.
3. **Le lead se termine avant la réponse.** La tâche de décision passe `dropped`, l'escalade disparaît de « À toi », et une réponse tardive est refusée proprement. Test à la tâche 2.
4. **La même décision dans Desktop.** Elle n'apparaît qu'une fois dans « À toi » : la carte d'escalade, pas en double avec la carte de décision de tâche. Test à la tâche 3.
5. **Un siège non lead ou un siège qui fait `ledge ask`.** Le refus nomme la commande à utiliser (`ledge task give @leader …`). Test à la tâche 1.

---

### Task 1 : seul le lead escalade

**Files :**
- Modify : `packages/ledge/src/daemon/tasks.ts` (le `give` vers `ledge`, vers la ligne 176), `packages/ledge/src/daemon/asks.ts` (`create`), `packages/ledge/src/cli/hook.ts` (`identityContext`), `packages/ledge/src/daemon/seat.ts` (`seatContext`, pour le siège non lead)
- Test : `packages/ledge/test/lead-escalates.test.ts`, plus des cas dans `hook.test.ts`

**Interfaces :**
- Consumes : `LEADER_ROLE` ; `teams.teamOf(sessionId)` ou l'équivalent dont `tasks.ts` dispose déjà, qui donne l'équipe et le rôle d'un siège.
- Produces, avec ces textes exacts :
  - **`task give ledge`** d'un siège d'une équipe vivante dont le rôle n'est pas `leader` est refusé avec : `seul le lead pose les questions à Ledge : pose la tienne à ton lead (ledge task give @leader "<question>" "<options>")`.
  - **`ask.create`** d'un siège d'une équipe vivante est refusé, avec le code de refus existant le plus proche (lire `asks.ts`) et l'une de ces raisons :
    - pour le lead : `dans une équipe, pose ta question avec ledge task give ledge "<question>" "<options>" : Ledge la tranche selon le mandat ou la remonte`
    - pour un autre siège : le texte du refus précédent.
  - **`identityContext`** d'un siège : la phrase sur les décisions (`hook.ts:412`) devient, pour le lead : `Une question que tu ne peux pas trancher se pose à Ledge avec ledge task give ledge "<question>" "<options, ta recommandation>" : Ledge la tranche selon le mandat de l'utilisateur ou la lui remonte, et sa réponse te réveille.`
    Pour un siège non lead : `Une question que tu ne peux pas trancher se pose à ton lead (ledge task give @leader "<question>" "<options>") : lui seul s'adresse à Ledge.`
    Le texte d'une session hors équipe ne change pas.

- [ ] **Step 1 : tests.**
  - **Contre un vrai daemon** (motif de `team-objective.test.ts`) :
    - `task.cmd give to ledge` par `@review` donne un refus avec le texte exact.
    - Le même par `@leader` crée la décision.
    - `ask.create` par chacun des deux donne un refus avec le texte exact. Par une session hors équipe, il passe.
  - **`identityContext`** : les deux nouvelles phrases, selon le rôle, et l'ancienne pour une session hors équipe.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.** Pour savoir si un siège est le lead, `identityContext` a besoin du rôle. Le passer dans `Identity`, qui porte déjà `seat`.
- [ ] **Step 4 : GREEN**, sur `@paradow/ledge` en entier. Mettre à jour les assertions existantes qui épinglaient l'ancienne phrase des sièges.
- [ ] **Step 5 : commit** — `feat(ledge): only a team's lead puts questions to Ledge; the others ask their lead`

### Task 2 : les décisions du lead deviennent des escalades tranchées par le cerveau

**Files :**
- Modify :
  - `packages/ledge/src/daemon/openrig/bridge.ts` : `deps.decisions` et le livre `decisionBook`, gardé en mode sonde comme `askBook` (voir le lot D, tâche 3) ;
  - `packages/ledge/src/daemon/openrig/answer.ts` : livraison des ids `task-` ;
  - `packages/ledge/src/daemon/brain/decide.ts` : grâce pour les `task-` ;
  - `packages/ledge/src/daemon/brain/guard.ts` : réponse en texte libre pour les `task-` ;
  - `packages/ledge/src/daemon/brain/commands.ts` : `--text` ;
  - `packages/ledge/src/daemon/brain/inbox.ts` et `packages/ledge/src/daemon/brain/persona.ts` : textes du cerveau ;
  - `packages/ledge/src/daemon/index.ts` : brancher `deps.decisions`.
- Create : `packages/ledge/src/daemon/openrig/decisions.ts` (`decisionToEscalation`)
- Test : `packages/ledge/test/lead-decision-brain.test.ts`

**Interfaces :**
- Consumes :
  - les tâches de décision (`openDecision`, `owner: 'ledge'`) et `tasks.onTask` ou l'équivalent ;
  - `tasks.run({ by: 'ledge', op: 'done', task, text })`, appelé dans le daemon et non par le message client `task.cmd`, que Ledge refuse ;
  - le motif existant `askToEscalation`, `askBook` et `syncAsks`.
- Produces :
  - **`decisionToEscalation(t: Task, ctx: { lead: boolean }): Escalation`** renvoie :
    - `{ id: \`task-${t.id}\`, source: 'ask', machine: 'local', rigId: t.team, from: t.giverName, intent: 'decision', summary: t.title, detail: t.text, questions: [], createdAt: t.at, state: 'pending' }`.
  - **`deps.decisions: { list(): Task[]; onChange(fn: () => void): () => void }`**. Le pont tient `decisionBook` comme `askBook`, avec les seules tâches `openDecision`. Il fusionne ce livre dans `escalations()` et `escalation(id)`, avec le même calque de `patchEscalation`.
  - **La grâce** (`decide.ts`, `arrived`). Une escalade dont l'id commence par `task-` entre en grâce comme une décision à questions (`GRACE_MS`), même avec `questions: []`. Les autres `source: 'ask'` (les `ask-`) restent exclues, comme aujourd'hui.
  - **La garde** (`guard.ts`, `validAnswers`). Pour une escalade `task-`, elle accepte `{ text: string }` non vide, au plus `TASK_TEXT_MAX`. Elle refuse des réponses par option. Les règles de catégorie, de mots critiques et de mandat s'appliquent comme pour une escalade OpenRig.
  - **La commande du cerveau** : `ledge brain decide <id> --text "<réponse>" --category <cat> [--rule <id>] [--why "…"]`. `--text` exclut `--answer`. L'usage (`USAGE`) gagne cette ligne.
  - **La livraison** (`answer.ts`). Pour un id `task-`, `deliver` appelle `tasks.run({ by: 'ledge', op: 'done', task: id.slice(5), text })`. Le texte vaut `Réponse de Ledge : <text>` (par `'ledge'`) ou `Réponse de l'utilisateur : <text>` (par `'user'`). Si la tâche est déjà close, c'est un refus, et la mise à jour d'état est annulée comme pour un échec de livraison OpenRig. L'escalade passe alors `answered`, et le livre la retire à la fermeture de la tâche.
  - **La garde du moteur** (`daemon/engine/guard.ts`, lot D). En mode Ledge, elle laisse passer `escalation.answer` pour les ids `task-` comme pour les `ask-`. Ce sont des escalades de Ledge lui-même. Test : en mode Ledge, `escalation.answer { id: 'task-…' }` n'est pas refusé par `ENGINE_LEDGE`.
  - **Le cerveau** :
    - Dans `inbox.ts`, l'événement d'une escalade `task-` dit : `question du lead de l'équipe <rigId> : tranche-la avec ledge brain decide <id> --text "<réponse>" --category <cat>, ou remonte-la avec ledge brain ask <id> --advice "…"`.
    - Dans `persona.ts`, le tableau des commandes gagne `--text`.

- [ ] **Step 1 : tests.** Contre un vrai daemon, avec un faux pont qui garde les livres des asks et des décisions. Si le pont réel peut tourner sans OpenRig en mode sonde, le prendre ; sinon, reprendre le motif des tests du cerveau existants (`brain-*.test.ts`) :
  - **Escalade créée.** Le lead fait `task give ledge "Fusionner maintenant ?" "oui / non, je recommande oui"`. On attend un `escalation.updated { id: 'task-<id>', source: 'ask', rigId: <team>, summary: 'Fusionner maintenant ?' }`.
  - **Cerveau allumé.** L'escalade passe en `grace` et le cerveau reçoit un `<ledge-event kind="escalation"` qui contient `ledge brain decide task-`. Le cerveau répond `decide task-<id> --text "oui" --category git`. Après la grâce, on attend :
    - la tâche `done` avec `result: 'Réponse de Ledge : oui'` ;
    - le lead notifié (`terminée par Ledge`) ;
    - une décision enregistrée dans la mémoire.
  - **Garde.** `decide task-<id> --text "oui" --category design` fait monter l'escalade à l'utilisateur (`pending`, `advice`), sans fermer la tâche.
  - **Review Focus 1.** Cerveau éteint : l'escalade reste `pending`. `escalation.answer { id: 'task-<id>', answers: { text: 'non' }, by: 'user' }` donne la tâche `done` avec `Réponse de l'utilisateur : non`.
  - **Review Focus 2.** Pendant la grâce, l'utilisateur répond. La décision différée du cerveau ne ferme rien une deuxième fois, et le journal de la tâche n'a qu'un `done`.
  - **Review Focus 3.** Le lead sort. On attend la tâche `dropped`, l'escalade retirée (`escalation.removed`), et une réponse tardive refusée.
  - **Mode sonde (lot D).** Le livre des décisions reste actif quand le pont est en mode sonde.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN**, sur `@paradow/ledge` en entier.
- [ ] **Step 5 : commit** — `feat(ledge): a lead's question is an escalation the brain settles within the mandate, or hands to the user`

### Task 3 : une seule carte dans « À toi », et le TUI et le téléphone suivent

**Files :**
- Modify :
  - `apps/desktop/src/shell/sidebar/Attention.tsx` : cacher la carte de décision de tâche quand l'escalade `task-<id>` existe ;
  - la carte d'escalade de Desktop (`EscalationRow`, ou la carte d'ask utilisée pour `source: 'ask'`) : réponse en texte libre pour un `task-`, avec le nom de l'équipe ;
  - `packages/ledge/src/tui/` : l'à-toi du TUI ne compte pas deux fois ;
  - `apps/mobile/src/` : même règle pour « À toi » sur le téléphone.
- Test : `apps/desktop/test/attention*.test.tsx` (ou le test existant de la barre latérale), `packages/ledge/test/tui-decisions.test.tsx`, le test « À toi » du téléphone

**Interfaces :**
- Consumes : les escalades `task-<taskId>` de la tâche 2.
- Produces :
  - **`decisionMirrored(t: Task, escalations: Escalation[]): boolean`** dans `@ledge/protocol` (ou `packages/ui` s'il y a un endroit commun aux fronts). Vrai quand une escalade `task-${t.id}` existe.
  - **Le compte de « À toi »** et la liste comptent chaque décision une fois, sous la forme d'une escalade, quand elle est reflétée. Une décision non reflétée, par exemple d'un daemon sans pont, reste une carte de décision.
  - **La touche D du TUI** et la carte de décision du téléphone continuent de répondre par `task.answer`. La tâche se ferme, puis le livre retire l'escalade : le même objet, répondu par un autre chemin.

- [ ] **Step 1 : tests.**
  - **Review Focus 4.** Desktop, avec une tâche de décision ouverte et son escalade `task-` : une seule carte, et un compte de 1. Une réponse en texte libre envoie `escalation.answer` avec `answers: { text }`.
  - TUI : avec les deux, le compte de « À toi » vaut 1.
  - Téléphone : avec les deux, une seule entrée.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN**, sur `desktop`, `@paradow/ledge`, `@ledge/mobile` et `@ledge/ui` s'il est touché.
- [ ] **Step 5 : commit** — `feat(desktop,mobile,ledge): one card per decision in « À toi », the escalation the brain also sees`
