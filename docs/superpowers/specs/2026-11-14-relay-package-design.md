# A relay anyone can launch — design

Date: 2026-11-14. Status: awaiting the owner's approval.

## Intent

Ledge is public on GitHub and its owner wants to share it. Someone who finds it should be able to run Ledge for
themselves and their own machines, including the phone app, without depending on the owner's relay
(`app.kl-ledge.dev`) and without building a Docker image. Today the relay only exists as `apps/relay`, a private
workspace package deployed by a Dockerfile on Railway, with a runbook written for the owner.

The goal: install one npm package on a server, run one command, answer a few questions, and that server is a Ledge
relay serving the phone app.

## Goals

- A published npm package holding the relay and the built phone app: `npm i -g @paradow/ledge-relay`, then
  `ledge-relay launch`.
- No external database needed: an embedded store by default, Postgres still supported.
- A first launch that asks for what it needs (public URL, GitHub OAuth App, allowed GitHub account), generates the rest
  (VAPID keys), and remembers it.
- Released in lockstep with the daemon, carrying the same phone app build as the release.
- The existing Railway deployment keeps working unchanged in behaviour.

## Non-goals (for this project)

- **Sign-in without GitHub.** The relay keeps GitHub accounts and the allow-list (owner's choice). A "single owner"
  mode with a code shown by `launch` may come later.
- **Certificates inside the relay.** The relay serves plain HTTP on a local port; an HTTPS reverse proxy (Caddy,
  nginx, a Cloudflare tunnel) sits in front (owner's choice). The docs give a Caddy example.
- **Mobile setup without Ledge Desktop.** For now the self-hoster is assumed to have Desktop: they type their relay's
  address in Réglages › Accès mobile (a free-text field that already exists) and sign in there. Enabling mobile access,
  signing in with GitHub and linking or revoking a phone from `ledge` (CLI or TUI) is a separate, later project, with
  its own mockups.
- A standalone executable without Node, several relay replicas, running as a service by itself (the docs give a
  systemd unit instead).

## Anti-goals

- A relay that can read, store or log what it carries, or logs a token or secret. This rule of `apps/relay` holds for
  every new line, including the first-launch prompts and the config file handling.
- `launch` ever falling back to dev tokens: a launched relay always runs with the production checks.
- Anything in the relay that only works because Desktop is the client. The later Desktop-less setup must reuse the
  same relay routes (device flow for the PC, OAuth for the phone, device revocation) without changing the relay.
- A phone app served by a self-hosted relay that differs from the published one: the phone shows its build
  fingerprint so a user can check it against the release notes, and that check must keep meaning something.

## Constraints

- Node ≥ 22 (as the relay and the daemon today).
- The WebAuthn relying party, the PWA install and Web Push all need the relay's public origin in `https`.
- One process per relay: the socket routing hub lives in memory.
- The phone app's `build.json` (version and fingerprint) in the package must be identical to the release asset
  `ledge-mobile-build.json` of the same tag.
- **Licence:** the repository has no `LICENSE` and `@paradow/ledge` says `UNLICENSED`, which grants nobody the right
  to run the code. The owner picks a licence later, outside this project. Until then the relay package is built and
  checked by the release, but **not published** (owner's choice).

## Approaches considered

1. **A dedicated npm package, `@paradow/ledge-relay`** — relay + phone build + embedded Postgres (pglite), first-run
   questions, published by the release workflow. Simple to install, does not weigh on the daemon's package, reuses
   the relay as it is. **Picked by the owner.**
2. **A subcommand of the daemon's package, `ledge relay launch`** — one package to install, but the daemon's package
   would grow by several MB (phone build, pglite, pg) and a server that only relays would carry the whole tmux CLI.
3. **A standalone executable from the GitHub releases** — nothing to install, but one build per OS, pglite's
   WebAssembly inside a Node executable is fragile, and the release work is heavy for a small gain.

## Decided with the owner

- Approach 1.
- GitHub sign-in stays (OAuth App + allow-list of GitHub ids); `launch` guides the creation of the OAuth App.
- HTTPS by a reverse proxy in front; the relay does no TLS.
- The Desktop-less mobile setup comes later and must stay possible without relay changes.
- The name is `@paradow/ledge-relay`, command `ledge-relay`.
- No publication before a licence: until the owner has chosen one, the release packs the relay without publishing it.
- The first publication is done once by hand by the owner from their machine, who then sets the npm Trusted Publisher
  for the package; only after that does the release workflow publish it.

## Design

### The package

`apps/relay` becomes the publishable package (my call: one source of truth, no copy): its `name` becomes
`@paradow/ledge-relay`, `private` goes, it gains a `bin` `ledge-relay`, `files` holding the bundled `dist/` and the
phone build (e.g. `web/`), `repository`/`homepage` like `@paradow/ledge`, and `"license": "UNLICENSED"` until the owner
picks one. `pglite` moves from a dev dependency to a dependency, **pinned to an exact version** (see "Embedded database
upgrades"); `pg`, `ws`, `zod` stay. `@ledge/protocol` and `@ledge/seal` stay bundled by tsup, as today.

Every `--filter @ledge/relay` (Dockerfile, root scripts, `AGENTS.md`, README, CI) follows the rename.
`scripts/set-version.mjs` stamps this package too.

### `ledge-relay launch`

Runs the relay in the foreground. Options: `--port` (default `8787`), `--host` (default `127.0.0.1`: the proxy runs on
the same machine; `0.0.0.0` when it does not), `--data <dir>`, `--setup` (ask the first-launch questions again).
`ledge-relay --version` prints the version. The current `node dist/main.js` entry (env-only, used by the Docker image)
keeps working as it does.

**Data directory.** `--data`, else `LEDGE_RELAY_HOME`, else `~/.ledge-relay/`. It holds `config.json` (written with
mode `0600`, directory `0700`) and the embedded database. The config file holds the public URL, the OAuth App's id and
secret, the allowed GitHub ids, and the generated VAPID keys and subject.

**Precedence.** Environment variables (the ones `apps/relay/README.md` documents) override the config file, which
overrides defaults. `DATABASE_URL` set: Postgres, as today. Unset: pglite, persisted in the data directory. The relay
always loads with the production rules of `loadConfig` (https public URL, web build present, VAPID present), whatever
`NODE_ENV` says.

**First launch.** When the config is incomplete and stdin is a terminal, `launch` asks, in order:

1. the public URL (`https://…`, checked like `LEDGE_RELAY_PUBLIC_URL`);
2. then shows the exact OAuth App values to enter on GitHub (homepage = the public URL, callback =
   `<public URL>/auth/github/callback`, "Enable Device Flow" ticked, no permission), and asks for the client id and
   the client secret (typed without echo);
3. the GitHub account allowed in: a login, resolved to its numeric id through `api.github.com/users/<login>` and shown
   back for confirmation (a numeric id is accepted as is, so no network is needed for it);
4. a contact for Web Push (`mailto:` address), defaulting to the public URL when left empty (the existing rule allows
   `mailto:` or `https:`).

VAPID keys are generated (same code as `scripts/vapid-keys.mjs`). The file is written, then the relay starts and
prints one human line saying where it listens, the public URL to put in Ledge Desktop, and that an HTTPS proxy must
forward to it, followed by the existing JSON `listening` line.

When the config is incomplete and stdin is not a terminal (systemd, a container), `launch` exits 1 with one line
naming the missing settings (never a value) and how to provide them (run `ledge-relay launch` once interactively, or
the environment variables).

Adding someone to the allow-list later: edit `allowed` in `config.json` or `LEDGE_RELAY_ALLOWED_GITHUB_IDS`, then
restart (same rule as today). No dedicated command in this project.

### Embedded database upgrades

pglite's on-disk format has changed between versions, and the package follows the daemon's releases. My call, to keep
this project small: pglite is pinned exactly and only bumped on purpose. When `launch` cannot open the database
directory, it never deletes nor rewrites it: it exits 1 with one line saying the database could not be opened, where it
is, and that moving it aside starts a fresh one (accounts, sessions, linked phones and push subscriptions are then
lost: sign in and link the phones again). The README says the same. An automatic dump-and-restore across pglite
versions is not part of this project.

### The phone build and the release

The npm job of `.github/workflows/release.yml` builds and packs `@paradow/ledge-relay` next to `@paradow/ledge`, with the
same version. The phone build is already made in that job and is the one published as `ledge-mobile-build.json`; the
package carries that very build, and a release step checks the packed `build.json` against it.

Publication is gated (owner's choice): while the package says `UNLICENSED`, the step only runs `npm pack --dry-run`,
like the daemon's "Check the package without publishing" step. Once the owner has chosen a licence and done the first
publication by hand (Trusted Publishing needs an existing package), the step publishes with the same "already
published" guard and `--provenance` as the daemon. The gate must never fail the job: the `production` job (Railway)
depends on it. The builder picks how the gate reads (the package's `license` field, a repository variable…) and writes
the owner's one-time steps (manual publish, Trusted Publisher setup) in the README.

The Docker image keeps working; whether it now installs the published package or keeps building from the repository is
left to the builder, as long as Railway's behaviour and variables do not change.

### Docs

- `apps/relay/README.md`: a "Run your own relay" section first: install, `launch`, the OAuth App, a Caddy example
  (`relay.example.com { reverse_proxy 127.0.0.1:8787 }`), a systemd unit, then in Ledge Desktop: Réglages › Accès
  mobile › relay address. The Railway runbook stays as the owner's production section.
- The package's npm README is that section.
- `docs/ledge-guide.md`: one line in Ledge mobile pointing to self-hosting.

### Tests

- Config: merge order (env over file over defaults), missing settings reported together without values, the file's
  modes, pglite chosen when `DATABASE_URL` is unset.
- First launch with a fake terminal and a fake GitHub (`test/fakeGithub.ts` exists): answers written to the file,
  login resolved, secret never echoed nor logged.
- Non-interactive incomplete config: exit 1 with the single line.
- An end-to-end run on pglite persisted in a temp directory: launch, restart, the session survives.
- A database directory pglite cannot open: exit 1 with the single line, the directory left untouched.
- The release gate: with `UNLICENSED`, nothing is published and the job succeeds.
- The packed package (`npm pack`) contains `dist/`, the phone build and a runnable `bin`.

## Left to the builder

- How `launch` reuses `loadConfig` (feeding it a merged environment or splitting it), the prompt library (or none:
  `node:readline`), the exact wording of prompts and messages.
- How the phone build reaches the npm job (artifact shared between jobs or reproducible build).
- Whether the Dockerfile switches to the published package.
