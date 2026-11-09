# Ledge — guidance for agents

Ledge is a workshop for one person who runs coding agents (Claude Code, Codex, Cursor Agent, OMP) across projects and
machines: a WSL daemon and CLI that follow the agents in tmux, a Windows app (Ledge Desktop, with its island on the top
edge), an end-to-end encrypted phone app, and a relay between the phone and the PC. `README.md` explains the whole;
each project below has its own `AGENTS.md`, read it before working there.

| Project | What it is |
|---|---|
| `packages/ledge` (`@paradow/ledge`) | The WSL daemon, the `ledge` CLI and its TUI; published to npm |
| `packages/protocol` (`@ledge/protocol`) | The zod schemas every part speaks |
| `packages/fleet` (`@ledge/fleet`) | The client of the daemons of several machines, shared by Desktop and the island |
| `packages/ui` (`@ledge/ui`) | Shared React UI: mascots, chat cards, documents, themes, i18n |
| `packages/seal` (`@ledge/seal`) | Phone↔PC end-to-end crypto |
| `apps/desktop` (`desktop`) | Ledge Desktop: Tauri 2 + React; hosts the notch window |
| `apps/overlay` (`overlay`) | The island's web app, built into Desktop's notch window |
| `apps/mobile` (`@ledge/mobile`) | The phone/tablet PWA |
| `apps/relay` (`@ledge/relay`) | The relay: routes encrypted bodies it cannot read |
| `crates/ledge-native` | Win32 helpers shared by Desktop and the island |

## The owner

Ledge is its owner's personal project: they decide what gets built. Talk to them in French. Code, comments, commit
messages and these files are in English.

## Commands

- Node 22 is required: `PATH=~/.local/share/pi-node/current/bin:$PATH` (not `pi-node/bin`, which leaves you on another
  Node). Tests failing under Node 18, and `hook.test` failing under load, fail on `main` too: not a regression.
- `pnpm install` once per worktree, then `pnpm test`, `pnpm typecheck`, `pnpm build` for everything, or
  `pnpm --filter <name> test|typecheck|test:e2e` for one project (names in the table above).
- `cargo test --workspace` and `pnpm --filter desktop tauri dev|build` only run on Windows (CI's Windows runner). Say so
  when a change there could not be checked from WSL.

## Hard rules

- One git worktree per task. Never work in `~/Workspace/ledge`: the owner often has uncommitted work there.
- No push, PR, merge, release or destructive operation without the owner's explicit go for that very action.
- No secret in code, logs, commits or messages (`~/.ledge/token`, VAPID keys, OAuth secrets, relay tokens).

## Screens need an approved mockup

Any visible change to a screen (Desktop, the island, the phone app, `ledge tui`) starts with a mockup in
`docs/mockups/` that **the owner** approved; another agent's approval does not count. A state, text or interaction the
mockup does not show is asked for, not invented. Purely technical fixes with no visible effect need no mockup. A
Desktop screen is checked with zoomed Playwright screenshots (alignment included) before saying it is done.

## Code conventions

- Messages between the parts are zod schemas in `@ledge/protocol`; a new field goes there first.
- Internal packages export their raw `src/*.ts` (no build step); relative imports end in `.js`.
- Comments are prose: one full sentence saying what a thing is for or why, not what the next line does.
- Processes are started with `execFile`/`spawn` and an argument list, never through a shell.
- Every visible text goes through the project's i18n catalogue (French and English).
- Tests sit next to their project in `test/` (vitest) and `e2e/` (Playwright); a bug fix comes with the test that
  would have caught it.

## Documents

- Specs and plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`, named `YYYY-MM-DD-<topic>.md`.
- Mockups: `docs/mockups/`. User guide: `docs/ledge-guide.md`. Multi-machine: `docs/multi-machine.md`.
- Version: `pnpm version:set <x.y.z>` (`scripts/set-version.mjs`) stamps every package and crate. A release is a `v*`
  tag (`.github/workflows/release.yml`): only with the owner's go.

## This machine (WSL behind a corporate proxy)

- Never let Docker pick a subnet: `192.168.40.0/24` carries the proxy and `172.17.192.0/20` the WSL interface. Every
  `docker compose up` / `docker network create` declares an explicit subnet (e.g. `10.80.x.0/24`) after listing the
  existing networks.
- An HTTP 503 or `UNHEALTHY` from `rig` is the proxy answering for `127.0.0.1`: run it with `http_proxy`/`https_proxy`
  unset.

## OpenRig in this repository

`openrig/` holds the `ledge-dev` rig (a lead, a UX/UI designer, two developers, a Codex reviewer); its culture is
`openrig/CULTURE.md`. Its seats start in `~/Workspace/ledge`, where OpenRig writes guidance blocks marked
`<!-- BEGIN OpenRig MANAGED BLOCK: … -->`: Claude seats get theirs in `CLAUDE.local.md` (ignored by git), the Codex
reviewer appends its own to this `AGENTS.md`. **Never commit OpenRig's managed blocks.**
