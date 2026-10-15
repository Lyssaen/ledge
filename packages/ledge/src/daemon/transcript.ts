import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Native tracking (spec 2026-10-13 §2, §4): the agent's own messages, read from the tail of what the harness writes. */
export type AgentText = { id: string; at: string; text: string };
export const TAIL_BYTES = 512 * 1024;

/** The last `bytes` of a JSONL file as whole lines: a line cut by the window, or still being written, is dropped. */
export function tailLines(path: string, bytes = TAIL_BYTES): string[] {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return []; }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift();
    if (!text.endsWith('\n')) lines.pop();
    return lines.filter(l => l.trim());
  } finally { closeSync(fd); }
}

type Block = { type?: string; text?: string };
const texts = (blocks: unknown, kind: string): string =>
  (Array.isArray(blocks) ? blocks as Block[] : []).filter(b => b?.type === kind && typeof b.text === 'string').map(b => b.text!.trim()).filter(Boolean).join('\n\n');

/** `sidechain`: the file is a helper's own transcript. Claude Code marks every entry of it `isSidechain: true`, so the
 *  filter that keeps a helper's lines out of the main transcript would leave a helper with no message at all. */
export function agentMessages(path: string, opts: { sidechain?: boolean; bytes?: number } = {}): AgentText[] {
  const out: AgentText[] = [];
  for (const line of tailLines(path, opts.bytes ?? TAIL_BYTES)) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const at = typeof e.timestamp === 'string' ? e.timestamp : undefined;
    if (!at) continue;
    // Claude Code: an assistant entry's text blocks. Thinking and tool_use are not messages; in the main transcript,
    // sidechains belong to helpers. A helper's transcript is read whole.
    if (e.type === 'assistant' && (opts.sidechain || e.isSidechain !== true)) {
      const text = texts((e.message as { content?: unknown } | undefined)?.content, 'text');
      if (text && typeof e.uuid === 'string') out.push({ id: e.uuid, at, text });
      continue;
    }
    // Codex: a completed AgentMessage item. The response_item lines repeat it and are skipped.
    if (e.type === 'event_msg') {
      const p = e.payload as { type?: string; item?: { type?: string; id?: string; content?: unknown } } | undefined;
      const item = p?.type === 'item_completed' ? p.item : undefined;
      if (item?.type !== 'AgentMessage' || typeof item.id !== 'string') continue;
      const text = texts(item.content, 'Text');
      if (text) out.push({ id: item.id, at, text });
    }
  }
  return out;
}

/** Codex in Plan mode ends its turn with a null `last_assistant_message`: the plan it proposed is that turn's completed
 *  `Plan` item in the rollout (the plain text; the assistant message wraps it in `<proposed_plan>` tags). */
export function codexPlan(path: string, turnId: string): string | undefined {
  let plan: string | undefined;
  for (const line of tailLines(path)) {
    let e: { type?: string; payload?: { type?: string; turn_id?: string; item?: { type?: string; text?: unknown } } };
    try { e = JSON.parse(line); } catch { continue; }
    const p = e.payload;
    if (e.type === 'event_msg' && p?.type === 'item_completed' && p.turn_id === turnId && p.item?.type === 'Plan' && typeof p.item.text === 'string') plan = p.item.text.trim() || plan;
  }
  return plan;
}

/** Claude Code names a project folder after its cwd, every character but letters and digits a dash. Past 200 characters
 *  it shortens the name with a hash of its own: no path rather than a wrong one. */
const CLAUDE_DIR_MAX = 200;

/** Where Claude Code writes the transcript of session `id` started in `cwd` (`CLAUDE_CONFIG_DIR`, else ~/.claude). */
export function claudeTranscriptPath(cwd: string, id: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (dir.length > CLAUDE_DIR_MAX) return undefined;
  return join(env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude'), 'projects', dir, `${id}.jsonl`);
}

/** The plan Claude Code waits to have approved: the input of the last ExitPlanMode call of the main thread that has no
 *  result yet (one with a result was answered: an older plan is never shown for the current one). */
export function claudePlan(path: string): string | undefined {
  let plan: { id: string; text: string } | undefined;
  for (const line of tailLines(path)) {
    let e: { type?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain === true || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message!.content as Array<{ type?: string; id?: string; name?: string; tool_use_id?: string; input?: { plan?: unknown } }>) {
      if (e.type === 'assistant' && b?.type === 'tool_use' && b.name === 'ExitPlanMode' && typeof b.id === 'string' && typeof b.input?.plan === 'string' && b.input.plan.trim()) plan = { id: b.id, text: b.input.plan.trim() };
      else if (e.type === 'user' && b?.type === 'tool_result' && plan && b.tool_use_id === plan.id) plan = undefined;
    }
  }
  return plan?.text;
}
