# packages/fleet — `@ledge/fleet`

The client of the Ledge daemons of several machines (the local one, others over SSH): connection, store, decisions,
launches, OpenRig, usage. React is a peer dependency.

## Commands

`pnpm --filter @ledge/fleet test` (jsdom), `typecheck`.

## Rules

- Desktop and the island both consume it: check a change in both, `pnpm --filter desktop test` and
  `pnpm --filter overlay test`.
- A remote daemon may be older or offline: never assume a machine answers, nor that it knows the newest message.
