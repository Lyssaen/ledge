import type { MobileState } from './store';

export const TOKEN_KEY = 'ledge.mobile.token';
export const DEVICE_KEY = 'ledge.mobile.device';
export const LAST_STATE_KEY = 'ledge.mobile.lastState';

export type LastState = Pick<MobileState, 'sessions' | 'previews' | 'syncedAt' | 'pcName'>;

const store = (s?: Storage): Storage | null => { try { return s ?? globalThis.localStorage ?? null; } catch { return null; } };

/** What the phone showed last, so a cold start or an offline phone still has something to read. */
export function loadLastState(storage?: Storage): LastState | null {
  try {
    const raw = store(storage)?.getItem(LAST_STATE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastState>;
    if (!v || !Array.isArray(v.sessions)) return null;
    return { sessions: v.sessions, previews: v.previews ?? {}, syncedAt: v.syncedAt ?? null, pcName: v.pcName ?? null };
  } catch { return null; }
}

export function saveLastState(s: LastState, storage?: Storage): void {
  try { store(storage)?.setItem(LAST_STATE_KEY, JSON.stringify({ sessions: s.sessions, previews: s.previews, syncedAt: s.syncedAt, pcName: s.pcName })); } catch { /* storage full or blocked: the live state still works */ }
}

export function clearLastState(storage?: Storage): void {
  try { store(storage)?.removeItem(LAST_STATE_KEY); } catch { /* ignore */ }
}
