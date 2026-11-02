import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Machines, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE, useTeamsEngine } from '../src/machines';

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
const state = (engine: 'ledge' | 'openrig', openrigAvailable = true, running = false): ServerMessage => ({ type: 'teams.engine', engine, openrigAvailable, running });
const setsOf = (p: { sent: unknown[] }) => p.sent.filter(m => (m as { type: string }).type === 'teams.engine.set') as { type: string; rid: string; engine: string }[];

beforeEach(() => localStorage.clear());

describe('team engine from the local daemon', () => {
  it('is null until the local daemon speaks of it, then follows each broadcast; a remote machine is ignored', () => {
    const { api, local, server } = setup();
    expect(api.fleet!.teamsEngine()).toBeNull();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    server.set('open'); server.emit(snap('dev-server'));
    server.emit(state('openrig'));
    expect(api.fleet!.teamsEngine()).toBeNull();
    local.emit(state('ledge', false));
    expect(api.fleet!.teamsEngine()).toEqual({ engine: 'ledge', openrigAvailable: false, running: false });
    local.emit(state('openrig', true, true));
    expect(api.fleet!.teamsEngine()).toEqual({ engine: 'openrig', openrigAvailable: true, running: true });
  });
  it('setTeamsEngine resolves on the teams.engine.result of the same rid', async () => {
    const { api, local } = setup();
    local.emit(state('ledge'));
    const first = api.fleet!.setTeamsEngine('openrig');
    const second = api.fleet!.setTeamsEngine('ledge');
    const [a, b] = setsOf(local) as [ReturnType<typeof setsOf>[number], ReturnType<typeof setsOf>[number]];
    expect(a.engine).toBe('openrig'); expect(a.rid).not.toBe(b.rid);
    local.emit({ type: 'teams.engine.result', rid: b.rid, ok: false, reason: 'une équipe tourne' });
    local.emit({ type: 'teams.engine.result', rid: a.rid, ok: true });
    expect(await second).toEqual({ ok: false, reason: 'une équipe tourne' });
    expect(await first).toEqual({ ok: true });
  });
  it('setTeamsEngine throws DaemonOutdated without teams.engine in the snapshot, DaemonOffline when down', () => {
    const { api, local } = setup();
    expect(() => api.fleet!.setTeamsEngine('openrig')).toThrow(expect.objectContaining({ name: 'DaemonOutdated' }));
    local.emit(state('ledge'));
    local.set('unreachable');
    expect(() => api.fleet!.setTeamsEngine('openrig')).toThrow(expect.objectContaining({ name: 'DaemonOffline' }));
    expect(setsOf(local)).toHaveLength(0);
  });
  it('a request in flight is refused when the daemon drops', async () => {
    const { api, local } = setup();
    local.emit(state('ledge'));
    const p = api.fleet!.setTeamsEngine('openrig');
    local.set('unreachable');
    expect(await p).toEqual({ ok: false, reason: 'hors ligne' });
  });
  it('useTeamsEngine follows the fleet', () => {
    const { api, local } = setup();
    const { result } = renderHook(() => useTeamsEngine(api));
    expect(result.current).toBeNull();
    act(() => local.emit(state('openrig', true)));
    expect(result.current).toEqual({ engine: 'openrig', openrigAvailable: true, running: false });
  });
});
