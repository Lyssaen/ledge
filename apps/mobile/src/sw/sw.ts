// The pinned service worker: it serves the build it was installed with, each file checked against the hash this
// script carries, and gives way to a newer build only when the user accepts it. Built on its own by vite.sw.config.ts,
// which writes the manifest and the version in; it never loads @ledge/seal.
import { fingerprintOf, hexOf, type FileHash } from './fingerprint';
import type { BuildInfo } from './types';

/** The app's files and their hashes, without sw.js (vite.sw.config.ts). */
declare const __MANIFEST__: FileHash[];
/** The version of packages/ledge (vite.sw.config.ts). */
declare const __VERSION__: string;

// The parts of the worker scope used here: the DOM lib this app compiles against has no worker types.
type Extendable = { waitUntil(p: Promise<unknown>): void };
type FetchEvent = Extendable & { request: Request; respondWith(r: Promise<Response>): void };
type MessageEvent = Extendable & { data: unknown; ports: readonly { postMessage(m: unknown): void }[] };
interface WorkerScope {
  location: { origin: string };
  registration: { active: object | null };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', fn: (e: Extendable) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

const sw = self as unknown as WorkerScope;
const MANIFEST = __MANIFEST__;
const VERSION = __VERSION__;
const SELF = '/sw.js';
const PREFIX = 'ledge-';
/** The relay's own routes: always the network, never the cache. */
const NETWORK = /^\/(auth(\/.*)?|ws|healthz)$/;

const sha256 = async (bytes: ArrayBuffer): Promise<string> => hexOf(await crypto.subtle.digest('SHA-256', bytes));

// One cache per build: a worker waiting for consent fills its own, never the one the page runs on.
let cacheName: Promise<string> | undefined;
const ownName = () => (cacheName ??= fingerprintOf(MANIFEST).then((fp) => `${PREFIX}${VERSION}-${fp.slice(0, 16)}`));
const ownCache = async () => caches.open(await ownName());

/** A file as the server serves it now, refused unless it hashes to `want` (when given). */
async function fetchChecked(path: string, want?: string): Promise<Response> {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  if (want !== undefined && (await sha256(await res.clone().arrayBuffer())) !== want) throw new Error(`${path}: not the file of this build`);
  return res;
}

async function install(): Promise<void> {
  const cache = await ownCache();
  try {
    const files = await Promise.all([...MANIFEST.map((f) => fetchChecked(f.path, f.sha256).then((res) => [f.path, res] as const)), fetchChecked(SELF).then((res) => [SELF, res] as const)]);
    for (const [path, res] of files) await cache.put(path, res);
  } catch (e) {
    await caches.delete(await ownName());
    throw e;
  }
  // The first installation has no build to keep: it serves at once. Any later one waits for { type: 'accept' }.
  if (!sw.registration.active) await sw.skipWaiting();
}

async function activate(): Promise<void> {
  const keep = await ownName();
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== keep) await caches.delete(name);
  await sw.clients.claim();
}

/** A navigation is the app's page; any other file is the cached one, or the network when this build has none. */
async function answer(request: Request, path: string): Promise<Response> {
  return (await (await ownCache()).match(path)) ?? fetch(request);
}

/** The build this worker holds: its fingerprint computed again over the files it verified and cached. */
async function build(): Promise<BuildInfo | null> {
  const cache = await ownCache();
  const files: FileHash[] = [];
  for (const path of [...MANIFEST.map((f) => f.path), SELF]) {
    const hit = await cache.match(path);
    if (!hit) return null;
    files.push({ path, sha256: await sha256(await hit.arrayBuffer()) });
  }
  return { version: VERSION, fingerprint: await fingerprintOf(files) };
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
  if (type === 'accept') e.waitUntil(sw.skipWaiting());
  if (type === 'build') e.waitUntil(build().then((b) => e.ports[0]?.postMessage(b)));
});
