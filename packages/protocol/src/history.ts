import { z } from 'zod';

/** The longest reply kept from a Stop hook (the hook caps there, then appends TRUNCATION_MARK). */
export const REPLY_MAX = 24_000;
/** Appended by the hook to a capped reply; `TurnSchema.text` leaves room for it (16 >= its 5 characters). */
export const REPLY_TRUNCATION_MARK = '\n\n[…]';

/**
 * One entry of a session's thread as a phone reads it: what was said, decided or interrupted, oldest first. The daemon
 * maps it from the shared thread (thread.ts): `id` is the thread item's, `at` its time, which `session.read` echoes.
 */
export const TurnSchema = z.object({
  id: z.string().min(1),
  at: z.string().datetime(),
  kind: z.enum(['prompt', 'reply', 'decision', 'answer', 'resolved', 'interrupt']),
  text: z.string().max(REPLY_MAX + 16).optional(),
  decision: z.enum(['accept', 'deny']).optional(),
  source: z.enum(['pc', 'phone']).optional(),
  pendingId: z.string().optional()
});
export type Turn = z.infer<typeof TurnSchema>;
