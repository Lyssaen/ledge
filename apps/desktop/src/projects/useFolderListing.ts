import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';

export type Listing =
  | { status: 'loading' }
  | { status: 'ready'; path: string; parent: string | null; entries: string[]; repos: ReadonlyMap<string, string> }
  | { status: 'error'; message: string };

/** How long a listing may take: an older daemon drops the requestId, and the fleet relays no answer without it. */
export const LISTING_TIMEOUT_MS = 10_000;
const LOADING: Listing = { status: 'loading' };
let next = 0;

/** A folder's subfolders on one machine (its home when `path` is undefined), with the Git repositories among them and their branch:
 *  one `folder.list` per (machine, path, attempt), with its own requestId; an answer to another request, or a late one, is ignored.
 *  Loading while it is asked, and when there is no machine; an error after LISTING_TIMEOUT_MS of silence. A new `attempt` asks again. */
export function useFolderListing(client: DaemonClient, machine: string | null, path: string | undefined, attempt = 0): Listing {
  const { t } = useI18n();
  const timeout = t.projects.picker.timeout;
  const key = machine === null ? null : JSON.stringify([machine, path ?? null, attempt]);
  const [answer, setAnswer] = useState<{ key: string; listing: Listing } | null>(null);
  useEffect(() => {
    if (key === null || machine === null) return;
    const requestId = `folder-${++next}`;
    let done = false;
    const settle = (listing: Listing) => { if (done) return; done = true; clearTimeout(timer); off(); setAnswer({ key, listing }); };
    const off = client.onMessage(m => {
      if (m.type !== 'folder.listing' || m.requestId !== requestId) return;
      settle(m.error !== undefined
        ? { status: 'error', message: m.error }
        : { status: 'ready', path: m.path, parent: m.parent, entries: m.entries, repos: new Map((m.repos ?? []).map(r => [r.name, r.branch])) });
    });
    const timer = setTimeout(() => settle({ status: 'error', message: timeout }), LISTING_TIMEOUT_MS);
    client.send({ type: 'folder.list', ...(path === undefined ? {} : { path }), machineId: machine, requestId });
    return () => { done = true; clearTimeout(timer); off(); };
  }, [client, key, machine, path, timeout]);
  return answer && answer.key === key ? answer.listing : LOADING;
}
