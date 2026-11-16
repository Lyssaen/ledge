import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type CliDeps } from '../src/cli.js';
import type { SetupIo } from '../src/launch/setup.js';
import { fakeGitHub } from './fakeGithub.js';

const dirs: string[] = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'relay-cli-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const COMPLETE_ENV = {
  LEDGE_RELAY_PUBLIC_URL: 'https://relay.example',
  GITHUB_CLIENT_ID: 'cid',
  GITHUB_CLIENT_SECRET: 'csecret-value',
  LEDGE_RELAY_ALLOWED_GITHUB_IDS: '4242'
};

async function webDir(): Promise<string> {
  const d = join(await tmp(), 'web');
  await mkdir(d);
  for (const f of ['index.html', 'sw.js', 'build.json', 'manifest.webmanifest']) await writeFile(join(d, f), '{}');
  return d;
}

function scripted(answers: Array<string | Error>): SetupIo & { close(): void } {
  const queue = [...answers];
  return {
    async ask() {
      const a = queue.shift();
      if (a === undefined) throw new Error('no more scripted answers');
      if (a instanceof Error) throw a;
      return a;
    },
    say: () => {},
    close: () => {}
  };
}

async function harness(env: NodeJS.ProcessEnv, o: { isTTY?: boolean; io?: () => SetupIo & { close(): void } } = {}) {
  const home = await tmp();
  let stop!: () => void;
  const out: string[] = [];
  const err: string[] = [];
  const deps = (): CliDeps => {
    const stopped = new Promise<void>((r) => { stop = r; });
    return {
      env, homedir: home, isTTY: o.isTTY ?? false, io: o.io ?? (() => scripted([])),
      out: (l) => { out.push(l); }, err: (l) => { err.push(l); },
      webDir: webDirPath, github: fakeGitHub(), waitForStop: () => stopped
    };
  };
  const webDirPath = await webDir();
  const configPath = join(home, '.ledge-relay', 'config.json');
  return { home, out, err, configPath, deps, stop: () => stop() };
}

/** Runs `launch`, waits for the listening line, then stops it and returns the exit code. */
async function launchAndStop(h: Awaited<ReturnType<typeof harness>>): Promise<number> {
  const run = main(['launch', '--port', '0'], h.deps());
  const until = Date.now() + 20_000;
  while (!h.out.some((l) => l.includes('"ev":"listening"')) && !h.err.length && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  h.stop();
  return run;
}

describe('ledge-relay', { timeout: 60_000 }, () => {
  it('--version prints the package version', async () => {
    const h = await harness({});
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(await main(['--version'], h.deps())).toBe(0);
    expect(h.out).toEqual([pkg.version]);
  });

  it('refuses anything else with a usage line and code 2', async () => {
    const h = await harness({});
    expect(await main(['bogus'], h.deps())).toBe(2);
    expect(await main(['launch', '--nope'], h.deps())).toBe(2);
    expect(h.err.every((l) => l.startsWith('usage:'))).toBe(true);
  });

  it('starts from a complete env, saves only the VAPID keys, and keeps them across restarts', async () => {
    const h = await harness(COMPLETE_ENV);
    expect(await launchAndStop(h)).toBe(0);
    expect(h.out[0]).toMatch(/^ledge-relay \S+ listening on http:\/\/127\.0\.0\.1:\d+ — public URL https:\/\/relay\.example:/);
    expect(h.out[1]).toContain('"mode":"accounts"');
    const saved = JSON.parse(await readFile(h.configPath, 'utf8')) as { vapid: { publicKey: string; subject: string } };
    expect(Object.keys(saved)).toEqual(['vapid']);
    expect(saved.vapid.subject).toBe('https://relay.example');
    expect(existsSync(join(h.home, '.ledge-relay', 'db'))).toBe(true);

    h.out.length = 0;
    expect(await launchAndStop(h)).toBe(0);
    const again = JSON.parse(await readFile(h.configPath, 'utf8')) as { vapid: { publicKey: string } };
    expect(again.vapid.publicKey).toBe(saved.vapid.publicKey);
  });

  it('without a terminal and with settings missing, names them and writes nothing', async () => {
    const h = await harness({});
    expect(await main(['launch', '--port', '0'], h.deps())).toBe(1);
    expect(h.err).toHaveLength(1);
    for (const label of ['public URL', 'GitHub OAuth App client id', 'GitHub OAuth App client secret', 'allowed GitHub account']) expect(h.err[0]).toContain(label);
    expect(existsSync(h.configPath)).toBe(false);
  });

  it('writes nothing when the dialogue is interrupted', async () => {
    const h = await harness({}, { isTTY: true, io: () => scripted(['https://relay.example', new Error('ctrl-c')]) });
    expect(await main(['launch', '--port', '0'], h.deps())).toBe(1);
    expect(existsSync(h.configPath)).toBe(false);
  });

  it('saves the answers of a complete dialogue and never prints the client secret', async () => {
    const github = fakeGitHub();
    const h = await harness({}, { isTTY: true, io: () => scripted(['https://relay.example', 'cid', 'top-secret-xyz', '4242', 'ops@relay.example']) });
    const deps = h.deps();
    const run = main(['launch', '--port', '0'], { ...deps, github });
    const until = Date.now() + 20_000;
    while (!h.out.some((l) => l.includes('"ev":"listening"')) && !h.err.length && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    h.stop();
    expect(await run).toBe(0);
    const saved = JSON.parse(await readFile(h.configPath, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({ publicUrl: 'https://relay.example', githubClientId: 'cid', githubClientSecret: 'top-secret-xyz', allowedGithubIds: ['4242'] });
    expect([...h.out, ...h.err].join('\n')).not.toContain('top-secret-xyz');
  });

  it('refuses a config.json that is not valid, and leaves it unchanged', async () => {
    const h = await harness(COMPLETE_ENV);
    await mkdir(join(h.home, '.ledge-relay'));
    await writeFile(h.configPath, '{"publicUrl":');
    expect(await main(['launch', '--port', '0'], h.deps())).toBe(1);
    expect(h.err[0]).toContain(h.configPath);
    expect(h.err[0]).toContain('launch --setup');
    expect(await readFile(h.configPath, 'utf8')).toBe('{"publicUrl":');
  });

  it('refuses an http public URL even with NODE_ENV unset', async () => {
    const h = await harness({ ...COMPLETE_ENV, LEDGE_RELAY_PUBLIC_URL: 'http://relay.example' });
    expect(await main(['launch', '--port', '0'], h.deps())).toBe(1);
    expect(h.err[0]).toMatch(/^ledge-relay: .*https/);
  });
});
