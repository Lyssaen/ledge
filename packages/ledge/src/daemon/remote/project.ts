import type { ServerMessage, Session } from '@ledge/protocol';

/** A phone never learns the tmux session name: it cannot attach to it, and it says nothing it needs. */
const projectSession = (s: Session): Session => ({ ...s, tmuxSession: null });

/**
 * What a remote peer may receive (decision D2): an allow-list by message type, everything else is dropped (null).
 * The snapshot loses `launcher`, `recents` and `daemon`. Later lots add their types to the switch.
 */
export function toRemote(msg: ServerMessage, _view: { deviceId: string }): ServerMessage | null {
  switch (msg.type) {
    case 'snapshot': return { type: 'snapshot', sessions: msg.sessions.map(projectSession) };
    case 'session.updated': return { type: 'session.updated', session: projectSession(msg.session) };
    case 'session.removed':
    case 'session.preview':
    case 'error':
    case 'auth.ok':
    case 'pair.code':
    case 'pair.challenge':
    case 'pair.done':
    case 'pair.error':
      return msg;
    default: return null;
  }
}
