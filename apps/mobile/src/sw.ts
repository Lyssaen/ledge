// Service worker, built as its own entry to `sw.js` at the root of /m/. Offline shell: `index.html` goes network
// first (so a new build is picked up), hashed `assets/*` cache first. The DOM lib has no worker types, so the few
// members used are declared here.
interface Ev { waitUntil(p: Promise<unknown>): void }
interface FetchEv extends Ev { request: Request; respondWith(r: Promise<Response>): void }
interface Sw {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', cb: (e: Ev) => void): void;
  addEventListener(type: 'fetch', cb: (e: FetchEv) => void): void;
}
const sw = self as unknown as Sw;

declare const __BUILD__: string;
// One cache per build: activating a new worker drops the previous build's hashed assets.
const CACHE = `ledge-shell-${__BUILD__}`;
const scope = new URL('./', sw.location.href);
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/180.png', './icons/192.png', './icons/512.png'].map(p => new URL(p, scope).href);

sw.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => sw.clients.claim()));
});

async function networkFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

sw.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('assets/')) e.respondWith(cacheFirst(req));
  else if (req.mode === 'navigate' || rel === '' || rel === 'index.html') e.respondWith(networkFirst(req));
  else if (SHELL.includes(url.href)) e.respondWith(networkFirst(req));
});
