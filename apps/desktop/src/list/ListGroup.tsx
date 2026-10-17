import type { JSX, ReactNode } from 'react';
import { PROJECT_COLORS } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { Filing } from '../atelier/filing';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import type { Bucket, ListGroup as Group } from './model';

const QUIET: readonly Bucket[] = ['running', 'done', 'offline'];

export interface ListGroupProps {
  group: Group;
  collapsed: boolean;
  /** A text filter or a chip is on: the count reads `shown/members`. */
  filtering: boolean;
  onToggle: () => void;
  dispatch: (a: NavAction) => void;
  /** A project's whole section takes a drop; « Sans projet » says what to do during a drag. */
  filing: Filing;
  /** Its rows, rendered by the List. */
  children: ReactNode;
}

/** A group of the List (list.tsx, `header` and its section): a sticky header (fold, mark, name, branch, count, summary,
 *  « + Nouvelle session » on a project), then its rows unless it is collapsed. */
export function ListGroup({ group: g, collapsed, filtering, onToggle, dispatch, filing, children }: ListGroupProps): JSX.Element {
  const { t } = useI18n();
  const project = g.project && !g.unassigned ? g.project : null;
  const quiet = QUIET.filter(b => g.tally[b] > 0).map(b => t.list.tally[b](g.tally[b])).join(' · ');
  const target = g.kind === 'project' && project ? project : null;
  const over = target !== null && filing.over === target.id;
  return (
    <section className={cls('lgroup', collapsed && 'collapsed', g.unassigned && 'unassigned', over && 'drop-over')} aria-label={g.label} {...(target ? filing.dropProps(target.id) : {})}>
      <div className="lgroup-head">
        <button type="button" className="g-toggle" aria-expanded={!collapsed} aria-label={collapsed ? t.list.expand(g.label) : t.list.collapse(g.label)} onClick={onToggle}>
          <Icon d={ICONS.chevronRight.d} size={13} />
        </button>
        {project ? <i className="side-swatch" style={{ background: PROJECT_COLORS[project.color] }} />
          : g.unassigned ? <Icon d={SHELL_ICONS.unassigned} size={14} />
          : g.machine ? <i className={cls('machine-dot', g.machine.offline && 'off')} />
          : <i className={`g-dot dot-${g.bucket}`} />}
        {project
          ? <button type="button" className="g-name" title={t.list.only(g.label)} onClick={() => dispatch({ type: 'home', project: project.id })}>{g.label}</button>
          : <strong className="g-name">{g.label}</strong>}
        {g.branch && <span className="g-branch mono" title={t.list.branch(g.branch)}>⎇ {g.branch}</span>}
        {g.machine?.offline && <span className="g-branch">{t.list.buckets.offline}</span>}
        <span className="g-count mono">{g.shown}{filtering && g.shown !== g.members.length ? `/${g.members.length}` : ''}</span>
        {g.kind !== 'state' && (
          <span className="g-summary">
            {g.tally.decide > 0 && <span className="g-alert">{t.list.tally.decide(g.tally.decide)}</span>}
            {quiet && <span className="muted">{quiet}</span>}
          </span>
        )}
        {g.unassigned && <span className="g-help muted">{filing.dragging ? t.list.dropHelp : t.list.unassignedHelp}</span>}
        {target && filing.dragging && <span className="drop-hint">{over ? t.list.dropNow(filing.dragging.name) : t.filing.dropHere}</span>}
        <span className="spacer" />
        {project && (
          <button type="button" className="g-add" aria-label={t.list.newSessionIn(g.label)} onClick={() => dispatch({ type: 'modal', modal: { kind: 'launch', project: project.id } })}>
            <Icon d={ICONS.plus.d} size={13} /><span>{t.atelier.newSession}</span>
          </button>
        )}
      </div>
      {!collapsed && <div role="list" className="lgroup-rows">{children}</div>}
    </section>
  );
}
