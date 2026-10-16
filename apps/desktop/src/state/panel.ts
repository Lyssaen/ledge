import { isRecord, readJson, writeJson } from './storage';

export interface PanelState { width: number; expanded: boolean }
export interface Bounds { min: number; max: number }
export const PANEL_KEY = 'desktop.panel';
export const DEFAULT_PANEL: PanelState = { width: 38, expanded: false };
export const PANEL_STEP = 2;
const PANE_MIN_PX = 320, LIST_MIN_PX = 288, MAX_PCT = 70, UNMEASURED: Bounds = { min: 25, max: 70 };

/** The conversation's share of the body, in % (mockup split-view.js): at least 320 px of conversation, 288 px of
 *  sessions plus the 8 px handle, at most 70 %. A body not measured yet gets 25–70; a narrow one keeps min ≤ max. */
export function panelBounds(width: number): Bounds {
  if (!Number.isFinite(width) || width <= 0) return UNMEASURED;
  const max = Math.min(MAX_PCT, Math.max(UNMEASURED.min, ((width - LIST_MIN_PX) / width) * 100));
  return { min: Math.min((PANE_MIN_PX / width) * 100, max), max };
}
export function clampPanel(pct: number, b: Bounds): number {
  return Math.min(b.max, Math.max(b.min, Number.isFinite(pct) ? pct : DEFAULT_PANEL.width));
}
/** ← widens the conversation (the handle moves left), → narrows it; Home and End jump to the bounds. */
export function stepPanel(pct: number, key: string, b: Bounds): number | null {
  switch (key) {
    case 'ArrowLeft': return clampPanel(pct + PANEL_STEP, b);
    case 'ArrowRight': return clampPanel(pct - PANEL_STEP, b);
    case 'Home': return b.min;
    case 'End': return b.max;
    default: return null;
  }
}
export function loadPanel(): PanelState {
  const raw = readJson(PANEL_KEY);
  const o = isRecord(raw) ? raw : {};
  const width = typeof o.width === 'number' && Number.isFinite(o.width) && o.width > 0 && o.width <= MAX_PCT ? o.width : DEFAULT_PANEL.width;
  return { width, expanded: typeof o.expanded === 'boolean' ? o.expanded : DEFAULT_PANEL.expanded };
}
export function savePanel(p: PanelState): void { writeJson(PANEL_KEY, { width: p.width, expanded: p.expanded }); }
