import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_ISLAND_PREFS, type IslandPrefs, type Machines, type ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE, useIsland } from '../src/machines';

function peer() {
  const sent: unknown[] = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const snap = (sshAlias?: string): ServerMessage => ({ type: 'snapshot', ...(sshAlias ? { sshAlias } : {}), sessions: [], recents: [], daemon: { version: '0.6.0', install: 'npm', systemd: true, routing: true } });
const machinesMsg = (machines: Machines): ServerMessage => ({ type: 'machines', machines });
function setup() {
  const local = peer(), server = peer();
  const api = createFleetClient([LOCAL_MACHINE], o => (o.url === LOCAL_MACHINE.url ? local.client : server.client), { machinesFromDaemon: true });
  api.connect(); local.set('open'); local.emit(snap());
  return { api, local, server };
}
const left: IslandPrefs = { ...DEFAULT_ISLAND_PREFS, position: 'left' };
const islandSent = (p: { sent: unknown[] }) => p.sent.filter(m => (m as { type: string }).type === 'island.set');

beforeEach(() => localStorage.clear());

describe('island settings from the local daemon', () => {
  it('is undefined until the local daemon speaks of them, null while none was set, then follows each broadcast', () => {
    const { api, local } = setup();
    expect(api.fleet!.island()).toBeUndefined();
    local.emit({ type: 'island', prefs: null });
    expect(api.fleet!.island()).toBeNull();
    local.emit({ type: 'island', prefs: left });
    expect(api.fleet!.island()).toEqual(left);
  });
  it('ignores a remote machine and keeps the last ones while the local daemon is down', () => {
    const { api, local, server } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    server.set('open'); server.emit(snap('dev-server'));
    server.emit({ type: 'island', prefs: left });
    expect(api.fleet!.island()).toBeUndefined();
    local.emit({ type: 'island', prefs: left }); local.set('unreachable');
    expect(api.fleet!.island()).toEqual(left);
  });
  it('setIsland refuses a daemon that never spoke of them and one offline, validates, and waits for the broadcast', () => {
    const { api, local } = setup();
    expect(() => api.fleet!.setIsland(left)).toThrow(expect.objectContaining({ name: 'DaemonOutdated' }));
    local.emit({ type: 'island', prefs: null });
    expect(() => api.fleet!.setIsland({ ...left, shortcut: ' ' })).toThrow();
    api.fleet!.setIsland(left);
    expect(islandSent(local)).toEqual([{ type: 'island.set', prefs: left }]);
    expect(api.fleet!.island()).toBeNull();   // not applied before the daemon answers
    local.set('unreachable');
    expect(() => api.fleet!.setIsland(left)).toThrow(expect.objectContaining({ name: 'DaemonOffline' }));
    expect(islandSent(local)).toHaveLength(1);
  });
  it('useIsland follows the fleet', () => {
    const { api, local } = setup();
    const { result } = renderHook(() => useIsland(api));
    expect(result.current).toBeUndefined();
    act(() => local.emit({ type: 'island', prefs: left }));
    expect(result.current).toEqual(left);
  });
});
