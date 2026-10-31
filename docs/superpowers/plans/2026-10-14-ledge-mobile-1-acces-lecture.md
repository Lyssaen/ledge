# Ledge mobile — lot 1 : accès en lecture — plan d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUIS : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour réaliser ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** un iPhone appairé par code et clé WebAuthn se connecte à une entrée distante séparée. Il y voit les demandes en attente et leur contexte. Toute décision distante est refusée par le daemon. L'overlay liste et retire les appareils.

**Architecture :** listener distant `127.0.0.1:47832` (fichiers `/m/` + WebSocket `/m/ws`), authentification par jeton au premier message, contexte de pair, projection et liste fermée de commandes. La PWA `apps/mobile` est construite dans `packages/ledge/dist/mobile`. Le code client commun est extrait dans `@ledge/client`.

**Pile technique :** voir le [plan directeur](2026-10-14-ledge-mobile.md). Ce lot ajoute `@simplewebauthn/server`, `@simplewebauthn/browser`, `uqr` (QR dans l'overlay) et les polices Geist.

**Spec :** [`2026-10-14-ledge-mobile-design.md`](../specs/2026-10-14-ledge-mobile-design.md), §2 (À traiter, Détail, Connexion perdue, Connecter le téléphone), §3, §5, §6 (fichiers PWA), §7 et §9.1.

**Prérequis :** tâche 0 du plan directeur, avec H1 et H3 confirmées.

## Global Constraints

Celles du [plan directeur](2026-10-14-ledge-mobile.md#global-constraints), plus, pour ce lot :
- « Liste des demandes et contexte, décisions encore désactivées » (spec §9.1) : le daemon refuse `session.decide`, `session.reply` et `session.interrupt` venant d'un pair distant.
- `README.md` contient des modifications non commitées au 2026-10-14 : les intégrer, ne jamais les écraser.

## Review Focus

Les cinq lignes du plan directeur s'appliquent à l'ensemble. Ce lot porte la ligne 3 (tâche 2). En plus, pour ce lot :
- **Jeton expiré côté iPhone** (stockage purgé, H5) : l'app reçoit 4401 et doit ouvrir l'appairage, sans boucle de reconnexion. → Tâche 11, test `4401 clears the token and shows pairing without reconnecting`.

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `packages/protocol/src/remote.ts` | Constantes de l'entrée distante, schémas `Device` et `PairError`. |
| `packages/ledge/src/daemon/identify.ts` | Identité et version des demandes (pur). |
| `packages/client/` | `@ledge/client` : client WebSocket, `reply/parse`, `materialFor`, `poseFor`, `BotShell`. |
| `packages/ledge/src/daemon/peers.ts` | Registre des pairs, diffusion projetée. |
| `packages/ledge/src/daemon/remote/project.ts`, `rights.ts` | Ce qu'un pair distant reçoit et peut exécuter. |
| `packages/ledge/src/daemon/remote/listener.ts`, `static.ts` | HTTP `/m/`, upgrade `/m/ws`, authentification et appairage avant l'auth. |
| `packages/ledge/src/mobile/config.ts`, `src/cli/mobile.ts` | Origine HTTPS et commande `ledge mobile`. |
| `packages/ledge/src/daemon/devices.ts` | Appareils et jetons hachés. |
| `packages/ledge/src/daemon/webauthn.ts`, `pairing.ts` | Enregistrement WebAuthn, fenêtre de code. |
| `apps/overlay/src/surface/MobileSettings.tsx` | Réglages › Mobile. |
| `apps/mobile/` | La PWA. |

---

### Task 1: Protocole de l'entrée distante et identité des demandes

**Fichiers :**
- Créer : `packages/protocol/src/remote.ts`
- Modifier : `packages/protocol/src/session.ts`, `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`
- Test : `packages/protocol/test/remote.test.ts`

**Interfaces :**
- Produit : `REMOTE_PORT = 47832`, `MOBILE_BASE = '/m/'`, `MOBILE_WS_PATH = '/m/ws'`, `PAIR_CODE_TTL_MS = 120_000`, `PAIR_MAX_ATTEMPTS = 5`, `AUTH_TIMEOUT_MS = 5_000`, `REMOTE_CLOSE = { unauthenticated: 4401, revoked: 4403, timeout: 4408 } as const`.
- Produit : `DeviceSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(60), createdAt: z.string().datetime(), lastSeenAt: z.string().datetime().optional(), hasKey: z.boolean() })`, `PairErrorSchema = z.enum(['not_configured', 'no_window', 'invalid_code', 'expired', 'locked', 'webauthn_failed'])`.
- Produit : `PendingSchema` + `id: z.string().optional()`, `version: z.number().int().positive().optional()`, `since: z.string().datetime().optional()`, `reason: z.string().max(500).optional()` ; `SessionSchema` + `pendingSeq: z.number().int().nonnegative().optional()` ; `SessionEventSchema` + `reason: z.string().max(500).optional()`.
- Produit (`ClientMessage`) : `auth { token: string(32..128) }`, `pair.begin {}`, `pair.options { code: /^\d{6}$/ }`, `pair.complete { code, deviceName: string(1..60), webauthn: RegistrationJsonSchema }`, `devices {}`, `device.revoke { id }`, `mobile.configure { origin: string.url() https | null }`.
- Produit (`ServerMessage`) : `auth.ok { deviceId, deviceName, pcName }`, `pair.code { code, expiresAt, url }`, `pair.challenge { options: z.record(z.unknown()), expiresAt }`, `pair.done { token, deviceId }`, `pair.error { reason: PairError }`, `devices { devices: Device[], origin: string | null, listening: boolean }`.
- `RegistrationJsonSchema = z.object({ id: z.string(), rawId: z.string(), type: z.literal('public-key'), response: z.object({ clientDataJSON: z.string(), attestationObject: z.string() }).passthrough() }).passthrough()`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('parses auth and refuses a short token', () => {
  expect(parseClientMessage({ type: 'auth', token: 'a'.repeat(43) }).type).toBe('auth');
  expect(() => parseClientMessage({ type: 'auth', token: 'short' })).toThrow();
});
it('pair.code carries exactly six digits', () => {
  expect(() => parseServerMessage({ type: 'pair.code', code: '48120', expiresAt: T, url: 'https://pc.t.ts.net/m/#/pair' })).toThrow();
});
it('mobile.configure accepts https or null, never http', () => {
  expect(parseClientMessage({ type: 'mobile.configure', origin: null }).type).toBe('mobile.configure');
  expect(() => parseClientMessage({ type: 'mobile.configure', origin: 'http://pc.t.ts.net' })).toThrow();
});
it('a journal pending without id, version or since still parses', () => {
  expect(PendingSchema.parse({ kind: 'permission', text: 'ls', source: 'hook' }).id).toBeUndefined();
});
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @ledge/protocol exec vitest run test/remote.test.ts`
Attendu : ÉCHEC (`remote.ts` absent, types inconnus).

- [ ] **Étape 3 : implémenter les schémas ci-dessus**

`mobile.configure` utilise un `refine(u => u === null || new URL(u).protocol === 'https:')`.

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @ledge/protocol test && pnpm -r typecheck`
Attendu : PASS. Les paquets qui lisent `ClientMessage` compilent ; les `switch` exhaustifs signalent les nouveaux types, traités aux tâches 4 et 8.

- [ ] **Étape 5 : commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): remote entry, devices, pairing messages and pending identity fields"
```

### Task 2: Identité des demandes dans le reducer

**Fichiers :**
- Créer : `packages/ledge/src/daemon/identify.ts`
- Modifier : `packages/ledge/src/daemon/state.ts` (`reduce` enveloppe le reducer actuel renommé `reduceEvent` ; `mergePending` conserve `id`/`since` quand un hook remplace une demande du pane ; `pendingFor` recopie `ev.reason`), `packages/ledge/src/daemon/store.ts` (`load()` identifie les demandes sans `id`), `packages/ledge/src/cli/hook.ts` (`reason` = `tool_input.description` de Bash sur `PermissionRequest`/`PreToolUse`)
- Test : `packages/ledge/test/identify.test.ts`, `packages/ledge/test/hook.test.ts`

**Interfaces :**
- Produit : `identify(before: Session, after: Session, at: string): Session` ; `pendingKey(p: Pending): string`.
- `reduce(s, ev)` garde sa signature et renvoie le même objet quand rien ne change (contrat de `Store.apply`).

Algorithme (les tests ne le déterminent pas entièrement) :

```
identify(before, after, at):
  if after === before or !after.pending: return after
  p = after.pending
  if !p.id:
    seq = (after.pendingSeq ?? 0) + 1
    return { ...after, pendingSeq: seq, pending: { ...p, id: `p${seq}-${Date.parse(at).toString(36)}`, version: 1, since: at } }
  if before.pending?.id === p.id and pendingKey(before.pending) !== pendingKey(p):
    return { ...after, pending: { ...p, version: (before.pending.version ?? 1) + 1 } }
  return after
pendingKey(p) = JSON.stringify([p.kind, p.text, p.tool ?? null, p.options ?? null, p.helperId ?? null, p.reason ?? null])
```

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a new pending gets p1, version 1 and since = event time', () => {
  const s = reduce(base(), ev('PermissionRequest', { tool: 'Bash', text: 'ls', at: T1 }));
  expect(s.pending).toMatchObject({ id: `p1-${Date.parse(T1).toString(36)}`, version: 1, since: T1 });
  expect(s.pendingSeq).toBe(1);
});
it('hook over pane keeps id and bumps version', () => {
  const a = reduce(base({ tool: 'codex' }), ev('PanePrompt', { kind: 'permission', text: 'git push', source: 'pane' }));
  const b = reduce(a, ev('PermissionRequest', { tool: 'Bash', text: 'git push --force origin main' }));
  expect(b.pending!.id).toBe(a.pending!.id);
  expect(b.pending!.version).toBe(2);
});
it('the same request again after a decision is a new id', () => {
  const a = reduce(base(), ev('PermissionRequest', { tool: 'Bash', text: 'ls' }));
  const b = reduce(reduce(a, ev('Decided', { source: 'daemon' })), ev('PermissionRequest', { tool: 'Bash', text: 'ls', at: T2 }));
  expect(b.pending!.id).not.toBe(a.pending!.id);
});
it('a helper request routed to the parent has its own id', () => { /* SubagentStart + helper PermissionRequest */ });
it('nothing changes: reduce returns the same object', () => { const s = idle(); expect(reduce(s, ev('PaneIdle'))).toBe(s); });
it('store.load gives an id to a journal pending that has none', async () => { /* writes a journal, loads, expects pending.id */ });
// hook.test.ts
it('a Bash permission carries the tool description as reason', () => {
  expect(mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'pnpm test', description: 'Run the overlay tests' } }, T)!.event.reason).toBe('Run the overlay tests');
});
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/identify.test.ts test/hook.test.ts`
Attendu : ÉCHEC (`pending.id` indéfini, `reason` absent).

- [ ] **Étape 3 : implémenter `identify` et brancher `reduce`, `mergePending`, `store.load` et `hook.ts`**

- [ ] **Étape 4 : vérifier toute la suite du daemon**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS, y compris `state.test.ts` et `server.test.ts` existants. Un `toEqual` existant sur `pending` qui échoue à cause des nouveaux champs se corrige avec `toMatchObject`, sans changer l'assertion de fond.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon/identify.ts packages/ledge/src/daemon/state.ts packages/ledge/src/daemon/store.ts packages/ledge/src/cli/hook.ts packages/ledge/test
git commit -m "feat(daemon): stable identity and version for pending requests"
```

### Task 3: Paquet partagé `@ledge/client`

**Fichiers :**
- Créer : `packages/client/package.json` (`"name": "@ledge/client"`, `main`/`types`/`exports` sur `./src/index.ts` comme `@ledge/protocol` ; dépendance `@ledge/protocol: workspace:*` ; `react` en peerDependency), `packages/client/tsconfig.json`, `packages/client/vitest.config.ts`, `packages/client/src/index.ts`, `packages/client/src/bots/BotShell.tsx`
- Déplacer : `apps/overlay/src/daemon/client.ts` → `packages/client/src/daemonClient.ts` ; `apps/overlay/src/reply/parse.ts` → `packages/client/src/reply/parse.ts` ; `apps/overlay/src/bots/material.ts` et `poseFor.ts` → `packages/client/src/bots/` ; `apps/overlay/src/surface/groups.ts` (pur) → `packages/client/src/groups.ts`
- Déplacer les tests : `apps/overlay/test/reply-parse.test.ts` → `packages/client/test/reply-parse.test.ts` ; `apps/overlay/test/groups.test.ts` → `packages/client/test/groups.test.ts` ; les cas de `apps/overlay/test/daemon.test.ts` qui portent sur `createDaemonClient` → `packages/client/test/daemon-client.test.ts`
- Modifier : tous les imports de l'overlay vers `@ledge/client` ; `apps/overlay/package.json` (dépendance `@ledge/client: workspace:*`) ; `apps/overlay/src/bots/Bot.tsx` (utilise `BotShell`)

**Interfaces :**
- Produit : `createDaemonClient(opts: { url: string; WebSocketImpl?: WsCtor; minBackoffMs?: number; maxBackoffMs?: number; hello?: () => ClientMessage | null; onClose?: (code: number) => void; stopOn?: readonly number[] }): DaemonClient`. `hello` est envoyé à chaque ouverture, avant tout autre message. Un code de fermeture listé dans `stopOn` arrête les reconnexions. `DaemonStatus` reste inchangé.
- Produit : `parseReply`, `materialFor`, `poseFor`, `groupSessions`, `tildePath` (signatures inchangées) ; `BotShell(props: { tool: Tool; fill: string }): JSX.Element` (la coque `rect`/`ellipse`/`path` de `Bot.tsx`, lignes 60-63).

- [ ] **Étape 1 : déplacer les tests, ajouter ceux du client étendu**

```ts
it('sends hello before anything else on each open', () => { /* fake WS: first sent frame is the hello, on every reconnect */ });
it('reports the close code', () => { /* close(4401) → onClose called with 4401 */ });
it('does not reconnect after a stop code', () => { /* stopOn [4401]; close(4401); advance timers 60 s; no new socket */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @ledge/client test`
Attendu : ÉCHEC (paquet ou options absents).

- [ ] **Étape 3 : déplacer le code, ajouter `hello`, `onClose` et `stopOn`, extraire `BotShell`, réécrire les imports**

`pnpm install` met à jour le lockfile du workspace.

- [ ] **Étape 4 : vérifier qu'aucun comportement de l'overlay ne change**

Exécuter : `pnpm --filter @ledge/client test && pnpm --filter overlay test && pnpm --filter overlay test:e2e && pnpm -r typecheck`
Attendu : PASS ; les tests e2e de l'overlay (dont `visual.spec.ts`) restent inchangés.

- [ ] **Étape 5 : commit**

```bash
git add packages/client apps/overlay pnpm-lock.yaml
git commit -m "refactor: share the daemon client, reply parser and bot shell in @ledge/client"
```

### Task 4: Pairs, projection et droits distants

**Fichiers :**
- Créer : `packages/ledge/src/daemon/peers.ts`, `packages/ledge/src/daemon/remote/project.ts`, `packages/ledge/src/daemon/remote/rights.ts`
- Modifier : `packages/ledge/src/daemon/server.ts` (`handle(peer, msg)` remplace `handle(ws, msg)` ; diffusion par `peers` ; `attach()` ; `verifyClient` refuse les en-têtes de transfert)
- Test : `packages/ledge/test/remote-project.test.ts`, `packages/ledge/test/server.test.ts`

**Interfaces :**
- Produit (`peers.ts`) : `type PeerContext = { kind: 'local' } | { kind: 'remote'; deviceId: string }` ; `interface PeerSocket { send(data: string): void; close(code?: number, reason?: string): void; on(ev: 'message' | 'close' | 'error', fn: (...a: any[]) => void): unknown; readyState: number }` ; `interface Peer { ctx: PeerContext; send(msg: ServerMessage): void; close(code: number): void }` ; `createPeers(): { add(p: Peer): () => void; broadcast(msg: ServerMessage): void; closeDevice(deviceId: string, code: number): number; all(): Peer[] }`. `Peer.send` d'un pair distant passe toujours par `toRemote`.
- Produit (`project.ts`) : `toRemote(msg: ServerMessage, view: { deviceId: string }): ServerMessage | null`. Lot 1 : `snapshot` réduit à `{ type, sessions }` ; `session.updated`, `session.removed`, `session.preview`, `error`, `auth.ok`, `pair.*` transmis ; tout autre type → `null`. Chaque session projetée a `tmuxSession: null`.
- Produit (`rights.ts`) : `PRE_AUTH: ReadonlySet<ClientMessage['type']> = new Set(['auth', 'pair.options', 'pair.complete'])` ; `MOBILE_COMMANDS: ReadonlySet<ClientMessage['type']> = new Set(['snapshot.request'])` (étendu aux lots 2, 3 et 4) ; `remoteMayRun(msg: ClientMessage): boolean`.
- Produit (`server.ts`) : `ServerHandle.attach(socket: PeerSocket, ctx: PeerContext): void` (enregistre le pair, envoie l'instantané projeté et câble les messages) ; `ServerHandle.peers` ; `FORWARDED_HEADERS = ['tailscale-user-login', 'x-forwarded-for', 'forwarded']`. Une commande distante refusée reçoit `error { message: 'forbidden' }` et est journalisée (`remote <deviceId> refused <type>`).

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a remote snapshot has sessions only, without launcher, recents and daemon', () => {
  const m = toRemote({ type: 'snapshot', sessions: [mk('a')], recents: [R], launcher: ['node', 'x'], daemon: D }, view)!;
  expect(Object.keys(m).sort()).toEqual(['sessions', 'type']);
  expect((m as any).sessions[0].tmuxSession).toBeNull();
});
it('drops chat, document, folder, update, recents and launched messages for a remote peer', () => {
  for (const msg of [chatDone, docContent, folderListing, updateProgress, recents, launched]) expect(toRemote(msg, view)).toBeNull();
});
it('a remote peer may only run snapshot.request in this lot', () => {
  expect(remoteMayRun({ type: 'snapshot.request' })).toBe(true);
  for (const t of ['session.decide', 'session.reply', 'session.interrupt', 'document.read', 'session.launch', 'folder.create', 'update.daemon', 'pair.begin', 'device.revoke', 'mobile.configure', 'session.event', 'chat.ask'] as const)
    expect(remoteMayRun({ type: t } as never)).toBe(false);
});
it('a remote session.decide is refused as forbidden and nothing is typed', async () => {
  const sock = fakeSocket(); srv.attach(sock, { kind: 'remote', deviceId: 'd1' });
  sock.receive({ type: 'session.decide', id: 'a', decision: 'accept' });
  expect(await sock.next('error')).toMatchObject({ message: 'forbidden' });
  expect(tmux.sent).toEqual([]);
});
// server.test.ts
it('refuses a forwarded upgrade on the local port', async () => {
  expect(await handshake(srv.port, undefined, { 'x-forwarded-for': '100.64.0.2' })).toBe(401);
  expect(await handshake(srv.port, undefined, { 'tailscale-user-login': 'me@example.com' })).toBe(401);
});
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/remote-project.test.ts test/server.test.ts`
Attendu : ÉCHEC sur les nouveaux cas.

- [ ] **Étape 3 : implémenter**

`handshake()` de `server.test.ts` accepte des en-têtes supplémentaires. Le flux local reste identique : `send(ws, …)` devient `peer.send(…)` avec un pair local transparent.

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS, tous les tests existants de `server.test.ts` compris.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon packages/ledge/test
git commit -m "feat(daemon): peer contexts, remote projection and a closed list of remote commands"
```

### Task 5: Configuration mobile et commande `ledge mobile`

**Fichiers :**
- Créer : `packages/ledge/src/mobile/config.ts`, `packages/ledge/src/cli/mobile.ts`
- Modifier : `packages/ledge/src/paths.ts` (`devices`, `mobile`, `history`, `vapid`), `packages/ledge/src/cli/index.ts` (commande `mobile`)
- Test : `packages/ledge/test/mobile-config.test.ts`, `packages/ledge/test/mobile-cli.test.ts`

**Interfaces :**
- Produit : `interface MobileConfig { origin: string; rpID: string }` ; `parseOrigin(input: string): MobileConfig` (https seulement ; ni chemin hors `/`, ni requête, ni identifiants, ni port non standard ; `rpID` = nom d'hôte) ; `loadMobileConfig(path = paths().mobile): Promise<MobileConfig | null>` ; `saveMobileConfig(cfg: MobileConfig | null, path?): Promise<void>` (0600 ; `null` supprime le fichier).
- Produit : `runMobile(argv: string[], deps?: { connect?: typeof connect; print?: (s: string) => void }): Promise<number>`. `enable --origin <url>` envoie `mobile.configure` et affiche la commande Windows `tailscale serve --bg --https=443 http://127.0.0.1:47832`. `disable` envoie `mobile.configure { origin: null }`. `status` envoie `devices` et affiche l'origine, l'état d'écoute et les appareils.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('derives rpID from an https tailnet origin', () => expect(parseOrigin('https://pc.tail1.ts.net')).toEqual({ origin: 'https://pc.tail1.ts.net', rpID: 'pc.tail1.ts.net' }));
it('refuses http, paths, credentials and odd ports', () => {
  for (const o of ['http://pc.t.ts.net', 'https://pc.t.ts.net/m/', 'https://u@pc.t.ts.net', 'https://pc.t.ts.net:8443']) expect(() => parseOrigin(o)).toThrow();
});
it('saves the config readable by its owner only', async () => { await saveMobileConfig(cfg, p); expect(statSync(p).mode & 0o777).toBe(0o600); });
it('enable sends mobile.configure and prints the tailscale serve command', async () => { /* fake connect; expects message and printed line */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/mobile-config.test.ts test/mobile-cli.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : la commande de l'étape 2.
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/mobile packages/ledge/src/cli packages/ledge/src/paths.ts packages/ledge/test
git commit -m "feat(cli): ledge mobile enable, disable and status"
```

### Task 6: Registre des appareils et révocation

**Fichiers :**
- Créer : `packages/ledge/src/daemon/devices.ts`
- Modifier : `packages/ledge/src/daemon/server.ts` (commandes locales `devices`, `device.revoke`, `mobile.configure` via `opts.mobile`)
- Test : `packages/ledge/test/devices.test.ts`, `packages/ledge/test/server.test.ts`

**Interfaces :**
- Produit : `interface StoredCredential { id: string; publicKey: string; counter: number; transports?: string[] }` ; `interface DeviceRecord { id: string; name: string; tokenHash: string; createdAt: string; lastSeenAt?: string; credential: StoredCredential }`.
- Produit : `class DeviceStore { constructor(opts?: { path?: string; now?: () => string }); load(): Promise<void>; list(): Device[]; get(id: string): DeviceRecord | undefined; byToken(token: string): DeviceRecord | undefined; create(name: string, credential: StoredCredential): Promise<{ device: DeviceRecord; token: string }>; touch(id: string): Promise<void>; setCounter(id: string, counter: number): Promise<void>; revoke(id: string): Promise<boolean>; onChange(fn: () => void): () => void }`. Le jeton fait 32 octets aléatoires en base64url ; seul `sha256(token)` en hexadécimal est stocké. Fichier 0600, écrit de façon atomique (`.tmp` puis `rename`).
- Produit : `interface MobileControl { state(): { origin: string | null; listening: boolean }; configure(origin: string | null): Promise<void>; devices: DeviceStore }`, reçu par `startServer({ …, mobile?: MobileControl })`. La tâche 8 y ajoute `pairing: Pairing`. Sans `mobile`, les trois commandes répondent `error { message: 'mobile not available' }`.
- `device.revoke` : `devices.revoke(id)`, puis `peers.closeDevice(id, REMOTE_CLOSE.revoked)`, puis `devices` diffusé aux pairs locaux.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('returns the token once and never writes it to disk', async () => {
  const { token, device } = await store.create('iPhone', cred);
  expect(readFileSync(p, 'utf8')).not.toContain(token);
  expect(store.byToken(token)?.id).toBe(device.id);
});
it('an unknown token finds nothing', () => expect(store.byToken('x'.repeat(43))).toBeUndefined());
it('revoke removes the device; a second revoke is false', async () => { /* … */ });
it('keeps devices across a reload; a corrupt file starts empty and is logged', async () => { /* … */ });
it('device.revoke closes that device\'s open sockets with 4403 and tells local peers', async () => { /* attach fake remote socket d1; local client sends device.revoke; expect close code 4403 and a devices message */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/devices.test.ts test/server.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge/src/daemon packages/ledge/test
git commit -m "feat(daemon): device registry with hashed tokens and revocation"
```

### Task 7: Enregistrement WebAuthn et fenêtre d'appairage

**Fichiers :**
- Créer : `packages/ledge/src/daemon/webauthn.ts`, `packages/ledge/src/daemon/pairing.ts`, `packages/ledge/test/soft-authenticator.ts`
- Modifier : `packages/ledge/package.json` (dépendance `@simplewebauthn/server`)
- Test : `packages/ledge/test/pairing.test.ts`

**Interfaces :**
- Produit (`webauthn.ts`) : `registrationOptions(cfg: MobileConfig, deviceName: string): Promise<PublicKeyCredentialCreationOptionsJSON>` (`rpName: 'Ledge'`, `rpID: cfg.rpID`, `attestationType: 'none'`, `authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }`, `timeout: 60_000`) ; `verifyRegistration(cfg: MobileConfig, response: unknown, expectedChallenge: string): Promise<StoredCredential>` (`expectedOrigin: cfg.origin`, `expectedRPID: cfg.rpID`, `requireUserVerification: true` ; lève une exception en cas d'échec).
- Produit (`pairing.ts`) : `class PairError extends Error { constructor(readonly reason: PairErrorReason) }` ; `createPairing(deps: { config: () => MobileConfig | null; devices: DeviceStore; now?: () => number; randomCode?: () => string }): Pairing` avec `begin(): { code: string; expiresAt: string; url: string }`, `options(code: string): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; expiresAt: string }>` et `complete(code: string, deviceName: string, response: unknown): Promise<{ token: string; deviceId: string }>`.
- Règles : une seule fenêtre ; `begin` la remplace. `url = ${origin}/m/#/pair`. Chaque mauvais code compte ; au `PAIR_MAX_ATTEMPTS`-ième, la fenêtre se verrouille (`locked`) jusqu'au prochain `begin`. Un code de plus de `PAIR_CODE_TTL_MS` donne `expired`. `complete` exige le défi émis par `options` pour ce code. Un succès consomme la fenêtre ; ensuite `no_window`. Le nom est tronqué à 60 caractères, `'iPhone'` par défaut. Code : `crypto.randomInt(0, 1e6)` sur six chiffres.
- Produit (aide de test) : `createSoftAuthenticator(o: { origin: string; rpID: string }): { register(options): RegistrationResponseJSON; assert(options, opts?: { uv?: boolean; origin?: string }): AuthenticationResponseJSON }`. Algorithme :
  - clé `generateKeyPairSync('ec', { namedCurve: 'P-256' })`, identifiant de 16 octets aléatoires ;
  - `clientDataJSON = { type: 'webauthn.create' | 'webauthn.get', challenge, origin, crossOrigin: false }` ;
  - `authData = sha256(rpID) ‖ flags ‖ signCount (uint32 BE)`, avec les drapeaux UP `0x01`, UV `0x04` (si `uv`) et AT `0x40` (création) ; à la création, ajouter `aaguid` (16 × 0) ‖ longueur de l'identifiant (uint16 BE) ‖ identifiant ‖ clé COSE ;
  - clé COSE `{1: 2, 3: -7, -1: 1, -2: x, -3: y}` encodée avec `isoCBOR` de `@simplewebauthn/server/helpers` ;
  - création : `attestationObject = CBOR({ fmt: 'none', attStmt: {}, authData })` ;
  - assertion : signature ECDSA-SHA256 DER sur `authData ‖ sha256(clientDataJSON)`, compteur incrémenté.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('begin gives six digits for 120 s and a /m/#/pair url', () => {
  const w = pairing.begin();
  expect(w.code).toMatch(/^\d{6}$/); expect(Date.parse(w.expiresAt) - now()).toBe(120_000);
  expect(w.url).toBe('https://pc.t.ts.net/m/#/pair');
});
it('begin without mobile config throws not_configured', () => { /* … */ });
it('the fifth wrong code locks the window, even with the right code afterwards', async () => { /* 5× options('000000') → invalid_code ×4 then locked; options(right) → locked */ });
it('an expired code is refused', async () => { /* advance 120 001 ms → expired */ });
it('registers the key, returns a token once, and the code cannot be reused', async () => {
  const { options } = await pairing.options(code);
  const r = await pairing.complete(code, 'iPhone', soft.register(options));
  expect(devices.byToken(r.token)?.credential.id).toBeTruthy();
  await expect(pairing.options(code)).rejects.toMatchObject({ reason: 'no_window' });
});
it('refuses a registration without user verification', async () => { /* soft.register with uv false → webauthn_failed, no device */ });
it('refuses a registration made for another origin', async () => { /* soft authenticator origin https://evil.ts.net → webauthn_failed */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/pairing.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier, y compris le bundle (H10)**

Exécuter : `pnpm --filter @paradow/ledge test && pnpm --filter @paradow/ledge build && node packages/ledge/dist/cli/index.js mobile status`
Attendu : tests PASS ; le CLI construit démarre (sans daemon : message d'erreur de connexion, pas d'erreur de module). En cas d'échec de bundle, déclarer `@simplewebauthn/server` dans `external` de `tsup.config.ts`.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge pnpm-lock.yaml
git commit -m "feat(daemon): pairing window with WebAuthn key registration"
```

### Task 8: Entrée distante : HTTP `/m/`, WebSocket `/m/ws`, authentification

**Fichiers :**
- Créer : `packages/ledge/src/daemon/remote/listener.ts`, `packages/ledge/src/daemon/remote/static.ts`
- Modifier : `packages/ledge/src/daemon/index.ts` (charge `mobile.json` et `devices.json`, crée `pairing`, démarre et arrête l'entrée distante via `MobileControl.configure`), `packages/ledge/src/daemon/server.ts` (`MobileControl` + `pairing: Pairing` ; `pair.begin` local → `pair.code`, ou `pair.error { reason: 'not_configured' }`)
- Test : `packages/ledge/test/remote.test.ts`

**Interfaces :**
- Consomme : `ServerHandle.attach`, `DeviceStore`, `Pairing`, `MobileConfig`, `REMOTE_CLOSE`, `PRE_AUTH`.
- Produit : `startRemoteListener(o: { server: ServerHandle; config: MobileConfig; devices: DeviceStore; pairing: Pairing; port?: number; host?: string; staticDir?: string; authTimeoutMs?: number; pcName?: string }): Promise<{ port: number; close(): Promise<void> }>`. Valeurs par défaut : `REMOTE_PORT`, `'127.0.0.1'`, `fileURLToPath(new URL('../mobile/', import.meta.url))`, `AUTH_TIMEOUT_MS`, `os.hostname()`.
- Produit : `serveMobile(req, res, dir: string, origin: string): void`.
  - Routes : `GET`/`HEAD` sur `/m/` (renvoie `index.html`) et `/m/<fichier>` ; `GET /` redirige (302) vers `/m/` ; tout le reste répond 404, chemins remontants compris. Dossier absent : 503 `PWA not built`.
  - En-têtes : `Content-Security-Policy: default-src 'self'; connect-src 'self' wss://<hôte>; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
  - Cache : `no-cache` pour `index.html` et `sw.js` (avec `Service-Worker-Allowed: /m/`) ; `immutable` pour `/m/assets/*`.
- Comportement du WebSocket :
  - Upgrade accepté seulement sur `MOBILE_WS_PATH`, avec `Origin === config.origin`. Sinon 403 et une ligne dans `daemon.log`. Ce contrôle protège en plus du jeton, il ne l'identifie pas.
  - Avant l'auth, seuls les types de `PRE_AUTH` sont lus. Tout autre message ferme en 4401. Sans `auth` dans `authTimeoutMs`, fermeture en 4408. `auth` avec un jeton inconnu : 4401 et `remote auth refused from <adresse>` dans le log, jamais le jeton.
  - `auth` valide : `devices.touch`, `auth.ok`, puis `server.attach(ws, { kind: 'remote', deviceId })`.
  - `pair.options`/`pair.complete` répondent `pair.challenge`, `pair.done` ou `pair.error`. Le socket se ferme après `pair.done`, ou après 3 `pair.error` sur la même connexion.

- [ ] **Étape 1 : écrire les tests qui échouent** (listener réel sur le port 0, dossier statique temporaire, authentificateur logiciel de la tâche 7)

```ts
it('serves the PWA under /m/ with security headers; 404 elsewhere; no traversal', async () => {
  const r = await fetch(`${base}/m/`); expect(r.status).toBe(200); expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect((await fetch(`${base}/m/..%2f..%2fsessions.json`)).status).toBe(404);
  expect((await fetch(`${base}/api`)).status).toBe(404);
});
it('closes a silent socket with 4408', async () => expect(await closeCodeOf(openWs({ origin }), 'nothing')).toBe(4408));
it('an unknown token closes with 4401 and logs the attempt without the token', async () => { /* … log contains "remote auth refused", not the token */ });
it('refuses a WebSocket from another Origin', async () => expect(await upgradeStatus({ origin: 'https://evil.example' })).toBe(403));
it('an unpaired phone receives no snapshot and no session', async () => { /* send snapshot.request first → closed 4401, zero messages received */ });
it('pairs end to end, then authenticates and gets a projected snapshot', async () => { /* pair.begin via local client → pair.options → soft.register → pair.complete → reconnect auth → auth.ok then snapshot without launcher */ });
it('a revoked token closes the open socket with 4403 and cannot come back', async () => { /* … */ });
it('remote session.decide is forbidden in this lot and nothing is typed', async () => { /* … */ });
it('mobile.configure starts and stops the remote entry without touching the local port', async () => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/remote.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter le listener, le service statique et le câblage de `daemon/index.ts`**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS, y compris `daemon.test.ts` et `e2e.test.ts` existants.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): remote entry serving /m/ with token authentication and pairing"
```

### Task 9: Overlay : Réglages › Mobile

Cet écran n'a pas de maquette validée. Il suit les composants existants de `SettingsView` ; une capture est soumise à l'utilisateur en fin de tâche.

**Fichiers :**
- Créer : `apps/overlay/src/surface/MobileSettings.tsx`
- Modifier : `apps/overlay/src/surface/SettingsView.tsx` (`SETTINGS_TABS = ['display', 'notifications', 'sounds', 'mobile', 'about']`), `apps/overlay/src/daemon/store.ts` (`mobile: { devices: Device[]; origin: string | null; listening: boolean } | null`, `pairing: { code: string; expiresAt: string; url: string } | null`), `apps/overlay/src/surface/Surface.tsx` (envoie `devices` à l'ouverture de l'onglet, `pair.begin` et `device.revoke`), `apps/overlay/src/i18n/messages.ts` (clés FR et EN), `apps/overlay/package.json` (`uqr`)
- Test : `apps/overlay/test/mobile-settings.test.tsx`, `apps/overlay/e2e/mobile-settings.spec.ts`

**Interfaces :**
- Produit : `MobileSettings(p: { state: { devices: Device[]; origin: string | null; listening: boolean } | null; pairing: { code: string; expiresAt: string; url: string } | null; now: () => number; onPair(): void; onRevoke(id: string): void }): JSX.Element`.
- Sans origine : seule la commande `ledge mobile enable --origin https://<machine>.<tailnet>.ts.net` est affichée, avec un lien vers `docs/mobile.md` (texte). Avec origine : bouton « Appairer un téléphone », puis QR (SVG `uqr` de `pairing.url`, `role="img"` avec l'URL en `aria-label`), code groupé `481 203` et compte à rebours. À expiration : « Nouveau code ». Liste des appareils : nom, dernière connexion relative, bouton « Retirer » qui envoie `device.revoke` en un clic.

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
it('without an origin shows only the enable command', () => { /* no pair button */ });
it('shows the QR, the grouped code and the countdown, then offers a new code when it expires', () => { /* fake now */ });
it('lists devices with their last connection and revokes in one click', async () => { /* onRevoke called with id */ });
it('has both FR and EN strings', () => { /* render with each lang */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter overlay exec vitest run test/mobile-settings.test.tsx`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier et capturer**

Exécuter : `pnpm --filter overlay test && pnpm --filter overlay exec playwright test e2e/mobile-settings.spec.ts`
Attendu : PASS. La capture `apps/overlay/e2e/.results/mobile-settings.png` est jointe au rapport de la tâche pour revue utilisateur.

- [ ] **Étape 5 : commit**

```bash
git add apps/overlay pnpm-lock.yaml
git commit -m "feat(overlay): Settings > Mobile to pair and remove phones"
```

### Task 10: Squelette de la PWA servi sous `/m/`

**Fichiers :**
- Créer : `apps/mobile/package.json` (`"name": "mobile"`, scripts `dev`, `build`, `test`, `typecheck` et `test:e2e`, sur le modèle de l'overlay ; dépendances `@ledge/protocol`, `@ledge/client`, `react`, `react-dom`, `@simplewebauthn/browser`, polices Geist et Geist Mono), `apps/mobile/tsconfig.json`, `apps/mobile/vite.config.ts`, `apps/mobile/index.html`, `apps/mobile/public/manifest.webmanifest`, `apps/mobile/public/icons/{180,192,512}.png`, `apps/mobile/src/{main.tsx,App.tsx,styles.css,copy.ts,sw.ts,registerSw.ts}`, `apps/mobile/test/setup.ts`, `apps/mobile/playwright.config.ts`, `apps/mobile/e2e/daemon.ts`
- Modifier : `packages/ledge/package.json` (`"prepublishOnly": "pnpm --filter mobile build && pnpm build"`)
- Test : `apps/mobile/test/manifest.test.ts`, `apps/mobile/e2e/shell.spec.ts`

**Interfaces :**
- Vite : `base: '/m/'`, `build.outDir: '../../packages/ledge/dist/mobile'`, `emptyOutDir: true`. Deux entrées (`index.html` et `src/sw.ts`, sortie `sw.js` à la racine). Port de dev et d'e2e : `5299`.
- `styles.css` : `@theme` Tailwind 4 avec les jetons de la spec §7.1, sous des noms sémantiques (`--color-bg`, `--color-surface`, `--color-raised`, `--color-fg`, `--color-muted`, `--color-attention`, `--color-ok`, `--color-info`, `--color-danger-fg`, `--color-danger-bg`, `--color-danger-btn`, `--radius-card: 16px`, `--radius-control: 12px`, `--space-side: 18px`) ; `prefers-reduced-motion` coupe les transitions ; conteneur à `max-width: 480px` et `100dvh` ; marges `env(safe-area-inset-*)`.
- `index.html` : `viewport-fit=cover`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-touch-icon` 180, `theme-color #0c0d0e`, `lang="fr"`.
- Manifeste : `{ name: 'Ledge', short_name: 'Ledge', start_url: '/m/', scope: '/m/', display: 'standalone', background_color: '#0c0d0e', theme_color: '#0c0d0e', icons: 192 et 512 }`.
- `sw.ts` : à l'installation, met en cache `./`, `./index.html`, `./manifest.webmanifest` et les icônes ; `index.html` en réseau d'abord ; `/m/assets/*` en cache d'abord. Les icônes viennent de `apps/overlay/src-tauri/icons/`, redimensionnées.
- `e2e/daemon.ts` : daemon simulé par `page.routeWebSocket`, sur le modèle de `apps/overlay/e2e/daemon.ts`, qui répond `auth.ok` puis un `snapshot` paramétrable.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('the manifest installs under /m/ in standalone with the dark background', () => {
  const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  expect(m).toMatchObject({ start_url: '/m/', scope: '/m/', display: 'standalone', background_color: '#0c0d0e' });
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
});
// e2e/shell.spec.ts, for 320, 390 and 430 px wide
test('the shell fits the width and uses local fonts only', async ({ page }) => { /* scrollWidth <= innerWidth; no request outside 127.0.0.1 */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile test`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter le squelette**

- [ ] **Étape 4 : vérifier la construction et le service par le daemon**

Exécuter : `pnpm install && pnpm --filter mobile test && pnpm --filter mobile build && ls packages/ledge/dist/mobile && pnpm --filter mobile test:e2e`
Attendu : PASS ; `index.html`, `sw.js`, `manifest.webmanifest` et `assets/` présents. Le test `serves the PWA under /m/` de la tâche 8, relancé contre ce dossier, passe.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile packages/ledge/package.json pnpm-lock.yaml
git commit -m "feat(mobile): PWA shell with manifest, service worker and design tokens"
```

### Task 11: Connexion et état du mobile

**Fichiers :**
- Créer : `apps/mobile/src/connection/remoteClient.ts`, `apps/mobile/src/connection/standalone.ts`, `apps/mobile/src/state/store.ts`, `apps/mobile/src/state/persist.ts`
- Test : `apps/mobile/test/store.test.ts`, `apps/mobile/test/remote-client.test.ts`

**Interfaces :**
- Produit : `type Link = 'unpaired' | 'connecting' | 'online' | 'offline'` ; `interface MobileState { link: Link; sessions: Session[]; previews: Record<string, string[]>; syncedAt: string | null; device: { id: string; name: string } | null; pcName: string | null }`.
- Produit : `TOKEN_KEY = 'ledge.mobile.token'`, `DEVICE_KEY = 'ledge.mobile.device'`, `LAST_STATE_KEY = 'ledge.mobile.lastState'` ; `loadLastState(): Pick<MobileState, 'sessions' | 'previews' | 'syncedAt' | 'pcName'> | null` ; `saveLastState(s): void`.
- Produit : `createMobileStore(): { getState(): MobileState; subscribe(fn: () => void): () => void; apply(msg: ServerMessage): void; setLink(l: Link): void }` ; `useMobile(): MobileState`.
- Produit : `connectRemote(o: { store; url?: string; storage?: Storage; WebSocketImpl?; doc?: Document }): DaemonClient`. URL par défaut : `wss://${location.host}/m/ws`. Utilise `createDaemonClient` avec `hello: () => token ? { type: 'auth', token } : null` et `stopOn: [4401, 4403]`. Un code d'arrêt efface le jeton et passe à `unpaired`. Le statut `unreachable` donne `offline`. Au retour au premier plan (`visibilitychange` visible), reconnexion immédiate. Sans jeton : `unpaired`, sans connexion.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('sends auth with the stored token first', () => { /* fake WS: first frame {type:'auth', token} */ });
it('offline keeps the last known sessions readable', () => { /* snapshot → close → link offline, sessions unchanged */ });
it('4401 clears the token and shows pairing without reconnecting', () => { /* … no new socket after 60 s */ });
it('returning to the foreground reconnects at once', () => { /* dispatch visibilitychange → new socket without waiting for backoff */ });
it('the last state survives a reload', () => { /* saveLastState → new store → loadLastState */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/store.test.ts test/remote-client.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : la commande de l'étape 2.
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): authenticated connection, offline state and reconnection on resume"
```

### Task 12: Parcours d'appairage

Référence visuelle : `docs/mockups/ledge-mobile/Pairing.html`, rendue par `renderPairing` dans `mobile.js`. Le code de démonstration, la mention de démonstration et le bandeau de maquette ne sont pas repris.

**Fichiers :**
- Créer : `apps/mobile/src/connection/pair.ts`, `apps/mobile/src/screens/Pairing.tsx`
- Test : `apps/mobile/test/pair.test.ts`, `apps/mobile/e2e/pairing.spec.ts`

**Interfaces :**
- Produit : `class PairFailure extends Error { constructor(readonly reason: PairErrorReason | 'network') }` ; `pairDevice(code: string, deps: { open(): Promise<PairSocket>; startRegistration: typeof import('@simplewebauthn/browser').startRegistration; deviceName: string }): Promise<{ token: string; deviceId: string }>` ; `guessDeviceName(ua: string): string` (`'iPhone'`, `'iPad'`, `'Android'` ou `'Navigateur'`) ; `isIosBrowserTab(nav?: Navigator, mm?: typeof matchMedia): boolean`.
- Les quatre étapes de la maquette. Étape 2 : dans un onglet Safari d'iOS, l'écran reste sur les consignes d'installation, sans bouton suivant. Étape 3 : saisie numérique, `autocomplete="one-time-code"` ; envoi seulement à 6 chiffres. Étape 4 : « Vous êtes connecté » et « Continuer » vers À traiter ; le bouton de notifications arrive au lot 4.
- Messages d'erreur (`copy.ts`) : `invalid_code` « Code non reconnu. Vérifiez le code affiché sur le PC. » ; `expired` « Ce code a expiré. Demandez-en un nouveau sur le PC. » ; `locked` « Trop d'essais. Demandez un nouveau code sur le PC. » ; `webauthn_failed` « La vérification de l'appareil n'a pas abouti. Réessayez. » ; `not_configured` et `no_window` « Ouvrez Réglages › Mobile sur le PC pour obtenir un code. » ; `network` « PC injoignable. Vérifiez Tailscale. »

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('pairs: options, registration, complete, then stores token and device', async () => { /* fake socket + fake startRegistration */ });
it('maps pair.error reasons to failures and keeps the typed code', async () => { /* invalid_code */ });
it('stays on install instructions inside an iOS Safari tab', () => { /* isIosBrowserTab true → no next button */ });
// e2e with the Chromium virtual authenticator (CDP WebAuthn.addVirtualAuthenticator, ctap2, internal, isUserVerified)
test('pairing ends on the inbox with a stored token', async ({ page }) => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/pair.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter mobile test && pnpm --filter mobile exec playwright test e2e/pairing.spec.ts`
Attendu : PASS à 320, 390 et 430 px.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): four-step pairing with device verification"
```

### Task 13: À traiter et détail en lecture seule

Référence visuelle : `Inbox.html`, `Request.html`, `Offline.html` (`renderInbox`, `renderRequest`, `renderOffline`). Le contenu suit les vraies données, pas les textes de démonstration.

**Fichiers :**
- Créer : `apps/mobile/src/model/requests.ts`, `apps/mobile/src/router.ts`, `apps/mobile/src/screens/{Inbox,RequestDetail,Gone}.tsx`, `apps/mobile/src/ui/{Header,TabBar,Badge,MobileBot,Notice,Command}.tsx`
- Test : `apps/mobile/test/requests.test.ts`, `apps/mobile/test/router.test.ts`, `apps/mobile/e2e/inbox.spec.ts`

**Interfaces :**
- Produit : `interface InboxItem { sessionId: string; pendingId: string; pendingVersion: number; kind: Pending['kind']; filter: 'permission' | 'question'; task: string; botName: string; tool: Tool; repo: string; branch?: string; worktree?: boolean; since: string; text: string; reason?: string; options?: string[]; readOnly: boolean }` ; `requestsOf(sessions: Session[]): InboxItem[]` (demandes avec `id` seulement, les plus anciennes d'abord ; `task = topic ?? project` ; `repo = repo ?? project` ; `readOnly = source === 'hook_only'`) ; `type Filter = 'all' | 'permission' | 'question'` ; `filterItems(items: InboxItem[], f: Filter): InboxItem[]` (`permission` couvre `permission`, `plan` et `diff`) ; `ageLabel(since: string, now: number): string` (`'40 s'`, `'3 min'`, `'2 h'`, `'1 j'`) ; `headline(item: InboxItem): string` (question : son texte ; permission : première ligne de la commande ; diff : « Modifier <fichier> » ; plan : « Plan à valider »).
- Produit : `type Route = { name: 'inbox' } | { name: 'request'; sessionId: string; pendingId: string } | { name: 'pair' }` (étendu aux lots 3 et 4) ; `parseRoute(hash: string): Route` ; `href(r: Route): string`.
- Détail : tâche, bot et outil, dépôt et branche (pointillé si worktree) ; badge de type ; titre ; `reason` si présent ; commande en `<pre>` avec retour à la ligne (`white-space: pre-wrap; overflow-wrap: anywhere`) ; métadonnées (Dossier = `tildePath(cwd)`, Branche, Demandé) ; « Contexte du terminal » dépliable (dernières lignes de `previews[sessionId]`). Pied : « Refuser » et « Autoriser une fois » **désactivés**, avec l'indication « Décisions depuis le téléphone : pas encore disponibles. Répondez sur le PC. » (remplacée au lot 2).
- `Gone` : quand le `pendingId` du lien n'est plus en attente, « Cette demande n'attend plus de décision. », puis « Retour aux demandes » (affiné au lot 2).
- En-tête : point et « `pcName` · connecté/déconnecté ». Hors connexion : bandeau « Connexion au PC perdue », « Dernier état connu · <heure> », bouton « Reconnecter et actualiser ». Liste vide : « Vous êtes à jour ». Filtre vide : « Aucune demande dans ce filtre ». Barre d'onglets réduite à « À traiter » et son compteur ; « Agents » arrive au lot 3.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('lists the oldest request first and skips pendings without id', () => { /* … */ });
it('Autorisations covers permission, plan and diff; Questions covers question', () => { /* … */ });
it('falls back to the project when there is no topic', () => { /* … */ });
it('formats ages', () => { expect(ageLabel(T, Date.parse(T) + 40_000)).toBe('40 s'); expect(ageLabel(T, Date.parse(T) + 180_000)).toBe('3 min'); });
it('parses #/request/<sid>/<pid> and falls back to the inbox', () => { /* … */ });
// e2e/inbox.spec.ts at 320, 390 and 430
test('ten requests: no horizontal overflow, every target at least 44 px, filters keep the global count', async ({ page }) => { /* … */ });
test('a long command wraps in the detail without widening the page', async ({ page }) => { /* … */ });
test('offline: last state readable, decision buttons disabled, banner offers reconnect', async ({ page }) => { /* … */ });
test('a link to a request that is no longer pending shows Gone', async ({ page }) => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/requests.test.ts test/router.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter les écrans**

- [ ] **Étape 4 : vérifier, puis comparer à la maquette**

Exécuter : `pnpm --filter mobile test && pnpm --filter mobile test:e2e`
Attendu : PASS. Les captures à 390 px d'À traiter, du Détail et de Connexion perdue sont mises côte à côte avec `Inbox.html`, `Request.html` et `Offline.html` dans le rapport de la tâche. Les écarts voulus (données réelles, décisions désactivées) y sont nommés.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): inbox with filters and read-only request detail"
```

### Task 14: Documentation et validation du lot 1

**Fichiers :**
- Créer : `docs/mobile.md` (prérequis Tailscale, MagicDNS et certificats HTTPS, `ledge mobile enable --origin …`, commande `tailscale serve` exacte relevée en tâche 0, appairage, révocation, ce qui n'est **pas** exposé)
- Modifier : `README.md` (sections Components : `packages/client`, `apps/mobile` ; Protocol : nouveaux messages ; Files and settings : `devices.json`, `mobile.json` ; Security : entrée distante, jetons, ce que le téléphone peut et ne peut pas faire), en intégrant les modifications non commitées existantes
- Modifier : `docs/spikes/2026-10-14-ledge-mobile-feasibility.md` (section « Validation », R1 à R3)

- [ ] **Étape 1 : rédiger la documentation**

- [ ] **Étape 2 : passer toute la suite**

Exécuter : `pnpm -r typecheck && pnpm -r test && pnpm --filter overlay test:e2e && pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 3 : valider sur l'iPhone (R1, R2, R3 du plan directeur)**

Attendu : chaque condition cochée dans le rapport, ou un échec accepté explicitement par l'utilisateur.

- [ ] **Étape 4 : commit**

```bash
git add docs/mobile.md README.md docs/spikes/2026-10-14-ledge-mobile-feasibility.md
git commit -m "docs(mobile): setup guide, protocol and security for the read-only phone access"
```
