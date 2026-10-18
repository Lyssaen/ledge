import { useEffect, useState, type JSX, type MouseEvent } from 'react';
import type { Project, Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot, StateBadge } from '../shell/SessionBot';
import type { Filing } from './filing';
import { MoveTo } from './MoveTo';
import { machineOf, taskOf } from '../nav/agents';

/** « Sans projet » (observatory.tsx, `unassigned-zone` in atelier mode): the agents Ledge ties to no project wait in a
 *  taped-off area, one card each. A card drags onto a table or a sidebar project, or « Ranger dans… » files it (filing). */
export function Unassigned({ sessions, order, focusedId, paused, dispatch, filing, projects, onMenu }: { sessions: readonly Session[]; order: readonly Session[]; focusedId: string | null; paused: boolean; dispatch: (a: NavAction) => void; filing: Filing; projects: readonly Project[]; onMenu(s: Session, e: MouseEvent<HTMLElement>): void }): JSX.Element | null {
  const { t } = useI18n();
  // The card whose « Ranger dans… » menu is open.
  const [assigning, setAssigning] = useState<string | null>(null);
  // The menu's session left the zone (filed, gone): the menu goes with it.
  useEffect(() => { if (assigning !== null && !sessions.some(s => s.id === assigning)) setAssigning(null); }, [sessions, assigning]);
  if (sessions.length === 0) return null;
  return (
    <section className="unassigned-zone atelier" aria-labelledby="unassigned-title">
      <div className="unassigned-heading">
        <Icon d={SHELL_ICONS.unassigned} size={15} />
        <h2 id="unassigned-title">{t.side.unassigned}</h2>
        <span className="muted">{t.atelier.unassignedHint}</span>
      </div>
      <div className="unassigned-list">
        {sessions.map(s => {
          const n = order.findIndex(o => o.id === s.id) + 1;
          const task = taskOf(s);
          const drag = filing.dragProps(s);
          const open = assigning === s.id;
          return (
            <div key={s.id} {...drag} onDragStart={e => { setAssigning(null); drag.onDragStart(e); }} title={t.filing.grip} onContextMenu={e => onMenu(s, e)}
              className={`unassigned-card ${filing.dragging?.id === s.id ? 'is-dragged' : ''} ${focusedId === s.id ? 'keyboard-selected' : ''}`}>
              <span className="drag-grip" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
              <button className="unassigned-open" data-agent={s.id} aria-label={`${s.name}, ${task}`} onClick={() => dispatch({ type: 'open', id: s.id })}>
                <SessionBot session={s} size={56} paused={paused} />
                <span className="unassigned-copy">
                  <strong>{s.name}{n >= 1 && n <= 9 && <span className="seat-shortcut">Alt {n}</span>}</strong>
                  <span title={task}>{task}</span>
                  <code>{machineOf(s)} · {s.cwd}</code>
                </span>
              </button>
              <div className="unassigned-actions">
                <StateBadge state={botState(s)} offline={!!s.offline} />
                <span className="spacer" />
                <MoveTo session={s} projects={projects} filing={filing} dispatch={dispatch} open={open} onOpenChange={o => setAssigning(o ? s.id : null)} className="assign-wrap" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
