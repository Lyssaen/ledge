import { z } from 'zod';
import { AskQuestionSchema, PendingSchema, SessionSchema, ToolSchema, OmpApprovalSchema } from './session.js';
import { ChatStepSchema, ChatTurnSchema, ChatProposalSchema, ChatProposalsSchema, ChatRelaySchema, ChatClosesSchema, MAX_PROPOSALS, ChatProjectProposalSchema, ChatTeamProposalSchema, ChatTasksSchema, ChatActionsSchema, ChatActionSchema } from './chat.js';
import { ActionIdSchema } from './actions.js';
import { ReposInspectSchema, ReposInfoSchema } from './repos.js';
import { ModelsListSchema, ModelsListingSchema, ModelIdSchema, EffortSchema } from './models.js';
import { ReposScanSchema, ReposFoundSchema } from './scan.js';
import { DocumentReadSchema, DocumentContentSchema, DocumentErrorSchema } from './documents.js';
import { RoutingContextSchema, RouteResultSchema } from './routing.js';
import { SshAliasSchema } from './ssh.js';
import { MachinesSchema } from './machines.js';
import { IslandPrefsSchema } from './island.js';
import { ProjectsSchema } from './projects.js';
import { ThreadItemSchema } from './thread.js';
import { DecisionSchema, NOTE_MAX } from './decisions.js';
import { MobileStateSchema, RelayUrlSchema } from './mobile.js';
import { TaskCmdSchema, TaskResultSchema, TaskUpdatedSchema } from './tasks.js';
import { ContextPrefsMessageSchema, ContextSetSchema, HandoverBriefSchema, HandoverResultSchema, HandoverShowSchema, SessionHandoverResultSchema, SessionHandoverSchema } from './handover.js';
import { RoleIdSchema, RolesListSchema, RolesListingSchema, TeamDissolveSchema, TeamFailedSchema, TeamIdSchema, TeamJoinSchema, TeamLaunchSchema, TeamLaunchedSchema, TeamLeaveSchema, TeamResumeSchema, TeamSaveSchema, TeamSavedSchema, TeamsMessageSchema, TeamUpdatedSchema } from './teams.js';

export const PROTOCOL_PORT = 47831;

/** Why the daemon refused a front's command. Travels as the `code` of an `error`, which stays a free string so that an older front ignores a new one. */
export const RefusalCodeSchema = z.enum(['stale', 'read_only', 'no_prompt', 'not_taken', 'busy', 'unknown_session', 'nothing_to_decide', 'not_offered', 'free_text', 'note_not_typed', 'unavailable', 'invalid']);
export type RefusalCode = z.infer<typeof RefusalCodeSchema>;

export const SessionEventSchema = z.object({
  name: z.enum(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd', 'PaneChanged', 'PaneGone', 'PanePrompt', 'PaneIdle', 'InjectFailed', 'Decided', 'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PaneTitle', 'Renamed', 'NativeRequest', 'AgentMessage', 'QueueUpdate']),
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
  /** QueueUpdate: OMP's queue as it stands. */
  queue: z.array(z.object({ text: z.string(), mode: z.enum(['steer', 'follow_up']) })).optional(),
  /** AgentMessage: the harness's own message, its text so far (`streaming`) or whole. `messageId` is unique for the session's life. */
  messageId: z.string().optional(), streaming: z.boolean().optional(),
  /** NativeRequest: the dialog's id, and OMP's `ask` questions when it is one. */
  requestId: z.string().optional(), questions: z.array(AskQuestionSchema).optional(),
  /** Stop: its text is already in the thread as AgentMessage cards, which the reply card must not repeat. */
  streamed: z.boolean().optional(),
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
  decision: DecisionSchema.optional(),
  /** Decided: the request was refused by Ledge closing the session (its interrupt keys), not by the user's answer. */
  byClose: z.literal(true).optional(),
  /** The agent's own session id when the hook names it, so the daemon can resume that conversation. */
  agentSessionId: z.string().optional()
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

/** A folder a session ran in, for the launch form; `lastAt` is its latest session's start. */
export const RecentSchema = z.object({ cwd: z.string().min(1), project: z.string().min(1), lastAt: z.string().datetime() });
export type Recent = z.infer<typeof RecentSchema>;

/** A release version as the tag gives it, without the `v` and without a pre-release suffix. */
export const SEMVER = /^\d+\.\d+\.\d+$/;
/** What the daemon knows of itself (spec 2026-10-12 auto-update §6): its version, how it was installed, whether it runs
 *  as the systemd service, and the command a person runs by hand when it cannot update itself. */
export const DaemonInfoSchema = z.object({ version: z.string(), install: z.enum(['npm', 'git', 'unknown']), systemd: z.boolean(), manual: z.string().optional(), routing: z.boolean().optional(), archive: z.boolean().optional(),
  /** Takes `model` and `effort` on `session.launch` and answers `models.list` (#58). */ models: z.boolean().optional(),
  /** Drives OMP over its RPC: launching `omp` sessions is possible when the binary is there (`models.list` says so). */ omp: z.boolean().optional(),
  /** Takes `session.model`: a live session's model and effort changed (#58, lot 2). */ modelSwitch: z.boolean().optional(),
  /** Takes `approval` on an OMP `session.launch` (auto mode). */ ompApproval: z.boolean().optional(),
  /** Its home folder, so a client shows the folders under it as `~` (absent from older daemons). */ home: z.string().optional(), mobile: z.boolean().optional(),
  /** Knows roles, teams and tasks given by Ledge (spec 2026-10-25 roles). */ teams: z.boolean().optional() });
export type DaemonInfo = z.infer<typeof DaemonInfoSchema>;
export const UpdateFailureSchema = z.enum(['git-install', 'no-systemd', 'sessions-at-risk', 'npm-failed', 'busy']);
export type UpdateFailure = z.infer<typeof UpdateFailureSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.routed'), qid: z.string(), result: RouteResultSchema }),
  DocumentContentSchema,
  DocumentErrorSchema,
  ReposInfoSchema,
  ReposFoundSchema,
  ModelsListingSchema,
  /** `recents`: the folders of past sessions, most recent first. `launcher`: the command that runs `ledge` inside WSL
   *  (`[node, cli]`), so the overlay can attach a terminal to a session with `<launcher> attach <id>`. `daemon`: absent
   *  from daemons older than the auto-update. */
  z.object({ type: z.literal('snapshot'), sessions: z.array(SessionSchema), recents: z.array(RecentSchema).optional(), launcher: z.array(z.string()).optional(), daemon: DaemonInfoSchema.optional(), sshAlias: SshAliasSchema.optional() }),
  z.object({ type: z.literal('session.updated'), session: SessionSchema }),
  /** OMP: the instructions taken back from its queue by an interrupt that restores it; the asker puts them back in its draft. */
  z.object({ type: z.literal('session.queue.restored'), id: z.string(), texts: z.array(z.string()) }),
  z.object({ type: z.literal('session.removed'), id: z.string() }),
  z.object({ type: z.literal('session.preview'), id: z.string(), lines: z.array(z.string()) }),
  /** A session's thread, on request (spec 2026-10-13 §5); then each created or updated item, broadcast. */
  z.object({ type: z.literal('session.thread'), id: z.string(), items: z.array(ThreadItemSchema) }),
  z.object({ type: z.literal('session.thread.item'), id: z.string(), item: ThreadItemSchema }),
  /** Answer to the requester of a `session.launch`: the session exists (its `session.updated` is broadcast as usual). */
  z.object({ type: z.literal('session.launched'), id: z.string() }),
  /** Answer to the requester of a `session.close`, once per row closed: the session `id` and how it ended. */
  z.object({ type: z.literal('session.closed'), qid: z.string(), row: z.number().int().min(0), id: z.string(), how: z.enum(['exit', 'killed']) }),
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
  z.object({ type: z.literal('chat.done'), qid: z.string(), text: z.string(), at: z.string().datetime(), proposal: ChatProposalSchema.optional(), proposals: ChatProposalsSchema.optional(), relay: ChatRelaySchema.optional(), closes: ChatClosesSchema.optional(), projectProposal: ChatProjectProposalSchema.optional(), team: ChatTeamProposalSchema.optional(), tasks: ChatTasksSchema.optional(), actions: ChatActionsSchema.optional() }),
  /** What a `chat.act` applied: the rows done, and the one that failed with why (the rows after it stay proposed). */
  z.object({ type: z.literal('chat.acted'), rid: z.string(), qid: z.string(), done: z.array(z.number().int().min(0)), failed: z.array(z.object({ row: z.number().int().min(0), message: z.string(), /** nothing was sent */ refused: z.literal(true).optional() })) }),
  /** What an `action.run` came to: `row` the action as the daemon resolved it (its summary, its risk); `reason` why it was not
   *  done, with `code` (`refused`: not possible now; `agent`: a session may not run it; `confirm_required`: destructive, ask
   *  again; `failed`: the handler turned it down; a free string, as an `error`'s); `path` the template a `team.save` wrote. */
  z.object({ type: z.literal('action.result'), rid: z.string(), action: z.string().min(1).max(40), row: ChatActionSchema.optional(), reason: z.string().optional(), code: z.string().optional(), path: z.string().optional() }),
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
  /** Mobile access (lot 3), after the island in each snapshot and on every change. Local clients only. */
  z.object({ type: z.literal('mobile'), state: MobileStateSchema }),
  /** The daemon's immediate answer to a `session.message`: delivered (`accepted`), held for later (`queued`), left to Claude's own SendMessage (`native`), or refused with a `reason`. */
  z.object({ type: z.literal('message.ack'), rid: z.string(), outcome: z.enum(['accepted', 'queued', 'native', 'refused']), reason: z.string().optional() }),
  /** The answer to a `message.read`: the body with its sender, target and time, or the refusal's `reason`. */
  z.object({ type: z.literal('message.body'), id: z.string(), from: z.string().optional(), to: z.string().optional(), at: z.string().optional(), text: z.string().optional(), reason: z.string().optional() }),
  TaskResultSchema,
  SessionHandoverResultSchema,
  ContextPrefsMessageSchema,
  HandoverResultSchema,
  TaskUpdatedSchema,
  RolesListingSchema,
  TeamsMessageSchema, TeamUpdatedSchema, TeamLaunchedSchema, TeamFailedSchema, TeamSavedSchema,
  z.object({ type: z.literal('error'), message: z.string(), id: z.string().optional(), /** Le type du message client refusé. */ request: z.string().optional(),
    /** Ce que le front doit reconnaître au-delà du texte (NOTE_NOT_TYPED) ; une chaîne libre, qu'un front plus ancien ignore. */ code: z.string().optional() })
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type MessageAck = Extract<ServerMessage, { type: 'message.ack' }>;

/** The longest text and summary a `session.message` may carry (as `chat.route` caps a routed text). */
export const MESSAGE_MAX = 20000;
export const SUMMARY_MAX = 500;

/** A card's rows to act on (#24), indexes into the turn's list, each once. */
const launchRows = z.array(z.number().int().min(0).max(MAX_PROPOSALS - 1)).min(1).max(MAX_PROPOSALS).refine(r => new Set(r).size === r.length, 'a row twice');

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat.route'), qid: z.string().min(1).max(100), text: z.string().min(1).max(20000), tool: ToolSchema.optional(), context: RoutingContextSchema }),
  DocumentReadSchema,
  ReposInspectSchema,
  ReposScanSchema,
  ModelsListSchema,
  /** The overlay starts a session: `cwd` is a WSL path (`~` allowed), `name` a preferred bot name (the daemon picks a
   *  free one otherwise), `prompt` the agent's first instruction, `continue` resumes the folder's last conversation.
   *  With `qid` it is the chat card of that turn: the daemon launches the turn's proposal and ignores the other fields
   *  but `rows`, `model` and `effort`. */
  z.object({ type: z.literal('session.launch'), tool: ToolSchema, cwd: z.string().min(1), name: z.string().optional(), prompt: z.string().optional(), continue: z.boolean().optional(), qid: z.string().min(1).optional(),
    /** With `qid`: the card's rows to launch (#24), indexes into the turn's `proposals`, each once; the first row without it. */
    rows: launchRows.optional(),
    /** Folders in addition to `cwd` (Claude: `--add-dir`); resolved like `cwd`. */ dirs: z.array(z.string().min(1)).max(20).optional(),
    /** The agent's model and effort (#58), the agent's own default when left out; with `qid`, for every row launched. */
    model: ModelIdSchema.optional(), effort: EffortSchema.optional(),
    /** OMP only: its approval mode, `always-ask` when left out. */ approval: OmpApprovalSchema.optional(),
    /** A role (spec 2026-10-25 roles §3.4): its prompt reaches the agent at every start, its defaults fill what is left out. */ role: RoleIdSchema.optional(),
    /** A live team the new session joins at once, in `role`. */ team: TeamIdSchema.optional(),
    /** Routing by the fleet, removed before the message reaches the daemon. */ machineId: z.string().optional() }),
  /** The launch form's folder browser: list a folder's subfolders (home when no `path`), or make `name` inside `parent`
   *  and list it. Both are answered with a `folder.listing`. */
  z.object({ type: z.literal('folder.list'), path: z.string().optional(),
    /** Routing by the fleet, removed before the message reaches the daemon. */ machineId: z.string().optional(),
    /** Copied into the `folder.listing` that answers; the fleet relays only that listing, from the machine asked. */ requestId: z.string().min(1).max(100).optional() }),
  z.object({ type: z.literal('folder.create'), parent: z.string().min(1), name: z.string().min(1),
    /** As for `folder.list`: routing by the fleet, and the request its `folder.listing` answers. */ machineId: z.string().optional(), requestId: z.string().min(1).max(100).optional() }),
  /** `steer`: OMP only, redirect the turn running now instead of queueing the text after it. */
  /** OMP's `ask`: the answers to every question of the dialog `requestId`, in order (`selected` labels, and/or free `text`); `cancel` declines it. */
  z.object({ type: z.literal('session.answer'), id: z.string(), requestId: z.string().min(1).max(200), answers: z.array(z.object({ id: z.string(), selected: z.array(z.string().max(2000)).max(100), text: z.string().max(20000).optional() })).max(50), cancel: z.boolean().optional() }),
  z.object({ type: z.literal('session.reply'), id: z.string(), text: z.string().min(1), steer: z.boolean().optional() }),
  /** The chat card's instruction (spec 2026-10-12 relay §4): sent now if the session is free, else queued until it is. */
  z.object({ type: z.literal('session.relay'), qid: z.string().min(1) }),
  /** Takes the card's queued instruction back out of the queue. */
  z.object({ type: z.literal('session.relay.cancel'), qid: z.string().min(1) }),
  /** The chat's generic card (action registry spec §5.1): applies its rows in order (all of them without `rows`), stopping at
   *  the first failure. `confirmed` says the front asked again; refused without it when a row is destructive. */
  z.object({ type: z.literal('chat.act'), rid: z.string().min(1).max(100), qid: z.string().min(1), rows: launchRows.optional(), confirmed: z.literal(true).optional() }),
  /** « Ignorer » the turn's cards, for every device and for Ledge (who is told at the next question); `undo` opens them
   *  again (« Revoir »). Refused while one of them is under way. Every client gets the turn's `ignoredAt` through chat.history. */
  z.object({ type: z.literal('chat.ignore'), qid: z.string().min(1), undo: z.literal(true).optional() }),
  /** A registry action run outside the chat (#93, the CLI): the daemon resolves `args` as it does a generic card's row, then
   *  applies it through its own handler. `by` the session that asks, left out for the user; `confirmed` for a destructive one. */
  z.object({ type: z.literal('action.run'), rid: z.string().min(1).max(100), by: z.string().min(1).optional(), action: ActionIdSchema, args: z.record(z.unknown()), confirmed: z.literal(true).optional() }),
  /** The chat's close card: closes the turn's sessions, `rows` (indexes into its `closes`) or all of them. */
  z.object({ type: z.literal('session.close'), qid: z.string().min(1), rows: launchRows.optional() }),
  /** `always` and `note` only where the harness offers them (`offers`); a note goes with `deny`, for the agent to read. */
  z.object({
    type: z.literal('session.decide'), id: z.string(), decision: DecisionSchema, note: z.string().trim().min(1).max(NOTE_MAX).optional(),
    /** The request the user saw when deciding: refused (the request changed) unless it is still the pending one. Left out by older fronts and the island.
     *  `key` (pendingKey) covers its whole content; older fronts send kind and text only. */
    expect: PendingSchema.pick({ kind: true, text: true }).extend({ key: z.string().max(64).optional() }).optional()
  }),
  z.object({ type: z.literal('session.focus'), id: z.string() }),
  z.object({ type: z.literal('session.kill'), id: z.string() }),
  /** `restoreQueue` (OMP): also take back what waits in its queue, returned as `session.queue.restored` to put in the draft. */
  z.object({ type: z.literal('session.interrupt'), id: z.string(), restoreQueue: z.boolean().optional() }),
  /** Removes a finished (exited) or read-only (hook_only) session from the list; refused for a live launcher session. */
  z.object({ type: z.literal('session.dismiss'), id: z.string() }),
  /** Puts a session in the archive: it leaves the live list but is kept. */
  z.object({ type: z.literal('session.archive'), id: z.string() }),
  /** Takes an archived session back out of the archive, as it was. */
  z.object({ type: z.literal('session.restore'), id: z.string() }),
  /** Starts the agent again on an archived session's conversation. */
  z.object({ type: z.literal('session.resume'), id: z.string() }),
  /** Changes a live session's model and effort (#58, lot 2), `null` for the agent's own default: the daemon restarts the
   *  agent on the same conversation with them, at once when the session is free, else at its next free moment. */
  z.object({ type: z.literal('session.model'), id: z.string(), model: ModelIdSchema.nullable(), effort: EffortSchema.nullable() }),
  /** Deletes a session for good, archived or not. */
  z.object({ type: z.literal('session.delete'), id: z.string() }),
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
  z.object({ type: z.literal('island.set'), prefs: IslandPrefsSchema }),
  /** Mobile access (lot 3), local fronts only. A changed `relayUrl` drops the relay session. */
  z.object({ type: z.literal('mobile.set'), enabled: z.boolean(), relayUrl: RelayUrlSchema }),
  z.object({ type: z.literal('mobile.signin') }),
  z.object({ type: z.literal('mobile.signin.cancel') }),
  z.object({ type: z.literal('mobile.signout') }),
  /** While the link is offline: try again now. */
  z.object({ type: z.literal('mobile.retry') }),
  z.object({ type: z.literal('mobile.pairing.approve'), id: z.string().min(1).max(100) }),
  z.object({ type: z.literal('mobile.pairing.deny'), id: z.string().min(1).max(100) }),
  /** `id`: the device's fingerprint. */
  z.object({ type: z.literal('mobile.device.revoke'), id: z.string().min(1).max(100) }),
  /** One session writing to another by Ledge name (`to` may end in ` [ref]`); `intercept` (the Claude hook): answer `native` unless `to` is a live non-Claude session. */
  z.object({ type: z.literal('session.message'), rid: z.string().min(1), from: z.string().min(1), to: z.string().min(1), text: z.string().min(1).max(MESSAGE_MAX), summary: z.string().max(SUMMARY_MAX).optional(), intercept: z.boolean().optional() }),
  /** `ledge read <id>`: a message's whole body, for its receiver or its sender (`by`, a session id). */
  z.object({ type: z.literal('message.read'), id: z.string().min(1).max(40), by: z.string().min(1) }),
  TaskCmdSchema,
  SessionHandoverSchema,
  ContextSetSchema,
  HandoverBriefSchema,
  HandoverShowSchema,
  RolesListSchema,
  TeamLaunchSchema, TeamJoinSchema, TeamLeaveSchema, TeamResumeSchema, TeamDissolveSchema, TeamSaveSchema
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
/** The commands of the mobile access service. */
export type MobileClientMessage = Extract<ClientMessage, { type: `mobile.${string}` }>;

export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw);
}
export function parseServerMessage(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw);
}
