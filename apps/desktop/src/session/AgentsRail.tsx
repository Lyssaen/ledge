import { Fragment, useEffect, useRef, type JSX } from 'react';
import type { Helper, Projects, Session } from '@ledge/protocol';
import { botState, type BotState } from '@ledge/ui/bots/poseFor';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { helperState } from '../atelier/layout';
import { useI18n } from '../i18n/lang';
import { taskOf } from '../nav/agents';
import type { NavAction, NavState } from '../nav/state';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { HelperBot, SessionBot } from '../shell/SessionBot';
import { ProjectSwatch } from '../projects/ProjectSwatch';

/** The rail's dot (office.css .rail-dot): a ring offline, the two requests lit, an error red (as in the sidebar), done or
 *  available muted, anything else at work. */
type RailDot = 'off' | 'approval' | 'question' | 'error' | 'done' | 'working';
const railDotOf = (state: BotState, offline: boolean): RailDot =>
  offline ? 'off' : state === 'approval' || state === 'question' || state === 'error' ? state : state === 'done' || state === 'idle' ? 'done' : 'working';

/** The project's agents beside the session (observatory.tsx project-rail): the main agents of the open one's project — or of
 *  « Sans projet » — in mainOrder, each subagent grouped under its parent when subagents show, and « Nouvelle session ici ».
 *  `flash` (a counter) scrolls the open agent's subagents into view and lights them again (the « N sous-agents » pill). */
export function AgentsRail({ session, helper, order, projects, projectIdOf, nav, dispatch, flash }: {
  session: Session; helper: Helper | null; order: readonly Session[]; projects: Projects | null; projectIdOf(s: Session): string | null;
  nav: NavState; dispatch(a: NavAction): void; flash: number;
}): JSX.Element {
  const { t } = useI18n();
  const r = t.session.rail;
  // A project that is gone counts as « Sans projet », as in mainOrder.
  const groupOf = (s: Session): string | null => {
    const id = projectIdOf(s);
    return id !== null && projects?.projects.some(p => p.id === id) ? id : null;
  };
  const pid = groupOf(session);
  const project = pid === null ? undefined : projects?.projects.find(p => p.id === pid);
  const name = project?.name ?? t.side.unassigned;
  const team = order.filter(s => groupOf(s) === pid);

  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flash) return;
    const group = [...(list.current?.querySelectorAll<HTMLElement>('.rail-kids') ?? [])].find(g => g.dataset.parent === session.id);
    if (!group) return;
    group.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    // Taken off and put back so the animation plays again.
    group.classList.remove('rail-flash');
    void group.offsetWidth;
    group.classList.add('rail-flash');
    // Only a new flash plays it: the rail outlives the agent shown, and switching agent must not light the new one's group.
  }, [flash]);

  const row = (key: string, s: Session, state: BotState, label: { name: string; task: string }, current: boolean, open: NavAction, bot: JSX.Element, child = false) => {
    const offline = !!s.offline;
    const stateText = offline ? t.atelier.offline : t.stateLabel[state];
    return (
      <button key={key} type="button" className={cls('rail-agent', child && 'child', current && 'current')}
        aria-current={current ? 'page' : undefined} data-agent={s.id} aria-label={[label.name, label.task, stateText].filter(Boolean).join(', ')} onClick={() => dispatch(open)}>
        {bot}
        <span><strong>{label.name}</strong><small>{label.task}</small></span>
        {/* The row's name says the state already. */}
        <i className={`rail-dot ${railDotOf(state, offline)}`} aria-hidden="true" />
      </button>
    );
  };

  return (
    <nav className="project-rail" aria-label={r.label(name)}>
      <div className="rail-head">
        <ProjectSwatch project={project ?? null} />
        <span title={name}>{name}</span>
        <small>{team.length}</small>
      </div>
      <div className="rail-list" ref={list}>
        {team.map(s => {
          const kids = nav.helpers ? s.helpers ?? [] : [];
          return (
            <Fragment key={s.id}>
              {row(s.id, s, botState(s), { name: s.name, task: taskOf(s) }, s.id === session.id && helper === null, { type: 'open', id: s.id },
                <SessionBot session={s} size={26} paused={nav.paused} />)}
              {kids.length > 0 && (
                <div className="rail-kids" role="group" aria-label={r.kidsOf(s.name)} data-parent={s.id}>
                  <div className="rail-kids-label"><Icon d={SHELL_ICONS.subagents} size={11} />{r.kids(kids.length)}</div>
                  {kids.map(h => row(h.id, s, helperState(h), { name: h.kind, task: h.task }, s.id === session.id && helper?.id === h.id, { type: 'open', id: s.id, helper: h.id },
                    <HelperBot helper={h} parent={s} size={20} paused={nav.paused} />, true))}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <button type="button" className="rail-new" onClick={() => dispatch({ type: 'modal', modal: pid === null ? { kind: 'launch' } : { kind: 'launch', project: pid } })}>
        <Icon d={ICONS.plus.d} size={13} />{r.newHere}
      </button>
    </nav>
  );
}
