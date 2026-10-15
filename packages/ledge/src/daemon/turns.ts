import { REPLY_MAX, type Session, type SessionEvent, type ThreadItem, type Turn } from '@ledge/protocol';
import type { Note } from './history.js';

/** Turns sent to a phone at most: the thread's latest. */
export const TURNS_MAX = 200;
/** Room for the hook's truncation mark after a capped reply (TurnSchema.text). */
const TEXT_MAX = REPLY_MAX + 16;

const cap = (text: string) => (text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text);

/**
 * The phone's view of a session's thread (mobile spec §6): what was said and decided, mapped from the shared thread
 * (history.ts). Fail closed: only the kinds named here go out. Actions, their inputs and outputs, the agent's
 * intermediate messages and the helpers' own threads stay on the PC; a helper's permission is the session's decision.
 */
export function phoneTurns(items: readonly ThreadItem[]): Turn[] {
  const turns: Turn[] = [];
  for (const it of items) {
    const t = turnOf(it);
    if (t) turns.push(t);
  }
  return turns.slice(-TURNS_MAX);
}

function turnOf(it: ThreadItem): Turn | null {
  const base = { id: it.id, at: it.at };
  switch (it.kind) {
    case 'prompt': return it.helperId ? null : { ...base, kind: 'prompt', text: cap(it.text), ...(it.source ? { source: it.source } : {}) };
    case 'reply': return it.helperId ? null : { ...base, kind: 'reply', text: cap(it.text) };
    case 'permission': {
      const pendingId = it.pendingId ? { pendingId: it.pendingId } : {};
      if (it.decision === 'accept' || it.decision === 'deny') return { ...base, kind: 'decision', decision: it.decision, source: it.source ?? 'pc', ...pendingId };
      // Seen to vanish: answered in the terminal.
      if (it.decision === 'unknown') return { ...base, kind: 'resolved', source: 'pc', ...pendingId };
      return null; // still open: the phone shows the session's pending request instead
    }
    case 'note': return {
      ...base, kind: it.note,
      ...(it.text !== undefined ? { text: cap(it.text) } : {}),
      ...(it.decision ? { decision: it.decision } : {}),
      ...(it.source ? { source: it.source } : {}),
      ...(it.pendingId ? { pendingId: it.pendingId } : {})
    };
    default: return null;
  }
}

/** When the agent last replied on the session's own thread (a helper's report is not the session's reply). */
export function lastReplyAt(items: readonly ThreadItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'reply' && !it.helperId) return it.at;
  }
  return undefined;
}

/**
 * A request that left the session on anything but a decision of Ledge's (`Decided`) or the end of the session was
 * settled in the terminal: a `resolved` note. Ledge's own decisions and answers are noted where they are made.
 */
export function resolvedBy(ev: SessionEvent, before: Session | undefined, after: Session | undefined): Note | null {
  if (!before?.pending || after?.pending || ev.name === 'Decided' || ev.name === 'SessionEnd' || ev.name === 'PaneGone') return null;
  return { note: 'resolved', source: 'pc', ...(before.pending.id ? { pendingId: before.pending.id } : {}) };
}
