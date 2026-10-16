import { useRef } from 'react';
import { PROJECT_COLORS, type Projects, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { taskOf } from '../nav/agents';
import type { NavAction, NavState, ProjectFilter, View } from '../nav/state';
import { SHELL_ICONS } from './icons';
import { SessionBot, StateBadge } from './SessionBot';

const VIEWS: readonly View[] = ['atelier', 'list'];

/** The mockup's top bar: the breadcrumb on the left (no page title); on the right, icons only, in groups: view and display
 *  (overview only), or the session's state; then search, chat, shortcuts, and full screen. */
export function TopBar({ nav, dispatch, session, projects, projectIdOf }: {
  nav: NavState; dispatch: (a: NavAction) => void; session: Session | null; projects: Projects | null; projectIdOf: (s: Session) => string | null;
}) {
  const { t } = useI18n();
  const tabs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});
  const { place } = nav;
  const viewName = (v: View) => (v === 'list' ? t.crumb.list : t.crumb.atelier);
  const project = (id: string) => projects?.projects.find(p => p.id === id);
  const filterName = (f: ProjectFilter) => (f === 'none' ? t.side.unassigned : project(f)?.name ?? t.side.unassigned);
  const overview = place.kind === 'overview';
  const crumbIcon = place.kind === 'settings' ? SHELL_ICONS.gear : place.kind === 'session' ? ICONS.folder.d : SHELL_ICONS.grid;

  const crumbs = () => {
    if (place.kind === 'settings') return <>
      <button className="crumb-link" onClick={() => dispatch({ type: 'settings', section: 'general' })}>{t.crumb.settings}</button>
      <span className="muted">/</span>
      <strong>{t.sections[place.section]}</strong>
    </>;
    if (place.kind === 'session' && session) {
      const pid = projectIdOf(session) ?? 'none';
      return <>
        <button className="crumb-link" onClick={() => dispatch({ type: 'home' })} title={t.crumb.escape}>{viewName(place.view)}</button>
        <span className="muted">/</span>
        <button className="crumb-link" onClick={() => dispatch({ type: 'home', project: pid })} title={filterName(pid)}>{filterName(pid)}</button>
        <span className="muted">/</span>
        <span className="crumb-session">
          <SessionBot session={session} size={22} paused={nav.paused} />
          <strong>{session.name}</strong>
          <span className="crumb-task" title={taskOf(session)}>{taskOf(session)}</span>
        </span>
      </>;
    }
    const view = place.view;
    const filter = place.project;
    if (filter === 'all') return <strong>{viewName(view)}</strong>;
    const color = project(filter)?.color;
    return <>
      <button className="crumb-link" onClick={() => dispatch({ type: 'home' })}>{viewName(view)}</button>
      <span className="muted">/</span>
      <span className="project-filter">
        <i className={filter === 'none' || !color ? 'filter-none' : 'side-swatch'} style={filter !== 'none' && color ? { background: PROJECT_COLORS[color] } : undefined} />
        <span title={filterName(filter)}>{filterName(filter)}</span>
        <button aria-label={t.crumb.clearFilter} title={t.crumb.clearFilterTitle} onClick={() => dispatch({ type: 'home' })}><Icon d={ICONS.close.d} size={12} /></button>
      </span>
    </>;
  };

  const current: View = place.kind === 'settings' ? place.back.view : place.view;
  const tab = (v: View, d: readonly string[]) => (
    <button key={v} ref={el => { tabs.current[v] = el; }} role="tab" id={`view-tab-${v}`} aria-controls={`view-panel-${v}`} aria-selected={current === v} tabIndex={current === v ? 0 : -1}
      title={viewName(v)} aria-label={viewName(v)} onClick={() => dispatch({ type: 'view', view: v })}
      onKeyDown={e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = VIEWS[(VIEWS.indexOf(current) + 1) % VIEWS.length]!;
        dispatch({ type: 'view', view: next });
        tabs.current[next]?.focus();
      }}>
      <Icon d={d} size={15} />
    </button>
  );

  return (
    <header className="app-header" role="banner">
      <div className="breadcrumb"><Icon d={crumbIcon} />{crumbs()}</div>
      {place.kind === 'session' && session && <div className="header-view header-session"><StateBadge state={botState(session)} offline={!!session.offline} /></div>}
      {overview && (
        <div className="header-view">
          <div className="icon-tabs" role="tablist" aria-label={t.top.viewTabs}>{tab('atelier', SHELL_ICONS.grid)}{tab('list', SHELL_ICONS.list)}</div>
          <span className="view-actions-sep" />
          <Button variant="ghost" size="icon" aria-pressed={nav.helpers} aria-label={nav.helpers ? t.top.helpersHide : t.top.helpersShow} title={nav.helpers ? t.top.helpersHide : t.top.helpersShow} onClick={() => dispatch({ type: 'helpers' })}>
            <Icon d={nav.helpers ? SHELL_ICONS.subagents : SHELL_ICONS.subagentsOff} size={16} />
          </Button>
          <Button variant="ghost" size="icon" aria-pressed={nav.paused} aria-label={nav.paused ? t.top.play : t.top.pause} title={nav.paused ? t.top.play : t.top.pause} onClick={() => dispatch({ type: 'paused' })}>
            <Icon d={nav.paused ? SHELL_ICONS.play : SHELL_ICONS.pause} size={16} />
          </Button>
        </div>
      )}
      <div className="header-actions">
        {overview && <span className="view-actions-sep" />}
        <Button variant="ghost" size="icon" aria-label={t.side.searchLabel} title={t.top.search} onClick={() => dispatch({ type: 'modal', modal: { kind: 'search' } })}><Icon d={SHELL_ICONS.search} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.side.chat} title={t.top.chat} onClick={() => dispatch({ type: 'chat', open: true })}><Icon d={SHELL_ICONS.chat} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.top.shortcuts} title={t.top.shortcuts} onClick={() => dispatch({ type: 'modal', modal: { kind: 'shortcuts' } })}><Icon d={SHELL_ICONS.help} /></Button>
        <span className="view-actions-sep" />
        <Button variant="ghost" size="icon" aria-label={nav.fullscreen ? t.top.fullscreenExit : t.top.fullscreen} title={nav.fullscreen ? t.top.fullscreenExit : t.top.fullscreen} onClick={() => dispatch({ type: 'fullscreen', on: !nav.fullscreen })}>
          <Icon d={nav.fullscreen ? SHELL_ICONS.collapse : ICONS.expand.d} size={16} />
        </Button>
      </div>
    </header>
  );
}
