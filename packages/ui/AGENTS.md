# packages/ui — `@ledge/ui`

Shared React UI: the mascots (`src/bots/Bot.tsx`), reply parsing, Markdown documents, chat cards, themes, sounds and
i18n (`src/i18n/{lang,copy}.tsx`), used by Desktop, the island and the phone app.

## Commands

- `pnpm --filter @ledge/ui test` (jsdom, with `VITE_LEDGE_MOTION=0`), `typecheck`.
- `pnpm --filter @ledge/ui dev:mascots` opens the mascots page in a browser.

## Rules

- Exports are explicit subpaths in `package.json`: a new module is added to `exports`.
- A visible change here shows on several screens: the mockup rule of the root `AGENTS.md` applies, and each consumer is
  checked.
