import type { SessionEvent, Tool } from '@ledge/protocol';
import { connect } from '../client.js';
import { log } from '../log.js';
import { QUESTION_TOOLS } from '../daemon/state.js';
import { readFileSync } from 'node:fs';
import { CODEX_ENV_VAR, CODEX_HOOK_VAR } from '../spawn.js';

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

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
export const REPLY_MAX = 24_000;
/** The agent's last message (Claude Code 2.1: `last_assistant_message` on Stop), trimmed and capped. */
function lastReply(p: Payload): string | undefined {
  const text = str(p.last_assistant_message)?.trim();
  if (!text) return undefined;
  return text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX)}\n\n[…]` : text;
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
  return event ? { id, event, agent, ...(cwd ? { cwd } : {}) } : null;
}

function mapEvent(eventName: string, p: Payload, at: string, launched: boolean): SessionEvent | null {
  const tool = str(p.tool_name);
  // agent_id is present only when the hook fires inside a subagent (absent on the main thread, even with --agent).
  const agentId = str(p.agent_id) || undefined;
  const base = { at, source: 'hook' as const, ...(agentId ? { helperId: agentId } : {}) };
  switch (eventName) {
    case 'SubagentStart':
    case 'SubagentStop': {
      // Here agent_id names the helper itself. 2.1 sends no task; description/prompt are read if a later version adds them.
      if (!agentId) return null;
      const type = str(p.agent_type) || undefined;
      const task = eventName === 'SubagentStart' ? (str(p.description) || str(p.prompt))?.split('\n')[0] : undefined;
      return { name: eventName, ...base, ...(type ? { tool: type } : {}), ...(task ? { text: task } : {}) };
    }
    case 'PostToolUse': return { name: 'PostToolUse', ...base, tool };
    case 'PostToolUseFailure': return { name: 'PostToolUseFailure', ...base, tool, ...(p.is_interrupt === true ? { interrupt: true } : {}) };
    case 'StopFailure': {
      const error = str(p.error); const details = str(p.error_details);
      const text = [error, details].filter(Boolean).join(': ').slice(0, 300) || undefined;
      return { name: 'StopFailure', ...base, ...(text ? { text } : {}) };
    }
    // Codex: Esc on a running turn or on an approval. Like Claude's interrupted tool run, no Stop follows.
    case 'Interrupt': return { name: 'PostToolUseFailure', ...base, interrupt: true };
    case 'SessionStart': return { name: 'SessionStart', ...base };
    case 'UserPromptSubmit': return { name: 'UserPromptSubmit', ...base };
    case 'Stop': {
      const text = lastReply(p);
      return { name: 'Stop', ...base, ...(text ? { text } : {}) };
    }
    case 'SessionEnd':
      // Under the launcher, the exit belongs to session.unregister (real exit code) and PaneGone:
      // Claude's SessionEnd also fires on /clear, /resume and logout while the process lives on.
      if (launched) return null;
      if (NON_TERMINAL_END_REASONS.has(str(p.reason) ?? '')) return null;
      return { name: 'SessionEnd', ...base, exitCode: null };
    case 'PermissionRequest': return { name: 'PermissionRequest', ...base, tool, text: describeTool(tool, p.tool_input) };
    case 'PreToolUse': {
      if (tool && QUESTION_TOOLS.has(tool)) {
        const qs = ((p.tool_input as Payload | undefined)?.questions as Array<Payload> | undefined) ?? [];
        const q = qs[0];
        const options = ((q?.options as Array<Payload> | undefined) ?? []).map(o => str(o.label) ?? '').filter(Boolean);
        return { name: 'PreToolUse', ...base, tool, text: str(q?.question) ?? '', options };
      }
      return { name: 'PreToolUse', ...base, tool, text: describeTool(tool, p.tool_input) };
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

/** Always resolves, always fast: a hook must never slow the agent down. */
export async function runHook(eventName: string, stdin: string, opts: { port?: number; timeoutMs?: number; tool?: Tool } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  const agent = opts.tool ?? 'claude';
  const label = agent === 'claude' ? eventName : `${agent} ${eventName}`;
  try {
    const payload = JSON.parse(stdin || '{}');
    const mapped = mapHook(agent, eventName, payload, new Date().toISOString());
    if (!mapped) { log(`hook ${label} ignored: unknown event, malformed payload, non-terminal SessionEnd or subagent event without agent_id`); return; }
    const client = await connect({ port: opts.port, timeoutMs });
    client.send({ type: 'session.event', id: mapped.id, event: mapped.event, agent: mapped.agent, ...(mapped.cwd ? { cwd: mapped.cwd } : {}) });
    // close() resolves once the handshake completes, i.e. after the send is flushed; one shared deadline
    await Promise.race([client.close(), new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now())))]);
  } catch (e) {
    log(`hook ${label} dropped: ${(e as Error).message}`);
  }
}
