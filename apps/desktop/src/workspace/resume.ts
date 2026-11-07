import { splitId } from '@ledge/fleet';
import { isArchived, type Session } from '@ledge/protocol';
import { readJson, writeJson } from '../state/storage';
import { sessionOf, type Workspace } from './model';

/** The sessions that had a tab open and were alive, kept as the run goes: the ones a stop of Ledge kills, resumed at the next start. */
export const LIVE_TABS_KEY = 'ledge.ide.liveTabs';

/** A session Ledge resumes by itself: launched by Ledge, not an OpenRig seat (OpenRig restarts those), not archived. */
const resumable = (s: Session): boolean => s.source === 'launcher' && !s.rig && !isArchived(s);

/** The machine a session id is on (`local` for an id without one). */
export const machineOf = (id: string): string => splitId(id)?.machine ?? 'local';

/** The sessions with a tab (theirs, their Changes, their Terminal) that are alive now, sorted. */
export function liveTabs(w: Workspace, known: readonly Session[]): string[] {
  const open = new Set<string>();
  for (const g of w.groups) for (const t of g.tabs) { const sid = sessionOf(t); if (sid !== null) open.add(sid); }
  return known.filter(s => open.has(s.id) && resumable(s) && s.state !== 'exited').map(s => s.id).sort();
}

/** The memo after a change: the ids of machines not ready yet are kept as they were (their sessions are not known yet);
 *  those of ready machines are what `liveTabs` says now. A session ended during the run leaves it, so it is not resumed. */
export function nextMemo(memo: readonly string[], live: readonly string[], ready: ReadonlySet<string>): string[] {
  return [...new Set([...memo.filter(id => !ready.has(machineOf(id))), ...live.filter(id => ready.has(machineOf(id)))])].sort();
}

/** What the start resumes from the memo read then: the sessions now ended (killed by the stop) that their machine can resume. */
export function toResume(memo: readonly string[], known: readonly Session[], allowed: (id: string) => boolean): string[] {
  return memo.filter(id => {
    const s = known.find(x => x.id === id);
    return !!s && resumable(s) && s.state === 'exited' && !s.offline && allowed(id);
  });
}

export function loadLiveTabs(): string[] {
  const raw = readJson(LIVE_TABS_KEY);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}
export const saveLiveTabs = (ids: readonly string[]): void => writeJson(LIVE_TABS_KEY, ids);
