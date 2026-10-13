import { spawn as nodeSpawn } from 'node:child_process';
import { PERSONA, type ClaudeEvent, type RunHandle, type RunOptions } from './claude.js';
import { runJsonl } from './run.js';

/** `codex exec` headless, read-only; the prompt is stdin (`-`), never made writable via `--add-dir`. */
export function codexArgs(o: RunOptions): string[] {
  const flags = ['--sandbox', 'read-only', '--json', '--skip-git-repo-check', '--ignore-user-config', '-C', o.cwd, '-c', 'sandbox_permissions=["disk-full-read-access"]', '-'];
  return o.resume ? ['exec', 'resume', o.sessionId, ...flags] : ['exec', ...flags];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const pathIn = (s: string) => s.match(/(\/\S+)/)?.[1];

/** One Codex exec --json line as Ledge events. */
export function parseCodexLine(line: string): ClaudeEvent[] {
  let m: Json; try { m = obj(JSON.parse(line)); } catch { return []; }
  if (m.type === 'thread.started' && str(m.thread_id)) return [{ type: 'init', sessionId: str(m.thread_id)! }];
  const item = obj(m.item);
  if (m.type === 'item.started' || m.type === 'item.completed') {
    if (item.type === 'agent_message' && str(item.text)) {
      const text = str(item.text)!;
      return [{ type: 'delta', text }, { type: 'result', text, isError: false }];
    }
    const command = str(item.command);
    const path = command ? pathIn(command) : str(item.path) ?? str(obj(item.changes).path);
    if (item.type && item.type !== 'agent_message') return [{ type: 'tool', tool: String(item.type), ...(path ? { path } : {}) }];
  }
  if (m.type === 'turn.failed' || m.type === 'error') {
    const err = obj(m.error);
    return [{ type: 'result', text: str(err.message) ?? str(m.message) ?? '', isError: true }];
  }
  return [];
}

export function runCodex(o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawnImpl: typeof nodeSpawn = nodeSpawn): RunHandle {
  const [file = 'codex', ...pre] = o.bin ?? ['codex'];
  return runJsonl(file, [...pre, ...codexArgs(o)], { cwd: o.cwd, env: o.env, question: `${o.persona ?? PERSONA}\n\n${o.question}` }, parseCodexLine, onEvent, spawnImpl);
}
