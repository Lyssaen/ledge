import type { ChatErrorCode, PhoneChatStep, PhoneChatTurn } from '@ledge/protocol';
import { copy } from '../../copy';
import type { MobileStore } from '../../state/store';
import { Answer, Sources } from './Answer';
import { CloseCards } from './CloseCard';
import { LaunchCards } from './LaunchCard';
import { RelayCard } from './RelayCard';
import { TaskCards } from './TaskCard';
import { TeamCard } from './TeamCard';

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
          <li key={`${i}:${s.kind}:${s.id ?? ''}`} className={`flex items-center gap-2 text-xs text-muted ${doing ? 'motion-safe:animate-pulse' : ''}`}>
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

const ERROR: Record<ChatErrorCode, string> = { busy: copy.chat.busy, timeout: copy.chat.timeout, failed: copy.chat.failed, cancelled: copy.chat.cancelled };

/**
 * One question and what came of it. `live` is the question being answered: its steps and the text so far
 * (the answer's Markdown comes later, the text is shown as it is).
 */
export function TurnView({ store, turn, live, sessions, list, canConfirm, onStop }: { store: MobileStore; turn: PhoneChatTurn; live: { steps: PhoneChatStep[]; text: string } | null; sessions: number; list: { id: string; name: string; repo?: string; exited?: boolean }[]; canConfirm: boolean; onStop: () => void }) {
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
      <div className="max-w-[80%] self-end whitespace-pre-wrap break-words rounded-[18px_18px_4px_18px] bg-raised px-3.5 py-2.5">{turn.question}</div>
      <Steps steps={steps} sessions={sessions} running={!!live && !live.text} />
      {live && text && <p aria-live="polite" className="px-1 whitespace-pre-wrap break-words">{text}</p>}
      {!live && text && <Answer text={text} names={names} />}
      {!live && turn.answer && <Sources names={sourcesOf(steps)} ids={names} />}
      {!live && turn.cut && <span className="px-1 text-xs text-muted">{copy.chat.cut}</span>}
      {!live && turn.error && <p role="status" className="px-1 text-[13px] text-danger-fg">{ERROR[turn.error]}</p>}
      {!live && turn.closes && <CloseCards store={store} qid={turn.qid} closes={turn.closes} canConfirm={canConfirm} sessions={list} />}
      {!live && !turn.closes && relay && <RelayCard store={store} qid={turn.qid} relay={relay} repo={list.find(x => x.id === relay.id)?.repo} known={list.some(x => x.id === relay.id)} />}
      {!live && !turn.closes && turn.proposals && turn.proposals.length > 0 && <LaunchCards store={store} qid={turn.qid} proposals={turn.proposals} canConfirm={canConfirm} sessionIds={new Set(list.map(x => x.id))} />}
      {!live && turn.team && <TeamCard store={store} qid={turn.qid} team={turn.team} canConfirm={canConfirm} />}
      {!live && turn.tasks && turn.tasks.length > 0 && <TaskCards store={store} qid={turn.qid} tasks={turn.tasks} waiting={!!turn.team && turn.team.teamId === undefined} />}
      {live && (
        <button type="button" onClick={onStop} className="inline-flex h-9 items-center gap-2 self-start rounded-control border border-white/15 px-3.5 text-[13px] font-medium">
          <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><rect width="12" height="12" x="6" y="6" rx="1" /></svg>
          {copy.chat.stop}
        </button>
      )}
    </div>
  );
}
