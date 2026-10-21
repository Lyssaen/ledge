import { useRef } from 'react';
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
}

const NONE: readonly ThreadItem[] = [];
/** A tab's bubbles and the two threads they were merged from. */
type Merged = { a: readonly ThreadItem[]; b: readonly ThreadItem[] | undefined; bubbles: readonly Bubble[] };

/** A view per open Conversation tab (`keys`: their peerKeys), at the page's level: SidePane mounts only the active tab.
 *  B's thread is asked while its tab is open, active or not; each view's bubbles keep their identity while neither thread
 *  changes. */
export function useConversations(client: Pick<DaemonClient, 'send'>, self: Session, items: readonly ThreadItem[] | undefined, keys: readonly string[]): ReadonlyMap<string, ConversationView> {
  const { byId } = useDaemon();
  const a = items ?? NONE;
  const own = splitId(self.id);
  const machine = own?.machine ?? 'local';
  const selfId = own?.id ?? self.id;
  // B is resolved on A's own machine, as the thread's peers are (Thread.tsx usePeers).
  const peers = keys.map(key => {
    const raw = conversationPeer(a, key);
    return raw === null ? null : byId.get(qualify(machine, raw)) ?? null;
  });
  const threads = useThreads(client, peers.filter((s): s is Session => s !== null));
  const cache = useRef(new Map<string, Merged>());
  const kept = new Map<string, Merged>();
  const out = new Map<string, ConversationView>();
  keys.forEach((key, i) => {
    const peer = peers[i]!;
    const b = peer ? threads.get(peer.id) : undefined;
    const last = cache.current.get(key);
    const bubbles = last && last.a === a && last.b === b ? last.bubbles : conversation(a, b, key, selfId);
    kept.set(key, { a, b, bubbles });
    out.set(key, { key, peer, name: peer?.name ?? conversationName(a, key), bubbles, loading: peer !== null && peer.offline !== true && b === undefined });
  });
  cache.current = kept;
  return out;
}
