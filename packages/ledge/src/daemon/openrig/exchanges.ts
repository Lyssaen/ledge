import { EXCHANGES_MAX, type Exchange } from '@ledge/protocol';
import { EVENTS, EVENTS_UNOBSERVED, HUMAN_ADDRESS, HUMAN_GATE_TIER, OPERATOR_HUMAN_SESSIONS, OUTBOX_EVENT } from './facts.js';
import type { OpenRigEvent } from './sse.js';
import type { OutboxRow } from './wire.js';

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
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/m.exec(body);
  const text = m ? m[1] : body;
  const stamp = [row.createdAt, row.sentAt, row.timestamp].map(str).find((s): s is string => !!s && !Number.isNaN(Date.parse(s)));
  const at = stamp ? new Date(stamp).toISOString() : ctx.at ?? new Date().toISOString();
  return build(`o-${row.outboxId}`, 'message', row.senderSession, row.destinationSession, text, at, ctx);
}

export interface ExchangeLog {
  /** false when the id is already known (no rebroadcast). */
  add(x: Exchange): boolean;
  /** At most `max` items, oldest to newest. */
  list(rigId: string): Exchange[];
  forgetRig(rigId: string): void;
}

export function createExchangeLog(max: number = EXCHANGES_MAX): ExchangeLog {
  const byRig = new Map<string, Exchange[]>(); const seen = new Set<string>();
  return {
    add(x) {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      const l = byRig.get(x.rigId) ?? []; byRig.set(x.rigId, l); l.push(x);
      while (l.length > max) l.shift();
      return true;
    },
    list: rigId => [...(byRig.get(rigId) ?? [])],
    forgetRig(rigId) { for (const x of byRig.get(rigId) ?? []) seen.delete(x.id); byRig.delete(rigId); },
  };
}
