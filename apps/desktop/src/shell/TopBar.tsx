import { PROJECT_COLORS, type Helper, type Projects, type Rig, type Session } from '@ledge/protocol';
import { parseRigFilter, rigColor } from '@ledge/ui/rigs/model';
import { botState } from '@ledge/ui/bots/poseFor';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { helperState } from '../atelier/layout';
import { useI18n } from '../i18n/lang';
import { taskOf } from '../nav/agents';
import type { NavAction, NavState, ProjectFilter } from '../nav/state';
import { isArchived } from '@ledge/protocol';
import { SHELL_ICONS } from './icons';
import { ApprovalBadge, HelperBot, SessionBot, StateBadge } from './SessionBot';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import { useRigControls } from '../rigs/useRigActions';
import { isUnfiled } from '../rigs/proposal';

/** An isolated rig room's bar (maquette w-3): « Fil du rig », then, off any project, « Dépôts · n » and « Ranger dans un projet… », then
 *  « Arrêter le rig… » (its confirmation). Without the app's rig gestures, only the thread. */
function RigBar({ rig, dispatch }: { rig: Rig; dispatch: (a: NavAction) => void }) {
  const { t } = useI18n();
  const a = t.rigActions;
  const controls = useRigControls();
  const live = rig.lifecycle !== 'unreachable' && rig.lifecycle !== 'stopped';
  return (
    <span className="rig-bar">
      <Button size="sm" onClick={() => dispatch({ type: 'ledge', tab: 'conversation' })}>{a.rigThread}</Button>
      {controls && isUnfiled(rig) && <>
        <Button size="sm" onClick={() => controls.showRepos(rig)}>{a.repos(rig.repos.length)}</Button>
        <Button size="sm" onClick={() => controls.askAdopt(rig)}>{a.adopt}</Button>
      </>}
      {controls && live && <Button size="sm" disabled={controls.busy(rig.machine, rig.id)} onClick={() => controls.askStop(rig)}>{a.stopRigBar}</Button>}
    </span>
  );
}

/** The session menu opens under its button, its right edge on the button's (Menu keeps it inside the window). */
const MENU_WIDTH = 260;

/** The mockup's top bar: the breadcrumb on the left (no page title; on a subagent's page, its parent before it); on the right,
 *  icons only, in groups: display (overview only), or the open agent's state, the terminal toggle and the session menu; then
 *  shortcuts and full screen (search and chat are in the title bar). */
export function TopBar({ nav, dispatch, session, helper, projects, rigs = [], projectIdOf, terminal, onTerminal, manage, onRevealArchives, onDetach }: {
  nav: NavState; dispatch: (a: NavAction) => void; session: Session | null; projects: Projects | null; projectIdOf: (s: Session) => string | null;
  /** OpenRig's rigs: a rig filter's chip shows its colour and name. */
  rigs?: readonly Rig[];
  /** The subagent whose page is open (session is then its parent). */
  helper: Helper | null; terminal: boolean; onTerminal(): void;
  /** The session menu from the header « … » (a principal session that is not archived): whether it is open, and opening it at a point under the button. */
  manage?: { open: boolean; onOpen(at: { x: number; y: number }, opener: HTMLElement): void };
  /** The Archived pill: ask the sidebar to unfold Archives and bring the open archive into view. */
  onRevealArchives?: () => void;
  /** « Détacher l'Atelier » (#21), on the overview: only in Tauri, while the Atelier is in this window. */
  onDetach?: () => void;
}) {
  const { t } = useI18n();
  const { place } = nav;
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
        <button className="crumb-link" onClick={() => dispatch({ type: 'home' })} title={t.crumb.escape}>{t.crumb.atelier}</button>
        <span className="muted">/</span>
        <button className="crumb-link" onClick={() => dispatch({ type: 'home', project: pid })} title={filterName(pid)}>{filterName(pid)}</button>
        <span className="muted">/</span>
        {helper ? <>
          <button className="crumb-link crumb-parent" onClick={() => dispatch({ type: 'open', id: session.id })} title={t.crumb.openParent(session.name)}>
            <SessionBot session={session} size={18} paused={nav.paused} />{session.name}
          </button>
          <span className="muted">/</span>
          <span className="crumb-session">
            <HelperBot helper={helper} parent={session} size={22} paused={nav.paused} />
            <strong>{helper.kind}</strong>
            {helper.task && <span className="crumb-task" title={helper.task}>{helper.task}</span>}
          </span>
        </> : (
          <span className="crumb-session">
            <SessionBot session={session} size={22} paused={nav.paused} />
            <strong>{session.name}</strong>
            {taskOf(session) && <span className="crumb-task" title={taskOf(session)}>{taskOf(session)}</span>}
          </span>
        )}
      </>;
    }
    const filter = place.project;
    if (filter === 'all') return <strong>{t.crumb.atelier}</strong>;
    const color = project(filter)?.color;
    // A rig filter: the rig's colour and name; a kernel filter: « Noyau OpenRig ».
    const rf = parseRigFilter(filter);
    const rig = rf?.kind === 'rig' ? rigs.find(r => !r.kernel && r.machine === rf.machine && r.id === rf.rigId) : undefined;
    const label = rf?.kind === 'kernel' ? t.side.rigs.kernel : rf ? rig?.name ?? rf.rigId : filterName(filter);
    return <>
      <button className="crumb-link" onClick={() => dispatch({ type: 'home' })}>{t.crumb.atelier}</button>
      <span className="muted">/</span>
      <span className="project-filter" data-filter={rf?.kind ?? 'project'}>
        {rf?.kind === 'kernel' ? <i className="side-swatch st-kernel-swatch" style={{ background: 'var(--muted-foreground)' }} />
          : rf ? <i className="side-swatch" style={{ background: PROJECT_COLORS[rigColor({ name: rig?.name ?? rf.rigId })] }} />
          : <ProjectSwatch project={filter !== 'none' && color ? { color } : null} />}
        <span title={label}>{label}</span>
        <button aria-label={t.crumb.clearFilter} title={t.crumb.clearFilterTitle} onClick={() => dispatch({ type: 'home' })}><Icon d={ICONS.close.d} size={12} /></button>
      </span>
      {rig && <RigBar rig={rig} dispatch={dispatch} />}
    </>;
  };

  return (
    <header className="app-header" role="banner">
      <div className="breadcrumb"><Icon d={crumbIcon} />{crumbs()}</div>
      {place.kind === 'session' && session && (
        <div className="header-view header-session">
          {isArchived(session)
            ? <button type="button" className="archived-pill" onClick={() => onRevealArchives?.()}><Icon d={SHELL_ICONS.archive} size={12} />{t.manage.archivedBanner.pill}</button>
            : <>{!helper && <ApprovalBadge session={session} />}<StateBadge state={helper ? helperState(helper) : botState(session)} offline={!!session.offline} /></>}
          <span className="view-actions-sep" />
          <Button variant="ghost" size="icon" aria-pressed={terminal} aria-label={terminal ? t.top.terminalHide : t.top.terminalShow} title={terminal ? t.top.terminalHideTitle : t.top.terminalShowTitle} onClick={onTerminal}>
            <Icon d={SHELL_ICONS.terminal} size={16} />
          </Button>
          {manage && !helper && !isArchived(session) && (
            <Button variant="ghost" size="icon" aria-label={t.manage.menu.label(session.name)} title={t.manage.menu.more} aria-haspopup="menu" aria-expanded={manage.open}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); manage.onOpen({ x: r.right - MENU_WIDTH, y: r.bottom + 6 }, e.currentTarget); }}>
              <Icon d={[]} fill={SHELL_ICONS.dots} size={16} />
            </Button>
          )}
        </div>
      )}
      {overview && (
        <div className="header-view">
          <Button variant="ghost" size="icon" aria-pressed={nav.helpers} aria-label={nav.helpers ? t.top.helpersHide : t.top.helpersShow} title={nav.helpers ? t.top.helpersHide : t.top.helpersShow} onClick={() => dispatch({ type: 'helpers' })}>
            <Icon d={nav.helpers ? SHELL_ICONS.subagents : SHELL_ICONS.subagentsOff} size={16} />
          </Button>
          <Button variant="ghost" size="icon" aria-pressed={nav.paused} aria-label={nav.paused ? t.top.play : t.top.pause} title={nav.paused ? t.top.play : t.top.pause} onClick={() => dispatch({ type: 'paused' })}>
            <Icon d={nav.paused ? SHELL_ICONS.play : SHELL_ICONS.pause} size={16} />
          </Button>
          {onDetach && (
            <Button variant="ghost" size="icon" aria-label={t.detached.detach} title={t.detached.detachTitle} onClick={onDetach}>
              <Icon d={SHELL_ICONS.detach} size={16} />
            </Button>
          )}
        </div>
      )}
      <div className="header-actions">
        {overview && <span className="view-actions-sep" />}
        <Button variant="ghost" size="icon" aria-label={t.top.shortcuts} title={t.top.shortcuts} onClick={() => dispatch({ type: 'modal', modal: { kind: 'shortcuts' } })}><Icon d={SHELL_ICONS.help} /></Button>
        <span className="view-actions-sep" />
        <Button variant="ghost" size="icon" aria-label={nav.fullscreen ? t.top.fullscreenExit : t.top.fullscreen} title={nav.fullscreen ? t.top.fullscreenExit : t.top.fullscreen} onClick={() => dispatch({ type: 'fullscreen', on: !nav.fullscreen })}>
          <Icon d={nav.fullscreen ? SHELL_ICONS.collapse : ICONS.expand.d} size={16} />
        </Button>
      </div>
    </header>
  );
}
