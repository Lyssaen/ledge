/**
 * Everything the web app asks of the native shell goes through here. In a plain browser (dev, tests) every call is a
 * no-op or a DOM fallback; under Tauri it talks to the commands and events in `src-tauri/src/main.rs`:
 *   set_frame { top, width, height }   window to (0, top) on the primary monitor's work area, sized width x height
 *   set_hot_zones { zones: Band[] }    edge bands the native cursor poller watches (empty: none)
 *   focus_overlay                      remember the foreground window, then show and focus the overlay window
 *   release_focus                      give the foreground back to the window remembered by focus_overlay
 *   focus_terminal { title }           bring the matching terminal window forward
 *   event `ledge://edge` { inside }    cursor entered / left the edge bands
 * Coordinates are logical px from the top of the primary monitor's work area.
 */
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const inTauri = isTauri;

export interface Frame { top: number; w: number; h: number }
export interface Band { top: number; h: number }
export const EDGE_EVENT = 'ledge://edge';

/** The primary monitor's work-area height in logical px (the space the surface lays itself out in). */
export async function screenHeight(): Promise<number> {
  if (!inTauri()) return window.innerHeight;
  const { primaryMonitor } = await import('@tauri-apps/api/window');
  const m = await primaryMonitor();
  if (!m) return window.innerHeight;
  const h = m.workArea?.size.height ?? m.size.height;
  return Math.round(h / m.scaleFactor);
}

// One shared import: the commands are loaded once, not once per call.
let core: Promise<typeof import('@tauri-apps/api/core')> | null = null;
const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  core ??= import('@tauri-apps/api/core');
  return (await core).invoke<T>(cmd, args);
};

// Frames are sent one after the other: async commands may otherwise land out of order and leave the window at an
// older frame than the page offset, which is committed with each request.
let lastFrame = '';
let frameChain: Promise<unknown> = Promise.resolve();
/** Moves and sizes the native window. Resolves true once the shell applied it (false in the browser or on failure). */
export function setFrame(f: Frame): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  const key = `${f.top}:${f.w}:${f.h}`;
  if (key === lastFrame) return frameChain.then(() => lastFrame === key);
  lastFrame = key;
  const run = frameChain.then(() => invoke('set_frame', { top: f.top, width: f.w, height: f.h })).then(() => true, () => { if (lastFrame === key) lastFrame = ''; return false; });
  frameChain = run;
  return run;
}

let lastZones = '';
/** Reports the edge bands that should open the surface; an empty list disarms the native poller. */
export function setHotZones(zones: Band[]): void {
  if (!inTauri()) return;
  const key = JSON.stringify(zones); if (key === lastZones) return; lastZones = key;
  invoke('set_hot_zones', { zones }).catch(() => { if (lastZones === key) lastZones = ''; });
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

export async function focusTerminal(title: string): Promise<void> {
  if (!inTauri()) return;
  await invoke('focus_terminal', { title }).catch(() => {});
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
