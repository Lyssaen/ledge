import { REPLY_MAX, REPLY_TRUNCATION_MARK, type SessionEvent, type Tool } from '@ledge/protocol';
import { connect } from '../client.js';
import { log } from '../log.js';
import { QUESTION_TOOLS } from '../daemon/state.js';
import { codexPlan } from '../daemon/transcript.js';
import { readFileSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CODEX_ENV_VAR, CODEX_HOOK_VAR } from '../spawn.js';

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The longest prompt kept: the phone thread shows it whole, and the reducer cuts the topic candidate to one line of TOPIC_MAX. */
const PROMPT_MAX = 4_000;
/** Claude Code hands a backgrounded helper's report back as a prompt: that text is the report, capped like a tool input. */
const handBack = (t: string) => t.startsWith('<agent-message from="');
const promptText = (p: Payload) => { const t = str(p.prompt)?.trim(); return t ? { text: t.slice(0, handBack(t) ? INPUT_MAX : PROMPT_MAX) } : {}; };

/** Claude's own words for what a Bash command is for (`tool_input.description`). */
function bashReason(tool: string | undefined, input: unknown): { reason?: string } {
  if (tool !== 'Bash') return {};
  const reason = str((input as Payload | null | undefined)?.description);
  return reason ? { reason } : {};
}

function describeTool(tool: string | undefined, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Payload;
  if (tool === 'Bash') return str(i.command) ?? '';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'Read') return str(i.file_path) ?? '';
  if (tool === 'ExitPlanMode') return str(i.plan)?.split('\n')[0] ?? 'plan';
  // Codex: the patch names its files on `*** Update File: <path>` (Add, Delete) lines.
  if (tool === 'apply_patch') {
    const files = [...(str(i.command) ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(m => m[1]!.trim());
    return files.length ? files.join(', ') : 'patch';
  }
  return str(i.description) ?? JSON.stringify(i).slice(0, 200);
}

/** The longest reply kept from a Stop hook: enough for a long report, never a whole transcript. */
export { REPLY_MAX };
/** The agent's last message (Claude Code 2.1: `last_assistant_message` on Stop), trimmed and capped. */
function lastReply(p: Payload): string | undefined {
  return cap(str(p.last_assistant_message)?.trim());
}

function cap(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX)}${REPLY_TRUNCATION_MARK}` : text;
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
  return { id, event: task ? { ...event, task } : event, agent, ...(cwd ? { cwd } : {}) };
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
    case 'PermissionRequest': return { name: 'PermissionRequest', ...base, tool, text: describeTool(tool, p.tool_input), ...bashReason(tool, p.tool_input), ...call, ...transcript };
    case 'PreToolUse': {
      if (tool && QUESTION_TOOLS.has(tool)) {
        const qs = ((p.tool_input as Payload | undefined)?.questions as Array<Payload> | undefined) ?? [];
        const q = qs[0];
        const opts = ((q?.options as Array<Payload> | undefined) ?? []).filter(o => !!str(o.label));
        const options = opts.map(o => str(o.label)!);
        const optionDetails = opts.map(o => str(o.description)?.trim() ?? '');
        return { name: 'PreToolUse', ...base, tool, text: str(q?.question) ?? '', options, ...(optionDetails.some(Boolean) ? { optionDetails } : {}), ...call, ...transcript };
      }
      return { name: 'PreToolUse', ...base, tool, text: describeTool(tool, p.tool_input), ...bashReason(tool, p.tool_input), ...call, ...transcript };
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
  return event ? { id, event, agent: 'cursor', ...(cwd ? { cwd } : {}) } : null;
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

/** Always resolves, always fast: a hook must never slow the agent down. */
export async function runHook(eventName: string, stdin: string, opts: { port?: number; timeoutMs?: number; tool?: Tool } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  const agent = opts.tool ?? 'claude';
  const label = agent === 'claude' ? eventName : `${agent} ${eventName}`;
  // Ledge's own chat runs Claude Code headless: its hooks (if any ran) must never make a session.
  if (process.env.LEDGE_CHAT === '1') { log(`hook ${label} ignored: Ledge chat`); return; }
  try {
    const payload = JSON.parse(stdin || '{}');
    const mapped = agent === 'cursor' ? mapCursorHook(eventName, payload, new Date().toISOString()) : mapHook(agent, eventName, payload, new Date().toISOString());
    if (!mapped) { log(`hook ${label} ignored: unknown event, malformed payload, non-terminal SessionEnd or subagent event without a session of its own`); return; }
    const client = await connect({ port: opts.port, timeoutMs });
    client.send({ type: 'session.event', id: mapped.id, event: mapped.event, agent: mapped.agent, ...(mapped.cwd ? { cwd: mapped.cwd } : {}) });
    // close() resolves once the handshake completes, i.e. after the send is flushed; one shared deadline
    await Promise.race([client.close(), new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now())))]);
  } catch (e) {
    log(`hook ${label} dropped: ${(e as Error).message}`);
  }
}
