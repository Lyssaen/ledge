import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { PROJECT_COLORS, type Project, type Projects, type Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { activeCount } from '../nav/agents';
import { useScreenKeys } from '../nav/screenKeys';
import type { NavAction, NavState } from '../nav/state';
import { sceneOf, walkOrder } from './layout';
import { LedgeDesk } from './LedgeDesk';
import { ProjectTable } from './ProjectTable';
import { Unassigned } from './Unassigned';

export interface AtelierProps {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; projects: Projects | null; order: readonly Session[];
  projectIdOf: (s: Session) => string | null;
}

/** A folder's own name: the last segment of its path. */
const folderOf = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The filtered project has no agent yet: say where its table will appear, and offer to start a session there. */
function EmptyProject({ project, dispatch }: { project: Project; dispatch: (a: NavAction) => void }): JSX.Element {
  const { t } = useI18n();
  const where = project.repos.map(r => folderOf(r.path)).join(' · ') || t.atelier.empty.noRepo;
  return (
    <div className="empty-project">
      <i className="side-swatch" style={{ background: PROJECT_COLORS[project.color] }} />
      <h2>{t.atelier.empty.title(project.name)}</h2>
      <p>{t.atelier.empty.body(where)}</p>
      <Button variant="primary" onClick={() => dispatch({ type: 'modal', modal: { kind: 'launch', project: project.id } })}>
        <Icon d={ICONS.plus.d} size={14} />{t.atelier.newSession}
      </Button>
    </div>
  );
}

/** The atelier (observatory.tsx, atelier mode): Ledge's desk, a table per project with agents, the filtered project's
 *  empty state, « Sans projet », then the legend. J / K (or ↓ / ↑) walk the agents shown, Entrée opens the chosen one. */
export function Atelier({ nav, dispatch, sessions, projects, order, projectIdOf }: AtelierProps): JSX.Element {
  const { t } = useI18n();
  const { reduced } = useMotionPreferences();
  const { place } = nav;
  const filter = place.kind === 'settings' ? place.back.project : place.project;
  const scene = useMemo(() => sceneOf(order, projects, projectIdOf, filter), [order, projects, projectIdOf, filter]);
  const walk = useMemo(() => walkOrder(scene), [scene]);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The chosen agent left the walk (gone, filed elsewhere, filtered out): nothing stays chosen.
  useEffect(() => { if (focusedId !== null && !walk.some(s => s.id === focusedId)) setFocusedId(null); }, [walk, focusedId]);

  const scroll = useRef<HTMLDivElement>(null);
  useScreenKeys(e => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[role=tablist],[role=menu]')) return false;
    const key = e.key.toLowerCase();
    const step = key === 'j' || key === 'arrowdown' ? 1 : key === 'k' || key === 'arrowup' ? -1 : 0;
    if (step !== 0) {
      if (walk.length === 0) return false;
      const i = walk.findIndex(s => s.id === focusedId);
      const next = walk[i < 0 ? (step > 0 ? 0 : walk.length - 1) : (i + step + walk.length) % walk.length]!;
      setFocusedId(next.id);
      // Compare ids as data, never build a selector from one.
      [...(scroll.current?.querySelectorAll<HTMLElement>('[data-agent]') ?? [])].find(el => el.dataset.agent === next.id)?.focus();
      return true;
    }
    // A focused button or link keeps its own Entrée.
    if (e.key === 'Enter' && focusedId !== null && !target?.closest('button,a')) {
      dispatch({ type: 'open', id: focusedId });
      return true;
    }
    return false;
  });

  return (
    <div className="overview-scroll atelier" id="view-panel-atelier" role="tabpanel" aria-labelledby="view-tab-atelier" ref={scroll}>
      <div className={`office-shell ${nav.paused ? 'office-paused' : ''} ${reduced ? 'office-reduced' : ''}`}>
        <LedgeDesk count={activeCount(sessions)} chat={nav.chat} paused={nav.paused} onClick={() => dispatch({ type: 'chat' })} />
        <div className={`project-grid ${scene.tables.length === 1 ? 'focused' : ''}`}>
          {scene.tables.map(({ project, mains }) => (
            <ProjectTable key={project.id} project={project} mains={mains} order={order} helpers={nav.helpers} paused={nav.paused}
              isolated={filter === project.id} focusedId={focusedId} seated={null} dispatch={dispatch} />
          ))}
        </div>
        {scene.empty && <EmptyProject project={scene.empty} dispatch={dispatch} />}
        <Unassigned sessions={scene.unassigned} order={order} focusedId={focusedId} paused={nav.paused} dispatch={dispatch} />
      </div>
      <div className="workspace-legend">
        <span><i className="live-dot" />{t.atelier.legend.working}</span>
        <span><i className="approval-dot" />{t.atelier.legend.approval}</span>
        <span><i className="question-dot" />{t.atelier.legend.question}</span>
        <span><i className="done-dot" />{t.atelier.legend.done}</span>
        <span className="spacer" />
        <span>{t.atelier.legend.helper}</span>
      </div>
    </div>
  );
}
