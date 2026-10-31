import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Projects, type ServerMessage } from '@ledge/protocol';
import { createOpenRigHttp } from '../src/daemon/openrig/http.js';
import { listSpecs, specSeats } from '../src/daemon/openrig/specs.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const STARTER_YAML = readFileSync(new URL('./fixtures/starter-rig.yaml', import.meta.url), 'utf8');
const MINE_YAML = 'version: "0.2"\nname: mine\npods:\n  - id: p\n    members:\n      - id: solo\n        runtime: claude-code\n        model: opus\n        effort: high\n';
const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;

let fake: FakeOpenRig | null = null; let bridge: Bridge | null = null; let srv: ServerHandle | null = null; const dirs: string[] = [];
afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('specSeats', () => {
  it('reads the members of every pod, address @member', () => {
    expect(specSeats(STARTER_YAML)).toEqual([
      { address: '@build', member: 'build', pod: 'dev', runtime: 'claude-code', profile: 'default' },
      { address: '@review', member: 'review', pod: 'dev', runtime: 'codex', model: 'gpt-6-astra', profile: 'default' }]);
  });
  it('answers an unreadable YAML with an empty list, without throwing', () => { expect(specSeats(':\n- [')).toEqual([]); });
  it('answers a YAML without pods with an empty list', () => { expect(specSeats('name: x\n')).toEqual([]); });
});

describe('listSpecs', () => {
  it('builtin -> builtin, user_file -> library, seats read from the yaml', async () => {
    fake = await createFakeOpenRig();
    fake.specs = [{ id: 'b:starter', name: 'starter', sourceType: 'builtin', yaml: STARTER_YAML }, { id: 'u:mine', name: 'mine', sourceType: 'user_file', yaml: MINE_YAML }];
    const specs = await listSpecs(createOpenRigHttp({ base: fake.url }));
    expect(specs.map(s => [s.name, s.source, s.seats.length])).toEqual([['starter', 'builtin', 2], ['mine', 'library', 1]]);
    expect(specs[1]!.seats[0]).toEqual({ address: '@solo', member: 'solo', pod: 'p', runtime: 'claude-code', model: 'opus', effort: 'high' });
    expect(specs[0]!.summary).toMatch(/Claude Code builder/);
    expect(fake.requests.map(r => r.path + (r.search ?? ''))).toContain('/api/specs/library?kind=rig');
  });
  it('an entry whose yaml cannot be fetched keeps seats []', async () => {
    fake = await createFakeOpenRig();
    fake.specs = [{ id: 'u:gone', name: 'gone', sourceType: 'user_file', yaml: MINE_YAML, missing: true }];
    const specs = await listSpecs(createOpenRigHttp({ base: fake.url }));
    expect(specs).toMatchObject([{ id: 'u:gone', source: 'library', seats: [] }]);
  });
});

describe('server rig.specs.request', () => {
  async function run(withBridge: boolean, stopFake: boolean) {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-openrig-specs-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
    const store = new Store();
    const f = fake = await createFakeOpenRig(); f.specs = [{ id: 'b:starter', name: 'starter', sourceType: 'builtin', yaml: STARTER_YAML }];
    if (withBridge) bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(f.port) }), exec: fakeRigCli(f), sessionName: () => undefined, projects: () => none, home: dir, file: join(dir, 'openrig.json'), probeMs: 20, outboxMs: 30, resyncMs: 50 });
    srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), ...(bridge ? { openrig: bridge } : {}) });
    if (bridge) { await bridge.start(); await until(() => bridge!.status().state === 'running'); }
    if (stopFake) { await f.stop(); await until(() => bridge!.status().state !== 'running'); }
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = []; ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    return { msgs, send, close: () => ws.close() };
  }
  it('answers rig.specs with the requestId and the specs', async () => {
    const c = await run(true, false);
    c.send({ type: 'rig.specs.request', requestId: 'q1' });
    await until(() => c.msgs.some(m => m.type === 'rig.specs'));
    const m = c.msgs.find(m => m.type === 'rig.specs')!;
    expect(m).toMatchObject({ type: 'rig.specs', requestId: 'q1', machine: 'local' });
    expect((m as { specs: unknown[] }).specs).toHaveLength(1); expect(m).not.toHaveProperty('error'); c.close();
  });
  it('answers error openrig_down when OpenRig is stopped', async () => {
    const c = await run(true, true);
    c.send({ type: 'rig.specs.request', requestId: 'q2' });
    await until(() => c.msgs.some(m => m.type === 'rig.specs'));
    expect(c.msgs.find(m => m.type === 'rig.specs')).toMatchObject({ requestId: 'q2', machine: 'local', specs: [], error: 'openrig_down' }); c.close();
  });
  it('answers error openrig_down when the daemon has no bridge', async () => {
    const c = await run(false, false);
    c.send({ type: 'rig.specs.request', requestId: 'q3' });
    await until(() => c.msgs.some(m => m.type === 'rig.specs'));
    expect(c.msgs.find(m => m.type === 'rig.specs')).toMatchObject({ requestId: 'q3', error: 'openrig_down' }); c.close();
  });
});
