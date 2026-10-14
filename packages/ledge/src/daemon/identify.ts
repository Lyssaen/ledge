import type { Pending, Session } from '@ledge/protocol';

/** What makes a request a different ask: a change in any of these bumps the version of the same id. */
export function pendingKey(p: Pending): string {
  return JSON.stringify([p.kind, p.text, p.tool ?? null, p.options ?? null, p.helperId ?? null, p.reason ?? null]);
}

/** The session with an id, version 1 and `since` given to a pending that has none; identical when it has an id or no pending. */
export function withIdentity(s: Session, at: string): Session {
  const p = s.pending;
  if (!p || p.id) return s;
  const seq = (s.pendingSeq ?? 0) + 1;
  return { ...s, pendingSeq: seq, pending: { ...p, id: `p${seq}-${Date.parse(at).toString(36)}`, version: 1, since: at } };
}

/** Gives a new request its id and bumps the version of a request whose content changed; identical when nothing changes. */
export function identify(before: Session, after: Session, at: string): Session {
  if (after === before || !after.pending) return after;
  const p = after.pending;
  if (!p.id) return withIdentity(after, at);
  if (before.pending?.id === p.id && pendingKey(before.pending) !== pendingKey(p)) {
    return { ...after, pending: { ...p, version: (before.pending.version ?? 1) + 1 } };
  }
  return after;
}
