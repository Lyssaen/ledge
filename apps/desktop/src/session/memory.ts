/** What a session page leaves behind when it closes, kept by the shell in memory (never stored): it survives
 *  navigation, not a restart. `scroll` null = at the end of the thread; `seen` = the last item shown. */
export interface Memo { draft: string; scroll: number | null; seen: string | null }
export interface SessionMemory { get(key: string): Memo; set(key: string, patch: Partial<Memo>): void }

/** A session's key, or `${id}#${helper}` for one of its subagents. */
export const memoKey = (id: string, helper?: string): string => (helper === undefined ? id : `${id}#${helper}`);

const EMPTY: Memo = { draft: '', scroll: null, seen: null };

export function createSessionMemory(): SessionMemory {
  const memos = new Map<string, Memo>();
  return {
    get: key => memos.get(key) ?? EMPTY,
    set: (key, patch) => { memos.set(key, { ...(memos.get(key) ?? EMPTY), ...patch }); }
  };
}
