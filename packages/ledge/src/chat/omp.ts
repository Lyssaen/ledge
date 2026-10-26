import { spawn as nodeSpawn } from 'node:child_process';
import { PERSONA, type ClaudeEvent, type RunHandle, type RunOptions } from './claude.js';
import { runJsonl } from './run.js';

/**
 * Ask Ledge run by OMP (spec 2026-10-20 §2, §7): `omp -p --mode json`, a distinct path from the sessions OMP drives for the
 * user. Read-only is the tool whitelist (read, grep, glob: no bash, edit, write, task, web) with no extension, skill or rule
 * loaded, never a promise of the approval mode. The day's conversation is the last one of its own session directory
 * (`--continue`); a run with no directory (the routing) keeps nothing.
 */
export function ompChatArgs(o: RunOptions & { sessionDir?: string }): string[] {
  return ['-p', '--mode', 'json', '--tools', 'read,grep,glob', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--approval-mode', 'always-ask',
    '--append-system-prompt', o.persona ?? PERSONA, ...o.addDirs.flatMap(d => ['--add-dir', d]),
    ...(o.sessionDir ? ['--session-dir', o.sessionDir, ...(o.resume ? ['--continue'] : [])] : ['--no-session']),
    ...(o.images ?? []).map(i => `@${i.path}`)];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** One `--mode json` line as Ledge events: the session id, each read, the text as it comes, and each message as the answer so far. */
export function parseOmpLine(line: string): ClaudeEvent[] {
  let m: Json; try { m = obj(JSON.parse(line)); } catch { return []; }
  if (m.type === 'session' && str(m.id)) return [{ type: 'init', sessionId: str(m.id)! }];
  if (m.type === 'tool_execution_start') {
    const path = str(obj(m.args).path);
    return [{ type: 'tool', tool: String(m.toolName ?? 'tool'), ...(path ? { path } : {}) }];
  }
  if (m.type === 'message_update') {
    const e = obj(m.assistantMessageEvent);
    return e.type === 'text_delta' && str(e.delta) !== undefined ? [{ type: 'delta', text: str(e.delta)! }] : [];
  }
  if (m.type === 'message_end') {
    const msg = obj(m.message);
    if (msg.role !== 'assistant') return [];
    const blocks = Array.isArray(msg.content) ? msg.content.map(obj) : [];
    const text = blocks.filter(b => b.type === 'text').map(b => str(b.text) ?? '').join('');
    if (msg.stopReason === 'error') return [{ type: 'result', text: str(msg.errorMessage) ?? (text || ''), isError: true }];
    return text ? [{ type: 'result', text, isError: false }] : [];
  }
  return [];
}

export function runOmp(o: RunOptions & { sessionDir?: string }, onEvent: (e: ClaudeEvent) => void, spawnImpl: typeof nodeSpawn = nodeSpawn): RunHandle {
  const [file = 'omp', ...pre] = o.bin ?? ['omp'];
  return runJsonl(file, [...pre, ...ompChatArgs(o)], { cwd: o.cwd, env: o.env, question: o.question }, parseOmpLine, onEvent, spawnImpl);
}
