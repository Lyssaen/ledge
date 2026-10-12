/**
 * Everything the web app asks of the native shell goes through here. In a plain browser (dev, tests) every call is a
 * no-op or a DOM fallback; under Tauri it talks to the commands and events in `src-tauri/src/main.rs`:
 *   set_frame { left, top, width, height }   window to (left, top) on the chosen monitor's work area, sized width x height
 *   set_hot_zone { left, width }       the island's x range (logical px): the cursor poller watches the top band around it
 *   set_outside_watch { on }           arm (or disarm) the native watch for a mouse press outside the window
 *   list_monitors                      every monitor (logical sizes, work-area height, which one is the primary)
 *   set_monitor { id | null }          the Screen setting: the overlay moves to that monitor at once (null: primary)
 *   focus_overlay                      remember the foreground window, then show and focus the overlay window
 *   release_focus                      give the foreground back to the window remembered by focus_overlay
 *   focus_terminal { title }           bring the matching terminal window forward (true when found)
 *   open_terminal { title, command }   open a Windows Terminal tab running `command` in WSL (true once spawned)
 *   open_url { url }                   open a web URL in the default browser (the webview never navigates)
 *   set_tray_labels { open, newSession, dnd, quit }  translated tray menu items
 *   get_autostart                      whether Ledge launches at login (null: not offered, a `tauri dev` build)
 *   set_autostart { on }               turn launch at login on or off; returns the state Windows now reports
 *   event `ledge://outside-click`      a mouse button went down outside the window while the watch was armed
 *   event `ledge://cursor-near` { x, y } | null    cursor in the top band around the island, in logical work-area coordinates
 *   event `ledge://foreground` { covered }   a maximised or full-screen window took (or left) the foreground on the island's monitor
 *   event `ledge://tray` { action }    tray menu action
 * Coordinates sent to the shell are logical px from the top of the chosen monitor's work area ("monitor px").
 * The page is never zoomed (each layer applies its own UI scale), so its CSS px are monitor px; `setFrame` still
 * takes an optional `zoom` (one CSS px = `zoom` monitor px) and round frames outward here. The shell
 * itself never knows about any zoom.
 */
import { resolveMonitor, type MonitorInfo } from '../monitor';
import { listen } from '@tauri-apps/api/event';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const inTauri = isTauri;

export interface Frame { left: number; top: number; w: number; h: number }
export const OUTSIDE_CLICK_EVENT = 'ledge://outside-click';
export const CURSOR_NEAR_EVENT = 'ledge://cursor-near';
export const TRAY_EVENT = 'ledge://tray';
export const FOREGROUND_EVENT = 'ledge://foreground';

/** The work-area height, in logical (monitor) px, of the monitor the Screen setting `choice` resolves to (`null`: the
 *  primary): the height the surface lays itself out in. */
export async function screenHeight(choice: string | null = null): Promise<number> {
  if (!inTauri()) return window.innerHeight;
  if (choice !== null) {
    const m = resolveMonitor(choice, await listMonitors());
    if (m) return m.workH;
  }
  const { primaryMonitor } = await import('@tauri-apps/api/window');
  const m = await primaryMonitor();
  if (!m) return window.innerHeight;
  const h = m.workArea?.size.height ?? m.size.height;
  return Math.round(h / m.scaleFactor);
}

/** Work-area width in logical monitor pixels, independent of the current overlay window. */
export async function screenWidth(choice: string | null = null): Promise<number> {
  if (!inTauri()) return window.innerWidth;
  if (choice !== null) {
    const m = resolveMonitor(choice, await listMonitors());
    if (m) return m.workW ?? m.width;
  }
  const { primaryMonitor } = await import('@tauri-apps/api/window');
  const m = await primaryMonitor();
  if (!m) return window.innerWidth;
  return Math.round((m.workArea?.size.width ?? m.size.width) / m.scaleFactor);
}

/** The monitors the Screen setting can choose from. In the browser: the viewport, as the one primary monitor. */
export async function listMonitors(): Promise<MonitorInfo[]> {
  if (!inTauri()) return [{ id: 'primary', name: null, width: window.innerWidth, height: window.innerHeight, workH: window.innerHeight, workW: window.innerWidth, primary: true }];
  try { return await invoke<MonitorInfo[]>('list_monitors'); } catch { return []; }
}

/** Applies the Screen setting: the shell moves the overlay to that monitor at once (`null`: the primary). */
export async function setMonitor(id: string | null): Promise<void> {
  if (!inTauri()) return;
  await invoke('set_monitor', { id }).catch(() => {});
}

// One shared import: the commands are loaded once, not once per call.
let core: Promise<typeof import('@tauri-apps/api/core')> | null = null;
const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  core ??= import('@tauri-apps/api/core');
  return (await core).invoke<T>(cmd, args);
};

/** A frame in CSS px to monitor px under `zoom`: the edges are rounded outward so the window always holds the drawing. */
export function toMonitorFrame(f: Frame, zoom = 1): Frame {
  if (zoom === 1) return f;
  const left = Math.floor(f.left * zoom), top = Math.floor(f.top * zoom);
  return { left, top, w: Math.max(1, Math.ceil((f.left + f.w) * zoom) - left), h: Math.max(1, Math.ceil((f.top + f.h) * zoom) - top) };
}

// Frames are sent one after the other: async commands may otherwise land out of order and leave the
// window at an older frame than the page offset, which is committed with each request.
let lastFrame = '';
let frameChain: Promise<unknown> = Promise.resolve();
/** Moves and sizes the native window to `f` (CSS px) under the UI `zoom`. Resolves true once the shell applied it
 *  (false in the browser or on failure). */
export function setFrame(f: Frame, zoom = 1): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  const m = toMonitorFrame(f, zoom);
  const key = `${m.left}:${m.top}:${m.w}:${m.h}`;
  if (key === lastFrame) return frameChain.then(() => lastFrame === key);
  lastFrame = key;
  const run = frameChain.then(() => invoke('set_frame', { left: m.left, top: m.top, width: m.w, height: m.h })).then(() => true, () => { if (lastFrame === key) lastFrame = ''; return false; });
  frameChain = run;
  return run;
}

let lastHot = '';
/** The island's x range in logical px: the shell's cursor poller watches the 10 px band along the top edge around it. */
export function setHotZone(left: number, width: number): void {
  if (!inTauri()) return;
  const key = `${left}:${width}`;
  if (key === lastHot) return;
  lastHot = key;
  invoke('set_hot_zone', { left, width }).catch(() => { if (lastHot === key) lastHot = ''; });
}

let lastWatch: boolean | null = null;
/** Arms the native watch for a press outside the window while a panel shows. The window never takes focus on a
 *  mouse open, so a click elsewhere gives it no blur to react to. */
export function setOutsideWatch(on: boolean): void {
  if (!inTauri() || on === lastWatch) return;
  lastWatch = on;
  invoke('set_outside_watch', { on }).catch(() => { if (lastWatch === on) lastWatch = null; });
}

/** Gives the overlay OS focus so single-letter keys reach it. Only for keyboard opens: asks never steal focus. */
export async function focusOverlay(): Promise<void> {
  if (!inTauri()) return;
  await invoke('focus_overlay').catch(() => {});
}

/** Hands OS focus back to the window that had it before `focusOverlay` (a keyboard-opened surface folding away). */
export async function releaseFocus(): Promise<void> {
  if (!inTauri()) return;
  await invoke('release_focus').catch(() => {});
}

/** Brings the terminal window whose title matches `title` forward; true when one was found (always false in the browser). */
export async function focusTerminal(title: string): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>('focus_terminal', { title }).catch(() => false);
}

/** Opens a new Windows Terminal tab titled `title` running `command` inside WSL (`wt.exe -w 0 new-tab --title <title>
 *  wsl.exe -- <command>`): the tab of a session the overlay launched itself. True once the tab was spawned. */
export async function openTerminal(title: string, command: string[]): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>('open_terminal', { title, command }).catch(() => false);
}

/** Opens a web URL in the default browser: through the shell in Tauri (the overlay's webview must never navigate
 *  away), a new tab in the browser. Anything but http(s) is ignored. */
export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri()) { void invoke('open_url', { url }).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener');
}

/** Relabels the tray menu in the overlay's language (the shell starts in French). */
export async function setTrayLabels(labels: { open: string; newSession: string; dnd: string; quit: string }): Promise<void> {
  if (!inTauri()) return;
  await invoke('set_tray_labels', labels).catch(() => {});
}

/** Whether Ledge launches at Windows login. `null` when it is not offered: in the browser and in a `tauri dev` build. */
export async function getAutostart(): Promise<boolean | null> {
  if (!inTauri()) return null;
  return invoke<boolean | null>('get_autostart').catch(() => null);
}

/** Turns launch at login on or off; resolves to the state Windows reports afterwards (`null`: not offered or failed). */
export async function setAutostart(on: boolean): Promise<boolean | null> {
  if (!inTauri()) return null;
  return invoke<boolean | null>('set_autostart', { on }).catch(() => null);
}

/** Whether Windows Terminal is the foreground window (the "only when the terminal is behind" sound rule). False outside Tauri. */
export async function foregroundIsTerminal(): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>('foreground_is_terminal').catch(() => false);
}

/** A press outside the window while the watch is armed. In the browser it never fires: the surface listens to the
 *  document's own pointer presses there. */
export function onOutsideClick(fn: () => void): () => void {
  if (!inTauri()) return () => {};
  let off = () => {}; let disposed = false;
  void listen(OUTSIDE_CLICK_EVENT, () => { if (!disposed) fn(); }).then(un => {
    off = un;
    if (disposed) un();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

/** The native window is only as wide as the island, so the shell reports cursor movement in the band along the top
 *  edge around it. Null means the cursor left that region. Browser previews use document pointer events instead. */
export function onCursorProximity(fn: (point: { x: number; y: number } | null) => void): () => void {
  if (!inTauri()) return () => {};
  let off = () => {}; let disposed = false;
  void listen<{ x: number; y: number } | null>(CURSOR_NEAR_EVENT, e => { if (!disposed) fn(e.payload); }).then(un => {
    off = un;
    if (disposed) un();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

/** Whether a maximised or full-screen window holds the foreground on the island's monitor (the discreet strip). In the
 *  browser, a `ledge:foreground` CustomEvent on `window` (dev previews and e2e) stands in for the shell. */
export function onForegroundCovered(fn: (covered: boolean) => void): () => void {
  if (!inTauri()) {
    const h = (e: Event) => fn(!!(e as CustomEvent<{ covered: boolean }>).detail?.covered);
    window.addEventListener('ledge:foreground', h);
    return () => window.removeEventListener('ledge:foreground', h);
  }
  let off = () => {}; let disposed = false;
  void listen<{ covered: boolean }>(FOREGROUND_EVENT, e => { if (!disposed) fn(e.payload.covered); }).then(un => {
    off = un;
    if (disposed) un();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

export type TrayAction = 'open' | 'new' | 'dnd';
export function onTrayAction(fn: (action: TrayAction) => void): () => void {
  if (!inTauri()) return () => {};
  let off = () => {}; let disposed = false;
  void listen<{ action: TrayAction }>(TRAY_EVENT, e => { if (!disposed) fn(e.payload.action); }).then(un => {
    off = un;
    if (disposed) un();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

let shortcutPlugin: Promise<typeof import('@tauri-apps/plugin-global-shortcut')> | null = null;
/** Ctrl+Alt+<key>: a global shortcut under Tauri, a window key binding in the browser. */
function globalShortcut(key: string, fn: () => void): () => void {
  if (!inTauri()) { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === key) fn(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }
  const accel = `Ctrl+Alt+${key.toUpperCase()}`;
  let off = () => {}; let disposed = false;
  shortcutPlugin ??= import('@tauri-apps/plugin-global-shortcut');
  shortcutPlugin.then(async ({ register, unregister }) => {
    await register(accel, e => { if (e.state === 'Pressed') fn(); });
    off = () => { unregister(accel).catch(() => {}); };
    if (disposed) off();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

/** Ctrl+Alt+L: open or fold the list from the keyboard. */
export const onShortcut = (fn: () => void) => globalShortcut('l', fn);
/** Ctrl+Alt+N: open or fold the new-session form from the keyboard. */
export const onNewSessionShortcut = (fn: () => void) => globalShortcut('n', fn);
