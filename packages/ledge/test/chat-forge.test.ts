import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Projects } from '@ledge/protocol';
import { FORGE_COMMANDS, asksForge, createForge, forgeOf, redact, type ForgeRun } from '../src/chat/forge.js';

const T = '2026-10-19T09:00:00.000Z';
const projects = (repos: Array<{ machine: string; path: string }>, name = 'Ledge'): Projects =>
  ({ projects: [{ id: 'ledge', name, color: 'blue', description: '', repos }], rules: [] });

/** A runner answering `git config` with the folder's remote and recording every forge call. */
function fakeRun(remotes: Record<string, string>, answer: (file: string, args: string[]) => { code: number | null; stdout?: string; stderr?: string } = () => ({ code: 0, stdout: 'row\n' })) {
  const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
  const run: ForgeRun = async (file, args, cwd) => {
    if (file === 'git') return remotes[cwd!] !== undefined ? { code: 0, stdout: remotes[cwd!]!, stderr: '' } : { code: 1, stdout: '', stderr: '' };
    calls.push({ file, args, cwd });
    const r = answer(file, args);
    return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { run, calls };
}
const ctx = () => ({ dir: mkdtempSync(join(tmpdir(), 'ctx-')), steps: new Map() });

describe('forgeOf', () => {
  it('github.com goes to gh as owner/repo, another GitHub host as host/owner/repo, the rest to glab by URL', () => {
    expect(forgeOf('git@github.com:Lyssaen/ledge.git')).toEqual({ cli: 'gh', host: 'github.com', path: 'Lyssaen/ledge', repo: 'Lyssaen/ledge' });
    expect(forgeOf('https://github.example.com/a/b')).toMatchObject({ cli: 'gh', repo: 'github.example.com/a/b' });
    expect(forgeOf('https://gitlab.speos.lan/group/sub/proj.git')).toEqual({ cli: 'glab', host: 'gitlab.speos.lan', path: 'group/sub/proj', repo: 'https://gitlab.speos.lan/group/sub/proj' });
  });
  it('never keeps credentials from the remote, and refuses what could read as a flag', () => {
    expect(forgeOf('https://oauth2:glpat-SECRET@gitlab.com/g/p.git')).toEqual({ cli: 'glab', host: 'gitlab.com', path: 'g/p', repo: 'https://gitlab.com/g/p' });
    expect(forgeOf('/srv/git/repo.git')).toBeNull();
    expect(forgeOf('https://github.com/-x/--y')).toBeNull();
    expect(forgeOf('https://github.com/only')).toBeNull();
  });
});

describe('the commands are a closed list of reads', () => {
  it('every command is a « list », never api, and no write verb appears', () => {
    for (const cli of ['gh', 'glab'] as const) for (const c of FORGE_COMMANDS[cli]) {
      expect(['issue', 'pr', 'run', 'mr', 'ci']).toContain(c.args[0]);
      expect(c.args[1]).toBe('list');
      expect(c.args.join(' ')).not.toMatch(/\b(api|create|close|merge|delete|edit|comment|approve|rerun|cancel|retry|-X)\b/);
    }
  });
  it('the runner receives only those commands, with the repository after -R', async () => {
    const { run, calls } = fakeRun({ '/w/ledge': 'git@github.com:Lyssaen/ledge.git\n' });
    await createForge({ run, now: () => T }).write(ctx(), projects([{ machine: 'local', path: '/w/ledge' }]));
    expect(calls.map(c => [c.file, ...c.args])).toEqual(FORGE_COMMANDS.gh.map(c => ['gh', ...c.args, '-R', 'Lyssaen/ledge']));
  });
});

describe('forge files', () => {
  it('writes a dated forge-<project>.md per project and an index, and registers them as steps', async () => {
    const { run } = fakeRun({ '/w/ledge': 'https://github.com/Lyssaen/ledge\n' }, (_f, args) => ({ code: 0, stdout: `${args[0]} ${args.slice(2).join(' ')} → 42\tOPEN\tFix it\n` }));
    const c = ctx();
    await createForge({ run, now: () => T }).write(c, projects([{ machine: 'local', path: '/w/ledge' }, { machine: 'nas', path: '/srv/other' }]));
    const file = readFileSync(join(c.dir, 'forge-ledge.md'), 'utf8');
    expect(file).toContain(`read at ${T}`);
    expect(file).toContain('github.com/Lyssaen/ledge');
    expect(file).toContain('42\tOPEN\tFix it');
    expect(file).not.toContain('/srv/other');
    expect(readFileSync(join(c.dir, 'forge.md'), 'utf8')).toContain('Ledge: forge-ledge.md');
    expect(c.steps.get('forge-ledge.md')).toEqual({ kind: 'repo', name: 'Ledge', path: 'github.com/Lyssaen/ledge' });
  });
  it('says when gh is missing, not logged in, or the repository has no forge remote', async () => {
    const missing = fakeRun({ '/w/a': 'git@github.com:o/a.git' }, () => ({ code: null, stderr: 'spawn gh ENOENT' }));
    let c = ctx(); await createForge({ run: missing.run, now: () => T }).write(c, projects([{ machine: 'local', path: '/w/a' }]));
    expect(readFileSync(join(c.dir, 'forge-ledge.md'), 'utf8')).toContain('`gh` is not installed');
    expect(missing.calls).toHaveLength(1);

    const logged = fakeRun({ '/w/a': 'git@gitlab.com:g/a.git' }, () => ({ code: 1, stderr: 'glab: 401 Unauthorized. Run glab auth login' }));
    c = ctx(); await createForge({ run: logged.run, now: () => T }).write(c, projects([{ machine: 'local', path: '/w/a' }]));
    expect(readFileSync(join(c.dir, 'forge-ledge.md'), 'utf8')).toContain('`glab` is not logged in to gitlab.com');

    const none = fakeRun({});
    c = ctx(); await createForge({ run: none.run, now: () => T }).write(c, projects([{ machine: 'local', path: '/w/plain' }]));
    expect(readFileSync(join(c.dir, 'forge-ledge.md'), 'utf8')).toContain('no GitHub or GitLab remote');
  });
  it('a failing command keeps its short reason, tokens removed', async () => {
    const { run } = fakeRun({ '/w/a': 'git@github.com:o/a.git' }, (_f, args) => args[0] === 'run' ? { code: 1, stderr: 'HTTP 502 for https://x:ghp_abcdefghijklmnopqrstuvwxyz0123456789@api.github.com' } : { code: 0, stdout: 'ok\n' });
    const c = ctx(); await createForge({ run, now: () => T }).write(c, projects([{ machine: 'local', path: '/w/a' }]));
    const file = readFileSync(join(c.dir, 'forge-ledge.md'), 'utf8');
    expect(file).toContain('HTTP 502');
    expect(file).not.toContain('ghp_');
  });
  it('keeps what it read for 2 minutes, then reads again', async () => {
    let now = Date.parse(T);
    const { run, calls } = fakeRun({ '/w/a': 'git@github.com:o/a.git' });
    const forge = createForge({ run, now: () => new Date(now).toISOString() });
    const p = projects([{ machine: 'local', path: '/w/a' }]);
    await forge.write(ctx(), p); const first = calls.length;
    now += 119_000; const c = ctx(); await forge.write(c, p);
    expect(calls).toHaveLength(first);
    expect(readFileSync(join(c.dir, 'forge-ledge.md'), 'utf8')).toContain(`read at ${T}`);
    now += 2_000; await forge.write(ctx(), p);
    expect(calls).toHaveLength(first * 2);
  });
  it('without projects, no file', async () => {
    const c = ctx(); await createForge({ run: fakeRun({}).run, now: () => T }).write(c, { projects: [], rules: [] });
    expect(existsSync(join(c.dir, 'forge.md'))).toBe(false);
  });
});

describe('redact', () => {
  it('removes GitHub and GitLab tokens, bearer headers and URL credentials', () => {
    const s = redact('a ghp_abcdefghijklmnopqrstuvwxyz0123 b github_pat_11ABCDEFG_xyz c glpat-AbCdEf123456789 d Authorization: Bearer abc.def e https://u:p@host/x f token=abc123');
    for (const secret of ['ghp_', 'github_pat_', 'glpat-', 'abc.def', 'u:p@', 'abc123']) expect(s).not.toContain(secret);
  });
});

describe('asksForge', () => {
  it('recognises a question about issues, PR/MR, CI or what was merged', () => {
    for (const q of ['quelles issues sont ouvertes sur ledge ?', 'où en est la MR de Pim ?', 'la CI de main est-elle verte ?', 'qu’est-ce qui a été mergé cette semaine ?', 'any open pull requests?', 'le pipeline a cassé ?'])
      expect(asksForge(q)).toBe(true);
    for (const q of ['où en sont les autres ?', 'lance une session sur ledge']) expect(asksForge(q)).toBe(false);
  });
});
