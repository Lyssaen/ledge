import type { HumanAnswer, HumanAsk, PhoneSession, PhoneTask, PointAnswer, PointItem } from '@ledge/protocol';
import type { ConfirmRequest } from '../state/store';
import { actionChecked } from './actionCard';

// The operator's point on the phone (docs/mockups/ledge-operator.html, board 7), without the DOM: what a row's answer needs before
// it goes, as the PC's gateway asks it (packages/ledge/src/mobile/gateway.ts, `pointAct`).

/** What a row's answer or suggestion needs: `confirmed` for a destructive one, and the device's check (`check`) to prepare. */
export interface PointNeed { confirmed?: true; check?: ConfirmRequest }

/** An ask's answer as OpenRig takes it (the daemon's `humanAnswerOf`): an option answers the first question still open. */
function humanAnswerOf(ask: HumanAsk, answer: PointAnswer): HumanAnswer | undefined {
  if ('text' in answer) return { kind: 'words', text: answer.text };
  const question = ask.questions.find(q => !q.answer);
  return question ? { kind: 'choice', questionId: question.id, optionId: answer.id } : undefined;
}

/**
 * What answering `item` with `answer` (or applying its suggestion) needs, read from what the phone knows; null when it cannot be
 * sent from here (a rig ask the phone does not see, whose check could not be bound to its answer).
 */
export function pointCheck(qid: string, item: PointItem, answer: PointAnswer | 'suggest',
  state: { asks: readonly HumanAsk[] | null; sessions: ReadonlyMap<string, PhoneSession>; tasks: ReadonlyMap<string, PhoneTask> }): PointNeed | null {
  if (answer === 'suggest') {
    const s = item.suggestion;
    if (!s) return {};
    return {
      ...(s.risk === 'destructive' ? { confirmed: true as const } : {}),
      ...(actionChecked(s) ? { check: { purpose: 'act', qid, item: item.id, suggest: true } as const } : {})
    };
  }
  const ref = item.ref;
  if (!ref) return {};
  const picked = 'id' in answer ? answer.id : undefined;
  if (ref.kind === 'rig.ask') {
    const ask = state.asks?.find(a => a.id === ref.qitem);
    const human = ask ? humanAnswerOf(ask, answer) : undefined;
    return human ? { check: { purpose: 'rig', qitem: ref.qitem, answer: human } } : null;
  }
  if (ref.kind === 'task') {
    if (state.tasks.get(ref.task)?.brain) return picked === 'accept' ? { check: { purpose: 'note', task: ref.task, choice: { yes: true } } } : {};
    return { confirmed: true, check: { purpose: 'act', qid, item: item.id, pointAnswer: answer } };
  }
  const s = state.sessions.get(ref.session);
  const p = s?.pending;
  const decide = p ? { check: { purpose: 'decide', id: ref.session, expect: { key: ref.key, kind: p.kind, text: p.text } } as const } : {};
  if (p?.kind !== 'question' && picked === 'accept') return { confirmed: true, ...(p?.risk !== 'low' ? decide : {}) };
  if (p?.kind === 'question' && p.source === 'rpc' && p.risk !== 'low') return decide;
  return {};
}
