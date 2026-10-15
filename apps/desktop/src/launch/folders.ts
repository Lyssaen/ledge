import type { ServerMessage } from '@ledge/protocol';

export type Listing = Extract<ServerMessage, { type: 'folder.listing' }>;
/** What the browser asks the chosen machine; each is answered with a `folder.listing` to the asker only. */
export type FolderRequest = { type: 'folder.list'; path?: string } | { type: 'folder.create'; parent: string; name: string };
export interface Browser {
  shown: { path: string; parent: string | null; entries: string[] } | null;
  /** The request waiting for its listing, which decides how the answer (or its refusal) lands; one at a time. */
  pending: 'list' | 'create' | 'fallback' | null;
  /** The exact path a navigation asked for (a listing for another path is a late answer to an abandoned request); null = any. */
  expect: string | null;
  error: string | null;
  /** The machine refused the send or dropped while a request was pending. */
  offline: boolean;
}
export const BROWSER_START: Browser = { shown: null, pending: null, expect: null, error: null, offline: false };

export const childOf = (path: string, name: string) => (path === '/' ? `/${name}` : `${path}/${name}`);
/** The breadcrumb: the root, then each folder down to `path`, with the path that lists it (from the overlay). */
export function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  return [{ name: '/', path: '/' }, ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` }))];
}

/** Starts a request; null while another one waits (a click during a wait is ignored). */
export function ask(b: Browser, asked: 'list' | 'create', expect: string | null = null): Browser | null {
  return b.pending ? null : { ...b, pending: asked, expect, error: null, offline: false };
}

/** Lands a listing. One nobody waits for changes nothing. `next` is a request to send at once (the fallback to home). */
export function answer(b: Browser, l: Listing): { browser: Browser; next?: { type: 'folder.list' } } {
  if (!b.pending || (b.expect !== null && l.path !== b.expect)) return { browser: b };
  const at = { path: l.path, parent: l.parent, entries: l.entries };
  if (l.error) {
    // A refused creation lists its parent: stay there with the name to fix.
    if (b.pending === 'create') return { browser: { ...b, pending: null, expect: null, error: l.error, shown: at } };
    // The first folder cannot be listed: fall back to home, keeping the reason.
    if (b.pending === 'list' && !b.shown) return { browser: { ...b, pending: 'fallback', expect: null, error: l.error }, next: { type: 'folder.list' } };
    return { browser: { ...b, pending: null, expect: null, error: l.error } };
  }
  return { browser: { ...b, pending: null, expect: null, shown: at, error: b.pending === 'fallback' ? b.error : null } };
}

/** Nothing will answer: the machine refused the send or its connection dropped. */
export const unsent = (b: Browser): Browser => ({ ...b, pending: null, expect: null, offline: true });
