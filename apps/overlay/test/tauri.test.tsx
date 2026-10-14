import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { frameOf, unionFrame, FRAME_PAD } from '../src/surface/frame';
import { SHOULDER_R } from '../src/surface/Shoulders';
import { LAUNCH_NOTICE_MS } from '../src/surface/Surface';

// The native side, stubbed: `invoke` records commands, `listen` keeps the handler so a test can emit a shell event,
// the global shortcut plugin keeps each handler by its accelerator (`shortcut` is Ctrl+Alt+L's).
const native = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
  shortcut: null as null | ((e: { state: string }) => void),
  shortcuts: new Map<string, (e: { state: string }) => void>(),
  monitor: null as null | { scaleFactor: number; size: { height: number; width: number }; workArea: { size: { height: number; width: number } } }
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => { native.listeners.set(name, cb); return () => { native.listeners.delete(name); native.unlisten(); }; })
}));
vi.mock('@tauri-apps/api/window', () => ({ primaryMonitor: vi.fn(async () => native.monitor) }));
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(async (k: string, cb: (e: { state: string }) => void) => { native.shortcuts.set(k, cb); if (k === 'Ctrl+Alt+L') native.shortcut = cb; }),
  unregister: vi.fn(async (k: string) => { native.shortcuts.delete(k); if (k === 'Ctrl+Alt+L') native.shortcut = null; })
}));

const enterTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
const leaveTauri = () => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; };
const calls = (cmd: string) => native.invoke.mock.calls.filter(c => c[0] === cmd).map(c => c[1]);
// Fresh module state (the bridge's dedupe keys) for every test.
const loadBridge = async () => { vi.resetModules(); return import('../src/tauri/bridge'); };

beforeEach(() => { native.invoke.mockClear(); native.invoke.mockImplementation(async () => undefined); native.listeners.clear(); native.unlisten.mockClear(); native.shortcut = null; native.shortcuts.clear(); });
afterEach(() => { leaveTauri(); vi.unstubAllEnvs(); });

describe('frameOf', () => {
  it('pads the surface for its shadow on the sides and below, never above the top edge, in whole px', () => {
    expect(frameOf({ left: 900, top: 0, w: 117, h: 38 }, [], { w: 1920, h: 1080 })).toEqual({ left: 900 - FRAME_PAD.left, top: 0, w: 117 + FRAME_PAD.left + FRAME_PAD.right, h: 38 + FRAME_PAD.bottom });
    expect(frameOf({ left: 900.4, top: 0, w: 117, h: 38 }, [{ left: 880.5, top: 44.5, w: 200.4, h: 30 }], { w: 1920, h: 1080 })).toEqual({ left: 864, top: 0, w: 233, h: 99 });
  });

  it('extends to the extras around the surface and stays inside the work area', () => {
    // The fillets either side widen the frame; a coachmark under the panel extends it down.
    expect(frameOf({ left: 770, top: 0, w: 380, h: 300 }, [{ left: 758, top: 0, w: 404, h: 12 }], { w: 1920, h: 1080 }).w).toBe(404 + FRAME_PAD.left + FRAME_PAD.right);
    const below = frameOf({ left: 770, top: 0, w: 380, h: 300 }, [{ left: 810, top: 308, w: 300, h: 128 }], { w: 1920, h: 1080 });
    expect(below.top + below.h).toBe(308 + 128 + FRAME_PAD.bottom);
    // Clamped to the work area on every side.
    expect(frameOf({ left: 4, top: 0, w: 1912, h: 1070 }, [], { w: 1920, h: 1080 })).toEqual({ left: 0, top: 0, w: 1920, h: 1080 });
  });

  it('the union holds both frames', () => {
    expect(unionFrame({ left: 900, top: 0, w: 149, h: 62 }, { left: 754, top: 0, w: 412, h: 500 })).toEqual({ left: 754, top: 0, w: 412, h: 500 });
    expect(unionFrame({ left: 100, top: 0, w: 50, h: 80 }, { left: 120, top: 10, w: 100, h: 30 })).toEqual({ left: 100, top: 0, w: 120, h: 80 });
  });
});

describe('bridge', () => {
  it('in the browser nothing reaches the shell', async () => {
    const b = await loadBridge();
    await expect(b.setFrame({ left: 0, top: 1, w: 2, h: 3 })).resolves.toBe(false);
    b.setOutsideWatch(true); await b.focusOverlay(); await b.releaseFocus();
    await expect(b.focusTerminal('Otto')).resolves.toBe(false);
    await expect(b.openTerminal('Otto', ['node', 'cli', 'attach', 'a'])).resolves.toBe(false);
    const fn = vi.fn(); b.onOutsideClick(fn)();
    await Promise.resolve();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
  });

  it('set_frame takes left, top, width and height, once per distinct frame and in call order', async () => {
    enterTauri(); const b = await loadBridge();
    const order: unknown[] = [];
    let release!: () => void;
    native.invoke.mockImplementationOnce(async (_c, a) => { await new Promise<void>(r => { release = r; }); order.push(a); });
    native.invoke.mockImplementation(async (_c, a) => { order.push(a); });
    const first = b.setFrame({ left: 900, top: 0, w: 149, h: 62 });
    const second = b.setFrame({ left: 754, top: 0, w: 412, h: 500 });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(order).toEqual([]); // the second waits for the first
    release();
    await expect(first).resolves.toBe(true); await expect(second).resolves.toBe(true);
    expect(order).toEqual([{ left: 900, top: 0, width: 149, height: 62 }, { left: 754, top: 0, width: 412, height: 500 }]);
    await b.setFrame({ left: 754, top: 0, w: 412, h: 500 });
    expect(calls('set_frame')).toHaveLength(2);
  });

  it('a failed set_frame resolves false and is retried next time', async () => {
    enterTauri(); const b = await loadBridge();
    native.invoke.mockRejectedValueOnce(new Error('no window'));
    await expect(b.setFrame({ left: 0, top: 1, w: 2, h: 3 })).resolves.toBe(false);
    await expect(b.setFrame({ left: 0, top: 1, w: 2, h: 3 })).resolves.toBe(true);
    expect(calls('set_frame')).toHaveLength(2);
  });

  it('the outside-click watch, overlay focus and terminal focus are commands', async () => {
    enterTauri(); const b = await loadBridge();
    b.setOutsideWatch(true); b.setOutsideWatch(true); b.setOutsideWatch(false);
    await b.focusOverlay(); await b.releaseFocus();
    native.invoke.mockImplementationOnce(async () => true);
    await expect(b.focusTerminal('Otto · harness-assistant')).resolves.toBe(true);
    await vi.waitFor(() => expect(calls('set_outside_watch')).toEqual([{ on: true }, { on: false }]));
    expect(calls('focus_overlay')).toEqual([undefined]);
    expect(calls('release_focus')).toEqual([undefined]);
    expect(calls('focus_terminal')).toEqual([{ title: 'Otto · harness-assistant' }]);
  });

  it('open_terminal takes the tab title and the WSL command; a refusal or a failure reads false', async () => {
    enterTauri(); const b = await loadBridge();
    native.invoke.mockImplementationOnce(async () => true);
    await expect(b.openTerminal('Juno · api-gateway', ['/usr/bin/node', '/opt/ledge/cli.js', 'attach', 'n1'])).resolves.toBe(true);
    expect(calls('open_terminal')).toEqual([{ title: 'Juno · api-gateway', command: ['/usr/bin/node', '/opt/ledge/cli.js', 'attach', 'n1'] }]);
    native.invoke.mockRejectedValueOnce(new Error('wt.exe not found'));
    await expect(b.openTerminal('x', ['y'])).resolves.toBe(false);
    native.invoke.mockRejectedValueOnce(new Error('no window'));
    await expect(b.focusTerminal('x')).resolves.toBe(false);
  });

  it('onOutsideClick forwards ledge://outside-click and unlistens on dispose', async () => {
    enterTauri(); const b = await loadBridge();
    const fn = vi.fn(); const off = b.onOutsideClick(fn);
    await vi.waitFor(() => expect(native.listeners.has('ledge://outside-click')).toBe(true));
    native.listeners.get('ledge://outside-click')!({ payload: null });
    expect(fn).toHaveBeenCalledOnce();
    off();
    expect(native.unlisten).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Alt+L and Ctrl+Alt+N are global shortcuts under Tauri and window keys in the browser', async () => {
    const browser = await loadBridge();
    const list = vi.fn(); const launch = vi.fn();
    const offL = browser.onShortcut(list); const offN = browser.onNewSessionShortcut(launch);
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true });
    expect(launch).toHaveBeenCalledOnce(); expect(list).toHaveBeenCalledOnce();
    offL(); offN();
    enterTauri(); const b = await loadBridge();
    const n = vi.fn(); const off = b.onNewSessionShortcut(n);
    await vi.waitFor(() => expect(native.shortcuts.has('Ctrl+Alt+N')).toBe(true));
    native.shortcuts.get('Ctrl+Alt+N')!({ state: 'Released' }); native.shortcuts.get('Ctrl+Alt+N')!({ state: 'Pressed' });
    expect(n).toHaveBeenCalledOnce();
    off();
    await vi.waitFor(() => expect(native.shortcuts.has('Ctrl+Alt+N')).toBe(false));
  });

  it('a zoomed frame is rounded outward to whole monitor px; frames go out in order', async () => {
    enterTauri(); const b = await loadBridge();
    expect(b.toMonitorFrame({ left: 10, top: 101, w: 45, h: 77 }, 1)).toEqual({ left: 10, top: 101, w: 45, h: 77 });
    // 101 * 1.25 = 126.25 -> 126; (101 + 77) * 1.25 = 222.5 -> 223; 10 * 1.25 = 12.5 -> 12; (10 + 45) * 1.25 = 68.75 -> 69.
    expect(b.toMonitorFrame({ left: 10, top: 101, w: 45, h: 77 }, 1.25)).toEqual({ left: 12, top: 126, w: 57, h: 97 });
    expect(b.toMonitorFrame({ left: 10.4, top: 0, w: 20.2, h: 10.2 }, 1.5)).toEqual({ left: 15, top: 0, w: 31, h: 16 });
    const order: string[] = [];
    native.invoke.mockImplementation(async (c: string) => { order.push(c); });
    await b.setFrame({ left: 0, top: 100, w: 44, h: 80 }, 2);
    await b.setFrame({ left: 0, top: 100, w: 44, h: 80 }, 1.5); // same CSS frame, new zoom: sent again
    await b.setFrame({ left: 0, top: 100, w: 44, h: 80 }, 1.5); // unchanged: not sent twice
    expect(calls('set_frame')).toEqual([{ left: 0, top: 200, width: 88, height: 160 }, { left: 0, top: 150, width: 66, height: 120 }]);
    expect(order).toEqual(['set_frame', 'set_frame']);
  });

  it('screenHeight is the primary work area in logical px', async () => {
    enterTauri(); const b = await loadBridge();
    native.monitor = { scaleFactor: 1.5, size: { height: 1620, width: 2880 }, workArea: { size: { height: 1548, width: 2760 } } };
    await expect(b.screenHeight()).resolves.toBe(1032);
    await expect(b.screenWidth()).resolves.toBe(1840);
  });

  const monitors = [
    { id: '\\\\.\\DISPLAY1', name: '\\\\.\\DISPLAY1', width: 1920, height: 1080, workH: 1032, primary: true },
    { id: '\\\\.\\DISPLAY2', name: '\\\\.\\DISPLAY2', width: 2560, height: 1440, workH: 1400, primary: false }
  ];

  it('screenHeight follows the Screen setting: the chosen monitor while listed, else the primary', async () => {
    enterTauri(); const b = await loadBridge();
    native.monitor = { scaleFactor: 1.5, size: { height: 1620, width: 2880 }, workArea: { size: { height: 1548, width: 2760 } } };
    native.invoke.mockImplementation(async cmd => (cmd === 'list_monitors' ? monitors : undefined));
    await expect(b.screenHeight(monitors[1]!.id)).resolves.toBe(1400);
    await expect(b.screenHeight('\\\\.\\DISPLAY3')).resolves.toBe(1032);
    await expect(b.screenHeight(null)).resolves.toBe(1032);
    await expect(b.screenWidth(monitors[1]!.id)).resolves.toBe(2560);
    expect(calls('list_monitors')).toHaveLength(3);
  });

  it('listMonitors and setMonitor go to the shell; the browser lists its viewport as the one primary screen', async () => {
    const browser = await loadBridge();
    await expect(browser.listMonitors()).resolves.toEqual([{ id: 'primary', name: null, width: window.innerWidth, height: window.innerHeight, workH: window.innerHeight, workW: window.innerWidth, primary: true }]);
    await browser.setMonitor('x');
    expect(native.invoke).not.toHaveBeenCalled();
    enterTauri(); const b = await loadBridge();
    native.invoke.mockImplementation(async cmd => (cmd === 'list_monitors' ? monitors : undefined));
    await expect(b.listMonitors()).resolves.toEqual(monitors);
    await b.setMonitor(monitors[1]!.id); await b.setMonitor(null);
    expect(calls('set_monitor')).toEqual([{ id: monitors[1]!.id }, { id: null }]);
    // A shell that fails to answer: an empty list, never a rejection.
    native.invoke.mockImplementation(async () => { throw new Error('no shell'); });
    await expect(b.listMonitors()).resolves.toEqual([]);
    await expect(b.setMonitor('x')).resolves.toBeUndefined();
  });

  it('setTrayLabels sends the Quit label to the shell; in the browser and on a failure it is a no-op', async () => {
    const browser = await loadBridge();
    await browser.setTrayLabels({ open: 'Open Ledge', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge' });
    expect(native.invoke).not.toHaveBeenCalled();
    enterTauri(); const b = await loadBridge();
    await b.setTrayLabels({ open: 'Ouvrir Ledge', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', quit: 'Quitter Ledge' });
    expect(calls('set_tray_labels')).toEqual([{ open: 'Ouvrir Ledge', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', quit: 'Quitter Ledge' }]);
    native.invoke.mockImplementation(async () => { throw new Error('no shell'); });
    await expect(b.setTrayLabels({ open: 'Open Ledge', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge' })).resolves.toBeUndefined();
  });

  it('launch at startup is read and set through the shell; null in the browser, from `tauri dev` and on a failure', async () => {
    const browser = await loadBridge();
    await expect(browser.getAutostart()).resolves.toBeNull();
    await expect(browser.setAutostart(true)).resolves.toBeNull();
    expect(native.invoke).not.toHaveBeenCalled();
    enterTauri(); const b = await loadBridge();
    native.invoke.mockImplementation(async (cmd: string) => (cmd === 'get_autostart' ? true : false));
    await expect(b.getAutostart()).resolves.toBe(true);
    await expect(b.setAutostart(false)).resolves.toBe(false);
    expect(calls('set_autostart')).toEqual([{ on: false }]);
    native.invoke.mockImplementation(async () => { throw new Error('no shell'); });
    await expect(b.getAutostart()).resolves.toBeNull();
    await expect(b.setAutostart(true)).resolves.toBeNull();
  });

  it('the hot zone goes to the shell once per distinct band; the foreground event reaches the page in both worlds', async () => {
    enterTauri();
    const b = await loadBridge();
    b.setHotZone(900, 117); b.setHotZone(900, 117); b.setHotZone(880, 157);
    await vi.waitFor(() => expect(calls('set_hot_zone')).toEqual([{ left: 900, width: 117 }, { left: 880, width: 157 }]));
    const seen: boolean[] = [];
    const off = b.onForegroundCovered(c => seen.push(c));
    await vi.waitFor(() => expect(native.listeners.has('ledge://foreground')).toBe(true));
    native.listeners.get('ledge://foreground')!({ payload: { covered: true } });
    expect(seen).toEqual([true]);
    off();
    leaveTauri();
    const b2 = await loadBridge();
    const seen2: boolean[] = [];
    const off2 = b2.onForegroundCovered(c => seen2.push(c));
    window.dispatchEvent(new CustomEvent('ledge:foreground', { detail: { covered: true } }));
    window.dispatchEvent(new CustomEvent('ledge:foreground', { detail: { covered: false } }));
    expect(seen2).toEqual([true, false]);
    off2();
    expect(calls('set_hot_zone')).toHaveLength(2);
  });
});

describe('<Surface> under Tauri', () => {
  let mock: Awaited<ReturnType<typeof createMockDaemon>>; let detach: () => void; let close: () => void;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const surface = () => document.querySelector('[data-surface]') as HTMLElement;
  const content = () => document.querySelector('[data-frame-content]') as HTMLElement | null;
  const lastFrame = () => calls('set_frame').at(-1) as { left: number; top: number; width: number; height: number };

  async function mount(opts: { tauri: boolean; handleScale?: number; panelScale?: number; screenH?: number; launcher?: string[]; onToggleDnd?: () => void }) {
    if (opts.tauri) enterTauri();
    vi.resetModules();
    const [{ Surface }, { createDaemonClient }, { attachClient, daemonStore }] = await Promise.all([
      import('../src/surface/Surface'), import('@ledge/client'), import('../src/daemon/store')
    ]);
    daemonStore.reset(); mock = await createMockDaemon();
    if (opts.launcher) mock.extras.launcher = opts.launcher;
    mock.sessions.set('a', fakeSession('a')); mock.sessions.set('b', fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' }));
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
    close = () => client.close();
    await sleep(100);
    render(<Surface screenH={opts.screenH ?? 1080} handleScale={opts.handleScale} panelScale={opts.panelScale} theme="dark" client={client} dnd={false} onToggleDnd={opts.onToggleDnd ?? (() => {})} />);
  }
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(async () => { detach(); close(); await mock.close(); vi.useRealTimers(); });

  it('a session launched with the terminal option opens a tab through the launcher when no window carries its title', async () => {
    await mount({ tauri: true, launcher: ['/usr/bin/node', '/opt/ledge/cli.js'] });
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    // Modules are reset for this mount, so the catalogue is back to French: the queries go by data attributes.
    const el = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
    fireEvent.click(el('[data-launch]'));
    fireEvent.change(el('[data-launch-cwd]'), { target: { value: '/w/api-gateway' } });
    expect(el<HTMLInputElement>('[data-layer="launch"] input[data-switch="openTab"]').checked).toBe(true);
    fireEvent.submit(el('[data-launch-form]'));
    await vi.waitFor(() => expect(mock.received.some(m => m.type === 'session.launch')).toBe(true));
    native.invoke.mockImplementation(async (cmd: string) => (cmd === 'focus_terminal' ? false : cmd === 'open_terminal' ? true : undefined));
    await act(async () => { mock.launched(fakeSession('n1', { name: 'Juno', project: 'api-gateway', title: 'Juno · api-gateway', state: 'starting' })); await sleep(50); });
    await vi.waitFor(() => expect(calls('open_terminal')).toEqual([{ title: 'Juno · api-gateway', command: ['/usr/bin/node', '/opt/ledge/cli.js', 'attach', 'n1'] }]));
    expect(calls('focus_terminal')).toEqual([{ title: 'Juno · api-gateway' }]);
    // The notice's action and the session card's terminal button do the same; a window found needs no new tab.
    native.invoke.mockImplementation(async (cmd: string) => (cmd === 'focus_terminal' ? true : undefined));
    fireEvent.click(el('[data-notice] button'));
    await vi.waitFor(() => expect(calls('focus_terminal')).toHaveLength(2));
    await sleep(20);
    expect(calls('open_terminal')).toHaveLength(1);
    // The notice adds its height to the list's (6 px of air + the box, 36 px when jsdom measures nothing) instead of making the rows scroll.
    const height = () => parseFloat(el('[data-surface]').style.height);
    const withNotice = height();
    await act(async () => { vi.advanceTimersByTime(LAUNCH_NOTICE_MS + 10); });
    expect(el('[data-notice]')).toBeNull();
    expect(withNotice - height()).toBe(42);
  });

  it('in the browser nothing goes to a shell', async () => {
    await mount({ tauri: false });
    expect(content()).toBeNull();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('sends the bounding frame (island plus fillets); the page is drawn in work-area coordinates, never shifted', async () => {
    await mount({ tauri: true });
    // Two quiet bots plus Ledge on a 1024 px wide jsdom viewport: 117 px wide at x 454, 38 px high on the top edge.
    expect(surface()).toHaveStyle({ left: '454px', top: '0px', width: '117px', height: '38px' });
    // Fillets of 12 px either side, 16 px of shadow left and right, 24 px below: (426, 0) 173 x 62.
    await waitFor(() => expect(lastFrame()).toEqual({ left: 454 - SHOULDER_R - FRAME_PAD.left, top: 0, width: 117 + 2 * SHOULDER_R + FRAME_PAD.left + FRAME_PAD.right, height: 38 + FRAME_PAD.bottom }));
    // The window covers the work area and only its region follows the frame: the page needs no offset wrapper.
    expect(content()).toBeNull();
  });

  it('a grow goes out as soon as the list opens, the fold back right after it, in call order and without waiting for the shell', async () => {
    const seen: number[] = [];
    const pending: Array<() => void> = [];
    const answer = () => act(async () => { while (pending.length) pending.shift()!(); await Promise.resolve(); });
    native.invoke.mockImplementation((cmd: string, a?: unknown) => {
      if (cmd !== 'set_frame') return Promise.resolve(undefined);
      seen.push((a as { left: number }).left);
      return new Promise<undefined>(r => pending.push(() => r(undefined)));
    });
    await mount({ tauri: true });
    const handleLeft = 454 - SHOULDER_R - FRAME_PAD.left;
    await waitFor(() => expect(seen.at(-1)).toBe(handleLeft));
    await answer();
    // Handle to list: the list is wider, so its frame starts further left and holds the island's; it goes out at once.
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    const listLeft = parseFloat(surface().style.left) - SHOULDER_R - FRAME_PAD.left;
    expect(listLeft).toBeLessThan(handleLeft);
    await waitFor(() => expect(seen.at(-1)).toBe(listLeft));
    expect(pending).toHaveLength(1); // the shell has not answered: the request did not wait for it
    await answer();
    // List to handle (no settle with VITE_LEDGE_MOTION=0): straight back, after the list frame's answer (frames are sequenced).
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    await answer();
    await waitFor(() => expect(seen.at(-1)).toBe(handleLeft));
  });

  it('an island at 2x on a 4K work area: the surface and the frame are the 512-unit ones doubled', async () => {
    // A 4K work area (2160 logical px), island 200 %: the island lays out in a 512 x 1080 unit screen and is drawn at 2x.
    await mount({ tauri: true, screenH: 2160, handleScale: 2, panelScale: 1 });
    expect(surface()).toHaveStyle({ left: '396px', top: '0px', width: '234px', height: '76px' });
    expect((document.querySelector('[data-zoom="handle"]') as HTMLElement).style.zoom).toBe('2');
    expect((document.querySelector('[data-panel]') as HTMLElement).style.zoom).toBe('1');
    const left = 396 - SHOULDER_R - FRAME_PAD.left;
    await waitFor(() => expect(lastFrame()).toEqual({ left, top: 0, width: 234 + 2 * SHOULDER_R + FRAME_PAD.left + FRAME_PAD.right, height: 76 + FRAME_PAD.bottom }));
    // The windows keep their own scale: the list opens at its base 380 px, centred on the real screen.
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    expect(surface()).toHaveStyle({ width: '380px', top: '0px' });
    const listLeft = parseFloat(surface().style.left);
    expect(Math.abs(listLeft + 190 - 512)).toBeLessThanOrEqual(1);
  });

  it('the native cursor event moves Ledge’s gaze outside the narrow webview, and null recentres it', async () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    await mount({ tauri: true });
    await waitFor(() => expect([...native.listeners.keys()]).toContain('ledge://cursor-near'));
    const face = document.querySelector('[data-resident] svg') as SVGSVGElement;
    // The mascot sits 23 px into the island (x 477), 19 px under the top edge; a cursor 60 px to its right is near.
    act(() => native.listeners.get('ledge://cursor-near')!({ payload: { x: 454 + 83, y: 19 } }));
    expect(face).toHaveAttribute('data-near', 'true');
    expect(face.style.getPropertyValue('--resident-gx')).not.toBe('0px');
    act(() => native.listeners.get('ledge://cursor-near')!({ payload: null }));
    expect(face).toHaveAttribute('data-near', 'false');
  });

  it('the Ledge tray opens the list, starts a new session, and toggles DND', async () => {
    const toggleDnd = vi.fn();
    await mount({ tauri: true, onToggleDnd: toggleDnd });
    await waitFor(() => expect(native.listeners.has('ledge://tray')).toBe(true));
    const tray = native.listeners.get('ledge://tray')!;
    await act(async () => tray({ payload: { action: 'open' } }));
    await waitFor(() => expect(surface()).toHaveAttribute('data-mode', 'list'));
    await act(async () => tray({ payload: { action: 'new' } }));
    await waitFor(() => expect(surface()).toHaveAttribute('data-mode', 'launch'));
    await act(async () => tray({ payload: { action: 'dnd' } }));
    expect(toggleDnd).toHaveBeenCalledOnce();
    expect(calls('focus_overlay').length).toBeGreaterThanOrEqual(2);
  });

  it('hovering the handle opens the list without taking focus; the outside-click watch is armed only while a panel shows', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(native.listeners.has('ledge://outside-click')).toBe(true));
    await waitFor(() => expect(calls('set_outside_watch').at(-1)).toEqual({ on: false }));
    fireEvent.mouseEnter(surface());
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveAttribute('data-mode', 'list');
    await waitFor(() => expect(calls('set_outside_watch').at(-1)).toEqual({ on: true }));
    expect(calls('focus_overlay')).toHaveLength(0); // a hover open never takes focus
    await act(async () => { native.listeners.get('ledge://outside-click')!({ payload: null }); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    await waitFor(() => expect(calls('set_outside_watch').at(-1)).toEqual({ on: false }));
    // The shell watches the top band over the island's span (the band's depth and overhang are its own).
    expect(calls('set_hot_zone').at(-1)).toEqual({ left: 454, width: 117 });
  });

  it('a press outside a keyboard-opened panel folds it without handing focus back over the window just clicked', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    await waitFor(() => expect(calls('focus_overlay')).toHaveLength(1));
    await act(async () => { native.listeners.get('ledge://outside-click')!({ payload: null }); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    await act(async () => { await sleep(20); });
    expect(calls('release_focus')).toHaveLength(0);
  });

  it('Ctrl+Alt+N opens the launch form with focus from anywhere, and a second press folds it', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(native.shortcuts.has('Ctrl+Alt+N')).toBe(true));
    await act(async () => { native.shortcuts.get('Ctrl+Alt+N')!({ state: 'Pressed' }); });
    expect(surface()).toHaveAttribute('data-mode', 'launch');
    await waitFor(() => expect(calls('focus_overlay')).toHaveLength(1));
    await act(async () => { native.shortcuts.get('Ctrl+Alt+N')!({ state: 'Pressed' }); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    await waitFor(() => expect(calls('release_focus')).toHaveLength(1));
  });

  it('a shortcut open focuses the overlay and its close releases it; asks do neither', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    expect(surface()).toHaveAttribute('data-mode', 'list');
    await waitFor(() => expect(calls('focus_overlay')).toHaveLength(1));
    expect(calls('release_focus')).toHaveLength(0);
    await act(async () => { native.shortcut!({ state: 'Released' }); native.shortcut!({ state: 'Pressed' }); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    await waitFor(() => expect(calls('release_focus')).toHaveLength(1)); // the keyboard close hands focus back
    await act(async () => { mock.upsert(fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    await act(async () => { await sleep(20); });
    expect(calls('focus_overlay')).toHaveLength(1);
    expect(calls('release_focus')).toHaveLength(1);
  });
});

describe('useNativeFrame', () => {
  beforeEach(() => { vi.useFakeTimers(); enterTauri(); });
  afterEach(() => { vi.useRealTimers(); });
  const log: string[] = [];
  async function probe(first: { left: number; top: number; w: number; h: number }, settleMs = 320) {
    vi.resetModules(); log.length = 0;
    const { useNativeFrame } = await import('../src/tauri/useNativeFrame');
    native.invoke.mockImplementation(async (cmd: string, a?: unknown) => { if (cmd === 'set_frame') log.push(JSON.stringify(a)); });
    function Probe({ f }: { f: { left: number; top: number; w: number; h: number } }) { useNativeFrame(f, settleMs); return null; }
    const r = render(<Probe f={first} />);
    return { rerender: (f: { left: number; top: number; w: number; h: number }) => r.rerender(<Probe f={f} />) };
  }
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const handle = { left: 100, top: 0, w: 44, h: 77 }, list = { left: 60, top: 0, w: 396, h: 500 };
  const HANDLE = '{"left":100,"top":0,"width":44,"height":77}', LIST = '{"left":60,"top":0,"width":396,"height":500}';

  it('the first placement and a grow go out at once: the window never moves, only its region changes', async () => {
    const p = await probe(handle);
    await tick(0);
    expect(log).toEqual([HANDLE]);
    // The list opens: laid out at a fallback size, then measured. Each pass sends its frame as soon as it lands; the
    // shell only changes the window region, which costs nothing and displaces nothing on screen.
    p.rerender({ left: 60, top: 0, w: 396, h: 480 });
    p.rerender(list);
    await tick(0);
    expect(log).toEqual([HANDLE, '{"left":60,"top":0,"width":396,"height":480}', LIST]);
  });

  it('a shrink holds the union through the settle time, then sends the final frame', async () => {
    const p = await probe(list);
    await tick(0);
    p.rerender(handle);
    await tick(0);
    expect(log).toEqual([LIST]); // the union of the list and the handle is the list frame: not resent
    await tick(319);
    expect(log).toEqual([LIST]); // the surface is still shrinking: the region keeps the whole animation visible
    await tick(1);
    expect(log).toEqual([LIST, HANDLE]);
  });

  it('a frame change during the settle re-plans against the frame the shell holds', async () => {
    const p = await probe(list);
    await tick(0);
    p.rerender(handle);
    await tick(100);
    p.rerender(list); // back to the list before the settle: the union (the list frame) already holds it
    await tick(400);
    expect(log).toEqual([LIST]); // the cancelled settle never shrank the region to the handle
  });

  it('with no settle time a shrink applies at once', async () => {
    const p = await probe(list, 0);
    await tick(0);
    p.rerender(handle);
    await tick(0);
    expect(log).toEqual([LIST, HANDLE]);
  });

  it('a partial overlap (wider but shorter) holds the union of both until the settle', async () => {
    const p = await probe({ left: 100, top: 0, w: 44, h: 200 });
    await tick(0);
    p.rerender({ left: 60, top: 0, w: 396, h: 100 });
    await tick(0);
    expect(log).toEqual(['{"left":100,"top":0,"width":44,"height":200}', '{"left":60,"top":0,"width":396,"height":200}']);
    await tick(320);
    expect(log.at(-1)).toBe('{"left":60,"top":0,"width":396,"height":100}');
  });
});

describe('openUrl', () => {
  it('goes through the shell in Tauri, a new tab in the browser, and never for a non-web url', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const browser = await loadBridge();
    browser.openUrl('https://example.com/x');
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener');
    enterTauri(); const b = await loadBridge();
    b.openUrl('https://example.com/y');
    await vi.waitFor(() => expect(calls('open_url')).toEqual([{ url: 'https://example.com/y' }]));
    b.openUrl('javascript:alert(1)');
    await new Promise(r => setTimeout(r, 20));
    expect(calls('open_url')).toHaveLength(1); expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});
