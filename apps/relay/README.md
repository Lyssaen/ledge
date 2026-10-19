# @ledge/relay

Relay between phones and a PC. It routes opaque end-to-end-encrypted bodies and never decrypts them; no content is stored or logged. Websocket path: `/ws`; health check: `GET /healthz` answers `ok`.

## Modes

`DATABASE_URL` selects the mode. Present: accounts mode. Absent: dev mode, which is refused when `NODE_ENV=production`.

### Accounts mode

Accounts are GitHub users from an allow-list. The relay keeps accounts and sessions in Postgres (only the sha256 of a session token is stored) and creates its tables at startup.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The GitHub OAuth App. |
| `LEDGE_RELAY_ALLOWED_GITHUB_IDS` | Numeric GitHub ids, positive integers separated by commas, at least one. Checked at every authentication. |
| `LEDGE_RELAY_PUBLIC_URL` | The relay's public origin, `http(s)://host[:port]`, no path. https is required when `NODE_ENV=production`. A cookie session is accepted only from this `Origin`. |
| `PORT` | Default `8787`. |
| `LEDGE_RELAY_GITHUB_WEB_URL`, `LEDGE_RELAY_GITHUB_API_URL` | Point GitHub calls at another server (tests). Refused in production. |

A configuration error is printed on stderr, naming the variable and never its value, and the process exits with code 1.

### Dev mode

```sh
LEDGE_RELAY_DEV_TOKENS='{"tok-pc-0123456789abcdef":{"accountId":"me","peer":"pc"}}' pnpm --filter @ledge/relay dev
curl -s localhost:8787/healthz   # ok
```

- `PORT` (default `8787`).
- `LEDGE_RELAY_DEV_TOKENS`: JSON `{ "<token>": { "accountId": "...", "peer": "pc" | "d_<id>" } }`. The daemon presents the token as `Authorization: Bearer <token>`, a browser as the websocket subprotocol `ledge-relay.<token>`.

Static tokens: never deploy this mode.

## Create the GitHub OAuth App

GitHub, Settings, Developer settings, OAuth Apps, New OAuth App:

- Authorization callback URL: `<LEDGE_RELAY_PUBLIC_URL>/auth/github/callback`.
- Tick "Enable Device Flow" (the PC signs in with it).
- No permission is needed: the relay asks for an empty scope and only reads the user's id and login.

Generate a client secret and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

## Run locally with Docker Postgres

```sh
docker run --name ledge-pg -e POSTGRES_PASSWORD=ledge -p 5432:5432 -d postgres:16
pnpm --filter @ledge/relay build
DATABASE_URL=postgres://postgres:ledge@localhost:5432/postgres \
GITHUB_CLIENT_ID=<id> GITHUB_CLIENT_SECRET=<secret> \
LEDGE_RELAY_ALLOWED_GITHUB_IDS=<your numeric id> \
LEDGE_RELAY_PUBLIC_URL=http://localhost:8787 \
node apps/relay/dist/main.js
curl -s localhost:8787/healthz   # ok
```

For a local callback, register `http://localhost:8787/auth/github/callback` in the OAuth App.

## Deploy on Railway

- Create the service from the repository root (not `apps/relay`), and set its config file to `apps/relay/railway.json`. It builds with `pnpm install --frozen-lockfile && pnpm --filter @ledge/relay build`, starts `node apps/relay/dist/main.js`, checks `/healthz` and restarts on failure.
- Add the Railway Postgres plugin: it provides `DATABASE_URL`.
- Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `LEDGE_RELAY_ALLOWED_GITHUB_IDS`, `LEDGE_RELAY_PUBLIC_URL` (the https URL of the service) and `NODE_ENV=production`. Railway provides `PORT`.

## Allow-list

To let someone in, add their numeric GitHub id to `LEDGE_RELAY_ALLOWED_GITHUB_IDS`, then restart the service. Removing an id and restarting cuts that account: its sessions stay in the database but no longer authenticate. A login's id is at `https://api.github.com/users/<login>` (field `id`).

## Auth routes

| Route | Use |
| --- | --- |
| `POST /auth/device/start` | PC: starts GitHub's device flow; answers the user code and verification URL. |
| `POST /auth/device/poll` | PC: body `{ "deviceCode": "..." }`; answers `pending`, `slow_down`, `expired`, `denied`, `not_allowed` or `ok` with the session token. A new PC sign-in revokes the account's earlier PC sessions. |
| `GET /auth/github/start` | Phone: redirects to GitHub, with a `state` cookie. |
| `GET /auth/github/callback` | Phone: GitHub's return; sets the `HttpOnly` session cookie and redirects to `/?signin=<issue>`. |
| `GET /auth/me` | The current session: account id, login, peer and kind. |
| `POST /auth/logout` | Ends the current session. |

## Websocket close codes

| Code | Meaning |
| --- | --- |
| 4000 | Replaced: a newer connection of the same account and peer took over. |
| 4001 | Signed out: the session was revoked (logout, or a new PC sign-in). |
| 4008 | Limit: a rate or size limit was exceeded. |
