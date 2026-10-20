import { beforeEach, describe, expect, it } from 'vitest';
import { generateIdentity } from '@ledge/seal';
import { ensureIdentity, memoryKeys, type KeyStore, type PinnedPc } from '../../src/link/keys';

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

  it('two concurrent ensureIdentity calls return the same, stored identity', async () => {
    const store = memoryKeys();
    const [a, b] = await Promise.all([ensureIdentity(store), ensureIdentity(store)]);
    expect(b).toBe(a);
    expect(await store.identity()).toBe(a);
  });

  it('saveIdentity never replaces a stored identity; ensureIdentity then returns the stored one', async () => {
    const store = memoryKeys();
    const first = await ensureIdentity(store);
    await expect(store.saveIdentity(await generateIdentity())).rejects.toThrow();
    expect(await store.identity()).toBe(first);
    // Another tab saved first: this one keeps what is stored.
    const other = memoryKeys();
    const theirs = await generateIdentity();
    await other.saveIdentity(theirs);
    const lost: KeyStore = { ...other, identity: (() => { let n = 0; return async () => (n++ === 0 ? null : other.identity()); })() };
    expect(await ensureIdentity(lost)).toBe(theirs);
  });

  it('after forget(), ensureIdentity makes a new identity', async () => {
    const store = memoryKeys();
    const first = await ensureIdentity(store);
    await store.forget();
    const second = await ensureIdentity(store);
    expect(second).not.toBe(first);
    expect(await store.identity()).toBe(second);
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
