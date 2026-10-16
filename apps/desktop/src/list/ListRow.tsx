import type { JSX, MouseEvent } from 'react';
import { PROJECT_COLORS, type Projects, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { helperState } from '../atelier/layout';
import { useI18n } from '../i18n/lang';
import { fold, machineOf, taskOf } from '../nav/agents';
import type { NavAction } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';
import { HelperBot, SessionBot, StateBadge } from '../shell/SessionBot';
import { bucketOf, helperBucket, repoOf, type GroupBy, type ListRow as Row } from './model';
import type { Density } from './prefs';
import { whenOf } from './time';

const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/** Marks the filter's match inside a label (list.tsx's `Hl`), when the accents fold character for character. */
export function Hl({ text, q }: { text: string; q: string }): JSX.Element {
  const needle = fold(q.trim());
  if (!needle) return <>{text}</>;
  const folded = [...text].map(c => fold(c)).join('');
  const i = folded.indexOf(needle);
  if (i < 0 || folded.length !== text.length) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + needle.length)}</mark>{text.slice(i + needle.length)}</>;
}

export interface ListRowProps {
  row: Row;
  /** The row J / K chose. */
  selected: boolean;
  /** Focusing the row itself chooses it. */
  onChoose: (key: string) => void;
  group: GroupBy;
  density: Density;
  /** The text filter, for the marks. */
  text: string;
  now: number;
  /** The start of each wait, by session id. */
  waits: ReadonlyMap<string, string>;
  projects: Projects | null;
  projectIdOf: (s: Session) => string | null;
  paused: boolean;
  dispatch: (a: NavAction) => void;
  onToggleKids: (id: string) => void;
}

/** One row of the List (list.tsx, `row`): bot, name (and the subagents' count), task and repository, badge, machine
 *  (or project when grouped by machine), activity. A subagent's row sits under its parent: its parent's machine, no clock
 *  of its own, and opening it opens the parent's session. */
export function ListRow({ row, selected, onChoose, group, density, text, now, waits, projects, projectIdOf, paused, dispatch, onToggleKids }: ListRowProps): JSX.Element {
  const { t } = useI18n();
  const session = row.kind === 'main' ? row.session : row.parent;
  const helper = row.kind === 'helper' ? row.helper : null;
  const bucket = helper ? helperBucket(helper, session) : bucketOf(session);
  const state = helper ? helperState(helper) : botState(session);
  const name = helper ? helper.kind : session.name;
  const task = helper ? helper.task : taskOf(session);
  const id = projectIdOf(session);
  const project = id === null ? undefined : projects?.projects.find(p => p.id === id);
  const projectName = project?.name ?? t.side.unassigned;
  const swatch = project ? <i className="side-swatch" style={{ background: PROJECT_COLORS[project.color] }} /> : <i className="filter-none" />;
  const machine = machineOf(session);
  const ctx = group === 'machine' ? projectName : machine;
  const when = helper ? null : whenOf(session, waits.get(session.id), now, t.list.when);
  const label = helper ? t.atelier.helperSeat(helper.kind, session.name, helper.task) : t.list.row(name, task, t.list.buckets[bucket].toLowerCase(), ctx);
  const open = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('button,a')) dispatch({ type: 'open', id: session.id }); };
  const size = helper || density === 'tight' ? 24 : 32;

  return (
    <div role="listitem" tabIndex={0} data-agent={row.key} aria-label={label} onClick={open} onFocus={e => { if (e.target === e.currentTarget) onChoose(row.key); }}
      className={cls('lrow', selected && 'keyboard-selected', `b-${bucket}`, `s-${state}`, helper && 'child', row.kind === 'helper' && row.last && 'last', row.kind === 'main' && row.context && 'context')}>
      <span className="r-bot">{helper ? <HelperBot helper={helper} parent={session} size={size} paused={paused} /> : <SessionBot session={session} size={size} paused={paused} />}</span>
      <span className="r-name">
        <strong><Hl text={name} q={text} /></strong>
        {row.kind === 'main' && row.kids > 0 && (
          <button type="button" className="kids-chip" aria-expanded={row.expanded} title={t.list.kids.count(row.kids)}
            aria-label={row.expanded ? t.list.kids.hide(row.kids) : t.list.kids.show(row.kids)} onClick={() => onToggleKids(session.id)}>
            <Icon d={ICONS.chevronRight.d} size={10} />{row.kids}
          </button>
        )}
      </span>
      <span className="r-task">
        <span className="r-title" title={task}><Hl text={task} q={text} /></span>
        <small className="r-repo mono">
          {group === 'state' && <>{swatch}<span className="r-proj">{projectName}</span><span className="sep">·</span></>}
          <Hl text={repoOf(session)} q={text} />
        </small>
      </span>
      <span className="r-state"><StateBadge state={state} offline={session.offline} /></span>
      <span className="r-ctx">{group === 'machine' ? <>{swatch}{projectName}</> : <><Icon d={SHELL_ICONS.machine} size={12} /><Hl text={machine} q={text} /></>}</span>
      {when ? <span className={cls('r-when', when.waiting && 'waiting')} title={when.title}>{when.text}</span> : <span className="r-when" />}
    </div>
  );
}
