import { z } from 'zod';

export const ASK_QUESTION_MAX = 2000;
export const ASK_OPTIONS_MAX = 4000;
export const ASK_ANSWER_MAX = 4000;

export const AskIdSchema = z.string().regex(/^a[0-9a-f]{6}$/);
/** A decision a lone session asks the user (`ledge ask`). Lot 2 maps it into `Escalation`:
 *  id `ask-<id>`, source 'ask', from = fromName, intent 'decision', summary = question, detail = options,
 *  questions = [], state open→pending | answered→answered | dropped→closed, answer → { by: 'user', answers: { text } }. */
export const AskSchema = z.object({
  id: AskIdSchema, from: z.string().min(1), fromName: z.string(),
  question: z.string().min(1).max(ASK_QUESTION_MAX), options: z.string().max(ASK_OPTIONS_MAX), at: z.string().datetime(),
  state: z.enum(['open', 'answered', 'dropped']),
  answer: z.object({ text: z.string().min(1).max(ASK_ANSWER_MAX), at: z.string().datetime() }).optional(),
  closedAt: z.string().datetime().optional()
});
export type Ask = z.infer<typeof AskSchema>;
export const AskRefusalSchema = z.enum(['unknown', 'closed', 'dropped', 'not_session', 'invalid']);
export type AskRefusal = z.infer<typeof AskRefusalSchema>;

// client
export const AskCreateSchema = z.object({ type: z.literal('ask.create'), rid: z.string().min(1).max(100), by: z.string().min(1),
  question: z.string().trim().min(1).max(ASK_QUESTION_MAX), options: AskSchema.shape.options });
export const AskAnswerSchema = z.object({ type: z.literal('ask.answer'), rid: z.string().min(1).max(100), id: AskIdSchema,
  text: z.string().trim().min(1).max(ASK_ANSWER_MAX), machineId: z.string().optional() });
// server
export const AsksMessageSchema = z.object({ type: z.literal('asks'), asks: z.array(AskSchema) });
export const AskUpdatedSchema = z.object({ type: z.literal('ask.updated'), ask: AskSchema });
export const AskResultSchema = z.object({ type: z.literal('ask.result'), rid: z.string(), ask: AskSchema.optional(),
  code: AskRefusalSchema.optional(), reason: z.string().optional() });

/** What « À toi » shows: the decisions still waiting. */
export const askShown = (a: Pick<Ask, 'state'>): boolean => a.state === 'open';
