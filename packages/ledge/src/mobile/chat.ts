// The phone's view of a chat thread: what Ledge answers is projected to what a phone may see (no folder, no path,
// no machine, no free error text), and the live answer is coalesced so a slow link never builds a backlog.
import {
  CHAT_HISTORY_BUDGET, THREAD_TEXT_MAX, TOOL_TEXT_MAX, MESSAGE_MAX, proposalRows,
  type ChatErrorCode, type ChatTurn, type PhoneChatProposal, type PhoneChatStep, type PhoneChatTurn, type PhoneServerMessage
} from '@ledge/protocol';
import { ONE_AT_A_TIME, TOO_MANY, type Chat, type ChatMessage } from '../chat/service.js';

/** The turns the phone is sent at most, before the byte budget. */
const HISTORY_TURNS = 50;

/** Why a question ended, as a code: the PC's message is never forwarded. */
export function errorCode(message: string): ChatErrorCode {
  if (message === ONE_AT_A_TIME || message === TOO_MANY) return 'busy';
  if (message === 'cancelled') return 'cancelled';
  if (/did not answer within/.test(message)) return 'timeout';
  return 'failed';
}

const stepOf = (s: ChatTurn['steps'][number]): PhoneChatStep => ({ kind: s.kind, ...(s.id !== undefined ? { id: s.id } : {}), ...(s.name !== undefined ? { name: s.name } : {}) });

/** A card is never cut: a prompt or an instruction too long for the phone is not projected at all. */
export function toPhoneTurn(t: ChatTurn): PhoneChatTurn {
  const out: PhoneChatTurn = { qid: t.qid, question: t.question.slice(0, MESSAGE_MAX), askedAt: t.askedAt, steps: t.steps.slice(0, 50).map(stepOf) };
  if (t.answer !== undefined) {
    out.answer = t.answer.slice(0, THREAD_TEXT_MAX);
    if (t.answer.length > THREAD_TEXT_MAX) out.cut = true;
  }
  if (t.answeredAt !== undefined) out.answeredAt = t.answeredAt;
  if (t.error !== undefined) out.error = errorCode(t.error);
  // All or nothing: the phone's row i is the PC's row i, so a card with one row too long is not projected at all.
  const rows = proposalRows(t);
  const proposals: PhoneChatProposal[] = rows.some(p => (p.prompt?.length ?? 0) > TOOL_TEXT_MAX) ? [] : rows
    .map(p => ({
      project: p.project.slice(0, 80), tool: p.tool, ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
      ...(p.launchedId !== undefined ? { launchedId: p.launchedId } : {}), ...(p.error !== undefined ? { failed: true as const } : {})
    }));
  if (proposals.length > 0) out.proposals = proposals;
  if (t.relay && t.relay.text.length <= TOOL_TEXT_MAX) {
    const r = t.relay;
    out.relay = { id: r.id, name: r.name, tool: r.tool, text: r.text, ...(r.status ? { status: r.status } : {}), ...(r.sentAt ? { sentAt: r.sentAt } : {}), ...(r.error !== undefined ? { failed: true as const } : {}) };
  }
  return out;
}

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');

/** The last 50 turns, the oldest dropped while the JSON of the message would pass `CHAT_HISTORY_BUDGET`. */
export function toPhoneHistory(turns: ChatTurn[]): PhoneChatTurn[] {
  const projected = turns.slice(-HISTORY_TURNS).map(toPhoneTurn);
  const sizes = projected.map(bytes);
  // `{"type":"chat.history","turns":[]}` and the commas.
  let total = 40 + sizes.reduce((a, n) => a + n + 1, 0);
  let from = 0;
  while (from < projected.length && total > CHAT_HISTORY_BUDGET) total -= sizes[from++]! + 1;
  return projected.slice(from);
}

export interface PhoneEmitterOpts { now?: () => number; throttleMs?: number; onEnd?: (end: { qid: string; code?: ChatErrorCode }) => void }

/** Translates a chat's messages for one phone. `chat.delta` carries the whole text so far, at most once per `throttleMs` per question
 *  (the first at once, the last with the end), so a lost frame leaves no gap. */
export function phoneEmitter(
  send: (m: PhoneServerMessage, key?: string) => void, chat: Pick<Chat, 'history'>, opts: PhoneEmitterOpts = {}
): (m: ChatMessage) => void {
  const now = opts.now ?? Date.now;
  const throttleMs = opts.throttleMs ?? 250;
  const live = new Map<string, { text: string; sent: string; at: number }>();
  const flushLive = (qid: string) => {
    const l = live.get(qid);
    if (l && l.text !== l.sent) { send({ type: 'chat.delta', qid, text: l.text.slice(0, THREAD_TEXT_MAX) }, `chat.live:${qid}`); l.sent = l.text; }
  };
  /** The one timer per question that sends what a throttled delta left unsent, once the window is over. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const clearTimer = (qid: string) => { const t = timers.get(qid); if (t) { clearTimeout(t); timers.delete(qid); } };
  const done = (qid: string) => {
    clearTimer(qid);
    flushLive(qid);
    live.delete(qid);
    const turn = chat.history().find(t => t.qid === qid);
    // A turn gone from the history (a reset) must still end for the phone.
    if (turn) send({ type: 'chat.done', qid, turn: toPhoneTurn(turn) });
    else send({ type: 'chat.error', qid, code: 'failed' });
  };
  /** The questions that ended: a late delta for one is ignored. Bounded. */
  const finished = new Set<string>();
  const finish = (qid: string) => { finished.add(qid); if (finished.size > 200) finished.delete(finished.values().next().value!); };
  return (m) => {
    switch (m.type) {
      case 'chat.history': return send({ type: 'chat.history', turns: toPhoneHistory(m.turns) }, 'chat.history');
      case 'chat.step': return send({ type: 'chat.step', qid: m.qid, step: stepOf(m.step) });
      case 'chat.delta': {
        if (finished.has(m.qid)) return;
        const l = live.get(m.qid) ?? { text: '', sent: '', at: Number.NEGATIVE_INFINITY };
        live.set(m.qid, l);
        l.text += m.text;
        if (now() - l.at >= throttleMs) { l.at = now(); flushLive(m.qid); }
        else if (!timers.has(m.qid)) {
          // The agent may go quiet right after a burst: the tail of the text must not wait for the next delta.
          const t = setTimeout(() => { timers.delete(m.qid); const x = live.get(m.qid); if (x) { x.at = now(); flushLive(m.qid); } }, Math.max(1, throttleMs - (now() - l.at)));
          t.unref?.();
          timers.set(m.qid, t);
        }
        return;
      }
      case 'chat.done':
        done(m.qid);
        finish(m.qid);
        return opts.onEnd?.({ qid: m.qid });
      case 'chat.error': {
        clearTimer(m.qid);
        live.delete(m.qid);
        finish(m.qid);
        const code = errorCode(m.message);
        send({ type: 'chat.error', qid: m.qid, code });
        // A question that never started ('busy') is no news for a phone that was looking a moment ago.
        return code === 'busy' ? undefined : opts.onEnd?.({ qid: m.qid, code });
      }
      default: {
        // Anything else that names a turn (the relay's progress) is the turn as it stands now.
        const qid = (m as { qid?: unknown }).qid;
        const turn = typeof qid === 'string' ? chat.history().find(t => t.qid === qid) : undefined;
        if (turn) send({ type: 'chat.done', qid: turn.qid, turn: toPhoneTurn(turn) });
      }
    }
  };
}
