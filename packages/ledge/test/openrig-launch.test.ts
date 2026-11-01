import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type OpenRigStatus, type Projects, type Rig, type RigLaunchInfo, type RigPlan, type RigSeat, type ServerMessage } from '@ledge/protocol';
import { createRigCli } from '../src/daemon/openrig/cli.js';
import { createBridge, type Bridge, type BridgeMessage } from '../src/daemon/openrig/bridge.js';
import { createLaunches, GOAL_TIMEOUT_MS, goalMessage, leadOf, type PendingLaunch } from '../src/daemon/openrig/launch.js';
import { mandateSummary } from '../src/daemon/openrig/seatContext.js';
import type { Exec } from '../src/daemon/git.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ledge-launch-')); dirs.push(d); return d; };

const SEATS = ['orch-lead', 'dev-a', 'dev-b', 'dev-c', 'rev-d', 'rev-e', 'qa-f'];
const seats = (state: (ref: string) => RigSeat['state']): RigSeat[] => SEATS.map(n => {
  const ref = `${n}@factory`; return { ref, address: `@${n.split('-')[1]!}`, name: n, runtime: 'claude-code', state: state(ref) };
});
const allReady = seats(() => 'ready');
const rigOf = (id: string, s: RigSeat[], lifecycle: Rig['lifecycle'] = 'running'): Rig =>
  ({ id, name: 'factory', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle, kernel: false, seats: s, repos: [] });

/** The part of the OpenRig bridge launches use, driven by the test. */
function fakeBridge() {
  let rigs: Rig[] = []; const fns = new Set<(m: BridgeMessage) => void>(); const notes: { rigId: string; launch: RigLaunchInfo | null | undefined }[] = [];
  let state: OpenRigStatus['state'] = 'running';
  const b = {
    rigs: () => rigs,
    onMessage(fn: (m: BridgeMessage) => void) { fns.add(fn); return () => { fns.delete(fn); }; },
    annotate(rigId: string, extra: { launch?: RigLaunchInfo | null }) { notes.push({ rigId, launch: extra.launch }); const r = rigs.find(x => x.id === rigId); return r ? { ...r, ...(extra.launch ? { launch: extra.launch } : {}) } : null; },
    ensureRunning: async () => ({ machine: 'local', state }) as OpenRigStatus,
    notes,
    setState(s: OpenRigStatus['state']) { state = s; },
    emitSeats(rigId: string, s: RigSeat[], lifecycle: Rig['lifecycle'] = 'running') {
      const rig = rigOf(rigId, s, lifecycle); rigs = [...rigs.filter(r => r.id !== rigId), rig];
      for (const fn of fns) fn({ type: 'rig.updated', rig });
    },
    snapshot(list: Rig[]) { rigs = list; for (const fn of fns) fn({ type: 'rig.snapshot', machine: 'local', rigs: list } as BridgeMessage); },
    remove(rigId: string) { rigs = rigs.filter(r => r.id !== rigId); for (const fn of fns) fn({ type: 'rig.removed', machine: 'local', rigId }); },
  };
  return b;
}

let fake: FakeOpenRig;
beforeAll(async () => { fake = await createFakeOpenRig(); });
afterAll(async () => { await fake.stop(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function setup(o: { upFails?: boolean; file?: string; sendFails?: boolean } = {}) {
  const calls: { args: string[]; env?: Record<string, string> }[] = [];
  const exec = fakeRigCli(fake, { calls, up: (spec, cwd) => o.upFails ? { code: 1, stdout: '', stderr: 'boom: spec broken' }
    : { code: 0, stdout: JSON.stringify({ rigId: 'r1', rigName: spec, cwd }), stderr: '' } });
  const cli = createRigCli(exec);
  const bridge = fakeBridge(); const said: string[] = [];
  const dir = tmp(); const file = o.file ?? join(dir, 'rig-launches.json');
  const gitCalls: string[][] = [];
  const git: Exec = async (f, args) => { gitCalls.push([f, ...args]); return { code: args.includes('rev-parse') ? 1 : 0, stdout: '' }; };
  const launches = createLaunches({ cli, bridge, git, say: t => { said.push(t); }, mandate: () => 'MANDAT',
    send: async (ref, text) => o.sendFails ? { ok: false, detail: 'nope' } : cli.send(ref, text),
    file, now: () => Date.now(), setTimer: setTimeout, clearTimer: clearTimeout });
  const plan: RigPlan = { id: 'plan-1', machine: 'local', spec: 'factory', goal: 'Refaire le cache', where: { kind: 'off-project', name: 'factory' },
    cwd: join(dir, 'rigs', 'factory'), seats: [], writes: [], command: '', required: false };
  return { calls, cli, bridge, said, file, launches, plan, dir, gitCalls };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
const sends = (calls: { args: string[] }[]) => calls.filter(c => c.args[0] === 'send');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('helpers', () => {
  it('leadOf: name or address with lead, else the first seat', () => {
    expect(leadOf(allReady)?.ref).toBe('orch-lead@factory');
    expect(leadOf(allReady.slice(1))?.ref).toBe('dev-a@factory');
    expect(leadOf([])).toBeUndefined();
  });
  it('goalMessage', () => { expect(goalMessage('G', 'M')).toBe("But donné par l'utilisateur, via Ledge : G\n\nM"); });
});

describe('mandateSummary', () => {
  it('null: the default text', () => {
    expect(mandateSummary(null)).toBe("Ledge tranche seul : git et branches, tests et relectures, contexte et relèves, petits choix de code.\nTe reviennent toujours, via Ledge, à l'utilisateur : design, architecture, critique (données, sécurité, suppression, coûts).");
  });
  it('mandateSummary lit les deux listes de mandat.md', () => {
    const md = "# Le mandat de Ledge\n\nIntro.\n\n## Ledge tranche seul\n- git : git et branches\n- tests : tests et relectures\n\n## Te revient toujours\n- context : contexte et relèves\n- design : design (UI, copie)\n";
    expect(mandateSummary(md)).toBe("Ledge tranche seul : git et branches, tests et relectures.\nTe reviennent toujours, via Ledge, à l'utilisateur : contexte et relèves, design (UI, copie).");
  });
  it('design moved into the first list still goes to the user; an empty file sends all to the user', () => {
    const md = '## Ledge tranche seul\n- design : design\n- git : git et branches\n\n## Te revient toujours\n- critical : critique\n';
    expect(mandateSummary(md)).toBe("Ledge tranche seul : git et branches.\nTe reviennent toujours, via Ledge, à l'utilisateur : critique, design.");
    expect(mandateSummary('')).toBe("Ledge ne tranche rien seul : tout revient, via Ledge, à l'utilisateur.");
  });
});

describe('createLaunches', () => {
  it('lance rig up une seule fois, enregistre le lancement et annote le rig', async () => {
    const { launches, plan, calls, file, bridge } = setup();
    expect(await launches.launch(plan)).toEqual({ ok: true, rigId: 'r1' });
    expect(calls.filter(c => c.args[0] === 'up')).toEqual([{ args: ['up', 'factory', '--cwd', plan.cwd, '--yes', '--json'] }]);
    expect(existsSync(plan.cwd)).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as PendingLaunch[];
    expect(saved).toEqual([{ planId: 'plan-1', machine: 'local', rigId: 'r1', rigName: 'factory', goal: 'Refaire le cache', lead: expect.any(String), startedAt: '2026-10-31T10:00:00.000Z' }]);
    expect(bridge.notes[0]).toMatchObject({ rigId: 'r1', launch: { planId: 'plan-1', goal: 'Refaire le cache', startedAt: '2026-10-31T10:00:00.000Z' } });
    expect(launches.pending()).toHaveLength(1);
    launches.close();
  });
  it('rig up failing → failed with the end of stderr, the thread says it', async () => {
    const { launches, plan, said, file } = setup({ upFails: true });
    expect(await launches.launch(plan)).toEqual({ ok: false, code: 'failed', reason: 'boom: spec broken' });
    expect(said.some(s => s.includes('boom: spec broken'))).toBe(true);
    expect(existsSync(file)).toBe(false);
    launches.close();
  });
  it('OpenRig down → openrig_down, no rig up', async () => {
    const { launches, plan, calls, bridge } = setup(); bridge.setState('stopped');
    expect(await launches.launch(plan)).toMatchObject({ ok: false, code: 'openrig_down' });
    expect(calls.filter(c => c.args[0] === 'up')).toHaveLength(0);
    launches.close();
  });
  it('a bad branch is refused before git and rig up', async () => {
    const { launches, plan, calls, gitCalls } = setup();
    const p: RigPlan = { ...plan, where: { kind: 'project', projectId: 'x', repo: '/w', branch: '-b', copy: true }, cwd: '/w/.worktrees/rig-factory' };
    expect(await launches.launch(p)).toEqual({ ok: false, code: 'failed', reason: 'invalid branch' });
    expect(gitCalls).toEqual([]); expect(calls.filter(c => c.args[0] === 'up')).toHaveLength(0);
    launches.close();
  });
  it('but remis au lead quand les 7 sièges sont prêts, une fois', async () => {
    const { launches, plan, calls, bridge, said, file } = setup();
    await launches.launch(plan);
    bridge.emitSeats('r1', seats(r => r === 'qa-f@factory' ? 'starting' : 'ready')); await flush();
    expect(sends(calls)).toHaveLength(0);
    bridge.emitSeats('r1', allReady); await flush();
    expect(sends(calls)).toEqual([expect.objectContaining({ args: ['send', 'orch-lead@factory', expect.stringMatching(/^\[Ledge\] But donné par l'utilisateur, via Ledge : Refaire le cache\n\nMANDAT$/)] })]);
    expect(said).toContain("J'ai donné le but à orch-lead@factory.");
    expect(bridge.notes.at(-1)).toMatchObject({ rigId: 'r1', launch: { goalSentAt: '2026-10-31T10:00:00.000Z' } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([expect.objectContaining({ rigId: 'r1', goalSentAt: '2026-10-31T10:00:00.000Z' })]);
    expect(launches.pending()).toEqual([]);
    bridge.emitSeats('r1', allReady); await flush();
    expect(sends(calls)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS); expect(sends(calls)).toHaveLength(1);
    launches.close();
  });
  it('10 min sans tous les sièges : but remis quand même et l’utilisateur prévenu', async () => {
    const { launches, plan, calls, bridge, said } = setup();
    await launches.launch(plan);
    bridge.emitSeats('r1', seats(r => r === 'qa-f@factory' ? 'starting' : 'ready')); await flush();
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS - 1000); expect(sends(calls)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sends(calls)).toHaveLength(1);
    expect(said).toContain("Les sièges de factory ne sont pas tous prêts après 10 min : j'ai quand même donné le but à orch-lead@factory. qa-f@factory attend encore.");
    expect(bridge.notes.at(-1)).toMatchObject({ launch: { lateNotice: true } });
    launches.close();
  });
  it('lead en trust : rien envoyé, « attend ta confiance » dans le fil, puis le but part quand il en sort', async () => {
    const { launches, plan, calls, bridge, said } = setup();
    await launches.launch(plan);
    bridge.emitSeats('r1', seats(r => r === 'orch-lead@factory' ? 'trust' : 'ready')); await flush();
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS);
    bridge.emitSeats('r1', seats(r => r === 'orch-lead@factory' ? 'trust' : 'ready')); await flush();
    expect(sends(calls)).toHaveLength(0);
    expect(said.filter(s => s === 'orch-lead@factory attend ta confiance dans le dossier : le but partira après.')).toHaveLength(1);
    bridge.emitSeats('r1', seats(r => r === 'dev-a@factory' ? 'trust' : 'ready')); await flush();
    expect(sends(calls).map(c => c.args[1])).toEqual(['orch-lead@factory']);
    launches.close();
  });
  it('never sends the goal to a lead needing intervention, even after the timeout', async () => {
    const { launches, plan, calls, bridge } = setup();
    await launches.launch(plan);
    bridge.emitSeats('r1', seats(r => r === 'orch-lead@factory' ? 'attention' : 'ready')); await flush();
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS);
    expect(sends(calls)).toHaveLength(0);
    bridge.emitSeats('r1', allReady); await flush();
    expect(sends(calls)).toHaveLength(1);
    launches.close();
  });
  it('a send failing: said once, retried at the next update', async () => {
    const { launches, plan, bridge, said } = setup({ sendFails: true });
    await launches.launch(plan);
    bridge.emitSeats('r1', allReady); await flush(); bridge.emitSeats('r1', allReady); await flush();
    expect(said.filter(s => s.includes('nope'))).toHaveLength(1);
    expect(launches.pending()).toHaveLength(1);
    launches.close();
  });
  it('rig stopped or removed: tracking stops, nothing sent', async () => {
    const { launches, plan, calls, bridge, file } = setup();
    await launches.launch(plan);
    bridge.emitSeats('r1', seats(() => 'starting'), 'stopped'); await flush();
    expect(launches.pending()).toEqual([]); expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS); expect(sends(calls)).toHaveLength(0);
    launches.close();
    const s2 = setup(); await s2.launches.launch(s2.plan); s2.bridge.emitSeats('r1', seats(() => 'starting')); s2.bridge.remove('r1');
    expect(s2.launches.pending()).toEqual([]); s2.launches.close();
  });
  it('restart after a sent goal: annotation restored with goalSentAt and lateNotice, nothing sent, pruned when the rig stops', async () => {
    const dir = tmp(); const file = join(dir, 'rig-launches.json');
    const sent = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(file, JSON.stringify([{ planId: 'p2', machine: 'local', rigId: 'r2', rigName: 'other', goal: 'G2', lead: 'x', startedAt: sent, goalSentAt: sent, lateNotice: true }]));
    const { launches, calls, bridge } = setup({ file });
    launches.resume();
    expect(launches.pending()).toEqual([]);
    bridge.emitSeats('r2', allReady); await flush();
    expect(bridge.notes).toEqual([{ rigId: 'r2', launch: { planId: 'p2', goal: 'G2', lead: 'x', startedAt: sent, goalSentAt: sent, lateNotice: true } }]);
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS); expect(sends(calls)).toHaveLength(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    bridge.emitSeats('r2', allReady, 'stopped'); await flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
    launches.close();
  });
  it('a sent launch is pruned when its rig leaves a snapshot after being seen', async () => {
    const { launches, plan, bridge, file } = setup();
    await launches.launch(plan);
    bridge.emitSeats('r1', allReady); await flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    bridge.remove('r1');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
    launches.close();
  });
  it('a rig that never appears: the thread says so after the delay, once the snapshot lacks it', async () => {
    const { launches, plan, bridge, said, file } = setup();
    await launches.launch(plan);
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS);
    expect(said).toEqual([]);
    bridge.snapshot([]); await flush();
    expect(said).toEqual(["factory n'est jamais apparu : le but n'est pas parti."]);
    expect(launches.pending()).toEqual([]); expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
    launches.close();
  });
  it('cancel forgets the launch', async () => {
    const { launches, plan, calls, bridge } = setup();
    await launches.launch(plan); await launches.cancel('r1');
    expect(launches.pending()).toEqual([]); expect(bridge.notes.at(-1)).toEqual({ rigId: 'r1', launch: null });
    await vi.advanceTimersByTimeAsync(GOAL_TIMEOUT_MS); expect(sends(calls)).toHaveLength(0);
    launches.close();
  });
  it('redémarrage : resume() relit rig-launches.json et n’envoie pas un but déjà parti', async () => {
    const dir = tmp(); const file = join(dir, 'rig-launches.json');
    const started = new Date(Date.now() - 4 * 60_000).toISOString();
    const entries: PendingLaunch[] = [
      { planId: 'p1', machine: 'local', rigId: 'r1', rigName: 'factory', goal: 'G1', lead: 'orch-lead@factory', startedAt: started },
      { planId: 'p2', machine: 'local', rigId: 'r2', rigName: 'other', goal: 'G2', lead: 'x', startedAt: started, goalSentAt: started },
    ];
    writeFileSync(file, JSON.stringify(entries));
    const { launches, calls, bridge, said } = setup({ file });
    launches.resume();
    expect(launches.pending().map(p => p.rigId)).toEqual(['r1']);
    bridge.emitSeats('r2', allReady); await flush();
    expect(sends(calls)).toHaveLength(0);
    bridge.emitSeats('r1', seats(r => r === 'qa-f@factory' ? 'starting' : 'ready')); await flush();
    expect(bridge.notes.some(n => n.rigId === 'r1' && n.launch?.planId === 'p1')).toBe(true); // re-annotated once the mirror has it
    await vi.advanceTimersByTimeAsync(6 * 60_000 - 1000); expect(sends(calls)).toHaveLength(0); // the remaining time from the real startedAt
    await vi.advanceTimersByTimeAsync(1000); expect(sends(calls)).toHaveLength(1);
    expect(said.some(s => s.startsWith('Les sièges de factory'))).toBe(true);
    launches.close();
  });
});

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const FACTORY = 'version: "0.2"\nname: factory\npods:\n  - id: p\n    members:\n      - id: lead\n        runtime: claude-code\n';
describe('server rig.launch', () => {
  let bridge: Bridge | null = null; let srv: ServerHandle | null = null; let f: FakeOpenRig | null = null;
  const savedHome = process.env.LEDGE_HOME; // undefined when unset
  afterEach(async () => {
    if (savedHome === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = savedHome; await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await f?.stop(); f = null; });
  it('launches a prepared plan once; a used plan and an unknown one are refused', async () => {
    vi.useRealTimers();
    const dir = tmp(); process.env.LEDGE_HOME = dir;
    f = await createFakeOpenRig(); f.specs = [{ id: 'b:factory', name: 'factory', sourceType: 'builtin', yaml: FACTORY }];
    const exec = fakeRigCli(f, { up: spec => ({ code: 0, stdout: JSON.stringify({ rigId: 'r9', rigName: spec }), stderr: '' }) });
    const fr = f;
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fr.port) }), exec, sessionName: () => undefined, projects: () => ({ projects: [], rules: [] }) as Projects, home: dir, file: join(dir, 'openrig.json'), probeMs: 20, outboxMs: 30, resyncMs: 50 });
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: bridge });
    await bridge.start(); await until(() => bridge!.status().state === 'running');
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = []; ws.on('message', x => msgs.push(parseServerMessage(JSON.parse(String(x)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    send({ type: 'rig.prepare', rid: 'p', machine: 'local', spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'ok' } });
    await until(() => msgs.some(m => m.type === 'rig.plan'));
    const plan = (msgs.find(m => m.type === 'rig.plan') as Extract<ServerMessage, { type: 'rig.plan' }>).plan;
    send({ type: 'rig.launch', rid: 'l1', planId: plan.id });
    await until(() => msgs.some(m => m.type === 'rig.result' && m.rid === 'l1'));
    send({ type: 'rig.launch', rid: 'l2', planId: plan.id });
    send({ type: 'rig.launch', rid: 'l3', planId: 'plan-nope' });
    await until(() => msgs.filter(m => m.type === 'rig.result').length >= 3);
    expect(msgs.find(m => m.type === 'rig.result' && m.rid === 'l1')).toMatchObject({ ok: true });
    expect(msgs.find(m => m.type === 'rig.result' && m.rid === 'l2')).toMatchObject({ ok: false, code: 'failed', reason: 'plan already launched' });
    expect(msgs.find(m => m.type === 'rig.result' && m.rid === 'l3')).toMatchObject({ ok: false, code: 'failed', reason: 'plan expired' });
    expect(exec.calls.filter(c => c[0] === 'up')).toEqual([['up', 'factory', '--cwd', join(dir, 'rigs', 'ok'), '--yes', '--json']]);
    expect(JSON.parse(readFileSync(join(dir, 'rig-launches.json'), 'utf8'))).toMatchObject([{ rigId: 'r9', planId: plan.id, goal: 'G' }]);
    ws.close();
  });
  it('a launch refused « not now » (OpenRig down) keeps its plan: the same rid launches it once OpenRig is back', async () => {
    vi.useRealTimers();
    const dir = tmp(); process.env.LEDGE_HOME = dir;
    f = await createFakeOpenRig(); f.specs = [{ id: 'b:factory', name: 'factory', sourceType: 'builtin', yaml: FACTORY }];
    const exec = fakeRigCli(f, { up: spec => ({ code: 0, stdout: JSON.stringify({ rigId: 'r9', rigName: spec }), stderr: '' }) });
    const fr = f;
    const b = bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fr.port) }), exec, sessionName: () => undefined, projects: () => ({ projects: [], rules: [] }) as Projects, home: dir, file: join(dir, 'openrig.json'), probeMs: 20, outboxMs: 30, resyncMs: 50 });
    const real = b.ensureRunning; let down = false;
    b.ensureRunning = async reason => (down ? { machine: 'local', state: 'stopped', detail: "OpenRig s'est arrêté" } : real(reason));
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: b });
    await b.start(); await until(() => b.status().state === 'running');
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = []; ws.on('message', x => msgs.push(parseServerMessage(JSON.parse(String(x)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    send({ type: 'rig.prepare', rid: 'p', machine: 'local', spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'ok' } });
    await until(() => msgs.some(m => m.type === 'rig.plan'));
    const plan = (msgs.find(m => m.type === 'rig.plan') as Extract<ServerMessage, { type: 'rig.plan' }>).plan;
    down = true;
    send({ type: 'rig.launch', rid: 'l1', planId: plan.id });
    await until(() => msgs.some(m => m.type === 'rig.result' && m.rid === 'l1'));
    expect(msgs.find(m => m.type === 'rig.result' && m.rid === 'l1')).toMatchObject({ ok: false, code: 'openrig_down' });
    down = false;
    send({ type: 'rig.launch', rid: 'l1', planId: plan.id });
    await until(() => msgs.filter(m => m.type === 'rig.result' && m.rid === 'l1').length === 2);
    expect(msgs.filter(m => m.type === 'rig.result' && m.rid === 'l1').at(-1)).toEqual({ type: 'rig.result', rid: 'l1', ok: true });
    expect(exec.calls.filter(c => c[0] === 'up')).toHaveLength(1);
    ws.close();
  });
  it('rig.act down on a launching rig cancels the pending launch first', async () => {
    vi.useRealTimers();
    const dir = tmp(); process.env.LEDGE_HOME = dir;
    f = await createFakeOpenRig(); f.specs = [{ id: 'b:factory', name: 'factory', sourceType: 'builtin', yaml: FACTORY }];
    const exec = fakeRigCli(f, { up: spec => ({ code: 0, stdout: JSON.stringify({ rigId: 'r9', rigName: spec }), stderr: '' }) });
    const fr = f;
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fr.port) }), exec, sessionName: () => undefined, projects: () => ({ projects: [], rules: [] }) as Projects, home: dir, file: join(dir, 'openrig.json'), probeMs: 20, outboxMs: 30, resyncMs: 50 });
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: bridge });
    await bridge.start(); await until(() => bridge!.status().state === 'running');
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = []; ws.on('message', x => msgs.push(parseServerMessage(JSON.parse(String(x)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    send({ type: 'rig.prepare', rid: 'p', machine: 'local', spec: 'factory', goal: 'G', where: { kind: 'off-project', name: 'ok' } });
    await until(() => msgs.some(m => m.type === 'rig.plan'));
    const plan = (msgs.find(m => m.type === 'rig.plan') as Extract<ServerMessage, { type: 'rig.plan' }>).plan;
    send({ type: 'rig.launch', rid: 'l1', planId: plan.id });
    await until(() => msgs.some(m => m.type === 'rig.result' && m.rid === 'l1'));
    expect(JSON.parse(readFileSync(join(dir, 'rig-launches.json'), 'utf8'))).toHaveLength(1);
    send({ type: 'rig.act', rid: 'd1', machine: 'local', rigId: 'r9', verb: 'down' });
    await until(() => msgs.some(m => m.type === 'rig.result' && m.rid === 'd1'));
    expect(JSON.parse(readFileSync(join(dir, 'rig-launches.json'), 'utf8'))).toEqual([]);
    ws.close();
  });
});

describe('trust', () => {
  it('no argv of a full launch (up, then goal send) contains --dangerously-interact or --raw', async () => {
    const { launches, plan, calls, bridge } = setup();
    await launches.launch(plan);
    bridge.emitSeats('r1', allReady); await flush();
    expect(sends(calls)).toHaveLength(1);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.flatMap(c => c.args).filter(a => a === '--dangerously-interact' || a === '--raw')).toEqual([]);
    launches.close();
  });
});
