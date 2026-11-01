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

/** A browser's push subscription as the phone gives it: the endpoint is a push service URL, the keys are the P-256 public key and the auth secret. */
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1_024).refine(pushEndpointAllowed),
  keys: z.object({ p256dh: B64U.length(87), auth: B64U.length(22) })
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;

/** The clear text of a push, before it is sealed: what the service worker shows. `url` stays inside the app. */
export const PushPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.enum(['request', 'question', 'finished', 'chat', 'escalation', 'decided']),
  escalationId: z.string().min(1).max(120).optional(),
  count: z.number().int().min(1).max(999).optional(),
  actions: z.array(z.object({ qId: z.string().min(1).max(64), optId: z.string().min(1).max(64), label: z.string().max(40) }).strict()).max(2).optional(),
  title: z.string().max(80),
  body: z.string().max(120),
  url: z.string().regex(/^\/#\/[A-Za-z0-9/%._~-]*$/).max(300),
  badge: z.number().int().min(0).max(999),
  tag: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)
});
export type PushPayload = z.infer<typeof PushPayloadSchema>;
