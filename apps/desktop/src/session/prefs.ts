import { isRecord, readJson, writeJson } from '../state/storage';

/** The session place's preferences that survive a restart: whether the terminal shows beside the conversation, and how wide
 *  the side pane opens (lot 6b). The place itself never survives. */
export const SESSION_KEY = 'desktop.session';
export const SPLIT_MIN = 0.3, SPLIT_MAX = 0.72;
export interface SessionPrefs { terminal: boolean; split: number }

export function loadSessionPrefs(): SessionPrefs {
  const raw = readJson(SESSION_KEY);
  const r = isRecord(raw) ? raw : {};
  const split = r.split;
  return {
    terminal: r.terminal === true,
    split: typeof split === 'number' && split >= SPLIT_MIN && split <= SPLIT_MAX ? split : 0.5
  };
}
export function saveSessionPrefs(p: SessionPrefs): void { writeJson(SESSION_KEY, p); }
