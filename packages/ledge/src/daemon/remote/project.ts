import type { Helper, Pending, ServerMessage, Session } from '@ledge/protocol';
import { capabilitiesByTool } from '../../adapters/index.js';

/** Who receives the projection: the device, and whether a session's thread holds replies it has not read. */
export interface RemoteView { deviceId: string; unread(sessionId: string): boolean }

/** The session fields a phone receives (fail closed: a field added to Session later stays on the PC until listed here). */
const SESSION_FIELDS = [
  'id', 'name', 'tool', 'cwd', 'project', 'title', 'topic', 'topicSource', 'repo', 'repoPath', 'branch', 'worktree', 'state',
  'pendingSeq', 'lastReply', 'startedAt', 'lastActivityAt', 'lastHookAt', 'exitCode', 'exitedAt', 'lastError', 'source'
] as const satisfies readonly (keyof Session)[];
/** The request fields a phone needs to decide (the plan's `body`, each option's details), and nothing else. */
const PENDING_FIELDS = [
  'id', 'version', 'since', 'reason', 'kind', 'text', 'body', 'tool', 'options', 'optionDetails', 'risk', 'riskReason', 'source', 'helperId', 'parentState'
] as const satisfies readonly (keyof Pending)[];
const HELPER_FIELDS = ['id', 'kind', 'task', 'state'] as const satisfies readonly (keyof Helper)[];

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/**
 * A phone never learns the tmux session name (it cannot attach to it, and it says nothing it needs), where the agent's
 * transcript lives on the PC, the agent's own session id or the overlay's machine annotations; it learns its own unread.
 */
const projectSession = (s: Session, view: RemoteView): Session => ({
  ...pick(s, SESSION_FIELDS),
  ...(s.pending ? { pending: pick(s.pending, PENDING_FIELDS) } : {}),
  helpers: s.helpers.map(h => pick(h, HELPER_FIELDS)),
  tmuxSession: null,
  unread: view.unread(s.id)
});

/**
 * What a remote peer may receive (decision D2): an allow-list by message type, everything else is dropped (null).
 * The snapshot loses `launcher`, `recents` and `daemon`, and gains what each tool can answer (`capabilities`); every `pair.*` message is dropped. Later lots add their types to the switch.
 */
export function toRemote(msg: ServerMessage, view: RemoteView): ServerMessage | null {
  switch (msg.type) {
    case 'snapshot': return { type: 'snapshot', sessions: msg.sessions.map(s => projectSession(s, view)), capabilities: capabilitiesByTool() };
    case 'session.updated': return { type: 'session.updated', session: projectSession(msg.session, view) };
    case 'session.removed':
    case 'session.preview':
    case 'error':
    case 'auth.ok':
    // Sent to the asking peer only (never broadcast): the challenge for its own decision and the fate of its own operation.
    case 'decide.challenge':
    case 'operation.received':
    case 'operation.result':
    // The thread of a session, to the peer that asked for it.
    case 'session.turns':
      return msg;
    // Pairing never goes through a peer: `pair.code` is the PC's secret (decision D5), and the remote entry writes
    // `pair.challenge`, `pair.done` and `pair.error` straight to the unauthenticated socket that asked.
    default: return null;
  }
}
