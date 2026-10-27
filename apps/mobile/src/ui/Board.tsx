import type { ReactNode } from 'react';
import { buttonClass } from './Button';

/** The one action the board leads to, and the other ways out: the large buttons of ui/Button. */
export const PRIMARY = buttonClass({ variant: 'primary', size: 'lg', block: true });
export const OUTLINE = buttonClass({ size: 'lg', block: true });
export const ICON = 'size-5 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]';
export const H1 = 'text-2xl leading-8 font-semibold tracking-[-.025em]';

/** A screen of the account and pairing boards: one column, no tab bar, its actions at the bottom. */
export function Board({ children, top = 'pt-24' }: { children: ReactNode; top?: string }) {
  return <main className={`flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-[34px] ${top}`}>{children}</main>;
}

/** The space that pushes what follows to the bottom of a board. */
export const Fill = () => <div className="flex-grow" aria-hidden="true" />;

export function Spinner({ size = 'size-8' }: { size?: string }) {
  return <svg className={`${ICON} ${size} animate-spin text-muted`} viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>;
}
