/**
 * Two UI scales, set apart in Settings: the handle on the screen edge, and the windows that open from it (bubble, list,
 * session, settings, help, coachmark). Every size in the app is a CSS px designed for a 1080p work area; a scale
 * multiplies its own layer only (a CSS `zoom` on that layer, its geometry multiplied in `surface/geometry.ts`), so the
 * page itself is never zoomed and the native frame is plain logical px.
 */
export type UiScale = 'auto' | 1 | 1.25 | 1.5 | 2;
export type ScaleTarget = 'handle' | 'panel';
export const UI_SCALES: readonly UiScale[] = ['auto', 1, 1.25, 1.5, 2];
const KEYS: Record<ScaleTarget, string> = { handle: 'ledge.handleScale', panel: 'ledge.panelScale' };
/** The single Size setting this replaces: migrated to both on first load. */
const LEGACY_KEY = 'ledge.uiScale';
/** The work-area height (logical px) at which Auto starts growing: the handle grows from 1080p (a 4K screen at 100 %
 *  Windows scaling gets 200 %), the windows only on very tall work areas (2160 px and up stay readable at 100 %). */
export const AUTO_BASE_H: Record<ScaleTarget, number> = { handle: 1080, panel: 2160 };

/** Auto scale of `target` for a work area `h` logical px tall: h / base to the nearest quarter, between 1 and 2. */
export function autoScale(h: number, target: ScaleTarget = 'handle'): number {
  if (!Number.isFinite(h) || h <= 0) return 1;
  return Math.min(2, Math.max(1, Math.round((h / AUTO_BASE_H[target]) * 4) / 4));
}

export const resolveScale = (setting: UiScale, h: number, target: ScaleTarget = 'handle'): number => (setting === 'auto' ? autoScale(h, target) : setting);

const parse = (v: string | null): UiScale => {
  if (v === null || v === 'auto') return 'auto';
  const n = Number(v);
  return (UI_SCALES as readonly unknown[]).includes(n) ? (n as UiScale) : 'auto';
};

/** Copies a stored single Size value to both settings (unless they already exist), then drops it. */
export function migrateLegacyScale(): void {
  try {
    const old = localStorage.getItem(LEGACY_KEY);
    if (old === null) return;
    for (const k of Object.values(KEYS)) if (localStorage.getItem(k) === null) localStorage.setItem(k, String(parse(old)));
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* storage unavailable: nothing to migrate */ }
}

/** The persisted setting; 'auto' when absent, invalid, or when storage is unavailable. */
export function loadScale(target: ScaleTarget): UiScale {
  try { return parse(localStorage.getItem(KEYS[target])); } catch { return 'auto'; }
}

export function saveScale(target: ScaleTarget, s: UiScale): void {
  try { localStorage.setItem(KEYS[target], String(s)); } catch { /* storage unavailable: the in-memory value still applies */ }
}

export const percent = (scale: number) => `${Math.round(scale * 100)}%`;
