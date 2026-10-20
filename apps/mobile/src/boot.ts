// What runs once before the app shows anything: the relay's sign-in answer is read, lost keys are noticed, then the
// link and the store are made. Only ever imported in a secure context: it loads @ledge/seal.
import { clearMobileStorage, indexedDbKeys, type KeyStore } from './link/keys';
import { createPhoneLink, type PhoneLink } from './link/link';
import { LAST_STATE_KEY } from './state/persist';
import { localStore } from './state/storage';
import { createStore, type MobileStore } from './state/store';
import { registerPinnedSw, type UpdateWatch } from './sw/register';

/**
 * The relay's `?signin=<issue>` (after GitHub), taken out of the address so a reload does not say it again; the path
 * and the hash stay. Null when there is none.
 */
export function takeSignin(): string | null {
  try {
    const url = new URL(globalThis.location.href);
    const issue = url.searchParams.get('signin');
    if (issue === null) return null;
    url.searchParams.delete('signin');
    globalThis.history.replaceState(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return issue;
  } catch {
    return null;
  }
}

/**
 * The phone's identity is gone (site data cleared, a private window) while the last state is still cached: what was
 * cached belonged to a link that no longer exists, so every key and every `ledge.mobile.*` entry is dropped. True
 * when that happened. A key store that cannot be read is not taken for a lost one.
 */
export async function forgetIfKeysLost(keys: KeyStore, storage?: Storage): Promise<boolean> {
  let identity: unknown;
  try {
    identity = await keys.identity();
  } catch {
    return false;
  }
  const local = localStore(storage);
  if (identity || !local?.getItem(LAST_STATE_KEY)) return false;
  try {
    await keys.forget();
  } catch {
    // The cache below is dropped all the same.
  }
  clearMobileStorage(local);
  return true;
}

export interface Booted {
  link: PhoneLink;
  store: MobileStore;
  signin: string | null;
  lost: boolean;
  /** Null where no service worker could be registered: the app runs all the same, its build unknown. */
  updates: UpdateWatch | null;
}

/** The link to the relay of this origin, the store on it, and the pinned service worker. */
export async function boot(): Promise<Booted> {
  const signin = takeSignin();
  const keys = indexedDbKeys();
  const lost = await forgetIfKeysLost(keys);
  const link = createPhoneLink({ keys, url: globalThis.location.origin });
  const store = createStore(link);
  const updates = await registerPinnedSw().catch(() => null);
  return { link, store, signin, lost, updates };
}
