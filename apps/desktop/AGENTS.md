# apps/desktop — `desktop`

Ledge Desktop, the Windows app: home, atelier, IDE workspace, settings, tray, updater. Tauri 2 (`src-tauri/`, built on
`crates/ledge-native`) around React 19, Vite 6, Tailwind 4 and xterm. It also hosts the notch window, which shows the
island built from `apps/overlay`.

## Commands

- `pnpm --filter desktop dev`: the UI in a browser on port 1421, against the real WSL daemon.
- `pnpm --filter desktop test` (vitest), `typecheck`, `build` (also builds and copies the notch).
- `pnpm --filter desktop test:e2e`: Playwright on Chromium, the daemon mocked with `routeWebSocket`; each worktree gets
  its own port (`scripts/e2e-port.ts`, `LEDGE_E2E_PORT` to force one).
- Screenshots: `LEDGE_SCREENSHOTS=1 pnpm --filter desktop exec playwright test e2e/screenshots.spec.ts` (into
  `docs/screens/`).
- `pnpm --filter desktop tauri dev|build`: Windows only.

## Rules

- Every screen change follows an owner-approved mockup in `docs/mockups/`. The IDE redesign (`docs/ide-workspace*.md`)
  is the target: an ambiguous request about a screen means the IDE workspace, not the older screens.
- Strings go in `src/i18n/{fr,en}.ts`.
- Before saying a screen is done: zoomed Playwright screenshots of it, alignment and spacing checked, light and dark.
- Native code (`src-tauri/src/*.rs`) cannot be built from WSL: say what was not checked.
