import { z } from 'zod';

/** The longest reply kept from a Stop hook (the hook caps there, then appends TRUNCATION_MARK). */
export const REPLY_MAX = 24_000;
/** Appended by the hook to a capped reply; `TurnSchema.text` leaves room for it (16 >= its 5 characters). */
export const REPLY_TRUNCATION_MARK = '\n\n[…]';

/** One entry of a session's thread: what was said, decided or interrupted, in order (`seq` grows from 1). */
export const TurnSchema = z.object({
  seq: z.number().int().positive(),
  at: z.string().datetime(),
  kind: z.enum(['prompt', 'reply', 'decision', 'answer', 'resolved', 'interrupt']),
  text: z.string().max(REPLY_MAX + 16).optional(),
  decision: z.enum(['accept', 'deny']).optional(),
  source: z.enum(['pc', 'phone']).optional(),
  pendingId: z.string().optional()
});
export type Turn = z.infer<typeof TurnSchema>;
