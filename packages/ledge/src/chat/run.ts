import { spawn as nodeSpawn } from 'node:child_process';
import type { ClaudeEvent, RunHandle } from './claude.js';

/** Spawns a CLI, feeds `question` on stdin, and turns each stdout line into chat events. */
export function runJsonl(
  file: string, args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; question: string },
  parse: (line: string) => ClaudeEvent[],
  onEvent: (e: ClaudeEvent) => void,
  spawnImpl: typeof nodeSpawn = nodeSpawn
): RunHandle {
  const child = spawnImpl(file, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let stderr = '';
  const feed = (line: string) => { for (const e of parse(line)) onEvent(e); };
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (c: string) => { stderr = (stderr + c).slice(-2000); });
  const done = new Promise<{ code: number | null; stderr: string }>(res => {
    child.on('error', e => { stderr = `${stderr}${e.message}`.slice(-2000); res({ code: null, stderr }); });
    child.on('close', code => { if (buf.trim()) feed(buf); res({ code, stderr }); });
  });
  child.stdin!.on('error', () => { /* the child exited before reading: close reports it */ });
  child.stdin!.end(o.question);
  return { done, kill: () => { child.kill('SIGTERM'); } };
}
