import { useState, type JSX } from 'react';
import type { MachineState } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { Filing } from '../../atelier/filing';
import type { Decisions } from '../../fleet/decisions';
import { useI18n } from '../../i18n/lang';
import type { Wait } from '../../list/time';
import type { SessionActions } from '../../manage/useSessionActions';
import { useMotionPreferences } from '../../motionPreferences';
import { activeCount } from '../../nav/agents';
import type { NavAction, NavState } from '../../nav/state';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { useTheme } from '../theme';

/** The explorer shell: Session, Ask Ledge, Atelier, then the foot. Attention, the tree and Archives are empty sections until their own tasks;
 *  the tree still names each project so the app's boot can find the row. */
export function Sidebar(p: {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; archived: readonly Session[];
  machines: readonly MachineState[]; projects: Projects | null;
  order: readonly Session[]; projectIdOf: (s: Session) => string | null;
  filing: Filing; actions: SessionActions; decisions: Decisions;
  waits: ReadonlyMap<string, Wait>;
  menu: { open(id: string, at: { x: number; y: number }, opener?: HTMLElement): void };
  onAsk(text: string): void;
  onTerminal(s: Session): void;
  revealArchives: number; revealCurrent: number;
}): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const [ask, setAsk] = useState('');
  const { place } = p.nav;
  const atelierOn = place.kind === 'overview' && place.view === 'atelier';
  const inSettings = place.kind === 'settings';
  const active = activeCount(p.sessions);
  const submitAsk = () => {
    const q = ask.trim();
    p.dispatch({ type: 'chat', open: true });
    if (q) { p.onAsk(q); setAsk(''); }
  };
  return (
    <aside className="sidebar st" aria-label={t.side.label}>
      <div className="st-brand">
        <span className="st-fill" />
        <button type="button" className="st-new" onClick={() => p.dispatch({ type: 'modal', modal: { kind: 'launch' } })}>
          <Icon d={ICONS.plus.d} size={13} /><span>{t.side.newSession}</span><Kbd accent>N</Kbd>
        </button>
      </div>
      <label className={cls('st-ask', p.nav.chat && 'on')}>
        <button type="button" tabIndex={-1} className="st-mascot" aria-label={t.side.openChat} title={t.side.openChat} onClick={e => { e.preventDefault(); p.dispatch({ type: 'chat', open: true }); }}>
          <ResidentMascot size={20} theme={theme} paused={p.nav.paused} reducedMotion={reduced} />
        </button>
        <input data-ask-input="" type="text" aria-label={t.side.ask} placeholder={t.side.askPlaceholder} value={ask} onChange={e => setAsk(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitAsk(); } else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} />
        <Kbd>/</Kbd>
      </label>
      <nav className="st-views" aria-label={t.side.views}>
        <button type="button" className={atelierOn ? 'on' : undefined} aria-current={atelierOn ? 'page' : undefined} onClick={() => p.dispatch({ type: 'home' })}>
          <Icon d={SHELL_ICONS.grid} size={13} /><span>{t.side.atelier}</span><span className="st-fill" /><small>{t.side.active(active)}</small>
        </button>
      </nav>
      <div className="st-scroll">
        <section aria-label={t.side.yours} />
        <section aria-label={t.side.tree}>
          {(p.projects?.projects ?? []).map(project => (
            <button key={project.id} type="button" onClick={() => p.dispatch({ type: 'home', project: project.id })}>
              <ProjectSwatch project={project} /><span>{project.name}</span>
            </button>
          ))}
        </section>
        <section aria-label={t.side.archives} />
      </div>
      <div className="st-foot">
        {p.machines.map(m => {
          const offline = m.status === 'unreachable';
          const count = p.sessions.filter(s => (s.machineId ?? 'local') === m.id).length;
          return (
            <button key={m.id} type="button" className="st-mach" title={offline ? `${m.label} · ${t.side.offline}` : `${m.label} · ${t.side.agents(count)}`}
              onClick={() => p.dispatch({ type: 'settings', section: 'machines' })}>
              <i className={`machine-dot${offline ? ' off' : ''}`} />{m.label}{!offline && <small>{count}</small>}
            </button>
          );
        })}
        <span className="st-fill" />
        <button type="button" className={cls('st-icon', inSettings && 'on')} aria-label={t.side.settings} title={`${t.side.settings} · Ctrl ,`} aria-current={inSettings ? 'page' : undefined}
          onClick={() => p.dispatch({ type: 'settings' })}>
          <Icon d={SHELL_ICONS.gear} size={15} />
        </button>
      </div>
    </aside>
  );
}
