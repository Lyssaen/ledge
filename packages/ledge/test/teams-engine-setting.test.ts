import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenRigStatus, Rig, Team } from '@ledge/protocol';
import { readTeamsEngine, writeTeamsEngine, engineRunning, openrigAvailable, switchRefusal, initialTeamsEngine } from '../src/daemon/engine/setting.js';
import { runTeams } from '../src/cli/team.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { paths } from '../src/paths.js';
import { until } from './helpers.js';

const team = (state: Team['state']) => ({ state }) as Team;
const rig = (lifecycle: Rig['lifecycle'], kernel = false) => ({ lifecycle, kernel }) as Rig;
const st = (state: OpenRigStatus['state']): OpenRigStatus => ({ machine: 'local', state });
const none = { teams: [], rigs: [], statuses: [st('running')] };

let dir: string;
const role = (id: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\nlabel: Lead\n---\nTu es ${id}.\n`); };
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-engine-')); process.env.LEDGE_HOME = dir; role('leader'); });

describe('the teams engine file', () => {
  it('is ledge when absent or corrupt, and round-trips', () => {
    const f = join(dir, 'teams-engine.json');
    expect(readTeamsEngine(f)).toBe('ledge');
    writeFileSync(f, '{nope'); expect(readTeamsEngine(f)).toBe('ledge');
    writeFileSync(f, '{"engine":"bogus"}'); expect(readTeamsEngine(f)).toBe('ledge');
    writeTeamsEngine(f, 'openrig'); expect(readTeamsEngine(f)).toBe('openrig');
  });
});

describe('switchRefusal', () => {
  it('lets the same engine through', () => expect(switchRefusal('ledge', 'ledge', { ...none, teams: [team('active')] })).toBeNull());
  it('refuses openrig when absent everywhere', () => {
    const m = "OpenRig n'est installé sur aucune machine : installe-le (npm i -g @openrig/cli) avant de le choisir";
    expect(switchRefusal('ledge', 'openrig', { teams: [], rigs: [], statuses: [] })).toBe(m);
    expect(switchRefusal('ledge', 'openrig', { teams: [], rigs: [], statuses: [st('absent')] })).toBe(m);
    expect(openrigAvailable([st('absent'), st('stopped')])).toBe(true);
  });
  it('refuses while a Ledge team is active, not while it rests', () => {
    expect(switchRefusal('ledge', 'openrig', { ...none, teams: [team('active')] })).toBe('une équipe Ledge tourne : mets-la au repos ou dissous-la avant de changer de moteur');
    expect(switchRefusal('ledge', 'openrig', { ...none, teams: [team('resting'), team('dissolved')] })).toBeNull();
  });
  it('refuses while an OpenRig rig runs, but a kernel rig does not count', () => {
    for (const l of ['running', 'partial', 'launching'] as const)
      expect(switchRefusal('openrig', 'ledge', { ...none, rigs: [rig(l)] })).toBe('un rig OpenRig tourne : arrête-le avant de changer de moteur');
    expect(switchRefusal('openrig', 'ledge', { ...none, rigs: [rig('running', true), rig('stopped')] })).toBeNull();
    expect(engineRunning('openrig', { teams: [], rigs: [rig('unreachable')] })).toBe(false);
  });
});

const panes = new Set<string>();
const noTmux: Tmux = { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
  async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n] };

describe('the daemon', () => {
  let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null;
  afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; rmSync(dir, { recursive: true, force: true }); });
  async function boot(withBridge: boolean) {
    if (withBridge) {
      fake = await createFakeOpenRig();
      bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as never, home: dir, file: join(dir, 'openrig.json'),
        asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    }
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))], ...(bridge ? { openrig: bridge } : {}) });
    if (bridge) { await bridge.start(); await until(() => bridge!.status().state === 'running'); }
    const c = await connect({ port: srv.port });
    await c.next('snapshot');
    return c;
  }
  const file = () => paths().teamsEngine;

  it('sends teams.engine in the snapshot', async () => {
    const c = await boot(false);
    expect(await c.next('teams.engine')).toEqual({ type: 'teams.engine', engine: 'ledge', openrigAvailable: false, running: false });
  });
  it('refuses openrig when it is absent, and writes nothing', async () => {
    const c = await boot(false);
    c.send({ type: 'teams.engine.set', rid: 'a', engine: 'openrig' });
    const r = await c.next('teams.engine.result');
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/installé sur aucune machine/);
    expect(existsSync(file())).toBe(false);
  });
  it('refuses while a team is active', async () => {
    const c = await boot(true);
    c.send({ type: 'team.launch', rid: 'l', cwd: dir, name: 'api', seats: [{ role: 'leader' }] });
    await c.next('team.launched', 5000);
    c.send({ type: 'teams.engine.set', rid: 'a', engine: 'openrig' });
    const r = await c.next('teams.engine.result');
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/une équipe Ledge tourne/);
    expect(existsSync(file())).toBe(false);
  });
  it('switches to openrig when it is present: file written, teams.engine broadcast', async () => {
    const c = await boot(true);
    c.send({ type: 'teams.engine.set', rid: 'a', engine: 'openrig' });
    expect((await c.next('teams.engine.result')).ok).toBe(true);
    expect(JSON.parse(readFileSync(file(), 'utf8')).engine).toBe('openrig');
    let seen = await c.next('teams.engine'); // the snapshot's may still be queued
    if (seen.engine !== 'openrig') seen = await c.next('teams.engine');
    expect(seen).toMatchObject({ engine: 'openrig', openrigAvailable: true });
  });
});

// Branch review I1: an OpenRig user who upgrades keeps OpenRig; `ledge teams engine` reads and switches the engine.
describe('the first start without teams-engine.json', () => {
  let srv: ServerHandle | null = null;
  afterEach(async () => { await srv?.close(); srv = null; rmSync(dir, { recursive: true, force: true }); });
  const openrigFile = (local: { lastEventId: number | null; rigs: string[] }) =>
    writeFileSync(join(dir, 'openrig.json'), JSON.stringify({ version: 1, machines: { local: { ...local, at: '2026-10-30T08:00:00.000Z' } } }));
  async function boot() {
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    return (await c.next('teams.engine')).engine;
  }

  it('rigs OpenRig mirrored on this machine before: OpenRig, written to the file', async () => {
    openrigFile({ lastEventId: 41, rigs: ['starter'] });
    expect(initialTeamsEngine(paths().teamsEngine, paths().openrig)).toBe('openrig');
    expect(JSON.parse(readFileSync(paths().teamsEngine, 'utf8')).engine).toBe('openrig');
    rmSync(paths().teamsEngine);
    expect(await boot()).toBe('openrig');
    expect(readTeamsEngine(paths().teamsEngine)).toBe('openrig');
  });
  it('a cursor alone (OpenRig ran here, no rig kept) is OpenRig too', async () => {
    openrigFile({ lastEventId: 7, rigs: [] });
    expect(await boot()).toBe('openrig');
    expect(existsSync(paths().teamsEngine)).toBe(true);
  });
  it('no openrig.json, or one with nothing of this machine: Ledge, and nothing written', async () => {
    expect(await boot()).toBe('ledge');
    expect(existsSync(paths().teamsEngine)).toBe(false);
    await srv!.close(); srv = null;
    writeFileSync(join(dir, 'openrig.json'), JSON.stringify({ version: 1, machines: { legion: { lastEventId: 3, rigs: ['far'], at: '2026-10-30T08:00:00.000Z' } } }));
    expect(await boot()).toBe('ledge');
    expect(existsSync(paths().teamsEngine)).toBe(false);
  });
  it('a choice already in the file is kept, whatever openrig.json says', async () => {
    openrigFile({ lastEventId: 41, rigs: ['starter'] });
    writeTeamsEngine(paths().teamsEngine, 'ledge');
    expect(await boot()).toBe('ledge');
    expect(readTeamsEngine(paths().teamsEngine)).toBe('ledge');
  });
});

describe('ledge teams engine', () => {
  let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null;
  afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; rmSync(dir, { recursive: true, force: true }); });
  async function boot(withBridge: boolean) {
    if (withBridge) {
      fake = await createFakeOpenRig();
      bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as never, home: dir, file: join(dir, 'openrig.json'),
        asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    }
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))], ...(bridge ? { openrig: bridge } : {}) });
    if (bridge) { await bridge.start(); await until(() => bridge!.status().state === 'running'); }
    return { port: srv.port };
  }

  it('prints the engine in force, whether a team runs and whether OpenRig is there', async () => {
    const o = await boot(false);
    expect(await runTeams(['engine'], o)).toEqual({ line: "moteur d'équipes : ledge · une équipe tourne : non · OpenRig disponible : non", code: 0 });
  });
  it('a refused switch says why and exits 1; the file is not written', async () => {
    const o = await boot(false);
    expect(await runTeams(['engine', 'openrig'], o)).toEqual({ line: "refusé : OpenRig n'est installé sur aucune machine : installe-le (npm i -g @openrig/cli) avant de le choisir", code: 1 });
    expect(existsSync(paths().teamsEngine)).toBe(false);
  });
  it('switches to OpenRig and back through teams.engine.set', async () => {
    const o = await boot(true);
    expect(await runTeams(['engine', 'openrig'], o)).toEqual({ line: "moteur d'équipes : openrig", code: 0 });
    expect(readTeamsEngine(paths().teamsEngine)).toBe('openrig');
    expect((await runTeams(['engine'], o)).line).toBe("moteur d'équipes : openrig · un rig tourne : non · OpenRig disponible : oui");
    expect(await runTeams(['engine', 'ledge'], o)).toEqual({ line: "moteur d'équipes : ledge", code: 0 });
    expect(readTeamsEngine(paths().teamsEngine)).toBe('ledge');
  });
  it('a bad engine or verb prints the usage and exits 1; no daemon is said', async () => {
    expect((await runTeams(['engine', 'bogus'], { port: 1 })).code).toBe(1);
    expect((await runTeams(['nope'], { port: 1 })).code).toBe(1);
    expect((await runTeams(['engine', 'bogus'], { port: 1 })).line).toMatch(/ledge teams engine <ledge\|openrig>/);
    expect(await runTeams(['engine'], { port: 1 })).toMatchObject({ code: 1, line: expect.stringMatching(/daemon/i) });
  });
});
