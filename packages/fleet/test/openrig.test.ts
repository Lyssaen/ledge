// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ClientMessage, OpenRigState, ServerMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/client';
import { useOpenRig } from '../src/openrig';

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))), listeners };
}
const state = (s: 'running' | 'stopped'): OpenRigState => ({ installed: true, daemon: { state: s }, kernel: { state: 'stopped' }, rigs: [], at: '2026-11-02T09:00:00.000Z' });
const rid = (m: ClientMessage | undefined) => (m as { requestId: string }).requestId;

describe('useOpenRig', () => {
  it('asks the machine at once and every poll; takes only its own latest answer and any broadcast of that machine', () => {
    vi.useFakeTimers();
    try {
      const { client, sent, emit, listeners } = fake();
      const { result, unmount } = renderHook(() => useOpenRig(client, 'server', 1000));
      expect(sent).toEqual([{ type: 'openrig.status', requestId: rid(sent[0]), machineId: 'server' }]);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(sent).toHaveLength(2);
      emit({ type: 'openrig.state', requestId: rid(sent[0]), machineId: 'server', state: state('running') }); // superseded by the poll
      expect(result.current.state).toBeNull();
      emit({ type: 'openrig.state', requestId: rid(sent[1]), machineId: 'local', state: state('running') }); // another machine
      expect(result.current.state).toBeNull();
      emit({ type: 'openrig.state', requestId: rid(sent[1]), machineId: 'server', state: state('running') });
      expect(result.current.state?.daemon.state).toBe('running');
      emit({ type: 'openrig.state', machineId: 'server', state: state('stopped') });
      expect(result.current.state?.daemon.state).toBe('stopped');
      emit({ type: 'openrig.state', requestId: rid(sent[1]), machineId: 'server', error: 'outdated' });
      expect(result.current).toMatchObject({ state: null, error: 'outdated' });
      unmount();
      expect(listeners.size).toBe(0);
      act(() => { vi.advanceTimersByTime(5000); });
      expect(sent).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });
  it('an action is pending until its end, which it resolves with', async () => {
    const { client, sent, emit } = fake();
    const { result } = renderHook(() => useOpenRig(client, 'local', 60_000));
    let p!: Promise<unknown>;
    act(() => { p = result.current.act({ kind: 'rig.stop', rig: 'starter', snapshot: true }); });
    const ask = sent.at(-1)!;
    expect(ask).toMatchObject({ type: 'openrig.act', machineId: 'local', action: { kind: 'rig.stop', rig: 'starter', snapshot: true } });
    expect(result.current.pending).toEqual({ kind: 'rig.stop', rig: 'starter', snapshot: true });
    emit({ type: 'openrig.done', requestId: rid(ask), machineId: 'local', ok: true, commands: ['rig down starter --snapshot'] });
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(result.current.pending).toBeNull();
    expect(result.current.last).toMatchObject({ ok: true, commands: ['rig down starter --snapshot'] });
  });
  it('no machine: nothing is asked', () => {
    const { client, sent } = fake();
    const { result } = renderHook(() => useOpenRig(client, null));
    expect(sent).toEqual([]);
    expect(result.current.state).toBeNull();
  });
});

describe('useOpenRigRoles / useOpenRigRole / readRoleFile', () => {
  it('the roles: asked once per machine, its own answer only', async () => {
    const { useOpenRigRoles } = await import('../src/openrig');
    const { client, sent, emit } = fake();
    const { result } = renderHook(() => useOpenRigRoles(client, 'local'));
    expect(result.current.status).toBe('loading');
    expect(sent).toEqual([{ type: 'openrig.roles', requestId: rid(sent[0]), machineId: 'local' }]);
    emit({ type: 'openrig.roleList', requestId: 'other', roles: [] });
    expect(result.current.status).toBe('loading');
    emit({ type: 'openrig.roleList', requestId: rid(sent[0]), machineId: 'local', roles: [], openrigVersion: '0.7.7', error: 'daemon_stopped' });
    expect(result.current).toMatchObject({ status: 'ready', roles: [], openrigVersion: '0.7.7', error: 'daemon_stopped' });
    act(() => result.current.reload());
    expect(sent).toHaveLength(2);
  });
  it('a role: asked again when the id changes, the previous one not shown for another id', async () => {
    const { useOpenRigRole } = await import('../src/openrig');
    const { client, sent, emit } = fake();
    const { result, rerender } = renderHook(({ id }) => useOpenRigRole(client, 'local', id), { initialProps: { id: 'a' as string | null } });
    expect(sent.at(-1)).toMatchObject({ type: 'openrig.role', roleId: 'a' });
    emit({ type: 'openrig.roleDetail', requestId: rid(sent.at(-1)), roleId: 'a', error: 'role_not_found' });
    expect(result.current).toMatchObject({ status: 'ready', role: null, error: 'role_not_found' });
    rerender({ id: 'b' });
    expect(result.current.status).toBe('loading');
    expect(sent.at(-1)).toMatchObject({ type: 'openrig.role', roleId: 'b' });
    rerender({ id: null });
    expect(result.current.status).toBe('idle');
  });
  it('a role file resolves with its answer', async () => {
    const { readRoleFile } = await import('../src/openrig');
    const { client, sent, emit } = fake();
    const p = readRoleFile(client, 'local', 'a', '/s/role.md');
    expect(sent.at(-1)).toMatchObject({ type: 'openrig.roleFile', machineId: 'local', roleId: 'a', path: '/s/role.md' });
    emit({ type: 'openrig.roleFileContent', requestId: rid(sent.at(-1)), roleId: 'a', path: '/s/role.md', content: '# Rôle', size: 7 });
    await expect(p).resolves.toMatchObject({ content: '# Rôle' });
  });
});

describe('useRigSnapshots', () => {
  const snapshots = [{ id: '01M6XTAV9KM2HVRS841K1FQ6RV', kind: 'manual', status: 'complete', createdAt: '2026-11-08 14:52:23' }];
  it('asks once per machine and rig, its own answer only; another rig is not shown the previous list', async () => {
    const { useRigSnapshots } = await import('../src/openrig');
    const { client, sent, emit } = fake();
    const { result, rerender } = renderHook(({ rig }) => useRigSnapshots(client, 'server', rig), { initialProps: { rig: 'a' as string | null } });
    expect(result.current).toMatchObject({ status: 'loading', snapshots: [] });
    expect(sent).toEqual([{ type: 'openrig.snapshots', requestId: rid(sent[0]), machineId: 'server', rig: 'a' }]);
    emit({ type: 'openrig.snapshotList', requestId: 'other', rig: 'a', snapshots });
    expect(result.current.status).toBe('loading');
    emit({ type: 'openrig.snapshotList', requestId: rid(sent[0]), machineId: 'server', rig: 'a', snapshots });
    expect(result.current).toMatchObject({ status: 'ready', snapshots });
    rerender({ rig: 'b' });
    expect(result.current).toMatchObject({ status: 'loading', snapshots: [] });
    emit({ type: 'openrig.snapshotList', requestId: rid(sent.at(-1)), rig: 'b', snapshots: [], error: 'unknown_rig' });
    expect(result.current).toMatchObject({ status: 'ready', snapshots: [], error: 'unknown_rig' });
    act(() => result.current.reload());
    expect(sent).toHaveLength(3);
    rerender({ rig: null });
    expect(result.current.status).toBe('idle');
  });
});

describe('useRigGraph', () => {
  const graph = { pods: [{ id: 'dev', label: 'Project' }], seats: [{ logicalId: 'dev.build', pod: 'dev', runtime: 'codex', status: 'exited', attention: false }], links: [] };
  it('asks once per machine and rig, its own answer only; another rig is not shown the previous graph', async () => {
    const { useRigGraph } = await import('../src/openrig');
    const { client, sent, emit } = fake();
    const { result, rerender } = renderHook(({ rig }) => useRigGraph(client, 'server', rig), { initialProps: { rig: 'a' as string | null } });
    expect(result.current.status).toBe('loading');
    expect(sent).toEqual([{ type: 'openrig.graph', requestId: rid(sent[0]), machineId: 'server', rig: 'a' }]);
    emit({ type: 'openrig.graphState', requestId: 'other', rig: 'a', graph });
    expect(result.current.status).toBe('loading');
    emit({ type: 'openrig.graphState', requestId: rid(sent[0]), machineId: 'server', rig: 'a', graph });
    expect(result.current).toMatchObject({ status: 'ready', graph });
    rerender({ rig: 'b' });
    expect(result.current).toMatchObject({ status: 'loading', graph: null });
    emit({ type: 'openrig.graphState', requestId: rid(sent.at(-1)), rig: 'b', error: 'unknown_rig' });
    expect(result.current).toMatchObject({ status: 'ready', graph: null, error: 'unknown_rig' });
    act(() => result.current.reload());
    expect(sent).toHaveLength(3);
    rerender({ rig: null });
    expect(result.current.status).toBe('idle');
  });
});

describe('useRigRow', () => {
  const row = { id: 'qitem-1-a', state: 'in-progress', from: 'a@r', to: 'b@r', createdAt: 'x', updatedAt: 'y', at: 'z' };
  it('asks while the card is visible, again every 30 s, its own answer only; nothing while hidden', async () => {
    const { useRigRow } = await import('../src/openrig');
    vi.useFakeTimers();
    try {
      const { client, sent, emit, listeners } = fake();
      const { result, rerender, unmount } = renderHook(({ visible }) => useRigRow(client, 'server', 'qitem-1-a', visible), { initialProps: { visible: false } });
      expect(sent).toEqual([]);
      rerender({ visible: true });
      expect(sent).toEqual([{ type: 'openrig.row', requestId: rid(sent[0]), machineId: 'server', qitem: 'qitem-1-a' }]);
      expect(result.current).toEqual({ row: null });
      emit({ type: 'openrig.rowState', requestId: 'other', qitem: 'qitem-1-a', row: { ...row, state: 'done' } });
      expect(result.current).toEqual({ row: null });
      emit({ type: 'openrig.rowState', requestId: rid(sent[0]), qitem: 'qitem-1-a', row });
      expect(result.current).toEqual({ row });
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(sent).toHaveLength(2);
      emit({ type: 'openrig.rowState', requestId: rid(sent[1]), qitem: 'qitem-1-a', error: 'offline' }); // the last state stays, marked
      expect(result.current).toEqual({ row, error: 'offline' });
      emit({ type: 'openrig.rowState', requestId: rid(sent[1]), qitem: 'qitem-1-a', error: 'not_found' });
      expect(result.current).toEqual({ row: null, error: 'not_found' });
      rerender({ visible: false });
      act(() => { vi.advanceTimersByTime(90_000); });
      expect(sent).toHaveLength(2);
      unmount();
      expect(listeners.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('no row named: nothing is asked', async () => {
    const { useRigRow } = await import('../src/openrig');
    const { client, sent } = fake();
    expect(renderHook(() => useRigRow(client, 'local', null, true)).result.current).toEqual({ row: null });
    expect(sent).toEqual([]);
  });
});
