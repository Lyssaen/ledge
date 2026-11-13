import type { HumanAnswer, HumanAsk, PointAnswer, PointItem, Session, DecidedBy } from '@ledge/protocol';
import { pendingKey } from '@ledge/protocol';
import type { Chat, ChatMessage } from '../chat/service.js';
import type { DeviceId } from './journal.js';
import type { Operator } from './index.js';

/** Why an answer did not go: `error` is what the item shows, `code` what a front may recognise (`confirm_required` shows no error). */
export interface PointRefusal { ok: false; error: string; code?: string }
export type PointResult = { ok: true } | PointRefusal;
/** What a daemon handler gives back: nothing when it went, else its reason. */
export type Fail = undefined | { message: string; code?: string };

export interface PointActDeps {
  chatOf(device: DeviceId): { chat: Pick<Chat, 'points' | 'updatePoint'>; emit: (m: ChatMessage) => void } | undefined;
  session(id: string): Session | undefined;
  asks(): readonly HumanAsk[];
  /** The session's own decide path (`session.decide`, as a card's row applies it): an accept is refused unless `confirmed`. */
  decide(session: string, decision: 'accept' | 'deny', confirmed: boolean, by?: DecidedBy): Promise<Fail>;
  /** A reply typed to the session (a question's option digit, or the words). */
  reply(session: string, text: string, by?: DecidedBy): Promise<Fail>;
  /** `human.answer`, which does not settle the ask itself (the point does, with where `chat`). */
  answerAsk(qitem: string, answer: HumanAnswer): Promise<{ ok: boolean; message?: string; error?: string; outcome?: string }>;
  /** The decision a session put to the user (`task.answer`, destructive: refused unless `confirmed`). */
  answerTask(task: string, text: string, confirmed: boolean): Promise<Fail>;
  /** A proposal about the notes: written when `yes`. */
  answerBrain(task: string, yes: boolean): Fail;
  /** Whether the task is a proposal about the notes rather than a decision. */
  isBrain(task: string): boolean;
  operator: Pick<Operator, 'settle'>;
}

const STALE = 'already settled';

/** An ask's answer as OpenRig takes it: an option answers the first question still open, words are words. */
export function humanAnswerOf(ask: HumanAsk, answer: PointAnswer): HumanAnswer | undefined {
  if ('text' in answer) return { kind: 'words', text: answer.text };
  const question = ask.questions.find(q => !q.answer);
  return question ? { kind: 'choice', questionId: question.id, optionId: answer.id } : undefined;
}
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * Acts on a row of a point (spec §4): the answer goes through the daemon's own handler for what the row is about, then the row is settled
 * with where `chat`. An answer that fails is shown on the row; a request that changed since the point was written sends nothing.
 */
export function createPointActor(deps: PointActDeps) {
  const markError = (device: DeviceId, qid: string, id: string, error: string) => {
    const c = deps.chatOf(device); if (!c) return;
    c.chat.updatePoint(qid, p => ({ ...p, items: p.items.map(i => (i.id === id ? { ...i, error: clip(error, 200) } : i)) }), c.emit);
  };

  return {
    async act(device: DeviceId, msg: { qid: string; item: string; answer: PointAnswer; confirmed?: true }, by?: DecidedBy): Promise<PointResult> {
      const c = deps.chatOf(device);
      const item: PointItem | undefined = c?.chat.points().find(p => p.qid === msg.qid)?.point.items.find(i => i.id === msg.item);
      if (!c || !item) return { ok: false, error: 'unknown item', code: 'unknown_item' };
      const refuse = (error: string, code?: string): PointRefusal => { markError(device, msg.qid, item.id, error); return { ok: false, error, ...(code ? { code } : {}) }; };
      if (item.settled || !item.ref) return refuse(STALE, 'settled');
      const confirmed = msg.confirmed === true;
      const text = 'text' in msg.answer ? msg.answer.text : undefined;
      const id = 'id' in msg.answer ? msg.answer.id : undefined;
      const labelOf = (): string => text ?? item.answers?.find(a => a.id === id)?.label ?? id ?? '';
      const done = (fail: Fail): PointResult => {
        if (fail) return fail.code === 'confirm_required' ? { ok: false, error: fail.message, code: fail.code } : refuse(fail.message, fail.code);
        const at = item.id.indexOf(':');
        deps.operator.settle(item.id.slice(0, at), item.id.slice(at + 1), 'chat', labelOf());
        return { ok: true };
      };
      const ref = item.ref;
      if (ref.kind === 'session.request') {
        const s = deps.session(ref.session);
        if (!s?.pending || pendingKey(s.pending) !== ref.key) return refuse('changed', 'changed');
        if (s.pending.kind === 'question') {
          // An option is its index; the select dialog takes it as a digit, an OMP dialog as the option's own words.
          const option = id !== undefined ? s.pending.options?.[Number(id)] : undefined;
          if (id !== undefined && option === undefined) return refuse('unknown answer', 'invalid');
          const typed = text ?? (s.backend === 'omp-rpc' ? option! : String(Number(id) + 1));
          return done(await deps.reply(s.id, typed, by));
        }
        if (id !== 'accept' && id !== 'deny') return refuse('unknown answer', 'invalid');
        return done(await deps.decide(s.id, id, confirmed, by));
      }
      if (ref.kind === 'rig.ask') {
        const ask = deps.asks().find(a => a.id === ref.qitem);
        if (!ask) return refuse('changed', 'changed');
        const answer = humanAnswerOf(ask, msg.answer);
        if (!answer) return refuse('unknown answer', 'invalid');
        const r = await deps.answerAsk(ref.qitem, answer);
        if (!r.ok) return refuse(r.message ?? r.error ?? 'failed');
        // Questions that still wait leave the row open: it is settled by the last answer.
        if (r.outcome === 'recorded') return { ok: true };
        return done(undefined);
      }
      // A decision (the answer is its option's label, or words) or a proposal about the notes (accept / deny).
      const brain = (id === 'accept' || id === 'deny') && deps.isBrain(ref.task);
      if (brain) return done(deps.answerBrain(ref.task, id === 'accept'));
      const words = text ?? id;
      if (words === undefined) return refuse('unknown answer', 'invalid');
      return done(await deps.answerTask(ref.task, words, confirmed));
    }
  };
}
