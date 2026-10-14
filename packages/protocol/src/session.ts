import { z } from 'zod';
import { RiskSchema, RiskReasonSchema } from './operations.js';

export const ToolSchema = z.enum(['claude', 'codex', 'cursor']);
export type Tool = z.infer<typeof ToolSchema>;

export const SessionStateSchema = z.enum(['starting', 'working', 'waiting_input', 'waiting_permission', 'idle', 'exited', 'error']);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const PendingSchema = z.object({
  /** Identity of the request, so a phone can answer exactly this one (absent from journals written before). */
  id: z.string().optional(),
  version: z.number().int().positive().optional(),
  since: z.string().datetime().optional(),
  /** Why the request was refused or closed, when it was. */
  reason: z.string().max(500).optional(),
  kind: z.enum(['question', 'permission', 'plan', 'diff']),
  text: z.string(),
  tool: z.string().optional(),
  options: z.array(z.string()).optional(),
  /** How dangerous accepting it blindly would be, and why (absent from journals written before). */
  risk: RiskSchema.optional(),
  riskReason: RiskReasonSchema.optional(),
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
  at: z.string().datetime()
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
  pendingSeq: z.number().int().nonnegative().optional(),
  helpers: z.array(HelperSchema).default([]),
  lastReply: ReplySchema.optional(),
  startedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  lastHookAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable().optional(),
  exitedAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  source: z.enum(['launcher', 'hook_only']),
  /** The thread holds replies the phone has not read yet (`session.read` clears it). */
  unread: z.boolean().optional()
});
export type Session = z.infer<typeof SessionSchema>;
