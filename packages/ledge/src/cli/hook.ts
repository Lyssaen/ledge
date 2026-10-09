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

export function mapClaudeHook(eventName: string, payload: unknown, at: string): { id: string; event: SessionEvent } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Payload;
  const id = process.env.LEDGE_SESSION || str(p.session_id);
  if (!id) return null;
  const tool = str(p.tool_name);
  const base = { at, source: 'hook' as const };
  switch (eventName) {
    case 'SessionStart': return { id, event: { name: 'SessionStart', ...base } };
    case 'UserPromptSubmit': return { id, event: { name: 'UserPromptSubmit', ...base } };
    case 'Stop': return { id, event: { name: 'Stop', ...base } };
    case 'SessionEnd': return { id, event: { name: 'SessionEnd', ...base, exitCode: null } };
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
    if (!mapped) { log(`hook ${eventName} ignored: unknown event or malformed payload`); return; }
    const client = await connect({ port: opts.port, timeoutMs });
    client.send({ type: 'session.event', id: mapped.id, event: mapped.event });
    // close() resolves once the handshake completes, i.e. after the send is flushed; one shared deadline
    await Promise.race([client.close(), new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now())))]);
  } catch (e) {
    log(`hook ${eventName} dropped: ${(e as Error).message}`);
  }
}
