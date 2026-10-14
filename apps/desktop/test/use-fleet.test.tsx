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
    expect(localStorage.getItem('ledge.machines')).toBeNull();   // the island's key is never read
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
});
