// Notifications of requests answered elsewhere (another device, the PC) close once the app knows: at each snapshot and
// change of what is pending, a request or question notification whose session no longer waits is closed. A courtesy:
// nothing here may fail the app.
import type { MobileStore } from '../state/store';

/** The daemon's push tag of a session (mobile/push/triggers.ts `safeTag`). */
export const tagOf = (sessionId: string): string => sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);

interface Shown { tag: string; data?: unknown; close(): void }
type Registration = { getNotifications?: (filter?: { tag?: string }) => Promise<Shown[]> };

/** Closes the shown request and question notifications whose tag is not in `pending`. */
export async function pruneNotifications(reg: Registration | null | undefined, pending: ReadonlySet<string>): Promise<void> {
  try {
    const shown = (await reg?.getNotifications?.()) ?? [];
    for (const n of shown) {
      const kind = (n.data as { kind?: unknown } | undefined)?.kind;
      if ((kind === 'request' || kind === 'question') && !pending.has(n.tag)) n.close();
    }
  } catch { /* ignored */ }
}

/** Prunes each time the store is fresh with a new set of waiting sessions. Returns the way to stop. */
export function startPruning(store: MobileStore, registration: () => Promise<Registration | null | undefined>): () => void {
  let last: string | null = null;
  const check = () => {
    const st = store.getState();
    if (!st.fresh) return;
    const pending = new Set([...st.sessions.values()].filter(s => s.pending).map(s => tagOf(s.id)));
    const key = [...pending].sort().join(' ');
    if (key === last) return;
    last = key;
    void registration().then(reg => pruneNotifications(reg, pending)).catch(() => {});
  };
  const stop = store.subscribe(check);
  check();
  return stop;
}
