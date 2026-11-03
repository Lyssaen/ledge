import type { Projects, Session } from '@ledge/protocol';
import { isArchived, isStoppedOmpSeat, projectOf } from '@ledge/protocol';
import { basename } from 'node:path';
import { connect, type Client } from '../client.js';

/** The directory of the sessions an agent can reach (#20): the live ones, not archived, and the stopped OMP seats of OpenRig
 *  (`exited`), so an agent sees that one will not answer; `self` (LEDGE_SESSION) marked `*`. Its project is the daemon's project (`projects`, the name `@projet:` takes) when the session is in one, else the
 *  repository, with the worktree folder when it is one. */
export function formatWho(sessions: readonly Session[], self?: string, projects?: Projects): string {
  const live = sessions.filter(s => (s.state !== 'exited' && !isArchived(s)) || isStoppedOmpSeat(s));
  if (live.length === 0) return 'aucune autre session';
  const rows = live.map(s => [
    s.id === self ? '*' : ' ', s.name, s.tool, s.state,
    registryName(s, projects) ?? `${s.repo ?? s.project}${s.worktree ? ` (${basename(s.cwd)})` : ''}`, s.branch ?? '-',
    `${s.topic ?? '-'}${s.source === 'hook_only' ? ' · lecture seule' : ''}`
  ]);
  const head = [' ', 'NOM', 'OUTIL', 'ÉTAT', 'PROJET', 'BRANCHE', 'SUJET'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
  return [head, ...rows].map(r => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join(' ')).join('\n');
}

function registryName(s: Session, projects: Projects | undefined): string | undefined {
  if (!projects) return undefined;
  const id = projectOf(s, projects);
  return id ? projects.projects.find(p => p.id === id)?.name : undefined;
}

/** The directory from a connected client: its snapshot, then the projects the daemon sends after it (none from an older one). */
export async function whoOnClient(client: Client, self: string | undefined, timeoutMs = 1500): Promise<string> {
  const sessions = (await client.next('snapshot', timeoutMs)).sessions;
  const projects = await client.next('projects', Math.min(timeoutMs, 500)).then(m => m.projects, () => undefined);
  return formatWho(sessions, self, projects);
}

/** `ledge who`: the directory, read from the daemon. */
export async function printWho(opts: { port?: number; self?: string } = {}): Promise<string> {
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
  catch { return 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)'; }
  try { return await whoOnClient(client, opts.self ?? process.env.LEDGE_SESSION); }
  finally { await client.close(); }
}
