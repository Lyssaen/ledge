import type { ReactNode } from 'react';
import type { ChatErrorCode, PhoneChatStep, PhoneChatTurn, PhoneSession } from '@ledge/protocol';
import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { PhoneThumbs } from '../PhoneThumbs';
import { ActionCards } from './ActionCard';
import { Answer, Sources } from './Answer';
import { CloseCards } from './CloseCard';
import { LaunchCards } from './LaunchCard';
import { RelayCard } from './RelayCard';
import { TaskCards } from './TaskCard';
import { kitButtonClass } from '../kit/Controls';
import type { PhoneHarnessUsage } from '@ledge/protocol';
import { CompactLimits } from './Limits';
import { StorePoint } from './PointTurn';

/** Under an answer, the edge that sets what it shows apart from Ledge's text (m3-chat.html `.inans`). */
export const IN_ANSWER = 'flex flex-col gap-1.5 border-l-2 border-line pl-2.5';

const ICON = 'size-3.5 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';

/** What a step says, by kind. */
export function stepLabel(step: PhoneChatStep, sessions: number): string {
  const name = step.name ?? step.id ?? '';
  switch (step.kind) {
    case 'sessions': return copy.chat.steps.sessions(sessions);
    case 'pane': return copy.chat.steps.pane(name);
    case 'reply': return copy.chat.steps.reply(name);
    case 'git': case 'repo': return copy.chat.steps.look(name);
  }
}

/** The names of the sessions whose terminal or reply Ledge read, once each: « Sources : ». */
function sourcesOf(steps: PhoneChatStep[]): string[] {
  const names = steps.filter(s => s.kind === 'pane' || s.kind === 'reply').map(s => s.name ?? s.id).filter((n): n is string => !!n);
  return [...new Set(names)];
}

function Steps({ steps, sessions, running }: { steps: PhoneChatStep[]; sessions: number; running: boolean }) {
  if (steps.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2 px-1 py-0.5" aria-label={copy.chat.stepsLabel}>
      {steps.map((s, i) => {
        const doing = running && i === steps.length - 1;
        return (
          <li key={`${i}:${s.kind}:${s.id ?? ''}`} className={`flex items-center gap-2 text-small text-muted ${doing ? 'motion-safe:animate-pulse' : ''}`}>
            {doing
              ? <svg className={`${ICON} motion-safe:animate-spin`} viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>
              : <svg className={`${ICON} text-ok`} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>}
            {stepLabel(s, sessions)}
          </li>
        );
      })}
    </ul>
  );
}

/** Read at render, so the words follow the language chosen. */
const errorText = (c: ChatErrorCode): string => ({ busy: copy.chat.busy, timeout: copy.chat.timeout, failed: copy.chat.failed, cancelled: copy.chat.cancelled })[c];

/**
 * One question and what came of it. `live` is the question being answered: its steps and the text so far
 * (the answer's Markdown comes later, the text is shown as it is).
 */
export function TurnView({ store, turn, live, sessions, list, canConfirm, onAskAgain, readOnly = false, limits, inAnswer }: { store: MobileStore; turn: PhoneChatTurn; live: { steps: PhoneChatStep[]; text: string } | null; sessions: number; list: { id: string; name: string; repo?: string; exited?: boolean; state?: PhoneSession['state']; helpers?: PhoneSession['helpers'] }[]; canConfirm: boolean;
  /** « Reposer la question » after a timeout or a failure (Q37): the same question, as a new one; absent while it cannot be sent. */
  onAskAgain?: (question: string) => void;
  /** A past conversation (m3-chat.html §6): its cards keep their outcome and are switched off; the PC refuses any action on them. */
  readOnly?: boolean;
  /** The answer read the account limits (Q31): when, and the phone's own usage to draw them with. */
  limits?: { at: string; usage: readonly PhoneHarnessUsage[]; alert: number | null; fresh: boolean } | undefined;
  /** Under « Sources » (Q30): the requests waiting in them, or the lines of those settled since. */
  inAnswer?: ReactNode }) {
  // A point Ledge wrote on its own (board 7): its rows, nothing else of the turn.
  if (turn.point) return <StorePoint store={store} turn={{ ...turn, point: turn.point }} readOnly={readOnly} />;
  const steps = live?.steps ?? turn.steps;
  const text = live ? live.text : turn.answer;
  // A name two sessions share says nothing about which one is meant: it is not linked.
  const names = new Map<string, string>();
  const shared = new Set<string>();
  for (const x of list) { if (!x.name) continue; if (names.has(x.name)) shared.add(x.name); else names.set(x.name, x.id); }
  for (const n of shared) names.delete(n);
  const relay = turn.relay;
  return (
    <div className="flex flex-col gap-3">
      {turn.question && <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-[12px_12px_4px_12px] bg-raised px-3 py-2">{turn.question}</div>}
      {turn.attachments && <div className="self-end max-w-full"><PhoneThumbs store={store} refs={turn.attachments} align="end" /></div>}
      <Steps steps={steps} sessions={sessions} running={!!live && !live.text} />
      {live && text && <p aria-live="polite" className="px-1 whitespace-pre-wrap break-words">{text}</p>}
      {!live && text && <Answer text={text} names={names} />}
      {!live && turn.answer && <Sources names={sourcesOf(steps)} ids={names} />}
      {!live && turn.answer && inAnswer}
      {!live && turn.answer && limits && <CompactLimits usage={limits.usage} now={Date.now()} alert={limits.alert} fresh={limits.fresh} at={limits.at} />}
      {!live && turn.cut && <span className="px-1 text-small text-muted">{copy.chat.cut}</span>}
      {!live && turn.error && (
        // Under the question, with what can be done next (m3-chat.html §3): a stop is only said.
        <div className="flex flex-col items-start gap-1.5 px-1">
          <p role="status" className={`text-[13.5px] ${turn.error === 'cancelled' ? 'text-muted' : turn.error === 'busy' ? 'text-attention' : 'text-danger-fg'}`}>{errorText(turn.error)}</p>
          {(turn.error === 'timeout' || turn.error === 'failed') && turn.question && onAskAgain && (
            <button type="button" onClick={() => onAskAgain(turn.question)} className={kitButtonClass({ size: 'xs' })}>{copy.chat.askAgain}</button>
          )}
        </div>
      )}
      {!live && (
      <fieldset disabled={readOnly} className="contents">
      {!live && turn.closes && <CloseCards store={store} qid={turn.qid} closes={turn.closes} canConfirm={canConfirm} sessions={list} />}
      {!live && !turn.closes && relay && <RelayCard store={store} qid={turn.qid} relay={relay} target={list.find(x => x.id === relay.id)} known={list.some(x => x.id === relay.id)} ignoredAt={turn.ignoredAt} />}
      {!live && !turn.closes && turn.proposals && turn.proposals.length > 0 && <LaunchCards store={store} qid={turn.qid} proposals={turn.proposals} canConfirm={canConfirm} sessionIds={new Set(list.map(x => x.id))} ignoredAt={turn.ignoredAt} />}
      {!live && turn.actions && <ActionCards store={store} qid={turn.qid} actions={turn.actions} ignoredAt={turn.ignoredAt} canConfirm={canConfirm} readOnly={readOnly} />}
      {!live && turn.tasks && turn.tasks.length > 0 && <TaskCards store={store} qid={turn.qid} tasks={turn.tasks} />}
      </fieldset>
      )}
    </div>
  );
}
