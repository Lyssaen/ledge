/**
 * What Desktop asks of the native shell (same command and event names as the overlay's bridge). Outside Tauri every
 * call is a no-op or a DOM fallback.
 *   focus_terminal { title }           bring the matching terminal window forward (true when found)
 *   open_terminal { title, command }   open a Windows Terminal tab running `command` in WSL (true once spawned)
 *   open_url { url }                   open a web URL in the default browser
 *   daemon_token                       the per-user daemon token read from WSL: { kind: 'token', token } | { kind: 'absent' } | { kind: 'unavailable' }
 *   get_autostart / set_autostart { on }   launch at login (null: not offered)
 *   foreground_is_terminal             whether a terminal window is in front (sounds: « only when the terminal is behind »)
 *   set_tray_labels { open, newSession, dnd, quit }   tray entries in the app's language
 *   plugin notification                Windows toasts (spec §10)
 *   event `ledge://tray` { action }    tray menu action
 *   take_open_target / event `ledge://open`   what the island asked to open (`--open`), taken once
 *   pty_open { argv, cols, rows, onData, onExit } → id   a pseudo-terminal running argv; bytes stream back on onData, the exit code on onExit
 *   pty_write { id, data } / pty_resize { id, cols, rows } / pty_close { id }   ids start at 0: never test one for truthiness
 *   window minimize / toggleMaximize / close / isMaximized / onResized   the title bar's buttons (decorations are off)
 *   editors_available → { cursor, vscode, zed }    the editors installed on this PC (« Ouvrir dans… », lot 11)
 *   open_in_editor { editor, path, ssh? } → EditorOutcome   opens a WSL folder, or one on the machine Windows reaches as `ssh`
 */
import { listen } from '@tauri-apps/api/event';
import type { NativeShell, PtyEvents, PtyHandle } from '../term/backend';
import type { ShellsAvailable } from '../term/shells';
import { createTokenSource, type TokenRead, type TokenSource } from '@ledge/fleet';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const TRAY_EVENT = 'ledge://tray';
export const OPEN_EVENT = 'ledge://open';
export type TrayAction = 'open' | 'new' | 'dnd';

let core: Promise<typeof import('@tauri-apps/api/core')> | null = null;
const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  core ??= import('@tauri-apps/api/core');
  return (await core).invoke<T>(cmd, args);
};

/** The daemon token this window presents: one source per window, so the client and the notice share the reads. Inside Tauri
 *  it asks the shell (`daemon_token`); in a browser it is `VITE_LEDGE_TOKEN` when set, else none (tokenless, as dev, demo and e2e). */
let tokenSource: TokenSource | undefined;
export function daemonTokenSource(): TokenSource | undefined {
  if (tokenSource) return tokenSource;
  if (isTauri()) return (tokenSource = createTokenSource(() => invoke<TokenRead>('daemon_token')));
  const fixed = (import.meta.env.DEV ? import.meta.env.VITE_LEDGE_TOKEN : undefined) as string | undefined; // dev only: a release build never inlines a token
  if (fixed) return (tokenSource = createTokenSource(async () => ({ kind: 'token', token: fixed })));
  return undefined;
}

/** Brings the terminal window whose title matches `title` forward; true when one was found (always false in the browser). */
export async function focusTerminal(title: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('focus_terminal', { title }).catch(() => false);
}

/** Opens a new Windows Terminal tab titled `title` running `command` inside WSL. True once the tab was spawned. */
export async function openTerminal(title: string, command: string[]): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('open_terminal', { title, command }).catch(() => false);
}

/** Opens a web URL in the default browser (a new tab in the browser). Anything but http(s) is ignored. */
export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) { void invoke('open_url', { url }).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener');
}

/** Whether Ledge launches at Windows login. `null` when it is not offered (browser, `tauri dev`). */
export async function getAutostart(): Promise<boolean | null> {
  if (!isTauri()) return null;
  return invoke<boolean | null>('get_autostart').catch(() => null);
}

/** Turns launch at login on or off; resolves to the state Windows reports afterwards (`null`: not offered or failed). */
export async function setAutostart(on: boolean): Promise<boolean | null> {
  if (!isTauri()) return null;
  return invoke<boolean | null>('set_autostart', { on }).catch(() => null);
}

/** A tray menu action. Never fires outside Tauri. */
export function onTrayAction(fn: (action: TrayAction) => void): () => void {
  if (!isTauri()) return () => {};
  let off = () => {}; let disposed = false;
  void listen<{ action: TrayAction }>(TRAY_EVENT, e => { if (!disposed) fn(e.payload.action); }).then(un => {
    off = un;
    if (disposed) un();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

/** Whether a terminal window is in front; false outside Tauri or when the shell cannot tell. */
export async function foregroundIsTerminal(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('foreground_is_terminal').catch(() => false);
}

/** The tray entries, in the app's language (main.rs builds them in French until the first call). */
export interface TrayLabels { open: string; newSession: string; dnd: string; quit: string }
export function setTrayLabels(labels: TrayLabels): void {
  if (!isTauri()) return;
  void invoke('set_tray_labels', { open: labels.open, newSession: labels.newSession, dnd: labels.dnd, quit: labels.quit }).catch(() => {});
}

/** A Windows toast (spec §10); permission is asked once. False when refused, failed or outside Tauri. The click is not handled. */
export async function showToast(title: string, body: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const n = await import('@tauri-apps/plugin-notification');
    const granted = (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
    if (!granted) return false;
    n.sendNotification({ title, body });
    return true;
  } catch { return false; }
}

/** What the island asks to open (« Open in Ledge »), as its raw JSON: the one waiting at start, then each one the shell
 *  receives. Never fires outside Tauri. */
export function onOpenTarget(fn: (raw: string) => void): () => void {
  if (!isTauri()) return () => {};
  let off = () => {}; let disposed = false;
  const take = () => { void invoke<string | null>('take_open_target').then(raw => { if (raw && !disposed) fn(raw); }, () => {}); };
  void listen(OPEN_EVENT, take).then(un => { if (disposed) un(); else off = un; });
  take();
  return () => { disposed = true; off(); };
}

/** A pseudo-terminal running `argv` in the shell, or null when it refuses to start or outside Tauri. After `close()` no
 *  more output reaches `on.data`. */
export async function openPty(argv: string[], size: { cols: number; rows: number }, on: PtyEvents, native?: NativeShell): Promise<PtyHandle | null> {
  if (!isTauri()) return null;
  try {
    core ??= import('@tauri-apps/api/core');
    const { Channel, invoke: call } = await core;
    let disposed = false;
    const onData = new Channel<ArrayBuffer>(); const onExit = new Channel<number | null>();
    onData.onmessage = buf => { if (!disposed) on.data(new Uint8Array(buf)); };
    onExit.onmessage = code => { if (!disposed) on.exit(code); };
    const id = await call<number>('pty_open', { argv, cols: size.cols, rows: size.rows, onData, onExit, native: native ?? null });
    const quiet = (cmd: string, args: Record<string, unknown>) => { void call(cmd, args).catch(() => {}); };
    return {
      write: data => quiet('pty_write', { id, data }),
      resize: (cols, rows) => quiet('pty_resize', { id, cols, rows }),
      close: () => { if (disposed) return; disposed = true; quiet('pty_close', { id }); },
    };
  } catch { return null; }
}

/** What the machine can open in the bottom panel: WSL's default distro ("" when wsl.exe did not answer), and the native
 *  shells found. Outside Tauri: nothing, or the e2e build's `window.__ledgeShells`. */
export async function shellsAvailable(): Promise<ShellsAvailable> {
  const none: ShellsAvailable = { wsl: null, powershell: false, cmd: false, gitBash: false };
  if (!isTauri()) return (window as unknown as { __ledgeShells?: ShellsAvailable }).__ledgeShells ?? none;
  try {
    core ??= import('@tauri-apps/api/core');
    return { ...none, ...await (await core).invoke<ShellsAvailable>('shells_available') };
  } catch { return none; }
}

/** « Ouvrir dans… » (lot 11): the editors the setting offers, as the page and the native side name them. */
export type EditorId = 'cursor' | 'vscode' | 'zed';
export type EditorsInstalled = Record<EditorId, boolean>;
/** What opening a folder in an editor did: opened (nothing to show), not installed, Zed asked for a WSL folder, or failed. */
export type EditorOutcome = { kind: 'opened' } | { kind: 'missing' } | { kind: 'zedWsl' } | { kind: 'failed'; reason: 'exe' | 'distro' | 'path' };

/** The editors installed on this PC; null until known, and outside Tauri (nothing to say then). */
export async function editorsAvailable(): Promise<EditorsInstalled | null> {
  if (!isTauri()) return (window as unknown as { __ledgeEditors?: EditorsInstalled }).__ledgeEditors ?? null;
  try {
    core ??= import('@tauri-apps/api/core');
    return await (await core).invoke<EditorsInstalled>('editors_available');
  } catch { return null; }
}

/** Opens `path` in `editor`: in WSL, or on the machine Windows reaches as `ssh` (its alias). A failed call is « the program
 *  won't start »; outside Tauri the e2e build's `window.__ledgeOpenInEditor` answers (it records the call). */
export async function openInEditor(editor: EditorId, path: string, ssh?: string): Promise<EditorOutcome> {
  const args = { editor, path, ...(ssh !== undefined && { ssh }) };
  if (!isTauri()) {
    const fake = (window as unknown as { __ledgeOpenInEditor?: (a: typeof args) => EditorOutcome }).__ledgeOpenInEditor;
    return fake ? fake(args) : { kind: 'failed', reason: 'exe' };
  }
  try {
    core ??= import('@tauri-apps/api/core');
    return await (await core).invoke<EditorOutcome>('open_in_editor', args);
  } catch { return { kind: 'failed', reason: 'exe' }; }
}

/** The title bar's window buttons (the native bar is off: `decorations: false`). Without Tauri they do nothing. `label`
 *  names another window than the page's own: a detached IDE window (lot 9), a popout of this same page, whose own
 *  `getCurrentWindow()` would be the main one. */
async function appWindow(label?: string) {
  if (label) { const w = await (await import('@tauri-apps/api/webviewWindow')).WebviewWindow.getByLabel(label); if (!w) throw new Error(`no window ${label}`); return w; }
  return (await import('@tauri-apps/api/window')).getCurrentWindow();
}
export function minimizeWindow(label?: string): void { if (isTauri()) void appWindow(label).then(w => w.minimize()).catch(() => {}); }
/** Outside Tauri, the e2e build's `window.__ledgeWindowCall` records what a window bar asked (nothing happens otherwise). */
const fakeWindowCall = (op: 'drag' | 'maximize', label: string | undefined) => (window as unknown as { __ledgeWindowCall?: (op: string, label?: string) => void }).__ledgeWindowCall?.(op, label);
export function toggleMaximizeWindow(label?: string): void { if (isTauri()) void appWindow(label).then(w => w.toggleMaximize()).catch(() => {}); else fakeWindowCall('maximize', label); }
/** Moves the window with the pointer held (a press on its bar). For a detached IDE window (`label`), called from the main page:
 *  Tauri's drag.js only ran in that window's initial about:blank document, so its `data-tauri-drag-region` does nothing there. */
export function startDraggingWindow(label: string): void { if (isTauri()) void appWindow(label).then(w => w.startDragging()).catch(() => {}); else fakeWindowCall('drag', label); }
export function closeWindow(): void { if (isTauri()) void appWindow().then(w => w.close()).catch(() => {}); }
/** A window's title in the taskbar (lot 9: a detached window's « {tab} — Ledge »). */
export function setWindowTitle(label: string, title: string): void { if (isTauri()) void appWindow(label).then(w => w.setTitle(title)).catch(() => {}); }
/** Whether the window is maximised; false outside Tauri or when the shell cannot tell. */
export async function isWindowMaximized(label?: string): Promise<boolean> {
  if (!isTauri()) return false;
  try { return await (await appWindow(label)).isMaximized(); } catch { return false; }
}
/** Calls back after each resize of the window (maximising and restoring resize it). Never fires outside Tauri; the
 *  unsubscription is safe before the subscription completes. */
export function onWindowResized(fn: () => void, label?: string): () => void {
  if (!isTauri()) return () => {};
  let off = () => {}; let disposed = false;
  void appWindow(label).then(w => w.onResized(() => { if (!disposed) fn(); })).then(un => { if (disposed) un(); else off = un; }).catch(() => {});
  return () => { disposed = true; off(); };
}
