import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import webpush from 'web-push';
import { paths } from '../../paths.js';
import { log } from '../../log.js';

/** The daemon's identity towards the push services (VAPID): a key pair made once, and the https origin it speaks for. */
export interface Vapid { publicKey: string; privateKey: string; subject: string }

/** The push services a phone's browser hands out (Apple, Google, Mozilla, Microsoft): the daemon posts to no other host. */
export const PUSH_HOSTS: readonly RegExp[] = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function pushEndpointAllowed(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  return u.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(u.hostname));
}

/** A missing or unreadable file is "no keys yet": `ensureVapid` makes them. */
export async function loadVapid(path: string = paths().vapid): Promise<Vapid | null> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); } catch { return null; }
  try {
    const j = JSON.parse(raw) as Partial<Vapid>;
    if (typeof j.publicKey === 'string' && typeof j.privateKey === 'string' && typeof j.subject === 'string' && j.publicKey && j.privateKey) return { publicKey: j.publicKey, privateKey: j.privateKey, subject: j.subject };
    throw new Error('missing fields');
  } catch (e) {
    log(`vapid file unreadable, keys will be made again: ${(e as Error).message}`);
    return null;
  }
}

async function save(path: string, v: Vapid): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

const pending = new Map<string, Promise<Vapid>>();

/**
 * The keys, made on the first call (0600) and kept for good: new keys would orphan every subscription. Only the subject
 * follows the configured origin. Concurrent calls share one run, so two pairings cannot make two key pairs.
 */
export function ensureVapid(subject: string, path: string = paths().vapid): Promise<Vapid> {
  const running = pending.get(path);
  if (running) return running;
  const run = (async () => {
    const have = await loadVapid(path);
    if (have && have.subject === subject) return have;
    const next: Vapid = have ? { ...have, subject } : { ...webpush.generateVAPIDKeys(), subject };
    await save(path, next);
    if (!have) log('VAPID keys created');
    return next;
  })().finally(() => pending.delete(path));
  pending.set(path, run);
  return run;
}
