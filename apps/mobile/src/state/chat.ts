// The phone's chat with Ledge, as the store keeps it: the turns the PC sent, the question being answered, and why the
// last one failed. Pure reducers: the store sends, these only say what each message of the PC changes.
import type { ChatErrorCode, OperationReason, PhoneChatStep, PhoneChatTurn, PhoneServerMessage } from '@ledge/protocol';

export interface ChatState {
  turns: PhoneChatTurn[];
  /** The question being answered: its steps so far, and the whole text so far (replaced by each delta). */
  live: { qid: string; steps: PhoneChatStep[]; text: string } | null;
  /** `offline`: nothing was sent. `busy` carries the question's `text`, for the screen to put back in its field. */
  error: { code: ChatErrorCode | 'offline'; qid?: string; text?: string } | null;
}

/** What a relay or a launch came to, once its operation is final. */
export type ChatAction =
  | { status: 'applied' | 'failed' }
  | { status: 'rejected'; reason: OperationReason }
  | { status: 'cancelled' }
  | { status: 'expired' };

export const emptyChat = (): ChatState => ({ turns: [], live: null, error: null });

const finished = (t: PhoneChatTurn) => t.answer !== undefined || t.error !== undefined;

/** The message of the PC's chat that `reduceChat` takes. */
export type ChatServerMessage = Extract<PhoneServerMessage, { type: 'chat.history' | 'chat.step' | 'chat.delta' | 'chat.done' | 'chat.error' }>;

/** A question just asked: its bubble now, before any answer. */
export function asked(s: ChatState, turn: PhoneChatTurn): ChatState {
  return { turns: [...s.turns, turn], live: { qid: turn.qid, steps: [], text: '' }, error: null };
}

export function reduceChat(s: ChatState, m: ChatServerMessage): ChatState {
  switch (m.type) {
    case 'chat.history': {
      // The PC's thread is the truth, except for a question just asked that its reply was built before seeing: that
      // bubble stays after the history, with its live, until its own done or error.
      const fresh = s.live ? s.turns.find(t => t.qid === s.live?.qid && !finished(t) && !m.turns.some(h => h.qid === t.qid)) : undefined;
      const known = s.live && m.turns.some(t => t.qid === s.live?.qid && !finished(t));
      return { ...s, turns: fresh ? [...m.turns, fresh] : m.turns, live: fresh || known ? s.live : null };
    }
    case 'chat.step': {
      const live = liveFor(s, m.qid);
      if (!live) return s;
      if (m.step.id !== undefined && live.steps.some(x => x.id === m.step.id)) return s;
      return { ...s, live: { ...live, steps: [...live.steps, m.step] } };
    }
    case 'chat.delta': {
      const live = liveFor(s, m.qid);
      return live ? { ...s, live: { ...live, text: m.text } } : s;
    }
    case 'chat.done': {
      const has = s.turns.some(t => t.qid === m.qid);
      const turns = has ? s.turns.map(t => t.qid === m.qid ? m.turn : t) : [...s.turns, m.turn];
      return { ...s, turns, live: s.live?.qid === m.qid ? null : s.live };
    }
    case 'chat.error': {
      const known = s.turns.find(t => t.qid === m.qid);
      // An error for a question the phone does not know, or that already has its answer, changes nothing.
      if (!known || (m.code !== 'busy' && finished(known))) return s;
      const live = s.live?.qid === m.qid ? null : s.live;
      if (m.code === 'busy') {
        // The PC made no turn for it: the bubble goes, and the text comes back to the field.
        const turn = s.turns.find(t => t.qid === m.qid);
        return { turns: s.turns.filter(t => t.qid !== m.qid), live, error: { code: 'busy', qid: m.qid, text: turn?.question ?? '' } };
      }
      return { turns: s.turns.map(t => t.qid === m.qid ? { ...t, error: m.code } : t), live, error: { code: m.code, qid: m.qid } };
    }
  }
}

/** The live question of `qid`; one the phone lost track of (a reload) is picked up again from its unfinished turn. */
function liveFor(s: ChatState, qid: string): NonNullable<ChatState['live']> | null {
  if (s.live?.qid === qid) return s.live;
  if (s.live) return null;
  const t = s.turns.find(x => x.qid === qid);
  return t && !finished(t) ? { qid, steps: [...t.steps], text: '' } : null;
}
