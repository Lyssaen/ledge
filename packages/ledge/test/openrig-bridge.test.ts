import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerMessageSchema, type Ask, type Projects, type Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { pairSession } from '../src/daemon/openrig/pairing.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { createBridge, type Bridge, type BridgeDeps, type BridgeMessage } from '../src/daemon/openrig/bridge.js';
import { readOpenRigFile } from '../src/daemon/openrig/cursor.js';
import type { RigExec } from '../src/daemon/openrig/cli.js';

const until = async (ok: () => boolean, ms = 4000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const dirs: string[] = []; let fake: FakeOpenRig | null = null; let bridge: Bridge | null = null;
afterEach(async () => { await bridge?.stop(); bridge = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } },
  { logicalId: 'dev.test', canonicalSessionName: 'dev-test@starter', runtime: 'codex', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });
const humanRow = (id: string) => ({ qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: `question ${id}`, createdAt: '2026-10-30 10:00:00' });
/** Seat-to-seat queue event (an exchange, not an escalation). */
const polls = (ref: string) => fake!.requests.filter(r => r.path === '/api/queue/outbox/list' && r.search?.includes(encodeURIComponent(ref))).length;
const task = (id: string) => ({ type: 'queue.created', qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'dev-test@starter', summary: `do ${id}` });

function setup(over: Partial<BridgeDeps> & { rigs?: string[]; exec?: RigExec } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ledge-bridge-')); dirs.push(d); const file = join(d, 'openrig.json');
  if (over.rigs) writeFileSync(file, JSON.stringify({ version: 1, machines: { local: { lastEventId: null, rigs: over.rigs, at: '2026-10-30T10:00:00.000Z' } } }));
  const notices: string[] = []; const msgs: BridgeMessage[] = [];
  const b = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), projects: () => none, home: d, file, sessionName: () => undefined,
    probeMs: 20, outboxMs: 30, notice: t => notices.push(t), ...over });
  b.onMessage(m => { ServerMessageSchema.parse(m); msgs.push(m); });
  bridge = b;
  const of = <T extends BridgeMessage['type']>(t: T) => msgs.filter((m): m is Extract<BridgeMessage, { type: T }> => m.type === t);
  return { b, file, notices, msgs, of };
}

describe('OpenRig bridge', () => {
  it('starts with a known rig', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); await fake.stop();
    const exec = fakeRigCli(fake); const { b, notices, of } = setup({ exec, rigs: ['starter'] });
    await b.start();
    await until(() => of('rig.snapshot').some(m => m.rigs.some(r => r.name === 'starter')));
    expect(exec.calls.filter(c => c.join(' ') === 'daemon start')).toHaveLength(1);
    expect(notices).toContain("J'ai démarré OpenRig sur local");
    const states = of('openrig.status').map(m => m.status.state);
    expect(states).toContain('starting'); expect(states.at(-1)).toBe('running');
    expect(b.status()).toMatchObject({ machine: 'local', state: 'running', version: '0.6.14' });
    await sleep(100); expect(exec.calls.filter(c => c.join(' ') === 'daemon start')).toHaveLength(1);
  });

  it('does not start without known rigs', async () => {
    fake = await createFakeOpenRig(); await fake.stop();
    const exec = fakeRigCli(fake); const { b } = setup({ exec });
    await b.start(); await until(() => exec.calls.filter(c => c[0] === '--version').length >= 3);
    expect(exec.calls.some(c => c.join(' ') === 'daemon start')).toBe(false);
    expect(b.status().state).toBe('stopped');
  });

  it('auto start failure is an error with no retry before retryMs', async () => {
    fake = await createFakeOpenRig(); await fake.stop();
    const exec = fakeRigCli(fake, { startFails: true }); const { b } = setup({ exec, rigs: ['starter'] });
    await b.start(); await until(() => b.status().state === 'error');
    expect(b.status().detail).toContain('port busy'); await sleep(150);
    expect(exec.calls.filter(c => c.join(' ') === 'daemon start')).toHaveLength(1); expect(b.status().state).toBe('error');
  });

  it('ensureRunning starts a stopped OpenRig and waits for running', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); await fake.stop();
    const exec = fakeRigCli(fake); const { b } = setup({ exec });
    await b.start(); await until(() => exec.calls.length > 0);
    const [s1, s2] = await Promise.all([b.ensureRunning('launch'), b.ensureRunning('action')]);
    expect(s1.state).toBe('running'); expect(s2.state).toBe('running');
    expect(exec.calls.filter(c => c.join(' ') === 'daemon start')).toHaveLength(1);
    expect((await b.ensureRunning('action')).state).toBe('running');
    expect(exec.calls.filter(c => c.join(' ') === 'daemon start')).toHaveLength(1);
  });

  it('registers once', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter());
    const exec = fakeRigCli(fake); const { b, of } = setup({ exec });
    await b.start(); await until(() => b.status().human === 'registered');
    await sleep(100);
    expect(exec.calls.filter(c => c.slice(0, 3).join(' ') === 'gateway human add')).toHaveLength(1);
    expect(fake.humans).toEqual(['ledge']); expect(of('openrig.status').at(-1)!.status.human).toBe('registered');
  });

  it('a failed registration is not retried before retryMs', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter());
    const inner = fakeRigCli(fake); let n = 0; const adds = () => n;
    const exec = (async (args: string[]) => args.slice(0, 3).join(' ') === 'gateway human add' ? (n++, { code: 1, stdout: '', stderr: 'refused (fake)' }) : inner(args)) as RigExec;
    const { b } = setup({ exec, retryMs: 300 });
    await b.start(); await until(() => b.status().human === 'failed');
    await sleep(150); expect(adds()).toBe(1);
    await until(() => adds() === 2); expect(b.status().human).toBe('failed');
  });

  it('replaces another human and says so (R3)', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('alice');
    const exec = fakeRigCli(fake); const { b, notices } = setup({ exec });
    await b.start(); await until(() => b.status().human === 'registered');
    expect(exec.calls.find(c => c.slice(0, 3).join(' ') === 'gateway human add')).toContain('--replace');
    expect(notices).toContain("J'ai remplacé l'humain alice par Ledge sur local");
  });

  it('does not register without a non-kernel rig', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push({ rigId: 'k', name: 'kernel', status: 'running', nodes: [] });
    const exec = fakeRigCli(fake); const { b } = setup({ exec });
    await b.start(); await until(() => b.status().state === 'running'); await sleep(100);
    expect(exec.calls.some(c => c[0] === 'gateway')).toBe(false); expect(b.status().human).toBe('missing');
  });

  it('escalation arrives, asks live in their own book', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    let asks: Ask[] = [{ id: 'a000001', from: 's1', fromName: 'solo', question: 'Merge?', options: 'yes / no', at: '2026-10-30T10:00:00.000Z', state: 'open' }];
    const fns = new Set<() => void>(); const changed = () => { for (const f of fns) f(); };
    const { b, of } = setup({ exec: fakeRigCli(fake), asks: { all: () => asks, onChange: f => { fns.add(f); return () => fns.delete(f); } } });
    await b.start(); await until(() => b.status().state === 'running');
    expect(of('escalation.updated').map(m => m.escalation.id)).toEqual(['ask-a000001']);
    fake.queue.push(humanRow('q1')); fake.emit({ type: 'queue.created', qitemId: 'q1', sourceSession: 'dev-build@starter', destinationSession: 'ledge@external' });
    await until(() => of('escalation.updated').some(m => m.escalation.id === 'q1'));
    expect(of('escalation.updated').find(m => m.escalation.id === 'q1')!.escalation).toMatchObject({ source: 'rig', rigId: 'r1', machine: 'local', summary: 'question q1' });
    expect(b.escalations().map(e => e.id).sort()).toEqual(['ask-a000001', 'q1']);
    expect(of('rig.exchange')).toHaveLength(0);
    // The row leaves the open states: removed; the ask is untouched by the queue re-read.
    fake.queue[0]!.state = 'done'; fake.emit({ type: 'queue.updated', qitemId: 'q1' });
    await until(() => of('escalation.removed').some(m => m.id === 'q1'));
    expect(b.escalations().map(e => e.id)).toEqual(['ask-a000001']);
    asks = [{ ...asks[0]!, state: 'answered', answer: { text: 'yes', at: '2026-10-30T10:01:00.000Z' } }]; changed();
    expect(of('escalation.removed').map(m => m.id)).toContain('ask-a000001'); expect(b.escalations()).toEqual([]);
    expect(b.replay().map(m => m.type)).toEqual(['openrig.status', 'rig.snapshot']);
  });

  it('asks are escalations even when OpenRig is absent', async () => {
    fake = await createFakeOpenRig(); await fake.stop();
    const asks: Ask[] = [{ id: 'a000002', from: 's1', fromName: 'solo', question: 'Q?', options: '', at: '2026-10-30T10:00:00.000Z', state: 'open' }];
    const { b, of } = setup({ exec: fakeRigCli(null), sessionName: id => (id === 's1' ? 'ledge-solo' : undefined), asks: { all: () => asks, onChange: () => () => {} } });
    await b.start(); await until(() => b.status().state === 'absent');
    expect(of('escalation.updated')[0]!.escalation).toMatchObject({ id: 'ask-a000002', source: 'ask', from: 'ledge-solo', state: 'pending' });
    expect(b.replay().map(m => m.type)).toEqual(['openrig.status', 'rig.snapshot', 'escalation.updated']);
  });

  it('resumes after an OpenRig restart', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'));
    const { b, of, msgs, file } = setup({ exec: fakeRigCli(fake) });
    await b.start(); await until(() => b.status().state === 'running'); await until(() => polls('dev-build@starter') >= 2); // first listing seeded
    // 1. three exchanges: two queue tasks (SSE) and one `rig send` (outbox poll).
    fake.emit(task('X1')); fake.emit(task('X2'));
    fake.outbox.set('dev-build@starter', [{ outboxId: 'outbox-X3', senderSession: 'dev-build@starter', destinationSession: 'dev-test@starter', body: 'hello', deliveryState: 'delivered' }]);
    await until(() => of('rig.exchange').length === 3);
    const lastSeq = 2;
    // 2. OpenRig goes away.
    const cut = msgs.length; await fake.stop();
    await until(() => b.status().state === 'stopped');
    const during = msgs.slice(cut);
    expect(during.some(m => m.type === 'rig.updated' && m.rig.name === 'starter' && m.rig.lifecycle === 'unreachable')).toBe(true);
    expect(during.some(m => m.type === 'openrig.status' && m.status.state === 'stopped')).toBe(true);
    // 3. while it is down: escalation E2 and exchange X4.
    fake.queue.push(humanRow('E2')); fake.emit({ type: 'queue.created', qitemId: 'E2', sourceSession: 'dev-build@starter', destinationSession: 'ledge@external' });
    fake.emit(task('X4'));
    // 4. it comes back: the stream resumes from the cursor.
    const back = msgs.length; await fake.restart();
    await until(() => b.status().state === 'running');
    const sse = fake.requests.filter(r => r.path === '/api/events');
    expect(sse.at(-1)!.lastEventId).toBe(String(lastSeq));
    await until(() => of('rig.exchange').some(m => m.exchange.id === 'q-X4') && of('escalation.updated').some(m => m.escalation.id === 'E2'));
    await sleep(300); // queue re-read (200 ms) and several outbox polls
    // 5. starter running again, E2 once, E1 not re-sent, X4 once, no exchange id twice.
    const after = msgs.slice(back);
    expect(after.some(m => m.type === 'rig.snapshot' && m.rigs.find(r => r.name === 'starter')?.lifecycle === 'running')).toBe(true);
    const ups = of('escalation.updated').map(m => m.escalation.id);
    expect(ups.filter(id => id === 'E2')).toHaveLength(1); expect(ups.filter(id => id === 'E1')).toHaveLength(1);
    const ids = of('rig.exchange').map(m => m.exchange.id);
    expect(ids.sort()).toEqual(['o-outbox-X3', 'q-X1', 'q-X2', 'q-X4']);
    expect(b.exchanges('r1').map(x => x.id)).toHaveLength(4);
    await b.stop(); bridge = null;
    expect(readOpenRigFile(file).machines.local).toMatchObject({ lastEventId: 4, rigs: ['starter'] });
  });

  it('falls back to a fresh stream when the cursor is refused', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    const base = fetch; let refused = 0;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      if (String(input).includes('/api/events') && h.has('last-event-id')) { refused++; return new Response('too old', { status: 410 }); }
      return base(input, init);
    }) as typeof fetch;
    const d = mkdtempSync(join(tmpdir(), 'ledge-bridge-')); dirs.push(d); const file = join(d, 'openrig.json');
    writeFileSync(file, JSON.stringify({ version: 1, machines: { local: { lastEventId: 999, rigs: ['starter'], at: '2026-10-30T10:00:00.000Z' } } }));
    const { b } = setup({ exec: fakeRigCli(fake), fetch: f, file });
    await b.start(); await until(() => b.status().state === 'running');
    expect(refused).toBe(1); expect(fake.requests.filter(r => r.path === '/api/events').at(-1)!.search).toBe('?replay=0');
    expect(b.rigs().map(r => r.name)).toEqual(['starter']);
  });

  it('resyncs from ps', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    const { b, of } = setup({ exec: fakeRigCli(fake), resyncMs: 50 });
    await b.start(); await until(() => b.status().state === 'running');
    fake.rigs.push({ rigId: 'r2', name: 'factory', status: 'running', nodes: [{ logicalId: 'ops.lead', canonicalSessionName: 'ops-lead@factory', runtime: 'claude-code', sessionStatus: 'running', cwd: '/w/f' }] });
    await until(() => of('rig.updated').some(m => m.rig.id === 'r2'));
    expect(of('rig.updated').find(m => m.rig.id === 'r2')!.rig.seats.map(s => s.ref)).toEqual(['ops-lead@factory']);
    fake.rigs.splice(1, 1); await until(() => of('rig.removed').some(m => m.rigId === 'r2'));
  });

  it('refetches nodes on seat activity', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    const { b, of } = setup({ exec: fakeRigCli(fake) });
    await b.start(); await until(() => b.status().state === 'running');
    fake.rigs[0]!.nodes[0]!.activityState = { activity: 'working' };
    fake.emit({ type: 'seat.activity_changed', seatNodeId: 'n', sessionName: 'dev-build@starter' });
    await until(() => of('rig.updated').some(m => m.rig.seats[0]!.state === 'working'));
  });

  it('recovers from an /api/events open that never answers', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.hangEvents = 2;
    const { b } = setup({ exec: fakeRigCli(fake), openMs: 60 });
    await b.start(); await until(() => b.status().state === 'running');
    expect(fake.requests.filter(r => r.path === '/api/events').length).toBeGreaterThanOrEqual(3);
    expect(fake.hangEvents).toBe(0);
  });

  it('broadcasts each outbox id once, past the log dedupe window', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    // A row listed before Ledge starts is history: logged for rig.exchanges, not broadcast.
    fake.outbox.set('dev-test@starter', [{ outboxId: 'outbox-old', senderSession: 'dev-test@starter', destinationSession: 'dev-build@starter', body: 'old', deliveryState: 'delivered' }]);
    const { b, of } = setup({ exec: fakeRigCli(fake) });
    await b.start(); await until(() => polls('dev-build@starter') >= 2 && polls('dev-test@starter') >= 2);
    expect(of('rig.exchange')).toHaveLength(0); expect(b.exchanges('r1').map(x => x.id)).toEqual(['o-outbox-old']);
    fake.outbox.set('dev-build@starter', Array.from({ length: 450 }, (_, i) => ({ outboxId: `outbox-${i}`, senderSession: 'dev-build@starter', destinationSession: 'dev-test@starter', body: `m${i}`, deliveryState: 'delivered' })));
    await until(() => of('rig.exchange').length === 450);
    const p = polls('dev-build@starter'); await until(() => polls('dev-build@starter') >= p + 3);
    const ids = of('rig.exchange').map(m => m.exchange.id); expect(new Set(ids).size).toBe(450); expect(ids).toHaveLength(450);
    // a new row is still picked up, once
    fake.outbox.get('dev-build@starter')!.push({ outboxId: 'outbox-new', senderSession: 'dev-build@starter', destinationSession: 'dev-test@starter', body: 'n', deliveryState: 'delivered' });
    await until(() => of('rig.exchange').some(m => m.exchange.id === 'o-outbox-new'));
    const q = polls('dev-build@starter'); await until(() => polls('dev-build@starter') >= q + 2); expect(of('rig.exchange')).toHaveLength(451);
  });

  it('keeps the cursor when the stream open times out, and replays the outage', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    const { b, of } = setup({ exec: fakeRigCli(fake), openMs: 60 });
    await b.start(); await until(() => b.status().state === 'running');
    fake.emit(task('Y1')); await until(() => of('rig.exchange').length === 1);
    await fake.stop(); await until(() => b.status().state === 'stopped');
    fake.emit(task('Y2')); fake.hangEvents = 1; await fake.restart();
    await until(() => b.status().state === 'running');
    const sse = fake.requests.filter(r => r.path === '/api/events').slice(-2);
    expect(sse.map(r => r.lastEventId)).toEqual(['1', '1']); // the hung open, then the retry: same cursor
    await until(() => of('rig.exchange').some(m => m.exchange.id === 'q-Y2'));
  });

  it('follows a wiped OpenRig journal (seq below the cursor)', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    const d = mkdtempSync(join(tmpdir(), 'ledge-bridge-')); dirs.push(d); const file = join(d, 'openrig.json');
    writeFileSync(file, JSON.stringify({ version: 1, machines: { local: { lastEventId: 500, rigs: ['starter'], at: '2026-10-30T10:00:00.000Z' } } }));
    const { b, of } = setup({ exec: fakeRigCli(fake), file });
    await b.start(); await until(() => b.status().state === 'running');
    expect(fake.requests.find(r => r.path === '/api/events')!.lastEventId).toBe('500');
    fake.queue.push(humanRow('J1')); fake.emit({ type: 'queue.created', qitemId: 'J1', sourceSession: 'dev-build@starter', destinationSession: 'ledge@external' });
    fake.emit(task('J2'));
    await until(() => of('escalation.updated').some(m => m.escalation.id === 'J1') && of('rig.exchange').some(m => m.exchange.id === 'q-J2'));
    await b.stop(); bridge = null;
    expect(readOpenRigFile(file).machines.local!.lastEventId).toBe(2);
  });

  it('a failed read changes nothing (body that is no list)', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'));
    let broken = false; const base = fetch;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (broken && (u.includes('/api/ps') || u.includes('/api/queue/list'))) return new Response('{}', { status: 200 });
      return base(input, init);
    }) as typeof fetch;
    const { b, of } = setup({ exec: fakeRigCli(fake), fetch: f, resyncMs: 40 });
    await b.start(); await until(() => b.status().state === 'running' && b.escalations().length === 1);
    b.pair('s1', 'dev-build@starter');
    broken = true; const n = fake.requests.length;
    fake.emit({ type: 'queue.updated', qitemId: 'E1' }); // human re-read, broken too
    await until(() => fake!.requests.length >= n + 6); await sleep(250);
    expect(of('rig.removed')).toHaveLength(0); expect(of('escalation.removed')).toHaveLength(0);
    expect(b.rigs()[0]!.seats.find(s => s.ref === 'dev-build@starter')!.sessionId).toBe('s1');
    expect(b.escalations().map(e => e.id)).toEqual(['E1']);
  });

  it('restored pairing holds the seat; an exited session frees it', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    const T0 = '2026-10-30T10:00:00.000Z';
    const sess = (id: string, over: Partial<Session> = {}): Session => ({ id, name: id, tool: 'codex', cwd: '/w/app', project: 'app', title: id, tmuxSession: null, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'hook_only', ...over });
    const store = new Store();
    // Ledge restarted: the store kept A's seat, the new bridge's mirror does not know it yet.
    store.upsert(sess('A', { rig: { machine: 'local', rigId: 'r1', rigName: 'starter', seat: 'dev-test@starter', pod: 'dev', member: 'test' } }));
    store.upsert(sess('B'));
    const { b } = setup({ exec: fakeRigCli(fake), alive: id => { const s = store.get(id); return !!s && s.state !== 'exited'; } });
    await b.start(); await until(() => b.status().state === 'running');
    expect(pairSession(store, b, { id: 'A', cwd: '/w/app', agent: 'codex' })).toBe(false); // restored, store unchanged
    expect(b.rigs()[0]!.seats.find(s => s.ref === 'dev-test@starter')!.sessionId).toBe('A');
    expect(pairSession(store, b, { id: 'B', cwd: '/w/app', agent: 'codex' })).toBe(false); expect(store.get('B')!.rig).toBeUndefined();
    store.upsert({ ...store.get('A')!, state: 'exited' });
    expect(b.unpairedRefs()).toContain('dev-test@starter');
    expect(pairSession(store, b, { id: 'B', cwd: '/w/app', agent: 'codex' })).toBe(true); expect(store.get('B')!.rig?.seat).toBe('dev-test@starter');
  });

  it('a registration in flight across a disconnect does not register', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter());
    const inner = fakeRigCli(fake); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const exec = (async (args: string[]) => { if (args.slice(0, 3).join(' ') === 'gateway human list') await gate; return inner(args); }) as RigExec;
    const { b } = setup({ exec });
    await b.start(); await until(() => b.status().state === 'running');
    await fake.stop(); await until(() => b.status().state === 'stopped');
    release(); await sleep(50);
    expect(inner.calls.some(c => c.slice(0, 3).join(' ') === 'gateway human add')).toBe(false);
    expect(b.status().human).toBeUndefined();
  });

  it('pairs by cwd on each seat\'s own cwd, only when unique', async () => {
    fake = await createFakeOpenRig(); fake.humans.push('ledge');
    const n = (member: string, runtime: string, cwd: string) => ({ logicalId: `dev.${member}`, canonicalSessionName: `dev-${member}@mixed`, runtime, sessionStatus: 'running', startupStatus: 'ready', cwd });
    fake.rigs.push({ rigId: 'm', name: 'mixed', status: 'running', nodes: [n('a', 'claude-code', '/w/app'), n('b', 'claude-code', '/w/app'), n('c', 'claude-code', '/w/other'), n('d', 'codex', '/w/app')] });
    const { b } = setup({ exec: fakeRigCli(fake) });
    await b.start(); await until(() => b.status().state === 'running');
    expect(b.pairByCwd('s1', '/w/other', 'claude')).toMatchObject({ seat: 'dev-c@mixed' }); // the rig's cwd is /w/app: per-seat cwd matters
    expect(b.pairByCwd('s2', '/w/app', 'claude')).toBeNull();                               // two free claude seats there
    expect(b.pairByCwd('s3', '/w/app', 'codex')).toMatchObject({ seat: 'dev-d@mixed' });
    expect(b.pairByCwd('s4', '/w/nowhere', 'codex')).toBeNull();
  });

  it('unsupported reads nothing', async () => {
    fake = await createFakeOpenRig({ version: '0.7.0' }); fake.rigs.push(starter());
    const exec = fakeRigCli(fake); const { b, of } = setup({ exec });
    await b.start(); await until(() => b.status().state === 'unsupported'); await sleep(100);
    expect(b.status()).toMatchObject({ version: '0.7.0', detail: 'OpenRig 0.7.0 non pris en charge' });
    expect(new Set(fake.requests.map(r => r.path))).toEqual(new Set(['/healthz']));
    expect(exec.calls.some(c => c[0] === 'gateway')).toBe(false);
    expect(of('openrig.status').filter(m => m.status.state === 'unsupported')).toHaveLength(1);
  });

  it('caches the CLI version per pid', async () => {
    fake = await createFakeOpenRig({ version: null }); fake.humans.push('ledge');
    const exec = fakeRigCli(fake, { version: '0.6.14' }); const { b } = setup({ exec });
    await b.start(); await until(() => b.status().state === 'running'); await sleep(100);
    expect(exec.calls.filter(c => c[0] === '--version')).toHaveLength(1); expect(b.status().version).toBe('0.6.14');
  });

  it('pairs seats with sessions', async () => {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    const { b, of } = setup({ exec: fakeRigCli(fake) });
    await b.start(); await until(() => b.status().state === 'running');
    expect(b.unpairedRefs().sort()).toEqual(['dev-build@starter', 'dev-test@starter']);
    expect(b.pair('s1', 'dev-build@starter')).toEqual({ machine: 'local', rigId: 'r1', rigName: 'starter', seat: 'dev-build@starter', pod: 'dev', member: 'build' });
    expect(of('rig.updated').at(-1)!.rig.seats[0]!.sessionId).toBe('s1');
    expect(b.pair('s9', 'nobody-x@nowhere')).toBeNull();
    expect(b.pairByCwd('s2', '/w/app', 'codex')).toMatchObject({ seat: 'dev-test@starter', member: 'test' });
    expect(b.unpairedRefs()).toEqual([]);
    expect(b.pairByCwd('s3', '/w/app', 'claude')).toBeNull();
  });
});
