import { open } from 'node:fs/promises';
import type { Context, Session, UsageWindow } from '@ledge/protocol';

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

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() && v.length <= 80 ? v.trim() : undefined);

/** Claude Code: the model and effort of the last assistant message outside a side chain (`message.model`, `effort`). */
export function claudeTurn(lines: readonly string[]): { model?: string; effort?: string } {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.includes('"assistant"')) continue;
    let e: Json;
    try { e = JSON.parse(line) as Json; } catch { continue; }
    if (e.type !== 'assistant' || e.isSidechain === true) continue;
    const model = str(obj(e.message)?.model);
    // A synthetic message (an error, a local command) names no real model.
    if (!model || model.startsWith('<')) continue;
    const effort = str(e.effort);
    return { model, ...(effort ? { effort } : {}) };
  }
  return {};
}

/** Codex: the model and effort of the last `turn_context`. */
export function codexTurn(lines: readonly string[]): { model?: string; effort?: string } {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.includes('turn_context')) continue;
    let e: Json;
    try { e = JSON.parse(line) as Json; } catch { continue; }
    if (e.type !== 'turn_context') continue;
    const p = obj(e.payload) ?? {};
    const model = str(p.model), effort = str(p.effort);
    if (!model && !effort) continue;
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }
  return {};
}

/** Codex's limits as its last `token_count` reports them: the 5 hours (300 minutes) and the week (10 080), each `used_percent`
 *  and `resets_at` (epoch seconds; `resets_in_seconds` from an older CLI). No window: it reports none (a plan without windows).
 *  undefined: no dated `token_count` with `rate_limits` in the part read. `at`: when it was reported, kept for an empty one too,
 *  so an older reading never replaces a newer one. */
export function codexLimits(lines: readonly string[]): { windows: UsageWindow[]; at: string } | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.includes('rate_limits')) continue;
    let e: Json;
    try { e = JSON.parse(line) as Json; } catch { continue; }
    const p = obj(e.payload) ?? e;
    if (p.type !== 'token_count' || !('rate_limits' in p)) continue;
    const rl = obj(p.rate_limits);
    const at = typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp)) ? new Date(e.timestamp).toISOString() : undefined;
    if (!at) continue;
    if (!rl) return { windows: [], at };
    const windows: UsageWindow[] = [];
    for (const key of ['primary', 'secondary'] as const) {
      const w = obj(rl[key]);
      if (!w || typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent)) continue;
      const minutes = num(w.window_minutes);
      const kind = minutes === 300 ? 'five_hour' : minutes === 10_080 ? 'seven_day' : key === 'primary' ? 'five_hour' : 'seven_day';
      const resets = typeof w.resets_at === 'number' && w.resets_at > 0 ? new Date(w.resets_at * 1000)
        : typeof w.resets_in_seconds === 'number' && w.resets_in_seconds >= 0 ? new Date(Date.parse(at) + w.resets_in_seconds * 1000) : null;
      windows.push({ kind, pct: Math.max(0, Math.min(1000, Math.round(w.used_percent))), resetsAt: resets && !Number.isNaN(resets.getTime()) ? resets.toISOString() : null });
    }
    windows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'five_hour' ? -1 : 1));
    return { windows, at };
  }
  return undefined;
}

/** What a turn's end tells about a session, from one read of its transcript's end: its context, the model and effort it runs,
 *  and, for Codex, the account's limits. Each part undefined when it cannot be told. */
export interface TurnInfo { context?: Context; model?: string; effort?: string; codexLimits?: { windows: UsageWindow[]; at: string } }
export async function readTurn(s: Pick<Session, 'tool' | 'transcriptPath' | 'model'>, at: string): Promise<TurnInfo> {
  if (!s.transcriptPath || (s.tool !== 'claude' && s.tool !== 'codex')) return {};
  let lines: string[];
  try { lines = await tail(s.transcriptPath); } catch { return {}; }
  if (s.tool === 'claude') {
    const u = claudeUsage(lines, s.model);
    return { ...(u ? { context: { ...u, at } } : {}), ...claudeTurn(lines) };
  }
  const u = codexUsage(lines);
  const limits = codexLimits(lines);
  return { ...(u ? { context: { ...u, at } } : {}), ...codexTurn(lines), ...(limits !== undefined ? { codexLimits: limits } : {}) };
}

/** A session's context, read from its transcript (context handover spec §3.1); undefined when it cannot be told. */
export async function readContext(s: Pick<Session, 'tool' | 'transcriptPath' | 'model'>, at: string): Promise<Context | undefined> {
  return (await readTurn(s, at)).context;
}
