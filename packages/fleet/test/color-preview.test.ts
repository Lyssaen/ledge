import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import { LOCAL_MACHINE } from '../src/machines';
import { attachClient, daemonStore } from '../src/store';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { useColorPreview } from '../src/colorPreview';
import { fakeSession } from './mockDaemon';

const ec2 = { id: 'ec2', label: 'ec2', url: 'ws://127.0.0.1:47832', ssh: 'ec2' };
const build = { id: 'build', label: 'build', url: 'ws://127.0.0.1:47833', ssh: 'build' };
function peer() {
  let status: DaemonStatus = 'connecting';
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>();
  const sent: ClientMessage[] = [];
  const set = (s: DaemonStatus) => { status = s; statuses.forEach(f => f(s)); };
  const client: DaemonClient = { connect: () => set('open'), close: () => set('unreachable'), status: () => status, send: m => { sent.push(m); }, onMessage: f => { messages.add(f); return () => { messages.delete(f); }; }, onStatus: f => { statuses.add(f); return () => { statuses.delete(f); }; } };
  return { client, sent, set, emit: (m: ServerMessage) => messages.forEach(f => f(m)) };
}
const snap = (ssh?: string, colorPreview = true, ids: string[] = ['s1']): ServerMessage => ({ type: 'snapshot', sessions: ids.map(i => fakeSession(i)), ...(ssh ? { sshAlias: ssh } : {}), daemon: { version: '0.30.0', install: 'npm', systemd: true, ...(colorPreview ? { colorPreview: true } : {}) } });
const subs = (p: { sent: ClientMessage[] }) => p.sent.filter(m => m.type === 'session.preview.subscribe');
function setup(colorPreview = { local: true, ec2: true, build: true }) {
  const local = peer(), e = peer(), b = peer();
  const client = createFleetClient([LOCAL_MACHINE, ec2, build], o => o.url === LOCAL_MACHINE.url ? local.client : o.url.endsWith('/ssh/ec2') ? e.client : b.client);
  attachClient(client); client.connect();
  local.emit(snap(undefined, colorPreview.local)); e.emit(snap('ec2', colorPreview.ec2)); b.emit(snap('build', colorPreview.build));
  return { client, local, e, b };
}
beforeEach(() => { daemonStore.reset(); localStorage.clear(); });

describe('useColorPreview', () => {
  it('subscribes with color and unsubscribes on unmount', () => {
    const { client, local } = setup();
    const { unmount } = renderHook(() => useColorPreview(client, 'local:s1'));
    expect(subs(local)).toEqual([{ type: 'session.preview.subscribe', id: 's1', color: true }]);
    unmount();
    expect(subs(local)).toEqual([{ type: 'session.preview.subscribe', id: 's1', color: true }, { type: 'session.preview.subscribe', id: null, color: true }]);
  });
  it('a client without a fleet subscribes with the id as is', () => {
    const sent: ClientMessage[] = [];
    const client: DaemonClient = { connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };
    daemonStore.apply(snap());
    const { unmount } = renderHook(() => useColorPreview(client, 's1'));
    unmount();
    expect(sent).toEqual([{ type: 'session.preview.subscribe', id: 's1', color: true }, { type: 'session.preview.subscribe', id: null, color: true }]);
  });
  it('a remote session is subscribed on its machine with its bare id, and its lines come back qualified', () => {
    const { client, local, e } = setup();
    const { result } = renderHook(() => useColorPreview(client, 'ec2:ab12'));
    expect(subs(e)).toEqual([{ type: 'session.preview.subscribe', id: 'ab12', color: true }]);
    expect(subs(local)).toEqual([]);
    expect(result.current).toBeUndefined();
    act(() => e.emit({ type: 'session.preview.color', id: 'ab12', lines: ['\u001b[31mred\u001b[0m'] }));
    expect(daemonStore.getState().colorPreviews.get('ec2:ab12')).toEqual(['\u001b[31mred\u001b[0m']);
    expect(result.current).toEqual(['\u001b[31mred\u001b[0m']);
  });
  it('the local color preview is stored qualified too', () => {
    const { client, local } = setup();
    const { result } = renderHook(() => useColorPreview(client, 'local:s1'));
    act(() => local.emit({ type: 'session.preview.color', id: 's1', lines: ['x'] }));
    expect(daemonStore.getState().colorPreviews.get('local:s1')).toEqual(['x']);
    expect(result.current).toEqual(['x']);
  });
  it('subscribes again after a new snapshot', () => {
    const { client, local } = setup();
    renderHook(() => useColorPreview(client, 'local:s1'));
    expect(subs(local)).toHaveLength(1);
    act(() => local.emit(snap()));
    expect(subs(local)).toHaveLength(2);
    expect(subs(local)[1]).toEqual({ type: 'session.preview.subscribe', id: 's1', color: true });
  });
  it('a daemon without colorPreview gets no subscribe and nothing is returned', () => {
    const { client, e } = setup({ local: true, ec2: false, build: true });
    const { result, unmount } = renderHook(() => useColorPreview(client, 'ec2:ab12'));
    act(() => e.emit({ type: 'session.preview.color', id: 'ab12', lines: ['x'] }));
    expect(subs(e)).toEqual([]);
    expect(result.current).toBeUndefined();
    unmount();
    expect(subs(e)).toEqual([]);
  });
  it('moving to another machine unfollows on the first, on the same connection', () => {
    const { client, e, b } = setup();
    const { rerender } = renderHook(({ id }) => useColorPreview(client, id), { initialProps: { id: 'ec2:ab12' as string | null } });
    rerender({ id: 'build:cd34' });
    expect(subs(e)).toEqual([{ type: 'session.preview.subscribe', id: 'ab12', color: true }, { type: 'session.preview.subscribe', id: null, color: true }]);
    expect(subs(b)).toEqual([{ type: 'session.preview.subscribe', id: 'cd34', color: true }]);
  });
  it('another session of the same machine sends only the new id; no session unfollows', () => {
    const { client, e } = setup();
    const { rerender } = renderHook(({ id }) => useColorPreview(client, id), { initialProps: { id: 'ec2:ab12' as string | null } });
    rerender({ id: 'ec2:ef56' });
    expect(subs(e).map(m => (m as { id: string | null }).id)).toEqual(['ab12', 'ef56']);
    rerender({ id: null });
    expect(subs(e).map(m => (m as { id: string | null }).id)).toEqual(['ab12', 'ef56', null]);
  });
  it('a removed session and a new snapshot purge the stored lines', () => {
    const { client, e } = setup();
    renderHook(() => useColorPreview(client, 'ec2:s1'));
    act(() => e.emit({ type: 'session.preview.color', id: 's1', lines: ['x'] }));
    expect(daemonStore.getState().colorPreviews.has('ec2:s1')).toBe(true);
    act(() => e.emit({ type: 'session.removed', id: 's1' }));
    expect(daemonStore.getState().colorPreviews.has('ec2:s1')).toBe(false);
    act(() => e.emit({ type: 'session.preview.color', id: 'gone', lines: ['y'] }));
    act(() => e.emit(snap('ec2')));
    expect(daemonStore.getState().colorPreviews.has('ec2:gone')).toBe(false);
  });
});
