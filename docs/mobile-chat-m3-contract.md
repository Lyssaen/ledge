# Contrat : le chat Ledge du téléphone, côté PC (refonte mobile M3)

Pour `dev-front`, qui code M3 (l'onglet Ledge et le volet de la tablette). La maquette validée par l'utilisateur est
`docs/mockups/ledge-mobile-refonte/m3-chat.html` (« M3 validée A », 2026-11-10 à 20:25Z, Q30 à Q37). Ce contrat dit ce que
le PC fournit pour Q31, Q33, Q34 et Q35. Q30, Q32, Q36 et Q37 se font sur le téléphone seul.

Les schémas zod font foi :
- `packages/protocol/src/phone.ts` : les messages `chat.*` ;
- `packages/protocol/src/chat.ts` : le tour, la ligne d'action et ses `vars`.

Le comportement est fixé par les tests :
- `packages/ledge/test/chat-conversations.test.ts` et `mobile-chat-conversations.test.ts` (Q33) ;
- `chat-limits.test.ts` (Q31) ;
- `daemon-actions.test.ts` (Q34 et Q35) et `chat-act.test.ts` (la cause d'un refus `unknown` dans `vars.missing`).

Aucun texte visible n'est écrit par le PC pour ces quatre points : le téléphone écrit ses propres mots, ceux de la
fiche de passation de la maquette.

## 1. Drapeau

`snapshot.daemon.conversations: true` : le PC garde les conversations de l'appareil 7 jours, répond à
`chat.conversations` et à `chat.conversation`, et `chat.reset` range la conversation au lieu de l'effacer.

Sans le drapeau (PC plus ancien) : c'est le repli B de la maquette. Une lecture envoyée quand même est répondue par
`{ type: 'error', code: 'invalid', request: 'chat.conversations' }` (ou `'chat.conversation'`).

Q31, Q34 et Q35 n'ont pas de drapeau propre. Un PC plus ancien n'envoie simplement pas les champs décrits plus bas.

## 2. Q31 : une réponse qui a lu les limites

Quand le PC connaît les limites des harnais (`daemon.usage`), il écrit `limits.md` dans le dossier que Ledge lit avant de
répondre. Ce fichier donne, pour chaque harnais, son état, l'heure de la dernière lecture réussie, et chaque fenêtre avec
son pourcentage et l'heure de sa remise à zéro.

Quand Ledge lit ce fichier pendant une réponse, le PC le dit par un message à part, pour qu'un téléphone plus ancien ne
perde rien (voir §6) :

```
← { type: 'chat.limits', reads: [{ qid, at }…] }
```

- `at` : l'heure où Ledge a lu les limites pour cette question.
- Le PC l'envoie juste après chaque `chat.history` et chaque `chat.done` qui touchent un tour qui a lu les limites. `reads`
  porte alors tous les tours de la conversation en cours qui les ont lues, 50 au plus. Un `chat.history` sans tour de ce
  genre n'est pas suivi de `chat.limits`.
- `chat.conversation` porte le même `limits: [{ qid, at }]` pour une conversation passée (§3).

Le téléphone affiche alors, sous cette réponse, les barres de « Limites » tirées de son propre `usage.state`, avec
« Lu il y a … » calculé depuis `at`. Sans lecture des limites, la réponse reste du texte (Q31). Aucune étape n'est ajoutée à
`steps`.

## 3. Q33 : 7 jours de conversations par appareil

**Ce que le PC garde.** Chaque appareil a ses conversations, et l'une d'elles est en cours :
- Le PC enregistre la conversation en cours à chaque changement (question, réponse, carte qui avance). Un daemon qui
  redémarre la retrouve : elle n'est plus perdue. Ce qui était en cours à l'arrêt ne l'est plus : une instruction en file
  redevient proposée, une ligne en cours passe `failed`, et une question encore sans réponse revient avec `error: 'failed'`
  (« Ledge n'a pas pu répondre », §3 de la maquette) : elle n'est jamais « en cours » pour toujours.
- **« Nouvelle conversation » (`chat.reset`) range la conversation en cours** dans la liste, puis en ouvre une vide. Rien
  n'est effacé. Le fil reçoit `chat.history { turns: [] }` comme avant. Sans question, il n'y a rien à ranger.
- **Un nouveau jour** range aussi la conversation de la veille. La première question du jour ouvre une nouvelle
  conversation, comme aujourd'hui.
- Une conversation dont la dernière question date de plus de 7 jours est supprimée au démarrage du daemon et à chaque
  nouvelle conversation. C'est vrai aussi de la conversation en cours d'un appareil qui ne revient pas.
- Oublier l'appareil (`device.forget`) supprime ses conversations.

**La liste.**

```
→ { type: 'chat.conversations' }
← { type: 'chat.conversations', current?: Résumé, past: [Résumé…] }
Résumé = { id, startedAt, lastAt, first, count }
```

- `current` : la conversation en cours, absente tant qu'elle n'a aucune question.
- `past` : les conversations rangées, la plus récente d'abord, 200 au plus.
- `first` : sa première question, coupée à 200 caractères ; `count` : son nombre de questions ; `startedAt` et `lastAt` :
  l'heure de sa première et de sa dernière question.
- Le téléphone fait lui-même les groupes par jour (« Aujourd'hui », « Hier », « lun. 8 nov. ») à partir de `startedAt`.
- La liste n'est pas poussée : le téléphone la redemande quand il ouvre la feuille « Conversations ».

**Rouvrir une conversation passée.**

```
→ { type: 'chat.conversation', id }
← { type: 'chat.conversation', id, turns?, limits?, error? }
```

- `turns` : ses tours, au même format que `chat.history` (`PhoneChatTurn`). Ils sont figés dans l'état où ils ont été
  rangés, chaque carte avec son issue (appliquée, refusée, échouée, ignorée…).
- Elle est **en lecture seule** : une action sur une de ses cartes (`chat.act`, `chat.launch`, `chat.close`,
  `chat.relay`, `chat.task`, `chat.ignore`) est refusée par `operation.result` `rejected`, comme une carte inconnue.
  Le téléphone éteint donc ses boutons.
- `error: 'unknown'` : elle n'existe plus (plus de 7 jours, ou appareil oublié). `id` de la conversation en cours : ce
  sont les tours de `chat.history`.
- Comme `chat.history`, la réponse garde les tours les plus récents qui tiennent dans le budget de la trame, et marque
  `cut` un tour raccourci.

**Ce qui n'est pas gardé.** Une image jointe n'est gardée que tant que la conversation en cours la tient. Une conversation
passée peut donc citer une image qui n'existe plus : le téléphone la montre comme une image introuvable.

## 4. Q34 : les lignes des actions OpenRig

Chaque ligne de `rig.act` et de `rig.seats` porte ses variables (`vars`), pour que le téléphone écrive la ligne et le
bouton de §5 de la maquette :

| `action` | `vars` |
|---|---|
| `rig.act` (rig) | `kind` (`rig.start`, `rig.stop`, `rig.restart`, `rig.snapshot`), `rig` |
| `rig.act` (kernel) | `kind` (`kernel.start`, `kernel.stop`, `kernel.restart`), `rig` = `kernel` |
| `rig.seats` | `rig`, `role` (`pod.membre`), `count` (après), `from` (avant) |

- `risk` vaut `destructive` pour un arrêt, un redémarrage, ou un retrait de sièges ; `reversible` sinon.
- `summary` reste la phrase du daemon, en français : c'est le repli quand un `kind` est inconnu du téléphone.
- **Les refus** se lisent sur **la ligne** (`state: 'refused'` et son `code`) de `chat.history` ou de `chat.done`, jamais
  dans `operation.result` : un `chat.act` dont une ligne est refusée au moment d'appliquer reçoit `operation.result`
  `failed`, sans raison. Seuls les refus d'avant l'application y arrivent en `rejected` (`confirm_required`, une
  vérification de l'appareil refusée, une carte inconnue). Les codes d'une ligne :
  - `not_running` : le rig ou le kernel ne tourne pas ;
  - `running` : il tourne déjà ;
  - `unchanged` : le rôle a déjà ce nombre de sièges ;
  - `unknown` : quelque chose a disparu depuis la carte. La ligne refusée porte alors la cause dans `vars.missing`, une clé
    ajoutée par le PC au moment du refus :
    - `openrig` : OpenRig n'est pas sur ce PC ;
    - `rig` : le rig n'existe plus (aussi pour un changement de sièges dont le rig a disparu) ;
    - `role` : le rig tourne, mais le rôle n'a aucun siège.

    Sans `vars.missing` (un PC d'avant #283), le téléphone n'affirme aucune cause : il dit seulement que l'action n'est
    plus possible.
    Desktop, l'île et la TUI disent la même chose : `packages/ui/src/chat/actionWords.ts` (`why`, cas `unknown`).

  Un code inconnu se lit comme `failed`.

## 5. Q35 : ce qu'une étape irréversible coupe

Toutes les actions OpenRig demandent la vérification de l'appareil (`phone: 'act'`, déjà en place). Pour qu'une étape
irréversible dise dans la feuille quels sièges elle coupe, ses `vars` portent aussi :

- `seats` : les sièges coupés, séparés par `, `, chacun écrit comme sa session sans `@rig` (`dev-back`) :
  - pour `rig.stop` et `rig.restart`, tous les sièges du rig ;
  - pour `kernel.stop` et `kernel.restart`, ceux du kernel, quand le PC les connaît ;
  - pour un retrait de sièges (`rig.seats` où `count` < `from`), ceux qu'OpenRig retirera : les derniers du rôle.
- `seatCount` : leur nombre, même quand `seats` est coupé.
- `seatsMore` : combien manquent à `seats` quand la liste dépasse 300 caractères (« … et N autres » sur le téléphone).

`seats` est absent quand le PC ne connaît pas les sièges, par exemple pour un kernel qu'il ne lit pas. La feuille dit alors
seulement que l'étape est irréversible.

Au moment d'appliquer, le PC recalcule les sièges coupés. S'ils ne sont plus ceux de la carte (un siège remplacé, un rôle qui
a grandi, un siège ajouté au rig), la ligne n'est pas appliquée : elle passe `refused` avec le code `changed`, comme une
cible qui a changé depuis la carte. Ledge peut alors proposer une nouvelle carte, avec les sièges réels.

## 6. Vérifié, et non vérifié

Vérifié par les tests (Node 24) : voir les fichiers nommés en tête.

Non vérifié :
- un vrai téléphone ;
- un vrai Claude Code qui lit `limits.md` (le test passe par un faux harnais qui « lit » le fichier).

**Un téléphone plus ancien** ignore un message qu'il ne connaît pas. C'est pourquoi la lecture des limites arrive dans
`chat.limits`, et non comme un champ de `PhoneChatTurn` : ce schéma est strict, et un champ nouveau ferait perdre tout le
`chat.history`. Les `vars` de §4 et §5 ne changent pas de schéma : ce ne sont que de nouvelles clés.
