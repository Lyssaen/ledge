import type { ServerMessage } from './messages.js';
import type { Pending, Session } from './session.js';

/**
 * The closed notch's activity line: one line for every agent, made from what the daemon already broadcasts to every local
 * front (`snapshot`, `session.updated`, `session.removed`, `session.thread.item`). Nothing new travels on the wire: this
 * module only reads those messages and says which of them is an activity worth a line.
 *
 * An activity carries data, never words: the front writes the line (FR/EN) as the notch's mockup says.
 *   message       an agent sent a message to another agent (`out`), or received one from an agent Ledge does not know (`in`)
 *   tool          an action started (`label` is the thread's one-line label of the call: « Edit src/a.ts », « npm test »)
 *   thinking      the agent works with no action running: its prompt just arrived, or an action just ended mid-turn
 *   notification  the agent needs the user (`permission`, `question`, `plan`, `diff`), finished its turn, or failed
 *
 * `session` is the Ledge session id (its name, tool and rig are in the snapshot); `helperId` marks a sub-agent's activity.
 */
export type NotchActivity =
  | { kind: 'message'; session: string; at: string; helperId?: string; direction: 'out' | 'in';
      /** `out`: the address it wrote to; `in`: the sender's name. */
      counterpart: string;
      /** The Ledge session on the other end, when it is one. */
      peer?: string;
      /** The message's own one-line summary, else its first line. */
      summary: string }
  | { kind: 'tool'; session: string; at: string; helperId?: string; tool: string; label: string }
  | { kind: 'thinking'; session: string; at: string; helperId?: string }
  | { kind: 'notification'; session: string; at: string; reason: NotificationReason;
      /** The question or request as the agent put it, the error's message; left out when there is none. */
      text?: string };

export type NotificationReason = Pending['kind'] | 'finished' | 'error';

/** Messages first (the user's word: « priorité aux messages »), then what needs the user, then the rest. */
export const ACTIVITY_RANK: Record<NotchActivity['kind'], number> = { message: 3, notification: 2, tool: 1, thinking: 1 };

/** Whether `next` may take the line from `current` while `current` still shows: a lower-ranked activity waits. */
export function outranks(next: NotchActivity, current: NotchActivity | null | undefined): boolean {
  return !current || ACTIVITY_RANK[next.kind] >= ACTIVITY_RANK[current.kind];
}

/** How many thread items the feed remembers having seen, so a re-broadcast (a status change) is not a new activity. */
const SEEN_MAX = 4000;

export interface ActivityFeed {
  /** Reads one daemon message: the activity it is, or null. A snapshot only teaches the feed the sessions' states. */
  push(msg: ServerMessage): NotchActivity | null;
}

/** One feed per connection (a new connection starts with a snapshot, which resets nothing that matters). */
export function createActivityFeed(): ActivityFeed {
  const sessions = new Map<string, Session>();
  const seen = new Map<string, true>();
  const firstSight = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.set(key, true);
    if (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value!);
    return true;
  };
  const helper = (helperId: string | undefined) => (helperId ? { helperId } : {});
  /** The actions running, by session and helper (`<session>/<helper>`): an agent thinks only once none runs. */
  const running = new Map<string, Set<string>>();
  const lane = (session: string, helperId: string | undefined) => `${session}/${helperId ?? ''}`;
  const forget = (session: string) => { for (const k of [...running.keys()]) if (k.startsWith(`${session}/`)) running.delete(k); };

  return {
    push(msg) {
      switch (msg.type) {
        case 'snapshot':
          sessions.clear();
          running.clear();
          for (const s of msg.sessions) sessions.set(s.id, s);
          return null;
        case 'session.removed':
          sessions.delete(msg.id);
          forget(msg.id);
          return null;
        case 'session.updated': {
          const prev = sessions.get(msg.session.id);
          sessions.set(msg.session.id, msg.session);
          // A turn that ends leaves nothing running (an interrupted action never reports its end).
          if (msg.session.state !== 'working') forget(msg.session.id);
          return prev ? fromTransition(prev, msg.session) : null;
        }
        case 'session.thread.item': {
          const { id: session, item } = msg;
          const s = sessions.get(session);
          if (s?.archivedAt) return null;
          switch (item.kind) {
            case 'sent':
              if (item.status === 'failed' || !firstSight(`${session}/${item.id}`)) return null;
              return { kind: 'message', session, at: item.at, ...helper(item.helperId), direction: 'out', counterpart: item.to,
                ...(item.peer ? { peer: item.peer } : {}), summary: summaryOf(item.summary, item.text) };
            case 'received':
              // Paired with a sent card: the sender's line already said it.
              if (item.sent || !firstSight(`${session}/${item.id}`)) return null;
              return { kind: 'message', session, at: item.at, ...helper(item.helperId), direction: 'in', counterpart: item.from,
                ...(item.peer ? { peer: item.peer } : {}), summary: summaryOf(undefined, item.text) };
            case 'tool':
            {
              const key = lane(session, item.helperId);
              if (item.status === 'running') {
                if (!firstSight(`${session}/${item.id}`)) return null;
                running.set(key, (running.get(key) ?? new Set()).add(item.id));
                return { kind: 'tool', session, at: item.at, ...helper(item.helperId), tool: item.tool, label: item.label };
              }
              // An action that ends while the turn goes on and no other action of that agent still runs: the agent is
              // back to thinking. Its end is seen once.
              const lanes = running.get(key);
              lanes?.delete(item.id);
              if (lanes?.size === 0) running.delete(key);
              if (!firstSight(`${session}/${item.id}/end`) || s?.state !== 'working' || (lanes?.size ?? 0) > 0) return null;
              return { kind: 'thinking', session, at: item.at, ...helper(item.helperId) };
            }
            case 'prompt':
              return firstSight(`${session}/${item.id}`) ? { kind: 'thinking', session, at: item.at, ...helper(item.helperId) } : null;
            default:
              return null;
          }
        }
        default:
          return null;
      }
    }
  };
}

/** A session's change of state that needs the user, or ends its turn. */
function fromTransition(prev: Session, next: Session): NotchActivity | null {
  if (next.archivedAt) return null;
  const at = next.lastActivityAt;
  const base = { kind: 'notification' as const, session: next.id, at };
  const p = next.pending;
  if (p && (next.state === 'waiting_permission' || next.state === 'waiting_input')) {
    const same = prev.pending && prev.state === next.state && prev.pending.kind === p.kind && prev.pending.text === p.text;
    return same ? null : { ...base, reason: p.kind, ...(p.text ? { text: p.text } : {}) };
  }
  if (next.state === 'error' && prev.state !== 'error') return { ...base, reason: 'error', ...(next.lastError ? { text: next.lastError } : {}) };
  if (prev.state === 'working' && (next.state === 'idle' || next.state === 'waiting_input')) return { ...base, reason: 'finished' };
  return null;
}

/** The message's own summary, else its first non-empty line, on one line. */
function summaryOf(summary: string | undefined, text: string): string {
  const s = summary?.trim() || text.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  return s.replace(/\s+/g, ' ');
}
