import { z } from 'zod';

/** Native session tracking (spec 2026-10-13 §3): what a session's thread is made of. */
export const ToolStatusSchema = z.enum(['running', 'success', 'failed', 'unknown']);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

/** A file an action touched, read from the action's input; confirmed only once the action succeeded. */
export const FileChangeSchema = z.object({ path: z.string().min(1), change: z.enum(['add', 'edit', 'delete', 'write']), diff: z.string().optional() });
export type FileChange = z.infer<typeof FileChangeSchema>;

/** `turn` counts the prompts so far (0 before the first); `helperId` marks an item of a subagent's own thread. */
const base = { id: z.string().min(1), at: z.string().datetime(), turn: z.number().int().nonnegative(), helperId: z.string().optional() };
export const ThreadItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), ...base, text: z.string() }),
  z.object({ kind: z.literal('message'), ...base, text: z.string() }),
  /** `id` is the harness's tool_use_id when it gives one, so the result updates the same row. */
  z.object({ kind: z.literal('tool'), ...base, tool: z.string(), label: z.string(), input: z.string().optional(), output: z.string().optional(), error: z.string().optional(), status: ToolStatusSchema, durationMs: z.number().nonnegative().optional(), files: z.array(FileChangeSchema).default([]) }),
  /** `unknown`: answered in the terminal, the daemon only saw the prompt go away; `always`: allowed and not asked again. */
  z.object({ kind: z.literal('permission'), ...base, tool: z.string(), text: z.string(), decision: z.enum(['accept', 'deny', 'always', 'unknown']).optional() }),
  z.object({ kind: z.literal('reply'), ...base, text: z.string() }),
  z.object({ kind: z.literal('helper'), ...base, task: z.string(), agentType: z.string().optional(), state: z.enum(['working', 'exited']) })
]);
export type ThreadItem = z.infer<typeof ThreadItemSchema>;
export type ToolItem = Extract<ThreadItem, { kind: 'tool' }>;
export type HelperItem = Extract<ThreadItem, { kind: 'helper' }>;
