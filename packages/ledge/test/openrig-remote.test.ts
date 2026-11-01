import { describe, expect, it } from 'vitest';
import type { Escalation, Exchange, Machine, Rig, ServerMessage } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '@ledge/fleet';
import { createRemotePeers, rewriteFromPeer, type RemoteMessage } from '../src/daemon/openrig/remote.js';

function fake() {
  const sent: Array<Record<string, unknown>> = [];
  let onMsg = (_: ServerMessage) => {}, onSt = (_: DaemonStatus) => {}, status: DaemonStatus = 'connecting';
  const o = { sent, closed: 0, connected: 0, url: '' };
  const client: DaemonClient = {
    connect() { o.connected++; }, close() { o.closed++; }, send(m) { sent.push(m as never); }, status: () => status,
    onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; }
  };
  return { ...o, o, client, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const T = '2026-10-30T08:00:00.000Z';
const snap = (openrig?: boolean): ServerMessage => ({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, ...(openrig ? { openrig } : {}) } } as ServerMessage);
const rig = (id: string, extra: Partial<Rig> = {}): Rig => ({ id, name: id, machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false,
  seats: [{ ref: 'dev@r', address: '@dev', name: 'dev', runtime: 'claude-code', state: 'ready', sessionId: 'ab12' }], repos: [], ...extra });
const esc = (id: string): Escalation => ({ id, source: 'rig', machine: 'local', from: 'dev@r', intent: 'decision', summary: 'Which?', questions: [], createdAt: T, state: 'pending' });
const exch = (machine = 'local'): Exchange => ({ id: 'x1', machine, rigId: 'r1', from: '@dev', to: '@qa', kind: 'message', text: 'hi', at: T });
const LOCAL: Machine = { id: 'local', label: 'PC' };
const EC2: Machine = { id: 'ec2', label: 'ec2-build', ssh: 'ec2-build' };

function setup(port: number | (() => number) = 47831) {
  const fakes: Array<ReturnType<typeof fake>> = [], urls: string[] = [];
  const peers = createRemotePeers({ port, connect: (_m, url) => { urls.push(url); const f = fake(); fakes.push(f); return f.client; } });
  const got: Array<[string, RemoteMessage]> = [], states: Array<[string, string]> = [];
  peers.onMessage((m, x) => got.push([m, x])); peers.onStatus((m, s) => states.push([m, s]));
  return { peers, fakes, urls, got, states };
}
function openEc2(s = setup(), openrig = true) {
  s.peers.setMachines([LOCAL, EC2]);
  const f = s.fakes[0]!; f.set('open'); f.emit(snap(openrig));
  return { ...s, f };
}

describe('RemotePeers', () => {
  it('connects once per ssh machine, on /ssh/<alias>, never for local', () => {
    const s = setup(() => 5555);
    s.peers.setMachines([LOCAL, EC2]); s.peers.setMachines([LOCAL, EC2]);
    expect(s.urls).toEqual(['ws://127.0.0.1:5555/ssh/ec2-build']);
    expect(s.fakes[0]!.o.connected).toBe(1);
    expect(s.peers.status('ec2')).toBe('connecting');
    expect(s.peers.status('local')).toBe('unreachable');
  });

  it('is open at the snapshot and relays rewritten rig traffic', () => {
    const { peers, f, got, states } = openEc2();
    expect(peers.status('ec2')).toBe('open');
    expect(states).toEqual([['ec2', 'open']]);
    f.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1')] });
    const [machine, m] = got[0]!;
    expect(machine).toBe('ec2');
    expect(m).toMatchObject({ type: 'rig.snapshot', machine: 'ec2', rigs: [{ id: 'r1', machine: 'ec2' }] });
    expect((m as { rigs: Rig[] }).rigs[0]!.seats[0]!.sessionId).toBe('ab12');
  });

  it('only negotiates delegated brain commands with a peer that announces the capability', () => {
    const { peers, f, got } = openEc2();
    expect(peers.supportsBrainDelegate?.('ec2')).toBe(false);
    f.emit({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.31.0', install: 'npm', systemd: true, openrig: true, brainDelegate: true } });
    expect(peers.supportsBrainDelegate?.('ec2')).toBe(true);
    f.emit({ type: 'brain.delegate.result', rid: 'r', ok: false, code: 'busy' });
    expect(got.at(-1)).toEqual(['ec2', { type: 'brain.delegate.result', rid: 'r', ok: false, code: 'busy' }]);
    f.set('unreachable'); expect(peers.supportsBrainDelegate?.('ec2')).toBe(false);
  });

  it('ignores a message of another machine (no echo between two daemons)', () => {
    const { f, got } = openEc2();
    f.emit({ type: 'rig.updated', rig: rig('r2', { machine: 'pc' }) });
    f.emit({ type: 'rig.snapshot', machine: 'pc', rigs: [rig('r2', { machine: 'pc' })] });
    f.emit({ type: 'escalation.updated', escalation: { ...esc('e1'), machine: 'pc' } });
    expect(got).toEqual([]);
  });

  it('ignores session and chat traffic, keeps escalation.removed', () => {
    const { f, got } = openEc2();
    f.emit({ type: 'rig.result', rid: 'a', ok: true });
    f.emit({ type: 'escalation.removed', id: 'e1' });
    f.emit({ type: 'machines', machines: [LOCAL] } as ServerMessage);
    expect(got.map(([, m]) => m.type)).toEqual(['rig.result', 'escalation.removed']);
  });

  it('a daemon without OpenRig is unsupported: no relay', () => {
    const { peers, f, got, states } = openEc2(setup(), false);
    expect(peers.status('ec2')).toBe('unsupported');
    expect(peers.version('ec2')).toBe('0.30.0');
    expect(states).toEqual([['ec2', 'unsupported']]);
    f.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1')] });
    expect(got).toEqual([]);
    expect(peers.send('ec2', { type: 'rig.act', rid: 'a', machine: 'local', verb: 'down' })).toBe(false);
  });

  it('reports unreachable and sends only when open', () => {
    const s = setup(); s.peers.setMachines([LOCAL, EC2]);
    const f = s.fakes[0]!;
    expect(s.peers.send('ec2', { type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' })).toBe(false);
    f.set('open'); f.emit(snap(true));
    expect(s.peers.send('ec2', { type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' })).toBe(true);
    expect(f.sent).toEqual([{ type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' }]);
    f.set('unreachable');
    expect(s.peers.status('ec2')).toBe('unreachable');
    expect(s.states.at(-1)).toEqual(['ec2', 'unreachable']);
    expect(s.peers.send('ec2', { type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' })).toBe(false);
    expect(s.peers.send('nope', { type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' })).toBe(false);
  });

  it('treats an explicit reconnect as a lost link before the next snapshot', () => {
    const { peers, f, states } = openEc2();
    f.set('connecting');
    expect(states.at(-1)).toEqual(['ec2', 'unreachable']);
    expect(peers.status('ec2')).toBe('connecting');
    expect(peers.supportsBrainDelegate?.('ec2')).toBe(false);
  });

  it('a removed machine closes its peer and says removed', () => {
    const { peers, f, states } = openEc2();
    peers.setMachines([LOCAL]);
    expect(f.o.closed).toBe(1);
    expect(states.at(-1)).toEqual(['ec2', 'removed']);
    expect(peers.status('ec2')).toBe('unreachable');
  });

  it('a changed ssh alias reconnects on the new alias: unreachable, never removed', () => {
    const { peers, f, states, fakes, urls, got } = openEc2();
    peers.setMachines([LOCAL, { ...EC2, ssh: 'ec2-new' }]);
    expect(f.o.closed).toBe(1);
    expect(states.slice(1)).toEqual([['ec2', 'unreachable']]);
    expect(urls.at(-1)).toBe('ws://127.0.0.1:47831/ssh/ec2-new');
    expect(peers.status('ec2')).toBe('connecting');
    // the old client says nothing more
    f.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r1')] }); expect(got).toEqual([]);
    const g = fakes[1]!; g.set('open'); g.emit(snap(true));
    expect(states.at(-1)).toEqual(['ec2', 'open']);
    expect(states.some(([, s]) => s === 'removed')).toBe(false);
  });

  it('close() closes every peer; a listener can unsubscribe', () => {
    const s = setup(); const off = s.peers.onStatus(() => { throw new Error('off'); }); off();
    s.peers.setMachines([LOCAL, EC2]); s.peers.close();
    expect(s.fakes[0]!.o.closed).toBe(1);
  });
});

describe('rewriteFromPeer', () => {
  it('rewrites machine local on every rig message, leaves seat session ids alone', () => {
    expect(rewriteFromPeer('ec2', { type: 'rig.removed', machine: 'local', rigId: 'r1' })).toEqual({ type: 'rig.removed', machine: 'ec2', rigId: 'r1' });
    expect(rewriteFromPeer('ec2', { type: 'rig.updated', rig: rig('r1') })).toMatchObject({ rig: { machine: 'ec2' } });
    expect(rewriteFromPeer('ec2', { type: 'rig.exchange', exchange: exch() })).toMatchObject({ exchange: { machine: 'ec2' } });
    expect(rewriteFromPeer('ec2', { type: 'rig.exchanges', machine: 'local', rigId: 'r1', items: [exch()] })).toMatchObject({ machine: 'ec2', items: [{ machine: 'ec2' }] });
    expect(rewriteFromPeer('ec2', { type: 'escalation.updated', escalation: esc('e1') })).toMatchObject({ escalation: { machine: 'ec2' } });
    expect(rewriteFromPeer('ec2', { type: 'openrig.status', status: { machine: 'local', state: 'running' } })).toMatchObject({ status: { machine: 'ec2', state: 'running' } });
    expect(rewriteFromPeer('ec2', { type: 'rig.updated', rig: rig('r1', { machine: 'pc' }) })).toBeNull();
    expect(rewriteFromPeer('ec2', { type: 'openrig.status', status: { machine: 'pc', state: 'running' } })).toBeNull();
    expect(rewriteFromPeer('ec2', { type: 'sessions' } as never)).toBeNull();
  });
});
