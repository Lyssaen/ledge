import { afterEach } from 'vitest';
import { createStore, type MobileStore } from '../../src/state/store';
import { fakeLink, MemoryStorage } from '../state/helpers';

const stores: MobileStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

/** A real store on a fake link, ready unless told otherwise; closed after the test. */
export function setup(state: Parameters<typeof fakeLink>[0] = 'ready') {
  const f = fakeLink(state);
  const storage = new MemoryStorage();
  const store = createStore(f.link, storage);
  stores.push(store);
  return { ...f, store, storage };
}
