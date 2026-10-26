// The conversation between the page's agent (A) and one peer (B), merged from both threads: each message once, in the
// order it was sent. The builder ports this as is (session/conversation.ts) with its tests.
import type { ReceivedItem, SentItem, ThreadItem } from '@ledge/protocol';
import { peerKey } from '../../../apps/desktop/src/session/exchanges';

export interface Bubble {
  /** Unique in the conversation: `a:<id>` when A's thread holds the message, else `b:<id>` (ids are unique per thread only). */
  key: string;
  /** Who wrote it: A (the page's agent, on the right, as « sent » in the thread) or B. */
  from: 'a' | 'b';
  /** When it was sent: the sender's own item when known, else the receiver's. */
  at: string;
  summary?: string;
  text: string;
  /** What the sender's item says; 'read' for a message A received whose sender's item is not known (A's hook delivered it). */
  status: SentItem['status'];
  /** The item in A's thread (lit in place); undefined: A's thread does not hold it (yet). */
  inA?: string;
  /** The item in B's thread (« voir son fil »); undefined: B's thread is not known. */
  inB?: string;
}

const main = (i: ThreadItem): i is SentItem | ReceivedItem => (i.kind === 'sent' || i.kind === 'received') && i.helperId === undefined;

/** `key`: the peer as A's thread names it (peerKey); `selfId`: A's raw daemon id, as B's thread names A (its `peer`).
 *  `b`: B's thread, undefined when Ledge does not know B (one side only) or has not read it yet. */
export function conversation(a: readonly ThreadItem[], b: readonly ThreadItem[] | undefined, key: string, selfId: string): Bubble[] {
  const mineA = a.filter(main).filter(i => peerKey(i) === key);
  const mineB = (b ?? []).filter(main).filter(i => i.peer === selfId);
  const sentB = new Map(mineB.flatMap(i => (i.kind === 'sent' ? [[i.id, i] as const] : [])));
  const out: Bubble[] = [];
  const seenB = new Set<string>();
  for (const i of mineA) {
    if (i.kind === 'sent') {
      // A's message; B's copy (its received item) adds nothing the sender's item does not say.
      const copy = mineB.find(r => r.kind === 'received' && (r.sent === i.id || r.id === i.received));
      if (copy) seenB.add(copy.id);
      out.push({ key: `a:${i.id}`, from: 'a', at: i.at, ...(i.summary && { summary: i.summary }), text: i.text, status: i.status, inA: i.id, ...(copy && { inB: copy.id }) });
    } else {
      // B's message as A received it: the sender's item gives its time and summary.
      const orig = i.sent !== undefined ? sentB.get(i.sent) : undefined;
      if (orig) seenB.add(orig.id);
      out.push({ key: `a:${i.id}`, from: 'b', at: orig?.at ?? i.at, ...(orig?.summary && { summary: orig.summary }), text: i.text, status: 'read', inA: i.id, ...(orig && { inB: orig.id }) });
    }
  }
  // What only B's thread holds: B's messages A has not received yet; A's messages A's thread no longer holds (a /clear).
  for (const i of mineB) {
    if (seenB.has(i.id)) continue;
    if (i.kind === 'sent') out.push({ key: `b:${i.id}`, from: 'b', at: i.at, ...(i.summary && { summary: i.summary }), text: i.text, status: i.status, inB: i.id });
    else out.push({ key: `b:${i.id}`, from: 'a', at: i.at, text: i.text, status: 'read', inB: i.id });
  }
  return out.sort((x, y) => x.at.localeCompare(y.at));
}
