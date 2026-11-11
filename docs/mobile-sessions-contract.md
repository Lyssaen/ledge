# Contrat : l'onglet Sessions sur le téléphone (refonte mobile M2, lot back B6)

Pour `dev-front`, qui code M2a (liste et fil) et M2b (terminal et Atelier), et « En cours » de M1, sans avoir à demander. Les
schémas zod font foi : `packages/protocol/src/phone.ts` (`PhoneSessionSchema`, messages `session.*`, `term.*`),
`session.ts` (`SessionSchema`, `HelperSchema`, `PendingSchema`) et `decisions.ts` (`offers`, `alwaysScope`).

Maquette validée : `docs/mockups/ledge-mobile-refonte/m2-sessions.html` (branche `design/mobile-refonte-m0-m1`), Q17 à Q27
de `QUESTIONS.md`. « Nouvelle session » (§ 9) a son propre contrat : `docs/mobile-launch-contract.md`. Les rigs et le
kernel (§ 1, § 7) : `docs/mobile-openrig-contract.md`. La pastille MR/PR : `docs/mobile-forge-contract.md`.

Ce lot ajoute trois choses au PC : `doing` (§ 2, calculé à partir de `Session.running`), `closedHow` (§ 5) et `alwaysScope` partagé (§ 4). Tout le reste existait.

## 1. Ce que porte une session (`PhoneSession`)

Le snapshot (`snapshot.sessions`) puis `session.updated` à chaque changement. Ce que la maquette montre, champ par champ :

| Maquette | Champ | Remarque |
|---|---|---|
| Point d'état, filtres « En attente » / « Au travail » (Q18, Q25) | `state`, `pending.kind` | « En attente » : `pending` présent (`waiting_permission` / `waiting_input`) ; « Au travail » : `state === 'working'` |
| Nom, runtime | `name`, `tool` | |
| **Ce qu'elle fait** (liste, « En cours » de M1) | `doing` (nouveau, § 2) | |
| Ce qu'elle attend | `pending.text` | |
| Contexte « 38 % », tablette « 620k / 1M » (Q27) | `context { used, window }` | absent : pas mesuré, ne rien montrer |
| Branche courte | `branch` (`repo`, `worktree`) | absents hors dépôt git |
| Pied sans Git : le dossier (Q23) | `project` | nom du dossier où la session a démarré (`basename(cwd)`), pas un worktree où elle serait entrée ensuite |
| Groupe par projet | `projectId` | avec `daemon.atelier` ; absent : « Sans projet » |
| Groupe par rig, rôle du siège (§ 1, § 7) | `rig { name, role? }` | avec `daemon.atelier` |
| « terminée à 14:02 » | `exitedAt` | |
| « Fermée de force » | `closedHow` (nouveau, § 5) | |
| Démarrée hors de Ledge (Q23) | `readOnly: true` | ni Fermer, ni Reprendre, composer remplacé par « Réponds dans le terminal » |
| Modèle et effort du pied | `model`, `effort`, `modelNext`, `canSwitch` | |
| Plan de travail « 2 / 4 » | `checklist` | avec `daemon.checklist` ; le détail par `session.checklist` |
| Sous-agents « +2 » | `helpers` | § 3 |
| Limite de l'outil « Claude 5 h 84 % » (Q27) | message `usage.state` | avec `daemon.usage`, par outil, pas par session |
| Pastille MR/PR « #226 » | `forge.state`, `pr.sessions` | contrat forge ; pas de pastille : pas de demande, rien à dire (Q23) |

Une session d'un siège OpenRig (`rig`) ne se ferme, ne se tue, ne se reprend ni ne change de modèle depuis Ledge : c'est
OpenRig qui la gouverne. Le PC refuse ces actions ; le téléphone ne les propose pas.

## 2. `doing` : ce que l'agent fait en ce moment (nouveau)

```
doing?: { tool: string, label: string, since: datetime }
```

- **D'où :** l'outil que l'agent lui-même vient de lancer, tel que son harnais l'annonce : le hook PreToolUse de Claude Code,
  de Codex et de Cursor Agent, l'événement d'outil d'OMP. `tool` est le nom de l'outil (`Bash`, `Read`, `Edit`, `shell`…),
  `label` sa ligne : la commande (« pnpm --filter desktop test »), le fichier, la description d'OMP (`intent`). `since` : quand
  il a commencé.
- **Une ligne :** la première ligne non vide, espaces réduits, coupée à `DOING_LABEL_MAX` (120) avec « … ». Sans libellé :
  le nom de l'outil.
- **Plusieurs outils à la fois :** le PC suit chaque appel en cours (`Session.running`, interne au PC) ; `doing` est le plus
  récent encore en cours. Quand il finit, `doing` redevient le précédent s'il tourne encore. Chaque fin retire son propre
  appel (par identifiant d'appel, sinon le plus ancien de cet outil) : des appels parallèles, même du même outil, finissent
  dans n'importe quel ordre.
- **Présent seulement** quand `state === 'working'` et sans `pending`. **Absent** entre deux outils (l'agent réfléchit ou
  écrit), au repos, sur une erreur, après un nouveau message, une fois terminée. Un sous-agent ne compte pas.
- **Une demande le cache sans l'oublier :** pendant une autorisation, `doing` est absent (la ligne dit la demande). Accordée
  depuis Ledge, l'outil tourne : `doing` revient sur lui jusqu'à sa fin. Refusée depuis Ledge, l'outil ne tourne pas : son
  appel est retiré.
  Refusée dans le terminal du PC : Ledge ne le sait que si le harnais signale l'échec de l'outil ; sinon l'appel reste
  jusqu'à la fin du tour (non vérifié pour chaque harnais).
- Une question (`AskUserQuestion`) ou un plan (`ExitPlanMode`) n'est pas un `doing` : c'est une demande (`pending`).
- **Repli :** absent, la ligne dit l'état (« au travail · 38 % »), comme aujourd'hui. Un PC plus ancien n'envoie jamais
  `doing` : même repli, pas de drapeau.
- **Les mots :** `label` est le texte de l'agent, pas celui de Ledge. Ce que la liste en montre (préfixe, icône d'outil,
  « Lit la file » de la maquette) est à `design-ux`.
- Un téléphone plus ancien ignore ce champ : `PhoneSessionSchema` n'est pas strict, il le retire sans jeter la session.

## 3. Les sous-agents « +2 » (Q21)

`helpers: [{ id, kind, task, state, finishedAt? }]` sur chaque session. Détail : `docs/mobile-launch-contract.md` § 10.

- `task` : ce que le parent lui a demandé ; `kind` : le type d'agent (`Explore`, `Review`…) ou `subagent`.
- `state` : `working`, puis `exited` avec `finishedAt`. Un sous-agent fini **disparaît après 5 minutes**. Pour « +2 » : compter
  `helpers` (actifs et finis récents) ou filtrer `state !== 'exited'` pour les seuls actifs ; c'est un choix de `design-ux`.
- Dans le fil du parent, l'élément `helper` (`{ task, agentType?, state }`) marque où il a été lancé (« 2 sous-agents lancés »,
  appui sur une ligne dépliée : ouvrir le fil du parent à cet endroit).
- Une demande venue d'un sous-agent porte `pending.helperId`.
- Codex n'en annonce aucun : jamais de « +2 » pour lui.

## 4. Le fil, et « Toujours dans ce projet » (Q19)

- **Fil :** `session.thread { id }` → `{ items, cut, more }`, puis `session.thread.item` en direct. `more: true` : « Messages plus
  anciens sur le PC » en tête. Outils : éléments `tool` (`status: running` en bleu, `success`, `failed`).
- **Actions :** `session.decide`, `session.reply`, `session.answer` (OMP), `session.interrupt`, `session.close` (passkey `close`),
  `session.resume` (passkey `act`), `session.model`, `session.broadcast` (« Écrire au groupe »), `session.commands` (« / »).

**« Toujours » :**
- Le proposer seulement si `offers(session.tool, pending.kind, 'always')` (de `@ledge/protocol`) : Claude Code pour une
  permission, une modification ou un plan ; Codex pour une permission ou une modification ; jamais Cursor Agent ni OMP.
- L'envoyer : `session.decide { decision: 'always', expect, assertion? }`. Comme « Autoriser », une demande à risque haut veut
  la passkey (`confirm.prepare`). Hors offre, le PC refuse (`not_offered`).
- **Ce qu'il accorde dépend de la demande :** `alwaysScope(session.tool, pending)` (de `@ledge/protocol`, la même fonction que
  Desktop) rend :

| Portée | Quand | Ce qui se passe | Desktop dit |
|---|---|---|---|
| `project` | Claude Code, une commande ou un autre outil | la règle va dans les réglages du projet, pour ses prochaines sessions aussi | « Toujours autoriser dans ce projet » |
| `edits` | Claude Code, une modification de fichier | acceptation automatique des modifications pour toute la session | « Toujours autoriser pour cette session » |
| `plan` | Claude Code, un plan | mode auto (ou acceptation des modifications avant la 2.1) | « Approuver en mode automatique » |
| `session` | Codex | plus de demande pour cette commande ou ces fichiers jusqu'à la fin de la session | « Toujours autoriser pour cette session » |

« Toujours dans ce projet » de la maquette n'est juste que pour `project`. Les textes des trois autres portées sont à
`design-ux` (Desktop : `session.pending.always`, `alwaysProject`, `approveAuto`, `alwaysScope.*` de `fr.ts`).

## 5. Session terminée, et « Fermée de force » (Q23)

- Terminée : `state === 'exited'`, `exitedAt`. « Reprendre » : `session.resume` avec la passkey (but `act`), refusé pour
  `readOnly` et un siège `rig`.
- **`closedHow: 'killed'` (nouveau) :** la fermeture de Ledge (`session.close`, depuis le téléphone, Desktop ou le chat) a dû
  tuer le terminal parce que l'agent ne partait pas sur sa commande de sortie. Gardé sur la session : le téléphone peut dire
  « Fermée de force » même quand la fermeture vient d'ailleurs. Absent pour toute autre fin : l'agent est sorti de lui-même ou
  sur la commande de sortie, ou il a été tué directement (`session.kill`, sans tentative de sortie propre). Retiré dès que la session repart (« Reprendre »).
- Sur l'appareil qui a fermé, le résultat de `session.close` (`operation.result`, `how: 'killed'`) le dit aussi, tout de suite.
- Un PC plus ancien n'envoie jamais `closedHow` : « Fermée de force » n'apparaît alors que sur l'appareil qui a fermé.

## 6. Le terminal (Q17, Q26)

`term.open` / `term.opened`, `term.output`, `term.resync`, `term.size`, `term.close`, `term.exit` ; « Prendre la main » :
`term.hold` (passkey `terminal`) → `term.held`, « Rendre la main » : `term.release` → `term.released` ; « Ligne » et touches :
`term.input`. Drapeaux `daemon.terminal` et `daemon.terminalInput` (saisie désactivée sur le PC : `inputOff`). Les touches
contextuelles (« 1 Oui », « 2 Toujours », « 3 Non ») viennent de l'écran et de `pending.options` : rien du PC en plus.

## 7. L'Atelier sur téléphone, l'appui long (Q22)

Îlots par projet (`projects` + `projectId`) ou par rig (`rig.name`), sous-agents en pointillés (`helpers`). L'appui long
ouvre les actions de § 4. « Redémarrer le siège » est retiré de M2 (décision de l'utilisateur du 2026-11-11) ; piste notée
dans `docs/mobile-openrig-contract.md` § 9.

## 8. Vérifié, et non vérifié

- Vérifié par les tests (Node 24) : appels suivis un par un (fins hors ordre, même outil en parallèle, avec et sans
  identifiant), demande accordée puis fin de l'outil, demande refusée, fin du tour, sous-agent ignoré, libellé coupé
  (`packages/ledge/test/state.test.ts`) ; `doing` et `closedHow` dans la
  projection du téléphone, ignorés par un schéma plus ancien (`mobile-project.test.ts`) ; `closedHow` posé par une fermeture
  forcée, absent d'une fermeture propre, retiré à la reprise (`server.test.ts`) ; `alwaysScope` (`protocol/test/decisions.test.ts`).
- Non vérifié : un vrai téléphone ; les sièges OpenRig (ils n'envoient `doing` que si les hooks de Ledge sont installés
  dans leur harnais) ; le libellé exact que Codex et Cursor Agent donnent à chaque outil.
