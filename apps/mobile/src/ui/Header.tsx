import { copy } from '../copy';
import { href } from '../router';
import type { MobileState } from '../state/store';
import { iconButtonClass } from './Button';
import { Icon } from './icons';

/** What the header says of the link: whether the state shown is the PC's now, and the PC's name. */
export interface LinkView { fresh: boolean; pc: string | null }
export const linkView = (s: Pick<MobileState, 'fresh' | 'daemon'>): LinkView => ({ fresh: s.fresh, pc: s.daemon?.name ?? null });


/** The PC and the link, with the way to the connection screen. */
export function LinkStatus({ link }: { link: LinkView }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-meta whitespace-nowrap text-muted">
      <i className={`inline-block size-1.5 flex-none rounded-full ${link.fresh ? 'bg-ok' : 'bg-muted'}`} />
      <span className="truncate">{link.pc ? `${link.pc} · ` : ''}{link.fresh ? copy.link.online : copy.link.offline}</span>
    </div>
  );
}

export function Header({ title, subtitle, link }: { title: string; subtitle: string; link: LinkView }) {
  return (
    <header className="flex-none pt-3 pb-[18px]">
      <div className="flex items-center justify-between gap-2.5">
        <LinkStatus link={link} />
        <a href={href({ name: 'connection' })} aria-label={copy.link.openConnection} className={iconButtonClass({ variant: 'outline' })}>
          <Icon name="gear" />
        </a>
      </div>
      <h1 className="mt-3 text-display leading-[1.15] font-semibold tracking-[-1px]">{title}</h1>
      <p className="mt-2 text-body text-muted">{subtitle}</p>
    </header>
  );
}

/** Back header of the detail screens. */
export function BackHeader({ title, backTo, label, link }: { title: string; backTo: string; label: string; link: LinkView }) {
  return (
    <header className="flex-none border-b border-line pt-2 pb-3">
      <div className="flex items-center gap-2.5">
        <a href={backTo} aria-label={label} className={iconButtonClass({ className: '-ml-2' })}>
          <Icon name="back" />
        </a>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <LinkStatus link={link} />
      </div>
    </header>
  );
}
