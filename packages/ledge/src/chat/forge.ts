import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatStep, Projects } from '@ledge/protocol';
import { repositoryId } from '../daemon/git.js';
import { log } from '../log.js';

/**
 * What the chat may know of GitHub and GitLab (#23): the daemon runs a closed list of `list` commands of `gh` / `glab` for the
 * repositories of the projects on this machine (their `origin` remote), and writes what they print, dated, beside sessions.md.
 * The chat keeps its read-only tools: it never runs a forge command itself, and nothing here can write to a forge.
 */

export type Cli = 'gh' | 'glab';
/** Runs `file args` without a shell; `code` null when the binary could not start. Never throws. */
export type ForgeRun = (file: string, args: string[], cwd?: string) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/** The only commands ever run: reads, each followed by `-R <repository>`. */
export const FORGE_COMMANDS: Record<Cli, ReadonlyArray<{ title: string; args: readonly string[] }>> = {
  gh: [
    { title: 'Open issues', args: ['issue', 'list', '--state', 'open', '--limit', '20'] },
    { title: 'Open pull requests', args: ['pr', 'list', '--state', 'open', '--limit', '20'] },
    { title: 'Recently merged pull requests', args: ['pr', 'list', '--state', 'merged', '--limit', '10'] },
    { title: 'Recent workflow runs (CI)', args: ['run', 'list', '--limit', '10'] }
  ],
  glab: [
    { title: 'Open issues', args: ['issue', 'list', '--per-page', '20'] },
    { title: 'Open merge requests', args: ['mr', 'list', '--per-page', '20'] },
    { title: 'Recently merged merge requests', args: ['mr', 'list', '--merged', '--per-page', '10'] },
    { title: 'Recent pipelines (CI)', args: ['ci', 'list', '--per-page', '10'] }
  ]
};

/** How long a repository's reads are reused. */
export const FORGE_TTL_MS = 120_000;
const TIMEOUT_MS = 15_000;
/** A repository path a forge CLI reads as a path, never as a flag: segments that start with a letter or a digit. */
const SAFE_PATH = /^[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)+$/;

export interface ForgeRepo { cli: Cli; host: string; path: string; repo: string }
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

/** Text without what looks like a token or a credential, for the chat's files and the logs. */
export function redact(text: string): string {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|gl[a-z]{1,5}-[A-Za-z0-9_-]{16,})/g, '[redacted]')
    .replace(/\b(Bearer|token|Basic)\s+[^\s'"]+/gi, '$1 [redacted]')
    .replace(/\b((?:access_|private_)?token|password|secret)=[^\s&'"]+/gi, '$1=[redacted]')
    .replace(/(\w+:\/\/)[^\s/@]+@/g, '$1[redacted]@');
}

/** A question the forge files can help with: issues, pull/merge requests, CI, what was merged. */
export function asksForge(question: string): boolean {
  return /\b(?:issues?|tickets?|PRs?|pull[- ]?requests?|MRs?|merge[- ]?requests?|merg\w*|CI|pipelines?|workflows?|github|gitlab|forge|actions)\b/i.test(question);
}

const execRun = (env: () => Promise<NodeJS.ProcessEnv>): ForgeRun => async (file, args, cwd) => {
  // No prompt, no colour, no update notice: the CLIs print plain rows to a pipe.
  const e = { ...(await env()), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_PROMPT: '1', GLAB_CHECK_UPDATE: 'false', NO_COLOR: '1', CLICOLOR: '0' };
  return new Promise(res => {
    execFile(file, args, { cwd, env: e, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = !err ? 0 : (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : typeof err.code === 'number' ? err.code : 1;
      res({ code, stdout: String(stdout), stderr: String(stderr) || (err && code === null ? err.message : '') });
    });
  });
};

export interface ForgeDeps { run?: ForgeRun; env?: () => Promise<NodeJS.ProcessEnv>; now?: () => string; ttlMs?: number }
export interface Forge {
  /** Writes `forge.md` and a `forge-<project>.md` per project into the chat's folder and registers them as steps; nothing without projects. */
  write(ctx: { dir: string; steps: Map<string, ChatStep> }, projects: Projects): Promise<void>;
}

const NOT_LOGGED = /auth login|not logged|authenticat|unauthori[sz]ed|\b401\b|\b403\b/i;
/** One repository's reads: each command's rows, or why the forge could not be read at all. */
async function readRepo(run: ForgeRun, f: ForgeRepo): Promise<string[]> {
  const out: string[] = [];
  for (const c of FORGE_COMMANDS[f.cli]) {
    const r = await run(f.cli, [...c.args, '-R', f.repo]);
    if (r.code === null) return [`\`${f.cli}\` is not installed on this machine: Ledge cannot read ${f.host}.`];
    if (r.code !== 0 && NOT_LOGGED.test(r.stderr)) return [`\`${f.cli}\` is not logged in to ${f.host} on this machine (\`${f.cli} auth login\`): Ledge cannot read it.`];
    const cmd = `${f.cli} ${c.args.join(' ')}`;
    if (r.code !== 0) { log(`forge: ${cmd} failed for ${f.host}/${f.path} (code ${r.code})`); out.push(`## ${c.title}`, `\`${cmd}\` failed: ${redact(r.stderr.trim().split('\n').slice(0, 3).join(' ')) || `exit code ${r.code}`}`, ''); continue; }
    out.push(`## ${c.title}`, `\`${cmd}\``, '', '```', redact(r.stdout.trimEnd()) || '(none)', '```', '');
  }
  return out;
}

export function createForge(deps: ForgeDeps = {}): Forge {
  const run = deps.run ?? execRun(deps.env ?? (async () => process.env));
  const now = deps.now ?? (() => new Date().toISOString());
  const ttl = deps.ttlMs ?? FORGE_TTL_MS;
  /** Each repository's last reads, by forge repository. */
  const cache = new Map<string, { at: string; lines: string[] }>();

  async function reads(f: ForgeRepo): Promise<{ at: string; lines: string[] }> {
    const hit = cache.get(f.repo);
    if (hit && Date.parse(now()) - Date.parse(hit.at) < ttl) return hit;
    const fresh = { at: now(), lines: await readRepo(run, f) };
    cache.set(f.repo, fresh);
    return fresh;
  }
  async function section(path: string): Promise<{ lines: string[]; source?: string }> {
    const remote = await run('git', ['config', '--get', 'remote.origin.url'], path);
    const f = remote.code === 0 ? forgeOf(remote.stdout) : null;
    if (!f) return { lines: [`# ${path}`, '', 'This repository has no GitHub or GitLab remote (origin): nothing to read.', ''] };
    const r = await reads(f);
    return { lines: [`# ${f.host}/${f.path} — read at ${r.at}`, `Local repository: ${path}`, '', ...r.lines], source: `${f.host}/${f.path}` };
  }

  return {
    async write(ctx, projects) {
      if (projects.projects.length === 0) return;
      const index = ['# GitHub / GitLab', '', 'What the daemon read from the forges of each project\'s repositories on this machine (open issues, pull/merge requests, CI). Each file says when it was read.', ''];
      await Promise.all(projects.projects.map(async p => {
        const local = p.repos.filter(r => r.machine === 'local');
        const file = `forge-${p.id}.md`;
        const name = p.name.replace(/\s*[\r\n]+\s*/g, ' ').trim();
        if (local.length === 0) { index.push(`- ${name}: no repository on this machine`); return; }
        const parts = await Promise.all(local.map(r => section(r.path)));
        await writeFile(join(ctx.dir, file), parts.flatMap(s => s.lines).join('\n'));
        const sources = parts.flatMap(s => (s.source ? [s.source] : []));
        ctx.steps.set(file, { kind: 'repo', name, path: sources.join(', ') || file });
        index.push(`- ${name}: ${file}`);
      }));
      await writeFile(join(ctx.dir, 'forge.md'), [...index, ''].join('\n'));
    }
  };
}
