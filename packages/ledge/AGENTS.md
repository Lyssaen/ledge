# packages/ledge — `@paradow/ledge`

The WSL daemon, the `ledge` CLI and its Ink TUI, published to npm. The daemon follows the agent sessions running in
tmux, answers hooks, and serves the apps over WebSocket on `127.0.0.1:47831` (`PROTOCOL_PORT`).

## Commands

- `pnpm --filter @paradow/ledge test`, `typecheck`, `build` (tsup bundles the workspace packages in: `noExternal`).
- `pnpm --filter @paradow/ledge dev -- <args>` runs the CLI from the sources (`tsx src/cli/index.ts`).
- Tests need `tmux` installed. Each test file gets its own `LEDGE_HOME` (`test/isolate-home.ts`); pane fixtures are in
  `test/fixtures/panes/`.

## Layout

`src/cli` (commands, hooks), `src/daemon` (server, sessions, OpenRig), `src/adapters` (one per agent tool),
`src/chat` (Ask Ledge), `src/tui`, `src/brain`, `src/mobile` (relay link, phone gateway), `src/term`,
`src/transport`, `src/update`.

## Pitfalls

- Ledge's agents run on its own tmux server: `tmux -L ledge -f ~/.ledge/tmux.conf`. `realTmux(null)` is the owner's
  default server, where OpenRig's seats run: read and attach there, never change its global options or environment.
- `src/cli/index.ts` imports nothing statically, and a hook must never fail the agent: an npm reinstall can leave the
  package half written while agents keep calling `ledge hook`.
- Ask Ledge runs carry `LEDGE_CHAT=1` so Ledge's own hooks ignore them.
- `rig` is run without `NO_COLOR`/`FORCE_COLOR` (`src/daemon/openrig.ts`): it can start OpenRig's daemon, which would
  hand them to every seat. Its output is stripped of escape sequences instead.
- Do not restart or replace the installed daemon (`ledge-daemon.service`) to try a change: use the tests, or `dev` with
  a separate `LEDGE_HOME`.

## Text

TUI strings: `src/tui/i18n/{fr,en}.ts`.
