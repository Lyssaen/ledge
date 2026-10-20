/** The given Storage, else the page's localStorage; null where it is blocked (a private window, a sandboxed frame). */
export const localStore = (storage?: Storage): Storage | null => { try { return storage ?? globalThis.localStorage ?? null; } catch { return null; } };
