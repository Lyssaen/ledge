import { z } from 'zod';

/** A browser's Web Push subscription (what `PushManager.subscribe` returns, serialized): https only, the keys the daemon encrypts with. */
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) })
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;

/** What a notification carries (lot 4): short texts, a badge count, and a link that stays inside the app. */
export const PushPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.enum(['request', 'question', 'finished']),
  title: z.string().max(80),
  body: z.string().max(120),
  url: z.string().startsWith('/m/#/'),
  badge: z.number().int().nonnegative(),
  tag: z.string().max(32)
});
export type PushPayload = z.infer<typeof PushPayloadSchema>;
