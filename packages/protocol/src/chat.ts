import { z } from 'zod';

/** What Ledge consulted while answering: a context file (a session's pane, reply or git summary, the sessions list) or a repository file. */
export const ChatStepSchema = z.object({
  kind: z.enum(['sessions', 'pane', 'reply', 'git', 'repo']),
  id: z.string().optional(), name: z.string().optional(), path: z.string().optional()
});
export type ChatStep = z.infer<typeof ChatStepSchema>;

/** One question to Ledge and its answer; `error` set when it could not answer, both absent while it is still reading. */
export const ChatTurnSchema = z.object({
  qid: z.string().min(1), question: z.string(), askedAt: z.string().datetime(),
  steps: z.array(ChatStepSchema), answer: z.string().optional(), answeredAt: z.string().datetime().optional(), error: z.string().optional()
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;
