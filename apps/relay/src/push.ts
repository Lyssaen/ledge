import { sign, type KeyObject } from 'node:crypto';
import type { PushSend, PushSendResult } from '@ledge/protocol';

/** The relay's VAPID identity. `publicKey` is the uncompressed P-256 point, base64url. */
export interface Vapid {
  publicKey: string;
  privateKey: KeyObject;
  subject: string;
}

export type PushFetch = (url: string, init: RequestInit) => Promise<Response>;

const JWT_LIFETIME_S = 12 * 3600;
const DEFAULT_TIMEOUT_MS = 10_000;

const b64u = (s: string) => Buffer.from(s).toString('base64url');

function vapidHeader(vapid: Vapid, endpoint: string, nowMs: number): string {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_S, sub: vapid.subject }));
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key: vapid.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${signature.toString('base64url')}, k=${vapid.publicKey}`;
}

/**
 * Forwards a body the PC already encrypted (`aes128gcm`); the relay never reads it. 2xx is `sent`, 404 and 410 are
 * `gone` (the PC drops the subscription), anything else, an error or a timeout is `failed`. Redirects are not
 * followed: the endpoint was checked against the push hosts, its redirect target was not.
 */
export async function sendPush(
  fetchFn: PushFetch,
  vapid: Vapid,
  msg: PushSend,
  now: () => number,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<PushSendResult> {
  try {
    const res = await fetchFn(msg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(msg.ttl),
        Urgency: msg.urgency,
        Topic: msg.topic,
        Authorization: vapidHeader(vapid, msg.endpoint, now())
      },
      body: Buffer.from(msg.body, 'base64url'),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
    await res.body?.cancel().catch(() => {});
    if (res.status >= 200 && res.status < 300) return { result: 'sent', status: res.status };
    if (res.status === 404 || res.status === 410) return { result: 'gone', status: res.status };
    return { result: 'failed', status: res.status };
  } catch {
    return { result: 'failed' };
  }
}

/** At most `limit` hits per account in a fixed window of `windowMs`; in memory. */
export function rateLimiter(limit: number, windowMs: number, now: () => number): (account: string) => boolean {
  const windows = new Map<string, { start: number; count: number }>();
  return (account) => {
    const t = now();
    if (windows.size > 1_024) for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
    const w = windows.get(account);
    if (!w || t - w.start >= windowMs) { windows.set(account, { start: t, count: 1 }); return true; }
    if (w.count >= limit) return false;
    w.count++;
    return true;
  };
}
