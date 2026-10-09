# Ledge

A living handle on the left edge of your Windows screen that follows every agentic session running in WSL2 (Claude Code, Codex, Cursor Agent), shows which ones are waiting for you, and lets you answer or approve without hunting for the right terminal tab.

- Design spec: [docs/superpowers/specs/2026-10-09-ledge-design.md](docs/superpowers/specs/2026-10-09-ledge-design.md)
- Design canvas (mockups and playable prototype): https://claude.ai/artifact/57oDjsKdabQBmPgAXn15mc
- Design system "Shadcn Red": https://claude.ai/artifact/QBv4bfYYVqV2aAfDjPW3JV
- Initial mascot exploration: [docs/mockups/mascots.html](docs/mockups/mascots.html) — historical comparison of three directions; the selected design is documented below.
- **Approved interactive design (revision 2):** [navigable prototype](docs/mockups/ledge-prototype.html) (keep its adjacent `prototype/` folder), or [standalone HTML](docs/mockups/ledge-prototype-standalone.html) requiring no server. Twelve scenarios, **Signal in dark mode / Galet in light mode**, with subdued motion and accessible keyboard navigation. Sessions and outcomes in the prototype are simulated.
- Revised implementation plans: [WSL core](docs/superpowers/plans/2026-10-09-ledge-core-wsl.md), [overlay and mascots](docs/superpowers/plans/2026-10-09-ledge-overlay.md), [adapters and rich screens](docs/superpowers/plans/2026-10-09-ledge-adapters-and-screens.md). Design is approved; production implementation remains to be done.

Personal project. Windows host + WSL2 only.

## Packages

- `packages/protocol`: zod schemas shared by the daemon, the CLI and the overlay.
- `packages/ledge`: the `ledge` CLI (launcher, daemon, hook receiver). See `packages/ledge/README.md`.
- `apps/overlay`: the Windows overlay (next plan).
