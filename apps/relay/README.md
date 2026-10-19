# @ledge/relay

Relay between phones and a PC. It routes opaque end-to-end-encrypted bodies and never decrypts them; nothing is stored or logged.

## Run locally

```sh
LEDGE_RELAY_DEV_TOKENS='{"tok-pc-0123456789abcdef":{"accountId":"me","peer":"pc"}}' pnpm --filter @ledge/relay dev
curl -s localhost:8787/healthz   # ok
```

- `PORT` (default `8787`).
- `LEDGE_RELAY_DEV_TOKENS`: JSON `{ "<token>": { "accountId": "...", "peer": "pc" | "d_<id>" } }`. The daemon presents the token as `Authorization: Bearer <token>`, a browser as the websocket subprotocol `ledge-relay.<token>`. Websocket path: `/ws`.
- The relay refuses to start when `NODE_ENV=production` or the variable is missing.

## Not ready for production

Dev tokens are static. Still to come before it can be deployed: GitHub accounts (lot 2) and the deployment itself (lot 7 of the roadmap).
