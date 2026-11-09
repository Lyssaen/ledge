/**
 * The IDE's secondary windows (lot 9, docs/ide-workspace-plan.md 3.1): dockview popouts of the same document. Each holds one
 * group (jde, 2026-11-09, option A). The page is opened by `window.open` (dockview's `addPopoutGroup`); in Tauri the main
 * window answers it with a real window in the same WebView2 environment, labelled after the model's window id, so the
 * window-state plugin keeps its screen and size.
 */
import { isTauri } from '../tauri/bridge';

/** A box on the screen, in CSS pixels (dockview's popout `position`). */
export interface Box { left: number; top: number; width: number; height: number }

/** A new window's size when nothing else says (the window-state plugin restores a known one). */
export const POPOUT_SIZE = { width: 900, height: 640 } as const;

/** The page a secondary window loads: empty, dockview fills it. The hash names the model window (`ide-win=w5`): Tauri reads
 *  it to label the window `ide-w5`. */
export const popoutUrl = (win: string): string => `/popout.html#ide-win=${encodeURIComponent(win)}`;

/** Where a tab let go outside every window opens: its top-left corner under the pointer, at POPOUT_SIZE. */
export const boxAt = (screenX: number, screenY: number): Box => ({ left: Math.round(screenX), top: Math.round(screenY), ...POPOUT_SIZE });

/** Whether a drag ended outside the window it started in: let go over no page of Ledge (the desktop, another app). */
export function outsideWindow(e: Pick<DragEvent, 'clientX' | 'clientY'>, w: Pick<Window, 'innerWidth' | 'innerHeight'>): boolean {
  return e.clientX < 0 || e.clientY < 0 || e.clientX > w.innerWidth || e.clientY > w.innerHeight;
}

/** The root element's look (theme, accent, language) copied onto a popout's root, and kept in step: the shared tokens hang
 *  on `data-theme` and the accent's custom properties on `style`. Dockview copies the style sheets itself. */
export function mirrorRoot(target: Document, source: Document = document): () => void {
  const from = source.documentElement;
  const to = target.documentElement;
  const copy = () => {
    for (const name of ['data-theme', 'style', 'class', 'lang']) {
      const v = from.getAttribute(name);
      if (v === null) to.removeAttribute(name); else if (to.getAttribute(name) !== v) to.setAttribute(name, v);
    }
  };
  copy();
  if (typeof MutationObserver === 'undefined') return () => {};
  const mo = new MutationObserver(copy);
  mo.observe(from, { attributes: true, attributeFilter: ['data-theme', 'style', 'class', 'lang'] });
  return () => mo.disconnect();
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } };

/** The Tauri label of a popout's window, null outside Tauri. */
export function popoutLabel(w: Window | null | undefined): string | null {
  try { return (w as TauriWindow | null | undefined)?.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null; } catch { return null; }
}

/** Closes a popout's real window (lot 0, point 5: the page's own `close()` may do nothing in a webview). Outside Tauri,
 *  dockview's `close()` is enough. */
export function closeNative(w: Window | null | undefined): void {
  const label = popoutLabel(w);
  if (!label || !isTauri()) return;
  void import('@tauri-apps/api/core').then(c => c.invoke('close_window', { label })).catch(() => {});
}
