import type { ChatRelay, Session } from '@ledge/protocol';
import type { Chat, ChatMessage } from '../chat/service.js';
import type { Store } from './store.js';
import { log } from '../log.js';

export interface Relay { request(qid: string): Promise<void>; cancel(qid: string): void; close(): void }
export interface RelayDeps {
  chat: Pick<Chat, 'relay' | 'markRelay' | 'queuedRelays'>; store: Pick<Store, 'get' | 'onChange'>;
  /** session.reply's path: null once typed and taken, the refusal otherwise; rejects when the injection fails. */
  replyTo: (id: string, text: string) => Promise<string | null>;
  broadcast: (m: ChatMessage) => void; now?: () => string;
}

/** Free to take a typed instruction: its turn, nothing pending. */
const free = (s: Session | undefined): s is Session => !!s && s.state === 'idle' && !s.pending;
const stopped = (name: string) => `${name} stopped before it got the instruction`;

/**
 * The chat cards' instructions (spec 2026-10-12 relay §4): typed now into a free session, else queued in the turn and typed at the
 * session's next free moment, one per free moment, oldest first. The queue is the turns' `relay.status`: a reset or a new day empties it.
 */
export function createRelay(d: RelayDeps): Relay {
  const now = d.now ?? (() => new Date().toISOString());
  // A session stays idle while its instruction is being typed: these keep a second one, or the same one twice, from following it.
  const typing = new Set<string>(); const sending = new Set<string>();

  async function deliver(qid: string, r: ChatRelay): Promise<string | null> {
    typing.add(r.id); sending.add(qid);
    try {
      let refused: string | null;
      try { refused = await d.replyTo(r.id, r.text); } catch (e) { refused = (e as Error).message; }
      if (refused) { log(`relay ${qid} to ${r.id} failed: ${refused}`); d.chat.markRelay(qid, { error: refused }, d.broadcast); }
      else d.chat.markRelay(qid, { status: 'sent', sentAt: now() }, d.broadcast);
      return refused;
    } finally { typing.delete(r.id); sending.delete(qid); }
  }

  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    const id = c.type === 'updated' ? c.session.id : c.id;
    const queued = d.chat.queuedRelays().filter(q => q.relay.id === id);
    if (queued.length === 0) return;
    const s = c.type === 'updated' ? c.session : undefined;
    if (!s || s.state === 'exited') { for (const q of queued) d.chat.markRelay(q.qid, { error: stopped(q.relay.name) }, d.broadcast); return; }
    if (free(s) && !typing.has(id)) void deliver(queued[0]!.qid, queued[0]!.relay);
  });

  return {
    async request(qid) {
      const r = d.chat.relay(qid);
      if (!r) throw new Error('unknown relay');
      if (r.status === 'sent' || sending.has(qid)) throw new Error('already sent');
      if (r.status === 'queued') throw new Error('already queued');
      const s = d.store.get(r.id);
      if (!s || s.state === 'exited') { const m = stopped(r.name); d.chat.markRelay(qid, { error: m }, d.broadcast); throw new Error(m); }
      if (free(s) && !typing.has(r.id)) { const refused = await deliver(qid, r); if (refused) throw new Error(refused); return; }
      d.chat.markRelay(qid, { status: 'queued' }, d.broadcast);
    },
    cancel(qid) {
      if (d.chat.relay(qid)?.status !== 'queued') throw new Error('nothing queued');
      d.chat.markRelay(qid, {}, d.broadcast);
    },
    close: unsubscribe
  };
}
