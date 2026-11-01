import type { ClientMessage, Escalation, Machines, ServerMessage } from '@ledge/protocol';
import { paths } from '../../paths.js';
import type { Reply } from '../server.js';
import type { RigAggregate } from './aggregate.js';
import { readOpenRigFile, writeOutbox } from './cursor.js';
import type { RemotePeers } from './remote.js';

/** An answer to a remote escalation, waiting for its machine (lot 6). `sentAt`: its last send (it may have arrived). */
export interface QueuedAnswer { rid: string; machine: string; id: string; answers: Record<string, string>; by: 'user' | 'ledge'; at: string; sentAt?: string }

export interface AnswerQueue {
  /** Answers rig.result { rid, ok: true } at once; overlays { state: 'answered', answer: { …, delivery: 'queued' } }. A `sentAt` is kept
   *  (an answer relayed whose ack the dropped link lost). */
  enqueue(a: QueuedAnswer, reply: Reply): void;
  pending(machine?: string): QueuedAnswer[];
  /** Definitive peer replies only; a lost acknowledgement or an inferred delivery is not a receipt. */
  onSettled(fn: (answer: QueuedAnswer, result: { status: 'applied' | 'rejected'; reason?: 'already_answered' }) => void): () => void;
  /** When the peer opens and each time its OpenRig turns `running`: resends each answer of the machine once, in order, same `rid`. */
  flush(machine: string): void;
  /** The peer's rig.result for a queued rid: ok or already_answered → removed, overlay removed (the peer's escalation rules); openrig_down → kept;
   *  `failed` for a resent answer (its first send's ack lost) to an escalation no longer listed → delivered, removed quietly; other → removed, notice. */
  settle(machine: string, result: Extract<ServerMessage, { type: 'rig.result' }>): void;
  /** Machine removed: dropped, with a notice. */
  drop(machine: string): void;
}

type Result = Extract<ServerMessage, { type: 'rig.result' }>;

/** How long after the last message of a peer's listing (status, rig.snapshot, escalations) it ends when nothing else follows. */
const SETTLE_MS = 1000;

/** What this daemon knows of one connection of a peer (reset at each `open`). */
interface Conn {
  /** The peer's OpenRig, as it said on this connection. */
  running: boolean;
  /** Escalation ids the peer lists now (its escalation.updated / escalation.removed on this connection). */
  listed: Set<string>;
  /** Rids sent on this connection: never twice. */
  sent: Set<string>;
  /** Rids sent for the first time on this connection to an escalation the peer did not list: a definite « unknown » or
   *  « already answered » from its daemon means the question was closed over there. */
  unlisted: Set<string>;
  /** Rids sent before (`sentAt`, the ack lost) and sent again to an escalation the peer no longer lists: the first send
   *  arrived, and a remote daemon restarted since (its rid memo gone) says « unknown » or « already answered » — delivered. */
  resent: Set<string>;
  /** A listing under way: a peer's replay (at `open`) or its OpenRig coming up (`running`) sends its status, its rig.snapshot,
   *  then every escalation it has, in one burst (bridge.replay / bridge connect). */
  listing: { snapshot: boolean; timer: NodeJS.Timeout | null } | null;
}

/**
 * The answers to escalations of a machine this daemon cannot reach, kept in openrig.json (`outbox`) until the machine's
 * daemon takes them. An answer goes when the peer is open, its OpenRig running, and it lists the escalation. One the peer
 * did not list goes when its listing ends, same rid: an answer sent before (its ack lost) gets the first outcome again from
 * the remote daemon's rid memo; one never sent is judged by the remote daemon's own reply, never by the listing alone (a
 * remote OpenRig whose queue failed to load lists nothing): « unknown » there (its queue read) or « already answered » means
 * closed over there, the answer is abandoned and Ledge's thread says so; « not read yet » (`openrig_down`) keeps it.
 */
export function createAnswerQueue(opts: { remote: RemotePeers; aggregate: RigAggregate; file?: string; notice: (text: string) => void; now?: () => string;
  labelOf?: (id: string) => string; settleMs?: number;
  /** machines.json as it is at startup: the answers of a machine no longer in it (or no longer reached by ssh) are abandoned. */
  machines?: () => Machines }): AnswerQueue {
  const { remote, aggregate, notice } = opts;
  const file = opts.file ?? paths().openrig; const now = opts.now ?? (() => new Date().toISOString());
  const labelOf = opts.labelOf ?? ((id: string) => id); const settleMs = opts.settleMs ?? SETTLE_MS;
  let items: QueuedAnswer[] = readOpenRigFile(file).outbox ?? [];
  const conns = new Map<string, Conn>();
  const settledListeners = new Set<(answer: QueuedAnswer, result: { status: 'applied' | 'rejected'; reason?: 'already_answered' }) => void>();
  const settled = (answer: QueuedAnswer, result: { status: 'applied' | 'rejected'; reason?: 'already_answered' }) => { for (const fn of settledListeners) { try { fn({ ...answer, answers: { ...answer.answers } }, result); } catch { /* a listener must not prevent queue settlement */ } } };
  /** Escalation summaries, for the notices (an escalation closed over there is gone from the aggregate). */
  const summaries = new Map<string, string>();

  const save = () => writeOutbox(file, items);
  const summary = (id: string) => summaries.get(id) ?? aggregate.escalation(id)?.summary ?? `la question ${id}`;
  const patch = (a: QueuedAnswer, delivery: 'queued' | 'sent'): Partial<Escalation> => ({ state: 'answered', answer: { by: a.by, answers: a.answers, at: a.at, delivery } });
  const conn = (machine: string): Conn | undefined => conns.get(machine);
  const remove = (a: QueuedAnswer, text?: string) => {
    items = items.filter(x => x !== a); save();
    aggregate.overlay(a.id, null);
    if (text) notice(text);
  };
  const send = (a: QueuedAnswer, c: Conn): boolean => {
    // Only `by: 'user'` is queued (enqueue refuses the rest): the protocol carries no other over the wire.
    const msg: ClientMessage = { type: 'escalation.answer', rid: a.rid, id: a.id, answers: a.answers, by: 'user' };
    if (!remote.send(a.machine, msg)) return false;
    const unlisted = !c.listed.has(a.id);
    if (unlisted && !a.sentAt) c.unlisted.add(a.rid); else c.unlisted.delete(a.rid);
    if (unlisted && a.sentAt) c.resent.add(a.rid); else c.resent.delete(a.rid);
    c.sent.add(a.rid); a.sentAt = now(); save();
    aggregate.overlay(a.id, patch(a, 'sent'));
    return true;
  };

  function flush(machine: string): void {
    const c = conn(machine);
    if (!c || !c.running || remote.status(machine) !== 'open') return;
    for (const a of items.filter(x => x.machine === machine)) {
      if (c.sent.has(a.rid) || !c.listed.has(a.id)) continue;
      if (!send(a, c)) return;
    }
  }

  const stopListing = (c: Conn) => { if (c.listing?.timer) clearTimeout(c.listing.timer); c.listing = null; };
  /** The listing is over: what the peer, OpenRig running, did not list goes anyway; its daemon's reply says what became of it. */
  const endListing = (machine: string, c: Conn) => {
    const l = c.listing; if (!l) return; stopListing(c);
    if (!c.running || remote.status(machine) !== 'open') return;
    for (const a of items.filter(x => x.machine === machine)) {
      if (c.listed.has(a.id) || c.sent.has(a.rid)) continue;
      if (!send(a, c)) return;
    }
    flush(machine);
  };
  const closedThere = (a: QueuedAnswer) => `Ma réponse à ${summary(a.id)} n'est pas partie : la question a été fermée sur ${labelOf(a.machine)}`;
  /** Every answer of the machine abandoned, with one notice saying `why`. */
  const abandon = (machine: string, why: string): void => {
    const gone = items.filter(a => a.machine === machine); if (!gone.length) return;
    items = items.filter(a => a.machine !== machine); save();
    for (const a of gone) aggregate.overlay(a.id, null);
    notice(gone.length === 1 ? `Ma réponse à ${summary(gone[0]!.id)} n'est pas partie : ${why}`
      : `Mes ${gone.length} réponses en attente pour ${labelOf(machine)} ne sont pas parties : ${why}`);
  };
  const arm = (machine: string, c: Conn) => {
    const l = c.listing; if (!l) return;
    if (l.timer) clearTimeout(l.timer);
    l.timer = setTimeout(() => { if (c.listing === l) endListing(machine, c); }, settleMs); l.timer.unref?.();
  };
  /** Back to « queued » what this connection had sent without an ack: it goes again on the next one. */
  const lost = (machine: string) => {
    const c = conn(machine); if (!c) return;
    stopListing(c); conns.delete(machine);
    for (const a of items) if (a.machine === machine && c.sent.has(a.rid)) aggregate.overlay(a.id, patch(a, 'queued'));
  };

  const removedWhy = (machine: string) => `${labelOf(machine)} a été retirée des machines`;
  if (opts.machines) {
    // Removed while this daemon was down: no peer will ever say `removed` for it.
    const listed = new Set(opts.machines().filter(m => m.ssh && m.id !== 'local').map(m => m.id));
    for (const machine of new Set(items.map(a => a.machine))) if (!listed.has(machine)) abandon(machine, removedWhy(machine));
  }
  // Overlays are the aggregate's memory only: laid again after a restart of this daemon.
  for (const a of items) aggregate.overlay(a.id, patch(a, 'queued'));

  remote.onStatus((machine, s) => {
    if (s === 'removed') { lost(machine); return queue.drop(machine); }
    if (s === 'unsupported') {
      // Its Ledge does not know OpenRig: nothing will take these answers until it is updated.
      lost(machine); const v = remote.version(machine);
      return abandon(machine, `Ledge ${v ? `${v} ` : ''}sur ${labelOf(machine)} ne connaît pas OpenRig : mets-le à jour`);
    }
    if (s !== 'open') return lost(machine);
    lost(machine);
    conns.set(machine, { running: false, listed: new Set(), sent: new Set(), unlisted: new Set(), resent: new Set(), listing: { snapshot: false, timer: null } });
    flush(machine);
  });

  remote.onMessage((machine, m) => {
    if (m.type === 'rig.result') return queue.settle(machine, m);
    const c = conn(machine); if (!c) return;
    // A listing ends at the peer's first message after its rig.snapshot that is not about an escalation.
    if (c.listing?.snapshot && m.type !== 'escalation.updated' && m.type !== 'escalation.removed') endListing(machine, c);
    switch (m.type) {
      case 'openrig.status':
        c.running = m.status.state === 'running';
        if (c.running) { if (!c.listing) c.listing = { snapshot: false, timer: null }; flush(machine); }
        return;
      case 'rig.snapshot': if (c.listing) { c.listing.snapshot = true; arm(machine, c); } return;
      case 'escalation.updated': {
        const id = m.escalation.id; c.listed.add(id); summaries.set(id, m.escalation.summary);
        if (c.listing?.snapshot) arm(machine, c);
        if (items.some(a => a.machine === machine && a.id === id)) flush(machine);
        return;
      }
      case 'escalation.removed': {
        c.listed.delete(m.id);
        // Closed over there while this answer waits, never sent: it will not go.
        const a = items.find(x => x.machine === machine && x.id === m.id);
        if (a && !a.sentAt && c.running) remove(a, closedThere(a));
        return;
      }
      default: return;
    }
  });

  const queue: AnswerQueue = {
    enqueue(a, reply) {
      if (a.by !== 'user') return reply({ type: 'rig.result', rid: a.rid, ok: false, code: 'failed', reason: "seule une réponse de l'utilisateur peut attendre une machine injoignable" });
      const same = items.find(x => x.machine === a.machine && x.id === a.id);
      if (same && same.rid !== a.rid) return reply({ type: 'rig.result', rid: a.rid, ok: false, code: 'already_answered', reason: 'déjà répondue' });
      if (!same) {
        const s = aggregate.escalation(a.id)?.summary; if (s) summaries.set(a.id, s);
        // `sentAt`: an answer the router had relayed when the link dropped, its ack lost: it may have arrived.
        const entry: QueuedAnswer = { rid: a.rid, machine: a.machine, id: a.id, answers: a.answers, by: a.by, at: a.at, ...(a.sentAt ? { sentAt: a.sentAt } : {}) };
        items = [...items, entry]; save();
        aggregate.overlay(a.id, patch(entry, 'queued'));
      }
      reply({ type: 'rig.result', rid: a.rid, ok: true });
      if (!same) flush(a.machine); // a peer open again since the router looked
    },
    pending: machine => items.filter(a => machine === undefined || a.machine === machine).map(a => ({ ...a })),
    onSettled(fn) { settledListeners.add(fn); return () => { settledListeners.delete(fn); }; },
    flush,
    settle(machine, result: Result) {
      const a = items.find(x => x.machine === machine && x.rid === result.rid); if (!a) return;
      const c = conn(machine);
      // First sent to an escalation the peer did not list, and its daemon (its queue read) does not know it or has it answered: closed there.
      if (!result.ok && c?.unlisted.has(a.rid) && (result.code === 'already_answered' || result.code === 'failed')) return remove(a, closedThere(a));
      if (result.ok) { const proven = result.confirmed && c?.sent.has(a.rid); remove(a); if (proven) settled(a, { status: 'applied' }); return; }
      if (result.code === 'already_answered') return remove(a);
      // Sent before, its ack lost, no longer listed: the remote daemon (restarted, its rid memo gone) no longer knows it — it went.
      if (c?.resent.has(a.rid) && result.code === 'failed') return remove(a);
      if (result.code === 'openrig_down') {
        // Kept (OpenRig down there, or its queue not read yet): it goes again on the peer's next word about it — its OpenRig
        // `running`, the escalation listed, the end of a listing — each once (a refusal sends nothing back: no loop).
        c?.sent.delete(a.rid); delete a.sentAt; save(); // refused: it did not arrive
        aggregate.overlay(a.id, patch(a, 'queued'));
        return;
      }
      remove(a, `Ma réponse à ${summary(a.id)} n'est pas partie sur ${labelOf(machine)} : ${result.reason ?? result.code ?? 'refusée'}`);
    },
    drop(machine) { abandon(machine, removedWhy(machine)); }
  };
  return queue;
}
