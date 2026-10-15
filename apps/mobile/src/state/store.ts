import { useSyncExternalStore } from 'react';
import type { ClientMessage, ServerMessage, Session, Turn } from '@ledge/protocol';
import { isNew, loadOps, matches, opsReducer, saveOps, toCheck, type OpEvent, type OpState } from '../model/operations';
import { setBadge } from '../push/handlers';
import { requestsOf } from '../model/requests';
import { clearLastState, DEVICE_KEY, loadLastState, saveLastState, saveTurns } from './persist';

export type Link = 'unpaired' | 'connecting' | 'online' | 'offline';
export interface MobileState {
  link: Link;
  sessions: Session[];
  previews: Record<string, string[]>;
  syncedAt: string | null;
  device: { id: string; name: string } | null;
  pcName: string | null;
  /** Decisions and replies made from this phone, and where each stands. */
  ops: Record<string, OpState>;
  /** Each opened thread as the PC last sent it (`session.turns`), in the PC's order; kept in memory only. */
  turns: Record<string, Turn[]>;
  /** The daemon's Web Push public key, from `auth.ok`; null until authenticated (or for a daemon without push). */
  vapidPublicKey: string | null;
  /** True once this connection's snapshot has arrived: until then a persisted state is only the last one seen. */
  live: boolean;
}
export interface MobileStore {
  getState(): MobileState;
  subscribe(fn: () => void): () => void;
  apply(msg: ServerMessage): void;
  setLink(l: Link): void;
  /** How messages reach the socket (set by the remote client). */
  setSender(send: (m: ClientMessage) => void): void;
  /** Send an operation now, only on an authenticated link: never queued, never retried. */
  submit(op: OpState, msg: ClientMessage): boolean;
  /** Ask the daemon where every uncertain operation ended up (`operation.status`); never resends a decision. */
  checkOperations(): void;
  /** Send a request that is not an operation (a challenge request), on an authenticated link only. */
  send(msg: ClientMessage): boolean;
  /** Every server message, as it arrives (used to await a reply to a request). */
  listen(fn: (msg: ServerMessage) => void): () => void;
  /** Feed the operations model (e.g. `resumed` on return to the foreground). */
  dispatch(e: OpEvent): void;
  /** Forget the PC's data (token refused or revoked). */
  reset(): void;
}

function loadDevice(storage?: Storage): MobileState['device'] {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(DEVICE_KEY);
    const v = raw ? JSON.parse(raw) as { id?: unknown; name?: unknown } : null;
    return v && typeof v.id === 'string' && typeof v.name === 'string' ? { id: v.id, name: v.name } : null;
  } catch { return null; }
}

export function createMobileStore(storage?: Storage): MobileStore {
  const last = loadLastState(storage);
  let state: MobileState = { link: 'connecting', sessions: last?.sessions ?? [], previews: last?.previews ?? {}, syncedAt: last?.syncedAt ?? null, device: loadDevice(storage), pcName: last?.pcName ?? null, ops: loadOps(storage), turns: last?.turns ?? {}, vapidPublicKey: null, live: false };
  let send: ((m: ClientMessage) => void) | null = null;
  const fns = new Set<() => void>();
  const listeners = new Set<(msg: ServerMessage) => void>();
  const set = (next: Partial<MobileState>, persist: boolean) => {
    state = { ...state, ...next };
    if (persist) saveLastState(state, storage);
    fns.forEach(f => f());
  };
  const now = () => new Date().toISOString();
  const dispatch = (e: OpEvent) => {
    const ops = opsReducer(state.ops, e);
    if (ops === state.ops) return;
    state = { ...state, ops };
    saveOps(ops, storage);
    fns.forEach(f => f());
  };
  return {
    getState: () => state,
    subscribe: fn => { fns.add(fn); return () => { fns.delete(fn); }; },
    setLink: l => { if (l !== state.link) { set(l === 'online' ? { link: l } : { link: l, live: false }, false); dispatch({ type: 'link', link: l }); } },
    setSender: f => { send = f; },
    dispatch,
    send: msg => {
      if (state.link !== 'online' || !send) return false;
      send(msg);
      return true;
    },
    listen: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    checkOperations: () => { if (state.link === 'online') for (const operationId of toCheck(state.ops)) send?.({ type: 'operation.status', operationId }); },
    submit: (op, msg) => {
      if (state.link !== 'online' || !send) return false;
      if (!matches(op, msg) || !isNew(state.ops, op)) return false;
      send(msg);
      dispatch({ type: 'sent', op });
      return true;
    },
    reset: () => { clearLastState(storage); saveOps({}, storage); set({ link: 'unpaired', sessions: [], previews: {}, syncedAt: null, device: null, pcName: null, ops: {}, turns: {}, vapidPublicKey: null, live: false }, false); },
    apply: msg => {
      listeners.forEach(f => f(msg));
      switch (msg.type) {
        case 'auth.ok': {
          const device = { id: msg.deviceId, name: msg.deviceName };
          try { (storage ?? globalThis.localStorage)?.setItem(DEVICE_KEY, JSON.stringify(device)); } catch { /* ignore */ }
          set({ link: 'online', device, pcName: msg.pcName, vapidPublicKey: msg.vapidPublicKey ?? null }, true);
          for (const operationId of toCheck(state.ops)) send?.({ type: 'operation.status', operationId });
          break;
        }
        case 'snapshot': {
          const ids = new Set(msg.sessions.map(s => s.id));
          const previews = Object.fromEntries(Object.entries(state.previews).filter(([id]) => ids.has(id)));
          const turns = Object.fromEntries(Object.entries(state.turns).filter(([id]) => ids.has(id)));
          const dropped = Object.keys(turns).length !== Object.keys(state.turns).length;
          set({ sessions: msg.sessions, previews, turns, syncedAt: now(), live: true }, true);
          void setBadge(requestsOf(msg.sessions).length);
          if (dropped) saveTurns(turns, storage);
          break;
        }
        case 'session.updated': {
          const has = state.sessions.some(s => s.id === msg.session.id);
          const sessions = has ? state.sessions.map(s => s.id === msg.session.id ? msg.session : s) : [...state.sessions, msg.session];
          set({ sessions, syncedAt: now() }, true);
          void setBadge(requestsOf(sessions).length);
          break;
        }
        case 'session.removed': {
          const { [msg.id]: _gone, ...previews } = state.previews;
          const { [msg.id]: goneTurns, ...turns } = state.turns;
          set({ sessions: state.sessions.filter(s => s.id !== msg.id), previews, turns, syncedAt: now() }, true);
          void setBadge(requestsOf(state.sessions).length);
          if (goneTurns !== undefined) saveTurns(turns, storage);
          break;
        }
        case 'session.preview':
          set({ previews: { ...state.previews, [msg.id]: msg.lines }, syncedAt: now() }, true);
          break;
        // Rows are replaced by id in the PC's order: a reply updated in place keeps its row, and no time sort is applied.
        case 'session.turns': {
          set({ turns: { ...state.turns, [msg.id]: msg.turns } }, false);
          saveTurns(state.turns, storage);
          break;
        }
        case 'operation.received': dispatch({ type: 'received', operationId: msg.operationId }); break;
        case 'operation.result': dispatch({ type: 'result', operationId: msg.operationId, status: msg.status, ...(msg.reason ? { reason: msg.reason } : {}) }); break;
        default: break;
      }
    }
  };
}

/** The app's single store; components read it through `useMobile`. */
export const mobileStore = createMobileStore();
export function useMobile(store: MobileStore = mobileStore): MobileState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
