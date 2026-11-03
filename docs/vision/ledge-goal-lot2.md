# Lot 2 back — l'objectif écrit à Ledge, Max propose l'équipe : livraison

dev-back@ledge-dev, 2026-11-02 (nuit). Ligne `qitem-20261102211219-e5d6ed658109e48d`. Branche `feat/goal-to-max`, sur
`feat/human-channel` c74a0762 (le lot 1 avec son dernier correctif). Contrat : `docs/vision/ledge-goal-contract.md`, avec la
convention Ledge ↔ Max acceptée par Max et ses quatre ajouts. dev-front a le contrat (ligne `qitem-20261102211649-e6c694d1c6a6135e`).

## Ce qui est livré

- **Protocole** (`packages/protocol/src/openrig.ts`, `messages.ts`) :
  - `openrig.goal.send` → `goal.sent` ; `openrig.goals` → `goalsChanged`, aussi poussé ; `openrig.goal.reply` → `goal.replied`.
  - `Goal`, `TeamProposal` (`existing` ou `launch`, avec les détails du lancement), `GoalError`.
  - `HumanAsk.goalId` et `HumanAsk.team` ; capacité `openrigGoals`.
- **Daemon** :
  - `packages/ledge/src/daemon/openrigGoals.ts` :
    - envoi par `rig queue create --source ledge@external` vers le siège `operator.agent` du kernel, avec l'id stable
      `qitem-ledge-goal-<goalId>`, le tag `ledge-goal` et un corps déterministe, pour qu'un renvoi retrouve la même ligne ;
    - `rig` y tourne sans `OPENRIG_SESSION*`, donc jamais au nom d'un siège ;
    - lecture des objectifs depuis OpenRig : les lignes de `ledge@external`, les demandes taguées, les transitions de la ligne
      d'objectif, puis la chaîne `handedOffFrom` (et, à défaut, les lignes taguées).
  - `goalTeam.ts` : le tag et le bloc `ledge-team`.
  - `openrigHuman.ts` : `goalId` et `team` sur les demandes de Max, et `onEvent`, pour que les objectifs suivent le même flux
    d'événements.
  - `server.ts` : les routes, et une poussée à chaque mouvement de la file (après 600 ms), dès qu'un front a demandé les objectifs.
- **Flotte** : routage `goals`, `goalSend` et `goalReply` (`outdated` limité à ces trois). Hook `useOpenRigGoals`
  (`packages/fleet/src/openrigGoals.ts`, fichier séparé) : envoi, réponse, et renvoi sûr en repassant le même id.

## Erreurs et lectures ratées

- **Envoi :**
  - `no_operator` : pas de siège `operator.agent` en marche ;
  - `openrig_stopped` : seulement un arrêt qu'OpenRig confirme ;
  - `unreachable` : état illisible ;
  - `refused` : OpenRig refuse ;
  - `uncertain` : `rig` a échoué sans dire pourquoi. Renvoyer le même id est sûr, puisque OpenRig retrouve la ligne.
- **Lecture :** si la liste ne peut pas être lue, ou si OpenRig est injoignable, les objectifs connus sont gardés (`partial`).
  Seul un arrêt confirmé vide la liste.

## Essai réel (OpenRig 0.7.7, Max simulé)

Max (`operator-agent@kernel`) était inactif, mais il porte deux lignes de l'utilisateur pour le matin. Le lot l'autorisait à simuler
dans ce cas : dev-back a joué `operator.agent`, avec les vraies commandes `rig`. Le reste, c'est le code du worktree contre le vrai
daemon.

| Étape | Résultat |
|---|---|
| Ledge envoie l'objectif `fda215dc…`, puis le renvoie | `qitem-ledge-goal-fda215dc-1fdc-434e-9b0d-5658065257eb`, la même ligne les deux fois ; source `ledge@external`, tag `ledge-goal` ; le « Max » a été **réveillé** (21:25Z) |
| « Max » prend la ligne, pose une note, propose (demande `qitem-20261102212538-449c4980a9d8e25e`, tag `ledge-goal:<id>`, question `team`, bloc `ledge-team`) | Ledge lit l'objectif `proposed`, la proposition avec son équipe (`existing`, `ledge-dev`, siège `dev-back`, raison) et le trajet `sent › taken › note` ; dans « À toi », la demande porte `goalId` et `team` |
| Ledge confirme (`openrig.answer` `team` = `confirm`) | `answered` ; « Max » réveillé par la ligne-réponse `qitem-human-answer-b9bc0da36a534215c629` ; la proposition affiche `answer` = confirm et `answeredAt` |
| « Max » transmet la ligne d'objectif (`--tags ledge-goal:<id>`) ; le siège la prend et la clôt | Objectif `done`, `current` = la ligne transmise `qitem-20261102212559-8bfab533`, trajet `sent › taken › note › handed › taken › closed (« Essai terminé, rien à livrer. »)` |

Toutes les lignes d'essai sont closes. **À faire avec le vrai Max**, quand l'utilisateur le voudra : un essai identique. Le corps
de l'objectif lui rappelle la convention.

## Vérifications

- `packages/ledge` :
  - `openrig-goals.test.ts` 13/13 : bloc d'équipe existante, de lancement (imbriqué ou à plat), illisible ; corps aller-retour ;
    envoi, renvoi et réponse ; erreurs ; trajet complet avec chaîne ; proposition, question, nouvel objectif, objectif clos ;
    dernière proposition après « Changer d'équipe » ; repli par tag ; `partial` et arrêt.
  - `openrig-human.test.ts` 33/33.
  - `server.test` : « goals to Max » et « À toi » verts.
- `packages/fleet` : 260/260 (routage des objectifs, `useOpenRigGoals`).
- `packages/protocol` : 273/273.
- `pnpm -r typecheck` : vert (9 paquets).

## Limites et points pour l'utilisateur

- Un seul Max, celui de la machine locale. Le multi-machines et le mobile restent au lot 3.
- La mise en forme de l'objectif (« Fini quand », « Reste à toi ») et « Ledge confirme seul » restent au lot 4. Le champ `delegated`
  est réservé dans le contrat, mais pas dans le code.
- Les textes de la carte violette viennent des libellés de Max (les options de sa question). La maquette les fixe
  (« Confirmer l'équipe », « Lancer un rig plutôt ») : la convention donne ces libellés à Max. L'écran peut aussi afficher ses
  propres libellés selon l'id d'option (`confirm`, `launch-rig`). C'est une décision de front.
