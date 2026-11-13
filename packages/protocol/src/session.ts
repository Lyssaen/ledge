import { z } from 'zod';
import { ContextSchema, HandoverSchema, RelievesSchema } from './handover.js';
import { DecidedBySchema, DecisionSchema } from './decisions.js';

export const ToolSchema = z.enum(['claude', 'codex', 'cursor', 'omp']);
/** OMP's `--approval-mode` as Ledge offers it: ask before writes and executions, approve file writes by themselves, or approve everything (auto). */
export const OmpApprovalSchema = z.enum(['always-ask', 'write', 'yolo']);
export type OmpApproval = z.infer<typeof OmpApprovalSchema>;
export type Tool = z.infer<typeof ToolSchema>;
/** How Ledge drives a session's agent: through a tmux pane (Claude Code, Codex, Cursor Agent), or through the agent's own
 *  JSONL protocol with the daemon owning the process (OMP, spec 2026-10-20 §4). A session without it is a tmux one. */
export const BackendSchema = z.enum(['tmux', 'omp-rpc']);
export type Backend = z.infer<typeof BackendSchema>;

/** The longest `doing.label` the daemon keeps (cut with « … »): one line of a list row. */
export const DOING_LABEL_MAX = 120;
/** The longest `doing.tool` a phone receives. */
export const DOING_TOOL_MAX = 100;

/** One tool call the agent is running (`Session.running`). */
export const RunningCallSchema = z.object({
  id: z.string().optional(), tool: z.string(), label: z.string(), since: z.string().datetime(),
  /** The call whose permission request waits now: a refusal from Ledge removes this one, not another call of that tool. */
  asks: z.literal(true).optional()
});
export type RunningCall = z.infer<typeof RunningCallSchema>;
/** The most calls `running` keeps: the newest win. */
export const RUNNING_MAX = 20;

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
  /** The folder the agent works in now, as its last hook reported it: `cwd` stays where it started, this follows a worktree it entered. */
  workdir: z.string().optional(),
  /** The OpenRig seat this agent is: its session name (`dev-build@starter`), its rig, and its role (`dev.build`) once OpenRig named it. */
  rig: z.object({ seat: z.string(), name: z.string(), role: z.string().optional() }).optional(),
  tmuxSession: z.string().nullable(),
  /** Left out for a tmux session. `omp-rpc`: no pane, nothing to attach to; the daemon holds the process (see `agentSessionFile`). */
  backend: BackendSchema.optional(),
  state: SessionStateSchema,
  /** The tools the agent itself is running, oldest first, as its harness announced them (a hook's PreToolUse, OMP's event):
   *  the call's id when the harness gives one, the tool, its one-line label (a command, a file, OMP's intent; cut to
   *  DOING_LABEL_MAX), since when. A call leaves on its own end (matched by id, else the oldest of that tool), on a refusal
   *  from Ledge, or when the turn ends; a subagent's calls are not here. Read it through `doingOf`. */
  running: z.array(RunningCallSchema).optional(),
  pending: PendingSchema.optional(),
  /** Codex's main agent (#302): the request its PermissionRequest hook described (exact tool and files), held until the terminal
   *  shows its dialog, which proves it waits: it then becomes `pending`, as a hook's request always did. Dropped when the tool ran,
   *  the turn ended, or the dialog asks another kind of request. Never sent to the phone. */
  codexAsk: PendingSchema.optional(),
  /** The call that held request is for, when its PreToolUse named it (its tool_use_id): only that call's end settles it. */
  codexAskCall: z.string().optional(),
  /** Codex (#302): its terminal cannot be captured now; its hook's requests wait at once, as before #302, until it can again. */
  paneUnreadable: z.literal(true).optional(),
  helpers: z.array(HelperSchema).default([]),
  /** OMP: the instructions waiting in its own queue (typed while it works), as it reports them; left out when none. */
  queue: z.array(z.object({ text: z.string(), mode: z.enum(['steer', 'follow_up']) })).optional(),
  lastReply: ReplySchema.optional(),
  /** The last request answered from Ledge (a decision, or a reply to a question): its key (pendingKey), who answered it
   *  (the PC or a device, its name then), when, and the decision when it was one. Absent until one is, and from an older daemon. */
  lastAnswer: z.object({ key: z.string().max(64), by: DecidedBySchema, at: z.string().datetime(), decision: DecisionSchema.optional() }).optional(),
  /** The last message this session sent to another agent: its tool_use_id, the address, the peer's Ledge session id, a one-line summary. */
  lastMessage: z.object({ id: z.string(), to: z.string(), peer: z.string().optional(), summary: z.string(), at: z.string().datetime() }).optional(),
  startedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  lastHookAt: z.string().datetime().optional(),
  /** The model and effort Ledge launched the agent with (#58); left out, the agent's own default. For a session Ledge did not
   *  launch (or a seat), what its transcript says it runs: Claude Code `message.model`, Codex `turn_context` (`modelFrom` and
   *  `effortFrom` then say `transcript`). A Claude Code effort is never in its transcript: unknown, left out. */
  model: z.string().optional(),
  effort: z.string().optional(),
  modelFrom: z.literal('transcript').optional(),
  effortFrom: z.literal('transcript').optional(),
  /** `startedAt` is when Ledge first saw the session (its first hook, a seat found), not its launch: « depuis que Ledge la voit ». */
  startedSeen: z.literal(true).optional(),
  /** OMP: the approval mode it was launched with, kept by a resume; left out, `always-ask`. */
  approval: OmpApprovalSchema.optional(),
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
  /** `killed`: Ledge's close had to kill its terminal, the agent did not leave on its exit command (« Fermée de force »).
   *  Left out for any other end; dropped when it starts again. */
  closedHow: z.literal('killed').optional(),
  lastError: z.string().optional(),
  /** `launcher`: Ledge launched it; `hook_only`: only its hooks are known (read-only); `rig`: an OpenRig seat Ledge follows through
   *  its tmux pane on the user's default server, answered like its own, whose life stays OpenRig's (no close, kill, resume, model). */
  // A kind a newer daemon adds reads as read-only here, never as a snapshot thrown away whole (« hors ligne »).
  source: z.enum(['launcher', 'hook_only', 'rig']).catch('hook_only'),
  /** When the session was put in the archive (session management): set, it leaves the live list and waits to be restored, resumed or deleted. */
  archivedAt: z.string().datetime().optional(),
  /** When the session was last taken out of the archive: the poller's retirement clock restarts from it, not from `exitedAt`. */
  restoredAt: z.string().datetime().optional()
});
export type Session = z.infer<typeof SessionSchema>;

/** The transport a session's agent is driven through. */
export function backendOf(s: Pick<Session, 'backend'>): Backend {
  return s.backend ?? 'tmux';
}

/** What the agent is doing now, for a list row: its newest call still running, only while it works with no request up;
 *  when that call ends, the one before it if it still runs. */
export function doingOf(s: Pick<Session, 'state' | 'pending' | 'running'>): { tool: string; label: string; since: string } | undefined {
  if (s.state !== 'working' || s.pending) return undefined;
  const last = s.running?.at(-1);
  return last ? { tool: last.tool, label: last.label, since: last.since } : undefined;
}

/** Whether the session sits in the archive. */
export function isArchived(s: Pick<Session, 'archivedAt'>): boolean {
  return s.archivedAt !== undefined;
}

/** An OMP seat of OpenRig that Ledge follows for its state only (one Ledge launches itself is `omp-rpc`): no thread, its pane is
 *  the seat's runner, its life OpenRig's. */
export function isOmpSeat(s: Pick<Session, 'source' | 'tool' | 'backend'>): boolean {
  return s.source === 'rig' && s.tool === 'omp' && s.backend === undefined;
}

/** A stopped OMP seat, which the fronts keep under its rig, greyed « arrêté » (docs/mockups/ledge-openrig-omp.html), as long as the
 *  daemon keeps it out of the archive. Claude and Codex seats that end leave the lists, as before. */
export function isStoppedOmpSeat(s: Pick<Session, 'source' | 'tool' | 'backend' | 'state' | 'archivedAt'>): boolean {
  return isOmpSeat(s) && s.state === 'exited' && !isArchived(s);
}
