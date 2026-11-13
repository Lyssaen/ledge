// #302: the hooks Codex CLI 0.166 really sent (captured 2026-11-13 with an isolated CODEX_HOME, the same events Ledge installs), in
// each approval mode, replayed through Ledge's own hook mapping and reducer. « Approve for me » sends a PermissionRequest its automatic
// review settles alone (approved, then PostToolUse; refused, then only Stop); `-a never` sends none; « Ask » shows its dialog in the
// terminal, which the pane reads (PanePrompt), and only that is a request waiting on the person.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Session, SessionEvent } from '@ledge/protocol';
import { mapHook } from '../src/cli/hook.js';
import { reduce } from '../src/daemon/state.js';

type Captured = { mode: 'ask' | 'auto' | 'never'; at: string; event: string; payload: unknown };
const captured: Captured[] = readFileSync(new URL('./fixtures/codex-0166-approval-hooks.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l) as Captured);

const start = (at: string): Session => ({
  id: 'x', name: 'Codex', tool: 'codex', cwd: '/w/work', project: 'work', title: 'Codex · work', tmuxSession: 'ledge-x',
  state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher'
});

/** Each step's state, the events of `mode` mapped as the daemon gets them; `pane` adds what the terminal showed after an event. */
function replay(mode: Captured['mode'], pane: (c: Captured) => SessionEvent | null = () => null): Array<{ event: string; state: Session['state'] }> {
  const rows = captured.filter(c => c.mode === mode);
  let s = start(rows[0]!.at);
  const steps: Array<{ event: string; state: Session['state'] }> = [];
  for (const c of rows) {
    const mapped = mapHook('codex', c.event, c.payload, c.at);
    if (mapped) { s = reduce(s, mapped.event); steps.push({ event: c.event, state: s.state }); }
    const shown = pane(c);
    if (shown) { s = reduce(s, shown); steps.push({ event: shown.name, state: s.state }); }
  }
  return steps;
}

describe('#302: real Codex 0.166 hooks, replayed', () => {
  it('the capture has each mode', () => {
    expect(new Set(captured.map(c => c.mode))).toEqual(new Set(['ask', 'auto', 'never']));
    expect(captured.filter(c => c.mode === 'auto' && c.event === 'PermissionRequest')).toHaveLength(3);
    expect(captured.some(c => c.mode === 'never' && c.event === 'PermissionRequest')).toBe(false);
  });

  it('« Approve for me »: three PermissionRequests settled by the automatic review (two approved, one refused), never a request waiting', () => {
    const steps = replay('auto');
    expect(steps.filter(s => s.event === 'PermissionRequest')).toHaveLength(3);
    expect(steps.some(s => s.state === 'waiting_permission' || s.state === 'waiting_input')).toBe(false);
    // The refusal: no PostToolUse, the turn's end says it is over.
    expect(steps.at(-1)).toEqual({ event: 'Stop', state: 'idle' });
  });

  it('-a never: no PermissionRequest, never a request waiting', () => {
    expect(replay('never').some(s => s.state === 'waiting_permission')).toBe(false);
  });

  it('« Ask for approval »: waiting once the terminal shows the dialog, cleared when the approved command ran', () => {
    const dialog = (c: Captured): SessionEvent | null => (c.event === 'PermissionRequest'
      ? { name: 'PanePrompt', at: c.at, source: 'pane', kind: 'permission', text: 'touch /w/outside-ask.txt', options: ['Yes, proceed (y)', 'No (esc)'] } : null);
    const steps = replay('ask', dialog);
    const ask = steps.findIndex(s => s.event === 'PermissionRequest');
    expect(steps[ask]!.state).toBe('working'); // the hook alone
    expect(steps[ask + 1]).toEqual({ event: 'PanePrompt', state: 'waiting_permission' }); // the terminal shows it
    expect(steps[ask + 2]).toEqual({ event: 'PostToolUse', state: 'working' }); // approved, it ran
    expect(steps.at(-1)).toEqual({ event: 'Stop', state: 'idle' });
  });
});
