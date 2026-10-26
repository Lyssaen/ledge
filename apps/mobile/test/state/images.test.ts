import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '@ledge/protocol';
import { createStore, type MobileStore } from '../../src/state/store';
import { fakeLink, MemoryStorage } from './helpers';

const stores: MobileStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); vi.useRealTimers(); });

function setup() {
  const f = fakeLink('ready');
  const store = createStore(f.link, new MemoryStorage());
  stores.push(store);
  return { ...f, store };
}

const ID = (c: string) => c.repeat(64);
const ref = (c: string, extra: Partial<AttachmentRef> = {}): AttachmentRef => ({ id: ID(c), mime: 'image/webp', width: 800, height: 600, bytes: 1000, preview: true, ...extra });
const upload = { mime: 'image/webp' as const, data: 'AAAA' };
const tick = () => new Promise(r => setTimeout(r, 0));

describe('putImage', () => {
  it('sends the next put only after the previous one is answered', async () => {
    const t = setup();
    const first = t.store.putImage(upload);
    const second = t.store.putImage(upload);
    await tick();
    expect(t.of('attachment.put')).toHaveLength(1);
    t.deliver({ type: 'attachment.stored', requestId: t.of('attachment.put')[0]!.requestId, ref: ref('a') });
    await expect(first).resolves.toEqual(ref('a'));
    await tick();
    expect(t.of('attachment.put')).toHaveLength(2);
    t.deliver({ type: 'attachment.stored', requestId: t.of('attachment.put')[1]!.requestId, ref: ref('b') });
    await expect(second).resolves.toEqual(ref('b'));
    expect(t.store.knownImage(ID('b'))).toEqual(ref('b'));
    expect(t.store.knownImage(ID('c'))).toBeUndefined();
  });

  it('rejects with the server reason and lets the next put go', async () => {
    const t = setup();
    const first = t.store.putImage(upload);
    const second = t.store.putImage(upload);
    await tick();
    t.deliver({ type: 'attachment.error', requestId: t.of('attachment.put')[0]!.requestId, reason: 'too_large' });
    await expect(first).rejects.toThrow('too_large');
    await tick();
    expect(t.of('attachment.put')).toHaveLength(2);
    t.deliver({ type: 'attachment.stored', requestId: t.of('attachment.put')[1]!.requestId, ref: ref('b') });
    await expect(second).resolves.toBeDefined();
  });

  it('rejects with timeout after 30 s without an answer', async () => {
    vi.useFakeTimers();
    const t = setup();
    const p = t.store.putImage(upload);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(caught).resolves.toBe('timeout');
  });
});

describe('imageUrl', () => {
  it('keeps one get in flight at a time', async () => {
    const t = setup();
    const urls = [t.store.imageUrl(ID('a'), true), t.store.imageUrl(ID('b'), true), t.store.imageUrl(ID('c'), false)];
    await tick();
    expect(t.of('attachment.get')).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      const g = t.of('attachment.get')[i]!;
      t.deliver({ type: 'attachment.data', requestId: g.requestId, attachment: g.attachment, mime: 'image/webp', data: 'AAAA' });
      await tick();
      expect(t.of('attachment.get')).toHaveLength(Math.min(3, i + 2));
    }
    const all = await Promise.all(urls);
    expect(all.every(u => typeof u === 'string' && u.length > 0)).toBe(true);
    expect(t.of('attachment.get').map(g => [g.attachment, g.preview])).toEqual([[ID('a'), true], [ID('b'), true], [ID('c'), undefined]]);
  });

  it('sends nothing for a key it already has, and does not cache a failure', async () => {
    const t = setup();
    const a = t.store.imageUrl(ID('a'), true);
    await tick();
    const g = t.of('attachment.get')[0]!;
    t.deliver({ type: 'attachment.data', requestId: g.requestId, attachment: g.attachment, mime: 'image/webp', data: 'AAAA' });
    const url = await a;
    expect(await t.store.imageUrl(ID('a'), true)).toBe(url);
    expect(t.of('attachment.get')).toHaveLength(1);
    const bad = t.store.imageUrl(ID('b'), true);
    await tick();
    t.deliver({ type: 'attachment.error', requestId: t.of('attachment.get')[1]!.requestId, reason: 'not_found' });
    await expect(bad).rejects.toThrow('not_found');
    void t.store.imageUrl(ID('b'), true).catch(() => undefined);
    await tick();
    expect(t.of('attachment.get')).toHaveLength(3);
  });
});
