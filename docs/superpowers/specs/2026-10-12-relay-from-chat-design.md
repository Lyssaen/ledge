# Relayer une instruction depuis le chat Ledge — design

Date : 2026-10-12 · Projet personnel, hors story Jira · Auteur : Guillaume Charlier avec Claude Code

S'appuie sur la [spec du lancement depuis le chat](2026-10-12-launch-from-chat-design.md) (le bloc, la carte, la confirmation par clic), sur celle [des sessions et du chat](2026-10-11-sessions-identity-and-chat-design.md) (section 5, le persona ; « relayer un message à un bot » y était en V2) et sur `session.reply` (la réponse depuis l'overlay). Tout ce que cette spec ne mentionne pas reste tel que ces specs le décrivent.

## 1. Objectif

L'utilisateur doit pouvoir demander au chat d'envoyer une instruction à une session suivie : « dis à Otto de lancer les tests ». Ledge identifie la session, propose une carte « Envoyer à **Otto** : *lance les tests* · [Envoyer] », et l'instruction part au clic. Si la session n'est pas libre, l'instruction attend dans le daemon et part dès qu'elle l'est.

Succès :

- Une demande explicite dont la session est sûre produit, sous la réponse, une carte de relais.
- Une demande dont la session n'est pas sûre (plusieurs candidats, aucun, session en lecture seule) produit une question ou une explication, jamais une carte devinée.
- Le clic sur une session libre envoie l'instruction exactement comme une réponse tapée dans l'overlay ; sur une session occupée, la carte passe « en attente » et l'instruction part au prochain retour à l'état libre, même si l'overlay est fermé entre-temps.
- Une carte n'envoie qu'une fois, même après un double clic, une reconnexion ou depuis un second overlay.
- Le chat lui-même n'envoie rien : il propose, le clic de l'utilisateur envoie.

Décisions prises pendant le cadrage :

- Cible : toutes les sessions suivies par Ledge (lancées par le chat, par le `+` ou par `ledge claude`), sauf les sessions `hook_only`, en lecture seule.
- Action : relayer une instruction, et seulement cela.
- Session occupée : file d'attente dans le daemon, annulable depuis la carte.
- Approche : un second bloc, `ledge-relay`, calqué sur `ledge-session` ; le lancement n'est pas refondu.

Hors périmètre : répondre à une question ou une permission en attente, interrompre ou arrêter une session, modifier l'instruction sur la carte (on reformule la demande), relayer vers plusieurs sessions à la fois, conserver la file après un redémarrage du daemon.

## 2. Le principe de lecture seule

Le harnais du chat reste lancé en lecture seule, sans outil nouveau (spec du lancement, section 2). Il gagne seulement le droit d'écrire une proposition de relais dans sa réponse. L'envoi passe par le daemon, au clic de l'utilisateur, par le même chemin que `session.reply`.

## 3. Le bloc de relais

Le harnais termine sa réponse par un bloc de code dont la langue est `ledge-relay`, contenant un objet JSON :

````
```ledge-relay
{"session": "a1b2c3", "text": "Lance les tests de l'overlay"}
```
````

- `session` : obligatoire, l'`id` de la session tel que `sessions.md` le donne.
- `text` : obligatoire, non vide après `trim` : l'instruction exacte à taper dans la session.

Une réponse porte au plus une carte : quand elle contient des blocs `ledge-session` et `ledge-relay`, tous sont retirés du texte affiché et seul le dernier, toutes langues confondues, compte.

## 4. Daemon

- **`protocol/proposal.ts`** : `extractProposal(answer)` reconnaît les deux langues de bloc et renvoie `{ text, kind, raw }`, `kind` valant `'session'`, `'relay'` ou `null`. `parseRelayBlock(raw)` valide `{ session, text }` comme `parseProposalBlock` valide le bloc de lancement. `hideProposal` masque les deux langues pendant le streaming, y compris une barrière en cours de frappe.
- **`PERSONA`** (`chat/claude.ts`) : « jamais d'instruction envoyée à une session » devient « tu n'envoies jamais rien toi-même à une session ». Ajout de la règle : « Quand l'utilisateur demande explicitement de dire, demander ou envoyer quelque chose à une session, et seulement si une seule session de sessions.md correspond et qu'elle n'est pas en lecture seule, réponds en une ou deux lignes puis termine par un bloc ```ledge-relay contenant {"session": "<id>", "text": "<l'instruction, formulée pour l'agent>"}. Si plusieurs sessions conviennent ou aucune, ne mets pas de bloc : cite les candidats et demande laquelle. » `sessions.md` indique pour chaque session en lecture seule `- read-only: Ledge cannot send to it`.
- **`chat/service.ts`**, en fin de tour réussi : pour un bloc `relay` valide, `deps.lookup(id)` (la session du store) ; si elle est inconnue, `hook_only` ou `exited`, pas de carte (ligne de log) ; sinon `turn.relay = { id, name, tool, text }`, joint à `chat.done`. Nouvelles méthodes de `Chat` : `relay(qid)` (le relais du tour, s'il est dans l'historique du jour), `markRelay(qid, patch)` (pose `status`, `sentAt`, `error` ; un `status` efface `error`), `queuedRelays()` (les tours dont le relais est `queued`, du plus ancien au plus récent). `markRelay` émet `chat.history` à tous les clients.
- **`daemon/server.ts`** : le corps de `session.reply` devient une fonction `replyTo(id, text)` qui renvoie `null` ou le message d'erreur, partagée par `session.reply` et le relais. Comportement de `session.reply` inchangé.
- **`daemon/relay.ts`** (nouveau) : `createRelay({ chat, store, replyTo, broadcast })`.
  - `request(qid)` : le tour doit exister et porter un relais sans `status`, ou en erreur (Réessayer) ; sinon erreur « déjà envoyée », « déjà en file » ou « relais introuvable ». Les champs viennent du tour, jamais du message. Session libre (`idle`, sans `pending`) : `replyTo` tout de suite, puis `status: 'sent', sentAt` ou `error`. Sinon : `status: 'queued'`.
  - `cancel(qid)` : un relais `queued` redevient proposé (`status` retiré) ; sinon erreur « rien en file ».
  - Abonnement à `store.onChange` : quand une session devient libre, la plus ancienne instruction en file pour elle part (une seule par passage, la suivante attend le prochain retour à l'état libre). Quand elle passe `exited` ou est retirée, ses instructions en file passent en `error` (« Otto s'est arrêté »).
- **`daemon/server.ts`** : `session.relay { qid }` appelle `request`, `session.relay.cancel { qid }` appelle `cancel` ; une erreur part au demandeur comme `error`, l'état de la carte à tous par `chat.history`.
- Un relais vit avec son tour : un `chat.reset`, un nouveau jour ou un redémarrage du daemon emportent la file avec l'historique, et rien n'est envoyé.

## 5. Protocole

| Message | Changement |
| --- | --- |
| `ChatRelay` (nouveau) | `{ id, name, tool, text, status?: 'queued' \| 'sent', sentAt?, error? }` |
| `ChatTurn` | `relay?: ChatRelay` |
| `chat.done { qid, text, at, proposal? }` | `relay?` (le même objet, sans `status`, `sentAt` ni `error`) |
| `session.relay { qid }` (nouveau) | Envoie ou met en file le relais de la carte de ce tour. |
| `session.relay.cancel { qid }` (nouveau) | Retire de la file le relais de ce tour. |

Les champs ajoutés aux messages existants sont facultatifs : un overlay ou un daemon plus ancien les ignore.

## 6. Overlay

- **`RelayCard.tsx`** (nouveau), rendue sous la réponse dans `ChatView`, avant les sources, à la place de `LaunchCard` (un tour n'a qu'une carte). Quatre états :
  - **proposée** : le compagnon et « Envoyer à **Otto** », l'instruction en citation, pied « [➤ Envoyer] ou reformule ta demande » ;
  - **en attente** (`queued`) : « **Otto** travaille, j'enverrai dès qu'il aura fini » (ou « attend ta réponse » quand une demande est en cours), bouton [Annuler] ;
  - **envoyée** (`sent`) : « Envoyé à **Otto** · 14:32 », le nom étant le lien `ledge://session/<id>` existant ;
  - **échec** (`error`) : le message du daemon dans une bande `role="alert"`, pied « [Réessayer] ou reformule ta demande ».
- L'état de la session vient du snapshot que l'overlay a déjà ; la carte ne lit rien d'autre.
- **`Surface.tsx`** : Envoyer et Réessayer envoient `session.relay { qid }`, Annuler `session.relay.cancel { qid }`. On reste dans le chat. Les boutons sont désactivés pendant l'aller-retour et quand le daemon est injoignable.
- Textes FR/EN dans `i18n/messages.ts`. L'aide mentionne qu'on peut demander au chat de relayer une instruction.

## 7. Erreurs

| Situation | Effet |
| --- | --- |
| Pas de bloc, ou bloc mal formé | La réponse texte s'affiche, sans carte. |
| Session inconnue, `hook_only` ou quittée au moment de la réponse | Pas de carte ; ligne de log. |
| Session quittée ou retirée pendant l'attente | La carte passe en échec, avec Réessayer (qui échoue tant que la session n'existe plus). |
| L'injection échoue (pane injoignable, vérification ratée) | La carte passe en échec avec le message de `replyTo`. |
| Double clic, deux overlays, relais déjà en file ou envoyé | Le daemon refuse ; la carte affiche l'état que diffuse `chat.history`. |
| Reset, nouveau jour, redémarrage du daemon | La file disparaît avec l'historique ; rien n'est envoyé. |
| Daemon injoignable | Boutons désactivés. |

## 8. Tests

- Protocole : `ChatRelay`, `session.relay`, `session.relay.cancel` se valident ; les anciens messages aussi.
- `extractProposal` / `parseRelayBlock` / `hideProposal` : bloc relais valide, champ manquant, texte vide, blocs mélangés (le dernier gagne), bloc non fermé pendant le streaming.
- `service` : relais valide joint à `chat.done` et au tour ; session inconnue, `hook_only` ou quittée rejetée ; `markRelay` émet `chat.history` ; `sessions.md` marque les sessions en lecture seule.
- `relay.ts` : envoi immédiat sur session libre ; mise en file sur session occupée puis envoi à la libération ; deux relais en file pour une même session partent un par un, le plus ancien d'abord ; annulation ; échec à la sortie et au retrait ; refus d'un second envoi ; échec de `replyTo` reporté sur la carte.
- `server` : `session.reply` inchangé après l'extraction de `replyTo` ; `session.relay` et `session.relay.cancel` câblés.
- Overlay : `RelayCard` dans ses quatre états ; la surface envoie le bon message et reste dans le chat ; `hideProposal` masque un bloc relais en cours.
- Playwright : un tour avec relais vers une session occupée, en attente, puis envoyé quand elle devient libre ; un échec puis Réessayer.
- Vérification manuelle avec les trois harnais (Claude Code, Codex, Cursor Agent) : une demande explicite à une session sûre produit une carte, une demande ambiguë produit une question, une question ordinaire n'en produit jamais.
