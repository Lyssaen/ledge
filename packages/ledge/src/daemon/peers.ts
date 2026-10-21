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

/** The Ledge session a peer name (`name` or `name [ref]`) or address (`uds:…/<pid>.sock`) belongs to. */
export function peerFor(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[], dir: string = defaultDir(), alive: (pid: number) => boolean = pidAlive): Session | undefined {
  const name = bareName(target);
  const found = peers.filter(p => p.name === name || p.address === name);
  if (!found.length && name.startsWith('uds:') && name.endsWith('.sock')) {
    const pid = basename(name, '.sock');
    const direct = /^\d+$/.test(pid) ? parsePeer(join(dir, `${pid}.json`)) : undefined;
    if (direct && alive(direct.pid)) found.push(direct);
  }
  for (const { sessionId: id } of found) {
    const s = sessions.find(s => s.agentSessionId === id || s.transcriptPath?.endsWith(`/${id}.jsonl`));
    if (s) return s;
  }
  return undefined;
}

/** The Ledge session a message to `target` goes to: Claude's peer when it is one, else the live session of that Ledge name. */
export function ledgePeer(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[]): Session | undefined {
  const name = bareName(target);
  return peerFor(target, peers, sessions) ?? sessions.find(s => s.name === name && s.state !== 'exited');
}
