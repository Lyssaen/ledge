# Fermer des sessions depuis le chat Ledge — design

Date : 2026-10-21 · Projet personnel, hors story Jira · Auteur : Guillaume Charlier avec Claude Code (Otto)

Issue d'origine : [#75](https://github.com/Lyssaen/ledge/issues/75) « Fermer une session Ledge depuis un agent (ledge close) », recadrée par l'utilisateur. S'appuie sur la [spec du relais depuis le chat](2026-10-12-relay-from-chat-design.md) et sur celle [du lancement depuis le chat](2026-10-12-launch-from-chat-design.md) (le bloc, la carte, la confirmation par clic, les lignes multiples du #24).

## 1. Objectif

Le 2026-10-21, une session coordinatrice (Bix) a arrêté cinq sessions puis l'utilisateur a dû taper `/exit` à la main dans chacun des cinq terminaux : rien dans Ledge ne ferme proprement une session. L'utilisateur veut que **Ledge**, dans « Demandez à Ledge », puisse le faire : « ferme Arlo, Bram et Mira », « clos les sessions de software-factory ». Ledge identifie les sessions, propose une carte « Fermer **Arlo**, **Bram**, **Mira** · [Fermer tout] », et la fermeture se fait au clic.

Décision de l'utilisateur : **ce n'est pas une session qui en ferme une autre, c'est Ledge.** Pas de commande `ledge close` pour les agents.

Succès :

- Une demande explicite dont les sessions sont sûres produit, sous la réponse, une carte de fermeture avec une ligne par session (8 au plus).
- Une demande dont une session n'est pas sûre (plusieurs candidats, aucun, en lecture seule, déjà terminée) produit une question ou une explication pour celle-là, jamais une ligne devinée.
- Le clic ferme proprement : l'agent sort comme s'il avait reçu `/exit`, sa conversation reste reprenable (`session.resume`). Ce n'est qu'en dernier recours, si l'agent ne sort pas, que sa session tmux est tuée.
- Après fermeture, la session est `exited` dans `ledge who`, `ledge status`, le Desktop et l'overlay, sans être archivée.
- Une ligne ne ferme qu'une fois, même après un double clic, une reconnexion ou depuis un second front.
- Le chat lui-même ne ferme rien : il propose, le clic de l'utilisateur ferme.

## 2. Périmètre

Deux lots, livrés l'un après l'autre :

- **Lot 1** : protocole, daemon (fermeture propre + carte), persona, interface partagée (Desktop et overlay), fleet multi-machines.
- **Lot 2** : le mobile (PWA) : projection de la carte, opération téléphone avec passkey, interface.

Entre les deux lots, le téléphone ne montre pas la carte de fermeture (sa projection des tours est explicite, le champ nouveau n'y passe pas) et rien n'y casse.

Hors périmètre :

- **Une commande `ledge close` pour les agents** (la demande initiale de #75) : refusée par l'utilisateur.
- **Demander et attendre le point de reprise avant de fermer.** Pour qu'il soit automatique, Ledge devrait recevoir les réponses des sessions, ce qui relève d'un chantier séparé (« Ledge participe au protocole de messages entre sessions »). En attendant, l'utilisateur demande le point de reprise par le relais existant, puis demande la fermeture.
- Changer le bouton « Terminer » du Desktop (`session.kill`) pour une fermeture propre : possible ensuite, l'action du daemon le permettra, mais pas dans ce chantier.
- Conserver l'état des cartes après un redémarrage du daemon, un `chat.reset` ou un nouveau jour (comme les autres cartes).
- Fermer des sessions `hook_only` (Ledge n'a pas de terminal pour elles).

Anti-objectifs :

- Une fermeture qui tape du texte dans un dialogue de permission ou de question, ou qui y donne une réponse autre qu'un refus inscrit dans le fil (voir §3, étape 3).
- Une session archivée ou supprimée par une fermeture : elle doit rester visible et reprenable.
- Une ligne de carte devinée par le chat.

## 3. La fermeture propre, dans le daemon (lot 1)

Une fonction interne `closeSession(s): Promise<{ how: 'exit' | 'killed' }>` (rejette avec une `Refusal`), dans `daemon/server.ts`, à côté de `endSession`.

1. **Refus** : session inconnue (`unknown_session`), `hook_only` (`read_only`), déjà `exited` (« la session est déjà terminée »), une fermeture déjà en cours pour cette session (`busy`).
   Dès ce point, la session est **en fermeture** (un ensemble `closing` du daemon) : le relais (`relay.ts`) et le mailbox (`mailbox.ts`) ne lui délivrent plus rien, même quand elle redevient libre ; leurs files échouent ensuite à l'état `exited` comme aujourd'hui (mon choix : sinon une instruction en file partirait dans la fenêtre entre l'interruption et la sortie).
2. **OMP** (`backendOf(s) === 'omp-rpc'`) : `omp.close`, puis `PaneGone`, comme `endSession` aujourd'hui. `how: 'exit'`.
3. **Libérer l'invite** : si la session travaille (`working`, `starting`) ou porte une demande (`pending`, permission ou question), le daemon envoie les touches d'interruption de l'adaptateur (`interruptKeys` : Échap pour Claude et Codex, Ctrl-C pour Cursor), puis attend que la session soit libre (`idle` ou `error`, sans `pending`, la même définition que `relay.ts`) au plus **10 s** (mon choix). Pour Claude et Codex, Échap sur une demande ouverte **la refuse** : décision de l'utilisateur, fermer une session qui attend sa validation refuse cette demande, et le refus est inscrit dans le fil (un `Decided` avec `deny`, libellé « refusée par la fermeture »). Une demande d'un sous-agent (`helperId`), que `PaneIdle` ne lève pas, mène au repli de l'étape 6 : acceptable. Cette étape est indispensable : Codex, par exemple, ouvre un dialogue « Choose what happens to the current task » si on tape `/exit` pendant une tâche.
4. **Taper la commande de sortie** dans le terminal, jamais par `ledge send` ni le mailbox (qui enveloppe le texte dans `<ledge-message>`). Pas par `replyTo` / `injectAndVerify` non plus : leur vérification échoue quand le pane disparaît (une capture nulle n'est jamais « partie », `runPlan` lève `not_taken`, `InjectFailed` passerait la session en `error`). Un chemin dédié, sans vérification : effacer la ligne d'invite (un brouillon laissé dans la boîte serait sinon envoyé avec la commande ; il serait perdu à la fermeture de toute façon), taper la commande, valider, avec les délais propres à l'adaptateur (`replyPlan` sert de modèle). Le succès se juge à l'étape 5, pas ici. Chaque adaptateur gagne `exitText(): string` : `/exit` pour Claude Code ; pour Codex et Cursor Agent, la commande vérifiée sur le vrai CLI par le constructeur (`/exit` ou `/quit`). Si l'invite n'est pas libérée au bout des 10 s, cette étape est sautée.
5. **Attendre la sortie** : la fin du processus ferme la session tmux (`remain-on-exit off`) et le poller applique `PaneGone`. Le daemon attend l'état `exited` au plus **15 s** (mon choix) après la commande.
6. **Repli** : à défaut, `tmux.killSession` puis `PaneGone`, `how: 'killed'`, avec une ligne de log qui dit pourquoi.

L'état `exited` déclenche ce qui existe déjà : les relais en file pour la session passent en échec (`relay.ts`), les messages d'agents en file sont signalés comme non délivrables (`mailbox.ts`).

Les deux délais sont des options du serveur (comme `opts.verify`) pour que les tests ne patientent pas.

## 4. Le bloc de fermeture et le chat (lot 1)

### 4.1 Le bloc

Le harnais termine sa réponse par un bloc `ledge-close` **par session**, 8 au plus, comme `ledge-session` (#24) :

````
```ledge-close
{"session": "a1b2c3"}
```
````

- `session` : obligatoire, l'`id` de la session tel que `sessions.md` le donne.

Une réponse porte une seule carte, celle du **dernier** bloc, toutes langues confondues (règle existante). Les blocs `ledge-close` d'une réponse dont le dernier bloc est `ledge-close` forment ses lignes, dans l'ordre ; les blocs d'une autre langue sont retirés du texte et ignorés.

### 4.2 Protocole (`packages/protocol`)

- `proposal.ts` : `BlockKind` gagne `'close'` ; `FENCES` et `BLOCK` reconnaissent `ledge-close` ; `CloseBlockSchema = z.object({ session: z.string().trim().min(1) })` et `parseCloseBlock(raw)` ; `hideProposal` masque une clôture en cours de frappe.
- `chat.ts` : `ChatCloseSchema = { id, name, tool, closedAt?: datetime, how?: 'exit' | 'killed', error?: string }` ; `ChatClosesSchema = z.array(ChatCloseSchema).min(1).max(MAX_PROPOSALS)` ; `ChatTurnSchema` gagne `closes?`.
- `messages.ts` : `chat.done` gagne `closes?` ; nouveau message client `session.close { qid, rows? }`, `rows` validé comme celui de `session.launch` (entiers 0..7, uniques, 1 à 8). Nouveau message serveur `session.closed { qid, row, id, how }` (le pendant de `session.launched`), envoyé au demandeur pour chaque ligne fermée.

### 4.3 Service du chat (`chat/service.ts`)

- En fin de tour réussi, quand le dernier bloc est `close` : chaque bloc valide est résolu dans le store (`deps.store.get`, comme `relayFrom`). Une session inconnue, `hook_only` ou `exited`, ou un doublon d'une ligne déjà retenue, ne donne pas de ligne (ligne de log, comme `relayFrom`). Au-delà de 8 lignes, l'excédent est journalisé et ignoré. Sans aucune ligne valide, pas de carte. Les champs `id`, `name`, `tool` viennent du store, jamais du bloc.
- `Chat` gagne `close(qid, row)` (la ligne, si le tour est encore dans l'historique) et `markClosed(qid, row, how, emit)` / `markCloseFailed(qid, row, message, emit)`, qui émettent tout `chat.history` comme `markLaunched`.

### 4.4 Persona (`chat/claude.ts`)

Ajout à `PERSONA` (partagée par Codex, Cursor et OMP), dans le même registre que la règle du relais :

> Quand l'utilisateur demande explicitement de fermer, clore, arrêter ou quitter une ou plusieurs sessions, réponds en une ou deux lignes puis termine par un bloc ```ledge-close contenant {"session": "<id>"} par session, 8 au plus, et seulement pour les sessions de sessions.md qui correspondent sans ambiguïté, qui ne sont pas en lecture seule et pas déjà terminées. Pour chacune des autres, cite les candidats et demande laquelle, ou dis pourquoi elle ne peut pas être fermée. La fermeture est propre et la conversation reste reprenable. Si l'utilisateur veut d'abord un point de reprise, propose seulement le relais de cette demande et dis-lui de demander la fermeture une fois les réponses arrivées.

« Tu n'envoies jamais rien toi-même à une session » reste vrai.

### 4.5 Serveur (`daemon/server.ts`, nouveau `chat/close.ts`)

- `closeFromChat(deps, qid, rows = all)`, calqué sur `launchFromChat` : passe les lignes déjà fermées ou en cours (`inFlight` partagé, clé `qid#row`), refuse (`CloseRefused`) quand aucune ligne ne peut partir. Différence voulue : les lignes ferment **en parallèle** (mon choix : jusqu'à 25 s chacune, 8 à la suite feraient attendre plus de 3 minutes). Chaque ligne aboutie : `markClosed` et `session.closed` ; chaque échec : `markCloseFailed` avec la raison.
- `session.close { qid, rows? }` résout le fil propriétaire du tour (`threads.owner(qid)`, comme le relais), appelle `closeFromChat` avec `closeSession`. Une `CloseRefused` part au demandeur en `error`.

### 4.6 Interface partagée (`packages/ui/src/chat`, Desktop, overlay)

- `CloseGroupCard`, sur le modèle de `LaunchGroupCard` : une ligne par session (prénom en gras, outil, état actuel lu dans les sessions du front), un bouton « Fermer » par ligne et « Fermer tout » quand il en reste plusieurs. États par ligne : proposée, en cours (« Fermeture… »), fermée (« Fermée » ; « Fermée de force » quand `how === 'killed'`), échec (la raison, et « Réessayer »). Une session déjà `exited` d'elle-même entre-temps s'affiche « Terminée » sans bouton.
- Pas de dialogue de confirmation en plus : le clic sur la carte est la confirmation (mon choix ; la session reste reprenable).
- `ChatView` place la carte dans la chaîne existante (relais, groupe, lancement simple). Desktop (`useChatCards`, `ChatPanel`) et overlay (`Surface`) envoient `session.close` et libèrent la carte comme pour le lancement.
- Textes fr et en (`apps/desktop/src/i18n`, `apps/overlay/src/i18n/messages.ts`, `copy.tsx` de `packages/ui`).

### 4.7 Fleet (`packages/fleet`)

Le chat commun multi-machines doit transmettre la carte sans la perdre :

- `session.close` rejoint `OPERATIONS` (fleet.ts:11) et l'enregistrement des opérations en cours (fleet.ts:362). Comme les lignes ferment en parallèle et qu'`operations` tient une entrée par machine (fleet.ts:44), l'opération se termine quand toutes les lignes demandées sont réglées (`closedAt` ou `error`) dans `chat.history`, ou sur `error`, et non au premier changement.
- `mappedTurn` qualifie les `closes[].id` par machine, comme `relay.id` ; `session.closed` est qualifié et relayé comme `session.launched` (fleet.ts:194).
- Un chat tourne sur un seul daemon : une demande qui vise des sessions de plusieurs machines passe par le routeur, qui demande déjà une clarification pour un projet présent sur plusieurs machines (`routing.ts`). Pas de carte multi-machines.
- Les copies explicites des champs de `chat.done` (fleet.ts:230, store.ts:56) incluent `closes`.

### 4.8 Documentation

README racine (description des cartes, table du protocole : `session.close`, `session.closed`), `packages/ledge/README.md` section « Ask Ledge (chat) ». Un commentaire sur l'issue #75 dit le recadrage et pointe vers cette spec.

## 5. Le mobile (lot 2)

- **Projection** (`packages/ledge/src/mobile/chat.ts`, `toPhoneTurn`) : `closes` passe au téléphone sous `PhoneChatCloseSchema` strict (`id`, `name`, `tool`, `how?`, `failed?: true` à la place du texte d'erreur, comme les autres cartes) ; `PhoneChatTurnSchema` gagne `closes?`.
- **Opération** (`protocol/phone.ts`) : `chat.close { op, qid, rows?, assertion? }` ; `ConfirmPurposeSchema` gagne `'close'` : une fermeture depuis le téléphone exige une assertion passkey liée au `qid`, comme `chat.launch`.
- **Passerelle** (`mobile/gateway.ts`) : `chatClose` sur le modèle de `chatLaunch` (lignes validées, tour du téléphone, `confirm_required` sans passkey, toutes lignes déjà faites → échec, assertion vérifiée), puis `closeFromChat` sur le fil de l'appareil. `chat.close` est exclu de `SessionOperation` et rejoint le cas particulier des appareils approuvés (gateway.ts:470) si `chat.launch` y est.
- **Application** (`apps/mobile`) : `CloseCards` dans `TurnView` (une ligne par session, « Fermer » / « Fermer tout »), action `close` du store avec la préparation et la signature passkey (purpose `'close'`), `chat.close` dans `isVolatile` (jamais rejouée après un rechargement), textes en français dans `copy.ts`.
- Tests : projection, schémas stricts, passerelle (assertion requise, refus), écran, e2e du chat mobile.

## 6. Tests (lot 1)

- Protocole : extraction et masquage du bloc `ledge-close`, plusieurs blocs, blocs de langues mêlées (le dernier décide), schémas de `session.close` (`rows`) et de `chat.done`.
- Service du chat : lignes retenues, sessions inconnues / `hook_only` / `exited` / doublons écartées, plafond de 8, `markClosed` / `markCloseFailed`.
- `closeSession` : session libre (commande tapée, `PaneGone`, `how: 'exit'`) ; session qui travaille (interruption puis commande) ; demande de permission ouverte (interruption, jamais de texte tapé dans le dialogue) ; agent qui ne sort pas (repli `killSession`, `how: 'killed'`) ; invite jamais libérée (pas de commande tapée, repli) ; OMP ; refus `hook_only`, `exited`, fermeture déjà en cours.
- `closeFromChat` : lignes en parallèle, double clic, ligne déjà fermée, refus quand rien ne peut partir.
- Serveur : `session.close` de bout en bout avec un tmux factice, `session.closed` au demandeur, `chat.history` à tous.
- Persona : contient la langue `ledge-close` (test existant de la persona).
- Adaptateurs : `exitText` de chacun.
- Fleet : opération en cours, ids qualifiés, champ `closes` recopié.
- UI : `CloseGroupCard` (états, « Fermer tout », réessai), câblage Desktop et overlay ; un e2e overlay sur le modèle de `relay-from-chat.spec.ts`.
- Téléphone : la projection d'un tour qui porte `closes` reste valide (le champ n'y passe pas au lot 1).

## 7. Laissé au constructeur

- La commande de sortie exacte de Codex et de Cursor Agent, à vérifier sur le vrai CLI (captures d'écran de pane si besoin) ; si l'une n'a pas de commande fiable, le repli `killSession` après le délai reste correct.
- Le balisage et le CSS de `CloseGroupCard`, dans l'allure de `LaunchGroupCard` et `RelayCard`.
- La façon d'attendre un état dans `closeSession` (abonnement `store.onChange` ou boucle courte), tant que les délais sont des options.
- Les fixtures de test exactes.
