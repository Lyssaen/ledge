# Plan: the terminal's mouse wheel (spec `2026-11-17-terminal-wheel.md`)

Branch `feat/terminal-wheel`, one worktree. Each step is test first, then code, then the project's tests.

1. **B, daemon coalescing** (`packages/ledge`)
   - Test in `test/pane-stream.test.ts`: three inputs sent at once are one `send-keys` with all their bytes, in order;
     an input arriving while a `send-keys` waits for tmux is typed in the next one.
   - `src/term/pane.ts`: `drain` chains one turn that takes `w.queued` whole when it runs.
   - `pnpm --filter @paradow/ledge test`, `typecheck`.
2. **A, wheel module** (`apps/desktop`)
   - Tests in `test/term-wheel.test.ts` for `wheelLines` and `wheelReport`.
   - `src/term/wheel.ts`: the two pure functions.
3. **A, surface** (`apps/desktop`)
   - Tests in `test/term-surface.test.ts` (the fake gets `attachCustomWheelEventHandler`): reports written in one input
     while tracked, SGR after `?1006h`, default after `?1006l`, xterm's own path when not tracked, read-only, or Shift.
   - `src/term/surface.ts`: the encoding followed through CSI handlers, the wheel handler, both inside `make()` so an
     adopted xterm has them.
   - `pnpm --filter desktop test`, `typecheck`.
4. **Review and finish**: a code review of the diff, `pnpm test` and `pnpm typecheck` on everything, a commit on the
   branch. Push and PR only on the owner's go.
