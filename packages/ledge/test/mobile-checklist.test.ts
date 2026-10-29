import { describe, it, expect, afterEach } from 'vitest';
import { latestTodos, PhoneServerMessageSchema, type PhoneServerMessage, type ThreadItem } from '@ledge/protocol';
import { T0, flush, setup, stopAll } from './helpers/gateway.js';

// The agent's checklist on the phone: the gateway computes it from the main thread and pushes it (mobile checklist spec §3.1, §3.3).

afterEach(stopAll);

type Raw = { content: string; status: string; activeForm?: string };
let n = 0;
const update = (todos: Raw[], extra: Partial<ThreadItem> = {}): ThreadItem => ({
  kind: 'tool', id: `tw${++n}`, at: T0, turn: 1, tool: 'TodoWrite', label: 'TodoWrite', input: JSON.stringify({ todos }), status: 'success', files: [], ...extra
} as ThreadItem);
const PLAN: Raw[] = [
  { content: 'Read the code', status: 'completed' },
  { content: 'Write the test', status: 'in_progress', activeForm: 'Writing the test' },
  { content: 'Ship it', status: 'pending' }
];

/** A gateway whose session `a` has `PLAN`, with dev1 subscribed and watching `a`. */
async function watching() {
  const g = setup();
  g.threads.get('a')!.push(update(PLAN));
  g.send('dev1', { type: 'snapshot.request' });
  g.send('dev1', { type: 'session.watch', id: 'a' });
  await flush();
  /** Adds `item` to `a`'s thread, as history does, then forwards it; answers what dev1 got from it. */
  const add = async (item: ThreadItem) => {
    const before = g.got('dev1').length;
    g.threads.get('a')!.push(item);
    g.gw.forward({ type: 'session.thread.item', id: 'a', item });
    await flush();
    return g.got('dev1').slice(before);
  };
  return { ...g, add };
}
const ofType = <T extends PhoneServerMessage['type']>(ms: PhoneServerMessage[], type: T) => ms.filter((m): m is Extract<PhoneServerMessage, { type: T }> => m.type === type);
const snapOf = (ms: PhoneServerMessage[]) => ofType(ms, 'snapshot').at(-1)!;

describe('phone gateway: the checklist', () => {
  it('says so in the snapshot and sums each session up', async () => {
    const g = setup();
    g.threads.get('a')!.push(update(PLAN));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = snapOf(g.got('dev1'));
    expect(PhoneServerMessageSchema.parse(snap)).toMatchObject({ daemon: { checklist: true } });
    expect(snap.sessions.find(s => s.id === 'a')!.checklist).toEqual({ done: 1, total: 3, current: 'Writing the test' });
    expect(snap.sessions.find(s => s.id === 'b')).not.toHaveProperty('checklist');
  });

  it('the summary follows the latest update', async () => {
    const g = await watching();
    const got = await g.add(update([{ content: 'Read the code', status: 'completed' }, { content: 'Write the test', status: 'completed' }, { content: 'Ship it', status: 'in_progress' }]));
    const updated = ofType(got, 'session.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.session.checklist).toEqual({ done: 2, total: 3, current: 'Ship it' });
  });

  it('a new text for a pending task reaches the watcher only', async () => {
    const g = await watching();
    const got = await g.add(update([...PLAN.slice(0, 2), { content: 'Ship it today', status: 'pending' }]));
    expect(ofType(got, 'session.updated')).toHaveLength(0);
    const lists = ofType(got, 'session.checklist');
    expect(lists).toHaveLength(1);
    expect(lists[0]!.checklist!.tasks[2]).toEqual({ text: 'Ship it today', status: 'pending' });
  });

  it('an empty update takes the checklist away', async () => {
    const g = await watching();
    const got = await g.add(update([]));
    const updated = ofType(got, 'session.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.session).not.toHaveProperty('checklist');
    expect(ofType(got, 'session.checklist')).toEqual([{ type: 'session.checklist', id: 'a', checklist: null }]);
  });

  it('ignores a subagent\'s update', async () => {
    const g = await watching();
    const got = await g.add(update([{ content: 'Sub task', status: 'in_progress' }], { helperId: 'h1' }));
    expect(ofType(got, 'session.updated')).toHaveLength(0);
    expect(ofType(got, 'session.checklist')).toHaveLength(0);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(snapOf(g.got('dev1')).sessions.find(s => s.id === 'a')!.checklist).toEqual({ done: 1, total: 3, current: 'Writing the test' });
  });

  it('answers a thread with the whole capped list after it', async () => {
    const g = setup();
    const many = Array.from({ length: 80 }, (_, i) => ({ content: `t${i}`, status: i < 3 ? 'completed' : 'pending' }));
    g.threads.get('a')!.push(update(many));
    g.send('dev1', { type: 'session.thread', id: 'a' });
    await flush();
    const got = g.got('dev1');
    expect(got.map(m => m.type)).toEqual(['session.thread', 'session.checklist']);
    const c = ofType(got, 'session.checklist')[0]!;
    expect(PhoneServerMessageSchema.safeParse(c).success).toBe(true);
    expect(c.checklist).toMatchObject({ done: 3, total: 80, cut: true });
    expect(c.checklist!.tasks).toHaveLength(50);
  });

  it('answers a thread without a list with checklist null', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.thread', id: 'b' });
    await flush();
    expect(ofType(g.got('dev1'), 'session.checklist')).toEqual([{ type: 'session.checklist', id: 'b', checklist: null }]);
  });

  it('recomputes after a time with no follower', async () => {
    const g = setup();
    g.threads.get('a')!.push(update(PLAN));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.fm.setDevices([]);
    const item = update([{ content: 'Read the code', status: 'completed' }, { content: 'Write the test', status: 'completed' }]);
    g.threads.get('a')!.push(item);
    g.gw.forward({ type: 'session.thread.item', id: 'a', item });
    g.fm.setDevices(['dev1']);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(snapOf(g.got('dev1')).sessions.find(s => s.id === 'a')!.checklist).toEqual({ done: 2, total: 2 });
  });

  it('gives the list Desktop reads from the same thread', async () => {
    const g = setup();
    g.threads.get('a')!.push(update(PLAN), update([{ content: 'Other plan', status: 'pending' }], { helperId: 'h1' }));
    g.send('dev1', { type: 'session.thread', id: 'a' });
    await flush();
    const c = ofType(g.got('dev1'), 'session.checklist')[0]!;
    expect(c.checklist!.tasks).toEqual(latestTodos(g.threads.get('a')!));
  });

  it('a queue overflow sends the watched checklist again, after the snapshot', async () => {
    const g = setup({ deps: { outbox: { frames: 1, windowMs: 40 } } });
    g.threads.get('a')!.push(update(PLAN));
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'a' });
    await flush();
    await new Promise(r => setTimeout(r, 100));
    const before = g.got('dev1').length;
    // The window lets one frame out: the rest queues, past 300 messages the queue is dropped and resynced.
    for (let i = 0; i < 310; i++) {
      const item = { kind: 'message', id: `o${i}`, at: T0, turn: 1, text: `m${i}` } as ThreadItem;
      g.gw.forward({ type: 'session.thread.item', id: 'a', item });
    }
    await new Promise(r => setTimeout(r, 200));
    expect(g.logs.some(l => l.includes('queue overflow'))).toBe(true);
    const types = g.got('dev1').slice(before).map(m => m.type);
    const snap = types.lastIndexOf('snapshot');
    expect(snap).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('session.checklist', snap)).toBeGreaterThan(snap);
  });
});
