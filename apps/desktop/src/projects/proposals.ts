import type { Proposal } from '@ledge/fleet';

/** The proposals handed to the editor (Settings › Projects, the chat), by pid, for the app's session: the navigation carries only
 *  the pid (`{ kind: 'project', proposal: pid }`). Kept tiny and type-only on its imports: it lives in the main chunk. */
const open = new Map<string, Proposal>();

/** Keeps `p` to be opened by its pid; returns the pid. */
export function rememberProposal(p: Proposal): string {
  open.set(p.pid, p);
  return p.pid;
}

export function proposalOf(pid: string): Proposal | undefined {
  return open.get(pid);
}
