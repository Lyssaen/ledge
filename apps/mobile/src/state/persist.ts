// What the phone showed last, so a cold start or an offline phone still has something to read. Only what the PC
// sent about its sessions and the person's read marks: never a key (those live in IndexedDB, see link/keys.ts).
import { PhoneSessionSchema, type PhoneSession } from '@ledge/protocol';
import { localStore } from './storage';

export const LAST_STATE_KEY = 'ledge.mobile.lastState';
export const READS_KEY = 'ledge.mobile.reads';

export interface LastState {
  sessions: PhoneSession[];
  previews: Record<string, string[]>;
  daemon: { version: string; name: string } | null;
  syncedAt: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The last state, each session checked again (a cache from an older version may not match); null when there is none. */
export function loadLastState(storage?: Storage): LastState | null {
  try {
    const raw = localStore(storage)?.getItem(LAST_STATE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (!isRecord(v) || !Array.isArray(v.sessions)) return null;
    const sessions = v.sessions.flatMap(s => { const p = PhoneSessionSchema.safeParse(s); return p.success ? [p.data] : []; });
    const previews: Record<string, string[]> = {};
    if (isRecord(v.previews)) for (const [id, lines] of Object.entries(v.previews)) if (Array.isArray(lines) && lines.every(l => typeof l === 'string')) previews[id] = lines;
    const d = v.daemon;
    const daemon = isRecord(d) && typeof d.version === 'string' && typeof d.name === 'string' ? { version: d.version, name: d.name } : null;
    const syncedAt = typeof v.syncedAt === 'string' ? v.syncedAt : null;
    return { sessions, previews, daemon, syncedAt };
  } catch { return null; }
}

export function saveLastState(s: LastState, storage?: Storage): void {
  try { localStore(storage)?.setItem(LAST_STATE_KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the live state still works */ }
}

/** The latest read mark per session. */
export function loadReads(storage?: Storage): Record<string, string> {
  try {
    const v = JSON.parse(localStore(storage)?.getItem(READS_KEY) ?? '{}') as unknown;
    if (!isRecord(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string' && !Number.isNaN(Date.parse(e[1]))));
  } catch { return {}; }
}

export function saveReads(reads: Record<string, string>, storage?: Storage): void {
  try { localStore(storage)?.setItem(READS_KEY, JSON.stringify(reads)); } catch { /* storage full or blocked */ }
}

export function clearLastState(storage?: Storage): void {
  try { localStore(storage)?.removeItem(LAST_STATE_KEY); localStore(storage)?.removeItem(READS_KEY); } catch { /* ignore */ }
}
