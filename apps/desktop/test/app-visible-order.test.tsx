import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';

// Wraps the real view state to record what App dispatches: the selection only ever reads the first id, so the order can be seen nowhere else.
const visibleCalls: string[][] = [];
vi.mock('../src/state/useViewState', async () => {
  const real = await vi.importActual<typeof import('../src/state/useViewState')>('../src/state/useViewState');
  return { useViewState: () => { const [state, dispatch] = real.useViewState(); return [state, (a: { type: string; ids?: string[] }) => { if (a.type === 'visible') visibleCalls.push(a.ids!); dispatch(a as never); }] as const; } };
});
const { App } = await import('../src/App');

describe('visible ids follow the active view', () => {
  it('room view by Jira story lists the ids in table order, not project order', async () => {
    visibleCalls.length = 0;
    const d = await createMockDaemon();
    // daemon order a, x, b: the team view groups by repo (a, b, x); the room groups by story (no key: a / K-1: x, b)
    d.upsert(fakeSession('a', { repoId: 'r/one', cwd: '/w/one' }));
    d.upsert(fakeSession('x', { repoId: 'r/two', cwd: '/w/two', branch: 'feat/K-1-x', startedAt: '2026-10-09T18:00:01.000Z' }));
    d.upsert(fakeSession('b', { repoId: 'r/one', cwd: '/w/one', branch: 'feat/K-1-b', startedAt: '2026-10-09T18:00:02.000Z' }));
    d.machines([{ id: 'local', label: 'Local' }]);
    localStorage.clear(); localStorage.setItem('desktop.view', JSON.stringify({ view: 'room', grouping: 'jira' }));
    const { unmount } = render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    await waitFor(() => expect(visibleCalls.at(-1)).toEqual(['local:a', 'local:x', 'local:b']));
    unmount(); await d.close();
  });
});
