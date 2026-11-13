import type { ChatTurn } from '@ledge/protocol';

// The operator point's rules every front shares, without the DOM: the Desktop's shell reads them outside the chat's chunk.

/** The last point turn of the thread and the highest journal event it shows: what `operator.read` marks read once it is seen. */
export function newestPointRead(turns: readonly ChatTurn[]): { qid: string; eventId: number } | null {
  const t = [...turns].reverse().find(x => x.point);
  if (!t?.point) return null;
  return { qid: t.qid, eventId: t.point.items.reduce((m, i) => Math.max(m, i.event), 0) };
}
