import { useSyncExternalStore } from 'react';

/** Hash routes of the phone app. The sign-in, a changed key and a new version are not routes: the link's state shows them (App.tsx). `#/thread/<sid>` and `#/request/<sid>/<key>` are also the entry points of a shared link. */
export type Route =
  /** « À toi », the app's first screen (`#/`). */
  | { name: 'atoi' }
  /** « Sessions » (`#/sessions`; `#/agents`, its old address, still leads there); `#/sessions/working` opens it on « Au travail »
   *  (« Voir les N autres » in « À toi »), `#/sessions/waiting` on « En attente ». */
  | { name: 'sessions'; filter?: 'waiting' | 'working' }
  /** « MR/PR » and « Rigs »: what the PC does not send to the phone yet (docs/mockups/ledge-mobile-refonte/m0-socle.html, §3). */
  | { name: 'prs' }
  | { name: 'rigs' }
  /** The Atelier (iPad, a PC with `daemon.atelier`); `#/atelier/<sid>` has a session's panel open over it, `#/atelier/<sid>/request/<key>`
   *  one of its requests, to decide there. */
  | { name: 'atelier'; sessionId?: string; requestKey?: string }
  | { name: 'chat' }
  | { name: 'thread'; sessionId: string }
  | { name: 'terminal'; sessionId: string }
  | { name: 'request'; sessionId: string; key: string }
  /** An OpenRig ask in full (`#/ask/<qitem>`), opened from its card in « À toi » (m1-a-toi.html §2, §12). */
  | { name: 'ask'; id: string }
  /** Réglages; `#/connection/link` opens it on its « Connexion » section (the host pill). */
  | { name: 'connection'; section?: 'link' }
  /** A rig of the Rigs tab (`#/rigs/<rig>`), the kernel and its daemon (`#/kernel`), and Max's goals (`#/max`, `#/max/<goalId>` one of them as a
   *  thread): docs/mockups/ledge-mobile-refonte/m4-rigs.html. */
  | { name: 'rig'; rig: string }
  | { name: 'kernel' }
  | { name: 'max'; goalId?: string }
  /** « Nouvelle session » (`#/new`): launches an agent on the PC (m2-sessions.html §9, m2-lancement.html). */
  | { name: 'launch' }
  /** A pull or merge request of the MR/PR tab (`#/prs/<id>`, its id `host/repo#n` escaped): docs/mockups/ledge-mobile-refonte/m5-mr-pr.html. */
  | { name: 'pr'; id: string };

/** Every route, as the Ledge guide (docs/ledge-guide.md) must describe them: a Record, so a new route fails to compile until it is listed here. */
const ROUTE_NAME: Record<Route['name'], true> = { atoi: true, sessions: true, prs: true, rigs: true, atelier: true, chat: true, thread: true, terminal: true, request: true, ask: true, connection: true, rig: true, kernel: true, max: true, launch: true, pr: true };
export const ROUTE_NAMES = Object.keys(ROUTE_NAME) as Route['name'][];

const SIMPLE = ['sessions', 'prs', 'rigs', 'chat', 'connection', 'kernel', 'max'] as const;
/** Routes whose address is not their name. */
const NEW = 'new';

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'request' && parts.length === 3) return { name: 'request', sessionId: decodeURIComponent(parts[1]!), key: decodeURIComponent(parts[2]!) };
    if (parts[0] === 'ask' && parts.length === 2) return { name: 'ask', id: decodeURIComponent(parts[1]!) };
    if ((parts[0] === 'thread' || parts[0] === 'terminal') && parts.length === 2) return { name: parts[0], sessionId: decodeURIComponent(parts[1]!) };
    if (parts[0] === 'atelier' && parts.length === 4 && parts[2] === 'request') return { name: 'atelier', sessionId: decodeURIComponent(parts[1]!), requestKey: decodeURIComponent(parts[3]!) };
    if (parts[0] === 'atelier' && parts.length <= 2) return parts[1] ? { name: 'atelier', sessionId: decodeURIComponent(parts[1]) } : { name: 'atelier' };
    if (parts[0] === 'connection' && parts.length === 2 && parts[1] === 'link') return { name: 'connection', section: 'link' };
    if (parts[0] === 'rigs' && parts.length === 2) return { name: 'rig', rig: decodeURIComponent(parts[1]!) };
    if (parts[0] === 'prs' && parts.length === 2) return { name: 'pr', id: decodeURIComponent(parts[1]!) };
    if (parts[0] === 'max' && parts.length === 2) return { name: 'max', goalId: decodeURIComponent(parts[1]!) };
    if (parts[0] === 'sessions' && parts.length === 2 && (parts[1] === 'working' || parts[1] === 'waiting')) return { name: 'sessions', filter: parts[1] };
  } catch { /* malformed escape: fall through to À toi */ }
  if (parts[0] === 'agents' && parts.length === 1) return { name: 'sessions' };
  if (parts[0] === NEW && parts.length === 1) return { name: 'launch' };
  const simple = SIMPLE.find((n) => n === parts[0]);
  if (simple && parts.length === 1) return { name: simple };
  return { name: 'atoi' };
}

export function href(r: Route): string {
  if (r.name === 'request') return `#/request/${encodeURIComponent(r.sessionId)}/${encodeURIComponent(r.key)}`;
  if (r.name === 'ask') return `#/ask/${encodeURIComponent(r.id)}`;
  if (r.name === 'thread' || r.name === 'terminal') return `#/${r.name}/${encodeURIComponent(r.sessionId)}`;
  if (r.name === 'atelier') return !r.sessionId ? '#/atelier'
    : r.requestKey ? `#/atelier/${encodeURIComponent(r.sessionId)}/request/${encodeURIComponent(r.requestKey)}` : `#/atelier/${encodeURIComponent(r.sessionId)}`;
  if (r.name === 'connection' && r.section) return `#/connection/${r.section}`;
  if (r.name === 'rig') return `#/rigs/${encodeURIComponent(r.rig)}`;
  if (r.name === 'pr') return `#/prs/${encodeURIComponent(r.id)}`;
  if (r.name === 'max' && r.goalId) return `#/max/${encodeURIComponent(r.goalId)}`;
  if (r.name === 'sessions' && r.filter) return `#/sessions/${r.filter}`;
  if (r.name === 'launch') return `#/${NEW}`;
  return r.name === 'atoi' ? '#/' : `#/${r.name}`;
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
