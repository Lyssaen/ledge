import { isArchived, isOmpSeat, type Session } from '@ledge/protocol';
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
    // The page's view comes from « Vue par défaut d'une session » now; a view stored by an older Ledge is ignored.
    view: 'thread',
    terminal: r.terminal === true,
    split: typeof split === 'number' && split >= SPLIT_MIN && split <= SPLIT_MAX ? split : 0.5,
    termWidth: typeof termWidth === 'number' && termWidth >= TERM_MIN && termWidth <= TERM_MAX ? termWidth : TERM_WIDTH
  };
}
/** The view is not kept (#300): a session opens on « Vue par défaut d'une session » (session/defaultView.ts). */
export function saveSessionPrefs(p: SessionPrefs): void { const { view: _view, ...kept } = p; writeJson(SESSION_KEY, kept); }

/** The view `s`'s page shows: the preference, but for an OMP seat of OpenRig, which has no thread (design-ux, 2026-11-03 12:23Z):
 *  running, its Terminal view, unless this visit chose « Fil » (`visit`); stopped, « Fil », where its page says its terminal is gone. */
export function viewShown(s: Pick<Session, 'id' | 'source' | 'tool' | 'backend' | 'state' | 'archivedAt'> | null, pref: SessionView, visit: { id: string; view: SessionView } | null): SessionView {
  if (!s || !isOmpSeat(s)) return pref;
  if (isArchived(s) || s.state === 'exited') return 'thread';
  return visit?.id === s.id ? visit.view : 'terminal';
}
