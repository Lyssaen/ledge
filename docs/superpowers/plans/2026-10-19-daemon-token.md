# Daemon Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every connection to the daemon on `127.0.0.1:47831` must present a per-user secret from `~/.ledge/token`; only the Ledge suite (Desktop, notch, CLI, bridge) holds it.

**Architecture:** The daemon creates the token at start and refuses any WebSocket handshake without it (Bearer header for Node clients, `ledge.<token>` subprotocol for the WebViews), with a loopback `Host` check. Ledge Desktop's Rust side reads the token from WSL through a fixed `wsl.exe` command and hands it to both windows; `packages/fleet` presents it on every (re)connection and exposes a "token missing" flag that the main window and the notch turn into an "update the daemon" notice.

**Tech Stack:** Node + `ws` (daemon, CLI), TypeScript + React (`packages/fleet`, `apps/desktop`, `apps/overlay`), Rust + Tauri 2 (`apps/desktop/src-tauri`, `crates/ledge-native`), vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-10-19-daemon-token-design.md`. The superseded PR is available as git ref `pr9` (`git fetch origin pull/9/head:pr9` if missing); port from it, never cherry-pick.

## Global Constraints

- Token file: `<ledgeDir()>/token`, 64 lowercase hex chars + `\n`, mode `0600`. Kept across restarts; malformed → replaced.
- Subprotocol prefix: `ledge.` (exactly). Header: `Authorization: Bearer <token>`.
- Allowed `Host` names: `localhost`, `127.0.0.1`, `[::1]`, optional `:port`. `Origin`, when present, must be in `ALLOWED_ORIGINS` (unchanged list).
- Any refusal → HTTP 401, no `Access-Control-*` header. A token in the query string is ignored.
- The token never appears in a log line, an error message, a URL, `localStorage`, or a file on the Windows side.
- A hook never blocks or fails the agent: token read errors are swallowed (100 ms budget unchanged).
- Strict client: inside Tauri, the app never opens a daemon socket without a token.
- WSL read command, verbatim: `wsl.exe --exec sh -c 'f="${LEDGE_HOME:-$HOME/.ledge}/token"; [ -f "$f" ] || exit 3; cat "$f"'`; exit code `3` = absent; read timeout 5 s.
- Update commands shown to the user, verbatim:
  - npm: `npm i -g @paradow/ledge && systemctl --user restart ledge-daemon`
  - git: `cd <your Ledge clone> && git pull && pnpm install && pnpm --filter @paradow/ledge build && systemctl --user restart ledge-daemon`
- No Windows `icacls` branch: the daemon only runs on Linux.

## Review Focus

1. A daemon restarted with a fresh token file while the app is open → the app re-reads the token after the failed reconnect and comes back without user action (Task 4 test `re-reads the token after a failed connection`).
2. `connect()` / `close()` called while a token read is still pending → no stale socket is opened, no status flip after `close()` (Task 4 test `a close during the token read opens nothing`).
3. A refused handshake carrying a wrong token → the daemon log names the reason (`auth`) but contains neither the presented nor the expected token (Task 2 test `logs why, never the token`).
4. Missing, empty, truncated or directory-shaped token file on the CLI side → `readDaemonToken()` returns `undefined`, `connect()` still attempts and fails like a down daemon, no throw (Task 1 test `reads nothing from a bad file`).
5. WSL slow or failing at Windows login → "unreachable", never "update the daemon" (Task 3 test `anything but exit 3 or a token is unavailable`, Task 4 test `unavailable is not missing`).

---

### Task 1: Token module and file

**Files:**
- Create: `packages/ledge/src/auth.ts` (port of `git show pr9:packages/ledge/src/auth.ts`, without the `win32`/`icacls` branch of `lockTokenFile`)
- Modify: `packages/ledge/src/paths.ts:23` (add `token: join(dir, 'token')` to `paths()`)
- Test: `packages/ledge/test/auth.test.ts` (port of `git show pr9:packages/ledge/test/auth.test.ts`, keep only the unit tests of the functions below; handshake tests come in Task 2)

**Interfaces:**
- Produces (all exported from `packages/ledge/src/auth.ts`):
  - `DAEMON_PROTOCOL_PREFIX = 'ledge.'`
  - `isDaemonToken(value: string): boolean`
  - `tokenEquals(presented: string, expected: string): boolean` (SHA-256 both, `timingSafeEqual`)
  - `hostAllowed(host: string | string[] | undefined): boolean`
  - `requestAuthorized(headers: IncomingHttpHeaders, expected: string): boolean`
  - `selectDaemonProtocol(protocols: Set<string>, expected: string): string | false`
  - `ensureDaemonToken(): Promise<string>` (create-or-keep, race-safe via `wx` temp + `link`)
  - `readDaemonToken(): string | undefined` (sync; `undefined` on any error or malformed content)
  - `paths().token: string`

- [ ] **Step 1: Write the failing tests** in `auth.test.ts`, each with `process.env.LEDGE_HOME` set to a fresh `mkdtempSync` dir:
  - `creates a 0600 token of 64 hex chars`: `statSync(paths().token).mode & 0o777` is `0o600`; content matches `/^[0-9a-f]{64}\n$/`.
  - `keeps the same secret across starts`: two `ensureDaemonToken()` calls return the same value.
  - `replaces a malformed file`: write `'nope\n'`, then `ensureDaemonToken()` returns a valid token ≠ `'nope'`.
  - `two concurrent starts publish one secret`: `Promise.all([ensureDaemonToken(), ensureDaemonToken()])` yields two equal values equal to the file.
  - `reads nothing from a bad file`: `readDaemonToken()` is `undefined` for no file, `''`, 63 hex chars, and when `paths().token` is a directory.
  - `compares tokens`: `tokenEquals(t, t)` true; `tokenEquals(t.slice(1), t)`, `tokenEquals('', t)`, `tokenEquals('x'.repeat(10_000), t)` false, none throws.
  - `accepts loopback hosts only`: true for `localhost`, `127.0.0.1:47831`, `[::1]:47831`, `LOCALHOST`; false for `undefined`, `''`, `evil.example`, `127.0.0.1.evil.example`, `localhost.`, `[::1]x`, `127.0.0.1:abc`.
  - `authorizes Bearer or subprotocol`: `requestAuthorized({ authorization: 'Bearer ' + t }, t)` true; `{ 'sec-websocket-protocol': 'ledge.' + t }` true; `{ 'sec-websocket-protocol': 'other, ledge.' + t }` true; wrong token in either false; `{}` false.
  - `echoes only the matching subprotocol`: `selectDaemonProtocol(new Set(['ledge.' + t]), t)` is `'ledge.' + t`; with a wrong token or no `ledge.` entry it is `false`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `pnpm --filter @paradow/ledge exec vitest run test/auth.test.ts`
  Expected: FAIL, `Cannot find module '../src/auth.js'`.

- [ ] **Step 3: Implement `packages/ledge/src/auth.ts` and `paths().token`** as listed in Interfaces (port from `pr9`, drop the Windows branch; `lockTokenFile` is only `chmod 0o600`).

- [ ] **Step 4: Run them to verify they pass**
  Run: `pnpm --filter @paradow/ledge exec vitest run test/auth.test.ts && pnpm --filter @paradow/ledge typecheck`
  Expected: PASS, no type error.

- [ ] **Step 5: Commit**
  ```bash
  git add packages/ledge/src/auth.ts packages/ledge/src/paths.ts packages/ledge/test/auth.test.ts
  git commit -m "feat(ledge): a per-user daemon token in ~/.ledge/token"
  ```

### Task 2: The daemon requires the token; the CLI and the bridge present it

Server and clients land together: enforcing the token without the clients sending it would break every hook.

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts:60-118` (doc comment of `ALLOWED_ORIGINS`, `verifyClient`, `handleProtocols`, own `http.Server` answering 401, `close()`) — port the `refusal` / `unauthorized` / `requestPath` shape from `git diff $(git merge-base main pr9) pr9 -- packages/ledge/src/daemon/server.ts`, keeping today's `/ssh/<alias>` path rule and the desktop dev origins.
- Modify: `packages/ledge/src/client.ts:12-14` (`connect()` sends Bearer)
- Modify: `packages/ledge/src/cli/bridge.ts:9` (Bearer from `readDaemonToken()`)
- Modify tests that open raw sockets: `packages/ledge/test/server.test.ts` (lines ~65, ~857, ~1484, ~1611, ~1745), `packages/ledge/test/ssh-transport.test.ts` (5 sockets); check `attach.test.ts`, `e2e.test.ts`, `launch.test.ts`, `hook.test.ts` still pass (they go through `connect()`; set `LEDGE_HOME` to a temp dir where they do not already).
- Test: `packages/ledge/test/auth.test.ts` (handshake section, port from `pr9`)

**Interfaces:**
- Consumes: Task 1's `ensureDaemonToken`, `hostAllowed`, `requestAuthorized`, `selectDaemonProtocol`, `readDaemonToken`.
- Produces: `connect(opts: { port?: number; host?: string; timeoutMs?: number; token?: string | null })` — `token` `undefined` reads the file, `null` sends none (for tests). `startServer` creates the token itself (`await ensureDaemonToken()` before listening), so every test that starts a server gets a file in its `LEDGE_HOME`.

- [ ] **Step 1: Write the failing handshake tests** in `auth.test.ts` (`describe('handshake')`, a real `startServer({ store: new Store(), tmux: fakeTmux, port: 0 })`, raw `ws` sockets):
  - `refuses no token`: 401.
  - `refuses a wrong token`: Bearer of another valid-looking token → 401.
  - `accepts Bearer`: opens.
  - `accepts the subprotocol and echoes it`: `new WebSocket(url, ['ledge.' + t], { origin: 'tauri://localhost' })` opens and `ws.protocol === 'ledge.' + t`.
  - `refuses a foreign Host`: valid Bearer, `headers: { host: 'evil.example:47831' }` → 401.
  - `refuses an unknown Origin`: valid Bearer, `origin: 'https://evil.example'` → 401.
  - `ignores a token in the query`: `ws://127.0.0.1:<port>/?token=<t>` without header → 401.
  - `answers plain HTTP with 401 and no CORS`: `fetch('http://127.0.0.1:<port>/', { headers: { origin: 'tauri://localhost' } })` → status 401, no header starting with `access-control-`.
  - `opens /ssh/<alias> with the token only`: `/ssh/server` with Bearer opens; without → 401.
  - `logs why, never the token`: after a wrong-token attempt, `daemon.log` contains `refused a connection (auth)` and contains neither the presented nor the expected token.
  - `connect() reads the file`: `await connect({ port })` resolves; `connect({ port, token: null })` rejects.

- [ ] **Step 2: Run them to verify they fail**
  Run: `pnpm --filter @paradow/ledge exec vitest run test/auth.test.ts`
  Expected: FAIL on the refusal cases (the server still accepts tokenless clients).

- [ ] **Step 3: Implement** the server checks (path → origin → host → token, log `refused a connection (<reason>) from origin <sanitised origin>`), `handleProtocols: protocols => selectDaemonProtocol(protocols, token)`, the 401 `http.Server` with tracked sockets destroyed in `close()`, Bearer in `connect()` and `bridge()`. Update the raw sockets in `server.test.ts` / `ssh-transport.test.ts` to send `Authorization: Bearer ${readDaemonToken()}` (a shared `authHeaders()` helper in `packages/ledge/test/helpers.ts`).

- [ ] **Step 4: Run the whole package**
  Run: `pnpm --filter @paradow/ledge test && pnpm --filter @paradow/ledge typecheck`
  Expected: PASS, including `hook.test.ts` (hooks still forward their event) and `ssh-transport.test.ts`.

- [ ] **Step 5: Commit**
  ```bash
  git add packages/ledge/src packages/ledge/test
  git commit -m "feat(daemon): require the token on every local connection"
  ```

### Task 3: Desktop reads the token from WSL

**Files:**
- Create: `crates/ledge-native/src/daemon_token.rs`
- Modify: `crates/ledge-native/src/lib.rs` (`pub mod daemon_token;`)
- Modify: `apps/desktop/src-tauri/src/main.rs:174-178` (register `daemon_token`), plus the command itself next to `open_url`
- Test: unit tests inside `daemon_token.rs` (`#[cfg(test)] mod tests`, same style as `terminal.rs`)

**Interfaces:**
- Produces (Rust, `ledge_native::daemon_token`):
  - `pub enum TokenRead { Token(String), Absent, Unavailable }`
  - `pub const ABSENT_EXIT: i32 = 3;`
  - `pub fn wsl_args() -> [&'static str; 4]` → `["--exec", "sh", "-c", "f=\"${LEDGE_HOME:-$HOME/.ledge}/token\"; [ -f \"$f\" ] || exit 3; cat \"$f\""]`
  - `pub fn outcome(code: Option<i32>, stdout: &[u8]) -> TokenRead` — `Some(0)` + trimmed stdout of 64 `[0-9a-f]` → `Token`; `Some(3)` → `Absent`; anything else → `Unavailable`.
  - `pub fn read(timeout: std::time::Duration) -> TokenRead` — Windows: spawn `wsl.exe` with `wsl_args()`, stdout piped, stdin/stderr null, `creation_flags(0x0800_0000)` (CREATE_NO_WINDOW); poll `try_wait()` every 50 ms until the deadline, then `kill()` and return `Unavailable`; spawn error → `Unavailable`. Not Windows: `Unavailable`.
- Produces (Tauri command, JS side): `invoke('daemon_token')` resolves to `{ kind: 'token', token: string } | { kind: 'absent' } | { kind: 'unavailable' }`. In `main.rs`: `#[tauri::command] async fn daemon_token() -> serde_json::Value`, running `daemon_token::read(Duration::from_secs(5))` inside `tauri::async_runtime::spawn_blocking` (a join error → `unavailable`). Nothing is logged.

- [ ] **Step 1: Write the failing tests** in `daemon_token.rs`:
  - `a token is 64 hex chars`: `outcome(Some(0), b"<64 hex>\n")` is `Token(<64 hex>)`.
  - `exit 3 is absent`: `outcome(Some(3), b"")` is `Absent`.
  - `anything but exit 3 or a token is unavailable`: `Unavailable` for `(Some(0), b"")`, `(Some(0), b"nope")`, `(Some(0), <63 hex>)`, `(Some(0), <64 uppercase hex>)`, `(Some(1), b"")`, `(None, b"")`.
  - `the command is fixed`: `wsl_args()` equals the array above, byte for byte.

- [ ] **Step 2: Run them to verify they fail**
  Run: `cargo test -p ledge-native daemon_token`
  Expected: FAIL, unresolved module.

- [ ] **Step 3: Implement** `daemon_token.rs` and the `daemon_token` command as in Interfaces.

- [ ] **Step 4: Run the tests and the build**
  Run: `cargo test -p ledge-native && cargo check -p ledge-desktop` (Windows target: `cargo xwin check -p ledge-desktop --target x86_64-pc-windows-msvc`, per the no-admin WSL setup; never touch the Windows PATH)
  Expected: tests PASS, both checks build.

- [ ] **Step 5: Commit**
  ```bash
  git add crates/ledge-native apps/desktop/src-tauri/src/main.rs
  git commit -m "feat(desktop): read the daemon token from WSL"
  ```

### Task 4: The fleet presents the token and reports a missing one

**Files:**
- Create: `packages/fleet/src/token.ts`
- Modify: `packages/fleet/src/index.ts` (`export * from './token';`)
- Modify: `packages/fleet/src/client.ts:11-27` (`WsCtor`, `createDaemonClient` options, `open()`)
- Modify: `packages/fleet/src/machines.ts:60-67` (`probeMachine` options gain `token?: TokenSource`)
- Modify: `packages/fleet/src/fleet.ts` (`FleetOptions.token?: TokenSource`; `add()` calls `makeClient({ url, token: opts.token })`; `probe: ssh => probeMachine(configs[0]!.url!, ssh, { token: opts.token })`)
- Test: `packages/fleet/test/token.test.ts`, `packages/fleet/test/daemon.test.ts` (new cases), `packages/fleet/test/mockDaemon.ts` (optional `token` that it requires, echoing `ledge.<token>` via `handleProtocols`)

**Interfaces:**
- Produces (`packages/fleet/src/token.ts`):
  ```ts
  export type TokenRead = { kind: 'token'; token: string } | { kind: 'absent' } | { kind: 'unavailable' };
  export const DAEMON_PROTOCOL_PREFIX = 'ledge.';
  export interface TokenSource {
    /** Cached after the first success; `fresh` forces a new read. Never rejects (a thrown read is `unavailable`). */
    get(fresh: boolean): Promise<TokenRead>;
    /** True after the last read answered `absent`; false after `token` or `unavailable`. */
    missing(): boolean;
    onMissing(fn: (missing: boolean) => void): () => void;
  }
  export function createTokenSource(read: () => Promise<TokenRead>): TokenSource;
  export function useTokenMissing(source: TokenSource | undefined): boolean; // useSyncExternalStore; false when undefined
  ```
- Produces (`client.ts`): `type WsCtor = new (url: string, protocols?: string[]) => WsLike`; `createDaemonClient(opts: { url: string; token?: TokenSource; WebSocketImpl?: WsCtor; minBackoffMs?: number; maxBackoffMs?: number })`. Without `token`, behaviour is unchanged (no protocol). With it, `open()` awaits `token.get(failedSinceLastSnapshot)`, then — only if the client is still the one that asked (not closed, no newer `connect()`) — opens `new Ws(url, [DAEMON_PROTOCOL_PREFIX + token])` on `token`, or sets `'unreachable'` and schedules a retry on `absent` / `unavailable`. `failedSinceLastSnapshot` becomes true on a close/failed read, false on a `snapshot`. `DaemonStatus` is unchanged.

- [ ] **Step 1: Write the failing tests**
  - `token.test.ts`: `caches the first token` (`read` called once for two `get(false)`); `fresh re-reads` (`get(true)` calls `read` again); `absent sets missing and notifies` (`missing()` true, listener got `true`, then a `token` read flips it back to `false`); `unavailable is not missing` (`missing()` false after `unavailable`); `a throwing read is unavailable`.
  - `daemon.test.ts` (mock daemon with `token: 'a'.repeat(64)`):
    - `presents the token as a subprotocol`: client with a source returning that token reaches `'open'` and gets the snapshot.
    - `stays unreachable and opens nothing while the token is absent`: source returns `absent`; after 300 ms status is `'unreachable'`, the mock saw 0 connections, `source.missing()` is true.
    - `re-reads the token after a failed connection`: source returns `'b'.repeat(64)` first (refused), then the right one; with `minBackoffMs: 50` the client reaches `'open'`, and `read` was called at least twice.
    - `a close during the token read opens nothing`: source whose `read` resolves after 100 ms; `connect()` then `close()` at once; after 200 ms the mock saw 0 connections and status is `'connecting'`.
    - `without a source nothing changes`: existing tests still pass untouched.
  - `fleet.test.ts`: `probe presents the token` (a fleet built with `{ token }` probes the mock's `/ssh/<alias>` and the mock saw the `ledge.<token>` protocol).

- [ ] **Step 2: Run them to verify they fail**
  Run: `pnpm --filter @ledge/fleet exec vitest run test/token.test.ts test/daemon.test.ts test/fleet.test.ts`
  Expected: FAIL (`token.ts` missing, options unknown).

- [ ] **Step 3: Implement** `token.ts`, the client, probe and fleet changes as in Interfaces.

- [ ] **Step 4: Run the package**
  Run: `pnpm --filter @ledge/fleet test && pnpm --filter @ledge/fleet typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add packages/fleet
  git commit -m "feat(fleet): present the daemon token and report a missing one"
  ```

### Task 5: Desktop and notch use the token and say when the daemon is too old

**Files:**
- Modify: `apps/desktop/src/tauri/bridge.ts` (add `daemonTokenSource()`; document `daemon_token` in the header comment)
- Modify: `apps/overlay/src/tauri/bridge.ts` (same function, same contract)
- Modify: `apps/desktop/src/fleet/useFleet.ts:10-16` (`createDesktopFleet` passes `token: daemonTokenSource()` in the fleet options and forwards `c.token` in its `makeClient` lambda)
- Modify: `apps/overlay/src/App.tsx:21-22` (`createFleetClient(loadMachines(), undefined, { ...fleetOptions, token })`; the `VITE_LEDGE_DEMO_WS` demo path stays tokenless)
- Create: `apps/desktop/src/shell/DaemonOutdated.tsx` (the notice), rendered in `apps/desktop/src/App.tsx` at the top of `<section className="workspace">` when `useTokenMissing(token)` is true
- Modify: `apps/overlay/src/surface/Surface.tsx:811` (status line shows `t.daemonOutdated` instead of `t.unreachable` when a new `daemonOutdated` prop is true; `App.tsx` passes it)
- Modify i18n: `apps/desktop/src/i18n/en.ts`, `apps/desktop/src/i18n/fr.ts` (+ the type in `messages.ts` if it lists keys), `apps/overlay/src/i18n/messages.ts`
- Test: `apps/desktop/test/daemon-outdated.test.tsx` (follow `daemon-update.test.tsx` for rendering `App` with a mock fleet), `apps/desktop/test/bridge.test.ts` (new cases), `apps/overlay/test/surface.test.tsx` (new case)

**Interfaces:**
- Consumes: Task 3's `invoke('daemon_token')` result shape; Task 4's `TokenSource`, `createTokenSource`, `useTokenMissing`, `FleetOptions.token`.
- Produces: `daemonTokenSource(): TokenSource | undefined` — one source per window, created once (module singleton). Inside Tauri: `createTokenSource(() => invoke<TokenRead>('daemon_token'))`. Outside Tauri: if `import.meta.env.VITE_LEDGE_TOKEN` is set, a source that always returns it; otherwise `undefined` (browser dev, demo and Playwright e2e connect tokenless to their fake daemon as today).
- Copy, verbatim:
  - Desktop `daemonOutdated` (en): `title: 'The Ledge daemon must be updated'`, `body: 'This Ledge Desktop needs a newer daemon in WSL. Run one of these commands in WSL; Ledge reconnects by itself.'`, `npm: 'Installed with npm'`, `git: 'Installed from a git clone'`.
  - Desktop `daemonOutdated` (fr): `title: 'Le démon Ledge doit être mis à jour'`, `body: 'Ce Ledge Desktop a besoin d’un démon plus récent dans WSL. Lancez une de ces commandes dans WSL ; Ledge se reconnecte tout seul.'`, `npm: 'Installé avec npm'`, `git: 'Installé depuis un clone git'`.
  - Notch `daemonOutdated`: fr `'Démon Ledge à mettre à jour · voir Ledge Desktop'`, en `'Ledge daemon to update · see Ledge Desktop'`.
  - The two commands of Global Constraints, each in a `<code>`, not translated.

- [ ] **Step 1: Write the failing tests**
  - `bridge.test.ts`: `no token source outside Tauri without VITE_LEDGE_TOKEN` (`daemonTokenSource()` is `undefined`); `VITE_LEDGE_TOKEN gives a fixed token` (`vi.stubEnv`, `get(false)` resolves `{ kind: 'token', token }`); `inside Tauri the source asks daemon_token` (stub `window.__TAURI_INTERNALS__` and the `invoke` mock the file already uses; `get(false)` resolves the mocked `{ kind: 'absent' }`).
  - `daemon-outdated.test.tsx`: `shows both commands when the token is missing` (render `App` with a fleet whose token source answers `absent`: the en title, the npm and git labels and both exact commands are on screen); `hides once the token appears` (the source then answers a token: the title is gone); `says nothing while WSL is unavailable` (source answers `unavailable`: no title).
  - Overlay: `the notch says the daemon is too old` (Surface with `status: 'unreachable'` and `daemonOutdated`: shows the fr notch string, not `t.unreachable`).

- [ ] **Step 2: Run them to verify they fail**
  Run: `pnpm --filter desktop exec vitest run test/bridge.test.ts test/daemon-outdated.test.tsx && pnpm --filter overlay exec vitest run test/surface.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement** as in Files/Interfaces. The notice uses the existing settings/About styling for `<code>` blocks (`apps/desktop/src/settings/About.tsx:76-79`) rather than new CSS where possible.

- [ ] **Step 4: Run both apps' suites and e2e**
  Run: `pnpm --filter desktop test && pnpm --filter overlay test && pnpm typecheck && pnpm --filter desktop test:e2e && pnpm --filter overlay test:e2e`
  Expected: PASS; e2e unaffected (no token source outside Tauri).

- [ ] **Step 5: Commit**
  ```bash
  git add apps/desktop/src apps/desktop/test apps/overlay/src apps/overlay/test
  git commit -m "feat(desktop): connect with the daemon token; say when the daemon is too old"
  ```

### Task 6: Documentation

**Files:**
- Modify: `README.md` § "Security and failure model" (line ~334), § "Protocol", § "How to install?" / updating, § "Development" (`VITE_LEDGE_TOKEN`)

- [ ] **Step 1: Rewrite** the first bullet of "Security and failure model": the daemon listens on loopback, checks `Host` and `Origin`, and requires the per-user token from `~/.ledge/token` (Bearer or `ledge.<token>` subprotocol) on every connection. Known limits, both from spec §1: a program running as the same Linux user can read the token; while the port is free (Windows login, daemon restart) a program of another user can take it and collect the token a client presents.
- [ ] **Step 2: Protocol section**: the handshake requirements (one line each: header/subprotocol, loopback `Host`, 401 otherwise).
- [ ] **Step 3: Install/update section**: the clean cut (spec §6): update the app and the daemon; an app that says the daemon must be updated shows the command to run.
- [ ] **Step 4: Development section**: `VITE_LEDGE_TOKEN` for a browser dev front against a real daemon (`VITE_LEDGE_TOKEN=$(cat ~/.ledge/token)`).
- [ ] **Step 5: Full check and commit**
  Run: `pnpm test && pnpm typecheck && cargo test -p ledge-native`
  Expected: PASS.
  ```bash
  git add README.md
  git commit -m "docs: the daemon token, its limits and the clean-cut update"
  ```
