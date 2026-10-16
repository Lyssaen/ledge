import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import type { Machines, Project, Projects, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import { createDaemonClient, type DaemonClient, type DaemonStatus } from '../src/client';
import { LOCAL_MACHINE, useProjects } from '../src/machines';
import { createMockDaemon } from './mockDaemon';

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
const A: Project = { id: 'a', name: 'A', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] };
const state: Projects = { projects: [A], rules: [{ machine: 'local', path: '/tmp/x', project: 'a' }] };
const projectsSent = (p: { sent: unknown[] }) => p.sent.filter(m => (m as { type: string }).type === 'projects.set');

beforeEach(() => localStorage.clear());

describe('projects from the local daemon', () => {
  it('is null until the local daemon sends projects, then follows each broadcast', () => {
    const { api, local } = setup();
    expect(api.fleet!.projects()).toBeNull();
    local.emit({ type: 'projects', projects: state });
    expect(api.fleet!.projects()).toEqual(state);
    const first = api.fleet!.projects();
    local.emit(snap());
    expect(api.fleet!.projects()).toBe(first);   // stable reference for useSyncExternalStore
  });
  it('ignores projects from a remote machine', () => {
    const { api, local, server } = setup();
    local.emit(machinesMsg([{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server', ssh: 'dev-server' }]));
    server.set('open'); server.emit(snap('dev-server'));
    server.emit({ type: 'projects', projects: state });
    expect(api.fleet!.projects()).toBeNull();
  });
  it('keeps the last projects while the local daemon is down', () => {
    const { api, local } = setup();
    local.emit({ type: 'projects', projects: state }); local.set('unreachable');
    expect(api.fleet!.projects()).toEqual(state);
  });
  it('setProjects validates, refuses offline, and waits for the broadcast', () => {
    const { api, local } = setup();
    expect(() => api.fleet!.setProjects({ projects: [{ ...A, name: ' ' }], rules: [] })).toThrow();
    api.fleet!.setProjects(state);
    expect(projectsSent(local)).toEqual([{ type: 'projects.set', projects: state }]);
    expect(api.fleet!.projects()).toBeNull();   // not applied before the daemon answers
    local.set('unreachable');
    expect(() => api.fleet!.setProjects(state)).toThrow(expect.objectContaining({ name: 'DaemonOffline' }));
    expect(projectsSent(local)).toHaveLength(1);
  });
  it('notifies subscribers on a projects broadcast', () => {
    const { api, local } = setup();
    let calls = 0; api.fleet!.subscribe(() => { calls++; });
    local.emit({ type: 'projects', projects: state });
    expect(calls).toBeGreaterThan(0);
  });
  it('useProjects follows the fleet', () => {
    const { api, local } = setup();
    const { result } = renderHook(() => useProjects(api));
    expect(result.current).toBeNull();
    act(() => local.emit({ type: 'projects', projects: state }));
    expect(result.current).toEqual(state);
  });
  it('round-trips through a daemon: stored projects arrive, a set comes back broadcast', async () => {
    const d = await createMockDaemon(); d.projects(state);
    const api = createFleetClient([LOCAL_MACHINE], () => createDaemonClient({ url: d.url, WebSocketImpl: WebSocket as never }), { machinesFromDaemon: true });
    api.connect();
    await waitFor(() => expect(api.fleet!.projects()).toEqual(state));
    const next: Projects = { projects: [A, { ...A, id: 'b', name: 'B', repos: [] }], rules: [] };
    api.fleet!.setProjects(next);
    await waitFor(() => expect(api.fleet!.projects()).toEqual(next));
    api.close(); await d.close();
  });
});
