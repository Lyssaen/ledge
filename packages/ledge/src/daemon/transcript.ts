import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

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

export function agentMessages(path: string, bytes = TAIL_BYTES): AgentText[] {
  const out: AgentText[] = [];
  for (const line of tailLines(path, bytes)) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const at = typeof e.timestamp === 'string' ? e.timestamp : undefined;
    if (!at) continue;
    // Claude Code: an assistant entry's text blocks. Thinking and tool_use are not messages; sidechains belong to helpers.
    if (e.type === 'assistant' && e.isSidechain !== true) {
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
