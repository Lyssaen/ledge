import { z } from 'zod';

/** Why the daemon refused a front's command. Travels as the `code` of an `error`, which stays a free string so that an older front ignores a new one. */
export const RefusalCodeSchema = z.enum(['stale', 'read_only', 'no_prompt', 'not_taken', 'busy', 'unknown_session', 'nothing_to_decide', 'not_offered', 'free_text', 'note_not_typed', 'unavailable', 'invalid', 'attachment_missing', 'attachments_not_accepted']);
export type RefusalCode = z.infer<typeof RefusalCodeSchema>;
