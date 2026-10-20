import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { createOutbox } from '../src/mobile/outbox.js';

const removed = (id: string): PhoneServerMessage => ({ type: 'session.removed', id });
const preview = (id: string, line: string): PhoneServerMessage => ({ type: 'session.preview', id, lines: [line] });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function make(over: Partial<Parameters<typeof createOutbox>[0]> = {}) {
  const sent: Array<[string, string]> = [];
  const gone: string[] = [];
  const overflow: string[] = [];
  const logs: string[] = [];
  const outbox = createOutbox({
    send: async (d, t) => { sent.push([d, t]); return true; },
    onGone: (d) => gone.push(d),
    onOverflow: (d) => overflow.push(d),
    log: (l) => logs.push(l),
    now: () => Date.now(),
    ...over
  });
  return { outbox, sent, gone, overflow, logs };
}

/** Lets pending promise continuations run. */
const flush = () => vi.advanceTimersByTimeAsync(0);
const idOf = (t: string) => (JSON.parse(t) as { id: string }).id;

describe('outbox', () => {
  it('sends 200 frames at once and the rest after the window', async () => {
    const { outbox, sent } = make();
    for (let i = 0; i < 250; i++) outbox.push('d1', removed(`s${i}`));
    await flush();
    expect(sent).toHaveLength(200);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(sent).toHaveLength(200);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(250);
  });

  it('coalesces a key while blocked: one send, the last content', async () => {
    const { outbox, sent } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    for (let i = 0; i < 50; i++) outbox.push('d1', preview('s1', `v${i}`), 'session.preview:s1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]![1]).toContain('v49');
    expect(sent[1]![1]).not.toContain('v48');
  });

  it('keeps the place of a replaced message', async () => {
    const { outbox, sent } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    outbox.push('d1', preview('a', 'old'), 'k');
    outbox.push('d1', removed('mid'));
    outbox.push('d1', preview('a', 'new'), 'k');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent.map(([, t]) => t.includes('new') ? 'k' : idOf(t))).toEqual(['first', 'k', 'mid']);
  });

  it('serves two devices in turn', async () => {
    const { outbox, sent } = make({ frames: 1 });
    outbox.push('x', removed('x0'));
    await flush();
    for (let i = 1; i < 4; i++) outbox.push('x', removed(`x${i}`));
    for (let i = 0; i < 3; i++) outbox.push('y', removed(`y${i}`));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.map(([d]) => d)).toEqual(['x', 'x', 'y', 'x', 'y', 'x', 'y']);
  });

  it('respects the byte budget', async () => {
    const { outbox, sent } = make({ bytes: 5_000 });
    for (let i = 0; i < 3; i++) outbox.push('d1', removed(`s${i}`)); // cost 1366 + 256 each
    await flush();
    expect(sent).toHaveLength(3);
    outbox.push('d1', removed('more'));
    await flush();
    expect(sent).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(4);
  });

  it('on the 301st queued message: one onOverflow, queue emptied', async () => {
    const { outbox, sent, overflow } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    for (let i = 0; i < 301; i++) outbox.push('d1', removed(`s${i}`));
    expect(overflow).toEqual(['d1']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
  });

  it('overflows on queued bytes too', async () => {
    const { outbox, overflow } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    const big: PhoneServerMessage = { type: 'session.preview', id: 's', lines: ['x'.repeat(600_000)] };
    // Each costs ceil(655360 * 4 / 3) + 256 = 874 069: nine fit in 8 MiB, the tenth crosses.
    for (let i = 0; i < 9; i++) outbox.push('d1', big);
    expect(overflow).toEqual([]);
    outbox.push('d1', big);
    expect(overflow).toEqual(['d1']);
  });

  it('send false: onGone once, nothing more for that device', async () => {
    const calls: string[] = [];
    const { outbox, gone } = make({ send: async (d, t) => { calls.push(`${d}:${idOf(t)}`); return d !== 'dead'; } });
    outbox.push('dead', removed('a'));
    outbox.push('dead', removed('b'));
    outbox.push('ok', removed('c'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gone).toEqual(['dead']);
    expect(calls).toEqual(['dead:a', 'ok:c']);
  });

  it('does not send a message pad refuses, tells the device, and logs no content', async () => {
    const { outbox, sent, logs } = make();
    outbox.push('d1', { type: 'session.preview', id: 's', lines: ['SECRET'.repeat(120_000)] });
    await flush();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]![1])).toEqual({ type: 'error', code: 'too_large', request: 'session.preview' });
    expect(Buffer.byteLength(sent[0]![1])).toBe(1024);
    expect(logs.join('\n')).toMatch(/^phone message too large: session\.preview \d+ bytes$/m);
    expect(logs.join('\n')).not.toContain('SECRET');
  });

  it('drop forgets a device queue; close stops everything', async () => {
    const { outbox, sent } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    outbox.push('d1', removed('a'));
    outbox.push('d2', removed('b'));
    outbox.drop('d1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent.map(([d]) => d)).toEqual(['d1', 'd2']);
    outbox.push('d2', removed('c'));
    outbox.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toHaveLength(2);
  });

  it('arms one timer however many pushes arrive while blocked, and none after close', async () => {
    const { outbox } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    for (let i = 0; i < 20; i++) outbox.push('d1', removed(`s${i}`));
    expect(vi.getTimerCount()).toBe(1);
    outbox.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives a throwing onGone and a rejecting send, and keeps draining', async () => {
    const calls: string[] = [];
    const { outbox, logs } = make({
      send: async (d, t) => { calls.push(`${d}:${idOf(t)}`); if (d === 'boom') throw new Error('x'); return d !== 'dead'; },
      onGone: () => { throw new TypeError('nope'); }
    });
    outbox.push('dead', removed('a'));
    outbox.push('boom', removed('b'));
    outbox.push('ok', removed('c'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual(['dead:a', 'boom:b', 'ok:c']);
    expect(logs.join('\n')).toContain('onGone failed (TypeError)');
  });

  it('coalesces repeated too_large errors for the same type', async () => {
    const { outbox, sent } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    const huge: PhoneServerMessage = { type: 'session.preview', id: 's', lines: ['x'.repeat(700_000)] };
    for (let i = 0; i < 5; i++) outbox.push('d1', huge);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(2);
  });
});

describe('outbox priority lane', () => {
  const result = (op: string): PhoneServerMessage => ({ type: 'operation.result', op, status: 'applied' });

  it('an operation.result queued behind 50 coalesced updates goes before them, results and errors keep their order', async () => {
    const { outbox, sent } = make({ frames: 1 });
    outbox.push('d1', removed('first'));
    await flush();
    for (let i = 0; i < 50; i++) outbox.push('d1', { type: 'session.updated', session: { id: `s${i}` } } as unknown as PhoneServerMessage, `session.updated:s${i}`);
    outbox.push('d1', result('00000000-0000-4000-8000-000000000001'));
    outbox.push('d1', { type: 'error', code: 'unknown_session', request: 'session.pending' });
    outbox.push('d1', result('00000000-0000-4000-8000-000000000002'));
    for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(10_000);
    const types = sent.map(([, t]) => (JSON.parse(t) as { type: string }).type);
    expect(types.slice(0, 5)).toEqual(['session.removed', 'operation.result', 'error', 'operation.result', 'session.updated']);
    expect(sent).toHaveLength(54);
  });
});
