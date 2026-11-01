# Équipes : deux moteurs (Ledge ou OpenRig), une seule interface

Date : 2026-11-01. Point de départ : la branche `ledge-open-rig` (commit `f3f83925`).

Les décisions de Guillaume sont marquées **[G]**. Les choix faits pendant la rédaction, que le constructeur peut revoir, sont marqués **[R]**.

## 1. Intention

La branche `ledge-open-rig` a retiré les équipes de Ledge (lot 1, `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` §7) pour confier les équipes à OpenRig. Le constat de départ est partagé : les équipes Ledge étaient lentes et avançaient mal.

Guillaume préfère faire évoluer les équipes Ledge jusqu'à ce qu'elles soient vraiment efficaces, et garder OpenRig comme une option à côté. **[G]**

**Pourquoi.** Il veut garder la main sur le moteur des équipes. OpenRig est un outil externe, jeune et qui change vite :
- version 0.6.14 ;
- 113 migrations de base ;
- beaucoup d'options marquées « dépréciée, ignorée » ;
- pas de changelog.

S'il est le seul moteur, chaque changement de son côté oblige à reprendre Ledge. Avec un moteur Ledge à nous, OpenRig devient un plus, pas un point de rupture.

## 2. Objectifs

1. **Remettre les équipes Ledge** sur la branche `ledge-open-rig`, sans casser l'intégration OpenRig. **[G]**
2. **Le lead reçoit l'objectif.** Au lancement d'une équipe, l'objectif part tout de suite au lead sous forme de tâche, et le lead se met au travail. Le lead est désigné dans le modèle d'équipe, et il y en a exactement un par équipe. **[G]**
3. **Les résultats remontent au lead.** Un siège qui termine une tâche rend son résultat à celui qui la lui a donnée, en général le lead, qui enchaîne. L'utilisateur reçoit le résultat final de l'objectif, et les vraies questions passent par le cerveau (point 6). **[G]**
4. **Broadcast.** Le lead et l'utilisateur peuvent écrire à toute l'équipe d'un coup. **[G]**
5. **Un choix de moteur unique** dans les réglages, « Ledge » ou « OpenRig », qui s'applique à toutes les équipes. On ne peut pas changer de moteur tant qu'une équipe tourne. **[G]**
6. **Même interface pour les deux moteurs** : celle de la branche de Joffrey (onglet Rigs, salles de rig dans les Bureaux, escalades, cerveau), rebaptisée « Équipes ». **[G]**
   - Les équipes Ledge s'y affichent comme les rigs.
   - Les questions du lead passent par le cerveau, comme pour OpenRig. **[G]**
7. **La salle technique devient la salle du moteur d'équipes**, et n'est plus liée à OpenRig seul. **[G]** Elle montre une baie par machine où tourne le moteur choisi, avec une LED d'état.

## 3. Non-objectifs (deuxième étape) **[G]**

- La priorité des messages.
- Des rôles plus paramétrables (skills, MCP, permissions, etc.).
- Une file de tâches plus riche (priorités, dépendances, délais, relances graduées).

L'audit du 2026-11-01 (§8) liste ce qu'OpenRig fait sur ces points. C'est une source d'idées pour la deuxième étape, pas un modèle à copier.

## 4. Anti-objectifs (échec, même si « ça marche »)

- **Une interface calquée sur OpenRig** : ses mots, ses identifiants ou sa forme de données imposés à tous les écrans. La dépendance reviendrait par l'interface. Si OpenRig change, seul son branchement doit être à refaire.
- **Casser ou appauvrir l'intégration OpenRig existante** : pont, cerveau, escalades, Bureaux, lots 0 à 10.
- **Faire repasser les résultats par l'utilisateur** entre chaque étape. C'est la principale cause de lenteur aujourd'hui.
- **Faire dépendre le moteur Ledge d'OpenRig**, de son daemon ou de son CLI.

## 5. Contraintes

- **Partir de `ledge-open-rig`**, pas de `main`. **[G]**
- **On ne modifie pas la branche de Joffrey.** **[G]**
  - Le travail vit sur sa propre branche, `feat/teams-two-engines`, tirée de `ledge-open-rig`.
  - Joffrey continue de commiter sur `ledge-open-rig`, notamment pour ajouter les interfaces qui lui manquent. Notre branche doit donc reprendre ses commits régulièrement, et rester facile à fusionner.
- **[R]** Conséquence : pas de renommage en profondeur du code « rig » (types du protocole, `apps/desktop/src/rigs/*`, `useRigs`, écrans rigs du TUI et du téléphone).
  - Seuls les textes visibles deviennent « Équipes ».
  - La couche commune (§6.1) s'ajoute à côté du code de Joffrey plutôt que de le réécrire.
- **Récupérer ce que `main` a ajouté aux équipes depuis la séparation** (base commune `8525ad21`, PR #135) : correctifs #140 à #151 et la 0.30 (réponses aux décisions des agents). Le reste de `main` (0.31, 0.32) arrive avec le même merge.
- **Le lot 1 forme un bloc isolé** : commits `770d2b1c` à `9bf23099`, fusionnés par `1196dfe0` (parents `c4d1672f`, `6630e41d`). Tout le travail OpenRig vient après.
- **On garde `ledge ask`** (`770d2b1c`). **[R]** Il sert aux sessions seules, et le cerveau le traite déjà comme une escalade (`source: 'ask'`).
- **Changement de moteur bloqué** dès qu'au moins une équipe tourne, quel que soit le moteur. **[G]** Le réglage dit pourquoi il est grisé.

## 6. Ce qui est décidé du « comment »

### 6.1 Une couche « équipes » commune

L'interface ne lit plus OpenRig directement. Elle lit une forme commune (équipe, sièges, échanges, escalades, état du moteur par machine), que chaque moteur alimente.

Le protocole de la branche a déjà presque cette forme : `RigSchema`, `RigSeatSchema`, `ExchangeSchema`, `EscalationSchema`, `OpenRigStatusSchema` dans `packages/protocol/src/openrig.ts`.

**[R]** Les points suivants sont au choix du constructeur, tant que l'anti-objectif « interface calquée sur OpenRig » est respecté :
- généraliser ces schémas (par exemple `TeamSchema` et un état « moteur ») plutôt qu'en créer d'autres ;
- garder ou renommer les noms de messages sur le fil ;
- traiter les champs propres à OpenRig, comme `ref` = « dev-build@starter », comme une donnée de moteur.

Côté daemon, le pont OpenRig (`packages/ledge/src/daemon/openrig/bridge.ts`, interface `Bridge`) devient l'un des deux moteurs. Le moteur Ledge, construit sur les équipes remises en place, implémente le même contrat.

### 6.2 Moteur Ledge

On le construit sur ce que le lot 1 a retiré (`daemon/{teams,teamsLive,tasks,roles,seat,definitions}.ts` et les cas `team.*` / `task.cmd` de `server.ts`), plus les ajouts de `main`.

**Lead.**
- Le modèle d'équipe désigne le lead. Le rôle `leader` existe déjà sur `main` (`daemon/actions.ts:185`, `LEADER_ROLE`) avec des droits en plus. **[R]** On s'appuie sur lui.
- Le modèle doit avoir exactement un lead pour être valide. **[G]**

**Lancement avec objectif.**
- Lancer une équipe demande un objectif : quoi, dans quel dépôt, sur quelle branche, et à quoi on reconnaît que c'est fini.
- L'objectif devient une tâche donnée au lead dès le lancement, avec une consigne de départ. Aujourd'hui, `server.ts` lance les sièges sans premier prompt : c'est ce qu'on corrige.
- Le lead découpe le travail et donne des tâches aux autres sièges.

**Résultats.**
- Une tâche terminée rend son résultat à celui qui l'a donnée. Le donneur est réveillé avec le résultat, comme pour un message.
- La tâche « objectif » donnée au lead rend son résultat à l'utilisateur. Ce résultat apparaît dans « À toi » et dans le fil de l'équipe.

**Questions.**
- Une question que le lead ne peut pas trancher devient une escalade. Le cerveau la traite selon le mandat, comme une escalade OpenRig, et ne la remonte à l'utilisateur que si elle sort du mandat. **[G]**
- **[R]** Au choix du constructeur : l'outil que le lead utilise pour la poser, `ledge ask` ou `ledge task give ledge`.

**Broadcast.**
- Une commande pour le lead (par exemple `ledge send @team "…"`) et un champ dans l'interface pour l'utilisateur.
- Chaque siège le reçoit comme un message normal, à la fin de son tour, sans passer devant les autres. **[R]** C'est cohérent avec « pas de priorité dans cette étape ».

**Qui pose les questions.** **[R]**
- Seul le lead escalade.
- Un siège qui n'est pas le lead pose ses questions au lead.
- Le chemin 0.30 de `main` (`ledge task give ledge` → `task.answer`, cartes de décision) ne reste pas un second canal à côté du cerveau. Une question à Ledge devient une escalade, et passe donc par le mandat.

**Messages Claude ↔ Claude.** **[R]**
- Dans une équipe du moteur Ledge, tous les messages entre sièges passent par la mailbox Ledge : le hook refuse le `SendMessage` natif et transmet le message.
- Sans ça, une grande partie des échanges manquerait au fil et aux Bureaux, et le broadcast comme les résultats se comporteraient différemment selon l'outil (Claude ou Codex).
- Hors équipe, le chemin natif reste comme aujourd'hui.

### 6.3 Moteur OpenRig

Il reste tel qu'il est sur la branche. Seule sa sortie passe par la couche commune.

### 6.4 Réglage du moteur

- Réglages › Équipes : « Moteur d'équipes : Ledge / OpenRig ».
- **[R]** Ledge par défaut. OpenRig ne peut être choisi que si OpenRig est présent : état autre que `absent` sur au moins une machine.
- **[R]** Le réglage coupe vraiment le moteur non choisi. Ce n'est pas un simple filtre d'affichage.
  - **Mode Ledge** : le pont OpenRig ne fait que détecter si OpenRig est présent, pour le réglage. Il ne reflète ni rigs ni escalades. Un rig lancé à la main avec `rig up` n'apparaît pas et ne bloque pas le changement de moteur.
  - **Mode OpenRig** : `ledge team …` et `ledge task …` sont refusés avec un message clair. `ledge who`, `ledge send`, `ledge read` et `ledge ask` restent disponibles dans les deux modes.

### 6.5 Interface « Équipes »

- On garde l'interface de Joffrey et on la rebaptise « Équipes » partout : Desktop, TUI, téléphone. Elle inclut l'onglet Rigs → Équipes, la section de la barre latérale, la carte de rig, le lancement, les Bureaux et le fil. **[G]**
- **Ce que son interface n'a pas, on le reprend de `main`.** **[G]** Notamment :
  - les éditeurs de modèles d'équipe et de rôles, sur Desktop (`teams/Catalog.tsx`) et sur le téléphone (`TeamEditor`, `RoleEditor`, `SeatModel`) ;
  - les équipes proposées par le chat (`ChatTeamProposal`) ;
  - les changements sur une équipe en cours : ajouter ou retirer un siège, rejoindre, quitter, reprendre.
- **Ces reprises sont provisoires.** **[G]** Joffrey va ajouter ses propres interfaces pour ces fonctions.
  - **[R]** Chaque écran repris de `main` reste isolé (son propre dossier ou composant, branché à un seul endroit), pour pouvoir le remplacer par celui de Joffrey quand il arrivera.
  - On ne fusionne pas ces écrans dans les siens, et on ne les retouche pas au-delà du nécessaire pour qu'ils marchent sur la couche commune.
- **[R]** La règle « exactement un lead » est vérifiée au chargement du modèle (daemon), et affichée par l'éditeur repris de `main`.
- **[R]** Le TUI et le téléphone suivent le même principe : leurs écrans rigs des lots 8 et 9 affichent les deux moteurs.
- Le kernel OpenRig n'existe qu'en mode OpenRig. Il garde son traitement actuel : pas de salle d'équipe, une baie dans la salle technique.

### 6.6 Salle technique

- La plaque indique le moteur actif. **[R]** Par exemple « Équipes · Ledge » ou « Équipes · OpenRig ».
- Une baie par machine où le moteur choisi tourne :
  - **mode Ledge** : une baie par machine dont le daemon Ledge est connecté ; LED verte si connecté et prêt, éteinte si injoignable ;
  - **mode OpenRig** : comportement actuel, une baie par kernel, état `openrig.status`.
- La salle apparaît dès que le moteur tourne sur au moins une machine, au lieu de « dès qu'un kernel existe ».

### 6.7 Vérification de l'efficacité **[R]**

Un scénario de bout en bout, rejoué avant et après :
- une équipe de deux sièges, lead Claude et relecteur Codex ;
- un objectif de petite taille sur un vrai dépôt.

Ce qui est mesuré :
- le délai entre le lancement et la première action du lead ;
- le nombre d'interventions de l'utilisateur entre le lancement et le résultat final. Objectif : zéro, hors vraies questions passées par le cerveau ;
- la présence de tous les échanges dans le fil.

## 7. Laissé au constructeur

- La mécanique pour remettre les équipes sur `feat/teams-two-engines` : annuler `1196dfe0` (`git revert -m 1`) puis merger `origin/main`, ou un autre chemin. L'ordre aussi.
- Le rythme de reprise des commits de `ledge-open-rig`.
- Les noms et la forme exacte de la couche commune et des messages (§6.1).
- L'emplacement du réglage, et sa diffusion aux daemons distants. Ce qui compte : un seul choix pour toutes les équipes.
- Le découpage en lots, les tests, les migrations de données. Les fichiers `tasks.json`, `teams-live.json`, `~/.ledge/teams/` et `~/.ledge/roles/` sont aujourd'hui « ignorés, pas effacés ».

## 8. Contexte utile

**Audit des équipes Ledge sur `main` (2026-11-01).** Causes probables de la lenteur :
- tout message ou toute tâche n'est tapé que quand l'agent est libre, à la fin de son tour (`daemon/mailbox.ts:77`, `daemon/relay.ts:28`) ;
- une notification coûte un tour entier ;
- les sièges démarrent sans prompt ;
- les résultats des tâches données par Ledge vont à l'utilisateur, pas à un lead (`daemon/tasks.ts:99-101`) ;
- le seul rappel tombe après 15 min d'inactivité ;
- il n'y a pas de broadcast (`@role` vise un seul siège, `daemon/seat.ts:76-87`) ;
- les messages Claude ↔ Claude passent par le `SendMessage` natif, hors de Ledge (`cli/hook.ts:477-483`).

**Audit OpenRig 0.6.14 (2026-11-01).**
- `rig send` colle aussi le texte dans le terminal de l'agent, qui le lit à la fin de son tour.
- Ce qu'OpenRig a en plus :
  - broadcast ;
  - file durable par siège ;
  - clôture obligatoire avec suite déclarée ;
  - relances (toutes les 5 min, 3 fois, puis remontée) ;
  - détection de blocage ;
  - rôles très paramétrables en YAML.
- La priorité des tâches ne change pas l'ordre de travail des agents.

**Compatibilité réseau à noter (hors périmètre).** `transport/ssh.ts` coupe tout le lien vers une machine distante dès qu'une trame est illisible. C'est ce qui fait boucler la reconnexion entre le snapshot et legion en 0.31 (message `teams`). Remettre les équipes supprime cette cause précise, mais la fragilité reste.

**Décision du 2026-11-01 (Guillaume) : la tolérance du pont SSH est incluse dans le lot A.** Après le premier `snapshot`, `transport/ssh.ts` saute (et journalise une fois par type) une trame qu'il ne comprend pas au lieu de couper le lien, et le client du fleet ne remet son délai de reconnexion à zéro qu'après 10 s de lien stable.
