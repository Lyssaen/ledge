import type { SessionEvent } from '@ledge/protocol';
import { connect } from '../client.js';
import { log } from '../log.js';

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function describeTool(tool: string | undefined, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Payload;
  if (tool === 'Bash') return str(i.command) ?? '';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'Read') return str(i.file_path) ?? '';
  if (tool === 'ExitPlanMode') return str(i.plan)?.split('\n')[0] ?? 'plan';
  return str(i.description) ?? JSON.stringify(i).slice(0, 200);
}

/** SessionEnd reasons after which the same agent process keeps running (Claude Code 2.1). */
const NON_TERMINAL_END_REASONS = new Set(['clear', 'resume']);

export function mapClaudeHook(eventName: string, payload: unknown, at: string): { id: string; event: SessionEvent } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Payload;
  const launched = !!process.env.LEDGE_SESSION;
  const id = process.env.LEDGE_SESSION || str(p.session_id);
  if (!id) return null;
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
      return { id, event: { name: eventName, ...base, ...(type ? { tool: type } : {}), ...(task ? { text: task } : {}) } };
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': return { id, event: { name: eventName, ...base, tool } };
    case 'StopFailure': {
      const error = str(p.error); const details = str(p.error_details);
      const text = [error, details].filter(Boolean).join(': ').slice(0, 300) || undefined;
      return { id, event: { name: 'StopFailure', ...base, ...(text ? { text } : {}) } };
    }
    case 'SessionStart': return { id, event: { name: 'SessionStart', ...base } };
    case 'UserPromptSubmit': return { id, event: { name: 'UserPromptSubmit', ...base } };
    case 'Stop': return { id, event: { name: 'Stop', ...base } };
    case 'SessionEnd':
      // Under the launcher, the exit belongs to session.unregister (real exit code) and PaneGone:
      // Claude's SessionEnd also fires on /clear, /resume and logout while the process lives on.
      if (launched) return null;
      if (NON_TERMINAL_END_REASONS.has(str(p.reason) ?? '')) return null;
      return { id, event: { name: 'SessionEnd', ...base, exitCode: null } };
    case 'PermissionRequest': return { id, event: { name: 'PermissionRequest', ...base, tool, text: describeTool(tool, p.tool_input) } };
    case 'PreToolUse': {
      if (tool === 'AskUserQuestion') {
        const qs = ((p.tool_input as Payload | undefined)?.questions as Array<Payload> | undefined) ?? [];
        const q = qs[0];
        const options = ((q?.options as Array<Payload> | undefined) ?? []).map(o => str(o.label) ?? '').filter(Boolean);
        return { id, event: { name: 'PreToolUse', ...base, tool, text: str(q?.question) ?? '', options } };
      }
      return { id, event: { name: 'PreToolUse', ...base, tool, text: describeTool(tool, p.tool_input) } };
    }
    case 'Notification': {
      const type = str(p.notification_type) ?? '';
      const message = str(p.message) ?? '';
      const kind = type === 'permission_prompt' || /permission/i.test(message) ? 'permission' : undefined;
      return { id, event: { name: 'Notification', ...base, kind, text: message } };
    }
    default: return null;
  }
}

/** Always resolves, always fast: a hook must never slow the agent down. */
export async function runHook(eventName: string, stdin: string, opts: { port?: number; timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  try {
    const payload = JSON.parse(stdin || '{}');
    const mapped = mapClaudeHook(eventName, payload, new Date().toISOString());
    if (!mapped) { log(`hook ${eventName} ignored: unknown event, malformed payload, non-terminal SessionEnd or subagent event without agent_id`); return; }
    const client = await connect({ port: opts.port, timeoutMs });
    client.send({ type: 'session.event', id: mapped.id, event: mapped.event });
    // close() resolves once the handshake completes, i.e. after the send is flushed; one shared deadline
    await Promise.race([client.close(), new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now())))]);
  } catch (e) {
    log(`hook ${eventName} dropped: ${(e as Error).message}`);
  }
}
