import { z } from 'zod';
import { BRAIN_FACT_MAX, BRAIN_SOURCE_MAX, BrainChoiceSchema, NoteNameSchema } from './tasks.js';


/** One note as Réglages › Notes shows it. */
export const NoteInfoSchema = z.object({
  name: z.string(), file: z.string(), title: z.string(), when: z.string().optional(), firstLine: z.string(),
  scope: z.enum(['all', 'chat', 'sessions']), projects: z.array(z.string()),
  modifiedAt: z.string(), checkedAt: z.string().optional(),
  /** Days since it was last checked or changed, past the threshold (spec §3.7). */ oldDays: z.number().int().optional(),
  flag: z.object({ what: z.string(), by: z.string(), at: z.string() }).optional(),
  /** Lines under « ## Ajouts ». */ additions: z.number().int(), truncated: z.boolean()
});
export type NoteInfo = z.infer<typeof NoteInfoSchema>;

/** Local fronts only. `brain.answer`: a proposal's buttons; `brain.list`: the notes; `brain.note`: « Vérifiée aujourd'hui » (`checked`)
 *  or « Effacer le signalement » (`unflag`). Each is answered by `brain.result` (`reason` when refused), `brain.list` and `brain.note`
 *  with the notes as they are after it. */
export const BrainAnswerSchema = z.object({ type: z.literal('brain.answer'), rid: z.string().min(1).max(100), task: z.string().min(1).max(40), choice: BrainChoiceSchema });
export const BrainListSchema = z.object({ type: z.literal('brain.list'), rid: z.string().min(1).max(100) });
export const BrainNoteSchema = z.object({ type: z.literal('brain.note'), rid: z.string().min(1).max(100), note: NoteNameSchema, op: z.enum(['checked', 'unflag']) });
/** The chat's `note.add` card, applied: what the user said, appended at once (the card was the user's validation). */
export const BrainAddSchema = z.object({ type: z.literal('brain.add'), rid: z.string().min(1).max(100), note: NoteNameSchema,
  fact: z.string().trim().min(1).max(BRAIN_FACT_MAX), source: z.string().trim().min(1).max(BRAIN_SOURCE_MAX).optional() });
export const BrainResultSchema = z.object({ type: z.literal('brain.result'), rid: z.string(), reason: z.string().optional(),
  /** What came of an answer (the text its proposer is told). */ result: z.string().optional(),
  dir: z.string().optional(), notes: z.array(NoteInfoSchema).optional() });
export type BrainResult = z.infer<typeof BrainResultSchema>;
