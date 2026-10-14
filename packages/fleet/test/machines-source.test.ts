import { describe, it, expect, beforeEach } from 'vitest';
import type { ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import { LOCAL_MACHINE } from '../src/machines';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { fakeSession } from './mockDaemon';

const remote = { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' };
function peer() {
  const sent: unknown[] = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting'; let connects = 0;
  const client: DaemonClient = { connect() { connects++; }, close() {}, send(m) { sent.push(m); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, connects: () => connects, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
// A remote peer's snapshot must echo its ssh alias, or the fleet rejects it as an old local daemon.
const snap = (ids: string[], sshAlias?: string): ServerMessage => ({ type: 'snapshot', ...(sshAlias ? { sshAlias } : {}), sessions: ids.map(id => fakeSession(id)), recents: [], daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } });
const machinesMsg = (list: { id: string; label: string; ssh?: string }[]) => ({ type: 'machines', machines: list }) as unknown as ServerMessage;
const setSent = (p: { sent: unknown[] }) => p.sent.filter(m => (m as { type: string }).type === 'machines.set');
function setup() {
  const local = peer(), server = peer(), extra = peer(); let creates = 0; const made: string[] = [];
  const api = createFleetClient([LOCAL_MACHINE], o => { creates++; made.push(o.url); return o.url === LOCAL_MACHINE.url ? local.client : o.url.endsWith('/ssh/dev-server') ? server.client : extra.client; }, { machinesFromDaemon: true });
  const got: ServerMessage[] = []; api.onMessage(m => got.push(m));
  api.connect(); local.set('open'); local.emit(snap(['a']));
  return { api, local, server, extra, got, made, creates: () => creates };
}
beforeEach(() => localStorage.clear());

describe('machines from the daemon', () => {
  it('before any machines message the list is local and configure writes localStorage', () => {
    const { api } = setup();
    expect(api.fleet!.machinesSource()).toBe('local');
    api.fleet!.configure([LOCAL_MACHINE, remote]);
    expect(JSON.parse(localStorage.getItem('ledge.machines')!).map((m: { id: string }) => m.id)).toEqual(['local', 'server']);
  });
  it('once the daemon speaks, configure sends machines.set and waits for the broadcast', () => {
    const { api, local } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    expect(api.fleet!.machinesSource()).toBe('daemon');
    api.fleet!.configure([LOCAL_MACHINE, remote]);
    expect(local.sent.at(-1)).toEqual({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }] });
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local']); // not applied yet
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'server']);
    expect(localStorage.getItem('ledge.machines')).toBeNull();
  });
  it('migrates a richer local list once, then clears the local key', () => {
    localStorage.setItem('ledge.machines', JSON.stringify([LOCAL_MACHINE, remote]));
    const { local } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    expect(setSent(local)).toHaveLength(1);
    expect(localStorage.getItem('ledge.machines')).toBeNull();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }])); // a second plain list migrates nothing more
    expect(setSent(local)).toHaveLength(1);
  });
  it('the first front connected wins: a daemon list already filled leaves the local one aside', () => {
    localStorage.setItem('ledge.machines', JSON.stringify([LOCAL_MACHINE, { ...remote, id: 'mine', label: 'mine', ssh: 'mine' }]));
    const { api, local } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    expect(setSent(local)).toHaveLength(0);
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'server']);
    expect(localStorage.getItem('ledge.machines')).toBeNull();
  });
  it('a daemon list arriving while a configure waits replaces the request, no duplicate peer, no connection for an unconfirmed machine', () => {
    const { api, local, server, extra, made } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    api.fleet!.configure([LOCAL_MACHINE, remote]);
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'other', label: 'other', ssh: 'other' }]));
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'other']);
    expect(server.connects()).toBe(0);
    expect(extra.connects()).toBe(1);
    expect(made.filter(u => u.endsWith('/ssh/dev-server'))).toHaveLength(0);
    expect(made.filter(u => u.endsWith('/ssh/other'))).toHaveLength(1);
  });
  it('a remote peer\'s machines message is ignored', () => {
    const { api, local, server, got } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    const before = got.length;
    server.set('open'); server.emit(snap(['r1'], remote.ssh));
    const after = got.length;
    server.emit(machinesMsg([{ id: 'local', label: 'Local' }]));
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local', 'server']);
    expect(got.length).toBe(after);
    expect(before).toBeLessThanOrEqual(after);
  });
  it('machines messages are ignored entirely with the option off', () => {
    const local = peer(); const api = createFleetClient([LOCAL_MACHINE], () => local.client);
    const got: ServerMessage[] = []; api.onMessage(m => got.push(m)); api.connect(); local.set('open'); local.emit(snap(['a']));
    const n = got.length;
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    expect(api.fleet!.machinesSource()).toBe('local');
    expect(api.fleet!.machines().map(m => m.id)).toEqual(['local']);
    expect(got.length).toBe(n);
  });
});
