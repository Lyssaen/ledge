# Contrat : MR/PR et pipelines sur le téléphone (refonte mobile B5, partie 1)

Pour `dev-front`, qui code M5 (l'onglet MR/PR du téléphone et de la tablette, la section « Pipelines » de « À toi », le lien
PR du pied de session) sans avoir à demander. Les schémas zod font foi :
- `packages/protocol/src/phone.ts` : les messages `forge.*` ;
- `packages/protocol/src/phoneForge.ts` : les bornes et les codes ;
- `packages/protocol/src/forge.ts` : la demande, son détail et ses actions, les mêmes que pour Desktop.

Le comportement est fixé par `packages/ledge/test/mobile-forge.test.ts`.

Le téléphone voit les MR (GitLab) et PR (GitHub) **du PC auquel il est appairé**, par la passerelle chiffrée, exactement comme
la vue MR/PR de Desktop (lots 8a et 8b). Le PC les lit avec ses propres `gh` et `glab`. Aucun jeton ne circule, ni vers
Desktop ni vers le téléphone. Le lot 8a avait écarté le téléphone (R8 : « un lot à part ») ; c'est ce lot-ci, demandé par
la décision 3 de l'utilisateur (2026-11-10 : tout le périmètre MR/PR dès M5).

## 1. Drapeau

`snapshot.daemon.forge: true` : le PC répond à `forge.state` et à `forge.detail`, et accepte `forge.act`.

Sans le drapeau (PC plus ancien, ou sans relevé des forges) :
- l'onglet MR/PR n'a rien à afficher (décision 1 : « rien à afficher », comme Desktop) ;
- une lecture est répondue par `{ type: 'error', code: 'invalid', request: 'forge.state' }` (ou `'forge.detail'`) ;
- un `forge.act` est répondu par `operation.result` `rejected` / `unavailable`, avec `forge.done { ok: false, rejected: 'unavailable' }`.

## 2. La liste

```
→ { type: 'forge.state' }
← { type: 'forge.state', prs: [PullRequest…], forges: [statut…], followed: [{ session, forge, host, repo }…] }
```

`forge.state` **abonne** l'appareil : il reçoit ensuite chaque changement, toujours la liste entière. L'abonnement dure tant
que la passerelle suit l'appareil.

Le PC relit les demandes toutes les 60 s, ou toutes les 15 s quand un pipeline suivi tourne ou attend. Il les relit aussi
tout de suite après une action, et quand une session change de branche.

**Ce qui est suivi.** Les demandes dont la branche source est celle d'une session ou d'un siège OpenRig de ce PC. Les
branches par défaut et les HEAD détachées n'en font pas partie.

`PullRequest` :

| Champ | Contenu |
|---|---|
| `id` | `hôte/dépôt#numéro`, stable : c'est la clé de `forge.detail` et `forge.act` |
| `forge`, `host`, `repo`, `number` | `github` ou `gitlab`, l'hôte, le chemin du dépôt, le numéro |
| `ref` | ce que la forge affiche : `#226` (GitHub) ou `!41` (GitLab) |
| `url` | **« Ouvrir dans le navigateur »** : le téléphone l'ouvre lui-même ; aucun message vers le PC |
| `title`, `state` | `draft`, `open`, `review` (des relecteurs sont attendus ou demandent des changements), `merged`, `closed` |
| `branch`, `target`, `headSha` | la branche source, la branche cible, la tête |
| `pipeline` | `ok`, `run`, `fail`, `wait`, `skip`, `none` (aucun pipeline, dans un dépôt sans CI) |
| `approvals` | `{ given, required? }` ; `required` vient de GitLab, GitHub ne le donne pas |
| `mergeable` | tout ce qu'une fusion demande, à part le pipeline |
| `openThreads` | les discussions qu'on peut résoudre et qui ne le sont pas |
| `updatedAt` | la liste arrive triée par ce champ, la plus récente d'abord |
| `sessions` | les sessions de ce PC sur cette branche, la plus active d'abord : leurs `id` sont ceux du snapshot. C'est le lien session ↔ PR (« #226 » dans le pied de session) |

Le statut d'une forge (`forges`) : `{ forge, host, status: ok | missing | unauthenticated | error, at, since?, retryAt?, readAt? }`.
- `missing` : le `gh` ou le `glab` du PC n'est pas installé. Le PC le cherche dans le `PATH` du shell de connexion, sans le
  lancer, toutes les 5 min, avant de lire ses hôtes connectés : un `glab` absent (le cas de l'utilisateur, décision 35) est
  donc `missing`, jamais `unauthenticated`.
- `unauthenticated` : la CLI n'est pas connectée à cet hôte. Le PC n'appelle alors jamais cet hôte.
- `error` : la lecture a échoué. `since` dit depuis quand, `retryAt` quand le PC réessaie (dans 2 à 10 min), et `readAt`
  quand les demandes encore affichées ont été lues pour la dernière fois.
- **Pas de `message`** : le texte de la CLI peut contenir un chemin du PC ou les mots du proxy. Desktop l'a, le téléphone non.

`followed` : chaque session suivie, avec la forge de son dépôt. Le téléphone peut ainsi distinguer « aucune demande sur
cette branche » de « cette forge ne peut pas être lue ici », la puce « PR ? » de Desktop.

Bornes :
- 100 demandes au plus, 20 forges, 200 sessions suivies ;
- une demande dont la forge, l'état ou le pipeline est inconnu du téléphone est écartée, pas le message entier.

## 3. Le détail

```
→ { type: 'forge.detail', prId, log? }           // log : l'id d'un job, pour son extrait de log
← { type: 'forge.detail', prId, detail?, cut?, error? }
```

`detail` (`PrDetailSchema`, le même que pour Desktop) :
- `pr`, `description`, `author`, `labels`, `issues` (les tickets qu'elle ferme, `#38`) ;
- `reviewers` : `{ name, state: approved | changes | pending }` ;
- `jobs` : **le pipeline**, `{ id, name, column, columnName, status, durationS? }`. `column` est l'index de l'étape
  (GitLab) ou du workflow (GitHub), et `columnName` son nom : ce sont les « étapes » du graphe. `durationS` donne la durée ;
- `log` : seulement quand il est demandé (`log` = l'id d'un job). C'est `{ jobId, text }` : les 60 dernières lignes du job,
  sans couleurs ANSI, avec les secrets masqués par le PC ;
- `threads` : **les discussions**, `{ id, resolvable, resolved, file?, line?, code?, comments: [{ id, author, at, body }] }`. Une
  discussion de revue porte `file`, `line` et `code` (la ligne du diff). Un commentaire sur la demande elle-même n'a pas
  de fichier et ne se résout pas ;
- `files` : **Modifications**, `{ path, added, removed, patch? }` ;
- `commits` : **Commits**, `{ sha, title, author, at }` ;
- `mergeCommand` : la commande exacte qu'une fusion lancera, pour la confirmation ;
- `mergeBlockers` : pourquoi la fusion est refusée maintenant, en codes. Une liste vide veut dire que la demande peut être
  fusionnée. Les codes : `not_open`, `draft`, `approvals`, `changes_requested`, `pipeline` (le pipeline n'est pas vert,
  `pr.pipeline` dit comment), `pipeline_not_started` (aucun pipeline encore sur la tête, dans un dépôt qui a une CI ou dont
  on ne sait pas). Un code inconnu s'affiche tel quel.

**Pour tenir dans une trame** (environ 1 Mio une fois chiffrée), le PC allège le détail avant de l'envoyer et dit `cut: true` :
1. une description ou un commentaire de plus de 8 000 caractères est raccourci et finit par « … » ; un extrait de log de
   plus de 64 000 caractères garde sa **fin** (ce qui a échoué) et commence par « … » ;
2. si le détail pèse encore plus de 800 000 octets, les `patch` partent, mais la liste des fichiers reste ;
3. puis les discussions les plus anciennes, puis les commits les plus anciens ;
4. puis les fichiers au-delà des 300 premiers et les jobs au-delà des 200 premiers, puis l'extrait de log, puis les listes
   restantes.

La borne vaut pour le détail entier, vérifié à la fin. Si rien ne le fait tenir, le PC répond `error: 'too_large'` plutôt
qu'une trame qui n'arriverait jamais.

Le PC garde un détail 30 s : deux lectures rapprochées ne relancent pas `gh`.

`error` :
- `unavailable` : la demande n'est pas suivie sur ce PC (elle a disparu de la liste) ;
- `failed` : `gh` ou `glab` a échoué, ou n'a pas répondu dans les 60 s ;
- `too_large` : même allégé, le détail ne tient pas dans une trame (§ 3).

Jamais le texte du PC.

## 4. Les actions

```
→ { type: 'forge.act', op, prId, action, assertion }
action = { kind: 'rerun' }
       | { kind: 'merge', headSha }             // la tête que la personne a vue
       | { kind: 'comment', body }              // ≤ 64 Kio
       | { kind: 'reply', threadId, body }
       | { kind: 'resolve', threadId }
← operation.result { op, status: received → applied | rejected | failed, reason? }
← { type: 'forge.done', op, ok, command?, error?, message?, rejected? }
```

**Toutes demandent la passkey** : chacune écrit sur la forge au nom de l'utilisateur. Une relance lance la CI, et un
commentaire est publié sous son nom. La vérification porte sur **cette demande et cette action précises**, texte compris :

```
→ { type: 'confirm.prepare', purpose: 'forge', forge: { prId, action } }
← { type: 'confirm.challenge', purpose: 'forge', challenge, rpId, credentialId, expiresInMs }
```

`confirm.prepare` répond `error` / `invalid` :
- si le PC n'a pas de forge ;
- si l'appareil n'a pas de passkey (ou en a une d'un autre relais) ;
- si la demande n'est pas dans la liste de ce PC.

Une assertion faite pour un commentaire et envoyée avec un autre texte est refusée (`assertion_invalid`).

Ce que fait le PC est exactement le `forge.act` de Desktop :
- il relit la demande avant d'agir ;
- une fusion refuse une tête qui a bougé (`stale`) et une demande que la forge refuserait maintenant (`not_offered`) ;
- une relance refuse un pipeline qui tourne encore (`busy`) ;
- après l'action, il relit la liste, et le téléphone abonné reçoit le nouveau `forge.state`.

`forge.done` :
- `ok: true` avec `command` : la commande lancée (`gh pr merge 226 --repo acme/shop --squash`), pour l'accusé ;
- `rejected` : l'action n'a même pas été tentée, avec `confirm_required`, `assertion_invalid`, `assertion_expired` ou `unavailable` ;
- `error` :

| `error` | `operation.result` | Cas |
|---|---|---|
| `stale` | `rejected` / `stale` | la demande a de nouveaux commits depuis que la personne l'a vue : relire le détail |
| `busy` | `rejected` / `busy` | une relance pendant que le pipeline tourne |
| `not_offered` | `rejected` / `not_offered` | une fusion que la forge refuserait maintenant : `mergeBlockers` dit pourquoi |
| `unavailable` | `rejected` / `unavailable` | la demande n'est plus suivie |
| `failed` | `failed` | `gh` ou `glab` a échoué ; `message` est sa ligne (secrets masqués par le PC, ≤ 500 caractères). C'est le seul texte du PC que le téléphone reçoit |

Le même `op` renvoyé (« Réessayer ») redonne le résultat et `forge.done`, sans seconde action, tant que le PC le garde : au
moins 6 min (la fenêtre de renvoi du téléphone, 5 min, plus le trajet ; détail au § 6 du contrat de lancement), jamais
après un redémarrage du daemon. Le même `op` avec une autre demande ou une autre action est refusé (`conflict`).

## 5. Ce qui reste au téléphone

- **Ouvrir dans le navigateur** : `pr.url`, sans message au PC.
- **Envoyer à l'agent** : il n'y a pas de message propre. Le téléphone écrit à une session de `pr.sessions` avec le
  `session.reply` qui existe déjà. Le texte (une discussion citée, une consigne) est à dessiner par `design-ux`.
- **« À toi » › Pipelines** : à tirer de `forge.state` (par exemple `pipeline: 'fail'`). Aucun message propre.
- **Textes** : aucun ici. Les mots de M5 sont à dessiner par `design-ux`, en particulier ceux des codes de refus et des
  `mergeBlockers`.

## 6. Le risque `glab` derrière le proxy

**Vérifié dans le code :**
- `gh` et `glab` tournent avec l'environnement du shell de connexion de l'utilisateur (`loginShellEnv`, relu toutes les
  5 min) : son proxy (`HTTPS_PROXY`, `NO_PROXY`) et sa connexion. Ils ne passent jamais par un shell ;
- jamais d'invite : `NO_PROMPT`, `GLAB_CHECK_UPDATE=false`, `GLAB_SEND_TELEMETRY=false`, 20 s au plus par appel ;
- un hôte auquel `glab` n'est pas connecté n'est jamais appelé (`unauthenticated`) ;
- une forge en échec garde ses demandes affichées et réessaie dans 2, 4, 8 puis 10 min. Le téléphone voit
  `status: 'error'`, `since` et `retryAt`, mais pas le texte de l'erreur.

**Non vérifié :**
- **`glab` n'est pas installé sur la machine où j'ai travaillé** (Legion, un Ubuntu natif, pas le PC de l'utilisateur), et je n'ai
  pas d'accès au GitLab de l'entreprise. Je n'ai donc pas vérifié que `glab` atteint l'instance derrière le proxy.
- Ce qu'il faudrait vérifier sur le PC de l'utilisateur :
  - `glab auth status` dans le shell de connexion ;
  - que l'hôte GitLab est joignable avec le `HTTPS_PROXY` ou le `NO_PROXY` de ce shell ;
  - que le certificat de l'entreprise est connu de `glab`, qui utilise les certificats du système.
- Sans ça, la forge GitLab apparaîtra en `error` (ou `unauthenticated`) dans la liste. C'est déjà le cas sur Desktop : ce
  lot ne change rien au relevé. Sans `glab` installé, elle apparaît en `missing`.
- Une forge n'apparaît dans `forges` que si une session suivie a un dépôt sur cet hôte : sans dépôt GitLab suivi, il n'y a
  pas de ligne GitLab du tout, `missing` ou non.

## 7. Vérifié, et non vérifié

- Vérifié par les tests (`mobile-forge.test.ts`, Node 24) :
  - le drapeau ;
  - la liste et ses changements, seulement pour l'appareil abonné, sans le `message` des forges ;
  - les lectures refusées sans forge ;
  - le détail avec l'extrait de log, et ses erreurs `unavailable` et `failed`, sans texte du PC ;
  - l'allègement d'un détail trop lourd ;
  - la passkey sur l'action exacte (sans, ou signée pour un autre texte : refusée) ;
  - le défi refusé pour une demande non suivie ;
  - l'action appliquée une fois, avec sa commande, puis rejouée sans seconde action ;
  - chaque code de refus, et la ligne raccourcie d'un échec ;
  - le schéma strict.
- Non vérifié :
  - un vrai `gh` ou `glab` derrière le téléphone : les tests passent par un faux PC ;
  - le GitLab de l'entreprise (§ 6) ;
  - un vrai téléphone.
