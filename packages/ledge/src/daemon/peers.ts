import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Session } from '@ledge/protocol';

/** A live Claude Code process that can receive messages: its name, and the address other agents send to. */
export type ClaudePeer = { pid: number; sessionId: string; name: string; address: string };

const defaultDir = (): string => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'sessions');

function parsePeer(path: string): ClaudePeer | undefined {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (typeof j.pid !== 'number' || typeof j.sessionId !== 'string' || typeof j.name !== 'string' || typeof j.messagingSocketPath !== 'string') return undefined;
    return { pid: j.pid, sessionId: j.sessionId, name: j.name, address: `uds:${j.messagingSocketPath}` };
  } catch { return undefined; }
}

/** Whether a process exists (`EPERM`: it does, but is not ours). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false; // 0 and -1 would signal a process group
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Every `<pid>.json` of Claude's sessions directory whose process is alive; unreadable or partial files are skipped, never throws. */
export function readPeers(dir: string = defaultDir(), alive: (pid: number) => boolean = pidAlive): ClaudePeer[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter(n => n.endsWith('.json')).flatMap(n => parsePeer(join(dir, n)) ?? []).filter(p => alive(p.pid));
}

/** The address of a session's live peer, by its transcript (follows `/clear` and `--resume`), else agent session id;
 *  none when several live processes hold that conversation (never a guess). */
export function addressOf(s: Pick<Session, 'agentSessionId' | 'transcriptPath'>, peers: readonly ClaudePeer[]): string | undefined {
  const t = s.transcriptPath && basename(s.transcriptPath, '.jsonl');
  const byTranscript = t ? peers.filter(p => p.sessionId === t) : [];
  const found = byTranscript.length ? byTranscript : peers.filter(p => s.agentSessionId && p.sessionId === s.agentSessionId);
  return found.length === 1 ? found[0]!.address : undefined;
}

/** A session name without the ` [ref]` Claude's peer list appends to it (`Pim [ab12]` → `Pim`). */
export const bareName = (name: string): string => name.replace(/ \[[^\]]*\]$/, '');

/** The Ledge session a Claude session id belongs to (by agent session id or transcript basename). */
const sessionOf = (id: string, sessions: readonly Session[]): Session | undefined => sessions.find(s => s.agentSessionId === id || s.transcriptPath?.endsWith(`/${id}.jsonl`));

/** Who `to` names, in the hook's order: a live `uds:` address (`via`, its peer), the live non-archived Ledge name, then
 *  the Claude name of one live peer (`reason` when several hold it). */
function lookup(to: string, sessions: readonly Session[], peers: readonly ClaudePeer[]): { target?: Session; via?: ClaudePeer; reason?: string } {
  const name = bareName(to);
  if (name.startsWith('uds:')) { const via = peers.find(p => p.address === name); return { target: via && sessionOf(via.sessionId, sessions), via }; }
  const t = sessions.find(s => s.name === name && s.state !== 'exited' && !s.archivedAt);
  if (t) return { target: t };
  const named = peers.filter(p => p.name === name);
  if (named.length > 1) return { reason: `plusieurs sessions s'appellent ${name}` };
  return { target: named[0] && sessionOf(named[0].sessionId, sessions) };
}

/** The Ledge session a message to `target` goes to, resolved as the hook resolves it; `peers` are the live ones. */
export function ledgePeer(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[]): Session | undefined {
  return lookup(target, sessions, peers).target;
}

export type Resolution =
  | { outcome: 'native'; target: Session; address: string }
  | { outcome: 'ledge'; target: Session }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'unknown' };

/** What to do with a SendMessage `to`: by `uds:` address, Ledge name, then Claude name; `peers` are the live ones. */
export function resolveTarget(to: string, sessions: readonly Session[], peers: readonly ClaudePeer[]): Resolution {
  const { target: t, via, reason } = lookup(to, sessions, peers);
  if (reason) return { outcome: 'refused', reason };
  if (!t) return { outcome: 'unknown' };
  if (t.source === 'hook_only') return { outcome: 'refused', reason: `${t.name} n'a pas été lancée par Ledge : impossible de lui écrire` };
  if (t.tool !== 'claude') return { outcome: 'ledge', target: t };
  // An address names its process: it is kept, even when another one holds the conversation too.
  const address = via?.address ?? addressOf(t, peers);
  return address ? { outcome: 'native', target: t, address } : { outcome: 'refused', reason: `${t.name} n'est pas joignable` };
}
