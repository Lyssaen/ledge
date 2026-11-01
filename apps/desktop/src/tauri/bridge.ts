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
 */
import { listen } from '@tauri-apps/api/event';
import type { PtyEvents, PtyHandle } from '../term/backend';
import { createTokenSource, type TokenRead, type TokenSource } from '@ledge/fleet';
import { MEDIA_EVENT, NowPlayingSchema, type NowPlaying } from '@ledge/protocol';

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
export async function openPty(argv: string[], size: { cols: number; rows: number }, on: PtyEvents): Promise<PtyHandle | null> {
  if (!isTauri()) return null;
  try {
    core ??= import('@tauri-apps/api/core');
    const { Channel, invoke: call } = await core;
    let disposed = false;
    const onData = new Channel<ArrayBuffer>(); const onExit = new Channel<number | null>();
    onData.onmessage = buf => { if (!disposed) on.data(new Uint8Array(buf)); };
    onExit.onmessage = code => { if (!disposed) on.exit(code); };
    const id = await call<number>('pty_open', { argv, cols: size.cols, rows: size.rows, onData, onExit });
    const quiet = (cmd: string, args: Record<string, unknown>) => { void call(cmd, args).catch(() => {}); };
    return {
      write: data => quiet('pty_write', { id, data }),
      resize: (cols, rows) => quiet('pty_resize', { id, cols, rows }),
      close: () => { if (disposed) return; disposed = true; quiet('pty_close', { id }); },
    };
  } catch { return null; }
}

/** The title bar's window buttons (the native bar is off: `decorations: false`). Without Tauri they do nothing. */
async function appWindow() { return (await import('@tauri-apps/api/window')).getCurrentWindow(); }
export function minimizeWindow(): void { if (isTauri()) void appWindow().then(w => w.minimize()).catch(() => {}); }
export function toggleMaximizeWindow(): void { if (isTauri()) void appWindow().then(w => w.toggleMaximize()).catch(() => {}); }
export function closeWindow(): void { if (isTauri()) void appWindow().then(w => w.close()).catch(() => {}); }
/** Whether the window is maximised; false outside Tauri or when the shell cannot tell. */
export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false;
  try { return await (await appWindow()).isMaximized(); } catch { return false; }
}
const playingOf = (raw: unknown): NowPlaying | null => {
  if (raw == null) return null;
  const parsed = NowPlayingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** The track the shell is reading. In the browser, a `ledge:media` CustomEvent stands in for `ledge://media`. */
export function onNowPlaying(fn: (now: NowPlaying | null) => void): () => void {
  if (!isTauri()) {
    const h = (e: Event) => fn(playingOf((e as CustomEvent<unknown>).detail));
    window.addEventListener('ledge:media', h);
    return () => window.removeEventListener('ledge:media', h);
  }
  let off = () => {}; let disposed = false;
  void listen<unknown>(MEDIA_EVENT, e => { if (!disposed) fn(playingOf(e.payload)); }).then(un => { off = un; if (disposed) un(); });
  return () => { disposed = true; off(); };
}

/** The last track the shell read. `null` in the browser, or when nothing is playing. */
export async function mediaNow(): Promise<NowPlaying | null> {
  if (!isTauri()) return null;
  try { return playingOf(await invoke<unknown>('media_now')); } catch { return null; }
}

/** Calls back after each resize of the window (maximising and restoring resize it). Never fires outside Tauri; the
 *  unsubscription is safe before the subscription completes. */
export function onWindowResized(fn: () => void): () => void {
  if (!isTauri()) return () => {};
  let off = () => {}; let disposed = false;
  void appWindow().then(w => w.onResized(() => { if (!disposed) fn(); })).then(un => { if (disposed) un(); else off = un; }).catch(() => {});
  return () => { disposed = true; off(); };
}
