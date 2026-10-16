import type { JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { Bot } from '@ledge/ui/bots/Bot';
import { botState, poseFor } from '@ledge/ui/bots/poseFor';
import { Badge } from '@ledge/ui/ui/Badge';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { taskOf } from '../nav/agents';
import type { NavAction } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';
import { useTheme } from '../shell/theme';
import { machineOf } from './ProjectTable';

/** « Sans projet » (observatory.tsx, `unassigned-zone` in atelier mode): the agents Ledge ties to no project wait in a
 *  taped-off area, one card each. The grip, dragging and « Ranger dans… » arrive with filing (task 6). */
export function Unassigned({ sessions, order, focusedId, paused, dispatch }: { sessions: readonly Session[]; order: readonly Session[]; focusedId: string | null; paused: boolean; dispatch: (a: NavAction) => void }): JSX.Element | null {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
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
          return (
            <div key={s.id} className={`unassigned-card ${focusedId === s.id ? 'keyboard-selected' : ''}`}>
              <button className="unassigned-open" data-agent={s.id} aria-label={`${s.name}, ${task}`} onClick={() => dispatch({ type: 'open', id: s.id })}>
                <Bot tool={s.tool} state={botState(s)} pose={poseFor(s.id, s.state)} size={56} theme={theme} seed={s.id} frozen={!!s.offline} paused={paused} reducedMotion={reduced} readOnly={s.source === 'hook_only'} />
                <span className="unassigned-copy">
                  <strong>{s.name}{n >= 1 && n <= 9 && <span className="seat-shortcut">Alt {n}</span>}</strong>
                  <span title={task}>{task}</span>
                  <code>{machineOf(s)} · {s.cwd}</code>
                </span>
              </button>
              <div className="unassigned-actions">
                {s.offline ? <Badge state="readonly" label={t.atelier.offline} /> : <Badge state={botState(s)} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
