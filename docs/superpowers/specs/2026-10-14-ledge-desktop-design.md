# Ledge Desktop — cadrage technique

Date : 2026-10-14 · Projet personnel, hors story Jira · Auteur : Guillaume Charlier avec Claude Code

Maquette validée : `../ledge-desktop/mockup/index.html` (hors dépôt) et son handoff `../ledge-desktop/HANDOFF.md`
(sessions de conception des 13 et 14 octobre). La maquette fixe les écrans, les parcours et les comportements ; cette
spec fixe comment les réaliser avec le daemon, le protocole et le code existants.

## 1. Objectif

Ledge a aujourd'hui un seul front : l'île en haut de l'écran (`apps/overlay`), conçue pour répondre vite sans quitter le
terminal. Desktop est un second front, une fenêtre classique, pour **suivre une équipe d'agents** : qui travaille sur
quoi, sur quelle machine, ce qui attend une décision, le fil complet de chaque agent, et un chat avec Ledge. Les deux
fronts parlent au même daemon et coexistent.

**Succès**
- J'ouvre Desktop et je vois toutes les sessions de toutes mes machines, groupées par projet (Équipe) ou autour de
  tables (Réunion : toutes ensemble, par machine, par story Jira). Le filtre « À votre attention » ne garde que ce qui
  attend un accord ou une réponse.
- Je lis le fil complet d'un agent (consigne, messages, actions, demandes), je décide ou je réponds depuis Desktop, et
  l'état change dans les secondes qui suivent.
- Je lance une session sur n'importe quelle machine configurée, je vois le démarrage, et un échec me laisse mon
  formulaire intact.
- Une machine qui tombe garde ses sessions visibles, figées et inactives ; elle revient seule ou sur « Reconnecter ».
  Rien n'est jamais envoyé à la mauvaise machine.
- Je parle à Ledge sur l'ensemble des machines, comme dans l'île.
- Une machine ajoutée dans Desktop existe aussi dans l'île, et inversement.
- Desktop se met à jour comme l'île, et porte le même numéro de version.

## 2. Périmètre

**Dans le périmètre** : l'application `apps/desktop`, l'extraction des morceaux de l'overlay que Desktop partage, les
deux ajouts au daemon (liste des machines partagée, origine de dev), la release en lockstep, les tests.

**Hors périmètre** : toute intégration Jira (API, validation d'une clé) ; les réglages du notch (écran, île, mode
discret, pilotage de « Ledge classique ») ; macOS et Linux ; le multi-utilisateur ; une archive des sessions au-delà
de ce que le daemon garde ; toute modification visible de l'île. Le cockpit en colonnes reste rejeté.

## 3. Décisions structurantes

| Décision | Choix | Pourquoi |
| --- | --- | --- |
| Où vit le code | Second app du monorepo `ledge/`, `apps/desktop`, deps en `workspace:*` | Le protocole change presque chaque jour ; mascottes et tokens doivent rester identiques dans les deux fronts. La consigne « hors `ledge/apps/` » du handoff visait la maquette. |
| Réglages partagés | La liste des machines seulement, portée par le daemon local | C'est le seul réglage qui décrit l'infrastructure et non une préférence d'affichage ; sa divergence crée une vraie confusion. Le reste reste local à chaque front. |
| Version et release | Lockstep avec l'île et le daemon ; une release publie les deux installeurs | Les packages partagés reconstruisent les deux apps à chaque release ; un seul numéro dit la compatibilité. |

## 4. Structure du monorepo

### 4.1 `packages/ui` — `@ledge/ui`

Sorti de `apps/overlay/src`, sans changement de comportement, tests déplacés avec le code :

- `styles/tokens.css`, `styles/base.css` ;
- `bots/` : `Bot`, `material`, `poseFor`, `useBotMotion`, `bots.css` ; `ResidentMascot` et `resident.css` ;
- `accent.ts`, `motionPreferences.ts`, `motion.ts`, `scale.ts` ;
- `sounds/` : `player`, `cues`, `preferences` (les clés de stockage deviennent un paramètre, voir §7) ;
- `i18n/lang.tsx` : le mécanisme (contexte, `loadLang`/`saveLang`, fallback). Les textes (`messages.ts`) restent dans
  chaque app : l'île et Desktop n'ont pas la même copie.

React 19 en `peerDependencies`. L'overlay importe `@ledge/ui` et supprime ses copies.

### 4.2 `packages/fleet` — `@ledge/fleet`

Sorti de `apps/overlay/src/daemon` : `client.ts`, `machines.ts`, `fleet.ts`, `store.ts`, `changes.ts`, avec leurs
tests. React en peer dependency pour `useMachines` et `useDaemon`. Deux ajouts (§6) : l'option `keepStale` et la
lecture de la liste des machines depuis le daemon. L'overlay importe `@ledge/fleet`.

### 4.3 `crates/ledge-native`

Crate Cargo partagée par les deux `src-tauri`, Cargo workspace à la racine. Y vont les fonctions Win32 déjà écrites
dans `apps/overlay/src-tauri/src/main.rs` et que Desktop réutilise à l'identique : `open_terminal`, `focus_terminal`,
`foreground_is_terminal`, `open_url`, autostart (`get_autostart`/`set_autostart`), et leurs stubs non-Windows. Les
commandes Tauri (`#[tauri::command]`) restent déclarées dans chaque app et appellent la crate. Le code propre à l'île
(géométrie, poller du curseur, clics extérieurs, cadre) ne bouge pas.

### 4.4 `apps/desktop`

Même outillage que l'overlay : Tauri 2, React 19, Vite 6, Tailwind 4, vitest + testing-library, Playwright. Vite sur
le port **1421**, `strictPort`.

```
apps/desktop/
  src/
    main.tsx, App.tsx
    i18n/messages.ts            textes FR/EN de Desktop
    state/                      vue, filtre, regroupement, sélection, panneau (réducteur pur + persistance)
    grouping/                   inférence Jira et groupes (port de grouping.js)
    team/                       Espace d'équipe : cartes par projet
    room/                       Table de réunion : scènes, sièges, plateaux
    conversation/               fil d'un agent, décisions, réponse, brouillons, panneau redimensionnable
    chat/                       Parler à Ledge
    launch/                     Nouvelle session, démarrage, échec
    settings/                   Affichage, Machines, Notifications, Sons, À propos
    notify/                     toasts, DND, sons
    tauri/bridge.ts             invoke des commandes natives
  src-tauri/                    main.rs (fenêtre, tray, commandes), tauri.conf.json, capabilities, icons, windows/
  test/                         vitest (+ setup, devMock réutilisé)
  e2e/                          Playwright, daemon simulé en page
```

Fenêtre : `label: main`, décorée, redimensionnable, 1280 × 800 par défaut, minimum 640 × 480, position et taille
mémorisées par Tauri (`tauri-plugin-window-state`). Identifiant `be.paradow.ledge.desktop`, nom « Ledge Desktop ».
Tray : Ouvrir, Nouvelle session, Ne pas déranger, Quitter ; fermer la fenêtre la cache dans le tray, Quitter arrête
l'app. CSP identique à l'île (`connect-src ipc: http://ipc.localhost ws://127.0.0.1:47831`).

### 4.5 `packages/ledge` (daemon et CLI)

Deux ajouts, §5. Aucun changement au reste : adaptateurs, poller, chat, transport SSH, bridge.

## 5. Daemon : machines partagées et origine de dev

### 5.1 Protocole

Dans `packages/protocol` :

```ts
/** A configured machine, as both fronts list it: the local daemon first, then SSH aliases (spec 2026-10-14 §5). */
export const MachineSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), label: z.string().trim().min(1).max(80),
  ssh: SshAliasSchema.optional()
});
export const MachinesSchema = z.array(MachineSchema).min(1).max(20);
```

Règles, identiques à `parseMachines` du fleet : `local` en premier et sans `ssh` ; toute autre entrée a un `ssh` ;
ids et alias uniques. `parseMachines` reste dans le fleet et s'appuie sur ce schéma ; l'URL loopback du local n'est
plus persistée nulle part (elle est déjà recalculée).

- `ClientMessage` : `{ type: 'machines.set', machines: MachinesSchema }`.
- `ServerMessage` : `{ type: 'machines', machines: MachinesSchema }`.

### 5.2 Daemon

- Fichier `~/.ledge/machines.json` (`paths().machines`), lu au démarrage, écrit à chaque `machines.set` valide. Absent
  ou invalide → `[{ id: 'local', label: 'Local' }]`.
- Après chaque `snapshot` envoyé à un client, le daemon lui envoie `machines`. Après un `machines.set` accepté, il
  diffuse `machines` à tous les clients connectés. Un `machines.set` invalide répond `error`.
- Le daemon distant (`ledge bridge`) reçoit ces messages comme les autres mais sa liste ne sert à rien : le fleet ne
  lit `machines` que du pair `local` et n'envoie `machines.set` qu'à lui.

### 5.3 Fronts

Dans `@ledge/fleet` :

- Le fleet expose `machinesSource(): 'daemon' | 'local'`. Tant que le daemon local n'a pas envoyé `machines`
  (daemon antérieur), la liste vient du `localStorage` comme aujourd'hui, et `configure()` l'y écrit.
- Dès qu'un `machines` arrive, la liste du daemon fait foi : `configure()` envoie `machines.set` et attend le
  `machines` diffusé pour reconfigurer les pairs. L'édition est donc confirmée par le daemon, jamais appliquée en
  local avant.
- **Migration** : si le premier `machines` reçu ne contient que `local` et que le stockage local a d'autres
  machines, le fleet envoie une fois `machines.set` avec la liste locale, puis efface la clé locale. Les deux fronts
  font la même chose ; le premier connecté gagne, le second trouve la liste déjà remplie et laisse la sienne.

### 5.4 Origine de dev

`ALLOWED_ORIGINS` du daemon ajoute `http://localhost:1421` et `http://127.0.0.1:1421`. Les origines packagées
(`http://tauri.localhost`, `tauri://localhost`) couvrent déjà Desktop.

## 6. Connexions, identité, machine déconnectée

- `createFleetClient` tel quel : une connexion WebSocket par machine, `/ssh/<alias>` sur le daemon local, ids
  qualifiés `machine:id` (`qualify`/`splitId`). Les commandes vont à la machine propriétaire ; `sendTo` renvoie `false`
  si elle n'est pas connectée et rien n'est envoyé ni mis en attente.
- L'id qualifié est **la** clé de Desktop : sélection, filtres, regroupement, brouillons, position de lecture, liens
  dans le chat. Deux machines peuvent porter le même id brut sans collision.
- **`keepStale`** (nouvelle option de `createFleetClient`). Aujourd'hui `publish()` ne garde que les pairs
  disponibles : les sessions d'une machine injoignable disparaissent, ce que l'île veut. Desktop passe
  `keepStale: true` : le dernier snapshot d'un pair tombé reste publié, chaque session portant `offline: true`
  (champ ajouté à `SessionSchema`, optionnel, annoté par le fleet comme `machineId`). `MachineState.status` dit
  `unreachable`. Les threads déjà reçus restent dans le store. Rien n'est figé pour le pair `local` tant que le daemon
  local répond ; s'il tombe, Desktop affiche l'état « daemon local injoignable » et tout est en lecture seule.
- Dans l'UI, une session `offline` : mascotte en `readonly`, fil et métadonnées lisibles, envoi, décisions et
  « Ouvrir le terminal » désactivés avec la raison, brouillon conservé. Les compteurs de la machine dans Paramètres
  suivent `MachineState`.
- Reconnexion : le backoff du client existant, et « Reconnecter » appelle `retry(id)`. Au retour, le nouveau snapshot
  remplace le figé ; une session disparue entre-temps est retirée, une sélection perdue est remplacée par la première
  visible.
- Le pair `local` reste toujours premier et non supprimable.

## 7. Données et persistance

**Source de vérité : le daemon.** Sessions et `pending` par `snapshot`/`session.updated` ; le fil par `session.thread`
demandé à la sélection d'une session puis `session.thread.item` en direct ; les prompts envoyés depuis Desktop
reviennent dans le fil par les hooks (`prompt`), les décisions par `permission.decision`. Le chat par `chat.history`
du jour, fusionné entre machines par le fleet comme aujourd'hui. Desktop ne stocke aucun message d'agent.

**Local à Desktop**, `localStorage` de son WebView2, restauré au lancement (contrairement à la maquette qui repart à
zéro). Clés préfixées `desktop.` pour qu'un code partagé avec l'île (sons, langue, accent) reçoive le préfixe en
paramètre et que les deux fronts ne se marchent pas dessus s'ils partageaient un jour un stockage :

| Clé | Contenu |
| --- | --- |
| `desktop.view` | `team` / `room`, regroupement, filtre « À votre attention » |
| `desktop.selected` | id qualifié de la session ouverte, ou `ledge` pour le chat |
| `desktop.panel` | largeur en % du panneau de conversation, agrandi ou non |
| `desktop.drafts` | brouillon par id qualifié, et celui du chat Ledge ; purgé quand la session est retirée |
| `desktop.thread` | sections repliées et position de lecture par id qualifié |
| `desktop.theme`, `desktop.lang`, `desktop.accent`, `desktop.scale`, `desktop.motion` | Affichage |
| `desktop.tool` | harnais par défaut du formulaire de lancement |
| `desktop.sounds`, `desktop.notify`, `desktop.dnd` | Sons, mode d'alerte à la fin d'une tâche, Ne pas déranger |
| `desktop.update.*` | mêmes clés que l'île (`auto`, `dismissed`, `checkedAt`, `from`) |
| `desktop.launch` | dernier formulaire de lancement non abouti |

Chaque lecture valide champ par champ et retombe sur la valeur par défaut, comme `loadSounds`. Le démarrage Windows
n'est pas stocké : il est lu et écrit via l'autostart Tauri.

## 8. Regroupement Jira

Fonction pure `apps/desktop/src/grouping`, portée depuis `grouping.js` de la maquette avec ses cas de test :

- Clés trouvées par `/\b[A-Z][A-Z0-9]+-\d+\b/g` dans `branch` puis dans `topic`.
- Une seule clé distincte → table de cette clé, origine `branch` ou `topic` affichée dans le détail.
- Aucune clé → « Sans story identifiée ». Plusieurs clés distinctes → « À clarifier ».
- Une clé est un texte, jamais un rattachement : pas d'appel Jira, pas de vérification d'existence, pas de lien.
- Regroupement « Par machine » sur `machineId` ; « Toutes ensemble » = une table. L'ordre des groupes est stable
  (ordre de première apparition), la disposition en flux suit la maquette.

Le protocole ne gagne pas de champ Jira. Si un jour les hooks en fournissent un, il remplacera l'inférence sans
changer l'UI.

## 9. Parcours

### 9.1 Conversation d'un agent

- Tête : sujet, agent, état, machine ; métadonnées repliables (branche, dossier, durée, harnais, origine de la clé
  Jira). Fil : items de `session.thread` rendus comme dans l'île (`Thread`, tours repliés, actions dépliables),
  demandes d'accord et questions intégrées au fil avec leurs options.
- Décision : `session.decide { id, decision }`. Réponse libre ou option : `session.reply { id, text }`. Affichage
  optimiste « Envoyé… » jusqu'au `session.updated` qui retire le `pending` ; un `error` portant l'id rouvre l'action
  avec le message. Un message libre ne porte jamais de commande.
- Composer : multiligne, Ctrl/⌘ + Entrée envoie, Entrée ajoute une ligne. Brouillon conservé par id qualifié.
- Panneau : 38 % au départ, poignée pointeur et clavier (±2 pts, Début/Fin), min 320 px conversation / 280 px
  sessions, max 70 %, « Agrandir ». Sous 760 px, empilement vertical sans poignée.
- Actions : Ouvrir le terminal (`terminal(id)` du fleet + `open_terminal`), Interrompre (`session.interrupt`),
  Arrêter (`session.kill`, confirmé), Retirer (`session.dismiss`, sessions terminées ou `hook_only`), Renommer le
  sujet (`session.rename`).

### 9.2 Nouvelle session

- Formulaire : machine (liste du fleet, les injoignables désactivées), projet parmi les `recents` de cette machine ou
  dossier personnalisé, harnais (défaut `desktop.tool`), consigne multiligne.
- Navigateur de dossiers : `folder.list`/`folder.create` envoyés à la machine choisie, réponses `folder.listing`.
  Chemin saisi accepté s'il est absolu ou commence par `~` ; le daemon fait la validation finale.
- Lancement : `session.launch { tool, cwd, prompt }` vers la machine choisie ; écran Démarrage (récapitulatif, étapes)
  jusqu'au `session.launched` de cette machine, puis sélection de la session créée.
- Échec : `error` du daemon, `sendTo` à `false`, ou **15 s** sans `session.launched` → écran Échec avec le message et
  le formulaire intact ; Modifier y retourne, Réessayer renvoie le même `session.launch`.
- Annuler pendant le démarrage ferme l'écran et ignore un `launched` tardif ; si la session apparaît quand même,
  elle reste dans la liste (le daemon l'a bien créée).
- Le premier lancement dans un espace vide suit le même chemin.

### 9.3 Parler à Ledge

- Fil dédié dans le même panneau, `ResidentMascot` en portrait, historique/brouillon/lecture séparés des agents.
- Envoi : `chat.route` avec le `RoutingContext` construit par le fleet (inventaire des machines, `online` suivant
  `MachineState`) ; clarification ou choix rendus dans le fil ; puis `chat.ask` vers la machine désignée, `chat.step`,
  `chat.delta`, `chat.done`, `chat.error` comme dans l'île. `chat.cancel` sur Annuler, `chat.reset` sur
  « Nouvelle conversation ».
- Cartes : proposition de lancement → `session.launch { qid }` ; relais → `session.relay { qid }` et
  `session.relay.cancel`.
- Suggestions : trois consignes prédéfinies envoyées telles quelles (demandes en attente, point sur les projets,
  préparer une session). Liens vers une session par id qualifié, désactivés si elle n'existe plus.
- Sans session et avec Devbox hors ligne, le chat reste utilisable sur ce que le fleet connaît ; une machine
  `offline` est annoncée comme telle dans l'inventaire.

### 9.4 Paramètres

| Section | Contenu réel |
| --- | --- |
| Affichage | Démarrage Windows (autostart Tauri), harnais par défaut, langue FR/EN, échelle (zoom WebView, comme l'île), thème, accent et retour au corail, mouvements réduits |
| Machines | Liste du daemon (§5) : ajout avec test de connexion (`probe`), modification, reconnexion (`retry`), retrait avec confirmation, aide SSH (`sshProblem`) ; `local` non supprimable |
| Notifications | Ne pas déranger ; mode d'alerte à la fin d'une tâche (toast, son, les deux, aucun) |
| Sons | Activation, volume, test, catégories, « seulement quand le terminal est derrière » |
| À propos | Version Desktop, version et mode d'installation du daemon par machine (`DaemonInfo`), rechercher une mise à jour (updater Tauri), mettre à jour le daemon local (`update.daemon`), journal `update.progress`/`update.failed` |

Vue, filtre, regroupement et sélection sont conservés au retour des paramètres.

## 10. Notifications, sons, coexistence avec l'île

- Toast Windows (`tauri-plugin-notification`) quand la fenêtre n'a pas le focus ou est dans le tray, et qu'une
  session passe en `waiting_*` ou se termine. Le clic ramène la fenêtre au mieux ; ce n'est pas un critère
  d'acceptation, le plugin ne garantit pas l'événement de clic sur Windows.
- Sons : mêmes cues et préférences que l'île (`@ledge/ui`), « seulement quand le terminal est derrière » via
  `foreground_is_terminal`.
- Ne pas déranger coupe toasts et sons ; accessible dans Paramètres et dans le tray.
- **Défauts de Desktop : toasts activés, sons désactivés.** Les deux fronts peuvent tourner ensemble sur le même
  daemon ; aucun ne détecte l'autre. Ces défauts évitent le double son ; l'utilisateur qui n'utilise que Desktop
  active les sons.

## 11. Release, mise à jour, packaging

- Lockstep : `apps/overlay/scripts/set-version.mjs` devient un script racine et met à jour `apps/desktop`
  (`package.json`, `Cargo.toml`, `tauri.conf.json`) avec le reste.
- Release GitHub d'un tag : `Ledge_x.y.z_x64-setup.exe` + `latest.json` (île), `Ledge Desktop_x.y.z_x64-setup.exe` +
  `latest-desktop.json` (Desktop), même clé minisign. L'updater de Desktop pointe sur `latest-desktop.json`.
- NSIS `currentUser`, hooks `windows/hooks.nsh` propres à Desktop, entrée Démarrer et icône distinctes de l'île.
- `createUpdaterArtifacts: true`, `installMode: passive`, relance après installation (`tauri-plugin-process`).
- La mise à jour du daemon reste celle de l'île : `update.daemon` vers le daemon local seulement.

## 12. Vérification

**Lot d'extraction** : `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build` verts ; l'overlay construit et ses tests
passent sans modification des assertions ; `cargo build` des deux `src-tauri` sur Windows.

**Daemon** : tests du `machines.set`/`machines` (validation, persistance, diffusion, migration), de l'allowlist.

**Fleet** : `keepStale` (sessions figées, `offline`, commandes refusées, retour du pair), source des machines
(`daemon`/`local`, migration, premier connecté gagne).

**Desktop, vitest** : regroupement Jira (cas de la maquette : 8, 5/3, 4/3/1, deux tables filtrées, clés multiples,
origine), réducteur d'état (vue, filtre, sélection masquée remplacée, conservation au retour des paramètres),
persistance (chaque clé, valeurs invalides), panneau (bornes, clavier), lancement (timeout, annulation, retry),
isolation des brouillons et des fils entre agents et chat.

**Desktop, Playwright** avec daemon simulé en page (pattern `apps/overlay/e2e/daemon.ts`) : les six scénarios de la
maquette (8 agents, aucune session, machine déconnectée puis reconnectée, nouvelle session, démarrage, échec du
lancement), une décision depuis le fil, un message au chat avec clarification, l'ajout d'une machine et sa
réapparition dans la liste. Toute erreur console fait échouer le test.

**Essais réels avant release** : build Windows, deux machines (local + un alias SSH), coupure SSH pendant qu'une
session Devbox attend un accord, lancement sur Devbox, les deux fronts ouverts en même temps, mise à jour depuis la
release précédente.

## 13. Lots

Un plan d'implémentation par lot, dans cet ordre. Chaque lot laisse `main` livrable.

1. **Extraction** : `packages/ui`, `packages/fleet` (avec `keepStale` et la source des machines, derrière des options
   que l'île n'active pas encore), `crates/ledge-native`. Aucun changement visible dans l'île.
2. **Daemon** : `machines.set`/`machines`, fichier, migration côté fleet activée dans l'île, origine 1421.
3. **Squelette Desktop** : fenêtre, tray, build, updater, CI release lockstep ; Équipe et Réunion branchées sur le
   fleet réel ; sélection, filtre, regroupement, persistance de la vue ; pas de conversation.
4. **Conversations** : fil complet, décisions et réponses, panneau redimensionnable, actions de session, machine
   déconnectée et reconnexion.
5. **Nouvelle session** : formulaire, navigateur de dossiers, démarrage, échec, retry.
6. **Parler à Ledge** : routage, chat, cartes, suggestions, liens.
7. **Paramètres et notifications** : cinq sections, toasts, sons, DND, autostart, À propos et mises à jour.

## 14. Risques et limites

- **Extraction** : l'overlay est le seul consommateur actuel ; le risque est une régression silencieuse de l'île. Le
  lot 1 ne change aucun comportement et se vérifie par la suite existante plus un essai manuel de l'île.
- **`keepStale`** change l'invariant « une session publiée est actionnable ». Le champ `offline` doit être vérifié
  par chaque action de Desktop ; les tests du lot 4 couvrent chaque bouton.
- **Migration des machines** : deux fronts qui migrent en même temps ; « premier connecté gagne » est simple et sûr
  parce que la liste locale de l'île est aujourd'hui la seule qui existe.
- **Toasts** : le clic n'est pas fiable ; la fenêtre reste le point d'entrée.
- **Rendu réel** : la maquette n'a jamais été capturée en navigateur (Playwright bloqué). Les tailles de tables et
  les débordements se valident sur le vrai build, au lot 3.
- **Daemon ancien** : Desktop fonctionne avec un daemon sans `machines` (liste locale) ; sans `session.thread`
  (daemon < suivi natif) le fil se limite à l'état, à la demande en attente et à la dernière réponse, comme l'île.
