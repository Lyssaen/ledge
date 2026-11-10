import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, OpenRigState, ServerMessage } from '@ledge/protocol';
import { initialNav, navReducer } from '../src/nav/state';
import { summarize, useSidebarOpenRig } from '../src/openrig/sidebarState';
import { useOpenRig } from '@ledge/fleet/openrig';

afterEach(() => cleanup());

// What the sidebar knows of OpenRig (openrig/sidebarState.ts): the Atelier tab's « Projects | Rigs » and its empty states read it.
describe('what the sidebar knows of OpenRig', () => {
  const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({ installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [], at: '2026-11-02T09:00:00.000Z', ...o });
  const machine = (id: string, ready = true) => ({ id, label: id, ready, status: ready ? 'open' : 'closed', recents: [], sessions: [], launcher: null }) as unknown as MachineState;

  it('installed / daemon up across machines', () => {
    expect(summarize([])).toEqual({ installed: false, daemonUp: false });
    expect(summarize([state({ installed: false, daemon: { state: 'unknown' } })])).toEqual({ installed: false, daemonUp: false });
    expect(summarize([state({ daemon: { state: 'stopped' } })])).toEqual({ installed: true, daemonUp: false });
    expect(summarize([state({ daemon: { state: 'stopped' } }), state()])).toEqual({ installed: true, daemonUp: true });
  });

  it('asks every ready machine, and starts the local one with daemon.start', () => {
    const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
    const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
    const emit = (m: ServerMessage) => act(() => listeners.forEach(f => f(m)));
    const { result } = renderHook(() => useSidebarOpenRig(client, [machine('local'), machine('ec2'), machine('pi', false)]));
    const asked = sent.filter(m => m.type === 'openrig.status') as Array<{ requestId: string; machineId: string }>;
    expect(asked.map(m => m.machineId).sort()).toEqual(['ec2', 'local']);
    expect(result.current.installed).toBe(false);
    emit({ type: 'openrig.state', requestId: asked.find(m => m.machineId === 'ec2')!.requestId, machineId: 'ec2', state: state({ kernel: { state: 'starting' } }) });
    expect(result.current).toMatchObject({ installed: true, daemonUp: true });
    expect(result.current.kernelState('ec2')).toBe('starting');
    emit({ type: 'openrig.state', requestId: asked.find(m => m.machineId === 'local')!.requestId, machineId: 'local', state: state({ daemon: { state: 'stopped' } }) });
    expect(result.current.canStart).toBe(true);
    act(() => result.current.start());
    const startAct = sent.filter(m => m.type === 'openrig.act').at(-1) as { requestId: string };
    expect(startAct).toMatchObject({ type: 'openrig.act', machineId: 'local', action: { kind: 'daemon.start' } });
    expect(result.current.starting).toBe(true);
    emit({ type: 'openrig.done', requestId: startAct.requestId, machineId: 'local', ok: false, commands: ['rig daemon start'], error: 'port in use' });
    expect(result.current).toMatchObject({ starting: false, failed: 'port in use' });
  });
});

function fakeClient() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))) };
}
const machineOf = (id: string, ready = true) => ({ id, label: id, ready, status: ready ? 'open' : 'closed', recents: [], sessions: [], launcher: null }) as unknown as MachineState;
const st = (o: Partial<OpenRigState> = {}): OpenRigState => ({ installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [], at: '2026-11-02T09:00:00.000Z', ...o });
const statusAsks = (sent: ClientMessage[]) => sent.filter(m => m.type === 'openrig.status') as Array<{ requestId: string; machineId: string }>;

describe('« Démarrer OpenRig » acts on this computer only (review P1)', () => {
  it('the local machine not ready, a remote one ready with OpenRig stopped: no start, and nothing is sent to the remote', () => {
    const { client, sent, emit } = fakeClient();
    const { result } = renderHook(() => useSidebarOpenRig(client, [machineOf('local', false), machineOf('ec2')]));
    expect(statusAsks(sent).map(m => m.machineId)).toEqual(['ec2']);
    emit({ type: 'openrig.state', requestId: statusAsks(sent)[0]!.requestId, machineId: 'ec2', state: st({ daemon: { state: 'stopped' } }) });
    expect(result.current).toMatchObject({ installed: true, daemonUp: false, canStart: false });
    act(() => result.current.start());
    expect(sent.some(m => m.type === 'openrig.act')).toBe(false);
  });

  it('the local machine ready without OpenRig, a remote one with it: no start either', () => {
    const { client, sent, emit } = fakeClient();
    const { result } = renderHook(() => useSidebarOpenRig(client, [machineOf('local'), machineOf('ec2')]));
    const asks = statusAsks(sent);
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'local')!.requestId, machineId: 'local', state: st({ installed: false, daemon: { state: 'unknown' } }) });
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'ec2')!.requestId, machineId: 'ec2', state: st({ daemon: { state: 'stopped' } }) });
    expect(result.current).toMatchObject({ installed: true, daemonUp: false, canStart: false });
    act(() => result.current.start());
    expect(sent.some(m => m.type === 'openrig.act')).toBe(false);
  });
});

describe('the kernel state of each machine, as the sidebar reads it (review)', () => {
  it('not answered yet: undefined; answered: its state; disconnected or unanswerable: offline', () => {
    const { client, sent, emit } = fakeClient();
    const { result, rerender } = renderHook(({ ms }) => useSidebarOpenRig(client, ms), { initialProps: { ms: [machineOf('local'), machineOf('ec2')] } });
    expect(result.current.kernelState('ec2')).toBeUndefined();
    const asks = statusAsks(sent);
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'ec2')!.requestId, machineId: 'ec2', state: st() });
    expect(result.current.kernelState('ec2')).toBe('ready');
    // The fleet loses EC2: its seats stay listed, offline.
    rerender({ ms: [machineOf('local'), machineOf('ec2', false)] });
    expect(result.current.kernelState('ec2')).toBe('offline');
    // The local machine answers that it cannot (its daemon too old).
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'local')!.requestId, machineId: 'local', error: 'outdated' });
    expect(result.current.kernelState('local')).toBe('offline');
  });
});

describe('where OpenRig is installed when not here (4 bis)', () => {
  it('the first remote machine with OpenRig, in display order', () => {
    const { client, sent, emit } = fakeClient();
    const ms = [{ ...machineOf('local'), label: 'WSL' }, { ...machineOf('pi'), label: 'Pi' }, { ...machineOf('ec2'), label: 'EC2' }];
    const { result } = renderHook(() => useSidebarOpenRig(client, ms));
    const asks = statusAsks(sent);
    const answer = (m: string, s: OpenRigState) => emit({ type: 'openrig.state', requestId: asks.find(x => x.machineId === m)!.requestId, machineId: m, state: s });
    answer('local', st({ installed: false, daemon: { state: 'unknown' } }));
    answer('ec2', st({ daemon: { state: 'stopped' } }));
    expect(result.current.installedOn).toEqual({ id: 'ec2', label: 'EC2' });
    answer('pi', st({ daemon: { state: 'stopped' } }));
    expect(result.current.installedOn).toEqual({ id: 'pi', label: 'Pi' });
  });
});

describe('one read per machine (review P3)', () => {
  it('the OpenRig page and the sidebar on the same machine send one openrig.status, and keep one loop at the page’s pace', () => {
    vi.useFakeTimers();
    try {
      const { client, sent, emit } = fakeClient();
      const side = renderHook(() => useSidebarOpenRig(client, [machineOf('local')]));
      const page = renderHook(() => useOpenRig(client, 'local')); // the page's 5 s
      expect(statusAsks(sent)).toHaveLength(1);
      emit({ type: 'openrig.state', requestId: statusAsks(sent)[0]!.requestId, machineId: 'local', state: st() });
      expect(page.result.current.state?.daemon.state).toBe('running');
      expect(side.result.current.daemonUp).toBe(true);
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(statusAsks(sent)).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(4_999); });
      expect(statusAsks(sent)).toHaveLength(2);
      // The page closes: the sidebar's 15 s alone.
      page.unmount();
      act(() => { vi.advanceTimersByTime(14_000); });
      expect(statusAsks(sent)).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(statusAsks(sent)).toHaveLength(3);
      side.unmount();
      act(() => { vi.advanceTimersByTime(120_000); });
      expect(statusAsks(sent)).toHaveLength(3);
    } finally { vi.useRealTimers(); }
  });

  it('OpenRig stopped or absent: read every minute, on a window focus, and right after Start', () => {
    vi.useFakeTimers();
    try {
      const { client, sent, emit } = fakeClient();
      const side = renderHook(() => useSidebarOpenRig(client, [machineOf('local')]));
      emit({ type: 'openrig.state', requestId: statusAsks(sent)[0]!.requestId, machineId: 'local', state: st({ daemon: { state: 'stopped' }, kernel: { state: 'stopped' } }) });
      act(() => { vi.advanceTimersByTime(59_000); });
      expect(statusAsks(sent)).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(statusAsks(sent)).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(3_000); window.dispatchEvent(new Event('focus')); });
      expect(statusAsks(sent)).toHaveLength(3);
      act(() => side.result.current.start());
      const start = sent.at(-1) as { requestId: string };
      expect(sent.at(-1)).toMatchObject({ type: 'openrig.act', machineId: 'local', action: { kind: 'daemon.start' } });
      emit({ type: 'openrig.done', requestId: start.requestId, machineId: 'local', ok: true, commands: ['rig daemon start'] });
      expect(statusAsks(sent)).toHaveLength(4);
      side.unmount();
    } finally { vi.useRealTimers(); }
  });
});

describe('opening an OpenRig dialog from the sidebar', () => {
  it('the openrig action carries the dialog to open, not on the roles view', () => {
    const nav = initialNav({ view: 'atelier', helpers: true, paused: false });
    expect(navReducer(nav, { type: 'openrig', section: 'rigs', open: { launch: true } }).place).toMatchObject({ kind: 'openrig', open: { launch: true } });
    expect(navReducer(nav, { type: 'openrig', machine: 'ec2', open: { reseat: 'ledge-dev' } }).place).toMatchObject({ kind: 'openrig', machine: 'ec2', open: { reseat: 'ledge-dev' } });
    expect(navReducer(nav, { type: 'openrig', section: 'roles', open: { launch: true } }).place).not.toHaveProperty('open');
    expect(navReducer(nav, { type: 'openrig' }).place).not.toHaveProperty('open');
  });
});
