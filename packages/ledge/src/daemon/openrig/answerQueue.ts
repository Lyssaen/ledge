import type { ClientMessage, Escalation, ServerMessage } from '@ledge/protocol';
import { paths } from '../../paths.js';
import type { Reply } from '../server.js';
import type { RigAggregate } from './aggregate.js';
import { readOpenRigFile, writeOutbox } from './cursor.js';
import type { RemotePeers } from './remote.js';

/** An answer to a remote escalation, waiting for its machine (lot 6). `sentAt`: its last send (it may have arrived). */
export interface QueuedAnswer { rid: string; machine: string; id: string; answers: Record<string, string>; by: 'user' | 'ledge'; at: string; sentAt?: string }

export interface AnswerQueue {
  /** Answers rig.result { rid, ok: true } at once; overlays { state: 'answered', answer: { …, delivery: 'queued' } }. */
  enqueue(a: QueuedAnswer, reply: Reply): void;
  pending(machine?: string): QueuedAnswer[];
  /** When the peer opens and each time its OpenRig turns `running`: resends each answer of the machine once, in order, same `rid`. */
  flush(machine: string): void;
  /** The peer's rig.result for a queued rid: ok or already_answered → removed, overlay removed (the peer's escalation rules); openrig_down → kept; other → removed, notice. */
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
  /** A listing under way: a peer's replay (at `open`) or its OpenRig coming up (`running`) sends its status, its rig.snapshot,
   *  then every escalation it has, in one burst (bridge.replay / bridge connect). */
  listing: { snapshot: boolean; timer: NodeJS.Timeout | null } | null;
}

/**
 * The answers to escalations of a machine this daemon cannot reach, kept in openrig.json (`outbox`) until the machine's
 * daemon takes them. An answer goes when the peer is open, its OpenRig running, and it lists the escalation; an answer
 * already sent once (its ack may have been lost) goes again with the same rid when the peer's listing ends, listed or not:
 * the remote daemon's rid memo answers it as the first time. An answer never sent whose escalation the peer, OpenRig
 * running, does not list at the end of a listing was closed there: it is abandoned, and Ledge's thread says so.
 */
export function createAnswerQueue(opts: { remote: RemotePeers; aggregate: RigAggregate; file?: string; notice: (text: string) => void; now?: () => string;
  labelOf?: (id: string) => string; settleMs?: number }): AnswerQueue {
  const { remote, aggregate, notice } = opts;
  const file = opts.file ?? paths().openrig; const now = opts.now ?? (() => new Date().toISOString());
  const labelOf = opts.labelOf ?? ((id: string) => id); const settleMs = opts.settleMs ?? SETTLE_MS;
  let items: QueuedAnswer[] = readOpenRigFile(file).outbox ?? [];
  const conns = new Map<string, Conn>();
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
    // Only `by: 'user'` reaches a queue today (the router queues client answers).
    const msg = { type: 'escalation.answer', rid: a.rid, id: a.id, answers: a.answers, by: a.by } as ClientMessage;
    if (!remote.send(a.machine, msg)) return false;
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
  /** The listing is over: what the peer, OpenRig running, did not list is closed there (or answered, for an answer sent before). */
  const endListing = (machine: string, c: Conn) => {
    const l = c.listing; if (!l) return; stopListing(c);
    if (!c.running || remote.status(machine) !== 'open') return;
    for (const a of items.filter(x => x.machine === machine)) {
      if (c.listed.has(a.id) || c.sent.has(a.rid)) continue;
      if (a.sentAt) { if (!send(a, c)) return; continue; }
      remove(a, `Ma réponse à ${summary(a.id)} n'est pas partie : la question a été fermée sur ${labelOf(machine)}`);
    }
    flush(machine);
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

  // Overlays are the aggregate's memory only: laid again after a restart of this daemon.
  for (const a of items) aggregate.overlay(a.id, patch(a, 'queued'));

  remote.onStatus((machine, s) => {
    if (s === 'removed') { lost(machine); return queue.drop(machine); }
    if (s !== 'open') return lost(machine);
    lost(machine);
    conns.set(machine, { running: false, listed: new Set(), sent: new Set(), listing: { snapshot: false, timer: null } });
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
        if (a && !a.sentAt && c.running) remove(a, `Ma réponse à ${summary(a.id)} n'est pas partie : la question a été fermée sur ${labelOf(machine)}`);
        return;
      }
      default: return;
    }
  });

  const queue: AnswerQueue = {
    enqueue(a, reply) {
      const same = items.find(x => x.machine === a.machine && x.id === a.id);
      if (same && same.rid !== a.rid) return reply({ type: 'rig.result', rid: a.rid, ok: false, code: 'already_answered', reason: 'déjà répondue' });
      if (!same) {
        const s = aggregate.escalation(a.id)?.summary; if (s) summaries.set(a.id, s);
        const entry: QueuedAnswer = { rid: a.rid, machine: a.machine, id: a.id, answers: a.answers, by: a.by, at: a.at };
        items = [...items, entry]; save();
        aggregate.overlay(a.id, patch(entry, 'queued'));
      }
      reply({ type: 'rig.result', rid: a.rid, ok: true });
      if (!same) flush(a.machine); // a peer open again since the router looked
    },
    pending: machine => items.filter(a => machine === undefined || a.machine === machine).map(a => ({ ...a })),
    flush,
    settle(machine, result: Result) {
      const a = items.find(x => x.machine === machine && x.rid === result.rid); if (!a) return;
      if (result.ok || result.code === 'already_answered') return remove(a);
      if (result.code === 'openrig_down') {
        // Kept: it goes again once the peer says its OpenRig is running (not before: no resend loop on its escalation updates).
        const c = conn(machine); if (c) { c.sent.delete(a.rid); c.running = false; }
        aggregate.overlay(a.id, patch(a, 'queued'));
        return;
      }
      remove(a, `Ma réponse à ${summary(a.id)} n'est pas partie sur ${labelOf(machine)} : ${result.reason ?? result.code ?? 'refusée'}`);
    },
    drop(machine) {
      const gone = items.filter(a => a.machine === machine); if (!gone.length) return;
      items = items.filter(a => a.machine !== machine); save();
      for (const a of gone) aggregate.overlay(a.id, null);
      notice(gone.length === 1
        ? `Ma réponse à ${summary(gone[0]!.id)} n'est pas partie : ${labelOf(machine)} a été retirée des machines`
        : `Mes ${gone.length} réponses en attente pour ${labelOf(machine)} ne sont pas parties : la machine a été retirée`);
    }
  };
  return queue;
}
