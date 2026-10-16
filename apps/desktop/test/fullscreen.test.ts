import { afterEach, expect, it, vi } from 'vitest';
import { onFullscreenLeft } from '../src/shell/fullscreen';

const win = vi.hoisted(() => ({ onResized: vi.fn(), isFullscreen: vi.fn(), setFullscreen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));
const inTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
const element = (value: Element | null) => Object.defineProperty(document, 'fullscreenElement', { value, configurable: true });
afterEach(() => { vi.resetModules(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; element(null); vi.clearAllMocks(); });

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
const tick = () => new Promise(r => setTimeout(r, 0));
async function listen() {
  vi.resetModules();
  const mod = await import('../src/shell/fullscreen');
  inTauri();
  let resized = () => {};
  const unlisten = vi.fn();
  win.onResized.mockImplementation(async (fn: () => void) => { resized = fn; return unlisten; });
  const cb = vi.fn();
  const off = mod.onFullscreenLeft(cb);
  await vi.waitFor(() => expect(win.onResized).toHaveBeenCalled());
  return { cb, off, unlisten, mod, resize: () => resized() };
}
const answer = (on: boolean) => win.isFullscreen.mockResolvedValueOnce(on);

it('in the app, asks the window after each resize (back to back), and unlistens', async () => {
  const { cb, off, unlisten, resize } = await listen();
  answer(true); resize(); answer(false); resize();
  await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  off();
  expect(unlisten).toHaveBeenCalled();
});
it('in the app, only a true-to-false change counts, not an early resize reporting false', async () => {
  const { cb, resize } = await listen();
  for (const on of [false, false, true, false]) { answer(on); resize(); await tick(); }
  expect(cb).toHaveBeenCalledTimes(1);
});
it('in the app, a stale answer arriving late never calls back by itself', async () => {
  const { cb, resize } = await listen();
  let late!: (v: boolean) => void;
  win.isFullscreen.mockReturnValueOnce(new Promise<boolean>(r => { late = r; }));
  resize(); answer(false); resize();
  await tick(); late(true); await tick();
  expect(cb).not.toHaveBeenCalled();
});
it('in the app, an exit burst whose earlier query says true and resolves late calls back once', async () => {
  const { cb, resize } = await listen();
  answer(true); resize(); await tick();
  let late!: (v: boolean) => void;
  win.isFullscreen.mockReturnValueOnce(new Promise<boolean>(r => { late = r; }));
  resize(); answer(false); resize();
  await tick(); late(true); await tick();
  expect(cb).toHaveBeenCalledTimes(1);
});
it('in the app, an enter burst [false, false, true] does not call back; a later exit does, once', async () => {
  const { cb, resize } = await listen();
  answer(false); resize(); answer(false); resize(); answer(true); resize();
  await tick();
  expect(cb).not.toHaveBeenCalled();
  answer(false); resize(); await tick();
  expect(cb).toHaveBeenCalledTimes(1);
});
it('in the app, a burst whose last answer is false still arms the edge from its true answer', async () => {
  const { cb, resize } = await listen();
  answer(true); resize(); answer(false); resize(); await tick();
  expect(cb).toHaveBeenCalledTimes(1);
});
it('in the app, a programmatic enter seeds the edge when the OS sends no resize after the flip', async () => {
  const { cb, mod, resize } = await listen();
  win.setFullscreen.mockResolvedValue(undefined);
  answer(true);
  await mod.setWindowFullscreen(true);
  expect(win.setFullscreen).toHaveBeenCalledWith(true);
  answer(false); resize(); await tick();
  expect(cb).toHaveBeenCalledTimes(1);
});
