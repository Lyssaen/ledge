import { spawn } from 'node:child_process';
import { repositoryId } from '../git.js';

/**
 * One way to run `gh`, `glab` and `git` for the forge reads and the chat (lot 8a): no shell, a text body on standard input (never
 * in argv), bounded output and time. Nothing here throws: a binary that cannot start answers `code: null`.
 */

export type ForgeCli = 'gh' | 'glab';
export type ForgeRunResult = { code: number | null; stdout: string; stderr: string };
export type ForgeRun = (file: ForgeCli | 'git', args: string[], opts?: { cwd?: string; input?: string; timeoutMs?: number }) => Promise<ForgeRunResult>;

const MAX_OUTPUT = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

/** `maxOutput`: the bound on stdout and stderr together (4 MB; a test gives a small one). */
export function execForge(env: () => Promise<NodeJS.ProcessEnv>, opts0: { maxOutput?: number } = {}): ForgeRun {
  const max = opts0.maxOutput ?? MAX_OUTPUT;
  return async (file, args, opts = {}) => {
    // No prompt, no colour, no update notice: the CLIs print plain JSON to a pipe. glab's prompt switch is GLAB_NO_PROMPT, and a
    // NO_PROMPT left over from the login shell is dropped: glab 1.99 prints its deprecation warning on stdout, before the JSON.
    const { NO_PROMPT: _deprecated, ...base } = await env();
    const e = { ...base, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GLAB_NO_PROMPT: '1', GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false', NO_COLOR: '1', CLICOLOR: '0' };
    return new Promise<ForgeRunResult>(res => {
      let settled = false;
      const done = (r: ForgeRunResult): void => { if (!settled) { settled = true; clearTimeout(timer); res(r); } };
      const out: Buffer[] = [], err: Buffer[] = [];
      let size = 0, why = '';
      const child = spawn(file, args, { cwd: opts.cwd, env: e, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      const timer = setTimeout(() => { why = `timed out after ${Math.round((opts.timeoutMs ?? TIMEOUT_MS) / 1000)} s`; child.kill('SIGKILL'); }, opts.timeoutMs ?? TIMEOUT_MS);
      timer.unref();
      const take = (into: Buffer[]) => (d: Buffer): void => {
        size += d.length;
        if (size > max) { if (!why) { why = `output over ${max >= 1024 * 1024 ? `${Math.round(max / 1024 / 1024)} MB` : `${max} bytes`}`; child.kill('SIGKILL'); } return; }
        into.push(d);
      };
      child.stdout.on('data', take(out));
      child.stderr.on('data', take(err));
      child.on('error', (x: NodeJS.ErrnoException) => done({ code: x.code === 'ENOENT' ? null : 1, stdout: '', stderr: x.message }));
      child.on('close', code => {
        const stderr = Buffer.concat(err).toString('utf8');
        done({ code: why ? (code && code !== 0 ? code : 1) : (code ?? 1), stdout: why ? '' : Buffer.concat(out).toString('utf8'), stderr: why ? `${stderr}\n${file}: ${why}`.trim() : stderr });
      });
      child.stdin.on('error', () => { /* the CLI may exit before reading its input */ });
      child.stdin.end(opts.input ?? '');
    });
  };
}

/** A repository path a forge CLI reads as a path, never as a flag: segments that start with a letter or a digit. */
export const SAFE_PATH = /^[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)+$/;

export interface ForgeRepo { cli: ForgeCli; host: string; path: string; repo: string }
/** The forge of a remote URL, credentials left out: `gh` for a GitHub host, `glab` (by URL, self-hosted included) otherwise. */
export function forgeOf(remote: string): ForgeRepo | null {
  const id = repositoryId(remote);
  if (!id) return null;
  const slash = id.indexOf('/');
  const host = id.slice(0, slash), path = id.slice(slash + 1);
  if (!host || !SAFE_PATH.test(path)) return null;
  if (host === 'github.com') return { cli: 'gh', host, path, repo: path };
  if (/(^|\.)github\./.test(host)) return { cli: 'gh', host, path, repo: `${host}/${path}` };
  return { cli: 'glab', host, path, repo: `https://${host}/${path}` };
}

/** Text without what looks like a token or a credential, for the fronts, the chat's files and the logs. */
export function redact(text: string): string {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|gl[a-z]{1,5}-[A-Za-z0-9_-]{16,})/g, '[redacted]')
    .replace(/\b(Bearer|token|Basic)\s+[^\s'"]+/gi, '$1 [redacted]')
    .replace(/\b((?:access_|private_)?token|password|secret)=[^\s&'"]+/gi, '$1=[redacted]')
    .replace(/(\w+:\/\/)[^\s/@]+@/g, '$1[redacted]@');
}

const NOT_LOGGED = /auth login|not logged|authenticat|unauthori[sz]ed|\(HTTP 401\)/i;
/** The HTTP status `glab api` / `gh api` print in stderr: `glab` exits 0 on an HTTP error (Task 0). */
const HTTP_ERROR = /\(HTTP [45]\d\d\)/;
/** What a run says of the forge: its CLI missing, not signed in, another error, or fine. */
export function classify(r: { code: number | null; stderr: string }): 'ok' | 'missing' | 'unauthenticated' | 'error' {
  if (r.code === null) return 'missing';
  if (r.code === 0 && !HTTP_ERROR.test(r.stderr)) return 'ok';
  if (NOT_LOGGED.test(r.stderr) && !/rate limit/i.test(r.stderr)) return 'unauthenticated';
  return 'error';
}

/** A run's error, short and redacted, for `forges[].message` and the log. */
export function errorText(r: ForgeRunResult, cli: string): string {
  if (r.code === null) return `${cli} is not installed on this machine`;
  const t = redact(r.stderr.trim().split('\n').filter(Boolean).slice(0, 3).join(' ')).slice(0, 400);
  return t || `${cli} exited with code ${r.code}`;
}

/** The last `n` lines of a job's log: no ANSI, no timestamp nor stream prefix, no `##[debug]` line nor GitLab section marker, redacted. */
export function logTail(text: string, n = 60): string {
  const lines = text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map(l => l.replace(/\r/g, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z (?:\d\d[OE]\+? ?)?/, '').trimEnd())
    .filter(l => l && !l.startsWith('##[debug]') && !/^section_(?:start|end):\d+:/.test(l));
  return redact(lines.slice(-n).join('\n'));
}
