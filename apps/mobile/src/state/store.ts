import { useSyncExternalStore } from 'react';
import type { ServerMessage, Session } from '@ledge/protocol';
import { clearLastState, DEVICE_KEY, loadLastState, saveLastState } from './persist';

export type Link = 'unpaired' | 'connecting' | 'online' | 'offline';
export interface MobileState {
  link: Link;
  sessions: Session[];
  previews: Record<string, string[]>;
  syncedAt: string | null;
  device: { id: string; name: string } | null;
  pcName: string | null;
}
export interface MobileStore {
  getState(): MobileState;
  subscribe(fn: () => void): () => void;
  apply(msg: ServerMessage): void;
  setLink(l: Link): void;
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
  let state: MobileState = { link: 'connecting', sessions: last?.sessions ?? [], previews: last?.previews ?? {}, syncedAt: last?.syncedAt ?? null, device: loadDevice(storage), pcName: last?.pcName ?? null };
  const fns = new Set<() => void>();
  const set = (next: Partial<MobileState>, persist: boolean) => {
    state = { ...state, ...next };
    if (persist) saveLastState(state, storage);
    fns.forEach(f => f());
  };
  const now = () => new Date().toISOString();
  return {
    getState: () => state,
    subscribe: fn => { fns.add(fn); return () => { fns.delete(fn); }; },
    setLink: l => { if (l !== state.link) set({ link: l }, false); },
    reset: () => { clearLastState(storage); set({ link: 'unpaired', sessions: [], previews: {}, syncedAt: null, device: null, pcName: null }, false); },
    apply: msg => {
      switch (msg.type) {
        case 'auth.ok': {
          const device = { id: msg.deviceId, name: msg.deviceName };
          try { (storage ?? globalThis.localStorage)?.setItem(DEVICE_KEY, JSON.stringify(device)); } catch { /* ignore */ }
          set({ link: 'online', device, pcName: msg.pcName }, true);
          break;
        }
        case 'snapshot': {
          const ids = new Set(msg.sessions.map(s => s.id));
          const previews = Object.fromEntries(Object.entries(state.previews).filter(([id]) => ids.has(id)));
          set({ sessions: msg.sessions, previews, syncedAt: now() }, true);
          break;
        }
        case 'session.updated': {
          const has = state.sessions.some(s => s.id === msg.session.id);
          const sessions = has ? state.sessions.map(s => s.id === msg.session.id ? msg.session : s) : [...state.sessions, msg.session];
          set({ sessions, syncedAt: now() }, true);
          break;
        }
        case 'session.removed': {
          const { [msg.id]: _gone, ...previews } = state.previews;
          set({ sessions: state.sessions.filter(s => s.id !== msg.id), previews, syncedAt: now() }, true);
          break;
        }
        case 'session.preview':
          set({ previews: { ...state.previews, [msg.id]: msg.lines }, syncedAt: now() }, true);
          break;
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
