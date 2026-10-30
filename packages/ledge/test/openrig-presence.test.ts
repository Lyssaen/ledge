import { afterEach, describe, expect, it } from 'vitest';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { createOpenRigHttp } from '../src/daemon/openrig/http.js';
import { createRigCli, realRigExec, type RigExec } from '../src/daemon/openrig/cli.js';
import { probeOpenRig, versionSupported } from '../src/daemon/openrig/presence.js';
import { HUMAN_BINDING } from '../src/daemon/openrig/facts.js';

let fake: FakeOpenRig | null = null;
afterEach(async () => { await fake?.stop(); fake = null; });
const run = (code: number, stdout = '', stderr = ''): RigExec & { calls: string[][] } => {
  const calls: string[][] = []; const f = (async (a: string[]) => { calls.push(a); return { code, stdout, stderr }; }) as RigExec & { calls: string[][] }; f.calls = calls; return f;
};

describe('versionSupported', () => {
  it('accepts 0.6.x with x >= 14 only', () => {
    for (const v of ['0.6.14', '0.6.20']) expect(versionSupported(v)).toBe(true);
    for (const v of ['0.6.13', '0.7.0', '1.0.0', 'abc', '']) expect(versionSupported(v)).toBe(false);
  });
});

describe('probeOpenRig', () => {
  it('running, version from /healthz semver', async () => {
    fake = await createFakeOpenRig({ version: '0.6.14' });
    expect(await probeOpenRig({ http: createOpenRigHttp({ base: fake.url }), cli: createRigCli(fakeRigCli(fake)) })).toEqual({ state: 'running', version: '0.6.14' });
  });
  it('running, version from the CLI when /healthz has no semver', async () => {
    const http = { health: async () => ({ status: 'ok' }) } as never;
    const exec = fakeRigCli(null, { version: '0.6.14' });
    expect(await probeOpenRig({ http, cli: createRigCli(exec) })).toEqual({ state: 'running', version: '0.6.14' });
    expect(exec.calls[0]).toEqual(['--version']);
  });
  it('running without version when nothing tells it', async () => {
    const http = { health: async () => ({ status: 'ok' }) } as never;
    expect(await probeOpenRig({ http, cli: createRigCli(run(127)) })).toEqual({ state: 'running' });
  });
  it('unsupported (Review Focus 2)', async () => {
    fake = await createFakeOpenRig({ version: '0.7.0' });
    expect(await probeOpenRig({ http: createOpenRigHttp({ base: fake.url }), cli: createRigCli(fakeRigCli(fake)) }))
      .toEqual({ state: 'unsupported', version: '0.7.0', detail: 'OpenRig 0.7.0 non pris en charge' });
  });
  it('stopped when unreachable and CLI present; absent when CLI missing', async () => {
    fake = await createFakeOpenRig({ version: '0.6.14' });
    const http = createOpenRigHttp({ base: fake.url }); const cli = createRigCli(fakeRigCli(fake));
    await fake.stop();
    expect((await probeOpenRig({ http, cli })).state).toBe('stopped');
    expect((await probeOpenRig({ http, cli: createRigCli(run(127, '', 'not found')) })).state).toBe('absent');
  });
});

describe('createRigCli', () => {
  it('addHuman default argv', async () => {
    const exec = run(0); expect((await createRigCli(exec).addHuman()).ok).toBe(true);
    expect(exec.calls[0]).toEqual(['gateway', 'human', 'add', 'ledge', '--display-name', 'Ledge', '--binding', HUMAN_BINDING, '--delivery-class', 'D', '--actor', 'ledge']);
  });
  it('addHuman({ replace }) appends --replace', async () => {
    const exec = run(0); await createRigCli(exec).addHuman({ replace: true });
    expect(exec.calls[0]).toEqual(['gateway', 'human', 'add', 'ledge', '--display-name', 'Ledge', '--binding', HUMAN_BINDING, '--delivery-class', 'D', '--actor', 'ledge', '--replace']);
  });
  it('addHuman failure carries stderr detail', async () => {
    expect(await createRigCli(run(1, '', 'refused')).addHuman()).toEqual({ ok: false, detail: 'refused' });
  });
  it('humans parses tolerant JSON, null on failure', async () => {
    const h = (out: string, code = 0) => createRigCli(run(code, out)).humans();
    expect(await h('["a","b"]')).toEqual(['a', 'b']);
    expect(await h('[{"id":"a"},{"entityId":"b"},{"humanId":"c"}]')).toEqual(['a', 'b', 'c']);
    expect(await h('{"humans":[{"id":"a"}]}')).toEqual(['a']);
    expect(await h('{"items":["a"]}')).toEqual(['a']);
    expect(await h('[]')).toEqual([]);
    expect(await h('nope')).toBeNull();
    expect(await h('[]', 1)).toBeNull();
  });
  it('humans through the fake, version, available, daemonStart', async () => {
    fake = await createFakeOpenRig({ version: '0.6.14' }); const cli = createRigCli(fakeRigCli(fake));
    fake.humans.push('ledge');
    expect(await cli.humans()).toEqual(['ledge']);
    expect(await cli.version()).toBe('0.6.14');
    expect(await cli.available()).toBe(true);
    expect((await cli.daemonStart()).ok).toBe(true);
    expect(await createRigCli(fakeRigCli(null)).available()).toBe(false);
    expect(await createRigCli(fakeRigCli(null)).version()).toBeNull();
    expect(await createRigCli(fakeRigCli(null, { startFails: true })).daemonStart()).toEqual({ ok: false, detail: expect.stringContaining('port busy') });
  });
  it('daemonStart uses a 90 s timeout', async () => {
    const seen: unknown[] = []; const exec: RigExec = async (a, o) => { seen.push(a, o); return { code: 0, stdout: '', stderr: '' }; };
    await createRigCli(exec).daemonStart(); expect(seen).toEqual([['daemon', 'start'], { timeoutMs: 90_000 }]);
  });
});

describe('realRigExec', () => {
  it('ENOENT -> 127 when rig is not on PATH', async () => {
    const r = await realRigExec(async () => ({ PATH: '/nonexistent-ledge-test-dir' }))(['--version']);
    expect(r.code).toBe(127);
  });
});
