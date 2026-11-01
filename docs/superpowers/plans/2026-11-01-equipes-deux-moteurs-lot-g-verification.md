# Lot G : vérification de bout en bout — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** prouver le scénario de la spec §6.7 avec les deux moteurs. Une équipe de deux sièges (un lead Claude et un relecteur Codex) reçoit un petit objectif sur un vrai dépôt. On mesure le délai jusqu'à la première action du lead et le nombre d'interventions de l'utilisateur, et on vérifie que tous les échanges sont dans le fil.

**Architecture :**
- **Un test e2e Desktop** (`apps/desktop/e2e`) joue le scénario contre le faux daemon des e2e. Ce faux daemon gagne ce qu'il faut pour un moteur d'équipes : `teams.engine`, des équipes Ledge projetées en `Rig` avec `engine: 'ledge'`, les échanges et les escalades `task-`.
- **Un rapport** dans `docs/` donne les mesures prises sur la vraie machine, avec chacun des deux moteurs.
- **La mesure sur la machine** installe la branche et redémarre le daemon. Elle demande donc l'accord de Guillaume (règle du ledger). Elle regroupe aussi les vérifications de machine reportées des lots B à F.

**Tech Stack :** Playwright (`apps/desktop/e2e`), TypeScript.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md` (§6.7). Plan maître, lot G.

## Global Constraints

- Branche `feat/teams-two-engines`. On ne pousse pas. On ne touche ni `ledge-open-rig` ni `main`.
- Le faux daemon des e2e reste un faux. Il ne lance ni OpenRig ni de vraies sessions.
- Chaque tâche finit verte : `pnpm typecheck`, puis `pnpm --filter desktop test` et la spec e2e ajoutée (`pnpm --filter desktop e2e -- <spec>`).
- Un commit par tâche, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Le même scénario en mode OpenRig dans le faux daemon.** L'écran « Équipes » montre la même structure, sans texte propre à Ledge. Test à la tâche 1.
2. **Une escalade du lead tranchée par le cerveau.** Elle ne laisse rien dans « À toi ». Une escalade hors mandat laisse une seule carte. Test à la tâche 1.
3. **Les échanges d'une équipe Ledge.** On attend la tâche du lead vers `@review` et son résultat, puis le résultat final dans « À toi ». Ils apparaissent dans le fil de l'équipe dans l'ordre. Test à la tâche 1.

---

### Task 1 : le scénario e2e Desktop, avec les deux moteurs

**Files :**
- Modify : `apps/desktop/e2e/daemon.ts` (moteur d'équipes, équipe Ledge projetée, échanges, escalades `task-`)
- Create : `apps/desktop/e2e/teams-engines.spec.ts`

**Interfaces :**
- Consumes : les messages des lots B à F (`teams.engine`, `Rig.engine`, `rig.exchange`, escalades `task-`, `team.launch` avec `objective`, `rig.act`).
- Produces : dans le faux daemon, une option `teamsEngine: 'ledge' | 'openrig'`.
  - En mode Ledge :
    - un `team.launch` avec `objective` répond `team.launched` avec `objectiveTask` ;
    - le daemon pousse le rig projeté de l'équipe, puis, selon un script, les échanges (`give` du lead vers `@review`, `done` de `review`, `done` du lead) ;
    - une escalade `task-…` facultative ;
    - à la fin, la tâche objectif close dans « À toi ».

- [ ] **Step 1 : écrire `teams-engines.spec.ts`.**
  - **Mode Ledge.**
    - Lancer une équipe depuis l'onglet « Équipes » avec l'objectif « Ajoute un README », les sièges `leader` (claude) et `review` (codex).
    - On attend l'équipe dans l'onglet Équipes, dans la barre latérale (une ligne) et dans les Bureaux (un bureau).
    - On attend les échanges dans le fil, dans l'ordre.
    - On attend le résultat final dans « À toi ».
    - On attend une salle technique dont la plaque dit « Équipes · Ledge ».
  - **Review Focus 2.**
    - Une escalade `task-` tranchée par le cerveau (`answered`, `by: 'ledge'`) ne laisse aucune carte.
    - Une escalade `pending` en laisse une seule.
  - **Review Focus 1.** Le même enchaînement en mode OpenRig (rig OpenRig poussé par le faux daemon) donne la même structure d'écran et la plaque « Équipes · OpenRig ».
  - **Réglages › Équipes.**
    - OpenRig est grisé quand il est absent.
    - Le changement de moteur est refusé tant qu'une équipe tourne, avec la raison.
- [ ] **Step 2 : lancer la spec** (`pnpm --filter desktop e2e -- teams-engines`). On attend qu'elle échoue tant que le faux daemon ne joue pas le scénario.
- [ ] **Step 3 : compléter le faux daemon.**
- [ ] **Step 4 : la spec passe. Toute la suite e2e Desktop passe aussi**, ou n'a que les échecs déjà présents avant le lot, listés dans le rapport.
- [ ] **Step 5 : commit** — `test(desktop): the two-engine team scenario end to end against the fake daemon`

### Task 2 : la mesure sur la vraie machine et le rapport

Cette tâche n'a pas de code. Elle demande l'accord de Guillaume avant d'installer la branche et de redémarrer `ledge-daemon`.

- [ ] **Step 1 : installer.** `pnpm --filter @paradow/ledge build`, puis `pnpm pack`, puis `npm i -g` du paquet, puis `systemctl --user restart ledge-daemon`. On attend :
  - `ledge --help` qui liste `team`, `task`, `ask` et `brain` ;
  - `ledge team` dont l'usage montre `--goal` ;
  - un fichier `~/.ledge/roles/leader.md` présent ;
  - `~/.ledge/teams-engine.json` absent, ce qui veut dire Ledge.
- [ ] **Step 2 : moteur Ledge.** Dans un dépôt de test (`git init`, un fichier), avec un rôle `review` de type codex, lancer :
  ```
  ledge team up --seat leader --seat review:codex --goal "Ajoute un README qui décrit le dépôt" --done "README commité et relu" --cwd <dépôt>
  ```
  Mesurer :
  - (a) le délai entre le lancement et le `take` de l'objectif par le lead (`ledge task list --all`, heure du journal de la tâche) ;
  - (b) le nombre d'interventions de l'utilisateur, en dehors des permissions de démarrage de Claude et de Codex ;
  - (c) la présence dans `rig.exchanges` de l'équipe de chaque échange : la tâche vers `@review`, son résultat, et le résultat final ;
  - (d) l'objectif `done`.

  Ensuite, dissoudre l'équipe.
- [ ] **Step 3 : moteur OpenRig.**
  - Passer en OpenRig dans Réglages › Équipes, ou par `teams.engine.set`.
  - Lancer l'équipe équivalente par le lancement de rig, avec le même objectif.
  - Mesurer (a), (b) et (c) de la même façon.
  - Arrêter le rig, puis revenir à Ledge.
- [ ] **Step 4 : vérifications regroupées des lots B à F.**
  - **Lot A** : la boucle vers legion est toujours absente (les mêmes processus `ssh -T` sur 30 s).
  - **Lot B** : un modèle sans `leader` est signalé comme ignoré.
  - **Lot C** : `ledge send @team` du lead touche les autres sièges.
  - **Lot D** : en mode Ledge, un rig lancé à la main n'apparaît pas.
  - **Lot E** : une question du lead est tranchée par le cerveau quand elle entre dans le mandat. Le cerveau doit être allumé ; s'il ne l'est pas, le noter.
  - **Lot F** : le Desktop installé est celui de Joffrey, il ne voit donc pas les équipes. Noter seulement ce que la CLI et le TUI montrent.
- [ ] **Step 5 : écrire le rapport.** Il va dans `docs/superpowers/reports/2026-11-01-equipes-deux-moteurs-verification.md`. Il contient :
  - les mesures de chacun des deux moteurs, côte à côte ;
  - les écarts constatés ;
  - ce qui reste pour la deuxième étape de la spec : priorité des messages, rôles enrichis, file avancée.
- [ ] **Step 6 : commit** — `docs: two-engine teams, end-to-end measurements`
