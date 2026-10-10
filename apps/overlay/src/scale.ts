/**
 * UI scale. Every size in the app is a CSS px designed for a 1080p work area; on a taller work area (a 4K screen at
 * 100-150 % Windows scaling) the whole UI is zoomed instead of resizing components one by one.
 * Under Tauri the zoom is the webview's (`setZoom`), in a plain browser a CSS `zoom` on the app root. Either way the
 * surface lays itself out in a work area of H / scale CSS px, and everything sent to the shell in monitor-logical px
 * is multiplied back by the scale (see `tauri/bridge.ts`).
 */
export type UiScale = 'auto' | 1 | 1.25 | 1.5 | 2;
export const UI_SCALES: readonly UiScale[] = ['auto', 1, 1.25, 1.5, 2];
const KEY = 'ledge.uiScale';
/** The work-area height (logical px) the base sizes are designed for. */
export const BASE_H = 1080;

/** Auto scale for a work area `h` logical px tall: h / 1080 to the nearest quarter, between 1 and 2. */
export function autoScale(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return 1;
  return Math.min(2, Math.max(1, Math.round((h / BASE_H) * 4) / 4));
}

export const resolveScale = (setting: UiScale, h: number): number => (setting === 'auto' ? autoScale(h) : setting);

const parse = (v: string | null): UiScale => {
  if (v === null || v === 'auto') return 'auto';
  const n = Number(v);
  return (UI_SCALES as readonly unknown[]).includes(n) ? (n as UiScale) : 'auto';
};

/** The persisted setting; 'auto' when absent, invalid, or when storage is unavailable. */
export function loadUiScale(): UiScale {
  try { return parse(localStorage.getItem(KEY)); } catch { return 'auto'; }
}

export function saveUiScale(s: UiScale): void {
  try { localStorage.setItem(KEY, String(s)); } catch { /* storage unavailable: the in-memory value still applies */ }
}

export const percent = (scale: number) => `${Math.round(scale * 100)}%`;
