import { z } from 'zod';

/** Native session tracking (spec 2026-10-13 §3): what a session's thread is made of. */
export const ToolStatusSchema = z.enum(['running', 'success', 'failed', 'unknown']);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

/** A file an action touched, read from the action's input; confirmed only once the action succeeded. */
/** `from`: the path before, for a renamed file (Codex `*** Move to:`). */
export const FileChangeSchema = z.object({ path: z.string().min(1), from: z.string().min(1).optional(), change: z.enum(['add', 'edit', 'delete', 'write']), diff: z.string().optional() });
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
  z.object({ kind: z.literal('helper'), ...base, task: z.string(), agentType: z.string().optional(), state: z.enum(['working', 'exited']) }),
  /** A message this session sent to another agent; `id` is the tool_use_id, `to` the address it used, `peer` the Ledge session id, `received` the paired item's id in the peer's thread. */
  z.object({ kind: z.literal('sent'), ...base, to: z.string(), peer: z.string().optional(), summary: z.string().optional(), text: z.string(), status: z.enum(['sending', 'delivered', 'read', 'failed']), received: z.string().optional() }),
  /** A message another agent sent to this session; `from` is its from-name (else its address), `sent` the paired item's id in the peer's thread. */
  z.object({ kind: z.literal('received'), ...base, from: z.string(), peer: z.string().optional(), text: z.string(), sent: z.string().optional() }),
  /** An automated notice of the agent's harness about messages between sessions (Claude Code's `[Cross-session idle
   *  notice]` / `[Cross-session delivery notice]`): a system event, never the user's words. `name` is the session it is
   *  about as quoted, `peer` its Ledge session id; a delivery notice says the outcome of `count` messages to `recipients`. */
  z.object({
    kind: z.literal('notice'), ...base, notice: z.enum(['idle', 'exited', 'unavailable', 'expired', 'delivery', 'other']),
    name: z.string().optional(), peer: z.string().optional(), time: z.string().optional(), summary: z.string().optional(),
    status: z.enum(['held', 'denied', 'expired', 'delivered', 'refused', 'dropped', 'unknown']).optional(),
    count: z.number().int().positive().optional(), recipients: z.array(z.string()).optional(), reason: z.string().optional(), text: z.string()
  })
]);
export type ThreadItem = z.infer<typeof ThreadItemSchema>;
export type ToolItem = Extract<ThreadItem, { kind: 'tool' }>;
export type HelperItem = Extract<ThreadItem, { kind: 'helper' }>;
export type SentItem = Extract<ThreadItem, { kind: 'sent' }>;
export type ReceivedItem = Extract<ThreadItem, { kind: 'received' }>;
export type NoticeItem = Extract<ThreadItem, { kind: 'notice' }>;
