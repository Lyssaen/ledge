import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Projects, type Rig, type ServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge, type BridgeMessage } from '../src/daemon/openrig/bridge.js';
import { createOpenRigHttp } from '../src/daemon/openrig/http.js';
import { createRigCli } from '../src/daemon/openrig/cli.js';
import { actOnRig, rigActRequest } from '../src/daemon/openrig/actions.js';
import type { OpenRigStatus } from '@ledge/protocol';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const FACTORY_FAKE = (): FakeRig => ({ rigId: 'r1', name: 'factory', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@r', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });

let fake: FakeOpenRig | null = null; let srv: ServerHandle | null = null; let bridge: Bridge | null = null; const dirs: string[] = [];
afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const running: OpenRigStatus = { machine: 'local', state: 'running' };
const deps = (rig: FakeOpenRig, ensure: () => Promise<OpenRigStatus> = async () => running) =>
  ({ http: () => createOpenRigHttp({ base: rig.url }), ensureRunning: ensure, operator: 'ledge@external' });
const fresh = async () => { const rig = fake = await createFakeOpenRig(); rig.rigs.push(FACTORY_FAKE()); return rig; };

describe('rigActRequest', () => {
  it('maps verbs to routes', () => {
    expect(rigActRequest('down', { rigId: 'a b' }, 'ledge@external')).toEqual({ method: 'POST', path: '/api/down', body: { rigId: 'a b', snapshot: true } });
    expect(rigActRequest('restore', { rigId: 'r1' }, 'x')).toBe('restore');
  });
});

describe('actOnRig', () => {
  it.each([
    ['down', { rigId: 'r1' }, 'POST /api/down', { rigId: 'r1', snapshot: true }],
    ['up', { rigId: 'r1' }, 'POST /api/rigs/r1/up', {}],
    ['restart', { seatRef: 'dev-build@r' }, 'POST /api/seat/restart/dev-build%40r', { reason: expect.stringMatching(/^Ledge : /), operator: 'ledge@external' }],
    ['stop', { seatRef: 'dev-build@r' }, 'POST /api/seat/stop/dev-build%40r', { reason: expect.any(String), operator: 'ledge@external' }],
    ['handover', { seatRef: 'dev-build@r' }, 'POST /api/seat/handover/dev-build%40r', { reason: expect.any(String), source: 'fresh', operator: 'ledge@external' }],
  ] as const)('%s -> %s', async (verb, target, route, body) => {
    const rig = await fresh();
    expect(await actOnRig(deps(rig), { verb, ...target })).toEqual({ ok: true });
    expect(rig.requests.at(-1)).toMatchObject({ method: route.split(' ')[0], path: route.split(' ')[1], body });
  });

  it('restore: the most recent snapshot by createdAt', async () => {
    const rig = await fresh();
    rig.snapshots.set('r1', [{ id: 's1', createdAt: '2026-10-29 10:00:00' }, { id: 's3', createdAt: '2026-10-30 10:00:00' }, { id: 's2', createdAt: '2026-10-28 10:00:00' }]);
    expect(await actOnRig(deps(rig), { verb: 'restore', rigId: 'r1' })).toEqual({ ok: true });
    expect(rig.requests.filter(r => r.path.includes('/snapshots') || r.path.includes('/restore/')).map(r => `${r.method} ${r.path}`))
      .toEqual(['GET /api/rigs/r1/snapshots', 'POST /api/rigs/r1/restore/s3']);
  });
  it('restore without snapshot -> failed "no snapshot"', async () => {
    const rig = await fresh();
    expect(await actOnRig(deps(rig), { verb: 'restore', rigId: 'r1' })).toEqual({ ok: false, code: 'failed', reason: 'no snapshot' });
    expect(rig.requests.some(r => r.method === 'POST')).toBe(false);
  });
  it('ensureRunning is called; when it fails -> openrig_down, no lifecycle call', async () => {
    const rig = await fresh(); let n = 0;
    const r = await actOnRig(deps(rig, async () => { n++; return { machine: 'local', state: 'stopped' }; }), { verb: 'down', rigId: 'r1' });
    expect(r).toMatchObject({ ok: false, code: 'openrig_down' }); expect(n).toBe(1); expect(rig.requests).toEqual([]);
  });
  it('unsupported OpenRig -> unsupported', async () => {
    const rig = await fresh();
    expect(await actOnRig(deps(rig, async () => ({ machine: 'local', state: 'unsupported' })), { verb: 'down', rigId: 'r1' })).toMatchObject({ ok: false, code: 'unsupported' });
  });
  it('an unreachable OpenRig -> openrig_down', async () => {
    const rig = await fresh(); await rig.stop();
    expect(await actOnRig(deps(rig), { verb: 'down', rigId: 'r1' })).toMatchObject({ ok: false, code: 'openrig_down' });
  });
  it('OpenRig refuses (409, code no_snapshot) -> failed with the reason', async () => {
    const rig = await fresh(); rig.reply('POST', '/api/down', 409, { code: 'no_snapshot', error: undefined });
    expect(await actOnRig(deps(rig), { verb: 'down', rigId: 'r1' })).toEqual({ ok: false, code: 'failed', reason: 'no_snapshot' });
    rig.reply('POST', '/api/down', 500, 'oops');
    expect(await actOnRig(deps(rig), { verb: 'down', rigId: 'r1' })).toEqual({ ok: false, code: 'failed', reason: 'HTTP 500' });
    rig.reply('POST', '/api/down', 409, { error: 'rig busy' });
    expect(await actOnRig(deps(rig), { verb: 'down', rigId: 'r1' })).toEqual({ ok: false, code: 'failed', reason: 'rig busy' });
  });
  it.each([
    [{ verb: 'restart' }], [{ verb: 'down' }], [{ verb: 'up', seatRef: 'dev-build@r' }], [{ verb: 'stop', rigId: 'r1' }],
  ] as const)('invalid target %j -> failed invalid target, no call', async m => {
    const rig = await fresh(); let n = 0;
    expect(await actOnRig(deps(rig, async () => { n++; return running; }), m as never)).toEqual({ ok: false, code: 'failed', reason: 'invalid target' });
    expect(n).toBe(0); expect(rig.requests).toEqual([]);
  });
});

describe('RigCli.up', () => {
  it('runs rig up with --cwd --yes --json (300 s) and reads rigId/rigName, also nested', async () => {
    const calls: { args: string[]; env?: Record<string, string> }[] = []; let out = '{"rigId":"r9","rigName":"mine"}';
    const exec = fakeRigCli(null, { calls, up: () => ({ code: 0, stdout: out, stderr: '' }) });
    const cli = createRigCli(exec);
    expect(await cli.up('factory', '/w/x')).toEqual({ ok: true, rigId: 'r9', rigName: 'mine' });
    expect(calls[0]!.args).toEqual(['up', 'factory', '--cwd', '/w/x', '--yes', '--json']);
    out = '{"result":{"rigId":"r8","rigName":"n"}}';
    expect(await cli.up('factory', '/w/x')).toEqual({ ok: true, rigId: 'r8', rigName: 'n' });
  });
  it('a failure or an unreadable answer gives { ok:false, detail }', async () => {
    const bad = createRigCli(fakeRigCli(null, { up: () => ({ code: 1, stdout: '', stderr: 'boom' }) }));
    expect(await bad.up('s', '/c')).toEqual({ ok: false, detail: 'boom' });
    const nothing = createRigCli(fakeRigCli(null, { up: () => ({ code: 0, stdout: 'done', stderr: 'tail' }) }));
    expect(await nothing.up('s', '/c')).toMatchObject({ ok: false });
  });
});

describe('Bridge.annotate', () => {
  const launch = { planId: 'p1', goal: 'g', lead: 'dev-build@r', at: '2026-10-30T10:00:00.000Z' } as unknown as NonNullable<Rig['launch']>;
  it('keeps launch and repos across mirror refreshes, emits rig.updated, null clears', async () => {
    const rig = await fresh(); const d = mkdtempSync(join(tmpdir(), 'ledge-annot-')); dirs.push(d);
    const msgs: BridgeMessage[] = [];
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(rig.port) }), exec: fakeRigCli(rig), projects: () => none, home: d, file: join(d, 'openrig.json'),
      sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 40 });
    bridge.onMessage(m => msgs.push(m)); await bridge.start();
    await until(() => bridge!.rigs().length === 1);
    expect(bridge.annotate('nope', { launch })).toBeNull();
    const before = msgs.length;
    const r = bridge.annotate('r1', { launch, repos: [{ path: '/w/app', name: 'app', modified: 1 }] })!;
    expect(r.launch).toEqual(launch);
    expect(msgs.slice(before).some(m => m.type === 'rig.updated' && m.rig.launch !== undefined)).toBe(true);
    rig.rigs[0]!.nodes.push({ logicalId: 'dev.x', canonicalSessionName: 'dev-x@r', runtime: 'codex', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app' });
    rig.emit({ type: 'rig.updated', rigId: 'r1' });
    await until(() => bridge!.rigs()[0]!.seats.length === 2);
    expect(bridge.rigs()[0]!.launch).toEqual(launch); expect(bridge.rigs()[0]!.repos).toHaveLength(1);
    expect(bridge.replay().find(m => m.type === 'rig.snapshot' && m.rigs[0]?.launch)).toBeTruthy();
    expect(bridge.annotate('r1', { launch: null })!.launch).toBeUndefined();
    expect(bridge.rigs()[0]!.launch).toBeUndefined();
  });
});

async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const of = <K extends ServerMessage['type']>(t: K) => msgs.filter((m): m is Extract<ServerMessage, { type: K }> => m.type === t);
  return { msgs, of, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), close: () => new Promise<void>(r => { ws.once('close', () => r()); ws.close(); }) };
}
async function serve(withBridge: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-act-srv-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
  const store = new Store();
  if (withBridge) {
    const rig = fake = await createFakeOpenRig(); rig.rigs.push(FACTORY_FAKE()); rig.humans.push('ledge');
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(rig.port) }), exec: fakeRigCli(rig), projects: () => none, home: dir, file: join(dir, 'openrig.json'),
      sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50, notice: t => srv?.say(t) });
  }
  srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), ...(bridge ? { openrig: bridge } : {}) });
  if (bridge) { await bridge.start(); await until(() => bridge!.status().state === 'running' && bridge!.rigs().length === 1); }
  return srv;
}

describe('server rig.act', () => {
  it('answers rig.result to the sender only', async () => {
    const s = await serve(true); const a = await client(s.port); const b = await client(s.port);
    a.send({ type: 'rig.act', rid: 'x1', machine: 'local', rigId: 'r1', verb: 'down' });
    await until(() => a.of('rig.result').length === 1);
    expect(a.of('rig.result')[0]).toEqual({ type: 'rig.result', rid: 'x1', ok: true });
    expect(fake!.requests.filter(r => r.method === 'POST').at(-1)).toMatchObject({ path: '/api/down' });
    a.send({ type: 'rig.act', rid: 'x2', machine: 'mac', rigId: 'r1', verb: 'down' });
    a.send({ type: 'rig.act', rid: 'x3', machine: 'local', verb: 'down' });
    await until(() => a.of('rig.result').length === 3);
    expect(a.of('rig.result').slice(1)).toEqual([{ type: 'rig.result', rid: 'x2', ok: false, code: 'unreachable', reason: expect.any(String) },
      { type: 'rig.result', rid: 'x3', ok: false, code: 'failed', reason: 'invalid target' }]);
    expect(b.of('rig.result')).toEqual([]);
    await a.close(); await b.close();
  });
  it('without a bridge -> openrig_down', async () => {
    const s = await serve(false); const a = await client(s.port);
    a.send({ type: 'rig.act', rid: 'y', machine: 'local', rigId: 'r1', verb: 'down' });
    await until(() => a.of('rig.result').length === 1);
    expect(a.of('rig.result')[0]).toMatchObject({ ok: false, code: 'openrig_down' });
    await a.close();
  });
  it('a bridge notice lands in Ledge thread', async () => {
    const s = await serve(true); const a = await client(s.port);
    s.say("J'ai démarré OpenRig sur local");
    await until(() => a.of('ledge.thread.item').some(m => m.item.kind === 'ledge' && m.item.text === "J'ai démarré OpenRig sur local"));
    await a.close();
  });
});
