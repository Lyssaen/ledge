import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenRigStatus, Rig, Team } from '@ledge/protocol';
import { readTeamsEngine, writeTeamsEngine, engineRunning, openrigAvailable, switchRefusal } from '../src/daemon/engine/setting.js';
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
