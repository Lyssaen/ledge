import { z } from 'zod';
import { ToolSchema } from './session.js';

/** What Ledge consulted while answering: a context file (a session's pane, reply or git summary, the sessions list) or a repository file. */
export const ChatStepSchema = z.object({
  kind: z.enum(['sessions', 'pane', 'reply', 'git', 'repo']),
  id: z.string().optional(), name: z.string().optional(), path: z.string().optional()
});
export type ChatStep = z.infer<typeof ChatStepSchema>;

/** A session the chat proposes to start (spec 2026-10-12 §5): the folder as the daemon resolved it, the question's harness;
 *  `launchedId` once the card started it, `error` when the last launch failed. */
export const ChatProposalSchema = z.object({
  cwd: z.string().min(1), project: z.string(), prompt: z.string().optional(), tool: ToolSchema,
  launchedId: z.string().optional(), error: z.string().optional()
});
export type ChatProposal = z.infer<typeof ChatProposalSchema>;

/** One question to Ledge and its answer; `error` set when it could not answer, both absent while it is still reading. */
export const ChatTurnSchema = z.object({
  qid: z.string().min(1), question: z.string(), askedAt: z.string().datetime(),
  steps: z.array(ChatStepSchema), answer: z.string().optional(), answeredAt: z.string().datetime().optional(), error: z.string().optional(), proposal: ChatProposalSchema.optional()
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;
