import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

// A developer machine may have a real daemon on 47831: the shell tests run against a socket that never opens.
class SilentSocket { onopen = null; onmessage = null; onclose = null; onerror = null; readyState = 0; constructor(public url: string) {} send() {} close() {} }
beforeAll(() => { vi.stubGlobal('WebSocket', SilentSocket); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('Desktop shell', () => {
  it('renders the team and room toggles in English', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meeting' })).toBeInTheDocument();
  });
});

const seed = (selected: string, extra: Record<string, unknown> = {}) => {
  localStorage.clear(); localStorage.setItem('desktop.selected', selected); localStorage.setItem('desktop.view', JSON.stringify({ view: 'team', ...extra }));
};
// Remote machines (`/ssh/<alias>`) stay "connecting" forever; the local one is the real mock daemon.
function RemoteSilent(this: unknown, url: string) { return url.includes('/ssh/') ? new SilentSocket(url) : new WebSocket(url); }

describe('visible-ids dispatch', () => {
  it('keeps the persisted selection until the fleet has delivered a first snapshot', async () => {
    seed('local:otto');
    render(<App />);
    await new Promise(r => setTimeout(r, 300));   // the socket never opens: sessions stay [] and no snapshot ever arrives
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
  });
  it('after the snapshot keeps a selection that is listed and dispatches ids in displayed order', async () => {
    const d = await createMockDaemon();
    d.upsert(fakeSession('a', { repoId: 'r/one', cwd: '/w/one' })); d.upsert(fakeSession('x', { repoId: 'r/two', cwd: '/w/two', startedAt: '2026-10-09T18:00:01.000Z' }));
    d.upsert(fakeSession('b', { repoId: 'r/one', cwd: '/w/one', startedAt: '2026-10-09T18:00:02.000Z' }));
    d.machines([{ id: 'local', label: 'Local' }]); seed('local:x');
    const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
    const { unmount } = render(<App client={client} />);
    await waitFor(() => expect(document.querySelectorAll('[data-session]')).toHaveLength(3));
    // displayed order: repo one (a, b) then repo two (x)
    expect([...document.querySelectorAll('[data-session]')].map(b => b.getAttribute('data-session'))).toEqual(['local:a', 'local:b', 'local:x']);
    expect(localStorage.getItem('desktop.selected')).toBe('local:x');
    // a selection that is gone falls to the first displayed id
    unmount(); seed('local:gone');
    const again = render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    await waitFor(() => expect(localStorage.getItem('desktop.selected')).toBe('local:a'));
    again.unmount(); await d.close();
  });
  it('does not prune while a remote machine has not delivered its first snapshot', async () => {
    const d = await createMockDaemon();
    d.upsert(fakeSession('a')); d.machines([{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }]);
    seed('devbox:nova');
    const client = createDesktopFleet({ url: d.url, WebSocketImpl: RemoteSilent as never });
    const { unmount } = render(<App client={client} />);
    await waitFor(() => expect(client.fleet!.machines().find(m => m.id === 'local')?.ready).toBe(true));
    await waitFor(() => expect(client.fleet!.machines()).toHaveLength(2));
    await new Promise(r => setTimeout(r, 300));
    expect(client.fleet!.machines().find(m => m.id === 'devbox')?.ready).toBe(false);
    expect(localStorage.getItem('desktop.selected')).toBe('devbox:nova');
    unmount(); await d.close();
  });
});
