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
