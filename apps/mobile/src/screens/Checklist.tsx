import { useMemo, useState } from 'react';
import type { PhoneChecklist } from '@ledge/protocol';
import { copy } from '../copy';
import { Icon } from '../ui/icons';

const BOX = 'mt-px inline-flex size-4 flex-none items-center justify-center rounded-[4px] border';

/** An agent's checklist: folded to its progress and current task, unfolded to every task. */
/** `current` is the gateway's current task over the whole list, for when the capped `tasks` hold none in progress. */
export function Checklist({ checklist, current: whole }: { checklist: PhoneChecklist; current?: string }) {
  const [open, setOpen] = useState(false);
  const { tasks, done, total } = checklist;
  const current = tasks.find(t => t.status === 'in_progress')?.text ?? whole ?? (done === total ? copy.checklist.allDone : copy.checklist.paused);
  const currentTask = tasks.some(t => t.status === 'in_progress') || !!whole;
  const keys = useMemo(() => {
    const seen = new Map<string, number>();
    return tasks.map(x => { const n = seen.get(x.text) ?? 0; seen.set(x.text, n + 1); return n === 0 ? x.text : `${x.text}#${n}`; });
  }, [tasks]);
  return (
    <div className="sticky top-0 z-10 flex-none bg-bg">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={`flex min-h-11 w-full flex-col gap-1.5 border border-line bg-surface px-3 py-2.5 text-left text-[12px] leading-[18px] text-muted shadow-[0_4px_14px_rgba(0,0,0,.35)] ${open ? 'rounded-t-card' : 'rounded-card'}`}>
        <span className="flex w-full items-center gap-2">
          <Icon name="plan" className="size-3.5" stroke={1.8} />
          <strong className="font-medium text-fg">{copy.checklist.title}</strong>
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-fg">{done}/{total}</span>
          <span aria-hidden="true" className="h-1 w-16 overflow-hidden rounded-[2px] bg-raised"><span className="block h-full bg-ok" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
          <span className={open ? '-rotate-90' : 'rotate-90'}><Icon name="chevron" className="size-[13px]" stroke={2} /></span>
        </span>
        <span className="block w-full truncate">{currentTask && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-info align-[1px]" />}{current}</span>
      </button>
      {open && (
        <ol className="max-h-[50dvh] overflow-y-auto rounded-b-card border border-t-0 border-line bg-surface px-3 pt-1.5 pb-2.5 text-small">
          {tasks.map((x, i) => (
            <li key={keys[i]} className={`flex items-start gap-2.5 py-1.5 [overflow-wrap:anywhere] ${x.status === 'completed' ? 'text-muted line-through' : x.status === 'in_progress' ? 'font-medium text-fg' : 'text-fg'}`}>
              {x.status === 'completed' && <span role="img" aria-label={copy.checklist.box.completed} className={`${BOX} border-ok/50 font-mono text-[10px] font-semibold text-ok no-underline`}>✓</span>}
              {x.status === 'in_progress' && (
                <span role="img" aria-label={copy.checklist.box.in_progress} className={`${BOX} border-info`}>
                  <svg className="size-2.5 text-info motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>
                </span>
              )}
              {x.status === 'pending' && <span role="img" aria-label={copy.checklist.box.pending} className={`${BOX} border-fg/25`} />}
              {x.text}
            </li>
          ))}
          {checklist.cut && <li className="py-1.5 text-meta text-muted">{copy.checklist.cut}</li>}
        </ol>
      )}
    </div>
  );
}
