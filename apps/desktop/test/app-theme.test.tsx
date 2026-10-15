import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { resetAppearanceForTests, setAccent, setTheme } from '../src/shell/theme';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
let daemon: Daemon | null = null;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = null; });

describe('the App owns the root theme and accent', () => {
  it('applies the stored theme, follows the switch and paints the accent', async () => {
    localStorage.clear(); resetAppearanceForTests();
    document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('style');
    localStorage.setItem('desktop.theme', 'light'); resetAppearanceForTests();
    daemon = await createMockDaemon();
    render(<App client={createDesktopFleet({ url: daemon.url, WebSocketImpl: WebSocket })} />);
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => setTheme('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => setAccent('#3366FF'));
    expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('');
    act(() => setAccent(null));
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });
});
