# Contrat protocole — « À toi » : les demandes OpenRig à l'humain

Auteur : dev-back@ledge-dev, 2026-11-02. Lot 1 back (`qitem-20261102193637-a9136266`). Branche
`feat/human-channel`. Étude : `docs/vision/ledge-human-channel-study.md` (branche `docs/human-channel-study`).
Maquette : `docs/mockups/ledge-human-operator-ab.html`.

Les schémas zod suivront ce texte dans `packages/protocol/src/openrig.ts`, et `packages/fleet` les routera comme
les autres `openrig.*` : `machineId` est optionnel et vaut `local` par défaut. Une machine absente répond
`offline`, un daemon trop ancien `outdated`. Je fournis aussi le hook `useOpenRigAsks(client, machine)` dans
`packages/fleet/src/openrig.ts`, sur le modèle de `useOpenRig`. Le front n'a donc que l'écran à faire.

Capacité : `DaemonInfo.openrigAsks: true` indique un daemon qui comprend ces messages.

## Ce qu'est une demande

```ts
type HumanAsk = {
  id: string;                 // qitemId OpenRig, ex. "qitem-20261102192556-…"
  kind: 'decision' | 'update' | 'parked';
  //  decision : une demande adressée à l'humain (--human-intent decision) → Décisions / Questions
  //  update   : une nouvelle (--human-intent update) → Nouvelles ; se ferme par « Vu »
  //  parked   : la ligne d'un siège bloquée sur l'humain (state blocked, blockedOn = la personne) → se règle par des mots
  alert: boolean;             // créée avec --alert (urgent : île, notification)
  priority: 'routine' | 'urgent' | 'critical';
  from: {
    seat: string;             // le siège demandeur, "pod-member@rig" (ex. "pilot-lead@ledge-dev") ; pour parked : le propriétaire de la ligne
    rig: string | null;       // "ledge-dev" (la partie après @), null si le siège n'a pas cette forme
    role: string | null;      // "pilot.lead" (pod.member) quand il se déduit du nom
  };
  summary: string;            // le titre de la carte (summary OpenRig, sinon la première ligne du corps)
  body: string;               // le texte complet de la demande (Markdown simple, tel que le siège l'a écrit), limité à 16 000 caractères
  bodyTruncated: boolean;
  detail: string | null;      // complément optionnel (--human-detail-file)
  evidenceRef: string | null; // chemin du fichier à juger (maquette, PROOF.md…), tel qu'écrit par le siège
  questions: Array<{          // vide si la demande n'a pas de boutons : la réponse se fait alors en mots
    id: string;
    question: string;
    options: Array<{ id: string; label: string; recommended: boolean }>;
    answer: string | null;    // l'option déjà choisie (id), ou les mots déjà donnés ; null tant qu'elle attend
  }>;
  createdAt: string;          // ISO
  updatedAt: string;          // ISO, pour le « il y a 4 min »
};
```

## L'état du canal

```ts
type HumanChannel = {
  state: 'ready' | 'no_person' | 'openrig_stopped' | 'not_installed' | 'unreachable';
  //  ready           : OpenRig tourne et une personne est enregistrée : les rigs peuvent t'écrire, et Ledge lit et répond
  //  no_person       : OpenRig tourne, mais aucune personne n'est enregistrée → « Ledge n'est pas encore le canal humain d'OpenRig »
  //  openrig_stopped : daemon OpenRig arrêté → « OpenRig est arrêté : les rigs ne peuvent pas t'écrire »
  //  not_installed   : pas de commande rig sur la machine
  //  unreachable     : le daemon OpenRig tourne mais son API ne répond pas (le message dit pourquoi)
  person: { address: string; name: string } | null;  // "ledge@external", "Ledge"
  slack: boolean;             // Slack est-il encore actif pour cette personne (copie) ? Faux aujourd'hui
  message?: string;           // pour unreachable : la raison, en anglais court
};
```

Le bouton « Brancher Ledge » (état `no_person`) n'est **pas** dans le lot 1 : les commandes de configuration
passent par l'utilisateur. Le front peut afficher la bannière sans le bouton, ou avec un bouton désactivé.

## Messages

### Front → daemon : lire

```ts
{ type: 'openrig.asks', requestId: string, machineId?: string }
```

### Daemon → front : la liste (réponse, et poussée à chaque changement)

```ts
{
  type: 'openrig.asksChanged',
  requestId?: string,         // présent : réponse à openrig.asks ; absent : poussé à tous les fronts
  machineId?: string,         // posé par la flotte
  channel?: HumanChannel,     // absent seulement avec error
  asks: HumanAsk[],           // les demandes ouvertes, la plus récente d'abord ; [] si rien
  truncated?: boolean,        // plus de 200 demandes ouvertes : les 200 plus récentes
  error?: 'offline' | 'outdated'   // posé par la flotte : la machine n'a pas pu répondre
}
```

Le daemon pousse la liste entière, et non un diff : quand une demande arrive, quand une ligne change dans
OpenRig (réponse donnée ailleurs, ligne close), et après chaque `openrig.answer`. Le délai est d'environ une
seconde après l'événement OpenRig. Une demande qui disparaît de la liste est réglée : le front la retire.

### Front → daemon : répondre

```ts
{
  type: 'openrig.answer', requestId: string, machineId?: string,
  qitemId: string,
  answer:
    | { kind: 'choice'; questionId: string; optionId: string }  // un bouton ; une fois par question
    | { kind: 'words'; text: string }                          // « Répondre autrement… » / « Écrire la réponse… » (decision)
    | { kind: 'seen' }                                         // « Vu » sur une nouvelle (update)
    | { kind: 'resolve'; text: string }                        // une ligne parked : la décision en mots
}
```

Règles :
- `choice` et `words` → `decision` ; `seen` → `update` ; `resolve` → `parked`. Un autre couple est refusé
  (`refused`). Pas de « refuser » au lot 1 : le `deny` d'OpenRig ferme la ligne sans rien rendre au siège ; un
  refus se dit en mots (`words`).
- `text` : 1 à 8 000 caractères.
- Avec plusieurs questions, chaque `choice` est enregistré tout de suite (`outcome: 'recorded'`). La réponse
  ne part au siège qu'à la dernière (`outcome: 'answered'`).

### Daemon → front : le résultat

```ts
{
  type: 'openrig.answered', requestId: string, machineId?: string,
  qitemId: string,
  ok: boolean,
  outcome?: 'recorded' | 'answered' | 'already',
  //  recorded : choix enregistré, d'autres questions attendent (remaining)
  //  answered : réponse rendue au siège, qui est réveillé ; la demande est close
  //  already  : déjà répondue (ailleurs ou par un envoi précédent) ; rien de nouveau n'est parti
  remaining?: string[],       // ids des questions qui attendent encore (recorded)
  replyId?: string,           // la ligne-réponse créée vers le siège (answered)
  error?: 'not_found' | 'closed' | 'refused' | 'not_closed' | 'unreachable' | 'openrig_stopped' | 'offline' | 'outdated',
  //  not_found       : la ligne n'existe pas (plus)
  //  closed          : la ligne est déjà close : la retirer, sans Réessayer
  //  refused         : OpenRig refuse cette réponse (mauvais type, texte vide…) ; message dit pourquoi
  //  not_closed      : la réponse est partie mais la ligne a changé entre-temps ; Réessayer est sûr
  //  unreachable     : l'API OpenRig n'a pas répondu → « Pas envoyée : … », Réessayer
  //  openrig_stopped : daemon OpenRig arrêté → « Pas envoyée : OpenRig est arrêté », Réessayer
  //  offline / outdated : posés par la flotte
  message?: string            // la raison lisible (anglais, telle qu'OpenRig la donne), pour « Pas envoyée : {raison} »
}
```

**Réessayer** consiste à renvoyer le même `openrig.answer`. C'est sûr : OpenRig ne crée jamais de deuxième
réponse (`outcome: 'already'`).

## Hors lot 1

- « Ledge décide seul » : un champ optionnel `by: { ledge: true, sources: string[] }` sera ajouté à
  `openrig.answer` au lot B5. Il est compatible avec ce contrat.
- Le délai « Annuler » vit côté daemon au lot B5. Au lot 1, une réponse part tout de suite.
- Plusieurs machines agrégées et le mobile (relais) : lot 3. La flotte route déjà par `machineId`.
- « Brancher Ledge » (la configuration OpenRig) : la décision appartient à l'utilisateur.
