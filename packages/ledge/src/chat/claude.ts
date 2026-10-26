import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ImageMime } from '@ledge/protocol';
import { runJsonl } from './run.js';
import { buildPersona } from './persona.js';

/** Who Ledge is when it answers, on Claude Code (spec 2026-10-26 action registry §4). */
export const PERSONA = buildPersona('claude');

export interface RunOptions {
  persona?: string;
  question: string; cwd: string; addDirs: string[]; sessionId: string; resume: boolean; env: NodeJS.ProcessEnv;
  /** The executable and its leading arguments (`['claude']` by default; tests pass `[node, fake-claude.mjs]`). */
  bin?: string[]; maxTurns?: number;
  /** OMP only: where the day's conversation lives (its `--session-dir`); none keeps nothing. */
  sessionDir?: string;
  /** The images attached to the question, as files on disk. */
  images?: Array<{ path: string; mime: ImageMime }>;
}

/** `claude -p` headless, restricted to reading (spec §5.2); the question goes on stdin, never in argv. */
export function claudeArgs(o: RunOptions): string[] {
  return ['-p', '--restricted', '--tools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--max-turns', String(o.maxTurns ?? 16), '--append-system-prompt', o.persona ?? PERSONA, ...o.addDirs.flatMap(d => ['--add-dir', d]), ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
    ...(o.images?.length ? ['--input-format', 'stream-json'] : [])];
}

/** The stdin of a question with images (`--input-format stream-json`): one user message, the text then each image inline as base64, one JSON line. */
export function claudeInput(question: string, images: NonNullable<RunOptions['images']>): string {
  const content = [{ type: 'text', text: question },
    ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: readFileSync(i.path).toString('base64') } }))];
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

export type ClaudeEvent = { type: 'init'; sessionId: string } | { type: 'tool'; tool: string; path?: string } | { type: 'delta'; text: string } | { type: 'result'; text: string; isError: boolean };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** One stream-json line as Ledge events (a message can hold several tool uses); nothing for the lines Ledge does not use. */
export function parseLine(line: string): ClaudeEvent[] {
  let m: Json; try { m = obj(JSON.parse(line)); } catch { return []; }
  if (m.type === 'system' && m.subtype === 'init' && str(m.session_id)) return [{ type: 'init', sessionId: str(m.session_id)! }];
  if (m.type === 'stream_event') {
    const ev = obj(m.event); const d = obj(ev.delta);
    return ev.type === 'content_block_delta' && d.type === 'text_delta' && str(d.text) !== undefined ? [{ type: 'delta', text: str(d.text)! }] : [];
  }
  if (m.type === 'assistant') {
    const content = obj(m.message).content;
    return (Array.isArray(content) ? content : []).map(obj).filter(b => b.type === 'tool_use').map(b => { const i = obj(b.input); const path = str(i.file_path) ?? str(i.path); return { type: 'tool' as const, tool: String(b.name ?? ''), ...(path ? { path } : {}) }; });
  }
  if (m.type === 'result') return [{ type: 'result', text: str(m.result) ?? '', isError: m.is_error === true || (m.subtype !== undefined && m.subtype !== 'success') }];
  return [];
}

export interface RunHandle { done: Promise<{ code: number | null; stderr: string }>; kill(): void }

/** Spawns Claude Code and feeds every stream line to `onEvent`; `done` resolves with the exit code and the tail of stderr. */
export function runClaude(o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawnImpl: typeof nodeSpawn = nodeSpawn): RunHandle {
  const [file = 'claude', ...pre] = o.bin ?? ['claude'];
  return runJsonl(file, [...pre, ...claudeArgs(o)], { cwd: o.cwd, env: o.env, question: o.question, ...(o.images?.length ? { stdin: claudeInput(o.question, o.images) } : {}) }, parseLine, onEvent, spawnImpl);
}
