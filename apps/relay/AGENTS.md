# apps/relay — `@paradow/ledge-relay`

The relay between phones and PCs (Node ≥22, `ws`, `pg`, zod, tsup). It routes opaque encrypted bodies on `/ws`, answers
`GET /healthz`, and serves the phone app's build. Deployed with Docker on Railway
(`docker build -f apps/relay/Dockerfile .`).

## Commands

- `pnpm --filter @paradow/ledge-relay test` (Postgres through pglite), `typecheck`, `build`.
- Dev mode, without a database: `LEDGE_RELAY_DEV_TOKENS='{…}' pnpm --filter @paradow/ledge-relay dev` (port 8787 unless
  `PORT`).
- `pnpm --filter @paradow/ledge-relay vapid-keys` makes push keys.
- `ledge-relay launch` (`src/cli.ts`, `src/launch/`) is the self-hosted entry: `--port`, `--host` (default `127.0.0.1`), `--data`,
  `--setup`. Its data directory is `--data`, else `LEDGE_RELAY_HOME`, else `~/.ledge-relay`: `config.json` (mode `0600`) and
  `db/` (pglite unless `DATABASE_URL`). Environment variables override the file. `node dist/main.js` (the Docker image) stays
  configured by the environment only.

## Configuration

`DATABASE_URL` switches to accounts mode; without it the relay runs in dev mode, which it refuses when
`NODE_ENV=production`. GitHub sign-in, VAPID and the `LEDGE_RELAY_*` variables are read in `src/config.ts` (push keys in `src/push.ts`).

## Rules

- The relay never decrypts, stores or logs a body, nor logs a token: it cannot read what it carries, keep it so.
- `ledge-relay launch` never prints a secret (client secret, VAPID private key, `config.json` content): messages name a setting, never its value. It never deletes or rewrites `db/`.
- Run Docker locally only with an explicit subnet (root `AGENTS.md`, "This machine").
