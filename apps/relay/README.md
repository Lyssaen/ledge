# @paradow/ledge-relay

Relay between phones and a PC. It routes opaque end-to-end-encrypted bodies and never decrypts them; no content is stored or logged. Websocket path: `/ws`; health check: `GET /healthz` answers `ok`.

## Run your own relay

The relay can run on your own server, with no database to install: `ledge-relay launch` keeps everything in one data directory.

1. **Requirements.** Node 22 or later, a domain name, and an HTTPS reverse proxy in front of the relay (the relay speaks plain HTTP and listens on `127.0.0.1` by default).
2. **Install.**

   ```sh
   npm i -g @paradow/ledge-relay
   ```

3. **Launch.**

   ```sh
   ledge-relay launch
   ```

   The first time, it asks in the terminal and saves the answers in `config.json`:
   - the public URL of the relay (`https`, no path), for example `https://relay.example.com`;
   - the GitHub OAuth App values. It prints them for you: create the App in GitHub, Settings, Developer settings, OAuth Apps, with Homepage URL `<public URL>`, Authorization callback URL `<public URL>/auth/github/callback`, and "Enable Device Flow" ticked (no permission is needed). Then it asks for the App's client id and client secret;
   - the GitHub login (or numeric id) allowed to use the relay;
   - a contact for Web Push (an email address, a `mailto:` address or an `https://` URL).

   It generates the Web Push keys itself, then starts the relay. The next launches ask nothing. Without a terminal (a service), it never asks: it exits with `missing settings: ...` unless the settings are in `config.json` or in the environment variables below.
4. **HTTPS proxy.** Any proxy works; with Caddy, which gets the certificate by itself:

   ```
   relay.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```

5. **Keep it running with systemd.** Create a dedicated user and its data directory, answer the questions once as that user, then install the service:

   ```sh
   sudo useradd --system --no-create-home ledge-relay
   sudo install -d -m 0700 -o ledge-relay /var/lib/ledge-relay
   sudo -u ledge-relay "$(command -v ledge-relay)" launch --data /var/lib/ledge-relay
   ```

   Stop that first run with Ctrl-C, then write `/etc/systemd/system/ledge-relay.service`. `ExecStart` takes the absolute path `command -v ledge-relay` printed (typically `/usr/bin/ledge-relay` or `/usr/local/bin/ledge-relay`):

   ```ini
   [Unit]
   Description=Ledge relay
   Wants=network-online.target
   After=network-online.target

   [Service]
   ExecStart=/usr/local/bin/ledge-relay launch --data /var/lib/ledge-relay
   StateDirectory=ledge-relay
   Restart=on-failure
   RestartSec=5
   User=ledge-relay

   [Install]
   WantedBy=multi-user.target
   ```

   Then `systemctl enable --now ledge-relay`. `StateDirectory=` makes systemd create `/var/lib/ledge-relay` for the user if it is missing. `ledge-relay` starts through `/usr/bin/env node`: when Node comes from nvm, add an `Environment=PATH=<node's bin directory>:/usr/bin:/bin` line to `[Service]`.
6. **In Ledge Desktop.** Settings, Mobile access (in French, Réglages › Accès mobile): enter the relay address (your public URL), then sign in with GitHub. On the phone, open the same address.

### Data directory and options

The data directory is `--data <dir>`, else the `LEDGE_RELAY_HOME` environment variable, else `~/.ledge-relay`. It is created with mode `0700` and holds:

- `config.json` (mode `0600`): `publicUrl`, `githubClientId`, `githubClientSecret`, `allowedGithubIds`, `vapid`. It contains secrets: keep it private.
- `db/`: the embedded database (pglite) with accounts, sessions, linked phones and push subscriptions. Set `DATABASE_URL` to use Postgres instead.

The environment variables of the sections below override `config.json`.

| Option | Meaning |
| --- | --- |
| `--port <port>` | Port to listen on (default `8787`, or `PORT`). |
| `--host <host>` | Address to listen on (default `127.0.0.1`). |
| `--data <dir>` | The data directory. |
| `--setup` | Ask the questions again, with the saved answers as defaults (needs a terminal). |

`ledge-relay --version` prints the version. `launch` always applies the production rules: an `https` public URL, the phone app present, Web Push keys present. If `config.json` is not valid, it exits naming the file and leaves it untouched; fix it or run `ledge-relay launch --setup`.

### Letting someone else in

Edit `allowedGithubIds` in `config.json` (numeric GitHub ids, as strings), then restart the relay. A login's id is at `https://api.github.com/users/<login>` (field `id`). Removing an id and restarting cuts that account.

### If the database cannot be opened after an upgrade

The relay exits with `cannot open the embedded database at <data>/db`, and never touches that directory itself. To start afresh, stop the relay and move `<data>/db` aside (rename it), then launch again. A fresh database loses the accounts, sessions, linked phones and push subscriptions: each phone must sign in and link again. `config.json` is kept.

### Publishing (owner)

Do these three steps, in this order, before the next release tag. Otherwise the `npm` job of the release fails at the relay publish (no Trusted Publisher yet) and blocks the production deploy.

1. Choose the licence: set `license` in `apps/relay/package.json` (it is `UNLICENSED`, and while it is, the release publishes nothing and only runs `npm pack --dry-run`), and add the `LICENSE` file.
2. Publish once by hand, from a checkout, after building the phone app, the relay and its copy:

   ```sh
   pnpm --filter @ledge/mobile build
   pnpm --filter @paradow/ledge-relay build
   pnpm --filter @paradow/ledge-relay pack:web
   cd apps/relay && npm publish --access public
   ```

3. On npmjs.com, in the package's settings, add a Trusted Publisher: this repository, workflow `release.yml`.

From then on, every release publishes the relay with its phone build (`.github/workflows/release.yml`).

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
| `LEDGE_RELAY_WEB_DIR` | Directory of the built phone app (`@ledge/mobile`), served as static files. Required in production, where it must hold `index.html`, `sw.js`, `build.json` and `manifest.webmanifest`. |
| `LEDGE_RELAY_VAPID_PUBLIC_KEY`, `LEDGE_RELAY_VAPID_PRIVATE_KEY`, `LEDGE_RELAY_VAPID_SUBJECT` | Web Push identity: an uncompressed P-256 point and a 32-byte scalar (base64url), and a `mailto:` or `https:` contact. Required in production; elsewhere all three or none. |
| `PORT` | Default `8787`. |
| `LEDGE_RELAY_GITHUB_WEB_URL`, `LEDGE_RELAY_GITHUB_API_URL` | Point GitHub calls at another server (tests). Refused in production. |

In production, every missing required variable is reported at once (`missing in production: ...`). A configuration error is printed on stderr, naming the variable and never its value, and the process exits with code 1.

### Dev mode

```sh
LEDGE_RELAY_DEV_TOKENS='{"tok-pc-0123456789abcdef":{"accountId":"me","peer":"pc"}}' pnpm --filter @paradow/ledge-relay dev
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
pnpm --filter @paradow/ledge-relay build
DATABASE_URL=postgres://postgres:ledge@localhost:5432/postgres \
GITHUB_CLIENT_ID=<id> GITHUB_CLIENT_SECRET=<secret> \
LEDGE_RELAY_ALLOWED_GITHUB_IDS=<your numeric id> \
LEDGE_RELAY_PUBLIC_URL=http://localhost:8787 \
node apps/relay/dist/main.js
curl -s localhost:8787/healthz   # ok
```

For a local callback, register `http://localhost:8787/auth/github/callback` in the OAuth App.

## Deploy on Railway

Production runbook: one Docker image (`apps/relay/Dockerfile`, build context = the repository root) holds the relay and the built phone app, served at `https://app.kl-ledge.dev`. Run exactly one replica: the socket routing hub lives in memory.

1. **VAPID keys.** `pnpm --filter @paradow/ledge-relay vapid-keys <contact email>` prints three lines (from a checkout without `pnpm install`, `node apps/relay/scripts/vapid-keys.mjs <contact email>` works too: it only imports `node:crypto`). They go into Railway variables only, never into the repository.
2. **GitHub OAuth App.** Homepage URL `https://app.kl-ledge.dev`, Authorization callback URL `https://app.kl-ledge.dev/auth/github/callback`, tick "Enable Device Flow", then generate a client secret.
3. **Railway project.** Hobby plan, region `europe-west4`. Create the service from the repository root (not `apps/relay`) and set its config file to `apps/relay/railway.json` (Dockerfile build, one replica, `/healthz` check, restart on failure). Add a Postgres. Once step 6 has created the branch `production`, point the service at it, with auto-deploy.
4. **Service variables.**

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference, private network). |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | From the OAuth App. |
   | `LEDGE_RELAY_ALLOWED_GITHUB_IDS` | Numeric ids, comma-separated (`https://api.github.com/users/<login>`, field `id`). |
   | `LEDGE_RELAY_PUBLIC_URL` | `https://app.kl-ledge.dev`, no trailing slash. |
   | `LEDGE_RELAY_VAPID_PUBLIC_KEY` | 87 base64url characters. |
   | `LEDGE_RELAY_VAPID_PRIVATE_KEY` | 43 base64url characters. |
   | `LEDGE_RELAY_VAPID_SUBJECT` | `mailto:<contact>`. |

   `NODE_ENV`, `LEDGE_RELAY_WEB_DIR` and `PORT` are not set: the image sets the first two, Railway provides `PORT`.
5. **Domain.** In the service, Settings, Networking, Custom Domain: `app.kl-ledge.dev`. Create the DNS record Railway shows (CNAME `app` to the target it gives, plus a TXT verification record if asked) wherever the DNS of `kl-ledge.dev` is served: in Railway itself when the domain was bought through Railway; behind Cloudflare the record is "DNS only". Wait for the certificate.
6. **Deploying a release.** Deploy only release commits, and only ones whose `packages/ledge/package.json` already carries the tag's version (the `chore: X.Y.Z` commit that precedes the tag). The service worker and `build.json` embed that version and the release workflow stamps it from the tag, so otherwise the served fingerprint differs from the release's. The first deploy is the first release tagged after lot 7 is merged: earlier tags have neither the Dockerfile nor a published `ledge-mobile-build.json`. Push that release commit to `production` first (this creates the branch), then select it in Railway (step 3). Advance the branch with:

   ```sh
   git push origin vX.Y.Z^{commit}:refs/heads/production
   ```

   The Release workflow does this itself (job `production`) once the daemon is on npm and the installer and `ledge-mobile-build.json` are on the release: fast-forward only, and only when the tagged commit carries the tag's version. It pushes with the repository secret `PRODUCTION_PUSH_TOKEN`: a fine-grained personal access token on this repository only, with Contents and Workflows read and write (the workflow's own token may not push a change under `.github/workflows`). By hand only for the first deploy or after that job failed.
7. **After a deploy, check.**
   - `https://app.kl-ledge.dev/healthz` answers `ok`.
   - The logs show `{"ev":"listening",…,"mode":"accounts"}`.
   - `https://app.kl-ledge.dev/build.json` is identical to the release asset `ledge-mobile-build.json`. Use curl, a browser may be answered by the service worker: `diff <(curl -s https://app.kl-ledge.dev/build.json) <(gh release download vX.Y.Z -p ledge-mobile-build.json -O -)` prints nothing when they match.
8. **When it fails.** A missing or mistyped variable: the process exits 1 with one line naming the missing variables (never their values); the healthcheck fails and Railway keeps the previous deployment. A database not ready yet: exit 1 with `ledge-relay: cannot start: the database is unreachable…`, then Railway restarts it.

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
