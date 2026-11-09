import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatStep, Projects } from '@ledge/protocol';
import { execForge, forgeOf, redact, type ForgeCli, type ForgeRepo } from '../daemon/forge/run.js';
import { signedInHosts } from '../daemon/forge/hosts.js';
import { log } from '../log.js';

export { forgeOf, redact, type ForgeRepo };

/**
 * What the chat may know of GitHub and GitLab (#23): the daemon runs a closed list of `list` commands of `gh` / `glab` for the
 * repositories of the projects on this machine (their `origin` remote), and writes what they print, dated, beside sessions.md.
 * The chat keeps its read-only tools: it never runs a forge command itself, and nothing here can write to a forge.
 */

export type Cli = ForgeCli;
/** Runs `file args` without a shell; `code` null when the binary could not start. Never throws. */
export type ForgeRun = (file: ForgeCli | 'git', args: string[], cwd?: string) => Promise<{ code: number | null; stdout: string; stderr: string }>;

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

/** A question the forge files can help with: issues, pull/merge requests, CI, what was merged. */
export function asksForge(question: string): boolean {
  return /\b(?:issues?|tickets?|PRs?|pull[- ]?requests?|MRs?|merge[- ]?requests?|merg\w*|CI|pipelines?|workflows?|github|gitlab|forge|actions|builds?|checks?|releases?)\b|demandes? de fusion/i.test(question);
}

/** The shared runner, with the chat's own timeout. */
const execRun = (env: () => Promise<NodeJS.ProcessEnv>): ForgeRun => {
  const run = execForge(env);
  return (file, args, cwd) => run(file, args, { cwd, timeoutMs: TIMEOUT_MS });
};

export interface ForgeDeps { run?: ForgeRun; env?: () => Promise<NodeJS.ProcessEnv>; now?: () => string; ttlMs?: number;
  /** The hosts each CLI is signed in to (signedInHosts by default, read at each write); a test gives its own. */ signedIn?: (cli: Cli) => Promise<Set<string>> }
export interface Forge {
  /**
   * Writes `forge.md` and a `forge-<project>.md` per project into the chat's folder and registers them as steps; nothing without
   * projects. `read: false` runs no forge command: what was read before is written, dated, whatever its age, and a repository never
   * read says so (a question that does not name issues, PR/MR or CI never waits on the network, yet the chat never takes a missing
   * file for no access).
   */
  write(ctx: { dir: string; steps: Map<string, ChatStep> }, projects: Projects, opts?: { read?: boolean }): Promise<void>;
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
  const env = deps.env ?? (async () => process.env);
  const run = deps.run ?? execRun(env);
  const signedIn = deps.signedIn ?? (async (cli: Cli) => signedInHosts(cli, await env()));
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
  async function section(path: string, read: boolean, hosts: (cli: Cli) => Promise<Set<string>>): Promise<{ lines: string[]; source?: string }> {
    const remote = await run('git', ['config', '--get', 'remote.origin.url'], path);
    const f = remote.code === 0 ? forgeOf(remote.stdout) : null;
    if (!f) return { lines: [`# ${path}`, '', 'This repository has no GitHub or GitLab remote (origin): nothing to read.', ''] };
    // Never a host the CLI is not signed in to (as the daemon's forge service, 0ada7cd2): a repository cloned from anywhere must not
    // make Ledge call that host with the machine's credentials. Said so, so the chat never reads it as « no issue, no PR ».
    if (!(await hosts(f.cli)).has(f.host.toLowerCase())) {
      return { lines: [`# ${f.host}/${f.path} — not read`, `Local repository: ${path}`, '', `\`${f.cli}\` is not signed in to ${f.host} on this machine: Ledge does not read this forge. This says nothing about its issues, pull/merge requests or CI.`, ''], source: `${f.host}/${f.path}` };
    }
    const r = read ? await reads(f) : cache.get(f.repo);
    if (!r) return { lines: [`# ${f.host}/${f.path} — not read yet`, `Local repository: ${path}`, '', 'Ledge reads this forge when a question is about issues, pull/merge requests or CI: nothing was read for this one.', ''], source: `${f.host}/${f.path}` };
    return { lines: [`# ${f.host}/${f.path} — read at ${r.at}`, `Local repository: ${path}`, '', ...r.lines], source: `${f.host}/${f.path}` };
  }

  return {
    async write(ctx, projects, opts = {}) {
      const read = opts.read ?? true;
      if (projects.projects.length === 0) return;
      // Each CLI's signed-in hosts, read once for this write.
      const memo = new Map<Cli, Promise<Set<string>>>();
      const hosts = (cli: Cli): Promise<Set<string>> => { let p = memo.get(cli); if (!p) { p = signedIn(cli).catch(() => new Set<string>()); memo.set(cli, p); } return p; };
      const index = ['# GitHub / GitLab', '', 'What the daemon read from the forges of each project\'s repositories on this machine (open issues, pull/merge requests, CI). Each file says when it was read.', ''];
      await Promise.all(projects.projects.map(async p => {
        const local = p.repos.filter(r => r.machine === 'local');
        const file = `forge-${p.id}.md`;
        const name = p.name.replace(/\s*[\r\n]+\s*/g, ' ').trim();
        if (local.length === 0) { index.push(`- ${name}: no repository on this machine`); return; }
        const parts = await Promise.all(local.map(r => section(r.path, read, hosts)));
        await writeFile(join(ctx.dir, file), parts.flatMap(s => s.lines).join('\n'));
        const sources = parts.flatMap(s => (s.source ? [s.source] : []));
        ctx.steps.set(file, { kind: 'repo', name, path: sources.join(', ') || file });
        index.push(`- ${name}: ${file}`);
      }));
      await writeFile(join(ctx.dir, 'forge.md'), [...index, ''].join('\n'));
    }
  };
}
