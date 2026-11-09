# packages/protocol — `@ledge/protocol`

The zod schemas every part of Ledge speaks: sessions and their events, `ServerMessage`/`ClientMessage`,
`PROTOCOL_PORT`, chat, tasks, OpenRig, the phone. Nothing else defines a message shape.

## Commands

`pnpm --filter @ledge/protocol test`, `typecheck`. No build: consumers import `src/*.ts`.

## Rules

- Parts of different versions talk to each other: Desktop on Windows, the daemon in WSL, a phone, another machine's
  daemon. A new field is optional or has a default, and a reader tolerates values it does not know yet; never rename
  or remove a field in one step.
- A schema change is checked where it is consumed: `pnpm --filter @paradow/ledge test` and the apps that use the
  message (`desktop`, `overlay`, `@ledge/mobile`, `@ledge/fleet`).
