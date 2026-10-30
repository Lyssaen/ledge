import { isDeepStrictEqual } from 'node:util';
import type { Escalation, EscalationQuestion } from '@ledge/protocol';
import { openrigTime, type QueueRow } from './wire.js';
import { QUEUE_ROW, HUMAN_ADDRESS, OPERATOR_HUMAN_SESSIONS, HUMAN_GATE_TIER } from './facts.js';

/** Rig knowledge the mapper needs. `isKernelSeat` (provided by the mirror): true for a seat of the kernel rig, whose rows are operator rows.
 *  `seenAt`: createdAt of a row whose own is missing or malformed, stable for an id (see createFirstSeen); now when absent. */
export interface EscalationCtx { machine: string; rigOf(ref: string): string | undefined; isKernelSeat?(ref: string): boolean; seenAt?(id: string): string }

/** First time each id was seen: a stable createdAt for rows without a usable one, so a re-read does not re-broadcast them. */
export function createFirstSeen(now: () => string = () => new Date().toISOString()) {
  const m = new Map<string, string>();
  return { at(id: string): string { let v = m.get(id); if (v === undefined) m.set(id, v = now()); return v; },
    /** Forgets the ids not in `ids` (rows gone). */ retain(ids: ReadonlySet<string>): void { for (const k of [...m.keys()]) if (!ids.has(k)) m.delete(k); } };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

/** A row addressed to the human, to the operator human, or gated at the human tier. */
export function isHumanRow(row: QueueRow): boolean {
  return row.destinationSession === HUMAN_ADDRESS || OPERATOR_HUMAN_SESSIONS.includes(row.destinationSession) || row.tier === HUMAN_GATE_TIER;
}


/** Valid questions only (>= 2 options), capped at 4 questions of 4 options. */
function readQuestions(raw: unknown): EscalationQuestion[] {
  let list = raw;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  const out: EscalationQuestion[] = [];
  for (const item of list) {
    const q = obj(item); const id = str(q?.id); const question = str(q?.question);
    if (!q || !id || !question || !Array.isArray(q.options)) continue;
    const options: EscalationQuestion['options'] = [];
    for (const o of q.options) {
      const oo = obj(o); const oid = str(oo?.id); const label = str(oo?.label);
      if (!oo || !oid || !label || options.length >= 4) continue;
      options.push(oo.recommended === true ? { id: oid, label, recommended: true } : { id: oid, label });
    }
    if (options.length >= 2) out.push({ id, question, options });
    if (out.length >= 4) break;
  }
  return out;
}

export function rowToEscalation(row: QueueRow, ctx: EscalationCtx): Escalation {
  const from = row.sourceSession ?? '';
  const questions = readQuestions(row[QUEUE_ROW.questions]);
  const summary = str(row.summary) ?? str(row.body) ?? row.qitemId;
  const body = str(row[QUEUE_ROW.body]);
  const intent = row[QUEUE_ROW.intent] === 'decision' || row[QUEUE_ROW.intent] === 'update' ? row[QUEUE_ROW.intent] as 'decision' | 'update' : questions.length ? 'decision' : 'update';
  const operator = OPERATOR_HUMAN_SESSIONS.includes(row.destinationSession) || (from !== '' && ctx.isKernelSeat?.(from) === true);
  const e: Escalation = { id: row.qitemId, source: operator ? 'operator' : 'rig', machine: ctx.machine, from, intent, summary, questions, createdAt: openrigTime(row.createdAt) ?? ctx.seenAt?.(row.qitemId) ?? new Date().toISOString(), state: 'pending' };
  const rigId = from ? ctx.rigOf(from) : undefined; if (rigId) e.rigId = rigId;
  if (body && body !== summary) e.detail = body;
  const ev = str(row[QUEUE_ROW.evidence]); if (ev) e.evidenceRef = ev;
  const rt = str(row[QUEUE_ROW.replyTo]); if (rt) e.replyTo = rt;
  return e;
}

export interface EscalationBook {
  /** Swap the whole set; `updated` = new or changed only, `removed` = ids gone. */
  replace(list: Escalation[]): { updated: Escalation[]; removed: string[] };
  /** Null when identical to the stored one (no rebroadcast). */
  upsert(e: Escalation): Escalation | null;
  remove(id: string): boolean; all(): Escalation[];
}

export function createEscalationBook(): EscalationBook {
  const m = new Map<string, Escalation>();
  const upsert = (e: Escalation) => { const old = m.get(e.id); if (old && isDeepStrictEqual(old, e)) return null; m.set(e.id, e); return e; };
  return { upsert, all: () => [...m.values()], remove: id => m.delete(id),
    replace(list) {
      const keep = new Set(list.map(e => e.id)); const removed = [...m.keys()].filter(id => !keep.has(id));
      for (const id of removed) m.delete(id);
      return { updated: list.flatMap(e => upsert(e) ?? []), removed };
    } };
}
