import type { ServerMessage, Session } from '@ledge/protocol';

/** Who receives the projection: the device, and whether a session's thread holds replies it has not read. */
export interface RemoteView { deviceId: string; unread(sessionId: string): boolean }

/** A phone never learns the tmux session name (it cannot attach to it, and it says nothing it needs); it learns its own unread. */
const projectSession = (s: Session, view: RemoteView): Session => ({ ...s, tmuxSession: null, unread: view.unread(s.id) });

/**
 * What a remote peer may receive (decision D2): an allow-list by message type, everything else is dropped (null).
 * The snapshot loses `launcher`, `recents` and `daemon`; every `pair.*` message is dropped. Later lots add their types to the switch.
 */
export function toRemote(msg: ServerMessage, view: RemoteView): ServerMessage | null {
  switch (msg.type) {
    case 'snapshot': return { type: 'snapshot', sessions: msg.sessions.map(s => projectSession(s, view)) };
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
