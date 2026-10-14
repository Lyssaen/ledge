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
    // A launch, a /clear or a resume starts no turn (only a prompt does): the state stays, so nothing "finishes".
    table.push([ev('SessionStart'), s, '=']);
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
    // The pane shows Claude waiting for a prompt: a turn that ended with no Stop, or a request answered in the terminal.
    table.push([ev('PaneIdle', { source: 'pane' }), s, s === 'idle' || s === 'exited' || s === 'error' ? '=' : 'idle']);
    table.push([ev('Notification', { kind: 'question', text: 'Claude is waiting for your input' }), s, '=']);
    table.push([ev('PostToolUse', { tool: 'Bash' }), s, terminal ? '=' : 'working']);
    table.push([ev('PostToolUseFailure', { tool: 'Bash' }), s, terminal ? '=' : 'working']);
    table.push([ev('PostToolUseFailure', { tool: 'Bash', interrupt: true }), s, terminal ? '=' : 'idle']);
    // A failure after the turn already ended (Cursor Agent's stray one after an abort) leaves the rest alone.
    table.push([ev('StopFailure', { text: 'rate_limit' }), s, terminal || s === 'idle' ? '=' : 'error']);
    table.push([ev('SubagentStart', { helperId: 'a1', tool: 'Explore' }), s, '=']);
    table.push([ev('SubagentStop', { helperId: 'a1', tool: 'Explore' }), s, '=']);
    // Fired inside a subagent: the parent's state never moves, except a helper permission over no pending.
    table.push([ev('PreToolUse', { tool: 'Bash', helperId: 'a1' }), s, '=']);
    table.push([ev('PostToolUse', { tool: 'Bash', helperId: 'a1' }), s, '=']);
    table.push([ev('PostToolUseFailure', { tool: 'Bash', helperId: 'a1' }), s, '=']);
    table.push([ev('Notification', { kind: 'permission', text: 'Claude needs your permission', helperId: 'a1' }), s, '=']);
    table.push([ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }), s, terminal ? '=' : 'waiting_permission']);
  }
  it('SessionStart only moves the hook clocks: a launch stays starting, a /clear or resume stays idle', () => {
    for (const from of ['starting', 'idle'] as const) {
      const next = reduce(session(from), ev('SessionStart'));
      expect(next).toMatchObject({ state: from, lastHookAt: later(5000), lastActivityAt: later(5000) });
    }
  });
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
    expect(next.pending).toMatchObject({ kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' });
  });
  it('AskUserQuestion sets a question pending with options', () => {
    const next = reduce(session('working'), ev('PreToolUse', { tool: 'AskUserQuestion', text: 'Which one?', options: ['Backfill', 'Shadow'] }));
    expect(next.pending).toMatchObject({ kind: 'question', text: 'Which one?', options: ['Backfill', 'Shadow'], source: 'hook' });
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
  it('a Cursor Agent pane prompt right after a hook is taken at once: its hooks never report approvals', () => {
    const s = reduce(session('working', { tool: 'cursor' }), ev('PreToolUse', { tool: 'Shell', text: 'touch a', at: later(5000) }));
    const next = reduce(s, ev('PanePrompt', { source: 'pane', kind: 'permission', text: 'touch a', at: later(5200) }));
    expect(next).toMatchObject({ state: 'waiting_permission', pending: { kind: 'permission', text: 'touch a', source: 'pane' } });
  });
  it('Cursor Agent abort: Stop then the stray StopFailure leaves the session at rest, in either order the end is idle', () => {
    const working = session('working', { tool: 'cursor' });
    const aborted = reduce(working, ev('Stop', { at: later(5000) }));
    expect(reduce(aborted, ev('StopFailure', { at: later(5066) }))).toBe(aborted);
    const flipped = reduce(reduce(working, ev('StopFailure', { at: later(5066) })), ev('Stop', { at: later(5100) }));
    expect(flipped.state).toBe('idle');
  });
  it('a reply sent from Ledge is not ended by the pane still at rest before the agent redraws', () => {
    const decided = reduce(session('idle', { tool: 'cursor', lastHookAt: T0 }), ev('Decided', { source: 'daemon', at: later(5000) }));
    expect(reduce(decided, ev('PaneIdle', { source: 'pane', at: later(5300) }))).toBe(decided);
    expect(reduce(decided, ev('PaneIdle', { source: 'pane', at: later(5000 + HOOK_PRIORITY_MS + 1) })).state).toBe('idle');
  });
  it('Cursor Agent helpers: the Task names one, the subagent takes it over, the parent moving on ends it', () => {
    let s = reduce(session('working', { tool: 'cursor' }), ev('SubagentStart', { helperId: 'task:c1', tool: 'explore', text: 'Read notes' }));
    s = reduce(s, ev('SubagentStart', { helperId: 'b335' }));
    expect(s.helpers).toEqual([{ id: 'b335', kind: 'explore', task: 'Read notes', state: 'working' }]);
    expect(reduce(s, ev('SubagentStart', { helperId: 'task:c2', tool: 'explore', text: 'another' })).helpers[0]!.state).toBe('working');
    for (const e of [ev('PreToolUse', { tool: 'Shell' }), ev('PostToolUse', { tool: 'Read' }), ev('Stop'), ev('UserPromptSubmit')]) {
      expect(reduce(s, e).helpers[0]!.state).toBe('exited');
    }
    // A background helper comes back with its next tool run, under its name.
    const back = reduce(reduce(s, ev('Stop')), ev('PostToolUse', { helperId: 'b335', tool: 'Read' }));
    expect(back.helpers[0]).toMatchObject({ id: 'b335', state: 'working', task: 'Read notes' });
  });
  it('Cursor Agent parallel Tasks are taken over in launch order; a subagent with no Task left is a plain helper', () => {
    let s = session('working', { tool: 'cursor' });
    for (const [id, text] of [['task:1', 'first'], ['task:2', 'second']]) s = reduce(s, ev('SubagentStart', { helperId: id, tool: 'explore', text }));
    for (const id of ['s1', 's2', 's3']) s = reduce(s, ev('SubagentStart', { helperId: id }));
    expect(s.helpers.map(h => [h.id, h.task])).toEqual([['s1', 'first'], ['s2', 'second'], ['s3', '']]);
  });
  it('Claude Code helpers are not ended by the parent\'s own steps (it sends SubagentStop)', () => {
    const s = reduce(session('working'), ev('SubagentStart', { helperId: 'a1', tool: 'Explore' }));
    expect(reduce(s, ev('PreToolUse', { tool: 'Bash' })).helpers[0]!.state).toBe('working');
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
  describe('the last reply', () => {
    const reply = { text: '## Done\n\n- the tests pass', at: later(5000) };
    it('Stop with a text records it as the last reply', () => {
      const next = reduce(session('working'), ev('Stop', { text: reply.text }));
      expect(next.state).toBe('idle');
      expect(next.lastReply).toEqual(reply);
    });
    it('Stop without a text keeps the previous reply', () => {
      const next = reduce(session('working', { lastReply: reply }), ev('Stop', { at: later(9000) }));
      expect(next.lastReply).toEqual(reply);
    });
    it('the next prompt drops it; other activity keeps it', () => {
      const idle = session('idle', { lastReply: reply });
      const prompted = reduce(idle, ev('UserPromptSubmit', { at: later(9000) }));
      expect(prompted.state).toBe('working');
      expect(prompted.lastReply).toBeUndefined();
      expect('lastReply' in prompted).toBe(false);
      expect(reduce(idle, ev('PaneChanged', { source: 'pane', at: later(9000) })).lastReply).toEqual(reply);
      expect(reduce(idle, ev('PreToolUse', { tool: 'Bash', at: later(9000) })).lastReply).toEqual(reply);
    });
    it('survives the session ending', () => {
      expect(reduce(session('idle', { lastReply: reply }), ev('SessionEnd', { exitCode: 0 })).lastReply).toEqual(reply);
    });
    it('is recorded under a helper-routed request too', () => {
      const routedReply = reduce(session('working', { pending: { ...hookPerm, helperId: 'a1', parentState: 'working' } }), ev('Stop', { text: reply.text }));
      expect(routedReply.pending?.helperId).toBe('a1');
      expect(routedReply.lastReply).toEqual(reply);
    });
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
    expect(next.pending).toMatchObject(pending);
    expect(next.lastHookAt).toBe(later(5000));
    expect(next.state).toBe('waiting_permission');
  });
  it('a PermissionRequest over a hook plan pending keeps kind plan', () => {
    const s = session('waiting_permission', { pending: { kind: 'plan', text: 'the plan', source: 'hook' } });
    const next = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    expect(next.pending).toMatchObject({ kind: 'plan', text: 'the plan', source: 'hook' });
  });
  it('a PermissionRequest over a hook question pending keeps kind question', () => {
    const s = session('waiting_input', { pending: { kind: 'question', text: 'Which?', options: ['a'], source: 'hook' } });
    const next = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test' }));
    expect(next.pending).toMatchObject({ kind: 'question', text: 'Which?', options: ['a'], source: 'hook' });
    expect(next.state).toBe('waiting_input');
  });
  it('a late PaneGone after SessionEnd keeps exitCode and lastActivityAt', () => {
    const s = reduce(session('working'), ev('SessionEnd', { exitCode: 1 }));
    const next = reduce(s, ev('PaneGone', { source: 'daemon', at: later(9000) }));
    expect(next).toBe(s);
    expect(next.exitCode).toBe(1);
    expect(next.lastActivityAt).toBe(later(5000));
  });
});

describe('reduce: post-tool events', () => {
  const bashPerm = { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } as const;
  it('PostToolUse of the pending tool clears a hook permission answered in the terminal', () => {
    const next = reduce(session('waiting_permission', { pending: bashPerm }), ev('PostToolUse', { tool: 'Bash' }));
    expect(next.state).toBe('working');
    expect(next.pending).toBeUndefined();
    expect(next.lastHookAt).toBe(later(5000));
  });
  it('PostToolUseFailure of the pending tool clears it too (denied or failed, the prompt is gone)', () => {
    const next = reduce(session('waiting_permission', { pending: bashPerm }), ev('PostToolUseFailure', { tool: 'Bash' }));
    expect(next.state).toBe('working');
    expect(next.pending).toBeUndefined();
  });
  it('PostToolUse of Edit clears a diff pending', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Edit', text: 'a.ts' }));
    expect(reduce(s, ev('PostToolUse', { tool: 'Edit', at: later(6000) })).pending).toBeUndefined();
  });
  it('PostToolUse of AskUserQuestion clears a question pending', () => {
    const s = reduce(session('working'), ev('PreToolUse', { tool: 'AskUserQuestion', text: 'Which?', options: ['a'] }));
    const next = reduce(s, ev('PostToolUse', { tool: 'AskUserQuestion', at: later(6000) }));
    expect(next.state).toBe('working');
    expect(next.pending).toBeUndefined();
  });
  it('Codex: request_user_input is a question its own PostToolUse clears, another tool run keeps it', () => {
    const s = reduce(session('working', { tool: 'codex' }), ev('PreToolUse', { tool: 'request_user_input', text: 'Which color?', options: ['Blue', 'Red'] }));
    expect(s.state).toBe('waiting_input');
    expect(s.pending).toMatchObject({ kind: 'question', text: 'Which color?', options: ['Blue', 'Red'], source: 'hook' });
    expect(reduce(s, ev('PostToolUse', { tool: 'Bash', at: later(6000) })).pending).toBeDefined();
    expect(reduce(s, ev('PostToolUse', { tool: 'request_user_input', at: later(6000) })).pending).toBeUndefined();
  });
  it('Codex: an apply_patch permission is a diff', () => {
    const s = reduce(session('working', { tool: 'codex' }), ev('PermissionRequest', { tool: 'apply_patch', text: '/w/README.md' }));
    expect(s.pending).toMatchObject({ kind: 'diff', text: '/w/README.md', tool: 'apply_patch' });
  });
  it('PostToolUse of ExitPlanMode clears a plan pending', () => {
    const s = reduce(session('working'), ev('PreToolUse', { tool: 'ExitPlanMode', text: 'plan' }));
    expect(reduce(s, ev('PostToolUse', { tool: 'ExitPlanMode', at: later(6000) })).pending).toBeUndefined();
  });
  it('PostToolUse of another tool keeps a hook pending (a parallel tool finished)', () => {
    const s = session('waiting_permission', { pending: bashPerm });
    const next = reduce(s, ev('PostToolUse', { tool: 'Read' }));
    expect(next.pending).toMatchObject(bashPerm);
    expect(next.state).toBe('waiting_permission');
    expect(next.lastHookAt).toBe(later(5000));
  });
  it('PostToolUse of AskUserQuestion does not clear a Bash permission', () => {
    const next = reduce(session('waiting_permission', { pending: bashPerm }), ev('PostToolUse', { tool: 'AskUserQuestion' }));
    expect(next.pending).toMatchObject(bashPerm);
  });
  it('PostToolUse clears a pane-sourced pending whatever the tool (the tool ran, the prompt is gone)', () => {
    const s = session('waiting_permission', { pending: { kind: 'permission', text: 'Do you want to proceed?', source: 'pane' } });
    const next = reduce(s, ev('PostToolUse', { tool: 'Read' }));
    expect(next.state).toBe('working');
    expect(next.pending).toBeUndefined();
  });
  it('PostToolUse clears a tool-less hook permission from a Notification', () => {
    const s = reduce(session('working'), ev('Notification', { kind: 'permission', text: 'Claude needs your permission' }));
    expect(reduce(s, ev('PostToolUse', { tool: 'Bash', at: later(6000) })).pending).toBeUndefined();
  });
  it('PostToolUse from idle with nothing pending goes back to working', () => {
    expect(reduce(session('idle'), ev('PostToolUse', { tool: 'Bash' })).state).toBe('working');
  });
});

describe('reduce: StopFailure', () => {
  it('goes to error with the reason and clears pending', () => {
    const s = session('waiting_permission', { pending: { kind: 'permission', text: 'x', source: 'hook' } });
    const next = reduce(s, ev('StopFailure', { text: 'rate_limit: 429 Too Many Requests' }));
    expect(next.state).toBe('error');
    expect(next.lastError).toBe('rate_limit: 429 Too Many Requests');
    expect(next.pending).toBeUndefined();
  });
  it('falls back to a generic reason', () => {
    expect(reduce(session('working'), ev('StopFailure')).lastError).toBe('the turn stopped on an error');
  });
  it('a later UserPromptSubmit or PreToolUse returns to working', () => {
    const s = reduce(session('working'), ev('StopFailure', { text: 'overloaded' }));
    expect(reduce(s, ev('UserPromptSubmit', { at: later(9000) })).state).toBe('working');
    expect(reduce(s, ev('PreToolUse', { tool: 'Bash', at: later(9000) })).state).toBe('working');
  });
});

describe('reduce: helpers (subagents)', () => {
  const start = (id = 'a1', extra: Partial<SessionEvent> = {}) => ev('SubagentStart', { helperId: id, tool: 'Explore', text: 'Find the hook mapper', ...extra });
  it('SubagentStart adds a working helper with its type and task', () => {
    const next = reduce(session('working'), start());
    expect(next.helpers).toEqual([{ id: 'a1', kind: 'Explore', task: 'Find the hook mapper', state: 'working' }]);
    expect(next.state).toBe('working');
  });
  it('SubagentStart without a type or task uses subagent and an empty task', () => {
    const next = reduce(session('working'), ev('SubagentStart', { helperId: 'a1' }));
    expect(next.helpers).toEqual([{ id: 'a1', kind: 'subagent', task: '', state: 'working' }]);
  });
  it('SubagentStart again for the same id updates in place (stable id, no duplicate)', () => {
    const s = reduce(reduce(session('working'), start('a1')), start('a2'));
    const next = reduce(s, start('a1', { tool: 'Plan', text: '', at: later(9000) }));
    expect(next.helpers.map(h => h.id)).toEqual(['a1', 'a2']);
    expect(next.helpers[0]).toEqual({ id: 'a1', kind: 'Plan', task: 'Find the hook mapper', state: 'working' });
  });
  it('SubagentStop marks the helper exited and keeps it', () => {
    const s = reduce(reduce(session('working'), start('a1')), start('a2'));
    const next = reduce(s, ev('SubagentStop', { helperId: 'a1', at: later(9000) }));
    expect(next.helpers.map(h => [h.id, h.state])).toEqual([['a1', 'exited'], ['a2', 'working']]);
    expect(next.state).toBe('working');
  });
  it('SubagentStop for an unknown helper records it as exited (not Claude Code: see below)', () => {
    const next = reduce(session('working', { tool: 'codex' }), ev('SubagentStop', { helperId: 'zz', tool: 'Explore' }));
    expect(next.helpers).toEqual([{ id: 'zz', kind: 'Explore', task: '', state: 'exited' }]);
  });
  it('a helper event without helperId is ignored', () => {
    const s = session('working');
    expect(reduce(s, ev('SubagentStart'))).toBe(s);
  });
  // Claude Code's internal agents (delegated observation) fire tool hooks with an agent_id but never SubagentStart,
  // and not always SubagentStop: tracked from their tool runs, they would stay working forever.
  it('Claude Code: tool runs of a helper never started are not tracked', () => {
    for (const name of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'] as const) {
      expect(reduce(session('working'), ev(name, { tool: 'Read', helperId: 'zz' })).helpers).toEqual([]);
    }
  });
  it('Claude Code: SubagentStop of a helper never started is not tracked', () => {
    expect(reduce(session('working'), ev('SubagentStop', { helperId: 'zz' })).helpers).toEqual([]);
  });
  it('Claude Code: a helper never started still routes its permission to the parent, untracked', () => {
    const next = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'zz' }));
    expect(next.pending).toMatchObject({ helperId: 'zz', text: 'npm test' });
    expect(next.helpers).toEqual([]);
    const done = reduce(next, ev('PostToolUse', { tool: 'Bash', helperId: 'zz', at: later(6000) }));
    expect(done.pending).toBeUndefined();
    expect(done.state).toBe('working');
    expect(done.helpers).toEqual([]);
  });
  it('Claude Code: a started helper is still tracked through its tool runs', () => {
    const s = reduce(session('working'), start());
    expect(reduce(s, ev('PostToolUseFailure', { tool: 'Bash', helperId: 'a1', interrupt: true })).helpers[0]!.state).toBe('idle');
  });
  it('a helper event with a task names a helper that has none, never renames one', () => {
    const s = reduce(session('working'), ev('SubagentStart', { helperId: 'a1', tool: 'general-purpose' }));
    const named = reduce(s, ev('PreToolUse', { tool: 'Read', helperId: 'a1', task: 'Review task 3' }));
    expect(named.helpers[0]).toMatchObject({ task: 'Review task 3', state: 'working' });
    expect(reduce(named, ev('PostToolUse', { tool: 'Read', helperId: 'a1', task: 'other' })).helpers[0]!.task).toBe('Review task 3');
    expect(reduce(s, ev('SubagentStop', { helperId: 'a1', task: 'Review task 3' })).helpers[0]).toMatchObject({ task: 'Review task 3', state: 'exited' });
  });
  it('Codex: tool runs of a helper never started are still tracked', () => {
    expect(reduce(session('working', { tool: 'codex' }), ev('PreToolUse', { tool: 'Bash', helperId: 'zz' })).helpers)
      .toEqual([{ id: 'zz', kind: 'subagent', task: '', state: 'working' }]);
  });
});

describe('reduce: subagent isolation', () => {
  const parentPerm = { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } as const;
  it('a helper PreToolUse does not clear the parent pending nor flip it to working', () => {
    const s = session('waiting_permission', { pending: parentPerm });
    const next = reduce(s, ev('PreToolUse', { tool: 'Read', helperId: 'a1' }));
    expect(next.pending).toMatchObject(parentPerm);
    expect(next.state).toBe('waiting_permission');
  });
  it('a helper PostToolUse of the same tool does not clear the parent pending', () => {
    const s = session('waiting_permission', { pending: parentPerm });
    const next = reduce(s, ev('PostToolUse', { tool: 'Bash', helperId: 'a1' }));
    expect(next.pending).toMatchObject(parentPerm);
    expect(next.state).toBe('waiting_permission');
  });
  it('a helper PreToolUse does not flip an idle parent to working', () => {
    expect(reduce(session('idle'), ev('PreToolUse', { tool: 'Bash', helperId: 'a1' })).state).toBe('idle');
  });
  it('a helper AskUserQuestion does not set a parent question', () => {
    const next = reduce(session('working'), ev('PreToolUse', { tool: 'AskUserQuestion', text: 'Which?', helperId: 'a1' }));
    expect(next.pending).toBeUndefined();
  });
  it('a helper PermissionRequest sets the parent pending with helperId when nothing is pending', () => {
    const s = reduce(session('working'), ev('SubagentStart', { helperId: 'a1', tool: 'Explore' }));
    const next = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'rm -rf dist', helperId: 'a1', at: later(6000) }));
    expect(next.state).toBe('waiting_permission');
    expect(next.pending).toMatchObject({ kind: 'permission', text: 'rm -rf dist', tool: 'Bash', source: 'hook', helperId: 'a1', parentState: 'working' });
    expect(next.helpers[0]!.state).toBe('waiting_permission');
  });
  it('a helper PermissionRequest is ignored when the parent already has a hook pending', () => {
    const s = session('waiting_permission', { pending: parentPerm });
    const next = reduce(s, ev('PermissionRequest', { tool: 'Edit', text: 'a.ts', helperId: 'a1' }));
    expect(next.pending).toMatchObject(parentPerm);
  });
  it('a second helper cannot replace the first helper pending', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'one', helperId: 'a1' }));
    const next = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'two', helperId: 'a2', at: later(6000) }));
    expect(next.pending?.helperId).toBe('a1');
    expect(next.pending?.text).toBe('one');
  });
  it('a helper PermissionRequest replaces a pane-sourced pending (hook wins over pane)', () => {
    const s = session('waiting_permission', { pending: { kind: 'permission', text: 'Do you want to proceed?', source: 'pane' } });
    const next = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
    expect(next.pending).toMatchObject({ kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook', helperId: 'a1', parentState: 'working' });
  });
  it('the helper own PostToolUse clears its routed pending and the parent goes back to working', () => {
    const s = reduce(reduce(session('working'), ev('SubagentStart', { helperId: 'a1', tool: 'Explore' })), ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
    const next = reduce(s, ev('PostToolUse', { tool: 'Bash', helperId: 'a1', at: later(6000) }));
    expect(next.pending).toBeUndefined();
    expect(next.state).toBe('working');
    expect(next.helpers[0]!.state).toBe('working');
  });
  it('the main agent PostToolUse does not clear a helper-routed pending', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
    const next = reduce(s, ev('PostToolUse', { tool: 'Bash', at: later(6000) }));
    expect(next.pending?.helperId).toBe('a1');
    expect(next.state).toBe('waiting_permission');
  });
  it('the main agent PreToolUse does not clear a helper-routed pending (background helper)', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
    const next = reduce(s, ev('PreToolUse', { tool: 'Read', at: later(6000) }));
    expect(next.pending?.helperId).toBe('a1');
    expect(next.state).toBe('waiting_permission');
  });
  it('a main agent PermissionRequest does not merge into a helper-routed pending', () => {
    const s = reduce(session('working'), ev('PermissionRequest', { tool: 'Bash', text: 'one', helperId: 'a1' }));
    const next = reduce(s, ev('PermissionRequest', { tool: 'Edit', text: 'a.ts', at: later(6000) }));
    expect(next.pending).toEqual(s.pending);
  });
  it('SubagentStop clears that helper routed pending', () => {
    const s = reduce(reduce(session('working'), ev('SubagentStart', { helperId: 'a1', tool: 'Explore' })), ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
    const next = reduce(s, ev('SubagentStop', { helperId: 'a1', at: later(6000) }));
    expect(next.pending).toBeUndefined();
    expect(next.state).toBe('working');
    expect(next.helpers[0]!.state).toBe('exited');
  });
  it('a helper Notification only moves lastHookAt', () => {
    const s = session('working');
    const next = reduce(s, ev('Notification', { kind: 'permission', text: 'Claude needs your permission', helperId: 'a1' }));
    expect(next.pending).toBeUndefined();
    expect(next.state).toBe('working');
    expect(next.lastHookAt).toBe(later(5000));
  });
});

describe('reduce: interrupted tool (Esc)', () => {
  it('an interrupted PostToolUseFailure goes idle and clears the pending, like Stop', () => {
    const s = session('waiting_permission', { pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } });
    const next = reduce(s, ev('PostToolUseFailure', { tool: 'Read', interrupt: true }));
    expect(next.state).toBe('idle');
    expect(next.pending).toBeUndefined();
  });
  it('an interrupted helper tool sets the helper idle and clears its routed pending', () => {
    const s = reduce(reduce(session('working'), ev('SubagentStart', { helperId: 'a1', tool: 'Explore' })), ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
    const next = reduce(s, ev('PostToolUseFailure', { tool: 'Bash', helperId: 'a1', interrupt: true, at: later(6000) }));
    expect(next.pending).toBeUndefined();
    expect(next.helpers[0]!.state).toBe('idle');
  });
});

describe('reduce: background helpers keep the parent resting state', () => {
  const routed = (from: Session) => reduce(from, ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
  it('idle parent + background helper permission answered in the terminal -> idle', () => {
    const s = routed(session('idle'));
    expect(s.state).toBe('waiting_permission');
    expect(reduce(s, ev('PostToolUse', { tool: 'Bash', helperId: 'a1', at: later(6000) })).state).toBe('idle');
  });
  it('idle parent + background helper permission answered from Ledge (Decided) -> idle, helper back to working', () => {
    const s = reduce(reduce(session('idle'), ev('SubagentStart', { helperId: 'a1' })), ev('PermissionRequest', { tool: 'Bash', text: 'x', helperId: 'a1', at: later(5500) }));
    const next = reduce(s, ev('Decided', { source: 'daemon', at: later(6000) }));
    expect(next.state).toBe('idle');
    expect(next.pending).toBeUndefined();
    expect(next.helpers[0]!.state).toBe('working');
  });
  it('idle parent + background helper stopping with its request open -> idle', () => {
    const next = reduce(routed(session('idle')), ev('SubagentStop', { helperId: 'a1', at: later(6000) }));
    expect(next.state).toBe('idle');
  });
  it('Stop while a helper permission is pending keeps it, then clearing it -> idle', () => {
    const s = reduce(routed(session('working')), ev('Stop', { at: later(6000) }));
    expect(s.state).toBe('waiting_permission');
    expect(s.pending?.helperId).toBe('a1');
    expect(s.pending?.parentState).toBe('idle');
    expect(reduce(s, ev('PostToolUse', { tool: 'Bash', helperId: 'a1', at: later(7000) })).state).toBe('idle');
  });
  it('StopFailure while a helper permission is pending keeps it, then clearing it -> error with the reason', () => {
    const s = reduce(routed(session('working')), ev('StopFailure', { text: 'overloaded', at: later(6000) }));
    expect(s.state).toBe('waiting_permission');
    expect(s.pending?.helperId).toBe('a1');
    expect(s.lastError).toBe('overloaded');
    const next = reduce(s, ev('Decided', { source: 'daemon', at: later(7000) }));
    expect(next.state).toBe('error');
    expect(next.lastError).toBe('overloaded');
  });
  it('the main thread resuming under a helper pending makes the resting state working again', () => {
    const s = reduce(reduce(routed(session('working')), ev('Stop', { at: later(6000) })), ev('UserPromptSubmit', { at: later(7000) }));
    expect(s.pending?.parentState).toBe('working');
    expect(reduce(s, ev('PostToolUse', { tool: 'Bash', helperId: 'a1', at: later(8000) })).state).toBe('working');
  });
  it('a main-thread interrupt under a helper pending rests idle', () => {
    const s = reduce(routed(session('working')), ev('PostToolUseFailure', { tool: 'Agent', interrupt: true, at: later(6000) }));
    expect(s.pending?.helperId).toBe('a1');
    expect(s.pending?.parentState).toBe('idle');
  });
  it('a pending without parentState (older journal) settles to working', () => {
    const s = session('waiting_permission', { pending: { kind: 'permission', text: 'x', tool: 'Bash', source: 'hook', helperId: 'a1' } });
    expect(reduce(s, ev('PostToolUse', { tool: 'Bash', helperId: 'a1' })).state).toBe('working');
  });
});

describe('reduce: PaneIdle (the pane is at rest)', () => {
  const idle = (ms = 5000) => ev('PaneIdle', { source: 'pane', at: later(ms) });
  it('ends a turn that stopped without a Stop hook (a denial, an Esc)', () => {
    const next = reduce(session('working', { lastHookAt: T0 }), idle());
    expect(next.state).toBe('idle');
  });
  it('clears a request answered or dismissed in the terminal', () => {
    const pending = { kind: 'plan' as const, text: '# Plan', source: 'hook' as const };
    const next = reduce(session('waiting_permission', { pending, lastHookAt: T0 }), idle());
    expect(next.state).toBe('idle');
    expect(next.pending).toBeUndefined();
  });
  it('waits for the hook priority window: a hook just fired describes the turn better', () => {
    const s = session('working', { lastHookAt: later(4000) });
    expect(reduce(s, idle(4000 + HOOK_PRIORITY_MS - 1))).toBe(s);
    expect(reduce(s, idle(4000 + HOOK_PRIORITY_MS)).state).toBe('idle');
  });
  it('leaves a helper-routed request alone: the helper may still be waiting', () => {
    const pending = { kind: 'permission' as const, text: 'npm test', source: 'hook' as const, helperId: 'a1', parentState: 'working' as const };
    const s = session('waiting_permission', { pending, lastHookAt: T0 });
    expect(reduce(s, idle())).toBe(s);
  });
  it('is a no-op when already idle', () => {
    const s = session('idle');
    expect(reduce(s, idle())).toBe(s);
  });
});

describe('topics', () => {
  const at = '2026-10-11T10:00:00.000Z';
  const mk = (_id: string) => session('idle');
  it('takes the first prompt as topic, never a later one', () => {
    let s = reduce(mk('a'), { name: 'UserPromptSubmit', at, source: 'hook', text: 'Ajoute un README\nIl manque.' });
    expect(s.topic).toBe('Ajoute un README'); expect(s.topicSource).toBe('prompt'); expect(s.title).toBe('Otto · Ajoute un README');
    s = reduce(s, { name: 'UserPromptSubmit', at, source: 'hook', text: 'Autre chose' });
    expect(s.topic).toBe('Ajoute un README');
  });
  it('a pane title replaces a prompt topic, not a user one', () => {
    let s = reduce(mk('a'), { name: 'UserPromptSubmit', at, source: 'hook', text: 'premier prompt' });
    s = reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'add-readme-file' });
    expect(s.topic).toBe('add-readme-file'); expect(s.topicSource).toBe('pane');
    s = reduce(s, { name: 'Renamed', at, source: 'daemon', text: 'Mon sujet' });
    s = reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'other-title' });
    expect(s.topic).toBe('Mon sujet'); expect(s.topicSource).toBe('user'); expect(s.title).toBe('Otto · Mon sujet');
  });
  it('an empty rename hands back to the automatic sources', () => {
    let s = reduce(mk('a'), { name: 'Renamed', at, source: 'daemon', text: 'Mon sujet' });
    s = reduce(s, { name: 'Renamed', at, source: 'daemon', text: '  ' });
    expect(s.topic).toBeUndefined(); expect(s.topicSource).toBeUndefined(); expect(s.title).toBe('Otto · harness-assistant');
    s = reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'again' });
    expect(s.topic).toBe('again');
  });
  it('titles touch neither activity nor the hook clock, and an unchanged title is a no-op', () => {
    const base = mk('a');
    const s = reduce(base, { name: 'PaneTitle', at, source: 'pane', text: 'x' });
    expect(s.lastActivityAt).toBe(base.lastActivityAt); expect(s.lastHookAt).toBe(base.lastHookAt);
    expect(reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'x' })).toBe(s);
  });
});
