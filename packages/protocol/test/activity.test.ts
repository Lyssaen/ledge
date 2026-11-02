import { describe, it, expect } from 'vitest';
import { createActivityFeed, outranks, type NotchActivity, type ServerMessage, type Session, type ThreadItem } from '../src/index.js';

const T0 = '2026-11-02T18:00:00.000Z';
const T1 = '2026-11-02T18:00:05.000Z';

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1', name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge', tmuxSession: 'ledge-s1',
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T1, source: 'launcher', ...over
});
const snapshot = (...sessions: Session[]): ServerMessage => ({ type: 'snapshot', sessions });
const updated = (s: Session): ServerMessage => ({ type: 'session.updated', session: s });
const item = (it: ThreadItem, id = 's1'): ServerMessage => ({ type: 'session.thread.item', id, item: it });
const tool = (status: 'running' | 'success' | 'failed', over: Partial<Extract<ThreadItem, { kind: 'tool' }>> = {}): ThreadItem =>
  ({ kind: 'tool', id: 'tu1', at: T0, turn: 1, tool: 'Bash', label: 'pnpm test', status, files: [], ...over });

describe('activity feed', () => {
  it('says an action started once, even when the daemon re-broadcasts its row', () => {
    const feed = createActivityFeed();
    feed.push(snapshot(session()));
    expect(feed.push(item(tool('running')))).toEqual({ kind: 'tool', session: 's1', at: T0, tool: 'Bash', label: 'pnpm test' });
    expect(feed.push(item(tool('running')))).toBeNull();
  });

  it('goes back to thinking when an action ends mid-turn, not once the turn is over', () => {
    const feed = createActivityFeed();
    feed.push(snapshot(session()));
    feed.push(item(tool('running')));
    expect(feed.push(item(tool('success', { at: T1 })))).toEqual({ kind: 'thinking', session: 's1', at: T1 });
    expect(feed.push(item(tool('success', { at: T1 })))).toBeNull();
    feed.push(updated(session({ state: 'idle' })));
    expect(feed.push(item(tool('failed', { id: 'tu2' })))).toBeNull();
  });

  it('starts thinking on a prompt', () => {
    const feed = createActivityFeed();
    expect(feed.push(item({ kind: 'prompt', id: 'p1', at: T0, turn: 1, text: 'go' }))).toEqual({ kind: 'thinking', session: 's1', at: T0 });
  });

  it('keeps a sub-agent apart', () => {
    const feed = createActivityFeed();
    feed.push(snapshot(session()));
    expect(feed.push(item(tool('running', { helperId: 'h1' })))).toMatchObject({ kind: 'tool', helperId: 'h1' });
  });

  it('says a message between agents once, from the sender, with its summary', () => {
    const feed = createActivityFeed();
    feed.push(snapshot(session(), session({ id: 's2', name: 'Plume' })));
    const sent: ThreadItem = { kind: 'sent', id: 'm1', at: T0, turn: 1, to: 'plume', peer: 's2', summary: 'Contrat posé', text: 'Le contrat est posé\nvoir commit', status: 'sending' };
    expect(feed.push(item(sent))).toEqual({ kind: 'message', session: 's1', at: T0, direction: 'out', counterpart: 'plume', peer: 's2', summary: 'Contrat posé' });
    expect(feed.push(item({ ...sent, status: 'delivered' }))).toBeNull();
    // the receiver's card, paired with that sent one, is the same message
    expect(feed.push(item({ kind: 'received', id: 'r1', at: T0, turn: 3, from: 'Otto', peer: 's1', text: 'Le contrat est posé', sent: 'm1' }, 's2'))).toBeNull();
  });

  it('takes a message without summary by its first line, and a failed send not at all', () => {
    const feed = createActivityFeed();
    const sent: ThreadItem = { kind: 'sent', id: 'm2', at: T0, turn: 1, to: 'review', text: '\n  Revue   prête  \nsuite', status: 'sending' };
    expect(feed.push(item(sent))).toMatchObject({ summary: 'Revue prête' });
    expect(feed.push(item({ ...sent, id: 'm3', status: 'failed' }))).toBeNull();
  });

  it('says a message from an agent Ledge does not know, on the receiver', () => {
    const feed = createActivityFeed();
    expect(feed.push(item({ kind: 'received', id: 'r2', at: T0, turn: 1, from: 'pilot-lead@ledge-dev-2', text: 'Ta ligne est prête' })))
      .toEqual({ kind: 'message', session: 's1', at: T0, direction: 'in', counterpart: 'pilot-lead@ledge-dev-2', summary: 'Ta ligne est prête' });
  });

  it('notifies when an agent needs the user, once per request', () => {
    const feed = createActivityFeed();
    feed.push(snapshot(session()));
    const asking = session({ state: 'waiting_permission', pending: { kind: 'permission', text: 'rm -rf dist', tool: 'Bash', source: 'hook' } });
    expect(feed.push(updated(asking))).toEqual({ kind: 'notification', session: 's1', at: T1, reason: 'permission', text: 'rm -rf dist' });
    expect(feed.push(updated({ ...asking, lastActivityAt: '2026-11-02T18:00:09.000Z' }))).toBeNull();
    const question = session({ state: 'waiting_input', pending: { kind: 'question', text: 'Which branch?', source: 'hook' } });
    expect(feed.push(updated(question))).toMatchObject({ reason: 'question', text: 'Which branch?' });
  });

  it('notifies a finished turn and a failure', () => {
    const feed = createActivityFeed();
    feed.push(snapshot(session()));
    expect(feed.push(updated(session({ state: 'idle' })))).toEqual({ kind: 'notification', session: 's1', at: T1, reason: 'finished' });
    expect(feed.push(updated(session({ state: 'idle' })))).toBeNull();
    expect(feed.push(updated(session({ state: 'error', lastError: 'API overloaded' })))).toMatchObject({ reason: 'error', text: 'API overloaded' });
  });

  it('stays quiet on a session it learns about, an archived one, and other messages', () => {
    const feed = createActivityFeed();
    expect(feed.push(updated(session({ state: 'idle' })))).toBeNull();
    feed.push(snapshot(session({ archivedAt: T0 })));
    expect(feed.push(item(tool('running')))).toBeNull();
    expect(feed.push(updated(session({ state: 'idle', archivedAt: T0 })))).toBeNull();
    expect(feed.push({ type: 'recents', recents: [] })).toBeNull();
    expect(feed.push(item({ kind: 'reply', id: 'x', at: T0, turn: 1, text: 'done' }))).toBeNull();
  });

  it('forgets a removed session', () => {
    const feed = createActivityFeed();
    feed.push(snapshot(session()));
    feed.push({ type: 'session.removed', id: 's1' });
    expect(feed.push(updated(session({ state: 'idle' })))).toBeNull();
  });
});

describe('activity priority', () => {
  const msg: NotchActivity = { kind: 'message', session: 's1', at: T0, direction: 'out', counterpart: 'x', summary: 'y' };
  const toolA: NotchActivity = { kind: 'tool', session: 's1', at: T0, tool: 'Bash', label: 'ls' };
  const note: NotchActivity = { kind: 'notification', session: 's1', at: T0, reason: 'finished' };
  it('lets a message take the line from anything, and nothing lower take it from a message', () => {
    expect(outranks(msg, toolA)).toBe(true);
    expect(outranks(msg, note)).toBe(true);
    expect(outranks(toolA, msg)).toBe(false);
    expect(outranks(note, msg)).toBe(false);
    expect(outranks(note, toolA)).toBe(true);
    expect(outranks(toolA, { kind: 'thinking', session: 's1', at: T0 })).toBe(true);
    expect(outranks(toolA, null)).toBe(true);
  });
});
