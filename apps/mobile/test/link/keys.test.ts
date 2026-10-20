import { beforeEach, describe, expect, it } from 'vitest';
import { ensureIdentity, memoryKeys, type PinnedPc } from '../../src/link/keys';

const pc: PinnedPc = {
  publicKey: 'B'.repeat(87),
  fingerprint: 'f'.repeat(22),
  name: null,
  pinnedAt: '2026-10-20T08:00:00.000Z'
};

beforeEach(() => localStorage.clear());

describe('keys', () => {
  it('ensureIdentity generates a non-extractable identity once, then returns the stored one', async () => {
    const store = memoryKeys();
    const first = await ensureIdentity(store);
    const second = await ensureIdentity(store);
    expect(second).toBe(first);
    expect(first.privateKey.extractable).toBe(false);
    expect(await store.identity()).toBe(first);
  });

  it('pin stores the PC that pinned() returns', async () => {
    const store = memoryKeys();
    expect(await store.pinned()).toBeNull();
    await store.pin(pc);
    expect(await store.pinned()).toEqual(pc);
  });

  it('forget() clears the identity, the pinned PC and every ledge.mobile.* key, and nothing else', async () => {
    const store = memoryKeys();
    await ensureIdentity(store);
    await store.pin(pc);
    localStorage.setItem('ledge.mobile.snapshot', '{}');
    localStorage.setItem('ledge.mobile.drafts', '{}');
    localStorage.setItem('ledge.other', 'kept');
    await store.forget();
    expect(await store.identity()).toBeNull();
    expect(await store.pinned()).toBeNull();
    expect(localStorage.getItem('ledge.mobile.snapshot')).toBeNull();
    expect(localStorage.getItem('ledge.mobile.drafts')).toBeNull();
    expect(localStorage.getItem('ledge.other')).toBe('kept');
  });
});
