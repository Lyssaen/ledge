import type { Turn } from '@ledge/protocol';
import type { MobileState } from './store';

export const TOKEN_KEY = 'ledge.mobile.token';
export const DEVICE_KEY = 'ledge.mobile.device';
export const LAST_STATE_KEY = 'ledge.mobile.lastState';
/** Thread turns live under their own key: they are the heavy part, and a full storage must never cost the session list. */
export const TURNS_KEY = 'ledge.mobile.turns';

export type LastState = Pick<MobileState, 'sessions' | 'previews' | 'syncedAt' | 'pcName'> & { turns?: Record<string, Turn[]> };

/** Turns kept on the phone per thread: the latest ones (the PC sends at most 200). */
export const TURNS_KEPT = 50;

const store = (s?: Storage): Storage | null => { try { return s ?? globalThis.localStorage ?? null; } catch { return null; } };

/** What the phone showed last, so a cold start or an offline phone still has something to read. */
export function loadLastState(storage?: Storage): LastState | null {
  try {
    const raw = store(storage)?.getItem(LAST_STATE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastState>;
    if (!v || !Array.isArray(v.sessions)) return null;
    return { sessions: v.sessions, previews: v.previews ?? {}, syncedAt: v.syncedAt ?? null, pcName: v.pcName ?? null, turns: loadTurns(storage) };
  } catch { return null; }
}

/** The sessions and previews; the turns are saved apart (`saveTurns`) so one failing never takes the other down. */
export function saveLastState(s: LastState, storage?: Storage): void {
  try { store(storage)?.setItem(LAST_STATE_KEY, JSON.stringify({ sessions: s.sessions, previews: s.previews, syncedAt: s.syncedAt, pcName: s.pcName })); } catch { /* storage full or blocked: the live state still works */ }
}

function loadTurns(storage?: Storage): Record<string, Turn[]> {
  try {
    const raw = store(storage)?.getItem(TURNS_KEY);
    const v = raw ? JSON.parse(raw) as unknown : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, Turn[]> : {};
  } catch { return {}; }
}

export function saveTurns(turns: Record<string, Turn[]>, storage?: Storage): void {
  try { store(storage)?.setItem(TURNS_KEY, JSON.stringify(Object.fromEntries(Object.entries(turns).map(([id, t]) => [id, t.slice(-TURNS_KEPT)])))); } catch { /* storage full or blocked: the threads are read again from the PC */ }
}

export function clearLastState(storage?: Storage): void {
  try { store(storage)?.removeItem(LAST_STATE_KEY); store(storage)?.removeItem(TURNS_KEY); } catch { /* ignore */ }
}

/** Whether this phone holds a device token (it is paired). */
export function hasToken(storage?: Storage): boolean {
  try { return !!store(storage)?.getItem(TOKEN_KEY); } catch { return false; }
}
