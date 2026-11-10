// The phone's « Conversations » (refonte mobile M3 Q33, docs/mobile-chat-m3-contract.md §1 and §3): the flag, the list, one
// conversation read-only, and the refusals.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PhoneServerMessageSchema, type PhoneServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createChatThreads } from '../src/chat/threads.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

vi.mock('../src/log.js', () => ({ log: () => {} }));
afterEach(stopAll);
const tmux = { async capture() { return null; } } as never;

/** A CLI that answers each question at once. */
const spawn = (() => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false, kill: () => { child.emit('close', null); } });
  setImmediate(() => {
    child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's' }) + '\n');
    setImmediate(() => child.emit('close', 0));
  });
  return child;
}) as unknown as typeof nodeSpawn;

function rig() {
  const home = mkdtempSync(join(tmpdir(), 'ledge-conv-gw-'));
  const clock = { t: '2026-10-20T08:00:00.000Z' };
  const chats = createChatThreads({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, now: () => clock.t, today: () => clock.t.slice(0, 10), env: async () => ({ ...process.env }), spawn });
  const g = setup({ chats });
  const until = async (type: string, n = 1) => { await vi.waitFor(() => expect(g.got('dev1').filter(m => m.type === type).length).toBeGreaterThanOrEqual(n)); return g.got('dev1').filter(m => m.type === type).at(-1)!; };
  return { g, chats, clock, until };
}

describe('phone gateway: conversations', { timeout: 20_000 }, () => {
  it('the snapshot says the PC keeps them; an older PC without chat does not', async () => {
    const r = rig();
    r.g.send('dev1', { type: 'snapshot.request' });
    const without = setup();
    without.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect((r.g.got('dev1')[0] as { daemon: unknown }).daemon).toMatchObject({ conversations: true });
    expect((without.got('dev1')[0] as { daemon: object }).daemon).not.toHaveProperty('conversations');
    without.send('dev1', { type: 'chat.conversations' });
    await flush();
    expect(without.got('dev1').at(-1)).toEqual({ type: 'error', code: 'invalid', request: 'chat.conversations' });
  });

  it('lists the current and the past ones, reads a past one read-only, and says one that is gone', async () => {
    const r = rig();
    const q1 = randomUUID();
    r.g.send('dev1', { type: 'chat.ask', qid: q1, text: 'Où en est ledge-dev ?' });
    await r.until('chat.done');
    r.g.send('dev1', { type: 'chat.conversations' });
    const first = await r.until('chat.conversations') as Extract<PhoneServerMessage, { type: 'chat.conversations' }>;
    expect(PhoneServerMessageSchema.safeParse(first).success).toBe(true);
    expect(first).toMatchObject({ current: { first: 'Où en est ledge-dev ?', count: 1 }, past: [] });
    const id = first.current!.id;

    r.g.send('dev1', { type: 'chat.reset' });
    await vi.waitFor(() => expect(r.chats.device('dev1').history()).toEqual([]));
    r.g.send('dev1', { type: 'chat.conversations' });
    const second = await r.until('chat.conversations', 2);
    expect(PhoneServerMessageSchema.safeParse(second).success).toBe(true);
    expect(second).toEqual({ type: 'chat.conversations', past: [{ id, startedAt: '2026-10-20T08:00:00.000Z', lastAt: '2026-10-20T08:00:00.000Z', first: 'Où en est ledge-dev ?', count: 1 }] });

    r.g.send('dev1', { type: 'chat.conversation', id });
    const one = await r.until('chat.conversation');
    expect(PhoneServerMessageSchema.safeParse(one).success).toBe(true);
    expect(one).toMatchObject({ type: 'chat.conversation', id, turns: [{ qid: q1, question: 'Où en est ledge-dev ?', answer: 'ok' }] });
    expect(one).not.toHaveProperty('limits');
    // Its cards are refused, as an unknown card's.
    const op = randomUUID();
    r.g.send('dev1', { type: 'chat.ignore', op, qid: q1 });
    await vi.waitFor(() => expect(r.g.results('dev1').filter(m => (m as { op: string }).op === op).at(-1)).toMatchObject({ status: 'rejected' }));

    const gone = randomUUID();
    r.g.send('dev1', { type: 'chat.conversation', id: gone });
    await r.until('chat.conversation', 2);
    expect(r.g.got('dev1').filter(m => m.type === 'chat.conversation').at(-1)).toEqual({ type: 'chat.conversation', id: gone, error: 'unknown' });
    // Another device does not see them.
    r.g.send('dev2', { type: 'chat.conversation', id });
    await vi.waitFor(() => expect(r.g.got('dev2').some(m => m.type === 'chat.conversation')).toBe(true));
    expect(r.g.got('dev2').find(m => m.type === 'chat.conversation')).toEqual({ type: 'chat.conversation', id, error: 'unknown' });
  });

  it('a malformed id is refused by the schema', async () => {
    const r = rig();
    r.g.send('dev1', { type: 'chat.conversation', id: '../../x' });
    await flush();
    expect(r.g.got('dev1').filter(m => m.type === 'chat.conversation')).toEqual([]);
    expect(r.g.got('dev1').at(-1)).toMatchObject({ type: 'error', code: 'invalid' });
  });
});
