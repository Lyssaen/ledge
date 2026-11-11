// The sessions this phone launched: their thread starts with « Nova démarre à la table ledge. » (m2-sessions.html §9), a line
// the phone writes and keeps on the device for that session (design-ux, QUESTIONS.md Q77).
import { MOBILE_STORAGE_PREFIX } from '../link/keys';
import { localStore } from '../state/storage';

const KEY = `${MOBILE_STORAGE_PREFIX}launch.started`;
/** Enough for the sessions still in the list; the oldest go first. */
const MAX = 50;
type Started = { id: string; project: string };

function all(storage?: Storage): Started[] {
  try {
    const v: unknown = JSON.parse(localStore(storage)?.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is Started => typeof x?.id === 'string' && typeof x?.project === 'string') : [];
  } catch { return []; }
}

export function rememberStarted(id: string, project: string, storage?: Storage): void {
  const next = [...all(storage).filter(s => s.id !== id), { id, project }].slice(-MAX);
  try { localStore(storage)?.setItem(KEY, JSON.stringify(next)); } catch { /* the line is lost, the session is not */ }
}

/** The project's name this phone launched the session in, when it did. */
export const startedHere = (id: string, storage?: Storage): string | null => all(storage).find(s => s.id === id)?.project ?? null;
