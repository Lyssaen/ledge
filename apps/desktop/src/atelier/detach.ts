/**
 * The detached Atelier (#21): its own window, `atelier`, declared in tauri.conf.json and made by `open_atelier`; it loads the
 * same app, which sees its label and shows the Atelier alone. Each window keeps its own connection to the daemon (the same
 * live state); between them, events:
 *   `ledge://atelier` { NavAction }   atelier → main: what the Atelier asks (open a session, a dialog, the chat…)
 *   `ledge://atelier-terminal` { id }  atelier → main: « Terminal » on a session, shown in the main window with its pane
 *   `ledge://atelier-closed`         atelier → main: the window is closing, the main window takes the Atelier back
 *   `ledge://atelier-attach`         main → atelier: « Rattacher » from the main window, the detached one closes
 * Outside Tauri there is nothing to detach: every call is a no-op.
 */
import { isTauri } from '../tauri/bridge';
import { setWindowFullscreen } from '../shell/fullscreen';
import type { NavAction } from '../nav/state';

export const ATELIER_LABEL = 'atelier';
const MAIN_LABEL = 'main';
export const ACTION_EVENT = 'ledge://atelier';
export const TERMINAL_EVENT = 'ledge://atelier-terminal';
export const CLOSED_EVENT = 'ledge://atelier-closed';
export const ATTACH_EVENT = 'ledge://atelier-attach';

const event = () => import('@tauri-apps/api/event');
const currentWindow = async () => (await import('@tauri-apps/api/window')).getCurrentWindow();

/** Whether the Atelier can have its own window (Tauri only). */
export const canDetach = (): boolean => isTauri();

/** Whether this page is the detached Atelier's window. */
export async function isAtelierWindow(): Promise<boolean> {
  if (!isTauri()) return false;
  try { return (await currentWindow()).label === ATELIER_LABEL; } catch { return false; }
}

/** Opens the detached Atelier, or brings it forward; true once it shows. */
export async function detachAtelier(): Promise<boolean> {
  if (!isTauri()) return false;
  try { await (await import('@tauri-apps/api/core')).invoke('open_atelier'); return true; } catch { return false; }
}

/** Whether the detached Atelier's window is there (the main window reloaded while it was). */
export async function atelierOpen(): Promise<boolean> {
  if (!isTauri()) return false;
  try { return (await (await import('@tauri-apps/api/webviewWindow')).WebviewWindow.getByLabel(ATELIER_LABEL)) !== null; } catch { return false; }
}

/** « Rattacher » from the main window: the detached one closes itself. */
export function attachAtelier(): void {
  if (isTauri()) void event().then(e => e.emitTo(ATELIER_LABEL, ATTACH_EVENT)).catch(() => {});
}

/** Registers `listen`'s handlers until the returned unsubscription, safe before the registration completes. */
function subscribe(register: () => Promise<Array<() => void>>): () => void {
  let offs: Array<() => void> = []; let disposed = false;
  void register().then(un => { if (disposed) un.forEach(f => f()); else offs = un; }).catch(() => {});
  return () => { disposed = true; offs.forEach(f => f()); };
}

/** The main window: what the detached Atelier asks, and its closing. Never fires outside Tauri. */
export function onAtelier(fn: { action(a: NavAction): void; terminal(id: string): void; closed(): void }): () => void {
  if (!isTauri()) return () => {};
  return subscribe(async () => {
    const e = await event();
    return Promise.all([
      e.listen<NavAction>(ACTION_EVENT, m => fn.action(m.payload)),
      e.listen<{ id: string }>(TERMINAL_EVENT, m => fn.terminal(m.payload.id)),
      e.listen(CLOSED_EVENT, () => fn.closed())
    ]);
  });
}

/** The main window comes forward to show what the detached Atelier asked. */
export function showMainWindow(): void {
  if (!isTauri()) return;
  void currentWindow().then(async w => { await w.unminimize(); await w.show(); await w.setFocus(); }).catch(() => {});
}

/** The detached Atelier: hands an action to the main window. */
export function toMain(a: NavAction): void {
  if (isTauri()) void event().then(e => e.emitTo(MAIN_LABEL, ACTION_EVENT, a)).catch(() => {});
}

/** The detached Atelier: « Terminal » on a session, which only the main window can show with its pane. */
export function terminalToMain(id: string): void {
  if (isTauri()) void event().then(e => e.emitTo(MAIN_LABEL, TERMINAL_EVENT, { id })).catch(() => {});
}

/** The detached Atelier closes (its « Rattacher », its ×, Alt+F4, or the main window's « Rattacher »): the main window is told first.
 *  From full screen it leaves it first (maximised again if it was, #18): the window-state plugin would remember it otherwise. */
export function closeAtelierWindow(): void {
  if (isTauri()) void currentWindow().then(async w => { if (await w.isFullscreen()) await setWindowFullscreen(false); await w.close(); }).catch(() => {});
}

/** The detached Atelier's window: says it closes, and closes when the main window takes it back. */
export function watchAtelierWindow(): () => void {
  if (!isTauri()) return () => {};
  return subscribe(async () => {
    const [e, w] = await Promise.all([event(), currentWindow()]);
    return Promise.all([
      w.onCloseRequested(async () => { await e.emitTo(MAIN_LABEL, CLOSED_EVENT).catch(() => {}); }),
      e.listen(ATTACH_EVENT, () => closeAtelierWindow())
    ]);
  });
}
