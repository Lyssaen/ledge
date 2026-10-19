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

/** Every `<pid>.json` of Claude's sessions directory; unreadable or partial files are skipped, never throws. */
export function readPeers(dir: string = defaultDir()): ClaudePeer[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter(n => n.endsWith('.json')).flatMap(n => parsePeer(join(dir, n)) ?? []);
}

/** The Ledge session a peer name (`name` or `name [ref]`) or address (`uds:…/<pid>.sock`) belongs to. */
export function peerFor(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[], dir: string = defaultDir()): Session | undefined {
  const name = target.replace(/ \[[^\]]*\]$/, '');
  const found = peers.filter(p => p.name === name || p.address === name);
  if (!found.length && name.startsWith('uds:') && name.endsWith('.sock')) {
    const pid = basename(name, '.sock');
    const direct = /^\d+$/.test(pid) ? parsePeer(join(dir, `${pid}.json`)) : undefined;
    if (direct) found.push(direct);
  }
  for (const { sessionId: id } of found) {
    const s = sessions.find(s => s.agentSessionId === id || s.transcriptPath?.endsWith(`/${id}.jsonl`));
    if (s) return s;
  }
  return undefined;
}

/** The Ledge session a message to `target` goes to: Claude's peer when it is one, else the live session of that Ledge name. */
export function ledgePeer(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[]): Session | undefined {
  const name = target.replace(/ \[[^\]]*\]$/, '');
  return peerFor(target, peers, sessions) ?? sessions.find(s => s.name === name && s.state !== 'exited');
}
