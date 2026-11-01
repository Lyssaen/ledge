import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Machine, type Projects, type ServerMessage } from '@ledge/protocol';
import { createDaemonClient, type DaemonClient } from '@ledge/fleet/client';
import { createTokenSource } from '@ledge/fleet/token';
import { readDaemonToken, sessionKey } from '../src/auth.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { writeMachines } from '../src/daemon/machines.js';
import { createMemory } from '../src/daemon/brain/memory.js';
import { createPendingJournal, createReceiptJournal } from '../src/daemon/brain/remoteJournal.js';
import { remoteBrainId } from '../src/daemon/brain/remoteCoordinator.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { until } from './helpers.js';

const noTmux: Tmux = { async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return true; }, async listSessions() { return []; }, async setOption() {}, async killSession() {}, attachArgs: name => ['attach', name] };
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const homes: string[] = [], fakes: FakeOpenRig[] = [], servers: Array<{ srv: ServerHandle; bridge: Bridge }> = [];
const savedHome = process.env.LEDGE_HOME;
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'brain-remote-integration-')); homes.push(dir); return dir; };
afterEach(async () => {
  for (const x of servers.splice(0).reverse()) { await x.bridge.stop(); await x.srv.close(); }
  for (const f of fakes.splice(0)) await f.stop();
  if (savedHome === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = savedHome;
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function daemon(home: string, fake: FakeOpenRig, o: { store?: Store; machinesFile?: string; remoteConnect?: (m: Machine, url: string) => DaemonClient; fetch?: typeof fetch; graceMs?: number } = {}) {
  process.env.LEDGE_HOME = home;
  const store = o.store ?? new Store(); let srv: ServerHandle | null = null;
  const bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake.port) }), exec: fakeRigCli(fake), projects: () => none, home, file: join(home, 'openrig.json'),
    ...(o.fetch ? { fetch: o.fetch } : {}), asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
  srv = await startServer({ store, tmux: noTmux, port: 0, home, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: bridge,
    ...(o.machinesFile ? { machinesFile: o.machinesFile } : {}), ...(o.remoteConnect ? { remoteConnect: o.remoteConnect } : {}), ...(o.graceMs !== undefined ? { remoteBrainGraceMs: o.graceMs } : {}) });
  await bridge.start(); const result = { srv, bridge, store }; servers.push(result); return result;
}
async function socket(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { authorization: `Bearer ${token}` } }); const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  return { ws, msgs, close: () => new Promise<void>(resolve => { ws.once('close', () => resolve()); ws.close(); }) };
}
async function pair(o: { fetch?: typeof fetch; graceMs?: number; dropAck?: boolean | 'hold' } = {}) {
  const homeA = tmp(), homeB = tmp();
  const fakeA = await createFakeOpenRig(), fakeB = await createFakeOpenRig(); fakes.push(fakeA, fakeB);
  fakeA.rigs.push({ rigId: 'r1', name: 'starter', status: 'running', nodes: [{ logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w' }] });
  fakeA.humans.push('ledge'); fakeA.queue.push({ qitemId: 'E1', sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: 'Branch?', humanIntent: 'decision', humanQuestions: [{ id: 'q', question: 'Branch?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }], createdAt: '2026-10-30 10:00:00' });
  const origin = await daemon(homeA, fakeA, { ...(o.fetch ? { fetch: o.fetch } : {}), graceMs: o.graceMs ?? 250 });
  await until(() => origin.bridge.escalation('E1')?.questions.length === 1);
  const originToken = readDaemonToken()!; copyFileSync(join(homeA, 'token'), join(homeB, 'token'));
  writeFileSync(join(homeB, 'brain.json'), JSON.stringify({ enabled: true, tool: 'claude' }));
  const machinesFile = join(homeB, 'machines.json'); writeMachines([{ id: 'local', label: 'PC' }, { id: 'ec2', label: 'EC2', ssh: 'ec2' }], machinesFile);
  const store = new Store(), t = new Date().toISOString();
  store.upsert({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: homeB, project: 'x', title: 'Ledge', tmuxSession: 'ledge-brain', state: 'idle', helpers: [], startedAt: t, lastActivityAt: t, source: 'launcher', brain: true } as never);
  const token = createTokenSource(async () => ({ kind: 'token', token: originToken }));
  const toPeer: ClientMessage[] = [];
  let decideRid = '', dropped = false;
  const remoteConnect = (): DaemonClient => { const c = createDaemonClient({ url: `ws://127.0.0.1:${origin.srv.port}`, WebSocketImpl: WebSocket as never, token, minBackoffMs: 30, maxBackoffMs: 150 }); return { ...c, send(m) { toPeer.push(m); if (m.type === 'brain.delegate.decide') decideRid = m.rid; c.send(m); }, onMessage(fn) { return c.onMessage(m => { if (o.dropAck && !dropped && m.type === 'brain.delegate.result' && m.rid === decideRid) { dropped = true; if (o.dropAck !== 'hold') setTimeout(() => c.connect(), 0); return; } fn(m); }); } }; };
  const home = await daemon(homeB, fakeB, { store, machinesFile, remoteConnect }); process.env.LEDGE_HOME = homeB;
  const ui = await socket(home.srv.port, originToken);
  await until(() => ui.msgs.some(m => m.type === 'escalation.updated' && m.escalation.machine === 'ec2' && m.escalation.id === 'E1' && m.escalation.state === 'grace'), 8000);
  await until(() => toPeer.some(m => m.type === 'brain.delegate.claim'), 8000);
  return { homeA, homeB, origin, home, fakeA, fakeB, ui, token: originToken, toPeer, store, machinesFile, remoteConnect };
}
function submit(ws: WebSocket, token: string) { ws.send(JSON.stringify({ type: 'brain.cmd', rid: 'cmd', by: 'brain', key: sessionKey('brain', token), op: 'decide', args: [remoteBrainId('ec2', 'E1'), '--answer', 'q=a', '--category', 'git'] })); }

describe('delegated brain: two real daemon servers, fake OpenRig', () => {
  it('confirms and records only after the origin has applied the answer', async () => {
    let open!: () => void; const gate = new Promise<void>(resolve => { open = resolve; });
    let reached = false;
    const intercept: typeof fetch = async (input, init) => { if (String(input).includes('/api/mission-control/action')) { reached = true; await gate; } return fetch(input, init); };
    const p = await pair({ fetch: intercept });
    try {
      submit(p.ui.ws, p.token);
      await until(() => p.ui.msgs.some(m => m.type === 'brain.result' && m.rid === 'cmd' && m.ok));
      await until(() => reached, 8000);
      expect(createMemory({ dir: join(p.homeB, 'memoire') }).decisions()).toEqual([]);
      open();
      await until(() => createMemory({ dir: join(p.homeB, 'memoire') }).decisions().length === 1, 8000);
      expect(createMemory({ dir: join(p.homeB, 'memoire') }).decisions()).toMatchObject([{ by: 'ledge', escalationId: remoteBrainId('ec2', 'E1'), answers: { q: 'a' } }]);
      expect(p.fakeA.requests.filter(r => r.method === 'POST' && r.path === '/api/mission-control/action')).toHaveLength(1);
    } finally { open(); await p.ui.close(); }
  }, 15_000);
  it('recovers a lost acknowledgement from the origin proof without applying twice', async () => {
    const p = await pair({ dropAck: true });
    try {
      submit(p.ui.ws, p.token);
      await until(() => p.toPeer.some(m => m.type === 'brain.delegate.query'), 8000);
      await until(() => createMemory({ dir: join(p.homeB, 'memoire') }).decisions().length === 1, 8000);
      expect(createPendingJournal(join(p.homeB, 'brain-delegation-pending.json')).all()).toEqual([]);
      expect(p.fakeA.requests.filter(r => r.method === 'POST' && r.path === '/api/mission-control/action')).toHaveLength(1);
      expect(p.toPeer.filter(m => m.type === 'brain.delegate.decide')).toHaveLength(1);
    } finally { await p.ui.close(); }
  }, 15_000);
  it('recovers a pending proof after the coordinating daemon restarts', async () => {
    const p = await pair({ dropAck: 'hold' });
    submit(p.ui.ws, p.token);
    await until(() => p.fakeA.requests.some(r => r.method === 'POST' && r.path === '/api/mission-control/action'), 8000);
    await until(() => createPendingJournal(join(p.homeB, 'brain-delegation-pending.json')).all().length === 1);
    // Wait for the source to persist its proof before simulating the coordinator crash.
    await until(() => createReceiptJournal(join(p.homeA, 'brain-delegation-receipts.json')).all().some(r => r.state === 'applied'), 8000);
    await p.ui.close(); await p.home.bridge.stop(); await p.home.srv.close();
    servers.splice(servers.indexOf(p.home), 1);
    await daemon(p.homeB, p.fakeB, { store: p.store, machinesFile: p.machinesFile, remoteConnect: p.remoteConnect });
    await until(() => p.toPeer.some(m => m.type === 'brain.delegate.query'), 8000);
    await until(() => createMemory({ dir: join(p.homeB, 'memoire') }).decisions().length === 1, 8000);
    expect(createPendingJournal(join(p.homeB, 'brain-delegation-pending.json')).all()).toEqual([]);
    expect(p.fakeA.requests.filter(r => r.method === 'POST' && r.path === '/api/mission-control/action')).toHaveLength(1);
    expect(p.toPeer.filter(m => m.type === 'brain.delegate.decide')).toHaveLength(1);
  }, 15_000);
  it('a user answer during grace wins and cancels the remote candidate', async () => {
    const p = await pair({ graceMs: 500 }); const originUi = await socket(p.origin.srv.port, p.token);
    try {
      submit(p.ui.ws, p.token); await until(() => p.ui.msgs.some(m => m.type === 'brain.result' && m.rid === 'cmd' && m.ok));
      originUi.ws.send(JSON.stringify({ type: 'escalation.answer', rid: 'user', id: 'E1', answers: { q: 'b' }, by: 'user' }));
      await until(() => originUi.msgs.some(m => m.type === 'rig.result' && m.rid === 'user' && m.ok));
      await new Promise(resolve => setTimeout(resolve, 650));
      expect(p.toPeer.filter(m => m.type === 'brain.delegate.decide')).toHaveLength(0);
      expect(createMemory({ dir: join(p.homeB, 'memoire') }).decisions()).toEqual([]);
      expect(p.fakeA.requests.filter(r => r.method === 'POST' && r.path === '/api/mission-control/action')).toHaveLength(1);
    } finally { await originUi.close(); await p.ui.close(); }
  });
});
