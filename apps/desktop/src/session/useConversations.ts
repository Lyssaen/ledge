import { useEffect, useMemo, useRef } from 'react';
import { qualify, splitId, useDaemon, type DaemonClient } from '@ledge/fleet';
import type { Session, ThreadItem } from '@ledge/protocol';
import { conversation, conversationName, conversationPeer, type Bubble } from './conversation';
import { useThreads } from './useThread';

/** One Conversation tab: the page's agent (A) and one peer (B), merged from both threads. */
export interface ConversationView {
  /** The peer as A's thread names it (peerKey): the tab's own key. */
  key: string;
  /** B's session; null: not one Ledge follows here (one side only, its raw name). */
  peer: Session | null;
  /** B's name: its session's, else the raw name A's thread gives. */
  name: string;
  bubbles: readonly Bubble[];
  /** B's thread is being read for the first time (A's side shows meanwhile). */
  loading: boolean;
  /** Messages added while the tab was not the active one (its dot); a status changing is not one. */
  unseen: number;
}

const NONE: readonly ThreadItem[] = [];
/** A tab's bubbles and the two threads they were merged from. */
type Merged = { a: readonly ThreadItem[]; b: readonly ThreadItem[] | undefined; bubbles: readonly Bubble[] };

/** The merge again, its unchanged bubbles kept as they were (the rows are memoised on them), and the same list when nothing
 *  in it changed (another item of A's thread, a tool run, leaves the tab alone). */
function remerge(prev: readonly Bubble[] | undefined, next: Bubble[]): readonly Bubble[] {
  if (!prev) return next;
  const byKey = new Map(prev.map(x => [x.key, x]));
  const kept = next.map(x => {
    const p = byKey.get(x.key);
    return p && p.from === x.from && p.at === x.at && p.summary === x.summary && p.text === x.text && p.status === x.status && p.inA === x.inA && p.inB === x.inB ? p : x;
  });
  return kept.length === prev.length && kept.every((x, i) => x === prev[i]) ? prev : kept;
}

/** A view per open Conversation tab (`keys`: their peerKeys), at the page's level: SidePane mounts only the active tab.
 *  B's thread is asked while its tab is open, active or not; each view's bubbles keep their identity while neither thread
 *  changes. `active`: the tab the reader sees (its peerKey, the pane shown), whose messages are all seen; null: none. */
export function useConversations(client: Pick<DaemonClient, 'send'>, self: Session, items: readonly ThreadItem[] | undefined, keys: readonly string[], active: string | null): ReadonlyMap<string, ConversationView> {
  const { byId } = useDaemon();
  const a = items ?? NONE;
  const own = splitId(self.id);
  const machine = own?.machine ?? 'local';
  const selfId = own?.id ?? self.id;
  // What A's thread says of each peer (its raw id, else null: one side only; its raw name), read again only when A's thread
  // or the tabs change. B is resolved on A's own machine, as the thread's peers are (Thread.tsx usePeers).
  const named = useMemo(() => keys.map(key => ({ raw: conversationPeer(a, key), name: conversationName(a, key) })), [a, keys]);
  const peers = named.map(({ raw }) => (raw === null ? null : byId.get(qualify(machine, raw)) ?? null));
  const threads = useThreads(client, peers.filter((s): s is Session => s !== null));
  const cache = useRef(new Map<string, Merged>());
  // How many messages each tab held when last seen. A count that drops (both agents ran /clear) takes it down too, so the
  // messages that come after still count; while B's thread is first read, an inactive tab's is left as it was. Written
  // once the render is committed: the unseen counts below come from the same render.
  const seen = useRef<ReadonlyMap<string, number>>(new Map());
  const nextSeen = new Map<string, number>();
  const kept = new Map<string, Merged>();
  const out = new Map<string, ConversationView>();
  keys.forEach((key, i) => {
    const peer = peers[i]!;
    const b = peer ? threads.get(peer.id) : undefined;
    const last = cache.current.get(key);
    const bubbles = last && last.a === a && last.b === b ? last.bubbles : remerge(last?.bubbles, conversation(a, b, key, selfId));
    kept.set(key, { a, b, bubbles });
    const loading = peer !== null && peer.offline !== true && b === undefined;
    const base = seen.current.get(key);
    const count = bubbles.length;
    const baseline = key === active || base === undefined ? count : loading ? base : Math.min(base, count);
    nextSeen.set(key, baseline);
    out.set(key, { key, peer, name: peer?.name ?? named[i]!.name, bubbles, loading, unseen: Math.max(0, count - baseline) });
  });
  cache.current = kept;
  // Closed tabs' baselines go with them.
  useEffect(() => { seen.current = nextSeen; });
  return out;
}
