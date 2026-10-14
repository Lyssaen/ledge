# Ledge sur le téléphone — plan directeur d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUIS : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour réaliser les plans de lot tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** livrer une PWA installable sur iPhone, servie par le daemon via Tailscale, qui permet de consulter les demandes des agents, de décider avec vérification proportionnée au risque, de suivre et relancer les fils, et d'être notifié, sans affaiblir l'overlay Windows.

**Architecture :** le daemon garde son port local `127.0.0.1:47831`, inchangé pour l'overlay, les hooks et la CLI. Une **entrée distante** distincte sur `127.0.0.1:47832` sert la PWA sous `/m/` et un WebSocket `/m/ws`. `tailscale serve`, sous Windows, publie uniquement cette entrée sur le tailnet. Un appareil s'y authentifie par jeton à chaque connexion et n'exécute qu'une liste fermée de commandes. Les décisions distantes désignent une demande identifiée et versionnée. Elles portent un `operationId` idempotent, avec accusé de réception et consultation après coupure. Une autorisation à impact élevé exige une assertion WebAuthn liée à l'action.

**Pile technique :** Node 22, `ws`, zod (existants) ; `@simplewebauthn/server` et `@simplewebauthn/browser` (WebAuthn) ; `web-push` (VAPID, lot 4) ; `apps/mobile` en Vite 6, React 19 et Tailwind 4, comme l'overlay ; Vitest et Playwright (Chromium), comme l'overlay.

**Spec :** [`docs/superpowers/specs/2026-10-14-ledge-mobile-design.md`](../specs/2026-10-14-ledge-mobile-design.md). Maquette de référence : `docs/mockups/ledge-mobile/` (pages HTML V2, `mobile.css`, `mobile.js`). Les fichiers `source/` et la V1 sont historiques. Les interactions de la maquette sont simulées : elles ne prouvent ni la sécurité ni la compatibilité iPhone.

## Plans de lot

Ce document est le plan directeur. Les tâches détaillées vivent dans cinq plans, à exécuter dans l'ordre des dépendances (section « Découpage ») :

| Lot | Plan | Livrable vérifiable |
| --- | --- | --- |
| 0 | Tâche 0 ci-dessous | Rapport de faisabilité sur iPhone réel ; aucune ligne de produit. |
| 1 | [Accès en lecture](2026-10-14-ledge-mobile-1-acces-lecture.md) | Un iPhone appairé voit les demandes et leur contexte ; décisions refusées par le daemon ; révocation depuis l'overlay. |
| 2 | [Décisions](2026-10-14-ledge-mobile-2-decisions.md) | Décisions et réponses à options depuis le téléphone, une seule injection, WebAuthn pour l'impact élevé, réception incertaine gérée. |
| 3 | [Fil, agents et terminal](2026-10-14-ledge-mobile-3-fil.md) | Onglet Agents, fil persistant, consigne à un agent disponible, terminal en lecture seule avec interruption. |
| 4 | [Notifications push](2026-10-14-ledge-mobile-4-push.md) | Web Push ouvrant le détail, badge du nombre de demandes. |
| 5 | [Réponses étendues](2026-10-14-ledge-mobile-5-reponses-etendues.md) | Réponse libre « Other » pour Claude Code ; capacités vérifiées outil par outil ; masquage sinon. |

## Global Constraints

Valeurs reprises de la spec ; chaque tâche les inclut implicitement.

- Transport : « Tailscale sur Windows, avec `tailscale serve` qui publie en HTTPS sur le tailnet ». Le daemon « reste lié à `127.0.0.1` ». « Aucune ouverture de port sur le routeur ni exposition publique du daemon. »
- La PWA est servie par le daemon « sous `/m/`. Une seule origine HTTPS, sur le nom du tailnet, pour la page et le WebSocket. »
- « Tout accès par l'entrée distante exige un jeton d'appareil, même si `Origin` est absent ou correspond à l'overlay. »
- « Le premier message d'une connexion distante est `auth { token }`. Sans lui, ou avec un jeton inconnu, la connexion est fermée et l'essai est écrit dans `daemon.log`. »
- Appairage : code « en QR code et en six chiffres pendant deux minutes ». Révocation : « Réglages › Mobile dans l'overlay liste les appareils (nom, dernière connexion) et retire un appareil d'un clic. »
- Risque : `risk: 'low' | 'high'` sur `pending`. « Toute demande que le classeur ne sait pas lire est élevée. » « Le classeur est une fonction pure. »
- Impact élevé : « assertion WebAuthn avec vérification de l'utilisateur », vérifiée par le daemon « avant d'injecter la décision ». « Le défi serveur doit être à usage unique et lié à la demande, à sa version et à la décision. » « L'identifiant de partie de confiance doit correspondre au domaine HTTPS retenu. »
- « L'overlay sur le PC n'est pas concerné : il décide comme aujourd'hui. »
- « Une décision n'est jamais mise en file hors connexion. » Aucun renvoi automatique. « Une décision obsolète est refusée, même si une nouvelle demande est déjà apparue dans la même session. »
- Historique : `~/.ledge/history/<id>.jsonl`, « 200 tours au plus par session, effacé avec la session ».
- Push : « Clés VAPID générées au premier appairage dans `~/.ledge` ». Le contenu affiche « le titre de tâche et le motif de demande, pas la commande complète ». Aucune action Autoriser/Refuser dans la notification. Le badge (nombre de demandes en attente) part avec chaque push.
- Application : « Nouveau paquet `apps/mobile` : Vite, React 19, Tailwind 4 ». Elle réutilise `@ledge/protocol`, le client WebSocket et `reply/parse.ts`, « à extraire dans un paquet partagé plutôt qu'à copier ».
- Visuel (spec §7.1) : fond `#0c0d0e` ; surfaces `#17191b` et `#202326` ; texte `#f2f1ed` et `#a2a6ab` ; ambre `#edc479` ; vert `#a6d6bf` ; bleu `#a6c8f0` ; impact élevé : texte `#f4a5a3`, fond `#301b1d`, bouton `#8f3037`. Geist et Geist Mono. Titres 29, 25 et 16 px, saisie 16 px ; marges 18 px ; rayons 16 et 12 px ; cibles ≥ 44 × 44 px, boutons principaux de 48 px ; largeur plafonnée à 480 px ; `env(safe-area-inset-*)`.
- Interaction : aucun glissement pour décider, aucune annulation après transmission. Le mouvement réduit est respecté. Largeurs de revue : 320, 390 et 430 px.
- Hors MVP : terminal interactif, lancement de session depuis le téléphone, chat global « Demander à Ledge », applications natives, plusieurs PC, `remember` et `note`.

## Décisions de conception justifiées par le dépôt

Ces décisions relèvent du plan technique, que la spec laisse ouvert (§3 « mécanisme précis de séparation », §5, §11). Elles ne remettent pas en cause le design validé.

| # | Décision | Justification dans le dépôt |
| --- | --- | --- |
| D1 | **Entrée distante sur un listener séparé** (`127.0.0.1:47832`, `REMOTE_PORT`), arrêté par défaut et démarré seulement quand le mobile est configuré. Le port 47831 n'est jamais publié par Serve. | `daemon/server.ts` n'identifie un client que par `originAllowed()`, qui accepte toute connexion sans `Origin`. Derrière `tailscale serve`, toute connexion vient de `127.0.0.1` : ni l'adresse ni `Origin` ne distinguent un téléphone d'un hook. Seul un listener séparé crée une frontière vérifiable. |
| D2 | **Contexte de pair** `{ kind: 'local' } \| { kind: 'remote'; deviceId }` attaché à chaque socket. Les commandes reçues passent par `remoteMayRun()`, une liste fermée par lot, et les messages émis par `toRemote()`, une projection qui retire `launcher`, `recents`, `daemon`, `chat.*`, `document.*`, `folder.*` et `update.*`. | `server.ts` diffuse tout à tous (`broadcast`) et accepte `document.read`, `session.launch`, `folder.create` et `update.daemon` sans distinction de client. Les exposer à un téléphone élargirait le périmètre au-delà de la spec. |
| D3 | **Garde-fou sur le port local** : une requête d'upgrade sur 47831 portant `Tailscale-User-Login`, `X-Forwarded-For` ou `Forwarded` est refusée et journalisée. C'est un refus supplémentaire, jamais une preuve d'identité. | Protège contre une mauvaise commande `tailscale serve` pointée sur 47831, sans changer le modèle local accepté (README, « Security »). |
| D4 | **Identité des demandes dès le lot 1** : `Pending.id`, `version` et `since`, attribués par une fonction pure `identify()` en sortie du reducer, avec un compteur `Session.pendingSeq`. Le refus des décisions obsolètes reste au lot 2. | La liste du lot 1 doit afficher l'ancienneté et produire des liens stables (`#/request/:sid/:pid`), que le push du lot 4 réutilise. `state.ts` est pur : l'identifiant dérive de `pendingSeq` et de `ev.at`, sans aléa. |
| D5 | **Clé WebAuthn enregistrée pendant l'appairage**, qui l'exige : `pair.complete { code, deviceName, webauthn }`. Renouveler la clé exige un nouvel appairage. | Un enregistrement de clé autorisé par le seul jeton permettrait au voleur du jeton d'ajouter sa propre clé et de contourner la vérification. Le code affiché sur le PC prouve la présence physique (spec §3). |
| D6 | **Jetons et appareils** dans `~/.ledge/devices.json` (mode 0600, écriture atomique comme `store.ts`). Seul le SHA-256 du jeton est stocké, avec un jeton aléatoire de 32 octets en base64url. | Même stratégie de persistance que `Store.write()`. Un jeton à forte entropie n'a pas besoin de hachage lent. |
| D7 | **Un seul profil de droits « téléphone »** (`MOBILE_COMMANDS`), étendu lot par lot, sans édition par appareil dans le MVP. | La spec demande « la liste des opérations autorisées au téléphone » (§11), pas une gestion fine. YAGNI. |
| D8 | **Origine configurée explicitement** : `ledge mobile enable --origin https://<machine>.<tailnet>.ts.net` envoie `mobile.configure` au daemon, qui l'écrit dans `~/.ledge/mobile.json` et démarre l'entrée distante à chaud. `rpID` est l'hôte de cette origine, jamais l'en-tête `Host`. | WebAuthn exige une origine attendue fixe. Un redémarrage du daemon peut fermer les sessions tmux (README, « Update ») : la configuration à chaud l'évite. |
| D9 | **Opérations** : `operationId` (UUID v4 du client) sur `session.decide`, `session.reply` et `session.interrupt` distants. Le daemon répond `operation.received`, puis `operation.result { status, reason? }`. `operation.status` relit un résultat. Un même `operationId` ne s'exécute jamais deux fois ; si sa charge diffère, le daemon répond `conflict`. Registre en mémoire, borné à 24 h et 500 entrées. Après un redémarrage, le statut vaut `unknown`. | `injectAndVerify()` verrouille déjà par session (`inFlight`) et ne réessaie jamais. On ajoute l'identité de l'action sans toucher à la vérification « prompt visible puis disparu ». |
| D10 | **Compatibilité locale** : sur le port local, `session.decide { id, decision }` sans `pendingId` reste accepté comme aujourd'hui, et `error { id }` reste envoyé en cas d'échec. Sur l'entrée distante, `pendingId`, `pendingVersion` et `operationId` sont obligatoires. L'overlay est mis à jour pour envoyer `pendingId` et `pendingVersion`. | Le daemon se met à jour avant l'application (README, « Security », ordre fixe) : un nouveau daemon doit servir l'ancien overlay. `useDaemonAsks` lit `error { id }`. |
| D11 | **Paquet partagé `packages/client` (`@ledge/client`)** : client WebSocket (avec `hello` et `onClose(code)`), `reply/parse.ts`, `materialFor`, `poseFor` et la forme `BotShell`. Le composant `Bot` animé reste dans l'overlay. | La spec demande l'extraction. `Bot.tsx` dépend de `motion`, de `motionPreferences` et d'`i18n`, propres à l'overlay ; la maquette mobile utilise des mascottes statiques. |
| D12 | **La PWA est construite dans `packages/ledge/dist/mobile`** et servie depuis `new URL('../mobile/', import.meta.url)`. Polices Geist embarquées. Routage par hash (`#/request/...`). | Le paquet npm ne publie que `dist` (`package.json` `files`). Le hash évite toute réécriture côté serveur et fonctionne hors connexion avec le service worker. |
| D13 | **Textes du mobile en français**, centralisés dans `apps/mobile/src/copy.ts`. | Les écrans validés sont en français. L'overlay garde son catalogue FR/EN, et ses nouvelles clés (Réglages › Mobile) existent dans les deux langues. |
| D14 | **Les questions sont classées `low`** (motif `question`). Les plans et les dialogues de confiance de dossier sont classés `high`. | Écran « Une question » validé sans vérification d'identité. Une question n'est pas une autorisation d'outil. Validée par l'utilisateur le 2026-10-14 (Q2). |

## Hypothèses de faisabilité à vérifier

Aucune n'est démontrée par la maquette. Chacune a une tâche qui la vérifie et une conséquence si elle échoue.

| # | Hypothèse | Vérifiée par | Si elle échoue |
| --- | --- | --- | --- |
| H1 | `tailscale serve` sous Windows publie `https://<machine>.<tailnet>.ts.net` vers `http://127.0.0.1:47832`, WebSocket compris, et le transfert localhost de WSL2 atteint le daemon (réseau NAT ou mirrored). | Tâche 0 | Plan bloqué : documenter une alternative (proxy Windows) et revenir vers l'utilisateur. |
| H2 | Les certificats HTTPS et MagicDNS sont activés sur le tailnet de l'utilisateur. | Tâche 0 | Action manuelle dans la console Tailscale, documentée dans `docs/mobile.md`. |
| H3 | Dans une PWA installée sur l'écran d'accueil d'iOS, `navigator.credentials.create/get` fonctionne avec `rpId` = hôte `ts.net` et `userVerification: 'required'`. | Tâche 0, puis lots 1 et 2 sur appareil | Sans WebAuthn, l'impact élevé reste interdit depuis le téléphone. Le lot 2 livre alors décisions faibles et refus, et les autorisations à impact élevé restent au PC. |
| H4 | Une passkey iOS peut être synchronisée par le trousseau iCloud. Elle reste inutilisable sans le jeton de l'appareil, que le daemon exige avec l'assertion. | Lot 2, tâche 4 (le daemon vérifie que la clé correspond à l'appareil) | Aucune ; documenter que la garantie porte sur l'utilisateur, pas sur le matériel. |
| H5 | Le stockage de Safari et celui de l'app installée sont séparés ; le jeton (localStorage) de l'app installée persiste des semaines. | Tâche 0, puis R2 | Sinon, réappairer. L'app détecte le jeton absent ou refusé (4401) et ouvre l'appairage. |
| H6 | Web Push fonctionne pour une PWA installée (iOS ≥ 16.4) : permission demandée depuis un geste, `push` reçu application fermée, `notificationclick` capable d'ouvrir ou de focaliser l'app sur une URL précise. | Tâche 0, lot 4 et R6 | Le lot 4 se limite au badge à l'ouverture de l'app ; la spec doit alors être révisée avec l'utilisateur. |
| H7 | `navigator.setAppBadge` est disponible dans le service worker iOS. | Lot 4 et R6 | Le badge est posé seulement à l'ouverture de l'app. |
| H8 | Le daemon, sous systemd, joint `web.push.apple.com` en HTTPS. Si un proxy est nécessaire, il vient de l'environnement du shell de connexion (`shell-path.ts`). | Lot 4, tâche 3, et R9 | L'envoi échoue et est journalisé ; l'application reste utilisable sans push. |
| H9 | iOS coupe le WebSocket d'une PWA suspendue sans prévenir. Au retour, `visibilitychange` permet de reconnecter et de vérifier les opérations ouvertes. | Lot 2, tâche 8, et R8 | Toute opération ouverte devient incertaine au retour, comportement conservateur déjà prévu. |
| H10 | `@simplewebauthn/server` (ESM) se bundle avec tsup pour Node 22 ; `web-push` aussi. | Lot 1, tâche 7 ; lot 4, tâche 2 | Les déclarer `external` dans `tsup.config.ts`, puisqu'ils figurent dans `dependencies`. |
| H11 | Codex (`request_user_input`) et Cursor Agent (AskQuestion) acceptent une réponse libre au clavier. | Lot 5, tâche 3 | La capacité reste `false` pour l'outil concerné : le téléphone masque « Autre réponse ». |

## Arbitrages de l'utilisateur

**Tranchés le 2026-10-14 :** Q1 et Q2 sont validées avec la valeur retenue ci-dessous. Q3 est écartée : « Ne plus demander » et « Refuser avec une consigne » ne seront pas réalisés. Plus aucun arbitrage ne bloque la porte du lot 2.

| # | Question | Décision | Effet sur le plan |
| --- | --- | --- | --- |
| Q1 | **Valider la politique de risque** (tableau du [lot 2, tâche 2](2026-10-14-ledge-mobile-2-decisions.md#task-2-classeur-de-risque)). La spec l'exige : « La politique doit être validée avant toute décision distante ». Conséquence directe : `pnpm test`, `pnpm build` et tout script du dépôt sont classés **élevés**, donc la plupart des autorisations Bash demanderont une vérification d'appareil. | **Validée** : politique conservatrice du tableau, sans configuration depuis le PC. Une liste « faible » configurable sur le PC reste une extension possible, hors de ce plan. | Lot 2, tâche 2, appliquée telle quelle ; condition de la porte (tâche 7) remplie. |
| Q2 | **Réponses aux questions sans vérification d'appareil** (D14), comme sur l'écran validé. Une question du type « Pousser en production ? 1. Oui » serait alors répondue sans WebAuthn. | **Validée** : questions classées `low`. | D14 confirmée ; condition de la porte (tâche 7) remplie. |
| Q3 | **« Ne plus demander » et « Refuser avec une consigne »** (spec §8 et §9.5) : leur utilité est-elle confirmée ? | **Non nécessaires.** | Le lot 5 ne livre que la réponse libre ; aucun plan complémentaire. |

## Découpage et dépendances

```
Tâche 0 (faisabilité iPhone) ──► Lot 1 (accès en lecture) ──► Lot 2 (décisions) ──► Lot 5 (réponses étendues)
                                         │                        ▲
                                         ├──► Lot 3 (fil) ────────┘ (lot 3 utilise les opérations du lot 2)
                                         └──► Lot 4 (push)  ◄── les liens profonds utilisent Pending.id (lot 1)
```

- **Ordre d'exécution recommandé** : 0 → 1 → 2 → 3 → 4 → 5. Le lot 3 dépend du registre d'opérations du lot 2 pour la consigne et l'interruption. Le lot 4 ne dépend que du lot 1, mais son écran « Déjà traitée » réutilise la logique de résultat du lot 2 (`model/requestOutcome.ts`). Le lot 5 dépend du formulaire de question du lot 2.
- **Porte de sécurité du lot 2** : la tâche 7 ajoute `session.decide`, `decide.prepare`, `operation.status` et `session.reply` à `MOBILE_COMMANDS`. Elle n'est exécutée qu'une fois les tâches 1 à 6 vertes et R4 préparé (Q1 et Q2 sont validées depuis le 2026-10-14). Jusque-là, le daemon refuse toute décision distante (test du lot 1, tâche 4).
- **Chaque lot se livre seul** : chaque plan se termine par une tâche de documentation et de vérification ; le lot laisse `pnpm -r test` et `pnpm -r typecheck` verts.

## Interfaces partagées entre les plans

Les signatures complètes sont dans les blocs « Interfaces » des tâches. Cette section fixe les noms communs.

### Protocole (`packages/protocol/src`)

| Fichier | Lot | Ajouts |
| --- | --- | --- |
| `remote.ts` (nouveau) | 1 | `REMOTE_PORT = 47832`, `MOBILE_BASE = '/m/'`, `MOBILE_WS_PATH = '/m/ws'`, `PAIR_CODE_TTL_MS = 120_000`, `PAIR_MAX_ATTEMPTS = 5`, `AUTH_TIMEOUT_MS = 5_000`, `REMOTE_CLOSE = { unauthenticated: 4401, revoked: 4403, timeout: 4408 }`, `DeviceSchema`, `PairErrorSchema` |
| `session.ts` | 1 | `PendingSchema` + `id?`, `version?`, `since?` ; `SessionSchema` + `pendingSeq?` |
| `session.ts` | 2 | `PendingSchema` + `risk?: 'low' \| 'high'`, `riskReason?` |
| `operations.ts` (nouveau) | 2 | `OperationStatusSchema`, `OperationReasonSchema`, `OperationIdSchema` |
| `history.ts` (nouveau) | 3 | `TurnSchema` ; `SessionSchema` + `unread?` |
| `push.ts` (nouveau) | 4 | `PushSubscriptionSchema`, `PushPayloadSchema` |
| `capabilities.ts` (nouveau) | 5 | `CapabilitiesSchema`, `NO_CAPABILITIES` |

| Message | Sens | Pair | Lot |
| --- | --- | --- | --- |
| `auth { token }` → `auth.ok { deviceId, deviceName, pcName, vapidPublicKey? }` | téléphone ↔ daemon | distant, pré-auth | 1 (`vapidPublicKey` : 4) |
| `pair.begin` → `pair.code { code, expiresAt, url }` | overlay ↔ daemon | local | 1 |
| `pair.options { code }` → `pair.challenge { options, expiresAt }` | téléphone ↔ daemon | distant, pré-auth | 1 |
| `pair.complete { code, deviceName, webauthn }` → `pair.done { token, deviceId }` / `pair.error { reason }` | téléphone ↔ daemon | distant, pré-auth | 1 |
| `devices` → `devices { devices, origin, listening }` ; `device.revoke { id }` ; `mobile.configure { origin \| null }` | overlay/CLI ↔ daemon | local | 1 |
| `session.decide { id, decision, pendingId?, pendingVersion?, operationId?, assertion? }` | client → daemon | local et distant | 2 |
| `session.reply { id, text, operationId?, pendingId?, pendingVersion?, other? }` | client → daemon | local et distant | 2 (`other` : 5) |
| `decide.prepare { id, pendingId, pendingVersion, decision }` → `decide.challenge { pendingId, pendingVersion, decision, options, expiresAt }` | téléphone ↔ daemon | distant | 2 |
| `operation.status { operationId }` ; `operation.received { operationId }` ; `operation.result { operationId, status, reason? }` | téléphone ↔ daemon | distant (et local si `operationId` fourni) | 2 |
| `session.history { id }` → `session.turns { id, turns }` ; `session.read { id, seq }` ; `session.interrupt { id, operationId? }` | client ↔ daemon | local et distant | 3 |
| `push.subscribe { subscription }` ; `push.unsubscribe` | téléphone → daemon | distant | 4 |
| `snapshot { …, capabilities? }` | daemon → téléphone | distant | 5 |

### Daemon (`packages/ledge/src`)

| Module | Lot | Responsabilité |
| --- | --- | --- |
| `daemon/identify.ts` | 1 (2 : risque) | `identify(before, after, at): Session` : attribue l'identité, la version et le risque d'une demande. |
| `daemon/peers.ts` | 1 | `Peer`, `PeerContext`, `createPeers()` : diffusion projetée. |
| `daemon/remote/{listener,static,project,rights}.ts` | 1 | Entrée distante, fichiers `/m/`, `toRemote()`, `MOBILE_COMMANDS` et `remoteMayRun()`. |
| `daemon/devices.ts` | 1 (3 : lus ; 4 : push) | `DeviceStore`. |
| `daemon/pairing.ts`, `daemon/webauthn.ts` | 1 (2 : assertions) | Fenêtre de code, enregistrement, puis vérification des assertions. |
| `mobile/config.ts`, `cli/mobile.ts` | 1 | `~/.ledge/mobile.json`, `ledge mobile enable\|disable\|status`. |
| `daemon/risk.ts`, `daemon/operations.ts`, `daemon/challenges.ts` | 2 | Classeur pur, registre idempotent, défis à usage unique. |
| `daemon/history.ts` | 3 | `HistoryStore`, `turnFromEvent()`. |
| `daemon/push/{vapid,triggers,sender}.ts` | 4 | Clés, décisions de notification pures, envoi. |
| `adapters/types.ts` (`capabilities`) | 5 | Ce que chaque outil sait répondre. |

Fichiers persistants ajoutés à `paths()` : `devices` (`devices.json`), `mobile` (`mobile.json`), `history` (`history/`), `vapid` (`vapid.json`). Tous en mode 0600 (dossier `history/` en 0700).

### Application (`apps/mobile/src`)

`connection/remoteClient.ts` (1), `state/store.ts` et `state/persist.ts` (1), `model/requests.ts` (1), `model/requestOutcome.ts` et `model/operations.ts` (2), `model/thread.ts` (3), `sw.ts` (1 ; 4 : push), écrans sous `screens/`.

## Garanties existantes de l'overlay préservées

| Garantie (README, « Security and failure model ») | Comment elle est préservée | Test qui la fixe |
| --- | --- | --- |
| Port local en loopback, origines web refusées | Listener local inchangé ; garde-fou D3 en plus. | `server.test.ts` « origin check » existants + lot 1, tâche 4 « refuses a forwarded upgrade on the local port » |
| Une réponse n'est tapée que si le prompt est visible, puis confirmée par sa disparition | `injectAndVerify()` conservée ; la vérification d'identité de la demande s'ajoute sous le même verrou. | Tests existants de `server.test.ts` + lot 2, tâche 5 |
| Aucun renvoi automatique | Aucun chemin du daemon ni du mobile ne renvoie ; le client mobile ne fait que consulter (`operation.status`). | Lot 2, tâches 3 et 8 |
| Décision verrouillée dans l'overlay jusqu'à confirmation, rejet ou coupure | `useDaemonAsks` inchangé ; `error { id }` toujours émis localement (D10). | Lot 2, tâche 6 « still fails the lock on error » |
| Un hook ne bloque jamais l'agent | Les hooks ne parlent qu'au port local, inchangé ; `PROMPT_MAX` relevé (lot 3), budget de 100 ms inchangé. | `hook.test.ts` existant + lot 3, tâche 2 |
| L'overlay décide sans WebAuthn | Le contrôle d'assertion ne s'applique qu'aux pairs distants. | Lot 2, tâche 5 « local accept of a high-risk request needs no assertion » |

## Review Focus

Les cinq situations que la spec implique et qu'aucun parcours nominal n'exerce, de la plus probable à la moins probable. Chacune a son test dans la tâche qui possède le code.

1. **iOS suspend l'app pendant une transmission, sans fermeture visible du socket.** On attend : au retour au premier plan, l'opération ouverte devient « Réception non confirmée » puis est vérifiée, jamais renvoyée. → [Lot 2, tâche 8](2026-10-14-ledge-mobile-2-decisions.md#task-8-modèle-dopérations-côté-mobile), test `resume with an open operation marks it uncertain and asks its status`.
2. **Redémarrage du daemon entre l'envoi et la reconnexion.** On attend : `operation.status` répond `unknown` ; le téléphone affiche l'état actuel de la demande, avec une nouvelle décision possible seulement si la même `pendingId`/`pendingVersion` attend toujours. → Lot 2, tâche 8, test `unknown operation shows current request state`.
3. **Le hook enrichit une demande vue d'abord dans le pane, avant ou pendant la décision du téléphone.** On attend : même `pendingId`, version incrémentée, décision refusée avec `changed` (jamais injectée sur un contenu non relu) et détail rafraîchi. → [Lot 1, tâche 2](2026-10-14-ledge-mobile-1-acces-lecture.md#task-2-identité-des-demandes-dans-le-reducer) (`hook over pane keeps id and bumps version`) et lot 2, tâche 5 (`changed version is rejected`).
4. **Vérification d'appareil plus lente que la validité du défi** (Face ID annulé puis relancé, code saisi lentement). On attend : `assertion_expired` lisible, nouveau défi sur demande, la demande reste en attente. → [Lot 2, tâche 4](2026-10-14-ledge-mobile-2-decisions.md#task-4-défis-liés-à-laction-et-vérification-dassertion), test `an expired challenge is refused and not consumed twice`.
5. **Révocation pendant qu'une décision du téléphone attend le verrou d'injection.** On attend : le socket se ferme (4403). Une opération non encore injectée est refusée (`forbidden`) ; une injection déjà engagée se termine et reste consultable depuis le PC. → Lot 2, tâche 5, test `revocation before injection rejects the operation`.

---

## Task 0 : Faisabilité sur iPhone réel

Avant toute ligne de produit, vérifier H1, H2, H3, H5 et H6 sur le matériel de l'utilisateur, avec un prototype jetable. Ce prototype vit dans un dossier temporaire et n'est **pas commité**. Seul le rapport l'est.

**Fichiers :**
- Créer : `docs/spikes/2026-10-14-ledge-mobile-feasibility.md` (rapport)

- [ ] **Étape 1 : préparer le prototype**

Un script Node (`http` + `ws`, déjà dans le dépôt) écoute `127.0.0.1:47832`. Il sert sous `/m/` une page avec un manifeste (`display: standalone`, `scope: '/m/'`) et un service worker minimal. Quatre boutons : `credentials.create`, `credentials.get`, `Notification.requestPermission` + `pushManager.subscribe`, et un écho WebSocket sur `/m/ws`. Défis et clés VAPID sont générés à la volée ; le script affiche et vérifie les réponses.

- [ ] **Étape 2 : publier avec Tailscale (PowerShell, Windows)**

Exécuter : `tailscale serve --bg --https=443 http://127.0.0.1:47832`, puis `tailscale serve status`.
Attendu : l'URL `https://<machine>.<tailnet>.ts.net` est listée. La syntaxe exacte de la version installée est consignée dans le rapport.

- [ ] **Étape 3 : exercer sur l'iPhone**

Dans Safari (Tailscale actif, Wi-Fi coupé) : la page s'ouvre en HTTPS valide. L'ajouter à l'écran d'accueil, puis l'ouvrir. Dans l'app installée : écho WebSocket, `create` puis `get` avec Face ID ou code, abonnement push, notification reçue app fermée, appui qui ouvre `/m/#/probe`. Vérifier qu'une valeur `localStorage` écrite dans Safari est absente de l'app installée.
Attendu : chaque point coché ou noté en échec, avec la version d'iOS et de Tailscale.

- [ ] **Étape 4 : vérifier l'absence d'exposition**

Depuis un appareil hors tailnet, ou l'iPhone avec Tailscale désactivé, l'URL ne répond pas. Depuis Windows, `Test-NetConnection <ip-lan-du-PC> -Port 47832` échoue.
Attendu : aucune réponse hors tailnet.

- [ ] **Étape 5 : rédiger le rapport et décider**

Le rapport liste H1 à H6 avec un résultat (confirmée, infirmée ou partielle). Si H1 ou H3 est infirmée, s'arrêter et présenter les conséquences du tableau des hypothèses à l'utilisateur avant le lot 1.

- [ ] **Étape 6 : commit**

```bash
git add docs/spikes/2026-10-14-ledge-mobile-feasibility.md
git commit -m "docs(mobile): feasibility report on a real iPhone"
```

---

## Revue de couverture spec → tâches

| Spec | Exigence | Tâches |
| --- | --- | --- |
| §1 Succès | Identifier tâche, branche et effet avant de décider ; notification qui ouvre le détail | L1-T13, L2-T9, L4-T4 |
| §1 Succès | Écrire à un agent au repos et voir la prise en compte | L3-T3, L3-T5 |
| §1 Succès | Impact élevé impossible sans vérification | L2-T2, L2-T4, L2-T5, L2-T10 |
| §1 Succès | Rien sur internet ; téléphone perdu retiré depuis le PC | T0, L1-T4, L1-T6, L1-T8, L1-T9 |
| §1.1 | Deux onglets, liste avec filtres, détail avant décision, titre de tâche d'abord, sans swipe ni annulation, conséquence répétée, carte de décision distincte d'une suggestion, réponses rapides en brouillon, dernier état hors ligne, notifications vers le détail | L1-T13, L2-T9, L2-T10, L3-T4, L3-T5, L4-T4 |
| §2 | Écrans : À traiter, Détail, Impact élevé, Question, Transmise, Incertaine, Déjà traitée, Fil, Terminal, Agents, Connexion perdue, Notification, Connecter le téléphone | L1-T12, L1-T13 ; L2-T9, L2-T10 ; L3-T4, L3-T5, L3-T6 ; L4-T4 |
| §2.1 | Règles d'état (liste vide, filtre vide, saisie désactivée hors disponibilité, brouillon conservé, « Pris par le terminal ») | L1-T13, L2-T9, L3-T5 |
| §3 Transport | Tailscale Serve, loopback, `/m/` sur la même origine | T0, L1-T8, L1-T10, L1-T14 |
| §3 Authentification | Jeton par appareil quel que soit `Origin`, séparation local/distant, liste d'opérations | L1-T4, L1-T6, L1-T8 |
| §3 | Appairage (QR + 6 chiffres, 2 min), révocation, `auth` en premier message, journalisation | L1-T6, L1-T7, L1-T8, L1-T9, L1-T12 |
| §4 | Classement du risque, inconnu = élevé, fonction pure testée sur cas réels | L2-T2 |
| §4 | WebAuthn avec UV, vérifié avant injection, défi lié à la demande, à sa version et à la décision ; `rpId` = domaine | L1-T7, L2-T4, L2-T5, L2-T10 |
| §4 | Aucune file hors ligne, réception incertaine, décision obsolète refusée | L2-T3, L2-T5, L2-T8, L2-T9 |
| §5 | Messages du protocole, compatibilité avec les clients locaux | L1-T1, L2-T1, L2-T6, L3-T1, L4-T1, L5-T1 |
| §5 | Acquittements, consultation après reconnexion, idempotence, échanges de défis | L2-T1, L2-T3, L2-T4, L2-T8 |
| §6 | Historique des tours (prompts, réponses, décisions et leur source ; 200 ; effacé avec la session ; redémarrage) | L3-T2, L3-T3 |
| §6 | Web Push (VAPID au premier appairage, contenu sans commande, ouverture du détail) ; badge | L4-T2, L4-T3, L4-T4 |
| §6 | Fichiers PWA sous `/m/` avec manifeste et service worker | L1-T10 |
| §7 | `apps/mobile`, réutilisation par paquet partagé, thème, tailles, safe areas, mouvement réduit, 320/390/430 | L1-T3, L1-T10, L1-T13 et e2e de chaque lot |
| §7.1 | Référence visuelle | L1-T10 (jetons), revue visuelle de chaque tâche d'écran |
| §8 | Réponses étendues par adaptateur, masquées si non supportées | L5-T1 à L5-T4 |
| §9 | Découpage en cinq lots, aucune décision distante avant les garanties | Plans 1 à 5, porte L2-T7 |
| §10 | Critères d'acceptation | L1-T8 (non appairé, révocation) ; L2-T5 (push --force, unicité, A→B) ; L2-T8, L3-T5 (coupure, brouillon) ; L3-T2 (redémarrage) ; L4-T4 + R6 (notification) ; e2e de chaque lot |
| §11 | Points ouverts | D1 à D14, H1 à H11, Q1 à Q3 |
| §12 | Le prototype reste une référence visuelle | Aucun fichier de maquette modifié ; captures e2e comparées à la maquette dans chaque tâche d'écran |

Hors périmètre volontaire : `remember` et `note` (Q3, écartée le 2026-10-14), chat global, lancement depuis le téléphone, multi-PC.

## Validation sur appareils réels

À réaliser sur l'iPhone de l'utilisateur, PWA installée, à la fin du lot indiqué. Les résultats sont consignés dans `docs/spikes/2026-10-14-ledge-mobile-feasibility.md` (section « Validation »), avec la version d'iOS, de Tailscale et du daemon. Un lot n'est pas déclaré terminé tant que ses conditions ne sont pas cochées ou explicitement acceptées en échec par l'utilisateur.

| # | Lot | Condition | Attendu |
| --- | --- | --- | --- |
| R1 | 1 | iPhone en données mobiles, Tailscale actif ; puis Tailscale coupé | L'app charge et se connecte ; sans Tailscale, connexion perdue et dernier état lisible. |
| R2 | 1 | Appairage complet (QR, installation, code, Face ID ou code) ; app fermée 24 h ; iPhone redémarré | Toujours appairé. Un mauvais code affiche l'erreur ; un code de plus de 2 min est refusé. |
| R3 | 1 | « Retirer » dans Réglages › Mobile, app ouverte | La connexion se ferme en moins de 2 s et l'app revient à l'appairage. |
| R4 | 2 | `git push --force` vers un dépôt factice local (remote `file://`) ; annuler Face ID, puis confirmer | Annulation : rien n'est injecté, la demande reste. Confirmation : injection unique, « Autorisation prise en compte ». |
| R5 | 2 | Mode avion activé juste après « Autoriser une fois » | « Réception non confirmée », puis l'état exact après reconnexion ; aucun double envoi dans le pane. |
| R6 | 4 | Écran verrouillé, app fermée : 10 demandes successives | Notification sans commande à l'écran verrouillé ; l'appui ouvre la bonne demande, ou « Déjà traitée » ; badge exact. Délai médian et maximal relevés, sans engagement. |
| R7 | 3 | Clavier logiciel sur le fil, texte agrandi (Taille du texte au maximum), iPhone SE ou 320 px | Composer visible au-dessus du clavier, aucune action principale masquée, aucun débordement horizontal. |
| R8 | 2 | App verrouillée 10 min pendant une session active, puis rouverte | Reconnexion automatique, état rafraîchi, opérations ouvertes vérifiées. |
| R9 | 4 | Daemon sous systemd, avec et sans proxy | Push livré, ou échec journalisé dans `daemon.log` sans erreur pour l'utilisateur. |
| R10 | 5 | Réponse libre à une vraie question `AskUserQuestion` de Claude Code, depuis l'iPhone, clavier logiciel | Texte reçu mot pour mot par l'agent ; question suivante ou fin du dialogue ; « Autre réponse » absente pour Codex et Cursor Agent tant qu'ils ne sont pas vérifiés. |

## Auto-revue

- Couverture : chaque section de la spec renvoie à au moins une tâche (tableau ci-dessus). La spec ne détaillait pas l'enregistrement WebAuthn : D5 le fixe pendant l'appairage.
- Cohérence des noms : `pendingId`/`pendingVersion` désignent `Pending.id`/`Pending.version` dans tous les plans ; `MOBILE_COMMANDS` et `remoteMayRun()` (lot 1) sont étendus par les lots 2, 3 et 4 ; `operation.result.reason` utilise `OperationReasonSchema` (lot 2) dans les lots 3 et 5.
- Proportion : les six documents font environ huit fois la longueur de la spec, mais celle-ci couvre cinq lots et deux applications. Les plans fixent signatures, valeurs et assertions ; les corps de fonctions sont laissés à l'implémentation, sauf l'identité des demandes (lot 1, T2), la politique de risque (lot 2, T2), qui doit être validée telle quelle, et l'authentificateur logiciel des tests (lot 1, T7).
- Ordre des interfaces : `MobileControl` (lot 1, T6) reçoit `pairing` à la tâche 8, après la création de `Pairing` (T7). `runDecide`, `runAnswer` (lot 2), `runMessage` et `runInterrupt` (lot 3) vivent tous dans `daemon/decisions.ts`.

## Passage à l'exécution

Arbitrages Q1 à Q3 rendus le 2026-10-14. Reste à choisir le mode d'exécution. Recommandation : **piloté par sous-agents**, car les lots partagent beaucoup d'interfaces (protocole, contexte de pair, opérations), touchent à la sécurité et gagnent à une revue indépendante par tâche.
