# Ledge core (WSL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WSL side of Ledge end to end for Claude Code: a typed protocol, a daemon that is the single source of truth, a launcher that wraps an agent in a dedicated tmux server, the Claude Code adapter with verified key injection, and the hook receiver, verifiable from the command line with `ledge status` before any overlay exists.

**Architecture:** One pnpm monorepo. `packages/protocol` holds the zod schemas every side shares. `packages/ledge` is the `ledge` CLI with three modes (`daemon`, `hook`, `<agent>` launcher) plus `setup` and `status`. The daemon keeps sessions in memory, journals them to `~/.ledge/sessions.json`, serves one WebSocket on `127.0.0.1:47831`, polls tmux panes once a second, and applies every change through a pure reducer with an exhaustive transition table. Adapters translate tool-specific prompts and hooks into reducer events and decisions into verified key sequences.

**Tech Stack:** Node 22+ (24 installed), TypeScript 5 strict, pnpm 11 workspaces, Vitest 2, `ws` 8, `zod` 3, `tsx` for dev, `tsup` for the CLI bundle, tmux 3.6 (`-L ledge`), no framework for the CLI (hand-rolled argv parsing).

**Spec:** `docs/superpowers/specs/2026-10-09-ledge-design.md` (sections 3, 4, 8, 9, 10 drive this plan; the overlay (section 5, 6, 7) and the Codex and Cursor adapters are separate plans).

## Global Constraints

- Node 22 or newer; TypeScript strict; ESM only (`"type": "module"`).
- The daemon listens on `127.0.0.1:47831`, WebSocket only, JSON messages validated by schema in both directions.
- Every tmux call uses the dedicated server `tmux -L ledge -f ~/.ledge/tmux.conf`; session names are `ledge-<id>`; `LEDGE_SESSION=<id>` is set in the agent's environment.
- Files under `~/.ledge/`: `tmux.conf`, `sessions.json` (journal), `daemon.log`, `daemon.pid`.
- `ledge hook` always exits 0 and returns within 200 ms, daemon present or not.
- A hook-sourced `pending` is never replaced by a pane-sourced one. A pane match is ignored for 2 s after any hook event on the same session.
- After an injection the adapter re-reads the last 5 lines up to 3 times over 600 ms; if the prompt is still there the decision fails and nothing is re-sent.
- `exited` is terminal: `SessionEnd` and `PaneGone` clear `pending`. Exited sessions are removed 10 minutes after exit.
- `lastActivityAt` advances only when the pane content hash changes. Pane poll every 1 s; dead-pane check every 5 s.
- Bot names come from a fixed list of 64, never reused while a bot with that name is alive; `--name <n>` overrides.
- `ledge setup` appends to existing hook arrays in `~/.claude/settings.json`, never replaces them, and is idempotent (the user already has another tool's hooks on every event).
- Copy in logs and CLI output: sentence case, no emoji, product names "Claude Code", "Codex", "Cursor Agent".

## Review Focus

1. A hook for a session arrives before the launcher's `session.register` (the agent starts fast): the daemon must create a `hook_only` session, then upgrade it in place on register, never show two bots. Pinned in Task 7.
2. The agent prints a file that contains the line `Do you want to proceed?` while working: a pane match within 2 s of a hook event must be ignored, and never downgrade a hook-sourced pending. Pinned in Task 7.
3. A reply typed in the overlay contains `;`, a leading `-`, or a newline: `send-keys -l --` must pass it literally and send `Enter` as a separate key. Pinned in Task 4.
4. Port 47831 is already taken by a live Ledge daemon (the launcher must connect, not spawn a second) or by a foreign process (clear error, agent still launched untracked). Pinned in Task 9.
5. `~/.ledge/sessions.json` is corrupt or truncated: the daemon starts with an empty store, logs one line, and does not crash. Pinned in Task 6.

---

## File structure

```
pnpm-workspace.yaml
package.json                      # workspace root: scripts test/build/lint
tsconfig.base.json
packages/protocol/
  package.json
  src/index.ts                    # re-exports
  src/session.ts                  # Session, SessionState, Pending, Helper schemas + types
  src/messages.ts                 # daemon→client, client→daemon, launcher/hook→daemon message schemas
  test/messages.test.ts
packages/ledge/
  package.json                    # bin: ledge
  tsconfig.json
  src/cli/index.ts                # argv dispatch: daemon | hook | setup | status | <agent>
  src/cli/launch.ts               # ledge <agent>: ensure daemon, tmux session, register, attach
  src/cli/hook.ts                 # ledge hook <Event>: stdin JSON → event → daemon, exit 0
  src/cli/setup.ts                # merge hooks into ~/.claude/settings.json, write tmux.conf
  src/cli/status.ts               # print sessions from a snapshot
  src/client.ts                   # tiny WebSocket client used by launch, hook, status
  src/paths.ts                    # ~/.ledge paths, ensureDir
  src/names.ts                    # 64 names + allocator
  src/tmux.ts                     # Tmux interface + real implementation (-L ledge)
  src/log.ts                      # append-only daemon.log
  src/daemon/state.ts             # Session reducer: reduce(session, event)
  src/daemon/store.ts             # in-memory map + journal persistence + listeners
  src/daemon/server.ts            # WebSocket server: snapshot, broadcast, commands
  src/daemon/poller.ts            # pane polling, hashing, PaneGone, retire
  src/daemon/index.ts             # startDaemon(opts): wires store, server, poller, adapters
  src/adapters/types.ts           # Adapter interface
  src/adapters/verify.ts          # verifyGone(capture, pattern) 3× over 600ms
  src/adapters/claude.ts          # Claude Code adapter
  src/adapters/index.ts           # adapterFor(tool)
  test/fixtures/panes/claude-permission.txt
  test/fixtures/panes/claude-question.txt
  test/fixtures/panes/claude-working.txt
  test/fixtures/panes/claude-trap-file-contents.txt
  test/fake-agent.mjs             # scripted TUI stand-in for integration tests
  test/*.test.ts
```

---

### Task 1: Monorepo scaffold and shared protocol schemas

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.npmrc`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/src/index.ts`, `packages/protocol/src/session.ts`, `packages/protocol/src/messages.ts`
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces: `SessionSchema`, `Session`, `SessionState`, `PendingSchema`, `Pending`, `HelperSchema`; `ServerMessageSchema`/`ServerMessage` (`snapshot`, `session.updated`, `session.removed`, `session.preview`); `ClientMessageSchema`/`ClientMessage` (`session.reply`, `session.decide`, `session.focus`, `session.kill`, `session.interrupt`, `session.register`, `session.event`, `session.unregister`); `parseClientMessage(raw: unknown): ClientMessage` (throws `ZodError`); `PROTOCOL_PORT = 47831`.

- [ ] **Step 1: Create the workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`package.json` (root):
```json
{
  "name": "ledge-workspace",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node"]
  }
}
```

`.npmrc`:
```
auto-install-peers=true
```

`packages/protocol/package.json`:
```json
{
  "name": "@ledge/protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "@types/node": "^22.7.0" }
}
```

`packages/protocol/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Write the failing test**

`packages/protocol/test/messages.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseClientMessage, ServerMessageSchema, SessionSchema, PROTOCOL_PORT } from '../src/index.js';

const session = {
  id: '7f3a', name: 'Otto', tool: 'claude', cwd: '/home/u/Workspace/harness-assistant',
  project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: 'ledge-7f3a',
  state: 'waiting_permission',
  pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' },
  helpers: [], startedAt: '2026-10-09T18:00:00.000Z', lastActivityAt: '2026-10-09T18:01:00.000Z',
  source: 'launcher'
};

describe('protocol', () => {
  it('exposes the port', () => { expect(PROTOCOL_PORT).toBe(47831); });

  it('accepts a full session', () => {
    expect(SessionSchema.parse(session)).toEqual(session);
  });

  it('rejects an unknown state', () => {
    expect(() => SessionSchema.parse({ ...session, state: 'sleeping' })).toThrow();
  });

  it('parses every client message kind', () => {
    const msgs = [
      { type: 'session.reply', id: '7f3a', text: 'go ahead' },
      { type: 'session.decide', id: '7f3a', decision: 'accept' },
      { type: 'session.focus', id: '7f3a' },
      { type: 'session.kill', id: '7f3a' },
      { type: 'session.interrupt', id: '7f3a' },
      { type: 'session.register', session },
      { type: 'session.event', id: '7f3a', event: { name: 'Stop', at: '2026-10-09T18:02:00.000Z', source: 'hook' } },
      { type: 'session.unregister', id: '7f3a', exitCode: 0 }
    ];
    for (const m of msgs) expect(parseClientMessage(m).type).toBe(m.type);
  });

  it('rejects a decision outside accept/deny', () => {
    expect(() => parseClientMessage({ type: 'session.decide', id: 'x', decision: 'maybe' })).toThrow();
  });

  it('validates server messages', () => {
    expect(ServerMessageSchema.parse({ type: 'snapshot', sessions: [session] }).type).toBe('snapshot');
    expect(ServerMessageSchema.parse({ type: 'session.preview', id: '7f3a', lines: ['a', 'b'] }).type).toBe('session.preview');
    expect(ServerMessageSchema.parse({ type: 'session.removed', id: '7f3a' }).type).toBe('session.removed');
    expect(ServerMessageSchema.parse({ type: 'session.updated', session }).type).toBe('session.updated');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm install && pnpm --filter @ledge/protocol test`
Expected: FAIL, `Cannot find module '../src/index.js'`.

- [ ] **Step 4: Write the schemas**

`packages/protocol/src/session.ts`:
```ts
import { z } from 'zod';

export const ToolSchema = z.enum(['claude', 'codex', 'cursor']);
export type Tool = z.infer<typeof ToolSchema>;

export const SessionStateSchema = z.enum(['starting', 'working', 'waiting_input', 'waiting_permission', 'idle', 'exited', 'error']);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const PendingSchema = z.object({
  kind: z.enum(['question', 'permission', 'plan', 'diff']),
  text: z.string(),
  tool: z.string().optional(),
  options: z.array(z.string()).optional(),
  source: z.enum(['hook', 'pane'])
});
export type Pending = z.infer<typeof PendingSchema>;

export const HelperSchema = z.object({
  id: z.string(),
  kind: z.string(),
  task: z.string(),
  state: SessionStateSchema
});
export type Helper = z.infer<typeof HelperSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tool: ToolSchema,
  cwd: z.string(),
  project: z.string(),
  title: z.string(),
  tmuxSession: z.string().nullable(),
  state: SessionStateSchema,
  pending: PendingSchema.optional(),
  helpers: z.array(HelperSchema).default([]),
  startedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  exitCode: z.number().int().nullable().optional(),
  exitedAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  source: z.enum(['launcher', 'hook_only'])
});
export type Session = z.infer<typeof SessionSchema>;
```

`packages/protocol/src/messages.ts`:
```ts
import { z } from 'zod';
import { SessionSchema } from './session.js';

export const PROTOCOL_PORT = 47831;

export const SessionEventSchema = z.object({
  name: z.enum(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd', 'PaneChanged', 'PaneGone', 'PanePrompt', 'PaneIdle', 'InjectFailed', 'Decided']),
  at: z.string().datetime(),
  source: z.enum(['hook', 'pane', 'daemon']),
  tool: z.string().optional(),
  text: z.string().optional(),
  options: z.array(z.string()).optional(),
  kind: z.enum(['question', 'permission', 'plan', 'diff']).optional(),
  exitCode: z.number().int().nullable().optional(),
  helperId: z.string().optional()
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), sessions: z.array(SessionSchema) }),
  z.object({ type: z.literal('session.updated'), session: SessionSchema }),
  z.object({ type: z.literal('session.removed'), id: z.string() }),
  z.object({ type: z.literal('session.preview'), id: z.string(), lines: z.array(z.string()) }),
  z.object({ type: z.literal('error'), message: z.string(), id: z.string().optional() })
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.reply'), id: z.string(), text: z.string().min(1) }),
  z.object({ type: z.literal('session.decide'), id: z.string(), decision: z.enum(['accept', 'deny']) }),
  z.object({ type: z.literal('session.focus'), id: z.string() }),
  z.object({ type: z.literal('session.kill'), id: z.string() }),
  z.object({ type: z.literal('session.interrupt'), id: z.string() }),
  z.object({ type: z.literal('session.register'), session: SessionSchema }),
  z.object({ type: z.literal('session.event'), id: z.string(), event: SessionEventSchema }),
  z.object({ type: z.literal('session.unregister'), id: z.string(), exitCode: z.number().int().nullable() }),
  z.object({ type: z.literal('snapshot.request') })
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw);
}
export function parseServerMessage(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw);
}
```

`packages/protocol/src/index.ts`:
```ts
export * from './session.js';
export * from './messages.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @ledge/protocol test`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .npmrc pnpm-lock.yaml packages/protocol
git commit -m "feat(protocol): shared session and message schemas"
```

---

### Task 2: Session reducer with an exhaustive transition table

**Files:**
- Create: `packages/ledge/package.json`, `packages/ledge/tsconfig.json`, `packages/ledge/src/daemon/state.ts`
- Test: `packages/ledge/test/state.test.ts`

**Interfaces:**
- Consumes: `Session`, `SessionEvent`, `Pending` from `@ledge/protocol`.
- Produces: `reduce(session: Session, event: SessionEvent): Session` (pure, returns the same object when nothing changes); `HOOK_PRIORITY_MS = 2000`; `isPending(session): boolean`.

- [ ] **Step 1: Create the package**

`packages/ledge/package.json`:
```json
{
  "name": "ledge",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ledge": "./dist/cli/index.js" },
  "scripts": {
    "dev": "tsx src/cli/index.ts",
    "build": "tsup src/cli/index.ts --format esm --target node22 --out-dir dist/cli --clean",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ledge/protocol": "workspace:*",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@types/ws": "^8.5.12",
    "tsup": "^8.3.0"
  }
}
```

`packages/ledge/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Write the failing transition-table test**

`packages/ledge/test/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Session, SessionEvent, SessionState } from '@ledge/protocol';
import { reduce, HOOK_PRIORITY_MS } from '../src/daemon/state.js';

const T0 = '2026-10-09T18:00:00.000Z';
const later = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

function session(state: SessionState, extra: Partial<Session> = {}): Session {
  return {
    id: '7f3a', name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant',
    title: 'Otto · harness-assistant', tmuxSession: 'ledge-7f3a', state, helpers: [],
    startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
  };
}
const ev = (name: SessionEvent['name'], extra: Partial<SessionEvent> = {}): SessionEvent =>
  ({ name, at: later(5000), source: 'hook', ...extra });

const states: SessionState[] = ['starting', 'working', 'waiting_input', 'waiting_permission', 'idle', 'exited', 'error'];

describe('reduce: transition table', () => {
  // [event, from-state] -> expected next state ('=' keeps the state)
  const table: Array<[SessionEvent, SessionState, SessionState | '=']> = [];
  for (const s of states) {
    const terminal = s === 'exited';
    table.push([ev('SessionStart'), s, terminal ? '=' : 'working']);
    table.push([ev('UserPromptSubmit'), s, terminal ? '=' : 'working']);
    table.push([ev('PreToolUse', { tool: 'Bash' }), s, terminal ? '=' : 'working']);
    table.push([ev('PreToolUse', { tool: 'AskUserQuestion', text: 'Which one?', options: ['a', 'b'] }), s, terminal ? '=' : 'waiting_input']);
    table.push([ev('PreToolUse', { tool: 'ExitPlanMode', text: 'plan' }), s, terminal ? '=' : 'waiting_permission']);
    table.push([ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }), s, terminal ? '=' : 'waiting_permission']);
    table.push([ev('Notification', { kind: 'permission', text: 'Do you want to proceed?' }), s, terminal ? '=' : 'waiting_permission']);
    table.push([ev('Stop'), s, terminal ? '=' : 'idle']);
    table.push([ev('SessionEnd', { exitCode: 0 }), s, 'exited']);
    table.push([ev('PaneGone', { source: 'daemon' }), s, 'exited']);
    table.push([ev('InjectFailed', { source: 'daemon', text: 'prompt still visible' }), s, terminal ? '=' : 'error']);
    table.push([ev('Decided', { source: 'daemon' }), s, terminal ? '=' : 'working']);
  }
  for (const [event, from, to] of table) {
    it(`${event.name}${event.tool ? '(' + event.tool + ')' : ''} from ${from} -> ${to === '=' ? from : to}`, () => {
      const next = reduce(session(from), event);
      expect(next.state).toBe(to === '=' ? from : to);
    });
  }
});

describe('reduce: pending rules', () => {
  it('PermissionRequest sets a hook-sourced permission pending with the command text', () => {
    const next = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    expect(next.pending).toEqual({ kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' });
  });
  it('AskUserQuestion sets a question pending with options', () => {
    const next = reduce(session('working'), ev('PreToolUse', { tool: 'AskUserQuestion', text: 'Which one?', options: ['Backfill', 'Shadow'] }));
    expect(next.pending).toEqual({ kind: 'question', text: 'Which one?', options: ['Backfill', 'Shadow'], source: 'hook' });
  });
  it('ExitPlanMode sets a plan pending', () => {
    const next = reduce(session('working'), ev('PreToolUse', { tool: 'ExitPlanMode', text: 'Fix three findings' }));
    expect(next.pending?.kind).toBe('plan');
  });
  it('Edit permission sets a diff pending', () => {
    const next = reduce(session('working'), ev('PermissionRequest', { tool: 'Edit', text: 'src/daemon/state.ts' }));
    expect(next.pending?.kind).toBe('diff');
  });
  it('a pane prompt never replaces a hook-sourced pending', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    const next = reduce(s, ev('PanePrompt', { source: 'pane', kind: 'permission', text: 'Do you want to proceed?', at: later(9000) }));
    expect(next).toBe(s);
  });
  it('a pane prompt within HOOK_PRIORITY_MS of the last hook event is ignored', () => {
    const s = reduce(session('working'), ev('UserPromptSubmit', { at: later(5000) }));
    const next = reduce(s, ev('PanePrompt', { source: 'pane', kind: 'permission', text: 'Do you want to proceed?', at: later(5000 + HOOK_PRIORITY_MS - 1) }));
    expect(next).toBe(s);
  });
  it('a pane prompt after the window is accepted when nothing is pending', () => {
    const s = reduce(session('working'), ev('UserPromptSubmit', { at: later(5000) }));
    const next = reduce(s, ev('PanePrompt', { source: 'pane', kind: 'permission', text: 'Do you want to proceed?', at: later(5000 + HOOK_PRIORITY_MS + 1) }));
    expect(next.state).toBe('waiting_permission');
    expect(next.pending?.source).toBe('pane');
  });
  it('SessionEnd clears pending and records exit', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    const next = reduce(s, ev('SessionEnd', { exitCode: 1 }));
    expect(next.pending).toBeUndefined();
    expect(next.exitCode).toBe(1);
    expect(next.exitedAt).toBe(later(5000));
  });
  it('PaneGone clears pending with a null exit code', () => {
    const s = reduce(session('waiting_permission', { pending: { kind: 'permission', text: 'x', source: 'hook' } }));
    const next = reduce(s, ev('PaneGone', { source: 'daemon' }));
    expect(next.pending).toBeUndefined();
    expect(next.exitCode).toBeNull();
  });
  it('exited is terminal even for a late hook', () => {
    const s = reduce(session('working'), ev('SessionEnd', { exitCode: 0 }));
    expect(reduce(s, ev('UserPromptSubmit', { at: later(9000) }))).toBe(s);
  });
  it('Decided clears pending and goes back to working', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    const next = reduce(s, ev('Decided', { source: 'daemon' }));
    expect(next.state).toBe('working');
    expect(next.pending).toBeUndefined();
  });
  it('InjectFailed keeps pending and records the error', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    const next = reduce(s, ev('InjectFailed', { source: 'daemon', text: 'prompt still visible after 1' }));
    expect(next.pending).toEqual(s.pending);
    expect(next.lastError).toBe('prompt still visible after 1');
  });
  it('PaneChanged only bumps lastActivityAt', () => {
    const next = reduce(session('working'), ev('PaneChanged', { source: 'pane', at: later(7000) }));
    expect(next.state).toBe('working');
    expect(next.lastActivityAt).toBe(later(7000));
  });
  it('returns the same object when nothing changes', () => {
    const s = session('working');
    expect(reduce(s, ev('PreToolUse', { tool: 'Read', at: s.lastActivityAt }))).toBe(s);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm install && pnpm --filter ledge test`
Expected: FAIL, `Cannot find module '../src/daemon/state.js'`.

- [ ] **Step 4: Write the reducer**

`packages/ledge/src/daemon/state.ts`:
```ts
import type { Session, SessionEvent, Pending } from '@ledge/protocol';

export const HOOK_PRIORITY_MS = 2000;

export function isPending(s: Session): boolean {
  return s.state === 'waiting_permission' || s.state === 'waiting_input';
}

function pendingFor(ev: SessionEvent): Pending | undefined {
  if (ev.name === 'PermissionRequest') {
    const diff = ev.tool === 'Edit' || ev.tool === 'Write' || ev.tool === 'MultiEdit';
    return { kind: diff ? 'diff' : 'permission', text: ev.text ?? '', tool: ev.tool, source: 'hook' };
  }
  if (ev.name === 'PreToolUse' && ev.tool === 'AskUserQuestion') {
    return { kind: 'question', text: ev.text ?? '', options: ev.options, source: 'hook' };
  }
  if (ev.name === 'PreToolUse' && ev.tool === 'ExitPlanMode') {
    return { kind: 'plan', text: ev.text ?? '', source: 'hook' };
  }
  if (ev.name === 'Notification' && ev.kind === 'permission') {
    return { kind: 'permission', text: ev.text ?? '', source: 'hook' };
  }
  if (ev.name === 'PanePrompt') {
    return { kind: ev.kind ?? 'permission', text: ev.text ?? '', options: ev.options, source: 'pane' };
  }
  return undefined;
}

/** Richer wins: a hook pending is never replaced by a pane pending. */
function mergePending(current: Pending | undefined, incoming: Pending): Pending {
  if (!current) return incoming;
  if (current.source === 'hook' && incoming.source === 'pane') return current;
  if (incoming.source === 'hook' && current.source === 'pane') return incoming;
  return { ...current, ...incoming, text: incoming.text || current.text, tool: incoming.tool ?? current.tool, options: incoming.options ?? current.options };
}

export function reduce(s: Session, ev: SessionEvent): Session {
  if (s.state === 'exited' && ev.name !== 'SessionEnd' && ev.name !== 'PaneGone') return s;
  const at = ev.at;
  const lastHookAt = s.lastHookAt;

  switch (ev.name) {
    case 'SessionEnd':
      return { ...s, state: 'exited', pending: undefined, exitCode: ev.exitCode ?? null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneGone':
      return { ...s, state: 'exited', pending: undefined, exitCode: null, exitedAt: s.exitedAt ?? at, lastActivityAt: at };
    case 'PaneChanged':
      return s.lastActivityAt === at ? s : { ...s, lastActivityAt: at };
    case 'PaneIdle':
      return s;
    case 'InjectFailed':
      return { ...s, state: 'error', lastError: ev.text ?? 'injection not confirmed', lastActivityAt: at };
    case 'Decided':
      return { ...s, state: 'working', pending: undefined, lastError: undefined, lastActivityAt: at };
    case 'Stop':
      return { ...s, state: 'idle', lastHookAt: at, lastActivityAt: at };
    case 'PanePrompt': {
      if (s.pending?.source === 'hook') return s;
      if (lastHookAt && Date.parse(at) - Date.parse(lastHookAt) < HOOK_PRIORITY_MS) return s;
      const pending = pendingFor(ev)!;
      const state = pending.kind === 'question' ? 'waiting_input' : 'waiting_permission';
      return { ...s, state, pending: mergePending(s.pending, pending), lastActivityAt: at };
    }
    case 'SessionStart':
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PermissionRequest':
    case 'Notification': {
      const pending = pendingFor(ev);
      if (pending) {
        const state = pending.kind === 'question' ? 'waiting_input' : 'waiting_permission';
        return { ...s, state, pending: mergePending(s.pending, pending), lastHookAt: at, lastActivityAt: at };
      }
      if (ev.name === 'Notification') return { ...s, lastHookAt: at, lastActivityAt: at };
      if (s.state === 'working' && s.lastActivityAt === at && !s.pending) return s;
      return { ...s, state: 'working', pending: undefined, lastHookAt: at, lastActivityAt: at };
    }
  }
}
```

Add `lastHookAt` to the protocol session schema so the reducer can keep it (it is internal but harmless on the wire). In `packages/protocol/src/session.ts`, add after `lastActivityAt`:
```ts
  lastHookAt: z.string().datetime().optional(),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test && pnpm --filter @ledge/protocol test`
Expected: PASS. The table alone is 84 tests (7 states × 12 events).

- [ ] **Step 6: Commit**

```bash
git add packages/ledge packages/protocol/src/session.ts pnpm-lock.yaml
git commit -m "feat(daemon): session reducer with exhaustive transition table"
```

---

### Task 3: Bot names, paths and log

**Files:**
- Create: `packages/ledge/src/names.ts`, `packages/ledge/src/paths.ts`, `packages/ledge/src/log.ts`
- Test: `packages/ledge/test/names.test.ts`, `packages/ledge/test/paths.test.ts`

**Interfaces:**
- Produces: `NAMES: readonly string[]` (64 entries); `pickName(taken: Iterable<string>, preferred?: string): string`; `ledgeDir(): string` (honours `LEDGE_HOME` for tests, else `~/.ledge`); `paths(): { dir, tmuxConf, journal, log, pid }`; `ensureLedgeDir(): Promise<void>` (creates dir and writes `tmux.conf` if missing); `log(line: string): void` (appends `ISO time | line` to `daemon.log`, never throws).

- [ ] **Step 1: Write the failing tests**

`packages/ledge/test/names.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NAMES, pickName } from '../src/names.js';

describe('names', () => {
  it('has 64 unique short names', () => {
    expect(NAMES.length).toBe(64);
    expect(new Set(NAMES).size).toBe(64);
    for (const n of NAMES) expect(n.length).toBeLessThanOrEqual(5);
  });
  it('picks the first free name in list order', () => {
    expect(pickName([])).toBe(NAMES[0]);
    expect(pickName([NAMES[0]!, NAMES[1]!])).toBe(NAMES[2]);
  });
  it('honours a preferred name, capitalised', () => {
    expect(pickName(['Otto'], 'otto')).toBe('Otto-2');
    expect(pickName([], 'zed')).toBe('Zed');
  });
  it('suffixes when all 64 are taken', () => {
    expect(pickName(NAMES)).toBe(NAMES[0] + '-2');
  });
});
```

`packages/ledge/test/paths.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths, ensureLedgeDir } from '../src/paths.js';
import { log } from '../src/log.js';

describe('paths', () => {
  beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); });
  it('derives every file from LEDGE_HOME', () => {
    const p = paths();
    expect(p.tmuxConf).toBe(join(process.env.LEDGE_HOME!, 'tmux.conf'));
    expect(p.journal.endsWith('sessions.json')).toBe(true);
  });
  it('creates the dir and a tmux.conf with status off and mouse on', async () => {
    await ensureLedgeDir();
    const conf = readFileSync(paths().tmuxConf, 'utf8');
    expect(conf).toContain('set -g status off');
    expect(conf).toContain('set -g mouse on');
  });
  it('log appends a timestamped line and never throws', async () => {
    await ensureLedgeDir();
    log('hello');
    log('world');
    const txt = readFileSync(paths().log, 'utf8').trim().split('\n');
    expect(txt.length).toBe(2);
    expect(txt[1]).toMatch(/^\d{4}-\d{2}-\d{2}T.* \| world$/);
    process.env.LEDGE_HOME = '/nonexistent/dir/for/ledge';
    expect(() => log('nope')).not.toThrow();
    expect(existsSync('/nonexistent/dir/for/ledge')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/ledge/src/names.ts`:
```ts
export const NAMES: readonly string[] = [
  'Otto', 'Pim', 'Nova', 'Bix', 'Lu', 'Max', 'Ida', 'Rex', 'Zoe', 'Kit',
  'Ari', 'Bo', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jax',
  'Kai', 'Lio', 'Mo', 'Nia', 'Oz', 'Pax', 'Quin', 'Rae', 'Sol', 'Tad',
  'Uma', 'Vic', 'Wyn', 'Xen', 'Yan', 'Zia', 'Abe', 'Bea', 'Cy', 'Dot',
  'Eva', 'Fin', 'Gil', 'Hen', 'Iro', 'Jo', 'Kip', 'Lex', 'Mia', 'Ned',
  'Ola', 'Pat', 'Rio', 'Sam', 'Tia', 'Ulf', 'Val', 'Wes', 'Yui', 'Zed',
  'Ash', 'Bry', 'Cleo', 'Dax'
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function pickName(taken: Iterable<string>, preferred?: string): string {
  const used = new Set(taken);
  const free = (n: string) => !used.has(n);
  if (preferred) {
    const base = cap(preferred.trim());
    if (free(base)) return base;
    for (let i = 2; ; i++) if (free(`${base}-${i}`)) return `${base}-${i}`;
  }
  const first = NAMES.find(free);
  if (first) return first;
  for (let i = 2; ; i++) if (free(`${NAMES[0]}-${i}`)) return `${NAMES[0]}-${i}`;
}
```

`packages/ledge/src/paths.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';

export const TMUX_CONF = `set -g status off
set -g mouse on
set -g default-terminal "tmux-256color"
set -sg escape-time 10
set -g history-limit 20000
set -g remain-on-exit off
`;

export function ledgeDir(): string {
  return process.env.LEDGE_HOME ?? join(homedir(), '.ledge');
}

export function paths() {
  const dir = ledgeDir();
  return { dir, tmuxConf: join(dir, 'tmux.conf'), journal: join(dir, 'sessions.json'), log: join(dir, 'daemon.log'), pid: join(dir, 'daemon.pid') };
}

export async function ensureLedgeDir(): Promise<void> {
  const p = paths();
  await mkdir(p.dir, { recursive: true });
  try { await access(p.tmuxConf); } catch { await writeFile(p.tmuxConf, TMUX_CONF); }
}
```

`packages/ledge/src/log.ts`:
```ts
import { appendFileSync } from 'node:fs';
import { paths } from './paths.js';

export function log(line: string): void {
  try { appendFileSync(paths().log, `${new Date().toISOString()} | ${line}\n`); } catch { /* never throw from logging */ }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/names.ts packages/ledge/src/paths.ts packages/ledge/src/log.ts packages/ledge/test/names.test.ts packages/ledge/test/paths.test.ts
git commit -m "feat(ledge): bot names, ~/.ledge paths and daemon log"
```

---

### Task 4: tmux wrapper on the dedicated server

**Files:**
- Create: `packages/ledge/src/tmux.ts`
- Test: `packages/ledge/test/tmux.test.ts` (integration: uses the real tmux on a throwaway socket)

**Interfaces:**
- Produces: `interface Tmux { newSession(opts: { name, cwd, env: Record<string,string>, command: string[] }): Promise<void>; sendText(name, text): Promise<void>; sendKeys(name, keys: string[]): Promise<void>; capture(name, lines: number): Promise<string>; hasSession(name): Promise<boolean>; listSessions(): Promise<string[]>; killSession(name): Promise<void>; attachArgs(name): string[] }`; `realTmux(socket = 'ledge'): Tmux`; `run(args: string[]): Promise<{ code, stdout, stderr }>`.
- `sendText` uses `send-keys -l --` (literal), `sendKeys` sends named keys (`Enter`, `Escape`, `C-c`).

- [ ] **Step 1: Write the failing integration test**

`packages/ledge/test/tmux.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { realTmux } from '../src/tmux.js';
import { ensureLedgeDir } from '../src/paths.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const socket = 'ledge-test-' + process.pid;
const tmux = realTmux(socket);
const name = 'ledge-t1';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir(); });
afterAll(async () => { for (const s of await tmux.listSessions()) await tmux.killSession(s); });

describe('tmux', () => {
  it('creates a session running a command with env and cwd', async () => {
    await tmux.newSession({ name, cwd: '/tmp', env: { LEDGE_SESSION: 't1' }, command: ['sh', '-c', 'echo "LS=$LEDGE_SESSION PWD=$(pwd)"; cat'] });
    await sleep(300);
    expect(await tmux.hasSession(name)).toBe(true);
    expect(await tmux.listSessions()).toContain(name);
    const out = await tmux.capture(name, 5);
    expect(out).toContain('LS=t1 PWD=/tmp');
  });
  it('sends text literally, then Enter separately', async () => {
    await tmux.sendText(name, '-n ; echo not-a-flag');
    await tmux.sendKeys(name, ['Enter']);
    await sleep(300);
    const out = await tmux.capture(name, 5);
    expect(out).toContain('-n ; echo not-a-flag');
  });
  it('reports a missing session', async () => {
    expect(await tmux.hasSession('ledge-nope')).toBe(false);
  });
  it('kills a session', async () => {
    await tmux.killSession(name);
    await sleep(100);
    expect(await tmux.hasSession(name)).toBe(false);
  });
  it('builds attach args for the dedicated server', () => {
    expect(tmux.attachArgs('ledge-x')).toEqual(['-L', socket, '-f', expect.stringContaining('tmux.conf'), 'attach-session', '-t', 'ledge-x']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ledge test tmux`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/ledge/src/tmux.ts`:
```ts
import { execFile } from 'node:child_process';
import { paths } from './paths.js';

export interface Tmux {
  newSession(opts: { name: string; cwd: string; env: Record<string, string>; command: string[] }): Promise<void>;
  sendText(name: string, text: string): Promise<void>;
  sendKeys(name: string, keys: string[]): Promise<void>;
  capture(name: string, lines: number): Promise<string>;
  hasSession(name: string): Promise<boolean>;
  listSessions(): Promise<string[]>;
  killSession(name: string): Promise<void>;
  attachArgs(name: string): string[];
}

export function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile('tmux', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? (err as unknown as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export function realTmux(socket = 'ledge'): Tmux {
  const base = () => ['-L', socket, '-f', paths().tmuxConf];
  const t = (args: string[]) => run([...base(), ...args]);
  return {
    async newSession({ name, cwd, env, command }) {
      const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      const r = await t(['new-session', '-d', '-s', name, '-c', cwd, '-x', '200', '-y', '50', ...envArgs, '--', ...command]);
      if (r.code !== 0) throw new Error(`tmux new-session failed: ${r.stderr.trim()}`);
    },
    async sendText(name, text) {
      const r = await t(['send-keys', '-t', name, '-l', '--', text]);
      if (r.code !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
    },
    async sendKeys(name, keys) {
      const r = await t(['send-keys', '-t', name, ...keys]);
      if (r.code !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
    },
    async capture(name, lines) {
      const r = await t(['capture-pane', '-p', '-J', '-t', name, '-S', String(-lines)]);
      return r.code === 0 ? r.stdout.replace(/\s+$/g, '') : '';
    },
    async hasSession(name) {
      return (await t(['has-session', '-t', `=${name}`])).code === 0;
    },
    async listSessions() {
      const r = await t(['list-sessions', '-F', '#{session_name}']);
      return r.code === 0 ? r.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
    },
    async killSession(name) { await t(['kill-session', '-t', `=${name}`]); },
    attachArgs(name) { return [...base(), 'attach-session', '-t', name]; }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ledge test tmux`
Expected: PASS, 5 tests. If `has-session` with `=` prefix is not accepted by your tmux, drop the `=` (it only forces an exact match).

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/tmux.ts packages/ledge/test/tmux.test.ts
git commit -m "feat(ledge): tmux wrapper on the dedicated ledge server"
```

---

### Task 5: Adapter interface, verification helper and the Claude Code adapter

**Files:**
- Create: `packages/ledge/src/adapters/types.ts`, `packages/ledge/src/adapters/verify.ts`, `packages/ledge/src/adapters/claude.ts`, `packages/ledge/src/adapters/index.ts`
- Create: `packages/ledge/test/fixtures/panes/claude-permission.txt`, `claude-question.txt`, `claude-working.txt`, `claude-trap-file-contents.txt`
- Test: `packages/ledge/test/adapters-claude.test.ts`, `packages/ledge/test/verify.test.ts`

**Interfaces:**
- Produces: `interface Adapter { tool: Tool; detectPrompt(pane: string): PanePromptMatch | null; promptStillVisible(pane: string): boolean; keysFor(decision: 'accept' | 'deny', pending: Pending): KeyPlan; replyPlan(text: string): KeyPlan; interruptKeys(): string[]; }`; `type KeyPlan = Array<{ text: string } | { keys: string[] }>`; `type PanePromptMatch = { kind: 'permission' | 'question'; text: string; options?: string[] }`; `verifyGone(capture: () => Promise<string>, stillVisible: (pane: string) => boolean, opts?: { attempts?: number; intervalMs?: number }): Promise<boolean>`; `claudeAdapter: Adapter`; `adapterFor(tool: Tool): Adapter` (throws for tools not yet implemented).

- [ ] **Step 1: Record the pane fixtures**

Create the four fixtures with these exact contents (they mimic the Claude Code TUI as of October 2026; refresh them from a real `tmux capture-pane` during the manual checklist if the TUI changed):

`packages/ledge/test/fixtures/panes/claude-permission.txt`:
```
● Bash(npm test)
  ⎿  Run tests for packages/api

╭──────────────────────────────────────────────────────────────╮
│ Do you want to proceed?                                      │
│ ❯ 1. Yes                                                     │
│   2. Yes, and don't ask again for npm test                   │
│   3. No, and tell Claude what to do differently (esc)        │
╰──────────────────────────────────────────────────────────────╯
```

`packages/ledge/test/fixtures/panes/claude-question.txt`:
```
● Which migration strategy for the invoices table?

╭──────────────────────────────────────────────────────────────╮
│ Which migration strategy for the invoices table?             │
│ ❯ 1. Backfill in place (Recommended)                         │
│   2. Shadow table and swap                                   │
│   3. Dual write for a week                                   │
│   4. Other                                                   │
╰──────────────────────────────────────────────────────────────╯
```

`packages/ledge/test/fixtures/panes/claude-working.txt`:
```
● Read(src/daemon/state.ts)
  ⎿  Read 184 lines

● I'll run the test suite to confirm the state machine transitions.

● Bash(npm test)
  ⎿  Running…
```

`packages/ledge/test/fixtures/panes/claude-trap-file-contents.txt`:
```
● Read(test/fixtures/panes/claude-permission.txt)
  ⎿  Read 9 lines
     │ Do you want to proceed?
     │ ❯ 1. Yes
     │   2. Yes, and don't ask again for npm test

● Thinking…
```

- [ ] **Step 2: Write the failing tests**

`packages/ledge/test/verify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { verifyGone } from '../src/adapters/verify.js';

describe('verifyGone', () => {
  it('returns true as soon as the prompt is gone', async () => {
    const panes = ['Do you want to proceed?', 'Do you want to proceed?', 'Running tests'];
    let i = 0;
    const ok = await verifyGone(async () => panes[i++] ?? 'Running tests', p => p.includes('Do you want to proceed?'), { attempts: 3, intervalMs: 5 });
    expect(ok).toBe(true);
    expect(i).toBe(3);
  });
  it('returns false after the last attempt if it is still there', async () => {
    let calls = 0;
    const ok = await verifyGone(async () => { calls++; return 'Do you want to proceed?'; }, p => p.includes('proceed'), { attempts: 3, intervalMs: 5 });
    expect(ok).toBe(false);
    expect(calls).toBe(3);
  });
  it('defaults to 3 attempts over 600ms', async () => {
    const t0 = Date.now();
    await verifyGone(async () => 'still', () => true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
  });
});
```

`packages/ledge/test/adapters-claude.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { claudeAdapter } from '../src/adapters/claude.js';
import { adapterFor } from '../src/adapters/index.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');

describe('claude adapter: detection', () => {
  it('detects a permission prompt with the command', () => {
    const m = claudeAdapter.detectPrompt(fx('claude-permission'));
    expect(m).toEqual({ kind: 'permission', text: 'Bash(npm test)', options: ['Yes', "Yes, and don't ask again for npm test", 'No, and tell Claude what to do differently (esc)'] });
  });
  it('detects a question with its options', () => {
    const m = claudeAdapter.detectPrompt(fx('claude-question'));
    expect(m?.kind).toBe('question');
    expect(m?.text).toBe('Which migration strategy for the invoices table?');
    expect(m?.options).toEqual(['Backfill in place (Recommended)', 'Shadow table and swap', 'Dual write for a week', 'Other']);
  });
  it('returns null while working', () => {
    expect(claudeAdapter.detectPrompt(fx('claude-working'))).toBeNull();
  });
  it('is not fooled by prompt text quoted inside file contents', () => {
    expect(claudeAdapter.detectPrompt(fx('claude-trap-file-contents'))).toBeNull();
    expect(claudeAdapter.promptStillVisible(fx('claude-trap-file-contents'))).toBe(false);
  });
  it('promptStillVisible is true on a live prompt', () => {
    expect(claudeAdapter.promptStillVisible(fx('claude-permission'))).toBe(true);
  });
});

describe('claude adapter: keys', () => {
  const perm = { kind: 'permission' as const, text: 'npm test', source: 'hook' as const };
  it('accept presses 1 then Enter', () => {
    expect(claudeAdapter.keysFor('accept', perm)).toEqual([{ text: '1' }, { keys: ['Enter'] }]);
  });
  it('deny presses Escape', () => {
    expect(claudeAdapter.keysFor('deny', perm)).toEqual([{ keys: ['Escape'] }]);
  });
  it('a question answered by option number types the number then Enter', () => {
    const q = { kind: 'question' as const, text: 'Which?', options: ['A', 'B'], source: 'hook' as const };
    expect(claudeAdapter.replyPlan('2')).toEqual([{ text: '2' }, { keys: ['Enter'] }]);
    expect(claudeAdapter.keysFor('accept', q)).toEqual([{ text: '1' }, { keys: ['Enter'] }]);
  });
  it('a free text reply is typed literally then Enter, multi-line joined by spaces', () => {
    expect(claudeAdapter.replyPlan('fix all three\nthen run tests')).toEqual([{ text: 'fix all three then run tests' }, { keys: ['Enter'] }]);
  });
  it('interrupt is Escape', () => {
    expect(claudeAdapter.interruptKeys()).toEqual(['Escape']);
  });
  it('adapterFor returns the claude adapter and throws for others', () => {
    expect(adapterFor('claude')).toBe(claudeAdapter);
    expect(() => adapterFor('codex')).toThrow(/not implemented/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter ledge test adapters verify`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`packages/ledge/src/adapters/types.ts`:
```ts
import type { Pending, Tool } from '@ledge/protocol';

export type KeyPlan = Array<{ text: string } | { keys: string[] }>;
export type PanePromptMatch = { kind: 'permission' | 'question'; text: string; options?: string[] };

export interface Adapter {
  tool: Tool;
  detectPrompt(pane: string): PanePromptMatch | null;
  promptStillVisible(pane: string): boolean;
  keysFor(decision: 'accept' | 'deny', pending: Pending): KeyPlan;
  replyPlan(text: string): KeyPlan;
  interruptKeys(): string[];
}
```

`packages/ledge/src/adapters/verify.ts`:
```ts
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Re-read the pane up to `attempts` times, `intervalMs` apart; true once the prompt is gone. */
export async function verifyGone(
  capture: () => Promise<string>,
  stillVisible: (pane: string) => boolean,
  opts: { attempts?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const attempts = opts.attempts ?? 3;
  const interval = opts.intervalMs ?? 200;
  for (let i = 0; i < attempts; i++) {
    await sleep(interval);
    if (!stillVisible(await capture())) return true;
  }
  return false;
}
```

`packages/ledge/src/adapters/claude.ts`:
```ts
import type { Adapter, KeyPlan, PanePromptMatch } from './types.js';

// A live prompt is a box whose first inner line is the question and whose next lines are numbered options.
// Quoted file contents are prefixed by the Read tool's "│" gutter at column 5, so we only accept
// box lines that start at column 0 with the box character.
const BOX_LINE = /^│\s(.*?)\s*│$/;
const OPTION = /^(?:❯\s)?(\d+)\.\s(.+)$/;
const PERMISSION_QUESTION = /^Do you want to proceed\??$/;
const TOOL_CALL = /^●\s([A-Z][A-Za-z]+\([^)]*\))/m;

function boxLines(pane: string): string[] {
  return pane.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => BOX_LINE.test(l)).map(l => l.match(BOX_LINE)![1]!.trim());
}

function parseBox(pane: string): { question: string; options: string[] } | null {
  const lines = boxLines(pane);
  if (lines.length < 2) return null;
  const question = lines[0]!;
  const options: string[] = [];
  for (const l of lines.slice(1)) {
    const m = l.match(OPTION);
    if (m) options.push(m[2]!.trim());
  }
  if (options.length === 0) return null;
  return { question, options };
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const box = parseBox(pane);
  if (!box) return null;
  if (PERMISSION_QUESTION.test(box.question)) {
    const call = pane.match(TOOL_CALL);
    return { kind: 'permission', text: call ? call[1]! : box.question, options: box.options };
  }
  return { kind: 'question', text: box.question, options: box.options };
}

function numberThenEnter(n: string): KeyPlan { return [{ text: n }, { keys: ['Enter'] }]; }

export const claudeAdapter: Adapter = {
  tool: 'claude',
  detectPrompt,
  promptStillVisible: pane => parseBox(pane) !== null,
  keysFor(decision) {
    return decision === 'accept' ? numberThenEnter('1') : [{ keys: ['Escape'] }];
  },
  replyPlan(text) {
    const flat = text.replace(/\s*\n\s*/g, ' ').trim();
    return [{ text: flat }, { keys: ['Enter'] }];
  },
  interruptKeys: () => ['Escape']
};
```

`packages/ledge/src/adapters/index.ts`:
```ts
import type { Tool } from '@ledge/protocol';
import type { Adapter } from './types.js';
import { claudeAdapter } from './claude.js';

export function adapterFor(tool: Tool): Adapter {
  if (tool === 'claude') return claudeAdapter;
  throw new Error(`adapter for ${tool} not implemented yet`);
}
export type { Adapter, KeyPlan, PanePromptMatch } from './types.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test adapters verify`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ledge/src/adapters packages/ledge/test/fixtures packages/ledge/test/adapters-claude.test.ts packages/ledge/test/verify.test.ts
git commit -m "feat(adapters): Claude Code adapter with pane detection and verified key plans"
```

---

### Task 6: Store with journal persistence

**Files:**
- Create: `packages/ledge/src/daemon/store.ts`
- Test: `packages/ledge/test/store.test.ts`

**Interfaces:**
- Consumes: `reduce` (Task 2), `paths` (Task 3), `log` (Task 3).
- Produces: `class Store { constructor(opts?: { journalPath?: string }); load(): Promise<void>; all(): Session[]; get(id): Session | undefined; upsert(session: Session): void; apply(id, event: SessionEvent): Session | undefined; remove(id): void; onChange(listener: (change: StoreChange) => void): () => void; save(): Promise<void> }`; `type StoreChange = { type: 'updated'; session: Session } | { type: 'removed'; id: string }`.
- `load()` never throws: a missing, empty or corrupt journal gives an empty store and one log line. `save()` writes atomically (temp file + rename) and is debounced 200 ms after each change.

- [ ] **Step 1: Write the failing test**

`packages/ledge/test/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/daemon/store.js';
import type { Session } from '@ledge/protocol';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (id: string, state: Session['state'] = 'working'): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: `ledge-${id}`,
  state, helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher'
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-')); process.env.LEDGE_HOME = dir; });

describe('Store', () => {
  it('upserts, applies events and notifies', async () => {
    const s = new Store(); const seen: string[] = [];
    s.onChange(c => seen.push(c.type));
    s.upsert(mk('a'));
    const next = s.apply('a', { name: 'Stop', at: '2026-10-09T18:01:00.000Z', source: 'hook' });
    expect(next?.state).toBe('idle');
    s.remove('a');
    expect(seen).toEqual(['updated', 'updated', 'removed']);
    expect(s.all()).toEqual([]);
  });
  it('does not notify when the reducer returns the same object', () => {
    const s = new Store(); let n = 0; s.onChange(() => n++);
    s.upsert(mk('a', 'exited'));
    s.apply('a', { name: 'UserPromptSubmit', at: '2026-10-09T18:01:00.000Z', source: 'hook' });
    expect(n).toBe(1);
  });
  it('persists to the journal and loads it back', async () => {
    const s = new Store(); s.upsert(mk('a')); await s.save();
    const s2 = new Store(); await s2.load();
    expect(s2.get('a')?.tmuxSession).toBe('ledge-a');
  });
  it('debounces saves after changes', async () => {
    const s = new Store(); s.upsert(mk('a')); s.upsert(mk('b'));
    await sleep(350);
    const txt = readFileSync(join(dir, 'sessions.json'), 'utf8');
    expect(JSON.parse(txt).sessions.length).toBe(2);
  });
  it('starts empty on a corrupt journal and logs once', async () => {
    writeFileSync(join(dir, 'sessions.json'), '{"sessions": [ {"id": "a", ');
    const s = new Store(); await expect(s.load()).resolves.toBeUndefined();
    expect(s.all()).toEqual([]);
    expect(readFileSync(join(dir, 'daemon.log'), 'utf8')).toMatch(/journal unreadable/);
  });
  it('drops journal entries that fail the schema instead of crashing', async () => {
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [mk('ok'), { id: 'bad', state: 'sleeping' }] }));
    const s = new Store(); await s.load();
    expect(s.all().map(x => x.id)).toEqual(['ok']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ledge test store`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/ledge/src/daemon/store.ts`:
```ts
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SessionSchema, type Session, type SessionEvent } from '@ledge/protocol';
import { reduce } from './state.js';
import { paths } from '../paths.js';
import { log } from '../log.js';

export type StoreChange = { type: 'updated'; session: Session } | { type: 'removed'; id: string };

export class Store {
  private sessions = new Map<string, Session>();
  private listeners = new Set<(c: StoreChange) => void>();
  private timer: NodeJS.Timeout | null = null;
  private readonly journalPath: string;

  constructor(opts: { journalPath?: string } = {}) {
    this.journalPath = opts.journalPath ?? paths().journal;
  }

  async load(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.journalPath, 'utf8'); } catch { return; }
    if (!raw.trim()) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (e) { log(`journal unreadable, starting empty: ${(e as Error).message}`); return; }
    const list = (parsed as { sessions?: unknown[] })?.sessions;
    if (!Array.isArray(list)) { log('journal unreadable, starting empty: no sessions array'); return; }
    for (const item of list) {
      const r = SessionSchema.safeParse(item);
      if (r.success) this.sessions.set(r.data.id, r.data);
      else log(`journal entry dropped: ${r.error.issues[0]?.message ?? 'invalid'}`);
    }
  }

  all(): Session[] { return [...this.sessions.values()]; }
  get(id: string): Session | undefined { return this.sessions.get(id); }

  upsert(session: Session): void {
    this.sessions.set(session.id, session);
    this.emit({ type: 'updated', session });
  }

  apply(id: string, event: SessionEvent): Session | undefined {
    const cur = this.sessions.get(id);
    if (!cur) return undefined;
    const next = reduce(cur, event);
    if (next === cur) return cur;
    this.sessions.set(id, next);
    this.emit({ type: 'updated', session: next });
    return next;
  }

  remove(id: string): void {
    if (!this.sessions.delete(id)) return;
    this.emit({ type: 'removed', id });
  }

  onChange(listener: (c: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async save(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await mkdir(dirname(this.journalPath), { recursive: true });
    const tmp = `${this.journalPath}.tmp`;
    await writeFile(tmp, JSON.stringify({ savedAt: new Date().toISOString(), sessions: this.all() }, null, 2));
    await rename(tmp, this.journalPath);
  }

  private emit(c: StoreChange): void {
    for (const l of this.listeners) { try { l(c); } catch (e) { log(`listener failed: ${(e as Error).message}`); } }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.save().catch(e => log(`journal save failed: ${(e as Error).message}`)); }, 200);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ledge test store`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/daemon/store.ts packages/ledge/test/store.test.ts
git commit -m "feat(daemon): session store with atomic, debounced journal"
```

---

### Task 7: WebSocket server, commands and hook-before-register merge

**Files:**
- Create: `packages/ledge/src/daemon/server.ts`, `packages/ledge/src/client.ts`
- Test: `packages/ledge/test/server.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 6), `adapterFor`, `verifyGone` (Task 5), `Tmux` (Task 4), protocol schemas (Task 1).
- Produces: `startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string }): Promise<{ port: number; close(): Promise<void>; broadcast(msg: ServerMessage): void }>`; `connect(opts?: { port?: number; timeoutMs?: number }): Promise<Client>` where `Client = { send(msg: ClientMessage): void; next<T extends ServerMessage['type']>(type: T, timeoutMs?: number): Promise<Extract<ServerMessage, { type: T }>>; close(): void }`.
- Behaviour: on connect the server sends `snapshot`; every store change is broadcast as `session.updated` or `session.removed`; `session.register` for an id that already exists as `hook_only` upgrades it in place (keeps `pending`, `state`, takes `tmuxSession`, `name`, `source: launcher`); `session.event` for an unknown id creates a `hook_only` session (name from `pickName`, state `working`); `session.decide` and `session.reply` run the adapter's key plan then `verifyGone`, and apply `Decided` or `InjectFailed`; `session.kill` kills the tmux session and applies `PaneGone`; `session.interrupt` sends the adapter's interrupt keys; invalid JSON or schema gets an `error` message back and a log line, never a crash.

- [ ] **Step 1: Write the failing test**

`packages/ledge/test/server.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

function fakeTmux(panes: Record<string, string[]>): Tmux & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    async newSession() {}, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async killSession(n) { delete panes[n]; sent.push(['kill', n]); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let tmux: ReturnType<typeof fakeTmux>;
const PROMPT = 'x\n╭──╮\n│ Do you want to proceed? │\n│ ❯ 1. Yes │\n╰──╯';
beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
  store = new Store();
  tmux = fakeTmux({ 'ledge-a': [PROMPT, PROMPT, 'Running…'] });
  srv = await startServer({ store, tmux, port: 0 });
});
afterEach(async () => { await srv.close(); });

describe('server', () => {
  it('sends a snapshot on connect and broadcasts updates', async () => {
    store.upsert(mk('a'));
    const c = await connect({ port: srv.port });
    const snap = await c.next('snapshot');
    expect(snap.sessions.map(s => s.id)).toEqual(['a']);
    store.apply('a', { name: 'Stop', at: T0, source: 'hook' });
    const upd = await c.next('session.updated');
    expect(upd.session.state).toBe('idle');
    c.close();
  });

  it('register upgrades a hook_only session created by an early hook', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.event', id: 'b', event: { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'npm test' } });
    const first = await c.next('session.updated');
    expect(first.session.source).toBe('hook_only');
    expect(first.session.pending?.text).toBe('npm test');
    c.send({ type: 'session.register', session: mk('b', { name: 'Pim', source: 'launcher' }) });
    const second = await c.next('session.updated');
    expect(second.session.source).toBe('launcher');
    expect(second.session.name).toBe('Pim');
    expect(second.session.pending?.text).toBe('npm test');
    expect(store.all().length).toBe(1);
    c.close();
  });

  it('decide accept types 1, Enter, verifies the prompt is gone and applies Decided', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    const upd = await c.next('session.updated', 3000);
    expect(upd.session.state).toBe('working');
    expect(upd.session.pending).toBeUndefined();
    expect(tmux.sent).toEqual([['text', 'ledge-a', '1'], ['keys', 'ledge-a', 'Enter']]);
    c.close();
  });

  it('decide fails to error when the prompt stays, and nothing is re-sent', async () => {
    tmux = fakeTmux({ 'ledge-a': [PROMPT] }); await srv.close(); srv = await startServer({ store, tmux, port: 0 });
    store.upsert(mk('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    const upd = await c.next('session.updated', 3000);
    expect(upd.session.state).toBe('error');
    expect(upd.session.pending?.text).toBe('npm test');
    expect(tmux.sent.length).toBe(2);
    c.close();
  });

  it('reply types the text literally then Enter', async () => {
    store.upsert(mk('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.reply', id: 'a', text: '-n ; backfill' });
    await c.next('session.updated', 3000);
    expect(tmux.sent[0]).toEqual(['text', 'ledge-a', '-n ; backfill']);
    expect(tmux.sent[1]).toEqual(['keys', 'ledge-a', 'Enter']);
    c.close();
  });

  it('kill removes the tmux session and marks the bot exited', async () => {
    store.upsert(mk('a'));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.kill', id: 'a' });
    const upd = await c.next('session.updated');
    expect(upd.session.state).toBe('exited');
    expect(tmux.sent).toContainEqual(['kill', 'ledge-a']);
    c.close();
  });

  it('answers bad input with an error message and keeps serving', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'zzz', decision: 'maybe' } as never);
    const err = await c.next('error');
    expect(err.message).toMatch(/invalid/i);
    c.send({ type: 'snapshot.request' });
    await c.next('snapshot');
    c.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ledge test server`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the client**

`packages/ledge/src/client.ts`:
```ts
import WebSocket from 'ws';
import { PROTOCOL_PORT, parseServerMessage, type ClientMessage, type ServerMessage } from '@ledge/protocol';

export interface Client {
  send(msg: ClientMessage): void;
  next<T extends ServerMessage['type']>(type: T, timeoutMs?: number): Promise<Extract<ServerMessage, { type: T }>>;
  close(): void;
}

export function connect(opts: { port?: number; host?: string; timeoutMs?: number } = {}): Promise<Client> {
  const port = opts.port ?? PROTOCOL_PORT;
  const host = opts.host ?? '127.0.0.1';
  const ws = new WebSocket(`ws://${host}:${port}`);
  const queue: ServerMessage[] = [];
  const waiters: Array<{ type: string; resolve: (m: ServerMessage) => void }> = [];
  ws.on('message', data => {
    let msg: ServerMessage;
    try { msg = parseServerMessage(JSON.parse(String(data))); } catch { return; }
    const i = waiters.findIndex(w => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg); else queue.push(msg);
  });
  const client: Client = {
    send: msg => ws.send(JSON.stringify(msg)),
    next(type, timeoutMs = 1500) {
      const i = queue.findIndex(m => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0] as never);
      return new Promise((resolve, reject) => {
        const w = { type, resolve: (m: ServerMessage) => { clearTimeout(t); resolve(m as never); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout waiting for ${type}`)); }, timeoutMs);
        waiters.push(w);
      });
    },
    close: () => ws.close()
  };
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.terminate(); reject(new Error('connect timeout')); }, opts.timeoutMs ?? 1000);
    ws.once('open', () => { clearTimeout(t); resolve(client); });
    ws.once('error', e => { clearTimeout(t); reject(e); });
  });
}
```

- [ ] **Step 4: Implement the server**

`packages/ledge/src/daemon/server.ts`:
```ts
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL_PORT, parseClientMessage, type ClientMessage, type ServerMessage, type Session } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Tmux } from '../tmux.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { verifyGone } from '../adapters/verify.js';
import { pickName } from '../names.js';
import { log } from '../log.js';

export interface ServerHandle { port: number; close(): Promise<void>; broadcast(msg: ServerMessage): void }

export async function startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string; verify?: { attempts?: number; intervalMs?: number } }): Promise<ServerHandle> {
  const { store, tmux } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const wss = new WebSocketServer({ host: opts.host ?? '127.0.0.1', port: opts.port ?? PROTOCOL_PORT });
  await new Promise<void>((res, rej) => { wss.once('listening', res); wss.once('error', rej); });
  const port = (wss.address() as { port: number }).port;

  const send = (ws: WebSocket, msg: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  const broadcast = (msg: ServerMessage) => { for (const c of wss.clients) send(c, msg); };
  const unsubscribe = store.onChange(c => broadcast(c.type === 'updated' ? { type: 'session.updated', session: c.session } : { type: 'session.removed', id: c.id }));

  async function runPlan(s: Session, plan: KeyPlan): Promise<void> {
    if (!s.tmuxSession) throw new Error('session has no terminal (started without ledge)');
    for (const step of plan) {
      if ('text' in step) await tmux.sendText(s.tmuxSession, step.text);
      else await tmux.sendKeys(s.tmuxSession, step.keys);
    }
  }

  async function injectAndVerify(id: string, plan: KeyPlan): Promise<void> {
    const s = store.get(id);
    if (!s) throw new Error(`unknown session ${id}`);
    const adapter = adapterFor(s.tool);
    await runPlan(s, plan);
    const gone = await verifyGone(() => tmux.capture(s.tmuxSession!, 5), p => adapter.promptStillVisible(p), opts.verify);
    if (gone) store.apply(id, { name: 'Decided', at: now(), source: 'daemon' });
    else store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: 'the terminal did not take it' });
  }

  async function handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'snapshot.request': return send(ws, { type: 'snapshot', sessions: store.all() });
      case 'session.register': {
        const existing = store.get(msg.session.id);
        if (existing && existing.source === 'hook_only') {
          store.upsert({ ...existing, ...msg.session, state: existing.state, pending: existing.pending, lastActivityAt: existing.lastActivityAt, source: 'launcher' });
        } else store.upsert(msg.session);
        return;
      }
      case 'session.event': {
        if (!store.get(msg.id)) {
          const taken = store.all().map(s => s.name);
          store.upsert({ id: msg.id, name: pickName(taken), tool: 'claude', cwd: '', project: 'unknown', title: 'untracked session', tmuxSession: null, state: 'working', helpers: [], startedAt: msg.event.at, lastActivityAt: msg.event.at, source: 'hook_only' });
        }
        store.apply(msg.id, msg.event);
        return;
      }
      case 'session.unregister':
        store.apply(msg.id, { name: 'SessionEnd', at: now(), source: 'hook', exitCode: msg.exitCode });
        return;
      case 'session.decide': {
        const s = store.get(msg.id); if (!s) return send(ws, { type: 'error', id: msg.id, message: 'unknown session' });
        if (!s.pending) return send(ws, { type: 'error', id: msg.id, message: 'nothing to decide' });
        return injectAndVerify(msg.id, adapterFor(s.tool).keysFor(msg.decision, s.pending));
      }
      case 'session.reply': {
        const s = store.get(msg.id); if (!s) return send(ws, { type: 'error', id: msg.id, message: 'unknown session' });
        return injectAndVerify(msg.id, adapterFor(s.tool).replyPlan(msg.text));
      }
      case 'session.interrupt': {
        const s = store.get(msg.id); if (!s?.tmuxSession) return;
        await tmux.sendKeys(s.tmuxSession, adapterFor(s.tool).interruptKeys());
        return;
      }
      case 'session.kill': {
        const s = store.get(msg.id); if (!s) return;
        if (s.tmuxSession) await tmux.killSession(s.tmuxSession);
        store.apply(msg.id, { name: 'PaneGone', at: now(), source: 'daemon' });
        return;
      }
      case 'session.focus':
        return; // handled by the overlay plan via wt.exe; the daemon only acknowledges
    }
  }

  wss.on('connection', ws => {
    send(ws, { type: 'snapshot', sessions: store.all() });
    ws.on('message', data => {
      let msg: ClientMessage;
      try { msg = parseClientMessage(JSON.parse(String(data))); }
      catch (e) { log(`invalid message: ${(e as Error).message}`); return send(ws, { type: 'error', message: 'invalid message' }); }
      handle(ws, msg).catch(e => { log(`${msg.type} failed: ${(e as Error).message}`); send(ws, { type: 'error', id: 'id' in msg ? msg.id : undefined, message: (e as Error).message }); });
    });
  });

  return {
    port,
    broadcast,
    close: () => new Promise(res => { unsubscribe(); for (const c of wss.clients) c.terminate(); wss.close(() => res()); })
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test server`
Expected: PASS, 7 tests. The "stays" test takes about 600 ms because of the three verification reads.

- [ ] **Step 6: Commit**

```bash
git add packages/ledge/src/daemon/server.ts packages/ledge/src/client.ts packages/ledge/test/server.test.ts
git commit -m "feat(daemon): websocket server with verified decisions and hook-before-register merge"
```

---

### Task 8: Poller, retirement and daemon entry point

**Files:**
- Create: `packages/ledge/src/daemon/poller.ts`, `packages/ledge/src/daemon/index.ts`
- Test: `packages/ledge/test/poller.test.ts`

**Interfaces:**
- Consumes: `Store`, `Tmux`, `adapterFor`, `log`.
- Produces: `startPoller(opts: { store; tmux; adapterFor?; intervalMs?: number; deadCheckMs?: number; retireMs?: number; now?: () => string; broadcastPreview?: (id: string, lines: string[]) => void }): { stop(): void; tick(): Promise<void> }`; `startDaemon(opts?: { port?: number }): Promise<{ stop(): Promise<void> }>` which loads the store, prunes sessions whose tmux session no longer exists, starts the server and the poller, writes `daemon.pid`, and logs `daemon started on <port>`.
- Poller rules per tick: for each session with a `tmuxSession` and not `exited`: capture 30 lines, hash; if the hash changed apply `PaneChanged` and broadcast the preview; if the adapter detects a prompt apply `PanePrompt`; every `deadCheckMs` check `hasSession`, apply `PaneGone` when missing; sessions `exited` for more than `retireMs` (10 min) are removed.

- [ ] **Step 1: Write the failing test**

`packages/ledge/test/poller.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startPoller } from '../src/daemon/poller.js';
import type { Tmux } from '../src/tmux.js';

const T0 = Date.parse('2026-10-09T18:00:00.000Z');
let clock = T0; const now = () => new Date(clock).toISOString();
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: `ledge-${id}`,
  state: 'working', helpers: [], startedAt: now(), lastActivityAt: now(), source: 'launcher', ...extra
});
const PROMPT = '╭──╮\n│ Do you want to proceed? │\n│ ❯ 1. Yes │\n╰──╯';
function fakeTmux(panes: Record<string, string>): Tmux {
  return {
    async newSession() {}, async sendText() {}, async sendKeys() {},
    async capture(n) { return panes[n] ?? ''; }, async hasSession(n) { return n in panes; },
    async listSessions() { return Object.keys(panes); }, async killSession(n) { delete panes[n]; }, attachArgs: () => []
  };
}
let store: Store; let panes: Record<string, string>; let previews: string[][];
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); store = new Store(); panes = {}; previews = []; clock = T0; });

describe('poller', () => {
  it('bumps lastActivityAt only when the pane content changes, and broadcasts the preview', async () => {
    panes['ledge-a'] = 'line one'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now, broadcastPreview: (id, lines) => previews.push(lines) });
    clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(now());
    clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(new Date(T0 + 1000).toISOString());
    panes['ledge-a'] = 'line one\nline two'; clock += 1000; await p.tick();
    expect(store.get('a')!.lastActivityAt).toBe(now());
    expect(previews.at(-1)).toEqual(['line one', 'line two']);
    p.stop();
  });
  it('detects a prompt from the pane when no hook spoke recently', async () => {
    panes['ledge-a'] = PROMPT; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, now });
    clock += 5000; await p.tick();
    expect(store.get('a')!.state).toBe('waiting_permission');
    expect(store.get('a')!.pending?.source).toBe('pane');
    p.stop();
  });
  it('marks a dead pane as exited on the dead check and retires it after retireMs', async () => {
    panes['ledge-a'] = 'x'; store.upsert(mk('a'));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, retireMs: 600000, now });
    delete panes['ledge-a']; clock += 1000; await p.tick();
    expect(store.get('a')!.state).toBe('exited');
    expect(store.get('a')!.exitCode).toBeNull();
    clock += 600001; await p.tick();
    expect(store.get('a')).toBeUndefined();
    p.stop();
  });
  it('ignores sessions without a terminal', async () => {
    store.upsert(mk('h', { tmuxSession: null, source: 'hook_only' }));
    const p = startPoller({ store, tmux: fakeTmux(panes), intervalMs: 100000, deadCheckMs: 0, now });
    clock += 1000; await p.tick();
    expect(store.get('h')!.state).toBe('working');
    p.stop();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ledge test poller`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the poller**

`packages/ledge/src/daemon/poller.ts`:
```ts
import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import type { Tmux } from '../tmux.js';
import { adapterFor as defaultAdapterFor } from '../adapters/index.js';
import { log } from '../log.js';

export const PREVIEW_LINES = 30;

export function startPoller(opts: {
  store: Store; tmux: Tmux; adapterFor?: typeof defaultAdapterFor;
  intervalMs?: number; deadCheckMs?: number; retireMs?: number; now?: () => string;
  broadcastPreview?: (id: string, lines: string[]) => void;
}) {
  const { store, tmux } = opts;
  const adapterFor = opts.adapterFor ?? defaultAdapterFor;
  const now = opts.now ?? (() => new Date().toISOString());
  const deadCheckMs = opts.deadCheckMs ?? 5000;
  const retireMs = opts.retireMs ?? 10 * 60 * 1000;
  const hashes = new Map<string, string>();
  let lastDeadCheck = 0;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; running = true;
    try {
      const t = Date.parse(now());
      const deadCheck = t - lastDeadCheck >= deadCheckMs;
      if (deadCheck) lastDeadCheck = t;
      for (const s of store.all()) {
        if (s.state === 'exited') {
          if (s.exitedAt && t - Date.parse(s.exitedAt) > retireMs) store.remove(s.id);
          continue;
        }
        if (!s.tmuxSession) continue;
        if (deadCheck && !(await tmux.hasSession(s.tmuxSession))) { store.apply(s.id, { name: 'PaneGone', at: now(), source: 'daemon' }); hashes.delete(s.id); continue; }
        const pane = await tmux.capture(s.tmuxSession, PREVIEW_LINES);
        const h = createHash('sha1').update(pane).digest('hex');
        if (hashes.get(s.id) !== h) {
          hashes.set(s.id, h);
          store.apply(s.id, { name: 'PaneChanged', at: now(), source: 'pane' });
          opts.broadcastPreview?.(s.id, pane.split('\n'));
        }
        let adapter; try { adapter = adapterFor(s.tool); } catch { continue; }
        const m = adapter.detectPrompt(pane);
        if (m) store.apply(s.id, { name: 'PanePrompt', at: now(), source: 'pane', kind: m.kind, text: m.text, options: m.options });
      }
    } catch (e) { log(`poll failed: ${(e as Error).message}`); }
    finally { running = false; }
  }

  const timer = setInterval(() => { tick(); }, opts.intervalMs ?? 1000);
  return { stop: () => clearInterval(timer), tick };
}
```

- [ ] **Step 4: Implement the daemon entry point**

`packages/ledge/src/daemon/index.ts`:
```ts
import { writeFile, rm } from 'node:fs/promises';
import { Store } from './store.js';
import { startServer } from './server.js';
import { startPoller } from './poller.js';
import { realTmux } from '../tmux.js';
import { ensureLedgeDir, paths } from '../paths.js';
import { log } from '../log.js';

export async function startDaemon(opts: { port?: number } = {}): Promise<{ stop(): Promise<void>; port: number }> {
  await ensureLedgeDir();
  const store = new Store();
  await store.load();
  const tmux = realTmux('ledge');
  const live = new Set(await tmux.listSessions());
  for (const s of store.all()) {
    if (s.tmuxSession && !live.has(s.tmuxSession) && s.state !== 'exited') store.apply(s.id, { name: 'PaneGone', at: new Date().toISOString(), source: 'daemon' });
  }
  const server = await startServer({ store, tmux, port: opts.port });
  const poller = startPoller({ store, tmux, broadcastPreview: (id, lines) => server.broadcast({ type: 'session.preview', id, lines }) });
  await writeFile(paths().pid, String(process.pid));
  log(`daemon started on ${server.port} with ${store.all().length} sessions`);
  const stop = async () => { poller.stop(); await server.close(); await store.save(); await rm(paths().pid, { force: true }); log('daemon stopped'); };
  process.once('SIGTERM', () => { stop().finally(() => process.exit(0)); });
  process.once('SIGINT', () => { stop().finally(() => process.exit(0)); });
  return { stop, port: server.port };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test poller`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ledge/src/daemon/poller.ts packages/ledge/src/daemon/index.ts packages/ledge/test/poller.test.ts
git commit -m "feat(daemon): pane poller, dead-pane detection, retirement and daemon entry"
```

---

### Task 9: Hook receiver, setup and the CLI entry

**Files:**
- Create: `packages/ledge/src/cli/hook.ts`, `packages/ledge/src/cli/setup.ts`, `packages/ledge/src/cli/status.ts`, `packages/ledge/src/cli/index.ts`
- Test: `packages/ledge/test/hook.test.ts`, `packages/ledge/test/setup.test.ts`

**Interfaces:**
- Consumes: `connect` (Task 7), `paths`, `ensureLedgeDir`, `TMUX_CONF`.
- Produces: `mapClaudeHook(eventName: string, payload: unknown, at: string): { id: string; event: SessionEvent } | null` (pure); `runHook(eventName: string, stdin: string, opts?: { port?: number; timeoutMs?: number }): Promise<void>` (never throws, never exceeds `timeoutMs`, default 150 ms); `mergeClaudeHooks(settings: unknown, command = 'ledge hook'): { settings: object; changed: boolean }` (pure, idempotent, appends); `runSetup(opts?: { settingsPath?: string }): Promise<void>`; `printStatus(opts?: { port?: number }): Promise<string>`.
- Session id for Claude Code hooks: `LEDGE_SESSION` from the environment when present (launcher-started), else `payload.session_id` (hook_only).

- [ ] **Step 1: Write the failing tests**

`packages/ledge/test/hook.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapClaudeHook, runHook } from '../src/cli/hook.js';

const at = '2026-10-09T18:00:00.000Z';
describe('mapClaudeHook', () => {
  it('uses LEDGE_SESSION when set, else session_id', () => {
    process.env.LEDGE_SESSION = '7f3a';
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('7f3a');
    delete process.env.LEDGE_SESSION;
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('uuid-1');
  });
  it('maps PermissionRequest for Bash to a permission event with the command', () => {
    const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } }, at);
    expect(m?.event).toEqual({ name: 'PermissionRequest', at, source: 'hook', tool: 'Bash', text: 'npm test' });
  });
  it('maps PermissionRequest for Edit to the file path', () => {
    const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/src/a.ts' } }, at);
    expect(m?.event.text).toBe('/w/src/a.ts');
  });
  it('maps PreToolUse AskUserQuestion with its options', () => {
    const payload = { session_id: 's', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] } };
    const m = mapClaudeHook('PreToolUse', payload, at);
    expect(m?.event).toEqual({ name: 'PreToolUse', at, source: 'hook', tool: 'AskUserQuestion', text: 'Which?', options: ['A', 'B'] });
  });
  it('maps Notification permission_prompt to kind permission', () => {
    const m = mapClaudeHook('Notification', { session_id: 's', notification_type: 'permission_prompt', message: 'Claude needs your permission' }, at);
    expect(m?.event.kind).toBe('permission');
  });
  it('maps SessionEnd with no code', () => {
    expect(mapClaudeHook('SessionEnd', { session_id: 's' }, at)?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', exitCode: null });
  });
  it('returns null for an unknown event or malformed payload', () => {
    expect(mapClaudeHook('Whatever', { session_id: 's' }, at)).toBeNull();
    expect(mapClaudeHook('Stop', 'not an object', at)).toBeNull();
  });
});

describe('runHook', () => {
  it('returns quickly and never throws when no daemon listens', async () => {
    const t0 = Date.now();
    await expect(runHook('Stop', JSON.stringify({ session_id: 's' }), { port: 1, timeoutMs: 150 })).resolves.toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('swallows invalid stdin', async () => {
    await expect(runHook('Stop', '{{{', { port: 1, timeoutMs: 50 })).resolves.toBeUndefined();
  });
});
```

`packages/ledge/test/setup.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mergeClaudeHooks, CLAUDE_EVENTS } from '../src/cli/setup.js';

describe('mergeClaudeHooks', () => {
  it('appends a ledge entry to every event, keeping foreign hooks', () => {
    const settings = { model: 'opus', hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: '/other/tool PreToolUse', timeout: 10 }] }] } };
    const { settings: out, changed } = mergeClaudeHooks(settings);
    expect(changed).toBe(true);
    const o = out as { model: string; hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(o.model).toBe('opus');
    expect(o.hooks.PreToolUse![0]!.hooks[0]!.command).toBe('/other/tool PreToolUse');
    expect(o.hooks.PreToolUse![1]!.hooks[0]!.command).toBe('ledge hook PreToolUse');
    for (const ev of CLAUDE_EVENTS) expect(o.hooks[ev]!.some(e => e.hooks.some(h => h.command === `ledge hook ${ev}`))).toBe(true);
  });
  it('is idempotent', () => {
    const once = mergeClaudeHooks({}).settings;
    const twice = mergeClaudeHooks(once);
    expect(twice.changed).toBe(false);
    expect(twice.settings).toEqual(once);
  });
  it('sets a 5 second timeout on its own entries only', () => {
    const o = mergeClaudeHooks({}).settings as { hooks: Record<string, Array<{ hooks: Array<{ timeout: number }> }>> };
    expect(o.hooks.Stop![0]!.hooks[0]!.timeout).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test hook setup`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the hook receiver**

`packages/ledge/src/cli/hook.ts`:
```ts
import type { SessionEvent } from '@ledge/protocol';
import { connect } from '../client.js';
import { log } from '../log.js';

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function describeTool(tool: string | undefined, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Payload;
  if (tool === 'Bash') return str(i.command) ?? '';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'Read') return str(i.file_path) ?? '';
  if (tool === 'ExitPlanMode') return str(i.plan)?.split('\n')[0] ?? 'plan';
  return str(i.description) ?? JSON.stringify(i).slice(0, 200);
}

export function mapClaudeHook(eventName: string, payload: unknown, at: string): { id: string; event: SessionEvent } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Payload;
  const id = process.env.LEDGE_SESSION ?? str(p.session_id);
  if (!id) return null;
  const tool = str(p.tool_name);
  const base = { at, source: 'hook' as const };
  switch (eventName) {
    case 'SessionStart': return { id, event: { name: 'SessionStart', ...base } };
    case 'UserPromptSubmit': return { id, event: { name: 'UserPromptSubmit', ...base } };
    case 'Stop': return { id, event: { name: 'Stop', ...base } };
    case 'SessionEnd': return { id, event: { name: 'SessionEnd', ...base, exitCode: null } };
    case 'PermissionRequest': return { id, event: { name: 'PermissionRequest', ...base, tool, text: describeTool(tool, p.tool_input) } };
    case 'PreToolUse': {
      if (tool === 'AskUserQuestion') {
        const qs = ((p.tool_input as Payload | undefined)?.questions as Array<Payload> | undefined) ?? [];
        const q = qs[0];
        const options = ((q?.options as Array<Payload> | undefined) ?? []).map(o => str(o.label) ?? '').filter(Boolean);
        return { id, event: { name: 'PreToolUse', ...base, tool, text: str(q?.question) ?? '', options } };
      }
      return { id, event: { name: 'PreToolUse', ...base, tool, text: describeTool(tool, p.tool_input) } };
    }
    case 'Notification': {
      const type = str(p.notification_type) ?? '';
      const message = str(p.message) ?? '';
      const kind = type === 'permission_prompt' || /permission/i.test(message) ? 'permission' : undefined;
      return { id, event: { name: 'Notification', ...base, kind, text: message } };
    }
    default: return null;
  }
}

/** Always resolves, always fast: a hook must never slow the agent down. */
export async function runHook(eventName: string, stdin: string, opts: { port?: number; timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 150;
  try {
    const payload = JSON.parse(stdin || '{}');
    const mapped = mapClaudeHook(eventName, payload, new Date().toISOString());
    if (!mapped) return;
    const client = await connect({ port: opts.port, timeoutMs });
    client.send({ type: 'session.event', id: mapped.id, event: mapped.event });
    await new Promise(r => setTimeout(r, 20));
    client.close();
  } catch (e) {
    log(`hook ${eventName} dropped: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 4: Implement setup and status**

`packages/ledge/src/cli/setup.ts`:
```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { ensureLedgeDir } from '../paths.js';

export const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'] as const;

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> };

export function mergeClaudeHooks(settings: unknown, command = 'ledge hook'): { settings: object; changed: boolean } {
  const base = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const hooks = { ...((base.hooks as Record<string, HookEntry[]> | undefined) ?? {}) };
  let changed = false;
  for (const ev of CLAUDE_EVENTS) {
    const list = [...(hooks[ev] ?? [])];
    const mine = `${command} ${ev}`;
    if (!list.some(e => e.hooks?.some(h => h.command === mine))) {
      list.push({ hooks: [{ type: 'command', command: mine, timeout: 5 }] });
      changed = true;
    }
    hooks[ev] = list;
  }
  return { settings: { ...base, hooks }, changed };
}

export async function runSetup(opts: { settingsPath?: string } = {}): Promise<string[]> {
  const out: string[] = [];
  await ensureLedgeDir();
  out.push('~/.ledge ready (tmux.conf written if missing)');
  const settingsPath = opts.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  let current: unknown = {};
  try { current = JSON.parse(await readFile(settingsPath, 'utf8')); } catch { /* new file */ }
  const { settings, changed } = mergeClaudeHooks(current);
  if (changed) {
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    out.push(`Claude Code hooks added in ${settingsPath}`);
  } else out.push('Claude Code hooks already present');
  return out;
}
```

`packages/ledge/src/cli/status.ts`:
```ts
import { connect } from '../client.js';

export async function printStatus(opts: { port?: number } = {}): Promise<string> {
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
  catch { return 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)'; }
  const snap = await client.next('snapshot');
  client.close();
  if (snap.sessions.length === 0) return 'no sessions';
  const rows = snap.sessions.map(s => {
    const age = Math.round((Date.now() - Date.parse(s.startedAt)) / 60000);
    const ask = s.pending ? ` · ${s.pending.kind}: ${s.pending.text}` : '';
    return `${s.name.padEnd(8)} ${s.tool.padEnd(7)} ${s.state.padEnd(19)} ${s.project.padEnd(28)} ${age}m${ask}${s.source === 'hook_only' ? ' · read only' : ''}`;
  });
  return rows.join('\n');
}
```

`packages/ledge/src/cli/index.ts`:
```ts
#!/usr/bin/env node
import { startDaemon } from '../daemon/index.js';
import { runHook } from './hook.js';
import { runSetup } from './setup.js';
import { printStatus } from './status.js';
import { launch } from './launch.js';

const USAGE = `ledge <claude|codex|cursor> [--name <bot>] [-- agent args]   start an agent in a tracked session
ledge daemon                                                 run the daemon in the foreground
ledge hook <Event>                                           receive a hook (reads JSON on stdin)
ledge setup                                                  install hooks and ~/.ledge
ledge status                                                 list sessions`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'daemon': { await startDaemon(); await new Promise(() => {}); return 0; }
    case 'hook': {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      await runHook(rest[0] ?? '', Buffer.concat(chunks).toString('utf8'));
      return 0;
    }
    case 'setup': { for (const l of await runSetup()) console.log(l); return 0; }
    case 'status': { console.log(await printStatus()); return 0; }
    case 'claude': case 'codex': case 'cursor': return launch(cmd, rest);
    default: console.log(USAGE); return cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(`ledge: ${(e as Error).message}`); process.exit(1); });
```

The `launch` import is created in Task 10; until then add a one-line stub `packages/ledge/src/cli/launch.ts`:
```ts
export async function launch(_tool: string, _args: string[]): Promise<number> { throw new Error('launcher not implemented yet'); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test hook setup && pnpm --filter ledge typecheck`
Expected: PASS, 12 tests, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ledge/src/cli packages/ledge/test/hook.test.ts packages/ledge/test/setup.test.ts
git commit -m "feat(cli): hook receiver, setup merge and status"
```

---

### Task 10: Launcher and end-to-end integration with a fake agent

**Files:**
- Create: `packages/ledge/src/cli/launch.ts` (replace the stub), `packages/ledge/test/fake-agent.mjs`
- Test: `packages/ledge/test/launch.test.ts`, `packages/ledge/test/e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `createSession(opts: { tool: Tool; args: string[]; name?: string; cwd: string; tmux: Tmux; client: Client; now?: () => string }): Promise<Session>` (creates the tmux session with the agent, registers it, returns the session); `ensureDaemon(opts?: { port?: number }): Promise<Client | null>` (connect; if refused, spawn `ledge daemon` detached and retry 3× over 1.5 s; null when still unreachable; if the port is taken by a non-Ledge process, log and return null); `launch(tool, argv): Promise<number>` (parses `--name`, calls `ensureDaemon`, `createSession`, attaches with `tmux attach` inheriting stdio, unregisters on exit, returns the agent's exit code). When the daemon is unreachable the agent still starts in tmux and a single line is printed: `ledge: daemon not running, session not tracked`.

- [ ] **Step 1: Write the fake agent**

`packages/ledge/test/fake-agent.mjs`:
```js
#!/usr/bin/env node
// A scripted stand-in for the Claude Code TUI. Steps are driven by argv:
//   permission <cmd>   print a permission box, wait for "1\n" (accept) or ESC (deny)
//   question           print a question box, wait for a line
//   work <ms>          print a working line, sleep
//   exit <code>        exit with code
import { stdin, stdout, exit } from 'node:process';
stdin.setRawMode?.(true); stdin.setEncoding('utf8');
const read = () => new Promise(r => stdin.once('data', r));
const say = s => stdout.write(s + '\n');
const steps = process.argv.slice(2);
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (s === 'permission') {
    const cmd = steps[++i];
    say(`● Bash(${cmd})`); say('  ⎿  Run it');
    say('╭──────────────────────────────────────────╮');
    say('│ Do you want to proceed?                  │');
    say('│ ❯ 1. Yes                                 │');
    say('│   2. Yes, and don\'t ask again            │');
    say('│   3. No, and tell Claude what to do (esc)│');
    say('╰──────────────────────────────────────────╯');
    let buf = '';
    while (true) { const k = await read(); if (k === '\u001b') { say('✗ denied'); break; } buf += k; if (buf.includes('\r') || buf.includes('\n')) { say(buf.trim() === '1' ? '✓ accepted' : '? ' + buf.trim()); break; } }
    say('● Running…');
  } else if (s === 'question') {
    say('╭──────────────────────────────────────────╮');
    say('│ Which migration strategy?                │');
    say('│ ❯ 1. Backfill                            │');
    say('│   2. Shadow table                        │');
    say('╰──────────────────────────────────────────╯');
    let buf = ''; while (!buf.includes('\r') && !buf.includes('\n')) buf += await read();
    say('● You chose: ' + buf.trim());
  } else if (s === 'work') { say('● Working on it…'); await new Promise(r => setTimeout(r, Number(steps[++i]))); }
  else if (s === 'exit') { exit(Number(steps[++i])); }
}
exit(0);
```

- [ ] **Step 2: Write the failing tests**

`packages/ledge/test/launch.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLaunchArgs, ensureDaemon } from '../src/cli/launch.js';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';

beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); });

describe('parseLaunchArgs', () => {
  it('extracts --name and passes the rest to the agent', () => {
    expect(parseLaunchArgs(['--name', 'otto', '--', '-p', 'hello'])).toEqual({ name: 'otto', args: ['-p', 'hello'] });
    expect(parseLaunchArgs(['--resume'])).toEqual({ name: undefined, args: ['--resume'] });
    expect(parseLaunchArgs([])).toEqual({ name: undefined, args: [] });
  });
});

describe('ensureDaemon', () => {
  it('connects to a live Ledge daemon instead of spawning a second one', async () => {
    const noop: Tmux = { async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return false; }, async listSessions() { return []; }, async killSession() {}, attachArgs: () => [] };
    const srv = await startServer({ store: new Store(), tmux: noop, port: 0 });
    const client = await ensureDaemon({ port: srv.port });
    expect(client).not.toBeNull();
    client!.close(); await srv.close();
  });
  it('returns null and logs when the port is held by a foreign process, without spawning', async () => {
    const foreign = createServer(sock => sock.end());
    await new Promise<void>(r => foreign.listen(0, '127.0.0.1', r));
    const port = (foreign.address() as { port: number }).port;
    const client = await ensureDaemon({ port });
    expect(client).toBeNull();
    expect(readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8')).toMatch(/does not speak the Ledge protocol/);
    foreign.close();
  });
});
```

`packages/ledge/test/e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { startPoller } from '../src/daemon/poller.js';
import { realTmux } from '../src/tmux.js';
import { ensureLedgeDir } from '../src/paths.js';
import { connect } from '../src/client.js';
import { createSession } from '../src/cli/launch.js';

const agent = fileURLToPath(new URL('./fake-agent.mjs', import.meta.url));
const socket = 'ledge-e2e-' + process.pid;
const tmux = realTmux(socket);
let srv: Awaited<ReturnType<typeof startServer>>; let poller: ReturnType<typeof startPoller>; let store: Store;
const until = async (pred: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)); } };

beforeAll(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir();
  store = new Store(); srv = await startServer({ store, tmux, port: 0 });
  poller = startPoller({ store, tmux, intervalMs: 150, deadCheckMs: 300, broadcastPreview: (id, lines) => srv.broadcast({ type: 'session.preview', id, lines }) });
});
afterAll(async () => { poller.stop(); await srv.close(); for (const s of await tmux.listSessions()) await tmux.killSession(s); });

describe('end to end with a fake Claude Code', () => {
  it('tracks a permission, approves it from the client, sees the agent continue and exit', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: ['node', agent, 'permission', 'npm test', 'work', '300', 'exit', '0'], cwd: '/tmp', tmux, client });
    expect(s.name).toBe('Otto');
    await until(() => store.get(s.id)?.state === 'waiting_permission');
    expect(store.get(s.id)!.pending?.text).toBe('Bash(npm test)');
    client.send({ type: 'session.decide', id: s.id, decision: 'accept' });
    await until(() => store.get(s.id)?.state === 'working');
    await until(() => store.get(s.id)?.state === 'exited', 6000);
    expect(store.get(s.id)!.pending).toBeUndefined();
    client.close();
  });

  it('answers a question with free text', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const s = await createSession({ tool: 'claude', args: ['node', agent, 'question', 'exit', '0'], cwd: '/tmp', tmux, client });
    await until(() => store.get(s.id)?.state === 'waiting_input');
    client.send({ type: 'session.reply', id: s.id, text: '2' });
    await until(() => store.get(s.id)?.state === 'exited', 6000);
    const pane = await tmux.capture(s.tmuxSession!, 10);
    expect(pane).toContain('You chose: 2');
    client.close();
  });

  it('survives a daemon restart: sessions are reloaded and dead ones marked exited', async () => {
    const client = await connect({ port: srv.port }); await client.next('snapshot');
    const alive = await createSession({ tool: 'claude', args: ['node', agent, 'work', '60000'], cwd: '/tmp', tmux, client });
    const dead = await createSession({ tool: 'claude', args: ['node', agent, 'exit', '0'], cwd: '/tmp', tmux, client });
    await until(() => store.get(dead.id)?.state === 'exited');
    await store.save(); poller.stop(); await srv.close(); client.close();
    const store2 = new Store(); await store2.load();
    expect(store2.get(alive.id)?.state).toBe('working');
    expect(store2.get(dead.id)?.state).toBe('exited');
    store = store2; srv = await startServer({ store, tmux, port: 0 });
    poller = startPoller({ store, tmux, intervalMs: 150, deadCheckMs: 300 });
    await tmux.killSession(alive.tmuxSession!);
    await until(() => store.get(alive.id)?.state === 'exited');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter ledge test launch e2e`
Expected: FAIL, `parseLaunchArgs`/`createSession` not exported.

- [ ] **Step 4: Implement the launcher**

`packages/ledge/src/cli/launch.ts`:
```ts
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Session, Tool } from '@ledge/protocol';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { realTmux, type Tmux } from '../tmux.js';
import { ensureLedgeDir } from '../paths.js';
import { pickName } from '../names.js';
import { log } from '../log.js';

const AGENT_BIN: Record<Tool, string> = { claude: 'claude', codex: 'codex', cursor: 'cursor-agent' };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function parseLaunchArgs(argv: string[]): { name?: string; args: string[] } {
  const args: string[] = []; let name: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--name') { name = argv[++i]; continue; }
    if (a === '--') { args.push(...argv.slice(i + 1)); break; }
    args.push(a);
  }
  return { name, args };
}

function portOpen(port: number): Promise<boolean> {
  return new Promise(res => { const s = createConnection({ host: '127.0.0.1', port }); s.once('connect', () => { s.end(); res(true); }); s.once('error', () => res(false)); });
}

export async function ensureDaemon(opts: { port?: number } = {}): Promise<Client | null> {
  await ensureLedgeDir();
  const port = opts.port ?? PROTOCOL_PORT;
  try { return await connect({ port, timeoutMs: 400 }); } catch { /* not running or not ours */ }
  if (await portOpen(port)) { log(`port ${port} is open but does not speak the Ledge protocol`); return null; }
  const child = spawn(process.execPath, [process.argv[1]!, 'daemon'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 3; i++) { await sleep(500); try { return await connect({ port, timeoutMs: 400 }); } catch { /* retry */ } }
  return null;
}

export async function createSession(opts: { tool: Tool; args: string[]; name?: string; cwd: string; tmux: Tmux; client: Client | null; now?: () => string }): Promise<Session> {
  const now = opts.now ?? (() => new Date().toISOString());
  const id = randomBytes(2).toString('hex');
  const taken: string[] = [];
  if (opts.client) { opts.client.send({ type: 'snapshot.request' }); const snap = await opts.client.next('snapshot'); taken.push(...snap.sessions.map(s => s.name)); }
  const name = pickName(taken, opts.name);
  const project = basename(opts.cwd) || opts.cwd;
  const tmuxSession = `ledge-${id}`;
  const command = opts.args.length && opts.args[0] === 'node' ? opts.args : [AGENT_BIN[opts.tool], ...opts.args];
  await opts.tmux.newSession({ name: tmuxSession, cwd: opts.cwd, env: { LEDGE_SESSION: id, LEDGE_NAME: name }, command });
  const session: Session = { id, name, tool: opts.tool, cwd: opts.cwd, project, title: `${name} · ${project}`, tmuxSession, state: 'starting', helpers: [], startedAt: now(), lastActivityAt: now(), source: 'launcher' };
  opts.client?.send({ type: 'session.register', session });
  return session;
}

export async function launch(tool: Tool, argv: string[]): Promise<number> {
  await ensureLedgeDir();
  const { name, args } = parseLaunchArgs(argv);
  const tmux = realTmux('ledge');
  const client = await ensureDaemon();
  if (!client) console.error('ledge: daemon not running, session not tracked');
  const session = await createSession({ tool, args, name, cwd: process.cwd(), tmux, client });
  process.stdout.write(`\u001b]0;${session.title}\u0007`); // rename the Windows Terminal tab
  const code = await new Promise<number>(resolve => {
    const child = spawn('tmux', tmux.attachArgs(session.tmuxSession!), { stdio: 'inherit' });
    child.on('exit', c => resolve(c ?? 0));
  });
  client?.send({ type: 'session.unregister', id: session.id, exitCode: code });
  await sleep(30);
  client?.close();
  return code;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test launch e2e && pnpm --filter ledge typecheck`
Expected: PASS, 6 tests. The e2e file takes 5 to 10 seconds because it drives real tmux panes. `ensureDaemon` needs `ensureLedgeDir()` to have run before it logs: call it at the top of `ensureDaemon` (it is idempotent).

- [ ] **Step 6: Build, link and try it for real**

```bash
pnpm --filter ledge build && cd packages/ledge && pnpm link --global && cd ../..
ledge setup
ledge claude          # in a Windows Terminal tab, inside a project
# in another tab:
ledge status
```
Expected: `ledge setup` reports hooks added (your existing hooks stay); `ledge claude` opens Claude Code inside tmux with the tab renamed to the bot; `ledge status` shows the bot as `working`, then `waiting_permission` with the command when Claude asks, then `working` again after you answer in the terminal. Trigger a permission, then from a third tab run:

```bash
node -e "import('ws').then(({default:W})=>{const w=new W('ws://127.0.0.1:47831');w.on('open',()=>{w.on('message',m=>{const j=JSON.parse(m);if(j.type==='snapshot'){const s=j.sessions.find(x=>x.pending);if(s){w.send(JSON.stringify({type:'session.decide',id:s.id,decision:'accept'}));setTimeout(()=>process.exit(0),1500)}else{console.log('nothing pending');process.exit(0)}}})})})"
```
Expected: Claude Code proceeds in the first tab. If it does not, read `~/.ledge/daemon.log`, compare the pane with `tmux -L ledge capture-pane -p -t <session>` and adjust `BOX_LINE` or the key plan in `adapters/claude.ts`, refreshing the fixtures from that capture.

- [ ] **Step 7: Commit**

```bash
git add packages/ledge/src/cli/launch.ts packages/ledge/test/fake-agent.mjs packages/ledge/test/launch.test.ts packages/ledge/test/e2e.test.ts
git commit -m "feat(cli): launcher with daemon bootstrap and end-to-end fake-agent tests"
```

---

### Task 11: Developer documentation

**Files:**
- Modify: `README.md`
- Create: `packages/ledge/README.md`

- [ ] **Step 1: Write the package README**

`packages/ledge/README.md`:
```markdown
# ledge (WSL side)

## Install for development
pnpm install
pnpm --filter ledge build && (cd packages/ledge && pnpm link --global)
ledge setup

## Use
ledge claude            # start Claude Code in a tracked tmux session (tab renamed to the bot)
ledge claude --name max # pick the bot's name
ledge status            # list bots and what they wait for
ledge daemon            # run the daemon in the foreground (normally auto-started)

## Where things live
~/.ledge/tmux.conf      dedicated tmux server config (status off, mouse on)
~/.ledge/sessions.json  journal, reloaded when the daemon restarts
~/.ledge/daemon.log     dropped hooks, failed injections, poll errors

## Tests
pnpm --filter ledge test            # unit + tmux + end-to-end (needs tmux, no AI)
pnpm --filter ledge test state      # only the transition table

## Refreshing pane fixtures
tmux -L ledge capture-pane -p -J -t ledge-<id> -S -30 > test/fixtures/panes/<name>.txt
```

- [ ] **Step 2: Add the package to the root README**

Append to `README.md`:
```markdown

## Packages

- `packages/protocol`: zod schemas shared by the daemon, the CLI and the overlay.
- `packages/ledge`: the `ledge` CLI (launcher, daemon, hook receiver). See `packages/ledge/README.md`.
- `apps/overlay`: the Windows overlay (next plan).
```

- [ ] **Step 3: Run everything once**

Run: `pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 4: Commit and push**

```bash
git add README.md packages/ledge/README.md
git commit -m "docs: ledge package usage and fixture refresh"
git push
```

---

## Self-review notes

- Spec coverage for this plan's scope: section 3 (components, daemon as source of truth, protocol, session model) → Tasks 1, 6, 7, 8; section 4 (launcher, Claude Code adapter, state machine, hook-only sessions) → Tasks 2, 5, 9, 10; section 8 (errors) → Task 6 corrupt journal, Task 7 inject failure and bad input, Task 8 dead pane and retirement, Task 9 hook timing, Task 10 daemon absent; section 9 (unit, integration, reconnection) → Tasks 2, 5, 10; section 10 (stack, repo layout) → Task 1. Deferred to the next plans: overlay (sections 5, 6, 7), Codex and Cursor adapters, `session.focus` via `wt.exe`, helpers (sub-agents) population, the `plan`/`diff` content beyond their kind.
- Names used consistently: `reduce`, `Store.apply`, `startServer`, `startPoller`, `connect`, `Client.next`, `adapterFor`, `verifyGone`, `createSession`, `ensureDaemon`, `mapClaudeHook`, `mergeClaudeHooks`, `pickName`, `paths`, `ensureLedgeDir`, `log`.
- Review Focus pins: 1 → Task 7 "register upgrades a hook_only session"; 2 → Task 2 "pane prompt within HOOK_PRIORITY_MS is ignored" and Task 5 trap fixture; 3 → Task 4 "sends text literally" and Task 7 reply test; 4 → Task 10 `ensureDaemon` tests (live daemon reused, foreign port logged and null) plus the manual step for the untracked launch; 5 → Task 6 corrupt journal test.
