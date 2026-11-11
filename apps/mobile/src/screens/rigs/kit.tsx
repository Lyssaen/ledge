import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from '../../ui/icons';
import { Sheet } from '../../ui/Dialog';
import { kitButtonClass } from '../../ui/kit/Controls';
import { Switch } from '../../ui/Switch';

/*
 * The Rigs tab's own marks and rows (docs/mockups/ledge-mobile-refonte/m4-rigs.html, the page's classes): a status chip, an
 * attention tag, a section label, a rig row, a tile, a strip, a receipt, a stepper, the option and toggle rows of its sheets.
 */

/** A status chip's tone: green running (or ready), blue starting, amber partial, red a stale daemon, grey stopped. */
export type ChipTone = 'on' | 'go' | 'part' | 'bad' | 'plain';

const CHIP: Record<ChipTone, string> = {
  on: 'border-ok/40 text-ok', go: 'border-info/40 text-info', part: 'border-attention/45 text-attention',
  bad: 'border-approval/45 text-approval', plain: 'border-input text-muted'
};

/** A status in a chip with its dot, and nothing else (Q48: the reason is said apart). */
export function Chip({ tone, children }: { tone: ChipTone; children: string }) {
  return (
    <span data-chip={tone} className={`inline-flex h-[22px] flex-none items-center gap-1.5 rounded-full border px-[9px] text-[12px] font-medium whitespace-nowrap ${CHIP[tone]}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{children}
    </span>
  );
}

/** What waits on the person in a rig: a permission in red, a question in amber. */
export function Att({ perm = false, children }: { perm?: boolean; children: string }) {
  return <span data-att={perm ? 'perm' : 'ask'} className={`inline-flex h-[22px] items-center rounded-md px-2 text-[12px] whitespace-nowrap ${perm ? 'bg-approval/12 text-approval' : 'bg-attention/12 text-attention'}`}>{children}</span>;
}

/** A section's label, in capitals, with an aside on its right. */
export function Lbl({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="flex flex-none items-center gap-2 text-[11px] font-medium tracking-[.4px] text-muted uppercase">
      <span>{children}</span>
      {aside !== undefined && <span className="ml-auto text-[12px] font-normal tracking-normal normal-case">{aside}</span>}
    </h2>
  );
}

/** A framed list, its border violet for the rigs (`tone="rigs"`). */
export function Frame({ tone, label, children, className = '' }: { tone?: 'rigs'; label?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={`flex-none overflow-hidden rounded-[10px] border bg-surface dark:bg-transparent ${tone === 'rigs' ? 'border-task/45' : 'border-line'} ${className}`}>
      {children}
    </section>
  );
}

/** A row of the list: its lead (a dot or the daemon's glyph), the name and its chip, a line under it, what waits, and a chevron when it opens. */
export function RRow({ lead, name, chip, sub, att, href, dim = false, selected = false, label }: {
  lead: ReactNode; name: string; chip: ReactNode; sub?: string; att?: ReactNode; href?: string; dim?: boolean; selected?: boolean; label?: string;
}) {
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2"><b className={`truncate text-[14.5px] font-semibold ${dim ? 'text-muted' : ''}`}>{name}</b>{chip}</span>
        {sub && <small className="text-[12px] text-muted">{sub}</small>}
        {att && <span className="flex flex-wrap gap-1.5">{att}</span>}
      </span>
      {href && <Icon name="chevron" className="size-4 text-muted" />}
    </>
  );
  const className = `flex min-h-[60px] items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 ${selected ? 'bg-secondary' : ''}`;
  return href
    ? <a href={href} aria-label={label} aria-current={selected ? 'page' : undefined} className={className}>{body}</a>
    : <div className={className}>{body}</div>;
}

/** A tile of the rig's head: a label and a value; one that opens a sheet has its chevron. */
export function Tile({ label, value, onOpen }: { label: string; value: string; onOpen?: () => void }) {
  const inner = <><small className="text-[11.5px] text-muted">{label}</small><b className="truncate text-[17px] font-semibold">{value}</b></>;
  const className = 'relative flex min-w-0 flex-col gap-px rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left';
  return onOpen
    ? <button type="button" onClick={onOpen} className={className}>{inner}<span aria-hidden="true" className="absolute top-[7px] right-[9px] text-muted">›</span></button>
    : <div className={className}>{inner}</div>;
}

/** A band over the content: what waits, OpenRig not answering, a partial rig. `warn`: its border amber. */
export function Strip({ lead, warn = false, children, action, role, compact = false }: { lead: ReactNode; warn?: boolean; children: ReactNode; action?: ReactNode; role?: 'status' | 'alert'; compact?: boolean }) {
  return (
    <div role={role} className={`strip flex flex-none gap-[9px] rounded-lg border text-[13px] leading-[18px] ${compact ? 'items-center px-2.5 py-2' : 'items-start px-3 py-2.5'} ${warn ? 'border-attention/40' : 'border-line'}`}>
      {lead}
      <div className={`flex min-w-0 flex-1 flex-col ${compact ? '' : 'gap-2'}`}>{children}</div>
      {action}
    </div>
  );
}

/** An action's end: done (✓), refused or failed (✕), or to try again (!). */
export function Receipt({ mark, title, sub, children, onClose, closeLabel }: { mark: 'ok' | 'bad' | 'warn' | 'ask'; title: string; sub?: ReactNode; children?: ReactNode; onClose?: () => void; closeLabel?: string }) {
  const glyph = { ok: '✓', bad: '✕', warn: '!', ask: '?' }[mark];
  const tone = { ok: 'text-ok', bad: 'text-approval', warn: 'text-attention', ask: 'text-attention' }[mark];
  return (
    <div role={mark === 'ok' ? 'status' : 'alert'} data-receipt={mark} className={`flex min-h-12 items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 text-[13px] leading-[18px] ${mark === 'bad' ? 'border-destructive/45' : 'border-line'}`}>
      <span aria-hidden="true" className={tone}>{glyph}</span>
      <div className="min-w-0 flex-1">
        <b className="font-semibold">{title}</b>
        {sub !== undefined && <small className="block text-[12px] text-muted [overflow-wrap:anywhere]">{sub}</small>}
        {children}
      </div>
      {onClose && closeLabel && (
        <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} className="grid size-9 flex-none place-items-center rounded-lg text-muted active:bg-raised">
          <Icon name="close" className="size-4" />
        </button>
      )}
    </div>
  );
}

/** The commands an action ran, as the PC shows them (without its paths). */
export function Commands({ commands }: { commands: readonly string[] }) {
  if (!commands.length) return null;
  return <code className="mt-1.5 block rounded-md bg-raised px-2 py-1.5 font-mono text-[12px] break-all whitespace-pre-wrap text-muted">{commands.join('\n')}</code>;
}

/** What a stop costs, in red, before the button that does it. */
export function Conseq({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-danger-bg/70 px-2.5 py-[9px] text-[13px] leading-[18px]">
      <Icon name="warning" className="mt-px size-4 text-approval" />
      <div className="min-w-0"><b className="block font-semibold">{title}</b>{body !== undefined && <span className="text-muted">{body}</span>}</div>
    </div>
  );
}

/** A spinner, the size of a line of text. */
export const Spinner = ({ className = 'text-info' }: { className?: string }) =>
  <span aria-hidden="true" className={`inline-block size-[13px] flex-none animate-spin rounded-full border-[1.6px] border-current border-r-transparent ${className}`} />;

/** An action under way, in a band: the rig answers when it is done. */
export function HoldBar({ children, bar = false }: { children: ReactNode; bar?: boolean }) {
  return (
    <div role="status" className={`flex flex-none items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-muted ${bar ? 'bleed border-t border-line bg-sidebar' : 'rounded-lg border border-line'}`}>
      <Spinner /><span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** A choice among a few, side by side (the page's `.seg`). */
export function Seg<T extends string>({ label, options, value, onChange, disabled = false }: { label: string; options: readonly { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-none self-start overflow-hidden rounded-lg border border-input">
      {options.map(o => (
        <button key={o.value} type="button" disabled={disabled} aria-pressed={o.value === value} onClick={() => onChange(o.value)} className="h-9 px-3.5 text-[13px] font-medium text-muted aria-pressed:bg-raised aria-pressed:text-fg disabled:opacity-45">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One option of a sheet: its name, what it means, pressed when chosen. */
export function Opt({ pressed, title, sub, onClick, disabled = false }: { pressed: boolean; title: ReactNode; sub?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick} className="flex flex-col gap-0.5 rounded-lg border border-input px-[11px] py-[9px] text-left text-[13.5px] font-medium aria-pressed:border-ring aria-pressed:bg-secondary aria-pressed:shadow-[inset_0_0_0_1px_var(--color-ring)] disabled:opacity-45">
      <span>{title}</span>
      {sub && <small className="text-[11.5px] font-normal text-muted">{sub}</small>}
    </button>
  );
}

/** A box ticked or not, in a row of a sheet. */
export function CheckRow({ on, label, onChange, disabled = false }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex min-h-12 items-center gap-3 border-b border-line px-3 py-1.5 text-[13.5px] last:border-b-0 ${disabled ? 'opacity-45' : ''}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className={`grid size-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] text-[12px] peer-focus-visible:outline-2 peer-focus-visible:outline-info ${on ? 'border-primary bg-primary text-primary-fg' : 'border-input'}`}>{on ? '✓' : ''}</span>
      <span className="min-w-0 flex-1">{label}</span>
    </label>
  );
}

/** A switch in a row: a start choice of the daemon. */
export function ToggleRow({ on, label, hint, onChange, disabled = false }: { on: boolean; label: string; hint?: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-line px-3 py-1.5 text-[13.5px] last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col"><span>{label}</span>{hint && <small id={id} className="text-[12px] text-muted">{hint}</small>}</div>
      <Switch on={on} label={label} onChange={onChange} {...(disabled ? { disabled } : {})} {...(hint ? { describedBy: id } : {})} />
    </div>
  );
}

/** A role's count, from 0 to 9: − and +. */
export function Stepper({ value, changed, min = 0, max = 9, fewer, more, onChange, disabled = false }: {
  value: number; changed: boolean; min?: number; max?: number; fewer: string; more: string; onChange: (v: number) => void; disabled?: boolean;
}) {
  const btn = 'h-9 w-10 text-[17px] text-fg disabled:opacity-35';
  return (
    <span className={`inline-flex flex-none items-center overflow-hidden rounded-lg border ${changed ? 'border-ring' : 'border-input'}`}>
      <button type="button" aria-label={fewer} title={fewer} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} className={btn}>−</button>
      <span aria-live="polite" className="min-w-[30px] text-center font-mono text-[14px]">{value}</span>
      <button type="button" aria-label={more} title={more} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} className={btn}>+</button>
    </span>
  );
}

/** A sheet of the Rigs tab: its title, then what it holds. */
export function RigSheet({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const id = useId();
  return (
    // While the passkey is asked, nothing closes the sheet: its end must land here.
    <Sheet labelledBy={id} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={id} className="text-[17px] leading-6 font-semibold">{title}</h2>
      {children}
    </Sheet>
  );
}

/** A button of the redesign in its Rigs forms: `danger` outlined red, `dangerfill` filled (« … avec Face ID »). */
export function rigButtonClass({ tone = 'outline', size = 'md', className = '' }: { tone?: 'outline' | 'primary' | 'danger' | 'dangerfill'; size?: 'md' | 'sm' | 'xs'; className?: string } = {}): string {
  const base = kitButtonClass({ variant: tone === 'primary' ? 'primary' : 'outline', size, className });
  if (tone === 'danger') return `${base} !border-approval/50 !text-approval`;
  if (tone === 'dangerfill') return `${base} !border-transparent !bg-destructive !text-primary-fg dark:!bg-primary`;
  return base;
}

/** A button with its icon. */
export function IconLabel({ icon, children, size = 'size-4' }: { icon: IconName; children: ReactNode; size?: string }) {
  return <><Icon name={icon} className={size} />{children}</>;
}
