import type { ChatTaskProposal } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { useChatCopy } from './copy';

export interface TaskCardProps {
  tasks: ChatTaskProposal[];
  /** The row being given now. */
  busyRow: number | null; disabled: boolean;
  /** The turn proposes a team that is not launched yet: a task to `@role` waits for it (« active une fois l'équipe lancée »). */
  waitingTeam: boolean;
  onGive: (row: number) => void;
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };

/** The tasks Ledge proposes to give (roles spec §3.8), a row each: given by its button, then following its task live
 *  (« ✓ Confiée à Mila · t91b0d4 · prise », then « finie »). */
export function TaskCard(p: TaskCardProps) {
  const c = useChatCopy().chat.task!;
  return (
    <section data-task-card aria-label={c.label(p.tasks.length)} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {p.tasks.map((task, i) => {
        const waits = task.to.startsWith('@') && !task.team && p.waitingTeam;
        return (
          <div key={i} data-task-row={task.taskId ? 'given' : task.error ? 'failed' : 'proposed'} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', borderTop: i > 0 ? '1px solid var(--sidebar-border)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{task.title}</strong> <span style={muted}>{c.to} {task.toName ?? task.to}</span>
              </span>
              {task.taskId ? (
                <span data-task-state={task.state} style={muted}>✓ {c.given(task.ownerName ?? task.toName ?? task.to, task.taskId, c.state[task.state ?? 'open'])}</span>
              ) : (
                <Button variant="outline" size="sm" disabled={waits || p.disabled || p.busyRow !== null} onClick={() => p.onGive(i)} style={{ height: 26, padding: '0 10px', fontSize: 12 }}>
                  {p.busyRow === i ? c.giving : task.error ? c.retry : c.give}
                </Button>
              )}
            </div>
            {task.text && !task.taskId && <div style={{ ...muted, overflowWrap: 'anywhere' }}>{task.text}</div>}
            {waits && !task.taskId && <div style={{ ...muted, fontSize: 11.5 }}>{c.waitTeam}</div>}
            {task.error && !task.taskId && <div role="alert" style={{ color: 'var(--destructive)', overflowWrap: 'anywhere' }}>{c.failed(task.error)}</div>}
          </div>
        );
      })}
    </section>
  );
}
