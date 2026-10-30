import { EXCHANGES_MAX, type Exchange } from '@ledge/protocol';
import { EVENTS, EVENTS_UNOBSERVED, HUMAN_ADDRESS, HUMAN_GATE_TIER, OPERATOR_HUMAN_SESSIONS, OUTBOX_EVENT } from './facts.js';
import type { OpenRigEvent } from './sse.js';
import { openrigTime, type OutboxRow } from './wire.js';

interface Ctx { machine: string; rigOf(ref: string): string | undefined }
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
/** Human rows are escalations, not exchanges. */
const isHuman = (to: string | undefined, tier?: string) => to === HUMAN_ADDRESS || (!!to && OPERATOR_HUMAN_SESSIONS.includes(to)) || tier === HUMAN_GATE_TIER;
const build = (id: string, kind: Exchange['kind'], from: string | undefined, to: string | undefined, text: string, at: string, ctx: Ctx): Exchange | null => {
  if (!from || !to) return null;
  const rigId = ctx.rigOf(from) ?? ctx.rigOf(to);
  return rigId ? { id, machine: ctx.machine, rigId, from, to, kind, text, at } : null;
};

/** Seat-to-seat queue events as exchanges; human rows and other events give null. */
export function exchangeFromEvent(e: OpenRigEvent, ctx: Ctx & { at: string }): Exchange | null {
  const qid = str(e.qitemId); if (!qid) return null;
  const to = str(e.destinationSession);
  if (isHuman(to, str(e.tier))) return null;
  const text = str(e.summary) ?? '';
  if (e.type === EVENTS.queueCreated) return build(`q-${qid}`, 'task', str(e.sourceSession), to, text, ctx.at, ctx);
  if (e.type === EVENTS_UNOBSERVED.queueHandedOff) return build(`h-${qid}`, 'handoff', str(e.sourceSession), to, text, ctx.at, ctx);
  if (OUTBOX_EVENT && e.type === OUTBOX_EVENT) return build(`o-${qid}`, 'message', str(e.sourceSession), to, text, ctx.at, ctx);
  return null;
}

/** Outbox row (`rig send`) as a message; only `outbox-…` ids count. */
export function exchangeFromOutbox(row: OutboxRow, ctx: Ctx & { at?: string }): Exchange | null {
  if (!row.outboxId.startsWith('outbox-')) return null;
  if (isHuman(row.destinationSession, str((row as { tier?: unknown }).tier))) return null;
  const body = str(row.body) ?? '';
  const m = /\n---\n([\s\S]*)\n---(?:\n|$)/.exec(body);
  const text = m?.[1] ?? body;
  const at = [row.createdAt, row.sentAt, row.timestamp].map(openrigTime).find((s): s is string => s !== null) ?? ctx.at ?? new Date().toISOString();
  return build(`o-${row.outboxId}`, 'message', row.senderSession, row.destinationSession, text, at, ctx);
}

export interface ExchangeLog {
  /** false when the id is already known (no rebroadcast). */
  add(x: Exchange): boolean;
  /** At most `max` items, oldest to newest. */
  list(rigId: string): Exchange[];
  /** Dedupe entries kept for a rig (bounded by 2*max). */
  size(rigId: string): number;
  forgetRig(rigId: string): void;
}

export function createExchangeLog(max: number = EXCHANGES_MAX): ExchangeLog {
  // Per rig: the window plus a dedupe set (window ids and recently evicted ids, insertion-ordered, capped at 2*max).
  const byRig = new Map<string, { items: Exchange[]; known: Set<string> }>();
  return {
    add(x) {
      let r = byRig.get(x.rigId); if (!r) byRig.set(x.rigId, r = { items: [], known: new Set() });
      if (r.known.has(x.id)) return false;
      r.known.add(x.id); r.items.push(x);
      while (r.items.length > max) r.items.shift();
      while (r.known.size > 2 * max) r.known.delete(r.known.values().next().value as string);
      return true;
    },
    list: rigId => [...(byRig.get(rigId)?.items ?? [])],
    size: rigId => byRig.get(rigId)?.known.size ?? 0,
    forgetRig(rigId) { byRig.delete(rigId); },
  };
}
