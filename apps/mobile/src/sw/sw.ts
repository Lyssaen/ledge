// The pinned service worker: it serves the build the user accepted, each file checked against the hash its worker
// carried, and a newer build takes over only when the user accepts it. Built on its own by vite.sw.config.ts, which
// writes the manifest, the version and the build id in; it never loads @ledge/seal.
//
// The browser alone decides which worker SCRIPT runs: a waiting worker becomes the active one once every page of the
// app is closed, consent or not. What stays pinned is the app's files: whichever worker runs serves the cache the
// marker in `ledge-meta` names, and moves it only on { type: 'accept' }.
import { fingerprintOf, hexOf, type FileHash } from './fingerprint';
import type { PushPayload } from '@ledge/protocol';
import type { BuildAnswer, BuildInfo } from './types';

/** The app's files and their hashes, without sw.js (vite.sw.config.ts). */
declare const __MANIFEST__: FileHash[];
/** The version of packages/ledge (vite.sw.config.ts). */
declare const __VERSION__: string;
/** 16 hex of the hash of this very script, so two builds never share a cache (vite.sw.config.ts). */
declare const __BUILD_ID__: string;

// The parts of the worker scope used here: the DOM lib this app compiles against has no worker types.
type Extendable = { waitUntil(p: Promise<unknown>): void };
type FetchEvent = Extendable & { request: Request; respondWith(r: Promise<Response>): void };
type PushEvent = Extendable & { data: { json(): unknown } | null };
type ClickEvent = Extendable & { notification: { close(): void; data?: { url?: unknown } } };
type MessageEvent = Extendable & { data: unknown; ports: readonly { postMessage(m: unknown): void }[] };
interface WorkerScope {
  location: { origin: string };
  registration: {
    active: object | null;
    showNotification(title: string, o?: { body?: string; tag?: string; data?: { url: string }; icon?: string; renotify?: boolean }): Promise<void>;
    setAppBadge?(n: number): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
    matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly { postMessage(m: unknown): void; focus?(): Promise<unknown> }[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: 'install' | 'activate', fn: (e: Extendable) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  addEventListener(type: 'push', fn: (e: PushEvent) => void): void;
  addEventListener(type: 'notificationclick', fn: (e: ClickEvent) => void): void;
}

const sw = self as unknown as WorkerScope;
const MANIFEST = __MANIFEST__;
const SELF = '/sw.js';
const PREFIX = 'ledge-';
/** One cache per build, `ledge-<version>-<build id>`: a worker waiting for consent fills its own. */
const OWN = `${PREFIX}${__VERSION__}-${__BUILD_ID__}`;
/** Where the accepted build's cache name is kept, across workers and versions. */
const META = `${PREFIX}meta`;
const ACCEPTED = '/accepted';
/** The relay's own routes: always the network, never the cache. */
const NETWORK = /^\/(auth(\/.*)?|ws|healthz|push\/key)$/;
/** Where a worker that is installing writes down that its cache is not an orphan: `/pending/<cache name>` = the time. */
const PENDING = '/pending/';
const PENDING_TTL = 24 * 3_600_000;
// The shapes of PushPayloadSchema (packages/protocol/src/push.ts), checked by hand: zod would weigh the pinned worker
// down by far more than this. Keep the two in step.
const PUSH_URL = /^\/#\/[A-Za-z0-9/%._~-]*$/;
const PUSH_TAG = /^[A-Za-z0-9_-]{1,32}$/;

const sha256 = async (bytes: ArrayBuffer): Promise<string> => hexOf(await crypto.subtle.digest('SHA-256', bytes));

/** The cache of the build the user accepted, as marked; null before any. */
async function marked(): Promise<string | null> {
  const hit = await (await caches.open(META)).match(ACCEPTED);
  return hit ? hit.text() : null;
}

/** The cache of the build the user accepted; this worker's own while none is marked. */
const accepted = async (): Promise<string> => (await marked()) ?? OWN;

/** The caches of the workers installing right now: registered less than a day ago (older ones are abandoned). */
async function installing(): Promise<string[]> {
  const meta = await caches.open(META);
  const names: string[] = [];
  for (const key of await meta.keys()) {
    const path = new URL(key.url).pathname;
    if (!path.startsWith(PENDING)) continue;
    const since = Number(await (await meta.match(path))?.text());
    if (Date.now() - since < PENDING_TTL) names.push(path.slice(PENDING.length));
    else await meta.delete(path);
  }
  return names;
}

async function accept(): Promise<void> {
  await (await caches.open(META)).put(ACCEPTED, new Response(OWN));
  await prune();
}

/** Drops the caches of builds that are neither this worker's nor the accepted one. */
async function prune(): Promise<void> {
  const keep = new Set([META, OWN, await accepted(), ...(await installing())]);
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && !keep.has(name)) await caches.delete(name);
}

/** A file as the server serves it now, refused unless it hashes to `want` (when given). */
async function fetchChecked(path: string, want?: string): Promise<Response> {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  if (want !== undefined && (await sha256(await res.clone().arrayBuffer())) !== want) throw new Error(`${path}: not the file of this build`);
  return res;
}

async function install(): Promise<void> {
  const meta = await caches.open(META);
  // Before its cache exists: a worker that prunes meanwhile must not take it for an orphan.
  await meta.put(PENDING + OWN, new Response(String(Date.now())));
  const cache = await caches.open(OWN);
  try {
    const files = await Promise.all([...MANIFEST.map((f) => fetchChecked(f.path, f.sha256).then((res) => [f.path, res] as const)), fetchChecked(SELF).then((res) => [SELF, res] as const)]);
    for (const [path, res] of files) await cache.put(path, res);
  } catch (e) {
    // Never the accepted build's cache, should this very build be installed again.
    if ((await marked()) !== OWN) await caches.delete(OWN);
    await meta.delete(PENDING + OWN);
    throw e;
  }
  // The first installation has no build to keep: it is the accepted one and serves at once. Any later one waits.
  if (!sw.registration.active) {
    await accept();
    await sw.skipWaiting();
  }
}

async function activate(): Promise<void> {
  await (await caches.open(META)).delete(PENDING + OWN);
  await prune();
  await sw.clients.claim();
}

/** A navigation is the app's page; any other file is the accepted build's, or the network when it has none. */
async function answer(request: Request, path: string): Promise<Response> {
  const name = await accepted();
  const hit = (await caches.has(name)) ? await (await caches.open(name)).match(path) : undefined;
  return hit ?? fetch(request);
}

/** The build a cache holds, its fingerprint computed again over every file in it, sw.js included. */
async function buildIn(name: string): Promise<BuildInfo | null> {
  if (!(await caches.has(name))) return null;
  const cache = await caches.open(name);
  const files: FileHash[] = [];
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname;
    const hit = await cache.match(path);
    if (hit) files.push({ path, sha256: await sha256(await hit.arrayBuffer()) });
  }
  if (!files.some((f) => f.path === SELF)) return null;
  // `ledge-<version>-<build id>`: the build id is hex, so the version is what lies between.
  return { version: name.slice(PREFIX.length, name.lastIndexOf('-')), fingerprint: await fingerprintOf(files) };
}

async function builds(): Promise<BuildAnswer> {
  const current = await accepted();
  return { current: await buildIn(current), pending: current === OWN ? null : await buildIn(OWN) };
}

sw.addEventListener('install', (e) => e.waitUntil(install()));
sw.addEventListener('activate', (e) => e.waitUntil(activate()));

sw.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin || NETWORK.test(url.pathname)) return;
  e.respondWith(answer(request, request.mode === 'navigate' ? '/index.html' : url.pathname));
});

sw.addEventListener('message', (e) => {
  const type = (e.data as { type?: unknown } | null)?.type;
  if (type === 'build') e.waitUntil(builds().then((b) => e.ports[0]?.postMessage(b)));
  // Accepted: this build serves from now on; every page is told, and one of an older build reloads.
  if (type === 'accept') {
    e.waitUntil((async () => {
      await accept();
      await sw.skipWaiting();
      for (const page of await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })) page.postMessage({ type: 'changed' });
    })());
  }
});

/** The payload when it has the shape of PushPayloadSchema, else null. */
function payloadOf(raw: unknown): PushPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
  const ok =
    p.v === 1 && (p.kind === 'request' || p.kind === 'question' || p.kind === 'finished' || p.kind === 'chat') &&
    str(p.title, 80) && str(p.body, 120) && str(p.url, 300) && PUSH_URL.test(p.url) &&
    typeof p.badge === 'number' && Number.isInteger(p.badge) && p.badge >= 0 && p.badge <= 999 &&
    typeof p.tag === 'string' && PUSH_TAG.test(p.tag);
  return ok ? (raw as PushPayload) : null;
}

// Every push shows a notification, whatever it carries: Safari drops the subscription of a site that stays silent.
sw.addEventListener('push', (e) => {
  let payload: PushPayload | null = null;
  try { payload = payloadOf(e.data?.json()); } catch { /* unreadable: the fallback below */ }
  e.waitUntil((async () => {
    if (!payload) return sw.registration.showNotification('Ledge', { body: 'Une demande attend', tag: 'ledge', renotify: true });
    await sw.registration.showNotification(payload.title, { body: payload.body, tag: payload.tag, data: { url: payload.url }, icon: '/icon-192.png', renotify: payload.kind !== 'finished' });
    // The badge is a courtesy: neither a throw nor a rejection of it may fail the notification.
    try { await sw.registration.setAppBadge?.(payload.badge); } catch { /* ignored */ }
  })());
});

sw.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const raw = e.notification.data?.url;
  const url = typeof raw === 'string' && raw.length <= 300 && PUSH_URL.test(raw) ? raw : '/#/';
  e.waitUntil((async () => {
    const [page] = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!page) return void (await sw.clients.openWindow(url));
    await page.focus?.();
    page.postMessage({ type: 'ledge.open', url });
  })());
});
