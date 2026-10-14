import { useSyncExternalStore } from 'react';

/** Hash routes (decision D12). Lots 3 and 4 add `#/thread/<sid>` and the push entry points. */
export type Route = { name: 'inbox' } | { name: 'request'; sessionId: string; pendingId: string } | { name: 'pair' } | { name: 'connection' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'request' && parts.length === 3) return { name: 'request', sessionId: decodeURIComponent(parts[1]!), pendingId: decodeURIComponent(parts[2]!) };
  } catch { /* malformed escape: fall through to the inbox */ }
  if (parts[0] === 'pair' && parts.length === 1) return { name: 'pair' };
  if (parts[0] === 'connection' && parts.length === 1) return { name: 'connection' };
  return { name: 'inbox' };
}

export function href(r: Route): string {
  if (r.name === 'request') return `#/request/${encodeURIComponent(r.sessionId)}/${encodeURIComponent(r.pendingId)}`;
  if (r.name === 'pair') return '#/pair';
  return r.name === 'connection' ? '#/connection' : '#/';
}

export const navigate = (r: Route): void => { globalThis.location.hash = href(r); };

const subscribe = (fn: () => void) => { globalThis.addEventListener('hashchange', fn); return () => globalThis.removeEventListener('hashchange', fn); };
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => globalThis.location.hash, () => '');
  return parseRoute(hash);
}
