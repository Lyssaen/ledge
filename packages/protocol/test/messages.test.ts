import { describe, it, expect } from 'vitest';
import { parseClientMessage, ServerMessageSchema, SessionSchema, PROTOCOL_PORT, NAMES, pickName } from '../src/index.js';

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
      { type: 'session.dismiss', id: '7f3a' },
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

  it('a hook event may name its agent and folder; an unknown agent is refused', () => {
    const event = { name: 'Stop', at: '2026-10-09T18:02:00.000Z', source: 'hook' };
    expect(parseClientMessage({ type: 'session.event', id: 'u1', event, agent: 'codex', cwd: '/w/x' })).toEqual({ type: 'session.event', id: 'u1', event, agent: 'codex', cwd: '/w/x' });
    expect(() => parseClientMessage({ type: 'session.event', id: 'u1', event, agent: 'gemini' })).toThrow();
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

describe('protocol: launching from the overlay', () => {
  it('parses session.launch with its optional fields', () => {
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '~/Workspace/api-gateway' }).type).toBe('session.launch');
    const full = parseClientMessage({ type: 'session.launch', tool: 'codex', cwd: '/w/x', name: 'Juno', prompt: 'run the tests', continue: true });
    expect(full).toEqual({ type: 'session.launch', tool: 'codex', cwd: '/w/x', name: 'Juno', prompt: 'run the tests', continue: true });
    expect(() => parseClientMessage({ type: 'session.launch', tool: 'vim', cwd: '/w' })).toThrow();
    expect(() => parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '' })).toThrow();
  });
  it('parses session.launched, recents, and a snapshot carrying recents and the launcher command', () => {
    expect(ServerMessageSchema.parse({ type: 'session.launched', id: '7f3a' })).toEqual({ type: 'session.launched', id: '7f3a' });
    const recents = [{ cwd: '/w/api-gateway', project: 'api-gateway', lastAt: '2026-10-10T09:00:00.000Z' }];
    expect(ServerMessageSchema.parse({ type: 'recents', recents })).toEqual({ type: 'recents', recents });
    const snap = ServerMessageSchema.parse({ type: 'snapshot', sessions: [], recents, launcher: ['/usr/bin/node', '/opt/ledge/dist/cli/index.js'] });
    expect(snap).toEqual({ type: 'snapshot', sessions: [], recents, launcher: ['/usr/bin/node', '/opt/ledge/dist/cli/index.js'] });
    // A daemon from before these fields still speaks the protocol.
    expect(ServerMessageSchema.parse({ type: 'snapshot', sessions: [] })).toEqual({ type: 'snapshot', sessions: [] });
  });
  it('exposes the bot names so the overlay can pick a free one', () => {
    expect(NAMES.length).toBe(64);
    expect(NAMES[0]).toBe('Otto');
    expect(pickName(['Otto', 'Pim'])).toBe('Nova');
    expect(pickName(['Otto'], 'juno')).toBe('Juno');
    expect(pickName(['Juno'], 'Juno')).toBe('Juno-2');
  });
});

describe('protocol: browsing folders from the launch form', () => {
  it('parses folder.list (home when no path) and folder.create', () => {
    expect(parseClientMessage({ type: 'folder.list' })).toEqual({ type: 'folder.list' });
    expect(parseClientMessage({ type: 'folder.list', path: '~/Workspace' })).toEqual({ type: 'folder.list', path: '~/Workspace' });
    expect(parseClientMessage({ type: 'folder.create', parent: '/w', name: 'new-project' })).toEqual({ type: 'folder.create', parent: '/w', name: 'new-project' });
    expect(() => parseClientMessage({ type: 'folder.create', parent: '/w', name: '' })).toThrow();
  });
  it('parses folder.listing, with a parent, at the root, and carrying an error', () => {
    const listing = { type: 'folder.listing', path: '/w', parent: '/', entries: ['api', 'web'] };
    expect(ServerMessageSchema.parse(listing)).toEqual(listing);
    expect(ServerMessageSchema.parse({ ...listing, path: '/', parent: null })).toEqual({ ...listing, path: '/', parent: null });
    const failed = { ...listing, entries: [], error: 'no such folder: /w' };
    expect(ServerMessageSchema.parse(failed)).toEqual(failed);
  });
});
