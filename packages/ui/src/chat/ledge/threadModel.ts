import type { ChatTurn, Escalation, Exchange, LedgeDecision, LedgeThreadItem } from '@ledge/protocol';
import { qualify } from '@ledge/fleet/machines';
import type { AgeWords, DayWords } from './copy';

type Item<K extends LedgeThreadItem['kind']> = Extract<LedgeThreadItem, { kind: K }>;

/** A row of Ledge's thread, ready to draw: each item with what it points to, and a separator at each new day. */
export type ThreadRow =
  | { kind: 'day'; day: string; label: string }
  | { kind: 'user'; item: Item<'user'>; to?: string }
  | { kind: 'ledge'; item: Item<'ledge'>; turn?: ChatTurn }
  | { kind: 'escalation'; item: Item<'escalation'>; escalation?: Escalation }
  /** `to`: the seat the decision answered without its rig (the decision's `from`, else its escalation's while still known). */
  | { kind: 'decided'; item: Item<'decided'>; decision?: LedgeDecision; to?: string }
  | { kind: 'exchanges'; item: Item<'exchanges'>; exchanges: Exchange[]; missing: number }
  /** An existing action card (`ChatAction`), drawn by the app. */
  | { kind: 'card'; item: Item<'card'> };

export interface ThreadContext {
  /** Keyed by escalation id (local escalations only in lot 4). */
  escalations: ReadonlyMap<string, Escalation>;
  /** A rig's exchanges as the fleet holds them (`client.fleet.exchanges`), `null` until loaded. */
  exchanges: (machine: string, rigId: string) => readonly Exchange[] | null | undefined;
  /** The fleet's chat turns, whose qids are global (`local:<encoded>`). */
  chat: readonly ChatTurn[];
  decisions?: ReadonlyMap<string, LedgeDecision>;
  /** Today as a local `YYYY-MM-DD`. */
  today: string;
  days: DayWords;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The local calendar day of an ISO instant, `YYYY-MM-DD`. */
export const localDay = (iso: string): string => dayOf(new Date(iso));
/** The local hour and minute of an ISO instant, « 16:42 ». */
export function hhmm(iso: string): string { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
/** A seat ref without its rig: « orch-lead@factory » → « orch-lead ». */
export const seatName = (ref: string): string => { const at = ref.indexOf('@'); return at > 0 ? ref.slice(0, at) : ref; };

function dayLabel(day: string, today: string, words: DayWords): string {
  if (day === today) return words.today;
  const [y, m, d] = today.split('-').map(Number);
  return day === dayOf(new Date(y!, m! - 1, d! - 1)) ? words.yesterday : words.date(day);
}

export function threadRows(items: readonly LedgeThreadItem[], ctx: ThreadContext): ThreadRow[] {
  const rows: ThreadRow[] = [];
  const turns = new Map(ctx.chat.map(t => [t.qid, t]));
  const loaded = new Map<string, Map<string, Exchange>>();
  const rigExchanges = (machine: string, rigId: string) => {
    const key = `${machine}/${rigId}`;
    let byId = loaded.get(key);
    if (!byId) { byId = new Map((ctx.exchanges(machine, rigId) ?? []).map(x => [x.id, x])); loaded.set(key, byId); }
    return byId;
  };
  let lastDay: string | undefined;
  for (const item of items) {
    const day = localDay(item.at);
    if (day !== lastDay) { rows.push({ kind: 'day', day, label: dayLabel(day, ctx.today, ctx.days) }); lastDay = day; }
    switch (item.kind) {
      case 'user': rows.push({ kind: 'user', item, ...(item.to ? { to: item.to } : {}) }); break;
      case 'ledge': {
        const turn = item.qid ? turns.get(qualify('local', item.qid)) : undefined;
        rows.push({ kind: 'ledge', item, ...(turn ? { turn } : {}) }); break;
      }
      case 'escalation': {
        const escalation = ctx.escalations.get(item.escalationId);
        rows.push({ kind: 'escalation', item, ...(escalation ? { escalation } : {}) }); break;
      }
      case 'decided': {
        const decision = ctx.decisions?.get(item.decisionId);
        // The seat: the decision's own (lot 7), else its escalation's while it is still known.
        const from = decision ? decision.from ?? ctx.escalations.get(decision.escalationId)?.from : undefined;
        rows.push({ kind: 'decided', item, ...(decision ? { decision } : {}), ...(from ? { to: seatName(from) } : {}) }); break;
      }
      case 'exchanges': {
        const byId = rigExchanges(item.machine, item.rigId);
        const exchanges = item.exchangeIds.flatMap(id => { const x = byId.get(id); return x ? [x] : []; });
        rows.push({ kind: 'exchanges', item, exchanges, missing: item.exchangeIds.length - exchanges.length }); break;
      }
      case 'card': rows.push({ kind: 'card', item }); break;
    }
  }
  return rows;
}

/** The notch's mixed feed: one exchange per line, plus the messages, the bubbles and the decisions; `onlyLedge` drops the exchanges.
 *  `id` keys the line (the item's, or the exchange's); a bubble carries its turn when the thread resolved it (its cards). */
export type FeedLine =
  | { id: string; at: string; kind: 'exchange'; exchange: Exchange; rigName: string }
  | { id: string; at: string; kind: 'user'; text: string; to?: string }
  | { id: string; at: string; kind: 'ledge'; text: string; turn?: ChatTurn }
  | { id: string; at: string; kind: 'decided'; text: string; to: string };

export function feedLines(rows: readonly ThreadRow[], o: { onlyLedge: boolean; rigName(machine: string, rigId: string): string }): FeedLine[] {
  const lines: FeedLine[] = [];
  for (const row of rows) {
    if (row.kind === 'exchanges') {
      if (o.onlyLedge) continue;
      const rigName = o.rigName(row.item.machine, row.item.rigId);
      for (const exchange of row.exchanges) lines.push({ id: exchange.id, at: exchange.at, kind: 'exchange', exchange, rigName });
    } else if (row.kind === 'user') lines.push({ id: row.item.id, at: row.item.at, kind: 'user', text: row.item.text, ...(row.to ? { to: row.to } : {}) });
    else if (row.kind === 'ledge') { if (row.item.text) lines.push({ id: row.item.id, at: row.item.at, kind: 'ledge', text: row.item.text, ...(row.turn ? { turn: row.turn } : {}) }); }
    else if (row.kind === 'decided' && row.decision) lines.push({ id: row.item.id, at: row.item.at, kind: 'decided', text: row.decision.summary, to: row.to ?? '' });
  }
  return lines;
}

/** The pinned decision: the oldest waiting `decision` escalation (`pending` or `grace`); asks keep their own card (R15). */
export function pinnedEscalation(escalations: readonly Escalation[]): Escalation | undefined {
  let pinned: Escalation | undefined;
  for (const e of escalations) {
    if (e.intent !== 'decision' || e.source === 'ask' || (e.state !== 'pending' && e.state !== 'grace')) continue;
    if (!pinned || Date.parse(e.createdAt) < Date.parse(pinned.createdAt)) pinned = e;
  }
  return pinned;
}

/** « il y a 4 min » through the app's words; `bare` leaves out the « il y a » (« 4 min », the notch). */
export function relativeAge(at: string, now: string, words: AgeWords, o: { bare?: boolean } = {}): string {
  const minutes = Math.floor(Math.max(0, Date.parse(now) - Date.parse(at)) / 60_000);
  if (minutes < 1) return words.now;
  const span = minutes < 60 ? words.minutes(minutes) : minutes < 24 * 60 ? words.hours(Math.floor(minutes / 60)) : words.days(Math.floor(minutes / (24 * 60)));
  return o.bare ? span : words.ago(span);
}
