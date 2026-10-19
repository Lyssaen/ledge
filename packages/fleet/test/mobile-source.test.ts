import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_RELAY_URL, type MobileState, type Machines, type ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE, useMobile } from '../src/machines';

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
const off: MobileState = { enabled: false, relayUrl: DEFAULT_RELAY_URL, account: null, signin: null, signinError: null, link: { state: 'off' }, devices: [], pairings: [] };
const on: MobileState = { ...off, enabled: true };
const mobileSent = (p: { sent: unknown[] }) => p.sent.filter(m => (m as { type: string }).type.startsWith('mobile.'));

beforeEach(() => localStorage.clear());

describe('mobile access state from the local daemon', () => {
  it('is undefined until the local daemon speaks of it, then follows each broadcast and notifies', () => {
    const { api, local } = setup();
    let calls = 0; api.fleet!.subscribe(() => { calls++; });
    expect(api.fleet!.mobile()).toBeUndefined();
    local.emit({ type: 'mobile', state: off });
    expect(api.fleet!.mobile()).toEqual(off);
    expect(calls).toBeGreaterThan(0);
    local.emit({ type: 'mobile', state: on });
    expect(api.fleet!.mobile()).toEqual(on);
  });
  it('ignores a remote machine and keeps the last state while the local daemon is down', () => {
    const { api, local, server } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    server.set('open'); server.emit(snap('dev-server'));
    server.emit({ type: 'mobile', state: on });
    expect(api.fleet!.mobile()).toBeUndefined();
    local.emit({ type: 'mobile', state: off }); local.set('unreachable');
    expect(api.fleet!.mobile()).toEqual(off);
  });
  it('sendMobile refuses a daemon that never sent mobile and one offline, otherwise sends without applying', () => {
    const { api, local } = setup();
    expect(() => api.fleet!.sendMobile({ type: 'mobile.retry' })).toThrow(expect.objectContaining({ name: 'DaemonOutdated' }));
    local.emit({ type: 'mobile', state: off });
    api.fleet!.sendMobile({ type: 'mobile.set', enabled: true, relayUrl: DEFAULT_RELAY_URL });
    expect(mobileSent(local)).toEqual([{ type: 'mobile.set', enabled: true, relayUrl: DEFAULT_RELAY_URL }]);
    expect(api.fleet!.mobile()).toEqual(off);   // applied on the daemon's broadcast only
    local.set('unreachable');
    expect(() => api.fleet!.sendMobile({ type: 'mobile.retry' })).toThrow(expect.objectContaining({ name: 'DaemonOffline' }));
    expect(mobileSent(local)).toHaveLength(1);
  });
  it('useMobile follows the fleet', () => {
    const { api, local } = setup();
    const { result } = renderHook(() => useMobile(api));
    expect(result.current).toBeUndefined();
    act(() => local.emit({ type: 'mobile', state: on }));
    expect(result.current).toEqual(on);
  });
});
