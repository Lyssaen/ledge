# Cartes d'action (#94) : les textes des codes de refus

Compagnon de `ledge-action-card.html`. Une ligne de carte refusée ou échouée porte un `code` (`ACTION_ERROR_CODES`,
`packages/protocol/src/chat.ts`). Le front écrit son propre texte à partir de ce code et des `vars` de la ligne. `error`
garde le texte du daemon : il va dans le journal, jamais à l'écran.

## Le cadre, déjà validé

| État | fr | en |
|---|---|---|
| `refused` (rien n'a été envoyé) | Refusée : {texte} Rien n'a été envoyé. | Refused: {text} Nothing was sent. |
| `failed` (envoyé, et ça a échoué) | Échec : {texte} | Failed: {text} |

- `{texte}` est la phrase du tableau ci-dessous. Elle commence en minuscule après les deux-points, sauf si elle commence par un nom.
- Les noms (`{session}`, `{team}`) sont en gras, comme dans le `summary`. Un titre de tâche se met entre « » en français et entre " " en anglais.
- Le tutoiement vaut pour le Desktop, l'overlay et la TUI. Le téléphone vouvoie, comme le reste de son texte : quand une phrase s'adresse à l'utilisateur, elle a une colonne « téléphone ».
- Les phrases évitent l'accord avec le nom d'une session (« Nova », « Otto ») : un participe ne s'accorde qu'avec « la session », « l'équipe » ou « la tâche ».
- Un code inconnu du front se lit comme `failed`. S'il manque la variable d'une phrase, on prend la variante sans nom (dernière ligne de `unknown`).

## Les 22 codes, validés par l'utilisateur

| Code | Quand | fr | en |
|---|---|---|---|
| `unknown` | session | Ledge ne trouve plus **{session}**. | Ledge can no longer find **{session}**. |
| | équipe | Ledge ne trouve plus l'équipe **{team}**. | Ledge can no longer find the team **{team}**. |
| | tâche | Ledge ne trouve plus la tâche « {task} ». | Ledge can no longer find the task "{task}". |
| | action, ou cible sans nom | cette action n'est plus possible. | this action is no longer possible. |
| `ambiguous` | session | plusieurs sessions s'appellent **{session}** : redemande à Ledge en précisant laquelle. · *téléphone* : … redemandez à Ledge en précisant laquelle. | several sessions are called **{session}**: ask Ledge again and say which one. |
| | équipe | plusieurs équipes s'appellent **{team}** : redemande à Ledge en précisant laquelle. · *téléphone* : … redemandez à Ledge en précisant laquelle. | several teams are called **{team}**: ask Ledge again and say which one. |
| `read_only` | session lancée hors de Ledge | **{session}** est en lecture seule : Ledge ne peut pas lui écrire. | **{session}** is read-only: Ledge cannot write to it. |
| `exited` | session arrêtée | **{session}** ne tourne plus. | **{session}** is no longer running. |
| `running` | `session.archive` | **{session}** tourne encore : il faut d'abord fermer sa session. | **{session}** is still running: its session has to be closed first. |
| | `session.resume` | **{session}** tourne déjà : rien à reprendre. | **{session}** is already running: nothing to resume. |
| `archived` | `session.archive` | **{session}** est déjà dans l'archive. | **{session}** is already archived. |
| `not_archived` | `session.restore` | **{session}** n'est pas dans l'archive : rien à en sortir. | **{session}** is not archived: nothing to restore. |
| `no_terminal` | `session.interrupt` | **{session}** n'a pas de terminal : Ledge ne peut pas l'interrompre. | **{session}** has no terminal: Ledge cannot interrupt it. |
| `same_model` | `session.model` | **{session}** tourne déjà sur ce modèle, avec cet effort. | **{session}** already runs this model, at this effort. |
| `no_request` | `session.decide` | **{session}** n'attend plus de réponse : la demande a été réglée entre-temps. | **{session}** is no longer waiting for an answer: the request was settled in the meantime. |
| `in_session` | `session.decide`, session OMP | les demandes de **{session}** se règlent dans sa session. | **{session}**'s requests are answered in its session. |
| `no_note` | `session.decide` avec une note | **{session}** ne peut pas recevoir de note avec cette réponse. | **{session}** cannot take a note with this answer. |
| `member` | `team.join` | **{session}** est déjà dans l'équipe **{team}**. | **{session}** is already in the team **{team}**. |
| `not_member` | `team.leave` | **{session}** n'est pas dans l'équipe **{team}**. | **{session}** is not in the team **{team}**. |
| `unknown_role` | `team.join` | le rôle @{role} n'existe pas pour ce projet. | there is no @{role} role for this project. |
| `not_resting` | `team.resume` | l'équipe **{team}** n'est pas au repos : rien à reprendre. | the team **{team}** is not resting: nothing to resume. |
| `dissolved` | toute action d'équipe | l'équipe **{team}** a été dissoute entre-temps. | the team **{team}** was dissolved in the meantime. |
| `no_seat` | `team.save` | l'équipe **{team}** n'a aucun poste : rien à enregistrer comme modèle. | the team **{team}** has no seat: nothing to save as a template. |
| `closed` | `task.*` | la tâche « {task} » est déjà close. | the task "{task}" is already closed. |
| `holder` | `task.pass` | **{session}** tient déjà la tâche « {task} ». | **{session}** already holds the task "{task}". |
| `changed` | `session.decide` | *pas une ligne « Refusée »* : c'est l'état « La demande a changé » de la maquette, avec son texte (« La demande de Nova a changé depuis ma réponse : rien n'a été envoyé. Ouvre Nova pour voir la nouvelle, ou redemande-moi. ») et « Ouvrir Nova ». | *(the "request changed" state)* **{session}**'s request has changed since my answer: nothing was sent. Open **{session}** to see the new one, or ask me again. |
| | autre action | la situation a changé depuis ma réponse : redemande-moi. · *téléphone* : la situation a changé depuis : redemandez à Ledge. | things have changed since my answer: ask me again. |
| `failed` | envoyé, et ça a échoué | l'action est partie, mais n'a pas abouti. *(avec « Réessayer », comme aujourd'hui)* | the action was sent but did not go through. |

## Hors de la liste

- `ignored` (réponse de `chat.act` sur une carte ignorée) et `confirm_required` (action irréversible sans confirmation) ne s'affichent jamais. La carte ignorée est repliée, et le front confirme avant d'envoyer. Si l'un d'eux arrive quand même, on rouvre la carte pour `ignored`, et on ouvre la confirmation pour `confirm_required`, sans texte d'erreur.
- Une demande coupée (`detailCut`) n'est pas un refus : c'est l'état « Demande coupée » de la maquette.
