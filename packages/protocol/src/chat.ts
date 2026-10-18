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

/** An instruction the chat proposes to send to a tracked session (spec 2026-10-12 relay §5): the session as the store named it,
 *  `status` once the card sent it or queued it, `error` when the last attempt failed. */
export const ChatRelaySchema = z.object({
  id: z.string().min(1), name: z.string(), tool: ToolSchema, text: z.string().min(1),
  status: z.enum(['queued', 'sent']).optional(), sentAt: z.string().datetime().optional(), error: z.string().optional()
});
export type ChatRelay = z.infer<typeof ChatRelaySchema>;

/** A project the chat proposes (lot 11, task 5): its repositories are paths the daemon found on its machine, each with the LLM's reason;
 *  `addTo` names an existing project to complete. Nothing is created until the editor's button. */
export const ChatProjectProposalSchema = z.object({
  name: z.string().min(1).max(80), description: z.string().max(500).optional(),
  repos: z.array(z.object({ path: z.string().min(1), why: z.string().min(1).max(200) })).min(1).max(50),
  addTo: z.string().min(1).max(80).optional()
});
export type ChatProjectProposal = z.infer<typeof ChatProjectProposalSchema>;

/** One question to Ledge and its answer; `error` set when it could not answer, both absent while it is still reading. */
export const ChatTurnSchema = z.object({
  machineId: z.string().optional(), machineName: z.string().optional(), choices: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  qid: z.string().min(1), question: z.string(), askedAt: z.string().datetime(),
  steps: z.array(ChatStepSchema), answer: z.string().optional(), answeredAt: z.string().datetime().optional(), error: z.string().optional(), proposal: ChatProposalSchema.optional(), relay: ChatRelaySchema.optional(),
  projectProposal: ChatProjectProposalSchema.optional()
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;
