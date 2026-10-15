import { spawn as nodeSpawn } from 'node:child_process';
import { PERSONA, parseLine, type ClaudeEvent, type RunHandle, type RunOptions } from './claude.js';
import { runJsonl } from './run.js';

/** `cursor-agent -p --mode ask`: read-only print mode, repos as extra workspace roots, no --force. */
export function cursorArgs(o: RunOptions): string[] {
  return ['-p', '--mode', 'ask', '--output-format', 'stream-json', '--stream-partial-output', '--sandbox', 'enabled', '--trust',
    '--workspace', o.cwd, ...o.addDirs.flatMap(d => ['--add-dir', d]), ...(o.resume ? ['--resume', o.sessionId] : [])];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Cursor stream-json, plus the Claude-shaped lines the CLI still emits. */
export function parseCursorLine(line: string): ClaudeEvent[] {
  const known = parseLine(line);
  if (known.length) return known;
  let m: Json; try { m = obj(JSON.parse(line)); } catch { return []; }
  if (m.type === 'tool_call') {
    const call = obj(m.tool_call);
    const read = obj(call.readToolCall);
    const args = obj(read.args ?? call.args);
    const path = str(args.path) ?? str(args.file_path);
    return [{ type: 'tool', tool: read.args ? 'Read' : String(call.name ?? 'tool'), ...(path ? { path } : {}) }];
  }
  if (m.type === 'assistant') {
    const content = obj(m.message).content;
    return (Array.isArray(content) ? content : []).map(obj).filter(b => b.type === 'text' && str(b.text)).map(b => ({ type: 'delta' as const, text: str(b.text)! }));
  }
  return [];
}

export function runCursor(o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawnImpl: typeof nodeSpawn = nodeSpawn): RunHandle {
  const [file = 'cursor-agent', ...pre] = o.bin ?? ['cursor-agent'];
  return runJsonl(file, [...pre, ...cursorArgs(o)], { cwd: o.cwd, env: o.env, question: `${o.persona ?? PERSONA}\n\n${o.question}` }, parseCursorLine, onEvent, spawnImpl);
}
