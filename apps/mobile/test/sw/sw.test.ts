// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushPayloadSchema } from '@ledge/protocol';
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
        keys: async () => [...store.keys()].map((k) => ({ url: `${ORIGIN}${k}` })),
        delete: async (key: string) => store.delete(key)
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
  const pages = [{ postMessage: vi.fn(), focus: vi.fn(async () => {}) }, { postMessage: vi.fn(), focus: vi.fn(async () => {}) }];
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
    registration: { active: opts.active ? {} : null, showNotification: vi.fn(async () => {}), setAppBadge: vi.fn(async () => {}) },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => o.pages), openWindow: vi.fn(async () => null) },
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
  const push = (data: unknown) => dispatch('push', { data: data === undefined ? null : { json: () => { if (typeof data === 'function') return data(); return data; } } });
  const click = (url: unknown) => {
    const notification = { close: vi.fn(), data: url === undefined ? undefined : { url } };
    return dispatch('notificationclick', { notification }).then(() => notification);
  };
  const build = async () => (await message({ type: 'build' })).mock.calls[0]?.[0] as unknown;
  return { self, dispatch, request, page, message, build, push, click };
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

    it('/auth/*, /ws, /healthz and /push/key go to the network, untouched by the cache', async () => {
      const o = origin();
      const w = await firstVisit(o);
      o.caches.open.mockClear();
      for (const [path, mode] of [['/auth/me', 'cors'], ['/auth/github/start', 'navigate'], ['/auth', 'navigate'], ['/ws', 'cors'], ['/healthz', 'cors'], ['/push/key', 'cors']] as const) {
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

  describe('installation race', () => {
    it('a worker installing keeps its cache when another worker accepts and prunes meanwhile', async () => {
      const o = origin();
      const v1 = await firstVisit(o);
      await update(o);
      await v1.message({ type: 'accept' });
      expect(await o.ledgeCaches()).toEqual(expect.arrayContaining(['ledge-0.11.0-bbbbbbbbbbbbbbbb']));
    });

    it('an installation registered 25 hours ago no longer protects its cache', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const o = origin();
        const v1 = await firstVisit(o);
        await update(o);
        vi.setSystemTime(Date.now() + 25 * 3_600_000);
        await v1.message({ type: 'accept' });
        expect(await o.ledgeCaches()).toEqual(['ledge-0.11.0-aaaaaaaaaaaaaaaa']);
      } finally { vi.useRealTimers(); }
    });

    it('activation and a failed installation withdraw the registration', async () => {
      const o = origin();
      await firstVisit(o);
      const meta = () => [...(o.stores.get('ledge-meta')?.keys() ?? [])].filter((k) => k.startsWith('/pending/'));
      expect(meta()).toEqual([]);
      const v2 = await update(o);
      expect(meta()).toEqual(['/pending/ledge-0.11.0-bbbbbbbbbbbbbbbb']);
      await v2.dispatch('activate');
      expect(meta()).toEqual([]);
      o.serve({ ...V1, '/icon-192.png': 'bad' }, 'sw v3');
      const v3 = await worker(o, { app: V1, id: 'cccccccccccccccc', active: true });
      await expect(v3.dispatch('install')).rejects.toThrow();
      expect(meta()).toEqual([]);
    });
  });

  describe('notifications', () => {
    const payload = { v: 1, kind: 'request', title: 'api attend votre accord', body: 'rm -rf build', url: '/#/request/s1/k1', badge: 3, tag: 's1-k1' };
    const FALLBACK = ['Ledge', { body: 'Une demande attend', tag: 'ledge' }];

    it('a valid push shows its title, body and url, and sets the badge', async () => {
      const o = origin();
      const w = await firstVisit(o);
      await w.push(payload);
      expect(w.self.registration.showNotification).toHaveBeenCalledWith('api attend votre accord', { body: 'rm -rf build', tag: 's1-k1', data: { url: '/#/request/s1/k1' }, icon: '/icon-192.png' });
      expect(w.self.registration.setAppBadge).toHaveBeenCalledWith(3);
    });

    it('an unreadable, absent or foreign-url push shows the fallback notification', async () => {
      const o = origin();
      const w = await firstVisit(o);
      const show = w.self.registration.showNotification;
      await w.push(() => { throw new Error('not json'); });
      await w.push(undefined);
      await w.push({ ...payload, url: 'https://evil.example' });
      await w.push({ ...payload, kind: 'other' });
      expect(show).toHaveBeenCalledTimes(4);
      for (const call of show.mock.calls) expect(call).toEqual(FALLBACK);
    });

    it('a push still shows when the badge API is missing', async () => {
      const o = origin();
      const w = await firstVisit(o);
      delete (w.self.registration as { setAppBadge?: unknown }).setAppBadge;
      await w.push(payload);
      expect(w.self.registration.showNotification).toHaveBeenCalledTimes(1);
    });

    it('shows the real notification exactly when PushPayloadSchema accepts the payload', async () => {
      const o = origin();
      const w = await firstVisit(o);
      const show = w.self.registration.showNotification;
      const fixtures: Record<string, unknown> = {
        valid: payload,
        'v 2': { ...payload, v: 2 },
        'bad kind': { ...payload, kind: 'other' },
        'title 80': { ...payload, title: 't'.repeat(80) },
        'title 81': { ...payload, title: 't'.repeat(81) },
        'body 120': { ...payload, body: 'b'.repeat(120) },
        'body 121': { ...payload, body: 'b'.repeat(121) },
        'url //evil': { ...payload, url: '//evil' },
        'url with space': { ...payload, url: '/#/a b' },
        'url 300': { ...payload, url: '/#/' + 'a'.repeat(297) },
        'url 301': { ...payload, url: '/#/' + 'a'.repeat(298) },
        'badge -1': { ...payload, badge: -1 },
        'badge 1.5': { ...payload, badge: 1.5 },
        'badge 999': { ...payload, badge: 999 },
        'badge 1000': { ...payload, badge: 1000 },
        'bad tag': { ...payload, tag: 'a b' },
        'extra key': { ...payload, extra: 1 }
      };
      for (const [name, fixture] of Object.entries(fixtures)) {
        show.mockClear();
        await w.push(fixture);
        expect(show).toHaveBeenCalledTimes(1);
        expect((show.mock.calls[0] as unknown[])[0] !== 'Ledge', name).toBe(PushPayloadSchema.safeParse(fixture).success);
      }
    });

    it('a badge API that throws does not fail the push', async () => {
      const o = origin();
      const w = await firstVisit(o);
      w.self.registration.setAppBadge.mockImplementation(() => { throw new Error('sync'); });
      await expect(w.push(payload)).resolves.toBeDefined();
      expect(w.self.registration.showNotification).toHaveBeenCalledTimes(1);
    });

    it('a click with a window open closes the notification, focuses it and tells it where to go', async () => {
      const o = origin();
      const w = await firstVisit(o);
      const n = await w.click('/#/request/s1/k1');
      expect(n.close).toHaveBeenCalled();
      expect(o.pages[0]!.focus).toHaveBeenCalled();
      expect(o.pages[0]!.postMessage).toHaveBeenCalledWith({ type: 'ledge.open', url: '/#/request/s1/k1' });
      expect(w.self.clients.openWindow).not.toHaveBeenCalled();
    });

    it('a click with no window opens one on the page', async () => {
      const o = origin();
      const w = await firstVisit(o);
      w.self.clients.matchAll.mockImplementation(async () => []);
      await w.click('/#/request/s1/k1');
      expect(w.self.clients.openWindow).toHaveBeenCalledWith('/#/request/s1/k1');
    });

    it('a click whose url is not inside the app goes to /#/', async () => {
      const o = origin();
      const w = await firstVisit(o);
      w.self.clients.matchAll.mockImplementation(async () => []);
      await w.click('https://evil.example');
      await w.click(undefined);
      expect(w.self.clients.openWindow.mock.calls).toEqual([['/#/'], ['/#/']]);
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
