// The phone's own identity and the PC key it pinned. The private key stays a non-extractable CryptoKey: IndexedDB
// keeps it by structured clone, it is never exported, logged or sent, and nothing secret goes to localStorage.
import { generateIdentity, type Identity } from '@ledge/seal';

/** The PC this phone trusts, pinned once the pairing was confirmed on both sides. */
export type PinnedPc = { publicKey: string; fingerprint: string; name: string | null; pinnedAt: string };

export interface KeyStore {
  identity(): Promise<Identity | null>;
  saveIdentity(id: Identity): Promise<void>;
  pinned(): Promise<PinnedPc | null>;
  pin(pc: PinnedPc): Promise<void>;
  /** Drops the identity, the pinned PC and every `ledge.mobile.*` entry of localStorage. */
  forget(): Promise<void>;
}

const DB_NAME = 'ledge';
const DB_VERSION = 1;
const STORE = 'keys';
const IDENTITY = 'identity';
const PC = 'pc';
/** The prefix of everything the app keeps in localStorage (snapshot, operations, drafts): never a key. */
export const MOBILE_STORAGE_PREFIX = 'ledge.mobile.';

function defaultStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function clearMobileStorage(storage: Storage | null): void {
  if (!storage) return;
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(MOBILE_STORAGE_PREFIX)) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
}

/** The stored identity, or a new non-extractable one, saved before it is returned. */
export async function ensureIdentity(store: KeyStore): Promise<Identity> {
  const known = await store.identity();
  if (known) return known;
  const id = await generateIdentity();
  await store.saveIdentity(id);
  return id;
}

/** For tests: the same contract, in memory. */
export function memoryKeys(storage: Storage | null = defaultStorage()): KeyStore {
  let identity: Identity | null = null;
  let pc: PinnedPc | null = null;
  return {
    async identity() { return identity; },
    async saveIdentity(id) { identity = id; },
    async pinned() { return pc; },
    async pin(p) { pc = { ...p }; },
    async forget() {
      identity = null;
      pc = null;
      clearMobileStorage(storage);
    }
  };
}

const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const committed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('key transaction aborted'));
});

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('the key database is blocked by another tab'));
  });
}

const isIdentity = (v: unknown): v is Identity =>
  typeof v === 'object' && v !== null && typeof (v as Identity).publicKey === 'string' && (v as Identity).privateKey instanceof CryptoKey;

const isPinned = (v: unknown): v is PinnedPc =>
  typeof v === 'object' && v !== null && typeof (v as PinnedPc).publicKey === 'string' && typeof (v as PinnedPc).fingerprint === 'string';

/** IndexedDB base `ledge`, version 1, store `keys`, entries `identity` and `pc`. */
export function indexedDbKeys(storage: Storage | null = defaultStorage()): KeyStore {
  let db: Promise<IDBDatabase> | null = null;
  const connect = () => {
    db ??= openDb().then((d) => {
      // Another tab upgrading the base: let it, and reopen on the next call.
      d.onversionchange = () => { d.close(); db = null; };
      return d;
    }, (e: unknown) => { db = null; throw e; });
    return db;
  };
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = (await connect()).transaction(STORE, mode);
    // Both awaited together: a failed request aborts the transaction, and neither rejection goes unhandled.
    const [result] = await Promise.all([request(op(tx.objectStore(STORE))), committed(tx)]);
    return result;
  };

  return {
    async identity() {
      const v = await run('readonly', (s) => s.get(IDENTITY));
      return isIdentity(v) ? { publicKey: v.publicKey, privateKey: v.privateKey } : null;
    },
    async saveIdentity(id) {
      await run('readwrite', (s) => s.put({ publicKey: id.publicKey, privateKey: id.privateKey }, IDENTITY));
    },
    async pinned() {
      const v = await run('readonly', (s) => s.get(PC));
      return isPinned(v) ? v : null;
    },
    async pin(pc) {
      await run('readwrite', (s) => s.put({ ...pc }, PC));
    },
    async forget() {
      const tx = (await connect()).transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.delete(IDENTITY);
      store.delete(PC);
      await committed(tx);
      clearMobileStorage(storage);
    }
  };
}
