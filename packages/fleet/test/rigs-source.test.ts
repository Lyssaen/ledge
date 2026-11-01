import { describe, it, expect, beforeEach } from 'vitest';
import type { Escalation, Exchange, Rig, ServerMessage, Session } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';

function peer() {
  const sent: Array<Record<string, unknown>> = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m as never); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const snap: ServerMessage = { type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, routing: true } };
const T = '2026-10-30T08:00:00.000Z';
const rig = (id: string, extra: Partial<Rig> = {}): Rig => ({ id, name: id, machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false,
  seats: [{ ref: 'dev@r', address: '@dev', name: 'dev', runtime: 'claude-code', state: 'ready', sessionId: 'ab12' }, { ref: 'qa@r', address: '@qa', name: 'qa', runtime: 'codex', state: 'idle' }], repos: [], ...extra });
const esc = (id: string, extra: Partial<Escalation> = {}): Escalation => ({ id, source: 'rig', machine: 'local', from: 'dev@r', intent: 'decision', summary: 'Which?', questions: [], createdAt: T, state: 'pending', ...extra });
const exch = (id: string): Exchange => ({ id, machine: 'local', rigId: 'r1', from: '@dev', to: '@qa', kind: 'message', text: 'hi', at: T });
const EC2 = { id: 'ec2', label: 'EC2', ssh: 'ec2' };
function setup() {
  const peers = [peer(), peer()];
  const api = createFleetClient([LOCAL_MACHINE, EC2], o => (o.url === LOCAL_MACHINE.url ? peers[0]! : peers[1]!).client, {});
  api.connect(); peers.forEach(p => p.set('open')); peers[0]!.emit(snap); peers[1]!.emit({ ...snap, sshAlias: 'ec2' } as ServerMessage);
  return { api, local: peers[0]!, ec2: peers[1]! };
}
beforeEach(() => localStorage.clear());

describe('rigs from every machine', () => {
  it('rewrites machine local to the peer id and qualifies paired seats', () => {
    const { api, local, ec2 } = setup();
    ec2.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1')] });
    local.emit({ type: 'rig.updated', rig: rig('r1') });
    const rigs = api.fleet!.rigs();
    expect(rigs.map(r => [r.machine, r.id])).toEqual([['ec2', 'r1'], ['local', 'r1']]);
    expect(rigs[0]!.seats[0]!.sessionId).toBe('ec2:ab12');
    expect(rigs[0]!.seats[1]!.sessionId).toBeUndefined();
    expect(rigs[1]!.seats[0]!.sessionId).toBe('local:ab12');
    expect(api.fleet!.rigs()).toBe(api.fleet!.rigs());
  });

  it('rig.removed and a new rig.snapshot of a peer drop what it held; the other machine is untouched', () => {
    const { api, local, ec2 } = setup();
    local.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1')] });
    ec2.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1'), rig('r2')] });
    ec2.emit({ type: 'rig.removed', machine: 'local', rigId: 'r2' });
    expect(api.fleet!.rigs().map(r => `${r.machine}/${r.id}`)).toEqual(['local/r1', 'ec2/r1']);
    ec2.emit({ ...snap, sshAlias: 'ec2' } as ServerMessage); // reconnection: the book forgets, the rig.snapshot refills
    expect(api.fleet!.rigs().map(r => `${r.machine}/${r.id}`)).toEqual(['local/r1']);
  });

  it('rewrites rig.machine of a session of another machine', () => {
    const { api, ec2 } = setup();
    const s: Session = { id: 'ab12', name: 'Nova', tool: 'claude', cwd: '/w', project: 'w', title: 'Nova', tmuxSession: 'x', state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, source: 'hook_only',
      rig: { machine: 'local', rigId: 'r1', rigName: 'r1', seat: 'dev@r', pod: 'dev', member: 'dev' } };
    const seen: ServerMessage[] = []; api.onMessage(m => seen.push(m));
    ec2.emit({ type: 'session.updated', session: s });
    const got = seen.find(m => m.type === 'session.updated') as Extract<ServerMessage, { type: 'session.updated' }>;
    expect(got.session.rig!.machine).toBe('ec2');
    expect(got.session.id).toBe('ec2:ab12');
  });

  it('keeps escalations by machine and id, and escalation.removed removes the sender\'s own', () => {
    const { api, local, ec2 } = setup();
    local.emit({ type: 'escalation.updated', escalation: esc('q1') });
    ec2.emit({ type: 'escalation.updated', escalation: esc('q1') });
    expect(api.fleet!.escalations().map(e => [e.machine, e.id])).toEqual([['local', 'q1'], ['ec2', 'q1']]);
    local.emit({ type: 'escalation.removed', id: 'q1' });
    expect(api.fleet!.escalations().map(e => [e.machine, e.id])).toEqual([['ec2', 'q1']]);
    ec2.emit({ type: 'escalation.removed', id: 'q1' });
    expect(api.fleet!.escalations()).toEqual([]);
  });

  it('keeps rigs, escalations and a status when a machine falls: unreachable', () => {
    const { api, ec2 } = setup();
    ec2.emit({ type: 'openrig.status', status: { machine: 'local', state: 'running', version: '0.6.14' } });
    ec2.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1')] });
    ec2.emit({ type: 'escalation.updated', escalation: esc('q1') });
    expect(api.fleet!.openrig()).toEqual([{ machine: 'ec2', state: 'running', version: '0.6.14' }]);
    ec2.set('closed' as DaemonStatus);
    expect(api.fleet!.rigs().map(r => [r.id, r.lifecycle])).toEqual([['r1', 'unreachable']]);
    expect(api.fleet!.escalations().map(e => e.id)).toEqual(['q1']);
    expect(api.fleet!.openrig()[0]!.state).toBe('unreachable');
  });

  it('requestExchanges asks the machine\'s peer as local and the answer fills exchanges()', () => {
    const { api, local, ec2 } = setup();
    expect(api.fleet!.exchanges('ec2', 'r1')).toBeNull();
    expect(api.fleet!.requestExchanges('ec2', 'r1')).toBe(true);
    expect(ec2.sent).toContainEqual({ type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' });
    expect(local.sent.filter(m => m.type === 'rig.exchanges.request')).toEqual([]);
    ec2.emit({ type: 'rig.exchanges', machine: 'local', rigId: 'r1', items: [exch('e1')] });
    ec2.emit({ type: 'rig.exchange', exchange: exch('e2') });
    expect(api.fleet!.exchanges('ec2', 'r1')!.map(e => [e.id, e.machine])).toEqual([['e1', 'ec2'], ['e2', 'ec2']]);
    expect(api.fleet!.exchanges('local', 'r1')).toBeNull();
    ec2.set('closed' as DaemonStatus);
    expect(api.fleet!.requestExchanges('ec2', 'r1')).toBe(false);
    expect(api.fleet!.requestExchanges('nowhere', 'r1')).toBe(false);
  });

  it('the client message rig.exchanges.request through send is routed like requestExchanges', () => {
    const { api, ec2 } = setup();
    api.send({ type: 'rig.exchanges.request', machine: 'ec2', rigId: 'r9' });
    expect(ec2.sent).toContainEqual({ type: 'rig.exchanges.request', machine: 'local', rigId: 'r9' });
  });

  it('rig messages are not relayed raw and notify the fleet listeners', () => {
    const { api, local } = setup();
    const seen: string[] = []; api.onMessage(m => seen.push(m.type)); api.fleet!.onMachineMessage((_, m) => seen.push(m.type));
    let n = 0; api.fleet!.subscribe(() => { n++; });
    local.emit({ type: 'rig.updated', rig: rig('r1') }); local.emit({ type: 'escalation.updated', escalation: esc('q1') });
    local.emit({ type: 'openrig.status', status: { machine: 'local', state: 'running' } });
    expect(seen).toEqual([]);
    expect(n).toBe(3);
  });
});

const fleetSnap = { ...snap, daemon: { ...(snap as Extract<ServerMessage, { type: 'snapshot' }>).daemon!, openrigFleet: true } } as ServerMessage;
/** Local daemon announcing `openrigFleet` (lot 6): it relays the remote machines' rigs with their real machine. */
function setupFleet() {
  const s = setup(); s.local.emit(fleetSnap); return s;
}
const rigSent = (p: ReturnType<typeof peer>) => p.sent.filter(m => /^(rig\.|escalation\.)/.test(String(m.type)));

describe('rigs from the aggregating local daemon (openrigFleet)', () => {
  it('Review Focus 5: a remote rig seen through both peers appears once, with its real machine', () => {
    const { api, local, ec2 } = setupFleet();
    local.emit({ type: 'rig.snapshot', machine: 'ec2', rigs: [rig('r1', { machine: 'ec2' })] });
    ec2.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1')] });
    expect(api.fleet!.rigs().map(r => [r.machine, r.id])).toEqual([['ec2', 'r1']]);
    expect(api.fleet!.rigs()[0]!.seats[0]!.sessionId).toBe('ec2:ab12');
  });

  it('Review Focus 5: rig.act to a remote machine goes to the local peer, machine kept; without openrigFleet it goes to the machine as local', () => {
    const f = setupFleet();
    f.api.send({ type: 'rig.act', rid: 'a1', machine: 'ec2', rigId: 'r1', action: 'stop' } as never);
    expect(rigSent(f.local)).toEqual([{ type: 'rig.act', rid: 'a1', machine: 'ec2', rigId: 'r1', action: 'stop' }]);
    expect(rigSent(f.ec2)).toEqual([]);
    const o = setup();
    o.api.send({ type: 'rig.act', rid: 'a1', machine: 'ec2', rigId: 'r1', action: 'stop' } as never);
    expect(rigSent(o.ec2)).toEqual([{ type: 'rig.act', rid: 'a1', machine: 'local', rigId: 'r1', action: 'stop' }]);
    expect(rigSent(o.local)).toEqual([]);
  });

  it('ignores rig.*, escalation.* and openrig.status of remote peers; forgets what they gave before the announcement', () => {
    const { api, local, ec2 } = setup();
    ec2.emit({ type: 'openrig.status', status: { machine: 'local', state: 'running' } });
    ec2.emit({ type: 'rig.updated', rig: rig('r9') });
    ec2.emit({ type: 'escalation.updated', escalation: esc('q9') });
    expect(api.fleet!.rigs()).toHaveLength(1);
    local.emit(fleetSnap);
    expect([api.fleet!.rigs(), api.fleet!.escalations(), api.fleet!.openrig()]).toEqual([[], [], []]);
    ec2.emit({ type: 'openrig.status', status: { machine: 'local', state: 'stopped' } });
    ec2.emit({ type: 'rig.updated', rig: rig('r9') });
    ec2.emit({ type: 'escalation.updated', escalation: esc('q9') });
    ec2.emit({ type: 'rig.exchanges', machine: 'local', rigId: 'r9', items: [exch('e1')] });
    expect([api.fleet!.rigs(), api.fleet!.escalations(), api.fleet!.openrig()]).toEqual([[], [], []]);
    expect(api.fleet!.exchanges('ec2', 'r9')).toBeNull();
    local.emit({ type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    local.emit({ type: 'escalation.updated', escalation: esc('q9', { machine: 'ec2' }) });
    expect(api.fleet!.openrig()).toEqual([{ machine: 'ec2', state: 'running' }]);
    expect(api.fleet!.escalations().map(e => [e.machine, e.id])).toEqual([['ec2', 'q9']]);
  });

  it('every rig command, sendTo(rig.launch) and requestExchanges go to the local peer without rewriting machine', () => {
    const { api, local, ec2 } = setupFleet();
    api.send({ type: 'rig.prepare', rid: 'p1', machine: 'ec2', spec: 's', goal: 'g', where: { kind: 'off', cwd: '/w' } } as never);
    api.send({ type: 'rig.send', rid: 's1', machine: 'ec2', rigId: 'r1', to: '@dev', text: 'hi' } as never);
    api.send({ type: 'rig.exchanges.request', machine: 'ec2', rigId: 'r1' });
    api.send({ type: 'escalation.answer', rid: 'q1', id: 'q1', text: 'yes' } as never);
    expect(api.fleet!.sendTo('ec2', { type: 'rig.launch', rid: 'l1', planId: 'pl1' })).toBe(true);
    expect(api.fleet!.requestExchanges('ec2', 'r2')).toBe(true);
    expect(rigSent(local).map(m => [m.type, m.machine])).toEqual([['rig.prepare', 'ec2'], ['rig.send', 'ec2'], ['rig.exchanges.request', 'ec2'], ['escalation.answer', undefined], ['rig.launch', undefined], ['rig.exchanges.request', 'ec2']]);
    expect(rigSent(ec2)).toEqual([]);
    // Another message sent with sendTo keeps its machine (a daemon update goes to that daemon).
    api.fleet!.sendTo('ec2', { type: 'update.daemon' } as never);
    expect(ec2.sent.map(m => m.type)).toContain('update.daemon');
  });

  it('the local peer answers for a remote machine even when that machine\'s own peer is down', () => {
    const { api, local, ec2 } = setupFleet();
    ec2.set('unreachable');
    expect(api.fleet!.sendTo('ec2', { type: 'rig.launch', rid: 'l1', planId: 'pl1' })).toBe(true);
    expect(api.fleet!.requestExchanges('ec2', 'r1')).toBe(true);
    expect(rigSent(local).map(m => m.type)).toEqual(['rig.launch', 'rig.exchanges.request']);
    local.set('unreachable');
    expect(api.fleet!.sendTo('ec2', { type: 'rig.launch', rid: 'l2', planId: 'pl1' })).toBe(false);
    expect(api.fleet!.requestExchanges('ec2', 'r1')).toBe(false);
  });

  it('without openrigFleet, sendTo(rig.launch) and requestExchanges keep lot 2 routing', () => {
    const { api, local, ec2 } = setup();
    api.fleet!.sendTo('ec2', { type: 'rig.launch', rid: 'l1', planId: 'pl1' });
    expect(rigSent(ec2)).toEqual([{ type: 'rig.launch', rid: 'l1', planId: 'pl1' }]);
    expect(rigSent(local)).toEqual([]);
  });

  it('a new snapshot or a drop of the local peer covers the remote rigs, escalations and statuses it relayed', () => {
    const { api, local, ec2 } = setupFleet();
    const relay = () => {
      local.emit({ type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
      local.emit({ type: 'rig.snapshot', machine: 'ec2', rigs: [rig('r1', { machine: 'ec2' })] });
      local.emit({ type: 'escalation.updated', escalation: esc('q1', { machine: 'ec2' }) });
    };
    relay();
    // The direct ec2 peer falling says nothing of what the local daemon relays.
    ec2.set('unreachable');
    expect(api.fleet!.rigs()[0]!.lifecycle).toBe('running');
    expect(api.fleet!.openrig()[0]!.state).toBe('running');
    local.set('unreachable');
    expect(api.fleet!.rigs().map(r => [r.machine, r.lifecycle])).toEqual([['ec2', 'unreachable']]);
    expect(api.fleet!.openrig()).toEqual([{ machine: 'ec2', state: 'unreachable' }]);
    expect(api.fleet!.escalations()).toHaveLength(1);
    local.set('open'); local.emit(fleetSnap);
    expect([api.fleet!.rigs(), api.fleet!.escalations(), api.fleet!.openrig()]).toEqual([[], [], []]);
  });

  it('a machine removed from the list loses its rigs, escalations and status', () => {
    const { api, local } = setupFleet();
    local.emit({ type: 'openrig.status', status: { machine: 'local', state: 'running' } });
    local.emit({ type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    local.emit({ type: 'rig.snapshot', machine: 'ec2', rigs: [rig('r1', { machine: 'ec2' })] });
    local.emit({ type: 'rig.updated', rig: rig('r2') });
    local.emit({ type: 'escalation.updated', escalation: esc('q1', { machine: 'ec2' }) });
    api.fleet!.configure([{ id: 'local', label: 'Local' }]);
    expect(api.fleet!.openrig().map(s => s.machine)).toEqual(['local']);
    expect(api.fleet!.rigs().map(r => `${r.machine}/${r.id}`)).toEqual(['local/r2']);
    expect(api.fleet!.escalations()).toEqual([]);
  });
});

describe('same (rig book equality)', () => {
  it('ignores key order and undefined fields, sees real changes', async () => {
    const { same } = await import('../src/rigs');
    expect(same({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(same({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(same({ a: [1, 2] }, { a: [2, 1] })).toBe(false); expect(same({ a: 1 }, { a: '1' })).toBe(false); expect(same([], {})).toBe(false);
  });
});
