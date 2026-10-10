/**
 * Everything the web app asks of the native shell goes through here. In a plain browser (dev, tests) every call is a
 * no-op or a DOM fallback; under Tauri it talks to the commands and events in `src-tauri/src/main.rs`:
 *   set_frame { top, width, height }   window to (0, top) on the chosen monitor's work area, sized width x height
 *   set_hot_zones { zones: Band[] }    edge bands the native cursor poller watches (empty: none)
 *   list_monitors                      every monitor (logical sizes, work-area height, which one is the primary)
 *   set_monitor { id | null }          the Screen setting: the overlay moves to that monitor at once (null: primary)
 *   focus_overlay                      remember the foreground window, then show and focus the overlay window
 *   release_focus                      give the foreground back to the window remembered by focus_overlay
 *   focus_terminal { title }           bring the matching terminal window forward (true when found)
 *   open_terminal { title, command }   open a Windows Terminal tab running `command` in WSL (true once spawned)
 *   event `ledge://edge` { inside }    cursor entered / left the edge bands
 * Coordinates sent to the shell are logical px from the top of the chosen monitor's work area ("monitor px").
 * The page is never zoomed (each layer applies its own UI scale), so its CSS px are monitor px; `setFrame` and
 * `setHotZones` still take an optional `zoom` (one CSS px = `zoom` monitor px) and round frames outward here. The shell
 * itself never knows about any zoom.
 */
import { resolveMonitor, type MonitorInfo } from '../monitor';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const inTauri = isTauri;

export interface Frame { top: number; w: number; h: number }
export interface Band { top: number; h: number }
export const EDGE_EVENT = 'ledge://edge';

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

/** The monitors the Screen setting can choose from. In the browser: the viewport, as the one primary monitor. */
export async function listMonitors(): Promise<MonitorInfo[]> {
  if (!inTauri()) return [{ id: 'primary', name: null, width: window.innerWidth, height: window.innerHeight, workH: window.innerHeight, primary: true }];
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
  const top = Math.floor(f.top * zoom);
  return { top, w: Math.ceil(f.w * zoom), h: Math.max(1, Math.ceil((f.top + f.h) * zoom) - top) };
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
  const key = `${m.top}:${m.w}:${m.h}`;
  if (key === lastFrame) return frameChain.then(() => lastFrame === key);
  lastFrame = key;
  const run = frameChain.then(() => invoke('set_frame', { top: m.top, width: m.w, height: m.h })).then(() => true, () => { if (lastFrame === key) lastFrame = ''; return false; });
  frameChain = run;
  return run;
}

let lastZones = '';
/** Reports the edge bands (CSS px, under the UI `zoom`) that should open the surface; an empty list disarms the
 *  native poller. */
export function setHotZones(zones: Band[], zoom = 1): void {
  if (!inTauri()) return;
  const bands = zones.map(z => ({ top: z.top * zoom, h: z.h * zoom }));
  const key = JSON.stringify(bands); if (key === lastZones) return; lastZones = key;
  invoke('set_hot_zones', { zones: bands }).catch(() => { if (lastZones === key) lastZones = ''; });
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

/** Whether Windows Terminal is the foreground window (the "only when the terminal is behind" sound rule). False outside Tauri. */
export async function foregroundIsTerminal(): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>('foreground_is_terminal').catch(() => false);
}

/** Native edge hover. In the browser it never fires: the DOM hot zones handle the edge there. */
export function onEdge(fn: (inside: boolean) => void): () => void {
  if (!inTauri()) return () => {};
  let off = () => {}; let disposed = false;
  import('@tauri-apps/api/event').then(async ({ listen }) => {
    const un = await listen<{ inside: boolean }>(EDGE_EVENT, e => { if (!disposed) fn(e.payload.inside); });
    off = un;
    if (disposed) un();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

export function onShortcut(fn: () => void): () => void {
  if (!inTauri()) { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') fn(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }
  let off = () => {}; let disposed = false;
  import('@tauri-apps/plugin-global-shortcut').then(async ({ register, unregister }) => {
    await register('Ctrl+Alt+L', e => { if (e.state === 'Pressed') fn(); });
    off = () => { unregister('Ctrl+Alt+L').catch(() => {}); };
    if (disposed) off();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}
