import { memo, useMemo, type JSX } from 'react';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import type { PlanDoc } from './thread';

/** The card shows this many steps, then « … et n autres étapes ». */
const SHOWN_STEPS = 3;

/** The first line that is neither a heading nor a list line: what the plan sets out to do (session.tsx renderItem). A plan
 *  without prose has none, rather than its first step shown twice. */
const LIST_LINE = /^\s*(\d+[.)]|[-*+])\s/;
const introOf = (markdown: string) => markdown.split('\n').find(l => l.trim() !== '' && !l.trimStart().startsWith('#') && !LIST_LINE.test(l)) ?? '';

export interface PlanCardProps {
  plan: PlanDoc;
  /** Its tab is the pane's active one: « Ouvert à côté ». */
  open: boolean;
  /** « Lire le plan »: its tab in the side pane. Stable (the page's callback). */
  onOpen(key: string): void;
}

/** A plan the agent proposed (session.tsx renderItem, `plan`): kicker, title and status, its intro, its first steps, and
 *  « Lire le plan » to read it beside the thread. Rendered again only when the plan, its status or its tab change. */
export const PlanCard = memo(function PlanCard({ plan, open, onOpen }: PlanCardProps): JSX.Element {
  const { t } = useI18n();
  const tp = t.session.plan;
  const { key, title, markdown, steps, status } = plan;
  const intro = useMemo(() => introOf(markdown), [markdown]);
  return (
    <div className={`plan-card status-${status}`} data-plan-card={key}>
      <div className="plan-card-head">
        <Icon d={SHELL_ICONS.plan} size={14} />
        <span className="plan-kicker">{tp.kicker}</span>
        <strong>{title}</strong>
        <span className="spacer" />
        <span className={`plan-status ${status}`}>{tp.statuses[status]}</span>
      </div>
      {intro && <div className="plan-intro"><ThreadMarkdown text={intro} /></div>}
      {steps.length > 0 && (
        <ol className="plan-steps">
          {steps.slice(0, SHOWN_STEPS).map((s, i) => <li key={i}>{s}</li>)}
          {steps.length > SHOWN_STEPS && <li className="more">{tp.more(steps.length - SHOWN_STEPS)}</li>}
        </ol>
      )}
      <div className="plan-card-foot">
        {steps.length > 0 && <span className="muted">{tp.steps(steps.length)}</span>}
        <span className="spacer" />
        <Button variant={open ? 'secondary' : 'outline'} size="sm" onClick={() => onOpen(key)}>
          {open ? tp.openBeside : tp.readPlan}<Icon d={ICONS.chevronRight.d} size={13} />
        </Button>
      </div>
    </div>
  );
}, (a, b) => a.open === b.open && a.onOpen === b.onOpen && a.plan.key === b.plan.key && a.plan.markdown === b.plan.markdown && a.plan.status === b.plan.status);
