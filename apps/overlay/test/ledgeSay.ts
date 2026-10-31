import { act } from '@testing-library/react';
import type { ChatTurn, ClientMessage, LedgeThreadItem, ServerMessage } from '@ledge/protocol';
import { daemonStore } from '../src/daemon/store';

let n = 0;
type Answer = Omit<ChatTurn, 'qid' | 'question' | 'askedAt' | 'steps'> & { steps?: ChatTurn['steps'] };

/** The daemon's answer to a `ledge.say` (lot 4), as messages: Ledge's turn with its cards (`chat.history`, the turns kept so far
 *  included), then its finished bubble in the thread naming that turn. */
export function sayAnswer(say: Extract<ClientMessage, { type: 'ledge.say' }>, answer: Answer, turns: readonly ChatTurn[] = []): { qid: string; messages: ServerMessage[] } {
  const qid = `say-${++n}`, at = new Date().toISOString();
  const turn: ChatTurn = { qid, question: say.text, askedAt: at, steps: [], answeredAt: at, ...answer };
  const item: LedgeThreadItem = { kind: 'ledge', id: `l-${qid}`, at, text: answer.answer ?? '', qid };
  return { qid, messages: [{ type: 'chat.history', turns: [...turns, turn] }, { type: 'ledge.thread.item', item }] };
}

/** Plays the answer to the last `ledge.say` the page sent straight into the store; returns the turn's qid and the text said. */
export function answerSay(sent: readonly ClientMessage[], answer: Answer): { qid: string; text: string } {
  const say = sent.filter((m): m is Extract<ClientMessage, { type: 'ledge.say' }> => m.type === 'ledge.say').at(-1);
  if (!say) throw new Error('no ledge.say sent');
  const { qid, messages } = sayAnswer(say, answer, daemonStore.getState().chat);
  act(() => { for (const m of messages) daemonStore.apply(m); });
  return { qid, text: say.text };
}
