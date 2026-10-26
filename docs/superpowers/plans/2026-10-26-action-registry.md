# Action registry Implementation Plan

**Goal:** one registry of the actions Ledge's chat may propose (#94), from which the persona, the daemon's validation
and the cards are derived; the generic `ledge-action` block; the coverage of spec §6.1; the base #93's CLI sits on.

**Spec:** [2026-10-26-action-registry-design.md](../specs/2026-10-26-action-registry-design.md). Tasks marked **(§9)**
wait for the user's decision on that point; the others do not depend on it.

**Architecture:** `packages/protocol/src/actions.ts` (pure data + Zod, shared with the fronts and the CLI);
`packages/ledge/src/daemon/actions.ts` (resolve against the live state, map to the existing `ClientMessage`);
`packages/ledge/src/chat/persona.ts` (generated persona); `packages/ledge/src/chat/act.ts` (apply a generic card's rows,
as `close.ts` does). The six legacy cards keep their turn fields and fronts.

**Tech Stack:** TypeScript (ESM), Zod, vitest.

## Global Constraints

- Worktree `.worktrees/action-registry`, branch `feat/action-registry`; never main; no push.
- TDD per task: failing test, minimal code, passing test.
- Tests: `pnpm vitest run <file>` from the package; full gate `pnpm -r typecheck && pnpm test` from the root, plus lint.
- No front change in this plan except what the protocol forces to compile (fleet's `chat.done` copy, the phone's turn
  schema). The generic card is Bix's, from spec §5.

## Tasks

### Task 1 — the registry (protocol)
- Test `packages/protocol/test/actions.test.ts`: ids unique; every `example` parses against `args`; `max` ≤ 8;
  `risk` is a value or a function returning one; `actionById`.
- `packages/protocol/src/actions.ts`: `ActionRiskSchema`, `ActionDef`, `ACTIONS` with the 19 entries of §6.1
  (summary, when, example, risk, max, card, phone, cli), `actionById`; export from `index.ts`.

### Task 2 — the `ledge-action` block and the normalisation of the old fences
- Tests in `proposal.test.ts`: `ledge-action` extracted, hidden while streaming (`hideProposal` with a partial fence);
  each old fence → `{action, args}` with the id of spec §3.1; an unknown action and bad args → `null`.
- `proposal.ts`: fence `action`, `ActionBlockSchema`, `parseActionBlock(kind, raw)` returning `{action, args}` or null.

### Task 3 — `ChatAction` and `chat.act` in the protocol
- Tests: `ChatActionSchema` bounds; `ChatTurn.actions` 1..8; `chat.act` rows unique and `confirmed` literal;
  `chat.acted`; phone `chat.act` and `ConfirmPurpose` `act`; `PhoneChatActionSchema` without `args`.
- `chat.ts`, `messages.ts`, `phone.ts`; fleet's `chat.done` copy of `actions` (+ its test).

### Task 4 — daemon resolvers (`daemon/actions.ts`)
- Tests `daemon-actions.test.ts`, per action: name → id, ambiguous name refused, unknown / read-only / exited refused
  where the handler would refuse, `session.model` model and effort checks, `team.save` seats from the live team,
  `summary` text.
- `ActionImpl` per generic action: `resolve(args, ctx)` and `toClient(row)`.

### Task 5 — the six validators behind the registry
- Tests: `chat-service.test.ts` keeps passing untouched (old fences), and the same cases written as `ledge-action`
  give the same cards.
- `service.ts`: blocks normalised; dispatch by `card`; `proposalFrom`… become the `resolve` of their entries (moved,
  not rewritten); generic rows into `turn.actions`, capped per `max` and 8 in all; `chat.done` carries `actions`.

### Task 6 — apply a generic card (`chat/act.ts`, `server.ts`)
- Tests `chat-act.test.ts`: in order, stop at the first failure, done rows passed over, in-flight rows passed over,
  `confirm_required` without `confirmed` on a destructive row, re-resolve fails a row whose target changed, the
  handler's `error` becomes the row's error; `chat.history` after each row.
- `actFromChat(deps, qid, rows, confirmed)`; `Chat.action(qid,row)` / `markAction`; `server.ts` `chat.act` →
  `handle(toClient(row), capture)`, `chat.acted` to the requester.

### Task 7 — tasks: `cancel`, and `pass` by Ledge
- Tests `daemon-tasks.test.ts`: cancel by giver / by Ledge / refused for others / refused when closed; owner told;
  pass by Ledge of a task it did not give.
- `TaskCmdSchema` op `cancel`; `daemon/tasks.ts`.

### Task 8 — the generated persona
- Tests `chat-persona.test.ts`: per tool, the harness line (claude/omp never mention a shell; codex says read-only
  shell); every registry id and example JSON present; the never-proposed list present; length bound.
- `chat/persona.ts` `buildPersona(tool)`; `PERSONA` = `buildPersona('claude')`; claude/omp/codex/cursor pass
  `buildPersona(tool)`; `chat-claude.test.ts` stops freezing the text (asserts the flag carries the built persona).

### Task 9 — `session.decide` from the chat **(§9.1)**
- Tests: `resolve` snapshots `expect` with `pendingKey`, `detail` verbatim, `always` impossible, note only where
  offered, OMP refused, accept destructive / deny reversible; stale request refused at apply.
- Entry and resolver enabled (behind the decision; left out of `ACTIONS` until then).

### Task 10 — persona as a system instruction for Codex and Cursor **(§9.3)**
- Tests: `codexArgs` carries `-c developer_instructions=…` (TOML-escaped) and stdin is the question alone; cursor
  writes `AGENTS.md` in the context folder and stdin is the question alone; fallback flag keeps stdin.
- Manual probe against the installed `codex` and `cursor-agent`, result written in the task's report.

### Task 11 — gate and hand-off
- `pnpm -r typecheck && pnpm test`, lint, build; `ledge task done` with branch, commits, results; Lu reviews; Bix gets
  spec §5 for the cards; #93 starts from §2.1.
