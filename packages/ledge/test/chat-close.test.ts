import { describe, it, expect } from 'vitest';
import type { ChatClose, CloseHow } from '@ledge/protocol';
import { closeFromChat, CloseRefused, cardOf, type CloseDeps } from '../src/chat/close.js';
import type { ChatMessage } from '../src/chat/service.js';
import type { ChatThreadId } from '../src/chat/threads.js';

const row = (id: string, extra: Partial<ChatClose> = {}): ChatClose => ({ id, name: id.toUpperCase(), tool: 'claude', ...extra });

/** A card's rows; the marks are recorded in the order they land. */
function fake(rows: ChatClose[]) {
  const marks: unknown[][] = [];
  const chat: CloseDeps['chat'] = {
    close: (_q, r) => rows[r],
    markClosed: (_q, r, how) => { marks.push(['closed', r, how]); rows[r] = { ...rows[r]!, closedAt: '2026-10-21T08:00:00.000Z', how }; },
    markCloseFailed: (_q, r, message) => { marks.push(['failed', r, message]); rows[r] = { ...rows[r]!, error: message }; }
  };
  return { chat, marks };
}
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('closeFromChat', () => {
  it('closes the rows in parallel and marks each', async () => {
    const f = fake([row('a'), row('b')]);
    const started: string[] = []; const waits: Record<string, ReturnType<typeof deferred<{ how: CloseHow }>>> = { a: deferred(), b: deferred() };
    const told: unknown[][] = [];
    const out = closeFromChat({ chat: f.chat, emit: () => {}, inFlight: new Set(), close: id => { started.push(id); return waits[id]!.promise; }, onClosed: (r, id, how) => told.push([r, id, how]) }, 'q');
    await flush();
    // Both have started before either has answered.
    expect(started).toEqual(['a', 'b']);
    waits.b!.resolve({ how: 'killed' }); waits.a!.resolve({ how: 'exit' });
    expect(await out).toEqual({ closed: [{ row: 0, id: 'a', how: 'exit' }, { row: 1, id: 'b', how: 'killed' }], failed: [] });
    expect(f.marks).toEqual(expect.arrayContaining([['closed', 0, 'exit'], ['closed', 1, 'killed']]));
    expect(f.marks).toHaveLength(2);
    expect(told).toEqual(expect.arrayContaining([[0, 'a', 'exit'], [1, 'b', 'killed']]));
    expect(told).toHaveLength(2);
  });

  it('marks a failed row with its reason and goes on', async () => {
    const f = fake([row('a'), row('b')]);
    const told: unknown[][] = [];
    const out = await closeFromChat({ chat: f.chat, emit: () => {}, inFlight: new Set(), close: async id => { if (id === 'a') throw new Error('read only'); return { how: 'exit' }; }, onClosed: (r, id) => told.push([r, id]) }, 'q');
    expect(out).toEqual({ closed: [{ row: 1, id: 'b', how: 'exit' }], failed: [{ row: 0, message: 'read only' }] });
    expect(f.marks).toEqual(expect.arrayContaining([['failed', 0, 'read only'], ['closed', 1, 'exit']]));
    expect(told).toEqual([[1, 'b']]);
  });

  it('a close that throws before it returns a promise fails its row too', async () => {
    const f = fake([row('a')]);
    const out = await closeFromChat({ chat: f.chat, emit: () => {}, inFlight: new Set(), close: () => { throw new Error('unknown session'); } }, 'q');
    expect(out).toEqual({ closed: [], failed: [{ row: 0, message: 'unknown session' }] });
    expect(f.marks).toEqual([['failed', 0, 'unknown session']]);
  });

  it('passes over a closed row and a row in flight, refuses when none is left', async () => {
    const f = fake([row('a', { closedAt: '2026-10-21T08:00:00.000Z', how: 'exit' }), row('b'), row('c')]);
    const asked: string[] = [];
    const deps = { chat: f.chat, emit: () => {}, inFlight: new Set(['q#1']), close: async (id: string) => { asked.push(id); return { how: 'exit' as const }; } };
    expect(await closeFromChat(deps, 'q')).toEqual({ closed: [{ row: 2, id: 'c', how: 'exit' }], failed: [] });
    expect(asked).toEqual(['c']);
    await expect(closeFromChat(deps, 'q')).rejects.toThrow(new CloseRefused('already closed'));
    await expect(closeFromChat(deps, 'q', [0, 1])).rejects.toBeInstanceOf(CloseRefused);
    expect(asked).toEqual(['c']);
  });

  it('refuses an unknown row', async () => {
    const f = fake([row('a')]);
    const deps = { chat: f.chat, emit: () => {}, inFlight: new Set<string>(), close: async () => ({ how: 'exit' as const }) };
    await expect(closeFromChat(deps, 'q', [3])).rejects.toThrow(new CloseRefused('unknown close'));
    await expect(closeFromChat({ ...deps, chat: fake([]).chat }, 'q')).rejects.toThrow('unknown close');
    expect(f.marks).toEqual([]);
  });

  it('closes a row once even when it is named twice or clicked twice at once', async () => {
    const f = fake([row('a')]);
    let n = 0; const wait = deferred<{ how: CloseHow }>();
    const deps = { chat: f.chat, emit: () => {}, inFlight: new Set<string>(), close: () => { n++; return wait.promise; } };
    const first = closeFromChat(deps, 'q', [0, 0]);
    const second = closeFromChat(deps, 'q', [0]);
    await expect(second).rejects.toThrow(new CloseRefused('already closed'));
    wait.resolve({ how: 'exit' });
    expect(await first).toEqual({ closed: [{ row: 0, id: 'a', how: 'exit' }], failed: [] });
    expect(n).toBe(1);
    // Settled, the row is no longer in flight: a later click is refused for being closed.
    expect(deps.inFlight.size).toBe(0);
  });

  it('a row that failed can be closed again', async () => {
    const f = fake([row('a')]);
    let fail = true;
    const deps = { chat: f.chat, emit: () => {}, inFlight: new Set<string>(), close: async () => { if (fail) throw new Error('busy'); return { how: 'exit' as const }; } };
    expect((await closeFromChat(deps, 'q')).failed).toHaveLength(1);
    fail = false;
    expect((await closeFromChat(deps, 'q')).closed).toEqual([{ row: 0, id: 'a', how: 'exit' }]);
  });

  it('marks through the emitter it was given', async () => {
    const heard: ChatMessage[] = [];
    const rows = [row('a')];
    const chat: CloseDeps['chat'] = { close: (_q, r) => rows[r], markClosed: (_q, _r, _h, emit) => emit({ type: 'chat.history', turns: [] }), markCloseFailed() {} };
    await closeFromChat({ chat, emit: m => heard.push(m), inFlight: new Set(), close: async () => ({ how: 'exit' }) }, 'q');
    expect(heard).toEqual([{ type: 'chat.history', turns: [] }]);
  });
});

describe('cardOf', () => {
  /** Threads by id (the desktop first), as the relay tests have them: each owns the qids its chat holds a card for. */
  function fakeThreads(spec: Record<string, string[]>) {
    const parts = Object.entries(spec).map(([id, qids]) => [id as ChatThreadId, { qids, close: (q: string, r: number) => (qids.includes(q) && r === 0 ? row(id) : undefined) }] as const);
    const heard: Partial<Record<ChatThreadId, number>> = {};
    const emitters = new Map<ChatThreadId, (m: ChatMessage) => void>(parts.map(([id]) => [id, () => { heard[id] = (heard[id] ?? 0) + 1; }]));
    const threads = {
      all: () => parts.map(([id, c]) => [id, c] as [ChatThreadId, typeof c]),
      owner: (qid: string) => parts.find(([, c]) => c.qids.includes(qid))?.[0],
      emitterOf: (id: ChatThreadId) => emitters.get(id)
    };
    return { threads, emitters, heard, chat: (id: string) => parts.find(([i]) => i === id)![1] };
  }

  it('finds the device thread that owns the turn, with its own emitter', () => {
    const f = fakeThreads({ desktop: ['q1'], 'device:d1': ['q2'] });
    const card = cardOf(f.threads, 'q2')!;
    expect(card.thread).toBe('device:d1');
    expect(card.chat).toBe(f.chat('device:d1'));
    card.emit({ type: 'chat.history', turns: [] });
    expect(f.heard).toEqual({ 'device:d1': 1 });
    expect(cardOf(f.threads, 'q1')!.chat).toBe(f.chat('desktop'));
  });

  it('knows no thread for an unknown turn, and a dropped thread\'s emitter is a no-op', () => {
    const f = fakeThreads({ desktop: [], 'device:d1': ['q2'] });
    expect(cardOf(f.threads, 'q9')).toBeUndefined();
    f.emitters.delete('device:d1');
    expect(() => cardOf(f.threads, 'q2')!.emit({ type: 'chat.history', turns: [] })).not.toThrow();
  });
});
