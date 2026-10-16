import { isRecord, readJson, writeJson } from './storage';

/** What Desktop keeps of a thread (spec §7 `desktop.thread`): which folds are open and where the reader was. Never a message. */
export interface ThreadPref { open: readonly string[]; scroll: number | null }
export type ThreadPrefs = Readonly<Record<string, ThreadPref>>;
export const THREAD_KEY = 'desktop.thread';
export const NO_PREF: ThreadPref = { open: [], scroll: null };
const MAX_OPEN = 200;

function readPref(v: unknown): ThreadPref | null {
  if (!isRecord(v)) return null;
  const open = Array.isArray(v.open) ? [...new Set(v.open.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(-MAX_OPEN) : [];
  const scroll = typeof v.scroll === 'number' && Number.isFinite(v.scroll) && v.scroll >= 0 ? v.scroll : null;
  return Array.isArray(v.open) || scroll !== null ? { open, scroll } : null;
}
export function loadThreadPrefs(): ThreadPrefs {
  const raw = readJson(THREAD_KEY);
  if (!isRecord(raw)) return {};
  const out: Record<string, ThreadPref> = {};
  for (const [id, v] of Object.entries(raw)) { const p = readPref(v); if (id && p) out[id] = p; }
  return out;
}
export function saveThreadPrefs(p: ThreadPrefs): void { writeJson(THREAD_KEY, p); }

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export function setThreadPref(p: ThreadPrefs, id: string, patch: Partial<ThreadPref>): ThreadPrefs {
  const cur = p[id] ?? NO_PREF;
  const next: ThreadPref = { open: patch.open ?? cur.open, scroll: patch.scroll !== undefined ? patch.scroll : cur.scroll };
  if (p[id] && sameList(next.open, cur.open) && next.scroll === cur.scroll) return p;
  if (!p[id] && next.open.length === 0 && next.scroll === null) return p;
  const out = { ...p };
  if (next.open.length || next.scroll !== null) out[id] = next; else delete out[id];
  return out;
}
export function toggled(open: readonly string[], fold: string, on: boolean): string[] {
  const rest = open.filter(f => f !== fold);
  return on ? [...rest, fold].slice(-MAX_OPEN) : rest;
}
