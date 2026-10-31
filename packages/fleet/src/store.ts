import { useSyncExternalStore } from 'react';
import { isArchived, type ChatTurn, type LedgeThreadItem, type DaemonInfo, type Recent, type ServerMessage, type Session, type ThreadItem } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from './client';

/** A daemon `error` reply; `seq` tells two identical messages apart. */
export interface DaemonError { id?: string; message: string; seq: number; /** Le type du message refusé, quand le daemon le dit. */ request?: string; /** NOTE_NOT_TYPED… */ code?: string }
/** How many errors the store remembers. */
export const ERRORS_KEPT = 20;
/** The daemon's last `session.launched` answer (to this client's `session.launch`); `seq` tells two apart. */
export interface Launched { id: string; seq: number }
export interface AnswerAttempt { id: string; result?: { ok: boolean; code?: string; reason?: string } }
/** How many answer attempts the store remembers. */
export const ANSWERS_KEPT = 50;
/** Upsert by id (a known id is replaced in place), then sort by `at`; arrival order breaks ties. */
export function mergeThread(items: readonly LedgeThreadItem[], incoming: readonly LedgeThreadItem[]): LedgeThreadItem[] {
  const out = [...items];
  for (const it of incoming) { const at = out.findIndex(i => i.id === it.id); if (at >= 0) out[at] = it; else out.push(it); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
export interface DaemonState {
  /** The live sessions (archived ones excluded). */
  sessions: Session[];
  /** The archived sessions, most recently archived first. */
  archived: Session[]; byId: Map<string, Session>; status: DaemonStatus; previews: Map<string, string[]>; lastError: DaemonError | null;
  /** Les ERRORS_KEPT derniers `error`, du plus ancien au plus récent; `lastError` est le dernier. */
  errors: readonly DaemonError[];
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
  /** The Ledge thread (local daemon only), oldest first; `threadBefore` = cursor of the older page, absent when none. */
  ledgeThread: LedgeThreadItem[]; threadBefore?: string; threadLoading: boolean;
  /** The escalation answers sent, by rid, with the daemon's `rig.result` once it came. */
  answering: Map<string, AnswerAttempt>;
  /** The daemon's last update.progress / update.failed message; `seq` tells two identical ones apart. */
  lastUpdate: { msg: Extract<ServerMessage, { type: 'update.progress' | 'update.failed' }>; seq: number } | null;
}
/** The daemon's last `folder.listing` answer (to this client's `folder.list` or `folder.create`); `seq` tells two apart. */
export type FolderListing = Omit<Extract<ServerMessage, { type: 'folder.listing' }>, 'type'> & { seq: number };
const empty = (): DaemonState => ({ sessions: [], archived: [], byId: new Map(), status: 'connecting', previews: new Map(), threads: new Map(), lastError: null, errors: [], recents: [], launcher: null, lastLaunched: null, lastListing: null, chat: [], chatLive: null, daemon: null, snapshotSeq: 0, ledgeThread: [], threadLoading: false, answering: new Map(), lastUpdate: null });
const archivedOf = (m: Map<string, Session>) => [...m.values()].filter(isArchived).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') || a.id.localeCompare(b.id));
let state: DaemonState = empty();
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const sorted = (m: Map<string, Session>) => [...m.values()].filter(s => !isArchived(s)).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

export const daemonStore = {
  getState: () => state,
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
  setStatus(status: DaemonStatus) { state = { ...state, status }; emit(); },
  reset() { state = empty(); emit(); },
  /** The overlay lists its own question at once; the daemon's events fill it in. */
  beginTurn(turn: ChatTurn) { state = { ...state, chat: [...state.chat.filter(t => t.qid !== turn.qid), turn], chatLive: null }; emit(); },
  /** A request for the older page is on its way. */
  beginThreadLoad() { state = { ...state, threadLoading: true }; emit(); },
  /** An escalation answer was sent under `rid`. */
  beginAnswer(rid: string, id: string) { state = { ...state, answering: new Map([...state.answering, [rid, { id }]].slice(-ANSWERS_KEPT) as [string, AnswerAttempt][]) }; emit(); },
  /** Settles an attempt without a result yet (no answer in time). */
  settleAnswer(rid: string, result: NonNullable<AnswerAttempt['result']>) {
    const a = state.answering.get(rid); if (!a || a.result) return;
    state = { ...state, answering: new Map(state.answering).set(rid, { ...a, result }) }; emit();
  },
  apply(m: ServerMessage) {
    if (m.type === 'ledge.thread.history') {
      // The page asked for (loading) goes before what is held; a history after a snapshot is the newest page, merged in.
      const older = state.threadLoading;
      const heldOlder = state.ledgeThread.length > 0 && m.items.length > 0 && state.ledgeThread[0]!.at < m.items.reduce((lo, i) => (i.at < lo ? i.at : lo), m.items[0]!.at);
      const threadBefore = older || !heldOlder ? m.before : state.threadBefore;
      const { threadBefore: _o, ...rest } = state;
      state = { ...rest, ledgeThread: mergeThread(state.ledgeThread, m.items), threadLoading: false, ...(threadBefore !== undefined ? { threadBefore } : {}) }; emit(); return;
    }
    if (m.type === 'ledge.thread.item') { state = { ...state, ledgeThread: mergeThread(state.ledgeThread, [m.item]) }; emit(); return; }
    if (m.type === 'rig.result') {
      const a = state.answering.get(m.rid); if (!a) return;
      state = { ...state, answering: new Map(state.answering).set(m.rid, { ...a, result: { ok: m.ok, ...(m.code ? { code: m.code } : {}), ...(m.reason ? { reason: m.reason } : {}) } }) }; emit(); return;
    }
    if (m.type === 'chat.history') { state = { ...state, chat: m.turns, chatLive: null }; emit(); return; }
    if (m.type === 'chat.step' || m.type === 'chat.delta' || m.type === 'chat.done' || m.type === 'chat.error') {
      const chat = state.chat.map(t => t.qid !== m.qid ? t
        : m.type === 'chat.step' ? { ...t, steps: [...t.steps, m.step] }
        : m.type === 'chat.done' ? { ...t, answer: m.text, answeredAt: m.at, ...(m.proposal ? { proposal: m.proposal } : {}), ...(m.proposals ? { proposals: m.proposals } : {}), ...(m.relay ? { relay: m.relay } : {}), ...(m.closes ? { closes: m.closes } : {}), ...(m.projectProposal ? { projectProposal: m.projectProposal } : {}), ...(m.actions ? { actions: m.actions } : {}) }
        : m.type === 'chat.error' ? { ...t, error: m.message } : t);
      const chatLive = m.type === 'chat.delta' ? { qid: m.qid, text: (state.chatLive?.qid === m.qid ? state.chatLive.text : '') + m.text } : m.type === 'chat.step' ? state.chatLive : null;
      state = { ...state, chat, chatLive }; emit(); return;
    }
    if (m.type === 'error') {
      const e: DaemonError = { id: m.id, message: m.message, seq: (state.lastError?.seq ?? 0) + 1, ...(m.request ? { request: m.request } : {}), ...(m.code ? { code: m.code } : {}) };
      state = { ...state, lastError: e, errors: [...state.errors, e].slice(-ERRORS_KEPT) }; emit(); return;
    }
    if (m.type === 'session.launched') { state = { ...state, lastLaunched: { id: m.id, seq: (state.lastLaunched?.seq ?? 0) + 1 } }; emit(); return; }
    if (m.type === 'folder.listing') { const { type: _, ...l } = m; state = { ...state, lastListing: { ...l, seq: (state.lastListing?.seq ?? 0) + 1 } }; emit(); return; }
    if (m.type === 'update.progress' || m.type === 'update.failed') { state = { ...state, lastUpdate: { msg: m, seq: (state.lastUpdate?.seq ?? 0) + 1 } }; emit(); return; }
    if (m.type === 'recents') { state = { ...state, recents: m.recents }; emit(); return; }
    const byId = new Map(state.byId); const previews = new Map(state.previews); const threads = new Map(state.threads);
    let { recents, launcher, daemon, snapshotSeq } = state;
    switch (m.type) {
      case 'snapshot':
        byId.clear(); for (const s of m.sessions) byId.set(s.id, s); for (const id of previews.keys()) if (!byId.has(id)) previews.delete(id);
        recents = m.recents ?? []; launcher = m.launcher ?? null;
        daemon = m.daemon ?? null; snapshotSeq += 1;
        // A session frozen by keepStale (spec 2026-10-14 §6) keeps the thread already received: its machine cannot be
        // asked again, and Desktop reads it while it is offline. Every other thread is asked again after a snapshot.
        for (const id of [...threads.keys()]) if (!byId.get(id)?.offline) threads.delete(id);
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
    state = { ...state, byId, previews, threads, sessions: sorted(byId), archived: archivedOf(byId), recents, launcher, daemon, snapshotSeq }; emit();
  }
};

export function attachClient(client: DaemonClient): () => void {
  const a = client.onMessage(m => daemonStore.apply(m));
  const b = client.onStatus(s => daemonStore.setStatus(s));
  return () => { a(); b(); };
}
export const useDaemon = (): DaemonState => useSyncExternalStore(daemonStore.subscribe, daemonStore.getState, daemonStore.getState);
