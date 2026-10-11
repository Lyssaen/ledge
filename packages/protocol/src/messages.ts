import { z } from 'zod';
import { SessionSchema, ToolSchema } from './session.js';
import { ChatStepSchema, ChatTurnSchema } from './chat.js';

export const PROTOCOL_PORT = 47831;

export const SessionEventSchema = z.object({
  name: z.enum(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd', 'PaneChanged', 'PaneGone', 'PanePrompt', 'PaneIdle', 'InjectFailed', 'Decided', 'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PaneTitle', 'Renamed']),
  at: z.string().datetime(),
  source: z.enum(['hook', 'pane', 'daemon']),
  tool: z.string().optional(),
  text: z.string().optional(),
  options: z.array(z.string()).optional(),
  kind: z.enum(['question', 'permission', 'plan', 'diff']).optional(),
  exitCode: z.number().int().nullable().optional(),
  helperId: z.string().optional(),
  /** PostToolUseFailure: the user interrupted the turn (Esc); Claude then waits for input with no Stop. */
  interrupt: z.boolean().optional()
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

/** A folder a session ran in, for the launch form; `lastAt` is its latest session's start. */
export const RecentSchema = z.object({ cwd: z.string().min(1), project: z.string().min(1), lastAt: z.string().datetime() });
export type Recent = z.infer<typeof RecentSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  /** `recents`: the folders of past sessions, most recent first. `launcher`: the command that runs `ledge` inside WSL
   *  (`[node, cli]`), so the overlay can attach a terminal to a session with `<launcher> attach <id>`. */
  z.object({ type: z.literal('snapshot'), sessions: z.array(SessionSchema), recents: z.array(RecentSchema).optional(), launcher: z.array(z.string()).optional() }),
  z.object({ type: z.literal('session.updated'), session: SessionSchema }),
  z.object({ type: z.literal('session.removed'), id: z.string() }),
  z.object({ type: z.literal('session.preview'), id: z.string(), lines: z.array(z.string()) }),
  /** Answer to the requester of a `session.launch`: the session exists (its `session.updated` is broadcast as usual). */
  z.object({ type: z.literal('session.launched'), id: z.string() }),
  z.object({ type: z.literal('recents'), recents: z.array(RecentSchema) }),
  /** Answer to the requester of a `folder.list` or `folder.create`: `path` resolved (`~` expanded), `parent` null at the
   *  root, `entries` its subfolders by name (hidden ones left out). A failure keeps the asked path and says why in `error`,
   *  never in an `error` message, which the launch form reads as a failed launch. */
  z.object({ type: z.literal('folder.listing'), path: z.string(), parent: z.string().nullable(), entries: z.array(z.string()), error: z.string().optional() }),
  /** The chat (spec 2026-10-11 §5): what Ledge reads, its words as they come, the final text, or why it stopped; the day's turns after each snapshot. */
  z.object({ type: z.literal('chat.step'), qid: z.string(), step: ChatStepSchema }),
  z.object({ type: z.literal('chat.delta'), qid: z.string(), text: z.string() }),
  z.object({ type: z.literal('chat.done'), qid: z.string(), text: z.string(), at: z.string().datetime() }),
  z.object({ type: z.literal('chat.error'), qid: z.string(), message: z.string() }),
  z.object({ type: z.literal('chat.history'), turns: z.array(ChatTurnSchema) }),
  z.object({ type: z.literal('error'), message: z.string(), id: z.string().optional() })
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  /** The overlay starts a session: `cwd` is a WSL path (`~` allowed), `name` a preferred bot name (the daemon picks a
   *  free one otherwise), `prompt` the agent's first instruction, `continue` resumes the folder's last conversation. */
  z.object({ type: z.literal('session.launch'), tool: ToolSchema, cwd: z.string().min(1), name: z.string().optional(), prompt: z.string().optional(), continue: z.boolean().optional() }),
  /** The launch form's folder browser: list a folder's subfolders (home when no `path`), or make `name` inside `parent`
   *  and list it. Both are answered with a `folder.listing`. */
  z.object({ type: z.literal('folder.list'), path: z.string().optional() }),
  z.object({ type: z.literal('folder.create'), parent: z.string().min(1), name: z.string().min(1) }),
  z.object({ type: z.literal('session.reply'), id: z.string(), text: z.string().min(1) }),
  z.object({ type: z.literal('session.decide'), id: z.string(), decision: z.enum(['accept', 'deny']) }),
  z.object({ type: z.literal('session.focus'), id: z.string() }),
  z.object({ type: z.literal('session.kill'), id: z.string() }),
  z.object({ type: z.literal('session.interrupt'), id: z.string() }),
  /** Removes a finished (exited) or read-only (hook_only) session from the list; refused for a live launcher session. */
  z.object({ type: z.literal('session.dismiss'), id: z.string() }),
  /** The user names the session's topic from the overlay (500 characters at most, the hook's prompt cap); an empty topic hands back to the automatic sources. */
  z.object({ type: z.literal('session.rename'), id: z.string(), topic: z.string().max(500) }),
  z.object({ type: z.literal('session.register'), session: SessionSchema }),
  /** `agent` and `cwd` describe the session when the daemon does not know it yet (a hook from an agent started without ledge). */
  z.object({ type: z.literal('session.event'), id: z.string(), event: SessionEventSchema, agent: ToolSchema.optional(), cwd: z.string().optional() }),
  z.object({ type: z.literal('session.unregister'), id: z.string(), exitCode: z.number().int().nullable() }),
  z.object({ type: z.literal('snapshot.request') }),
  z.object({ type: z.literal('chat.ask'), qid: z.string().min(1), text: z.string().min(1) }),
  z.object({ type: z.literal('chat.cancel'), qid: z.string().min(1) }),
  /** Starts a new conversation with Ledge: the day's turns are cleared and the next question opens a new Claude session. */
  z.object({ type: z.literal('chat.reset') })
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw);
}
export function parseServerMessage(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw);
}
