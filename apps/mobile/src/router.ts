import { useSyncExternalStore } from 'react';

/** Hash routes of the phone app. `#/thread/<sid>` and `#/request/<sid>/<key>` are also the entry points of a shared link. */
export type Route =
  | { name: 'inbox' }
  | { name: 'agents' }
  | { name: 'thread'; sessionId: string }
  | { name: 'terminal'; sessionId: string }
  | { name: 'request'; sessionId: string; key: string }
  | { name: 'connection' }
  | { name: 'login' }
  | { name: 'link' }
  | { name: 'key-changed' }
  | { name: 'update' };

const SIMPLE = ['agents', 'connection', 'login', 'link', 'key-changed', 'update'] as const;

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'request' && parts.length === 3) return { name: 'request', sessionId: decodeURIComponent(parts[1]!), key: decodeURIComponent(parts[2]!) };
    if ((parts[0] === 'thread' || parts[0] === 'terminal') && parts.length === 2) return { name: parts[0], sessionId: decodeURIComponent(parts[1]!) };
  } catch { /* malformed escape: fall through to the inbox */ }
  const simple = SIMPLE.find((n) => n === parts[0]);
  if (simple && parts.length === 1) return { name: simple };
  return { name: 'inbox' };
}

export function href(r: Route): string {
  if (r.name === 'request') return `#/request/${encodeURIComponent(r.sessionId)}/${encodeURIComponent(r.key)}`;
  if (r.name === 'thread' || r.name === 'terminal') return `#/${r.name}/${encodeURIComponent(r.sessionId)}`;
  return r.name === 'inbox' ? '#/' : `#/${r.name}`;
}

export const navigate = (r: Route): void => { globalThis.location.hash = href(r); };

const subscribe = (fn: () => void) => { globalThis.addEventListener('hashchange', fn); return () => globalThis.removeEventListener('hashchange', fn); };
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => globalThis.location.hash, () => '');
  return parseRoute(hash);
}
