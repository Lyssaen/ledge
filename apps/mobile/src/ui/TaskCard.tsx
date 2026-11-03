import type { TaskNotice } from '@ledge/ui/thread/task';
import { copy } from '../copy';
import type { Tone } from '../model/agents';
import { Icon } from './icons';
import { useRaw } from './RigThread';
import { Tag } from './Tag';

const K = copy.thread.task;

/** Each state's tone and icon, as the desktop's task card (apps/desktop/src/session/Thread.tsx, `TASK`). */
const TONE: Record<TaskNotice['status'], { tone: Tone; text: string; icon: 'stop' | 'check' | 'close' | 'task' }> = {
  killed: { tone: 'attention', text: 'text-attention', icon: 'stop' },
  completed: { tone: 'ok', text: 'text-ok', icon: 'check' },
  failed: { tone: 'danger', text: 'text-danger-fg', icon: 'close' },
  other: { tone: 'muted', text: 'text-muted', icon: 'task' }
};

/**
 * A `<task-notification>` in the thread (a background agent or command that stopped or ended): « Tâche », its state,
 * what it was about, its exit code and output file, and the notification as it came one tap away.
 */
export function TaskCard({ task, cut }: { task: TaskNotice; cut?: true | undefined }) {
  const { toggle, box } = useRaw({ label: K.raw, text: task.raw });
  const tone = TONE[task.status];
  const status = K.statuses[task.status];
  const { about } = task;
  const code = about?.kind === 'command' ? about.code : undefined;
  const meta = [code !== undefined ? K.code(code) : null, task.output ?? null].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-1">
      <section aria-label={K.label(status)} data-status={task.status} className="flex w-full flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
        <div className="flex items-center gap-1.5">
          <Icon name={tone.icon} className={`size-3.5 ${tone.text}`} />
          <span className="text-meta font-medium tracking-[.04em] text-muted uppercase">{K.kicker}</span>
          <span className="flex-1" />
          <Tag tone={tone.tone} label={status} />
        </div>
        <p className="text-body [overflow-wrap:anywhere]">
          {about?.kind === 'agent' ? <>{K.agent} <strong className="font-semibold">{about.name}</strong> {K.agentDid[task.status]}</>
            : about?.kind === 'command' ? <>{K.command} <code className="rounded-[4px] bg-fg/[0.05] px-1 font-mono text-[.9em]">{about.command}</code> {K.commandDid[task.status]}</>
            : task.summary}
        </p>
        {meta && <p className="font-mono text-meta text-muted [overflow-wrap:anywhere]">{meta}</p>}
        <div className="flex items-center border-t border-dashed border-line pt-1.5"><span className="flex-1" />{toggle}</div>
        {box}
      </section>
      {cut && <div className="text-meta text-muted">{copy.thread.cut}</div>}
    </div>
  );
}
