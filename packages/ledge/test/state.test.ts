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
    table.push([ev('PanePrompt', { source: 'pane', kind: 'permission', text: 'Do you want to proceed?' }), s, terminal ? '=' : 'waiting_permission']);
    table.push([ev('PaneChanged', { source: 'pane' }), s, '=']);
    table.push([ev('PaneIdle', { source: 'pane' }), s, '=']);
    table.push([ev('Notification', { kind: 'question', text: 'Claude is waiting for your input' }), s, '=']);
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
    const s = session('waiting_permission', { pending: { kind: 'permission', text: 'x', source: 'hook' } });
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

describe('reduce: rulings', () => {
  const hookPerm = { kind: 'permission', text: 'x', source: 'hook' } as const;
  it('PanePrompt returns the same session when the pending is unchanged', () => {
    const s = reduce(session('working'), ev('PanePrompt', { source: 'pane', kind: 'permission', text: 'Proceed?', at: later(5000) }));
    const next = reduce(s, ev('PanePrompt', { source: 'pane', kind: 'permission', text: 'Proceed?', at: later(9000) }));
    expect(next).toBe(s);
  });
  it('Stop clears pending', () => {
    const next = reduce(session('waiting_permission', { pending: hookPerm }), ev('Stop'));
    expect(next.state).toBe('idle');
    expect(next.pending).toBeUndefined();
  });
  it('a Notification over an existing hook pending only updates lastHookAt', () => {
    const pending = { kind: 'plan', text: 'the plan', source: 'hook' } as const;
    const s = session('waiting_permission', { pending });
    const next = reduce(s, ev('Notification', { kind: 'permission', text: 'Do you want to proceed?' }));
    expect(next.pending).toEqual(pending);
    expect(next.lastHookAt).toBe(later(5000));
    expect(next.state).toBe('waiting_permission');
  });
  it('a PermissionRequest over a hook plan pending keeps kind plan', () => {
    const s = session('waiting_permission', { pending: { kind: 'plan', text: 'the plan', source: 'hook' } });
    const next = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    expect(next.pending?.kind).toBe('plan');
  });
  it('a PermissionRequest over a hook question pending keeps kind question', () => {
    const s = session('waiting_input', { pending: { kind: 'question', text: 'Which?', options: ['a'], source: 'hook' } });
    const next = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    expect(next.pending?.kind).toBe('question');
    expect(next.state).toBe('waiting_input');
  });
});
