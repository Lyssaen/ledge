import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';

// Native Windows mode (spec 2026-11-03 §4.2.4): the shell says the mode and the port at boot; the page connects there
// and opens on a plain overview instead of the Atelier.
const shell = vi.hoisted(() => ({ info: null as null | { mode: 'native' | 'wsl'; port: number } }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), nativeInfo: async () => shell.info }));

import { features, isNative, loadNativeInfo, nativeInfo } from '../src/native/mode';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); shell.info = null; });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); shell.info = null; await loadNativeInfo(); });

describe('native mode', () => {
  it('features: everything in WSL mode, nothing outside the acceptance bar in native mode', () => {
    expect(Object.values(features(false)).every(Boolean)).toBe(true);
    expect(Object.values(features(true)).some(Boolean)).toBe(false);
    expect(Object.keys(features(true)).sort()).toEqual(['atelier', 'broadcast', 'captures', 'chat', 'daemonUpdates', 'documents', 'island', 'mobile', 'shells', 'tasks']);
  });

  it('outside Tauri the mode is WSL on 47831', async () => {
    expect(await loadNativeInfo()).toEqual({ mode: 'wsl', port: 47831 });
    expect(isNative()).toBe(false);
  });

  it('takes the mode and the port the shell gives', async () => {
    shell.info = { mode: 'native', port: 27832 };
    expect(await loadNativeInfo()).toEqual({ mode: 'native', port: 27832 });
    expect(nativeInfo()).toEqual({ mode: 'native', port: 27832 });
    expect(isNative()).toBe(true);
  });

  it('the local client connects to the port the shell gives', async () => {
    shell.info = { mode: 'native', port: 27832 };
    await loadNativeInfo();
    const urls: string[] = [];
    class Spy { onopen = null; onmessage = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 0; constructor(url: string) { urls.push(url); setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }
    const client = createDesktopFleet({ WebSocketImpl: Spy });
    client.connect();
    await waitFor(() => expect(urls[0]).toBe('ws://127.0.0.1:27832'));
    client.close();
  });

  it('native mode starts on the overview and shows the native overview, not the Atelier', async () => {
    shell.info = { mode: 'native', port: 27832 };
    await loadNativeInfo();
    const d = await createMockDaemon(); daemons.push(d); d.machines([{ id: 'local', label: 'Local' }]);
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    const overview = screen.getByRole('region', { name: 'Sessions' });
    expect(within(overview).getByRole('button', { name: 'Launch a session' })).toBeVisible();
    expect(document.querySelector('.atelier-floor')).toBeNull();
  });

  it('WSL mode still opens on the Ledge home', async () => {
    await loadNativeInfo();
    const d = await createMockDaemon(); daemons.push(d); d.machines([{ id: 'local', label: 'Local' }]);
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    expect(screen.queryByRole('region', { name: 'Sessions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Launch a session' })).toBeNull();
  });
});
