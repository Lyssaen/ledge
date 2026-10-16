import type { Session } from '@ledge/protocol';

/** What a pending request is, whatever refreshes around it: its kind, its text and the helper it comes from; null without a request. */
export function requestKey(s: Pick<Session, 'pending'>): string | null {
  const p = s.pending;
  return p ? `${p.kind}\n${p.text}\n${p.helperId ?? ''}` : null;
}
