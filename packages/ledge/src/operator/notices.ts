import type { ChatPoint, HumanAsk, OperatorNotice, PushPayload } from '@ledge/protocol';
import { cut, safeTag } from '../mobile/push/triggers.js';

const TEXT_MAX = 300;
const OPTIONS_MAX = 3;
const BODY_MAX = 120;
/** A time that never changes, for an ask whose own times are unreadable: a notice must not differ between two calls. */
const EPOCH = '1970-01-01T00:00:00.000Z';

const openAtoi = (p: ChatPoint) => p.items.filter(i => i.group === 'atoi' && !i.settled);
const validAt = (s: string): boolean => Number.isFinite(Date.parse(s)) && /^\d{4}-\d\d-\d\dT.*Z$/.test(s);

/** A rig ask with every question answered has nothing left to put to the user. */
const settledAsk = (a: HumanAsk): boolean => a.questions.length > 0 && a.questions.every(q => q.answer !== null);

/**
 * What the notch and the phone are told (spec §7): the newest unfolded point that still has something waiting on the user, unless
 * the device set it aside with « Plus tard » (a newer point brings it back); and every urgent or critical rig ask not settled, with
 * its first open question's options. Session requests are not notices: the notch's request bubble stays fed by the sessions.
 * `points` are oldest first; `at` stands in for the time of a point none of whose rows has one.
 */
export function noticesOf(points: Array<{ qid: string; point: ChatPoint; laterAt?: string }>, asks: readonly HumanAsk[], at: string): OperatorNotice[] {
  const out: OperatorNotice[] = [];
  const newest = points.filter(({ point }) => !point.foldedAt && openAtoi(point).length > 0).at(-1);
  if (newest && !(newest.laterAt ?? newest.point.laterAt)) {
    const open = openAtoi(newest.point);
    const when = open.map(i => i.at).sort().at(-1) ?? at;
    out.push({ id: `point:${newest.qid}`, kind: 'point', qid: newest.qid, text: cut(newest.point.lead, TEXT_MAX), priority: 'routine', at: when });
  }
  for (const a of asks) {
    if ((a.priority !== 'urgent' && a.priority !== 'critical') || settledAsk(a)) continue;
    const q = a.questions.find(x => x.answer === null) ?? a.questions[0];
    const options = (q?.options ?? []).slice(0, OPTIONS_MAX).map(o => ({ id: o.id, label: cut(o.label, 60) }));
    out.push({
      id: `rig.ask:${a.id}`, kind: 'rig.ask', text: cut(a.summary, TEXT_MAX), who: cut(a.from.seat, 100), ...(a.from.rig ? { rig: a.from.rig } : {}),
      qitem: a.id, ...(options.length ? { options } : {}), priority: a.priority, at: [a.createdAt, a.updatedAt].find(validAt) ?? EPOCH
    });
  }
  return out;
}

/**
 * The one push of a point: titled « Ledge », the lead as its body. The phone has no route per point (`apps/mobile/src/router.ts` knows
 * `#/chat` only), so the url is the chat tab, where the point is the last turn.
 */
export function pointPush(lead: string, badge: number): PushPayload {
  return { v: 1, kind: 'point', title: 'Ledge', body: cut(lead.trim(), BODY_MAX), url: '/#/chat', badge: Math.max(0, Math.min(999, badge)), tag: safeTag('point') };
}

/** The notices the notch last got: told again only when they change, and replayed to a client that connects later. */
export function createNoticeFeed(send: (n: OperatorNotice[]) => void): { tell(n: OperatorNotice[]): void; current(): OperatorNotice[] | undefined } {
  let last: OperatorNotice[] | undefined;
  return {
    tell(n) { if (last !== undefined && JSON.stringify(n) === JSON.stringify(last)) return; last = n; send(n); },
    current: () => last
  };
}
