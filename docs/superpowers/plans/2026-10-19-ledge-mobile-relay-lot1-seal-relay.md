# Ledge mobile, lot 1 : chiffrement de bout en bout et relais local — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un PC et un téléphone simulés échangent des messages chiffrés de bout en bout à travers un relais qui tourne en local et ne peut ni les lire, ni les modifier, ni les rejouer.

**Architecture:** Un paquet `@ledge/seal` (WebCrypto seul, le même code dans Node et le navigateur) fournit les identités d'appareil, une poignée de main entre deux clés connues et le code de liaison à engagement. `apps/relay` est un serveur Node `http` + `ws` : il authentifie chaque socket (jetons de dev dans ce lot, GitHub au lot 2), range les sockets par compte, et route des corps opaques entre le PC et les appareils d'un même compte. Les trames entre le relais et ses clients sont des schémas zod dans `@ledge/protocol`.

**Tech Stack:** TypeScript strict (NodeNext), Node ≥ 22 (`globalThis.crypto.subtle`), zod 3, ws 8, vitest 4, tsup.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md` ; feuille de route : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`.

## Global Constraints

- « primitives standard (WebCrypto côté navigateur, `node:crypto` côté daemon), sans crypto maison » : seulement `crypto.subtle` (ECDH P-256, HKDF-SHA-256, AES-256-GCM, SHA-256) ; aucune dépendance crypto.
- « la clé privée ne quitte jamais l'appareil (non extractible côté navigateur) » : `generateIdentity()` crée une clé non extractible par défaut.
- Le serveur « ne stocke aucun contenu » ; logs : « Connexions et déconnexions, identifiant de compte et d'appareil, erreurs, tailles, latences. Jamais le contenu ni les métadonnées de contenu. »
- « Isolation stricte entre comptes ; aucun partage de sessions entre utilisateurs. »
- « File d'attente côté serveur quand le PC est hors ligne » est un non-objectif : un message vers une cible hors ligne est refusé, jamais gardé.
- `engines.node >= 22`, `zod ^3.23.8`, `ws ^8.18.0`, imports relatifs en `.js` (NodeNext), paquets de l'espace de travail servis depuis `src/index.ts` comme `@ledge/protocol`.

## Review Focus

1. Le PC se reconnecte alors que l'ancien socket n'est pas encore fermé : un seul PC reste routé, l'ancien socket est fermé (test dans Task 4).
2. Un appareil vise un autre appareil, ou un identifiant d'un autre compte : refusé, rien n'est livré hors du compte (Task 4).
3. Une trame trop grosse, du JSON invalide ou un type inconnu : une erreur sur ce socket seulement, le serveur continue pour les autres (Tasks 4 et 5).
4. Le relais rejoue ou réordonne une trame chiffrée, y compris d'une connexion précédente : refusée à l'ouverture (Task 2).
5. Une trame invalide qui contient un secret : le secret n'apparaît dans aucune ligne de log (Task 5).

---

### Task 1: `@ledge/seal`, identités et encodage

**Files:**
- Create: `packages/seal/package.json`, `packages/seal/tsconfig.json`, `packages/seal/src/index.ts`, `packages/seal/src/encoding.ts`, `packages/seal/src/identity.ts`, `packages/seal/src/errors.ts`
- Test: `packages/seal/test/identity.test.ts`

**Interfaces:**
- Produces:
  - `b64u(bytes: Uint8Array): string`, `fromB64u(text: string): Uint8Array` (base64url sans padding ; `fromB64u` lève `SealError('bad_encoding')` sur un caractère hors alphabet)
  - `class SealError extends Error { code: 'bad_encoding' | 'bad_key' | 'bad_seal' | 'replay' | 'bad_commitment' }`
  - `interface Identity { publicKey: string; privateKey: CryptoKey }` — `publicKey` : point P-256 non compressé (65 octets, premier octet `0x04`) en base64url
  - `generateIdentity(opts?: { extractable?: boolean }): Promise<Identity>` (ECDH P-256, `extractable` faux par défaut)
  - `exportIdentity(id: Identity): Promise<string>` (PKCS8 base64url ; lève si la clé n'est pas extractible) et `importIdentity(pkcs8: string, publicKey: string): Promise<Identity>` — pour le daemon, qui garde sa clé sur disque (lot 3)
  - `importPublicKey(publicKey: string): Promise<CryptoKey>` (lève `SealError('bad_key')` si ce n'est pas 65 octets commençant par `0x04` ou si WebCrypto refuse le point)

- [ ] **Step 1: Créer le paquet**

`package.json` sur le modèle de `packages/protocol/package.json` : `"name": "@ledge/seal"`, `"private": true`, `"type": "module"`, `main`/`types`/`exports` sur `./src/index.ts`, scripts `test` et `typecheck`, aucune dépendance, devDependency `@types/node ^22.7.0`. `tsconfig.json` : `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022", "DOM"] }, "include": ["src", "test"] }` (types `CryptoKey` et `BufferSource` identiques pour Node et le navigateur). Lancer `pnpm install`.

- [ ] **Step 2: Écrire les tests qui échouent**

```ts
describe('identity', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63]);
    expect(b64u(bytes)).toBe('APv_Pj8');
    expect(fromB64u(b64u(bytes))).toEqual(bytes);
    expect(() => fromB64u('a+b/')).toThrow(SealError);
  });
  it('generates a non-extractable P-256 identity by default', async () => {
    const id = await generateIdentity();
    expect(fromB64u(id.publicKey)).toHaveLength(65);
    expect(fromB64u(id.publicKey)[0]).toBe(4);
    await expect(crypto.subtle.exportKey('pkcs8', id.privateKey)).rejects.toThrow();
    await expect(exportIdentity(id)).rejects.toThrow();
  });
  it('exports and re-imports an extractable identity', async () => {
    const id = await generateIdentity({ extractable: true });
    const back = await importIdentity(await exportIdentity(id), id.publicKey);
    expect(back.publicKey).toBe(id.publicKey);
  });
  it('refuses a malformed public key', async () => {
    await expect(importPublicKey(b64u(new Uint8Array(65)))).rejects.toMatchObject({ code: 'bad_key' });
    await expect(importPublicKey(b64u(new Uint8Array(33).fill(2)))).rejects.toMatchObject({ code: 'bad_key' });
  });
});
```

- [ ] **Step 3: Vérifier l'échec** — `pnpm --filter @ledge/seal test` : FAIL (modules absents).
- [ ] **Step 4: Implémenter** `encoding.ts`, `errors.ts`, `identity.ts`, `index.ts` (réexporte tout). Allouer les tampons avec `new Uint8Array(n)` pour rester assignable à `BufferSource`.
- [ ] **Step 5: Vérifier** — `pnpm --filter @ledge/seal test && pnpm --filter @ledge/seal typecheck` : PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(seal): device identities on WebCrypto P-256, private key non-extractable by default"`

### Task 2: `@ledge/seal`, poignée de main et canal chiffré

**Files:**
- Create: `packages/seal/src/channel.ts`
- Modify: `packages/seal/src/index.ts`
- Test: `packages/seal/test/channel.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Identity`, `importPublicKey`, `SealError`, `b64u`, `fromB64u`).
- Produces:
  - `type Role = 'pc' | 'device'`
  - `startHandshake(self: Identity, role: Role, peerPublicKey: string): Promise<Handshake>`
  - `interface Handshake { hello: string; finish(peerHello: string): Promise<Channel> }` — `hello` : clé publique éphémère (base64url, 65 octets)
  - `interface Channel { seal(text: string): Promise<string>; open(sealed: string): Promise<string> }`

Construction (à suivre exactement, les deux côtés doivent la calculer à l'identique) :

```
ss  = ECDH(static privé, static du pair)            32 octets
ee  = ECDH(éphémère privé, éphémère du pair)        32 octets
th  = SHA-256("ledge-seal/1" ‖ pcStatic ‖ deviceStatic ‖ pcEphemeral ‖ deviceEphemeral)   (clés brutes 65 octets, ordre fixé par le rôle)
okm = HKDF-SHA-256(ikm = ss ‖ ee, salt = th, info = "ledge-seal/1 keys", 64 octets)
kPcToDevice = okm[0..32]   kDeviceToPc = okm[32..64]   (AES-256-GCM, non extractibles)
trame scellée = b64u(seq ‖ ct)   seq : 8 octets big-endian, commence à 0
iv  = 4 octets nuls ‖ seq      aad = th ‖ seq
```

`open` accepte seulement `seq === attendu` (puis incrémente) : sinon `SealError('replay')` ; un échec d'AES-GCM donne `SealError('bad_seal')`. Les clés éphémères changent à chaque connexion, donc une trame d'une connexion précédente ne s'ouvre pas.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
async function pair() {
  const pc = await generateIdentity(), dev = await generateIdentity();
  const hp = await startHandshake(pc, 'pc', dev.publicKey);
  const hd = await startHandshake(dev, 'device', pc.publicKey);
  const [cpc, cdev] = await Promise.all([hp.finish(hd.hello), hd.finish(hp.hello)]);
  return { pc, dev, cpc, cdev };
}
describe('channel', () => {
  it('carries text both ways', async () => {
    const { cpc, cdev } = await pair();
    expect(await cdev.open(await cpc.seal('session.decide accept'))).toBe('session.decide accept');
    expect(await cpc.open(await cdev.seal('é ✓'))).toBe('é ✓');
  });
  it('refuses a replayed or reordered frame', async () => {
    const { cpc, cdev } = await pair();
    const a = await cpc.seal('a'), b = await cpc.seal('b');
    await expect(cdev.open(b)).rejects.toMatchObject({ code: 'replay' });
    expect(await cdev.open(a)).toBe('a');
    await expect(cdev.open(a)).rejects.toMatchObject({ code: 'replay' });
  });
  it('refuses a flipped bit', async () => {
    const { cpc, cdev } = await pair();
    const bytes = fromB64u(await cpc.seal('hello'));
    bytes[bytes.length - 1]! ^= 1;
    await expect(cdev.open(b64u(bytes))).rejects.toMatchObject({ code: 'bad_seal' });
  });
  it('does not open a frame from another connection', async () => {
    const first = await pair();
    const old = await first.cpc.seal('old');
    const hp = await startHandshake(first.pc, 'pc', first.dev.publicKey);
    const hd = await startHandshake(first.dev, 'device', first.pc.publicKey);
    const cdev = await hd.finish(hp.hello);
    await expect(cdev.open(old)).rejects.toMatchObject({ code: 'bad_seal' });
  });
  it('fails when a side expects another peer key', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity(), other = await generateIdentity();
    const hp = await startHandshake(pc, 'pc', other.publicKey);
    const hd = await startHandshake(dev, 'device', pc.publicKey);
    const [cpc, cdev] = await Promise.all([hp.finish(hd.hello), hd.finish(hp.hello)]);
    await expect(cdev.open(await cpc.seal('x'))).rejects.toMatchObject({ code: 'bad_seal' });
  });
  it('cannot open its own frame as the peer’s', async () => {
    const { cpc } = await pair();
    await expect(cpc.open(await cpc.seal('x'))).rejects.toMatchObject({ code: 'bad_seal' });
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/seal test` : FAIL.
- [ ] **Step 3: Implémenter** `startHandshake` dans `channel.ts` selon la construction ci-dessus ; `finish` lève `SealError('bad_key')` si `peerHello` n'est pas une clé valide.
- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/seal test` : PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(seal): a channel between two known keys, fresh per connection, replay refused"`

### Task 3: `@ledge/seal`, code de liaison à engagement

**Files:**
- Create: `packages/seal/src/pairing.ts`
- Modify: `packages/seal/src/index.ts`
- Test: `packages/seal/test/pairing.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `randomNonce(): string` (32 octets, base64url)
  - `commit(devicePublicKey: string, deviceNonce: string): Promise<string>` = b64u(SHA-256("ledge-pair/1 commit" ‖ devicePublicKey brut ‖ nonce brut))
  - `checkCommitment(commitment: string, devicePublicKey: string, deviceNonce: string): Promise<boolean>`
  - `pairingCode(input: { pcPublicKey: string; devicePublicKey: string; deviceNonce: string; pcNonce: string }): Promise<string>` → six chiffres `"482 913"` : les 4 premiers octets de SHA-256("ledge-pair/1 code" ‖ pcPublicKey ‖ devicePublicKey ‖ deviceNonce ‖ pcNonce), lus en uint32 big-endian, modulo 1 000 000, complétés à 6 chiffres, espace après le troisième.

Ordre de l'échange (mis en œuvre au lot 3, documenté en tête de `pairing.ts`) : le téléphone envoie l'engagement ; le PC répond avec sa clé publique et `pcNonce` ; le téléphone révèle sa clé et `deviceNonce` ; le PC vérifie l'engagement ; les deux affichent `pairingCode`. Les deux aléas empêchent un relais de chercher hors ligne un code qui coïncide des deux côtés : chaque côté fixe sa part avant de connaître celle de l'autre.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe('pairing code', () => {
  it('gives both sides the same six digits', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity();
    const input = { pcPublicKey: pc.publicKey, devicePublicKey: dev.publicKey, deviceNonce: randomNonce(), pcNonce: randomNonce() };
    const code = await pairingCode(input);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    expect(await pairingCode({ ...input })).toBe(code);
  });
  it('changes with any input', async () => {
    const a = await generateIdentity(), b = await generateIdentity(), c = await generateIdentity();
    const base = { pcPublicKey: a.publicKey, devicePublicKey: b.publicKey, deviceNonce: randomNonce(), pcNonce: randomNonce() };
    const code = await pairingCode(base);
    for (const change of [{ pcPublicKey: c.publicKey }, { devicePublicKey: c.publicKey }, { deviceNonce: randomNonce() }, { pcNonce: randomNonce() }])
      expect(await pairingCode({ ...base, ...change })).not.toBe(code);   // 1 chance sur 10^6 de collision par cas
  });
  it('checks the commitment against the revealed key and nonce', async () => {
    const dev = await generateIdentity(), other = await generateIdentity(), n = randomNonce();
    const c = await commit(dev.publicKey, n);
    expect(await checkCommitment(c, dev.publicKey, n)).toBe(true);
    expect(await checkCommitment(c, other.publicKey, n)).toBe(false);
    expect(await checkCommitment(c, dev.publicKey, randomNonce())).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — FAIL.
- [ ] **Step 3: Implémenter** `pairing.ts` (comparaison de l'engagement en temps constant sur les 32 octets).
- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/seal test && pnpm --filter @ledge/seal typecheck` : PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(seal): a six-digit linking code with a commitment, so a relay cannot grind a match"`

### Task 4: trames du relais et cœur de routage

**Files:**
- Create: `packages/protocol/src/relay.ts`, `packages/protocol/test/relay.test.ts`
- Modify: `packages/protocol/src/index.ts` (ajoute `export * from './relay.js';`)
- Create: `apps/relay/package.json`, `apps/relay/tsconfig.json`, `apps/relay/src/hub.ts`, `apps/relay/src/log.ts`
- Test: `apps/relay/test/hub.test.ts`

**Interfaces:**
- Produces (`@ledge/protocol`) :
  - `SEALED_MAX = 1_048_576` (caractères d'un corps)
  - `RelayPeerSchema = z.union([z.literal('pc'), z.string().regex(/^d_[A-Za-z0-9_-]{16,40}$/)])` — `'pc'` ou un identifiant d'appareil
  - `RelayClientMessageSchema` : `{ type: 'send', to: RelayPeer, body: string ≤ SEALED_MAX }`
  - `RelayServerMessageSchema` (union discriminée sur `type`) :
    - `{ type: 'welcome', accountId: string, self: RelayPeer, online: RelayPeer[] }` — `online` : les pairs du compte joignables à cet instant (pour un appareil : `['pc']` ou `[]`)
    - `{ type: 'deliver', from: RelayPeer, body: string }`
    - `{ type: 'presence', peer: RelayPeer, online: boolean }`
    - `{ type: 'error', code: 'bad_frame' | 'too_large' | 'bad_target' | 'offline' | 'rate_limited', to?: RelayPeer }`
  - `parseRelayClientMessage(raw: unknown)`, `parseRelayServerMessage(raw: unknown)` sur le modèle de `parseClientMessage`
  - `SealedFrameSchema = z.discriminatedUnion('k', [{ k: 'hello', e: string }, { k: 'msg', s: string }])` — le contenu de `body` entre le PC et un appareil ; le relais ne le lit jamais
- Produces (`apps/relay`) :
  - `interface Who { accountId: string; peer: RelayPeer }`
  - `interface Conn { send(msg: RelayServerMessage): void; close(code: number, reason: string): void }`
  - `class Hub { constructor(log: RelayLog, limits?: Partial<Limits>); attach(conn: Conn, who: Who): void; detach(conn: Conn, code: number): void; receive(conn: Conn, raw: string): void }`
  - `interface Limits { framesPerWindow: number; windowMs: number; now: () => number }`, défauts `300`, `10_000` et `Date.now`
  - `type RelayLogEvent` = `{ ev: 'connect', account, peer }` | `{ ev: 'disconnect', account, peer, code, ms, framesIn, framesOut, bytesIn, bytesOut }` | `{ ev: 'refused', reason: 'no_auth' | 'bad_path' }` | `{ ev: 'frame_error', account, peer, code }` ; `type RelayLog = (e: RelayLogEvent) => void` ; `jsonLog: RelayLog` écrit une ligne JSON avec `at` sur stdout. Aucun champ texte libre : un événement ne peut pas porter de contenu.

Règles du `Hub` :
- Les sockets sont rangés par `accountId`, puis par `peer`. Un nouveau socket pour le même `(compte, peer)` remplace l'ancien, fermé avec `4000, 'replaced'`, sans événement de présence intermédiaire.
- À l'attache : `welcome` au socket, puis `presence online` aux autres pairs du compte (au PC pour un appareil, à tous les appareils pour le PC). Au détachement d'un socket encore courant : `presence offline` de la même façon, puis le log `disconnect`.
- `send` d'un appareil : seulement `to: 'pc'`, sinon `bad_target`. `send` du PC : seulement vers un appareil du même compte, sinon `bad_target`. Une cible du compte sans socket : `offline` avec `to`.
- JSON invalide ou schéma refusé : `bad_frame` ; `body` trop long : `too_large` ; plus de `framesPerWindow` trames dans `windowMs` : `rate_limited` et trame ignorée. Chaque erreur est loguée en `frame_error` sans le contenu.

- [ ] **Step 1: Créer `apps/relay`** — `package.json` : `"name": "@ledge/relay"`, `private`, `type: module`, `engines.node >=22`, scripts `dev` (`tsx src/main.ts`), `build` (`tsup`), `test`, `typecheck` ; dépendances `ws ^8.18.0`, `zod ^3.23.8` ; devDependencies `@ledge/protocol` et `@ledge/seal` en `workspace:*`, `@types/node ^22.7.0`, `@types/ws ^8.5.12`, `tsup ^8.3.0`. `tsconfig.json` comme `packages/seal`. `pnpm install`.

- [ ] **Step 2: Écrire les tests qui échouent**

`packages/protocol/test/relay.test.ts` : `send` accepté vers `'pc'` et vers `d_` + 16 caractères ; refusé vers `'d_court'`, vers `'admin'`, avec un `body` de `SEALED_MAX + 1` caractères ; `welcome`/`deliver`/`presence`/`error` passent `parseRelayServerMessage`.

`apps/relay/test/hub.test.ts`, avec un faux `Conn` qui garde `sent` et `closed` :

```ts
const D1 = 'd_aaaaaaaaaaaaaaaa', D2 = 'd_bbbbbbbbbbbbbbbb';
it('routes a device frame to its PC and back', ...);           // deliver { from: D1 } côté PC ; deliver { from: 'pc' } côté D1
it('welcomes with who is online and tells the others', ...);   // D1 seul : welcome.online = [] ; le PC arrive : D1 reçoit presence pc online ; welcome du PC : online = [D1]
it('replaces a second PC socket and closes the first', ...);   // premier conn closed = [4000, 'replaced'] ; un message de D1 n'arrive qu'au second ; aucun presence offline envoyé
it('keeps accounts apart', ...);                               // PC du compte A envoie à un D1 du compte B : error bad_target ; rien chez B
it('refuses device-to-device frames', ...);                    // D1 → D2 : error bad_target
it('says offline instead of queuing', ...);                    // D1 → pc sans PC : error offline to 'pc' ; le PC arrivé ensuite ne reçoit rien d'ancien
it('answers bad JSON, unknown types and oversize bodies on that socket only', ...);
it('rate-limits a flooding socket', ...);                      // limits { framesPerWindow: 3, windowMs: 1000 } : 4e trame → rate_limited, pas livrée
it('logs sizes and counts, never a body', ...);                // corps contenant 'SECRET-123' livré puis frame invalide contenant 'SECRET-456' : aucune ligne JSON.stringify(event) ne contient 'SECRET'
```

- [ ] **Step 3: Vérifier l'échec** — `pnpm --filter @ledge/protocol test && pnpm --filter @ledge/relay test` : FAIL.
- [ ] **Step 4: Implémenter** `relay.ts` (protocole), `log.ts` et `hub.ts` selon les règles ci-dessus ; la fenêtre de débit est par socket (compteur remis à zéro quand `windowMs` est écoulé, horloge lue par `limits.now`, injectable pour le test).
- [ ] **Step 5: Vérifier** — `pnpm --filter @ledge/protocol test && pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` : PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(relay): frames and a hub that routes opaque bodies between a PC and its devices, accounts apart"`

### Task 5: serveur HTTP/websocket, jetons de dev et essai de bout en bout

**Files:**
- Create: `apps/relay/src/auth.ts`, `apps/relay/src/server.ts`, `apps/relay/src/main.ts`, `apps/relay/tsup.config.ts`, `apps/relay/README.md`
- Test: `apps/relay/test/server.test.ts`, `apps/relay/test/end-to-end.test.ts`

**Interfaces:**
- Consumes: Task 4 (`Hub`, `Who`, `RelayLog`, `jsonLog`, schémas), Tasks 1-2 (`generateIdentity`, `startHandshake`) dans le test de bout en bout.
- Produces:
  - `interface Authenticator { authenticate(req: IncomingMessage): Promise<Who | null> }`
  - `RELAY_PROTOCOL_PREFIX = 'ledge-relay.'` — le navigateur présente son jeton en sous-protocole `ledge-relay.<jeton>` (il ne peut pas poser `Authorization`), le daemon en `Authorization: Bearer <jeton>` ; même principe que `DAEMON_PROTOCOL_PREFIX` dans `packages/ledge/src/auth.ts`
  - `devTokens(map: Record<string, Who>): Authenticator` — comparaison des jetons avec `timingSafeEqual` sur leurs SHA-256
  - `createRelay(opts: { authenticator: Authenticator; log?: RelayLog; limits?: Partial<Limits> }): { server: http.Server; close(): Promise<void> }` — `GET /healthz` → `200 ok` ; websocket sur `/ws` seulement (autre chemin : 404 et `refused bad_path`) ; jeton absent ou inconnu : réponse 401 à l'upgrade et `refused no_auth` ; `maxPayload` = `SEALED_MAX + 4096` ; toute autre route HTTP → 404
  - `main.ts` : écoute `PORT` (défaut `8787`) ; lit `LEDGE_RELAY_DEV_TOKENS` (JSON `{ "<jeton>": { "accountId": "...", "peer": "pc" | "d_..." } }`, validé par zod) ; refuse de démarrer, avec un message qui le dit, si `NODE_ENV === 'production'` ou si la variable manque (les comptes GitHub arrivent au lot 2)

- [ ] **Step 1: Écrire les tests qui échouent**

`server.test.ts` (serveur sur le port 0, vrais clients `ws`) :
- `GET /healthz` → 200 `ok` ; `GET /` → 404.
- upgrade sans jeton → l'événement `unexpected-response` du client donne 401 ; un log `refused no_auth`.
- jeton en `Authorization: Bearer` et jeton en sous-protocole `ledge-relay.<jeton>` → `welcome` reçu dans les deux cas ; avec le sous-protocole, `ws.protocol` vaut le sous-protocole offert.
- upgrade sur `/autre` avec un bon jeton → 404.
- une trame `not json` → `error bad_frame`, puis la même connexion livre encore une trame valide.

`end-to-end.test.ts` : un PC et un appareil du compte `acct-1` (jetons de dev), plus un appareil d'un compte `acct-2` connecté en même temps.

```ts
it('carries a sealed exchange the relay cannot read', async () => {
  // poignée de main : chacun envoie { k: 'hello', e: handshake.hello } en body, puis finish() avec la hello reçue
  // le téléphone envoie { k: 'msg', s: await channel.seal('session.reply hi SECRET-789') }
  // le PC ouvre et lit 'session.reply hi SECRET-789'
  // aucun body vu passer (journal de la fonction log + interception des deliver) ne contient 'SECRET' ;
  // l'appareil de acct-2 n'a reçu que son welcome
});
it('a body changed by the relay does not open', async () => {
  // sans serveur : un Hub et deux faux Conn ; le Conn du PC réécrit un caractère du champ s de chaque deliver
  // avant de le passer au canal du PC (le relais malveillant) : open rejette avec bad_seal
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/relay test` : FAIL.
- [ ] **Step 3: Implémenter** `auth.ts`, `server.ts` (`WebSocketServer` en `noServer`, `server.on('upgrade')` qui authentifie avant `handleUpgrade`, `handleProtocols` qui renvoie le sous-protocole `ledge-relay.` présenté), `main.ts`, `tsup.config.ts` (`entry: ['src/main.ts']`, `target: 'node22'`, `noExternal: ['@ledge/protocol', '@ledge/seal']`, même raison que `packages/ledge/tsup.config.ts`).
- [ ] **Step 4: Écrire `apps/relay/README.md`** — comment le lancer en local : `LEDGE_RELAY_DEV_TOKENS='{"tok-pc-0123456789abcdef":{"accountId":"me","peer":"pc"}}' pnpm --filter @ledge/relay dev`, et ce qui manque avant la mise en service (lots 2 et 7 de la feuille de route).
- [ ] **Step 5: Vérifier** — `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck && pnpm --filter @ledge/relay build` : PASS ; puis lancer `node apps/relay/dist/main.js` avec la variable de l'étape 4 et `curl -s localhost:8787/healthz` → `ok`.
- [ ] **Step 6: Vérifier tout l'espace de travail** — `pnpm typecheck && pnpm -r --no-bail test` : seuls les échecs déjà présents sur origin/main restent (2 tests tmux, dépendants de tmux 3.2a ; les tests overlay/desktop instables sous charge passent en relance isolée).
- [ ] **Step 7: Commit** — `git commit -m "feat(relay): http and websocket server with dev tokens; a sealed PC-phone exchange crosses it unread"`
