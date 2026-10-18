/**
 * What Desktop asks of the native shell (same command and event names as the overlay's bridge). Outside Tauri every
 * call is a no-op or a DOM fallback.
 *   focus_terminal { title }           bring the matching terminal window forward (true when found)
 *   open_terminal { title, command }   open a Windows Terminal tab running `command` in WSL (true once spawned)
 *   open_url { url }                   open a web URL in the default browser
 *   get_autostart / set_autostart { on }   launch at login (null: not offered)
 *   foreground_is_terminal             whether a terminal window is in front (sounds: « only when the terminal is behind »)
 *   set_tray_labels { open, newSession, dnd, quit }   tray entries in the app's language
 *   plugin notification                Windows toasts (spec §10)
 *   event `ledge://tray` { action }    tray menu action
 *   take_open_target / event `ledge://open`   what the island asked to open (`--open`), taken once
 */
import { listen } from '@tauri-apps/api/event';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const TRAY_EVENT = 'ledge://tray';
export const OPEN_EVENT = 'ledge://open';
export type TrayAction = 'open' | 'new' | 'dnd';

let core: Promise<typeof import('@tauri-apps/api/core')> | null = null;
const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  core ??= import('@tauri-apps/api/core');
  return (await core).invoke<T>(cmd, args);
};

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
