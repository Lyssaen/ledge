import { open } from 'node:fs/promises';
import type { Context, Session } from '@ledge/protocol';

/** How much of a transcript's end is read for its last usage: a turn's last lines, never the whole file. */
const TAIL_BYTES = 512 * 1024;
/** Claude Code's window for an older model, and the long one: a model launched with `[1m]`, or Opus, Sonnet and Fable
 *  from the Claude 5 family on (Claude Code gives them 1 000 000 without the suffix: `context_window_size`). */
const CLAUDE_WINDOW = 200_000;
const CLAUDE_LONG_WINDOW = 1_000_000;
const LONG_BY_DEFAULT = /^claude-(?:opus|sonnet|fable)-(\d+)/;

/** Whether a Claude model, the transcript's (`claude-opus-5-5`) or the one Ledge launched (`opus[1m]`), has the long window. */
function longWindow(model: string | undefined): boolean {
  if (!model) return false;
  if (model.includes('[1m]')) return true;
  const m = LONG_BY_DEFAULT.exec(model);
  return !!m && Number(m[1]) >= 5;
}

type Usage = Omit<Context, 'at'>;
type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

/** The last lines of a file, whole ones only (the first, likely cut, is dropped when the file is longer than the tail). */
async function tail(path: string): Promise<string[]> {
  const f = await open(path, 'r');
  try {
    const { size } = await f.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await f.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    return start > 0 ? lines.slice(1) : lines;
  } finally { await f.close(); }
}

/**
 * Claude Code: the last assistant message outside a side chain (a subagent's context is not the session's); its
 * `usage` is the whole prompt it was given plus its answer. The model it names, a model launched with `[1m]`, or a use
 * already past 200 000 tells the long window.
 */
export function claudeUsage(lines: readonly string[], model?: string): Usage | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.includes('"usage"')) continue;
    let e: Json;
    try { e = JSON.parse(line) as Json; } catch { continue; }
    if (e.type !== 'assistant' || e.isSidechain === true) continue;
    const u = obj(obj(e.message)?.usage);
    if (!u) continue;
    const used = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens) + num(u.output_tokens);
    if (used === 0) continue;
    const msgModel = obj(e.message)?.model;
    const long = longWindow(model) || longWindow(typeof msgModel === 'string' ? msgModel : undefined) || used > CLAUDE_WINDOW;
    const window = long ? CLAUDE_LONG_WINDOW : CLAUDE_WINDOW;
    return { used, window };
  }
  return undefined;
}

/** Codex: the last `token_count` event of the rollout, which names the model's window itself. */
export function codexUsage(lines: readonly string[]): Usage | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.includes('token_count')) continue;
    let e: Json;
    try { e = JSON.parse(line) as Json; } catch { continue; }
    const p = obj(e.payload) ?? e;
    if (p.type !== 'token_count') continue;
    const info = obj(p.info);
    const last = obj(info?.last_token_usage);
    const window = num(info?.model_context_window);
    if (!last || window <= 0) continue;
    const used = num(last.total_tokens) || num(last.input_tokens) + num(last.output_tokens);
    if (used === 0) continue;
    return { used, window };
  }
  return undefined;
}

/** A session's context, read from its transcript (context handover spec §3.1); undefined when it cannot be told. */
export async function readContext(s: Pick<Session, 'tool' | 'transcriptPath' | 'model'>, at: string): Promise<Context | undefined> {
  if (!s.transcriptPath || (s.tool !== 'claude' && s.tool !== 'codex')) return undefined;
  let lines: string[];
  try { lines = await tail(s.transcriptPath); } catch { return undefined; }
  const u = s.tool === 'claude' ? claudeUsage(lines, s.model) : codexUsage(lines);
  return u ? { ...u, at } : undefined;
}
