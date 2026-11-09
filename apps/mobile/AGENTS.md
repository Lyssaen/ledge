# apps/mobile — `@ledge/mobile`

The phone and tablet PWA. It reaches the PC through `apps/relay`, end-to-end encrypted with `@ledge/seal`.

## Commands

- `pnpm --filter @ledge/mobile dev`, `test`, `typecheck`, `build` (app, then the service worker from
  `vite.sw.config.ts`, then `scripts/fingerprint.mjs`).
- `pnpm --filter @ledge/mobile test:e2e`: Playwright on Chromium and WebKit (WebKit skipped when not installed).
- `pnpm --filter @ledge/mobile serve:local` serves the e2e harness.

## Rules

- `@ledge/seal` is loaded lazily and only in a secure context (`src/start.tsx`): keep it out of the first bundle.
- Every French string lives in `src/copy.ts` (decision D13).
- The phone can be offline, asleep or behind on versions: every request to the PC has a timeout and a visible state.
- The build's fingerprint is what a user checks against the release notes: a change to the build output changes it.
