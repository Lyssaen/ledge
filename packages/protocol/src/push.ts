import { z } from 'zod';

const B64U = z.string().regex(/^[A-Za-z0-9_-]*$/);

/** The push services a subscription may point at. `*.` matches one or more labels. */
export const PUSH_HOSTS = ['*.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', '*.notify.windows.com'] as const;

/** `https:`, no port, no credentials, on a push service host. The phone, the PC and the relay all apply it. */
export function pushEndpointAllowed(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => {
    if (!h.startsWith('*.')) return host === h;
    const suffix = h.slice(1);
    return host.length > suffix.length && host.endsWith(suffix);
  });
}

/** What the PC asks the relay to forward: an already encrypted `aes128gcm` body (at most 4 096 bytes). */
export const PushSendSchema = z.object({
  endpoint: z.string().url().max(1_024),
  body: B64U.max(5_462),
  ttl: z.number().int().min(0).max(86_400),
  urgency: z.enum(['normal', 'high']),
  topic: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)
});
export type PushSend = z.infer<typeof PushSendSchema>;

export const PushSendResultSchema = z.object({
  result: z.enum(['sent', 'gone', 'failed']),
  status: z.number().int().optional()
});
export type PushSendResult = z.infer<typeof PushSendResultSchema>;
