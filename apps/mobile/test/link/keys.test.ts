import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateIdentity } from '@ledge/seal';
import { ensureIdentity, indexedDbKeys, memoryKeys, type KeyStore, type PinnedPc } from '../../src/link/keys';

const pc: PinnedPc = {
  publicKey: 'B'.repeat(87),
  fingerprint: 'f'.repeat(22),
  name: null,
  pinnedAt: '2026-10-20T08:00:00.000Z'
};

beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); });

type FakeConnection = { closed: boolean; onclose: (() => void) | null; onversionchange: (() => void) | null; close(): void; transaction(): unknown };

/**
 * Just enough IndexedDB for `indexedDbKeys`: one base, one store, every open counted. A connection can be closed under
 * the app's feet, its `transaction()` then throwing InvalidStateError as a browser's does.
 */
function fakeIndexedDb() {
  const data = new Map<string, unknown>();
  const connections: FakeConnection[] = [];
  const request = (fn: () => unknown) => {
    const r: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: undefined, onsuccess: null, onerror: null };
    queueMicrotask(() => { r.result = fn(); r.onsuccess?.(); });
    return r;
  };
  const transaction = () => {
    const tx = {
      error: null, oncomplete: null as (() => void) | null, onerror: null, onabort: null,
      objectStore: () => ({
        get: (k: string) => request(() => data.get(k)),
        put: (v: unknown, k: string) => request(() => { data.set(k, v); return k; }),
        add: (v: unknown, k: string) => request(() => { data.set(k, v); return k; }),
        delete: (k: string) => request(() => { data.delete(k); })
      })
    };
    setTimeout(() => tx.oncomplete?.(), 0);
    return tx;
  };
  const factory = {
    open() {
      const db: FakeConnection = {
        closed: false, onclose: null, onversionchange: null,
        close() { db.closed = true; },
        transaction() {
          if (db.closed) throw new DOMException('The database connection is closing.', 'InvalidStateError');
          return transaction();
        }
      };
      connections.push(db);
      const r = { result: db, onsuccess: null as (() => void) | null, onerror: null, onblocked: null, onupgradeneeded: null };
      setTimeout(() => r.onsuccess?.(), 0);
      return r;
    }
  };
  vi.stubGlobal('indexedDB', factory);
  return { connections };
}

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

  it('indexedDbKeys: a connection the browser closed (onclose) → the next call opens a new one', async () => {
    const { connections } = fakeIndexedDb();
    const store = indexedDbKeys(null);
    await store.pin(pc);
    expect(connections).toHaveLength(1);
    // iOS Safari: « Connection to Indexed Database server lost ».
    connections[0]!.closed = true;
    connections[0]!.onclose?.();
    expect(await store.pinned()).toEqual(pc);
    expect(connections).toHaveLength(2);
  });

  it('indexedDbKeys: a transaction refused with InvalidStateError → tried once more on a new connection', async () => {
    const { connections } = fakeIndexedDb();
    const store = indexedDbKeys(null);
    await store.pin(pc);
    // Closed without a close event.
    connections[0]!.closed = true;
    expect(await store.pinned()).toEqual(pc);
    expect(connections).toHaveLength(2);
    connections[1]!.closed = true;
    await store.forget();
    expect(await store.pinned()).toBeNull();
    expect(connections).toHaveLength(3);
  });
});
