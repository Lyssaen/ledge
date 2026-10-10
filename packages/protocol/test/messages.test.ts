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

  it('accepts the post-tool, stop-failure and subagent hook events', () => {
    for (const name of ['PostToolUse', 'PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop']) {
      const m = parseClientMessage({ type: 'session.event', id: '7f3a', event: { name, at: '2026-10-09T18:02:00.000Z', source: 'hook', helperId: 'a1' } });
      expect(m.type).toBe('session.event');
    }
  });

  it('accepts a helper-routed pending and helpers with a state', () => {
    const s = { ...session, pending: { ...session.pending, helperId: 'a1' }, helpers: [{ id: 'a1', kind: 'Explore', task: '', state: 'exited' }] };
    expect(SessionSchema.parse(s)).toEqual(s);
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
