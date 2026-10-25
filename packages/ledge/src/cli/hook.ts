import { type Session, type SessionEvent, type Tool } from '@ledge/protocol';
import { connect, sendMessageAndAwaitAck, type Client } from '../client.js';
import { log } from '../log.js';
import { QUESTION_TOOLS } from '../daemon/state.js';
import { codexPlan } from '../daemon/transcript.js';
import { gitInfo } from '../daemon/git.js';
import { readPeers, resolveTarget } from '../daemon/peers.js';
import { messageNote } from '../daemon/crossSession.js';
import { readFileSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CODEX_ENV_VAR, CODEX_HOOK_VAR } from '../spawn.js';
import { parseLedgeCommand, readOnClient, sendOnClient } from './send.js';
import { taskOnClient } from './task.js';
import { formatWho } from './who.js';

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The longest first prompt sent as a topic candidate; the reducer cuts it to one line of TOPIC_MAX. */
const PROMPT_MAX = 500;
/** Claude Code hands a backgrounded helper's report back, another session's message, or its harness's notice about one
 *  (`[Cross-session idle notice]`…), as a prompt: that text is the report, message or notice, capped like a tool input. */
const fromAgent = (t: string) => t.startsWith('<agent-message from="') || t.startsWith('<cross-session-message ') || t.startsWith('[Cross-session ');
const promptText = (p: Payload) => { const t = str(p.prompt)?.trim(); return t ? { text: t.slice(0, fromAgent(t) ? INPUT_MAX : PROMPT_MAX) } : {}; };

function describeTool(tool: string | undefined, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Payload;
  if (tool === 'Bash') return str(i.command) ?? '';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'Read') return str(i.file_path) ?? '';
  if (tool === 'SendMessage') return str(i.summary) || `→ ${str(i.to) ?? ''}`;
  if (tool === 'ExitPlanMode') return str(i.plan)?.split('\n')[0] ?? 'plan';
  // Codex: the patch names its files on `*** Update File: <path>` (Add, Delete) lines.
  if (tool === 'apply_patch') {
    const files = [...(str(i.command) ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(m => m[1]!.trim());
    return files.length ? files.join(', ') : 'patch';
  }
  return str(i.description) ?? JSON.stringify(i).slice(0, 200);
}

/** The longest reply kept from a Stop hook: enough for a long report, never a whole transcript. */
export const REPLY_MAX = 24_000;
/** The agent's last message (Claude Code 2.1: `last_assistant_message` on Stop), trimmed and capped. */
function lastReply(p: Payload): string | undefined {
  return cap(str(p.last_assistant_message)?.trim());
}

function cap(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX)}\n\n[…]` : text;
}

/** Each string of a tool input is capped: a Write carries a whole file, the daemon only shows a diff of it. */
export const INPUT_MAX = 8_000;

/** The tool's input, strings capped, or nothing when the harness gave no object. */
export function trimInput(input: unknown, max = INPUT_MAX): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const trim = (v: unknown): unknown => typeof v === 'string' ? v.slice(0, max)
    : Array.isArray(v) ? v.map(trim)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, trim(x)])) : v;
  return trim(input) as Record<string, unknown>;
}

/** A tool_response as text: a string as is, `{stdout, stderr}` joined, content blocks' texts, anything else as JSON. */
export function toolOutput(response: unknown): string | undefined {
  if (response === null || response === undefined) return undefined;
  let text: string;
  if (typeof response === 'string') text = response;
  else if (Array.isArray(response)) text = response.map(b => str((b as Payload)?.text) ?? '').filter(Boolean).join('\n');
  else if (typeof response === 'object' && ('stdout' in response || 'stderr' in response)) {
    const r = response as Payload;
    text = [str(r.stdout), str(r.stderr)].filter(Boolean).join('\n');
  } else {
    try { text = JSON.stringify(response); } catch { text = String(response); }
  }
  return text.slice(0, REPLY_MAX);
}

/** SessionEnd reasons after which the same agent process keeps running (Claude Code 2.1). */
const NON_TERMINAL_END_REASONS = new Set(['clear', 'resume']);

export type MappedHook = { id: string; event: SessionEvent; agent: Tool; cwd?: string };

/** Claude Code hooks (the payload shapes Codex hooks share), see `mapHook`. */
export function mapClaudeHook(eventName: string, payload: unknown, at: string): MappedHook | null {
  return mapHook('claude', eventName, payload, at);
}

/** True when an ancestor of this process is a Codex app-server (the shared daemon that runs hooks), as read from /proc. */
export function underCodexDaemon(read: (path: string) => string = p => readFileSync(p, 'utf8')): boolean {
  let pid = process.pid;
  for (let depth = 0; depth < 8; depth++) {
    try {
      // The parent pid is the 2nd field after "(comm)", which may itself contain spaces.
      const stat = read(`/proc/${pid}/stat`);
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!pid || pid <= 1) return false;
      if (read(`/proc/${pid}/cmdline`).split('\0').includes('app-server')) return true;
    } catch { return false; }
  }
  return false;
}

/** The Ledge session of a Codex hook: the per-thread override, else the environment when no shared daemon runs the hook. */
export function codexLedgeId(env: NodeJS.ProcessEnv = process.env, daemon: () => boolean = underCodexDaemon): string | undefined {
  if (env[CODEX_HOOK_VAR]) return env[CODEX_HOOK_VAR];
  if (env[CODEX_ENV_VAR] && !daemon()) return env[CODEX_ENV_VAR];
  return undefined;
}

/**
 * One hook call as a session event. Codex hooks take Claude Code's names and payloads, plus `Interrupt`; their session
 * comes from `codexLedgeId`, never `LEDGE_SESSION` (the shared Codex daemon may carry another session's). Without a
 * Ledge id, the agent's own session id names a read-only session.
 */
export function mapHook(agent: Tool, eventName: string, payload: unknown, at: string): MappedHook | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Payload;
  const ledgeId = (agent === 'codex' ? codexLedgeId() : process.env.LEDGE_SESSION) || undefined;
  const launched = !!ledgeId;
  const id = ledgeId || str(p.session_id);
  if (!id) return null;
  const cwd = str(p.cwd) || undefined;
  const event = mapEvent(eventName, p, at, launched);
  if (!event) return null;
  const task = agent === 'claude' && event.helperId ? helperDescription(str(p.transcript_path), event.helperId) : undefined;
  // The agent's own conversation id, which `--resume` takes; a subagent's hooks share the session's, so they add none.
  const agentSessionId = !event.helperId ? str(p.session_id) : undefined;
  return { id, event: { ...event, ...(task ? { task } : {}), ...(agentSessionId ? { agentSessionId } : {}) }, agent, ...(cwd ? { cwd } : {}) };
}

/**
 * The first line of a Claude Code subagent's description, from the `.meta.json` beside the session transcript
 * (`<session>/subagents/agent-<id>.meta.json`). SubagentStart carries none and the file is written just after it, so
 * it is read on each of the subagent's events; its internal agents have none.
 */
function helperDescription(transcriptPath: string | undefined, agentId: string): string | undefined {
  if (!transcriptPath?.endsWith('.jsonl') || !/^[\w-]+$/.test(agentId)) return undefined;
  try {
    const meta = JSON.parse(readFileSync(join(transcriptPath.slice(0, -'.jsonl'.length), 'subagents', `agent-${agentId}.meta.json`), 'utf8')) as Payload;
    return str(meta.description)?.split('\n')[0]?.trim() || undefined;
  } catch { return undefined; }
}

function mapEvent(eventName: string, p: Payload, at: string, launched: boolean): SessionEvent | null {
  const tool = str(p.tool_name);
  // agent_id is present only when the hook fires inside a subagent (absent on the main thread, even with --agent).
  const agentId = str(p.agent_id) || undefined;
  const base = { at, source: 'hook' as const, ...(agentId ? { helperId: agentId } : {}) };
  const toolUseId = str(p.tool_use_id) || undefined;
  // A plan is read whole before it is approved: it is capped like a reply, not like a tool input.
  const toolInput = trimInput(p.tool_input, tool === 'ExitPlanMode' ? REPLY_MAX : INPUT_MAX);
  const call = { ...(toolUseId ? { toolUseId } : {}), ...(toolInput ? { toolInput } : {}) };
  const transcript = str(p.transcript_path) ? { transcriptPath: str(p.transcript_path)! } : {};
  const duration = typeof p.duration_ms === 'number' && p.duration_ms >= 0 ? { durationMs: p.duration_ms } : {};
  switch (eventName) {
    case 'SubagentStart':
    case 'SubagentStop': {
      // Here agent_id names the helper itself. 2.1 sends no task; description/prompt are read if a later version adds them.
      if (!agentId) return null;
      const type = str(p.agent_type) || undefined;
      const task = eventName === 'SubagentStart' ? (str(p.description) || str(p.prompt))?.split('\n')[0] : undefined;
      // SubagentStop: the helper's report and its own transcript, which the daemon reads for its messages.
      const report = eventName === 'SubagentStop' ? lastReply(p) : undefined;
      const agentTranscript = eventName === 'SubagentStop' && str(p.agent_transcript_path) ? { transcriptPath: str(p.agent_transcript_path)! } : {};
      return { name: eventName, ...base, ...(type ? { tool: type } : {}), ...(task ? { text: task } : {}), ...(report ? { text: report } : {}), ...agentTranscript };
    }
    case 'PostToolUse': {
      const output = toolOutput(p.tool_response);
      return { name: 'PostToolUse', ...base, tool, ...call, ...(output !== undefined ? { output } : {}), ...duration };
    }
    case 'PostToolUseFailure': {
      const error = str(p.error) || undefined;
      return { name: 'PostToolUseFailure', ...base, tool, ...call, ...(error ? { error } : {}), ...duration, ...(p.is_interrupt === true ? { interrupt: true } : {}) };
    }
    case 'StopFailure': {
      const error = str(p.error); const details = str(p.error_details);
      const text = [error, details].filter(Boolean).join(': ').slice(0, 300) || undefined;
      return { name: 'StopFailure', ...base, ...(text ? { text } : {}) };
    }
    // Codex: Esc on a running turn or on an approval. Like Claude's interrupted tool run, no Stop follows.
    case 'Interrupt': return { name: 'PostToolUseFailure', ...base, interrupt: true };
    case 'SessionStart': return { name: 'SessionStart', ...base };
    case 'UserPromptSubmit': return { name: 'UserPromptSubmit', ...base, ...promptText(p), ...transcript };
    case 'Stop': {
      // Codex in Plan mode stops with a null last message: the plan of that turn, read from its rollout, is the reply.
      const turnId = str(p.turn_id); const path = str(p.transcript_path);
      const said = lastReply(p);
      const plan = said ? undefined : turnId && path ? cap(codexPlan(path, turnId)) : undefined;
      const text = said ?? plan;
      return { name: 'Stop', ...base, ...(plan ? { kind: 'plan' as const } : {}), ...(text ? { text } : {}), ...transcript };
    }
    case 'SessionEnd':
      // Under the launcher, the exit belongs to session.unregister (real exit code) and PaneGone:
      // Claude's SessionEnd also fires on /clear, /resume and logout while the process lives on.
      if (launched) return null;
      if (NON_TERMINAL_END_REASONS.has(str(p.reason) ?? '')) return null;
      return { name: 'SessionEnd', ...base, exitCode: null };
    case 'PermissionRequest': return { name: 'PermissionRequest', ...base, tool, text: describeTool(tool, p.tool_input), ...call, ...transcript };
    case 'PreToolUse': {
      if (tool && QUESTION_TOOLS.has(tool)) {
        const qs = ((p.tool_input as Payload | undefined)?.questions as Array<Payload> | undefined) ?? [];
        const q = qs[0];
        const opts = ((q?.options as Array<Payload> | undefined) ?? []).filter(o => !!str(o.label));
        const options = opts.map(o => str(o.label)!);
        const optionDetails = opts.map(o => str(o.description)?.trim() ?? '');
        return { name: 'PreToolUse', ...base, tool, text: str(q?.question) ?? '', options, ...(optionDetails.some(Boolean) ? { optionDetails } : {}), ...call, ...transcript };
      }
      return { name: 'PreToolUse', ...base, tool, text: describeTool(tool, p.tool_input), ...call, ...transcript };
    }
    case 'Notification': {
      const type = str(p.notification_type) ?? '';
      const message = str(p.message) ?? '';
      const kind = type === 'permission_prompt' || /permission/i.test(message) ? 'permission' : undefined;
      return { name: 'Notification', ...base, kind, text: message };
    }
    default: return null;
  }
}

/** Cursor Agent's tool input, as Ledge shows it: the command, the file, or a short description. */
function describeCursorTool(input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Payload;
  return str(i.command) ?? str(i.file_path) ?? str(i.path) ?? str(i.description) ?? JSON.stringify(i).slice(0, 200);
}

type Entry = { role?: string; message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: Payload }> } };

/** The last `bytes` of a JSONL transcript as entries: a long conversation is only read from its end. */
export function readTranscript(path: string, bytes = 512 * 1024): Entry[] {
  let raw: string;
  try {
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, bytes);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      raw = buf.toString('utf8');
      if (len < size) raw = raw.slice(raw.indexOf('\n') + 1); // the first line is cut
    } finally { closeSync(fd); }
  } catch { return []; }
  const out: Entry[] = [];
  for (const line of raw.split('\n')) { try { if (line.trim()) out.push(JSON.parse(line)); } catch { /* a line being written */ } }
  return out;
}

const blocks = (e: Entry) => e.message?.content ?? [];
const compact = (t: string) => t.replace(/\s+/g, '');
/** A user message's own words, without the `<timestamp>` and `<user_query>` wrapping Cursor Agent adds. */

/**
 * `afterAgentResponse` glues the turn's text blocks together with nothing between them ("…now.The first…"). The
 * transcript keeps them apart: the same text, a blank line between blocks, when it says exactly the same thing.
 */
export function cursorReply(text: string, entries: Entry[]): string {
  let u = entries.length - 1;
  while (u >= 0 && entries[u]!.role !== 'user') u--;
  const parts = entries.slice(u + 1).filter(e => e.role === 'assistant').flatMap(blocks)
    .filter(b => b.type === 'text' && b.text && b.text !== '[REDACTED]').map(b => b.text!.trim()).filter(Boolean);
  const joined = parts.join('\n\n');
  return parts.length > 1 && compact(joined) === compact(text) ? joined : text;
}

/** A tool call as the agent meant it: `CallDynamicTool { toolName, arguments }` is that tool with those arguments. */
function unwrapTool(name: string | undefined, input: unknown): { name: string | undefined; input: Payload } {
  const i = (input && typeof input === 'object' ? input : {}) as Payload;
  if (name === 'CallDynamicTool' && str(i.toolName)) return { name: str(i.toolName), input: (i.arguments && typeof i.arguments === 'object' ? i.arguments : {}) as Payload };
  return { name, input: i };
}

/**
 * Cursor Agent 2026.10 hooks (`~/.cursor/hooks.json`). They report the turn (prompt, tools, stop, reply) but never
 * an approval, a question or a plan: those come from the pane.
 *
 * Subagents fire no subagentStart/subagentStop. The parent's `preToolUse` for Task names one (`task:<tool_use_id>`,
 * its type and description); the subagent's own hooks carry the subagent's id as `session_id`, but
 * `CURSOR_TRANSCRIPT_PATH` in their environment is the parent's transcript, named after the parent's id. So a hook
 * whose session is not its transcript's is a helper of that transcript's session: each of its tool runs keeps the
 * helper working, the first one taking over the Task's name (see the reducer), and the parent moving on ends it.
 * Without the variable (an older build), the subagent shows by its `generation_id` equal to its `session_id`: tracked,
 * it is still a helper; untracked, its parent is unknown and the hook is dropped rather than make a phantom session.
 */
export function mapCursorHook(eventName: string, payload: unknown, at: string, env: NodeJS.ProcessEnv = process.env): MappedHook | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Payload;
  const sessionId = str(p.session_id) || str(p.conversation_id);
  if (!sessionId) return null;
  const transcript = env.CURSOR_TRANSCRIPT_PATH || undefined;
  const parentId = transcript ? basename(transcript, '.jsonl') : undefined;
  const generation = str(p.generation_id);
  const helper = parentId ? parentId !== sessionId : eventName !== 'sessionStart' && generation === sessionId;
  const id = env.LEDGE_SESSION || (helper ? parentId : sessionId);
  if (!id) return null;
  const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots : [];
  const cwd = str(roots[0]) || undefined;
  const event = helper ? mapCursorHelperEvent(eventName, p, at, sessionId) : mapCursorEvent(eventName, p, at, !!env.LEDGE_SESSION, transcript);
  // The conversation id (what `--resume` takes) rides on the session's own events, never on a subagent's.
  return event ? { id, event: helper || event.helperId ? event : { ...event, agentSessionId: sessionId }, agent: 'cursor', ...(cwd ? { cwd } : {}) } : null;
}

function mapCursorHelperEvent(eventName: string, p: Payload, at: string, helperId: string): SessionEvent | null {
  const base = { at, source: 'hook' as const, helperId };
  const tool = str(p.tool_name);
  switch (eventName) {
    case 'preToolUse': return { name: 'SubagentStart', ...base };
    case 'postToolUse': return { name: 'PostToolUse', ...base, tool };
    case 'postToolUseFailure': return { name: 'PostToolUseFailure', ...base, tool };
    default: return null;
  }
}

function mapCursorEvent(eventName: string, p: Payload, at: string, launched: boolean, transcript: string | undefined): SessionEvent | null {
  const { name: tool, input } = unwrapTool(str(p.tool_name), p.tool_input);
  const toolInput = p.tool_input ? trimInput(input) : undefined; // unwrapTool gives {} for no input
  const base = { at, source: 'hook' as const };
  switch (eventName) {
    case 'sessionStart': return { name: 'SessionStart', ...base };
    case 'beforeSubmitPrompt': return { name: 'UserPromptSubmit', ...base, ...promptText(p) };
    case 'preToolUse': {
      if (tool === 'Task') {
        // The subagent it launches: named here, taken over by the subagent's first hook (its own id).
        const callId = (str(p.tool_use_id) ?? '').split('\n')[0] || at;
        const task = str(input.description) || str(input.prompt)?.split('\n')[0] || '';
        return { name: 'SubagentStart', ...base, helperId: `task:${callId}`, tool: str(input.subagent_type) || 'subagent', ...(task ? { text: task } : {}) };
      }
      return { name: 'PreToolUse', ...base, tool, text: describeCursorTool(input) };
    }
    case 'postToolUse': return { name: 'PostToolUse', ...base, tool, ...(toolInput ? { toolInput } : {}) };
    case 'postToolUseFailure': return { name: 'PostToolUseFailure', ...base, tool, ...(toolInput ? { toolInput } : {}), ...(p.is_interrupt === true ? { interrupt: true } : {}) };
    case 'stop':
      // Ctrl-C sends `aborted` then, some 60 ms later, a stray `error`: the reducer keeps a session at rest there.
      if (str(p.status) === 'error') return { name: 'StopFailure', ...base };
      return { name: 'Stop', ...base };
    case 'afterAgentResponse': {
      // The turn's text, sent once at its end, just before or just after `stop`: a Stop that carries the reply.
      const raw = str(p.text) ?? '';
      const text = lastReply({ last_assistant_message: raw && transcript ? cursorReply(raw, readTranscript(transcript)) : raw });
      return { name: 'Stop', ...base, ...(text ? { text } : {}) };
    }
    case 'sessionEnd':
      // Under the launcher the exit belongs to session.unregister (real exit code) and PaneGone.
      if (launched) return null;
      return { name: 'SessionEnd', ...base, exitCode: null };
    default: return null;
  }
}

type Identity = Pick<Session, 'name' | 'tool' | 'project' | 'cwd'> & Partial<Pick<Session, 'repo' | 'branch' | 'worktree'>>;

/** What a session Ledge launched is told of itself when it starts, resumes or is cleared (#20): its Ledge name, project,
 *  branch and worktree, and how to find the other sessions. A Claude addresses the others by Ledge name: its hook
 *  rewrites that name to the target's live address (Claude's own peer names are not Ledge's). */
export function identityContext(s: Identity): string {
  const where = [`projet ${s.repo ?? s.project}`, ...(s.branch ? [`branche ${s.branch}`] : []), ...(s.worktree ? [`worktree ${basename(s.cwd) || s.cwd}`] : [])].join(', ');
  return [
    `Tu es ${s.name}, ${where} : une session lancée par Ledge (${s.tool}). Les autres sessions Ledge te connaissent sous le nom ${s.name}.`,
    'Pour voir les autres sessions (nom, outil, état, projet, branche, sujet), lance `ledge who`.',
    s.tool === 'claude' ? 'Pour écrire à une autre session Ledge, Claude ou Codex, utilise son nom Ledge (donné par `ledge who`) comme adresse SendMessage : Ledge le transmet. `ListAgents` montre les noms internes de Claude, pas les noms Ledge.'
      : 'Pour écrire à une autre session Ledge, lance `ledge send <nom> "<message>"` (seul, sans && ni |). Ledge exécute lui-même `ledge send`, `ledge read`, `ledge task` et `ledge who` : leur résultat t\'arrive comme « Command blocked by PreToolUse hook: … », c\'est la réponse, pas une erreur.',
    'Un long message d\'une autre session t\'arrive en aperçu avec son id : lance `ledge read <id>` pour le lire en entier. Une `<ledge-notice>` te dit qu\'un de tes messages n\'a pas pu être remis.',
    'Un message sert à prévenir ; pour confier un travail qui ne doit pas se perdre, lance plutôt `ledge task give <nom> "<titre>" "<détail>"` (`ledge task` pour le reste). Une `<ledge-task>` t\'en confie une, ou te dit comment une des tiennes a fini : quand on t\'en confie une, prends-la (`ledge task take <id>`) et termine-la toujours (`ledge task done <id> "<résultat>"`, ou `refuse`).'
  ].join('\n');
}

/** The identity of a launched session: the daemon's record (it follows renames), else LEDGE_NAME and the folder, with
 *  the branch read from git when the daemon has none yet. */
async function identity(agent: Tool, cwd: string | undefined, known: Session | undefined, deadline: number): Promise<Identity | undefined> {
  const name = known?.name ?? process.env.LEDGE_NAME;
  const dir = known?.cwd ?? cwd;
  if (!name || !dir) return undefined;
  const git = known?.branch ? null : await Promise.race([gitInfo(dir).catch(() => null), new Promise<null>(r => setTimeout(() => r(null), Math.max(0, deadline - Date.now())))]);
  return {
    name, tool: known?.tool ?? agent, cwd: dir, project: known?.project ?? (basename(dir) || dir),
    ...(known?.repo ?? git?.repo ? { repo: known?.repo ?? git!.repo } : {}),
    ...(known?.branch ?? git?.branch ? { branch: known?.branch ?? git!.branch } : {}),
    ...(known?.worktree ?? git?.worktree ? { worktree: true } : {})
  };
}

/** A Claude `SendMessage` waits this long for the daemon's ack: the message is typed into a Codex, not just recorded. */
const SEND_MESSAGE_MS = 1500;

const deny = (reason: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

/**
 * Routes a Ledge-launched Claude's `SendMessage`: to a Claude, the real tool proceeds with `to` rewritten to the target's
 * live address and the message naming its sender; to a Codex, the daemon types it and its ack becomes the deny reason
 * (delivered or queued: it went through Ledge). A dead or ambiguous target is refused; an unknown one, a sender Ledge
 * did not launch, or any failure leaves the real tool to proceed unchanged.
 */
async function relayMessage(client: Client, from: string, toolUseId: string | undefined, input: Payload, deadline: number): Promise<string | undefined> {
  if (!toolUseId) return undefined;
  const left = () => Math.max(0, deadline - Date.now());
  const to = input.to as string;
  const snapshot = await client.next('snapshot', left());
  const sender = snapshot.sessions.find(s => s.id === from);
  if (sender?.source !== 'launcher') return undefined;
  const r = resolveTarget(to, snapshot.sessions, readPeers());
  if (r.outcome === 'unknown') return undefined;
  if (r.outcome === 'refused') return deny(`Ledge n'a pas pu transmettre le message à ${to} : ${r.reason}`);
  if (r.outcome === 'native') {
    // Already named when Ledge's hook runs twice (installed in user and project settings): never twice.
    const note = messageNote(sender.name, 'claude');
    const named = (text: string) => (text.startsWith(note) ? text : `${note} ${text}`);
    const updatedInput = { ...input, to: r.address, message: named(input.message as string), ...(typeof input.content === 'string' ? { content: named(input.content) } : {}) };
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } });
  }
  const tool = r.target.tool;
  // Too long for Ledge: a Codex, a Cursor or an OMP can only be reached through it, refused below with the length
  // (Claude's own tool, which cannot reach them, would only fail later).
  const summary = str(input.summary);
  const ack = await sendMessageAndAwaitAck(client, { type: 'session.message', rid: toolUseId, from, to, text: input.message as string, ...(summary ? { summary } : {}), intercept: true }, left());
  const target = `${to} (${tool})`;
  const reason = ack.outcome === 'accepted' ? `Message transmis par Ledge à ${target} : il le reçoit maintenant.`
    : ack.outcome === 'queued' ? `Message transmis par Ledge à ${target} : il le recevra dès qu'il sera libre.`
    : ack.outcome === 'refused' ? `Ledge n'a pas pu transmettre le message à ${to} : ${ack.reason ?? 'raison inconnue'}` : undefined;
  return reason ? deny(reason) : undefined;
}

/**
 * Codex's shell cannot reach the daemon, its hook can: a lone `ledge send` / `ledge who` is run here and its output is the deny
 * reason the agent reads, sent on the hook's own connection so the daemon already knows the sender. A failure leaves the command to proceed; a send that got no ack is reported
 * (the message may be delivered), not retried by the sandbox.
 */
async function runLedgeCommand(client: Client, cmd: NonNullable<ReturnType<typeof parseLedgeCommand>>, from: string, deadline: number): Promise<string | undefined> {
  const left = () => Math.max(0, deadline - Date.now());
  let line: string;
  if (cmd.cmd === 'who') line = formatWho((await client.next('snapshot', left())).sessions, from);
  else if (cmd.cmd === 'read') line = (await readOnClient(client, cmd.args, from, left())).line;
  else if (cmd.cmd === 'task') line = (await taskOnClient(client, cmd.args, from, left())).line;
  else line = (await sendOnClient(client, cmd.args, from, left())).line;
  return deny(line);
}

/**
 * Always resolves, always fast: a hook must never slow the agent down. Resolves with what the hook prints for the agent:
 * on SessionStart, a session Ledge launched gets its identity as `additionalContext` (Claude Code and Codex read it);
 * that one hook waits for the daemon's snapshot, within a second.
 */
export async function runHook(eventName: string, stdin: string, opts: { port?: number; timeoutMs?: number; tool?: Tool } = {}): Promise<string | undefined> {
  const agent = opts.tool ?? 'claude';
  const label = agent === 'claude' ? eventName : `${agent} ${eventName}`;
  // Ledge's own chat runs Claude Code headless: its hooks (if any ran) must never make a session.
  if (process.env.LEDGE_CHAT === '1') { log(`hook ${label} ignored: Ledge chat`); return undefined; }
  let mapped: MappedHook | null = null;
  let identify = false; let known: Session | undefined; let deadline = Date.now() + (opts.timeoutMs ?? 100);
  let relayed: string | undefined;
  try {
    const payload = JSON.parse(stdin || '{}');
    mapped = agent === 'cursor' ? mapCursorHook(eventName, payload, new Date().toISOString()) : mapHook(agent, eventName, payload, new Date().toISOString());
    if (!mapped) { log(`hook ${label} ignored: unknown event, malformed payload, non-terminal SessionEnd or subagent event without a session of its own`); return undefined; }
    const launchedId = agent === 'codex' ? codexLedgeId() : agent === 'claude' ? process.env.LEDGE_SESSION : undefined;
    identify = eventName === 'SessionStart' && !!launchedId && mapped.id === launchedId;
    const input = ((payload as Payload).tool_input ?? {}) as Payload;
    const intercept = agent === 'claude' && eventName === 'PreToolUse' && str((payload as Payload).tool_name) === 'SendMessage'
      && typeof input.to === 'string' && typeof input.message === 'string' && !!input.message;
    const command = agent === 'codex' && eventName === 'PreToolUse' && str((payload as Payload).tool_name) === 'Bash' && typeof input.command === 'string'
      ? parseLedgeCommand(input.command) : undefined;
    const timeoutMs = opts.timeoutMs ?? (identify ? 1000 : intercept || command ? SEND_MESSAGE_MS : 100);
    deadline = Date.now() + timeoutMs;
    const client = await connect({ port: opts.port, timeoutMs });
    client.send({ type: 'session.event', id: mapped.id, event: mapped.event, agent: mapped.agent, ...(mapped.cwd ? { cwd: mapped.cwd } : {}) });
    if (identify) known = (await client.next('snapshot', Math.max(0, deadline - Date.now())).catch(() => undefined))?.sessions.find(s => s.id === mapped!.id);
    if (intercept) relayed = await relayMessage(client, mapped.id, str((payload as Payload).tool_use_id), input, deadline);
    if (command) relayed = await runLedgeCommand(client, command, mapped.id, deadline);
    // close() resolves once the handshake completes, i.e. after the send is flushed; one shared deadline
    await Promise.race([client.close(), new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now())))]);
  } catch (e) {
    log(`hook ${label} dropped: ${(e as Error).message}`);
  }
  if (relayed) return relayed;
  if (!identify || !mapped) return undefined;
  const who = await identity(agent, mapped.cwd, known, deadline);
  return who ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: identityContext(who) } }) : undefined;
}
