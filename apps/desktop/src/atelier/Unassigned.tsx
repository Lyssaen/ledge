import { useEffect, useState, type JSX } from 'react';
import type { Project, Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { taskOf } from '../nav/agents';
import type { NavAction } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';
import { Menu, MenuItem } from '../shell/Menu';
import { SessionBot, StateBadge } from '../shell/SessionBot';
import { folderOf, type Filing } from './filing';
import { machineOf } from '../nav/agents';

/** « Sans projet » (observatory.tsx, `unassigned-zone` in atelier mode): the agents Ledge ties to no project wait in a
 *  taped-off area, one card each. A card drags onto a table or a sidebar project, or « Ranger dans… » files it (filing). */
export function Unassigned({ sessions, order, focusedId, paused, dispatch, filing, projects }: { sessions: readonly Session[]; order: readonly Session[]; focusedId: string | null; paused: boolean; dispatch: (a: NavAction) => void; filing: Filing; projects: readonly Project[] }): JSX.Element | null {
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
            <div key={s.id} {...drag} onDragStart={e => { setAssigning(null); drag.onDragStart(e); }} title={t.filing.grip}
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
                <Menu open={open} onOpenChange={o => setAssigning(o ? s.id : null)} label={t.filing.moveTo} className="assign-wrap" menuClassName="assign-menu"
                  trigger={tr => (
                    <Button variant="outline" size="sm" {...tr}>
                      <Icon d={ICONS.folder.d} size={13} />{t.filing.moveTo}
                    </Button>
                  )}>
                  {projects.map(p => (
                    <MenuItem key={p.id} onSelect={() => filing.file(s, p.id)}>
                      {p.name}<small>{p.repos.map(r => folderOf(r.path)).join(' · ')}</small>
                    </MenuItem>
                  ))}
                  <MenuItem className="assign-new" onSelect={() => dispatch({ type: 'modal', modal: { kind: 'project', file: s.id } })}>
                    <span><Icon d={ICONS.plus.d} size={12} />{t.filing.newProject}</span>
                    <small>{t.filing.from(s.cwd)}</small>
                  </MenuItem>
                </Menu>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
