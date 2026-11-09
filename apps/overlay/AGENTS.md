# apps/overlay — `overlay`

The island: a pill on the top edge of the screen that opens into the session list, a session's view and a read-only
Ask Ledge chat. It has no native shell of its own: Desktop builds it into its notch window.

## Commands

- `pnpm --filter overlay dev` (port 1420). Against a fake daemon: `pnpm --filter overlay exec tsx test/devMock.ts`.
  Against the real one: `VITE_LEDGE_TOKEN=$(cat ~/.ledge/token) pnpm --filter overlay dev`.
- `pnpm --filter overlay test` (jsdom), `typecheck`, `test:e2e` (Playwright).

## Rules

- `src/surface/` is a pure state machine plus its views: logic goes in the machine, where it is tested without a DOM.
- Every Tauri `invoke` goes through `src/tauri/bridge.ts`, which does nothing in a browser; never import the Tauri API
  elsewhere.
- Strings live in the typed catalogue `src/i18n/` (French first, English); the type checker requires the same keys in
  both.
- The README's first-build checklist on Windows applies to anything touching the notch window.
