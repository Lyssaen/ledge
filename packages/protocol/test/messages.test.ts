import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage, ServerMessageSchema, SessionSchema, SessionEventSchema, PROTOCOL_PORT, NAMES, pickName, ThreadItemSchema, offers, NOTE_NOT_TYPED, isArchived, ChatTurnSchema, RefusalCodeSchema } from '../src/index.js';

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

  it('carries images and attachment ids on replies and questions', () => {
    const id = 'b'.repeat(64);
    expect(parseClientMessage({ type: 'session.reply', id: 's', text: '', attachments: [id] })).toEqual({ type: 'session.reply', id: 's', text: '', attachments: [id] });
    expect(() => parseClientMessage({ type: 'session.reply', id: 's', text: 'x', attachments: Array(6).fill(id) })).toThrow();
    expect(() => parseClientMessage({ type: 'session.reply', id: 's', text: 'x', attachments: ['nope'] })).toThrow();
    const image = { mime: 'image/png', data: 'iVBORw0KGgo=' };
    expect(parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'look', images: [image] })).toEqual({ type: 'chat.ask', qid: 'q1', text: 'look', images: [image] });
    expect(() => parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'look', images: Array(6).fill(image) })).toThrow();
    expect(parseServerMessage({ type: 'session.queue.restored', id: 's', texts: ['a'], entries: [{ text: 'a', attachments: [id] }, { text: 'b' }], imagesDropped: true }).type).toBe('session.queue.restored');
    expect(parseServerMessage({ type: 'session.queue.restored', id: 's', texts: ['a'] }).type).toBe('session.queue.restored');
    expect(SessionEventSchema.parse({ name: 'UserPromptSubmit', at: T0, source: 'daemon', attachments: [id] }).attachments).toEqual([id]);
    expect(() => SessionEventSchema.parse({ name: 'UserPromptSubmit', at: T0, source: 'daemon', attachments: Array(6).fill(id) })).toThrow();
  });

  it('carries image refs on a prompt and a chat turn', () => {
    const ref = { id: 'c'.repeat(64), mime: 'image/jpeg', width: 10, height: 10, bytes: 99, preview: true };
    expect(ThreadItemSchema.parse({ kind: 'prompt', id: 'p', at: T0, turn: 1, text: 'hi', images: [ref] })).toMatchObject({ images: [ref] });
    expect(ChatTurnSchema.parse({ qid: 'q', question: 'q', askedAt: T0, steps: [], attachments: [ref] }).attachments).toEqual([ref]);
  });

  it('knows the attachment refusals', () => {
    expect(RefusalCodeSchema.parse('attachment_missing')).toBe('attachment_missing');
    expect(RefusalCodeSchema.parse('attachments_not_accepted')).toBe('attachments_not_accepted');
  });

  it('carries the chat messages', () => {
    expect(parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'Où en sont les autres ?' })).toEqual({ type: 'chat.ask', qid: 'q1', text: 'Où en sont les autres ?' });
    expect(parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'x', tool: 'codex' })).toEqual({ type: 'chat.ask', qid: 'q1', text: 'x', tool: 'codex' });
    // Empty text is the daemon's to refuse (an image may carry the question), not the schema's.
    expect(parseClientMessage({ type: 'chat.ask', qid: 'q1', text: '' }).type).toBe('chat.ask');
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

describe('protocol: several sessions in one answer (#24)', () => {
  const a = { cwd: '/w/a', project: 'a', tool: 'claude' as const }, b = { cwd: '/w/b', project: 'b', tool: 'codex' as const, launchedId: 'n2' };
  it('chat.done and a turn carry the list beside the first proposal', () => {
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal: a, proposals: [a, b] })).toEqual({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal: a, proposals: [a, b] });
    const h = parseServerMessage({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], proposal: a, proposals: [a, b] }] });
    expect(h.type === 'chat.history' && h.turns[0]!.proposals).toEqual([a, b]);
  });
  it('holds at most 8 sessions', () => {
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposals: Array(9).fill(a) })).toThrow();
  });
  it('session.launch names the card rows to launch, each once, within the 8', () => {
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w/a', qid: 'q1', rows: [0, 2] })).toMatchObject({ rows: [0, 2] });
    for (const rows of [[], [8], [-1], [1, 1], [0.5]]) expect(() => parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w/a', qid: 'q1', rows })).toThrow();
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
  it('folder.create carries machineId and requestId too, like folder.list', () => {
    const asked = { type: 'folder.create', parent: '/w', name: 'new', machineId: 'nas', requestId: 'c1' };
    expect(parseClientMessage(asked)).toEqual(asked);
    expect(() => parseClientMessage({ type: 'folder.create', parent: '/w', name: 'new', requestId: '' })).toThrow();
    expect(() => parseClientMessage({ type: 'folder.create', parent: '/w', name: 'new', requestId: 'x'.repeat(101) })).toThrow();
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

describe('project proposal from the chat (lot 11 task 5)', () => {
  const projectProposal = { name: 'Paper', description: 'Les polices', repos: [{ path: '/w/paper-fonts', why: 'Nommé paper-*' }], addTo: 'Ledge' };
  it('a turn and chat.done carry a project proposal; old messages still parse', () => {
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', projectProposal })).toMatchObject({ projectProposal });
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z' })).not.toHaveProperty('projectProposal');
    const turn = { qid: 'q1', question: 'crée un projet', askedAt: '2026-10-12T10:00:00.000Z', steps: [], projectProposal };
    expect(parseServerMessage({ type: 'chat.history', turns: [turn] })).toEqual({ type: 'chat.history', turns: [turn] });
  });
  it('rejects a proposal without repositories, or with a path over 4096 characters', () => {
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', projectProposal: { ...projectProposal, repos: [] } })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', projectProposal: { ...projectProposal, repos: [{ path: '/' + 'x'.repeat(4096), why: 'x' }] } })).toThrow();
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', projectProposal: { ...projectProposal, repos: [{ path: '/' + 'x'.repeat(4095), why: 'x' }] } })).toHaveProperty('projectProposal');
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
  it("carries the daemon's home when it gives one, and stays valid without it (older daemons)", () => {
    const withHome = parseServerMessage({ type: 'snapshot', sessions: [], daemon: { version: '0.3.0', install: 'npm', systemd: true, home: '/home/u' } });
    expect(withHome).toMatchObject({ daemon: { home: '/home/u' } });
    const without = parseServerMessage({ type: 'snapshot', sessions: [], daemon: { version: '0.3.0', install: 'npm', systemd: true } });
    expect(without).toMatchObject({ daemon: { version: '0.3.0' } });
    expect((without as { daemon: { home?: string } }).daemon.home).toBeUndefined();
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
    expect(ThreadItemSchema.parse({ kind: 'tool', id: 'toolu_q', at, turn: 1, tool: 'AskUserQuestion', label: 'Q ?', status: 'unknown', byClose: true })).toMatchObject({ byClose: true });
    expect(ThreadItemSchema.safeParse({ kind: 'tool', id: 'toolu_q', at, turn: 1, tool: 'AskUserQuestion', label: 'Q ?', status: 'unknown', byClose: false }).success).toBe(false);
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

  it("parses a sent and a received message, and a session's last message", () => {
    const sent = { kind: 'sent', id: 'toolu_1', at: T0, turn: 2, to: 'harness-assistant-bf', peer: 'bc8e', summary: 'OK', text: 'Vas-y', status: 'read', received: 'recv-5-0' };
    const received = { kind: 'received', id: 'recv-5-0', at: T0, turn: 5, from: 'harness-assistant-2d', peer: 'fce8', text: 'Vas-y', sent: 'toolu_1' };
    expect(ThreadItemSchema.parse(sent)).toEqual(sent);
    expect(ThreadItemSchema.parse(received)).toEqual(received);
    expect(() => ThreadItemSchema.parse({ ...sent, status: 'lu' })).toThrow();
    const lastMessage = { id: 'toolu_1', to: 'harness-assistant-bf', peer: 'bc8e', summary: 'OK', at: T0 };
    expect(SessionSchema.parse({ ...session, lastMessage }).lastMessage).toEqual(lastMessage);
  });
});

describe('session management messages', () => {
  it('parses archive, restore, resume and delete with an id', () => {
    for (const type of ['session.archive', 'session.restore', 'session.resume', 'session.delete']) {
      expect(parseClientMessage({ type, id: 'ab12' })).toEqual({ type, id: 'ab12' });
    }
  });
  it('refuses them without an id', () => {
    expect(() => parseClientMessage({ type: 'session.delete' })).toThrow();
  });
  it('keeps archivedAt on a session and agentSessionId on an event', () => {
    expect(SessionSchema.parse({ ...session, archivedAt: '2026-10-18T10:00:00.000Z' }).archivedAt).toBe('2026-10-18T10:00:00.000Z');
    expect(SessionSchema.parse({ ...session, restoredAt: '2026-10-18T11:00:00.000Z' }).restoredAt).toBe('2026-10-18T11:00:00.000Z');
    expect(SessionEventSchema.parse({ name: 'Stop', at: T0, source: 'hook', agentSessionId: 'u-1' }).agentSessionId).toBe('u-1');
  });
  it('isArchived', () => {
    expect(isArchived({ archivedAt: undefined })).toBe(false);
    expect(isArchived({ archivedAt: '2026-10-18T10:00:00.000Z' })).toBe(true);
  });
});

describe('mobile access messages', () => {
  const state = {
    enabled: true, relayUrl: 'https://app.kl-ledge.dev', account: { login: 'octocat', accountId: 'A' }, signin: null, signinError: null,
    link: { state: 'offline', retryAt: T0, error: 'connection closed (1006)' },
    devices: [{ id: 'f'.repeat(22), label: 'Pixel', approvedAt: T0, online: false }],
    pairings: [{ id: 'p1', label: 'Pixel', code: '123456', expiresAt: T0, state: 'confirm' }]
  };
  it('parses the state message and refuses an unknown link state', () => {
    expect(parseServerMessage({ type: 'mobile', state })).toEqual({ type: 'mobile', state });
    expect(() => parseServerMessage({ type: 'mobile', state: { ...state, link: { state: 'sleeping' } } })).toThrow();
  });
  it('parses the commands; mobile.set reduces relayUrl to its origin and refuses plain http elsewhere than localhost', () => {
    expect(parseClientMessage({ type: 'mobile.set', enabled: true, relayUrl: 'https://relay.example/' })).toEqual({ type: 'mobile.set', enabled: true, relayUrl: 'https://relay.example' });
    expect(() => parseClientMessage({ type: 'mobile.set', enabled: true, relayUrl: 'http://relay.example' })).toThrow();
    for (const type of ['mobile.signin', 'mobile.signin.cancel', 'mobile.signout', 'mobile.retry']) expect(parseClientMessage({ type }).type).toBe(type);
    for (const type of ['mobile.pairing.approve', 'mobile.pairing.deny', 'mobile.device.revoke']) {
      expect(parseClientMessage({ type, id: 'x' })).toEqual({ type, id: 'x' });
      expect(() => parseClientMessage({ type, id: '' })).toThrow();
    }
  });
});

describe('session.message and message.ack', () => {
  const message = { type: 'session.message', rid: 'r1', from: 'ab12', to: 'Otto [fce8]', text: 'Vas-y', summary: 'OK', intercept: true };
  it('parses a full session.message and refuses an empty text', () => {
    expect(parseClientMessage(message)).toEqual(message);
    expect(() => parseClientMessage({ ...message, text: '' })).toThrow();
  });
  it('caps a session.message: 20000 characters of text, 500 of summary', () => {
    expect(parseClientMessage({ ...message, text: 'x'.repeat(20000), summary: 's'.repeat(500) })).toBeTruthy();
    expect(() => parseClientMessage({ ...message, text: 'x'.repeat(20001) })).toThrow();
    expect(() => parseClientMessage({ ...message, summary: 's'.repeat(501) })).toThrow();
  });
  it('parses a message.ack and refuses an unknown outcome', () => {
    const ack = { type: 'message.ack', rid: 'r1', outcome: 'refused', reason: 'x' };
    expect(parseServerMessage(ack)).toEqual(ack);
    expect(() => parseServerMessage({ ...ack, outcome: 'sent' })).toThrow();
  });
});

describe('protocol: model and effort (#58)', () => {
  it('session.launch carries a model and an effort, never one that reads as a flag', () => {
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w', model: 'opus', effort: 'high' })).toMatchObject({ model: 'opus', effort: 'high' });
    expect(parseClientMessage({ type: 'session.launch', tool: 'cursor', cwd: '/w', model: 'claude-opus-4-8[effort=high,fast=false]' })).toMatchObject({ model: 'claude-opus-4-8[effort=high,fast=false]' });
    for (const model of ['', '-p', '--dangerously-skip-permissions', 'a b', 'x;rm']) expect(() => parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w', model })).toThrow();
    for (const effort of ['', 'HIGH', '-x', 'very high']) expect(() => parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w', effort })).toThrow();
  });
  it('models.list asks a machine, models.listing answers with the choices or why not', () => {
    expect(parseClientMessage({ type: 'models.list', requestId: 'm1', tool: 'codex', machineId: 'dev' })).toEqual({ type: 'models.list', requestId: 'm1', tool: 'codex', machineId: 'dev' });
    const models = [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'ultra'], defaultEffort: 'low', isDefault: true }];
    expect(parseServerMessage({ type: 'models.listing', requestId: 'm1', tool: 'codex', models })).toEqual({ type: 'models.listing', requestId: 'm1', tool: 'codex', models });
    expect(parseServerMessage({ type: 'models.listing', requestId: 'm1', tool: 'codex', models: [], error: 'offline' })).toMatchObject({ error: 'offline' });
    expect(() => parseClientMessage({ type: 'models.list', requestId: 'm1', tool: 'vim' })).toThrow();
  });
  it('session.model changes a live session\'s model and effort, null for the agent\'s default (lot 2)', () => {
    expect(parseClientMessage({ type: 'session.model', id: 's1', model: 'gpt-6-astra', effort: 'high' })).toEqual({ type: 'session.model', id: 's1', model: 'gpt-6-astra', effort: 'high' });
    expect(parseClientMessage({ type: 'session.model', id: 's1', model: null, effort: null })).toMatchObject({ model: null, effort: null });
    expect(() => parseClientMessage({ type: 'session.model', id: 's1', model: '--yolo', effort: null })).toThrow();
    expect(() => parseClientMessage({ type: 'session.model', id: 's1', model: 'opus' })).toThrow();
  });
  it('session.close takes the card qid and optional rows, session.closed answers each row', () => {
    expect(parseClientMessage({ type: 'session.close', qid: 'q1' })).toEqual({ type: 'session.close', qid: 'q1' });
    expect(parseClientMessage({ type: 'session.close', qid: 'q1', rows: [0, 7] })).toMatchObject({ rows: [0, 7] });
    for (const rows of [[], [8], [1, 1], [0, 1, 2, 3, 4, 5, 6, 7, 0]]) expect(() => parseClientMessage({ type: 'session.close', qid: 'q1', rows })).toThrow();
    const closed = { type: 'session.closed', qid: 'q1', row: 0, id: 's1', how: 'killed' };
    expect(parseServerMessage(closed)).toEqual(closed);
    expect(() => parseServerMessage({ ...closed, how: 'quit' })).toThrow();
  });
  it('chat.act takes the card qid, optional rows and a literal confirmed; chat.acted answers it', () => {
    expect(parseClientMessage({ type: 'chat.act', rid: 'r1', qid: 'q1' })).toEqual({ type: 'chat.act', rid: 'r1', qid: 'q1' });
    expect(parseClientMessage({ type: 'chat.act', rid: 'r1', qid: 'q1', rows: [2, 0], confirmed: true })).toMatchObject({ rows: [2, 0], confirmed: true });
    expect(() => parseClientMessage({ type: 'chat.act', rid: 'r1', qid: 'q1', confirmed: false })).toThrow();
    expect(() => parseClientMessage({ type: 'chat.act', rid: 'r1', qid: 'q1', rows: [1, 1] })).toThrow();
    // « Refuser »: the rows' requests answered with deny, never confirmed; only a literal true.
    expect(parseClientMessage({ type: 'chat.act', rid: 'r1', qid: 'q1', rows: [0], deny: true })).toEqual({ type: 'chat.act', rid: 'r1', qid: 'q1', rows: [0], deny: true });
    expect(() => parseClientMessage({ type: 'chat.act', rid: 'r1', qid: 'q1', deny: false })).toThrow();
    const turn = { qid: 'q1', question: '?', askedAt: T0, steps: [] };
    const denied = { action: 'session.decide', args: { session: 's1', decision: 'accept' }, summary: 'Accepter', risk: 'destructive', state: 'denied', doneAt: T0 };
    expect(ChatTurnSchema.parse({ ...turn, actions: [denied] }).actions?.[0]).toMatchObject({ state: 'denied', doneAt: T0 });
    const acted = { type: 'chat.acted', rid: 'r1', qid: 'q1', done: [0], failed: [{ row: 1, message: 'unknown session', refused: true }, { row: 2, message: 'busy' }] };
    expect(parseServerMessage(acted)).toEqual(acted);
    expect(() => parseServerMessage({ ...acted, failed: [{ row: 1, message: 'x', refused: false }] })).toThrow();
  });
  it('action.run names a registry action and its args, by a session or the user; action.result answers it with the row or why not', () => {
    const run = { type: 'action.run', rid: 'r1', by: 's1', action: 'session.close', args: { session: 'api' }, confirmed: true };
    expect(parseClientMessage(run)).toEqual(run);
    expect(parseClientMessage({ type: 'action.run', rid: 'r1', action: 'session.resume', args: { session: 'api' } })).not.toHaveProperty('by');
    expect(() => parseClientMessage({ ...run, action: 'session.kill' })).toThrow();
    expect(() => parseClientMessage({ ...run, confirmed: false })).toThrow();
    const row = { action: 'session.close', args: { session: 'local:api' }, summary: 'Fermer **api**', risk: 'reversible', session: 'local:api' };
    const done = { type: 'action.result', rid: 'r1', action: 'session.close', row };
    expect(parseServerMessage(done)).toEqual(done);
    const refused = { type: 'action.result', rid: 'r1', action: 'session.close', row, reason: 'confirm', code: 'confirm_required' };
    expect(parseServerMessage(refused)).toEqual(refused);
    expect(parseServerMessage({ type: 'action.result', rid: 'r1', action: 'session.close', path: '/h/.ledge/teams/api.yaml' })).toMatchObject({ path: '/h/.ledge/teams/api.yaml' });
    expect(parseServerMessage({ type: 'action.result', rid: 'r1', action: 'session.close', reason: 'x', code: 'something-newer' })).toMatchObject({ code: 'something-newer' });
  });
  it('chat.done and a turn carry the generic rows, one to eight, each a registry action', () => {
    const row = { action: 'session.close', args: { session: 'local:api' }, summary: 'Fermer **api**', risk: 'reversible', session: 'local:api' };
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions: [row] })).toMatchObject({ actions: [row] });
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions: [] })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions: Array(9).fill(row) })).toThrow();
    // An action this front does not know yet still parses: it is drawn from its summary (spec §5.2).
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions: [{ ...row, action: 'session.later' }] })).toMatchObject({ actions: [{ action: 'session.later' }] });
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions: [{ ...row, action: '' }] })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions: [{ ...row, summary: 'x'.repeat(301) }] })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, actions: [{ ...row, risk: 'harmless' }] })).toThrow();
    const turn = { qid: 'q1', question: '?', askedAt: T0, steps: [] };
    expect(ChatTurnSchema.parse({ ...turn, actions: [{ ...row, state: 'done', doneAt: T0 }] }).actions?.[0]?.state).toBe('done');
    // Refused: nothing was sent (a target changed, a request answered meanwhile); failed: sent, and it went wrong.
    expect(ChatTurnSchema.parse({ ...turn, actions: [{ ...row, state: 'refused', error: 'unknown team' }] }).actions?.[0]?.state).toBe('refused');
  });
  it('a generic row carries its words for each front (vars), a cut detail and an error code', () => {
    const row = { action: 'session.decide', args: { session: 's1', decision: 'deny' }, summary: 'Refuser la demande de plan de **Nova**', risk: 'reversible',
      vars: { session: 'Nova', decision: 'deny', kind: 'plan', note: 'Pas sur main' }, detail: 'Le plan…', detailCut: true, state: 'refused', error: 'Nova has exited', code: 'exited' };
    const turn = { qid: 'q1', question: '?', askedAt: T0, steps: [] };
    expect(ChatTurnSchema.parse({ ...turn, actions: [row] }).actions?.[0]).toMatchObject({ vars: row.vars, detailCut: true, code: 'exited' });
    expect(() => ChatTurnSchema.parse({ ...turn, actions: [{ ...row, vars: { note: 'x'.repeat(301) } }] })).toThrow();
    expect(() => ChatTurnSchema.parse({ ...turn, actions: [{ ...row, detailCut: false }] })).toThrow();
  });
  it('a turn may be ignored, and chat.ignore ignores it or opens it again', () => {
    const turn = { qid: 'q1', question: '?', askedAt: T0, steps: [], ignoredAt: T0 };
    expect(ChatTurnSchema.parse(turn).ignoredAt).toBe(T0);
    expect(parseClientMessage({ type: 'chat.ignore', qid: 'q1' })).toEqual({ type: 'chat.ignore', qid: 'q1' });
    expect(parseClientMessage({ type: 'chat.ignore', qid: 'q1', undo: true })).toEqual({ type: 'chat.ignore', qid: 'q1', undo: true });
    expect(() => parseClientMessage({ type: 'chat.ignore', qid: '' })).toThrow();
    expect(() => parseClientMessage({ type: 'chat.ignore', qid: 'q1', undo: false })).toThrow();
  });
  it('chat.done and a turn carry the close rows, one to eight', () => {
    const row = { id: 's1', name: 'Arlo', tool: 'claude' };
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, closes: [row] })).toMatchObject({ closes: [row] });
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, closes: [] })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, closes: Array(9).fill(row) })).toThrow();
    const turn = { qid: 'q1', question: '?', askedAt: T0, steps: [] };
    expect(ChatTurnSchema.parse({ ...turn, closes: [row] }).closes).toEqual([row]);
    expect(() => ChatTurnSchema.parse({ ...turn, closes: [] })).toThrow();
    expect(() => ChatTurnSchema.parse({ ...turn, closes: Array(9).fill(row) })).toThrow();
  });
});

describe('session.model.accepted', () => {
  it('says when the change applies', () => {
    expect(ServerMessageSchema.safeParse({ type: 'session.model.accepted', id: 'a', when: 'turn' }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'session.model.accepted', id: 'a', when: 'later' }).success).toBe(false);
  });
});

describe('chat.done without team or tasks', () => {
  it('a chat.done with an old team or tasks field parses, without them', () => {
    const r = ServerMessageSchema.parse({ type: 'chat.done', qid: 'q', text: 't', at: T0, team: { name: 'x' }, tasks: [{ to: 'a', title: 'b' }] });
    expect(r).not.toHaveProperty('team'); expect(r).not.toHaveProperty('tasks');
  });
});
