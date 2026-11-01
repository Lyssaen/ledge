import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Projects, type ServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { createRidMemo } from '../src/daemon/openrig/ridMemo.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig, type FakeRigCli } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const ok = (rid: string): ServerMessage => ({ type: 'rig.result', rid, ok: true });

describe('createRidMemo', () => {
  it('runs once per (type, rid), in parallel and afterwards, and replays the requester messages', async () => {
    const memo = createRidMemo();
    let runs = 0; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const run = async (reply: (m: ServerMessage) => void) => { runs++; await gate; reply(ok('r1')); };
    const a: ServerMessage[] = []; const b: ServerMessage[] = []; const c: ServerMessage[] = [];
    const p1 = memo.once('escalation.answer', 'r1', m => a.push(m), run);
    const p2 = memo.once('escalation.answer', 'r1', m => b.push(m), run);
    await Promise.resolve(); release(); await Promise.all([p1, p2]);
    await memo.once('escalation.answer', 'r1', m => c.push(m), run);
    expect(runs).toBe(1);
    expect(a).toEqual([ok('r1')]); expect(b).toEqual([ok('r1')]); expect(c).toEqual([ok('r1')]);
  });

  it('runs again for another rid, another type, and after the ttl; evicts the oldest past max', async () => {
    let t = 0; const memo = createRidMemo({ ttlMs: 1000, max: 2, now: () => t });
    let runs = 0; const run = async (reply: (m: ServerMessage) => void) => { runs++; reply(ok('x')); };
    const r = () => undefined;
    await memo.once('rig.act', 'r1', r, run); await memo.once('rig.act', 'r2', r, run); await memo.once('rig.send', 'r1', r, run);
    expect(runs).toBe(3);
    await memo.once('rig.send', 'r1', r, run); expect(runs).toBe(3);
    await memo.once('rig.act', 'r1', r, run); expect(runs).toBe(4); // evicted (max 2)
    t = 2000; await memo.once('rig.act', 'r1', r, run); expect(runs).toBe(5);
  });

  it('forgets a run that answered a transient refusal (openrig_down, unreachable): the same rid runs again; a waiter got the refusal', async () => {
    const memo = createRidMemo(); let runs = 0; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const down: ServerMessage = { type: 'rig.result', rid: 'r1', ok: false, code: 'openrig_down', reason: 'pas lu' };
    const run = async (reply: (m: ServerMessage) => void) => { if (++runs === 1) { await gate; reply(down); } else reply(ok('r1')); };
    const a: ServerMessage[] = []; const b: ServerMessage[] = []; const c: ServerMessage[] = []; const d: ServerMessage[] = [];
    const p1 = memo.once('escalation.answer', 'r1', m => a.push(m), run);
    const p2 = memo.once('escalation.answer', 'r1', m => b.push(m), run);
    await Promise.resolve(); release(); await Promise.all([p1, p2]);
    expect(a).toEqual([down]); expect(b).toEqual([down]);
    await memo.once('escalation.answer', 'r1', m => c.push(m), run);
    expect(runs).toBe(2); expect(c).toEqual([ok('r1')]);
    await memo.once('escalation.answer', 'r1', m => d.push(m), run); // a definite outcome is kept
    expect(runs).toBe(2); expect(d).toEqual([ok('r1')]);
    let n = 0; const unreachable = async (reply: (m: ServerMessage) => void) => { n++; reply({ type: 'rig.result', rid: 'r2', ok: false, code: 'unreachable', reason: 'x' }); };
    await memo.once('rig.act', 'r2', () => undefined, unreachable); await memo.once('rig.act', 'r2', () => undefined, unreachable);
    expect(n).toBe(2);
    let f = 0; const failed = async (reply: (m: ServerMessage) => void) => { f++; reply({ type: 'rig.result', rid: 'r3', ok: false, code: 'failed', reason: 'x' }); };
    await memo.once('rig.act', 'r3', () => undefined, failed); await memo.once('rig.act', 'r3', () => undefined, failed);
    expect(f).toBe(1);
  });

  it('forgets a run that threw so a retry runs again', async () => {
    const memo = createRidMemo(); let runs = 0;
    const run = async () => { if (++runs === 1) throw new Error('boom'); };
    await expect(memo.once('rig.act', 'r1', () => undefined, run)).rejects.toThrow('boom');
    await memo.once('rig.act', 'r1', () => undefined, run); expect(runs).toBe(2);
  });
});

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });
const humanRow = (id: string) => ({ qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: `question ${id}`, createdAt: '2026-10-30 10:00:00' });

let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; let dir = ''; let exec: FakeRigCli | null = null;
afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('server: a resent escalation.answer', () => {
  it('reaches OpenRig once and answers rig.result ok twice', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ledge-openrig-rid-')); process.env.LEDGE_HOME = dir;
    const store = new Store(); let server: ServerHandle | null = null;
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'));
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: (exec = fakeRigCli(fake)), projects: () => none, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => server!.asks.all(), onChange: f => server!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    server = srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: bridge });
    await bridge.start();
    await until(() => bridge!.status().state === 'running' && bridge!.escalations().length === 1);
    const esc = bridge.escalations()[0]!;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers: authHeaders() }); const msgs: ServerMessage[] = [];
    ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const answerMsg: ClientMessage = { type: 'escalation.answer', rid: 'same-rid', id: esc.id, answers: Object.fromEntries(esc.questions.map(q => [q.id, q.options[0]?.id ?? 'x'])), by: 'user' } as ClientMessage;
    ws.send(JSON.stringify(answerMsg));
    await until(() => msgs.some(m => m.type === 'rig.result' && m.rid === 'same-rid'));
    const posts = () => fake!.requests.filter(r => r.method === 'POST').length;
    const queueCreates = () => exec!.calls.filter(c => c.join(' ').includes('queue create')).length;
    const before = { posts: posts(), creates: queueCreates() };
    expect(before.posts + before.creates).toBeGreaterThan(0);
    ws.send(JSON.stringify(answerMsg));
    await until(() => msgs.filter(m => m.type === 'rig.result' && m.rid === 'same-rid').length === 2);
    await new Promise(r => setTimeout(r, 150));
    expect({ posts: posts(), creates: queueCreates() }).toEqual(before);
    expect(msgs.filter(m => m.type === 'rig.result' && m.rid === 'same-rid')).toEqual([ok('same-rid'), ok('same-rid')]);
    ws.close();
  });
});
