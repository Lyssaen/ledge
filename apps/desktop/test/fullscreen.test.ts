import { afterEach, expect, it, vi } from 'vitest';
import { onFullscreenLeft } from '../src/shell/fullscreen';

const win = vi.hoisted(() => ({ onResized: vi.fn(), isFullscreen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));
const inTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
const element = (value: Element | null) => Object.defineProperty(document, 'fullscreenElement', { value, configurable: true });
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; element(null); vi.clearAllMocks(); });

it('in a browser, calls back when the page leaves full screen, not when it enters', () => {
  const cb = vi.fn();
  const off = onFullscreenLeft(cb);
  element(document.body); document.dispatchEvent(new Event('fullscreenchange'));
  expect(cb).not.toHaveBeenCalled();
  element(null); document.dispatchEvent(new Event('fullscreenchange'));
  expect(cb).toHaveBeenCalledTimes(1);
  off(); document.dispatchEvent(new Event('fullscreenchange'));
  expect(cb).toHaveBeenCalledTimes(1);
});
it('in the app, asks the window after each resize, and unlistens', async () => {
  inTauri();
  let resized = () => {};
  const unlisten = vi.fn();
  win.onResized.mockImplementation(async (fn: () => void) => { resized = fn; return unlisten; });
  const cb = vi.fn();
  const off = onFullscreenLeft(cb);
  await vi.waitFor(() => expect(win.onResized).toHaveBeenCalled());
  win.isFullscreen.mockResolvedValueOnce(true); resized(); await new Promise(r => setTimeout(r, 0));
  win.isFullscreen.mockResolvedValueOnce(false); resized();
  await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  off();
  expect(unlisten).toHaveBeenCalled();
});

async function listen() {
  inTauri();
  let resized = () => {};
  win.onResized.mockImplementation(async (fn: () => void) => { resized = fn; return vi.fn(); });
  const cb = vi.fn();
  const off = onFullscreenLeft(cb);
  await vi.waitFor(() => expect(win.onResized).toHaveBeenCalled());
  return { cb, off, resize: () => resized() };
}
it('in the app, only a true-to-false change of the window counts, not an early resize reporting false', async () => {
  const { cb, resize } = await listen();
  for (const on of [false, false, true, false]) { win.isFullscreen.mockResolvedValueOnce(on); resize(); await new Promise(r => setTimeout(r, 0)); }
  expect(cb).toHaveBeenCalledTimes(1);
});
it('in the app, a stale answer arriving late is ignored', async () => {
  const { cb, resize } = await listen();
  let late!: (v: boolean) => void;
  win.isFullscreen.mockReturnValueOnce(new Promise<boolean>(r => { late = r; }));
  resize();
  win.isFullscreen.mockResolvedValueOnce(false); resize();
  await new Promise(r => setTimeout(r, 0));
  late(true);
  await new Promise(r => setTimeout(r, 0));
  expect(cb).not.toHaveBeenCalled();
  win.isFullscreen.mockResolvedValueOnce(true); resize(); await new Promise(r => setTimeout(r, 0));
  win.isFullscreen.mockResolvedValueOnce(false); resize(); await new Promise(r => setTimeout(r, 0));
  expect(cb).toHaveBeenCalledTimes(1);
});
