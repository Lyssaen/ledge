import { appendFileSync, closeSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { ledgeTitleRest } from '../names.js';

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

/** Latest transient thinking excerpt for the office floor. It is read from a bounded tail and never persisted by Ledge. */
export function agentThought(path: string): string | undefined {
  let latest: string | undefined;
  for (const line of tailLines(path, 64 * 1024)) {
    let e: { type?: string; isSidechain?: boolean; message?: { content?: unknown }; payload?: { type?: string; item?: { type?: string; text?: unknown; summary?: unknown; content?: unknown } } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'assistant' && e.isSidechain !== true) latest = texts(e.message?.content, 'thinking') || latest;
    if (e.type === 'event_msg' && (e.payload?.type === 'item_completed' || e.payload?.type === 'item_updated')) {
      const item = e.payload.item;
      if (item?.type === 'AgentReasoning') latest = (typeof item.text === 'string' ? item.text : typeof item.summary === 'string' ? item.summary : texts(item.content, 'Text')) || latest;
    }
  }
  return latest?.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;
}

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

type ToolBlock = { type?: string; id?: string; name?: string; tool_use_id?: string };
/** The main thread's tool calls in the transcript, each with whether its result came. */
function claudeCalls(path: string): Array<{ id: string; name: string; answered: boolean }> {
  const calls: Array<{ id: string; name: string; answered: boolean }> = [];
  for (const line of tailLines(path)) {
    let e: { type?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain === true || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message!.content as ToolBlock[]) {
      if (e.type === 'assistant' && b?.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') calls.push({ id: b.id, name: b.name, answered: false });
      else if (e.type === 'user' && b?.type === 'tool_result') { const c = calls.find(c => c.id === b.tool_use_id); if (c) c.answered = true; }
    }
  }
  return calls;
}

/** The call of `tool` Claude Code waits on (the dialog on screen is its own): the last main-thread one, when it has no
 *  result yet. Claude Code writes the call before it asks. */
export function claudeOpenCall(path: string, tool: string): string | undefined {
  const last = claudeCalls(path).filter(c => c.name === tool).at(-1);
  return last && !last.answered ? last.id : undefined;
}

/** Whether the call `id` has its result in the transcript: the agent took the answer (#35). */
export function claudeToolAnswered(path: string, id: string): boolean {
  return claudeCalls(path).some(c => c.id === id && c.answered);
}

const LABEL_MAX = 80;
/** What `claude --resume` shows for a Ledge session: « name - topic » on one line, cut to LABEL_MAX characters. */
export function resumeLabel(name: string, topic: string): string {
  const label = `${name} - ${topic}`.replace(/\s+/g, ' ').trim();
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

type Title = { customTitle: string; ledge?: unknown };
/** The last `custom-title` entry of `lines`; only the lines that name one are parsed (a whole transcript can be read). */
function lastTitle(lines: readonly string[]): Title | undefined {
  let last: Title | undefined;
  for (const line of lines) {
    if (!line.includes('"custom-title"')) continue;
    try { const e = JSON.parse(line) as { type?: string; customTitle?: unknown; ledge?: unknown }; if (e.type === 'custom-title' && typeof e.customTitle === 'string') last = { customTitle: e.customTitle, ledge: e.ledge }; } catch { /* not an entry */ }
  }
  return last;
}

/** Whether a conversation title is Ledge's to replace: marked by Ledge, `name` or « name - … », or a bare Ledge-shaped
 *  name (the `-n` title of a launch before the change, or of a conversation continued under another Ledge name). */
const ledgeOwned = (t: Title, name: string): boolean =>
  t.ledge === true || t.customTitle.startsWith(`${name} - `) || ledgeTitleRest(t.customTitle, name) === '';

/** Appends Ledge's marked `custom-title` of `label` to an exited Claude's transcript, unless it already ends so or the
 *  user named the session (a last title that is not Ledge's). Whether it wrote, or the error that stopped it; never throws. */
export function labelTranscript(path: string, name: string, label: string): boolean | Error {
  try {
    const last = lastTitle(tailLines(path)) ?? (statSync(path).size > TAIL_BYTES ? lastTitle(readFileSync(path, 'utf8').split('\n')) : undefined);
    if (last && (last.customTitle === label || !ledgeOwned(last, name))) return false;
    const fd = openSync(path, 'r');
    let lead = '';
    try {
      const size = fstatSync(fd).size;
      if (size > 0) { const b = Buffer.alloc(1); readSync(fd, b, 0, 1, size - 1); if (b[0] !== 10) lead = '\n'; }
    } finally { closeSync(fd); }
    appendFileSync(path, `${lead}${JSON.stringify({ type: 'custom-title', customTitle: label, sessionId: basename(path, '.jsonl'), ledge: true })}\n`);
    return true;
  } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
}
