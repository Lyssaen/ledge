import { useId, type ReactNode } from 'react';
import type { Tool } from '@ledge/protocol';
import { Icon } from '../icons';
import { Card } from './Box';
import { Dot, RuntimeTag, type DotState } from './marks';

/*
 * The redesign's controls (docs/mockups/ledge-mobile-refonte/m0-socle.html, §6): its buttons, filter chips, a detail
 * header, a composer, and a request card to act on. Every touch target is 44 px at least.
 */

export type KitButtonVariant = 'outline' | 'primary' | 'ghost';
/** 44 px, 36 (`sm`), 32 (`xs`, a row's small action). */
export type KitButtonSize = 'md' | 'sm' | 'xs';

const VARIANT: Record<KitButtonVariant, string> = {
  outline: 'border-input bg-surface dark:bg-transparent text-fg active:bg-raised',
  primary: 'border-transparent bg-primary text-primary-fg active:bg-primary-hover',
  ghost: 'border-transparent bg-transparent text-muted text-[13px] active:bg-raised'
};
const SIZE: Record<KitButtonSize, string> = { md: 'h-11 px-3.5 text-body', sm: 'h-9 px-3 text-[13px]', xs: 'h-8 px-2.5 text-[12.5px]' };

/** A button of the redesign, for a link that looks like one too. A ghost button is 36 px high, as the mockup draws it. */
export const kitButtonClass = ({ variant = 'outline', size = 'md', className }: { variant?: KitButtonVariant; size?: KitButtonSize; className?: string } = {}): string =>
  ['inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition-colors duration-100 disabled:opacity-45',
    VARIANT[variant], variant === 'ghost' ? 'h-9 px-3.5' : SIZE[size], className ?? ''].filter(Boolean).join(' ');

/** Filter chips: one on at a time, each with its count. */
export function FilterChips<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-none gap-1.5 overflow-x-auto">
      {options.map(o => (
        <button
          key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg border border-input px-3 text-[13px] font-medium whitespace-nowrap text-muted aria-pressed:border-ring aria-pressed:bg-raised aria-pressed:text-fg"
        >
          {o.label}{o.count !== undefined && <span className="font-mono text-meta">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A detail screen's head: back, the runtime, the name and its dot, where it works, and « Plus d'actions ». */
export function DetailHeader({ back, tool, name, dot, sub, more }: {
  back: ReactNode; tool?: Tool; name: string; dot?: DotState; sub?: string; more?: ReactNode;
}) {
  return (
    <header className="flex h-14 flex-none items-center gap-2 border-b border-line pr-1.5 pl-0.5">
      {back}
      {tool && <RuntimeTag tool={tool} />}
      <b className="text-base font-semibold whitespace-nowrap">{name}</b>
      {dot && <Dot state={dot} />}
      {sub && <span className="min-w-0 truncate text-small text-muted">{sub}</span>}
      <span className="flex-1" />
      {more}
    </header>
  );
}

/**
 * A message field and its send button: empty (nothing to send), typing, or offline (« Reconnecte-toi pour écrire »,
 * nothing can be typed).
 */
export function Composer({ label, sendLabel, placeholder, offlinePlaceholder, value, onChange, onSend, offline = false }: {
  label: string; sendLabel: string; placeholder: string; offlinePlaceholder: string;
  value: string; onChange: (v: string) => void; onSend: () => void; offline?: boolean;
}) {
  const id = useId();
  const canSend = !offline && value.trim() !== '';
  return (
    <div className={`flex items-end gap-2 rounded-[10px] border border-input bg-surface py-[5px] pr-[5px] pl-3 focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ring)_30%,transparent)] ${offline ? 'opacity-55' : ''}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id} rows={1} value={offline ? '' : value} disabled={offline} placeholder={offline ? offlinePlaceholder : placeholder}
        onChange={e => onChange(e.target.value)}
        className="min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-[7px] text-base leading-[22px] text-fg outline-none placeholder:text-muted"
      />
      <button type="button" disabled={!canSend} onClick={onSend} aria-label={sendLabel} title={sendLabel} className="grid size-9 flex-none place-items-center rounded-lg bg-primary text-primary-fg disabled:opacity-40">
        <Icon name="send" className="size-[18px]" />
      </button>
    </div>
  );
}

/**
 * A request to act on, in its base form (its variants are M1's): who asks and where, how long ago, what is asked, the two
 * answers, and « Toujours dans ce projet » when it applies. `disabled`: offline, the buttons stay and do nothing.
 */
export function RequestCard({ tone, tool, name, where, age, pill, children, actions, always, label }: {
  tone: 'perm' | 'ask' | 'rig'; tool: Tool; name: string; where?: string; age?: string; pill?: ReactNode;
  children: ReactNode; actions: ReactNode; always?: ReactNode; label?: string;
}) {
  return (
    <Card tone={tone} {...(label ? { label } : {})}>
      <div className="flex min-w-0 items-center gap-[7px]">
        <RuntimeTag tool={tool} />
        <b className="font-semibold whitespace-nowrap">{name}</b>
        {where && <span className="min-w-0 truncate text-small text-muted">{where}</span>}
        <span className="flex-1" />
        {age && <span className="font-mono text-small whitespace-nowrap text-muted">{age}</span>}
        {pill}
      </div>
      {children}
      <div className="grid grid-cols-2 gap-2">{actions}</div>
      {always}
    </Card>
  );
}

/** What a permission asks to run, in a code block. */
export function RequestCode({ children }: { children: string }) {
  return <code className="block rounded-[5px] bg-raised px-[9px] py-[7px] font-mono text-small leading-[18px] break-all whitespace-pre-wrap">{children}</code>;
}
