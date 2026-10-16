// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet, useFleet } from '../src/fleet/useFleet';

describe('useFleet', () => {
  beforeEach(() => localStorage.clear());
  it('publishes the daemon sessions under desktop keys, local first, and follows the daemon machines list', async () => {
    const d = await createMockDaemon(); d.upsert(fakeSession('otto'));
    const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
    const { result, unmount } = renderHook(() => useFleet(client));
    await waitFor(() => expect(result.current.sessions.map(s => s.id)).toEqual(['local:otto']));
    expect(result.current.machines[0]).toMatchObject({ id: 'local', status: 'open' });
    expect(result.current.localDown).toBe(false);
    d.machines([{ id: 'local', label: 'Local' }]);
    await waitFor(() => expect(client.fleet!.machinesSource()).toBe('daemon'));
    unmount(); await d.close();
  });
  it('flags localDown only once local is unreachable, never while connecting', async () => {
    const d = await createMockDaemon(); const url = d.url; await d.close();   // nothing listens any more
    const client = createDesktopFleet({ url, WebSocketImpl: WebSocket });
    const { result, unmount } = renderHook(() => useFleet(client));
    expect(result.current.localDown).toBe(false);
    await waitFor(() => expect(result.current.machines[0]?.status).toBe('unreachable'), { timeout: 6000 });
    expect(result.current.localDown).toBe(true);
    unmount();
  });
  it('flags localDown when a reachable local daemon goes away', async () => {
    const d = await createMockDaemon();
    const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
    const { result, unmount } = renderHook(() => useFleet(client));
    expect(result.current.localDown).toBe(false);   // first connect still pending
    await waitFor(() => expect(result.current.machines[0]?.status).toBe('open'));
    expect(result.current.localDown).toBe(false);
    await d.close();
    await waitFor(() => expect(result.current.localDown).toBe(true), { timeout: 8000 });
    unmount();
  });
  it('shares one connection between consumers: last one out closes, a remount reconnects', async () => {
    const d = await createMockDaemon();
    const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
    const calls = { connect: 0, close: 0, attach: 0 };
    const connect = client.connect.bind(client), close = client.close.bind(client), onMessage = client.onMessage.bind(client);
    client.connect = () => { calls.connect++; connect(); };
    client.close = () => { calls.close++; close(); };
    client.onMessage = fn => { calls.attach++; return onMessage(fn); };
    const a = renderHook(() => useFleet(client)), b = renderHook(() => useFleet(client));
    await waitFor(() => expect(a.result.current.machines[0]?.status).toBe('open'));
    expect(calls).toEqual({ connect: 1, close: 0, attach: 1 });
    a.unmount();
    expect(calls.close).toBe(0);
    d.upsert(fakeSession('otto'));
    await waitFor(() => expect(b.result.current.sessions.map(s => s.id)).toEqual(['local:otto']));
    expect(b.result.current.machines[0]?.status).toBe('open');
    b.unmount();
    expect(calls).toEqual({ connect: 1, close: 1, attach: 1 });
    const c = renderHook(() => useFleet(client));
    expect(calls).toEqual({ connect: 2, close: 1, attach: 2 });
    await waitFor(() => expect(c.result.current.machines[0]?.status).toBe('open'));
    c.unmount(); await d.close();
  });
});
