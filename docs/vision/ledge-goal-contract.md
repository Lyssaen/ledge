# Contrat — l'objectif écrit à Ledge, Max propose l'équipe (lot 2)

Auteur : dev-back@ledge-dev, 2026-11-02. Ligne `qitem-20261102211219-e5d6ed658109e48d`. Branche `feat/goal-to-max` (sur
`feat/human-channel` c74a0762, le lot 1). Maquette : `docs/mockups/ledge-human-operator-ab.html`, écrans `goalAsk` et
`goalDone` (+ fiche §9). Contrat du lot 1 : `docs/vision/ledge-human-channel-contract.md`.

## Le trajet, en OpenRig

1. **Objectif → Max.** Ledge crée une ligne ordinaire vers Max (le siège `operator.agent` du rig `kernel`, aujourd'hui
   `operator-agent@kernel`) : `rig queue create --source ledge@external --destination <Max> --id <id stable> --tags ledge-goal
   --summary … --body …`. C'est le modèle po-web. Le corps contient l'objectif tel qu'écrit, le dossier s'il est donné, et la
   convention ci-dessous. Pas de `--alert`.
2. **Max propose.** Il crée une **demande de décision** vers `ledge@external`, taguée `ledge-goal:<id de la ligne d'objectif>`
   (convention ci-dessous). Elle arrive dans « À toi » par le chemin du lot 1, en carte violette.
3. **L'utilisateur répond** avec `openrig.answer` (lot 1) : Confirmer ou Lancer un rig plutôt (boutons), Changer d'équipe (en mots).
   OpenRig rend la réponse à Max et le réveille.
4. **Max lance l'équipe** en transmettant la ligne d'objectif : `rig queue handoff <id d'objectif> --to <siège>`. Ledge suit la
   chaîne des transmissions (`handedOffFrom`) pour montrer le trajet : « confiée › prise par Bix › passée à Lu ».
5. **Repli en texte libre.** Si Max répond autrement (une demande sans bloc `ledge-team`, ou une note sur la ligne d'objectif),
   Ledge le montre en texte. Une note se répond par `openrig.goal.reply` (une nouvelle ligne vers Max).

## Convention Ledge ↔ Max (proposée ; le lead la fait accepter par l'opérateur)

La proposition de Max est une demande de décision :

```
rig queue create --destination ledge@external --tags ledge-goal:<id d'objectif> \
  --summary "Équipe proposée : <objectif court>" --body-file proposition.md \
  --human-questions-file equipe.json --evidence-ref <le fichier de la proposition, ou un document du projet>
```

`equipe.json` : une seule question, `id: "team"`, deux options, `confirm` (recommandée) et `launch-rig` :

```json
[{ "id": "team", "question": "Confirmer l'équipe proposée ?", "options": [
  { "id": "confirm", "label": "Confirmer l'équipe", "recommended": true },
  { "id": "launch-rig", "label": "Lancer un rig plutôt" } ] }]
```

Pour changer d'équipe, l'utilisateur répond en mots ; OpenRig les rend à Max comme réponse libre.

`proposition.md` : du texte libre, plus un bloc de code `ledge-team` qui contient le JSON de l'équipe :

````
Pas de nouveau rig : ledge-dev a un siège design et connaît l'encoche.

```ledge-team
{ "rig": "ledge-dev", "running": true, "folder": "~/Workspace/ledge",
  "seats": [ { "seat": "design-ux@ledge-dev", "name": "Lu", "note": "maquette d'abord" },
             { "seat": "dev-front@ledge-dev", "name": "Ida", "note": "après validation" } ],
  "reason": "Pas de nouveau rig : ledge-dev a un siège design et connaît l'encoche." }
```
````

Champs : `rig` (nom du rig, obligatoire), `running` (le rig tourne déjà), `folder` (le dépôt), `seats` (`seat` obligatoire ;
`name` et `note` optionnels), `reason`. Un bloc absent ou illisible n'empêche rien : la carte montre le texte, avec les boutons
de la demande.

## Messages

Comme au lot 1, `machineId` est optionnel et vaut `local` par défaut, et la flotte route ces messages comme les autres
`openrig.*`. Capacité : `DaemonInfo.openrigGoals: true`.

### Envoyer un objectif

```ts
{ type: 'openrig.goal.send', requestId: string, machineId?: string,
  goalId: string,            // créé par le front (uuid) ; le même pour un renvoi : jamais deux lignes pour un objectif
  text: string,              // 1 à 8 000 caractères, tel qu'écrit
  folder?: string }          // le dossier ou le projet, s'il est donné
→ { type: 'openrig.goal.sent', requestId, machineId?, goalId, ok: boolean,
    qitemId?: string,        // la ligne d'objectif chez Max
    error?: 'no_operator' | 'openrig_stopped' | 'unreachable' | 'uncertain' | 'refused' | 'offline' | 'outdated',
    //  no_operator : pas de Max (le kernel ne tourne pas, ou n'a pas d'operator.agent)
    //  uncertain   : peut-être créée (réponse perdue) ; renvoyer le même goalId est sûr
    message?: string }
```

### Lire les objectifs (réponse, et poussée à chaque changement)

```ts
{ type: 'openrig.goals', requestId: string, machineId?: string }
→ { type: 'openrig.goalsChanged', requestId?: string, machineId?: string, goals: Goal[], partial?: boolean, error?: 'offline' | 'outdated' }

type Goal = {
  goalId: string; qitemId: string;
  text: string; folder: string | null; sentAt: string;
  to: string;                          // le siège de Max
  state: 'sent' | 'taken' | 'proposed' | 'running' | 'done' | 'closed';
  //  sent     : la ligne attend Max
  //  taken    : Max l'a prise, pas encore de proposition
  //  proposed : une proposition attend l'utilisateur (dans « À toi »)
  //  running  : Max a transmis l'objectif à une équipe
  //  done     : le dernier siège de la chaîne a fini
  //  closed   : Max l'a close sans la transmettre (refus, abandon, réglé autrement)
  proposal: {
    askId: string;                     // la demande dans « À toi » (même id que HumanAsk.id)
    team: TeamProposal | null;         // null : proposition en texte libre
    text: string;                      // le texte de la proposition, sans le bloc
    answer: { kind: 'option'; id: string } | { kind: 'words'; text: string } | null;  // ce que l'utilisateur a répondu
    answeredAt: string | null;
  } | null;
  trail: Array<{                       // le trajet, du plus ancien au plus récent
    at: string;
    kind: 'sent' | 'taken' | 'note' | 'handed' | 'closed';
    seat: string;                      // qui a agi (Max, puis les sièges de la chaîne)
    to?: string;                       // handed : à qui
    text?: string;                     // note : le texte ; closed : la résolution
    qitemId: string;                   // la ligne concernée
  }>;
  current: { qitemId: string; seat: string; state: string } | null;  // la ligne de la chaîne qui porte l'objectif maintenant
};

type TeamProposal = { rig: string; running: boolean | null; folder: string | null;
  seats: Array<{ seat: string; name: string | null; role: string | null; note: string | null }>; reason: string | null };
```

On garde les 20 objectifs les plus récents, le plus récent en premier. `role` se déduit du nom du siège (`pod.member`).

### Une proposition dans « À toi »

`HumanAsk` (lot 1) gagne deux champs optionnels :
- `goalId?: string` : l'objectif dont la demande est la proposition (le tag `ledge-goal:<id>`) ;
- `team?: TeamProposal` : le bloc `ledge-team` lu.

La carte violette se répond avec `openrig.answer` : `choice` `team`/`confirm`, `choice` `team`/`launch-rig`, ou `words`.

### Écrire à Max sur un objectif (repli, ou en plus)

```ts
{ type: 'openrig.goal.reply', requestId: string, machineId?: string, goalId: string, replyId: string,  // replyId : uuid, stable pour un renvoi
  text: string }
→ { type: 'openrig.goal.replied', requestId, machineId?, goalId, ok: boolean, qitemId?: string, error?: (comme goal.sent), message?: string }
```

Cela crée une nouvelle ligne vers Max (`--source ledge@external`, tags `ledge-goal-reply:<id d'objectif>`), qui le réveille.
Une note posée sur une ligne ne réveille personne : c'est pourquoi la réponse passe par une nouvelle ligne.

## Hors lot 2

- Ledge met l'objectif en forme (« Fini quand », « Reste à toi ») : lot 4 (harness et modèle de Ledge). Au lot 2, l'objectif part
  tel qu'écrit.
- « Ledge confirme seul » : lot 4.
- Plusieurs machines et le mobile : lot 3.
