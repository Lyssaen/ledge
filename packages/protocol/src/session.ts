import { z } from 'zod';

export const ToolSchema = z.enum(['claude', 'codex', 'cursor']);
export type Tool = z.infer<typeof ToolSchema>;

export const SessionStateSchema = z.enum(['starting', 'working', 'waiting_input', 'waiting_permission', 'idle', 'exited', 'error']);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const PendingSchema = z.object({
  kind: z.enum(['question', 'permission', 'plan', 'diff']),
  text: z.string(),
  tool: z.string().optional(),
  options: z.array(z.string()).optional(),
  source: z.enum(['hook', 'pane']),
  /** Set when the request comes from a helper (subagent): it is routed through its parent. */
  helperId: z.string().optional(),
  /** For a helper-routed request: the state the parent returns to once it is answered (main thread may stop meanwhile). */
  parentState: SessionStateSchema.optional()
});
export type Pending = z.infer<typeof PendingSchema>;

export const HelperSchema = z.object({
  id: z.string(),
  kind: z.string(),
  task: z.string(),
  state: SessionStateSchema
});
export type Helper = z.infer<typeof HelperSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tool: ToolSchema,
  cwd: z.string(),
  project: z.string(),
  title: z.string(),
  tmuxSession: z.string().nullable(),
  state: SessionStateSchema,
  pending: PendingSchema.optional(),
  helpers: z.array(HelperSchema).default([]),
  startedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  lastHookAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable().optional(),
  exitedAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  source: z.enum(['launcher', 'hook_only'])
});
export type Session = z.infer<typeof SessionSchema>;
