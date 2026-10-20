# Ledge mobile, lot 2 : comptes GitHub, liste d'autorisés et magasin Postgres — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le relais n'accepte plus que des sessions qu'il a lui-même délivrées après une connexion GitHub d'un compte autorisé : device flow pour le PC, flux web pour le téléphone, sessions rangées dans Postgres.

**Architecture:**
- **Magasin :** un `Store` sur une petite interface `Db` (`query(sql, params) → { rows }`). Un `pg.Pool` la satisfait en production, PGlite (Postgres en WASM, en mémoire) dans les tests.
- **GitHub :** une interface `GitHub` avec deux implémentations. `githubHttp` parle à github.com par `fetch` ; un faux en mémoire sert aux tests.
- **Routes et authentification :** des routes HTTP `/auth/*`, branchées sur `createRelay` par un nouveau point d'extension `http`, délivrent des jetons de session opaques. Le relais n'en garde que le hash. Un `accountsAuthenticator` remplace les jetons de dev à l'upgrade websocket : Bearer pour le PC, cookie HttpOnly et `Origin` vérifié pour le téléphone.
- **Ce que le relais ne garde pas :** le jeton d'accès GitHub est jeté dès que `/user` a répondu.

**Tech Stack:** TypeScript strict (NodeNext), Node ≥ 22, zod 3, ws 8, `pg` 8, `@electric-sql/pglite` (tests seulement), vitest 4, tsup.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md` ; feuille de route : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md` ; lot précédent : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-lot1-seal-relay.md`.

## Global Constraints

- « Comptes via GitHub, restreints à une liste d'autorisés gérée par l'admin » : `LEDGE_RELAY_ALLOWED_GITHUB_IDS`, des identifiants GitHub numériques séparés par des virgules. La liste est revérifiée à chaque authentification, pas seulement à la connexion GitHub : retirer un id puis redémarrer coupe ce compte.
- « Le serveur rattache tout à l'identifiant GitHub numérique » : `accountId` est l'id GitHub en décimal (`"583231"`), jamais le login.
- « Téléphone : flux web classique (redirection GitHub → serveur), le serveur délivre sa propre session. PC : device flow GitHub. »
- « Un compte = un PC + des appareils » : une nouvelle connexion PC révoque les sessions PC précédentes du compte et ferme leur socket.
- « Isolation stricte entre comptes ; aucun partage de sessions entre utilisateurs. »
- Logs : « Connexions et déconnexions, identifiant de compte et d'appareil, erreurs, tailles, latences. Jamais le contenu ni les métadonnées de contenu. » Ne jamais logger un jeton de session, un jeton GitHub, un `code`, un `state`, un `device_code`, le secret client, ni le corps d'une réponse GitHub.
- Le relais ne stocke ni jeton GitHub ni jeton de session en clair : seulement `sha256(jeton)` en hexadécimal.
- Les jetons de session et les ids d'appareil n'emploient que l'alphabet base64url, sous-ensemble des caractères de jeton RFC 7230, car ils voyagent en sous-protocole websocket.
- Toute colonne `bigint` est lue avec `::text` dans le SQL : `pg` et PGlite ne rendent pas `int8` sous le même type JS.
- Mode dev conservé : sans `DATABASE_URL`, le relais démarre sur `LEDGE_RELAY_DEV_TOKENS` comme au lot 1, et le refuse toujours si `NODE_ENV=production`.
- `engines.node >= 22`, `zod ^3.23.8`, `ws ^8.18.0`, imports relatifs en `.js`.

## Reporté par la revue du lot 1 (feuille de route)

| Règle | Tâche |
| --- | --- |
| l'authentificateur valide `Who.peer` contre `RelayPeerSchema` | Task 1 (dans le serveur, donc pour tout authentificateur) |
| jetons de session en caractères de jeton RFC 7230 | Task 2 (`newSessionToken`) |
| `Origin` vérifié si le téléphone s'authentifie par cookie | Task 4 |
| délai maximal sur `authenticate` (10 s → 503) et plafond d'upgrades en attente | Task 1 |
| lignes `refused` agrégées par intervalle | Task 1 |

## Review Focus

1. Une page d'un autre site ouvre une websocket vers le relais avec le cookie du téléphone. Attendu : refusée, car `Origin` diffère de `LEDGE_RELAY_PUBLIC_URL` (test dans Task 4).
2. Un compte sorti de la liste d'autorisés garde une session valide en base. Attendu : sa websocket et `/auth/me` sont refusés (Task 4).
3. GitHub ne répond pas ou répond une erreur. Attendu : la requête du client échoue en temps borné (502 ou 503), et ni jeton ni corps de réponse n'apparaît dans un log ou un message d'erreur (Tasks 3 et 4).
4. Un callback OAuth sans cookie `state`, avec un `state` différent, ou rejoué. Attendu : aucune session n'est créée (Task 5).
5. Un second PC se connecte au même compte. Attendu : le jeton du premier PC ne vaut plus rien, et son socket ouvert est fermé en 4001 (Task 4).

---

### Task 1: durcir le serveur et lui ouvrir des routes HTTP

**Files:**
- Modify: `apps/relay/src/server.ts`, `apps/relay/src/hub.ts`, `apps/relay/src/log.ts`, `apps/relay/src/auth.ts`
- Test: `apps/relay/test/server.test.ts`, `apps/relay/test/hub.test.ts`

**Interfaces:**
- Produces:
  - `presentedToken(req: IncomingMessage): string | null`, exporté depuis `auth.ts` (aujourd'hui privé).
  - `Hub.kick(accountId: string, peer: RelayPeer, code: number, reason: string): void` : ferme le socket de ce pair s'il est routé, sinon ne fait rien.
  - `interface RelayControl { kick(accountId: string, peer: RelayPeer, code: number, reason: string): void }`.
  - `type HttpHandler = (req: IncomingMessage, res: ServerResponse, relay: RelayControl) => Promise<boolean>` : `true` si la requête a été traitée.
  - `RelayOptions` gagne :
    - `http?: HttpHandler`, appelé avant `/healthz` et le 404 ; s'il lève, réponse 500 vide et un log `{ ev: 'http_error' }` ;
    - `authTimeoutMs?: number` (défaut `10_000`) ;
    - `maxPendingUpgrades?: number` (défaut `64`) ;
    - `refusedLogMs?: number` (défaut `60_000`).
  - `RelayLogEvent` :
    - `refused` devient `{ ev: 'refused'; reason: 'no_auth' | 'bad_path' | 'auth_error' | 'bad_peer' | 'timeout' | 'busy'; count: number }` ;
    - s'ajoute `{ ev: 'http_error' }`.

- [ ] **Step 1: Écrire les tests qui échouent**

`hub.test.ts` : `kick` sur un pair routé appelle `close(4001, 'signed_out')` sur son Conn, et les autres pairs du compte reçoivent `presence online:false` comme pour une fermeture normale. `kick` sur un pair absent ne lève pas.

`server.test.ts`, avec un authentificateur de test écrit dans le fichier :
- `authenticate` qui ne se résout jamais, avec `authTimeoutMs: 50` → statut 503 ; le log porte `refused` avec la raison `timeout`.
- `maxPendingUpgrades: 1` et un premier upgrade en attente → le second reçoit 503 (raison `busy`) ; après résolution du premier, un troisième passe.
- un authentificateur qui renvoie `{ accountId: 'A', peer: 'phone' }` → 401 et la raison `bad_peer` ; aucun `connect` n'est loggé.
- `refusedLogMs: 50` et trois upgrades sur `/autre` → un seul événement `{ ev: 'refused', reason: 'bad_path', count: 3 }`. `close()` vide le compteur restant dans le log.
- `http` qui traite `GET /x` (200 `x`) et rend `false` sinon → `/x` répond `x`, `/healthz` répond toujours `ok`, `/y` 404. Un `http` qui lève donne 500 et `{ ev: 'http_error' }`.
- `http` reçoit un `RelayControl` dont `kick('A', 'pc', 4001, 'signed_out')` ferme le socket PC connecté. Le client voit le code 4001.

Les assertions existantes sur `refused` prennent le champ `count`.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/relay exec vitest run test/server.test.ts test/hub.test.ts` : FAIL.

- [ ] **Step 3: Implémenter**
  - `refuse()` accepte aussi `'503 Service Unavailable'`.
  - L'upgrade prend une place d'attente avant `authenticate` et la rend dès que l'issue est décidée, réponse ou délai : un `authenticate` qui ne finit jamais ne bloque pas une place pour toujours. Un résultat arrivé après le délai est ignoré.
  - `RelayPeerSchema.safeParse(who.peer)` avant `handleUpgrade`.
  - Le compteur `refused` est un petit utilitaire de `log.ts`, `countedLog<E extends { count: number }>(log: RelayLog, ms: number): { add(e: Omit<E, 'count'>): void; flush(): void; stop(): void }`. Il compte par valeur de `reason`, vide ses comptes à chaque intervalle et à `close()`. Task 4 le réutilise pour `sign_in_refused`.

- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` : PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(relay): bounded authentication, aggregated refusals, a validated peer and an HTTP hook"`

---

### Task 2: magasin de comptes et de sessions

**Files:**
- Create: `apps/relay/src/db.ts`, `apps/relay/src/store.ts`, `apps/relay/src/tokens.ts`
- Modify: `apps/relay/package.json` (`pnpm --filter @ledge/relay add pg` ; `add -D @electric-sql/pglite @types/pg`)
- Test: `apps/relay/test/store.test.ts`, `apps/relay/test/tokens.test.ts`

**Interfaces:**
- Produces:
  - `interface Db { query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }> }`.
  - `tokens.ts`, tous construits sur `crypto.getRandomValues` et l'encodage `b64u` de `@ledge/seal` :
    - `newSessionToken(): string` : 32 octets aléatoires, 43 caractères ;
    - `hashToken(token: string): string` : SHA-256 en hexadécimal, par `node:crypto` ;
    - `newDevicePeer(): RelayPeer` : `d_` + 16 octets, soit 22 caractères ;
    - `newOpaque(): string` : 32 octets, pour le `state` OAuth.
  - `type SessionKind = 'pc' | 'device'`.
  - `interface Session { accountId: string; login: string; peer: RelayPeer; kind: SessionKind }`.
  - `class Store`, construit par `new Store(db: Db, opts?: { now?: () => number; ttlMs?: number })` (`ttlMs` vaut 90 jours par défaut). Méthodes :
    - `migrate(): Promise<void>` : idempotent ;
    - `upsertAccount(githubId: string, login: string): Promise<void>` : met le login à jour ;
    - `createSession(tokenHash: string, s: Session): Promise<void>` ;
    - `findSession(tokenHash: string): Promise<Session | null>` : seulement une session ni révoquée ni expirée ; repousse son expiration à `now + ttlMs` et met à jour `last_seen` ;
    - `revokeSession(tokenHash: string): Promise<Session | null>` : rend la session révoquée, ou `null` si elle n'était pas vivante ;
    - `revokeSessions(accountId: string, kind: SessionKind): Promise<number>`.

- [ ] **Step 1: Écrire les tests qui échouent**

`tokens.test.ts` :
- `newSessionToken()` vérifie `/^[A-Za-z0-9_-]{43}$/` ;
- `newDevicePeer()` passe `RelayPeerSchema` ;
- `hashToken('a')` vaut `ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb`.

`store.test.ts` : chaque test part d'une base neuve, `new PGlite()` puis `migrate()`. Cas à couvrir :
- `migrate()` lancé deux fois ne lève pas ;
- une session créée est rendue par `findSession` avec le login du compte, puis un `upsertAccount` avec un nouveau login change ce login ;
- expiration : `now` piloté par le test, `ttlMs: 1000`, session créée à t=0. `findSession` à t=900 la rend, et la repousse. À t=1800 elle est encore vivante. À t=2901, `null` ;
- `revokeSession` rend la session, puis `findSession` donne `null`, et un second `revokeSession` donne `null` ;
- `revokeSessions('A', 'pc')` révoque les sessions PC de A, pas ses sessions `device`, ni les sessions PC de B ;
- un hash inconnu donne `null`.

Le même `describe` tourne une seconde fois contre un vrai Postgres si `LEDGE_RELAY_TEST_DATABASE_URL` est défini (`describe.skipIf`). Ce run passe par un `pg.Client` unique, qui crée un schéma `t_<aléatoire>`, fait `SET search_path` dessus, puis le supprime en fin de test.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/relay exec vitest run test/store.test.ts test/tokens.test.ts` : FAIL.

- [ ] **Step 3: Implémenter**

Les migrations forment une liste ordonnée de chaînes SQL dans `store.ts`, appliquées dans une table `schema_migrations(version int primary key)`. Migration 1 :

```sql
CREATE TABLE accounts (github_id bigint PRIMARY KEY, login text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(github_id),
  peer text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pc', 'device')),
  created_at timestamptz NOT NULL, last_seen timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX sessions_account ON sessions(account_id, kind) WHERE revoked_at IS NULL;
```

Les dates sont passées en paramètre (`new Date(now())`) : le SQL n'appelle jamais `now()`, sinon les tests ne pourraient pas piloter le temps. `findSession` tient en un seul `UPDATE … FROM accounts … RETURNING`. Un `peer` relu de la base passe `RelayPeerSchema.parse`.

- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` : PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(relay): accounts and sessions in Postgres, stored by token hash, with sliding expiry"`

---

### Task 3: client GitHub

**Files:**
- Create: `apps/relay/src/github.ts`
- Test: `apps/relay/test/github.test.ts`

**Interfaces:**
- Produces:
  - `interface DeviceCode { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }`.
  - `type DevicePoll = { status: 'ok'; accessToken: string } | { status: 'pending' } | { status: 'slow_down'; interval: number } | { status: 'expired' } | { status: 'denied' }`.
  - `interface GitHubUser { id: string; login: string }`, où `id` est l'entier GitHub en décimal.
  - `class GitHubError extends Error`, avec `code: 'unavailable' | 'rejected'`. Le message ne contient jamais un jeton, un code, le secret ni un corps de réponse.
  - `interface GitHub` :
    - `authorizeUrl(state: string, redirectUri: string): string` ;
    - `exchangeCode(code: string, redirectUri: string): Promise<string>`, qui rend le jeton d'accès ;
    - `deviceStart(): Promise<DeviceCode>` ;
    - `devicePoll(deviceCode: string): Promise<DevicePoll>` ;
    - `user(accessToken: string): Promise<GitHubUser>`.
  - `githubHttp(opts: { clientId: string; clientSecret: string; webBase?: string; apiBase?: string; timeoutMs?: number; fetch?: typeof fetch }): GitHub`. Valeurs par défaut : `https://github.com`, `https://api.github.com`, `10_000`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ils tournent contre un petit serveur `http` local, lancé sur le port 0, qui joue github.com et api.github.com et enregistre les requêtes reçues.
- `authorizeUrl('S', 'http://r/cb')` pointe sur `/login/oauth/authorize`, avec `client_id`, `redirect_uri=http://r/cb`, `state=S`, `scope=` vide et `allow_signup=false`.
- `deviceStart()` envoie `POST /login/device/code` avec `client_id`, `scope` vide et `Accept: application/json`, puis traduit la réponse snake_case en `DeviceCode`.
- `devicePoll` envoie `grant_type=urn:ietf:params:oauth:grant-type:device_code` à `/login/oauth/access_token`. Les réponses GitHub se traduisent ainsi :

  | Réponse GitHub | Résultat |
  | --- | --- |
  | `{ error: 'authorization_pending' }` | `pending` |
  | `{ error: 'slow_down', interval: 10 }` | `{ status: 'slow_down', interval: 10 }` |
  | `expired_token` ou `incorrect_device_code` | `expired` |
  | `access_denied` | `denied` |
  | `{ access_token }` | `ok` |
  | autre `error` | `GitHubError('rejected')` |

- `exchangeCode` envoie le secret client et le `redirect_uri`. Une réponse `{ error: 'bad_verification_code' }` donne `GitHubError('rejected')`.
- `user('T')` envoie `Authorization: Bearer T`, un `User-Agent` et `X-GitHub-Api-Version: 2022-11-28`. Un `{ id: 583231, login: 'kruril' }` donne `{ id: '583231', login: 'kruril' }` ; un 401 donne `GitHubError('rejected')`.
- Un serveur qui ne répond pas, avec `timeoutMs: 50` → `GitHubError('unavailable')`. Un 500 → `unavailable`.
- Le serveur local répond `{ error: 'x', access_token_leak: 'SECRET-TOKEN' }` → le message de l'erreur levée ne contient pas `SECRET-TOKEN`.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/relay exec vitest run test/github.test.ts` : FAIL.

- [ ] **Step 3: Implémenter**
  - Corps de requête en `application/x-www-form-urlencoded` ;
  - `AbortSignal.timeout(timeoutMs)` sur chaque appel ;
  - réponses validées par des schémas zod privés ;
  - un échec de réseau ou de parsing devient `GitHubError` avec un message fixe.

- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` : PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(relay): GitHub OAuth and device flow client with bounded calls and no secret in errors"`

---

### Task 4: sessions à l'upgrade et device flow du PC

**Files:**
- Create: `packages/protocol/src/relayAuth.ts` (exporté depuis `packages/protocol/src/index.ts`), `apps/relay/src/accounts.ts`, `apps/relay/src/routes.ts`, `apps/relay/src/cookies.ts`
- Modify: `apps/relay/src/log.ts`
- Test: `apps/relay/test/fakeGithub.ts`, `apps/relay/test/accounts.test.ts`, `packages/protocol/test/relayAuth.test.ts`

**Interfaces:**
- Consumes: Task 1 (`HttpHandler`, `RelayControl`, `presentedToken`), Task 2 (`Store`, `Session`, `tokens.ts`), Task 3 (`GitHub`, `GitHubError`).
- Produces :
  - **Protocole (`relayAuth.ts`) :**
    - `RELAY_SESSION_COOKIE = 'ledge_session'` ;
    - `RELAY_CLOSE_SIGNED_OUT = 4001` ;
    - `DeviceStartResponseSchema` : `{ deviceCode, userCode, verificationUri, expiresIn, interval }` ;
    - `DevicePollResponseSchema`, union discriminée sur `status` : `pending`, `slow_down` (avec `interval`), `ok` (avec `token`, `accountId`, `login`), `expired`, `denied`, `not_allowed` ;
    - `MeResponseSchema` : `{ accountId, login, peer: RelayPeerSchema, kind: 'pc' | 'device' }`.
  - **Cookies (`cookies.ts`) :**
    - `parseCookies(header: string | undefined): Map<string, string>` ;
    - `setCookie(name: string, value: string, opts: { maxAgeS: number; path: string; secure: boolean }): string`, qui pose toujours `HttpOnly; SameSite=Lax`.
  - **Authentification (`accounts.ts`) :**
    - `interface AccountsDeps { store: Store; allowed: ReadonlySet<string>; publicUrl: string; log: RelayLog }` ;
    - `sessionOf(req: IncomingMessage, deps: AccountsDeps, opts: { checkOrigin: boolean }): Promise<{ session: Session; tokenHash: string; viaCookie: boolean } | null>`. Le jeton vient de `presentedToken(req)`, sinon du cookie `ledge_session`. Avec le cookie et `checkOrigin`, `req.headers.origin` doit être égal à `new URL(publicUrl).origin`. La session doit vivre (`store.findSession`) et `allowed.has(session.accountId)` ;
    - `accountsAuthenticator(deps: AccountsDeps): Authenticator`, c'est-à-dire `sessionOf(req, deps, { checkOrigin: true })` ramené à `Who`.
  - **Routes (`routes.ts`) :** `authRoutes(deps: AccountsDeps & { github: GitHub; maxGitHubCalls?: number }): HttpHandler`. `maxGitHubCalls` vaut 16 par défaut. Ce plafond porte sur les appels GitHub en cours : au-delà, réponse 503 `{ error: 'busy' }`. Toutes les réponses sont en JSON. Un corps JSON au-delà de 4 Kio donne 413, un corps invalide 400. Une `GitHubError` donne 502 `{ error: 'github' }`.

    | Route | Comportement |
    | --- | --- |
    | `POST /auth/device/start` | 200 `DeviceStartResponse` |
    | `POST /auth/device/poll` `{ deviceCode }` | 200 `DevicePollResponse` ; voir plus bas pour `ok` |
    | `GET /auth/me` | 200 `MeResponse`, ou 401 ; pas de vérification d'`Origin` pour un GET |
    | `POST /auth/logout` | 204 ; révoque la session présentée et appelle `relay.kick(accountId, peer, RELAY_CLOSE_SIGNED_OUT, 'signed_out')` ; 401 sans session ; avec un cookie, `Origin` doit correspondre et le cookie est effacé (`Max-Age=0`) |

    Quand GitHub autorise le PC, `/auth/device/poll` répond selon le compte :
    - compte hors liste : `not_allowed`, et rien n'est écrit en base ;
    - compte autorisé :
      1. `upsertAccount` ;
      2. `revokeSessions(id, 'pc')`, puis `kick(id, 'pc', 4001, 'signed_out')` ;
      3. création d'une session `{ kind: 'pc', peer: 'pc' }` ;
      4. réponse `ok` avec le jeton en clair, la seule fois où il sort du relais.
  - **Logs (`log.ts`) :**
    - `{ ev: 'sign_in'; account: string; peer: string; kind: 'pc' | 'device' }` ;
    - `{ ev: 'sign_out'; account: string; peer: string }` ;
    - `{ ev: 'sign_in_refused'; reason: 'not_allowed' | 'denied' | 'expired' | 'bad_state' | 'github'; count: number }`, agrégé comme `refused`. Le compteur est un petit utilitaire partagé avec Task 1, extrait dans `log.ts`.
  - **Faux GitHub (`test/fakeGithub.ts`) :** `fakeGitHub()` rend un `GitHub` en mémoire, plus de quoi le piloter :
    - `approve(deviceCode: string, user: GitHubUser)` ;
    - `deny(deviceCode: string)` ;
    - `codeFor(user: GitHubUser): string` ;
    - `failNext(code: 'unavailable' | 'rejected')`.

- [ ] **Step 1: Écrire les tests qui échouent**

`relayAuth.test.ts` : chaque schéma accepte une valeur valide et rejette un `status` inconnu.

`accounts.test.ts` monte un relais réel (`createRelay` avec `authenticator: accountsAuthenticator(deps)` et `http: authRoutes(deps)`), un `Store` sur PGlite et `fakeGitHub()`. `publicUrl` vaut `http://127.0.0.1:<port>` ; les comptes autorisés sont `'1'` et `'2'`.
- **Device flow :** `start`, puis `poll` → `pending`. Ensuite `approve(code, { id: '1', login: 'alice' })`, puis `poll` → `ok`. Le jeton ouvre `/ws` en `Authorization: Bearer` (`welcome` avec `accountId: '1'` et `self: 'pc'`) et en sous-protocole `ledge-relay.<jeton>`. `/auth/me` en Bearer → `{ accountId: '1', login: 'alice', peer: 'pc', kind: 'pc' }`.
- **Refus et erreurs du poll :**
  - un `deny` donne `denied` ;
  - un utilisateur `{ id: '9' }` hors liste donne `not_allowed`, et `/ws` reste fermé faute de session ;
  - `failNext('unavailable')` donne 502.
- **Un PC par compte :** un second device flow pour le compte 1, pendant que le premier PC est connecté. Le premier socket se ferme en 4001, son ancien jeton reçoit 401 à l'upgrade, et le nouveau jeton passe.
- **Liste d'autorisés revérifiée :** une session valide en base pour le compte 2, puis un relais relancé avec `allowed = {'1'}` → 401 à l'upgrade et 401 sur `/auth/me`.
- **Cookie et Origin :** une session `device` est créée directement dans le store pour le compte 1.
  - Le cookie `ledge_session` avec `Origin` égal à `publicUrl` → `welcome` avec `self` égal au peer de l'appareil.
  - Le même cookie avec `Origin: https://evil.example`, puis sans `Origin` → 401 dans les deux cas.
- **Logout :**
  - en Bearer : 204, le socket PC ouvert se ferme en 4001, et le jeton ne passe plus ;
  - en cookie, avec un mauvais `Origin` : 401, et la session vit encore.
- **Rien de secret dans les logs :** aucun événement loggé, sérialisé en JSON, ne contient le jeton de session, le `deviceCode` ni le login `alice`. Le login fait partie de l'identité GitHub ; les logs ne portent que l'`accountId`.
- **Plafond d'appels GitHub :** avec `maxGitHubCalls: 1` et un `deviceStart` du faux qui reste en attente, un second `start` reçoit 503.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/relay exec vitest run test/accounts.test.ts && pnpm --filter @ledge/protocol exec vitest run test/relayAuth.test.ts` : FAIL.
- [ ] **Step 3: Implémenter** `relayAuth.ts`, `cookies.ts`, `accounts.ts`, `routes.ts` (les routes du device flow, `/auth/me` et `/auth/logout`), les événements de `log.ts` et `fakeGithub.ts`.
- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/relay test && pnpm --filter @ledge/protocol test && pnpm typecheck` : PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(relay): GitHub device flow for the PC, session tokens at upgrade, cookie sessions checked against Origin"`

---

### Task 5: connexion web du téléphone

**Files:**
- Modify: `apps/relay/src/routes.ts`
- Test: `apps/relay/test/web-signin.test.ts`

**Interfaces:**
- Consumes: Task 4 (`authRoutes`, `AccountsDeps`, `setCookie`, `parseCookies`, `RELAY_SESSION_COOKIE`, `fakeGitHub`), Task 2 (`newOpaque`, `newDevicePeer`).
- Produces: deux routes en plus dans `authRoutes`. Un cookie est `Secure` exactement quand `publicUrl` commence par `https:`. L'URL de retour vaut toujours `${publicUrl}/auth/github/callback`.

  | Route | Comportement |
  | --- | --- |
  | `GET /auth/github/start` | 302 vers `github.authorizeUrl(state, redirectUri)` ; pose `ledge_oauth_state=<state>`, avec `Path=/auth/github` et `Max-Age=600` |
  | `GET /auth/github/callback?code&state` | toujours un 302 vers `/?signin=<issue>`, et le cookie `ledge_oauth_state` est effacé |

  Le callback donne l'une de ces issues :

  | Situation | Issue |
  | --- | --- |
  | `state` absent, différent du cookie (comparaison en temps constant), ou cookie absent | `bad_state` |
  | `?error=access_denied` | `denied` |
  | `GitHubError` | `error` |
  | compte hors liste | `not_allowed` |
  | compte autorisé | `ok` |

  Pour l'issue `ok`, le relais procède dans cet ordre :
  1. il fait `upsertAccount` ;
  2. il choisit le peer : si la requête porte déjà un cookie `ledge_session` vivant de type `device` pour le même compte, il garde ce peer et révoque l'ancienne session ; sinon il en crée un avec `newDevicePeer()` ;
  3. il crée la session `device` ;
  4. il pose `ledge_session=<jeton>`, avec `Path=/` et `Max-Age` égal à la durée de vie en secondes ;
  5. il logge `sign_in kind:'device'`.

  Ce flux ne pose jamais de jeton dans une URL.

- [ ] **Step 1: Écrire les tests qui échouent**

`web-signin.test.ts` reprend le montage de Task 4. Les requêtes passent par `fetch` avec `redirect: 'manual'`, et les cookies sont recopiés à la main.
- **Flux complet :** `start` → 302 vers l'URL d'autorisation du faux, avec un `state` égal au cookie posé. Ensuite `callback?code=<codeFor(alice)>&state=<state>`, avec le cookie → 302 vers `/?signin=ok`. Le `Set-Cookie` de `ledge_session` contient `HttpOnly`, `SameSite=Lax` et `Path=/`, mais pas `Secure`, car `publicUrl` est en http. Ce cookie, avec le bon `Origin`, ouvre `/ws`, dont le `welcome` porte un `self` en `d_…`. `/auth/me` → `kind: 'device'`.
- **Garde du `state` :**
  - un mauvais `state` donne `bad_state`, et aucune session n'est créée (`/auth/me` sans cookie : 401) ;
  - sans cookie `state`, `bad_state` aussi ;
  - le même `code` et le même `state` rejoués après un succès : le cookie `state` a été effacé, donc `bad_state`.
- **Autres issues :**
  - `?error=access_denied` donne `denied` ;
  - un compte hors liste donne `not_allowed` ;
  - `failNext('unavailable')` donne `error`.
- **Peer stable :** une seconde connexion web avec le cookie `ledge_session` de la première garde le même peer `d_…`, et l'ancien jeton ne vaut plus rien.
- **Cookie `Secure` :** avec `publicUrl` en `https://relay.example`, le `Set-Cookie` contient `Secure`. Ce test appelle le handler directement, sans serveur.
- **Comptes séparés :** un téléphone connecté comme alice (compte 1) et le PC du compte 2 ; un `send` du téléphone vers `pc` reçoit l'erreur `offline`, et le PC du compte 2 ne reçoit rien.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/relay exec vitest run test/web-signin.test.ts` : FAIL.
- [ ] **Step 3: Implémenter** les deux routes dans `routes.ts`.
- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck` : PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(relay): web GitHub sign-in for the phone, an HttpOnly session cookie and a stable device id"`

---

### Task 6: configuration, démarrage et Railway

**Files:**
- Create: `apps/relay/src/config.ts`, `apps/relay/src/app.ts`, `apps/relay/railway.json`
- Modify: `apps/relay/src/main.ts`, `apps/relay/README.md`
- Test: `apps/relay/test/config.test.ts`, `apps/relay/test/app.test.ts`

**Interfaces:**
- Consumes: Tasks 1 à 5.
- Produces :
  - `class ConfigError extends Error`. Son message nomme la variable en faute, jamais sa valeur.
  - `loadConfig(env: NodeJS.ProcessEnv): Config`, avec un `Config` à deux formes, selon `mode` :
    - mode `accounts` :

      | Champ | Variable |
      | --- | --- |
      | `port` | `PORT`, défaut 8787 |
      | `databaseUrl` | `DATABASE_URL` |
      | `clientId` | `GITHUB_CLIENT_ID` |
      | `clientSecret` | `GITHUB_CLIENT_SECRET` |
      | `allowed: Set<string>` | `LEDGE_RELAY_ALLOWED_GITHUB_IDS`, des entiers positifs séparés par des virgules, au moins un |
      | `publicUrl` | `LEDGE_RELAY_PUBLIC_URL`, une origine http(s) sans chemin ; https exigé si `NODE_ENV=production` |
      | `githubWeb?`, `githubApi?` | `LEDGE_RELAY_GITHUB_WEB_URL`, `LEDGE_RELAY_GITHUB_API_URL` ; refusées en production |

    - mode `dev` : `{ mode: 'dev'; port: number; tokens: Record<string, Who> }`, comme au lot 1.
  - La présence de `DATABASE_URL` choisit le mode `accounts`. Sans elle, c'est le mode `dev`, refusé si `NODE_ENV=production`.
  - `startAccountsRelay(cfg: AccountsConfig, deps: { db: Db; github: GitHub; log?: RelayLog }): Promise<{ server: http.Server; close(): Promise<void> }>`. Elle fait `migrate()`, puis `createRelay` avec `accountsAuthenticator` et `authRoutes`.
  - `main.ts` lit `loadConfig(process.env)`. En mode `accounts`, il crée un `pg.Pool` et un `githubHttp(...)`, appelle `startAccountsRelay`, et ferme le pool après le relais sur SIGINT/SIGTERM. En mode `dev`, il garde le comportement du lot 1. Une `ConfigError` s'affiche sur stderr et sort avec le code 1.
  - `railway.json` :
    - schéma `https://railway.com/railway.schema.json` ;
    - build : `pnpm install --frozen-lockfile && pnpm --filter @ledge/relay build` ;
    - démarrage : `node apps/relay/dist/main.js` ;
    - `healthcheckPath` : `/healthz` ;
    - `restartPolicyType` : `ON_FAILURE`.

- [ ] **Step 1: Écrire les tests qui échouent**

`config.test.ts` :
- un environnement complet donne le mode `accounts`, avec `allowed` égal à `{'1','22'}` pour `"1, 22"` ;
- erreurs de `ConfigError` :
  - chaque variable requise manquante lève une erreur qui la nomme ;
  - `LEDGE_RELAY_ALLOWED_GITHUB_IDS="1,abc"` ;
  - `LEDGE_RELAY_PUBLIC_URL="http://x/path"` ;
  - `http://` en production ;
  - `LEDGE_RELAY_GITHUB_WEB_URL` en production ;
  - aucun mode en production (ni `DATABASE_URL` ni jetons de dev) ;
- `GITHUB_CLIENT_SECRET=s3cr3t` combiné à une autre variable invalide → le message ne contient pas `s3cr3t` ;
- sans `DATABASE_URL`, avec `LEDGE_RELAY_DEV_TOKENS` → mode `dev`.

`app.test.ts` : `startAccountsRelay` sur PGlite et `fakeGitHub()`. `/healthz` répond `ok`. Un device flow complet aboutit à un `welcome` ; le compte reste en base après `close()` et le redémarrage d'un second relais sur la même base PGlite, et l'ancien jeton y passe encore.

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @ledge/relay exec vitest run test/config.test.ts test/app.test.ts` : FAIL.
- [ ] **Step 3: Implémenter** `config.ts`, `app.ts`, `main.ts` et `railway.json`.
- [ ] **Step 4: Mettre à jour `apps/relay/README.md`**
  - les deux modes et leurs variables ;
  - la création de la GitHub OAuth App : URL de callback `<LEDGE_RELAY_PUBLIC_URL>/auth/github/callback`, case « Enable Device Flow » cochée, aucune permission (scope vide) ;
  - un lancement local avec un Postgres en Docker ;
  - Railway : service sur la racine du dépôt, fichier de configuration `apps/relay/railway.json`, Postgres Railway (`DATABASE_URL` fournie par le plugin), variables à poser ;
  - la liste d'autorisés : on ajoute un id, puis on redémarre le service ; l'id d'un login se lit sur `https://api.github.com/users/<login>` ;
  - la table des routes `/auth/*` ;
  - les codes de fermeture 4000 (remplacé), 4001 (déconnecté) et 4008 (limite).
- [ ] **Step 5: Vérifier**
  - `pnpm --filter @ledge/relay test && pnpm --filter @ledge/relay typecheck && pnpm --filter @ledge/relay build` : PASS.
  - Si un Postgres est disponible, `LEDGE_RELAY_TEST_DATABASE_URL=<url> pnpm --filter @ledge/relay exec vitest run test/store.test.ts` passe aussi.
  - Lancement du build en mode `accounts` contre ce Postgres, avec de fausses valeurs GitHub, puis `curl -s localhost:8787/healthz` → `ok`.
  - Lancement en production sans `DATABASE_URL` → sortie avec le code 1, et un message qui le dit.
- [ ] **Step 6: Vérifier tout l'espace de travail** — `pnpm typecheck && pnpm -r --no-bail test` : seuls restent les échecs déjà présents sur origin/main (2 tests tmux, et les tests overlay et desktop instables sous charge, qui passent en relance isolée).
- [ ] **Step 7: Commit** — `git commit -m "feat(relay): accounts mode from the environment, Postgres at startup and a Railway config"`
