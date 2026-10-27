import type { ComponentPropsWithRef } from 'react';

/**
 * The phone's buttons, one vocabulary for every screen. `primary` is the one action a screen leads to (the text colour
 * as a fill), `outline` the other ways, `ghost` a way that stays quiet, `brand` the chat's own red (the desktop's
 * --primary). `lg` closes a board, `md` a footer or a card, `sm` sits in a row. A tap darkens the button: no hover on a phone.
 */
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'brand';
export type ButtonSize = 'lg' | 'md' | 'sm';

const BASE = 'inline-flex items-center justify-center gap-2 rounded-control border text-center transition-[background-color,opacity] duration-100 disabled:opacity-45';
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-fg text-bg hover:opacity-90 active:opacity-75',
  outline: 'border-input bg-transparent text-fg hover:bg-raised/60 active:bg-raised',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-raised/60 active:bg-raised',
  brand: 'border-transparent bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-hover'
};
/** An icon alone is the control's whole name: drawn in the text colour, not muted. */
const ICON_GHOST = 'border-transparent bg-transparent text-fg hover:bg-raised/60 active:bg-raised';
const SIZE: Record<ButtonSize, string> = {
  lg: 'min-h-14 px-4 text-base font-semibold',
  md: 'min-h-12 px-4 py-2.5 text-[13px] leading-[1.4] font-medium',
  sm: 'min-h-11 px-3.5 text-[13px] font-medium'
};

export interface ButtonStyle { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string | undefined }

/** The classes of a button, for a link that looks like one. */
export const buttonClass = ({ variant = 'outline', size = 'md', block = false, className }: ButtonStyle = {}): string =>
  [BASE, VARIANT[variant], SIZE[size], block ? 'w-full' : '', className ?? ''].filter(Boolean).join(' ');

export function Button({ variant, size, block, className, type = 'button', ...rest }: ComponentPropsWithRef<'button'> & ButtonStyle) {
  return <button type={type} {...rest} className={buttonClass({ variant, size, block, className })} />;
}

/** A square button that holds only an icon: its name is `label`, read aloud and shown on a long press. */
export function IconButton({ label, variant = 'ghost', round = false, large = false, className, type = 'button', ...rest }: Omit<ComponentPropsWithRef<'button'>, 'aria-label'> & { label: string; variant?: ButtonVariant; round?: boolean; large?: boolean }) {
  return <button type={type} aria-label={label} title={label} {...rest} className={iconButtonClass({ variant, round, large, className })} />;
}

export const iconButtonClass = ({ variant = 'ghost', round = false, large = false, className }: { variant?: ButtonVariant; round?: boolean; large?: boolean; className?: string | undefined } = {}): string =>
  [BASE, variant === 'ghost' ? ICON_GHOST : VARIANT[variant], large ? 'size-12' : 'size-11', 'flex-none p-0', round ? 'rounded-full' : '', className ?? ''].filter(Boolean).join(' ');

/**
 * A chip: a quick reply, a suggestion, or a filter. A filter says whether it is on with `pressed`; a chip without it is
 * an action.
 */
export const chipClass = (pressed?: boolean): string =>
  `inline-flex min-h-11 flex-none items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-100 active:bg-raised ${
    pressed === undefined ? 'border-line bg-surface text-fg' : pressed ? 'border-fg/25 bg-raised text-fg' : 'border-transparent text-muted'}`;
