import { describe, it, expect, beforeEach } from 'vitest';
import type { ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import { LOCAL_MACHINE } from '../src/machines';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { fakeSession } from './mockDaemon';

const remote = { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' };
function peer() {
  const sent: unknown[] = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
// A remote peer's snapshot must echo its ssh alias, or the fleet rejects it as an old local daemon.
const snap = (ids: string[], sshAlias?: string): ServerMessage => ({ type: 'snapshot', ...(sshAlias ? { sshAlias } : {}), sessions: ids.map(id => fakeSession(id)), recents: [], daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } });
const lastSnapshot = (got: ServerMessage[]) => [...got].reverse().find(m => m.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }> | undefined;

function setup(opts = { keepStale: true }) {
  const local = peer(), server = peer();
  const api = createFleetClient([LOCAL_MACHINE, remote], o => o.url === LOCAL_MACHINE.url ? local.client : server.client, opts);
  const got: ServerMessage[] = []; api.onMessage(m => got.push(m)); api.connect();
  local.set('open'); local.emit(snap(['a'])); server.set('open'); server.emit(snap(['r1', 'r2'], remote.ssh));
  return { api, local, server, got };
}
beforeEach(() => localStorage.clear());

describe('keepStale', () => {
  it('a fallen remote peer keeps its sessions published, flagged offline, its machine unreachable', () => {
    const { api, server, got } = setup();
    server.set('unreachable');
    const s = lastSnapshot(got)!;
    expect(s.sessions.map(x => [x.id, x.offline])).toEqual([['local:a', undefined], ['server:r1', true], ['server:r2', true]]);
    expect(api.fleet!.machines().find(m => m.id === 'server')?.status).toBe('unreachable');
    expect(api.fleet!.sendTo('server', { type: 'snapshot.request' })).toBe(false);
  });
  it('without the option the sessions vanish, as the island expects', () => {
    const { server, got } = setup({ keepStale: false });
    server.set('unreachable');
    const s = lastSnapshot(got)!;
    expect(s.sessions.map(x => x.id)).toEqual(['local:a']);
    expect(s.sessions.every(x => !('offline' in x))).toBe(true);
  });
  it('the local peer is never frozen: its fall empties everything and the fleet is unreachable', () => {
    const { api, local, got } = setup();
    local.set('unreachable');
    expect(lastSnapshot(got)!.sessions.map(x => x.id)).toEqual(['server:r1', 'server:r2']);
    expect(api.fleet!.machines().find(m => m.id === 'local')?.status).toBe('unreachable');
    expect(api.status()).toBe('open'); // the remote peer still answers
    expect(api.fleet!.sendTo('local', { type: 'snapshot.request' })).toBe(false);
  });
  it('the peer coming back replaces the stale snapshot and drops a session gone meanwhile', () => {
    const { server, got } = setup();
    server.set('unreachable'); server.set('open'); server.emit(snap(['r2', 'r3'], remote.ssh));
    expect(lastSnapshot(got)!.sessions.map(x => [x.id, x.offline])).toEqual([['local:a', undefined], ['server:r2', undefined], ['server:r3', undefined]]);
  });
});
