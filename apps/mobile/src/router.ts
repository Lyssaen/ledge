import { useSyncExternalStore } from 'react';

/** Hash routes of the phone app. `#/thread/<sid>` and `#/request/<sid>/<key>` are also the entry points of a shared link. */
export type Route =
  | { name: 'inbox' }
  | { name: 'agents' }
  | { name: 'chat' }
  | { name: 'thread'; sessionId: string }
  | { name: 'terminal'; sessionId: string }
  | { name: 'request'; sessionId: string; key: string }
  | { name: 'connection' }
  | { name: 'login' }
  | { name: 'link' }
  | { name: 'key-changed' }
  | { name: 'update' };

const SIMPLE = ['agents', 'chat', 'connection', 'login', 'link', 'key-changed', 'update'] as const;
/** Routes of the removed Équipes tab, which a bookmark or a cached app may still carry: they open the agents. */
const REMOVED = ['teams', 'team', 'team-copy', 'role', 'live', 'compose'];

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'request' && parts.length === 3) return { name: 'request', sessionId: decodeURIComponent(parts[1]!), key: decodeURIComponent(parts[2]!) };
    if ((parts[0] === 'thread' || parts[0] === 'terminal') && parts.length === 2) return { name: parts[0], sessionId: decodeURIComponent(parts[1]!) };
  } catch { /* malformed escape: fall through to the inbox */ }
  if (REMOVED.includes(parts[0] ?? '')) return { name: 'agents' };
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

/*
 * Where the user came from, so « Retour » goes back to it instead of to a fixed screen. Each history entry of the app
 * carries its position (`history.state.ledge`, 0 for the one the app was opened on); `trail` holds the address seen at
 * each position since the page loaded (a reload forgets them, the positions stay).
 */
interface Mark { ledge: number }
const isMark = (v: unknown): v is Mark => typeof (v as Mark | null)?.ledge === 'number';
let position = 0;
let trail: (string | undefined)[] = [];
let replacing = false;

const mark = (at: number) => {
  try { globalThis.history.replaceState({ ...(globalThis.history.state as object | null), ledge: at }, ''); } catch { /* the entry stays unmarked */ }
};

function track(): void {
  const here = globalThis.location.hash;
  const state: unknown = globalThis.history.state;
  if (isMark(state)) position = state.ledge;
  else if (replacing) mark(position);
  else { position += 1; trail = trail.slice(0, position); mark(position); }
  replacing = false;
  trail[position] = here;
}

if (typeof globalThis.addEventListener === 'function' && globalThis.history && globalThis.location) {
  const state: unknown = globalThis.history.state;
  position = isMark(state) ? state.ledge : 0;
  if (!isMark(state)) mark(0);
  trail[position] = globalThis.location.hash;
  globalThis.addEventListener('hashchange', track);
}

/** Goes to `r` in place of the current entry (a redirect, not a step the user took). */
export const replaceRoute = (r: Route): void => { replacing = true; globalThis.location.replace(href(r)); };

/** The screen « Retour » leads to: the one before in this app when there is one, else `fallback`; `known` when it is the one before. */
export function backTarget(fallback: Route): { route: Route; known: boolean; inApp: boolean } {
  if (position === 0) return { route: fallback, known: false, inApp: false };
  const before = trail[position - 1];
  return before === undefined ? { route: fallback, known: false, inApp: true } : { route: parseRoute(before), known: true, inApp: true };
}

/** « Retour »: one step back in the app's history, or, opened here from outside (a shared link, a notification), to `fallback`. */
export function goBack(fallback: Route): void {
  if (position > 0) globalThis.history.back();
  else replaceRoute(fallback);
}

const subscribe = (fn: () => void) => { globalThis.addEventListener('hashchange', fn); return () => globalThis.removeEventListener('hashchange', fn); };
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => globalThis.location.hash, () => '');
  return parseRoute(hash);
}

/** Where the app may be sent from outside: what a push payload's `url` may be (the same shape PushPayloadSchema checks). */
const OPENABLE = /^\/#\/[A-Za-z0-9/%._~-]*$/;

/** The service worker's `{ type: 'ledge.open', url }` after a notification tap: goes to `url`; any other message is ignored. */
export function openFromWorker(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;
  const m = data as { type?: unknown; url?: unknown };
  if (m.type !== 'ledge.open' || typeof m.url !== 'string' || !OPENABLE.test(m.url)) return;
  globalThis.location.hash = m.url.slice(1);
}
