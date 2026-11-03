import { describe, expect, it, vi } from 'vitest';
import { pruneNotifications, startPruning, tagOf } from '../../src/push/prune';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from '../screens/setup';

const shown = (tag: string, kind?: string) => ({ tag, data: kind ? { url: '/#/', kind } : { url: '/#/' }, close: vi.fn() });

describe('pruning notifications answered elsewhere', () => {
  it('closes a request or question whose session no longer waits; leaves the others, a finished, and an older one without kind', async () => {
    const gone = shown('a', 'request'), q = shown('b', 'question'), still = shown('c', 'request'), done = shown('a', 'finished'), old = shown('a');
    await pruneNotifications({ getNotifications: async () => [gone, q, still, done, old] }, new Set(['c']));
    expect(gone.close).toHaveBeenCalled();
    expect(q.close).toHaveBeenCalled();
    expect(still.close).not.toHaveBeenCalled();
    expect(done.close).not.toHaveBeenCalled();
    expect(old.close).not.toHaveBeenCalled();
  });

  it('never throws: no registration, no getNotifications, a rejection', async () => {
    await pruneNotifications(null, new Set());
    await pruneNotifications({}, new Set());
    await pruneNotifications({ getNotifications: async () => { throw new Error('no'); } }, new Set());
  });

  it('tags as the daemon does', () => {
    expect(tagOf('abc-1_2')).toBe('abc-1_2');
    expect(tagOf('a.b:c')).toBe('a_b_c');
    expect(tagOf('x'.repeat(40))).toHaveLength(32);
  });

  it('prunes once fresh, and again only when what waits changes', async () => {
    const t = setup();
    const n = shown('s1', 'request');
    const getNotifications = vi.fn(async () => [n]);
    const stop = startPruning(t.store, async () => ({ getNotifications }));
    expect(getNotifications).not.toHaveBeenCalled();
    t.deliver(snapshot([session('s1', { pending: pending() })]));
    await vi.waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(1));
    expect(n.close).not.toHaveBeenCalled();
    t.deliver(snapshot([session('s1', { pending: pending() })]));
    await new Promise(r => setTimeout(r, 10));
    expect(getNotifications).toHaveBeenCalledTimes(1);
    t.deliver(snapshot([session('s1')]));
    await vi.waitFor(() => expect(n.close).toHaveBeenCalled());
    stop();
  });
});
