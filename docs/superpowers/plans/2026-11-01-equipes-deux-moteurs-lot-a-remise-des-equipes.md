# Équipes à deux moteurs, lot A : remise des équipes (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remettre sur `feat/teams-two-engines` le système d'équipes de Ledge, tel qu'il est sur `origin/main` aujourd'hui, à côté de l'intégration OpenRig et de `ledge ask`.

**Architecture :**
- Un merge de `origin/main` ramène les équipes, leurs correctifs (#140 à #151) et le reste de `main` (0.30 à 0.32).
- Le merge ne suffit pas : les fichiers que le lot 1 de Joffrey a supprimés sans que `main` y touche depuis restent supprimés. On les restaure depuis `origin/main` dans le même commit de merge.
- On retire ensuite ce que le lot 1 avait ajouté pour signaler le retrait.

**Tech Stack :** git, TypeScript ESM, zod, vitest, pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md` (§2 objectif 1, §5). Plan maître : `docs/superpowers/plans/2026-11-01-equipes-deux-moteurs.md`. Ses Global Constraints s'appliquent.

**Mesure faite le 2026-11-01**, essai jetable sur `f0ff1f04` :
- `git merge origin/main` donne 50 conflits de contenu (UU) et 21 conflits « supprimé chez nous, modifié chez eux » (DU).
- Après le merge, 46 fichiers supprimés par le lot 1 manquent encore.
- Annuler le lot 1 (`git revert -m 1 1196dfe0`) donnerait 72 conflits et retirerait aussi `ledge ask`. On écarte ce chemin.

## Global Constraints

Celles du plan maître, plus :

- **Rien dans ce lot ne change le comportement des équipes de `main`.** Ni lead automatique, ni broadcast : ce sont les lots B et C.
- **L'interface de `main` revient telle quelle**, à côté de celle de Joffrey. C'est provisoire : le lot F la réduit aux écrans que Joffrey n'a pas.
- **`ledge decide` liste et répond aux deux sortes de décisions** : les asks (branche) et les décisions de tâche 0.30 (`main`). Le lot E les réunit par le cerveau.
- **Les données de `main` se relisent** : `~/.ledge/tasks.json`, `teams-live.json`, `~/.ledge/teams/`, `~/.ledge/roles/` et les `.ledge/{roles,teams}` des dépôts.

## Review Focus

1. **Un `~/.ledge` écrit par Ledge 0.31 ou 0.32**, avec `tasks.json`, `teams-live.json` et des sessions qui portent `role` et `team`. Attendu : le daemon démarre, recharge équipes et tâches, et ne journalise plus `ignored … were removed`. Test : tâche 2, `ignored-team-data.test.ts` remplacé.
2. **Un `~/.ledge` écrit par le snapshot**, avec `asks.json`, `openrig.json` et des sessions sans `role` ni `team`. Attendu : il se relit sans erreur, et les asks en attente restent listés. Test : tâche 2, `decide` liste les deux.
3. **Un Ledge 0.31 distant** (legion) envoie `teams` juste après `snapshot` sur le pont SSH. Attendu : la trame passe et le lien reste ouvert. C'était la cause de la boucle de reconnexion. Test : tâche 2, `ssh-transport` transmet `teams`.
4. **Une session à la fois paire d'un siège OpenRig et membre d'une équipe Ledge.** C'est possible jusqu'au lot D, qui coupe l'autre moteur. Attendu dans ce lot : rien ne plante, et chaque système l'affiche à sa manière. Pas de test dédié : c'est une limite connue, notée dans le commit.
5. **`ledge --help` et les commandes `task` / `team`**. Attendu : elles marchent, sans le message « commande retirée ». Test : tâche 2, `removed-commands.test.ts` retiré, `team-cli.test.ts` restauré et vert.

---

### Task 1 : merge de `origin/main` avec restauration des fichiers du lot 1

Une seule unité : on ne peut pas relire la moitié d'un merge. Le résultat compile et ses tests passent.

**Files :**
- Merge : tout le dépôt.
- Restore depuis `origin/main` (DU, 21 fichiers) :
  `apps/desktop/src/teams/useTeamsApi.ts`, `apps/mobile/src/model/teams.ts`, `apps/mobile/src/ui/chat/TeamCard.tsx`, `apps/mobile/src/ui/teams/LePoint.tsx`, `packages/ledge/src/daemon/definitions.ts`, `packages/ledge/src/daemon/seat.ts`, `packages/ledge/src/daemon/tasks.ts`, `packages/ledge/src/daemon/teams.ts`, `packages/ledge/src/daemon/teamsLive.ts`, `packages/ledge/src/tui/screens/Ask.tsx`, `packages/ledge/src/tui/screens/Overview.tsx`, `packages/ledge/test/definitions-server.test.ts`, `packages/ledge/test/definitions.test.ts`, `packages/ledge/test/roles.test.ts`, `packages/ledge/test/tasks.test.ts`, `packages/ledge/test/teams-flow.test.ts`, `packages/ledge/test/teams-server.test.ts`, `packages/ledge/test/teamsLive.test.ts`, `packages/protocol/src/tasks.ts`, `packages/protocol/src/teams.ts`, `packages/ui/src/chat/TeamCard.tsx`.
- Restore depuis `origin/main` (encore absents après le merge, 46 fichiers) : la liste est produite par l'étape 3, avec la commande donnée.

**Interfaces :**
- Produces : les modules de `main` à leur chemin d'origine. Les lots suivants s'en servent :
  - `packages/ledge/src/daemon/{teams,teamsLive,tasks,roles,seat,definitions}.ts` ;
  - `packages/protocol/src/{teams,tasks,phoneTeams}.ts` ;
  - `packages/ledge/src/cli/{team,task}.ts` ;
  - `LEADER_ROLE` dans `packages/ledge/src/daemon/actions.ts`.

- [ ] **Step 1 : se placer sur la branche à jour et lancer le merge**

```bash
cd /home/gch/development/ledge-teams-engines
git fetch origin && git merge --no-edit origin/ledge-open-rig   # reprise de Joffrey d'abord
git merge --no-ff --no-commit origin/main
```
Expected : `Automatic merge failed`. `git status --porcelain | grep -cE '^(UU|AA)'` vaut environ 50, et `grep -c '^DU'` environ 21. Si Joffrey a commité depuis le 2026-11-01, les nombres peuvent varier un peu.

- [ ] **Step 2 : prendre la version de `main` pour chaque DU**

```bash
git status --porcelain | awk '$1=="DU"{print $2}' | xargs git checkout origin/main --
git status --porcelain | awk '$1=="DU"{print $2}' | xargs -r git add
```
Expected : `git status --porcelain | grep -c '^DU'` vaut 0.

- [ ] **Step 3 : restaurer les fichiers du lot 1 encore absents**

```bash
git diff --name-only --diff-filter=D 1196dfe0^1 1196dfe0 \
  | while read f; do [ -e "$f" ] || { git cat-file -e "origin/main:$f" 2>/dev/null && echo "$f"; }; done > /tmp/lot1-restore.txt
wc -l < /tmp/lot1-restore.txt     # attendu : 46
xargs git checkout origin/main -- < /tmp/lot1-restore.txt
```
Expected : 46 fichiers restaurés, dont `packages/ledge/src/cli/{team,task}.ts`, `packages/ledge/src/daemon/roles.ts`, `apps/desktop/src/teams/Catalog.tsx`, `apps/mobile/src/screens/Teams.tsx` et `packages/protocol/src/phoneTeams.ts`.

- [ ] **Step 4 : résoudre chaque UU en gardant les deux côtés**

Règle générale : on garde tout ce que la branche apporte (OpenRig, asks, cerveau, Bureaux, mandat), et tout ce que `main` apporte (équipes, tâches, rôles, 0.30 à 0.32). Quand le lot 1 a remplacé un morceau d'équipe par un morceau d'ask, on garde les deux. Par zone :

| Zone | Fichiers | Résolution |
|---|---|---|
| Protocole | `packages/protocol/src/{messages,session,actions,chat,phone,push}.ts`, `test/actions.test.ts` | Union des schémas. Les unions discriminées contiennent les messages `team.*`, `task.cmd`, `role.*`, `template.*`, `definitions.list`, `roles.list` de `main` **et** `openrig.*`, `rig.*`, `escalation.*`, `ask*`, `brain.*`, `session.preview.*`, `session.thought` de la branche. `SessionSchema` reprend `role`, `roleLabel` et `team`, optionnels comme sur `main`, et garde `rig`. |
| Daemon | `packages/ledge/src/daemon/{server,store,actions}.ts` | Union des cas de `server.ts` (`team.*`, `task.cmd`, etc. de `main` ; `openrig`, `asks`, `brain` de la branche) et des dépendances de `startServer`. |
| Daemon (démarrage) | `packages/ledge/src/daemon/index.ts` | Garder le pont OpenRig et les asks. Remettre le chargement des équipes et des tâches de `main`. **Supprimer** la boucle qui journalise `ignored … were removed (2026-10-30-ledge-openrig-orchestrator-design §7)`. |
| Hook | `packages/ledge/src/cli/hook.ts`, `test/hook.test.ts` | Le texte injecté parle de `ledge task …` aux sièges d'équipe (`main`) et de `ledge ask` aux sessions seules (branche). L'identité de siège, le rôle et le SessionStart de `main` reviennent. Le relais du `SendMessage` natif reste tel que sur `main`. |
| Décisions | `packages/ledge/src/cli/decide.ts` | La liste contient les asks en attente et les décisions de tâche 0.30, au format de la branche (`<id>  de <nom>  <question>`, options en retrait de 4 espaces). La réponse route selon le préfixe de l'id (`a…` pour un ask, sinon une tâche). |
| Chat | `packages/ledge/src/chat/{context,persona,service}.ts`, `packages/ui/src/chat/{actionCopy,actionWords,copy}.ts(x)`, `packages/ui/test/action-card.test.tsx` | Union : le chat peut de nouveau proposer des équipes et des tâches (`main`), et garde les cartes de la branche. |
| Desktop | `apps/desktop/src/{App.tsx,chat/LedgeHome.tsx,nav/state.ts,shell/sidebar/{Attention,Sidebar}.tsx,i18n/{en,fr}.ts,styles/{shell,sidebar}.css}` | Union : les onglets Équipes et Tâches de `main` reviennent à côté de l'onglet Rigs. « À toi » montre les décisions de tâche et les asks. |
| Mobile | `apps/mobile/src/{copy.ts,router.ts,screens/Chat.tsx,state/operations.ts,sw/sw.ts,ui/chat/TurnView.tsx}`, `test/router.test.ts` | Union : l'onglet Équipes et ses routes reviennent à côté des écrans rigs. |
| Mobile (passerelle) | `packages/ledge/src/mobile/{gateway,project}.ts`, `mobile/push/triggers.ts` | Union des projections téléphone (équipes de `main`, OpenRig de la branche). |
| TUI | `packages/ledge/src/tui/{App.tsx,i18n/{en,fr}.ts,model/overview.ts,screens/Help.tsx,ui/Frame.tsx}` | Union : l'écran Équipes revient à côté des écrans de la branche. |
| Fleet | `packages/fleet/src/fleet.ts` | Union. |
| Tests | `packages/ledge/test/{daemon-actions,handover,server}.test.ts` | Union des cas. |
| README | `README.md` | Le texte de la branche, plus la section des commandes `ledge team` et `ledge task` de `main`. |

Expected : `git diff --name-only --diff-filter=U` est vide, et `git grep -n '^<<<<<<<\|^>>>>>>>' -- ':!*.md'` ne trouve rien.

- [ ] **Step 5 : installer et vérifier les types**

Run : `pnpm install --frozen-lockfile && pnpm typecheck`
Expected : 0 erreur. Si `pnpm-lock.yaml` est en conflit ou refusé, prendre `pnpm install` sans `--frozen-lockfile` et ajouter le lockfile au merge.

- [ ] **Step 6 : lancer toute la suite**

Run : `TERM=xterm pnpm test`
Expected : PASS. Les seuls échecs admis à ce stade sont les tests qui affirment le retrait des équipes, traités à la tâche 2 : `packages/ledge/test/removed-commands.test.ts`, `packages/ledge/test/ignored-team-data.test.ts`, et les cas « commande retirée » de `apps/desktop/test/{chat,project-proposals}.test.tsx`, `packages/ledge/test/{crossSession,history,mailbox}.test.ts`. Tout autre échec se corrige dans ce merge.

- [ ] **Step 7 : commit du merge**

```bash
git add -A
git commit -m "merge: origin/main into feat/teams-two-engines, teams back next to OpenRig

Restores the files lot 1 removed and main no longer touched (46), and takes
main's side of the 21 modify/delete conflicts. Known gap until lot D: a session
can be both paired to an OpenRig seat and a Ledge team member.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2 : retirer les traces du retrait, et figer la compatibilité

**Files :**
- Delete : `packages/ledge/src/cli/removed.ts`, `packages/ledge/test/removed-commands.test.ts`
- Modify : `packages/ledge/src/cli/index.ts` (cas `task` et `team` : router vers `cli/task.ts` et `cli/team.ts` comme sur `main`, plus d'import de `removedCommand`)
- Replace : `packages/ledge/test/ignored-team-data.test.ts` par `packages/ledge/test/team-data-reload.test.ts`
- Modify : les cas « commande retirée » des tests cités à la tâche 1, étape 6
- Test : `packages/ledge/test/ssh-transport.test.ts` (créer s'il n'existe pas un test de `serveSsh`), `packages/ledge/test/decide.test.ts`

**Interfaces :**
- Consumes : `serveSsh(ws, alias, { spawn })` de `packages/ledge/src/transport/ssh.ts`, `parseClientMessage` / `parseServerMessage` de `@ledge/protocol`, et le module de `cli/decide.ts` après la tâche 1.

- [ ] **Step 1 : écrire les tests de compatibilité**

```ts
// packages/ledge/test/ssh-transport.test.ts
it('forwards a teams frame from an older remote daemon instead of closing the link', async () => {
  // faux child : stdout émet `snapshot` puis `{ type: 'teams', teams: [] }`
  // attendu : le ws reçoit les deux trames, readyState reste OPEN, aucun { type: 'error' }
});

// packages/ledge/test/team-data-reload.test.ts
it('reloads tasks.json and teams-live.json written by Ledge 0.32, and logs no "ignored" line', async () => {
  // home temporaire avec un tasks.json (1 tâche taken) et un teams-live.json (1 équipe active)
  // attendu : store des tâches = 1, équipes vivantes = 1, journal sans /ignored .* were removed/
});

// packages/ledge/test/decide.test.ts
it('lists a pending ask and a pending task decision together', () => {
  // un ask `a1b2c3` de « Nova » et une décision de tâche de « Rex »
  // attendu : deux blocs `<id>  de <nom>  <question>`, chacun suivi de ses options en retrait de 4 espaces
});
it('routes an answer by id: a… to the ask, otherwise to the task decision', async () => { /* … */ });
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent ou passent pour la bonne raison**

Run : `pnpm --filter @paradow/ledge test -- ssh-transport team-data-reload decide`
Expected : `ssh-transport` passe déjà (le protocole connaît `teams` depuis la tâche 1). C'est la preuve que la boucle legion est corrigée. Les deux autres échouent tant que l'étape 3 n'est pas faite.

- [ ] **Step 3 : retirer `removed.ts`, rebrancher `task` et `team` dans `cli/index.ts`, ajuster `decide.ts` si l'étape 2 l'exige**

- [ ] **Step 4 : remettre les tests « commande retirée » dans l'état de `main`**

Pour chaque fichier de la tâche 1, étape 6, reprendre les cas de `origin/main`. Garder les cas de la branche qui portent sur les asks et OpenRig.

- [ ] **Step 5 : suite complète**

Run : `pnpm typecheck && TERM=xterm pnpm test`
Expected : PASS, 0 erreur.

- [ ] **Step 6 : commit**

```bash
git add -A
git commit -m "fix(ledge): teams and tasks are commands again; reload team data; keep older remotes linked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3 : vérification à la main sur les vraies machines

Pas de code. Cette tâche prouve le livrable du lot sur le laptop et contre legion (0.31, non modifié).

- [ ] **Step 1 : construire le daemon de la branche et le faire tourner à la place du snapshot**

```bash
pnpm --filter @paradow/ledge build
cd packages/ledge && npm pack && npm i -g ./paradow-ledge-*.tgz && cd -
systemctl --user restart ledge-daemon
```
Expected : `ledge --version` affiche la version de la branche, et `ledge --help` liste `team`, `task`, `ask` et `brain`.

- [ ] **Step 2 : la boucle vers legion a disparu**

Pendant 20 s, compter les `ssh -T … legion` créés (`ps -eo pid,etimes,args | grep '[s]sh -T'`).
Expected : au plus une connexion par client Desktop, qui dure (etimes croît), et non plus trois toutes les ~3 s.

- [ ] **Step 3 : une équipe Ledge démarre, OpenRig reste vu**

`ledge team up <un modèle de ~/.ledge/teams>` dans un dépôt de test, puis `ledge team list`.
Expected : l'équipe est `active`. Le daemon publie toujours `openrig.status` `running` pour `local`.

- [ ] **Step 4 : remettre le snapshot, ou laisser la branche, selon le choix de Guillaume**

Le dire dans le compte rendu du lot.
