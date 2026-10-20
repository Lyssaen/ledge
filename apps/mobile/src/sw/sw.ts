// The pinned service worker: it serves the build the user accepted, each file checked against the hash its worker
// carried, and a newer build takes over only when the user accepts it. Built on its own by vite.sw.config.ts, which
// writes the manifest, the version and the build id in; it never loads @ledge/seal.
//
// The browser alone decides which worker SCRIPT runs: a waiting worker becomes the active one once every page of the
// app is closed, consent or not. What stays pinned is the app's files: whichever worker runs serves the cache the
// marker in `ledge-meta` names, and moves it only on { type: 'accept' }.
import { fingerprintOf, hexOf, type FileHash } from './fingerprint';
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
type MessageEvent = Extendable & { data: unknown; ports: readonly { postMessage(m: unknown): void }[] };
interface WorkerScope {
  location: { origin: string };
  registration: { active: object | null };
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
    matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly { postMessage(m: unknown): void }[]>;
  };
  addEventListener(type: 'install' | 'activate', fn: (e: Extendable) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
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
const NETWORK = /^\/(auth(\/.*)?|ws|healthz)$/;

const sha256 = async (bytes: ArrayBuffer): Promise<string> => hexOf(await crypto.subtle.digest('SHA-256', bytes));

/** The cache of the build the user accepted, as marked; null before any. */
async function marked(): Promise<string | null> {
  const hit = await (await caches.open(META)).match(ACCEPTED);
  return hit ? hit.text() : null;
}

/** The cache of the build the user accepted; this worker's own while none is marked. */
const accepted = async (): Promise<string> => (await marked()) ?? OWN;

async function accept(): Promise<void> {
  await (await caches.open(META)).put(ACCEPTED, new Response(OWN));
  await prune();
}

/** Drops the caches of builds that are neither this worker's nor the accepted one. */
async function prune(): Promise<void> {
  const keep = new Set([META, OWN, await accepted()]);
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
  const cache = await caches.open(OWN);
  try {
    const files = await Promise.all([...MANIFEST.map((f) => fetchChecked(f.path, f.sha256).then((res) => [f.path, res] as const)), fetchChecked(SELF).then((res) => [SELF, res] as const)]);
    for (const [path, res] of files) await cache.put(path, res);
  } catch (e) {
    // Never the accepted build's cache, should this very build be installed again.
    if ((await marked()) !== OWN) await caches.delete(OWN);
    throw e;
  }
  // The first installation has no build to keep: it is the accepted one and serves at once. Any later one waits.
  if (!sw.registration.active) {
    await accept();
    await sw.skipWaiting();
  }
}

async function activate(): Promise<void> {
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
