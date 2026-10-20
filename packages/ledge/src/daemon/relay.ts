import type { ChatRelay, Session } from '@ledge/protocol';
import type { Chat, ChatMessage } from '../chat/service.js';
import type { ChatThreadId, ChatThreads } from '../chat/threads.js';
import type { Store } from './store.js';
import { log } from '../log.js';

export interface Relay { request(qid: string): Promise<void>; /** Hands the session on to whatever waits for it (its next queued card, else the mailbox): after a thread's cards vanished. */ settle(id: string): void; cancel(qid: string): void; close(): void }
export interface RelayDeps {
  /** Every chat thread (the PC's and each device's): an instruction lives in, and answers to, the thread that owns its qid. */
  threads: Pick<ChatThreads, 'all' | 'owner' | 'emitterOf'>; store: Pick<Store, 'get' | 'onChange'>;
  /**
   * session.reply's path: null once typed and taken, the refusal otherwise; rejects when the injection fails.
   * The queue relies on this: once it resolves null, the session has already left idle (the server's verified injection applies
   * Decided -> working), which keeps a second queued card from following in the same free moment. On a failure the server moves the
   * session to `error`, which counts as free, so a Retry goes at once.
   */
  replyTo: (id: string, text: string) => Promise<string | null>;
  now?: () => string;
  /** Sessions being typed into, shared with the mailbox so the two never type into one session at once. */
  typing?: Set<string>;
  /** A refused delivery left the session free with no card queued for it: whatever else waits for it (the mailbox) goes now. */
  next?: (id: string) => void;
}

/** Free to take a typed instruction: its turn (or in error, where session.reply types too), nothing pending. */
export const free = (s: Session | undefined): s is Session => !!s && (s.state === 'idle' || s.state === 'error') && !s.pending;
const stopped = (name: string) => `${name} stopped before it got the instruction`;

/**
 * The chat cards' instructions (spec 2026-10-12 relay §4): typed now into a free session, else queued in the turn and typed at the
 * session's next free moment, one per free moment, oldest first. The queue is the turns' `relay.status`: a reset or a new day empties it.
 */
export function createRelay(d: RelayDeps): Relay {
  const now = d.now ?? (() => new Date().toISOString());
  // A session stays idle while its instruction is being typed: these keep a second one, or the same one twice, from following it.
  const typing = d.typing ?? new Set<string>(); const sending = new Set<string>();

  /** A thread's emitter, looked up at the moment it is needed: a dropped device thread has none, and nothing here may throw for it. */
  const emitTo = (thread: ChatThreadId) => (m: ChatMessage): void => {
    try { d.threads.emitterOf(thread)?.(m); } catch (e) { log(`relay emit to ${thread} failed: ${(e as Error).message}`); }
  };
  const chatOf = (thread: ChatThreadId): Pick<Chat, 'relay' | 'markRelay' | 'queuedRelays'> | undefined => d.threads.all().find(([id]) => id === thread)?.[1];
  const mark = (thread: ChatThreadId, qid: string, patch: Parameters<Chat['markRelay']>[1]) => chatOf(thread)?.markRelay(qid, patch, emitTo(thread));
  /** Every thread's queued cards, oldest turn first (desktop's thread, then the thread's own order, break a tie). */
  function queued(): Array<{ thread: ChatThreadId; qid: string; relay: ChatRelay; askedAt: string }> {
    const out = d.threads.all().flatMap(([thread, c]) => c.queuedRelays(emitTo(thread)).map(q => ({ thread, ...q })));
    return out.map((q, i) => ({ q, i })).sort((a, b) => (a.q.askedAt < b.q.askedAt ? -1 : a.q.askedAt > b.q.askedAt ? 1 : 0) || a.i - b.i).map(x => x.q);
  }
  const markQueued = (thread: ChatThreadId, qid: string) => mark(thread, qid, { status: 'queued' });

  async function deliver(thread: ChatThreadId, qid: string, r: ChatRelay): Promise<string | null> {
    typing.add(r.id); sending.add(qid);
    try {
      let refused: string | null;
      try { refused = await d.replyTo(r.id, r.text); } catch (e) { refused = (e as Error).message; }
      if (refused) { log(`relay ${qid} to ${r.id} failed: ${refused}`); mark(thread, qid, { error: refused }); }
      else mark(thread, qid, { status: 'sent', sentAt: now() });
      return refused;
    } finally { typing.delete(r.id); sending.delete(qid); }
  }

  /** Delivers the session's oldest queued card when it is free and nothing is being typed into it. */
  function kick(id: string): void {
    const q = queued().find(x => x.relay.id === id);
    if (!q || typing.has(id) || !free(d.store.get(id))) return;
    void deliverAndKick(q.thread, q.qid, q.relay).catch(e => log(`relay ${q.qid} failed: ${(e as Error).message}`));
  }
  /** After a refused delivery the session is still free: the next queued card must not wait for an unrelated store change. */
  async function deliverAndKick(thread: ChatThreadId, qid: string, r: ChatRelay): Promise<string | null> {
    const refused = await deliver(thread, qid, r);
    if (refused) {
      if (queued().some(q => q.relay.id === r.id)) kick(r.id);
      else if (free(d.store.get(r.id)) && !typing.has(r.id)) d.next?.(r.id);
    }
    return refused;
  }

  const unsubscribe = d.store.onChange(c => {
    try {
      if (c.type === 'recents') return;
      const id = c.type === 'updated' ? c.session.id : c.id;
      const q = queued().filter(x => x.relay.id === id);
      if (q.length === 0) return;
      const s = c.type === 'updated' ? c.session : undefined;
      if (!s || s.state === 'exited') { for (const x of q) if (!sending.has(x.qid)) { mark(x.thread, x.qid, { error: stopped(x.relay.name) }); } return; }
      if (free(s) && !typing.has(id)) kick(id);
    } catch (e) { log(`relay change handler failed: ${(e as Error).message}`); }
  });

  return {
    async request(qid) {
      const thread = d.threads.owner(qid);
      const r = thread && chatOf(thread)?.relay(qid);
      if (!thread || !r) throw new Error('unknown relay');
      if (r.status === 'sent' || sending.has(qid)) throw new Error('already sent');
      if (r.status === 'queued') throw new Error('already queued');
      const s = d.store.get(r.id);
      if (!s || s.state === 'exited') { const m = stopped(r.name); mark(thread, qid, { error: m }); throw new Error(m); }
      if (free(s) && !typing.has(r.id)) {
        if (queued().some(q => q.relay.id === r.id)) { markQueued(thread, qid); kick(r.id); return; }
        const refused = await deliverAndKick(thread, qid, r); if (refused) throw new Error(refused); return;
      }
      markQueued(thread, qid);
    },
    cancel(qid) {
      if (sending.has(qid)) throw new Error('already sent');
      const thread = d.threads.owner(qid);
      if (!thread || chatOf(thread)?.relay(qid)?.status !== 'queued') throw new Error('nothing queued');
      mark(thread, qid, {});
    },
    settle(id) {
      try {
        if (queued().some(q => q.relay.id === id)) kick(id);
        else if (free(d.store.get(id)) && !typing.has(id)) d.next?.(id);
      } catch (e) { log(`relay settle failed: ${(e as Error).message}`); }
    },
    close: unsubscribe
  };
}
