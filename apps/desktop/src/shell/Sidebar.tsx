import { type MachineState } from '@ledge/fleet';
import { PROJECT_COLORS, type Projects, type Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { activeCount, dotOf } from '../nav/agents';
import type { NavAction, NavState } from '../nav/state';
import { SHELL_ICONS } from './icons';
import { useTheme } from './theme';

const needsYou = (s: Session) => { const d = dotOf(s); return d === 'approval' || d === 'question'; };

/** The mockup's sidebar: Ledge, New session and search, the views, the projects with their agents' dots, « Sans projet »,
 *  the machines and Settings. Dropping an agent on a project arrives with the atelier's filing task (lot 4, task 6). */
export function Sidebar({ nav, dispatch, sessions, machines, projects, order, projectIdOf }: { nav: NavState; dispatch: (a: NavAction) => void; sessions: readonly Session[]; machines: readonly MachineState[]; projects: Projects | null; order: readonly Session[]; projectIdOf: (s: Session) => string | null }) {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { place } = nav;
  const filter = place.kind === 'overview' ? place.project : null;
  const unassigned = order.filter(s => projectIdOf(s) === null);
  const active = activeCount(sessions);
  const inSettings = place.kind === 'settings';
  return (
    <aside className="sidebar" aria-label={t.side.label}>
      <div className="side-brand">
        <ResidentMascot size={30} theme={theme} paused={nav.paused} reducedMotion={reduced} />
        <strong>Ledge</strong>
        <span className="spacer" />
      </div>
      <div className="side-actions">
        <Button variant="primary" onClick={() => dispatch({ type: 'modal', modal: { kind: 'launch' } })}>
          <Icon d={ICONS.plus.d} /><span>{t.side.newSession}</span><Kbd>N</Kbd>
        </Button>
        <button className="side-search" onClick={() => dispatch({ type: 'modal', modal: { kind: 'search' } })} aria-label={t.side.searchLabel}>
          <Icon d={SHELL_ICONS.search} size={14} /><span>{t.side.search}</span><Kbd>Ctrl K</Kbd>
        </button>
      </div>
      <div className="side-scroll">
        <nav className="side-group" aria-label={t.side.views}>
          <button className={`side-row ${filter === 'all' ? 'active' : ''}`} onClick={() => dispatch({ type: 'home' })}>
            <Icon d={SHELL_ICONS.grid} /><span>{t.side.atelier}</span><small>{active}</small>
          </button>
          <button className={`side-row ${nav.chat ? 'active' : ''}`} onClick={() => dispatch({ type: 'chat' })}>
            <Icon d={SHELL_ICONS.chat} /><span>{t.side.chat}</span><Kbd>/</Kbd>
          </button>
        </nav>
        <div className="side-group">
          <div className="side-label">
            <span>{t.side.projects}</span>
            <button aria-label={t.side.newProject} onClick={() => dispatch({ type: 'modal', modal: { kind: 'project' } })}><Icon d={ICONS.plus.d} size={13} /></button>
          </div>
          <nav aria-label={t.side.projects}>
            {(projects?.projects ?? []).map(p => {
              const team = order.filter(s => projectIdOf(s) === p.id);
              return (
                <button key={p.id} className={`side-row side-project ${filter === p.id ? 'active' : ''}`} onClick={() => dispatch({ type: 'home', project: p.id })}>
                  <i className="side-swatch" style={{ background: PROJECT_COLORS[p.color] }} />
                  <span title={p.name}>{p.name}</span>
                  <span className="side-dots" aria-label={t.side.agents(team.length)}>{team.slice(0, 6).map(s => <i key={s.id} className={`dot-${dotOf(s)}`} />)}</span>
                </button>
              );
            })}
            {unassigned.length > 0 && (
              <button className={`side-row side-unassigned ${filter === 'none' ? 'active' : ''}`} onClick={() => dispatch({ type: 'home', project: 'none' })}>
                <Icon d={SHELL_ICONS.unassigned} /><span>{t.side.unassigned}</span><small>{unassigned.length}</small>
                {unassigned.some(needsYou) && <b className="side-alert" />}
              </button>
            )}
          </nav>
        </div>
        <div className="side-group">
          <div className="side-label">
            <span>{t.side.machines}</span>
            <button aria-label={t.side.manageMachines} onClick={() => dispatch({ type: 'settings', section: 'machines' })}><Icon d={ICONS.chevronRight.d} size={13} /></button>
          </div>
          {machines.map(m => {
            const offline = m.status === 'unreachable';
            const count = sessions.filter(s => (s.machineId ?? 'local') === m.id).length;
            return (
              <button key={m.id} className={`side-row side-machine ${inSettings && place.section === 'machines' ? 'active' : ''}`} onClick={() => dispatch({ type: 'settings', section: 'machines' })}>
                <i className={`machine-dot ${offline ? 'off' : ''}`} />
                <span title={m.label}>{m.label}</span>
                <small>{offline ? t.side.offline : t.side.agents(count)}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="side-footer">
        <button className={`side-row ${inSettings ? 'active' : ''}`} aria-current={inSettings ? 'page' : undefined}
          onClick={() => { if (!inSettings) { dispatch({ type: 'settings' }); return; } dispatch({ type: 'chat', open: false }); dispatch({ type: 'escape' }); }}>
          <Icon d={SHELL_ICONS.gear} /><span>{t.side.settings}</span><Kbd>Ctrl ,</Kbd>
        </button>
      </div>
    </aside>
  );
}
