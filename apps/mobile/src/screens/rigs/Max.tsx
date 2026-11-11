import { useEffect, useState } from 'react';
import type { Goal } from '@ledge/protocol';
import { copy } from '../../copy';
import { href } from '../../router';
import { LinkStrip, hostName, useShell } from '../../shell/Shell';
import type { Run, RigsStore } from '../../state/rigs';
import { useRigs } from '../../state/rigs';
import { useMobile, type MobileStore } from '../../state/store';
import { BackLink } from '../../ui/Header';
import { Composer } from '../../ui/kit/Controls';
import { Dot, Pill, type DotState, type PillTone } from '../../ui/kit/marks';
import { useWide } from '../../ui/layout';
import { clock } from '../Inbox';
import { Frame, IconLabel, ReadFail, Receipt, Spinner, rigButtonClass } from './kit';
import { isRunning } from './runs';
import { iso } from './RigView';
import { snapWhen } from './sheets';

/*
 * Max, the kernel's operator (m4-rigs.html, §9): the goals given to him, newest first, and a new one from the field; a goal opens as a
 * thread (what was written, his proposal or his question, the trail) with a field to write to him about it. His proposals and questions
 * are answered in « À toi ». No device check: this only writes to Max.
 */

const C = copy.rigs;
const M = C.max;

type GoalState = Goal['state'];

export const GOAL_DOT: Record<GoalState, DotState> = { sent: 'idle', taken: 'work', asking: 'ask', proposed: 'rig', running: 'work', done: 'done', closed: 'done' };
const GOAL_PILL: Record<GoalState, PillTone> = { sent: 'plain', taken: 'work', asking: 'ask', proposed: 'rig', running: 'work', done: 'ok', closed: 'plain' };

/** When a goal last moved: its trail's last step, or when it was sent. */
export const goalAt = (g: Goal): string => g.trail.at(-1)?.at ?? g.sentAt;

/** When Max said what he last said: the trail's step that carries it; null when the trail does not (m4-complement.html, E). */
export const maxAt = (g: Goal): string | null => {
  const word = maxWord(g);
  if (!word) return null;
  for (let i = g.trail.length - 1; i >= 0; i--) if (g.trail[i]!.text === word) return g.trail[i]!.at;
  return null;
};

/** A goal's line under its text in the list (« Max te pose une question · 14:05 », « en cours · docs-pass · depuis hier »). */
function goalSub(g: Goal): string {
  const when = snapWhen(goalAt(g)).short;
  if (g.state === 'asking') return `${M.asks} · ${when}`;
  if (g.state === 'running') return [M.state.running, g.current?.seat.split('@')[0] ?? '', M.since(when)].filter(Boolean).join(' · ');
  return `${M.state[g.state]} · ${when}`;
}

/** What Max last said on a goal: his open question, else his proposal. */
export const maxWord = (g: Goal): string | null => g.question?.text ?? g.proposal?.text ?? null;

/** A run of this screen that failed, in Desktop's words (GoalError), with « Renvoyer » when sending again can help. */
function GoalReceipt({ run, pc, onAgain, onClose }: { run: Run; pc: string; onAgain: () => void; onClose: () => void }) {
  const close = { onClose, closeLabel: C.done.close };
  const again = <button type="button" onClick={onAgain} className={rigButtonClass({ size: 'xs', className: 'mt-1.5' })}>{M.sendAgain}</button>;
  // No word from the PC in time: the same receipt as the PC's own « uncertain », « Renvoyer » sends the same id again.
  const error = run.phase === 'uncertain' ? 'uncertain' : run.phase === 'done' ? run.sent?.error : undefined;
  if (!error) return <Receipt mark="bad" title={M.unsent} sub={M.keeps} {...close}>{again}</Receipt>;
  if (error === 'uncertain') return <Receipt mark="ask" title={M.errors.uncertain.title} sub={M.errors.uncertain.body} {...close}>{again}</Receipt>;
  if (error === 'refused') return <Receipt mark="bad" title={M.errors.refused.title} {...(run.sent?.message ? { sub: <span className="font-mono">{run.sent.message}</span> } : {})} {...close} />;
  if (error === 'openrig_stopped') return <Receipt mark="bad" title={M.errors.openrig_stopped.title(pc)} sub={M.errors.openrig_stopped.body} {...close}>{again}</Receipt>;
  if (error === 'no_operator' || error === 'unreachable') return <Receipt mark="bad" title={M.errors[error].title} sub={M.errors[error].body} {...close}>{again}</Receipt>;
  return <Receipt mark="bad" title={M.unsent} sub={M.keeps} {...close}>{again}</Receipt>;
}

/** A run that went through: the PC said it has it, nothing to show (the goal itself comes with `rigs.goals`). */
const sent = (r: Run): boolean => r.phase === 'done' && !!r.sent?.ok;

/** The runs of the goals and replies sent from this page: while they go, then their failures. */
function GoalRuns({ runs, rigs, pc, bubble }: { runs: readonly Run[]; rigs: RigsStore; pc: string; bubble: boolean }) {
  return (
    <>
      {runs.filter(r => !sent(r)).map(r => {
        const s = r.subject;
        if (s.kind !== 'goal' && s.kind !== 'reply') return null;
        if (isRunning(r)) {
          // The half-opaque bubble with its wheel (M4 §9); « Envoi à Max… » is its accessible name (m4-complement.html, §4).
          return <div key={r.id} role="status" aria-label={M.sending} className="max-w-[85%] self-end rounded-[14px] rounded-br-[5px] bg-secondary px-3 py-2 text-[14px] leading-5 opacity-60">{s.text} <Spinner className="ml-1 align-[-1px] text-muted" /></div>;
        }
        const again = () => {
          rigs.dismiss(r.id);
          void (s.kind === 'goal' ? rigs.sendGoal(s.text, s.goalId) : rigs.replyGoal(s.goalId, s.text, s.replyId));
        };
        return <GoalReceipt key={r.id} run={r} pc={pc} onAgain={again} onClose={() => rigs.dismiss(r.id)} />;
      })}
    </>
  );
}

/** A step of a goal's trail, in words. */
function trailWords(t: Goal['trail'][number]): string {
  switch (t.kind) {
    case 'sent': return M.trail.sent;
    case 'taken': return M.trail.taken;
    case 'note': return M.trail.note(t.text ?? '');
    case 'handed': return M.trail.handed(t.to?.split('@')[0] ?? '');
    case 'closed': return M.trail.closed;
  }
}

/**
 * A goal as a thread: what was written, the trail, what Max said and what waits in « À toi », then the replies under way. `compact`: the
 * kernel's pane on a tablet (M4 §10), without the trail nor the card's sentence.
 */
export function GoalThread({ goal, runs, rigs, pc, compact = false }: { goal: Goal; runs: readonly Run[]; rigs: RigsStore; pc: string; compact?: boolean }) {
  const word = maxWord(goal);
  const said = maxAt(goal);
  const open = goal.question ?? (goal.proposal && !goal.proposal.answer ? goal.proposal : null);
  const mine = runs.filter(r => r.subject.kind === 'reply' && r.subject.goalId === goal.goalId);
  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-[85%] self-end rounded-[14px] rounded-br-[5px] bg-secondary px-3 py-2 text-[14px] leading-5 [overflow-wrap:anywhere]">{goal.text}</div>
      {!compact && goal.trail.some(t => t.kind !== 'sent') && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-muted">
          {goal.trail.filter(t => t.kind !== 'sent').map((t, i) => (
            <li key={`${t.at}-${i}`} className="flex gap-2"><span className="font-mono text-[11.5px]">{clock(iso(t.at))}</span><span className="min-w-0 [overflow-wrap:anywhere]">{trailWords(t)}</span></li>
          ))}
        </ul>
      )}
      {word && (
        <div className="flex flex-col gap-1 text-[13.5px] leading-[19px]">
          <span className="flex items-center gap-1.5 text-[12px] text-muted"><Dot state="idle" />{said ? `${C.kernelView.max} · ${clock(iso(said))}` : C.kernelView.max}</span>
          <span className="[overflow-wrap:anywhere]">{word}</span>
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-attention/45 bg-surface px-3 py-2.5">
          <span className="flex items-center gap-2"><Dot state="ask" /><b className="text-[14px] font-semibold">{goal.question ? M.question : M.proposal}</b>{said && <span className="ml-auto font-mono text-[11.5px] text-muted">{clock(iso(said))}</span>}</span>
          {!compact && <p className="text-[13px] text-muted">{goal.question ? M.questionBody : M.proposalBody}</p>}
          <a href={href({ name: 'atoi' })} className={rigButtonClass({ size: 'sm', className: 'self-start' })}>{M.seeAtoi}</a>
        </div>
      )}
      <GoalRuns runs={mine} rigs={rigs} pc={pc} bubble />
    </div>
  );
}

/** The field under a goal: a word to Max about it (`rigs.goal.reply`). */
export function ReplyField({ goalId, rigs, live }: { goalId: string; rigs: RigsStore; live: boolean }) {
  const [text, setText] = useState('');
  return (
    <Composer
      label={M.replyPlaceholder} sendLabel={M.send} placeholder={M.replyPlaceholder} offlinePlaceholder={M.offlinePlaceholder} offline={!live}
      value={text} onChange={setText} onSend={() => { const t = text.trim(); if (!t) return; setText(''); void rigs.replyGoal(goalId, t).then(r => { if (r.phase === 'unsent') setText(x => x || t); }); }}
    />
  );
}

/** Max's goals (`#/max`), or one of them as a thread (`#/max/<goalId>`). */
export function Max({ goalId, rigs, store }: { goalId?: string | undefined; rigs: RigsStore; store: MobileStore }) {
  const r = useRigs(rigs);
  const m = useMobile(store);
  const { pc, look } = useShell();
  const wide = useWide();
  const live = m.fresh;
  const offline = look === 'offline';
  const name = hostName(pc);
  const [text, setText] = useState('');
  useEffect(() => { rigs.follow(); rigs.followGoals(); }, [rigs, live]);
  const goals = r.goals?.data?.goals ?? [];
  const goal = goalId ? goals.find(g => g.goalId === goalId) : undefined;
  const scroll = `tab-main flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-[18px] ${wide ? 'pt-[18px]' : 'pt-3'}`;
  const headClass = wide ? 'pane-head flex h-[58px] flex-none items-center gap-2 border-b border-line pr-2' : 'flex h-14 flex-none items-center gap-2 border-b border-line pr-2 pl-0.5';
  const field = 'bleed flex-none border-t border-line bg-bg px-3.5 pt-2.5 pb-3';
  const status = (() => {
    if (r.goals?.error && !r.goals.data) return <Frame><ReadFail retry={() => rigs.followGoals()} retryLabel={C.unavailable.retry}>{M.goalsUnavailable}</ReadFail></Frame>;
    if (!r.goals?.data) return <p role="status" className="text-[13px] text-muted">{C.loading}</p>;
    return null;
  })();

  if (goalId) {
    return (
      <>
        <header className={headClass}>
          <BackLink fallback={{ name: 'max' }} label={C.backMax} />
          <h1 className="min-w-0 truncate text-base font-semibold">{goal?.text ?? M.title}</h1>
          {goal && <span className="flex-none"><Pill tone={GOAL_PILL[goal.state]}>{M.statePill[goal.state]}</Pill></span>}
        </header>
        <main data-tab-scroll="" className={`${scroll} justify-end`}>
          <LinkStrip body={C.offlineBody} />
          {goal ? <div className={offline ? 'opacity-50' : ''}><GoalThread goal={goal} runs={r.runs} rigs={rigs} pc={name} /></div> : status ?? <p role="alert" className="text-[13px] text-attention">{M.goalsUnavailable}</p>}
        </main>
        {goal && <div className={field}><ReplyField goalId={goal.goalId} rigs={rigs} live={live} /></div>}
      </>
    );
  }

  const goalRuns = r.runs.filter(x => x.subject.kind === 'goal');
  // « Le champ garde ton texte. »: a goal that did not leave comes back into the field.
  const send = () => { const t = text.trim(); if (!t) return; setText(''); void rigs.sendGoal(t).then(x => { if (x.phase === 'unsent') setText(v => v || t); }); };
  const focusField = () => { document.querySelector<HTMLTextAreaElement>('[data-goal-field] textarea')?.focus(); };
  return (
    <>
      <header className={headClass}>
        <BackLink fallback={{ name: 'kernel' }} label={C.backKernel} />
        <h1 className="flex-none text-base font-semibold">{M.title}</h1>
        <span className="min-w-0 truncate text-[12.5px] text-muted">{M.role}</span>
        <span className="flex-1" />
        <button type="button" disabled={!live} onClick={focusField} className={rigButtonClass({ tone: 'primary', size: 'sm' })}><IconLabel icon="plus">{M.newGoal}</IconLabel></button>
      </header>
      <main data-tab-scroll="" className={scroll}>
        <LinkStrip body={C.offlineBody} />
        <div className={`flex flex-col gap-3 ${offline ? 'opacity-50' : ''}`}>
          {status ?? (goals.length === 0
            ? <Frame><ReadFail>{M.none}</ReadFail></Frame>
            : (
              <Frame label={M.goalsLabel}>
                {goals.map(g => (
                  <a key={g.goalId} href={href({ name: 'max', goalId: g.goalId })} className="flex items-start gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0">
                    <span className="mt-1.5"><Dot state={GOAL_DOT[g.state]} pulse={g.state === 'running'} /></span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 text-[14px] leading-5 [overflow-wrap:anywhere]">{g.text}</span>
                      <small className={`text-[12px] ${g.state === 'asking' ? 'text-attention' : 'text-muted'}`}>{goalSub(g)}</small>
                    </span>
                  </a>
                ))}
              </Frame>
            ))}
          {r.goals?.data?.partial && <p className="text-[12px] leading-4 text-muted">{M.partial}</p>}
          <GoalRuns runs={goalRuns} rigs={rigs} pc={name} bubble={false} />
          <p className="text-[12px] leading-4 text-muted">{M.atoiNote}</p>
        </div>
      </main>
      <div data-goal-field="" className={field}>
        <Composer label={M.goalPlaceholder} sendLabel={M.send} placeholder={M.goalPlaceholder} offlinePlaceholder={M.offlinePlaceholder} offline={!live} value={text} onChange={setText} onSend={send} />
      </div>
    </>
  );
}
