import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Projects, type RigLaunchWhere, type RigPlan, type RigSpecSeat, type ServerMessage } from '@ledge/protocol';
import { createOpenRigHttp } from '../src/daemon/openrig/http.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { createPlans, plannedWrites, prepareRigPlan, PLAN_TTL_MS, rigCwd, isPlanRequired } from '../src/daemon/openrig/plan.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const members = ['lead', 'a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => `      - id: ${id}\n        runtime: ${i % 2 ? 'codex' : 'claude-code'}\n${i === 1 ? '        profile: auto\n' : ''}`).join('');
const FACTORY = `version: "0.2"\nname: factory\npods:\n  - id: p\n    members:\n${members}`;
const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const projects = { version: 1, rules: [], projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }] } as unknown as Projects;
const copyWhere: RigLaunchWhere = { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/rigs', copy: true };

let fake: FakeOpenRig | null = null; let bridge: Bridge | null = null; let srv: ServerHandle | null = null; const dirs: string[] = [];
afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ledge-plan-')); dirs.push(d); return d; };

async function deps() {
  const home = tmp(); const f = fake = await createFakeOpenRig();
  f.specs = [{ id: 'b:factory', name: 'factory', sourceType: 'builtin', yaml: FACTORY }];
  return { home, d: { http: createOpenRigHttp({ base: f.url }), home, projects: () => projects, machine: 'local' } };
}

describe('pure helpers', () => {
  it('rigCwd and isPlanRequired', () => {
    expect(rigCwd(copyWhere, 'factory', '/h')).toBe('/w/ledge/.worktrees/rig-factory');
    expect(rigCwd({ ...copyWhere, copy: false }, 'factory', '/h')).toBe('/w/ledge');
    expect(rigCwd({ kind: 'off-project', name: 'reprise-wsl' }, 'factory', '/h')).toBe('/h/rigs/reprise-wsl');
    expect([copyWhere, { ...copyWhere, copy: false }, { kind: 'off-project', name: 'x' } as RigLaunchWhere].map(isPlanRequired)).toEqual([false, true, false]);
  });
  it('plannedWrites: claude-code + codex', () => {
    const s = (runtime: string) => ({ address: '@x', member: 'x', pod: 'p', runtime }) as RigSpecSeat;
    expect(plannedWrites([s('codex'), s('claude-code')])).toEqual(['.openrig/', '.mcp.json', 'CLAUDE.md', '.claude/settings.local.json', 'AGENTS.md']);
    expect(plannedWrites([s('codex')])).toEqual(['.openrig/', '.mcp.json', 'AGENTS.md']);
  });
  it('Plans.take: once, then used; after 30 min null', () => {
    let t = 0; const plans = createPlans(() => t); const p = { id: 'plan-1' } as RigPlan;
    plans.put(p); expect(plans.get('plan-1')).toBe(p); expect(plans.take('plan-1')).toBe(p); expect(plans.take('plan-1')).toBe('used');
    plans.put({ id: 'plan-2' } as RigPlan); t = PLAN_TTL_MS + 1; expect(plans.take('plan-2')).toBeNull();
  });
});

describe('prepareRigPlan', () => {
  it('project + copy: cwd .worktrees/rig-factory, not imposed', async () => {
    const { d } = await deps();
    const plan = await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: copyWhere });
    expect(plan).toMatchObject({ machine: 'local', cwd: '/w/ledge/.worktrees/rig-factory', required: false, command: 'rig up factory --cwd /w/ledge/.worktrees/rig-factory --yes --json' });
    const p = plan as RigPlan; expect(p.id).toMatch(/^plan-/); expect(p.seats).toHaveLength(7);
    expect(p.seats[1]).toEqual({ address: '@a', runtime: 'codex', autonomy: 'auto' }); expect(p.seats[0]!.autonomy).toBe('default');
  });
  it('project without copy: real repo, required; spec found by id too', async () => {
    const { d } = await deps();
    expect(await prepareRigPlan(d, { spec: 'b:factory', goal: 'G', where: { ...copyWhere, copy: false } })).toMatchObject({ cwd: '/w/ledge', required: true });
  });
  it('off-project: ~/.ledge/rigs/<name>, not imposed, nothing written', async () => {
    const { d, home } = await deps();
    expect(await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'reprise-wsl' } })).toMatchObject({ cwd: `${home}/rigs/reprise-wsl`, required: false });
    expect(existsSync(join(home, 'rigs'))).toBe(false);
  });
  it.each(['../x', 'a b', 'Factory', 'x'.repeat(41)])('name « %s » refused, nothing written', async name => {
    const { d, home } = await deps();
    expect(await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { kind: 'off-project', name } })).toEqual({ refused: 'invalid name' });
    expect(existsSync(join(home, 'rigs'))).toBe(false);
  });
  it('existing non-empty off-project folder: workspace exists; an empty one is fine', async () => {
    const { d, home } = await deps();
    mkdirSync(join(home, 'rigs', 'full'), { recursive: true }); writeFileSync(join(home, 'rigs', 'full', 'f'), '1'); mkdirSync(join(home, 'rigs', 'empty'));
    expect(await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'full' } })).toEqual({ refused: 'workspace exists' });
    expect(await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'empty' } })).toHaveProperty('id');
  });
  it('other refusals', async () => {
    const { d } = await deps();
    expect(await prepareRigPlan(d, { spec: 'factory', goal: ' ', where: copyWhere })).toEqual({ refused: 'goal required' });
    expect(await prepareRigPlan(d, { spec: 'nope', goal: 'G', where: copyWhere })).toEqual({ refused: 'unknown spec nope' });
    expect(await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { ...copyWhere, repo: '/w/other' } })).toEqual({ refused: 'unknown repo' });
    expect(await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { ...copyWhere, projectId: 'zz' } })).toEqual({ refused: 'unknown repo' });
    expect(await prepareRigPlan({ ...d, machine: 'other' }, { spec: 'factory', goal: 'G', where: copyWhere })).toEqual({ refused: 'unknown repo' });
    expect(await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { ...copyWhere, branch: '' } })).toEqual({ refused: 'branch required' });
  });
});

describe('server rig.prepare', () => {
  it('answers rig.plan, a refusal as rig.result failed, other machine unreachable', async () => {
    const dir = tmp(); process.env.LEDGE_HOME = dir;
    const f = fake = await createFakeOpenRig(); f.specs = [{ id: 'b:factory', name: 'factory', sourceType: 'builtin', yaml: FACTORY }];
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(f.port) }), exec: fakeRigCli(f), sessionName: () => undefined, projects: () => projects, home: dir, file: join(dir, 'openrig.json'), probeMs: 20, outboxMs: 30, resyncMs: 50 });
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: bridge });
    await bridge.start(); await until(() => bridge!.status().state === 'running');
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = []; ws.on('message', x => msgs.push(parseServerMessage(JSON.parse(String(x)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    send({ type: 'rig.prepare', rid: 'r1', machine: 'local', spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'ok' } });
    send({ type: 'rig.prepare', rid: 'r2', machine: 'local', spec: 'factory', goal: '', where: { kind: 'off-project', name: 'ok' } });
    send({ type: 'rig.prepare', rid: 'r3', machine: 'laptop', spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'ok' } });
    await until(() => msgs.filter(m => m.type === 'rig.plan' || m.type === 'rig.result').length >= 3);
    expect(msgs.find(m => m.type === 'rig.plan')).toMatchObject({ rid: 'r1', plan: { machine: 'local', spec: 'factory' } });
    expect(msgs.find(m => m.type === 'rig.result' && m.rid === 'r2')).toMatchObject({ ok: false, code: 'failed', reason: 'goal required' });
    expect(msgs.find(m => m.type === 'rig.result' && m.rid === 'r3')).toMatchObject({ ok: false, code: 'unreachable' });
    ws.close();
  });
});
