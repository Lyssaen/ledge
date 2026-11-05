# Harness usage: account limits, model, effort, duration (back end)

Date: 2026-11-05. Status: in review. Mockup: `docs/mockups/ledge-harness-usage.html` v2, variant B, validated by the user
(decisions K1-K4, M0-M10, N1, N2). Contract: `packages/protocol/src/usage.ts`.

## What the daemon of each machine sends

`usage.state` after every snapshot and on each change: per harness, an opaque account id, a state (`ok`, `loading`, `stale`,
`unreachable`, `expired`), when it was last read, and its windows (the 5 hours, the week, one per model); the alerts past the
threshold and at 100 % (one per window and per reset, born `at`, put away by `usage.ack` until the window resets); the
threshold (`usage.set`, 50-95 %, 80 % by default). `DaemonInfo.usage` says it can. The phone gets the harnesses without the
account. A front sends `usage.set` and `usage.ack` to every machine it means.

## Claude Code

- Anthropic's usage API, with the token Claude Code keeps (`~/.claude/.credentials.json`, or `CLAUDE_CODE_OAUTH_TOKEN`):
  read only, never refreshed, never written. Past its time, or refused (401): `expired`, « sign in again in Claude Code ».
- The account id is told only for the file's token (the one `~/.claude.json` goes with): an environment token may be another
  account's. Another account signing in drops the previous one's windows and refusal at once.
- At most a read every 2 minutes. After a 429 the wait doubles up to 15 minutes, or is the API's Retry-After when longer.
- **Retry-After is waited at most a day** (decided 2026-11-05 by the lead: a technical guard, not a screen choice). A longer
  value is taken as a possibly mistaken header: Ledge tries again after a day rather than leave the limits unreadable for
  good. One try a day is negligible for the API. Code: `RETRY_AFTER_MAX_MS` in `daemon/usage/service.ts`.
- Claude Code's real version goes in the User-Agent (`claude --version`), never an invented one: without it the API answers
  about once an hour.
- Through the corporate proxy of the login shell: CONNECT tunnel, `no_proxy`, `NODE_EXTRA_CA_CERTS` (`daemon/usage/net.ts`).
- Values read more than an hour ago are never sent; past 5 minutes without a read they are `stale`.

## Codex

The limits its transcripts report (`token_count.rate_limits`), dated: the newest reading wins, an empty one included. A plan
that gives none: no Codex at all. No account id (no `auth.json` read): one group per machine (N2).

## Sessions

The model and effort from the transcript when Ledge did not choose them at launch (Claude Code `message.model` and `effort`,
Codex `turn_context`): `modelFrom` / `effortFrom` `transcript` (N1: shown). A launch's choice is never replaced. `startedSeen`:
the duration counts from when Ledge saw the session (a first hook other than SessionStart, a seat found).

## Out of this slice

The screens (dev-front). Cursor and OMP limits. A Claude Code status line (K2: not touched).
