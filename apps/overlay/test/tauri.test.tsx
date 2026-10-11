import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { frameOf, unionFrame, FRAME_PAD } from '../src/surface/frame';

// The native side, stubbed: `invoke` records commands, `listen` keeps the handler so a test can emit the edge event,
// the global shortcut plugin keeps the Ctrl+Alt+L handler.
const native = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
  shortcut: null as null | ((e: { state: string }) => void),
  monitor: null as null | { scaleFactor: number; size: { height: number }; workArea: { size: { height: number } } }
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => { native.listeners.set(name, cb); return () => { native.listeners.delete(name); native.unlisten(); }; })
}));
vi.mock('@tauri-apps/api/window', () => ({ primaryMonitor: vi.fn(async () => native.monitor) }));
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(async (_k: string, cb: (e: { state: string }) => void) => { native.shortcut = cb; }),
  unregister: vi.fn(async () => { native.shortcut = null; })
}));

const enterTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
const leaveTauri = () => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; };
const calls = (cmd: string) => native.invoke.mock.calls.filter(c => c[0] === cmd).map(c => c[1]);
// Fresh module state (the bridge's dedupe keys) for every test.
const loadBridge = async () => { vi.resetModules(); return import('../src/tauri/bridge'); };

beforeEach(() => { native.invoke.mockClear(); native.invoke.mockImplementation(async () => undefined); native.listeners.clear(); native.unlisten.mockClear(); native.shortcut = null; });
afterEach(leaveTauri);

describe('frameOf', () => {
  it('pads the surface for its shadow, from the left screen edge, in whole px', () => {
    expect(frameOf({ top: 518, w: 28, h: 45 }, [], 1080)).toEqual({ top: 518 - FRAME_PAD.top, w: 28 + FRAME_PAD.right, h: 45 + FRAME_PAD.top + FRAME_PAD.bottom });
    expect(frameOf({ top: 100, w: 28, h: 40 }, [{ left: 36, top: 110.5, w: 200.4, h: 30 }], 1080)).toEqual({ top: 92, w: 253, h: 73 });
  });

  it('extends to the extras beside the surface and stays inside the work area', () => {
    // A wide tooltip beside the handle widens the frame; it does not move the top.
    expect(frameOf({ top: 500, w: 28, h: 60 }, [{ left: 36, top: 515, w: 420, h: 30 }], 1080).w).toBe(36 + 420 + FRAME_PAD.right);
    // A coachmark below the list extends the frame down; one above it extends it up.
    const below = frameOf({ top: 300, w: 380, h: 200 }, [{ left: 44, top: 460, w: 300, h: 136 }], 1080);
    expect(below.top + below.h).toBe(460 + 136 + FRAME_PAD.bottom);
    expect(frameOf({ top: 300, w: 380, h: 200 }, [{ left: 44, top: 200, w: 300, h: 136 }], 1080).top).toBe(200 - FRAME_PAD.top);
    // Clamped to the work area.
    expect(frameOf({ top: 2, w: 380, h: 1070 }, [], 1080)).toEqual({ top: 0, w: 396, h: 1080 });
  });

  it('the union holds both frames', () => {
    expect(unionFrame({ top: 100, w: 44, h: 80 }, { top: 300, w: 396, h: 500 })).toEqual({ top: 100, w: 396, h: 700 });
  });
});

describe('bridge', () => {
  it('in the browser nothing reaches the shell', async () => {
    const b = await loadBridge();
    await expect(b.setFrame({ top: 1, w: 2, h: 3 })).resolves.toBe(false);
    b.setHotZones([{ top: 40, h: 100 }]); await b.focusOverlay(); await b.releaseFocus();
    await expect(b.focusTerminal('Otto')).resolves.toBe(false);
    await expect(b.openTerminal('Otto', ['node', 'cli', 'attach', 'a'])).resolves.toBe(false);
    const fn = vi.fn(); b.onEdge(fn)();
    await Promise.resolve();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
  });

  it('set_frame takes top, width and height, once per distinct frame and in call order', async () => {
    enterTauri(); const b = await loadBridge();
    const order: unknown[] = [];
    let release!: () => void;
    native.invoke.mockImplementationOnce(async (_c, a) => { await new Promise<void>(r => { release = r; }); order.push(a); });
    native.invoke.mockImplementation(async (_c, a) => { order.push(a); });
    const first = b.setFrame({ top: 510, w: 44, h: 77 });
    const second = b.setFrame({ top: 300, w: 396, h: 500 });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(order).toEqual([]); // the second waits for the first
    release();
    await expect(first).resolves.toBe(true); await expect(second).resolves.toBe(true);
    expect(order).toEqual([{ top: 510, width: 44, height: 77 }, { top: 300, width: 396, height: 500 }]);
    await b.setFrame({ top: 300, w: 396, h: 500 });
    expect(calls('set_frame')).toHaveLength(2);
  });

  it('a failed set_frame resolves false and is retried next time', async () => {
    enterTauri(); const b = await loadBridge();
    native.invoke.mockRejectedValueOnce(new Error('no window'));
    await expect(b.setFrame({ top: 1, w: 2, h: 3 })).resolves.toBe(false);
    await expect(b.setFrame({ top: 1, w: 2, h: 3 })).resolves.toBe(true);
    expect(calls('set_frame')).toHaveLength(2);
  });

  it('hot zones, overlay focus and terminal focus are commands', async () => {
    enterTauri(); const b = await loadBridge();
    b.setHotZones([{ top: 40, h: 100 }]); b.setHotZones([{ top: 40, h: 100 }]); b.setHotZones([]);
    await b.focusOverlay(); await b.releaseFocus();
    native.invoke.mockImplementationOnce(async () => true);
    await expect(b.focusTerminal('Otto · harness-assistant')).resolves.toBe(true);
    await vi.waitFor(() => expect(calls('set_hot_zones')).toEqual([{ zones: [{ top: 40, h: 100 }] }, { zones: [] }]));
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

  it('onEdge forwards the inside flag of ledge://edge and unlistens on dispose', async () => {
    enterTauri(); const b = await loadBridge();
    const fn = vi.fn(); const off = b.onEdge(fn);
    await vi.waitFor(() => expect(native.listeners.has('ledge://edge')).toBe(true));
    native.listeners.get('ledge://edge')!({ payload: { inside: true } });
    native.listeners.get('ledge://edge')!({ payload: { inside: false } });
    expect(fn.mock.calls).toEqual([[true], [false]]);
    off();
    expect(native.unlisten).toHaveBeenCalledTimes(1);
  });

  it('a zoomed frame is rounded outward to whole monitor px; bands are scaled; frames go out in order', async () => {
    enterTauri(); const b = await loadBridge();
    expect(b.toMonitorFrame({ top: 101, w: 45, h: 77 }, 1)).toEqual({ top: 101, w: 45, h: 77 });
    // 101 * 1.25 = 126.25 -> 126; (101 + 77) * 1.25 = 222.5 -> 223; 45 * 1.25 = 56.25 -> 57.
    expect(b.toMonitorFrame({ top: 101, w: 45, h: 77 }, 1.25)).toEqual({ top: 126, w: 57, h: 97 });
    const order: string[] = [];
    native.invoke.mockImplementation(async (c: string) => { order.push(c); });
    await b.setFrame({ top: 100, w: 44, h: 80 }, 2);
    await b.setFrame({ top: 100, w: 44, h: 80 }, 1.5); // same CSS frame, new zoom: sent again
    await b.setFrame({ top: 100, w: 44, h: 80 }, 1.5); // unchanged: not sent twice
    expect(calls('set_frame')).toEqual([{ top: 200, width: 88, height: 160 }, { top: 150, width: 66, height: 120 }]);
    expect(order).toEqual(['set_frame', 'set_frame']);
    b.setHotZones([{ top: 40, h: 100 }], 1.5);
    await vi.waitFor(() => expect(calls('set_hot_zones')).toEqual([{ zones: [{ top: 60, h: 150 }] }]));
  });

  it('screenHeight is the primary work area in logical px', async () => {
    enterTauri(); const b = await loadBridge();
    native.monitor = { scaleFactor: 1.5, size: { height: 1620 }, workArea: { size: { height: 1548 } } };
    await expect(b.screenHeight()).resolves.toBe(1032);
  });

  const monitors = [
    { id: '\\\\.\\DISPLAY1', name: '\\\\.\\DISPLAY1', width: 1920, height: 1080, workH: 1032, primary: true },
    { id: '\\\\.\\DISPLAY2', name: '\\\\.\\DISPLAY2', width: 2560, height: 1440, workH: 1400, primary: false }
  ];

  it('screenHeight follows the Screen setting: the chosen monitor while listed, else the primary', async () => {
    enterTauri(); const b = await loadBridge();
    native.monitor = { scaleFactor: 1.5, size: { height: 1620 }, workArea: { size: { height: 1548 } } };
    native.invoke.mockImplementation(async cmd => (cmd === 'list_monitors' ? monitors : undefined));
    await expect(b.screenHeight(monitors[1]!.id)).resolves.toBe(1400);
    await expect(b.screenHeight('\\\\.\\DISPLAY3')).resolves.toBe(1032);
    await expect(b.screenHeight(null)).resolves.toBe(1032);
    expect(calls('list_monitors')).toHaveLength(2);
  });

  it('listMonitors and setMonitor go to the shell; the browser lists its viewport as the one primary screen', async () => {
    const browser = await loadBridge();
    await expect(browser.listMonitors()).resolves.toEqual([{ id: 'primary', name: null, width: window.innerWidth, height: window.innerHeight, workH: window.innerHeight, primary: true }]);
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
    await browser.setTrayLabels('Quit Ledge');
    expect(native.invoke).not.toHaveBeenCalled();
    enterTauri(); const b = await loadBridge();
    await b.setTrayLabels('Quitter Ledge');
    expect(calls('set_tray_labels')).toEqual([{ quit: 'Quitter Ledge' }]);
    native.invoke.mockImplementation(async () => { throw new Error('no shell'); });
    await expect(b.setTrayLabels('Quit Ledge')).resolves.toBeUndefined();
  });
});

describe('<Surface> under Tauri', () => {
  let mock: Awaited<ReturnType<typeof createMockDaemon>>; let detach: () => void; let close: () => void;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const surface = () => document.querySelector('[data-surface]') as HTMLElement;
  const content = () => document.querySelector('[data-frame-content]') as HTMLElement | null;
  const lastFrame = () => calls('set_frame').at(-1) as { top: number; width: number; height: number };
  const edge = (inside: boolean) => act(async () => { native.listeners.get('ledge://edge')!({ payload: { inside } }); });

  async function mount(opts: { tauri: boolean; handleScale?: number; panelScale?: number; screenH?: number; launcher?: string[] }) {
    if (opts.tauri) enterTauri();
    vi.resetModules();
    const [{ Surface }, { createDaemonClient }, { attachClient, daemonStore }] = await Promise.all([
      import('../src/surface/Surface'), import('../src/daemon/client'), import('../src/daemon/store')
    ]);
    daemonStore.reset(); mock = await createMockDaemon();
    if (opts.launcher) mock.extras.launcher = opts.launcher;
    mock.sessions.set('a', fakeSession('a')); mock.sessions.set('b', fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' }));
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
    close = () => client.close();
    await sleep(100);
    render(<Surface screenH={opts.screenH ?? 1080} handleScale={opts.handleScale} panelScale={opts.panelScale} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
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
  });

  it('in the browser the page is not offset and the DOM hot zones handle the edge', async () => {
    await mount({ tauri: false });
    expect(content()).toBeNull();
    expect(document.querySelectorAll('[data-hotzone]')).toHaveLength(2);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('sends the bounding frame and offsets the page by its top', async () => {
    await mount({ tauri: true });
    // Two quiet bots: the handle is 45 px tall at 518 on a 1080 px work area.
    expect(surface()).toHaveStyle({ top: '518px', width: '28px', height: '45px' });
    await waitFor(() => expect(lastFrame()).toEqual({ top: 518 - FRAME_PAD.top, width: 28 + FRAME_PAD.right, height: 45 + FRAME_PAD.top + FRAME_PAD.bottom }));
    await waitFor(() => expect(content()).toHaveStyle({ top: `-${518 - FRAME_PAD.top}px` }));
    // No DOM hot zones: they would lie outside the window.
    expect(document.querySelectorAll('[data-hotzone]')).toHaveLength(0);
  });

  it('the page offset is committed with the set_frame request, after the painted frame that starts the transition, never after the shell answers', async () => {
    // The shell answers only when the test says so, and every request records the offset the page already shows when
    // it goes out.
    const seen: Array<{ top: number; offset: string | undefined }> = [];
    const pending: Array<() => void> = [];
    const answer = () => act(async () => { while (pending.length) pending.shift()!(); await Promise.resolve(); });
    native.invoke.mockImplementation((cmd: string, a?: unknown) => {
      if (cmd !== 'set_frame') return Promise.resolve(undefined);
      seen.push({ top: (a as { top: number }).top, offset: content()?.style.top });
      return new Promise<undefined>(r => pending.push(() => r(undefined)));
    });
    await mount({ tauri: true });
    const handleTop = 518 - FRAME_PAD.top;
    await waitFor(() => expect(seen.at(-1)).toEqual({ top: handleTop, offset: `-${handleTop}px` }));
    expect(content()).toHaveStyle({ top: `-${handleTop}px` }); // still unanswered
    await answer();
    // Handle to list: the list frame holds the handle frame, so it applies as soon as the first frame of the
    // transition is painted. In the pass that opened the list the page still shows the handle's offset.
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    const listTop = parseFloat(surface().style.top) - FRAME_PAD.top;
    expect(listTop).toBeLessThan(handleTop);
    expect(content()).toHaveStyle({ top: `-${handleTop}px` });
    expect(seen.at(-1)!.top).toBe(handleTop);
    await waitFor(() => expect(seen.at(-1)).toEqual({ top: listTop, offset: `-${listTop}px` }));
    expect(content()).toHaveStyle({ top: `-${listTop}px` }); // committed with the request, the shell has not answered
    await answer();
    // List to handle (no settle with VITE_LEDGE_MOTION=0): straight back after the next painted frame, offset first.
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    await waitFor(() => expect(content()).toHaveStyle({ top: `-${handleTop}px` }));
    await answer(); // the bridge sends frames one after the other: this one waited for the list frame's answer
    await waitFor(() => expect(seen.at(-1)).toEqual({ top: handleTop, offset: `-${handleTop}px` }));
  });

  it('a handle at 2x on a 4K work area: the surface, the frame and the bands are the 1080p ones doubled', async () => {
    // A 4K work area (2160 logical px), handle 200 %: the handle lays out in 1080 units and is drawn at 2x.
    await mount({ tauri: true, screenH: 2160, handleScale: 2, panelScale: 1 });
    expect(surface()).toHaveStyle({ top: `${2 * 518}px`, width: '56px', height: '90px' });
    expect((document.querySelector('[data-zoom="handle"]') as HTMLElement).style.zoom).toBe('2');
    expect((document.querySelector('[data-panel]') as HTMLElement).style.zoom).toBe('1');
    const top = 2 * 518 - FRAME_PAD.top;
    await waitFor(() => expect(lastFrame()).toEqual({ top, width: 56 + FRAME_PAD.right, height: 90 + FRAME_PAD.top + FRAME_PAD.bottom }));
    expect(content()).toHaveStyle({ top: `-${top}px` });
    await waitFor(() => expect(calls('set_hot_zones').at(-1)).toEqual({ zones: [{ top: 80, h: 2 * (518 - 6 - 40) }, { top: 2 * (518 + 45 + 6), h: 2 * (1080 - 40 - (518 + 45 + 6)) }] }));
    // The windows keep their own scale: the list opens at its base 380 px, centered on the real screen.
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); });
    expect(surface()).toHaveStyle({ width: '380px' });
    const listTop = parseFloat(surface().style.top), listH = parseFloat(surface().style.height);
    expect(Math.abs(listTop + listH / 2 - 1080)).toBeLessThanOrEqual(1);
  });

  it('the hovered bot tooltip widens the frame beside the handle', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(lastFrame().width).toBe(28 + FRAME_PAD.right));
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Pim/ }));
    await waitFor(() => expect(lastFrame().width).toBe(36 + 324 + FRAME_PAD.right));
  });

  it('the shell edge event drives edgeEnter/edgeLeave, and the hot zones are armed only on the bare handle', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(native.listeners.has('ledge://edge')).toBe(true));
    await waitFor(() => expect(calls('set_hot_zones').at(-1)).toEqual({ zones: [{ top: 40, h: 518 - 6 - 40 }, { top: 518 + 45 + 6, h: 1080 - 40 - (518 + 45 + 6) }] }));
    await edge(true); await edge(false);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveAttribute('data-mode', 'handle'); // left before the 180 ms dwell
    await edge(true);
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveAttribute('data-mode', 'list');
    await waitFor(() => expect(calls('set_hot_zones').at(-1)).toEqual({ zones: [] }));
    expect(calls('focus_overlay')).toHaveLength(0); // a hover open never takes focus
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
  async function probe(first: { top: number; w: number; h: number }, settleMs = 320) {
    vi.resetModules(); log.length = 0;
    const { useNativeFrame } = await import('../src/tauri/useNativeFrame');
    native.invoke.mockImplementation(async (cmd: string, a?: unknown) => {
      if (cmd === 'set_frame') log.push(`${JSON.stringify(a)} offset=${document.querySelector('[data-off]')?.textContent}`);
    });
    function Probe({ f }: { f: { top: number; w: number; h: number } }) { return <span data-off>{useNativeFrame(f, settleMs)}</span>; }
    const r = render(<Probe f={first} />);
    return { rerender: (f: { top: number; w: number; h: number }) => r.rerender(<Probe f={f} />), offset: () => document.querySelector('[data-off]')!.textContent };
  }
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const handle = { top: 510, w: 44, h: 77 }, list = { top: 292, w: 396, h: 500 };

  it('the first placement is committed in the render pass; a grow waits for the frame that starts the transition to be painted, then goes out once with its offset', async () => {
    const p = await probe(handle);
    expect(p.offset()).toBe('510'); // committed in the same pass, no shell answer needed
    await tick(0);
    expect(log).toEqual(['{"top":510,"width":44,"height":77} offset=510']);
    // The list opens: laid out at a fallback size, then measured, in the same pass. The first painted frame of the
    // transition shows no motion yet, so the page keeps the handle's offset through it: the shell then has a whole
    // frame to move the window before the page is presented at the new offset (a blank or displaced frame otherwise).
    p.rerender({ top: 300, w: 396, h: 480 });
    p.rerender(list);
    expect(p.offset()).toBe('510');
    await tick(15);
    expect(p.offset()).toBe('510');
    expect(log).toHaveLength(1);
    // Right after that frame: one request, for the last frame of the pass, its offset already committed.
    await tick(2);
    expect(p.offset()).toBe('292');
    expect(log).toEqual(['{"top":510,"width":44,"height":77} offset=510', '{"top":292,"width":396,"height":500} offset=292']);
  });

  it('a shrink holds the union through the settle time and one more painted frame, each step with its offset already committed', async () => {
    const p = await probe(list);
    expect(p.offset()).toBe('292');
    await tick(0);
    p.rerender(handle);
    expect(p.offset()).toBe('292'); // the union keeps the list's top
    await tick(17); // the union is committed after the next paint: it equals the list frame here, so the bridge does not resend it
    expect(p.offset()).toBe('292');
    expect(log).toHaveLength(1);
    await tick(336 - 17);
    expect(p.offset()).toBe('292'); // the settle time is up: the shrink waits for the transition's last frame to be painted
    await tick(17);
    expect(p.offset()).toBe('510');
    expect(log).toEqual(['{"top":292,"width":396,"height":500} offset=292', '{"top":510,"width":44,"height":77} offset=510']);
  });

  it('a frame change during the settle re-plans against the frame the shell holds', async () => {
    const p = await probe(list);
    await tick(0);
    p.rerender(handle);
    await tick(100);
    p.rerender(list); // back to the list before the settle: the union (the list frame) already holds it
    await tick(17);
    expect(p.offset()).toBe('292');
    await tick(400);
    expect(p.offset()).toBe('292'); // the cancelled settle never shrank the window to the handle
    expect(log).toEqual(['{"top":292,"width":396,"height":500} offset=292']);
  });

  it('with no settle time a shrink still waits for the painted frame, then applies at once', async () => {
    const p = await probe(list, 0);
    await tick(0);
    p.rerender(handle);
    expect(p.offset()).toBe('292');
    await tick(17);
    expect(p.offset()).toBe('510');
    expect(log).toEqual(['{"top":292,"width":396,"height":500} offset=292', '{"top":510,"width":44,"height":77} offset=510']);
  });

  it('a hidden document (no animation frames) still commits, after a short fallback', async () => {
    const p = await probe(handle);
    await tick(0);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      p.rerender(list);
      await tick(40);
      expect(p.offset()).toBe('510');
      await tick(20);
      expect(p.offset()).toBe('292');
    } finally { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); }
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
