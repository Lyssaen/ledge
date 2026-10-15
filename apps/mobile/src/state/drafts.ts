/** The text typed for an agent and not yet taken by the terminal: kept per session, cleared only once it was applied. */
const key = (sessionId: string) => `ledge.mobile.draft.${sessionId}`;

export function loadDraft(sessionId: string, storage?: Storage): string {
  try { return (storage ?? globalThis.localStorage)?.getItem(key(sessionId)) ?? ''; } catch { return ''; }
}

export function saveDraft(sessionId: string, text: string, storage?: Storage): void {
  try {
    const s = storage ?? globalThis.localStorage;
    if (text === '') s?.removeItem(key(sessionId)); else s?.setItem(key(sessionId), text);
  } catch { /* storage full or blocked: the draft lives on in the field */ }
}

const CLEARED = 'ledge.mobile.draft.cleared';
const KEEP = 50;
/** Instructions whose draft was already cleared, kept across reloads: a text typed again later is a new draft. */
export function wasCleared(operationId: string, storage?: Storage): boolean {
  try { return (JSON.parse((storage ?? globalThis.localStorage)?.getItem(CLEARED) ?? '[]') as string[]).includes(operationId); } catch { return false; }
}
export function markCleared(operationId: string, storage?: Storage): void {
  try {
    const s = storage ?? globalThis.localStorage;
    const list = (JSON.parse(s?.getItem(CLEARED) ?? '[]') as string[]).filter(x => x !== operationId);
    s?.setItem(CLEARED, JSON.stringify([...list, operationId].slice(-KEEP)));
  } catch { /* blocked storage */ }
}
