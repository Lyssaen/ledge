import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Projects, type ServerMessage } from '@ledge/protocol';
import { adoptRig, rigProjectId } from '../src/daemon/openrig/adopt.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const proj = (id: string, rigs: string[] = [], repos: { machine: string; path: string }[] = []) => ({ id, name: id, color: 'blue', description: '', repos, rigs });
const state = (...projects: ReturnType<typeof proj>[]): Projects => ({ projects, rules: [] }) as unknown as Projects;

describe('adoptRig', () => {
  it('adds r1 to ledge and removes it from website', () => {
    const out = adoptRig(state(proj('website', ['r1', 'r2']), proj('ledge')), 'ledge', 'r1');
    expect(out).not.toHaveProperty('refused');
    const p = (out as Projects).projects;
    expect(p.find(x => x.id === 'ledge')!.rigs).toEqual(['r1']);
    expect(p.find(x => x.id === 'website')!.rigs).toEqual(['r2']);
  });
  it('is idempotent and refuses an unknown project', () => {
    const s = state(proj('ledge', ['r1']));
    expect((adoptRig(s, 'ledge', 'r1') as Projects).projects[0]!.rigs).toEqual(['r1']);
    expect(adoptRig(s, 'nope', 'r1')).toEqual({ refused: 'unknown project' });
  });
});

describe('rigProjectId', () => {
  const rig = { id: 'r1', cwd: '/w/app', machine: 'local' };
  it('prefers the project that lists the rig, then the repo that contains the cwd, else null', () => {
    const repo = { machine: 'local', path: '/w/app' };
    expect(rigProjectId(rig, state(proj('web', [], [repo]), proj('ledge', ['r1'])))).toBe('ledge');
    expect(rigProjectId(rig, state(proj('web', [], [repo])))).toBe('web');
    expect(rigProjectId(rig, state(proj('ledge')))).toBeNull();
    expect(rigProjectId({ ...rig, cwd: '' }, state(proj('ledge', ['r1'])))).toBe('ledge');
    expect(rigProjectId({ ...rig, cwd: '' }, state(proj('ledge')))).toBeNull();
  });
});

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const of = <K extends ServerMessage['type']>(t: K) => msgs.filter((m): m is Extract<ServerMessage, { type: K }> => m.type === t);
  return { msgs, of, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), close: () => new Promise<void>(r => { ws.once('close', () => r()); ws.close(); }) };
}

let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; const dirs: string[] = []; let saved: string | undefined;
afterEach(async () => {
  await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null;
  if (saved === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = saved;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  saved = process.env.LEDGE_HOME;
  const dir = mkdtempSync(join(tmpdir(), 'ledge-adopt-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
  const rigDir = join(dir, 'rigs', 'starter'); mkdirSync(rigDir, { recursive: true }); writeFileSync(join(rigDir, 'notes.md'), 'hello');
  const projectsFile = join(dir, 'projects.json');
  const initial = state(proj('website', ['r1']), proj('ledge'));
  writeFileSync(projectsFile, JSON.stringify(initial));
  fake = await createFakeOpenRig();
  fake.rigs.push({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
    { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: rigDir, activityState: { activity: 'idle-at-prompt' } }] });
  fake.humans.push('ledge');
  let server: ServerHandle | null = null;
  bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => server!.projects(), home: dir, file: join(dir, 'openrig.json'),
    asks: { all: () => server!.asks.all(), onChange: f => server!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 5000 });
  server = srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, projectsFile, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: bridge });
  await bridge.start();
  await until(() => bridge!.status().state === 'running' && bridge!.rigs().length === 1);
  const snapshot = (d: string): string[] => readdirSync(d).sort().map(f => `${f}:${statSync(join(d, f)).mtimeMs}:${readFileSync(join(d, f), 'utf8')}`);
  return { server, projectsFile, rigDir, snapshot };
}

describe('rig.adopt', () => {
  it('rewrites projects.json, re-emits the rig with its new project and keeps offProject', async () => {
    const { server, projectsFile } = await setup();
    const c = await client(server.port);
    await until(() => c.of('rig.snapshot').length === 1);
    expect(c.of('rig.snapshot')[0]!.rigs[0]).toMatchObject({ projectId: 'website', offProject: true });
    c.send({ type: 'rig.adopt', rid: 'a1', machine: 'local', rigId: 'r1', projectId: 'ledge' });
    await until(() => c.of('rig.result').length === 1);
    expect(c.of('rig.result')[0]).toMatchObject({ rid: 'a1', ok: true });
    const written = JSON.parse(readFileSync(projectsFile, 'utf8')) as Projects;
    expect(written.projects.find(p => p.id === 'ledge')!.rigs).toEqual(['r1']);
    expect(written.projects.find(p => p.id === 'website')!.rigs).toEqual([]);
    expect(c.of('projects').at(-1)!.projects.projects.find(p => p.id === 'ledge')!.rigs).toEqual(['r1']);
    await until(() => c.of('rig.updated').some(m => m.rig.id === 'r1' && m.rig.projectId === 'ledge'));
    expect(c.of('rig.updated').find(m => m.rig.projectId === 'ledge')!.rig.offProject).toBe(true);
    await c.close();
  });

  it('leaves the rig folder untouched (same listing, same mtimes)', async () => {
    const { server, rigDir, snapshot } = await setup();
    const before = snapshot(rigDir);
    const c = await client(server.port);
    c.send({ type: 'rig.adopt', rid: 'a2', machine: 'local', rigId: 'r1', projectId: 'ledge' });
    await until(() => c.of('rig.result').length === 1);
    expect(c.of('rig.result')[0]).toMatchObject({ ok: true });
    expect(snapshot(rigDir)).toEqual(before);
    await c.close();
  });

  it('an unknown project or an unknown rig is a failed rig.result and writes nothing', async () => {
    const { server, projectsFile } = await setup();
    const raw = readFileSync(projectsFile, 'utf8');
    const c = await client(server.port);
    c.send({ type: 'rig.adopt', rid: 'a3', machine: 'local', rigId: 'r1', projectId: 'nope' });
    c.send({ type: 'rig.adopt', rid: 'a4', machine: 'local', rigId: 'ghost', projectId: 'ledge' });
    c.send({ type: 'rig.adopt', rid: 'a5', machine: 'mac', rigId: 'r1', projectId: 'ledge' });
    await until(() => c.of('rig.result').length === 3);
    expect(c.of('rig.result').find(r => r.rid === 'a3')).toMatchObject({ ok: false, code: 'failed', reason: 'unknown project' });
    expect(c.of('rig.result').find(r => r.rid === 'a4')).toMatchObject({ ok: false, code: 'failed' });
    expect(c.of('rig.result').find(r => r.rid === 'a5')).toMatchObject({ ok: false, code: 'unreachable' });
    expect(readFileSync(projectsFile, 'utf8')).toBe(raw);
    await c.close();
  });
});
