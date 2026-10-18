import { z } from 'zod';
import { PendingSchema, SessionSchema, ToolSchema } from './session.js';
import { ChatStepSchema, ChatTurnSchema, ChatProposalSchema, ChatRelaySchema, ChatProjectProposalSchema } from './chat.js';
import { ReposInspectSchema, ReposInfoSchema } from './repos.js';
import { ReposScanSchema, ReposFoundSchema } from './scan.js';
import { DocumentReadSchema, DocumentContentSchema, DocumentErrorSchema } from './documents.js';
import { RoutingContextSchema, RouteResultSchema } from './routing.js';
import { SshAliasSchema } from './ssh.js';
import { MachinesSchema } from './machines.js';
import { IslandPrefsSchema } from './island.js';
import { ProjectsSchema } from './projects.js';
import { ThreadItemSchema } from './thread.js';
import { DecisionSchema, NOTE_MAX } from './decisions.js';

export const PROTOCOL_PORT = 47831;

export const SessionEventSchema = z.object({
  name: z.enum(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd', 'PaneChanged', 'PaneGone', 'PanePrompt', 'PaneIdle', 'InjectFailed', 'Decided', 'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PaneTitle', 'Renamed']),
  at: z.string().datetime(),
  source: z.enum(['hook', 'pane', 'daemon']),
  tool: z.string().optional(),
  text: z.string().optional(),
  options: z.array(z.string()).optional(),
  /** Each option's description, by index ('' when it has none); left out when no option has one. */
  optionDetails: z.array(z.string()).optional(),
  kind: z.enum(['question', 'permission', 'plan', 'diff']).optional(),
  /** PanePrompt: what to review in full before deciding (a plan read in the terminal), when `text` is its summary. */
  body: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  helperId: z.string().optional(),
  /** The helper's description, once known (Claude Code: its `.meta.json`, written after SubagentStart). */
  task: z.string().optional(),
  /** PostToolUseFailure: the user interrupted the turn (Esc); Claude then waits for input with no Stop. */
  interrupt: z.boolean().optional(),
  /** Native tracking (spec 2026-10-13 §2): the harness's id of the tool call, so its result lands on the same row. */
  toolUseId: z.string().optional(),
  /** The tool's input as the harness gave it, every string capped by the hook. */
  toolInput: z.record(z.string(), z.unknown()).optional(),
  /** PostToolUse: the result as text; SubagentStop: nothing (the report travels in `text`). */
  output: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** PostToolUseFailure: the harness's error message. */
  error: z.string().optional(),
  /** The session's transcript, or the helper's on SubagentStop; the daemon reads its tail for the agent's messages. */
  transcriptPath: z.string().optional(),
  /** Decided: what was chosen when the daemon knows it. */
  decision: DecisionSchema.optional()
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

/** A folder a session ran in, for the launch form; `lastAt` is its latest session's start. */
export const RecentSchema = z.object({ cwd: z.string().min(1), project: z.string().min(1), lastAt: z.string().datetime() });
export type Recent = z.infer<typeof RecentSchema>;

/** A release version as the tag gives it, without the `v` and without a pre-release suffix. */
export const SEMVER = /^\d+\.\d+\.\d+$/;
/** What the daemon knows of itself (spec 2026-10-12 auto-update §6): its version, how it was installed, whether it runs
 *  as the systemd service, and the command a person runs by hand when it cannot update itself. */
export const DaemonInfoSchema = z.object({ version: z.string(), install: z.enum(['npm', 'git', 'unknown']), systemd: z.boolean(), manual: z.string().optional(), routing: z.boolean().optional() });
export type DaemonInfo = z.infer<typeof DaemonInfoSchema>;
export const UpdateFailureSchema = z.enum(['git-install', 'no-systemd', 'sessions-at-risk', 'npm-failed', 'busy']);
export type UpdateFailure = z.infer<typeof UpdateFailureSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.routed'), qid: z.string(), result: RouteResultSchema }),
  DocumentContentSchema,
  DocumentErrorSchema,
  ReposInfoSchema,
  ReposFoundSchema,
  /** `recents`: the folders of past sessions, most recent first. `launcher`: the command that runs `ledge` inside WSL
   *  (`[node, cli]`), so the overlay can attach a terminal to a session with `<launcher> attach <id>`. `daemon`: absent
   *  from daemons older than the auto-update. */
  z.object({ type: z.literal('snapshot'), sessions: z.array(SessionSchema), recents: z.array(RecentSchema).optional(), launcher: z.array(z.string()).optional(), daemon: DaemonInfoSchema.optional(), sshAlias: SshAliasSchema.optional() }),
  z.object({ type: z.literal('session.updated'), session: SessionSchema }),
  z.object({ type: z.literal('session.removed'), id: z.string() }),
  z.object({ type: z.literal('session.preview'), id: z.string(), lines: z.array(z.string()) }),
  /** A session's thread, on request (spec 2026-10-13 §5); then each created or updated item, broadcast. */
  z.object({ type: z.literal('session.thread'), id: z.string(), items: z.array(ThreadItemSchema) }),
  z.object({ type: z.literal('session.thread.item'), id: z.string(), item: ThreadItemSchema }),
  /** Answer to the requester of a `session.launch`: the session exists (its `session.updated` is broadcast as usual). */
  z.object({ type: z.literal('session.launched'), id: z.string() }),
  z.object({ type: z.literal('recents'), recents: z.array(RecentSchema) }),
  /** Answer to the requester of a `folder.list` or `folder.create`: `path` resolved (`~` expanded), `parent` null at the
   *  root, `entries` its subfolders by name (hidden ones left out). A failure keeps the asked path and says why in `error`,
   *  never in an `error` message, which the launch form reads as a failed launch. */
  z.object({ type: z.literal('folder.listing'), path: z.string(), parent: z.string().nullable(), entries: z.array(z.string()), error: z.string().optional(),
    /** The request this answers, when it carried one. */ requestId: z.string().optional(),
    /** Those `entries` that are Git repositories, with their branch (the short commit when HEAD is detached). */ repos: z.array(z.object({ name: z.string(), branch: z.string() })).optional() }),
  /** The chat (spec 2026-10-11 §5): what Ledge reads, its words as they come, the final text, or why it stopped; the day's turns after each snapshot. */
  z.object({ type: z.literal('chat.step'), qid: z.string(), step: ChatStepSchema }),
  z.object({ type: z.literal('chat.delta'), qid: z.string(), text: z.string() }),
  z.object({ type: z.literal('chat.done'), qid: z.string(), text: z.string(), at: z.string().datetime(), proposal: ChatProposalSchema.optional(), relay: ChatRelaySchema.optional(), projectProposal: ChatProjectProposalSchema.optional() }),
  z.object({ type: z.literal('chat.error'), qid: z.string(), message: z.string() }),
  z.object({ type: z.literal('chat.history'), turns: z.array(ChatTurnSchema) }),
  /** The daemon updating itself: npm is running, then the service restarts (the socket closes right after). */
  z.object({ type: z.literal('update.progress'), version: z.string(), step: z.enum(['installing', 'restarting']) }),
  /** Nothing was changed. `detail`: the useful end of npm's output; `command`: what the person can run instead. */
  z.object({ type: z.literal('update.failed'), version: z.string(), reason: UpdateFailureSchema, detail: z.string().optional(), command: z.string().optional() }),
  /** The shared machines list (spec 2026-10-14 §5), sent to local clients only. */
  z.object({ type: z.literal('machines'), machines: MachinesSchema }),
  /** The local daemon's projects and folder rules (spec 2026-10-16 build §5), sent to local clients only. */
  z.object({ type: z.literal('projects'), projects: ProjectsSchema }),
  /** The island's settings shared by the local fronts; null until a front sets them (the island then sends its own). Local clients only. */
  z.object({ type: z.literal('island'), prefs: IslandPrefsSchema.nullable() }),
  z.object({ type: z.literal('error'), message: z.string(), id: z.string().optional(), /** Le type du message client refusé. */ request: z.string().optional(),
    /** Ce que le front doit reconnaître au-delà du texte (NOTE_NOT_TYPED) ; une chaîne libre, qu'un front plus ancien ignore. */ code: z.string().optional() })
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.route'), qid: z.string().min(1).max(100), text: z.string().min(1).max(20000), tool: ToolSchema.optional(), context: RoutingContextSchema }),
  DocumentReadSchema,
  ReposInspectSchema,
  ReposScanSchema,
  /** The overlay starts a session: `cwd` is a WSL path (`~` allowed), `name` a preferred bot name (the daemon picks a
   *  free one otherwise), `prompt` the agent's first instruction, `continue` resumes the folder's last conversation.
   *  With `qid` it is the chat card of that turn: the daemon launches the turn's proposal and ignores the other fields. */
  z.object({ type: z.literal('session.launch'), tool: ToolSchema, cwd: z.string().min(1), name: z.string().optional(), prompt: z.string().optional(), continue: z.boolean().optional(), qid: z.string().min(1).optional(),
    /** Folders in addition to `cwd` (Claude: `--add-dir`); resolved like `cwd`. */ dirs: z.array(z.string().min(1)).max(20).optional(),
    /** Routing by the fleet, removed before the message reaches the daemon. */ machineId: z.string().optional() }),
  /** The launch form's folder browser: list a folder's subfolders (home when no `path`), or make `name` inside `parent`
   *  and list it. Both are answered with a `folder.listing`. */
  z.object({ type: z.literal('folder.list'), path: z.string().optional(),
    /** Routing by the fleet, removed before the message reaches the daemon. */ machineId: z.string().optional(),
    /** Copied into the `folder.listing` that answers; the fleet relays only that listing, from the machine asked. */ requestId: z.string().min(1).max(100).optional() }),
  z.object({ type: z.literal('folder.create'), parent: z.string().min(1), name: z.string().min(1) }),
  z.object({ type: z.literal('session.reply'), id: z.string(), text: z.string().min(1) }),
  /** The chat card's instruction (spec 2026-10-12 relay §4): sent now if the session is free, else queued until it is. */
  z.object({ type: z.literal('session.relay'), qid: z.string().min(1) }),
  /** Takes the card's queued instruction back out of the queue. */
  z.object({ type: z.literal('session.relay.cancel'), qid: z.string().min(1) }),
  /** `always` and `note` only where the harness offers them (`offers`); a note goes with `deny`, for the agent to read. */
  z.object({
    type: z.literal('session.decide'), id: z.string(), decision: DecisionSchema, note: z.string().trim().min(1).max(NOTE_MAX).optional(),
    /** The request the user saw when deciding: refused (the request changed) unless it is still the pending one. Left out by older fronts and the island. */
    expect: PendingSchema.pick({ kind: true, text: true }).optional()
  }),
  z.object({ type: z.literal('session.focus'), id: z.string() }),
  z.object({ type: z.literal('session.kill'), id: z.string() }),
  z.object({ type: z.literal('session.interrupt'), id: z.string() }),
  /** Removes a finished (exited) or read-only (hook_only) session from the list; refused for a live launcher session. */
  z.object({ type: z.literal('session.dismiss'), id: z.string() }),
  /** The user names the session's topic from the overlay (500 characters at most, the hook's prompt cap); an empty topic hands back to the automatic sources. */
  z.object({ type: z.literal('session.rename'), id: z.string(), topic: z.string().max(500) }),
  z.object({ type: z.literal('session.thread'), id: z.string() }),
  z.object({ type: z.literal('session.register'), session: SessionSchema }),
  /** `agent` and `cwd` describe the session when the daemon does not know it yet (a hook from an agent started without ledge). */
  z.object({ type: z.literal('session.event'), id: z.string(), event: SessionEventSchema, agent: ToolSchema.optional(), cwd: z.string().optional() }),
  z.object({ type: z.literal('session.unregister'), id: z.string(), exitCode: z.number().int().nullable() }),
  z.object({ type: z.literal('snapshot.request') }),
  z.object({ type: z.literal('chat.ask'), qid: z.string().min(1), text: z.string().min(1), tool: ToolSchema.optional() }),
  z.object({ type: z.literal('chat.cancel'), qid: z.string().min(1) }),
  /** Starts a new conversation with Ledge: the day's turns are cleared and the next question opens a new harness session. */
  z.object({ type: z.literal('chat.reset') }),
  /** Installs `@paradow/ledge@version` and restarts the service (spec 2026-10-12 auto-update §6). */
  z.object({ type: z.literal('update.daemon'), version: z.string().regex(SEMVER) }),
  /** Replaces the daemon's machines list (first connected front wins); refused unless valid. */
  z.object({ type: z.literal('machines.set'), machines: MachinesSchema }),
  /** Replaces the local daemon's projects and rules as a whole; refused unless valid. */
  z.object({ type: z.literal('projects.set'), projects: ProjectsSchema }),
  /** Replaces the island's settings as a whole; refused unless valid. */
  z.object({ type: z.literal('island.set'), prefs: IslandPrefsSchema })
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw);
}
export function parseServerMessage(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw);
}
