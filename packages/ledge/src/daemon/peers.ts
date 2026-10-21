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
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Every `<pid>.json` of Claude's sessions directory whose process is alive; unreadable or partial files are skipped, never throws. */
export function readPeers(dir: string = defaultDir(), alive: (pid: number) => boolean = pidAlive): ClaudePeer[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter(n => n.endsWith('.json')).flatMap(n => parsePeer(join(dir, n)) ?? []).filter(p => alive(p.pid));
}

/** The address of a session's live peer, by its transcript (follows `/clear` and `--resume`) or agent session id. */
export function addressOf(s: Pick<Session, 'agentSessionId' | 'transcriptPath'>, peers: readonly ClaudePeer[]): string | undefined {
  const t = s.transcriptPath && basename(s.transcriptPath, '.jsonl');
  return (peers.find(p => t && p.sessionId === t) ?? peers.find(p => s.agentSessionId && p.sessionId === s.agentSessionId))?.address;
}

/** A session name without the ` [ref]` Claude's peer list appends to it (`Pim [ab12]` → `Pim`). */
export const bareName = (name: string): string => name.replace(/ \[[^\]]*\]$/, '');

/** The Ledge session a Claude session id belongs to (by agent session id or transcript basename). */
const sessionOf = (id: string, sessions: readonly Session[]): Session | undefined => sessions.find(s => s.agentSessionId === id || s.transcriptPath?.endsWith(`/${id}.jsonl`));

/** The Ledge session a peer name (`name` or `name [ref]`) or address (`uds:…/<pid>.sock`) belongs to. */
export function peerFor(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[], dir: string = defaultDir(), alive: (pid: number) => boolean = pidAlive): Session | undefined {
  const name = bareName(target);
  const found = peers.filter(p => p.name === name || p.address === name);
  if (!found.length && name.startsWith('uds:') && name.endsWith('.sock')) {
    const pid = basename(name, '.sock');
    const direct = /^\d+$/.test(pid) ? parsePeer(join(dir, `${pid}.json`)) : undefined;
    if (direct && alive(direct.pid)) found.push(direct);
  }
  for (const { sessionId } of found) {
    const s = sessionOf(sessionId, sessions);
    if (s) return s;
  }
  return undefined;
}

/** The Ledge session a message to `target` goes to: Claude's peer when it is one, else the live session of that Ledge name. */
export function ledgePeer(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[]): Session | undefined {
  const name = bareName(target);
  return peerFor(target, peers, sessions) ?? sessions.find(s => s.name === name && s.state !== 'exited');
}

export type Resolution =
  | { outcome: 'native'; target: Session; address: string }
  | { outcome: 'ledge'; target: Session }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'unknown' };

/** What to do with a SendMessage `to`: by `uds:` address, Ledge name, then Claude name; `peers` are the live ones. */
export function resolveTarget(to: string, sessions: readonly Session[], peers: readonly ClaudePeer[]): Resolution {
  const name = bareName(to);
  let t: Session | undefined;
  if (name.startsWith('uds:')) {
    const p = peers.find(p => p.address === name);
    t = p && sessionOf(p.sessionId, sessions);
  } else {
    t = sessions.find(s => s.name === name && s.state !== 'exited' && !s.archivedAt);
    if (!t) {
      const named = peers.filter(p => p.name === name);
      if (named.length > 1) return { outcome: 'refused', reason: `plusieurs sessions s'appellent ${name}` };
      t = named[0] && sessionOf(named[0].sessionId, sessions);
    }
  }
  if (!t) return { outcome: 'unknown' };
  if (t.source === 'hook_only') return { outcome: 'refused', reason: `${t.name} n'a pas été lancée par Ledge : impossible de lui écrire` };
  if (t.tool !== 'claude') return { outcome: 'ledge', target: t };
  const address = addressOf(t, peers);
  return address ? { outcome: 'native', target: t, address } : { outcome: 'refused', reason: `${t.name} n'est pas joignable` };
}
