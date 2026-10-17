import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage, ServerMessageSchema, SessionSchema, SessionEventSchema, PROTOCOL_PORT, NAMES, pickName, ThreadItemSchema, offers, NOTE_NOT_TYPED } from '../src/index.js';

const T0 = '2026-10-09T18:02:00.000Z';

const session = {
  id: '7f3a', name: 'Otto', tool: 'claude', cwd: '/home/u/Workspace/harness-assistant',
  project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: 'ledge-7f3a',
  state: 'waiting_permission',
  pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' },
  helpers: [], startedAt: '2026-10-09T18:00:00.000Z', lastActivityAt: '2026-10-09T18:01:00.000Z',
  source: 'launcher'
};

describe('protocol', () => {
  it('validates document requests and replies without accepting empty or oversized paths', () => {
    const request = { type: 'document.read', requestId: 'r1', path: 'docs/plan.md', sessionId: 's1' };
    expect(parseClientMessage(request)).toEqual(request);
    expect(() => parseClientMessage({ ...request, requestId: '' })).toThrow();
    expect(() => parseClientMessage({ ...request, path: '' })).toThrow();
    expect(() => parseClientMessage({ ...request, path: 'a'.repeat(4097) })).toThrow();
    expect(() => parseClientMessage({ ...request, basePath: 'a'.repeat(4097) })).toThrow();
    const content = { type: 'document.content', requestId: 'r1', path: '/w/docs/plan.md', text: '# Plan', bytes: 6, modifiedAt: T0 };
    expect(parseServerMessage(content)).toEqual(content);
    expect(() => parseServerMessage({ ...content, bytes: -1 })).toThrow();
    expect(() => parseServerMessage({ ...content, modifiedAt: 'yesterday' })).toThrow();
    expect(parseServerMessage({ type: 'document.error', requestId: 'r1', path: 'docs/no.md', code: 'not_found' }).type).toBe('document.error');
    expect(() => parseServerMessage({ type: 'document.error', requestId: 'r1', path: 'x', code: 'unknown' })).toThrow();
  });
  it('exposes the port', () => { expect(PROTOCOL_PORT).toBe(47831); });

  it('accepts and keeps the optional offline flag', () => {
    const s = SessionSchema.parse({ ...session, offline: true });
    expect(s.offline).toBe(true);
    expect(SessionSchema.parse(session).offline).toBeUndefined();
  });

  it('accepts a full session', () => {
    expect(SessionSchema.parse(session)).toEqual(session);
  });

  it('accepts a session with topic and repository fields', () => {
    const s = { ...session, topic: 'Hooks Codex', topicSource: 'pane', repo: 'harness-assistant', repoPath: '/w/harness-assistant', branch: 'worktree-codex', worktree: true };
    expect(SessionSchema.parse(s).worktree).toBe(true);
  });

  it('accepts the new session events and the rename message', () => {
    expect(SessionEventSchema.parse({ name: 'PaneTitle', at: T0, source: 'pane', text: 'add-readme' }).name).toBe('PaneTitle');
    expect(SessionEventSchema.parse({ name: 'Renamed', at: T0, source: 'daemon', text: 'Mon sujet' }).name).toBe('Renamed');
    expect(parseClientMessage({ type: 'session.rename', id: 'a', topic: 'Mon sujet' }).type).toBe('session.rename');
  });

  it('caps a rename topic at 500 characters, like the hook caps a prompt', () => {
    expect(parseClientMessage({ type: 'session.rename', id: 'a', topic: 'x'.repeat(500) }).type).toBe('session.rename');
    expect(() => parseClientMessage({ type: 'session.rename', id: 'a', topic: 'x'.repeat(501) })).toThrow();
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

  it('carries the chat messages', () => {
    expect(parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'Où en sont les autres ?' })).toEqual({ type: 'chat.ask', qid: 'q1', text: 'Où en sont les autres ?' });
    expect(parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'x', tool: 'codex' })).toEqual({ type: 'chat.ask', qid: 'q1', text: 'x', tool: 'codex' });
    expect(() => parseClientMessage({ type: 'chat.ask', qid: 'q1', text: '' })).toThrow();
    expect(() => parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'x', tool: 'gemini' })).toThrow();
    expect(parseClientMessage({ type: 'chat.reset' }).type).toBe('chat.reset');
    expect(parseServerMessage({ type: 'chat.step', qid: 'q1', step: { kind: 'pane', id: 'a', name: 'Nova' } }).type).toBe('chat.step');
    expect(parseServerMessage({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', askedAt: T0, steps: [] }] }).type).toBe('chat.history');
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0 }).type).toBe('chat.done');
  });

  it('carries a launch proposal on a turn, on chat.done, and the card qid on session.launch', () => {
    const proposal = { cwd: '/w/ledge', project: 'ledge', prompt: 'Corrige le build', tool: 'claude' as const };
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal })).toEqual({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal });
    const launched = { ...proposal, launchedId: 'n1' };
    const h = parseServerMessage({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], answer: 'ok', answeredAt: T0, proposal: launched }] });
    expect(h.type === 'chat.history' && h.turns[0]!.proposal).toEqual(launched);
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal: { ...proposal, tool: 'vim' } })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal: { ...proposal, cwd: '' } })).toThrow();
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', qid: 'q1' })).toEqual({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', qid: 'q1' });
    // Older messages stay valid.
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0 })).not.toHaveProperty('proposal');
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w' })).not.toHaveProperty('qid');
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
    const asked = { type: 'folder.list', path: '/w', machineId: 'nas', requestId: 'r1' };
    expect(parseClientMessage(asked)).toEqual(asked);
    expect(() => parseClientMessage({ type: 'folder.list', requestId: '' })).toThrow();
    expect(() => parseClientMessage({ type: 'folder.list', requestId: 'x'.repeat(101) })).toThrow();
  });
  it('folder.listing carries requestId and the repositories with their branch', () => {
    const l = { type: 'folder.listing', requestId: 'r1', path: '/w', parent: '/', entries: ['a'], repos: [{ name: 'a', branch: 'main' }] };
    expect(ServerMessageSchema.parse(l)).toEqual(l);
    expect(() => ServerMessageSchema.parse({ ...l, repos: [{ name: 'a' }] })).toThrow();
  });
  it('parses folder.listing, with a parent, at the root, and carrying an error', () => {
    const listing = { type: 'folder.listing', path: '/w', parent: '/', entries: ['api', 'web'] };
    expect(ServerMessageSchema.parse(listing)).toEqual(listing);
    expect(ServerMessageSchema.parse({ ...listing, path: '/', parent: null })).toEqual({ ...listing, path: '/', parent: null });
    const failed = { ...listing, entries: [], error: 'no such folder: /w' };
    expect(ServerMessageSchema.parse(failed)).toEqual(failed);
  });
});

describe('protocol: launching with several folders and inspecting repos', () => {
  it('session.launch takes dirs and a machineId', () => {
    const m = { type: 'session.launch', tool: 'claude', cwd: '/w/a', dirs: ['/w/b'], machineId: 'm1' };
    expect(parseClientMessage(m)).toEqual(m);
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w/a' })).not.toHaveProperty('dirs');
    expect(() => parseClientMessage({ ...m, dirs: [''] })).toThrow();
    expect(() => parseClientMessage({ ...m, dirs: Array.from({ length: 21 }, () => '/x') })).toThrow();
  });
  it('parses repos.inspect and repos.info', () => {
    const q = { type: 'repos.inspect', requestId: 'r1', paths: ['/w/a', '~/b'], machineId: 'm1' };
    expect(parseClientMessage(q)).toEqual(q);
    expect(() => parseClientMessage({ ...q, paths: [] })).toThrow();
    expect(() => parseClientMessage({ ...q, requestId: '' })).toThrow();
    const info = { type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: true, branch: 'main' }, { path: '/w/b', exists: true, branch: null }] };
    expect(parseServerMessage(info)).toEqual(info);
    expect(() => parseServerMessage({ ...info, repos: [{ path: '/w', exists: true }] })).toThrow();
  });
  it('parses repos.scan and repos.found (lot 11): a machineId to route, a bounded list, truncated and an optional error', () => {
    const q = { type: 'repos.scan', requestId: 's1', machineId: 'm1' };
    expect(parseClientMessage(q)).toEqual(q);
    expect(parseClientMessage({ type: 'repos.scan', requestId: 's1' })).not.toHaveProperty('machineId');
    expect(() => parseClientMessage({ ...q, requestId: '' })).toThrow();
    expect(() => parseClientMessage({ ...q, requestId: 'x'.repeat(101) })).toThrow();
    const found = { type: 'repos.found', requestId: 's1', repos: [{ path: '/w/ledge', branch: 'main', remote: 'github.com/paradow/ledge' }, { path: '/w/empty', branch: null }], truncated: false };
    expect(parseServerMessage(found)).toEqual(found);
    expect(parseServerMessage({ ...found, repos: [], error: 'offline' })).toEqual({ ...found, repos: [], error: 'offline' });
    expect(() => parseServerMessage({ ...found, truncated: undefined })).toThrow();
    expect(() => parseServerMessage({ ...found, repos: Array.from({ length: 501 }, (_, i) => ({ path: `/w/${i}`, branch: null })) })).toThrow();
  });
});

describe('relay from the chat (spec 2026-10-12 relay §5)', () => {
  const relay = { id: 's1', name: 'Otto', tool: 'claude', text: 'Lance les tests' };
  it('a turn and chat.done carry a relay; old messages still parse', () => {
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', relay })).toMatchObject({ relay });
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z' })).not.toHaveProperty('relay');
    const turn = { qid: 'q1', question: 'dis à Otto', askedAt: '2026-10-12T10:00:00.000Z', steps: [], relay: { ...relay, status: 'sent', sentAt: '2026-10-12T10:01:00.000Z' } };
    expect(parseServerMessage({ type: 'chat.history', turns: [turn] })).toEqual({ type: 'chat.history', turns: [turn] });
  });
  it('rejects an unknown status and an empty text', () => {
    expect(() => parseServerMessage({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', askedAt: '2026-10-12T10:00:00.000Z', steps: [], relay: { ...relay, status: 'lost' } }] })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', relay: { ...relay, text: '' } })).toThrow();
  });
  it('session.relay and session.relay.cancel name the turn', () => {
    expect(parseClientMessage({ type: 'session.relay', qid: 'q1' })).toEqual({ type: 'session.relay', qid: 'q1' });
    expect(parseClientMessage({ type: 'session.relay.cancel', qid: 'q1' })).toEqual({ type: 'session.relay.cancel', qid: 'q1' });
    expect(() => parseClientMessage({ type: 'session.relay', qid: '' })).toThrow();
  });
});

describe('update messages', () => {
  it('keeps a snapshot without daemon info valid (older daemons)', () => {
    expect(parseServerMessage({ type: 'snapshot', sessions: [] })).toEqual({ type: 'snapshot', sessions: [] });
  });
  it('carries the daemon version, how it was installed and the manual command', () => {
    const m = parseServerMessage({ type: 'snapshot', sessions: [], daemon: { version: '0.3.0', install: 'git', systemd: true, manual: 'cd ~/x && git pull' } });
    expect(m).toMatchObject({ daemon: { version: '0.3.0', install: 'git', systemd: true } });
  });
  it('parses progress and failures', () => {
    expect(parseServerMessage({ type: 'update.progress', version: '0.3.0', step: 'restarting' })).toMatchObject({ step: 'restarting' });
    expect(parseServerMessage({ type: 'update.failed', version: '0.3.0', reason: 'npm-failed', detail: 'EACCES', command: 'npm i -g @paradow/ledge@0.3.0' })).toMatchObject({ reason: 'npm-failed' });
    expect(() => parseServerMessage({ type: 'update.failed', version: '0.3.0', reason: 'nope' })).toThrow();
  });
  it('accepts update.daemon only with a plain semver', () => {
    expect(parseClientMessage({ type: 'update.daemon', version: '0.3.0' })).toEqual({ type: 'update.daemon', version: '0.3.0' });
    expect(() => parseClientMessage({ type: 'update.daemon', version: 'latest' })).toThrow();
    expect(() => parseClientMessage({ type: 'update.daemon', version: '0.3.0; rm -rf ~' })).toThrow();
  });
});

describe('native session tracking (spec 2026-10-13 §3, §5)', () => {
  const at = '2026-10-13T10:00:00.000Z';
  it('validates each thread item kind and defaults the files of an action', () => {
    const tool = ThreadItemSchema.parse({ kind: 'tool', id: 'toolu_1', at, turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'running' });
    expect(tool).toMatchObject({ kind: 'tool', files: [] });
    expect(ThreadItemSchema.parse({ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Fais le plan' }).kind).toBe('prompt');
    expect(ThreadItemSchema.parse({ kind: 'helper', id: 'h1', at, turn: 1, task: 'review task 1', agentType: 'Explore', state: 'working' }).kind).toBe('helper');
    expect(ThreadItemSchema.parse({ kind: 'permission', id: 'perm-1', at, turn: 1, tool: 'Bash', text: 'rm -rf dist', decision: 'deny' }).kind).toBe('permission');
    expect(ThreadItemSchema.parse({ kind: 'reply', id: 'r1', at, turn: 1, text: 'Terminé', helperId: 'h1' }).helperId).toBe('h1');
    expect(() => ThreadItemSchema.parse({ kind: 'tool', id: 't', at, turn: 1, tool: 'Bash', label: 'x', status: 'done' })).toThrow();
  });
  it('accepts the enriched hook event and keeps the old shape valid', () => {
    const old = { type: 'session.event', id: 's', event: { name: 'PostToolUse', at, source: 'hook', tool: 'Bash' } };
    expect(parseClientMessage(old)).toMatchObject(old);
    const rich = { ...old, event: { ...old.event, toolUseId: 'toolu_1', toolInput: { command: 'pnpm test' }, output: 'ok', durationMs: 812, transcriptPath: '/t.jsonl' } };
    expect(parseClientMessage(rich)).toMatchObject(rich);
    expect(() => parseClientMessage({ ...old, event: { ...old.event, durationMs: -1 } })).toThrow();
  });
  it('carries a thread request, a thread and a single item', () => {
    expect(parseClientMessage({ type: 'session.thread', id: 's' })).toEqual({ type: 'session.thread', id: 's' });
    const item = { kind: 'message', id: 'm1', at, turn: 1, text: 'Je regarde le reducer.' };
    expect(parseServerMessage({ type: 'session.thread', id: 's', items: [item] })).toMatchObject({ type: 'session.thread', items: [item] });
    expect(parseServerMessage({ type: 'session.thread.item', id: 's', item })).toMatchObject({ type: 'session.thread.item', item });
  });
});

describe('decisions beyond accept and deny (lot 6a)', () => {
  it('session.decide takes always and a trimmed note; an empty or oversized note is refused', () => {
    expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'always' })).toEqual({ type: 'session.decide', id: 'a', decision: 'always' });
    expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', note: '  Use pnpm ' })).toMatchObject({ note: 'Use pnpm' });
    expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', note: '   ' })).toThrow();
    expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', note: 'x'.repeat(4001) })).toThrow();
    expect(parseServerMessage({ type: 'error', id: 'a', message: 'no', request: 'session.reply' })).toEqual({ type: 'error', id: 'a', message: 'no', request: 'session.reply' });
  });
  it('an error may carry a code: a deny whose note could not be typed', () => {
    const m = { type: 'error', id: 'a', message: 'denied, but the note could not be typed', request: 'session.decide', code: NOTE_NOT_TYPED };
    expect(parseServerMessage(m)).toEqual(m);
    expect(NOTE_NOT_TYPED).toBe('note_not_typed');
  });
  it('session.decide carries the request the user saw, optional (the island sends none)', () => {
    const expected = { kind: 'permission', text: 'npm test' } as const;
    expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept', expect: expected })).toEqual({ type: 'session.decide', id: 'a', decision: 'accept', expect: expected });
    expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept' })).not.toHaveProperty('expect');
    expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'maybe', text: 'x' } })).toThrow();
    expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'plan' } })).toThrow();
  });
  it('what each harness offers', () => {
    expect([offers('claude', 'plan', 'always'), offers('codex', 'plan', 'always'), offers('codex', 'diff', 'always'), offers('cursor', 'permission', 'always'),
      offers('cursor', 'plan', 'note'), offers('claude', 'question', 'note'), offers('claude', 'question', 'always')]).toEqual([true, false, true, false, true, false, false]);
  });
  it('always reaches the thread and the Decided event', () => {
    expect(SessionEventSchema.parse({ name: 'Decided', at: T0, source: 'daemon', decision: 'always' }).decision).toBe('always');
    expect(ThreadItemSchema.parse({ kind: 'permission', id: 'p', at: T0, turn: 0, tool: 'Bash', text: 'ls', decision: 'always' })).toMatchObject({ decision: 'always' });
  });
});
