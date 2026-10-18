import { z } from 'zod';

export const ToolSchema = z.enum(['claude', 'codex', 'cursor']);
export type Tool = z.infer<typeof ToolSchema>;

export const SessionStateSchema = z.enum(['starting', 'working', 'waiting_input', 'waiting_permission', 'idle', 'exited', 'error']);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const PendingSchema = z.object({
  kind: z.enum(['question', 'permission', 'plan', 'diff']),
  text: z.string(),
  /** What to review in full before deciding, when `text` is only its summary: a plan's markdown. */
  body: z.string().optional(),
  tool: z.string().optional(),
  options: z.array(z.string()).optional(),
  /** Each option's description, by index ('' when it has none); left out when no option has one. */
  optionDetails: z.array(z.string()).optional(),
  source: z.enum(['hook', 'pane']),
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
  state: SessionStateSchema
});
export type Helper = z.infer<typeof HelperSchema>;

/** Where a session's topic came from: the user's own words win over the pane's conversation title, which wins over the first prompt. */
export const TopicSourceSchema = z.enum(['user', 'pane', 'prompt']);
export type TopicSource = z.infer<typeof TopicSourceSchema>;

export const SessionSchema =z.object({
  /** Origin is annotated by the overlay, never used as an unqualified session id on the wire. */
  machineId: z.string().optional(), machineName: z.string().optional(), repoId: z.string().optional(),
  /** Annotated by the fleet when its machine is unreachable and the last snapshot is kept (keepStale, spec 2026-10-14 §6). */
  offline: z.boolean().optional(),
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
  tmuxSession: z.string().nullable(),
  state: SessionStateSchema,
  pending: PendingSchema.optional(),
  helpers: z.array(HelperSchema).default([]),
  lastReply: ReplySchema.optional(),
  startedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  lastHookAt: z.string().datetime().optional(),
  /** The agent's own session id when Ledge chose it at launch (Claude Code `--session-id`). */
  agentSessionId: z.string().optional(),
  /** The agent's transcript: the latest one a hook named (it follows /clear and --resume), else the one the launch implies. */
  transcriptPath: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  exitedAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  source: z.enum(['launcher', 'hook_only']),
  /** When the session was put in the archive (session management): set, it leaves the live list and waits to be restored, resumed or deleted. */
  archivedAt: z.string().datetime().optional()
});
export type Session = z.infer<typeof SessionSchema>;

/** Whether the session sits in the archive. */
export function isArchived(s: Pick<Session, 'archivedAt'>): boolean {
  return s.archivedAt !== undefined;
}
