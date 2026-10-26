import { z } from 'zod';
import { AutonomySchema, ToolSchema } from './session.js';
import { ActionIdSchema, ActionRiskSchema } from './actions.js';

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

/** The most sessions one answer may propose (#24): beyond, a burst nobody asked for. */
export const MAX_PROPOSALS = 8;
/** Every session an answer proposes, in order (#24); a turn's `proposal` stays the first one for older clients. */
export const ChatProposalsSchema = z.array(ChatProposalSchema).min(1).max(MAX_PROPOSALS);

/** An instruction the chat proposes to send to a tracked session (spec 2026-10-12 relay §5): the session as the store named it,
 *  `status` once the card sent it or queued it, `error` when the last attempt failed. */
export const ChatRelaySchema = z.object({
  id: z.string().min(1), name: z.string(), tool: ToolSchema, text: z.string().min(1),
  status: z.enum(['queued', 'sent']).optional(), sentAt: z.string().datetime().optional(), error: z.string().optional()
});
export type ChatRelay = z.infer<typeof ChatRelaySchema>;

/** How a session ended when the card closed it: its agent exited on its own, or was killed. */
export type CloseHow = 'exit' | 'killed';
/** A session the chat proposes to close: the session as the store named it, `closedAt` and `how` once the card closed it, `error` when the last attempt failed. */
export const ChatCloseSchema = z.object({
  id: z.string().min(1), name: z.string(), tool: ToolSchema,
  closedAt: z.string().datetime().optional(), how: z.enum(['exit', 'killed']).optional(), error: z.string().optional()
});
export type ChatClose = z.infer<typeof ChatCloseSchema>;
/** Every session an answer proposes to close, in order. */
export const ChatClosesSchema = z.array(ChatCloseSchema).min(1).max(MAX_PROPOSALS);

/** A project the chat proposes (lot 11, task 5): its repositories are paths the daemon found on its machine, each with the LLM's reason;
 *  `addTo` names an existing project to complete. Nothing is created until the editor's button. */
export const ChatProjectProposalSchema = z.object({
  name: z.string().min(1).max(80), description: z.string().max(500).optional(),
  repos: z.array(z.object({ path: z.string().min(1).max(4096), why: z.string().min(1).max(200) })).min(1).max(50),
  addTo: z.string().min(1).max(80).optional()
});
export type ChatProjectProposal = z.infer<typeof ChatProjectProposalSchema>;

/** A team the chat proposes to start (roles spec §3.8): the folder as the daemon resolved it, the project it falls in, and
 *  every seat with what it will be launched with, so the card shows the autonomy of each before the click. `teamId` and
 *  `launchedAt` once launched, `error` when the last launch failed, `savedPath` once written as a template. */
export const ChatTeamSeatSchema = z.object({
  role: z.string().min(1), label: z.string(), tool: ToolSchema, model: z.string().optional(), effort: z.string().optional(),
  autonomy: AutonomySchema.optional(), name: z.string().optional()
});
export type ChatTeamSeat = z.infer<typeof ChatTeamSeatSchema>;
export const ChatTeamProposalSchema = z.object({
  cwd: z.string().min(1), project: z.string(), projectName: z.string().optional(), name: z.string().min(1), template: z.string().optional(),
  seats: z.array(ChatTeamSeatSchema).min(1).max(8),
  teamId: z.string().optional(), launchedAt: z.string().datetime().optional(), error: z.string().optional(), savedPath: z.string().optional()
});
export type ChatTeamProposal = z.infer<typeof ChatTeamProposalSchema>;

/** A task the chat proposes to give (roles spec §3.8): to a session (its id and name) or to `@role` of a team, which may be
 *  the team proposed in the same answer (resolved once it is launched). Once given it follows its task: `taskId`, `owner`,
 *  `state` as the daemon tells it. */
export const ChatTaskProposalSchema = z.object({
  to: z.string().min(1), toName: z.string().optional(), team: z.string().optional(), title: z.string().min(1).max(200), text: z.string().max(20000).optional(),
  taskId: z.string().optional(), ownerName: z.string().optional(), state: z.enum(['open', 'taken', 'done', 'refused', 'dropped']).optional(),
  givenAt: z.string().datetime().optional(), error: z.string().optional()
});
export type ChatTaskProposal = z.infer<typeof ChatTaskProposalSchema>;
export const ChatTasksSchema = z.array(ChatTaskProposalSchema).min(1).max(MAX_PROPOSALS);

/** A row of the chat's generic card (action registry spec §5.1): an action the daemon resolved, ready to apply. `args` are
 *  resolved (ids, never names), what the daemon applies; `summary` the daemon's one line in French; `detail` what to read in
 *  full before confirming (a pending request, verbatim); `session` / `team` the target, for a link. No `state`: proposed. */
export const ChatActionSchema = z.object({
  action: ActionIdSchema, args: z.record(z.unknown()), summary: z.string().min(1).max(300), detail: z.string().max(4000).optional(),
  risk: ActionRiskSchema, session: z.string().optional(), team: z.string().optional(),
  state: z.enum(['running', 'done', 'failed']).optional(), doneAt: z.string().datetime().optional(), error: z.string().optional()
});
export type ChatAction = z.infer<typeof ChatActionSchema>;
/** Every generic row an answer proposes, in the order Ledge wrote them: one plan (spec §9.2). */
export const ChatActionsSchema = z.array(ChatActionSchema).min(1).max(MAX_PROPOSALS);

/** One question to Ledge and its answer; `error` set when it could not answer, both absent while it is still reading. */
export const ChatTurnSchema = z.object({
  machineId: z.string().optional(), machineName: z.string().optional(), choices: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  qid: z.string().min(1), question: z.string(), askedAt: z.string().datetime(),
  steps: z.array(ChatStepSchema), answer: z.string().optional(), answeredAt: z.string().datetime().optional(), error: z.string().optional(), proposal: ChatProposalSchema.optional(), proposals: ChatProposalsSchema.optional(), relay: ChatRelaySchema.optional(), closes: ChatClosesSchema.optional(),
  projectProposal: ChatProjectProposalSchema.optional(),
  team: ChatTeamProposalSchema.optional(), tasks: ChatTasksSchema.optional(), actions: ChatActionsSchema.optional()
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** A turn's session card rows (#24): `proposals`, or the lone `proposal` of a turn from a daemon before #24. */
export const proposalRows = (t: Pick<ChatTurn, 'proposal' | 'proposals'> | undefined): ChatProposal[] => t?.proposals ?? (t?.proposal ? [t.proposal] : []);
