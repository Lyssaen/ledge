# apps/relay — `@ledge/relay`

The relay between phones and PCs (Node ≥22, `ws`, `pg`, zod, tsup). It routes opaque encrypted bodies on `/ws`, answers
`GET /healthz`, and serves the phone app's build. Deployed with Docker on Railway
(`docker build -f apps/relay/Dockerfile .`).

## Commands

- `pnpm --filter @ledge/relay test` (Postgres through pglite), `typecheck`, `build`.
- Dev mode, without a database: `LEDGE_RELAY_DEV_TOKENS='{…}' pnpm --filter @ledge/relay dev` (port 8787 unless
  `PORT`).
- `pnpm --filter @ledge/relay vapid-keys` makes push keys.

## Configuration

`DATABASE_URL` switches to accounts mode; without it the relay runs in dev mode, which it refuses when
`NODE_ENV=production`. GitHub sign-in, VAPID and the `LEDGE_RELAY_*` variables are read in `src/config.ts` (push keys in `src/push.ts`).

## Rules

- The relay never decrypts, stores or logs a body, nor logs a token: it cannot read what it carries, keep it so.
- Run Docker locally only with an explicit subnet (root `AGENTS.md`, "This machine").
