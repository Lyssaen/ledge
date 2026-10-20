import type { JSX, ReactNode } from 'react';
import { useI18n, type Lang } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { cls } from '../shell/cls';
import { fmtDur } from './exchanges';
import { Spin } from './ActionGroup';
import { CLOCK_S, seedOf, stageOf, type Wait, type WaitCause } from './waiting';

/** The waiting row at the end of the rail (mockup C): the agent works and no action runs. A turning node, a phrase (what
 *  the thread last shows, then the bank in turn, then « it takes its time ») and, past a few seconds, the time waited.
 *  Screen readers hear only that the agent works: the phrase changing every few seconds would talk over everything. */
export function WaitLine({ wait, seedKey, now }: { wait: Wait; seedKey: string; now: number }): JSX.Element {
  const { t, lang } = useI18n();
  const tw = t.session.thread.working;
  const { reduced } = useMotionPreferences();
  const secs = Math.max(0, (now - wait.since) / 1000);
  const stage = stageOf(wait.cause, secs, seedOf(seedKey, tw.bank.length), tw.bank.length);
  const phrase = stage.stage === 'fact' ? factOf(wait.cause, tw) : stage.stage === 'bank' ? tw.bank[stage.index] : tw.long;
  return (
    <li className="r wait-row" role="status" aria-label={tw.label}>
      <span className="n node info" aria-hidden="true"><Spin live /></span>
      <span className={cls('wait-phrase', reduced && 'still')} key={stage.stage === 'bank' ? stage.index : stage.stage} aria-hidden="true">{phrase}</span>
      <span className="tm" aria-hidden="true">{secs >= CLOCK_S ? clock(secs, lang) : ''}</span>
    </li>
  );
}

type Copy = ReturnType<typeof useI18n>['t']['session']['thread']['working'];

function factOf(c: WaitCause, tw: Copy): ReactNode {
  switch (c.kind) {
    case 'prompt': return tw.prompt[c.from];
    case 'received': return tw.received(c.from);
    case 'helper': return tw.helper(c.name);
    case 'decision': return tw.decision;
    case 'said': return tw.said;
    case 'tool': {
      const [before, after] = c.failed ? tw.failed : tw.tool[c.verb];
      return <>{before}<code>{c.target}</code>{after}</>;
    }
  }
}

/** Whole seconds under ten (fmtDur's tenths would flicker on a one-second tick), fmtDur after. */
const clock = (secs: number, lang: Lang): string => (secs < 10 ? `${Math.floor(secs)} s` : fmtDur(Math.floor(secs) * 1000, lang));
