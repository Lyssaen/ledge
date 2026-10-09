# Ledge adapters and advanced screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the V1 feature set on top of Plans 1 and 2: the Codex and Cursor Agent adapters with their hook/notify setup, sub-agent helpers, richer pending payloads (diff, plan, report, long command, finished summary), and the overlay cards and views that show them, plus the queue bandeau and reading mode.

**Architecture:** Daemon side, every new tool is one `Adapter` implementation plus pane fixtures, registered in `adapterFor`; new facts (helpers, diff detail, plan text, last message, files changed, running command) travel in two optional session fields added to the protocol (`pending.detail`, `activity`) so the overlay needs no new transport. Overlay side, the session view gets one card component per pending kind and one activity panel, chosen by a pure `viewFor(session)` function; the list gets the queue bandeau; reading mode only changes the width and the text measure.

**Tech Stack:** same as Plans 1 and 2 (TypeScript, Vitest, `ws`, `zod`, React 19, Tailwind v4, tmux 3.6).

**Spec:** `docs/superpowers/specs/2026-10-09-ledge-design.md`, revision 2 (sections 4, 5, 6, 7 and 7 bis). Visual/interaction reference: [approved local prototype](../../mockups/ledge-prototype.html) and [standalone version](../../mockups/ledge-prototype-standalone.html), scenarios 3–10 and 12. The older remote canvas is historical; the local Signal/Galet prototype is authoritative for the approved direction.

**Approved revision:** carry Plan 2's revised Bot API and mandatory Task 13 into every rich screen. Task 9 below is the final prototype-parity gate. Product code must consume confirmed daemon state, not the mockup's local completion timers, sample statistics or browser-only grants. This plan remains unimplemented; visual approval does not check off its tasks.

**Depends on:**
- Tasks 1 to 3 need Plan 1 up to its Task 7 merged (adapter interface, verify helper, server). They can start as soon as Plan 1's `packages/ledge/src/adapters/types.ts` and `src/daemon/server.ts` exist on `main`.
- Tasks 4 to 8 need Plan 2 up to its Task 9 merged (`Surface`, `SessionView`, `SessionList`).
- Task 0 (protocol fields) is shared and must land first; it only adds optional fields, so it breaks nothing in either plan. Run it before parallelising.

## Global Constraints

- Everything in Plan 1 and Plan 2's Global Constraints still applies.
- Dark mode uses Signal, light mode Galet, including helper avatars, queue avatars, reading mode and finished summaries. Pass the current theme and stable session/helper seed; never hard-code a dark helper/queue component.
- Read-only and disconnected states disable every reply/decision entry point, including keyboard and quick replies; retain drafts and known expressions. A declined or interrupted action cannot produce a fabricated success report. Plan edits keep the session and reply field open.
- Scoped “Always” options require an adapter capability and confirmed scope; with the current one-shot protocol they are disabled with an explanation. Browser-local grants from the prototype are not a daemon authorization policy.
- Codex: decisions are `y` / `n`, replies are text then `Enter` 50 ms later, interrupt is `C-c`; `notify = ["ledge", "hook", "codex-notify"]` in `~/.codex/config.toml` (appended, never replacing an existing `notify`).
- Cursor Agent: hooks in `~/.cursor/hooks.json` under `hooks.beforeShellExecution`, `hooks.afterFileEdit`, `hooks.stop` as `{ "command": "ledge hook Cursor<Event>" }` entries appended to existing arrays; prompt patterns anchored to a line start.
- Pane patterns for every tool have at least one trap fixture (prompt text quoted inside output) and must not match it.
- A sub-agent helper is shown under its bot only while the bot is alive; there is no separate helper surface/bubble. The current protocol routes one active helper permission through the parent's `pending.helperId`. A helper card is actionable only when it matches that active request; other waiting helpers remain visible without misrouted decision buttons. Independent concurrent helper permissions require a separate request-identity protocol before activation.
- Reading mode is 560 px wide, body text 14/21, mono 12.5/20, diff lines wrap with `overflow-wrap: anywhere`; file headers in a diff are collapsible buttons.
- The finished summary retires with the bot (10 min); The prototype’s “Continue” creates a fictional new ID; until a real launch/resume command exists, the product action is “Open terminal to relaunch”, focuses the terminal and sends nothing.

## Review Focus

1. Codex prints `y/n` prompts for things other than approvals (for example a `[y/n]` inside a script's own output): the adapter must only match Codex's own approval box, verified on a trap fixture. Pinned in Task 1.
2. A Cursor hook fires `beforeShellExecution` for a helper command while the main bot is idle: the parent's state must become `waiting_permission` with `helperId`, and clearing it must not clear a different pending on the same bot. Pinned in Task 3.
3. A diff for a binary or a 5 000-line file: `pending.detail` is capped at 400 lines with a trailing "… N more lines, open the tab" and the card still renders in under a frame. Pinned in Task 4.
4. The transcript used for the report card is missing or truncated mid-line: the report card shows "message unavailable, open the tab" rather than a broken render. Pinned in Task 2.
5. The queue bandeau's "Next" when the current bot's ask disappears underneath (answered in the terminal): the view moves to the next waiting bot, never to a bot that is no longer waiting. Pinned in Task 7.

---

## File structure

```
packages/protocol/src/session.ts                  # + pending.detail, pending.helperId, activity, helpers (already), filesChanged
packages/ledge/src/adapters/codex.ts, cursor.ts   # new adapters
packages/ledge/src/adapters/index.ts              # registry
packages/ledge/src/cli/setup.ts                   # + codex notify, cursor hooks
packages/ledge/src/cli/hook.ts                    # + codex-notify, Cursor* mapping, helper events, transcript last message
packages/ledge/src/daemon/state.ts                # + helpers, activity, filesChanged reductions
packages/ledge/src/transcript.ts                  # lastAssistantMessage(path)
packages/ledge/test/fixtures/panes/codex-*.txt, cursor-*.txt
apps/overlay/src/surface/cards/PermissionCard.tsx, DiffCard.tsx, QuestionCard.tsx, PlanCard.tsx, ReportCard.tsx
apps/overlay/src/surface/cards/ActivityPanel.tsx  # long command / finished summary / helpers
apps/overlay/src/surface/viewFor.ts               # pure chooser
apps/overlay/src/surface/QueueBar.tsx
apps/overlay/src/surface/SessionView.tsx          # composes cards, reading mode
```

---

### Task 0: Protocol fields for richer sessions

**Files:**
- Modify: `packages/protocol/src/session.ts`, `packages/protocol/src/messages.ts`
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- `PendingSchema` gains `detail: z.string().optional()` (diff text, plan text, question context), `helperId: z.string().optional()`.
- `SessionSchema` gains `activity: z.object({ kind: z.enum(['command', 'message', 'none']), text: z.string(), startedAt: z.string().datetime().optional() }).optional()` (the running command, or the last assistant message once a turn stops), `filesChanged: z.array(z.object({ path: z.string(), kind: z.enum(['M', 'A', 'D']) })).default([])`, `testsPassed: z.number().int().optional()`.
- `SessionEventSchema.name` gains `'PostToolUse' | 'SubagentStart' | 'SubagentStop' | 'TurnMessage' | 'CodexNotify' | 'CursorBeforeShell' | 'CursorAfterFileEdit' | 'CursorStop'`; the event gains `detail: z.string().optional()`, `path: z.string().optional()`, `helperKind: z.string().optional()`.

- [ ] **Step 1: Add tests**

Append to `packages/protocol/test/messages.test.ts`:
```ts
  it('accepts the richer optional fields', () => {
    const rich = { ...session, pending: { ...session.pending, detail: '@@ -1 +1 @@\n-a\n+b', helperId: 'h1' }, activity: { kind: 'command', text: 'npm test', startedAt: '2026-10-09T18:00:00.000Z' }, filesChanged: [{ path: 'src/a.ts', kind: 'M' }], testsPassed: 48 };
    expect(SessionSchema.parse(rich).filesChanged.length).toBe(1);
    expect(parseClientMessage({ type: 'session.event', id: '7f3a', event: { name: 'SubagentStart', at: '2026-10-09T18:02:00.000Z', source: 'hook', helperId: 'h1', helperKind: 'Explore', text: 'find reducer consumers' } }).type).toBe('session.event');
  });
```

- [ ] **Step 2: Run, implement the schema additions as listed, run again**

Run: `pnpm --filter @ledge/protocol test`
Expected: FAIL then PASS. Every existing test in Plans 1 and 2 still passes because every new field is optional or defaulted.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): optional detail, activity, helpers and files-changed fields"
```

---

### Task 1: Codex adapter and notify setup

**Files:**
- Create: `packages/ledge/src/adapters/codex.ts`, `packages/ledge/test/fixtures/panes/codex-approval.txt`, `codex-question.txt`, `codex-working.txt`, `codex-trap-yn-in-output.txt`
- Modify: `packages/ledge/src/adapters/index.ts`, `packages/ledge/src/cli/setup.ts`, `packages/ledge/src/cli/hook.ts`
- Test: `packages/ledge/test/adapters-codex.test.ts`, extend `packages/ledge/test/setup.test.ts` and `hook.test.ts`

**Interfaces:**
- Produces: `codexAdapter: Adapter` (`tool: 'codex'`); `mergeCodexNotify(toml: string): { toml: string; changed: boolean }` (pure; appends `notify = ["ledge", "hook", "codex-notify"]` when no `notify` key exists; when one exists and does not mention ledge, leaves it and returns `changed: false` with a note the CLI prints: "Codex already has a notify command; add `ledge hook codex-notify` to it by hand"); `mapCodexNotify(payload: unknown, at: string): { id: string; event: SessionEvent } | null` mapping Codex's `agent-turn-complete` JSON (`{ type: 'agent-turn-complete', 'turn-id', 'last-assistant-message' }`) to a `Stop` event carrying `text` = the last message (used by the report card), id from `LEDGE_SESSION` only (Codex has no session id of its own; without the env var the notify is dropped).

- [ ] **Step 1: Record the fixtures**

`codex-approval.txt`:
```
codex
I need to run the test suite before changing the adapter.

  $ npm test -- --runInBand packages/api

  Allow command? [y/n]
```
`codex-question.txt`:
```
codex
I found two migration strategies for the invoices table.
Which one do you want: backfill in place, or shadow table?

› 
```
`codex-working.txt`:
```
codex
Reading src/adapters/codex.ts
Reading src/daemon/state.ts
• Working (12s · esc to interrupt)
```
`codex-trap-yn-in-output.txt`:
```
codex
  $ cat scripts/deploy.sh

  echo "Deploy to production? [y/n]"
  read answer

• Working (3s · esc to interrupt)
```

- [ ] **Step 2: Write the failing tests**

`packages/ledge/test/adapters-codex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { codexAdapter } from '../src/adapters/codex.js';
import { adapterFor } from '../src/adapters/index.js';
const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');

describe('codex adapter', () => {
  it('detects the approval box with the command', () => {
    expect(codexAdapter.detectPrompt(fx('codex-approval'))).toEqual({ kind: 'permission', text: 'npm test -- --runInBand packages/api' });
    expect(codexAdapter.promptStillVisible(fx('codex-approval'))).toBe(true);
  });
  it('detects a question as the last agent line ending with ? before an empty prompt', () => {
    expect(codexAdapter.detectPrompt(fx('codex-question'))).toEqual({ kind: 'question', text: 'Which one do you want: backfill in place, or shadow table?' });
  });
  it('returns null while working and on the y/n trap', () => {
    expect(codexAdapter.detectPrompt(fx('codex-working'))).toBeNull();
    expect(codexAdapter.detectPrompt(fx('codex-trap-yn-in-output'))).toBeNull();
    expect(codexAdapter.promptStillVisible(fx('codex-trap-yn-in-output'))).toBe(false);
  });
  it('keys: y / n, reply text then Enter, interrupt C-c', () => {
    const perm = { kind: 'permission' as const, text: 'x', source: 'pane' as const };
    expect(codexAdapter.keysFor('accept', perm)).toEqual([{ text: 'y' }]);
    expect(codexAdapter.keysFor('deny', perm)).toEqual([{ text: 'n' }]);
    expect(codexAdapter.replyPlan('shadow table')).toEqual([{ text: 'shadow table' }, { keys: ['Enter'] }]);
    expect(codexAdapter.interruptKeys()).toEqual(['C-c']);
    expect(adapterFor('codex')).toBe(codexAdapter);
  });
});
```

Append to `setup.test.ts`:
```ts
import { mergeCodexNotify } from '../src/cli/setup.js';
describe('mergeCodexNotify', () => {
  it('appends notify when absent and is idempotent', () => {
    const r = mergeCodexNotify('model = "gpt-5-codex"\n');
    expect(r.changed).toBe(true); expect(r.toml).toContain('notify = ["ledge", "hook", "codex-notify"]');
    expect(mergeCodexNotify(r.toml).changed).toBe(false);
  });
  it('leaves a foreign notify alone', () => {
    const r = mergeCodexNotify('notify = ["other-tool"]\n');
    expect(r.changed).toBe(false); expect(r.toml).toBe('notify = ["other-tool"]\n');
  });
});
```

Append to `hook.test.ts`:
```ts
import { mapCodexNotify } from '../src/cli/hook.js';
describe('mapCodexNotify', () => {
  it('maps agent-turn-complete to Stop with the last message, id from LEDGE_SESSION', () => {
    process.env.LEDGE_SESSION = 'c1';
    const m = mapCodexNotify({ type: 'agent-turn-complete', 'turn-id': 't', 'last-assistant-message': 'Done: three findings.' }, at);
    expect(m).toEqual({ id: 'c1', event: { name: 'Stop', at, source: 'hook', text: 'Done: three findings.' } });
    delete process.env.LEDGE_SESSION;
    expect(mapCodexNotify({ type: 'agent-turn-complete' }, at)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter ledge test codex setup hook`
Expected: FAIL.

- [ ] **Step 4: Implement**

`packages/ledge/src/adapters/codex.ts`:
```ts
import type { Adapter, PanePromptMatch } from './types.js';

// Codex's own approval box: an indented "$ <cmd>" line followed, within 3 lines, by an indented "Allow command? [y/n]" line.
const APPROVAL = /^\s{2,}\$\s(.+)\n(?:.*\n){0,2}\s{2,}Allow command\?\s\[y\/n\]\s*$/m;
const WORKING = /^•\sWorking\s\(/m;
const EMPTY_PROMPT = /^›\s*$/m;

function detectPrompt(pane: string): PanePromptMatch | null {
  const trimmed = pane.replace(/\s+$/, '');
  const a = trimmed.match(APPROVAL);
  if (a && !WORKING.test(trimmed.slice(a.index))) return { kind: 'permission', text: a[1]!.trim() };
  if (EMPTY_PROMPT.test(trimmed) && !WORKING.test(trimmed)) {
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    const q = [...lines].reverse().find(l => l.endsWith('?') && !l.startsWith('›') && !l.startsWith('$'));
    if (q) return { kind: 'question', text: q };
  }
  return null;
}

export const codexAdapter: Adapter = {
  tool: 'codex',
  detectPrompt,
  promptStillVisible: pane => APPROVAL.test(pane.replace(/\s+$/, '')),
  keysFor: decision => [{ text: decision === 'accept' ? 'y' : 'n' }],
  replyPlan: text => [{ text: text.replace(/\s*\n\s*/g, ' ').trim() }, { keys: ['Enter'] }],
  interruptKeys: () => ['C-c']
};
```

In `adapters/index.ts` add `if (tool === 'codex') return codexAdapter;`. In the server's `runPlan` (Plan 1 Task 7) a `{ text }` step followed by `{ keys: ['Enter'] }` already sends them as two tmux calls; add a 50 ms `sleep` between a text step and a following keys step so Codex's TUI takes the paste first.

`setup.ts` additions:
```ts
export function mergeCodexNotify(toml: string): { toml: string; changed: boolean } {
  if (/^\s*notify\s*=/m.test(toml)) return { toml, changed: false };
  const sep = toml.length && !toml.endsWith('\n') ? '\n' : '';
  return { toml: `${toml}${sep}notify = ["ledge", "hook", "codex-notify"]\n`, changed: true };
}
```
and in `runSetup`: read `~/.codex/config.toml` (missing → `''`), merge, write when changed, print "Codex notify added" / "Codex notify already present" / "Codex already has a notify command; add `ledge hook codex-notify` to it by hand" (when a foreign notify exists).

`hook.ts` additions:
```ts
export function mapCodexNotify(payload: unknown, at: string): { id: string; event: SessionEvent } | null {
  const id = process.env.LEDGE_SESSION; if (!id || !payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== 'agent-turn-complete') return null;
  return { id, event: { name: 'Stop', at, source: 'hook', text: typeof p['last-assistant-message'] === 'string' ? p['last-assistant-message'] : undefined } };
}
```
and in `runHook`: when `eventName === 'codex-notify'` parse the payload from `argv` (Codex passes the JSON as the last argument, not stdin: read `process.argv.at(-1)` in the CLI and pass it as `stdin` to `runHook`) and use `mapCodexNotify`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ledge
git commit -m "feat(adapters): Codex adapter, notify setup and turn-complete mapping"
```

---

### Task 2: Report, activity and files changed on the daemon side

**Files:**
- Create: `packages/ledge/src/transcript.ts`
- Modify: `packages/ledge/src/daemon/state.ts`, `packages/ledge/src/cli/hook.ts`, `packages/ledge/src/cli/setup.ts` (add `PostToolUse` to `CLAUDE_EVENTS`)
- Test: `packages/ledge/test/transcript.test.ts`, extend `state.test.ts`, `hook.test.ts`

**Interfaces:**
- Produces: `lastAssistantMessage(transcriptPath: string): Promise<string | null>` reading a Claude Code JSONL transcript from the end (last 64 KB), returning the text of the last `assistant` message's text blocks joined by `\n\n`, or `null` when the file is missing or no line parses.
- Reducer additions: `Stop` with `text` sets `activity = { kind: 'message', text }`; `PreToolUse` with `tool === 'Bash'` sets `activity = { kind: 'command', text, startedAt: at }`; `PostToolUse` with `tool` in `Edit | Write | MultiEdit` appends `{ path, kind: 'M' | 'A' }` to `filesChanged` (dedupe by path; `Write` on a new path is `A`); `PostToolUse` with `tool === 'Bash'` and `text` matching `/(\d+) passed/` sets `testsPassed`; `Decided` keeps `activity` as `command` when the pending was a permission for Bash (the command now runs).
- Hook mapping additions: `Stop` reads `transcript_path` from the payload and attaches the last assistant message as `text` (best effort, 100 ms budget, never blocks exit); `PostToolUse` maps `tool_name`, `tool_input.file_path`, and for Bash the first 2 000 chars of `tool_response` as `text`.

- [ ] **Step 1: Write the failing tests**

`packages/ledge/test/transcript.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAssistantMessage } from '../src/transcript.js';

const line = (role: string, text: string) => JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } });
describe('lastAssistantMessage', () => {
  it('returns the last assistant text, joining blocks', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'tr-')), 't.jsonl');
    writeFileSync(p, [line('user', 'hi'), line('assistant', 'first'), line('user', 'go'), JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Daemon review' }, { type: 'tool_use', name: 'Read' }, { type: 'text', text: 'three findings' }] } })].join('\n') + '\n');
    expect(await lastAssistantMessage(p)).toBe('Daemon review\n\nthree findings');
  });
  it('tolerates a truncated last line and returns the previous message', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'tr-')), 't.jsonl');
    writeFileSync(p, line('assistant', 'complete') + '\n' + '{"type":"assistant","message":{"con');
    expect(await lastAssistantMessage(p)).toBe('complete');
  });
  it('returns null when missing or unparseable', async () => {
    expect(await lastAssistantMessage('/nonexistent/t.jsonl')).toBeNull();
    const p = join(mkdtempSync(join(tmpdir(), 'tr-')), 't.jsonl'); writeFileSync(p, 'garbage\n');
    expect(await lastAssistantMessage(p)).toBeNull();
  });
});
```

Append to `state.test.ts`:
```ts
describe('reduce: activity, files, tests', () => {
  it('Stop with text becomes a message activity', () => {
    const n = reduce(session('working'), ev('Stop', { text: 'Report: 3 findings' }));
    expect(n.activity).toEqual({ kind: 'message', text: 'Report: 3 findings' });
  });
  it('PreToolUse Bash becomes a running command; Decided on a Bash permission keeps it', () => {
    const n = reduce(session('working'), ev('PreToolUse', { tool: 'Bash', text: 'npm test' }));
    expect(n.activity).toEqual({ kind: 'command', text: 'npm test', startedAt: later(5000) });
    const p = reduce(n, ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    expect(reduce(p, ev('Decided', { source: 'daemon' })).activity?.kind).toBe('command');
  });
  it('PostToolUse Edit/Write accumulate files, Bash test output sets testsPassed', () => {
    let s = reduce(session('working'), ev('PostToolUse', { tool: 'Edit', path: 'src/a.ts' }));
    s = reduce(s, ev('PostToolUse', { tool: 'Write', path: 'src/new.ts' }));
    s = reduce(s, ev('PostToolUse', { tool: 'Edit', path: 'src/a.ts' }));
    expect(s.filesChanged).toEqual([{ path: 'src/a.ts', kind: 'M' }, { path: 'src/new.ts', kind: 'A' }]);
    s = reduce(s, ev('PostToolUse', { tool: 'Bash', text: 'Tests: 48 passed, 48 total' }));
    expect(s.testsPassed).toBe(48);
  });
});
```

Append to `hook.test.ts`:
```ts
it('maps PostToolUse with the file path and the first 2000 chars of a Bash response', () => {
  const m = mapClaudeHook('PostToolUse', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: 'x'.repeat(5000) }, at);
  expect(m?.event.name).toBe('PostToolUse'); expect(m?.event.text?.length).toBe(2000);
  expect(mapClaudeHook('PostToolUse', { session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts' } }, at)?.event.path).toBe('/w/a.ts');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test transcript state hook`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/ledge/src/transcript.ts`:
```ts
import { open } from 'node:fs/promises';

export async function lastAssistantMessage(path: string): Promise<string | null> {
  let fh; try { fh = await open(path, 'r'); } catch { return null; }
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!.trim(); if (!l) continue;
      let j: unknown; try { j = JSON.parse(l); } catch { continue; }
      const m = (j as { type?: string; message?: { role?: string; content?: Array<{ type: string; text?: string }> | string } });
      if (m.type !== 'assistant' && m.message?.role !== 'assistant') continue;
      const c = m.message?.content;
      const text = typeof c === 'string' ? c : (c ?? []).filter(b => b.type === 'text' && b.text).map(b => b.text!.trim()).join('\n\n');
      if (text) return text;
    }
    return null;
  } finally { await fh.close(); }
}
```

Reducer additions in `state.ts` (inside the existing `switch`, before the generic hook branch, and in `Stop`/`Decided`):
```ts
    case 'PostToolUse': {
      let next = s;
      if ((ev.tool === 'Edit' || ev.tool === 'Write' || ev.tool === 'MultiEdit') && ev.path) {
        const files = s.filesChanged.filter(f => f.path !== ev.path);
        const prev = s.filesChanged.find(f => f.path === ev.path);
        next = { ...next, filesChanged: [...files, { path: ev.path, kind: prev?.kind ?? (ev.tool === 'Write' ? 'A' : 'M') }] };
      }
      if (ev.tool === 'Bash') {
        const m = ev.text?.match(/(\d+)\s+passed/);
        next = { ...next, activity: { kind: 'none', text: '' }, ...(m ? { testsPassed: Number(m[1]) } : {}) };
      }
      return next === s ? s : { ...next, lastHookAt: at, lastActivityAt: at };
    }
```
In `Stop`: `return { ...s, state: 'idle', lastHookAt: at, lastActivityAt: at, activity: ev.text ? { kind: 'message', text: ev.text } : s.activity };`. In the generic hook branch when `ev.name === 'PreToolUse' && ev.tool === 'Bash'`: include `activity: { kind: 'command', text: ev.text ?? '', startedAt: at }`. In `Decided`: keep `activity` unchanged (it already is).

`hook.ts` additions: in `mapClaudeHook`, `case 'PostToolUse'`: `return { id, event: { name: 'PostToolUse', ...base, tool, path: str((p.tool_input as Payload)?.file_path), text: typeof p.tool_response === 'string' ? p.tool_response.slice(0, 2000) : JSON.stringify(p.tool_response ?? '').slice(0, 2000) } }`. For `Stop`, `runHook` becomes async-aware: after mapping, if the event is `Stop` and `payload.transcript_path` is a string, `await Promise.race([lastAssistantMessage(path), sleep(100)])` and set `event.text` when a string came back. Add `'PostToolUse'` to `CLAUDE_EVENTS` in `setup.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): activity, files changed, tests passed and the last assistant message"
```

---

### Task 3: Cursor Agent adapter, hooks setup and sub-agent helpers

**Files:**
- Create: `packages/ledge/src/adapters/cursor.ts`, fixtures `cursor-permission.txt`, `cursor-working.txt`, `cursor-trap-allow-in-file.txt`
- Modify: `packages/ledge/src/adapters/index.ts`, `src/cli/setup.ts`, `src/cli/hook.ts`, `src/daemon/state.ts`
- Test: `packages/ledge/test/adapters-cursor.test.ts`, extend `setup.test.ts`, `hook.test.ts`, `state.test.ts`

**Interfaces:**
- `cursorAdapter: Adapter` (`tool: 'cursor'`): approval box lines start with `Allow ` or `Run `… at column 0 followed by `(y/n)` on the same or next line; accept `y`, deny `n`, reply text + Enter, interrupt `C-c`.
- `mergeCursorHooks(json: unknown): { hooks: object; changed: boolean }` appending `{ "command": "ledge hook CursorBeforeShell" }`, `CursorAfterFileEdit`, `CursorStop` under `hooks.beforeShellExecution`, `hooks.afterFileEdit`, `hooks.stop` (arrays created when missing, foreign entries kept, idempotent).
- `mapCursorHook(eventName, payload, at)`: `CursorBeforeShell` → `PermissionRequest` with `tool: 'Bash'`, `text: payload.command`; `CursorAfterFileEdit` → `PostToolUse` with `tool: 'Edit'`, `path: payload.file_path`; `CursorStop` → `Stop` with `text: payload.summary` when present. Id from `LEDGE_SESSION`, else `payload.conversation_id`.
- Helpers: Claude Code hooks `SubagentStart` (`{ agent_id, agent_type, description }`) → event `SubagentStart` with `helperId`, `helperKind`, `text`; `SubagentStop` → `SubagentStop` with `helperId`. Reducer: `SubagentStart` appends `{ id, kind, task, state: 'working' }` to `helpers` (dedupe by id); `SubagentStop` sets that helper's `state: 'exited'` and removes it 60 s later (the poller's retire pass drops exited helpers older than 60 s using a `helperExitedAt` map it keeps); a `PermissionRequest` whose payload carries `agent_id` sets `pending.helperId` and the matching helper's `state: 'waiting_permission'`; `Decided` restores that helper to `working`; `SessionEnd` clears helpers. Add `SubagentStart`, `SubagentStop` to `CLAUDE_EVENTS`.

- [ ] **Step 1: Record fixtures**

`cursor-permission.txt`:
```
Editing src/features/orders/ui/OrderTable.tsx
Running vitest for src/features/orders

Allow running: vitest --run src/features/orders  (y/n)
```
`cursor-working.txt`:
```
Editing src/features/orders/ui/OrderTable.tsx
Thinking…
```
`cursor-trap-allow-in-file.txt`:
```
Reading docs/permissions.md
  The dialog says: Allow running: rm -rf  (y/n)
  Users should decline.
Thinking…
```

- [ ] **Step 2: Write the failing tests**

`packages/ledge/test/adapters-cursor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cursorAdapter } from '../src/adapters/cursor.js';
const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
describe('cursor adapter', () => {
  it('detects an approval anchored at column 0 and extracts the command', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-permission'))).toEqual({ kind: 'permission', text: 'vitest --run src/features/orders' });
  });
  it('ignores indented quotes of the prompt and the working state', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-trap-allow-in-file'))).toBeNull();
    expect(cursorAdapter.detectPrompt(fx('cursor-working'))).toBeNull();
  });
  it('keys', () => {
    const perm = { kind: 'permission' as const, text: 'x', source: 'hook' as const };
    expect(cursorAdapter.keysFor('accept', perm)).toEqual([{ text: 'y' }]);
    expect(cursorAdapter.keysFor('deny', perm)).toEqual([{ text: 'n' }]);
    expect(cursorAdapter.interruptKeys()).toEqual(['C-c']);
  });
});
```

Append to `setup.test.ts`:
```ts
import { mergeCursorHooks } from '../src/cli/setup.js';
describe('mergeCursorHooks', () => {
  it('appends ledge commands, keeps foreign ones, idempotent', () => {
    const r = mergeCursorHooks({ hooks: { beforeShellExecution: [{ command: '/other' }] } });
    const h = (r.hooks as { hooks: Record<string, Array<{ command: string }>> }).hooks;
    expect(h.beforeShellExecution!.map(x => x.command)).toEqual(['/other', 'ledge hook CursorBeforeShell']);
    expect(h.afterFileEdit![0]!.command).toBe('ledge hook CursorAfterFileEdit');
    expect(h.stop![0]!.command).toBe('ledge hook CursorStop');
    expect(mergeCursorHooks(r.hooks).changed).toBe(false);
  });
});
```

Append to `hook.test.ts`:
```ts
import { mapCursorHook } from '../src/cli/hook.js';
describe('mapCursorHook and helpers', () => {
  it('maps the three Cursor events', () => {
    process.env.LEDGE_SESSION = 'u1';
    expect(mapCursorHook('CursorBeforeShell', { command: 'vitest --run' }, at)?.event).toEqual({ name: 'PermissionRequest', at, source: 'hook', tool: 'Bash', text: 'vitest --run' });
    expect(mapCursorHook('CursorAfterFileEdit', { file_path: '/w/a.tsx' }, at)?.event).toMatchObject({ name: 'PostToolUse', tool: 'Edit', path: '/w/a.tsx' });
    expect(mapCursorHook('CursorStop', { summary: 'done' }, at)?.event).toMatchObject({ name: 'Stop', text: 'done' });
    delete process.env.LEDGE_SESSION;
  });
  it('maps SubagentStart/Stop and a helper permission', () => {
    expect(mapClaudeHook('SubagentStart', { session_id: 's', agent_id: 'h1', agent_type: 'Explore', description: 'find consumers' }, at)?.event).toEqual({ name: 'SubagentStart', at, source: 'hook', helperId: 'h1', helperKind: 'Explore', text: 'find consumers' });
    expect(mapClaudeHook('SubagentStop', { session_id: 's', agent_id: 'h1' }, at)?.event).toEqual({ name: 'SubagentStop', at, source: 'hook', helperId: 'h1' });
    expect(mapClaudeHook('PermissionRequest', { session_id: 's', agent_id: 'h1', tool_name: 'Bash', tool_input: { command: 'npm test' } }, at)?.event.helperId).toBe('h1');
  });
});
```

Append to `state.test.ts`:
```ts
describe('reduce: helpers', () => {
  it('tracks helpers and a helper permission on the parent', () => {
    let s = reduce(session('working'), ev('SubagentStart', { helperId: 'h1', helperKind: 'Explore', text: 'find consumers' }));
    expect(s.helpers).toEqual([{ id: 'h1', kind: 'Explore', task: 'find consumers', state: 'working' }]);
    s = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'h1' }));
    expect(s.state).toBe('waiting_permission'); expect(s.pending?.helperId).toBe('h1'); expect(s.helpers[0]!.state).toBe('waiting_permission');
    s = reduce(s, ev('Decided', { source: 'daemon' }));
    expect(s.helpers[0]!.state).toBe('working');
    s = reduce(s, ev('SubagentStop', { helperId: 'h1' }));
    expect(s.helpers[0]!.state).toBe('exited');
    expect(reduce(s, ev('SessionEnd', { exitCode: 0 })).helpers).toEqual([]);
  });
  it('a helper permission does not erase a different pending on the parent', () => {
    let s = reduce(session('working'), ev('PermissionRequest', { tool: 'Edit', text: 'src/a.ts' }));
    s = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'h1' }));
    expect(s.pending?.text).toBe('src/a.ts');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter ledge test cursor setup hook state`
Expected: FAIL.

- [ ] **Step 4: Implement**

`packages/ledge/src/adapters/cursor.ts`:
```ts
import type { Adapter, PanePromptMatch } from './types.js';
const APPROVAL = /^(?:Allow|Run)(?: running)?:\s(.+?)\s+\(y\/n\)\s*$/m;
export const cursorAdapter: Adapter = {
  tool: 'cursor',
  detectPrompt(pane): PanePromptMatch | null {
    const m = pane.replace(/\s+$/, '').match(APPROVAL);
    return m ? { kind: 'permission', text: m[1]!.trim() } : null;
  },
  promptStillVisible: pane => APPROVAL.test(pane.replace(/\s+$/, '')),
  keysFor: decision => [{ text: decision === 'accept' ? 'y' : 'n' }],
  replyPlan: text => [{ text: text.replace(/\s*\n\s*/g, ' ').trim() }, { keys: ['Enter'] }],
  interruptKeys: () => ['C-c']
};
```
Register in `adapters/index.ts`.

`setup.ts`:
```ts
export const CURSOR_HOOKS: Array<[string, string]> = [['beforeShellExecution', 'CursorBeforeShell'], ['afterFileEdit', 'CursorAfterFileEdit'], ['stop', 'CursorStop']];
export function mergeCursorHooks(json: unknown): { hooks: object; changed: boolean } {
  const base = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const hooks = { ...((base.hooks as Record<string, Array<{ command: string }>> | undefined) ?? {}) };
  let changed = false;
  for (const [key, ev] of CURSOR_HOOKS) {
    const cmd = `ledge hook ${ev}`; const list = [...(hooks[key] ?? [])];
    if (!list.some(h => h.command === cmd)) { list.push({ command: cmd }); changed = true; }
    hooks[key] = list;
  }
  return { hooks: { ...base, version: (base.version as number | undefined) ?? 1, hooks }, changed };
}
```
and in `runSetup`: read `~/.cursor/hooks.json` (missing → `{}`), merge, write when changed, print the outcome.

`hook.ts`: `mapCursorHook` as specified (id from `LEDGE_SESSION` else `payload.conversation_id`), plus in `mapClaudeHook`: `SubagentStart`/`SubagentStop` cases and `helperId: str(p.agent_id)` on `PermissionRequest` and `PreToolUse`. In `runHook`, route `eventName.startsWith('Cursor')` to `mapCursorHook`.

`state.ts`: add `SubagentStart`/`SubagentStop` cases; in the pending branch, when `ev.helperId` and `s.pending && !s.pending.helperId`, keep `s.pending` (parent's own ask wins) but still mark the helper `waiting_permission`; otherwise set `pending.helperId = ev.helperId`. In `Decided`, update only the helper whose ID matched the resolved `pending.helperId`, leaving other waiting helpers intact. A helper decision never completes the parent or clears a different parent request. In `SessionEnd`/`PaneGone`, `helpers: []`. Add a reducer test with two waiting helpers and a distinct parent request; exactly the confirmed target is updated.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter ledge test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ledge
git commit -m "feat(adapters): Cursor Agent adapter and hooks, sub-agent helpers on the parent bot"
```

---

### Task 4: Diff, plan and report cards (overlay)

**Files:**
- Create: `apps/overlay/src/surface/cards/DiffCard.tsx`, `PlanCard.tsx`, `ReportCard.tsx`, `apps/overlay/src/surface/viewFor.ts`, `apps/overlay/src/markdown.ts`
- Modify: `apps/overlay/src/surface/SessionView.tsx` (choose the card with `viewFor`), `packages/ledge/src/cli/hook.ts` (diff and plan `detail`)
- Test: `apps/overlay/test/cards.test.tsx`, `apps/overlay/test/viewFor.test.ts`, extend `packages/ledge/test/hook.test.ts`

**Interfaces:**
- Daemon: `PermissionRequest` for `Edit` carries `detail` = a unified-diff-like text built from `tool_input.old_string`/`new_string` (`-` lines then `+` lines, max 400 lines, then `… N more lines, open the tab`); for `Write` on a new file, every line as `+`; `PreToolUse ExitPlanMode` carries `detail` = `tool_input.plan` (the markdown).
- Overlay: `viewFor(session): 'permission' | 'diff' | 'question' | 'plan' | 'report' | 'command' | 'finished' | 'idle'` (pending kind first; else `activity.kind === 'command'` → `command`; `state === 'exited'` → `finished`; `activity.kind === 'message'` → `report`; else `idle`).
- `parseDiff(detail: string): Array<{ file: string; hunks: Array<{ header: string; lines: Array<{ kind: ' ' | '+' | '-'; text: string; n?: number }> }> }>`; `<DiffCard pending onDecide />` with collapsible file headers (`aria-expanded`), `+N −M` counts, lines wrap; `<PlanCard pending onDecide onChange />` renders the plan's markdown headings and list items as numbered steps with "Change it" (sends `deny`) and "Approve plan" (`accept`); `<ReportCard text onReply quick: string[] />` renders a safe markdown subset via `renderMarkdown(text): Block[]` (`h1-h3`, `p`, `ul`/`ol`, fenced code, inline code; no raw HTML) with quick-reply chips `['Go ahead', 'Explain more', 'Later']` that send `onReply(text)`, and "message unavailable, open the tab" when `text` is empty.

- [ ] **Step 1: Write the failing tests**

`apps/overlay/test/viewFor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { viewFor } from '../src/surface/viewFor';
import { fakeSession } from './mockDaemon';
describe('viewFor', () => {
  it('picks the pending kind first, then activity, then exit', () => {
    expect(viewFor(fakeSession('a', { state: 'waiting_permission', pending: { kind: 'diff', text: 'a.ts', source: 'hook' } }))).toBe('diff');
    expect(viewFor(fakeSession('a', { state: 'waiting_permission', pending: { kind: 'plan', text: 'p', source: 'hook' } }))).toBe('plan');
    expect(viewFor(fakeSession('a', { activity: { kind: 'command', text: 'npm test', startedAt: '2026-10-09T18:00:00.000Z' } }))).toBe('command');
    expect(viewFor(fakeSession('a', { state: 'idle', activity: { kind: 'message', text: 'Report' } }))).toBe('report');
    expect(viewFor(fakeSession('a', { state: 'exited', exitCode: 0 }))).toBe('finished');
    expect(viewFor(fakeSession('a'))).toBe('idle');
  });
});
```

`apps/overlay/test/cards.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffCard, parseDiff } from '../src/surface/cards/DiffCard';
import { PlanCard } from '../src/surface/cards/PlanCard';
import { ReportCard } from '../src/surface/cards/ReportCard';
import { renderMarkdown } from '../src/markdown';

const detail = `--- src/daemon/state.ts\n@@ -41,2 +41,8 @@\n-      return { ...s, state: 'waiting_permission',\n+      if (s.pending?.kind === 'permission') return s;\n+      return { ...s, state: 'waiting_permission',\n--- src/adapters/codex.ts\n@@ -13,2 +13,9 @@\n-    return { ok: true };\n+    for (let i = 0; i < 3; i++) {`;

describe('DiffCard', () => {
  it('parses files and hunks with counts', () => {
    const d = parseDiff(detail);
    expect(d.map(f => f.file)).toEqual(['src/daemon/state.ts', 'src/adapters/codex.ts']);
    expect(d[0]!.hunks[0]!.lines.filter(l => l.kind === '+').length).toBe(2);
  });
  it('renders collapsible files, the first open, and sends decisions', () => {
    const onDecide = vi.fn();
    render(<DiffCard pending={{ kind: 'diff', text: '2 files', detail, source: 'hook' }} onDecide={onDecide} />);
    const headers = screen.getAllByRole('button', { name: /src\// });
    expect(headers[0]).toHaveAttribute('aria-expanded', 'true');
    expect(headers[1]).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(headers[1]!); expect(headers[1]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('+3')).toBeInTheDocument(); expect(screen.getByText('−2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' })); expect(onDecide).toHaveBeenCalledWith('accept');
  });
  it('caps at 400 lines with a trailing note', () => {
    const big = '--- big.ts\n@@ -1 +1 @@\n' + Array.from({ length: 1000 }, (_, i) => `+line ${i}`).join('\n');
    const { container } = render(<DiffCard pending={{ kind: 'diff', text: 'big', detail: big, source: 'hook' }} onDecide={() => {}} />);
    expect(container.querySelectorAll('[data-line]').length).toBe(400);
    expect(screen.getByText(/600 more lines, open the tab/)).toBeInTheDocument();
  });
});

describe('PlanCard', () => {
  it('lists steps from the plan markdown and offers Change it / Approve plan', () => {
    const onDecide = vi.fn();
    render(<PlanCard pending={{ kind: 'plan', text: 'Fix the findings', detail: '# Fix the findings\n\n1. Guard double entry\n2. Clear pending on exit\n\n## Out of scope\n- Cursor regex', source: 'hook' }} onDecide={onDecide} />);
    expect(screen.getByText('Guard double entry')).toBeInTheDocument();
    expect(screen.getByText(/Out of scope/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change it' })); expect(onDecide).toHaveBeenCalledWith('deny');
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' })); expect(onDecide).toHaveBeenCalledWith('accept');
  });
});

describe('ReportCard and markdown', () => {
  it('renders a safe subset and never raw html', () => {
    const blocks = renderMarkdown('## Title\n\nPara with `code` <script>x</script>\n\n- a\n- b\n\n```\nnpm test\n```');
    expect(blocks.map(b => b.type)).toEqual(['h2', 'p', 'ul', 'code']);
    const { container } = render(<ReportCard text={'## Title\n\n<script>alert(1)</script>'} onReply={() => {}} quick={['Go ahead']} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/<script>/)).toBeInTheDocument();
  });
  it('quick replies send their text; empty text shows the fallback', () => {
    const onReply = vi.fn();
    render(<ReportCard text="Done." onReply={onReply} quick={['Go ahead', 'Later']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go ahead' })); expect(onReply).toHaveBeenCalledWith('Go ahead');
    render(<ReportCard text="" onReply={onReply} quick={[]} />);
    expect(screen.getByText(/message unavailable, open the tab/)).toBeInTheDocument();
  });
});
```

Append to `packages/ledge/test/hook.test.ts`:
```ts
it('builds a diff detail for Edit and Write, capped at 400 lines', () => {
  const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' } }, at);
  expect(m?.event.detail).toBe('--- /w/a.ts\n@@ -1,2 +1,3 @@\n-a\n-b\n+a\n+c\n+d');
  const w = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Write', tool_input: { file_path: '/w/n.ts', content: Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n') } }, at);
  expect(w?.event.detail!.split('\n').length).toBe(2 + 400 + 1);
  expect(w?.event.detail!.endsWith('… 100 more lines, open the tab')).toBe(true);
  const p = mapClaudeHook('PreToolUse', { session_id: 's', tool_name: 'ExitPlanMode', tool_input: { plan: '# Plan\n1. a' } }, at);
  expect(p?.event.detail).toBe('# Plan\n1. a');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay test cards viewFor && pnpm --filter ledge test hook`
Expected: FAIL.

- [ ] **Step 3: Implement the daemon side**

In `hook.ts` add:
```ts
const CAP = 400;
function capLines(lines: string[]): string { return lines.length <= CAP ? lines.join('\n') : [...lines.slice(0, CAP), `… ${lines.length - CAP} more lines, open the tab`].join('\n'); }
export function diffDetail(tool: string | undefined, input: unknown): string | undefined {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const file = typeof i.file_path === 'string' ? i.file_path : 'file';
  if (tool === 'Edit' || tool === 'MultiEdit') {
    const old = String(i.old_string ?? '').split('\n'), neu = String(i.new_string ?? '').split('\n');
    return capLines([`--- ${file}`, `@@ -1,${old.length} +1,${neu.length} @@`, ...old.map(l => `-${l}`), ...neu.map(l => `+${l}`)]);
  }
  if (tool === 'Write') { const lines = String(i.content ?? '').split('\n'); return capLines([`--- ${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)]); }
  if (tool === 'ExitPlanMode') return typeof i.plan === 'string' ? i.plan : undefined;
  return undefined;
}
```
and set `detail: diffDetail(tool, p.tool_input)` on `PermissionRequest` and on `PreToolUse` for `ExitPlanMode`. In `state.ts`'s `pendingFor`, copy `ev.detail` into the pending (`detail: ev.detail`).

- [ ] **Step 4: Implement the overlay side**

`apps/overlay/src/surface/viewFor.ts`:
```ts
import type { Session } from '@ledge/protocol';
export type View = 'permission' | 'diff' | 'question' | 'plan' | 'report' | 'command' | 'finished' | 'idle';
export function viewFor(s: Session): View {
  if (s.pending) return s.pending.kind;
  if (s.state === 'exited') return 'finished';
  if (s.activity?.kind === 'command') return 'command';
  if (s.activity?.kind === 'message') return 'report';
  return 'idle';
}
```

`apps/overlay/src/markdown.ts`:
```ts
export type Block = { type: 'h1' | 'h2' | 'h3' | 'p'; text: string } | { type: 'ul' | 'ol'; items: string[] } | { type: 'code'; text: string };
export function renderMarkdown(src: string): Block[] {
  const out: Block[] = []; const lines = src.replace(/\r/g, '').split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) { const buf: string[] = []; i++; while (i < lines.length && !lines[i]!.startsWith('```')) buf.push(lines[i++]!); i++; out.push({ type: 'code', text: buf.join('\n') }); continue; }
    const h = l.match(/^(#{1,3})\s+(.*)$/); if (h) { out.push({ type: `h${h[1]!.length}` as 'h1' | 'h2' | 'h3', text: h[2]! }); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*]\s+/, '')); out.push({ type: 'ul', items }); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d+[.)]\s+/, '')); out.push({ type: 'ol', items }); continue; }
    const buf: string[] = []; while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i]!)) buf.push(lines[i++]!);
    out.push({ type: 'p', text: buf.join(' ') });
  }
  return out;
}
/** Inline: `code` only; everything else stays literal text (React escapes it). */
export function inline(text: string): Array<{ code: boolean; text: string }> {
  return text.split(/(`[^`]+`)/).filter(Boolean).map(t => t.startsWith('`') && t.endsWith('`') ? { code: true, text: t.slice(1, -1) } : { code: false, text: t });
}
```

`apps/overlay/src/surface/cards/DiffCard.tsx`:
```tsx
import { useState } from 'react';
import type { Pending } from '@ledge/protocol';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { transition } from '../../motion';

export interface DiffFile { file: string; hunks: Array<{ header: string; lines: Array<{ kind: ' ' | '+' | '-'; text: string }> }> }
export function parseDiff(detail: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const raw of detail.split('\n')) {
    if (raw.startsWith('--- ')) { files.push({ file: raw.slice(4), hunks: [] }); continue; }
    const f = files.at(-1); if (!f) continue;
    if (raw.startsWith('@@')) { f.hunks.push({ header: raw, lines: [] }); continue; }
    const h = f.hunks.at(-1) ?? (f.hunks.push({ header: '', lines: [] }), f.hunks.at(-1)!);
    const kind = raw[0] === '+' ? '+' : raw[0] === '-' ? '-' : ' ';
    h.lines.push({ kind, text: kind === ' ' ? raw : raw.slice(1) });
  }
  return files;
}
const CAP = 400;
export function DiffCard({ pending, onDecide }: { pending: Pending; onDecide: (d: 'accept' | 'deny') => void }) {
  const files = parseDiff(pending.detail ?? '');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (i: number, f: string) => open[f] ?? i === 0;
  let budget = CAP; const total = files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.length, 0), 0);
  const adds = files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.filter(l => l.kind === '+').length, 0), 0);
  const dels = files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.filter(l => l.kind === '-').length, 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderBottom: '1px solid var(--sidebar-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Badge state="approval" label="Approval needed" /><span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{files.length} files · <span style={{ color: 'var(--success)' }}>+{adds}</span> <span style={{ color: 'var(--danger-text)' }}>−{dels}</span></span></div>
      <div className="mono" style={{ background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', fontSize: 12, lineHeight: '19px' }}>
        {files.map((f, i) => {
          const o = isOpen(i, f.file);
          return (
            <div key={f.file}>
              <button type="button" aria-expanded={o} onClick={() => setOpen(x => ({ ...x, [f.file]: !o }))} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 32, padding: '0 10px', background: 'var(--sidebar)', border: 'none', borderBottom: '1px solid var(--border)', color: 'inherit', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${o ? 90 : 0}deg)`, transition: transition([['transform', 'hover']]) }}><path d="m9 18 6-6-6-6" /></svg>
                <span style={{ flexGrow: 1 }}>{f.file}</span>
              </button>
              <div style={{ maxHeight: o ? 4000 : 0, overflow: 'hidden', transition: transition([['max-height', o ? 'grow' : 'shrink', 0]]) }}>
                {f.hunks.map((h, j) => (
                  <div key={j}>
                    {h.header && <div style={{ padding: '3px 10px', background: 'var(--sidebar)', color: 'var(--info)', fontSize: 11 }}>{h.header}</div>}
                    {h.lines.map((l, k) => { if (budget <= 0) return null; budget--; return (
                      <div key={k} data-line style={{ display: 'flex', padding: '0 10px', background: l.kind === '+' ? 'color-mix(in oklch, var(--status-success-soft) 60%, transparent)' : l.kind === '-' ? 'color-mix(in oklch, var(--status-danger-soft) 60%, transparent)' : 'transparent', color: l.kind === '+' ? 'var(--success)' : l.kind === '-' ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>
                        <span style={{ width: 12, flexShrink: 0 }}>{l.kind === ' ' ? '' : l.kind}</span><span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 }}>{l.text}</span>
                      </div>); })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {total > CAP && <div style={{ padding: '6px 10px', color: 'var(--muted-foreground)', fontSize: 11 }}>… {total - CAP} more lines, open the tab</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" size="sm" disabled title="Scoped authorization is not supported by this adapter">Always for these files</Button><span style={{ flexGrow: 1 }} />
        <Button variant="outline" onClick={() => onDecide('deny')}>Deny</Button>
        <Button variant="primary" onClick={() => onDecide('accept')}>Approve</Button>
      </div>
    </div>
  );
}
```

`apps/overlay/src/surface/cards/PlanCard.tsx`:
```tsx
import type { Pending } from '@ledge/protocol';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { renderMarkdown, inline } from '../../markdown';
export function PlanCard({ pending, onDecide }: { pending: Pending; onDecide: (d: 'accept' | 'deny') => void }) {
  const blocks = renderMarkdown(pending.detail ?? pending.text);
  const title = blocks.find(b => b.type === 'h1'); const steps = blocks.find(b => b.type === 'ol');
  const rest = blocks.filter(b => b !== title && b !== steps);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderBottom: '1px solid var(--sidebar-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Badge state="approval" label="Plan ready" /><span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{steps && steps.type === 'ol' ? `${steps.items.length} steps · ` : ''}approve to leave plan mode</span></div>
      <h3 style={{ margin: 0, fontSize: 16, lineHeight: '22px', fontWeight: 600 }}>{title && title.type === 'h1' ? title.text : pending.text}</h3>
      {steps && steps.type === 'ol' && (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.items.map((s, i) => <li key={i} style={{ display: 'flex', gap: 12, padding: '10px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}><span className="mono" style={{ width: 22, height: 22, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9999, background: 'var(--secondary)', fontSize: 11, fontWeight: 500 }}>{i + 1}</span><span style={{ fontSize: 13.5, lineHeight: '19px', fontWeight: 500 }}>{inline(s).map((p, k) => p.code ? <code key={k} className="mono" style={{ fontSize: 12, background: 'var(--muted)', padding: '1px 5px', borderRadius: 6 }}>{p.text}</code> : <span key={k}>{p.text}</span>)}</span></li>)}
        </ol>
      )}
      {rest.map((b, i) => b.type === 'h2' || b.type === 'h3' ? <div key={i} style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)' }}>{b.text}</div> : b.type === 'ul' ? <ul key={i} style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--muted-foreground)' }}>{b.items.map((it, k) => <li key={k}>{it}</li>)}</ul> : b.type === 'p' ? <p key={i} style={{ margin: 0, fontSize: 13, color: 'var(--muted-foreground)' }}>{b.text}</p> : null)}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="outline" onClick={() => onDecide('deny')}>Change it</Button>
        <Button variant="primary" onClick={() => onDecide('accept')}>Approve plan</Button>
      </div>
    </div>
  );
}
```

`apps/overlay/src/surface/cards/ReportCard.tsx`:
```tsx
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { renderMarkdown, inline } from '../../markdown';
const Inline = ({ text }: { text: string }) => <>{inline(text).map((p, k) => p.code ? <code key={k} className="mono" style={{ fontSize: 12.5, background: 'var(--muted)', padding: '1px 5px', borderRadius: 6 }}>{p.text}</code> : <span key={k}>{p.text}</span>)}</>;
export function ReportCard({ text, onReply, quick, reading = false }: { text: string; onReply: (t: string) => void; quick: string[]; reading?: boolean }) {
  const blocks = renderMarkdown(text);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderBottom: '1px solid var(--sidebar-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Badge state="question" label="Your turn" /><span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{text ? `${text.split(/\s+/).length} words` : ''}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', maxHeight: reading ? 'none' : 320, overflowY: reading ? 'visible' : 'auto', fontSize: 14, lineHeight: '21px' }}>
        {!text && <span style={{ color: 'var(--muted-foreground)' }}>message unavailable, open the tab</span>}
        {blocks.map((b, i) => b.type === 'code' ? <pre key={i} className="mono" style={{ margin: 0, padding: '10px 12px', background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.text}</pre>
          : b.type === 'ul' || b.type === 'ol' ? (b.type === 'ul' ? <ul key={i} style={{ margin: 0, paddingLeft: 20 }}>{b.items.map((it, k) => <li key={k}><Inline text={it} /></li>)}</ul> : <ol key={i} style={{ margin: 0, paddingLeft: 20 }}>{b.items.map((it, k) => <li key={k}><Inline text={it} /></li>)}</ol>)
          : b.type === 'p' ? <p key={i} style={{ margin: 0 }}><Inline text={b.text} /></p>
          : <div key={i} style={{ fontSize: b.type === 'h1' ? 18 : 15, lineHeight: '22px', fontWeight: 600, letterSpacing: '-0.01em' }}><Inline text={b.text} /></div>)}
      </div>
      {quick.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{quick.map(q => <Button key={q} variant="secondary" size="sm" style={{ borderRadius: 9999, height: 28, fontSize: 12 }} onClick={() => onReply(q)}>{q}</Button>)}</div>}
    </div>
  );
}
```

In `SessionView.tsx`, replace the inline permission/question markup with `viewFor(session)`: `'permission'` → the existing permission card extracted as `PermissionCard` (same markup, file `cards/PermissionCard.tsx`), `'question'` → `QuestionCard` (same markup extracted), `'diff'` → `DiffCard`, `'plan'` → `PlanCard`, `'report'` → `ReportCard` with `quick={['Go ahead', 'Explain more', 'Later']}` and `reading` from props; the fold wrapper (`data-ask`) stays around pending cards only. `measureSessionH` adds 320 for `report`, `min(4000, 40 + lines * 19)` capped by geometry for `diff`, `48 + steps * 48 + 80` for `plan`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter overlay test && pnpm --filter ledge test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/overlay packages/ledge
git commit -m "feat: diff, plan and report cards with capped detail and safe markdown"
```

---

### Task 5: Long command, finished summary and helpers in the session view

**Files:**
- Create: `apps/overlay/src/surface/cards/ActivityPanel.tsx`, `apps/overlay/src/surface/cards/HelpersPanel.tsx`
- Modify: `apps/overlay/src/surface/SessionView.tsx`, `apps/overlay/src/surface/SessionList.tsx` (mini helpers under the avatar)
- Test: `apps/overlay/test/activity.test.tsx`

**Interfaces:**
- `<ActivityPanel session now onInterrupt onFocus onDismiss />`: for `command` → badge `Running a command`, the command in a well, elapsed `m:ss` from `activity.startedAt`, an indeterminate 2 px sweep bar (`ledge-sweep` keyframes, stops when `lastActivityAt` is older than 30 s), the preview as the live tail, `Interrupt` with `Esc`; for `finished` → badge `Done` (or `Error` with the code), "<Name> retires in <N> min" with a 2 px bar at `(10 min − elapsed since exitedAt) / 10 min`, four stat tiles (session duration, files, tests ok, approvals = count of `Decided` is not tracked: show files and tests only, two tiles plus duration), the last message via `ReportCard` without quick replies, the files list with `M`/`A` markers, `Open terminal`, `Open terminal to relaunch` (calls `onFocus`), `Dismiss` (calls `onDismiss` → `back`).
- `<HelpersPanel helpers parentId tool theme onOpenHelper? />`: a tree with `├`/`└` connectors (the last row has no continuing line), 20 px bots (parent tool unless a verified helper tool is available, actual helper state, current theme, seed `${parentId}:${helper.id}`), kind · task, badge; a helper in `waiting_permission` is highlighted. In the list row, up to three 12 px bots are stacked under the 32 px avatar when `helpers.length > 0`, and the sub-line says `<n> helpers, <m> need you`. Task 9 adds the correctly routed helper request card.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/activity.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityPanel } from '../src/surface/cards/ActivityPanel';
import { HelpersPanel } from '../src/surface/cards/HelpersPanel';
import { fakeSession } from './mockDaemon';
const T = Date.parse('2026-10-09T18:02:14.000Z');

describe('ActivityPanel', () => {
  it('shows a running command with elapsed time and Interrupt', () => {
    const onInterrupt = vi.fn();
    render(<ActivityPanel session={fakeSession('a', { activity: { kind: 'command', text: 'npm test', startedAt: '2026-10-09T18:00:00.000Z' }, lastActivityAt: '2026-10-09T18:02:10.000Z' })} preview={['PASS a', 'RUNS b']} now={T} onInterrupt={onInterrupt} onFocus={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('Running a command')).toBeInTheDocument();
    expect(screen.getByText('2:14')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(document.querySelector('[data-sweep]')).toHaveAttribute('data-alive', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Interrupt/ })); expect(onInterrupt).toHaveBeenCalled();
  });
  it('shows the finished summary with retirement countdown, files and tests', () => {
    const s = fakeSession('a', { name: 'Nova', tool: 'cursor', state: 'exited', exitCode: 0, exitedAt: '2026-10-09T18:00:00.000Z', filesChanged: [{ path: 'src/a.tsx', kind: 'M' }, { path: 'src/b.ts', kind: 'A' }], testsPassed: 48, activity: { kind: 'message', text: 'Order table paginates server side.' } });
    const onFocus = vi.fn(), onDismiss = vi.fn();
    render(<ActivityPanel session={s} preview={[]} now={Date.parse('2026-10-09T18:03:00.000Z')} onInterrupt={() => {}} onFocus={onFocus} onDismiss={onDismiss} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText(/Nova retires in 7 min/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('src/b.ts')).toBeInTheDocument();
    expect(screen.getByText(/paginates server side/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal to relaunch' })); expect(onFocus).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })); expect(onDismiss).toHaveBeenCalled();
  });
  it('an exit code other than 0 shows Error with the code', () => {
    render(<ActivityPanel session={fakeSession('a', { state: 'exited', exitCode: 2, exitedAt: '2026-10-09T18:00:00.000Z' })} preview={[]} now={T} onInterrupt={() => {}} onFocus={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('Error · exit 2')).toBeInTheDocument();
  });
});

describe('HelpersPanel', () => {
  it('lists helpers with a tree and highlights the one that needs you', () => {
    const { container } = render(<HelpersPanel parentId="parent-a" tool="claude" theme="dark" helpers={[{ id: 'h1', kind: 'Explore', task: 'find consumers', state: 'working' }, { id: 'h2', kind: 'Plan', task: 'draft the table', state: 'waiting_permission' }]} />);
    expect(screen.getByText(/Explore · find consumers/)).toBeInTheDocument();
    const rows = container.querySelectorAll('[data-helper]');
    expect(rows[1]).toHaveAttribute('data-last', 'true');
    expect(rows[1]).toHaveAttribute('data-needs-you', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test activity`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/overlay/src/surface/cards/ActivityPanel.tsx`:
```tsx
import type { Session } from '@ledge/protocol';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Kbd } from '../../ui/Kbd';
import { ReportCard } from './ReportCard';
import { relativeTime } from '../../format';

const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const RETIRE_MS = 10 * 60 * 1000;
const well: React.CSSProperties = { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13, lineHeight: '20px', padding: '8px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' };

export function ActivityPanel({ session: s, preview, now, onInterrupt, onFocus, onDismiss }: { session: Session; preview: string[]; now: number; onInterrupt: () => void; onFocus: () => void; onDismiss: () => void }) {
  if (s.state === 'exited') {
    const left = Math.max(0, RETIRE_MS - (now - Date.parse(s.exitedAt ?? s.lastActivityAt)));
    const err = typeof s.exitCode === 'number' && s.exitCode !== 0;
    const tile = (v: string | number, l: string, color?: string) => <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}><span style={{ fontSize: 18, lineHeight: '22px', fontWeight: 600, letterSpacing: '-0.02em', color }}>{v}</span><span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{l}</span></div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Badge state={err ? 'error' : 'done'} label={err ? `Error · exit ${s.exitCode}` : 'Done'} /><span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{s.name} retires in {Math.ceil(left / 60000)} min</span></div>
        <div style={{ height: 2, borderRadius: 9999, background: 'var(--muted)', overflow: 'hidden' }}><div style={{ width: `${(left / RETIRE_MS) * 100}%`, height: '100%', background: 'var(--success)', opacity: .7 }} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>{tile(relativeTime(s.startedAt, Date.parse(s.exitedAt ?? s.lastActivityAt)), 'session')}{tile(s.filesChanged.length, 'files')}{tile(s.testsPassed ?? '–', 'tests ok', 'var(--success)')}</div>
        {s.activity?.kind === 'message' && <ReportCard text={s.activity.text} onReply={() => {}} quick={[]} />}
        {s.filesChanged.length > 0 && <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 16px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)' }}>{s.filesChanged.map(f => <div key={f.path} style={{ display: 'flex', gap: 8 }}><span style={{ width: 14, color: f.kind === 'A' ? 'var(--info)' : 'var(--success)' }}>{f.kind}</span><span>{f.path}</span></div>)}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button><span style={{ flexGrow: 1 }} /><Button variant="outline" onClick={onFocus}>Open terminal</Button><Button variant="secondary" onClick={onFocus}>Open terminal to relaunch</Button></div>
      </div>
    );
  }
  const a = s.activity!; const alive = now - Date.parse(s.lastActivityAt) < 30000;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Badge state="working" label="Running a command" /><span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>no approval needed</span><span style={{ flexGrow: 1 }} /><span className="mono" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{mmss(now - Date.parse(a.startedAt ?? s.lastActivityAt))}</span></div>
      <div style={{ ...well, display: 'flex', gap: 10 }}><span style={{ color: 'var(--muted-foreground)' }}>$</span><span style={{ flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.text}</span></div>
      <div data-sweep data-alive={alive ? 'true' : 'false'} style={{ height: 2, borderRadius: 9999, background: 'var(--muted)', overflow: 'hidden', position: 'relative' }}><div style={{ position: 'absolute', left: 0, top: 0, width: '25%', height: '100%', background: 'var(--info)', animation: alive ? 'ledge-sweep 1.6s linear infinite' : 'none' }} /></div>
      <pre className="mono" style={{ ...well, margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto' }}>{preview.join('\n')}</pre>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted-foreground)' }}><span>Interrupt sends Esc; the agent then asks what to do next.</span><span style={{ flexGrow: 1 }} /><Button variant="outline" size="sm" onClick={onInterrupt}>Interrupt <Kbd>Esc</Kbd></Button></div>
    </div>
  );
}
```
Add `@keyframes ledge-sweep { 0% { transform: translateX(-100%) } 100% { transform: translateX(400%) } }` to `base.css`.

`apps/overlay/src/surface/cards/HelpersPanel.tsx`:
```tsx
import type { Helper } from '@ledge/protocol';
import { Bot } from '../../bots/Bot';
import { Badge } from '../../ui/Badge';
import type { BotState } from '../../bots/poseFor';
const st = (h: Helper): BotState => h.state === 'waiting_permission' ? 'approval' : h.state === 'waiting_input' ? 'question' : h.state === 'exited' ? 'done' : h.state === 'error' ? 'error' : h.state === 'idle' ? 'idle' : h.state === 'starting' ? 'starting' : 'working';
export function HelpersPanel({ helpers, parentId, tool, theme }: { helpers: Helper[]; parentId: string; tool: import('@ledge/protocol').Tool; theme: 'dark' | 'light' }) {
  if (helpers.length === 0) return null;
  return (
    <div style={{ margin: '12px 16px 0', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)' }}>Helpers · {helpers.length}</div>
      {helpers.map((h, i) => { const last = i === helpers.length - 1; const needs = h.state === 'waiting_permission' || h.state === 'waiting_input'; return (
        <div key={h.id} data-helper data-last={last ? 'true' : 'false'} data-needs-you={needs ? 'true' : 'false'} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 12px 0 28px', background: needs ? 'var(--sidebar)' : 'transparent', opacity: h.state === 'exited' ? .6 : 1 }}>
          <span style={{ position: 'absolute', left: 14, top: 0, height: last ? 22 : '100%', width: 1, background: 'var(--input)' }} /><span style={{ position: 'absolute', left: 14, top: 21, width: 10, height: 1, background: 'var(--input)' }} />
          <Bot seed={`${parentId}:${h.id}`} tool={tool} state={st(h)} pose={1} size={20} theme={theme} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1, minWidth: 0 }}><span style={{ fontSize: 13, lineHeight: '16px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.kind} · {h.task}</span></span>
          <Badge state={st(h)} />
        </div>); })}
    </div>
  );
}
```

In `SessionView.tsx`: when `viewFor(s)` is `command` or `finished`, render `ActivityPanel` instead of the preview/reply block (finished keeps no reply field); always render `HelpersPanel` under the ask card when `s.helpers.length > 0`. In `SessionList.tsx`: under the 32 px bot, when helpers exist, a row of up to three 12 px bots and the sub-line suffix `· ${n} helpers${m ? `, ${m} need you` : ''}`. `measureSessionH`: `command` → 56 + 300 + 40; `finished` → 56 + 120 + 90 + (message ? 200 : 0) + files * 18 + 60; helpers add `36 + 44 * n`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): long command, finished summary and helpers panels"
```

---

### Task 6: Reading mode

**Files:**
- Modify: `apps/overlay/src/surface/SessionView.tsx`, `apps/overlay/src/surface/cards/ReportCard.tsx`, `DiffCard.tsx`, `apps/overlay/src/surface/Surface.tsx`
- Test: `apps/overlay/test/reading.test.tsx`

**Interfaces:**
- `reading` already flows from the surface machine (`reading` flag, Plan 2 Task 4) and the geometry (`readingW: 560`). This task makes the content use it: the session header shows "reading mode" in its sub-line and the `Reading mode` button is `aria-pressed`; `ReportCard` and `DiffCard` receive `reading` and drop their internal `maxHeight`, letting the surface height follow the content up to the screen margins (`measureSessionH(session, true)` returns the full content estimate: report `40 + words / 9 * 21`, diff `40 + lines * 19`), with the panel scrolling only when the screen is too short; the padding grows from 16 to 20 px and the body text measure is capped at `70ch`.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/reading.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionView, measureSessionH } from '../src/surface/SessionView';
import { fakeSession } from './mockDaemon';

const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with enough words to count as a sentence or two.`).join('\n\n');
const report = fakeSession('a', { state: 'idle', activity: { kind: 'message', text: long } });
const base = { preview: [], visible: true, draft: '', onDraft: () => {}, onBack: () => {}, onClose: () => {}, onDecide: () => {}, onReply: () => {}, onInterrupt: () => {}, onKill: () => {}, onFocus: () => {} };

describe('reading mode', () => {
  it('toggle is reported and reflected in the header', () => {
    const onToggleReading = vi.fn();
    const { rerender } = render(<SessionView {...base} session={report} reading={false} onToggleReading={onToggleReading} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reading mode' })); expect(onToggleReading).toHaveBeenCalled();
    rerender(<SessionView {...base} session={report} reading onToggleReading={onToggleReading} />);
    expect(screen.getByRole('button', { name: 'Reading mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/reading mode/)).toBeInTheDocument();
  });
  it('removes the inner scroll cap and measures the full content', () => {
    const { container, rerender } = render(<SessionView {...base} session={report} reading={false} onToggleReading={() => {}} />);
    expect(container.querySelector('[data-report]')).toHaveStyle({ maxHeight: '320px' });
    rerender(<SessionView {...base} session={report} reading onToggleReading={() => {}} />);
    expect(container.querySelector('[data-report]')).toHaveStyle({ maxHeight: 'none' });
    expect(measureSessionH(report, true)).toBeGreaterThan(measureSessionH(report, false) + 400);
  });
});
```

- [ ] **Step 2: Run, implement, run again**

Run: `pnpm --filter overlay test reading`
Expected: FAIL, then PASS after: `ReportCard` gets `data-report` on its well and `maxHeight: reading ? 'none' : 320`; `DiffCard` gets `reading` and uses `maxHeight: reading ? 'none' : 360` on its well; `SessionView` passes `reading` down, shows `· reading mode` in the sub-line, uses `padding: reading ? 20 : 16` on cards, and `measureSessionH` implements the reading estimates above.

- [ ] **Step 3: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): reading mode for long reports and diffs"
```

---

### Task 7: Queue bandeau and Alt+ArrowRight navigation

**Files:**
- Create: `apps/overlay/src/surface/QueueBar.tsx`, `apps/overlay/src/surface/queue.ts`
- Modify: `apps/overlay/src/surface/SessionView.tsx`, `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/surface/machine.ts` (event `next`)
- Test: `apps/overlay/test/queue.test.tsx`

**Interfaces:**
- `waitingQueue(sessions: Session[]): Session[]` (pending sessions, oldest `lastActivityAt`-of-ask first: use `startedAt` of the pending bot order as kept by the daemon: pending sessions sorted by the time their state last changed, i.e. `lastActivityAt` ascending), `nextWaiting(sessions, currentId): string | null` (the next pending after `currentId` in queue order, wrapping; never returns a non-pending id; `null` when nothing else waits).
- `<QueueBar current: Session; queue: Session[]; theme: 'dark' | 'light'; autoAdvance: boolean; onToggleAuto(); onNext(); onPick(id) />`: "Waiting for you · i of n", the queued bots as 32 px rings (the current one with a 2 px `var(--sidebar-primary)` ring), `Next` with `Kbd Alt →`; hidden when `queue.length < 2`. Every avatar uses `seed={session.id}` and the current theme.
- Machine: event `{ type: 'next'; id: string | null }` → in `session`, `selectedId = id` when not null, else `list` with the "all caught up" line for 2 s then `close` (`startTimer('caught', 2000)`; `caughtElapsed` → handle). The `Alt+ArrowRight` key (Plan 2 `onNextAsk`) dispatches `next` with `nextWaiting(...)`.
- Auto-advance: after `onDecide`/`onReply` in the session view, when `autoAdvance` is on and the daemon confirms (`pending` gone on the current bot), dispatch `next` with the computed next id; stored in `localStorage['ledge.autoAdvance']`, default on.

- [ ] **Step 1: Write the failing test**

`apps/overlay/test/queue.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { waitingQueue, nextWaiting } from '../src/surface/queue';
import { QueueBar } from '../src/surface/QueueBar';
import { transition, initialSurface } from '../src/surface/machine';
import { fakeSession } from './mockDaemon';

const p = (id: string, t: string, name = 'Otto') => fakeSession(id, { name, state: 'waiting_permission', pending: { kind: 'permission', text: 'x', source: 'hook' }, lastActivityAt: t });
const sessions = [p('a', '2026-10-09T18:00:48.000Z'), fakeSession('w'), p('b', '2026-10-09T18:00:04.000Z', 'Pim'), p('c', '2026-10-09T18:01:00.000Z', 'Nova')];

describe('queue', () => {
  it('orders waiting bots oldest ask first and finds the next one, wrapping', () => {
    expect(waitingQueue(sessions).map(s => s.id)).toEqual(['b', 'a', 'c']);
    expect(nextWaiting(sessions, 'a')).toBe('c');
    expect(nextWaiting(sessions, 'c')).toBe('b');
    expect(nextWaiting(sessions, 'w')).toBe('b');
    expect(nextWaiting([fakeSession('w')], 'w')).toBeNull();
  });
  it('never advances to a bot that stopped waiting', () => {
    const later = sessions.map(s => s.id === 'c' ? { ...s, state: 'working' as const, pending: undefined } : s);
    expect(nextWaiting(later, 'a')).toBe('b');
  });
  it('QueueBar shows position, rings and Next', () => {
    const onNext = vi.fn(), onPick = vi.fn();
    const q = waitingQueue(sessions);
    render(<QueueBar theme="dark" current={q[1]!} queue={q} autoAdvance onToggleAuto={() => {}} onNext={onNext} onPick={onPick} />);
    expect(screen.getByText('Waiting for you · 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ })); expect(onNext).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Then: Nova/ })); expect(onPick).toHaveBeenCalledWith('c');
  });
  it('machine: next with null shows caught up then folds', () => {
    let s = { ...initialSurface(), mode: 'session' as const, selectedId: 'a' };
    const r = transition(s, { type: 'next', id: null });
    expect(r.state.mode).toBe('list'); expect(r.state.caughtUp).toBe(true); expect(r.effects).toContainEqual({ type: 'startTimer', name: 'caught', ms: 2000 });
    const r2 = transition(r.state, { type: 'caughtElapsed' });
    expect(r2.state.mode).toBe('handle');
    const r3 = transition(s, { type: 'next', id: 'c' });
    expect(r3.state).toMatchObject({ mode: 'session', selectedId: 'c' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter overlay test queue`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/overlay/src/surface/queue.ts`:
```ts
import type { Session } from '@ledge/protocol';
const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
export function waitingQueue(sessions: Session[]): Session[] {
  return sessions.filter(isPending).sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt) || a.id.localeCompare(b.id));
}
export function nextWaiting(sessions: Session[], currentId: string | null): string | null {
  const q = waitingQueue(sessions); if (q.length === 0) return null;
  const i = q.findIndex(s => s.id === currentId);
  if (i < 0) return q[0]!.id;
  if (q.length === 1) return null;
  return q[(i + 1) % q.length]!.id;
}
```

`apps/overlay/src/surface/QueueBar.tsx`:
```tsx
import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
export function QueueBar({ current, queue, autoAdvance, onToggleAuto, onNext, onPick, theme }: { theme: 'dark' | 'light'; current: Session; queue: Session[]; autoAdvance: boolean; onToggleAuto: () => void; onNext: () => void; onPick: (id: string) => void }) {
  if (queue.length < 2) return null;
  const i = queue.findIndex(s => s.id === current.id);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 52, boxSizing: 'border-box', padding: '0 16px', background: 'var(--well)', borderBottom: '1px solid var(--sidebar-border)' }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>Waiting for you · {i + 1} of {queue.length}</span>
      <span style={{ flexGrow: 1 }} />
      <span style={{ display: 'flex', gap: 4 }}>
        {queue.map(s => <button key={s.id} type="button" aria-label={s.id === current.id ? `Current: ${s.name}` : `Then: ${s.name}`} onClick={() => onPick(s.id)} style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9999, background: s.id === current.id ? 'var(--secondary)' : 'transparent', border: `${s.id === current.id ? 2 : 1}px solid ${s.id === current.id ? 'var(--sidebar-primary)' : 'var(--border)'}`, cursor: 'pointer', padding: 0, lineHeight: 0 }}><Bot seed={s.id} readOnly={s.source === 'hook_only'} tool={s.tool} state={botState(s)} pose={poseFor(s.id, s.state)} size={20} theme={theme} /></button>)}
      </span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted-foreground)', cursor: 'pointer' }}><input type="checkbox" checked={autoAdvance} onChange={onToggleAuto} style={{ margin: 0 }} />auto next</label>
      <Button variant="outline" size="sm" onClick={onNext}>Next <Kbd>Alt →</Kbd></Button>
    </div>
  );
}
```

Machine additions: `SurfaceState` gains `caughtUp: boolean`; `TimerName` gains `'caught'` (2000 ms); events `{ type: 'next'; id: string | null }` and `{ type: 'caughtElapsed' }`; `next` with an id → `{ ...s, mode: 'session', selectedId: id }`; with `null` from `session` → `{ ...s, mode: 'list', selectedId: null, caughtUp: true }` + `start('caught')`; `caughtElapsed` → `toHandle(s)` with `caughtUp: false`; the controller maps `caught` → `caughtElapsed`. `SessionList` shows a one-line "all caught up" footer note when `caughtUp`. In `Surface`, render `QueueBar` above the session header when `waitingQueue(sessions).length >= 2` and the selected bot is pending; wire `onNext` → `dispatch({ type: 'next', id: nextWaiting(sessions, selectedId) })`, `onPick` → `rowClick`; keyboard `onNextAsk` dispatches the same; auto-advance: in the daemon-change effect, when `st.mode === 'session'`, `autoAdvance` is on, and the selected bot just left the pending set, dispatch `next` with `nextWaiting(sessions, selectedId)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): waiting queue bandeau, Alt+ArrowRight navigation and auto-advance"
```

---

### Task 8: Manual checklist and docs

**Files:**
- Create: `docs/checklist.md`
- Modify: `README.md`, `packages/ledge/README.md`, `apps/overlay/README.md`

- [ ] **Step 1: Write the ten-minute checklist**

`docs/checklist.md`:
```markdown
# Ledge release checklist (10 minutes, real tools)

Run in WSL with the overlay running on Windows (`pnpm --filter overlay tauri dev`).

1. `ledge setup` reports Claude Code hooks, Codex notify and Cursor hooks present.
2. `ledge claude` in a project: a bot appears in the handle within 1 s; the tab is renamed.
3. Ask Claude to run `npm test`: the bot grows, the bubble unfolds at its slot, the timer drains, hover pauses it.
4. Click Approve in the bubble: the terminal continues, the bot shrinks, the bubble folds after 900 ms.
5. Ask Claude to edit a file: the diff card shows the hunk; Deny: the terminal shows the refusal.
6. Ask Claude a question with options: answer from the session view by number, then by text.
7. `/plan` something: the plan card lists the steps; Approve plan leaves plan mode.
8. `ledge codex`: an approval box is detected and answered with y; the turn-complete message shows as a report.
9. `ledge cursor`: a shell approval is detected and denied with n.
10. Kill the daemon (`pkill -f "ledge daemon"`), start another `ledge claude`: the daemon restarts, old bots reappear, the dead one retires after 10 min.
11. Ctrl+Alt+L, J/K/Alt+Right/Y/N/Esc work; Tab keeps native focus navigation; the coachmark shows the first three times.
12. Three asks at once: the queue bandeau says 1 of 3, Alt+Right moves on, "all caught up" appears at the end.
```

- [ ] **Step 2: Update the READMEs**

Add to `packages/ledge/README.md` the Codex and Cursor lines (`ledge codex`, `ledge cursor`, what `ledge setup` writes to `~/.codex/config.toml` and `~/.cursor/hooks.json`). Add to `apps/overlay/README.md` the cards (diff, plan, report, command, finished), reading mode and the queue. Add to `README.md` a link to `docs/checklist.md`.

- [ ] **Step 3: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add docs/checklist.md README.md packages/ledge/README.md apps/overlay/README.md
git commit -m "docs: release checklist and adapter/screen usage"
git push
```

---

### Task 9: Rich-screen parity with the approved prototype

**Files:**
- Modify: `apps/overlay/src/surface/cards/PermissionCard.tsx`, `QuestionCard.tsx`, `DiffCard.tsx`, `PlanCard.tsx`, `ReportCard.tsx`, `ActivityPanel.tsx`, `HelpersPanel.tsx`, `src/surface/SessionView.tsx`, `QueueBar.tsx`, `queue.ts`, `Surface.tsx`, `packages/ledge/src/daemon/state.ts`
- Test: `apps/overlay/test/rich-prototype-parity.test.tsx`, `test/activity.test.tsx`, `test/queue.test.tsx`, `packages/ledge/test/state.test.ts`
- Modify: `docs/checklist.md`

**Consumes:** Plan 2 Task 3's Bot/material/motion API, Plan 2 Task 13's focus/countdown/acknowledgement contracts, and this plan's verified adapter messages. The source reference is `docs/mockups/ledge-prototype.html`; no browser-simulation state transition is copied into the daemon.

**Interfaces:**
- Pass `theme`, `parentId`, and verified parent `tool` through `SessionView` to `HelpersPanel`; pass `theme` to `QueueBar`. Queue avatars use session IDs, helper avatars use `${parentId}:${helper.id}` as seeds. Motion preference and disconnected/frozen state apply to all.
- A helper decision is an existing `session.decide` routed to the parent only when `session.pending.helperId === helper.id`. Render a helper's actionable card from that exact `pending`; otherwise show its waiting status without an unrelated action. Do not synthesize an independent helper command channel or an auto-grant policy.
- Scoped authorization and true relaunch are capability boundaries from spec section 7 bis. With this plan's current protocol, scoped controls remain disabled with an explanation, and the finished-session action says “Open terminal to relaunch”. A focus action never revives the exited ID or reports a new session.
- Queue auto-advance observes resolution of the exact selected pending plus the navigation revision; manual navigation and plan modification cancel it. `caughtElapsed` only closes when pointer/focus is outside and no draft is being edited. Tab is not intercepted.

- [ ] **Step 1: Add the rich-screen interaction tests**

Use the fake daemon to pin these assertions:

- Switching dark to light changes all main/helper/queue SVGs from Signal to Galet without replacing their identity; report/reading mode inherits the same preference.
- Choosing a radio option sends its actual option value; custom text is sent verbatim. The draft and choice survive navigating away and back.
- A diff exposes collapsible files, safe text rendering, counts, and a 560 px reading view; unsupported “Always” cannot send a one-shot decision. Refusal does not become a success report.
- “Change it” sends the supported denial/exit-plan operation, preserves the session and focuses its reply field; it does not auto-advance. A stale daemon response after opening another session never reopens the old card.
- With two waiting helpers and a separate parent request, only a card matching `pending.helperId` is actionable. Resolving that helper changes only its state; the parent is not marked complete and another helper's request remains visible.
- Interrupt sends the adapter's actual interrupt command, waits for reported state and leaves no fabricated success count. Disconnected/read-only disables interruption, decisions, quick replies and text replies.
- A finished session keeps closed eyes and its immutable exited ID. “Open terminal to relaunch” calls focus only and never mutates the session to working. An eventual real launch is registered under a new ID by the launcher.
- After the last confirmed request, “all caught up” appears; a pointer, keyboard focus or edited draft prevents the 2 s automatic collapse.

- [ ] **Step 2: Run the tests and locate the remaining integration gaps**

Run `pnpm --filter overlay test rich-prototype-parity activity queue && pnpm --filter ledge test state`; expect the new assertions to fail before implementing their missing wiring.

- [ ] **Step 3: Complete the card and queue wiring**

Implement the interfaces above, replacing the old hard-coded helper tool/theme and indiscriminate helper reset. Keep the parent-owned pending limitation explicit. Separate plan modification from generic auto-advancing denial. Preserve draft/selection maps by stable session ID; retain authoritative status until confirmed by the daemon. Real progress and result counts come from the adapters, not the prototype's “12 tests passed” sample.

- [ ] **Step 4: Verify all twelve approved scenarios**

Run `pnpm --filter overlay test && pnpm --filter ledge test && pnpm typecheck`. Compare these scenarios against the approved reference in dark/Signal and light/Galet: overview, permission, question, diff, plan, helpers, long command, report, error, exited, read-only, team/connection. Plan 2 Task 13 supplies the base view checks; this task completes the rich screens. Test 0/5/12 sessions, reduced motion, keyboard-only navigation, draft retention and lost connection.

Record browser visual/motion results separately from the Windows+WSL integration checklist. Browser checks do not prove terminal focus, global shortcut registration, real scoped grants, relaunch or retirement. Extend `docs/checklist.md` with both themes, a renamed bot retaining its motion identity, OS reduced motion and a helper request that cannot be misrouted. Commit after both suites pass; keep real-environment checks visibly outstanding until run.

---

## Self-review notes

- Spec coverage for this plan: section 4 Codex and Cursor adapters, hooks setup → Tasks 1, 3; sub-agents → Task 3 (daemon) and Task 5 (overlay); section 5 diff/plan/report/command/finished cards, reading mode, queue → Tasks 4 to 7; section 9 manual checklist → Task 8; the "last assistant message" source for the report card (transcript) → Task 2, with the fallback copy pinned by Review Focus 4.
- Names consistent with Plans 1 and 2: `Adapter`, `adapterFor`, `mapClaudeHook`, `mapCodexNotify`, `mapCursorHook`, `mergeCodexNotify`, `mergeCursorHooks`, `lastAssistantMessage`, `diffDetail`, `viewFor`, `parseDiff`, `renderMarkdown`, `inline`, `waitingQueue`, `nextWaiting`, `measureSessionH`.
- Revision 2: Plan 2 Task 3 owns Signal/Galet and motion identity; Plan 2 Task 13 owns the surface/focus/confirmation contract; this plan's Task 9 owns rich-card, helper and queue parity. Spec section 7 bis records the deliberate simulation/production boundaries.
- Review Focus pins: 1 → Task 1 trap fixture `codex-trap-yn-in-output`; 2 → Task 3 "a helper permission does not erase a different pending"; 3 → Task 4 "caps at 400 lines" (daemon cap in `diffDetail`, overlay cap in `DiffCard`); 4 → Task 2 truncated/garbage transcript tests and Task 4 ReportCard fallback; 5 → Task 7 "never advances to a bot that stopped waiting".
