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
  let peer = peers.find(p => p.name === name || p.address === name);
  if (!peer && name.startsWith('uds:') && name.endsWith('.sock')) {
    const pid = basename(name, '.sock');
    if (/^\d+$/.test(pid)) peer = parsePeer(join(dir, `${pid}.json`));
  }
  if (!peer) return undefined;
  const id = peer.sessionId;
  return sessions.find(s => s.agentSessionId === id || s.transcriptPath?.endsWith(`/${id}.jsonl`));
}
