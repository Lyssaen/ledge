import { memo, type JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { Spinner } from './ActionGroup';
import { doneCount, type Todo } from './todos';

export interface TodoBarProps {
  /** latestTodos: the shown thread's latest list. */
  todos: readonly Todo[];
  open: boolean;
  /** Stable (the page's callback): the page folds it on Escape too. */
  onToggle(): void;
  /** false offline: the box of the task in progress stands still. */
  live: boolean;
}

/** The agent's work plan on top of the thread (session.tsx todoBar), sticky while the thread scrolls: how many are done,
 *  a progress bar, the task in progress (else all done, or paused); unfolded, the checklist. Memoised: the page's clock
 *  leaves it alone, and its in-progress box turns on its own (Spinner). */
export const TodoBar = memo(function TodoBar({ todos, open, onToggle, live }: TodoBarProps): JSX.Element {
  const { t } = useI18n();
  const tt = t.session.todos;
  const done = doneCount(todos);
  const current = todos.find(x => x.status === 'in_progress');
  return (
    <div className={cls('todo-bar', open && 'open')}>
      <button type="button" className="todo-head" aria-expanded={open} onClick={onToggle}>
        <Icon d={SHELL_ICONS.plan} size={14} />
        <strong>{tt.workPlan}</strong>
        <span className="mono todo-count">{done}/{todos.length}</span>
        <span className="todo-progress" aria-hidden="true"><i style={{ width: `${(done / todos.length) * 100}%` }} /></span>
        <span className="todo-current">{current ? <><span className="todo-dot" />{current.text}</> : done === todos.length ? tt.allDone : tt.paused}</span>
        <Icon d={SHELL_ICONS.chevronDown} size={13} />
      </button>
      {open && (
        <ol className="todo-list">
          {todos.map((x, i) => (
            <li key={i} className={x.status}>
              <span className="todo-box" aria-label={tt.boxes[x.status]}>{x.status === 'completed' ? '✓' : x.status === 'in_progress' ? <Spinner live={live} /> : ''}</span>
              {x.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
