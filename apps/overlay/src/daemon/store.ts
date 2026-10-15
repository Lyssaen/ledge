import { useSyncExternalStore } from 'react';
import type { ChatTurn, DaemonInfo, Device, PairErrorReason, Recent, ServerMessage, Session, ThreadItem } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from './client';

/** The daemon's last `error` reply; `seq` tells two identical messages apart. */
export interface DaemonError { id?: string; message: string; seq: number }
/** The daemon's last `session.launched` answer (to this client's `session.launch`); `seq` tells two apart. */
export interface Launched { id: string; seq: number }
export interface DaemonState {
  sessions: Session[]; byId: Map<string, Session>; status: DaemonStatus; previews: Map<string, string[]>; lastError: DaemonError | null;
  /** Native tracking: the threads received so far, by session (asked for when a session opens). */
  threads: Map<string, ThreadItem[]>;
  /** The folders of past sessions, most recent first (the launch form's suggestions). */
  recents: Recent[];
  /** The command that runs `ledge` inside WSL, from the snapshot; null until known. */
  launcher: string[] | null;
  lastLaunched: Launched | null;
  lastListing: FolderListing | null;
  /** The day's conversation with Ledge, oldest first, and the answer being streamed (null between questions). */
  chat: ChatTurn[]; chatLive: { qid: string; text: string } | null;
  /** The daemon's version and install mode, from the last snapshot; null when it does not report them. */
  daemon: DaemonInfo | null;
  /** How many snapshots arrived (one per connection), so a reconnect after a restart is detectable. */
  snapshotSeq: number;
  /** The paired phones, the https origin and whether the remote entry listens; null until the daemon answers `devices`. */
  mobile: { devices: Device[]; origin: string | null; listening: boolean } | null;
  /** The pairing code being shown (this PC asked for it), and the reason of the last refusal. */
  pairing: { code: string; expiresAt: string; url: string } | null; pairError: PairErrorReason | null;
  /** The daemon's last update.progress / update.failed message; `seq` tells two identical ones apart. */
  lastUpdate: { msg: Extract<ServerMessage, { type: 'update.progress' | 'update.failed' }>; seq: number } | null;
}
/** The daemon's last `folder.listing` answer (to this client's `folder.list` or `folder.create`); `seq` tells two apart. */
export type FolderListing = Omit<Extract<ServerMessage, { type: 'folder.listing' }>, 'type'> & { seq: number };
const empty = (): DaemonState => ({ sessions: [], byId: new Map(), status: 'connecting', previews: new Map(), threads: new Map(), lastError: null, recents: [], launcher: null, lastLaunched: null, lastListing: null, chat: [], chatLive: null, daemon: null, snapshotSeq: 0, mobile: null, pairing: null, pairError: null, lastUpdate: null });
let state: DaemonState = empty();
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const sorted = (m: Map<string, Session>) => [...m.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

export const daemonStore = {
  getState: () => state,
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
  setStatus(status: DaemonStatus) { state = { ...state, status }; emit(); },
  reset() { state = empty(); emit(); },
  /** The overlay lists its own question at once; the daemon's events fill it in. */
  beginTurn(turn: ChatTurn) { state = { ...state, chat: [...state.chat.filter(t => t.qid !== turn.qid), turn], chatLive: null }; emit(); },
  apply(m: ServerMessage) {
    if (m.type === 'chat.history') { state = { ...state, chat: m.turns, chatLive: null }; emit(); return; }
    if (m.type === 'chat.step' || m.type === 'chat.delta' || m.type === 'chat.done' || m.type === 'chat.error') {
      const chat = state.chat.map(t => t.qid !== m.qid ? t
        : m.type === 'chat.step' ? { ...t, steps: [...t.steps, m.step] }
        : m.type === 'chat.done' ? { ...t, answer: m.text, answeredAt: m.at, ...(m.proposal ? { proposal: m.proposal } : {}), ...(m.relay ? { relay: m.relay } : {}) }
        : m.type === 'chat.error' ? { ...t, error: m.message } : t);
      const chatLive = m.type === 'chat.delta' ? { qid: m.qid, text: (state.chatLive?.qid === m.qid ? state.chatLive.text : '') + m.text } : m.type === 'chat.step' ? state.chatLive : null;
      state = { ...state, chat, chatLive }; emit(); return;
    }
    if (m.type === 'error') { state = { ...state, lastError: { id: m.id, message: m.message, seq: (state.lastError?.seq ?? 0) + 1 } }; emit(); return; }
    if (m.type === 'session.launched') { state = { ...state, lastLaunched: { id: m.id, seq: (state.lastLaunched?.seq ?? 0) + 1 } }; emit(); return; }
    if (m.type === 'folder.listing') { const { type: _, ...l } = m; state = { ...state, lastListing: { ...l, seq: (state.lastListing?.seq ?? 0) + 1 } }; emit(); return; }
    if (m.type === 'update.progress' || m.type === 'update.failed') { state = { ...state, lastUpdate: { msg: m, seq: (state.lastUpdate?.seq ?? 0) + 1 } }; emit(); return; }
    if (m.type === 'devices') {
      // A device that was not there before consumes the pairing code: leave the pairing view.
      const known = new Set(state.mobile?.devices.map(d => d.id));
      const joined = state.mobile !== null && m.devices.some(d => !known.has(d.id));
      state = { ...state, mobile: { devices: m.devices, origin: m.origin, listening: m.listening }, pairing: joined ? null : state.pairing }; emit(); return;
    }
    if (m.type === 'pair.code') { state = { ...state, pairing: { code: m.code, expiresAt: m.expiresAt, url: m.url }, pairError: null }; emit(); return; }
    if (m.type === 'pair.error') { state = { ...state, pairing: null, pairError: m.reason }; emit(); return; }
    if (m.type === 'recents') { state = { ...state, recents: m.recents }; emit(); return; }
    const byId = new Map(state.byId); const previews = new Map(state.previews); const threads = new Map(state.threads);
    let { recents, launcher, daemon, snapshotSeq } = state;
    switch (m.type) {
      case 'snapshot':
        byId.clear(); for (const s of m.sessions) byId.set(s.id, s); for (const id of previews.keys()) if (!byId.has(id)) previews.delete(id);
        recents = m.recents ?? []; launcher = m.launcher ?? null;
        daemon = m.daemon ?? null; snapshotSeq += 1; threads.clear();
        break;
      case 'session.updated': byId.set(m.session.id, m.session); break;
      case 'session.removed': byId.delete(m.id); previews.delete(m.id); threads.delete(m.id); break;
      case 'session.preview': previews.set(m.id, m.lines); break;
      case 'session.thread': threads.set(m.id, m.items); break;
      case 'session.thread.item': {
        const cur = threads.get(m.id);
        if (!cur) break;
        const at = cur.findIndex(i => i.id === m.item.id);
        threads.set(m.id, at >= 0 ? cur.map((i, k) => (k === at ? m.item : i)) : [...cur, m.item]);
        break;
      }
    }
    state = { ...state, byId, previews, threads, sessions: sorted(byId), recents, launcher, daemon, snapshotSeq }; emit();
  }
};

export function attachClient(client: DaemonClient): () => void {
  const a = client.onMessage(m => daemonStore.apply(m));
  const b = client.onStatus(s => daemonStore.setStatus(s));
  return () => { a(); b(); };
}
export const useDaemon = (): DaemonState => useSyncExternalStore(daemonStore.subscribe, daemonStore.getState, daemonStore.getState);
