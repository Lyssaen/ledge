import { useSyncExternalStore } from 'react';
import type { ServerMessage, Session } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from './client';

/** The daemon's last `error` reply; `seq` tells two identical messages apart. */
export interface DaemonError { id?: string; message: string; seq: number }
export interface DaemonState { sessions: Session[]; byId: Map<string, Session>; status: DaemonStatus; previews: Map<string, string[]>; lastError: DaemonError | null }
const empty = (): DaemonState => ({ sessions: [], byId: new Map(), status: 'connecting', previews: new Map(), lastError: null });
let state: DaemonState = empty();
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const sorted = (m: Map<string, Session>) => [...m.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

export const daemonStore = {
  getState: () => state,
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
  setStatus(status: DaemonStatus) { state = { ...state, status }; emit(); },
  reset() { state = empty(); emit(); },
  apply(m: ServerMessage) {
    if (m.type === 'error') { state = { ...state, lastError: { id: m.id, message: m.message, seq: (state.lastError?.seq ?? 0) + 1 } }; emit(); return; }
    const byId = new Map(state.byId); const previews = new Map(state.previews);
    switch (m.type) {
      case 'snapshot': byId.clear(); for (const s of m.sessions) byId.set(s.id, s); for (const id of previews.keys()) if (!byId.has(id)) previews.delete(id); break;
      case 'session.updated': byId.set(m.session.id, m.session); break;
      case 'session.removed': byId.delete(m.id); previews.delete(m.id); break;
      case 'session.preview': previews.set(m.id, m.lines); break;
    }
    state = { ...state, byId, previews, sessions: sorted(byId) }; emit();
  }
};

export function attachClient(client: DaemonClient): () => void {
  const a = client.onMessage(m => daemonStore.apply(m));
  const b = client.onStatus(s => daemonStore.setStatus(s));
  return () => { a(); b(); };
}
export const useDaemon = (): DaemonState => useSyncExternalStore(daemonStore.subscribe, daemonStore.getState, daemonStore.getState);
