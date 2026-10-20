// The text typed for an agent and not yet taken by the terminal: kept per session, cleared only once it was applied.
// A draft is the person's own words, kept on their phone; it never holds a key.
import { localStore } from './storage';

const key = (sessionId: string) => `ledge.mobile.draft.${sessionId}`;

export function loadDraft(sessionId: string, storage?: Storage): string {
  try { return localStore(storage)?.getItem(key(sessionId)) ?? ''; } catch { return ''; }
}

export function saveDraft(sessionId: string, text: string, storage?: Storage): void {
  try {
    const s = localStore(storage);
    if (text === '') s?.removeItem(key(sessionId)); else s?.setItem(key(sessionId), text);
  } catch { /* storage full or blocked: the draft lives on in the field */ }
}

const CLEARED = 'ledge.mobile.draft.cleared';
const KEEP = 50;

function cleared(storage?: Storage): string[] {
  try {
    const v = JSON.parse(localStore(storage)?.getItem(CLEARED) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** Instructions whose draft was already cleared, kept across reloads: a text typed again later is a new draft. */
export function wasCleared(op: string, storage?: Storage): boolean {
  return cleared(storage).includes(op);
}

export function markCleared(op: string, storage?: Storage): void {
  try {
    const list = cleared(storage).filter(x => x !== op);
    localStore(storage)?.setItem(CLEARED, JSON.stringify([...list, op].slice(-KEEP)));
  } catch { /* blocked storage */ }
}
