import { isArchived, type ClientMessage, type MessageAck, type Session, type Tool } from '@ledge/protocol';
import type { Store } from './store.js';
import { formatLedgeMessage } from './crossSession.js';
import { free } from './relay.js';
import { bareName } from './peers.js';
import { log } from '../log.js';

export interface MailboxDeps {
  store: Pick<Store, 'get' | 'all' | 'onChange'>;
  /** session.reply's path (server `replyTo`): null once typed and taken, the refusal otherwise; rejects when the injection fails. */
  replyTo: (id: string, text: string) => Promise<string | null>;
  /** Shared with the relay: a session being typed into. */
  typing: Set<string>;
  /** A chat relay instruction is queued for the session: it goes first. */
  relayQueued: (id: string) => boolean;
  sent: { record(senderId: string, item: { rid: string; at: string; to: string; peer?: string; text: string; summary?: string }): void; mark(senderId: string, rid: string, status: 'delivered' | 'failed'): void };
  now?: () => string;
}
export interface Mailbox { submit(m: Extract<ClientMessage, { type: 'session.message' }>): MessageAck; kick(id: string): void; close(): void }

interface Queued { rid: string; from: string; sender: { name: string; tool: Tool }; target: string; text: string }
/** How many rids are remembered for the dedupe: past it the oldest are forgotten. */
const MAX_SEEN = 1000;
/** `replyTo`'s refusals that pass (server.ts, adapters/types.ts): a decision being typed, or a prompt that came up
 *  meanwhile. The message waits for the next free moment; any other refusal (no session, read only, no terminal, the
 *  text not taken) fails it. */
const PASSING = [/^a decision is already in progress$/, /^an? \w+ prompt takes accept or deny, not a reply$/, /^no prompt visible in the terminal\b/,
  /^free-text answers are not supported yet\b/, /^the request changed, look again$/];

/**
 * Messages between sessions: acknowledged at once, typed into the target at its next free moment, one per free moment, oldest first.
 * It shares the relay's typing lock, and a queued chat relay instruction goes first.
 */
export function createMailbox(d: MailboxDeps): Mailbox {
  const now = d.now ?? (() => new Date().toISOString());
  const queue: Queued[] = []; const seen = new Map<string, MessageAck>();

  const ready = (id: string) => free(d.store.get(id)) && !d.typing.has(id) && !d.relayQueued(id);

  async function deliver(m: Queued): Promise<void> {
    const s = d.store.get(m.target);
    if (!s) { d.sent.mark(m.from, m.rid, 'failed'); queueMicrotask(() => kick(m.target)); return; }
    d.typing.add(m.target);
    try {
      let refused: string | null;
      try { refused = await d.replyTo(m.target, formatLedgeMessage({ from: m.sender.name, tool: m.sender.tool, text: m.text, to: s.tool })); } catch (e) { refused = (e as Error).message; }
      // First in line again; the store change that ends the decision or the prompt is the next try. A target gone meanwhile fails it.
      const live = d.store.get(m.target);
      if (refused && PASSING.some(re => re.test(refused!)) && live && live.state !== 'exited') { log(`message ${m.rid} to ${m.target} waits: ${refused}`); queue.unshift(m); return; }
      if (refused) log(`message ${m.rid} to ${m.target} failed: ${refused}`);
      d.sent.mark(m.from, m.rid, refused ? 'failed' : 'delivered');
      // A refusal leaves the session's state unchanged, so a queued relay card waits for the next store change; only the mailbox retries at once.
      if (refused) queueMicrotask(() => kick(m.target));
    } finally { d.typing.delete(m.target); }
  }

  function kick(id: string): void {
    if (!ready(id)) return;
    const i = queue.findIndex(m => m.target === id);
    if (i < 0) return;
    const [m] = queue.splice(i, 1);
    void deliver(m!).catch(e => log(`message ${m!.rid} failed: ${(e as Error).message}`));
  }

  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    const id = c.type === 'updated' ? c.session.id : c.id;
    if (c.type === 'removed' || c.session.state === 'exited') {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.target === id) { const [m] = queue.splice(i, 1); d.sent.mark(m!.from, m!.rid, 'failed'); }
      return;
    }
    kick(id);
  });

  const target = (to: string): Session | undefined => {
    const name = bareName(to);
    return d.store.all().find(s => s.name === name && s.state !== 'exited' && !isArchived(s));
  };
  const remember = (rid: string, ack: MessageAck): MessageAck => {
    seen.set(rid, ack);
    if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value!);
    return ack;
  };

  return {
    submit(m) {
      const first = seen.get(m.rid);
      if (first) return first;
      const t = target(m.to);
      if (m.intercept && (!t || t.tool === 'claude')) return remember(m.rid, { type: 'message.ack', rid: m.rid, outcome: 'native' });
      const refuse = (reason: string): MessageAck => ({ type: 'message.ack', rid: m.rid, outcome: 'refused', reason });
      if (!t) return refuse(`aucune session Ledge nommée ${m.to}`);
      const sender = d.store.get(m.from);
      if (!sender) return refuse('session émettrice inconnue');
      if (t.source === 'hook_only' || !t.tmuxSession) return refuse(`${t.name} n'a pas été lancée par Ledge : impossible de lui écrire`);
      d.sent.record(m.from, { rid: m.rid, at: now(), to: t.name, peer: t.id, text: m.text, ...(m.summary ? { summary: m.summary } : {}) });
      const outcome = ready(t.id) ? 'accepted' : 'queued';
      queue.push({ rid: m.rid, from: m.from, sender: { name: sender.name, tool: sender.tool }, target: t.id, text: m.text });
      const ack = remember(m.rid, { type: 'message.ack', rid: m.rid, outcome });
      if (outcome === 'accepted') kick(t.id);
      return ack;
    },
    kick,
    close: unsubscribe
  };
}
