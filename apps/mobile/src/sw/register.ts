// The page's side of the pinned service worker: which build runs, which one waits for consent, and the consent.
import type { BuildInfo } from './types';

export interface UpdateWatch {
  /** The build the active worker serves; null until it says. */
  current(): BuildInfo | null;
  /** A newer build, installed and verified, waiting for the user; null when there is none. */
  waiting(): BuildInfo | null;
  subscribe(fn: () => void): () => void;
  /** Lets the waiting build take over; the page reloads on it. */
  accept(): void;
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** What a worker says of the build it holds; null when its answer is not one. */
function askBuild(worker: ServiceWorker): Promise<BuildInfo | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent<unknown>) => {
      channel.port1.close();
      const d = e.data as Partial<BuildInfo> | null;
      resolve(typeof d?.version === 'string' && typeof d.fingerprint === 'string' ? { version: d.version, fingerprint: d.fingerprint } : null);
    };
    worker.postMessage({ type: 'build' }, [channel.port2]);
  });
}

/**
 * Registers /sw.js for the whole site, bypassing the HTTP cache for the worker's script, and asks the server for a
 * newer one now and every 6 hours. Throws where service workers are unavailable.
 */
export async function registerPinnedSw(container: ServiceWorkerContainer | undefined = globalThis.navigator?.serviceWorker): Promise<UpdateWatch> {
  if (!container) throw new Error('service workers are unavailable');
  const reg = await container.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  let current: BuildInfo | null = null;
  let waiting: BuildInfo | null = null;
  let accepted = false;
  const listeners = new Set<() => void>();
  const asked = new WeakMap<ServiceWorker, Promise<BuildInfo | null>>();
  const buildOf = (w: ServiceWorker | null) => {
    if (!w) return null;
    let b = asked.get(w);
    if (!b) asked.set(w, (b = askBuild(w)));
    return b;
  };

  let round = 0;
  const refresh = async () => {
    const mine = ++round;
    const [a, w] = await Promise.all([buildOf(reg.active), buildOf(reg.waiting)]);
    if (mine !== round) return;
    current = a;
    waiting = w;
    for (const fn of listeners) fn();
  };
  const follow = (w: ServiceWorker | null) => w?.addEventListener('statechange', () => void refresh());

  follow(reg.installing);
  reg.addEventListener('updatefound', () => follow(reg.installing));
  container.addEventListener('controllerchange', () => {
    // The first installation takes the page by itself: only an accepted update reloads it.
    if (accepted) globalThis.location.reload();
    else void refresh();
  });
  void refresh();
  const check = () => { reg.update().catch(() => { /* offline: the next check will tell */ }); };
  check();
  setInterval(check, CHECK_EVERY_MS);

  return {
    current: () => current,
    waiting: () => waiting,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    accept() {
      if (!reg.waiting) return;
      accepted = true;
      reg.waiting.postMessage({ type: 'accept' });
    }
  };
}
