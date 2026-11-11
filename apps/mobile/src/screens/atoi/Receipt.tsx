import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RECEIPT_MS } from '../../model/atoi';
import { Icon, type IconName } from '../../ui/icons';
import { kitButtonClass } from '../../ui/kit/Controls';

/**
 * What a card becomes once decided (m1-a-toi.html §5, §6): one line in its place, so the list does not jump under the finger.
 * `ok` a decision taken, `denied` a refusal, `fail` / `warn` a failure or an uncertain end (they stay, with their action), `gone`
 * settled elsewhere (dashed, grey). Announced to a screen reader (`role=status`).
 */
export function Receipt({ tone, title, body, action }: {
  tone: 'ok' | 'denied' | 'fail' | 'warn' | 'gone'; title: string; body?: string | undefined;
  action?: { label: string; onClick: () => void; disabled?: boolean } | { label: string; href: string } | undefined;
}) {
  const icon: IconName = tone === 'ok' || tone === 'gone' ? 'check' : tone === 'denied' ? 'close' : 'alert';
  const iconTone = tone === 'ok' ? 'text-ok' : tone === 'fail' ? 'text-destructive' : tone === 'warn' ? 'text-attention' : 'text-muted';
  const frame = tone === 'gone' ? 'border-dashed border-line text-muted' : tone === 'fail' ? 'border-destructive/40' : tone === 'warn' ? 'border-attention/45' : 'border-line';
  return (
    <div role="status" data-receipt={tone} className={`flex min-h-[52px] items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 ${frame}`}>
      <Icon name={icon} className={`size-[18px] ${iconTone}`} />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className={`text-[13.5px] font-semibold [overflow-wrap:anywhere] ${tone === 'gone' ? 'text-fg' : ''}`}>{title}</b>
        {body && <small className="text-small [overflow-wrap:anywhere] text-muted">{body}</small>}
      </span>
      {action && ('href' in action
        ? <a href={action.href} className={kitButtonClass({ size: 'xs', className: 'flex-none' })}>{action.label}</a>
        : <button type="button" disabled={action.disabled} onClick={action.onClick} className={kitButtonClass({ size: 'xs', className: 'flex-none' })}>{action.label}</button>)}
    </div>
  );
}

/**
 * A receipt that leaves on its own: after `RECEIPT_MS` it folds in 200 ms (stilled by « Réduire les animations », styles.css), then
 * `onGone`. A receipt that stays (a failure) is not wrapped in this.
 */
export function Leaving({ onGone, children }: { onGone: () => void; children: ReactNode }) {
  const [leaving, setLeaving] = useState(false);
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), RECEIPT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => gone.current(), 200);
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <div data-leaving={leaving || undefined} className={`grid transition-[grid-template-rows,opacity] duration-200 ${leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]'}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * The list's entries in a stable order: those present now, in their order, and those just gone kept where they were (a ghost),
 * until `dismiss` lets them go. A ghost carries the last value seen, so its receipt can still say what it was.
 */
export function useSticky<T>(items: readonly { id: string; value: T }[]): { entries: { id: string; value: T; ghost: boolean }[]; dismiss: (id: string) => void; dismissed: ReadonlySet<string> } {
  const seen = useRef(new Map<string, { value: T; index: number }>());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const present = new Set(items.map(i => i.id));
  const entries: { id: string; value: T; ghost: boolean }[] = items.map(i => ({ ...i, ghost: false }));
  const ghosts = [...seen.current].filter(([id]) => !present.has(id) && !dismissed.has(id)).sort((a, b) => a[1].index - b[1].index);
  for (const [id, g] of ghosts) entries.splice(Math.min(g.index, entries.length), 0, { id, value: g.value, ghost: true });
  entries.forEach((e, index) => seen.current.set(e.id, { value: e.value, index }));
  // Forgotten once gone and let go: an id that comes back later is a new entry.
  for (const id of [...seen.current.keys()]) if (!present.has(id) && dismissed.has(id)) seen.current.delete(id);
  const dismiss = (id: string) => setDismissed(d => (d.has(id) ? d : new Set(d).add(id)));
  // A dismissed id present again (the same request shown anew) is shown: only gone ones stay dismissed.
  useEffect(() => {
    if ([...dismissed].some(id => !seen.current.has(id) && !present.has(id))) setDismissed(d => new Set([...d].filter(id => seen.current.has(id) || present.has(id))));
  });
  return { entries, dismiss, dismissed };
}
