import { alwaysScope as sharedAlwaysScope, offers, type AlwaysScope, type HumanAnswer, type HumanAsk, type PhoneSession } from '@ledge/protocol';
import type { Op } from '../state/operations';
import { isLive } from '../state/operations';
import type { InboxItem } from './requests';
import { copy } from '../copy';

/*
 * « À toi » (docs/mockups/ledge-mobile-refonte/m1-a-toi.html, commit 3228f5ed): the sessions' requests as cards, OpenRig's asks
 * under « Rigs OpenRig », then the sessions at work. What each card offers and what it becomes once decided.
 */

/** How a session's request is decided in the list (§1, §3, §4, §11). `examine`: it is not decided here, its card opens it. */
export type CardMode =
  | { kind: 'permission'; always: boolean }
  | { kind: 'high' }
  | { kind: 'question'; options: string[]; other: boolean }
  | { kind: 'answerOnPc'; options: string[] }
  | { kind: 'readOnly' }
  | { kind: 'examine' };

/**
 * The card's mode. A plan or a change is examined (§11); so are OMP's own dialogs, which the full request answers
 * (`caps.decide === false`, `caps.questions`). A high-impact accept never offers « Toujours dans ce projet » (§4).
 */
export function cardMode(item: InboxItem, caps: { decide?: boolean; freeTextAnswer?: boolean; questions?: boolean } | undefined, readOnly: boolean): CardMode {
  if (item.kind === 'plan' || item.kind === 'diff') return { kind: 'examine' };
  if (caps?.decide === false || (item.kind === 'question' && caps?.questions === true && item.requestId !== undefined && item.questions?.length)) return { kind: 'examine' };
  if (item.kind === 'question') {
    if (readOnly) return { kind: 'readOnly' };
    const options = item.options ?? [];
    const other = caps?.freeTextAnswer === true;
    return other || options.length > 0 ? { kind: 'question', options, other } : { kind: 'answerOnPc', options };
  }
  if (item.risk === 'high') return { kind: 'high' };
  return { kind: 'permission', always: offers(item.tool, item.kind, 'always') };
}

/**
 * What « Toujours » grants (m2-toujours.html §1, Q67), by the rule every front shares (`@ledge/protocol` `alwaysScope`):
 * Claude's command rule goes to the project, its file tools and Codex hold for the session, its plan switches to auto mode.
 */
export type { AlwaysScope };
export const alwaysScope = (item: Pick<InboxItem, 'tool' | 'kind' | 'pendingTool'>): AlwaysScope =>
  sharedAlwaysScope(item.tool, { kind: item.kind, ...(item.pendingTool ? { tool: item.pendingTool } : {}) });

/** The « Toujours » button's words for that scope. */
export const alwaysLabel = (scope: AlwaysScope): string =>
  scope === 'project' ? copy.atoi.always : scope === 'plan' ? copy.atoi.approveAuto : copy.atoi.alwaysSession;

const RANK = { critical: 0, urgent: 1, routine: 2 } as const;

/** OpenRig's asks in the order of the boards (Q8): critical, then urgent, then the oldest first. */
export const sortAsks = (asks: readonly HumanAsk[]): HumanAsk[] =>
  [...asks].sort((a, b) => RANK[a.priority] - RANK[b.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt));

/** The card's pill: what the ask is (Desktop's `pillOf`). */
export const pillOf = (a: HumanAsk): 'decision' | 'question' | 'update' | 'parked' =>
  a.kind === 'update' ? 'update' : a.kind === 'parked' ? 'parked' : a.questions.length > 0 ? 'decision' : 'question';

/** The seat's role as Desktop writes it: `pilot.lead` → `pilot`. */
export const shortRole = (role: string | null): string | null => role?.replace(/\.agent$|\.lead$|\.worker$/, '') ?? null;

/** Who asks, by the seat's name (`pilot-lead@ledge-dev` → `pilot-lead`), and its role when OpenRig gives one. */
export const whoOf = (a: HumanAsk): { name: string; role: string | null } => ({ name: a.from.seat.split('@')[0] || a.from.seat, role: shortRole(a.from.role) });

/** An option's label, or the words given, as a question shows once answered. */
export function answerLabel(a: HumanAsk, questionId: string): string | null {
  const q = a.questions.find(x => x.id === questionId);
  const given = q?.answer;
  if (!given) return null;
  return given.kind === 'words' ? given.text : q.options.find(o => o.id === given.id)?.label ?? given.id;
}

/** What an answer says, for the receipt (« « Fusionner maintenant » »): the option's label, or the words. */
export function answerText(a: HumanAsk, answer: HumanAnswer): string {
  switch (answer.kind) {
    case 'choice': return a.questions.find(q => q.id === answer.questionId)?.options.find(o => o.id === answer.optionId)?.label ?? answer.optionId;
    case 'words': case 'resolve': return answer.text;
    case 'seen': return '';
  }
}

/**
 * Where this phone's last answer to an ask stands. `recorded`: a choice kept, other questions wait; `sent`/`seen`: it went;
 * `already`: settled elsewhere; `failed`: not sent (why); `uncertain`: it may have gone; `refused`: the device check was
 * refused (`reason`), nothing went.
 */
export type AskEnd =
  | { kind: 'none' }
  | { kind: 'sending'; answer: HumanAnswer }
  | { kind: 'uncertain'; answer: HumanAnswer }
  | { kind: 'recorded'; answer: HumanAnswer }
  | { kind: 'sent'; answer: HumanAnswer }
  | { kind: 'already' }
  | { kind: 'failed'; answer: HumanAnswer; error: string; message?: string }
  | { kind: 'refused'; answer: HumanAnswer; reason: 'confirm_required' | 'assertion_invalid' | 'assertion_expired' | 'unavailable' };

/** This phone's last answer to the ask `qitemId`, as its operations say. */
export function askEndOf(qitemId: string, ops: Record<string, Op>): AskEnd {
  const mine = Object.values(ops)
    .filter((o): o is Op & { message: Extract<Op['message'], { type: 'openrig.answer' }> } => o.message.type === 'openrig.answer' && o.message.qitemId === qitemId)
    .sort((a, b) => a.at.localeCompare(b.at));
  const o = mine[mine.length - 1];
  if (!o) return { kind: 'none' };
  const answer = o.message.answer;
  if (o.rig) {
    const r = o.rig;
    if (r.rejected) return { kind: 'refused', answer, reason: r.rejected };
    if (r.ok) return r.outcome === 'recorded' ? { kind: 'recorded', answer } : r.outcome === 'already' ? { kind: 'already' } : { kind: 'sent', answer };
    // A closed or vanished row is no error: it was settled elsewhere.
    if (r.error === 'closed' || r.error === 'not_found') return { kind: 'already' };
    if (r.error === 'uncertain') return { kind: 'uncertain', answer };
    return { kind: 'failed', answer, error: r.error ?? 'unreachable', ...(r.message ? { message: r.message } : {}) };
  }
  if (isLive(o.phase)) return o.phase === 'uncertain' ? { kind: 'uncertain', answer } : { kind: 'sending', answer };
  if (o.phase === 'applied') return { kind: 'sent', answer };
  return { kind: 'failed', answer, error: o.reason ?? 'unreachable' };
}

/** How many sessions at work « En cours » lists before « Voir les N autres » (Q13). */
export const WORKING_MAX = 5;

/** The sessions at work with no card above (Q13), the latest active first. */
export function workingOf(sessions: readonly PhoneSession[], withCard: ReadonlySet<string>): PhoneSession[] {
  return sessions.filter(s => s.state === 'working' && !withCard.has(s.id)).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
}

/** How many requests make the filter chips come back (Q16). */
export const CHIPS_FROM = 6;

/** How long a receipt stays before it folds (Q10). */
export const RECEIPT_MS = 5_000;

/** What a wide screen's right pane shows next (§12): the open request or ask, by its place in « À toi ». */
export type AtoiTarget = { name: 'request'; sessionId: string; key: string } | { name: 'ask'; id: string };

/**
 * The entries of « À toi » in their order on a wide screen: the sessions' requests (the oldest first), then OpenRig's asks
 * that wait on an answer (Q8's order). A piece of news (« Vu ») is not a request to move on to.
 */
export function atoiOrder(items: readonly InboxItem[], asks: readonly HumanAsk[]): AtoiTarget[] {
  return [
    ...items.map(i => ({ name: 'request' as const, sessionId: i.sessionId, key: i.key })),
    ...sortAsks(asks).filter(a => a.kind !== 'update').map(a => ({ name: 'ask' as const, id: a.id }))
  ];
}

const sameTarget = (a: AtoiTarget, b: AtoiTarget) => a.name === 'request' ? b.name === 'request' && a.sessionId === b.sessionId : b.name === 'ask' && a.id === b.id;

/**
 * The entry after `current` once it is decided (§12 « passe à la demande suivante »): the next one in the order, else the first
 * one left; null when none is left (« Choisis une demande »). `current` itself is never the answer, even while it is still listed.
 */
export function nextAfter(order: readonly AtoiTarget[], current: AtoiTarget, before: readonly AtoiTarget[] = order): AtoiTarget | null {
  const left = order.filter(t => !sameTarget(t, current));
  const at = before.findIndex(t => sameTarget(t, current));
  const after = at < 0 ? [] : before.slice(at + 1);
  return after.find(t => left.some(l => sameTarget(l, t))) ?? left[0] ?? null;
}

/** ↑ / ↓ on a wide screen (§12): the entry before or after `current`, or the first one when nothing is open. */
export function stepFrom(order: readonly AtoiTarget[], current: AtoiTarget | null, by: 1 | -1): AtoiTarget | null {
  if (!order.length) return null;
  const at = current ? order.findIndex(t => sameTarget(t, current)) : -1;
  if (at < 0) return order[0]!;
  return order[Math.min(order.length - 1, Math.max(0, at + by))]!;
}
