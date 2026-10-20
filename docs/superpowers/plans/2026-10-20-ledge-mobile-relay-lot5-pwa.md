# Ledge mobile, lot 5 : la PWA du téléphone — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un téléphone ouvre la PWA servie par le relais, se connecte avec GitHub, se lie au PC en comparant un code, puis lit ses sessions, décide une demande, répond et interrompt, à travers le canal scellé du lot 3 et le protocole du lot 4. La version installée ne change qu'après accord explicite, avec son empreinte affichée.

**Architecture:**
- **`apps/mobile` (`@ledge/mobile`) :** React 19 + Vite. Les écrans et le modèle sont portés depuis `origin/mobile-ui` (commit `0973440`, à lire avec `git show 0973440:apps/mobile/<chemin>`). Leur couche connexion (`connection/*`) est jetée : elle est remplacée par `src/link/`.
- **`src/link/` :** toute la sécurité du téléphone, sans React.
  - `keys.ts` garde l'identité et la clé du PC épinglée dans IndexedDB ;
  - `socket.ts` tient la websocket `/ws` du relais (cookie) ;
  - `pairing.ts` mène la liaison ;
  - `channel.ts` mène le canal scellé ;
  - `link.ts` assemble le tout derrière une seule interface, `PhoneLink`.
- **`src/state/` :** le store applique les `PhoneServerMessage` et suit les opérations (uuid, `expect`, renvoi après reconnexion).
- **`src/sw/` :** un service worker à version figée. Il précharge les fichiers de son manifeste en vérifiant leur hash, il ne s'active qu'après accord, et il donne son empreinte.
- **Relais (`apps/relay/src/static.ts`) :** il sert la PWA sur sa propre origine. Le cookie du `/ws` n'est accepté que de `PUBLIC_URL`, et le service worker doit couvrir `/`.
- **Daemon :** les reports du lot 4 et du lot 3 côté PC.

**Tech Stack:** TypeScript strict, React 19, Vite 6, Tailwind 4, vitest 4 + jsdom 25, Playwright 1.64.1, zod 3, `@ledge/seal` (WebCrypto), `@ledge/protocol`, `@ledge/ui`. Relais : Node ≥ 22, ws 8.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md`. Autres références :
- feuille de route : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md` ;
- lot 4 : `docs/superpowers/plans/2026-10-20-ledge-mobile-relay-lot4-mobile-protocol.md`. Les schémas de `packages/protocol/src/phone.ts` font foi ;
- **le faux téléphone `packages/ledge/test/mobile-fake-device.ts` est la référence du rôle du téléphone** (ordre des trames, relance du hello, `ready`). `src/link/` le porte en navigateur ;
- maquette V3 : `docs/mockups/ledge-mobile/` (rapatriée par Task 1).

## Global Constraints

- **Maquette :** « L'UI mobile s'éloigne de la maquette `docs/mockups/ledge-mobile` » est un anti-objectif. Chaque écran suit sa planche V3 : textes au mot près, ordre des éléments, états. Les couleurs viennent des tokens de `@ledge/ui` (fond `#0c0d0e`), pas du `#000` de la maquette.
- **Textes :** en français seulement, tous dans `apps/mobile/src/copy.ts`. Aucun texte en dur dans un composant.
- **Contexte sécurisé :** la PWA exige `window.isSecureContext` (HTTPS, ou `http://localhost`). Sans lui, elle affiche un seul écran d'erreur et ne charge pas `@ledge/seal`, qui lit `crypto.subtle` au chargement : l'import est dynamique.
- **Clés :**
  - l'identité du téléphone est générée par `generateIdentity()` (non extractible). Elle est rangée telle quelle (`CryptoKey` par clonage structuré) dans IndexedDB, base `ledge`, magasin `keys` ;
  - la clé privée n'est jamais exportée, journalisée ni envoyée ;
  - rien de secret ne va dans `localStorage`.
- **Confiance :** le téléphone ne parle qu'à la clé du PC épinglée lors d'une liaison confirmée **sur le téléphone et sur le PC**. Un `hello` dont `f` ne vaut pas `fingerprint(pcPublicKey épinglée)` ouvre l'écran « clé changée », et plus rien n'est envoyé ni affiché.
- **Bourrage :** chaque message téléphone → PC est bourré aux paliers `PAD_TIERS` avant d'être scellé, sauf le premier `{"t":"ready"}`, qui ne l'est pas, comme côté PC. Au-delà de `PLAIN_MAX`, il n'est pas envoyé.
- **Fermetures du relais :**
  - `4000` (remplacé) : ne pas se reconnecter ;
  - `4001` (déconnecté) : appeler `GET /auth/me`. Une réponse 200 donne une reconnexion, une 401 l'écran de connexion ;
  - `4008` (limite) : reconnexion après au moins 10 s ;
  - autre fermeture : backoff de 1 s à 30 s.
- **Liaison côté téléphone :** elle expire 5 min après `pair_commit` (`PAIRING_TTL_MS`, le même que le PC). Le téléphone n'a aucune trame d'annulation : abandonner, c'est se taire.
- **Hors ligne :** pas de file côté serveur. Le téléphone affiche son cache et « PC hors ligne ». Il garde dans `localStorage` (clés `ledge.mobile.*`) le dernier snapshot, les opérations non résolues et les brouillons, jamais une clé.
- **Logs :** la PWA n'écrit jamais dans la console le contenu d'un message.
- **Relais :** il ne sert que des fichiers statiques (`GET`/`HEAD`), avec une CSP stricte, et rien d'autre ne change dans ses routes.
- **Hors lot 5 :** WebAuthn, Web Push, le chat. Une acceptation `high` reçoit donc `confirm_required`, et le téléphone dit « À accepter sur le PC ».
- **Dépendances :** seulement celles que le monorepo a déjà (react, react-dom, vite, `@vitejs/plugin-react`, tailwind 4, `@tailwindcss/vite`, vitest, jsdom, `@testing-library/*`, `@playwright/test` 1.64.1, zod). Pas de `fake-indexeddb` : le stockage passe par une interface (Task 4), testée en mémoire dans vitest et en vrai dans Chromium.
- **Imports :** relatifs, sans extension (bundler Vite) dans `apps/mobile`, en `.js` dans les paquets NodeNext.

## Reporté

| Origine | Point | Tâche |
| --- | --- | --- |
| feuille de route | un test : WebCrypto de Chrome et de Safari rejette un point hors courbe | Task 2 |
| feuille de route | un vecteur de dérivation de clés commun au navigateur et au daemon | Task 2 |
| feuille de route / lot 4 | la PWA bourre ses messages aux paliers `PAD_TIERS` | Task 5 |
| lot 4 | le téléphone envoie `expect` (demande vue, ou `null`) sur chaque `session.reply` | Task 7 |
| lot 4 | `session.updated` d'une session inconnue est un ajout (session désarchivée) | Task 7 |
| lot 4 | les marques de lecture sont perdues sur `onGone` ou à la reconnexion : le téléphone renvoie ses `session.read` après chaque `ready` | Task 7 |
| lot 4 | le snapshot peut dépasser `PLAIN_MAX` : les bodies des demandes partent à la demande | Task 6 |
| lot 4 | `operation.result` passe derrière les mises à jour coalescées | Task 6 |
| lot 4 | une demande sans verdict de `riskOf` est omise de la projection | Task 6 |
| lot 3 | une liaison approuvée garde le délai compté depuis la demande | Task 6 |
| lot 2 | `/auth/github/start` cross-site fait tourner le jeton, et le téléphone reçoit 4001 | Task 4 (sur 4001, `/auth/me` décide) |

## Review Focus

1. **Le relais coupe juste après l'envoi d'une décision.** Attendu : l'opération reste « en cours », puis « incertaine » après 10 s sans réponse. Au `ready` suivant, elle repart **avec le même `op`**. Le PC rend le même `applied`, l'écran l'affiche, et rien n'est tapé deux fois (Tasks 7 et 12).
2. **Le PC répond avec une autre clé** (réinstallation, ou relais malveillant). Attendu : l'écran « La clé de PC-Desan a changé », aucun message scellé n'est envoyé, le cache n'est plus montré comme à jour, et le seul chemin est « Refaire la liaison » ou « Se déconnecter » (Tasks 5, 10 et 12).
3. **Le serveur publie une nouvelle version pendant que l'app est ouverte, puis l'app est rechargée.** Attendu : c'est toujours l'ancienne version qui tourne. La feuille « Nouvelle version » montre l'empreinte de la version en attente, et seul « Mettre à jour » la fait passer (Task 11).
4. **Safari a vidé IndexedDB** (site non installé, 7 jours sans visite). Attendu : pas d'écran cassé. Le téléphone dit qu'il n'est plus lié et propose la liaison, et le cache `localStorage` est effacé avec (Tasks 4 et 10).
5. **Une rotation de jeton par un `/auth/github/start` cross-site ferme la socket en 4001.** Attendu : `/auth/me` répond 200, la PWA se reconnecte sans afficher l'écran de connexion et refait son hello (Tasks 4 et 12).

---

### Task 1: maquette et squelette de `apps/mobile`

**Files:**
- Create : `docs/mockups/ledge-mobile/**`, par `git checkout 0973440 -- docs/mockups/ledge-mobile`
- Create : `apps/mobile/{package.json,tsconfig.json,vite.config.ts,index.html,vitest.setup.ts}` ; `apps/mobile/public/{manifest.webmanifest,icon-180.png,icon-192.png,icon-512.png,icon-maskable-512.png,favicon.svg,favicon-32.png}` ; `apps/mobile/scripts/icons.mjs`
- Create : `apps/mobile/src/{main.tsx,App.tsx,router.ts,copy.ts,styles.css}`
- Test : `apps/mobile/test/router.test.ts`, `apps/mobile/test/manifest.test.ts`

**Interfaces:**
- Produces :
  - `package.json`, avec `name: "@ledge/mobile"` et les scripts `dev`, `build`, `test`, `typecheck`, `test:e2e` ;
  - les dépendances `@ledge/protocol`, `@ledge/seal`, `@ledge/ui` (`workspace:*`), react, react-dom, zod ;
  - `vite.config.ts`, avec `base: '/'`, `outDir: 'dist'` et le port de dev 5299.
- Produces, dans `router.ts` : `type Route` et `parseRoute(hash: string): Route`, `href(route: Route): string`.
  - Routes reprises : `#/`, `#/agents`, `#/thread/<sid>`, `#/terminal/<sid>`, `#/request/<sid>/<key>`, `#/connection` ;
  - routes nouvelles : `#/login`, `#/link`, `#/key-changed`, `#/update` ;
  - `#/pair` disparaît.
- Produces, dans `copy.ts` : `export const copy` en objet imbriqué par écran. Ses textes viennent de l'ancien `copy.ts` et des planches V3 (Login, Compare, Denied, KeyChanged, Update, Offline).

- [ ] **Step 1 :** rapatrier la maquette, puis vérifier que `docs/mockups/ledge-mobile/index.html` s'ouvre et liste les planches V3.
- [ ] **Step 2 : tests qui échouent.**
  - `router.test.ts` :
    - `parseRoute(href(r))` égale `r` pour chaque route ;
    - `parseRoute('#/pair')` et `parseRoute('#/nimporte')` donnent `{ name: 'inbox' }` ;
    - un `sid` ou une `key` encodé (`%2F`) est décodé une fois.
  - `manifest.test.ts` :
    - `display: 'standalone'`, `start_url: '/'`, `scope: '/'` ;
    - `background_color` et `theme_color` à `#0c0d0e` ;
    - les icônes 192 et 512 sont `any`, une 512 est `maskable` ;
    - chaque fichier cité existe dans `public/` ;
    - `index.html` déclare `favicon.svg` (`image/svg+xml`), `favicon-32.png` et `apple-touch-icon` 180.
- [ ] **Step 3 : produire les fichiers.**
  - Icônes : `scripts/icons.mjs` rend la mascotte resident en SVG, avec halo sur fond `#0c0d0e` pour les icônes, sans halo et sur fond transparent pour le favicon. Il les convertit en PNG avec le Chromium de Playwright (`page.screenshot`). Les PNG sont commités.
  - `App.tsx` rend un écran vide par route.
  - `main.tsx` refuse un contexte non sécurisé (Global Constraints).
- [ ] **Step 4 :** `pnpm install`, puis `pnpm --filter @ledge/mobile test` et `typecheck` → PASS.
- [ ] **Step 5 :** commit `feat(mobile): the PWA skeleton, its icons and the V3 mockups`.

### Task 2: `@ledge/seal`, un vecteur commun et le point hors courbe

**Files:**
- Modify : `packages/seal/src/channel.ts` (option de test du handshake)
- Create : `packages/seal/test/vectors.json`, `packages/seal/test/vectors.test.ts`
- Create : `apps/mobile/e2e/crypto.spec.ts`, `apps/mobile/e2e/crypto.html`, `apps/mobile/playwright.config.ts`

**Interfaces:**
- Produces, dans `channel.ts` : `startHandshake(self, role, peerPublicKey, opts?: { ephemeralPkcs8?: string })`. Commentaire : *test vectors only*. Sans l'option, rien ne change.
- Produces, dans `vectors.json` :
  - les identités PC et appareil (pkcs8 + publicKey), leurs éphémères (pkcs8) et les nonces de liaison ;
  - les sorties attendues : `fingerprint` des deux clés, `commit`, `pairingCode`, et `sealed`, le premier `seal('{"t":"ready"}')` dans chaque sens ;
  - `offCurve` : un point de 65 octets qui commence par `0x04` mais n'est pas sur P-256.

- [ ] **Step 1 :** générer une fois les valeurs de `vectors.json` avec un script jetable, sans le commiter, et les figer.
- [ ] **Step 2 : test Node `vectors.test.ts`.**
  - Chaque sortie de `vectors.json` est recalculée et vaut la valeur figée.
  - `importPublicKey(offCurve)` rejette avec `SealError` `bad_key`.
  - `startHandshake(id, 'device', offCurve)` rejette aussi.
- [ ] **Step 3 : test navigateur `crypto.spec.ts`.**
  - `crypto.html` charge `@ledge/seal` et `vectors.json` via le serveur Vite de Playwright.
  - Les mêmes assertions passent dans la page.
  - Projets : `chromium` toujours, `webkit` seulement si son exécutable est présent (`test.skip` avec la raison sinon). Ne rien installer : le rapport dit si WebKit a tourné.
- [ ] **Step 4 :** `pnpm --filter @ledge/seal test` et `pnpm --filter @ledge/mobile test:e2e -- crypto` → PASS.
- [ ] **Step 5 :** commit `test(seal): one key-derivation vector for Node and the browser; an off-curve point is refused`.

### Task 3: le relais sert la PWA

**Files:**
- Create : `apps/relay/src/static.ts`
- Modify : `apps/relay/src/config.ts` (`LEDGE_RELAY_WEB_DIR`), `apps/relay/src/app.ts` et `apps/relay/src/main.ts` (enchaîner le handler)
- Test : `apps/relay/test/static.test.ts`

**Interfaces:**
- Produces : `staticRoutes(opts: { root: string; publicUrl: string; log: RelayLog }): HttpHandler`. Ce handler est tenté **après** `authRoutes`, qui garde `/auth/*`. `/ws` et `/healthz` ne lui arrivent jamais.
- `Config` gagne `webDir?: string`, qui vient de `LEDGE_RELAY_WEB_DIR`. Quand il n'est pas défini, rien n'est servi et le comportement actuel reste (404).

- [ ] **Step 1 : tests qui échouent** (`static.test.ts`, sur un dossier temporaire avec `index.html`, `sw.js`, `build.json` et `assets/app-abc123.js`).
  - **Chemins :**
    - `GET /` et `GET /index.html` → 200, `text/html; charset=utf-8` ;
    - `GET /?signin=ok` → `index.html` ;
    - `GET /thread` (sans extension) → `index.html` ;
    - `GET /nope.js` → 404 ;
    - `GET /../package.json`, `/%2e%2e/x`, `/assets/%00` → 404, et aucune lecture hors de `root` ;
    - `POST /` → 405.
  - **En-têtes :**
    - `sw.js`, `index.html`, `build.json` et `manifest.webmanifest` → `Cache-Control: no-cache` ;
    - `assets/*` → `public, max-age=31536000, immutable`.
  - **Sécurité :**
    - chaque réponse porte `Content-Security-Policy` : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' <wss|ws>://<host de publicUrl>; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` ;
    - et aussi `X-Content-Type-Options: nosniff` et `Referrer-Policy: no-referrer`.
  - **Logs :** une 404 n'écrit pas le chemin demandé.
- [ ] **Step 2 :** implémenter `static.ts`.
  - `GET` et `HEAD` seulement.
  - Résoudre le chemin avec `path.resolve(root, '.' + decoded)`, puis vérifier qu'il reste sous `root`.
  - Types MIME : `.html .js .css .json .webmanifest .svg .png .woff2`.
  - Lire les fichiers à la demande, sans cache mémoire.
- [ ] **Step 3 :** brancher le handler dans `app.ts` (mode comptes) et `main.ts` (mode dev), puis compléter `config.test.ts`.
- [ ] **Step 4 :** `pnpm --filter @ledge/relay test` → PASS (les tests Postgres restent sautés sans base).
- [ ] **Step 5 :** commit `feat(relay): serve the PWA from the relay's own origin, with a strict CSP`.

### Task 4: clés, socket et liaison côté téléphone

**Files:**
- Create : `apps/mobile/src/link/{keys.ts,socket.ts,pairing.ts,label.ts}`
- Test : `apps/mobile/test/link/{keys,socket,pairing}.test.ts`, `apps/mobile/test/fakePc.ts`, `apps/mobile/e2e/keys.spec.ts`

**Interfaces:**
- Produces, dans `keys.ts` :
  - `interface KeyStore { identity(): Promise<Identity | null>; saveIdentity(id: Identity): Promise<void>; pinned(): Promise<PinnedPc | null>; pin(pc: PinnedPc): Promise<void>; forget(): Promise<void> }` ;
  - `type PinnedPc = { publicKey: string; fingerprint: string; name: string | null; pinnedAt: string }` ;
  - `indexedDbKeys(): KeyStore` (base `ledge`, version 1, magasin `keys`, clés `identity` et `pc`) et `memoryKeys(): KeyStore` ;
  - `ensureIdentity(store): Promise<Identity>` ;
  - `forget()` efface les deux clés **et** les clés `ledge.mobile.*` de `localStorage`.
- Produces, dans `socket.ts` :
  - `type SocketState = 'connecting' | 'open' | 'signed_out' | 'replaced' | 'closed'` ;
  - `openRelaySocket(opts: { url: string; WebSocketImpl?; fetchImpl?; onFrame(m: RelayServerMessage): void; onState(s: SocketState): void }): { send(to: RelayPeer, frame: SealedFrame): boolean; close(): void }`.
  - Le socket ne propose aucun sous-protocole. Il valide chaque trame avec `RelayServerMessageSchema` et ignore le reste. Il suit les fermetures des Global Constraints.
- Produces, dans `pairing.ts` :
  - `startPairing(opts: { identity: Identity; label: string; send(f: SealedFrame): void; now?(): number; ttlMs?: number }): Pairing` ;
  - `interface Pairing { receive(f: SealedFrame): Promise<void>; confirmOnPhone(): void; cancel(): void; state(): PairingState }` ;
  - `type PairingState = { step: 'committing' } | { step: 'compare'; code: string; pcConfirmed: boolean; phoneConfirmed: boolean } | { step: 'linked'; pc: PinnedPc } | { step: 'refused' } | { step: 'expired' } | { step: 'cancelled' }`.
  - L'état ne passe à `linked` que si `pair_ok` est reçu **et** `confirmOnPhone()` est appelé, dans n'importe quel ordre. La clé épinglée est celle de `pair_offer.pc`.
- Produces, dans `label.ts` : `deviceLabel(userAgent: string): string`, qui rend `iPhone`, `iPad`, `Android` ou `Téléphone` (≤ 40 caractères).
- Produces, dans `fakePc.ts` (test) : un PC scellé en mémoire, branché sur un vrai `createRelay` en mode dev. Il porte le rôle `pc` du faux appareil du lot 3 : il répond `pair_offer` et `pair_ok`/`pair_no` sur commande, `hello`, `ready`, et il scripte les `PhoneServerMessage`.

- [ ] **Step 1 : tests qui échouent.**
  - `keys.test.ts` (sur `memoryKeys`) :
    - `ensureIdentity` rend la même identité deux fois ;
    - `forget()` vide l'identité, le PC épinglé et `ledge.mobile.*`.
  - `socket.test.ts` (faux WebSocket) :
    - 4000 → `replaced`, sans nouvelle tentative ;
    - 4001 avec `/auth/me` en 200 → nouvelle tentative ; avec `/auth/me` en 401 → `signed_out` ;
    - 4008 → aucune tentative avant 10 s ;
    - 1006 → backoff 1 s, 2 s, 4 s… jusqu'à 30 s ;
    - aucun `protocols` passé au constructeur.
  - `pairing.test.ts` (contre `fakePc` et un vrai relais) :
    - le code affiché égale celui que calcule le faux PC ;
    - `pair_ok` puis `confirmOnPhone` → `linked`, et `confirmOnPhone` puis `pair_ok` → `linked` ;
    - `pair_no` → `refused` ;
    - sans `pair_ok` après 5 min (`now` injecté) → `expired` ;
    - un `pair_offer` reçu deux fois est ignoré ;
    - un `pair_ok` avant `compare` est ignoré.
  - `keys.spec.ts` (Chromium réel) : une identité rangée par `indexedDbKeys()`, rechargée après `page.reload()`, signe encore un handshake. Sa `privateKey.extractable` vaut `false`.
- [ ] **Step 2 :** implémenter les quatre fichiers.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` et `test:e2e -- keys` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the phone's keys in IndexedDB, its relay socket and its side of pairing`.

### Task 5: le canal scellé et `PhoneLink`

**Files:**
- Modify : `packages/protocol/src/phone.ts` (bourrage partagé), `packages/ledge/src/mobile/pad.ts` (s'en sert)
- Create : `apps/mobile/src/link/{channel.ts,link.ts}`
- Test : `packages/protocol/test/phone.test.ts`, `apps/mobile/test/link/{channel,link}.test.ts`

**Interfaces:**
- Produces, dans `phone.ts` : `padPlain(json: string): string | null`. Il mesure avec `TextEncoder`, sans `Buffer`, avec la même règle que `pad.ts` aujourd'hui. `pad.ts` devient un ré-export, et ses tests ne changent pas.
- Produces, dans `channel.ts` :
  - `openChannel(opts: { identity: Identity; pc: PinnedPc; send(f: SealedFrame): void; onMessage(m: PhoneServerMessage): void; onEvent(e: ChannelEvent): void }): { hello(): Promise<void>; receive(f: SealedFrame): Promise<void>; send(m: PhoneClientMessage): Promise<boolean>; ready(): boolean }` ;
  - `type ChannelEvent = 'ready' | 'key_changed' | 'denied' | 'too_large'`.
  - `send` rend `false` avant `ready` ou au-delà de `PLAIN_MAX`.
- Produces, dans `link.ts` :
  - `createPhoneLink(opts: { keys: KeyStore; url: string; WebSocketImpl?; fetchImpl? }): PhoneLink` ;
  - `interface PhoneLink { state(): LinkState; subscribe(fn: () => void): () => void; onMessage(fn: (m: PhoneServerMessage) => void): () => void; send(m: PhoneClientMessage): Promise<boolean>; pairing(): Pairing | null; startPairing(): void; relink(): Promise<void>; signOut(): Promise<void> }` ;
  - `type LinkState = 'signed_out' | 'unpaired' | 'pairing' | 'pc_offline' | 'handshaking' | 'ready' | 'key_changed' | 'replaced'`.

- [ ] **Step 1 : tests qui échouent** (`channel.test.ts`, `link.test.ts`, contre `fakePc` et un vrai relais).
  - **Établissement du canal :**
    - après `hello`, le premier message scellé envoyé est exactement `{"t":"ready"}`, sans espaces ;
    - un message suivant de 10 octets arrive au faux PC avec 1 024 octets ;
    - un `PhoneClientMessage` de 700 000 octets n'est pas envoyé (`false`).
  - **Clé, refus, relance :**
    - un `hello` dont `f` diffère → `key_changed`, et plus rien ne part ;
    - `denied` → `forget` du PC épinglé et `LinkState` `unpaired` ;
    - le hello est refait sur `welcome`, sur `presence pc online`, sur une erreur relais `offline`/`too_large`/`rate_limited`, sur `rekey`, et sur `gap`/`bad_seal` à l'ouverture ;
    - `replay` est ignoré.
  - **`PhoneLink` :**
    - après chaque `ready`, il envoie `snapshot.request` puis `session.watch` avec la dernière valeur demandée ;
    - un `PhoneServerMessage` invalide est ignoré, sans log de son contenu ;
    - `welcome` avec le PC absent de `online` → `pc_offline`.
- [ ] **Step 2 :** implémenter le code, en portant la logique de `packages/ledge/test/mobile-fake-device.ts`.
- [ ] **Step 3 :** `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge exec vitest run test/mobile`, puis `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the sealed channel to the pinned PC, padded both ways`.

### Task 6: reports côté daemon

**Files:**
- Modify : `packages/protocol/src/phone.ts`, `packages/ledge/src/mobile/{project.ts,gateway.ts,outbox.ts,pairing.ts}`
- Test : `packages/protocol/test/phone.test.ts`, `packages/ledge/test/mobile/{project,gateway,outbox,pairing}.test.ts`

**Interfaces:**
- Produces, dans `phone.ts` :
  - `SNAPSHOT_BODY_MAX = 2_048` ;
  - le client gagne `{ type: 'session.pending', id }` ;
  - le serveur gagne `{ type: 'session.pending', id, pending: PhonePendingSchema }`, avec le body complet jusqu'à `PENDING_BODY_MAX`, sinon `cut: true` ;
  - `snapshot.daemon` gagne `name: z.string().max(40)`.
- Dans `snapshot` et `session.updated`, le body d'une demande est coupé à `SNAPSHOT_BODY_MAX`, avec `cut: true`.

- [ ] **Step 1 : tests qui échouent.**
  - **Bodies :**
    - 12 sessions qui attendent chacune un body de 64 Kio → un snapshot sous `PLAIN_MAX`, chaque `pending.cut === true` ;
    - `session.pending` rend le body entier ;
    - `session.pending` sur une session sans demande → `error unknown_session`.
  - **File de sortie :** un `operation.result` mis en file derrière 50 `session.updated` coalescés part **avant** eux.
  - **Risque :** une demande pour laquelle `riskOf` ne rend pas de verdict apparaît en `high` / `unknown`, au lieu d'être omise.
  - **Liaison :**
    - `approve` à 4 min 59 s, puis un hello du téléphone à 9 min 30 s → l'état passe à `linked`, pas à `expired`, car l'approbation rouvre `PAIRING_TTL_MS` ;
    - `snapshot.daemon.name` vaut `os.hostname()` coupé à 40 caractères.
- [ ] **Step 2 :** implémenter. `outbox.ts` garde une voie prioritaire pour `operation.result` et `error`, dans le même budget de débit.
- [ ] **Step 3 :** `pnpm --filter @ledge/protocol test` et `pnpm --filter @paradow/ledge exec vitest run test/mobile` → PASS.
- [ ] **Step 4 :** commit `fix(mobile): request bodies on demand, results first, no request left out, a fresh window after approval`.

### Task 7: store, opérations et modèle

**Files:**
- Create : `apps/mobile/src/state/{store.ts,operations.ts,persist.ts,drafts.ts}` ; `apps/mobile/src/model/*`, porté depuis `0973440:apps/mobile/src/model/` (requests, requestOutcome, agents, thread, freeAnswer, consequence)
- Test : `apps/mobile/test/state/{store,operations}.test.ts` ; `apps/mobile/test/model/*`, porté depuis `0973440:apps/mobile/test/` (consequence, free-answer, agents, requests)

**Interfaces:**
- Consumes : `PhoneLink` (Task 5) ; `PhoneSession`, `PhonePending`, `PhoneServerMessage` et `PhoneClientMessage` de `@ledge/protocol`.
- Produces, dans `store.ts` :
  - `createStore(link: PhoneLink, storage?: Storage): MobileStore` ;
  - `MobileStore` s'utilise avec `useSyncExternalStore`. Son état : `{ sessions: Map<string, PhoneSession>; threads; previews; capabilities; daemon: { version: string; name: string } | null; fresh: boolean; ops }` ;
  - ses actions : `decide`, `reply`, `interrupt`, `read`, `openThread`, `watch` et `loadPending`.
- Produces, dans `operations.ts` :
  - `type OpPhase = 'sending' | 'uncertain' | 'applied' | 'rejected' | 'failed'` ;
  - chaque op garde `{ op: uuid, message, phase, reason? }` ;
  - `pruneOps` en garde 50.
- Produces, dans `model/*` : les signatures de l'archive, avec `pendingId` et `pendingVersion` remplacés par `key` (`PhonePending.key`).

- [ ] **Step 1 : tests qui échouent.**
  - **Messages reçus :**
    - `session.updated` d'un id inconnu → ajouté ;
    - `session.removed` → retiré, et un fil ouvert passe à « Gone » ;
    - `snapshot` remplace tout et `fresh` devient `true` ; une perte du canal le remet à `false`.
  - **Écritures :**
    - `reply` sur une session sans demande envoie `expect: null` ; avec une demande, `expect: { key, kind, text }` ;
    - `decide` envoie toujours `expect`.
  - **Reconnexion :**
    - une op sans `operation.result` après 10 s passe à `uncertain` ;
    - au `ready` suivant, elle est renvoyée avec le même `op` ;
    - `rejected` avec `reason: 'stale'` affiche la nouvelle demande ;
    - les `session.read` déjà faits sont renvoyés après chaque `ready`.
  - **Cache :**
    - rechargement depuis `localStorage` → les sessions s'affichent avec `fresh: false` ;
    - aucune clé `ledge.mobile.*` ne contient « privateKey » ni « pkcs8 ».
- [ ] **Step 2 :** porter le modèle et écrire le store.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the phone's store — upserts, idempotent operations resent after reconnecting, read marks kept`.

### Task 8: écrans de lecture

**Files:**
- Create : `apps/mobile/src/screens/{Inbox,Agents,Thread,Terminal,Gone}.tsx`, `apps/mobile/src/ui/*`, portés depuis `0973440:apps/mobile/src/`
- Test : `apps/mobile/test/screens/{inbox,agents,thread,terminal}.test.tsx`

**Interfaces:**
- Consumes : `MobileStore` (Task 7) ; `groupSessions` de `@ledge/fleet` ; `seedHash` et `ResidentMascot` de `@ledge/ui` (`@ledge/ui/bots/ResidentMascot`).
- Le bot d'agent : `BotShell` n'existe plus. Utiliser `Bot` de `@ledge/ui/bots/Bot`.
- Le rendu des réponses : `parseReply` vit dans `apps/overlay/src/reply/parse.ts`. Le déplacer dans `packages/ui/src/reply/parse.ts` (export `./reply/parse`), mettre à jour les imports de l'overlay, et déplacer son test avec lui.

- [ ] **Step 1 : tests qui échouent** (store factice).
  - **Inbox :**
    - les sessions qui attendent sont en tête, triées par ancienneté de la demande ;
    - « Tout est calme » quand aucune n'attend ;
    - le bandeau « PC hors ligne » quand `fresh` est faux.
  - **Thread :**
    - ouvrir le fil envoie `session.thread`, puis `session.read` avec l'`at` du dernier item ;
    - `cut` affiche « Message raccourci » ;
    - `more` affiche « Messages plus anciens sur le PC ».
  - **Terminal :**
    - l'ouvrir envoie `session.watch { id }` et le quitter `session.watch { id: null }` ;
    - « Interrompre » envoie `session.interrupt`, et `read_only` affiche le refus.
- [ ] **Step 2 :** porter les écrans en suivant leurs planches V3, et faire le déplacement de `parseReply`.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test`, puis `pnpm --filter @ledge/ui test` et `pnpm --filter overlay test -- --maxWorkers=2` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): inbox, agents, thread and terminal on the sealed link`.

### Task 9: écrans d'action

**Files:**
- Create : `apps/mobile/src/screens/{RequestDetail,QuestionForm,DecisionFooter,RiskConfirm,Result,Reply}.tsx`, portés depuis `0973440`
- Test : `apps/mobile/test/screens/{request-detail,risk,reply}.test.tsx`

**Interfaces:**
- Consumes : `store.decide`, `store.reply`, `store.loadPending` (Task 7) ; `model/consequence`, `model/freeAnswer`, `model/requestOutcome`.

- [ ] **Step 1 : tests qui échouent.**
  - **Détail :**
    - ouvrir le détail d'une demande `cut` envoie `session.pending` et affiche le body entier à la réception ;
    - une demande `high` : le bouton d'acceptation est remplacé par « À accepter sur le PC », et refuser reste possible ;
    - `operation.result` `confirm_required` → le même texte ;
    - une question à réponse libre (`capabilities.freeTextAnswer`) affiche le champ.
  - **Réponse :** un texte de plus de 20 000 caractères est refusé avant envoi, et un caractère de `UNTYPABLE` est signalé.
  - **Résultat :** `applied` affiche l'écran Résultat de la maquette ; `stale` revient au détail de la nouvelle demande.
- [ ] **Step 2 :** porter les écrans en suivant les planches Request, Question, Permission, Risk, Sent et Continue.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): decide, answer and reply from the phone`.

### Task 10: écrans de compte et de liaison

**Files:**
- Create : `apps/mobile/src/screens/{Login,Compare,Denied,KeyChanged,Offline,Connection,Insecure}.tsx`
- Modify : `apps/mobile/src/App.tsx` (aiguillage par `LinkState`)
- Test : `apps/mobile/test/screens/{login,compare,key-changed,app}.test.tsx`

**Interfaces:**
- Consumes : `PhoneLink`, `Pairing`, `PinnedPc` (Tasks 4 et 5) ; `ResidentMascot` avec halo sur ces écrans.
- Le nom du PC vient de `PinnedPc.name`, rempli au premier snapshot (`daemon.name`). Avant, c'est « votre PC ».

- [ ] **Step 1 : tests qui échouent.**
  - **Connexion :**
    - `?signin=not_allowed` → Denied « Ce compte n'a pas accès » ;
    - `?signin=denied` ou `bad_state` ou `error` → Login avec le message de la maquette, puis le paramètre est retiré de l'URL ;
    - « Continuer avec GitHub » mène à `/auth/github/start`.
  - **Comparaison :**
    - Compare affiche le code au format « 123 456 » ;
    - « Les codes sont identiques » → « Confirmez sur le PC » tant que `pair_ok` manque, puis « Téléphone lié à <nom> » ;
    - « Ils sont différents » → « Liaison annulée », et aucune trame n'est envoyée ;
    - `expired` et `refused` proposent de recommencer.
  - **Clé changée :** KeyChanged propose « Refaire la liaison », qui appelle `relink`, et « Se déconnecter », qui appelle `POST /auth/logout` puis `forget`.
  - **PC hors ligne :** Offline « PC-Desan ne répond plus », avec le nom réel ; « Réessayer » refait le hello.
  - **Connexion (écran) :** il montre le compte (`/auth/me`), l'empreinte du PC (`fingerprint` en groupes de 4), la version et l'empreinte de l'app (Task 11), et « Se déconnecter ».
  - **Perte des clés :** une identité absente au démarrage alors que `ledge.mobile.lastState` existe → le cache est effacé et la liaison proposée (Review Focus 4).
- [ ] **Step 2 :** implémenter les écrans en suivant leurs planches V3.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): sign in, compare the code, key changed, PC offline`.

### Task 11: service worker figé et empreinte

**Files:**
- Create : `apps/mobile/src/sw/{sw.ts,fingerprint.ts,register.ts}`, `apps/mobile/vite.sw.config.ts`, `apps/mobile/scripts/fingerprint.mjs`, `apps/mobile/src/screens/Update.tsx`
- Modify : `apps/mobile/package.json` (`build` = `tsc --noEmit && vite build && vite build --config vite.sw.config.ts && node scripts/fingerprint.mjs`)
- Test : `apps/mobile/test/sw/{fingerprint,sw}.test.ts`, `apps/mobile/e2e/update.spec.ts`

**Interfaces:**
- Produces, dans `fingerprint.ts` :
  - `fingerprintOf(files: Array<{ path: string; sha256: string }>): Promise<string>`. C'est le SHA-256 hex des lignes `<path> <sha256>\n`, triées par `path`, sur tous les fichiers de `dist` sauf `build.json` (donc `sw.js` compris) ;
  - `formatFingerprint(hex)` rend les 24 premiers caractères en 6 groupes de 4 (« 3f9a c21e 70bd 44e1 9a02 d5c8 ») et `shortFingerprint(hex)` les 2 premiers groupes.
- Produces :
  - `sw.js` embarque `__MANIFEST__` (les fichiers de l'app et leur hash, sans `sw.js`) et `__VERSION__` (la version de `packages/ledge/package.json`) ;
  - `build.json` vaut `{ version, fingerprint }`. Il est écrit par `fingerprint.mjs`, et le lot 7 le publiera dans la release ;
  - `register.ts` : `registerPinnedSw(): Promise<UpdateWatch>` et `interface UpdateWatch { current(): BuildInfo | null; waiting(): BuildInfo | null; subscribe(fn): () => void; accept(): void }`, avec `BuildInfo = { version: string; fingerprint: string }`.

- [ ] **Step 1 : tests qui échouent.**
  - `fingerprint.test.ts` :
    - l'ordre des fichiers en entrée ne change pas le résultat ;
    - le format affiché est celui de la maquette ;
    - `fingerprint.mjs`, lancé sur un `dist` de test, écrit la même valeur que `fingerprintOf`.
  - `sw.test.ts` (le module du worker, avec `self`, `caches` et `fetch` simulés) :
    - **installation :**
      - elle met en cache chaque fichier du manifeste et `sw.js` ;
      - un fichier dont le hash diffère fait échouer l'installation ;
    - **activation :**
      - aucun `skipWaiting()` sans message `{ type: 'accept' }` ;
      - à la première installation (aucun client contrôlé), elle s'active seule ;
    - **requêtes :**
      - une navigation rend `/index.html` depuis le cache ;
      - `/auth/*`, `/ws` et `/healthz` passent au réseau, sans cache ;
    - `{ type: 'build' }` rend `{ version, fingerprint }`, avec l'empreinte recalculée sur les hash vérifiés.
  - `update.spec.ts` (Chromium, servi par le vrai relais de Task 3) :
    - construire v1, l'ouvrir, puis remplacer `dist` par un v2 (un texte change) et recharger ;
    - la page montre toujours v1, et la feuille « Nouvelle version · <v2> » affiche l'empreinte de v2 ;
    - « Plus tard », puis un nouveau rechargement → toujours v1 ;
    - « Mettre à jour » → la page passe en v2.
- [ ] **Step 2 :** implémenter le code.
  - `register.ts` enregistre avec `{ scope: '/', updateViaCache: 'none' }` et appelle `update()` à l'ouverture, puis toutes les 6 h.
  - `Update.tsx` suit la planche Update, avec le lien « Comparer avec la release v<version> sur GitHub » vers `https://github.com/Lyssaen/ledge/releases/tag/v<version>`.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile build`, `test` et `test:e2e -- update` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): a pinned service worker — updates only on consent, with the build's fingerprint`.

### Task 12: de bout en bout, et feuille de route

**Files:**
- Create : `apps/mobile/e2e/{harness.ts,phone.spec.ts}`
- Modify : `apps/mobile/package.json` (`serve:local` lance le harnais), `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`
- Test : `apps/mobile/e2e/phone.spec.ts`

**Interfaces:**
- Consumes : `createApp` du relais en mode comptes, avec `@electric-sql/pglite` et `apps/relay/test/fakeGithub.ts` ; `staticRoutes` (Task 3) sur `apps/mobile/dist` ; le `fakePc` de Task 4, connecté au relais comme PC du même compte.
- `harness.ts` démarre ces trois éléments sur des ports libres. `PUBLIC_URL` vaut `http://localhost:<port>`.

- [ ] **Step 1 : `phone.spec.ts`, avec Chromium sur le viewport iPhone 13.**
  1. Se connecter avec GitHub (le faux GitHub autorise) et lier le téléphone : comparer le code, confirmer sur le téléphone, puis approuver sur le faux PC.
  2. L'inbox montre la demande du faux PC. L'accepter (risque `low`) : le faux PC reçoit `session.decide` avec `expect`, et sa trame est bourrée à un palier.
  3. Couper le relais juste après une décision, le relancer, et vérifier les points 1 et 5 du Review Focus.
  4. Faire répondre le faux PC avec une autre clé statique → KeyChanged.
  5. Recharger la page → elle reste liée (IndexedDB) et l'inbox revient.
  6. Aucune erreur dans la console du navigateur.
- [ ] **Step 2 :** feuille de route : le lot 5 passe à « fait », et ses décisions y sont inscrites :
  - la PWA servie par le relais ;
  - les clés dans IndexedDB ;
  - le bourrage dans les deux sens ;
  - les bodies à la demande ;
  - le format de l'empreinte.
- [ ] **Step 3 :** suite complète `pnpm -r test` ; `pnpm --filter @ledge/mobile build`, `typecheck` et `test:e2e`. Les échecs connus restent les 2 tests tmux, et les instabilités de charge de l'overlay et du desktop, qui passent seuls.
- [ ] **Step 4 :** commit `test(mobile): the phone end to end against the relay and a sealed PC; roadmap updated`.

## Hors de ce lot

- **Lot 6 :**
  - WebAuthn, qui permettra d'accepter une demande `high` depuis le téléphone ;
  - Web Push ;
  - le chat « Demander à Ledge », qui sera multi-fil (planche « 7 · Demander à Ledge »).
- **Lot 7 :**
  - le domaine `ledge.paradow.dev` ;
  - le déploiement Railway, avec `LEDGE_RELAY_WEB_DIR` qui pointe sur le build ;
  - la publication de l'empreinte (`build.json`) dans `release.yml` ;
  - la version de la PWA tamponnée par `scripts/set-version.mjs`.
- **Restent ouverts :**
  - la `Max-Age` du cookie, jamais prolongée par l'usage. La session expire 90 jours après la connexion, et le téléphone revient à l'écran de connexion ;
  - les tests WebKit, si son navigateur n'est pas installé localement.
