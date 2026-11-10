import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, type ClientMessage, type Goal, type OpenRigAction, type OpenRigState, type RigRow, type ServerMessage } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';
import { rigsSubject } from '../src/mobile/gateway.js';

afterEach(stopAll);

// Rigs and the kernel on the phone (refonte mobile B4, docs/mobile-openrig-contract.md).

type G = ReturnType<typeof setup>;
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const AT = '2026-11-10T17:00:00.000Z';
const seat = (logicalId: string) => ({ logicalId, session: `${logicalId.replace('.', '-')}@ledge-dev`, runtime: 'claude-code', model: 'opus', sessionStatus: 'running',
  lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const STATE: OpenRigState = {
  installed: true, version: '0.7.10', daemon: { state: 'running', pid: 4242, port: 7433, message: 'listening on /home/me/.openrig/daemon.sock', startedAt: AT },
  kernel: { state: 'ready' },
  rigs: [{ id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 0, uptime: '1h', snapshot: null,
    nodes: [seat('dev.back'), seat('dev.front')], specPath: '/home/me/.ledge/rigs/ledge-dev.yaml' }],
  at: AT
};
const row = (id: string, state: string, summary = 'B4'): RigRow => ({ id, state, from: 'pilot-lead@ledge-dev', to: 'dev-back@ledge-dev', createdAt: AT, updatedAt: AT, at: AT, summary });
const GOAL: Goal = { goalId: 'goal-0001', qitemId: 'qitem-g1', text: 'Refaire le mobile', folder: null, sentAt: AT, to: 'operator-agent@kernel', state: 'sent',
  proposal: null, question: null, trail: [], current: null };

/** A daemon that answers the Desktop's `openrig.*` like server.ts: `acts` records what reached it, `answers` overrides an answer. */
function make(opts: { rigs?: boolean; done?: Partial<Extract<ServerMessage, { type: 'openrig.done' }>>; queueError?: string } = {}) {
  const acts: ClientMessage[] = [];
  const dispatch = async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
    switch (msg.type) {
      case 'openrig.status': return reply({ type: 'openrig.state', requestId: msg.requestId, state: STATE });
      case 'openrig.graph': return reply({ type: 'openrig.graphState', requestId: msg.requestId, rig: msg.rig, ...(msg.rig === 'ledge-dev' ? { graph: { pods: [{ id: 'dev', label: 'dev' }], seats: [], links: [] } } : { error: 'unknown_rig' }) });
      case 'openrig.queue': return reply({ type: 'openrig.queueState', requestId: msg.requestId, rig: msg.rig, rows: opts.queueError ? [] : [row('qitem-open', 'in-progress', 'x'.repeat(300))], truncated: false, ...(opts.queueError ? { error: opts.queueError } : {}) });
      case 'openrig.permissions': return reply({ type: 'openrig.permissionList', requestId: msg.requestId, rig: msg.rig, policy: 'builtin:auto',
        seats: [{ logicalId: 'dev.back', session: 'dev-back@ledge-dev', mode: 'auto' }, { logicalId: 'dev.front', session: 'dev-front@ledge-dev', error: 'cannot read /home/me/x' }] });
      case 'openrig.snapshots': return reply({ type: 'openrig.snapshotList', requestId: msg.requestId, rig: msg.rig, snapshots: [{ id: '01K0000000000000000000000A', kind: 'manual', status: 'complete', createdAt: '2026-11-10 17:00:00' }] });
      case 'openrig.goals': return reply({ type: 'openrig.goalsChanged', requestId: msg.requestId, goals: [GOAL] });
      case 'openrig.act':
        acts.push(msg);
        return reply({ type: 'openrig.done', requestId: msg.requestId, ok: true, commands: ['rig down ledge-dev'], ...opts.done });
      case 'openrig.seats':
        acts.push(msg);
        return reply({ type: 'openrig.reseated', requestId: msg.requestId, ok: true, commands: ['rig expand'], added: ['dev.back-2'], removed: [] });
      case 'openrig.goal.send':
        acts.push(msg);
        return reply({ type: 'openrig.goal.sent', requestId: msg.requestId, goalId: msg.goalId, ok: true, qitemId: 'qitem-g2' });
      case 'openrig.goal.reply':
        acts.push(msg);
        return reply({ type: 'openrig.goal.replied', requestId: msg.requestId, goalId: msg.goalId, replyId: msg.replyId, ok: false, error: 'refused', message: 'x'.repeat(900) });
    }
  };
  const closedCalls: string[] = [];
  const g = setup({ dispatch, deps: opts.rigs === false ? {} : { rigs: {
    async closed(rig) { closedCalls.push(rig); return { rows: [row('qitem-done', 'done')] }; },
    async routing() { return { entries: [{ qitem: 'qitem-open', at: AT, seat: 'dev-back@ledge-dev', change: 'claimed', rig: 'ledge-dev', summary: 'y'.repeat(400) }] }; }
  } } });
  return { g, acts, closedCalls };
}

const enroll = async (g: G) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
const challenge = async (g: G, x: { rigAct: OpenRigAction } | { rigSeats: { rig: string; seats: Record<string, number> } }) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'rigs', ...x });
  await flush();
  const m = g.got('dev1').slice(before).find(y => y.type === 'confirm.challenge' || y.type === 'error');
  if (m?.type !== 'confirm.challenge') throw new Error(`no challenge: ${JSON.stringify(m)}`);
  return m.challenge;
};
/** Sends an operation and returns its last result and its detailed end. */
const op = async (g: G, msg: object, end: string, id = randomUUID()) => {
  g.send('dev1', { op: id, ...msg });
  await flush();
  return { result: g.results('dev1').filter(r => r.op === id && r.status !== 'received').at(-1), told: g.got('dev1').filter(m => m.type === end && 'op' in m && m.op === id).at(-1) };
};
const last = (g: G, type: string) => g.got('dev1').filter(m => m.type === type).at(-1);

describe('phone gateway: rigs and the kernel', () => {
  it('says `daemon.rigs` only with the daemon\'s OpenRig, and refuses the reads without it', async () => {
    const on = make();
    on.g.send('dev1', { type: 'snapshot.request' });
    const off = make({ rigs: false });
    off.g.send('dev1', { type: 'snapshot.request' });
    off.g.send('dev1', { type: 'rigs.state' });
    await flush();
    const snap = (g: G) => g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap(on.g)?.type === 'snapshot' && snap(on.g)?.daemon.rigs).toBe(true);
    expect(snap(off.g)?.type === 'snapshot' && snap(off.g)?.daemon.rigs).toBeUndefined();
    expect(last(off.g, 'error')).toEqual({ type: 'error', code: 'invalid', request: 'rigs.state' });
  });

  it('gives OpenRig\'s state without the PC\'s paths, then each change to the devices that asked', async () => {
    const { g } = make();
    g.send('dev1', { type: 'rigs.state' });
    await flush();
    const st = last(g, 'rigs.state');
    expect(PhoneServerMessageSchema.parse(st)).toBeTruthy();
    expect(JSON.stringify(st)).not.toContain('/home/me');
    expect(st).toMatchObject({ state: { daemon: { state: 'running', port: 7433, startedAt: AT }, rigs: [{ name: 'ledge-dev' }] } });
    expect(st?.type === 'rigs.state' && st.state?.daemon).not.toHaveProperty('pid');
    // A change after an action reaches dev1 (it asked), not dev2; a Desktop's answer to its own status is not a change.
    g.gw.forward({ type: 'openrig.state', state: { ...STATE, kernel: { state: 'stopped' } } });
    g.gw.forward({ type: 'openrig.state', requestId: 'desk', state: STATE });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'rigs.state')).toHaveLength(2);
    expect(last(g, 'rigs.state')).toMatchObject({ state: { kernel: { state: 'stopped' } } });
    expect(g.got('dev2').some(m => m.type === 'rigs.state')).toBe(false);
  });

  it('reads a rig\'s topology, queue (open and closed), permissions, snapshots and the routing, as codes and within bounds', async () => {
    const { g, closedCalls } = make();
    for (const m of [{ type: 'rigs.graph', rig: 'ledge-dev' }, { type: 'rigs.graph', rig: 'nope' }, { type: 'rigs.queue', rig: 'ledge-dev' }, { type: 'rigs.permissions', rig: 'ledge-dev' },
      { type: 'rigs.snapshots', rig: 'ledge-dev' }, { type: 'rigs.routing' }]) g.send('dev1', m);
    await flush();
    for (const m of g.got('dev1')) expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    const graphs = g.got('dev1').filter(m => m.type === 'rigs.graph');
    expect(graphs.map(m => m.type === 'rigs.graph' && (m.error ?? 'ok'))).toEqual(['ok', 'unknown_rig']);
    const q = last(g, 'rigs.queue');
    expect(q).toMatchObject({ rig: 'ledge-dev', rows: [{ id: 'qitem-open' }], closed: [{ id: 'qitem-done', state: 'done' }], truncated: false });
    expect(q?.type === 'rigs.queue' && q.rows[0]!.summary!.length).toBeLessThanOrEqual(200);
    expect(closedCalls).toEqual(['ledge-dev']);
    // A seat's error is a code, never what `rig` said (it may hold a path).
    expect(last(g, 'rigs.permissions')).toMatchObject({ policy: 'builtin:auto', seats: [{ mode: 'auto' }, { error: 'unavailable' }] });
    expect(last(g, 'rigs.snapshots')).toMatchObject({ snapshots: [{ kind: 'manual' }] });
    const r = last(g, 'rigs.routing');
    expect(r).toMatchObject({ entries: [{ qitem: 'qitem-open', change: 'claimed', seat: 'dev-back@ledge-dev' }] });
    expect(r?.type === 'rigs.routing' && r.entries[0]!.summary!.length).toBe(200);
  });

  it('says why a queue could not be read, by code', async () => {
    const { g } = make({ queueError: 'daemon_stopped' });
    g.send('dev1', { type: 'rigs.queue', rig: 'ledge-dev' });
    await flush();
    expect(last(g, 'rigs.queue')).toEqual({ type: 'rigs.queue', rig: 'ledge-dev', rows: [], closed: [], truncated: false, error: 'daemon_stopped' });
  });

  it('starts without a passkey; a stop needs the device\'s check over that very action, and a replay never runs it twice', async () => {
    const { g, acts } = make();
    let r = await op(g, { type: 'rigs.act', action: { kind: 'rig.start', rig: 'ledge-dev' } }, 'rigs.done');
    expect(r.result).toMatchObject({ status: 'applied' });
    expect(r.told).toMatchObject({ ok: true, commands: ['rig down ledge-dev'] });
    expect(acts).toHaveLength(1);
    const stop: OpenRigAction = { kind: 'rig.stop', rig: 'ledge-dev' };
    // No passkey: refused, nothing reaches OpenRig.
    r = await op(g, { type: 'rigs.act', action: stop }, 'rigs.done');
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(r.told).toMatchObject({ ok: false, rejected: 'confirm_required' });
    const auth = await enroll(g);
    // A check for another rig's stop does not stop this one.
    const other = await challenge(g, { rigAct: { kind: 'rig.stop', rig: 'other' } });
    r = await op(g, { type: 'rigs.act', action: stop, assertion: auth.get(rp, other, { counter: 1 }) }, 'rigs.done');
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(acts).toHaveLength(1);
    const right = await challenge(g, { rigAct: stop });
    const id = randomUUID();
    const assertion = auth.get(rp, right, { counter: 2 });
    r = await op(g, { type: 'rigs.act', action: stop, assertion }, 'rigs.done', id);
    expect(r.result).toMatchObject({ status: 'applied' });
    expect(acts).toHaveLength(2);
    expect(acts[1]).toMatchObject({ type: 'openrig.act', action: stop });
    // The same op again: its end again, from the registry.
    const before = g.got('dev1').filter(m => m.type === 'rigs.done' && m.op === id).length;
    g.send('dev1', { type: 'rigs.act', op: id, action: stop, assertion });
    await flush();
    expect(acts).toHaveLength(2);
    expect(g.got('dev1').filter(m => m.type === 'rigs.done' && m.op === id).length).toBe(before + 1);
  });

  it('binds the subject to the action itself, whatever the order of its keys', () => {
    expect(rigsSubject({ act: { kind: 'rig.stop', rig: 'a', force: true } })).toBe(rigsSubject({ act: { force: true, rig: 'a', kind: 'rig.stop' } as OpenRigAction }));
    expect(rigsSubject({ act: { kind: 'rig.stop', rig: 'a' } })).not.toBe(rigsSubject({ act: { kind: 'rig.stop', rig: 'b' } }));
    expect(rigsSubject({ rig: 'a', seats: { 'dev.back': 1 } })).not.toBe(rigsSubject({ rig: 'a', seats: { 'dev.back': 0 } }));
  });

  it('tells a failed action by its code, or `failed` with OpenRig\'s line shortened', async () => {
    const busy = make({ done: { ok: false, error: 'busy' } });
    let r = await op(busy.g, { type: 'rigs.act', action: { kind: 'kernel.start' } }, 'rigs.done');
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'busy' });
    expect(r.told).toMatchObject({ ok: false, error: 'busy' });
    const said = make({ done: { ok: false, error: 'z'.repeat(800) } });
    r = await op(said.g, { type: 'rigs.act', action: { kind: 'kernel.start' } }, 'rigs.done');
    expect(r.result).toMatchObject({ status: 'failed' });
    expect(r.told).toMatchObject({ ok: false, error: 'failed' });
    expect(r.told?.type === 'rigs.done' && r.told.message!.length).toBeLessThanOrEqual(500);
    expect(PhoneServerMessageSchema.safeParse(r.told).success).toBe(true);
  });

  it('adds seats without a passkey; removing one needs the device\'s check over that change', async () => {
    const { g, acts } = make();
    let r = await op(g, { type: 'rigs.seats', rig: 'ledge-dev', seats: { 'dev.back': 2 } }, 'rigs.reseated');
    expect(r.result).toMatchObject({ status: 'applied' });
    expect(r.told).toMatchObject({ ok: true, added: ['dev.back-2'], removed: [] });
    const fewer = { 'dev.front': 0 };
    r = await op(g, { type: 'rigs.seats', rig: 'ledge-dev', seats: fewer }, 'rigs.reseated');
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(acts).toHaveLength(1);
    const auth = await enroll(g);
    const c = await challenge(g, { rigSeats: { rig: 'ledge-dev', seats: fewer } });
    r = await op(g, { type: 'rigs.seats', rig: 'ledge-dev', seats: fewer, assertion: auth.get(rp, c, { counter: 1 }) }, 'rigs.reseated');
    expect(r.result).toMatchObject({ status: 'applied' });
    expect(acts.at(-1)).toMatchObject({ type: 'openrig.seats', rig: 'ledge-dev', seats: fewer });
  });

  it('gives the goals, follows them, and sends the person\'s goal and words to the operator', async () => {
    const { g, acts } = make();
    g.send('dev1', { type: 'rigs.goals' });
    await flush();
    expect(last(g, 'rigs.goals')).toEqual({ type: 'rigs.goals', goals: [GOAL] });
    g.gw.forward({ type: 'openrig.goalsChanged', goals: [], partial: true });
    g.gw.forward({ type: 'openrig.goalsChanged', requestId: 'desk', goals: [GOAL] });
    await flush();
    expect(last(g, 'rigs.goals')).toEqual({ type: 'rigs.goals', goals: [], partial: true });
    expect(g.got('dev2').some(m => m.type === 'rigs.goals')).toBe(false);
    let r = await op(g, { type: 'rigs.goal.send', goalId: 'goal-0002', text: 'Une tablette aussi' }, 'rigs.goal.sent');
    expect(r.result).toMatchObject({ status: 'applied' });
    expect(r.told).toMatchObject({ goalId: 'goal-0002', ok: true, qitemId: 'qitem-g2' });
    r = await op(g, { type: 'rigs.goal.reply', goalId: 'goal-0001', replyId: 'reply-0001', text: 'Oui' }, 'rigs.goal.replied');
    expect(r.result).toMatchObject({ status: 'failed' });
    expect(r.told?.type === 'rigs.goal.replied' && r.told.message!.length).toBeLessThanOrEqual(500);
    expect(acts.map(a => a.type)).toEqual(['openrig.goal.send', 'openrig.goal.reply']);
  });

  it('answers an operation the schema refuses with its result', async () => {
    const { g } = make();
    const id = randomUUID();
    g.send('dev1', { type: 'rigs.act', op: id, action: { kind: 'rig.stop', rig: '-rf' } });
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op: id, status: 'rejected', reason: 'invalid' });
  });
});
