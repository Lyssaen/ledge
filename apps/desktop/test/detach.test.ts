import { afterEach, expect, it, vi } from 'vitest';

const win = vi.hoisted(() => {
  const calls: string[] = [];
  const w = {
    calls, fullscreen: false, maximized: false,
    isFullscreen: vi.fn(async () => w.fullscreen),
    isMaximized: vi.fn(async () => w.maximized),
    setFullscreen: vi.fn(async (on: boolean) => { calls.push(`fullscreen ${on}`); w.fullscreen = on; }),
    unmaximize: vi.fn(async () => { calls.push('unmaximize'); w.maximized = false; }),
    maximize: vi.fn(async () => { calls.push('maximize'); w.maximized = true; }),
    close: vi.fn(async () => { calls.push('close'); })
  };
  return w;
});
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; win.calls.length = 0; win.fullscreen = false; win.maximized = false; vi.clearAllMocks(); });

it('closing the detached Atelier from full screen leaves it first, maximised again if it was (#41, #18)', async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const { setWindowFullscreen } = await import('../src/shell/fullscreen');
  const { closeAtelierWindow } = await import('../src/atelier/detach');
  win.maximized = true;
  await setWindowFullscreen(true);
  win.calls.length = 0;
  closeAtelierWindow();
  await vi.waitFor(() => expect(win.close).toHaveBeenCalled());
  expect(win.calls).toEqual(['fullscreen false', 'maximize', 'close']);
});

it('closing it out of full screen just closes it', async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const { closeAtelierWindow } = await import('../src/atelier/detach');
  closeAtelierWindow();
  await vi.waitFor(() => expect(win.close).toHaveBeenCalled());
  expect(win.calls).toEqual(['close']);
});
