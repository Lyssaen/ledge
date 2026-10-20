// The page's side of the pinned service worker: which build runs, which one waits for consent, and the consent.
// The messages it exchanges with the worker are a contract across versions (see BuildAnswer).
import type { BuildAnswer, BuildInfo } from './types';

export interface UpdateWatch {
  /** The build the worker serves; null until it says. */
  current(): BuildInfo | null;
  /** A newer build, installed and verified, waiting for the user; null when there is none. */
  waiting(): BuildInfo | null;
  subscribe(fn: () => void): () => void;
  /** Lets the waiting build take over; the page reloads on it. */
  accept(): void;
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const isBuild = (b: unknown): b is BuildInfo =>
  typeof (b as BuildInfo | null)?.version === 'string' && typeof (b as BuildInfo).fingerprint === 'string';

/** What a worker says of the builds it holds; null when there is no worker or its answer is not one. */
function askBuilds(worker: ServiceWorker | null): Promise<BuildAnswer | null> {
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent<unknown>) => {
      channel.port1.close();
      const d = e.data as Partial<BuildAnswer> | null;
      resolve(d && typeof d === 'object' ? { current: isBuild(d.current) ? d.current : null, pending: isBuild(d.pending) ? d.pending : null } : null);
    };
    worker.postMessage({ type: 'build' }, [channel.port2]);
  });
}

/**
 * Registers /sw.js for the whole site, bypassing the HTTP cache for the worker's script, and asks the server for a
 * newer one now and every 6 hours. Throws where service workers are unavailable.
 */
export async function registerPinnedSw(
  container: ServiceWorkerContainer | undefined = globalThis.navigator?.serviceWorker,
  reload: () => void = () => globalThis.location.reload()
): Promise<UpdateWatch> {
  if (!container) throw new Error('service workers are unavailable');
  const reg = await container.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  let current: BuildInfo | null = null;
  let waiting: BuildInfo | null = null;
  /** The build this page was loaded from: the first one the worker serves. */
  let loaded: string | undefined;
  const listeners = new Set<() => void>();

  let round = 0;
  const refresh = async () => {
    const mine = ++round;
    const [a, w] = await Promise.all([askBuilds(reg.active), askBuilds(reg.waiting)]);
    if (mine !== round) return;
    current = a?.current ?? null;
    // A worker that waits holds its own build as pending; after a cold open, the active one holds it.
    waiting = w?.pending ?? a?.pending ?? null;
    // Another build serves now (accepted here or in another tab): this page's files are no longer it.
    if (current && loaded !== undefined && current.fingerprint !== loaded) return reload();
    loaded ??= current?.fingerprint;
    for (const fn of listeners) fn();
  };
  const follow = (w: ServiceWorker | null) => w?.addEventListener('statechange', () => void refresh());

  follow(reg.installing);
  reg.addEventListener('updatefound', () => follow(reg.installing));
  container.addEventListener('controllerchange', () => void refresh());
  container.addEventListener('message', (e: MessageEvent<unknown>) => {
    if ((e.data as { type?: unknown } | null)?.type === 'changed') void refresh();
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
      if (!waiting) return;
      (reg.waiting ?? reg.active)?.postMessage({ type: 'accept' });
    }
  };
}
