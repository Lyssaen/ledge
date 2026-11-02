import type { Session } from '@ledge/protocol';
import { isArchived } from '@ledge/protocol';
import { basename } from 'node:path';
import { connect } from '../client.js';

/** The directory of the sessions an agent can reach (#20): the live ones, not archived; `self` (LEDGE_SESSION) marked
 *  `*`. Its project is the repository, with the worktree folder when it is one. */
export function formatWho(sessions: readonly Session[], self?: string): string {
  const live = sessions.filter(s => s.state !== 'exited' && !isArchived(s));
  if (live.length === 0) return 'aucune autre session';
  const rows = live.map(s => [
    s.id === self ? '*' : ' ', s.name, s.tool, s.state,
    `${s.repo ?? s.project}${s.worktree ? ` (${basename(s.cwd)})` : ''}`, s.branch ?? '-',
    `${s.topic ?? '-'}${s.source === 'hook_only' ? ' · lecture seule' : ''}`
  ]);
  const head = [' ', 'NOM', 'OUTIL', 'ÉTAT', 'PROJET', 'BRANCHE', 'SUJET'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
  return [head, ...rows].map(r => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join(' ')).join('\n');
}

/** `ledge who`: the directory, read from the daemon. */
export async function printWho(opts: { port?: number; self?: string } = {}): Promise<string> {
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
  catch { return 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)'; }
  try { return formatWho((await client.next('snapshot')).sessions, opts.self ?? process.env.LEDGE_SESSION); }
  finally { await client.close(); }
}
