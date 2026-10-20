// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fingerprintOf } from '../../src/sw/fingerprint';

const ORIGIN = 'https://relay.test';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const APP: Record<string, string> = { '/index.html': '<html>v1</html>', '/assets/index-abc.js': 'console.log(1)', '/icon-192.png': 'png' };
const SW_JS = 'the worker';
const MANIFEST = Object.entries(APP).map(([path, body]) => ({ path, sha256: sha(body) }));

type Listener = (e: any) => void;

/** The worker module loaded in a fake scope: `self`, `caches` and `fetch` stand for the browser's. */
async function worker(opts: { served?: Record<string, string | undefined>; active?: boolean } = {}) {
  const served: Record<string, string | undefined> = { ...APP, '/sw.js': SW_JS, ...opts.served };
  const on: Record<string, Listener> = {};
  const stores = new Map<string, Map<string, string>>();
  const opened: string[] = [];
  const caches = {
    open: vi.fn(async (name: string) => {
      opened.push(name);
      let s = stores.get(name);
      if (!s) stores.set(name, (s = new Map()));
      const store = s;
      return {
        put: async (key: string, res: Response) => { store.set(key, await res.text()); },
        match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined)
      };
    }),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name)
  };
  const fetch = vi.fn(async (input: string | { url: string }) => {
    const p = new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname;
    return served[p] !== undefined ? new Response(served[p]) : new Response('not found', { status: 404 });
  });
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    registration: { active: opts.active ? {} : null },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    addEventListener: (type: string, fn: Listener) => { on[type] = fn; }
  };
  vi.stubGlobal('self', self);
  vi.stubGlobal('caches', caches);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('__MANIFEST__', MANIFEST);
  vi.stubGlobal('__VERSION__', '0.11.0');
  vi.resetModules();
  await import('../../src/sw/sw');

  /** Dispatches an extendable event and waits for what it extended itself with. */
  const dispatch = async (type: string, extra: object = {}) => {
    const waits: Promise<unknown>[] = [];
    const responses: Promise<Response>[] = [];
    on[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, respondWith: (r: Promise<Response>) => { responses.push(r); } });
    await Promise.all(waits);
    return { response: responses[0] };
  };
  const request = (path: string, mode = 'cors', method = 'GET') => dispatch('fetch', { request: { url: `${ORIGIN}${path}`, mode, method } });
  const message = async (data: unknown) => {
    const postMessage = vi.fn();
    await dispatch('message', { data, ports: [{ postMessage }] });
    return postMessage;
  };
  return { self, caches, fetch, stores, opened, dispatch, request, message };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the pinned service worker', () => {
  describe('installation', () => {
    it('caches every file of the manifest and sw.js, each one as served', async () => {
      const w = await worker();
      await w.dispatch('install');
      expect(w.stores.size).toBe(1);
      const cached = Object.fromEntries([...w.stores.values()][0]!);
      expect(cached).toEqual({ ...APP, '/sw.js': SW_JS });
    });

    it('fails when a file does not hash to the manifest, and keeps nothing of it', async () => {
      const w = await worker({ served: { '/assets/index-abc.js': 'console.log("changed")' } });
      await expect(w.dispatch('install')).rejects.toThrow();
      expect(await w.caches.keys()).toEqual([]);
    });

    it('fails when a file is missing', async () => {
      const w = await worker({ served: { '/icon-192.png': undefined } });
      await expect(w.dispatch('install')).rejects.toThrow();
    });
  });

  describe('activation', () => {
    it('an update waits: no skipWaiting() until the page sends { type: "accept" }', async () => {
      const w = await worker({ active: true });
      await w.dispatch('install');
      await w.message({ type: 'build' });
      await w.message({ type: 'other' });
      await w.message(null);
      expect(w.self.skipWaiting).not.toHaveBeenCalled();
      await w.message({ type: 'accept' });
      expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it('the first installation (no worker yet, no client controlled) activates by itself', async () => {
      const w = await worker({ active: false });
      await w.dispatch('install');
      expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it('once active: drops the caches of other builds and takes the open pages', async () => {
      const w = await worker();
      await (await w.caches.open('ledge-old')).put('/index.html', new Response('old'));
      await (await w.caches.open('someone-else')).put('/x', new Response('x'));
      await w.dispatch('install');
      await w.dispatch('activate');
      const left = await w.caches.keys();
      expect(left).toHaveLength(2);
      expect(left).toContain('someone-else');
      expect(left.find((n) => n.startsWith('ledge-'))).not.toBe('ledge-old');
      expect(w.self.clients.claim).toHaveBeenCalled();
    });
  });

  describe('requests', () => {
    it('a navigation, whatever its path, answers /index.html from the cache', async () => {
      const w = await worker();
      await w.dispatch('install');
      // The server has moved on since: the cache answers all the same.
      w.fetch.mockImplementation(async () => new Response('<html>v2</html>'));
      w.fetch.mockClear();
      for (const path of ['/', '/agents', '/index.html']) {
        const { response } = await w.request(path, 'navigate');
        expect(await (await response!).text()).toBe('<html>v1</html>');
      }
      const { response } = await w.request('/assets/index-abc.js');
      expect(await (await response!).text()).toBe('console.log(1)');
      expect(w.fetch).not.toHaveBeenCalled();
    });

    it('/auth/*, /ws and /healthz go to the network, untouched by the cache', async () => {
      const w = await worker();
      await w.dispatch('install');
      w.caches.open.mockClear();
      for (const [path, mode] of [['/auth/me', 'cors'], ['/auth/github/start', 'navigate'], ['/auth', 'navigate'], ['/ws', 'cors'], ['/healthz', 'cors']] as const) {
        const { response } = await w.request(path, mode);
        expect(response, path).toBeUndefined();
      }
      expect(w.caches.open).not.toHaveBeenCalled();
    });

    it('other origins and other methods are left alone', async () => {
      const w = await worker();
      await w.dispatch('install');
      expect((await w.dispatch('fetch', { request: { url: 'https://github.com/login', mode: 'navigate', method: 'GET' } })).response).toBeUndefined();
      expect((await w.request('/index.html', 'cors', 'POST')).response).toBeUndefined();
    });
  });

  it('{ type: "build" } answers { version, fingerprint }, the fingerprint computed again over the verified files and sw.js', async () => {
    const w = await worker({ active: true });
    await w.dispatch('install');
    // The server changing afterwards changes nothing: the answer is the build the worker holds.
    w.fetch.mockImplementation(async () => new Response('changed'));
    const post = await w.message({ type: 'build' });
    const fingerprint = await fingerprintOf([...MANIFEST, { path: '/sw.js', sha256: sha(SW_JS) }]);
    expect(post).toHaveBeenCalledWith({ version: '0.11.0', fingerprint });
  });
});
