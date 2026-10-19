# Daemon token: only the Ledge suite talks to the daemon

Date: 2026-10-19. Status: design, approved in conversation. Supersedes PR #9 (`cursor/daemon-auth-token-760b`), which was written
against 0.5.4 and is 433 commits behind `main`: its concept is kept, its code is redone on the current tree (`apps/desktop`,
`packages/fleet`, the notch).

## 1. Intent

The daemon listens on `127.0.0.1:47831`. Whatever reaches that port can approve a permission, type into a pane, launch or kill a
session, read transcripts, or open the SSH bridge. Today the only gate is the `Origin` allow-list (`ALLOWED_ORIGINS` in
`packages/ledge/src/daemon/server.ts`), and a client that sends no `Origin` passes: any process, any other OS user, any container or
port-forward that sees the loopback can drive Ledge.

The goal: **reaching the port is no longer enough; a client must also know a per-user secret.** Every piece of the Ledge suite has
the secret; nothing else does.

### Who must hold the secret (the suite)

- Ledge Desktop: the main window and the notch (both connect through `packages/fleet`).
- The CLI in WSL: `ledge hook …` (Claude Code, Codex, Cursor Agent hooks), `ledge launch` / `ledge claude …`, `ledge attach`,
  `ledge status`, and every other command that goes through `connect()` in `packages/ledge/src/client.ts`.
- `ledge bridge` on a remote machine (SSH fleet), towards that machine's own daemon.

### Threat model

Protected against: anything that reaches the loopback port without being able to read the user's files in WSL. Another OS user
(Windows or Linux), a container or VM that sees the port, a port forward (SSH `-L`, VS Code, Docker), a web page (already refused by
`Origin`, now also by the token), DNS rebinding.

**Accepted limit (agreed):** a program running as the same Linux user in WSL can read `~/.ledge/token`, exactly as the hooks do,
and therefore can talk to the daemon. Telling "the Ledge app" apart from "any program of mine" is out of scope.

**Accepted limit (agreed): port squatting.** The token proves the client to the daemon; nothing proves the daemon to the client.
While nothing listens on 47831 (at Windows login before WSL has started the daemon, or during the daemon's restart after an update),
a program run by another OS user can take the port and collect the raw token our clients present. A mutual challenge (daemon nonce,
client HMAC, daemon proof) would close this; it was considered and rejected for this personal tool, as the attack needs code running
on the machine under another account at the right moment. It is written down in the README (§8) as a known limit.

## 2. Goals, non-goals, anti-goals

Goals
- Every WebSocket handshake to the daemon presents the token; one without it, or with a wrong one, is refused before any message is
  processed.
- No manual step for a user whose app and daemon are both up to date.
- The token never lands on the Windows disk and never appears in a log, a URL, or an error message.

Non-goals
- No second confirmation dialog for approve / inject / SSH: the app is the confirmation, the token stops others from imitating it.
- No per-client identity, no token rotation command, no expiry.
- No transition period (see §6): old clients are cut off.
- The other findings of the audit that produced PR #9 are not handled here.

Anti-goals (a failure even if it technically works)
- A hook that blocks, slows, or fails the agent because of the token. Hooks keep their 100 ms budget and swallow every error.
- An app that silently loops on "daemon unreachable, retrying" when the real problem is a missing token or an outdated daemon.
- The token passed on a command line, in a query string, or persisted in `localStorage`.

## 3. The token

- File: `<ledge dir>/token`, i.e. `~/.ledge/token` or `$LEDGE_HOME/token` (add `token` to `paths()` in
  `packages/ledge/src/paths.ts`).
- Content: 32 random bytes, hex (64 chars), trailing newline. Mode `0600`.
- Created by the daemon at startup if missing or malformed; otherwise kept as is across restarts (mode re-tightened each start).
  Creation is race-safe (two daemons starting together end up with one file): reuse PR #9's `ensureDaemonToken` approach
  (write a temp file with `wx`, `link` it into place, the loser reads the winner).
- The daemon holds the value read at startup. Deleting or replacing the file while it runs has no effect until the next restart.
- Builder's call (mine): drop PR #9's Windows `icacls` branch; the daemon only runs on Linux (WSL and SSH hosts).

## 4. The daemon side

In `startServer`'s `verifyClient` (`packages/ledge/src/daemon/server.ts`), in addition to the existing path check:

1. `Host` must be a loopback name: `localhost`, `127.0.0.1` or `[::1]`, optional port.
2. `Origin`, when present, must be in `ALLOWED_ORIGINS` (unchanged rule).
3. The token must be presented by **either**:
   - `Authorization: Bearer <token>` (Node clients), or
   - a WebSocket subprotocol `ledge.<token>` (browser clients: the WebView's `WebSocket` cannot set headers). The daemon echoes the
     matching subprotocol (`handleProtocols`), otherwise the browser drops the connection.
4. Comparison is constant-time: SHA-256 both sides, then `timingSafeEqual` (PR #9's `tokenEquals`).
5. A token in the URL (query string) is ignored.

Any failure → handshake refused with **401**, no CORS header, nothing served. The log line says which check failed (host, origin,
token) but never the presented or expected value.

PR #9's `packages/ledge/src/auth.ts` (`isDaemonToken`, `tokenEquals`, `hostAllowed`, `requestAuthorized`, `selectDaemonProtocol`,
`ensureDaemonToken`, `readDaemonToken`) is the starting point; port it, do not cherry-pick the commit.

## 5. The clients

### 5.1 CLI in WSL (`connect()`)

`connect()` reads the token file (`readDaemonToken`, sync, tiny) and sends `Authorization: Bearer`. No token file → the connection
is attempted without it and fails like an unreachable daemon; callers already handle that (the hook swallows it, `status` prints
"not running"). Callers that do not use `connect()` but open their own `WebSocket` (`packages/ledge/src/cli/bridge.ts`, and any other
found by grepping `new WebSocket` under `packages/ledge/src`) do the same.

### 5.2 `ledge bridge` and the SSH fleet

- Locally, the desktop opens `/ssh/<alias>` on the **local** daemon with the **local** token, like any other connection
  (`machineUrl` / `probeMachine` in `packages/fleet/src/machines.ts`).
- On the remote machine, `ledge bridge` reads **that machine's** token and authenticates to **its** daemon.
- No token ever crosses from one machine to another.

### 5.3 Ledge Desktop (Rust side)

- A Tauri command (e.g. `daemon_token`) returns the token to the web side. It reads it from WSL with a fixed command and no user input,
  e.g. `wsl.exe --exec sh -c 'f="${LEDGE_HOME:-$HOME/.ledge}/token"; [ -f "$f" ] || exit 3; cat "$f"'` (no shell expansion happens
  with a bare `--exec cat ~/…`). Three outcomes, kept distinct:
  - **token**: the output is 64 hex chars;
  - **absent**: WSL ran and the file does not exist (the agreed exit code) → the daemon predates this feature or never started;
  - **unavailable**: anything else (timeout, `wsl.exe` error, WSL still booting, malformed content) → treated as "daemon unreachable",
    never as "update the daemon".
- Builder's call (mine): the read has a timeout (a few seconds; WSL can be slow at Windows login). Calling it may boot the default
  distro, as `open_terminal` already does; that is accepted.
- Builder's call (mine): the value is read once and kept in memory (Rust state and JS memory), and re-read only after a failed
  connection, so a daemon that restarted with a fresh file is picked up without spawning `wsl.exe` on every retry of both windows.
  Not written to disk, not put in `localStorage`, not logged.
- Known limit, accepted: `LEDGE_HOME` is only honoured if it is visible to a non-login `sh` started by `wsl.exe` (e.g. not if it is
  only set in `.bashrc`). Default users never set it.

### 5.4 Ledge Desktop (web side: main window and notch)

- `createDaemonClient` (`packages/fleet/src/client.ts`) takes a token provider; each (re)connection asks it for the token and opens
  `new WebSocket(url, ['ledge.' + token])`. Probes (`probeMachine`) do the same. Its `WsCtor` type gains the `protocols` argument.
- **Strict (agreed):** the app never opens a socket without a token. No token → no connection attempt, even though an old daemon
  would accept one.
- Both the desktop main window (`apps/desktop/src/fleet/useFleet.ts`) and the notch (`apps/overlay/src/App.tsx` and its fleet) use it.
- The provider calls the Tauri command; outside Tauri (Vite dev in a browser) it uses `VITE_LEDGE_TOKEN`. The demo
  (`VITE_LEDGE_DEMO_WS`) and the Playwright fake daemon need no real token: the fake accepts any.

### 5.5 What the user sees when it fails

A new state, distinct from the existing "daemon unreachable, retrying":

- **Token absent** (§5.3: WSL answered, no file; the daemon is older than this feature, or has never started in this WSL):
  the app shows that the daemon must be updated, then restarted. Without a connection it cannot tell how the daemon is installed, so it
  shows both commands to copy, each labelled: the npm install (`npm i -g @paradow/ledge`, the `PACKAGE` of
  `packages/ledge/src/update/run-update.ts`) and the git-clone one (the command `packages/ledge/src/update/self.ts` already builds),
  plus the restart (`systemctl --user restart` of the daemon's unit). It keeps re-reading the token in the background (with backoff)
  and leaves this state on its own once a token appears and the connection opens.
- **Token unavailable** (§5.3: WSL not ready, timeout, error): the existing "unreachable, retrying" state.
- **Token present but the connection is refused**: the browser cannot tell a 401 from a down daemon (both are a close with code
  1006). The client re-reads the token before each retry, so a daemon that restarted with a new file is picked up. If it still fails,
  the existing "unreachable, retrying" state stays. Builder's call (mine): no extra detection; the realistic causes (daemon down,
  daemon restarting) are what that state already describes.

Wording, placement and translations follow the existing i18n files of the desktop and the notch.

## 6. Migration: clean cut (agreed)

No transition version. The app and the daemon update separately, each on a click in Ledge Desktop's settings, and the app is what
asks the daemon to update. Consequences, accepted:

- **New app, old daemon**: the old daemon has no token file → the app does not connect (strict, agreed) and shows §5.5's "update
  the daemon" state with the manual commands (the in-app daemon update cannot run, since it goes through the daemon connection).
- **New daemon, old app**: the old app sends no token → refused → shows "unreachable". The app updates itself through the Tauri
  updater (GitHub, independent of the daemon), after which it connects.
- Old CLI pieces cannot exist next to a new daemon: CLI and daemon are the same npm package. A running `ledge claude` started
  before the update keeps working only until its next hook, which then runs the new code (same global install).
- Remote SSH machines: their bridge and daemon come from the same package on that machine, so they are always in step.

The release notes and the README's install section say: update both, and if the app says the daemon must be updated, run the command.

## 7. Tests

- `packages/ledge/test/auth.test.ts` (port PR #9's): file mode, secret stable across starts, malformed file replaced, concurrent
  creation, constant-time compare, `Host` rules, Bearer, subprotocol echoed, wrong token → 401, unknown `Origin` → 401, no CORS
  header, plain HTTP refused, token in query ignored.
- `server.test.ts`, `ssh-transport.test.ts`, `launch.test.ts` and every test that starts a real server: run with a temporary
  `LEDGE_HOME`, the client reads the token `startServer` created.
- `packages/fleet`: the client sends `ledge.<token>` from the provider, re-reads it on each reconnect, and reports the "no token"
  state; probes send it too.
- Desktop: Rust unit test for the token validation (64 hex accepted, anything else refused) and for the fixed `wsl.exe` argument
  list; a component test for the "update the daemon" state in both the main window and the notch.
- Playwright e2e (desktop and overlay): the fake daemon ignores the token; the Tauri mock returns a fixed one.

## 8. Documentation

- README "Security and failure model": replace "There is no authentication beyond that: anything running on the machine can talk to
  it" with the token, what it protects against, and §1's two accepted limits (same-user programs, port squatting).
- README "Protocol": the handshake requirements (Bearer or `ledge.<token>` subprotocol, loopback `Host`).
- README install/update: the clean-cut note of §6.

## 9. Left to the builder

- Exact names (Tauri command, provider type, i18n keys, close/log wording).
- Whether `ensureDaemonToken` runs in `startServer` or in the daemon entry point before it (tests need `startServer` to create it).
- How the "no token" state is threaded through `DaemonStatus` (a new value such as `'outdated'`, or a separate flag), as long as
  both the main window and the notch show it.
