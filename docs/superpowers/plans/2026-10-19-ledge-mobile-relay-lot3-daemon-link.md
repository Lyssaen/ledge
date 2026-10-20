# Ledge mobile, lot 3 : le daemon se relie au relais, lie des appareils et les révoque — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis Ledge Desktop › Réglages › Accès mobile, on active l'accès, on connecte le PC au relais par GitHub, on approuve un téléphone après comparaison d'un code, on le révoque. Le daemon tient la websocket sortante et ouvre un canal chiffré avec chaque appareil approuvé.

**Architecture:**
- **Daemon, `packages/ledge/src/mobile/` :**
  - `files.ts` garde dans `~/.ledge` la config, la session relais, la clé du PC et les appareils approuvés, tous en mode 0600 ;
  - `link.ts` tient la websocket sortante, avec reconnexion et backoff ;
  - `signin.ts` mène le device flow par les routes `/auth/device/*` du relais ;
  - `pairing.ts` mène, côté PC, l'échange engagement → offre → révélation → code ;
  - `channels.ts` répond aux `hello` des appareils approuvés et tient un canal `@ledge/seal` par socket d'appareil ;
  - `service.ts` assemble le tout. Il expose un état `MobileState` et des commandes, que `daemon/server.ts` relaie aux fronts locaux seulement.
- **Relais :** une route `POST /auth/devices/revoke` permet au PC de couper la session et le socket d'un appareil qu'il a révoqué.
- **Fronts :** `@ledge/fleet` reçoit l'état et envoie les commandes. Le desktop ajoute la section « Accès mobile » et la popup « Lier un appareil », d'après la maquette validée.
- **Ce que voit le relais :** le relais ne lit rien. La liaison passe en clair dans `body`, mais elle ne transporte que des clés publiques, des nonces et un libellé. Elle est protégée par l'engagement, et par le code comparé des deux côtés.

**Tech Stack:** TypeScript strict (NodeNext), Node ≥ 22, zod 3, ws 8, WebCrypto (`globalThis.crypto.subtle`) via `@ledge/seal`, vitest 4, tsup. Desktop : React 19, Vite, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md`. Autres références :
- feuille de route : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md` ;
- lots précédents : `…-lot1-seal-relay.md`, `…-lot2-accounts.md` ;
- maquette : `docs/mockups/ledge-mobile-access.html`, sources dans `docs/mockups/mobile-access/`.

## Global Constraints

- **Liaison :** « Le PC et le téléphone affichent un même code court calculé à partir des deux clés publiques ; l'utilisateur le compare et confirme sur le PC et sur le téléphone. Le PC enregistre alors la clé de l'appareil comme approuvée (localement, c'est la source de vérité ; l'état serveur n'est qu'indicatif pour le routage). »
- **Filtrage :** « Le daemon ignore tout message qui ne provient pas d'une clé qu'il a lui-même approuvée. » Un appareil est identifié par l'empreinte de sa clé, jamais par l'id de pair que donne le relais.
- **Révocation :** « depuis l'overlay : le PC retire la clé localement et le serveur ferme les sockets de l'appareil ».
- **Connexion :** « Le daemon, quand on l'active depuis l'overlay, ouvre une websocket sortante vers Railway et la maintient. » Désactivé, il n'ouvre rien et n'appelle pas le relais.
- **Domaine :** « Le daemon et l'overlay l'ont par défaut et permettent de le changer » : `DEFAULT_RELAY_URL = 'https://server.ledge.paradow.dev'`.
- **Fichiers :** dans `~/.ledge` (`paths()`), écrits en entier par renommage d'un fichier temporaire, en mode 0600 :
  - `mobile.json` (config) ;
  - `mobile-session.json` (jeton relais, login, accountId) ;
  - `mobile-key` (PKCS8 base64url de la clé du PC) ;
  - `devices.json` (appareils approuvés).
- **Secrets et logs :** le jeton de session relais, le `deviceCode`, la clé privée, les nonces et le contenu des messages n'apparaissent jamais dans un log, dans un message d'erreur, ni dans `MobileState`. Le log du daemon peut nommer une empreinte d'appareil, un id de pair, un code de fermeture.
- **Isolation :** l'état mobile est envoyé aux fronts locaux seulement (`localClients`), jamais à un pair distant ni sur `/ssh/`.
- **Cryptographie :** primitives standard via `@ledge/seal` (WebCrypto), sans crypto maison. Le daemon embarque `@ledge/seal` comme il embarque `@ledge/protocol`, par `noExternal` dans tsup.
- **Imports :** imports relatifs en `.js`, `engines.node >= 22`, `zod ^3.23.8`, `ws ^8.18.0`.
- **Interface :** textes en français et en anglais, dans les fichiers i18n du desktop (`apps/desktop/src/i18n/`). Les textes français sont ceux de la maquette, mot pour mot.

## Reporté par la revue du lot 1 (feuille de route)

| Règle | Tâche |
| --- | --- |
| un canal vit le temps d'une paire de sockets : chaque `welcome` et chaque `hello` reçu ouvre un canal neuf | Task 6 |
| `error` du relais sur un corps scellé (`offline`, `too_large`, 4008) ou `SealError` `gap` ⇒ nouvelle poignée de main | Task 6 (`rekey`) |
| confirmation de clé, ou empreinte des clés statiques dans le `hello` | Task 1 (`f` dans `hello`) et Task 6 (`ready` scellé des deux côtés) |
| longueur des clés et des nonces validée à la révélation du code | Task 5 |
| clé publique dérivée du PKCS8 stocké | Task 1 (`importIdentity(pkcs8)`) et Task 3 |

Points du lot 2 traités ici : aucun. Les points reportés du lot 2 (Max-Age du cookie, limite de fréquence, `__Host-`, purge) restent pour le lot 7.

## Review Focus

1. **Un relais malveillant se fait passer pour un appareil approuvé.** Il réutilise l'id de pair d'un appareil approuvé, ou rejoue un ancien `hello`. Attendu : aucun canal confirmé, car sans la clé privée de l'appareil son `ready` ne s'ouvre pas, et aucun message n'atteint `onMessage` (Task 6).
2. **Le relais fabrique une révélation qui ne correspond pas à l'engagement,** ou envoie une clé ou un nonce de mauvaise longueur. Attendu : la liaison est abandonnée, `pair_no` est envoyé, rien n'est montré au desktop (Task 5).
3. **Le relais est injoignable, ou répond 503 à l'upgrade, en boucle.** Attendu : nouvel essai à 1, 2, 4… s, plafonné à 60 s, et l'état dit « Hors ligne » avec l'heure du prochain essai. Ni jeton ni `deviceCode` n'apparaît dans `link.error` ni dans le log (Task 4).
4. **Un appareil est révoqué pendant que son canal est ouvert.** Attendu : son prochain message est ignoré et reçoit `denied`. Son canal est fermé tout de suite. Le relais reçoit `POST /auth/devices/revoke` pour son dernier id de pair, et le révoquer à nouveau ne fait rien (Tasks 2 et 7).
5. **Deux demandes de liaison arrivent en même temps, ou une quatrième alors que trois attendent.** Attendu : chacune a son code et sa popup, la quatrième reçoit `pair_no`. Une demande non traitée expire au bout de 5 min et passe à `expired` (Task 5).

---

### Task 1: `@ledge/seal` et les trames du canal

**Files:**
- Modify: `packages/seal/src/identity.ts`, `packages/protocol/src/relay.ts`
- Create: `packages/seal/src/fingerprint.ts` (exporté par `index.ts`)
- Test: `packages/seal/test/identity.test.ts`, `packages/seal/test/fingerprint.test.ts`, `packages/protocol/test/relay.test.ts`

**Interfaces:**
- Produces:
  - `importIdentity(pkcs8: string): Promise<Identity>` remplace `importIdentity(pkcs8, publicKey)`. La clé publique est dérivée de la clé privée : import `extractable: true`, puis export `jwk` (`x`, `y`) et reconstruction du point non compressé `0x04 ‖ x ‖ y`. Le point obtenu passe par `importPublicKey`.
  - `fingerprint(publicKey: string): Promise<string>` : les 22 premiers caractères de `b64u(SHA-256("ledge-key/1" ‖ point brut))`. Elle lève `SealError('bad_key')` sur un point invalide.
  - Dans `relay.ts`, `SealedFrameSchema` devient :
    - `hello { e, f }`, où `f` est l'empreinte de la clé statique de l'émetteur ;
    - `msg { s }` ;
    - `pair_commit { c, label }` ;
    - `pair_offer { pc, n }` ;
    - `pair_reveal { d, n }` ;
    - `pair_ok {}`, `pair_no {}` ;
    - `denied {}`, `rekey {}`.
  - Bornes, toutes en base64url : clé `^[A-Za-z0-9_-]{87}$`, nonce et engagement `{43}`, empreinte `{22}`. `label` est une chaîne de 1 à 40 caractères après `trim`.
  - `PAIR_LABEL_MAX = 40` est exporté.

- [ ] **Step 1: Write the failing tests**
  - `identity.test.ts` : `importIdentity(await exportIdentity(id))` rend `publicKey === id.publicKey`, et un ECDH avec la clé importée donne les mêmes bits qu'avec l'original. `importIdentity('AAAA')` rejette.
  - `fingerprint.test.ts` :
    - 22 caractères base64url ;
    - stable pour une même clé, différente pour deux clés ;
    - `fingerprint('AAAA')` rejette avec `code: 'bad_key'`.
  - `relay.test.ts` (protocol) :
    - `SealedFrameSchema.parse({ k: 'hello', e: <87 car.> })` lève, parce que `f` manque ;
    - un `pair_commit` dont le `label` fait 41 caractères lève ;
    - `pair_reveal` avec `n` de 42 caractères lève ;
    - chacune des neuf variantes valides passe.
- [ ] **Step 2:** `pnpm --filter @ledge/seal test` et `pnpm --filter @ledge/protocol test`. Attendu : FAIL sur ces tests.
- [ ] **Step 3:** Implémenter. Mettre à jour les appels existants de `importIdentity` (tests du lot 1, test end-to-end du relais) et le commentaire d'en-tête de `pairing.ts`, qui donne l'ordre des messages : nommer les trames `pair_*`.
- [ ] **Step 4:** Les deux suites, puis `pnpm --filter @ledge/relay test` et `pnpm -r typecheck`. Attendu : PASS.
- [ ] **Step 5:** Commit `feat(seal): public key derived from the stored PKCS8, key fingerprints, pairing and rekey frames`.

### Task 2: le relais révoque un appareil à la demande du PC

**Files:**
- Modify: `apps/relay/src/store.ts`, `apps/relay/src/routes.ts`, `apps/relay/src/log.ts`, `packages/protocol/src/relayAuth.ts`
- Test: `apps/relay/test/store.test.ts`, `apps/relay/test/accounts.test.ts`

**Interfaces:**
- Produces:
  - `Store.revokePeerSessions(accountId: string, peer: RelayPeer): Promise<number>` révoque les sessions vivantes de ce pair dans ce compte.
  - `POST /auth/devices/revoke`, corps `{ peer: RelayPeer }`. `peer` doit être un id d'appareil (`d_…`), sinon 400.
    - Authentification : une session `kind: 'pc'` par Bearer ou sous-protocole seulement. Un cookie ou une session d'appareil reçoit 401.
    - Effet : `revokePeerSessions`, puis `kick(accountId, peer, RELAY_CLOSE_SIGNED_OUT, 'signed_out')`.
    - Réponse `200 { revoked: number }`, que la protocol exporte sous `DeviceRevokeResponseSchema`.
  - Log `{ ev: 'device_revoked'; account: string; peer: string; count: number }`.

- [ ] **Step 1: Write the failing tests**
  - store : deux sessions d'un même appareil et une d'un autre ; `revokePeerSessions` rend 2, et l'autre session reste trouvable.
  - routes, sur le harnais de `accounts.test.ts` :
    - PC connecté et appareil connecté ⇒ réponse `{ revoked: 1 }`, socket de l'appareil fermé en 4001, son jeton refusé à `/auth/me` ;
    - le jeton d'un appareil ⇒ 401 ;
    - cookie ⇒ 401 ;
    - `peer: 'pc'` ⇒ 400 ;
    - l'appareil d'un autre compte ⇒ `{ revoked: 0 }`, et son socket reste ouvert.
- [ ] **Step 2:** `pnpm --filter @ledge/relay test`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter. Ajouter la route au `switch` de `authRoutes`, sur le modèle de `logout`.
- [ ] **Step 4:** `pnpm --filter @ledge/relay test`, avec `LEDGE_RELAY_TEST_DATABASE_URL` si un Postgres est disponible. Attendu : PASS.
- [ ] **Step 5:** Commit `feat(relay): the PC revokes a device's sessions and closes its socket`.

### Task 3: les fichiers du daemon (config, session, clé, appareils)

**Files:**
- Create: `packages/ledge/src/mobile/files.ts`, `packages/protocol/src/mobile.ts` (exporté par `index.ts`)
- Modify: `packages/ledge/src/paths.ts`, `packages/ledge/package.json` (`@ledge/seal: workspace:*` en devDependency), `packages/ledge/tsup.config.ts` (`noExternal: ['@ledge/protocol', '@ledge/seal']`)
- Test: `packages/ledge/test/mobile-files.test.ts`

**Interfaces:**
- Produces, dans `packages/protocol/src/mobile.ts` :
  - `DEFAULT_RELAY_URL = 'https://server.ledge.paradow.dev'`.
  - `RelayUrlSchema` : une URL réduite à son origine (pas de chemin, de requête ni de fragment ; une barre finale est retirée avant la validation).
    - Schéma `https:`, ou `http:` seulement pour `localhost` et `127.0.0.1`.
    - Le schéma transforme la valeur en `new URL(v).origin`.
  - `MobileConfigSchema = z.object({ enabled: z.boolean(), relayUrl: RelayUrlSchema })`.
- Produces, dans `files.ts` : chaque lecture rend la valeur par défaut, ou `null`, si le fichier est absent ou invalide. Un fichier invalide est signalé dans le log, sans son contenu.

  | Fonction | Fichier | Absent ou invalide |
  | --- | --- | --- |
  | `readMobileConfig(): MobileConfig`, `writeMobileConfig(c): void` | `mobile.json` | `{ enabled: false, relayUrl: DEFAULT_RELAY_URL }` |
  | `readRelaySession(): RelaySession \| null`, `writeRelaySession(s): void`, `clearRelaySession(): void` | `mobile-session.json` | `null` |
  | `loadPcIdentity(): Promise<Identity>` | `mobile-key` | une clé est créée (`generateIdentity({ extractable: true })`, puis `exportIdentity`) |
  | `readDevices(): ApprovedDevice[]`, `writeDevices(list): void` | `devices.json` | `[]` |

  - `RelaySession = { token: string; accountId: string; login: string; relayUrl: string }`. La session est liée à son relais : `readRelaySession` rend `null` si son `relayUrl` n'est pas celui de la config.
  - `loadPcIdentity` dérive la clé publique avec `importIdentity(pkcs8)` ; elle ne lit jamais une copie de la clé publique.
  - `ApprovedDevice = { id: string; publicKey: string; label: string; approvedAt: string; lastPeer?: string; lastSeenAt?: string }`, où `id` est `fingerprint(publicKey)`.
  - `paths()` gagne `mobile`, `mobileSession`, `mobileKey`, `devices`.
  - L'écriture passe par `${file}.${pid}.tmp`, en `mode: 0o600` puis `chmod 0o600`, et finit par `renameSync`, sur le modèle de `daemon/island.ts`.

- [ ] **Step 1: Write the failing tests** (`LEDGE_HOME` temporaire, comme `test/isolate-home.ts`)
  - config absente ⇒ défaut ;
  - `RelayUrlSchema` :
    - `https://relay.example/` donne `https://relay.example` ;
    - `http://relay.example` est refusé ;
    - `http://localhost:8080` est accepté ;
    - `https://relay.example/x` est refusé ;
  - chaque fichier écrit a le mode `0o600` (`statSync(f).mode & 0o777`) ;
  - `loadPcIdentity` deux fois rend la même `publicKey`, et le fichier `mobile-key` ne contient que le PKCS8 ;
  - une session écrite pour `https://a.example` est `null` quand la config vise `https://b.example` ;
  - un `devices.json` corrompu ⇒ `[]`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-files`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Le test passe. `pnpm --filter @paradow/ledge build` termine, et `grep -c "@ledge/seal" dist/cli/index.js` rend 0 : seal est embarqué, pas importé.
- [ ] **Step 5:** Commit `feat(ledge): mobile access files: config, relay session, the PC's key and approved devices`.

### Task 4: la websocket sortante et la connexion GitHub du PC

**Files:**
- Create: `packages/ledge/src/mobile/link.ts`, `packages/ledge/src/mobile/signin.ts`, `packages/ledge/test/mobile-relay-harness.ts`
- Test: `packages/ledge/test/mobile-link.test.ts`, `packages/ledge/test/mobile-signin.test.ts`

**Interfaces:**
- Consumes : `RelaySession` (Task 3) ; `RelayServerMessageSchema`, `RelayClientMessage`, `DeviceStartResponseSchema`, `DevicePollResponseSchema` et `RELAY_CLOSE_SIGNED_OUT` (protocol).
- Produces, dans `link.ts` :
  - `type LinkState = { state: 'off' } | { state: 'connecting' } | { state: 'online' } | { state: 'offline'; retryAt: string; error: string } | { state: 'signed_out'; reason: 'other_pc' | 'session_invalid' }`.
  - `createRelayLink(opts: { relayUrl: string; token: string; onState(s: LinkState): void; onMessage(m: RelayServerMessage): void; now?: () => number; random?: () => number; WebSocketImpl?: typeof WebSocket }): { send(m: RelayClientMessage): boolean; retryNow(): void; close(): void }`.
  - Connexion : `wss://…/ws` (`ws://` pour `http:`) avec l'en-tête `Authorization: Bearer <token>`.
  - Backoff : 1 s, ×2 à chaque échec, plafonné à 60 s, avec un jitter de ±20 % (`random`). Il revient à 1 s à chaque `welcome`.
  - Ping toutes les 25 s ; sans pong en 10 s, `terminate`, puis reconnexion.
  - Fermeture 4001 ⇒ `signed_out` / `other_pc`, sans nouvel essai. Upgrade refusé en 401 (`unexpected-response`) ⇒ `signed_out` / `session_invalid`, sans nouvel essai.
  - Toute autre fermeture, ou un 503, ⇒ `offline` puis nouvel essai. `error` est le message réseau, coupé à 200 caractères.
  - Une trame qui ne passe pas `RelayServerMessageSchema` est ignorée et notée dans le log, sans son contenu.
  - `send` rend `false` hors `online`.
- Produces, dans `signin.ts` :
  - `startSignIn(opts: { relayUrl: string; onCode(c: { userCode: string; verificationUri: string; expiresAt: string }): void; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): { result: Promise<SignInResult>; cancel(): void }`.
  - `SignInResult = { status: 'ok'; session: RelaySession } | { status: 'expired' | 'denied' | 'not_allowed' | 'cancelled' } | { status: 'failed'; error: string }`.
  - Appels : `POST /auth/device/start`, puis `POST /auth/device/poll { deviceCode }` toutes les `interval` secondes. `slow_down` remplace l'intervalle. Chaque appel est borné par `AbortSignal.timeout(15_000)`.
  - Le `deviceCode` ne sort jamais de `signin.ts`.
  - `signOut(session: RelaySession, fetchImpl?): Promise<void>` : `POST /auth/logout` avec le Bearer. Une erreur réseau est avalée.
- Harnais de test, `mobile-relay-harness.ts` :
  - `startTestRelay(opts?: { auth?: HttpHandler }): Promise<{ url: string; pcToken: string; deviceToken(peer: string): string; relay: { close(): Promise<void> } }>` ;
  - il démarre le vrai relais : `createRelay` avec `devTokens`, importés par chemin relatif depuis `../../../apps/relay/src/`. `auth` lui sert de point d'extension `http` pour simuler `/auth/*`.
  - Ruling si `tsc` refuse ces imports relatifs : ajouter `@ledge/relay: workspace:*` en devDependency et un champ `exports` minimal à `apps/relay/package.json`.

- [ ] **Step 1: Write the failing tests**
  - link, contre `startTestRelay` :
    - jeton valide ⇒ états `connecting` puis `online`, et le `welcome` arrive à `onMessage` ;
    - jeton inconnu ⇒ `signed_out` / `session_invalid`, et aucun nouvel essai pendant 5 s simulées ;
    - un appareil envoie une trame ⇒ `deliver` arrive à `onMessage` ;
    - un `kick` 4001 ⇒ `signed_out` / `other_pc` ;
    - relais arrêté ⇒ `offline`, et les délais d'essai valent 1, 2, 4… jusqu'à 60 s avec `random = () => 0.5` (horloge simulée) ;
    - redémarrer le relais sur le même port ⇒ retour à `online`, et le délai revient à 1 s ;
    - le jeton n'apparaît dans aucun `LinkState` sérialisé.
  - signin, avec un `fetchImpl` simulé :
    - `pending`, `slow_down` (l'intervalle passe à 10), puis `ok` ⇒ `status: 'ok'`, avec `relayUrl` dans la session ;
    - `not_allowed`, `expired` et `denied` sont rendus tels quels ;
    - `cancel()` pendant l'attente ⇒ `cancelled`, et plus aucun appel ;
    - un `fetch` qui lève ⇒ `failed`, et `error` ne contient pas le `deviceCode`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-link mobile-signin`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** PASS, puis `pnpm --filter @paradow/ledge typecheck`.
- [ ] **Step 5:** Commit `feat(ledge): outgoing relay websocket with backoff, and GitHub device-flow sign-in through the relay`.

### Task 5: la liaison côté PC

**Files:**
- Create: `packages/ledge/src/mobile/pairing.ts`, `packages/ledge/test/mobile-fake-device.ts`
- Test: `packages/ledge/test/mobile-pairing.test.ts`

**Interfaces:**
- Consumes : `commit`, `checkCommitment`, `pairingCode`, `randomNonce`, `importPublicKey`, `fingerprint` et `fromB64u` (seal) ; `SealedFrameSchema` (Task 1) ; `ApprovedDevice` (Task 3).
- Produces :
  - `type PairingView = { id: string; label: string; code: string | null; expiresAt: string; state: 'waiting' | 'confirm' | 'approved' | 'linked' | 'expired' | 'refused' }`.
    - `waiting` : engagement reçu, pas encore de révélation.
    - `confirm` : code calculé, la décision attend sur le PC.
    - `approved` : approuvée sur le PC, on attend le premier canal confirmé de cet appareil.
    - `linked` : ce canal est confirmé.
  - `createPairing(opts: { pc: Identity; send(peer: string, frame: SealedFrame): void; approve(d: Omit<ApprovedDevice, 'lastSeenAt'>): void; onChange(): void; now?: () => number; ttlMs?: number }): { receive(peer: string, frame: SealedFrame): Promise<boolean>; approve(id: string): void; deny(id: string): void; linked(deviceId: string): void; views(): PairingView[]; reset(): void; stop(): void }`.
  - `receive` rend `true` si la trame était une `pair_*`.
  - `PAIRING_TTL_MS = 5 * 60_000`, `MAX_PAIRINGS = 3`.
  - Ordre de l'échange :
    1. `pair_commit` d'un pair : une liaison neuve, qui remplace celle du même pair. `id` est 16 octets aléatoires en base64url. Le PC tire un nonce et répond `pair_offer { pc: pc.publicKey, n }`.
    2. `pair_reveal` :
       - la clé et le nonce sont validés : `importPublicKey`, et `fromB64u(n).length === 32` ;
       - puis `checkCommitment` ;
       - sinon `pair_no`, et la liaison disparaît sans jamais avoir été visible.
       - Si tout passe : `code = pairingCode(…)` et `state: 'confirm'`.
    3. `approve(id)` (seulement en `confirm`) : appelle `opts.approve({ id: fingerprint(d), publicKey: d, label, approvedAt, lastPeer: peer })`, envoie `pair_ok`, passe à `approved`.
    4. `deny(id)` : `pair_no`, puis `refused`.
  - Une liaison `expired`, `refused` ou `linked` reste visible 10 s, pour la popup, puis disparaît.
  - `reset()` (nouveau `welcome`) abandonne les liaisons `waiting` et `confirm`.
  - Le `label` est nettoyé : caractères de contrôle retirés, `trim`, coupé à `PAIR_LABEL_MAX`. Vide, il devient `'Appareil'`.
- Harnais `mobile-fake-device.ts` :
  - `fakeDevice(opts: { relayUrl: string; token: string; peer: string; label?: string }): Promise<FakeDevice>` ;
  - `FakeDevice` : `pair(): Promise<{ code: string; result: Promise<'ok' | 'no'> }>`, `hello(): Promise<void>`, `send(text: string): Promise<void>`, `received: string[]`, `frames: SealedFrame[]`, `close()`.
  - Il suit, avec `@ledge/seal`, le rôle du téléphone, que le lot 5 portera dans la PWA.

- [ ] **Step 1: Write the failing tests** (sur `startTestRelay` et `createRelayLink` de la Task 4)
  - L'appareil appaire ⇒ une vue `confirm` dont le `code` est celui calculé par l'appareil. `approve` ⇒ l'appareil reçoit `pair_ok`, et `opts.approve` est appelé avec `id === fingerprint(clé de l'appareil)`.
  - `deny` ⇒ `pair_no`, puis `refused`.
  - Révélation avec un nonce différent de l'engagement ⇒ `pair_no`, et aucune vue `confirm` n'a existé (`onChange` espionné).
  - Révélation avec `d` sur 87 caractères qui n'est pas un point P-256 ⇒ `pair_no`.
  - Quatre `pair_commit` de quatre pairs ⇒ trois vues, le quatrième reçoit `pair_no`.
  - Horloge simulée à 5 min + 1 ms ⇒ `expired` ; après 10 s de plus, la vue disparaît.
  - Label `"\u0007  Pixel · Chrome  "` ⇒ `"Pixel · Chrome"`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-pairing`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ledge): device pairing on the PC: commitment, offer, reveal, code, approval`.

### Task 6: les canaux chiffrés avec les appareils approuvés

**Files:**
- Create: `packages/ledge/src/mobile/channels.ts`
- Test: `packages/ledge/test/mobile-channels.test.ts`

**Interfaces:**
- Consumes : `startHandshake`, `fingerprint` et `SealError` (seal) ; `ApprovedDevice` (Task 3) ; `FakeDevice` (Task 5).
- Produces :
  - `createChannels(opts: { pc: Identity; devices(): ApprovedDevice[]; send(peer: string, frame: SealedFrame): void; onConfirmed(deviceId: string, peer: string): void; onMessage(deviceId: string, text: string): void; onClosed(deviceId: string): void; now?: () => number }): { receive(peer: string, frame: SealedFrame): Promise<void>; send(deviceId: string, text: string): Promise<boolean>; drop(peer: string): void; dropDevice(deviceId: string): void; reset(): void; online(): Set<string> }`.
  - Le PC ne fait que répondre. À un `hello { e, f }` d'un pair :
    - si `f` n'est l'empreinte d'aucun appareil approuvé ⇒ `denied` ;
    - sinon, une poignée de main neuve avec la clé approuvée (`startHandshake(pc, 'pc', device.publicKey)`). Le PC répond `hello { e: hs.hello, f: fingerprint(pc.publicKey) }` et remplace le canal existant de ce pair.
  - Confirmation de clé : le premier `msg` ouvert de l'appareil doit être `{"t":"ready"}`. Le PC répond alors `{"t":"ready"}` scellé et appelle `onConfirmed`. Un premier message différent ferme le canal et provoque `rekey`.
  - Après la confirmation, chaque `msg` ouvert va à `onMessage`.
  - Erreurs d'ouverture :
    - `gap` et `bad_seal` ⇒ canal fermé, puis `rekey` ;
    - `replay` ⇒ trame ignorée ;
    - un `msg` sans canal ⇒ `rekey`.
    - `rekey` part au plus une fois par pair toutes les 2 s.
  - Un `msg` ou un `hello` dont l'empreinte n'est plus approuvée (appareil révoqué) ⇒ `denied`, sans rien ouvrir.
  - Fermetures :
    - `drop(peer)` sert pour `presence` hors ligne, et pour une `error` `offline` ou `too_large` qui nomme ce pair ;
    - `reset()` sert au `welcome` ;
    - `dropDevice(id)` sert à la révocation ;
    - chacune ferme les canaux concernés et appelle `onClosed` pour un appareil qui n'a plus de canal confirmé.
  - `send` rend `false` sans canal confirmé.

- [ ] **Step 1: Write the failing tests**
  - Un appareil approuvé fait `hello`, puis `ready` ⇒ `onConfirmed(id, peer)` ; ses `send('x')` arrivent à `onMessage(id, 'x')` ; `send(id, 'y')` du PC arrive dans `received` de l'appareil.
  - Un appareil non approuvé fait `hello` ⇒ `denied`, rien dans `onConfirmed`.
  - Usurpation : un second faux appareil, avec une autre clé, envoie un `hello` qui porte l'empreinte de l'appareil approuvé, puis un `ready` scellé avec sa propre clé ⇒ aucun `onConfirmed`, aucun `onMessage`, et `rekey` envoyé.
  - Le relais renvoie une trame déjà livrée ⇒ ignorée, le canal continue.
  - Trame perdue (on saute une séquence) ⇒ `rekey`. Un nouveau `hello` de l'appareil ⇒ le canal repart et les messages repassent.
  - `reset()` ⇒ `online()` vide, et un `msg` qui arrive ensuite ⇒ `rekey`.
  - `dropDevice` puis un `msg` de cet appareil ⇒ `denied`.
  - Deux `rekey` provoqués à 1 s d'intervalle ⇒ un seul envoyé.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-channels`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ledge): sealed channels with approved devices: responder handshake, key confirmation, rekey`.

### Task 7: le service mobile et les messages du daemon

**Files:**
- Create: `packages/ledge/src/mobile/service.ts`
- Modify: `packages/protocol/src/mobile.ts`, `packages/protocol/src/messages.ts`, `packages/ledge/src/daemon/server.ts`, `packages/ledge/src/daemon/index.ts`
- Test: `packages/ledge/test/mobile-service.test.ts`, `packages/ledge/test/server.test.ts`

**Interfaces:**
- Consumes : Tasks 3 à 6.
- Produces, dans `packages/protocol/src/mobile.ts` :
  - `MobileStateSchema` :
    ```ts
    z.object({
      enabled: z.boolean(), relayUrl: z.string(),
      account: z.object({ login: z.string(), accountId: z.string() }).nullable(),
      signin: z.object({ userCode: z.string(), verificationUri: z.string(), expiresAt: z.string().datetime() }).nullable(),
      /** The last sign-in that did not end with a session; cleared by the next one. */
      signinError: z.enum(['expired', 'denied', 'not_allowed', 'failed']).nullable(),
      link: z.discriminatedUnion('state', [/* the five LinkState shapes of Task 4 */]),
      devices: z.array(z.object({ id: z.string(), label: z.string(), approvedAt: z.string(), online: z.boolean(), lastSeenAt: z.string().optional() })),
      pairings: z.array(/* PairingView of Task 5 */)
    })
    ```
  - Messages du front vers le daemon, ajoutés à `ClientMessageSchema` :
    - `mobile.set { enabled: boolean; relayUrl: string }` ;
    - `mobile.signin`, `mobile.signin.cancel`, `mobile.signout`, `mobile.retry` ;
    - `mobile.pairing.approve { id }`, `mobile.pairing.deny { id }` ;
    - `mobile.device.revoke { id }`.
  - Message du daemon vers le front, ajouté à `ServerMessageSchema` : `{ type: 'mobile'; state: MobileState }`.
  - `DaemonInfo` gagne `mobile: z.boolean().optional()`, que le serveur met à `true` comme il le fait pour `routing` et `archive`.
- Produces, dans `service.ts` :
  - `createMobileService(opts?: { fetchImpl?; WebSocketImpl?; now? }): Promise<{ state(): MobileState; onChange(fn: () => void): () => void; handle(msg: MobileClientMessage): Promise<void>; send(deviceId: string, text: string): Promise<boolean>; onMessage(fn: (deviceId: string, text: string) => void): () => void; stop(): Promise<void> }>`.
  - Comportement :
    - **`mobile.set` :** écrit la config. Un `relayUrl` changé efface la session. Activé avec une session ⇒ link ouvert ; désactivé ⇒ link fermé, `link: { state: 'off' }`.
    - **`mobile.signin` :** refusé si l'accès est désactivé. Lance `startSignIn`, `signin` porte le code. `ok` ⇒ session écrite et link ouvert. Les autres issues remplissent `signinError` et vident `signin`.
    - **`mobile.signout` :** `signOut`, session effacée, link fermé. Les appareils restent approuvés.
    - **Messages du relais :**
      - `welcome` ⇒ `channels.reset()` et `pairing.reset()` ;
      - `deliver` ⇒ `SealedFrameSchema.safeParse(JSON.parse(body))` ; une trame invalide est ignorée. Les `pair_*` vont à `pairing`, `hello` et `msg` vont à `channels` ;
      - `presence` hors ligne et `error` qui nomme un pair ⇒ `channels.drop(peer)`.
    - **Approbation :** `approve` ajoute l'appareil à `devices.json`, ou remplace son libellé s'il existe déjà. `onConfirmed` met à jour `lastPeer` et `lastSeenAt`, puis appelle `pairing.linked(id)`.
    - **`mobile.device.revoke` :**
      1. retire l'appareil de `devices.json` ;
      2. appelle `channels.dropDevice` et envoie `denied` à `lastPeer` ;
      3. si le link est `online`, appelle `POST /auth/devices/revoke { peer: lastPeer }`. Une erreur est notée dans le log, sans relancer.
    - **Erreurs :** une commande invalide dans l'état courant (approuver une liaison inconnue, se connecter désactivé) lève une `Error` au message court. `server.ts` la renvoie au front comme les autres refus.
- Branchement :
  - `startServer` reçoit `mobile?: MobileService`.
  - `sendSnapshot` envoie `{ type: 'mobile', state }` après `island`.
  - `mobile.onChange` diffuse à `localClients` seulement.
  - `handle` aiguille les `mobile.*`.
  - `startDaemon` crée le service, le passe au serveur et l'arrête dans `stop`.
  - Sans `mobile`, ces messages reçoivent l'erreur « mobile access is not available ».

- [ ] **Step 1: Write the failing tests**
  - service, avec `startTestRelay` en simulant `/auth/device/*` et `/auth/devices/revoke` par son point d'extension `auth`, et `fakeDevice` :
    1. `set { enabled: true }` puis `signin` ⇒ `state().signin.userCode` rempli. Après le poll `ok`, `account.login` est rempli, `link.state` vaut `online`, et `mobile-session.json` existe en 0600.
    2. Liaison complète : `pairings[0].state` vaut `confirm`, avec le code de l'appareil. `approve` ⇒ `devices` contient l'appareil, l'appareil fait `hello`/`ready`, la liaison passe à `linked` et `devices[0].online` à `true`.
    3. `revoke` ⇒ `devices` vide, la route du relais est appelée avec le `lastPeer`, et le socket de l'appareil est fermé en 4001.
    4. `set { enabled: false }` ⇒ `link.state` vaut `off`, et aucune connexion vers le relais ne suit pendant 5 s simulées.
    5. Un `relayUrl` changé ⇒ `account` vaut `null`.
    6. `JSON.stringify(state())` ne contient ni le jeton relais, ni le `deviceCode`, ni le PKCS8.
  - `server.test.ts` :
    - un client local reçoit `{ type: 'mobile' }` après `island` dans le snapshot ;
    - `mobile.pairing.approve` sur un id inconnu ⇒ un `error` avec `request: 'mobile.pairing.approve'` ;
    - un client `/ssh/` ne reçoit jamais de message `mobile` ;
    - `DaemonInfo.mobile` vaut `true`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-service server`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/protocol test`, `pnpm -r typecheck`. Attendu : PASS.
- [ ] **Step 5: Vérification à la main** (consignée dans le rapport) :
  1. Relais en mode jetons de dev : `LEDGE_RELAY_DEV_TOKENS`, avec un jeton `pc` et un jeton d'appareil.
  2. Un daemon dans un `LEDGE_HOME` temporaire, avec `mobile-session.json` écrit à la main pour ce relais (`relayUrl: http://localhost:<port>`) ; puis `mobile.set { enabled: true }` par un petit client websocket.
  3. Un script qui utilise `fakeDevice` lie l'appareil, l'approuve, échange un message, puis le révoque.
  4. `daemon.log` ne contient ni le jeton ni le contenu.
- [ ] **Step 6:** Commit `feat(ledge): mobile access service: state and commands for the local fronts, wired into the daemon`.

### Task 8: `@ledge/fleet` porte l'état mobile

**Files:**
- Modify: `packages/fleet/src/fleet.ts`, `packages/fleet/src/machines.ts`, `packages/fleet/src/index.ts`
- Test: `packages/fleet/test/fleet.test.ts` (ou le fichier qui teste déjà `setIsland`)

**Interfaces:**
- Consumes : `MobileState` et les messages `mobile.*` (Task 7).
- Produces :
  - `Fleet.mobile(): MobileState | undefined` : `undefined` tant que le daemon local n'en a pas parlé. L'état est gardé pendant une coupure du daemon, comme `island`.
  - `Fleet.sendMobile(msg: Extract<ClientMessage, { type: \`mobile.${string}\` }>): void`. Elle lève `DaemonOffline` si le daemon local est coupé, et `DaemonOutdated` s'il n'a jamais envoyé `mobile`, sur le modèle de `setIsland`.
  - `useMobile(client: DaemonClient): MobileState | undefined`, sur le modèle de `useIsland`.
  - Les messages `mobile` ne viennent que du daemon local. Une machine distante qui en envoie un est ignorée.

- [ ] **Step 1: Write the failing tests**
  - un message `mobile` du daemon local met à jour `mobile()` et notifie les abonnés ;
  - le même message venu d'une machine distante ne change rien ;
  - `sendMobile` avant tout message `mobile` lève `DaemonOutdated` ;
  - daemon coupé ⇒ `DaemonOffline`.
- [ ] **Step 2:** `pnpm --filter @ledge/fleet test`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** PASS, puis `pnpm -r typecheck`.
- [ ] **Step 5:** Commit `feat(fleet): the local daemon's mobile access state and commands`.

### Task 9: la section « Accès mobile » du desktop

**Files:**
- Create: `apps/desktop/src/settings/Mobile.tsx`
- Modify:
  - `apps/desktop/src/nav/state.ts` : `SectionId` et `SECTIONS` gagnent `'mobile'`, entre `'machines'` et `'projects'` ;
  - `apps/desktop/src/settings/SettingsPage.tsx` : icône et corps ;
  - `apps/desktop/src/i18n/fr.ts` et `en.ts` ;
  - le CSS des réglages, pour les seules pièces nouvelles de la maquette.
- Test: `apps/desktop/test/settings-mobile.test.tsx` (sur le modèle des tests existants de `Machines` ou `Island`)

**Interfaces:**
- Consumes : `useMobile` et `Fleet.sendMobile` (Task 8) ; `Card`, `Row` et `SwitchRow` (`settings/controls.tsx`) ; `openUrl` (`tauri/bridge.ts`).
- La source de vérité est la maquette validée, `docs/mockups/ledge-mobile-access.html`, avec ses sources `docs/mockups/mobile-access/main.tsx` : mêmes cartes, mêmes lignes, mêmes textes français mot pour mot, mêmes états.

  | État de la maquette | Ce que la section reçoit |
  | --- | --- |
  | « Désactivé » | `enabled: false` |
  | « Connexion GitHub » | `signin` non nul |
  | « Connecté » | `link.state === 'online'` |
  | « Problèmes » a | `link.state === 'offline'` |
  | « Problèmes » b | `signinError === 'not_allowed'` |
  | « Problèmes » c | `link.state === 'signed_out'`, `reason: 'other_pc'` |

  `reason: 'session_invalid'` reprend le texte c, avec « La session n'est plus valide. » à la place de la cause.
- Commandes :
  - l'interrupteur et le champ « Serveur relais » envoient `mobile.set`. Le champ valide au blur ou à Entrée, avec `RelayUrlSchema` ; une URL refusée est dite sous le champ ;
  - « Ouvrir github.com/login/device » appelle `openUrl(signin.verificationUri)` ;
  - « Copier le code » utilise `navigator.clipboard.writeText` ;
  - « Révoquer » demande une confirmation en ligne, puis envoie `mobile.device.revoke`.
- Une ligne d'appareil en attente (`pairings` en `confirm`) affiche « Comparer le code », qui rouvre la popup de la Task 10.
- Si le daemon local ne connaît pas l'accès mobile (`mobile()` vaut `undefined` alors que le daemon est connecté), une carte unique dit qu'il faut le mettre à jour, avec le même texte que les autres sections pour ce cas.

- [ ] **Step 1: Write the failing tests** (rendu avec un faux `fleet`)
  - `enabled: false` ⇒ interrupteur décoché, champ et bouton GitHub désactivés ;
  - clic sur l'interrupteur ⇒ `sendMobile({ type: 'mobile.set', enabled: true, relayUrl })` ;
  - `signin` ⇒ le code `WDJB-MJHT` est affiché, et « Ouvrir… » appelle `openUrl` avec `verificationUri` ;
  - `link.offline` ⇒ « Hors ligne », puis l'erreur brute en `code` ;
  - Révoquer, puis Révoquer dans la confirmation ⇒ `mobile.device.revoke` avec l'id ;
  - « Annuler » n'envoie rien ;
  - `relayUrl` saisi `http://relay.example` ⇒ erreur sous le champ, rien n'est envoyé.
- [ ] **Step 2:** `pnpm --filter @ledge/desktop test settings-mobile`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** PASS, puis `pnpm --filter @ledge/desktop typecheck` et `pnpm --filter @ledge/desktop build`.
- [ ] **Step 5:** Commit `feat(desktop): Settings › Mobile access: relay, GitHub sign-in, linked devices and revocation`.

### Task 10: la popup « Lier un appareil » et sa notification

**Files:**
- Create: `apps/desktop/src/settings/PairingDialog.tsx` (ou sous `apps/desktop/src/shell/` si les dialogues globaux y vivent)
- Modify: `apps/desktop/src/App.tsx` (montage global), `apps/desktop/src/i18n/fr.ts` et `en.ts`, le module de notifications Windows qu'utilise `notify/useAlerts.ts`
- Test: `apps/desktop/test/pairing-dialog.test.tsx`

**Interfaces:**
- Consumes : `useMobile` et `sendMobile` (Task 8) ; la popup de la maquette, scénario 4, avec ses trois états.
- Comportement :
  - **Ouverture :** la popup s'ouvre sur n'importe quel écran dès qu'une liaison passe à `confirm`. Les liaisons en `confirm` se présentent une à la fois, la plus ancienne d'abord.
  - **Affichage :** le libellé, le code en grand, le compte (`account.login`) et le compte à rebours jusqu'à `expiresAt`.
  - **Décision :** « Approuver » envoie `mobile.pairing.approve`, « Refuser » envoie `mobile.pairing.deny`. Échap ou un clic hors de la popup ne refusent pas : ils ferment seulement la popup, et la ligne « Comparer le code » de la section la rouvre.
  - **États suivants :**
    - `approved` : « Approuvé sur ce PC. Confirmez maintenant sur le téléphone. », dans un `aria-live` ;
    - `linked` : « <libellé> est lié. » et « Fermer » ;
    - `expired` : « La demande a expiré. Recommencez depuis le téléphone. » et « Fermer » ;
    - `refused` : la popup se ferme.
  - **Notification :** une notification Windows « Un appareil demande l'accès » part par le même chemin que les alertes de session, si la fenêtre n'a pas le focus. Une seule par liaison, et aucune en mode Ne pas déranger.

- [ ] **Step 1: Write the failing tests**
  - une liaison `confirm` apparaît ⇒ `role="dialog"` affiche `482 913` ;
  - Approuver ⇒ `mobile.pairing.approve` avec l'id ;
  - l'état passe à `approved` ⇒ le texte d'attente ; puis à `linked` ⇒ « Pixel · Chrome est lié. » ;
  - Échap ⇒ fermée, rien n'est envoyé ;
  - deux liaisons `confirm` ⇒ la plus ancienne d'abord, puis la seconde après la décision ;
  - la notification part une fois par liaison, sans focus seulement, et jamais en Ne pas déranger.
- [ ] **Step 2:** `pnpm --filter @ledge/desktop test pairing-dialog`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** PASS. Puis la suite complète : `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter @ledge/desktop build`.
- [ ] **Step 5:** Commit `feat(desktop): the « Link a device » dialog on any screen, with a Windows notification`.

---

## Hors de ce lot

- Ce que le téléphone peut faire une fois lié (liste blanche, opérations, historique) : lot 4. `MobileService.onMessage` et `send` en sont le point d'entrée.
- La PWA et son rôle dans la liaison (engagement, confirmation côté téléphone, épinglage de la clé du PC, alerte « clé du PC changée ») : lot 5. Le faux appareil des tests en est la référence.
- WebAuthn et Web Push : lot 6. Domaine et déploiement : lot 7.
