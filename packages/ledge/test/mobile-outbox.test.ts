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
    for (let i = 0; i < 8; i++) outbox.push('d1', big);
    expect(overflow).toEqual([]);
    for (let i = 0; i < 8; i++) outbox.push('d1', big);
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
});
