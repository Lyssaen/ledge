import { backendOf, isArchived, type ClientMessage, type MessageAck, type ServerMessage, type Session, type Tool } from '@ledge/protocol';
import type { Store } from './store.js';
import { formatLedgeMessage, formatLedgeNotice, inline, mailId } from './crossSession.js';
import { free } from './relay.js';
import { bareName } from './peers.js';
import { log } from '../log.js';
import { jsonJournal, type Journal } from './journal.js';

/** What the mailbox journals: the messages still to type, and the bodies `ledge read` can still give. */
export interface MailState { queue: Queued[]; bodies: Body[] }
export type MailJournal = Journal<MailState>;

export interface MailboxDeps {
  store: Pick<Store, 'get' | 'all' | 'onChange'>;
  /** session.reply's path (server `replyTo`): null once typed and taken, the refusal otherwise; rejects when the injection fails. */
  replyTo: (id: string, text: string) => Promise<string | null>;
  /** Shared with the relay: a session being typed into. */
  typing: Set<string>;
  /** A chat relay instruction is queued for the session: it goes first. */
  relayQueued: (id: string) => boolean;
  /** Sessions Ledge is closing: never delivered to, even free; their messages fail once they exit. */
  closing?: ReadonlySet<string>;
  sent: { record(senderId: string, item: { rid: string; at: string; to: string; peer?: string; text: string; summary?: string }): void; mark(senderId: string, rid: string, status: 'delivered' | 'failed'): void };
  /** Where the queue and the bodies outlive the daemon; none keeps them in memory only. */
  journal?: MailJournal;
  now?: () => string;
}
export interface Mailbox {
  submit(m: Extract<ClientMessage, { type: 'session.message' }>): MessageAck;
  read(m: Extract<ClientMessage, { type: 'message.read' }>): Extract<ServerMessage, { type: 'message.body' }>;
  /** Ledge's own line for a session (a task's pointer), typed at its next free moment; false when it cannot be typed into. Never told back on failure. */
  notify(target: string, text: string, rid: string): boolean;
  kick(id: string): void;
  close(): void;
}

/** A message to type (`from` its sender's session id), or a notice telling a sender one of its messages failed (`from` empty). */
interface Queued { kind: 'message' | 'notice'; id: string; rid: string; from: string; sender: { name: string; tool: Tool }; target: string; to: string; text: string; summary?: string }
/** A message's body as `ledge read` gives it: `from`/`target` the session ids allowed to read it, `fromName`/`to` their names. */
interface Body { id: string; rid: string; from: string; fromName: string; target: string; to: string; at: string; text: string }
/** How many rids are remembered for the dedupe: past it the oldest are forgotten. */
const MAX_SEEN = 1000;
/** Bodies kept for `ledge read`: a pointer typed into a session may be read days later. */
const BODY_MAX = 200;
const BODY_TTL_MS = 7 * 24 * 3600 * 1000;
/** `replyTo`'s refusals that pass (server.ts, adapters/types.ts): a decision being typed, or a prompt that came up
 *  meanwhile. The message waits for the next free moment; any other refusal (no session, read only, no terminal, the
 *  text not taken) fails it. */
const PASSING = [/^a decision is already in progress$/, /^an? \w+ prompt takes accept or deny, not a reply$/, /^no prompt visible in the terminal\b/,
  /^free-text answers are not supported yet\b/, /^the request changed, look again$/];
const GONE = "la session n'existe plus";
const ENDED = "la session s'est terminée avant de le recevoir";

/** A session Ledge can type into, live: a notice to it can be delivered. */
const reachable = (s: Session | undefined): s is Session =>
  !!s && s.source === 'launcher' && s.state !== 'exited' && !isArchived(s) && (!!s.tmuxSession || backendOf(s) === 'omp-rpc');

/**
 * Messages between sessions: acknowledged at once, typed into the target at its next free moment, one per free moment, oldest first.
 * It shares the relay's typing lock, and a queued chat relay instruction goes first. A long body is typed as a pointer
 * that `ledge read` answers; a message given up on is told to its sender, once. With a journal, both outlive the daemon.
 */
export function createMailbox(d: MailboxDeps): Mailbox {
  const now = d.now ?? (() => new Date().toISOString());
  const queue: Queued[] = []; const seen = new Map<string, MessageAck>(); const bodies = new Map<string, Body>();

  /** Past their week or their count, the oldest bodies go (a Map keeps them oldest first); then the journal is told. */
  const save = () => {
    const oldest = Date.parse(now()) - BODY_TTL_MS;
    for (const [id, b] of bodies) if (Date.parse(b.at) < oldest || bodies.size > BODY_MAX) bodies.delete(id);
    d.journal?.save({ queue: [...queue], bodies: [...bodies.values()] });
  };

  const ready = (id: string) => free(d.store.get(id)) && !d.typing.has(id) && !d.closing?.has(id) && !d.relayQueued(id);

  /** The card fails; a message's sender, still there to read it, is told why at its own next free moment. */
  function fail(m: Queued, reason: string): void {
    log(`${m.kind} ${m.rid} to ${m.target} failed: ${reason}`);
    if (m.kind === 'notice') return; // never a notice about a notice
    d.sent.mark(m.from, m.rid, 'failed');
    const sender = d.store.get(m.from);
    if (!reachable(sender)) return;
    notice(sender, formatLedgeNotice({ to: m.to, text: m.text, reason }), `${m.rid}:notice`);
  }

  function notice(s: Session, text: string, rid: string): void {
    queue.push({ kind: 'notice', id: mailId(rid), rid, from: '', sender: { name: 'Ledge', tool: s.tool }, target: s.id, to: s.name, text });
    queueMicrotask(() => kick(s.id));
  }

  async function deliver(m: Queued): Promise<void> {
    const s = d.store.get(m.target);
    if (!s) { fail(m, GONE); save(); queueMicrotask(() => kick(m.target)); return; }
    d.typing.add(m.target);
    try {
      let refused: string | null;
      const text = m.kind === 'notice' ? m.text : formatLedgeMessage({ from: m.sender.name, tool: m.sender.tool, text: m.text, to: s.tool, id: m.id, ...(m.summary ? { summary: m.summary } : {}) });
      try { refused = await d.replyTo(m.target, text); } catch (e) { refused = (e as Error).message; }
      // First in line again; the store change that ends the decision or the prompt is the next try. A target gone meanwhile fails it.
      const live = d.store.get(m.target);
      if (refused && PASSING.some(re => re.test(refused!)) && live && live.state !== 'exited') { log(`${m.kind} ${m.rid} to ${m.target} waits: ${refused}`); queue.unshift(m); return; }
      if (refused) fail(m, refused);
      else if (m.kind === 'message') d.sent.mark(m.from, m.rid, 'delivered');
      save();
      // A refusal leaves the session's state unchanged, so a queued relay card waits for the next store change; only the mailbox retries at once.
      if (refused) queueMicrotask(() => kick(m.target));
    } finally { d.typing.delete(m.target); }
  }

  function kick(id: string): void {
    if (!ready(id)) return;
    const i = queue.findIndex(m => m.target === id);
    if (i < 0) return;
    const [m] = queue.splice(i, 1);
    void deliver(m!).catch(e => log(`${m!.kind} ${m!.rid} failed: ${(e as Error).message}`));
  }

  /** Every message queued for a session that has exited or is gone fails. */
  function failFor(id: string, reason: string): void {
    let changed = false;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.target === id) { const [m] = queue.splice(i, 1); fail(m!, reason); changed = true; }
    if (changed) save();
  }

  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    const id = c.type === 'updated' ? c.session.id : c.id;
    if (c.type === 'removed') return failFor(id, GONE);
    if (c.session.state === 'exited') return failFor(id, ENDED);
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
  /** The rid's short id, longer only when another body already holds the shorter one. */
  const idFor = (rid: string): string => {
    for (const length of [6, 8, 10, 40]) { const id = mailId(rid, length); const held = bodies.get(id); if (!held || held.rid === rid) return id; }
    return mailId(rid, 40);
  };

  // What the last daemon left: still waiting, or failed when its target is gone; the kicks wait for the caller's wiring.
  const loaded = d.journal?.load();
  if (loaded) {
    for (const b of loaded.bodies) bodies.set(b.id, b);
    const failed: [Queued, string][] = [];
    for (const m of loaded.queue) {
      const t = d.store.get(m.target);
      if (t && t.state !== 'exited') queue.push(m); else failed.push([m, t ? ENDED : GONE]);
    }
    for (const [m, reason] of failed) fail(m, reason);
    if (failed.length) save();
    if (queue.length) log(`mailbox: ${queue.length} message(s) still waiting from the last run`);
    queueMicrotask(() => { for (const id of new Set(queue.map(m => m.target))) kick(id); });
  }

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
      // An OMP session has no pane: its messages travel as instructions over its protocol (server `replyTo`).
      if (t.source === 'hook_only' || (!t.tmuxSession && backendOf(t) !== 'omp-rpc')) return refuse(`${t.name} n'a pas été lancée par Ledge : impossible de lui écrire`);
      const at = now(); const id = idFor(m.rid);
      d.sent.record(m.from, { rid: m.rid, at, to: t.name, peer: t.id, text: m.text, ...(m.summary ? { summary: m.summary } : {}) });
      // Only a body typed as a pointer needs keeping: a short one is in the receiver's prompt whole.
      if (!inline(m.text)) bodies.set(id, { id, rid: m.rid, from: sender.id, fromName: sender.name, target: t.id, to: t.name, at, text: m.text });
      const outcome = ready(t.id) ? 'accepted' : 'queued';
      queue.push({ kind: 'message', id, rid: m.rid, from: m.from, sender: { name: sender.name, tool: sender.tool }, target: t.id, to: t.name, text: m.text, ...(m.summary ? { summary: m.summary } : {}) });
      save();
      const ack = remember(m.rid, { type: 'message.ack', rid: m.rid, outcome });
      if (outcome === 'accepted') kick(t.id);
      return ack;
    },
    read({ id, by }) {
      const b = bodies.get(id);
      if (!b) return { type: 'message.body', id, reason: `aucun message ${id} (seuls les longs messages des 7 derniers jours se relisent)` };
      if (by !== b.from && by !== b.target) return { type: 'message.body', id, reason: `le message ${id} ne t'est pas adressé` };
      return { type: 'message.body', id, from: b.fromName, to: b.to, at: b.at, text: b.text };
    },
    notify(target, text, rid) {
      const s = d.store.get(target);
      if (!reachable(s)) return false;
      notice(s, text, rid); save();
      return true;
    },
    kick,
    close: unsubscribe
  };
}

/** The mailbox's journal in a file: read once at startup, rewritten whole through a temporary file after each change, one write at a time. */
export function fileJournal(path: string): MailJournal & { flush(): Promise<void> } {
  return jsonJournal<MailState>(path, 'mailbox', raw => {
    const r = raw as Partial<MailState> | null;
    return r ? { queue: Array.isArray(r.queue) ? r.queue : [], bodies: Array.isArray(r.bodies) ? r.bodies : [] } : undefined;
  });
}
