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
