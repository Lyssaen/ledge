import { isRecord, readJson, writeJson } from '../state/storage';

/** The session place's preferences that survive a restart, for every session alike: the view on the left (Fil | Terminal v3:
 *  the thread or the agent's screen), whether the right panel (Modifications and shells, `terminal`) shows and how wide its
 *  column is, and how wide the side pane opens (lot 6b). The place itself never survives. */
export const SESSION_KEY = 'desktop.session';
export const SPLIT_MIN = 0.3, SPLIT_MAX = 0.72;
/** The right panel's share of the place; the default is the former 1fr next to the thread's 1.15fr. */
export const TERM_MIN = 0.28, TERM_MAX = 0.7, TERM_WIDTH = 0.46;
export type SessionView = 'thread' | 'terminal';
export interface SessionPrefs { view: SessionView; terminal: boolean; split: number; termWidth: number }
/** The pane's share of the page, bounded and rounded to the hundredth (0.65 + 0.03 is 0.68, not 0.6800000000000002); not a
 *  number (a drag over an empty box): null. */
export function clampSplit(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) * 100) / 100;
}

/** The right panel's share, bounded and rounded to the hundredth; not a number: the default. */
export function clampTermWidth(v: number): number {
  if (!Number.isFinite(v)) return TERM_WIDTH;
  return Math.round(Math.min(TERM_MAX, Math.max(TERM_MIN, v)) * 100) / 100;
}

export function loadSessionPrefs(): SessionPrefs {
  const raw = readJson(SESSION_KEY);
  const r = isRecord(raw) ? raw : {};
  const { split, termWidth } = r;
  return {
    view: r.view === 'terminal' ? 'terminal' : 'thread',
    terminal: r.terminal === true,
    split: typeof split === 'number' && split >= SPLIT_MIN && split <= SPLIT_MAX ? split : 0.5,
    termWidth: typeof termWidth === 'number' && termWidth >= TERM_MIN && termWidth <= TERM_MAX ? termWidth : TERM_WIDTH
  };
}
export function saveSessionPrefs(p: SessionPrefs): void { writeJson(SESSION_KEY, p); }
