import { z } from 'zod';
import { ContextSchema, HandoverSchema, RelievesSchema } from './handover.js';

export const ToolSchema = z.enum(['claude', 'codex', 'cursor', 'omp']);
/** OMP's `--approval-mode` as Ledge offers it: ask before writes and executions, approve file writes by themselves, or approve everything (auto). */
export const OmpApprovalSchema = z.enum(['always-ask', 'write', 'yolo']);
export type OmpApproval = z.infer<typeof OmpApprovalSchema>;
export type Tool = z.infer<typeof ToolSchema>;
/** How far a session may go without asking: each agent's own permission switch at launch,
 *  never Ledge answering in its place. `ask` adds nothing. */
export const AutonomySchema = z.enum(['ask', 'edits', 'auto']);
export type Autonomy = z.infer<typeof AutonomySchema>;

/**
 * Each agent's own permission switch for an autonomy (spec §3.1), added at launch and kept by a resume. Ledge never
 * answers a prompt in the agent's place: what the agent still asks lands in « À toi ».
 */
export function autonomyArgs(tool: Tool, autonomy: Autonomy | undefined): string[] {
  if (!autonomy || autonomy === 'ask') return [];
  switch (tool) {
    case 'claude': return ['--permission-mode', autonomy === 'edits' ? 'acceptEdits' : 'auto'];
    case 'codex': return autonomy === 'edits' ? ['--ask-for-approval', 'on-request'] : ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'];
    case 'cursor': return autonomy === 'auto' ? ['--force'] : [];
    case 'omp': return [];
  }
}

/** OMP's approval mode for an autonomy: it has no switch of its own beyond these. */
export function ompApprovalFor(autonomy: Autonomy | undefined): OmpApproval | undefined {
  return autonomy === 'auto' ? 'yolo' : autonomy ? 'always-ask' : undefined;
}

/** How Ledge drives a session's agent: through a tmux pane (Claude Code, Codex, Cursor Agent), or through the agent's own
 *  JSONL protocol with the daemon owning the process (OMP, spec 2026-10-20 §4). A session without it is a tmux one. */
export const BackendSchema = z.enum(['tmux', 'omp-rpc']);
export type Backend = z.infer<typeof BackendSchema>;

export const SessionStateSchema = z.enum(['starting', 'working', 'waiting_input', 'waiting_permission', 'idle', 'exited', 'error']);
export type SessionState = z.infer<typeof SessionStateSchema>;

/** One question of OMP's `ask` tool: its choices (each may say more), whether several can be picked; a free answer is always possible. */
export const AskQuestionSchema = z.object({
  id: z.string(), question: z.string(), header: z.string().optional(), multi: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() }))
});
export type AskQuestion = z.infer<typeof AskQuestionSchema>;

export const PendingSchema = z.object({
  kind: z.enum(['question', 'permission', 'plan', 'diff']),
  text: z.string(),
  /** What to review in full before deciding, when `text` is only its summary: a plan's markdown. */
  body: z.string().optional(),
  tool: z.string().optional(),
  options: z.array(z.string()).optional(),
  /** Each option's description, by index ('' when it has none); left out when no option has one. */
  optionDetails: z.array(z.string()).optional(),
  /** `rpc`: the harness's own protocol asked (OMP): answered on its request id, never by typing. */
  source: z.enum(['hook', 'pane', 'rpc']),
  /** OMP: every question of one `ask` call, answered together with `session.answer`; `requestId` is the dialog it answers. */
  questions: z.array(AskQuestionSchema).optional(), requestId: z.string().optional(),
  /** Set when the request comes from a helper (subagent): it is routed through its parent. */
  helperId: z.string().optional(),
  /** For a helper-routed request: the state the parent returns to once it is answered (main thread may stop meanwhile). */
  parentState: SessionStateSchema.optional()
});
export type Pending = z.infer<typeof PendingSchema>;

/** The agent's last message of a finished turn, as the tool reported it (markdown), until the next prompt is sent. */
export const ReplySchema = z.object({
  text: z.string(),
  at: z.string().datetime(),
  /** The reply is a plan the agent proposes (Codex Plan mode): nothing in it is done yet. */
  plan: z.boolean().optional()
});
export type Reply = z.infer<typeof ReplySchema>;

export const HelperSchema = z.object({
  id: z.string(),
  kind: z.string(),
  task: z.string(),
  state: SessionStateSchema,
  /** When this helper finished; retained across daemon restarts until its five-minute expiry. */
  finishedAt: z.string().datetime().optional()
});
export type Helper = z.infer<typeof HelperSchema>;

/** Where a session's topic came from: the user's own words win over the pane's conversation title, which wins over the first prompt. */
export const TopicSourceSchema = z.enum(['user', 'pane', 'prompt']);
export type TopicSource = z.infer<typeof TopicSourceSchema>;

/** What a live session knows of its OpenRig seat (paired through `session.event.openrig`). Lives here, not in openrig.ts, to avoid an import cycle through chat.ts. */
export const SessionRigSchema = z.object({ machine: z.string(), rigId: z.string(), rigName: z.string(), seat: z.string(), pod: z.string(), member: z.string() });
export type SessionRig = z.infer<typeof SessionRigSchema>;

export const SessionSchema =z.object({
  /** Origin is annotated by the overlay, never used as an unqualified session id on the wire. */
  machineId: z.string().optional(), machineName: z.string().optional(), repoId: z.string().optional(),
  /** Annotated by the fleet when its machine is unreachable and the last snapshot is kept (keepStale, spec 2026-10-14 §6). */
  offline: z.boolean().optional(),
  /** The permanent Ledge brain session (Lot 7). */
  brain: z.literal(true).optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  tool: ToolSchema,
  cwd: z.string(),
  project: z.string(),
  title: z.string(),
  /** One line saying what the session is about (spec 2026-10-11 §3). */
  topic: z.string().optional(),
  topicSource: TopicSourceSchema.optional(),
  /** The repository (its main worktree's folder name and absolute path), the checked-out branch, and whether `cwd` is a linked worktree (§4). */
  repo: z.string().optional(),
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.boolean().optional(),
  /** The folder the agent works in now, as its last hook reported it: `cwd` stays where it started, this follows a worktree it entered. */
  workdir: z.string().optional(),
  tmuxSession: z.string().nullable(),
  /** Left out for a tmux session. `omp-rpc`: no pane, nothing to attach to; the daemon holds the process (see `agentSessionFile`). */
  backend: BackendSchema.optional(),
  state: SessionStateSchema,
  pending: PendingSchema.optional(),
  helpers: z.array(HelperSchema).default([]),
  /** OMP: the instructions waiting in its own queue (typed while it works), as it reports them; left out when none. */
  queue: z.array(z.object({ text: z.string(), mode: z.enum(['steer', 'follow_up']) })).optional(),
  lastReply: ReplySchema.optional(),
  /** The last message this session sent to another agent: its tool_use_id, the address, the peer's Ledge session id, a one-line summary. */
  lastMessage: z.object({ id: z.string(), to: z.string(), peer: z.string().optional(), summary: z.string(), at: z.string().datetime() }).optional(),
  startedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  lastHookAt: z.string().datetime().optional(),
  /** The model and effort Ledge launched the agent with (#58); left out, the agent's own default. */
  model: z.string().optional(),
  effort: z.string().optional(),
  /** OMP: the approval mode it was launched with, kept by a resume; left out, `always-ask`. */
  approval: OmpApprovalSchema.optional(),
  /** Its autonomy, as launched (kept by a resume); left out, `ask`. */
  autonomy: AutonomySchema.optional(),
  /** Its context as its agent last reported it, after a turn (context handover spec §3.1); left out, not measured. */
  context: ContextSchema.optional(),
  /** Its relief by a fresh session (§3.3): asked, launched, done or failed. */
  handover: HandoverSchema.optional(),
  /** The session it relieves, when it is a relief. */
  relieves: RelievesSchema.optional(),
  /** A model change asked while the agent worked (`session.model`), applied at its next free moment; a field left out is the agent's default. */
  modelNext: z.object({ model: z.string().optional(), effort: z.string().optional() }).optional(),
  /** The agent's own session id when Ledge chose it at launch (Claude Code `--session-id`). */
  agentSessionId: z.string().optional(),
  /** OMP: the exact journal file of the conversation, what a resume names (never "the latest of the folder"). */
  agentSessionFile: z.string().optional(),
  /** The agent's transcript: the latest one a hook named (it follows /clear and --resume), else the one the launch implies. */
  transcriptPath: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  exitedAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  source: z.enum(['launcher', 'hook_only']),
  /** When the session was put in the archive (session management): set, it leaves the live list and waits to be restored, resumed or deleted. */
  archivedAt: z.string().datetime().optional(),
  /** When the session was last taken out of the archive: the poller's retirement clock restarts from it, not from `exitedAt`. */
  restoredAt: z.string().datetime().optional(),
  /** The OpenRig seat this session runs in (paired from the hook's `openrig.sessionName`). */
  rig: SessionRigSchema.optional()
});
export type Session = z.infer<typeof SessionSchema>;

/** The transport a session's agent is driven through. */
export function backendOf(s: Pick<Session, 'backend'>): Backend {
  return s.backend ?? 'tmux';
}

/** Whether the session sits in the archive. */
export function isArchived(s: Pick<Session, 'archivedAt'>): boolean {
  return s.archivedAt !== undefined;
}
