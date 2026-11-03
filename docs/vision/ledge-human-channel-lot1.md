# Lot 1 back — « À toi » : livraison

dev-back@ledge-dev, 2026-11-02. Ligne `qitem-20261102193637-a9136266`. Branche `feat/human-channel` (base `main` 0c47f61b).
Contrat : `docs/vision/ledge-human-channel-contract.md` (transmis à dev-front, ligne `qitem-20261102193858-f0894ef53ea2ee4e`).

## Ce qui est livré

- **Protocole** (`packages/protocol/src/openrig.ts`, `messages.ts`) : `openrig.asks` → `openrig.asksChanged`
  (aussi poussé à chaque changement), `openrig.answer` → `openrig.answered`, plus `HumanAsk`, `HumanChannel` et la
  capacité `DaemonInfo.openrigAsks`.
- **Daemon** (`packages/ledge/src/daemon/openrigHuman.ts`, branché dans `server.ts`) :
  - Lecture : `GET /api/attention` puis `GET /api/queue/<id>` (relu seulement si `tsUpdated` change), réveillée par
    le SSE `GET /api/events` (reprise par `Last-Event-ID`, reconnexion de 2 à 30 s), avec un sondage de sûreté à
    60 s. Le suivi démarre au premier `openrig.asks` d'un front.
  - Réponse : `POST /api/mission-control/action`, avec `answer` (`choice` / `words`), `resolve` (`parked`) ou
    `approve` (`seen`), l'acteur `actorSession` = la personne demandée, `authority: primary-user` et aucun en-tête
    de siège.
- **Flotte** (`packages/fleet/src/fleet.ts`) : `asks` et `answer` sont routés comme les autres `openrig.*`
  (`offline`, et `outdated` limité à ces deux messages). Le hook `useOpenRigAsks` est dans un fichier séparé
  (`packages/fleet/src/openrigAsks.ts`), à la demande de dev-front, qui réécrit `useOpenRig`.

## Test réel (OpenRig 0.7.7, autorisé par l'utilisateur)

Le code du worktree a tourné contre le vrai daemon OpenRig, dans un script local non commité. Le daemon Ledge en
service n'a pas été touché.

| Étape | Résultat |
|---|---|
| Demande `qitem-20261102195049-434b34700d3b124e` (2 questions à boutons) et nouvelle `qitem-20261102195051-bc12629b6043cee5`, créées par dev-back vers `ledge@external` | Poussées par le flux d'événements en moins d'une seconde, avec questions, options, `recommended`, siège, rig et rôle |
| 1er essai de réponse | **Refusé** par OpenRig : sans en-tête de siège, il exige un acteur dans le corps. Rien n'a été enregistré. Corrigé (`a768712b`), avec un test |
| `choice` couleur=bleu | `recorded`, remaining `["taille"]` |
| `choice` taille=m | `answered`, ligne-réponse `qitem-human-answer-6bb09560b87a6adc4357` |
| Renvoi (`words`) | `already`, même ligne-réponse : pas de doublon |
| `seen` sur la nouvelle, puis renvoi | `answered`, puis `closed` |
| **Réveil du siège** | La ligne-réponse est arrivée dans la queue de dev-back et a été **tapée dans son terminal** (19:51Z, « ledge@external answered… », `delivered-ack-pending`). Demande close `done`, avec `humanAnswers` {couleur: bleu, taille: m} |
| Liste après coup | Vide, poussée d'elle-même |
| Demande `--alert` `qitem-20261102195158-08086627106f9c6e` | Après 2 min : constat `undelivered-human-notice` (`qitem-recovery-f4dd6d44ca3fe959`) envoyé au siège demandeur. Voir Slack ci-dessous |

Toutes les lignes de test et les lignes-réponses sont closes. Sur l'état de configuration actuel (`urgent-only`,
seuil `ALERT`), une demande ordinaire et une nouvelle n'ont produit **aucun** constat de non-remise.

## Slack → Ledge : configuration

- **Une liaison « Ledge » n'est pas possible aujourd'hui.** OpenRig 0.7.7 n'accepte que `kind: slack`
  (`HUMAN_CONNECTOR_KINDS = {"slack"}` dans `domain/gateway/human-registry.js`), avec exactement une liaison
  principale par personne. Le binding `slack:ledge-decoy` ne peut donc être ni remplacé ni retiré. Il est inerte :
  le connecteur Slack est désactivé, et ses secrets pointent vers `/tmp/ledge-decoy-slack.env`. **Aucune commande
  à lancer.**
- **Demandes `--alert` :** aucune configuration ne les fait taire. Le seuil de publication est plafonné à
  `ALERT`, et une demande `--alert` est toujours due à Slack. Elle finit donc « jamais postée », et le siège
  demandeur reçoit un constat au bout de 2 minutes. Ledge les montre quand même, avec `alert: true`, et y répond
  normalement. Deux suites possibles, au choix de l'utilisateur :
  1. **Tout de suite, sans OpenRig :** une consigne dans la culture des rigs de l'utilisateur : « vers
     `ledge@external`, ne pas utiliser `--alert` ; une urgence se dit avec `--priority urgent` ». Ledge transmet
     `priority`, donc l'île peut mettre en avant les demandes `urgent`.
  2. **À demander à OpenRig :** une liaison « client local » (par exemple `kind: app`) servie par
     `/api/attention`, avec un accusé de remise posé par le client. Les `--alert` seraient alors remises par Ledge
     plutôt que par Slack.

## Le modèle po-web (lu à la demande du lead)

`po-web/server.mjs` va dans l'autre sens, de l'humain vers un siège : un `rig queue create --source po-web:<login>`
avec un `--id` stable, et les réponses en notes (`rig queue transitions`). Cela ne change rien au lot 1.

C'est le bon modèle pour l'objectif donné à Max (lot 2), avec une amélioration : créer la ligne avec
`--source ledge@external`. Max répond alors par une vraie ligne `--human-intent update|decision` vers
`ledge@external`, qui arrive dans « À toi » par le chemin de ce lot, au lieu d'une note à extraire.

## Vérifications

- `packages/ledge` : `openrig-human.test.ts` (14 tests, dont SSE → poussée, cache, refus, renvois) et
  `server.test.ts` « À toi » (routage, poussée à tous les fronts) sont verts. Suite complète : 2 622 tests passent,
  2 échouent sous charge : `server > launch from the overlay > expands ~…` et `tui-roles > / searches the roles…`.
  Les deux passent seuls (relancés à part), et aucun ne touche au code modifié.
- `packages/fleet` : 256 tests verts (routage « À toi », `useOpenRigAsks`).
- `packages/protocol` : 273 tests verts. `pnpm -r typecheck` est vert sur tous les paquets, desktop, mobile,
  overlay et relay compris.

## Limites connues

- Une seule machine (`local`). Le relais mobile n'est pas traité (lot 3).
- Le nom affiché de la personne vient de `rig gateway human list --json` (CLI, 60 s de cache). Sans lui, c'est la
  partie locale de l'adresse.
- `HumanAsk.from` n'a pas de nom d'agent (« Bix », « Ida ») : seulement le siège, le rig et le rôle. Le front peut
  les croiser avec les sièges de `openrig.state`.
