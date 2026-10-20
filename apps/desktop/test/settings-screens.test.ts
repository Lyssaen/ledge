import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCKUP_SCREENS, readScreens, screenHere, screenValue } from '../src/settings/screens';

const at = (x: number, name: string | null, width: number, height: number, scaleFactor = 1) => ({ name, position: { x, y: 0 }, size: { width, height }, scaleFactor });
const native = vi.hoisted(() => ({ all: [] as unknown[], main: null as unknown }));
vi.mock('@tauri-apps/api/window', () => ({ availableMonitors: async () => native.all, primaryMonitor: async () => native.main }));

describe('the screens Settings › Notch offers', () => {
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

  it('reads every monitor, three too: the primary first, the others by their OS name and number', async () => {
    expect(await readScreens()).toBeNull(); // the browser: the mockup's stay
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    native.all = [at(0, '\\\\.\\DISPLAY1', 1920, 1080), at(1920, '\\\\.\\DISPLAY2', 3840, 2160, 2), at(5760, null, 1920, 1200)];
    native.main = native.all[1];
    expect(await readScreens()).toEqual([
      { id: 'primary', n: 2, primary: true, width: 3840, height: 2160, logicalHeight: 1080 },
      { id: '\\\\.\\DISPLAY1', n: 1, primary: false, width: 1920, height: 1080, logicalHeight: 1080 },
      { id: '#2', n: 3, primary: false, width: 1920, height: 1200, logicalHeight: 1200 }
    ]);
  });

  it('reads an older « second » as the first other screen, keeps an unplugged choice, and sits on the primary meanwhile', () => {
    expect(screenValue('second', MOCKUP_SCREENS)).toBe('#1');
    expect(screenValue('second', MOCKUP_SCREENS.slice(0, 1))).toBe('primary');
    expect(screenValue('\\\\.\\DISPLAY3', MOCKUP_SCREENS)).toBe('\\\\.\\DISPLAY3');
    expect(screenHere('#1', MOCKUP_SCREENS)).toBe(MOCKUP_SCREENS[1]);
    expect(screenHere('\\\\.\\DISPLAY3', MOCKUP_SCREENS)).toBe(MOCKUP_SCREENS[0]);
  });
});
