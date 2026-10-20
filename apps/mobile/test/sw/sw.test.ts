// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fingerprintOf } from '../../src/sw/fingerprint';

const ORIGIN = 'https://relay.test';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

type App = Record<string, string>;
const V1: App = { '/index.html': '<html>v1</html>', '/assets/index-abc.js': 'console.log(1)', '/icon-192.png': 'png' };
const V2: App = { '/index.html': '<html>v2</html>', '/assets/index-def.js': 'console.log(2)', '/icon-192.png': 'png' };
const manifestOf = (app: App) => Object.entries(app).map(([path, body]) => ({ path, sha256: sha(body) }));
/** The build.json of an app whose worker script is `script`. */
const buildOf = async (app: App, script: string, version = '0.11.0') =>
  ({ version, fingerprint: await fingerprintOf([...manifestOf(app), { path: '/sw.js', sha256: sha(script) }]) });

type Listener = (e: any) => void;

/** The browser's side shared by every worker of the origin: the caches, the server, the open pages. */
function origin() {
  const served: Record<string, string | undefined> = {};
  const stores = new Map<string, Map<string, string>>();
  const caches = {
    open: vi.fn(async (name: string) => {
      let s = stores.get(name);
      if (!s) stores.set(name, (s = new Map()));
      const store = s;
      return {
        put: async (key: string, res: Response) => { store.set(key, await res.text()); },
        match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined),
        keys: async () => [...store.keys()].map((k) => ({ url: `${ORIGIN}${k}` }))
      };
    }),
    has: async (name: string) => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name)
  };
  const fetch = vi.fn(async (input: string | { url: string }) => {
    const p = new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname;
    return served[p] !== undefined ? new Response(served[p]) : new Response('not found', { status: 404 });
  });
  const pages = [{ postMessage: vi.fn() }, { postMessage: vi.fn() }];
  /** The server serves `app` and its worker `script` from now on. */
  const serve = (app: App, script: string) => {
    for (const k of Object.keys(served)) delete served[k];
    Object.assign(served, app, { '/sw.js': script });
  };
  const ledgeCaches = async () => (await caches.keys()).filter((n) => n.startsWith('ledge-') && n !== 'ledge-meta');
  return { served, stores, caches, fetch, pages, serve, ledgeCaches };
}

type Origin = ReturnType<typeof origin>;

/** A worker script loaded in a fake scope: `id` stands for the build id the build writes into sw.js. */
async function worker(o: Origin, opts: { app?: App; id?: string; active?: boolean } = {}) {
  const app = opts.app ?? V1;
  const on: Record<string, Listener> = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    registration: { active: opts.active ? {} : null },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => o.pages) },
    addEventListener: (type: string, fn: Listener) => { on[type] = fn; }
  };
  vi.stubGlobal('self', self);
  vi.stubGlobal('caches', o.caches);
  vi.stubGlobal('fetch', o.fetch);
  vi.stubGlobal('__MANIFEST__', manifestOf(app));
  vi.stubGlobal('__VERSION__', '0.11.0');
  vi.stubGlobal('__BUILD_ID__', opts.id ?? '1111111111111111');
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
  const page = async (path: string) => (await (await request(path, 'navigate')).response!).text();
  const message = async (data: unknown) => {
    const postMessage = vi.fn();
    await dispatch('message', { data, ports: [{ postMessage }] });
    return postMessage;
  };
  const build = async () => (await message({ type: 'build' })).mock.calls[0]?.[0] as unknown;
  return { self, dispatch, request, page, message, build };
}

/** v1 installed by the first visit and active, as the page finds it. */
async function firstVisit(o: Origin) {
  o.serve(V1, 'sw v1');
  const v1 = await worker(o, { app: V1, id: 'aaaaaaaaaaaaaaaa' });
  await v1.dispatch('install');
  await v1.dispatch('activate');
  return v1;
}

/** v2 found on the server and installed while v1 is active: it waits. */
async function update(o: Origin, script = 'sw v2') {
  o.serve(V2, script);
  const v2 = await worker(o, { app: V2, id: 'bbbbbbbbbbbbbbbb', active: true });
  await v2.dispatch('install');
  return v2;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the pinned service worker', () => {
  describe('installation', () => {
    it('caches every file of the manifest and sw.js, each one as served, in a cache named after its version and build id', async () => {
      const o = origin();
      o.serve(V1, 'sw v1');
      const w = await worker(o, { id: 'aaaaaaaaaaaaaaaa' });
      await w.dispatch('install');
      expect(await o.ledgeCaches()).toEqual(['ledge-0.11.0-aaaaaaaaaaaaaaaa']);
      expect(Object.fromEntries(o.stores.get('ledge-0.11.0-aaaaaaaaaaaaaaaa')!)).toEqual({ ...V1, '/sw.js': 'sw v1' });
    });

    it('fails when a file does not hash to the manifest, and keeps nothing of it', async () => {
      const o = origin();
      o.serve({ ...V1, '/assets/index-abc.js': 'console.log("changed")' }, 'sw v1');
      const w = await worker(o);
      await expect(w.dispatch('install')).rejects.toThrow();
      expect(await o.ledgeCaches()).toEqual([]);
    });

    it('fails when a file is missing', async () => {
      const o = origin();
      o.serve({ ...V1, '/icon-192.png': undefined } as unknown as App, 'sw v1');
      const w = await worker(o);
      await expect(w.dispatch('install')).rejects.toThrow();
    });

    it('a failed update leaves the accepted build intact, even when only sw.js differs from it', async () => {
      const o = origin();
      const v1 = await firstVisit(o);
      // The same app, another worker script (so another build id), and a file that does not check out.
      o.serve({ ...V1, '/icon-192.png': 'not the png' }, 'sw v1 fixed');
      const next = await worker(o, { app: V1, id: 'cccccccccccccccc', active: true });
      await expect(next.dispatch('install')).rejects.toThrow();
      expect(await o.ledgeCaches()).toEqual(['ledge-0.11.0-aaaaaaaaaaaaaaaa']);
      expect(await v1.page('/')).toBe('<html>v1</html>');
    });
  });

  describe('activation', () => {
    it('an update waits: no skipWaiting() until the page sends { type: "accept" }', async () => {
      const o = origin();
      await firstVisit(o);
      const w = await update(o);
      await w.message({ type: 'build' });
      await w.message({ type: 'other' });
      await w.message(null);
      expect(w.self.skipWaiting).not.toHaveBeenCalled();
      await w.message({ type: 'accept' });
      expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it('the first installation (no worker yet, no client controlled) activates by itself and is the accepted build', async () => {
      const o = origin();
      const w = await firstVisit(o);
      expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
      expect(w.self.clients.claim).toHaveBeenCalled();
      expect(await w.build()).toEqual({ current: await buildOf(V1, 'sw v1'), pending: null });
    });

    it('once active: drops the caches of other builds, never the accepted one, and takes the open pages', async () => {
      const o = origin();
      await (await o.caches.open('ledge-0.10.0-0000000000000000')).put('/index.html', new Response('old'));
      await (await o.caches.open('someone-else')).put('/x', new Response('x'));
      const v1 = await firstVisit(o);
      expect(await o.ledgeCaches()).toEqual(['ledge-0.11.0-aaaaaaaaaaaaaaaa']);
      expect(o.stores.has('someone-else')).toBe(true);
      expect(v1.self.clients.claim).toHaveBeenCalled();
    });

    it('a waiting build the browser activates without consent (every page closed) still serves the accepted one', async () => {
      const o = origin();
      await firstVisit(o);
      const v2 = await update(o);
      // Every page was closed: the browser activates v2 on its own, and the next visit is a cold open.
      await v2.dispatch('activate');
      expect(await o.ledgeCaches()).toEqual(expect.arrayContaining(['ledge-0.11.0-aaaaaaaaaaaaaaaa', 'ledge-0.11.0-bbbbbbbbbbbbbbbb']));
      o.fetch.mockClear();
      expect(await v2.page('/')).toBe('<html>v1</html>');
      expect(await (await (await v2.request('/assets/index-abc.js')).response!).text()).toBe('console.log(1)');
      expect(o.fetch).not.toHaveBeenCalled();
      expect(await v2.build()).toEqual({ current: await buildOf(V1, 'sw v1'), pending: await buildOf(V2, 'sw v2') });
    });

    it('accepting that active build promotes it: it becomes current, the other build goes, and every page is told', async () => {
      const o = origin();
      await firstVisit(o);
      const v2 = await update(o);
      await v2.dispatch('activate');
      await v2.message({ type: 'accept' });
      expect(await v2.page('/')).toBe('<html>v2</html>');
      expect(await v2.build()).toEqual({ current: await buildOf(V2, 'sw v2'), pending: null });
      expect(await o.ledgeCaches()).toEqual(['ledge-0.11.0-bbbbbbbbbbbbbbbb']);
      for (const p of o.pages) expect(p.postMessage).toHaveBeenCalledWith({ type: 'changed' });
    });

    it('accepting a waiting build: it is current at once for the old worker too, then takes over', async () => {
      const o = origin();
      const v1 = await firstVisit(o);
      const v2 = await update(o);
      expect(await v1.build()).toEqual({ current: await buildOf(V1, 'sw v1'), pending: null });
      expect(await v2.build()).toEqual({ current: await buildOf(V1, 'sw v1'), pending: await buildOf(V2, 'sw v2') });
      await v2.message({ type: 'accept' });
      expect(await v1.page('/')).toBe('<html>v2</html>');
      await v2.dispatch('activate');
      expect(await o.ledgeCaches()).toEqual(['ledge-0.11.0-bbbbbbbbbbbbbbbb']);
    });
  });

  describe('requests', () => {
    it('a navigation, whatever its path, answers /index.html from the cache', async () => {
      const o = origin();
      const w = await firstVisit(o);
      // The server has moved on since: the cache answers all the same.
      o.serve(V2, 'sw v2');
      o.fetch.mockClear();
      for (const path of ['/', '/agents', '/index.html']) expect(await w.page(path)).toBe('<html>v1</html>');
      const { response } = await w.request('/assets/index-abc.js');
      expect(await (await response!).text()).toBe('console.log(1)');
      expect(o.fetch).not.toHaveBeenCalled();
    });

    it('/auth/*, /ws and /healthz go to the network, untouched by the cache', async () => {
      const o = origin();
      const w = await firstVisit(o);
      o.caches.open.mockClear();
      for (const [path, mode] of [['/auth/me', 'cors'], ['/auth/github/start', 'navigate'], ['/auth', 'navigate'], ['/ws', 'cors'], ['/healthz', 'cors']] as const) {
        const { response } = await w.request(path, mode);
        expect(response, path).toBeUndefined();
      }
      expect(o.caches.open).not.toHaveBeenCalled();
    });

    it('other origins and other methods are left alone', async () => {
      const o = origin();
      const w = await firstVisit(o);
      expect((await w.dispatch('fetch', { request: { url: 'https://github.com/login', mode: 'navigate', method: 'GET' } })).response).toBeUndefined();
      expect((await w.request('/index.html', 'cors', 'POST')).response).toBeUndefined();
    });
  });

  it('{ type: "build" } answers the builds computed again over the cached files and sw.js, whatever the server says now', async () => {
    const o = origin();
    await firstVisit(o);
    const v2 = await update(o);
    o.fetch.mockImplementation(async () => new Response('changed'));
    expect(await v2.build()).toEqual({ current: await buildOf(V1, 'sw v1'), pending: await buildOf(V2, 'sw v2') });
  });
});
